/**
 * Lightweight, dependency-light image comparison for design-fidelity checks.
 *
 * Decodes two PNGs, normalizes them onto a common grid (box-average downsample),
 * and produces OBJECTIVE metrics:
 *   - SSIM (structural similarity) — the headline number. Robust to the
 *     anti-aliasing texture that made the old raw grayscale-diff plateau ~92%
 *     on text-heavy sections; correlates far better with "looks the same".
 *   - a color delta (mean per-channel RGB difference),
 *   - a 3×3 region map (per-region structural mismatch, to localize problems),
 *   - an edge-overflow estimate (render content bleeding into empty margins),
 *   - optional brand-color presence,
 *   - and a saved diff HEATMAP png so the agent can SEE where it differs.
 *
 * Only depends on pngjs (already a dependency).
 */
import { PNG } from "pngjs";
import fs from "fs";

export interface RgbaImage {
  width: number;
  height: number;
  data: Buffer; // RGBA, length = width*height*4
}

export function decodePng(buffer: Buffer): RgbaImage {
  const png = PNG.sync.read(buffer);
  return { width: png.width, height: png.height, data: png.data };
}

/** Box-average downsample to gw×gh, returning grayscale (0-255) + mean RGB per cell. */
function toGrid(img: RgbaImage, gw: number, gh: number): { gray: Float64Array; rgb: Float64Array } {
  const gray = new Float64Array(gw * gh);
  const rgb = new Float64Array(gw * gh * 3);
  for (let cy = 0; cy < gh; cy++) {
    for (let cx = 0; cx < gw; cx++) {
      const x0 = Math.floor((cx * img.width) / gw);
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * img.width) / gw));
      const y0 = Math.floor((cy * img.height) / gh);
      const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * img.height) / gh));
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * img.width + x) * 4;
          r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
        }
      }
      r /= n; g /= n; b /= n;
      const idx = cy * gw + cx;
      gray[idx] = 0.299 * r + 0.587 * g + 0.114 * b;
      rgb[idx * 3] = r; rgb[idx * 3 + 1] = g; rgb[idx * 3 + 2] = b;
    }
  }
  return { gray, rgb };
}

function hexToRgb(hex: string): [number, number, number] | null {
  let t = hex.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(t)) t = t.replace(/./g, (c) => c + c); // #fff → #ffffff
  const m = /^([0-9a-f]{6})$/i.exec(t);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Windowed SSIM over two equal-sized grayscale grids.
 * Returns the mean SSIM (0-1) and a per-cell SSIM map for localization.
 */
export function ssimMap(
  a: Float64Array,
  b: Float64Array,
  gw: number,
  gh: number,
  win = 7
): { mssim: number; cell: Float64Array } {
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  const half = Math.floor(win / 2);
  const cell = new Float64Array(gw * gh);
  let sum = 0;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
      for (let dy = -half; dy <= half; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= gh) continue;
        for (let dx = -half; dx <= half; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= gw) continue;
          const va = a[yy * gw + xx], vb = b[yy * gw + xx];
          sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb; n++;
        }
      }
      const ma = sa / n, mb = sb / n;
      const va = saa / n - ma * ma, vb = sbb / n - mb * mb, cov = sab / n - ma * mb;
      const s = ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      cell[y * gw + x] = s;
      sum += s;
    }
  }
  return { mssim: sum / (gw * gh), cell };
}

export interface CompareResult {
  /** Headline: structural similarity, 0-100 (100 = identical). */
  similarity: number;
  /** Mean SSIM as 0-100 (same as similarity; kept explicit for clarity). */
  ssim: number;
  /** Legacy raw-pixel similarity (100 - mean grayscale diff %). Kept for continuity. */
  pixelSimilarity: number;
  meanDiff: number;          // 0-255 mean abs grayscale difference
  colorDelta: number;        // 0-255 mean per-channel RGB difference
  regions: number[][];       // 3×3 grid of structural mismatch (0=match … 100=worst)
  /** Percentage of grid cells that differ (see HOT_CELL_MISMATCH and HOT_CELL_COLOR_DELTA). */
  mismatchArea: number;
  /** Up to 5 clusters of differing cells, largest first, in design px. */
  hotSpots: HotSpot[];
  worstRegion: { row: number; col: number; diff: number; label: string };
  edgeOverflow: number;      // 0-1: bright render content in outer margins absent from reference
  colorMatch?: { target: string; renderPct: number; refPct: number; ok: boolean };
  /** Filled in by writeDiffHeatmap() when a path is provided. */
  diffImagePath?: string;
  gridWidth: number;
  gridHeight: number;
}

