// Gera os ícones do PWA (PNG) sem dependências, usando apenas node:zlib.
// São ícones PADRÃO (marca provisória). A marca real é configurável pelo painel admin (Fase 6).
import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const outDir = fileURLToPath(new URL('../apps/web/public/icons/', import.meta.url));
mkdirSync(outDir, { recursive: true });

const BG = [79, 70, 229]; // indigo-600
const FG = [255, 255, 255];

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filtro "none"
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // 8 bits, RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Glifo "hub": círculo central ligado a três satélites. `scale` < 1 mantém a área segura (maskable).
function glyph(size, scale) {
  const c = size / 2;
  const u = size * scale;
  const sats = [90, 210, 330].map((deg) => {
    const a = (deg * Math.PI) / 180;
    return [c + Math.cos(a) * u * 0.27, c - Math.sin(a) * u * 0.27];
  });
  const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  const nearSegment = (x, y, [ax, ay], [bx, by], w) => {
    const dx = bx - ax,
      dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    return (x - (ax + t * dx)) ** 2 + (y - (ay + t * dy)) ** 2 <= w * w;
  };
  const covered = (x, y) =>
    inCircle(x, y, c, c, u * 0.13) ||
    sats.some(
      (s) => inCircle(x, y, s[0], s[1], u * 0.07) || nearSegment(x, y, [c, c], s, u * 0.017),
    );
  return (px, py) => {
    let hits = 0;
    for (let sy = 0; sy < 3; sy++)
      for (let sx = 0; sx < 3; sx++) if (covered(px + (sx + 0.5) / 3, py + (sy + 0.5) / 3)) hits++;
    const t = hits / 9;
    return BG.map((v, i) => Math.round(v + (FG[i] - v) * t));
  };
}

const targets = [
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['icon-maskable-512.png', 512, 0.72],
  ['apple-touch-icon.png', 180, 1],
];
for (const [name, size, scale] of targets) {
  writeFileSync(outDir + name, png(size, glyph(size, scale)));
  console.log('gerado', name);
}
