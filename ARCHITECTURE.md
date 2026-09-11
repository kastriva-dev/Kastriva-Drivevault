# GFileManager — Arsitektur

PWA file manager dengan penyimpanan lokal (IndexedDB/LocalStorage) + Cloud (Google Apps Script + Google Drive), desain Glassmorphism.

## Struktur

```
GFileManager/
├── index.html            Halaman utama (grid/list, context menu, multi-select, DnD upload)
├── p/index.html          Halaman link publik /p/<token> (visitor anonim, tanpa login)
├── css/app.css           Glassmorphism UI (translucent panels, backdrop blur, tanpa h-scroll)
├── js/core.js            util + store lokal (IndexedDB) + API client (MM namespace)
├── js/auth.js            #29 sesi token (login/register) + sisip token ke semua api.call
├── js/sync.js            Sync Engine: Local→Cloud / Cloud→Local / Two-Way (anti-overwrite)
├── js/app-*.js           UI controller: render, context menu, upload, sync UI, share dialog
├── manifest.json         PWA manifest (standalone, ikon, theme)
├── sw.js                 Service worker: offline shell + cache assets (stale-while-revalidate)
├── backend/Code.gs       Backend Google Apps Script asli (DriveApp) — paritas aksi dgn mock
├── api/gas.js            Proxy Vercel → Apps Script Web App (POST JSON + GET query, timeout 25s)
├── vercel.json           Rewrite /p/:token -> /p/index.html + header no-store
├── dev/mock-server.mjs   Backend tiruan di disk (port 8177) untuk dev/test tanpa Google
├── dev/gen-icons.mjs     Generator ikon PNG (192/512 + maskable + favicon)
├── dev/share-check.cjs   Verifikasi UI dialog Share (13 cek)
├── dev/public-link-check.cjs  Verifikasi E2E /p/<token> anonim (server 8190, 9 cek)
└── tests/                node --test: sync engine, mock API, proxy modul API, validasi aset PWA
```

## Data model

Satu entitas file/folder:

```js
{ id, name, type: "file"|"folder", parentId: "root"|<folderId>,
  size: 0, mime: "", modified: ISO, deleted: false, version: N }
```

- **Lokal**: IndexedDB `gfm` → store `entries`, `blobs` (Blob biner file).
- **Cloud**: Apps Script menyimpan metadata di PropertiesService/Sheet + file biner di Google Drive (folder per parentId, lookup by id).

## API (?action=...)

| action | payload | hasil |
|---|---|---|
| list | — | `{ok, data:[entry]}` semua entri (inkl. deleted utk sync) |
| upload | {parentId, name, mime, size, dataUrl} | `{ok, data:entry}` |
| delete | {ids} | `{ok}` soft-delete |
| createFolder | {parentId, name} | `{ok, data:entry}` |
| rename | {id, name} | `{ok, data:entry}` |
| move | {ids, parentId} | `{ok}` |
| favorite | {id, on} | `{ok, data:entry}` |
| download | {id} | `{ok, data:{dataUrl}}` |
| register / login / logout / me | {email, password, name} / {token} | sesi token (hash scrypt, tanpa plaintext) |
| quota | {token} | `{ok, data:{used, limit}}` |
| share | {id, mode: private\|shared\|public, emails} | ubah izin sharing; public -> token link acak |
| shareInfo | {id} | `{ok, data:{share}}` |
| sharedList | {token} | entri milik orang lain yang dishare ke saya (read-only) |
| publicGet | {link} (GET, tanpa login) | metadata+isi via token publik; token cabut = "link tidak valid" |

### Modul API (proxy + rute publik)

- `api/gas.js` — proxy single-entry: POST JSON apa adanya ke `GAS_URL`; GET meneruskan query string
  (jalur `publicGet` dari halaman `/p/<token>`); respons upstream non-JSON / HTTP error → `502 {ok:false}`;
  timeout 25s; selalu `Cache-Control: no-store`; env hilang → 500 dengan pesan jelas.
- `p/index.html` — halaman link publik sisi klien (tanpa build): baca token dari pathname (regex ketat
  8–64 char), panggil `publicGet` anonim, render nama/ukuran/pratinjau gambar-PDF + unduh via Blob URL.
  Rute `/p/*` dilayani oleh mock server (dev) dan `vercel.json` rewrite (produksi). Tidak pernah
  me-listing isi drive; satu token = satu file.
- `js/core.js` — `MM.api.share|shareInfo|sharedList|publicGet` pembungkus tipis; token disisipkan
  otomatis oleh hook `MMAuth` (kecuali `publicGet` yang memang anonim).
- Paritas kontrak diuji: daftar `case '...'` mock-server ⊆/⊇ `Code.gs` (tests/api-proxy.test.mjs).

## Keamanan (#31–#33)

- **Least privilege**: auth gate server-side — semua action kecuali `register|login|_reset|publicGet` wajib token sesi; data terisolasi per `owner`.
- **Tanpa plaintext**: password disimpan sebagai `scrypt(password, per-user salt)`; tidak ada secret/credential GAS di frontend (proxy `api/gas.js` di server).
- **Nama file tidak dipercaya** (`sanitizeName`): strip `\ / : * ? " < > |`, control char, `..`, titik/spasi di ujung; nama perangkat Windows (`con`, `nul`, `com1`…) diberi prefiks `_`. Blob selalu disimpan dengan key id buatan server, bukan nama.
- **Path traversal**: static server menolak rute di luar ROOT (cek boundary separator); input path dari client tak pernah di-resolve langsung.
- **Sharing eksplisit**: mode wajib `private|shared|public`; tidak pernah public otomatis; keluar dari public mematikan token; `shared` default role `viewer`.
- **Notification**: toast 3 varian (success/error/info) + notifikasi upload selesai/gagal.

## Sync Engine (js/sync.js)

Prinsip: **tidak pernah menimpa file tanpa pengecekan.**

Per entri dibandingkan 3 sisi: Local (L), Cloud (C), berdasarkan `modified` + `version` + hash blob.

- `Local → Cloud`: push entri lokal yang lebih baru/lebih baru versinya; jika C masih ada versi lama → timpa dengan catatan di log; jika C **lebih baru juga** → konflik.
- `Cloud → Local`: mirror sebaliknya.
- `Two-way`: gabungan; **konflik** (kedua sisi berubah sejak sync terakhir) → **keep both**: `nama (konflik dari Cloud).ext` disimpan, tidak ada file hilang.
- Log sync dapat dilihat di panel Sync (timestamps, aksi per entri).

## PWA

- `manifest.json`: display standalone, theme #0b1020, ikon 192/512 + maskable, shortcuts.
- `sw.js`: precache app shell; runtime cache stale-while-revalidate; offline fallback ke `index.html`.
- Install prompt: banner "Install App" (beforeinstallprompt), fallback instruksi manual.
- Online/offline detection: banner status + auto-retry sync saat online kembali.

## Non-fungsional

- Tanpa horizontal scrolling di halaman utama (`overflow-x: hidden` + layout fluid `minmax`).
- Responsive: grid ↔ list, sidebar collapse di layar sempit.