const REGION_LABELS = [
  ["top-left", "top-center", "top-right"],
  ["mid-left", "center", "mid-right"],
  ["bottom-left", "bottom-center", "bottom-right"],
];

/** A grid cell covers this many design px, so a drift of 2 px changes the cells along the moved edges. */
const CELL_DESIGN_PX = 4;
const MIN_GRID_WIDTH = 120;
const MAX_GRID_WIDTH = 600;

/**
 * The grid width for a node `designWidth` px wide: one cell per 4 design px,
 * between 120 and 600 cells, and never more cells than either image has pixels.
 */
export function gridWidthFor(designWidth: number | undefined, ...imageWidths: number[]): number {
  const wanted = designWidth ? Math.round(designWidth / CELL_DESIGN_PX) : MIN_GRID_WIDTH;
  return Math.max(1, Math.min(MAX_GRID_WIDTH, Math.max(MIN_GRID_WIDTH, wanted), ...imageWidths));
}

function buildGrids(renderPng: Buffer, referencePng: Buffer, designWidth?: number) {
  const render = decodePng(renderPng);
  const reference = decodePng(referencePng);
  const GW = gridWidthFor(designWidth, render.width, reference.width);
  const GH = Math.max(24, Math.round((GW * reference.height) / reference.width));
  return { a: toGrid(render, GW, GH), b: toGrid(reference, GW, GH), GW, GH, width: reference.width, height: reference.height };
}

/** Precomputed decode + grid + SSIM data, shareable between compareImages and writeDiffHeatmap. */
export interface ComparisonData {
  a: { gray: Float64Array; rgb: Float64Array };
  b: { gray: Float64Array; rgb: Float64Array };
  GW: number;
  GH: number;
  /** The reference image's size in px. */
  width: number;
  height: number;
  mssim: number;
  cell: Float64Array;
}

/**
 * Decode both PNGs, build the comparison grids, and run SSIM — the expensive
 * part of a comparison. Pass the result to compareImages/writeDiffHeatmap to
 * avoid doing this work twice on the same pair of buffers. `designWidth` is
 * the node's width in design px, which sets the grid (see gridWidthFor).
 */
export function prepareComparison(renderPng: Buffer, referencePng: Buffer, opts: { designWidth?: number } = {}): ComparisonData {
  const grids = buildGrids(renderPng, referencePng, opts.designWidth);
  const { mssim, cell } = ssimMap(grids.a.gray, grids.b.gray, grids.GW, grids.GH);
  return { ...grids, mssim, cell };
}

/**
 * A cell differs when its structural mismatch (1 - SSIM) exceeds 0.5, or a
 * color channel of its mean differs by more than 60 of 255. Measured on a
 * 1440 x 765 section, with 4 px cells, against its 2x snapshot: the 1x
 * snapshot of the same section differs by 31 at most; moving a text or a
 * 54 px circle by 2 px, changing a color, a font or a font size exceeds 60.
 */
const HOT_CELL_MISMATCH = 0.5;
const HOT_CELL_COLOR_DELTA = 60;

