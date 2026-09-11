/**
 * Generates the PWA icon set from the Lepharo wordmark.
 *
 * The only brand asset in the repo is public/assets/images/lepharo.png, a
 * 300x75 wordmark. An app icon has to be square and legible at ~60px, so we
 * crop the spiral symbol out of the wordmark's right edge and use that alone.
 *
 * The spiral source is only 63x64, so reaching 512 means an 8x upscale. Doing
 * that in one bilinear step smears the curves, hence the progressive doubling
 * below. If a higher-resolution logo ever lands, point SOURCE at it, redo the
 * crop box, and re-run -- everything downstream stays the same.
 *
 *   node scripts/generate-pwa-icons.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = resolve(root, "public/assets/images/lepharo.png");
const OUT_DIR = resolve(root, "public/icons");

/** Opaque bounds of the spiral within the wordmark, measured from the source. */
const CROP = { x: 228, y: 0, w: 63, h: 64 };

/** Icons render on white: the spiral is maroon and has no light-ground variant. */
const GROUND = [255, 255, 255];

const TARGETS = [
  { file: "pwa-192x192.png", size: 192, coverage: 0.72 },
  { file: "pwa-512x512.png", size: 512, coverage: 0.72 },
  // Maskable icons are cropped to a platform-chosen shape; keeping the mark
  // inside the inner 80% guarantees nothing important is clipped.
  { file: "maskable-512x512.png", size: 512, coverage: 0.52 },
  { file: "apple-touch-icon-180x180.png", size: 180, coverage: 0.7 },
  // Not an app icon: the bare mark on a transparent ground, for placing on the
  // app's own surfaces (the sign-out screen). App icons need an opaque ground,
  // which reads as a white card once it sits on a dark page.
  { file: "mark.png", size: 192, coverage: 0.94, transparent: true },
];

/** Crop a region and flatten it onto the ground colour, so later resampling has no alpha to fringe. */
function cropFlattened(png, { x, y, w, h }) {
  const out = new PNG({ width: w, height: h });
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const si = ((row + y) * png.width + (col + x)) * 4;
      const di = (row * w + col) * 4;
      const a = png.data[si + 3] / 255;
      for (let c = 0; c < 3; c++) {
        out.data[di + c] = Math.round(png.data[si + c] * a + GROUND[c] * (1 - a));
      }
      out.data[di + 3] = 255;
    }
  }
  return out;
}

/**
 * Crop a region keeping its alpha, with RGB premultiplied.
 *
 * Resampling straight (non-premultiplied) alpha pulls the colour of fully
 * transparent pixels into its neighbours, which fringes the mark's edges with
 * whatever happens to sit in those unused RGB slots. Premultiplying first makes
 * the interpolation well behaved; undoPremultiply puts it back afterwards.
 */
function cropPremultiplied(png, { x, y, w, h }) {
  const out = new PNG({ width: w, height: h });
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const si = ((row + y) * png.width + (col + x)) * 4;
      const di = (row * w + col) * 4;
      const a = png.data[si + 3];
      for (let c = 0; c < 3; c++) {
        out.data[di + c] = Math.round((png.data[si + c] * a) / 255);
      }
      out.data[di + 3] = a;
    }
  }
  return out;
}

function undoPremultiply(png) {
  for (let i = 0; i < png.data.length; i += 4) {
    const a = png.data[i + 3];
    if (a === 0) continue;
    for (let c = 0; c < 3; c++) {
      png.data[i + c] = Math.min(255, Math.round((png.data[i + c] * 255) / a));
    }
  }
  return png;
}

function bilinear(src, w, h) {
  const out = new PNG({ width: w, height: h });
  const xRatio = src.width / w;
  const yRatio = src.height / h;
  for (let y = 0; y < h; y++) {
    const sy = Math.min(src.height - 1, (y + 0.5) * yRatio - 0.5);
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(src.height - 1, y0 + 1);
    const wy = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.width - 1, (x + 0.5) * xRatio - 0.5);
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(src.width - 1, x0 + 1);
      const wx = sx - x0;
      const di = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p00 = src.data[(y0 * src.width + x0) * 4 + c];
        const p10 = src.data[(y0 * src.width + x1) * 4 + c];
        const p01 = src.data[(y1 * src.width + x0) * 4 + c];
        const p11 = src.data[(y1 * src.width + x1) * 4 + c];
        const top = p00 + (p10 - p00) * wx;
        const bottom = p01 + (p11 - p01) * wx;
        out.data[di + c] = Math.round(top + (bottom - top) * wy);
      }
    }
  }
  return out;
}

/** Double until we overshoot the target, then step down once -- sharper than one big jump. */
function resample(src, w, h) {
  let cur = src;
  while (cur.width * 2 <= w) cur = bilinear(cur, cur.width * 2, cur.height * 2);
  return cur.width === w && cur.height === h ? cur : bilinear(cur, w, h);
}

function compose(mark, size, coverage, transparent) {
  const canvas = new PNG({ width: size, height: size });
  for (let i = 0; i < canvas.data.length; i += 4) {
    canvas.data[i] = transparent ? 0 : GROUND[0];
    canvas.data[i + 1] = transparent ? 0 : GROUND[1];
    canvas.data[i + 2] = transparent ? 0 : GROUND[2];
    canvas.data[i + 3] = transparent ? 0 : 255;
  }

  const box = size * coverage;
  const ratio = mark.width / mark.height;
  const w = Math.round(ratio > 1 ? box : box * ratio);
  const h = Math.round(ratio > 1 ? box / ratio : box);
  const scaled = transparent ? undoPremultiply(resample(mark, w, h)) : resample(mark, w, h);

  const ox = Math.round((size - w) / 2);
  const oy = Math.round((size - h) / 2);
  const channels = transparent ? 4 : 3;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const di = ((y + oy) * size + (x + ox)) * 4;
      for (let c = 0; c < channels; c++) canvas.data[di + c] = scaled.data[si + c];
    }
  }
  return canvas;
}

const source = PNG.sync.read(readFileSync(SOURCE));
const flattened = cropFlattened(source, CROP);
const withAlpha = cropPremultiplied(source, CROP);
mkdirSync(OUT_DIR, { recursive: true });

for (const { file, size, coverage, transparent } of TARGETS) {
  const png = compose(transparent ? withAlpha : flattened, size, coverage, transparent);
  const bytes = PNG.sync.write(png, { deflateLevel: 9 });
  writeFileSync(resolve(OUT_DIR, file), bytes);
  const kind = transparent ? "transparent" : "on white";
  console.log(`${file.padEnd(30)} ${size}x${size}  ${(bytes.length / 1024).toFixed(1)} KB  ${kind}`);
}
