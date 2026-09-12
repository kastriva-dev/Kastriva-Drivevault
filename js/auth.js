/* auth.js — Autentikasi Kastriva-DriveVault (#29).
   Login/Register/Logout/Session (token sesi di sessionStorage) + User Profile.
   Semua API call memakai token; data terisolasi per user di server (owner). */
(function () {
  'use strict';
  const MM = window.MM;
  const KEY = 'gfm.auth.v1';

  const A = {
    user: null,
    token: null,
  };

  function load() {
    try {
      const j = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      if (j && j.token) { A.token = j.token; A.user = j.user; }
    } catch {}
  }
  function persist() {
    try {
      if (A.token) sessionStorage.setItem(KEY, JSON.stringify({ token: A.token, user: A.user }));
      else sessionStorage.removeItem(KEY);
    } catch {}
  }

  A.isAuth = () => !!A.token;
  A.header = () => (A.token ? { token: A.token } : {});

  /* sisipkan token ke setiap panggilan API */
  const origCall = MM.api.call.bind(MM.api);
  MM.api.call = async function (action, payload = {}) {
    const p = { ...A.header(), ...payload };
    try {
      return await origCall(action, p);
    } catch (err) {
      if (err && /unauthorized/i.test(err.message)) { A.forceLogout(); }
      throw err;
    }
  };

  async function authCall(action, payload) {
    if (window.gfmDesktop) {
      const r = await window.gfmDesktop.cloudCall(action, payload || {});
      if (!r || r.ok === false || r.success === false) throw new Error((r && (r.error || r.message)) || 'Autentikasi cloud gagal');
      return r;
    }
    return origCall(action, payload || {});
  }

  A.login = async function (email, password) {
    const r = await authCall('login', { email, password });
    A.token = r.data.token;
    A.user = r.data.user;
    persist();
    return r.data.user;
  };
  A.register = async function (email, name, password) {
    const r = await authCall('register', { email, name, password });
    A.token = r.data.token;
    A.user = r.data.user;
    persist();
    return r.data.user;
  };
  A.logout = async function () {
    try { if (A.token) await authCall('logout', { token: A.token }); } catch {}
    A.forceLogout();
  };
  A.forceLogout = function () {
    A.token = null; A.user = null; persist();
    document.body.classList.add('auth-locked');
    location.reload();
  };
  A.me = async function () {
    const r = await authCall('me', { token: A.token });
    A.user = r.data.user;
    persist();
    return A.user;
  };

  /* ---------- UI: overlay login + tombol profile ---------- */
  function ensureUI() {
    if ($('#auth-overlay')) return;
    const ov = document.createElement('div');
    ov.id = 'auth-overlay';
    ov.className = 'auth-overlay hidden';
    const desktopCloud = !!window.gfmDesktop;
    ov.innerHTML =
      '<div class="glass auth-card">' +
      '<img class="auth-logo" src="assets/icons/logo.png" alt="Logo Kastriva-DriveVault">' +
      '<h2 id="auth-title">' + (desktopCloud ? 'Masuk ke Cloud' : 'Masuk ke Kastriva-DriveVault') + '</h2>' +
      '<div class="auth-err hidden" id="auth-err"></div>' +
      '<input class="input" id="auth-email" type="email" placeholder="Email" autocomplete="username">' +
      '<input class="input" id="auth-pass" type="password" placeholder="Password (min. 10, huruf + angka)" autocomplete="current-password">' +
      '<input class="input hidden" id="auth-name" placeholder="Nama tampilan" autocomplete="name">' +
      '<button class="btn primary" id="auth-go">Login</button>' +
      '<button class="btn" id="auth-switch">Belum punya akun? Daftar</button>' +
      (desktopCloud ? '' : '<div class="auth-demo">Demo: uji@gfm.app / password123</div>') +
      '</div>';
    document.body.appendChild(ov);
    let reg = false;
    ov.querySelector('#auth-switch').addEventListener('click', () => {
      reg = !reg;
      ov.querySelector('#auth-title').textContent = reg ? 'Daftar akun baru' : (desktopCloud ? 'Masuk ke Cloud' : 'Masuk ke Kastriva-DriveVault');
      ov.querySelector('#auth-go').textContent = reg ? 'Daftar' : 'Login';
      ov.querySelector('#auth-name').classList.toggle('hidden', !reg);
      ov.querySelector('#auth-switch').textContent = reg ? 'Sudah punya akun? Login' : 'Belum punya akun? Daftar';
      ov.querySelector('#auth-err').classList.add('hidden');
    });
    const submit = async () => {
      const err = ov.querySelector('#auth-err');
      err.classList.add('hidden');
      const email = ov.querySelector('#auth-email').value.trim();
      const pass = ov.querySelector('#auth-pass').value;
      const name = ov.querySelector('#auth-name').value.trim();
      try {
        if (reg) await A.register(email, name, pass);
        else await A.login(email, pass);
        ov.classList.add('hidden');
        document.body.classList.remove('auth-locked');
        location.reload(); // muat ulang data milik user ini
      } catch (e2) {
        err.textContent = e2.message;
        err.classList.remove('hidden');
      }
    };
    ov.querySelector('#auth-go').addEventListener('click', submit);
    ov.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') submit(); }));

    // tombol profile di topbar
    const btn = document.createElement('button');
    btn.id = 'btn-profile';
    btn.className = 'btn icon';
    btn.title = 'Profil & logout';
    btn.textContent = '👤';
    btn.addEventListener('click', () => {
      const u = A.user || {};
      window.App.openDialog('User Profile',
        '<table class="props">' +
        '<tr><td>Nama</td><td>' + (u.name || '—') + '</td></tr>' +
        '<tr><td>Email</td><td>' + (u.email || '—') + '</td></tr>' +
        '<tr><td>Sejak</td><td>' + (u.created ? new Date(u.created).toLocaleDateString('id-ID') : '—') + '</td></tr>' +
        '</table>', null, 'Tutup');
      // tawarkan logout via tombol tambahan pada dialog
      const ok = document.querySelector('#dialog-ok');
      ok.textContent = 'Logout';
      ok.onclick = async (ev) => { ev.preventDefault(); document.querySelector('#dialog').close(); await A.logout(); };
    });
    const actions = document.querySelector('.topbar-actions');
    if (actions) actions.prepend(btn);
  }

  function $ (s) { return document.querySelector(s); }

  A.enableCloudAuth = async function () {
    if (!window.gfmDesktop) return;
    ensureUI();
    document.body.classList.add('auth-locked');
    $('#auth-overlay').classList.remove('hidden');
  };

  A.wire = async function () {
    if (window.gfmDesktop) {
      const info = await window.gfmDesktop.info().catch(() => null);
      if (info && info.cloudConfigured) {
        load();
        ensureUI();
        if (A.isAuth()) {
          try {
            await A.me();
            document.body.classList.remove('auth-locked');
            return;
          } catch {
            A.token = null; A.user = null; persist();
          }
        }
        document.body.classList.add('auth-locked');
        $('#auth-overlay').classList.remove('hidden');
        return;
      }
      A.token = 'desktop-local';
      A.user = { id: 'desktop-local', name: 'Pengguna Lokal', email: 'local@desktop' };
      return;
    }
    load();
    ensureUI();
    if (!A.isAuth()) {
      document.body.classList.add('auth-locked');
      $('#auth-overlay').classList.remove('hidden');
    } else {
      document.body.classList.remove('auth-locked');
    }
  };

  window.MMAuth = A;
})();