/** A box in design px from the node's top-left. */
export interface HotSpot {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Clusters of differing cells, largest first, as boxes in design px (`sx`,
 * `sy` are design px per cell). Cells up to 2 apart join one cluster, so the
 * glyph edges of a moved text form one box. A box names where to look: the
 * nodes inside it moved, changed size or color, or render differently.
 */
function hotSpotsOf(hot: Uint8Array, GW: number, GH: number, sx: number, sy: number, limit = 5): HotSpot[] {
  const seen = new Uint8Array(GW * GH);
  const clusters: Array<HotSpot & { cells: number }> = [];
  for (let start = 0; start < GW * GH; start++) {
    if (seen[start] || !hot[start]) continue;
    let minX = GW, minY = GH, maxX = 0, maxY = 0, cells = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop()!;
      const x = i % GW, y = (i - x) / GW;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      cells++;
      for (let ny = Math.max(0, y - 2); ny <= Math.min(GH - 1, y + 2); ny++) {
        for (let nx = Math.max(0, x - 2); nx <= Math.min(GW - 1, x + 2); nx++) {
          const j = ny * GW + nx;
          if (!seen[j] && hot[j]) { seen[j] = 1; stack.push(j); }
        }
      }
    }
    clusters.push({
      cells,
      x: Math.round(minX * sx), y: Math.round(minY * sy),
      width: Math.round((maxX - minX + 1) * sx), height: Math.round((maxY - minY + 1) * sy),
    });
  }
  clusters.sort((p, q) => q.cells - p.cells);
  // A cluster inside a larger one's box (the counters of a resized headline) adds nothing.
  const inside = (p: HotSpot, q: HotSpot) => p.x >= q.x && p.y >= q.y && p.x + p.width <= q.x + q.width && p.y + p.height <= q.y + q.height;
  const kept: HotSpot[] = [];
  for (const { cells: _cells, ...spot } of clusters) {
    if (kept.length === limit) break;
    if (!kept.some((larger) => inside(spot, larger))) kept.push(spot);
  }
  return kept;
}

/**
 * @param opts.designWidth, opts.designHeight - The node's size in design px,
 *   for the grid and the hot-spot boxes (default: the reference image's size).
 */
export function compareImages(
  renderPng: Buffer,
  referencePng: Buffer,
  opts: { targetColor?: string; designWidth?: number; designHeight?: number } = {},
  pre?: ComparisonData
): CompareResult {
  // Structural similarity (headline) + per-cell map for localization.
  const { a, b, GW, GH, width, height, mssim, cell } = pre ?? prepareComparison(renderPng, referencePng, opts);

  // Raw grayscale + color diffs (continuity + a chroma signal SSIM ignores).
  let total = 0, colorTotal = 0, hotCells = 0;
  const hot = new Uint8Array(GW * GH);
  const regSum = Array.from({ length: 3 }, () => [0, 0, 0]);
  const regCnt = Array.from({ length: 3 }, () => [0, 0, 0]);
  for (let y = 0; y < GH; y++) {
    const rr = Math.min(2, Math.floor((y * 3) / GH));
    for (let x = 0; x < GW; x++) {
      const cc = Math.min(2, Math.floor((x * 3) / GW));
      const idx = y * GW + x;
      total += Math.abs(a.gray[idx] - b.gray[idx]);
      const dr = Math.abs(a.rgb[idx * 3] - b.rgb[idx * 3]);
      const dg = Math.abs(a.rgb[idx * 3 + 1] - b.rgb[idx * 3 + 1]);
      const db = Math.abs(a.rgb[idx * 3 + 2] - b.rgb[idx * 3 + 2]);
      colorTotal += (dr + dg + db) / 3;
      if (1 - cell[idx] > HOT_CELL_MISMATCH || Math.max(dr, dg, db) > HOT_CELL_COLOR_DELTA) {
        hot[idx] = 1;
        hotCells++;
      }
      // Region mismatch from structure: (1 - SSIM), clamped to [0,1].
      regSum[rr][cc] += Math.max(0, 1 - cell[idx]);
      regCnt[rr][cc]++;
    }
  }
  const meanDiff = total / (GW * GH);
  const colorDelta = colorTotal / (GW * GH);
  const regions = regSum.map((row, r) => row.map((s, c) => +((s / regCnt[r][c]) * 100).toFixed(1)));
  const hotSpots = hotSpotsOf(hot, GW, GH, (opts.designWidth ?? width) / GW, (opts.designHeight ?? height) / GH);

  let worst = { row: 0, col: 0, diff: -1, label: "" };
  regions.forEach((row, r) => row.forEach((d, c) => {
    if (d > worst.diff) worst = { row: r, col: c, diff: d, label: REGION_LABELS[r][c] };
  }));

  // Edge overflow: bright render cells in outer 6% columns where reference is dark.
  const margin = Math.max(1, Math.round(GW * 0.06));
  let bright = 0, edge = 0;
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      if (a.gray[y * GW + x] > 50) {
        bright++;
        const inMargin = x < margin || x >= GW - margin;
        if (inMargin && b.gray[y * GW + x] < 30) edge++;
      }
    }
  }
  const edgeOverflow = bright ? edge / bright : 0;

  let colorMatch: CompareResult["colorMatch"];
  if (opts.targetColor) {
    const tc = hexToRgb(opts.targetColor);
    if (tc) {
      const count = (grid: Float64Array) => {
        let n = 0;
        for (let i = 0; i < GW * GH; i++) {
          const dr = grid[i * 3] - tc[0], dg = grid[i * 3 + 1] - tc[1], db = grid[i * 3 + 2] - tc[2];
          if (dr * dr + dg * dg + db * db < 45 * 45) n++;
        }
        return n / (GW * GH);
      };
      const renderPct = count(a.rgb), refPct = count(b.rgb);
      const ok = refPct < 0.003 || (renderPct >= refPct * 0.5 && renderPct <= refPct * 2);
      colorMatch = { target: opts.targetColor, renderPct: +(renderPct * 100).toFixed(2), refPct: +(refPct * 100).toFixed(2), ok };
    }
  }

  // SSIM is in [-1,1]; clamp to [0,100] so "similarity %" reads naturally
  // (strongly anti-correlated content just reports 0).
  const ssim100 = +(Math.max(0, mssim) * 100).toFixed(1);
  return {
    similarity: ssim100,
    ssim: ssim100,
    pixelSimilarity: +(100 - (meanDiff / 255) * 100).toFixed(1),
    meanDiff: +meanDiff.toFixed(1),
    colorDelta: +colorDelta.toFixed(1),
    regions,
    mismatchArea: +((hotCells / (GW * GH)) * 100).toFixed(2),
    hotSpots,
    worstRegion: worst,
    edgeOverflow: +edgeOverflow.toFixed(3),
    colorMatch,
    gridWidth: GW,
    gridHeight: GH,
  };
}

