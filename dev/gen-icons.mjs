/* gen-icons.mjs — buat ikon PWA PNG (192/512, any + maskable) tanpa dependensi.
   Format PNG ditulis manual: encoder PNG paling sederhana (zlib store + CRC). */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'icons');
fs.mkdirSync(OUT, { recursive: true });

function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ table[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    sig, chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* Gambar: rounded-square gradient + dokumen putih + lipatan + baris "file". */
function draw(size, maskable) {
  const img = Buffer.alloc(size * size * 4);
  const R = maskable ? size * 0.5 : size * 0.22; // maskable: aman di zona 80%
  const pad = maskable ? size * 0.18 : size * 0.10;
  const set = (x, y, r, g, b, a) => {
    const i = (y * size + x) * 4;
    const na = a / 255;
    img[i] = img[i] * (1 - na) + r * na;
    img[i + 1] = img[i + 1] * (1 - na) + g * na;
    img[i + 2] = img[i + 2] * (1 - na) + b * na;
    img[i + 3] = Math.max(img[i + 3], a);
  };
  const insideRounded = (x, y, x0, y0, x1, y1, r) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const dx = Math.max(x0 + r - x, x - (x1 - r), 0);
    const dy = Math.max(y0 + r - y, y - (y1 - r), 0);
    return dx * dy + Math.max(0, dx - r) === 0 || (dx === 0 || dy === 0) || (dx * dx + dy * dy) <= r * r || (dx <= r && dy <= r && dx * dx + dy * dy <= r * r);
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // latar rounded gradient (#6ea8fe -> #9b7bff)
      const t = (x + y) / (2 * size);
      const r = Math.round(110 + (155 - 110) * t);
      const g = Math.round(168 + (123 - 168) * t);
      const b = Math.round(254 + (255 - 254) * t);
      if (insideRounded(x, y, 0, 0, size - 1, size - 1, R)) set(x, y, r, g, b, 255);
    }
  }
  // dokumen putih
  const dx0 = Math.round(size * pad), dy0 = Math.round(size * pad * 0.8);
  const dx1 = Math.round(size - pad), dy1 = Math.round(size - pad * 0.8);
  for (let y = dy0; y <= dy1; y++) {
    for (let x = dx0; x <= dx1; x++) {
      if (insideRounded(x, y, dx0, dy0, dx1, dy1, Math.round(size * 0.06))) set(x, y, 255, 255, 255, 235);
    }
  }
  // lipatan kanan-atas dokumen
  const fold = Math.round(size * 0.16);
  for (let y = dy0; y < dy0 + fold; y++) {
    for (let x = dx1 - fold; x <= dx1; x++) {
      if (x - (dx1 - fold) > (y - dy0)) set(x, y, 200, 215, 245, 255);
    }
  }
  // garis-garis "isi file"
  const lines = [0.32, 0.45, 0.58, 0.71];
  for (const fy of lines) {
    const ly = Math.round(size * fy);
    for (let x = Math.round(dx0 + size * 0.07); x <= dx1 - Math.round(size * 0.07); x++) {
      set(x, ly, 110, 130, 190, 255);
      set(x, ly + 1, 110, 130, 190, 255);
    }
  }
  return png(size, size, img);
}

for (const [name, size, maskable] of [
  ['icon-192.png', 192, false], ['icon-512.png', 512, false],
  ['icon-maskable-192.png', 192, true], ['icon-maskable-512.png', 512, true],
]) {
  fs.writeFileSync(path.join(OUT, name), draw(size, maskable));
  console.log('ikon dibuat:', name);
}
