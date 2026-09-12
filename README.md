# Kastriva-DriveVault

File manager PWA bergaya **glassmorphism** dengan sync **Local ↔ Cloud** (Google Apps Script + Google Drive).

## Menjalankan secara lokal

```bash
npm run dev        # web lokal + API cloud production di http://localhost:8177
npm run dev:mock   # backend tiruan terpisah untuk pengembangan/test tanpa Google
npm test           # unit test (sync engine, API, proxy modul API, aset PWA)
npm run ui-test    # smoke test UI via puppeteer-core + Chrome
npm run share-check # verifikasi dialog Share + halaman link publik /p/<token>
npm run verify     # test + ui-test + share-check + public-link-check
```

Buka http://localhost:8177. `npm run dev` meneruskan `/api/gas` ke deployment Vercel sehingga akun dan data cloud sama dengan web production. Data seed `Projects`, `laporan.pdf`, `data.xlsx`, `foto.jpg` hanya ada pada `npm run dev:mock`.

## Fitur

- **Grid & List view** (Name / Type / Size / Modified), breadcrumb, pencarian, sidebar (Semua/Favorit/Terbaru/Foto).
- **Upload**: klik (multiple files) atau **drag & drop** ke mana pun.
- **Klik kanan** file/folder: Open, Rename, Copy, Cut, Move, Share, Favorite, Properties, Delete.
- **Multi-select**: Ctrl+Click satuan, Shift+Click range.
- **Sync Engine** 3 mode: `Local → Cloud`, `Cloud → Local`, `Two Way Sync`.
  Tidak pernah menimpa tanpa pengecekan — konflik disimpan dua versi (`nama (konflik dari Cloud).ext`). Log sync tampil di panel.
- **PWA**: installable (Install App), offline shell, cache assets, online/offline detection, standalone mode, ikon + maskable.
- **Tema Dark / Light / System** — default dark, pilihan tersimpan di localStorage (`gfm.theme.v1`), anti-FOUC (tema diterapkan sebelum render), mode System mengikuti OS secara live.
- **Readability > decoration**: blur moderat via `--blur` (14px dark / 10px light), panel cukup solid untuk kontras teks, ornamen latar diredam.
- **Metadata & Sync Status**: tiap entri punya fileId/name/path/extension/size/modifiedTime/createdTime/hash/version/parentId + syncStatus (Synced/Pending/Uploading/Downloading/Conflict/Error/LocalOnly) — tampil di Properties.
- **Conflict handling**: konflik ditahan (tidak pernah auto-hapus), tercatat di IndexedDB, panel Conflicts dengan meta Lokal vs Cloud + tombol **Keep Local / Keep Cloud / Keep Both** (Keep Both membuat `nama (konflik dari Cloud).ext`).
- **Upload**: file & **folder** (webkitdirectory), **progress bar per file**, **cancel** (XHR abort), **retry** dari panel Uploading…, notifikasi gagal, offline → antrian.
- **Download**: single, multi-select, dan **folder → ZIP** (encoder ZIP sendiri, CRC32, progress toast).
- **Search global + filter**: nama/ekstensi/kategori/ukuran/tanggal, dropdown Type/Size/Date/Extension (dideteksi otomatis dari data).
- **Sort**: Name/Modified/Created/Size/Type, asc/desc, tersimpan di localStorage; folder selalu di atas.
- **Preview in-app**: image, PDF (iframe), video, audio, text/code (viewer) — format tak didukung menampilkan "Preview unavailable".
- **Context menu lengkap**: Open, Preview, Download, Download ZIP, Rename, Copy, Cut, Move, Share, Favorite, Properties, Delete + **Ctrl+A** + menu khusus multi-select & Trash.
- **Trash**: Delete → soft delete; view Trash dengan Restore / Delete Permanently (dengan konfirmasi) / Empty Trash.
- **Favorites & Recent**: halaman favorit + 20 file terbaru.
- **Properties**: File Name, Type, Location, Size, Created, Modified, Extension, File ID, Sync Status, Local Path / Google Drive ID.
- **Offline Mode**: indikator `● Online / ● Offline` + badge antrian; operasi lokal tetap jalan saat offline (optimis UI); data di-cache di **IndexedDB**; perubahan offline masuk **Sync Queue** dan otomatis di-flush ke server (Google Drive) saat koneksi kembali (FIFO, retry 3×, tombol Flush manual). Diverifikasi end-to-end via emulasi offline CDP.
- **Layout 3 zona + drawer**: Desktop ≥1201px = Sidebar + Content; Tablet 901–1200px = collapsible rail ikon 64px (hamburger membuka drawer overlay berlabel); Mobile ≤900px = Top Bar + Content + Bottom Navigation, sidebar otomatis menjadi drawer (tutup via backdrop/Escape/item). Overlay (context menu, sync panel, dialog) selalu diposisikan di dalam viewport. Diverifikasi otomatis di **17 viewport** (320px–2560px, portrait + lanskap + ultrawide): tanpa horizontal scroll, zona layout benar, drawer & overlay berfungsi.
- **Tanpa horizontal scroll** di halaman utama (grid fluid, kolom list `minmax(0,1fr)`, `overflow-x: hidden`).