/**
 * Render a diff HEATMAP png and write it to `outPath`. The reference is shown
 * dimmed in grayscale with structural-mismatch areas tinted red→yellow, so the
 * agent can open it and immediately see WHERE the implementation diverges.
 * Returns the output dimensions. Each grid cell is drawn as a `cellPx` block.
 */
export function writeDiffHeatmap(
  renderPng: Buffer,
  referencePng: Buffer,
  outPath: string,
  cellPx = 6,
  pre?: ComparisonData
): { width: number; height: number } {
  const { a, b, GW, GH, cell } = pre ?? prepareComparison(renderPng, referencePng);

  const W = GW * cellPx, H = GH * cellPx;
  const out = new PNG({ width: W, height: H });
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const idx = gy * GW + gx;
      const base = b.gray[idx] * 0.35; // dimmed reference backdrop
      // 0 good … 1 bad; a color delta of HOT_CELL_COLOR_DELTA shows like a structural mismatch of HOT_CELL_MISMATCH.
      const color = Math.max(
        Math.abs(a.rgb[idx * 3] - b.rgb[idx * 3]),
        Math.abs(a.rgb[idx * 3 + 1] - b.rgb[idx * 3 + 1]),
        Math.abs(a.rgb[idx * 3 + 2] - b.rgb[idx * 3 + 2])
      ) * (HOT_CELL_MISMATCH / HOT_CELL_COLOR_DELTA);
      const mismatch = Math.max(0, Math.min(1, Math.max(1 - cell[idx], color)));
      // Heat ramp: green/blue (low) → red (high). Mix over the dim backdrop.
      const r = base + mismatch * (255 - base);
      const g = base + (1 - mismatch) * (160 - base) * 0.6;
      const bl = base * (1 - mismatch);
      for (let py = 0; py < cellPx; py++) {
        for (let px = 0; px < cellPx; px++) {
          const ox = gx * cellPx + px, oy = gy * cellPx + py;
          const o = (oy * W + ox) * 4;
          out.data[o] = Math.round(Math.max(0, Math.min(255, r)));
          out.data[o + 1] = Math.round(Math.max(0, Math.min(255, g)));
          out.data[o + 2] = Math.round(Math.max(0, Math.min(255, bl)));
          out.data[o + 3] = 255;
        }
      }
    }
  }
  const buf = PNG.sync.write(out);
  fs.writeFileSync(outPath, buf);
  return { width: W, height: H };
}
