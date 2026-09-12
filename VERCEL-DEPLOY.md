# Vercel deployment

Vercel hanya digunakan untuk Web/PWA. Jangan menjalankan electron-builder di Vercel karena build machine Vercel berbasis Linux, sedangkan target Windows NSIS membutuhkan executable Windows tooling.

## Vercel
1. Import repository ke Vercel.
2. Pastikan Root Directory adalah root project.
3. Tambahkan Environment Variable `GAS_URL` berisi URL Google Apps Script Web App yang berakhiran `/exec`.
4. Deploy.
5. Vercel akan menjalankan `npm run build:web` dan menyajikan file statis + `/api/gas`.

## Windows
Build Windows dilakukan di mesin Windows atau GitHub Actions Windows.

Local:
`npm ci`
`npm run build:windows`

Output berada di `dist/`.
