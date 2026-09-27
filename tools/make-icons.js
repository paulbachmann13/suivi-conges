/* Génère les icônes PNG de l'appli (sans dépendance) : node tools/make-icons.js
   Motif : fond sombre, calendrier avec des jours de congé posés. */
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x + 0.5, y + 0.5, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BG = [13, 13, 13], CARD = [36, 36, 35], TOP = [57, 135, 229], CELL = [70, 70, 66], LEAVE = [25, 158, 112];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
/** Distance signée à un rectangle arrondi (négative à l'intérieur) */
function rrect(u, v, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hx = (x1 - x0) / 2 - r, hy = (y1 - y0) / 2 - r;
  const dx = Math.abs(u - cx) - hx, dy = Math.abs(v - cy) - hy;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
}

/** scale < 1 : contenu réduit (zone de sécurité des icônes « maskable »). */
function draw(scale) {
  return (x, y, S) => {
    const u = 0.5 + (x / S - 0.5) / scale, v = 0.5 + (y / S - 0.5) / scale;
    const aa = 1 / (S * scale);
    let col = BG;
    const paint = (d, c) => { if (d < aa) col = mix(col, c, Math.min(1, (aa - d) / aa)); };
    // Page du calendrier + bandeau du haut
    paint(rrect(u, v, 0.16, 0.20, 0.84, 0.82, 0.07), CARD);
    if (v < 0.34) paint(rrect(u, v, 0.16, 0.20, 0.84, 0.82, 0.07), TOP);
    // Anneaux
    for (const cx of [0.34, 0.66]) paint(rrect(u, v, cx - 0.025, 0.13, cx + 0.025, 0.26, 0.025), [230, 230, 225]);
    // Grille 4 × 3 de jours, dont 3 posés
    const leave = new Set(['1,1', '2,1', '3,1']);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
      const x0 = 0.23 + c * 0.14, y0 = 0.41 + r * 0.13;
      paint(rrect(u, v, x0, y0, x0 + 0.10, y0 + 0.09, 0.02), leave.has(`${c},${r}`) ? LEAVE : CELL);
    }
    return col;
  };
}

const out = path.join(__dirname, '..', 'icons');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon-192.png'), png(192, draw(1)));
fs.writeFileSync(path.join(out, 'icon-512.png'), png(512, draw(1)));
fs.writeFileSync(path.join(out, 'apple-touch-icon.png'), png(180, draw(1)));
fs.writeFileSync(path.join(out, 'icon-maskable-512.png'), png(512, draw(0.8)));
console.log('Icônes générées dans', out);
