/**
 * Authentication service untuk GFileManager.
 * Password: salted iterative HMAC-SHA256 + server-side pepper.
 * Session: random bearer token; hanya SHA-256 token yang disimpan.
 */
var AUTH_USERS_KEY = 'GFM_USERS_V1';
var AUTH_SESSIONS_KEY = 'GFM_SESSIONS_V1';
var AUTH_PEPPER_KEY = 'GFM_AUTH_PEPPER_V1';
var AUTH_KDF_ITERATIONS = 12000;
var AUTH_SESSION_MS = 7 * 24 * 60 * 60 * 1000;

function authLoadJson_(key, fallback) {
  var raw = PropertiesService.getScriptProperties().getProperty(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch (err) { return fallback; }
}
function authSaveJson_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(value));
}
function authBytesHex_(bytes) {
  return bytes.map(function (b) {
    var n = b < 0 ? b + 256 : b;
    return ('0' + n.toString(16)).slice(-2);
  }).join('');
}
function authSha256_(value) {
  return authBytesHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8));
}
function authPepper_() {
  var props = PropertiesService.getScriptProperties();
  var pepper = props.getProperty(AUTH_PEPPER_KEY);
  if (!pepper) {
    pepper = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
    props.setProperty(AUTH_PEPPER_KEY, pepper);
  }
  return pepper;
}
function authRandomToken_() {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    Utilities.getUuid() + Utilities.getUuid() + new Date().getTime() + Math.random(),
    Utilities.Charset.UTF_8
  )).replace(/=+$/g, '');
}
function authPasswordHash_(password, salt, iterations) {
  var value = String(password) + '|' + authPepper_();
  var key = String(salt);
  var rounds = Number(iterations || AUTH_KDF_ITERATIONS);
  for (var i = 0; i < rounds; i++) {
    value = authBytesHex_(Utilities.computeHmacSha256Signature(value, key, Utilities.Charset.UTF_8));
    key = salt + ':' + (i % 257);
  }
  return value;
}
function authSafeEqual_(a, b) {
  a = String(a || ''); b = String(b || '');
  var diff = a.length ^ b.length;
  var max = Math.max(a.length, b.length);
  for (var i = 0; i < max; i++) diff |= (a.charCodeAt(i % (a.length || 1)) || 0) ^ (b.charCodeAt(i % (b.length || 1)) || 0);
  return diff === 0;
}
function authNormalizeEmail_(email) { return String(email || '').trim().toLowerCase(); }
function authPublicUser_(user) {
  return { id: user.id, email: user.email, name: user.name, created: user.created };
}
function authCleanName_(name, email) {
  var clean = String(name || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 80);
  return clean || String(email).split('@')[0].slice(0, 80);
}
function authIssueSession_(userId) {
  var sessions = authLoadJson_(AUTH_SESSIONS_KEY, {});
  var now = new Date().getTime();
  Object.keys(sessions).forEach(function (key) {
    if (!sessions[key] || Number(sessions[key].expiresAt || 0) <= now) delete sessions[key];
  });
  var token = authRandomToken_();
  sessions[authSha256_(token)] = { userId: userId, createdAt: now, expiresAt: now + AUTH_SESSION_MS };
  authSaveJson_(AUTH_SESSIONS_KEY, sessions);
  return token;
}
function authRequireUser_(token) {
  if (!token) return null;
  var sessions = authLoadJson_(AUTH_SESSIONS_KEY, {});
  var key = authSha256_(token);
  var session = sessions[key];
  if (!session || Number(session.expiresAt || 0) <= new Date().getTime()) {
    if (session) { delete sessions[key]; authSaveJson_(AUTH_SESSIONS_KEY, sessions); }
    return null;
  }
  var users = authLoadJson_(AUTH_USERS_KEY, []);
  for (var i = 0; i < users.length; i++) if (users[i].id === session.userId) return users[i];
  return null;
}
function authFailureLimited_(email) {
  var cache = CacheService.getScriptCache();
  var key = 'auth-fail-' + authSha256_(email).slice(0, 24);
  var count = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(count), 900);
  return count >= 8;
}
function authClearFailures_(email) {
  CacheService.getScriptCache().remove('auth-fail-' + authSha256_(email).slice(0, 24));
}
function authHandle_(action, p) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var users = authLoadJson_(AUTH_USERS_KEY, []);
    if (action === 'register') {
      var email = authNormalizeEmail_(p.email);
      var password = String(p.password || '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return apiError_('Email tidak valid', 'INVALID_EMAIL');
      if (password.length < 10 || password.length > 256) return apiError_('Password minimal 10 karakter', 'WEAK_PASSWORD');
      if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return apiError_('Password harus mengandung huruf dan angka', 'WEAK_PASSWORD');
      for (var i = 0; i < users.length; i++) if (users[i].email === email) return apiError_('Akun sudah terdaftar', 'ACCOUNT_EXISTS');
      var salt = authRandomToken_();
      var user = {
        id: 'user-' + Utilities.getUuid(), email: email, name: authCleanName_(p.name, email),
        salt: salt, iterations: AUTH_KDF_ITERATIONS,
        passwordHash: authPasswordHash_(password, salt, AUTH_KDF_ITERATIONS),
        created: new Date().toISOString(), active: true
      };
      users.push(user); authSaveJson_(AUTH_USERS_KEY, users);
      return apiSuccess_({ user: authPublicUser_(user), token: authIssueSession_(user.id) }, 'Registrasi berhasil');
    }
    if (action === 'login') {
      var loginEmail = authNormalizeEmail_(p.email);
      var found = null;
      for (var j = 0; j < users.length; j++) if (users[j].email === loginEmail) { found = users[j]; break; }
      if (!found || found.active === false || !authSafeEqual_(authPasswordHash_(String(p.password || ''), found.salt || 'invalid', found.iterations || AUTH_KDF_ITERATIONS), found.passwordHash)) {
        if (authFailureLimited_(loginEmail)) return apiError_('Terlalu banyak percobaan. Coba lagi dalam 15 menit.', 'RATE_LIMITED');
        return apiError_('Email atau password salah', 'INVALID_CREDENTIALS');
      }
      authClearFailures_(loginEmail);
      return apiSuccess_({ user: authPublicUser_(found), token: authIssueSession_(found.id) }, 'Login berhasil');
    }
    if (action === 'logout') {
      var sessions = authLoadJson_(AUTH_SESSIONS_KEY, {});
      delete sessions[authSha256_(p.token || '')];
      authSaveJson_(AUTH_SESSIONS_KEY, sessions);
      return apiSuccess_(null, 'Logout berhasil');
    }
    if (action === 'me') {
      var current = authRequireUser_(p.token);
      return current ? apiSuccess_({ user: authPublicUser_(current) }, 'Sesi aktif') : apiError_('Unauthorized', 'AUTH');
    }
    return apiError_('Action autentikasi tidak dikenal', 'UNKNOWN_ACTION');
  } finally { lock.releaseLock(); }
}
