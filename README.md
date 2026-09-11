# GFileManager

File manager PWA bergaya **glassmorphism** dengan sync **Local ↔ Cloud** (Google Apps Script + Google Drive).

## Menjalankan (dev, tanpa Google)

```bash
npm run dev        # mock backend + static server di http://localhost:8177
npm test           # unit test (sync engine, API, proxy modul API, aset PWA)
npm run ui-test    # smoke test UI via puppeteer-core + Chrome
npm run share-check # verifikasi dialog Share + halaman link publik /p/<token>
npm run verify     # test + ui-test + share-check + public-link-check
```

Buka http://localhost:8177 — data seed: folder `Projects`, `laporan.pdf`, `data.xlsx`, `foto.jpg`.

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

1. Buat Apps Script dan salin seluruh file `backend/*.gs` sebagai file terpisah → Deploy → Web App (akses: siapa saja).
2. Set env `GAS_URL` di Vercel = URL Web App (`…/exec`).
3. Deploy repo ini ke Vercel (`api/gas.js` mem-proxy ke Apps Script, bebas CORS; `vercel.json` mengarahkan `/p/:token` ke halaman link publik).
4. Link publik hasil Share (`…/p/<token>`) langsung bisa dibuka visitor anonim — tanpa login.

API: `POST /api/gas {action: list|upload|delete|createFolder|rename|move|favorite|download|share|shareInfo|sharedList|publicGet|register|login|logout|me|quota}`.

Catatan login produksi: `backend/Code.gs` menyimpan metadata tanpa auth multi-user; untuk multi-user penuh, deploy lewat proxy `api/gas.js` + `ADMIN_API_TOKEN` (sama pola dengan kastriva-smartkasir) atau batasi akses Web App ke akun Google tertentu. Kredensial dev mock: `uji@gfm.app` / `password123`.

## Struktur

Lihat `ARCHITECTURE.md`.