- **Online Sharing**: klik kanan → Share dengan 3 mode (Private / Shared ke user tertentu view-only / Public Link). File tidak pernah public otomatis; link publik pakai token acak yang bisa dicabut (kembali Private) dan Copy Link ke clipboard.
- **Halaman Link Publik** `/p/<token>`: visitor anonim yang membuka link melihat nama/ukuran/pratinjau (gambar/PDF) + tombol Unduh — tanpa perlu login, tanpa daftar file. Token salah/kadaluarsa → pesan "Link tidak tersedia".
- **Keamanan**: semua operasi API butuh sesi login (token, hash scrypt — tanpa plaintext); nama file disanitasi server-side (path traversal `../`, karakter Windows terlarang, nama perangkat); static server dibatasi dalam workspace root.
- **Toast notification** 3 varian (sukses/gagal/info), termasuk notifikasi "File uploaded" per file.
- **Storage Dashboard**: Local (kuota asli via Storage API) + Cloud (total ukuran file server) dengan bar Used/Free/Total per sisi.

## Deploy ke Vercel + Google Apps Script

1. Buat Apps Script dan salin seluruh file `gas/*.gs` sebagai file terpisah → Deploy → Web App (akses: siapa saja).
2. Set env `GAS_URL` di Vercel = URL Web App (`…/exec`).
3. Deploy repo ini ke Vercel (`api/gas.js` mem-proxy ke Apps Script, bebas CORS; `vercel.json` mengarahkan `/p/:token` ke halaman link publik).
4. Link publik hasil Share (`…/p/<token>`) langsung bisa dibuka visitor anonim — tanpa login.

API: `POST /api/gas {action: list|upload|delete|createFolder|rename|move|favorite|download|share|shareInfo|sharedList|publicGet|register|login|logout|me|quota}`.

Catatan login produksi: `gas/Code.gs` memakai auth multi-user dan mengisolasi metadata berdasarkan pemilik. Proxy `api/gas.js` menyimpan URL Apps Script di sisi server melalui `GAS_URL`. Kredensial dev mock: `uji@gfm.app` / `password123`.


## Cara penggunaan yang benar

### A. Menjalankan webapp di komputer

Jangan membuka `index.html` dengan double-click (`file://`). Webapp memakai endpoint `/api/gas` dan service worker sehingga harus dijalankan melalui HTTP/HTTPS.

Untuk mode lokal yang memakai backend cloud production yang sama dengan Vercel:

```bash
npm install
npm run dev
```

Kemudian buka `http://localhost:8177`. Default target cloud adalah `https://kastriva-drivevault.vercel.app`; target dapat diganti dengan env `GFM_CLOUD_ORIGIN` bila domain production berubah.

Untuk backend mock dengan data uji lokal yang sengaja terpisah dari Vercel, jalankan `npm run dev:mock`.

### B. Mengaktifkan webapp production

Arsitektur production adalah:

