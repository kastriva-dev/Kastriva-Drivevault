# Google Apps Script Backend

Salin setiap file `.gs` di folder ini ke project Google Apps Script sebagai modul terpisah:

- `Config.gs` — konfigurasi dan kontrak response JSON.
- `Api.gs` — endpoint Web App, parsing request, dan serialisasi response.
- `DriveService.gs` — adapter Google Drive, file/folder, preview, Trash, dan quota.
- `SyncService.gs` — utilitas pembanding versi, status sync, dan conflict record.
- `Utils.gs` — sanitasi nama, hash, metadata, dan timestamp/version.
- `SecurityService.gs` — validasi action, user, ID, folder, dan permission.
- `AuthService.gs` — login, session, password hashing, dan rate limit.
- `Code.gs` — handler domain dan orkestrasi operasi file.

Deploy sebagai Web App, lalu simpan URL `/exec` hanya di environment server `GAS_URL` atau konfigurasi Desktop. Jangan menaruh URL/credential privat di source frontend.
