#!/usr/bin/env node
// Generates the PWA icons in apps/web/public/icons with zero dependencies (pure PNG encoding over zlib).
//
// The mark: three nested chevrons cascading downward and inward — Life › Yearly › Quarterly › Monthly, the
// product's whole idea in one glyph. The two outer chevrons are the pale accent, the innermost is white: the
// cascade narrows to the one thing you are actually doing this week.
//
// There is no logo file and no design tool in the loop, so the geometry is pure maths and the colours are the
// oklch literals copied from `src/ui.ts`, converted here. That makes the output deterministic: re-running this
// script on an unchanged palette produces byte-identical PNGs, so a diff in `public/icons` always means the
// palette or the geometry actually changed. Do not hand-edit the PNGs — edit this file and re-run:
//   node apps/web/scripts/make-icons.mjs      (or `npm run icons -w @goal-cascade/web`)
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- palette ----------------------------------------------------------------
// Copied verbatim from `src/ui.ts` (`colors.accent`, `colors.accentSoft`). `tests/pwa/manifest.test.ts`
// guards the manifest/HTML colours against that module; these two are the icon's share of the same palette.
const ACCENT_OKLCH = [0.42, 0.09, 125]; // colors.accent    — oklch(0.42 0.09 125)
const ACCENT_SOFT_OKLCH = [0.95, 0.025, 125]; // colors.accentSoft — oklch(0.95 0.025 125)

/** oklch → 8-bit sRGB. The palette is authored in oklch; PNG only speaks sRGB, so convert rather than guess. */
function oklch(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  // OKLab → LMS' → LMS → linear sRGB (Björn Ottosson's matrices).
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const enc = (v) => {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(c * 255)));
  };
  return [enc(lin[0]), enc(lin[1]), enc(lin[2]), 255];
}

const ACC = oklch(...ACCENT_OKLCH);
const ACC_SOFT = oklch(...ACCENT_SOFT_OKLCH);
const WHITE = [255, 255, 255, 255];
const NONE = [0, 0, 0, 0];

// ---- PNG encoder ------------------------------------------------------------

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- shapes (unit square, y down) ------------------------------------------

const inRoundedRect = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x;
  const cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

/** Distance from (px,py) to the segment (ax,ay)–(bx,by). Round caps and joins fall out of this for free. */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Each row: [halfWidth, topY, depth]. Widths and depths shrink together so the three chevrons read as one
// cascade narrowing to a point rather than three unrelated arrows.
// The tops are nudged down ~0.03 from a naive centring: the glyph's visual mass sits above its apex, so
// mathematically centring the bounding box leaves it looking top-heavy in the tile.
const CHEVRONS = [
  [0.235, 0.285, 0.145],
  [0.185, 0.445, 0.115],
  [0.135, 0.585, 0.085],
];
const STROKE = 0.072; // full stroke width, unit coords

/** The cascade glyph, scaled by `s` about the centre. Returns the colour at (x, y), or null for background. */
function cascade(x, y, s, outer, inner) {
  const u = (x - 0.5) / s + 0.5;
  const v = (y - 0.5) / s + 0.5;
  const half = STROKE / 2; // measured in glyph space, so the stroke scales with the glyph
  for (let i = 0; i < CHEVRONS.length; i++) {
    const [w, top, depth] = CHEVRONS[i];
    const d = Math.min(
      distToSegment(u, v, 0.5 - w, top, 0.5, top + depth),
      distToSegment(u, v, 0.5, top + depth, 0.5 + w, top),
    );
    if (d <= half) return i === CHEVRONS.length - 1 ? inner : outer;
  }
  return null;
}

/** Render one icon with 4x4 supersampling. `paint(x, y)` returns [r, g, b, a] in unit coordinates. */
function render(size, paint) {
  const out = Buffer.alloc(size * size * 4);
  const SS = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = paint((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
          r += c[0] * c[3];
          g += c[1] * c[3];
          b += c[2] * c[3];
          a += c[3];
        }
      }
      const i = (py * size + px) * 4;
      if (a > 0) {
        out[i] = Math.round(r / a);
        out[i + 1] = Math.round(g / a);
        out[i + 2] = Math.round(b / a);
      }
      out[i + 3] = Math.round(a / (SS * SS));
    }
  }
  return encodePng(size, size, out);
}

// `any` icons: rounded square, transparent outside — matches how iOS/Android already draw app tiles.
const rounded = (x, y, glyphScale) => (inRoundedRect(x, y, 0, 0, 1, 1, 0.22) ? (cascade(x, y, glyphScale, ACC_SOFT, WHITE) ?? ACC) : NONE);
// `maskable`: full bleed, glyph inside the 80% safe zone so a circular or squircle mask never clips it.
const maskable = (x, y) => cascade(x, y, 0.72, ACC_SOFT, WHITE) ?? ACC;
// iOS rounds the corners of the apple-touch-icon itself, so this one is a full-bleed square.
const apple = (x, y) => cascade(x, y, 1, ACC_SOFT, WHITE) ?? ACC;
// At 32px the pale outer chevrons would vanish into the green, so the favicon draws the whole mark in white.
const favicon = (x, y) => (inRoundedRect(x, y, 0, 0, 1, 1, 0.22) ? (cascade(x, y, 1.06, WHITE, WHITE) ?? ACC) : NONE);

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(dir, { recursive: true });
const files = {
  'icon-192.png': render(192, (x, y) => rounded(x, y, 1)),
  'icon-512.png': render(512, (x, y) => rounded(x, y, 1)),
  'maskable-512.png': render(512, maskable),
  'apple-touch-icon-180.png': render(180, apple),
  'favicon-32.png': render(32, favicon),
};
for (const [name, png] of Object.entries(files)) {
  writeFileSync(join(dir, name), png);
  console.log(`${name} ${png.length} B`);
}
console.log(`accent ${ACC.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('')} / accentSoft ${ACC_SOFT.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('')}`);