```text
Browser / PWA
    ↓
Vercel /api/gas
    ↓
Google Apps Script Web App
    ↓
Google Drive
```

Langkah:

1. Buat satu project Google Apps Script baru.
2. Gunakan **hanya** file `.gs` dari folder `gas/` sebagai file terpisah (jangan mencampurkan source backend lama): `Config.gs`, `Api.gs`, `DriveService.gs`, `SyncService.gs`, `Utils.gs`, `SecurityService.gs`, `AuthService.gs`, `Code.gs`.
3. Jalankan deployment **Web app**. Gunakan URL deployment yang berakhiran `/exec`.
4. Pastikan Web App dapat menerima request dari aplikasi dan memiliki izin Google Drive yang diperlukan. Saat deployment pertama kali, izinkan akses yang diminta Apps Script.
5. Di project Vercel, buat environment variable:

```text
GAS_URL=https://script.google.com/macros/s/ID_DEPLOYMENT/exec
```

6. Deploy folder project ini ke Vercel.
7. Buka domain Vercel melalui HTTPS.
8. Daftar akun pada aplikasi, lalu login.
9. Upload file. Metadata disimpan oleh backend dan binary file disimpan di Google Drive.

**Penting:** URL GAS tidak perlu ditulis ke `index.html`. Browser production melewati `/api/gas`; `GAS_URL` disimpan sebagai environment variable server Vercel.

### C. Penggunaan aplikasi Windows

1. Install dependency:

```bash
npm install
```

2. Jalankan:

```bash
npm run desktop
```

3. Aplikasi membuat Workspace lokal default di folder Documents pengguna:

```text
Documents/GFileManager
```

4. Gunakan tombol **Workspace** untuk memilih folder lain.
5. Gunakan file manager seperti biasa untuk file lokal.
6. Buka **Sync → Atur Server** dan masukkan URL GAS `/exec`. URL tersebut sekarang disimpan agar tidak perlu dimasukkan ulang setiap aplikasi dibuka.
7. Setelah server dikonfigurasi, login menggunakan akun Kastriva-DriveVault yang sama dengan webapp. Token cloud dipakai untuk operasi cloud sehingga data tetap terisolasi per akun.
8. Pilih mode sync:
   - **Local → Cloud**: kirim perubahan lokal ke cloud.
   - **Cloud → Local**: ambil perubahan cloud ke lokal.
   - **Two Way Sync**: sinkronisasi dua arah dan tahan konflik untuk keputusan pengguna.
10. Aplikasi Windows menjalankan Two Way Sync saat dibuka, saat kembali online, dan setiap 60 detik selama aplikasi aktif. Tombol sync tetap tersedia untuk menjalankan sinkronisasi langsung.

### D. PWA / HP

Buka domain production melalui HTTPS dari Chrome/Edge yang mendukung PWA, kemudian pilih **Install App**. Jangan mengharapkan PWA bekerja dari `file://`.

### E. Urutan penggunaan yang disarankan

```text
1. Deploy GAS
2. Set GAS_URL di Vercel
3. Deploy webapp
4. Daftar/Login akun
5. Uji upload/download di web
6. Build/install aplikasi Windows
7. Atur Server GAS di Windows
8. Login cloud di Windows
9. Pilih Workspace
10. Uji Sync
11. Baru aktifkan penggunaan rutin
```

### Catatan kapasitas

Versi ini menggunakan payload Base64 melalui Apps Script untuk upload/download. Ini cocok untuk file kecil sampai menengah, tetapi bukan desain ideal untuk file sangat besar atau ribuan file sekaligus. Untuk produksi skala besar, layer storage/upload sebaiknya dipindahkan ke object storage/API yang mendukung multipart/resumable upload.

Backend metadata sekarang memakai chunked PropertiesService agar tidak langsung gagal ketika satu property melewati batas ukuran, tetapi total kapasitas PropertiesService tetap terbatas. Untuk deployment multi-user besar, metadata sebaiknya dimigrasikan ke database/Google Sheet yang terstruktur atau storage database khusus.

## Struktur

Lihat `ARCHITECTURE.md`.
