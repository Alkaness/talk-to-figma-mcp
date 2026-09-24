/**
 * The node format that create_node_tree and update_nodes accept.
 *
 * It is the format get_node_info returns (filterFigmaNode in figma-helpers.ts),
 * so an agent writes in the same format it reads: a get_node_info result,
 * edited or not, is a valid spec. This module validates a spec and translates
 * it to Plugin API property names, grouped in the order the plugin applies
 * them (applyNodeSpec in code.js). Whatever cannot be applied is reported as
 * an error or a warning; nothing is dropped silently.
 */
import { z } from "zod";
import { AUTO_LAYOUT_PROPS, hexToRgba } from "./figma-helpers";

// ─── Schema ────────────────────────────────────────────────────────────────

const unit = z.number().min(0).max(1);
const length = z.number().min(0);
const vector = z.object({ x: z.number(), y: z.number() });
const transform = z.array(z.array(z.number()).length(3)).length(2);

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_FORMAT = "a color is #RGB, #RRGGBB, #RRGGBBAA or { r, g, b, a } with channels from 0 to 1";
// The message goes on both branches: zod reports a failed string branch's own issue.
const colorSchema = z.union(
  [z.string().regex(HEX_COLOR, COLOR_FORMAT), z.object({ r: unit, g: unit, b: unit, a: unit.optional() }).strict()],
  { errorMap: () => ({ message: COLOR_FORMAT }) }
);
type ColorInput = z.infer<typeof colorSchema>;

const blendMode = z.enum([
  "PASS_THROUGH", "NORMAL", "DARKEN", "MULTIPLY", "LINEAR_BURN", "COLOR_BURN", "LIGHTEN", "SCREEN",
  "LINEAR_DODGE", "COLOR_DODGE", "OVERLAY", "SOFT_LIGHT", "HARD_LIGHT", "DIFFERENCE", "EXCLUSION",
  "HUE", "SATURATION", "COLOR", "LUMINOSITY",
]);

// Paints and effects ignore unknown keys instead of rejecting them: the REST
// format gains fields over time, and get_node_info passes paint fields through.
const paintObject = z.object({
  type: z.string(),
  color: colorSchema.optional(),
  opacity: unit.optional(),
  visible: z.boolean().optional(),
  blendMode: blendMode.optional(),
  gradientStops: z.array(z.object({ position: unit, color: colorSchema })).optional(),
  gradientHandlePositions: z.array(vector).optional(),
  gradientTransform: transform.optional(),
  imageRef: z.string().optional(),
  imageHash: z.string().optional(),
  scaleMode: z.enum(["FILL", "FIT", "TILE", "STRETCH", "CROP"]).optional(),
  imageTransform: transform.optional(),
  scalingFactor: z.number().positive().optional(),
  rotation: z.number().optional(),
  filters: z.record(z.number()).optional(),
});
type PaintInput = z.infer<typeof paintObject>;

/** A paint, or a hex string as shorthand for a SOLID paint. */
const paintSchema = z.preprocess(
  (value) => (typeof value === "string" ? { type: "SOLID", color: value } : value),
  paintObject
);

// NOISE, TEXTURE and GLASS keep their other settings (noiseSize, refraction, ...) as they are.
const effectSchema = z
  .object({
    type: z.string(),
    color: colorSchema.optional(),
    secondaryColor: colorSchema.optional(),
    offset: vector.optional(),
    radius: length.optional(),
    spread: z.number().optional(),
    visible: z.boolean().optional(),
    blendMode: blendMode.optional(),
    showShadowBehindNode: z.boolean().optional(),
  })
  .passthrough();
type EffectInput = z.infer<typeof effectSchema>;

const hyperlinkSchema = z.object({
  type: z.enum(["URL", "NODE"]),
  url: z.string().optional(),
  nodeID: z.string().optional(),
  value: z.string().optional(),
});

const textStyleShape = {
  fontFamily: z.string().min(1).optional(),
  fontPostScriptName: z.string().nullable().optional(),
  fontStyle: z.string().min(1).optional(),
  fontWeight: z.number().min(1).max(1000).optional(),
  fontSize: z.number().positive().optional(),
  italic: z.boolean().optional(),
  textCase: z.enum(["ORIGINAL", "UPPER", "LOWER", "TITLE", "SMALL_CAPS", "SMALL_CAPS_FORCED"]).optional(),
  textDecoration: z.enum(["NONE", "UNDERLINE", "STRIKETHROUGH"]).optional(),
  textAlignHorizontal: z.enum(["LEFT", "CENTER", "RIGHT", "JUSTIFIED"]).optional(),
  textAlignVertical: z.enum(["TOP", "CENTER", "BOTTOM"]).optional(),
  letterSpacing: z.number().optional(),
  lineHeightPx: z.number().positive().optional(),
  lineHeightUnit: z.enum(["PIXELS", "FONT_SIZE_%", "INTRINSIC_%"]).optional(),
  lineHeightPercentFontSize: z.number().positive().optional(),
  paragraphSpacing: length.optional(),
  paragraphIndent: length.optional(),
  textAutoResize: z.enum(["NONE", "HEIGHT", "WIDTH_AND_HEIGHT", "TRUNCATE"]).optional(),
  maxLines: z.number().int().positive().nullable().optional(),
  textTruncation: z.enum(["DISABLED", "ENDING"]).optional(),
  hyperlink: hyperlinkSchema.optional(),
};
const textStyleSchema = z.object(textStyleShape).strict();
type TextStyleInput = z.infer<typeof textStyleSchema>;

const textRunSchema = z
  .object({
    ...textStyleShape,
    start: z.number().int().min(0).optional(),
    end: z.number().int().min(1).optional(),
    text: z.string().optional(),
    fills: z.array(paintSchema).optional(),
  })
  .strict();
type TextRunInput = z.infer<typeof textRunSchema>;

const sizing = z.enum(["FIXED", "HUG", "FILL"]);
const optionalLimit = length.nullable().optional();

const nodeShape = {
  // What to create, and the key that finds the new ID in the result.
  type: z.string().min(1).optional(),
  key: z.string().min(1).optional(),
  id: z.string().optional(),
  componentId: z.string().optional(),
  svg: z.string().min(1).max(500_000).optional(),
  name: z.string().optional(),
  visible: z.boolean().optional(),
  // Geometry. absoluteBoundingBox, localPosition and parentOffset are what
  // get_node_info reports; width, height, x and y take precedence over them.
  width: length.optional(),
  height: length.optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  absoluteBoundingBox: z.object({ x: z.number(), y: z.number(), width: length, height: length }).optional(),
  localPosition: vector.optional(),
  parentOffset: vector.optional(),
  rotation: z.number().optional(),
  // Auto-layout container (AUTO_LAYOUT_PROPS).
  layoutMode: z.enum(["NONE", "HORIZONTAL", "VERTICAL", "GRID"]).optional(),
  layoutWrap: z.enum(["NO_WRAP", "WRAP"]).optional(),
  itemSpacing: z.number().optional(),
  counterAxisSpacing: z.number().nullable().optional(),
  paddingTop: length.optional(),
  paddingRight: length.optional(),
  paddingBottom: length.optional(),
  paddingLeft: length.optional(),
  primaryAxisAlignItems: z.enum(["MIN", "CENTER", "MAX", "SPACE_BETWEEN"]).optional(),
  counterAxisAlignItems: z.enum(["MIN", "CENTER", "MAX", "BASELINE"]).optional(),
  counterAxisAlignContent: z.enum(["AUTO", "SPACE_BETWEEN"]).optional(),
  primaryAxisSizingMode: z.enum(["FIXED", "AUTO"]).optional(),
  counterAxisSizingMode: z.enum(["FIXED", "AUTO"]).optional(),
  itemReverseZIndex: z.boolean().optional(),
  strokesIncludedInLayout: z.boolean().optional(),
  // Layout child and appearance (NODE_PROPS).
  clipsContent: z.boolean().optional(),
  layoutSizingHorizontal: sizing.optional(),
  layoutSizingVertical: sizing.optional(),
  layoutPositioning: z.enum(["AUTO", "ABSOLUTE"]).optional(),
  layoutGrow: unit.optional(),
  layoutAlign: z.enum(["INHERIT", "STRETCH", "MIN", "CENTER", "MAX"]).optional(),
  constraints: z
    .object({
      horizontal: z.enum(["LEFT", "RIGHT", "CENTER", "LEFT_RIGHT", "SCALE", "MIN", "MAX", "STRETCH"]),
      vertical: z.enum(["TOP", "BOTTOM", "CENTER", "TOP_BOTTOM", "SCALE", "MIN", "MAX", "STRETCH"]),
    })
    .strict()
    .optional(),
  minWidth: optionalLimit,
  maxWidth: optionalLimit,
  minHeight: optionalLimit,
  maxHeight: optionalLimit,
  opacity: unit.optional(),
  blendMode: blendMode.optional(),
  isMask: z.boolean().optional(),
  locked: z.boolean().optional(),
  cornerRadius: length.optional(),
  cornerSmoothing: unit.optional(),
  // null keeps that corner as it is.
  rectangleCornerRadii: z.array(length.nullable()).length(4).optional(),
  // Paint, stroke geometry (STROKE_PROPS) and effects.
  fills: z.array(paintSchema).optional(),
  strokes: z.array(paintSchema).optional(),
  strokeWeight: length.optional(),
  strokeAlign: z.enum(["INSIDE", "OUTSIDE", "CENTER"]).optional(),
  individualStrokeWeights: z.object({ top: length, right: length, bottom: length, left: length }).strict().optional(),
  strokeDashes: z.array(length).optional(),
  effects: z.array(effectSchema).optional(),
  // Text.
  characters: z.string().optional(),
  style: textStyleSchema.optional(),
  textRuns: z.array(textRunSchema).optional(),
  lineTypes: z.array(z.string()).optional(),
  lineIndentations: z.array(z.number()).optional(),
  // Notes that get_node_info adds.
  _note: z.string().optional(),
  _childrenTruncated: z.boolean().optional(),
};

/** Node fields the spec accepts (for the drift test against the reader's lists). */
export const NODE_SPEC_FIELDS = [...Object.keys(nodeShape), "children"];
/** Text style fields the spec accepts. */
export const TEXT_STYLE_SPEC_FIELDS = Object.keys(textStyleShape);

const nodeBase = z.object(nodeShape);
type NodeFields = z.infer<typeof nodeBase>;
export type NodeSpec = NodeFields & { children?: NodeSpec[] };

export const nodeSpecSchema: z.ZodType<NodeSpec, z.ZodTypeDef, unknown> = nodeBase
  .extend({ children: z.lazy(() => z.array(nodeSpecSchema)).optional() })
  .strict();

// children is accepted here only to reject it with a useful message.
const nodeUpdateSchema = nodeBase.extend({ nodeId: z.string().min(1), children: z.array(z.unknown()).optional() }).strict();
export type NodeUpdate = z.infer<typeof nodeUpdateSchema>;

// ─── Errors ────────────────────────────────────────────────────────────────

/** A problem in a spec. The message names where it is: `at tree.children[2] ("Badge"): …`. */
export class NodeSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NodeSpecError";
  }
}

function specError(where: string, message: string): NodeSpecError {
  return new NodeSpecError(`at ${where}: ${message}`);
}

function fromZodError(error: z.ZodError, root: string): NodeSpecError {
  const lines = error.issues.slice(0, 5).map((issue) => {
    const where = issue.path.reduce<string>(
      (acc, part) => (typeof part === "number" ? `${acc}[${part}]` : `${acc}.${part}`),
      root
    );
    return `at ${where}: ${issue.message}`;
  });
  if (error.issues.length > 5) lines.push(`and ${error.issues.length - 5} more problems`);
  return new NodeSpecError(lines.join("\n"));
}

/** Validate a create_node_tree spec. Throws NodeSpecError. */
export function parseNodeSpec(value: unknown): NodeSpec {
  const parsed = nodeSpecSchema.safeParse(value);
  if (!parsed.success) throw fromZodError(parsed.error, "tree");
  return parsed.data;
}

/** Validate update_nodes updates. Throws NodeSpecError. */
export function parseNodeUpdates(value: unknown): NodeUpdate[] {
  const parsed = z.array(nodeUpdateSchema).min(1).safeParse(value);
  if (!parsed.success) throw fromZodError(parsed.error, "updates");
  return parsed.data;
}

// ─── Normalized spec: what the plugin receives ────────────────────────────

export interface FontName {
  family: string;
  style: string;
}

/**
 * The styles Figma has for each family, keyed by the family as the spec
 * spells it (get_available_fonts matches case-insensitively). null when
 * Figma does not have the family.
 */
export type FontCatalog = Record<string, { family: string; styles: string[] } | null>;

/** Similarly named families for each family Figma does not have. */
export type FontSuggestions = Record<string, string[]>;

/** Characters start to end of an existing text node use this font. */
export interface NodeFontRun {
  start: number;
  end: number;
  family: string;
  style: string;
}

const NATIVE_TYPES = ["FRAME", "COMPONENT", "RECTANGLE", "ELLIPSE", "LINE", "TEXT"] as const;
type NativeType = (typeof NATIVE_TYPES)[number];

export type CreateStep =
  | { kind: "new"; type: NativeType }
  | { kind: "svg"; svg: string }
  | { kind: "clone"; type: string; sourceId: string }
  | { kind: "instance"; sourceId?: string; componentId?: string; hasChildren: boolean }
  | { kind: "group" };

export interface PluginTextRange {
  start: number;
  end: number;
  fontName?: FontName;
  props: Record<string, unknown>;
}

export interface PluginTextSpec {
  fontName?: FontName;
  characters?: string;
  props?: Record<string, unknown>;
  autoResize?: string;
  ranges?: PluginTextRange[];
}

/**
 * A node in Plugin API terms. The plugin applies the groups in this order:
 * create, name, text, size, props, layout, insert into the parent,
 * childProps, position, constraints, rotation, children.
 */
export interface PluginNodeSpec {
  label: string;
  key?: string;
  create?: CreateStep;
  name?: string;
  text?: PluginTextSpec;
  size?: { width?: number; height?: number };
  props?: Record<string, unknown>;
  layout?: Record<string, unknown>;
  childProps?: Record<string, unknown>;
  /** byBox: x/y are the offset of the bounding box (parentOffset), which differs from x/y for rotated nodes. */
  position?: { x?: number; y?: number; byBox: boolean; explicit: boolean };
  constraints?: { horizontal: string; vertical: string };
  rotation?: number;
  children?: PluginNodeSpec[];
}

type Mode = "create" | "update";

interface Context {
  mode: Mode;
  catalog: FontCatalog;
  suggestions: FontSuggestions;
  fonts: Map<string, FontName>;
  warnings: string[];
  keys: Set<string>;
  /** update_nodes: the fonts of the text node being updated, when known. */
  nodeFonts?: NodeFontRun[];
}

/** Figma's default font, used for text that names no family. */
const DEFAULT_FONT_FAMILY = "Inter";

// New frames, rectangles and ellipses get a default fill, and new frames clip
// their content. get_node_info omits empty fills and clipsContent: false, so
// a spec that omits them means none.
const EMPTY_FILL_TYPES = new Set<string>(["FRAME", "COMPONENT", "RECTANGLE", "ELLIPSE"]);
const NO_CLIP_TYPES = new Set<string>(["FRAME", "COMPONENT"]);
const CONTAINER_TYPES = new Set<string>(["FRAME", "COMPONENT"]);
const AUTO_LAYOUT_MODES = new Set<string>(["HORIZONTAL", "VERTICAL"]);

const HORIZONTAL_CONSTRAINTS: Record<string, string> = {
  LEFT: "MIN", RIGHT: "MAX", CENTER: "CENTER", LEFT_RIGHT: "STRETCH", SCALE: "SCALE", MIN: "MIN", MAX: "MAX", STRETCH: "STRETCH",
};
const VERTICAL_CONSTRAINTS: Record<string, string> = {
  TOP: "MIN", BOTTOM: "MAX", CENTER: "CENTER", TOP_BOTTOM: "STRETCH", SCALE: "SCALE", MIN: "MIN", MAX: "MAX", STRETCH: "STRETCH",
};

/** Text properties that apply to whole paragraphs, not to a run of characters. */
const PARAGRAPH_ONLY_FIELDS = [
  "textAlignHorizontal", "textAlignVertical", "paragraphSpacing", "paragraphIndent",
  "textAutoResize", "maxLines", "textTruncation",
] as const;

const IDENTITY: number[][] = [[1, 0, 0], [0, 1, 0]];

function round(n: number, dp: number): number {
  const factor = 10 ** dp;
  return Math.round(n * factor) / factor;
}

function nonEmpty<T extends object>(value: T): T | undefined {
  return Object.keys(value).length > 0 ? value : undefined;
}

function labelOf(path: string, name: string | undefined): string {
  return name ? `${path} ("${name}")` : path;
}

function newContext(mode: Mode, catalog: FontCatalog, suggestions: FontSuggestions): Context {
  return { mode, catalog, suggestions, fonts: new Map(), warnings: [], keys: new Set() };
}

// ─── Fonts ─────────────────────────────────────────────────────────────────

// Compound words first, so "extrabold" is not read as "bold".
const WEIGHT_WORDS: Array<[string, number]> = [
  ["hairline", 100], ["thin", 100],
  ["extralight", 200], ["ultralight", 200], ["light", 300],
  ["regular", 400], ["normal", 400], ["book", 400], ["roman", 400],
  ["medium", 500],
  ["semibold", 600], ["demibold", 600], ["extrabold", 800], ["ultrabold", 800], ["bold", 700],
  ["heavy", 900], ["black", 900],
];

/**
 * Read the weight and slant from a style name such as "Semi Bold Italic".
 * `plain` is true when the name is only a weight (so "Bold" is preferred
 * over "Condensed Bold"). Returns null for names without a known weight.
 */
export function parseFontStyle(style: string): { weight: number; italic: boolean; plain: boolean } | null {
  let name = style.toLowerCase().replace(/[\s_-]+/g, "");
  const italic = /italic|oblique/.test(name);
  name = name.replace(/italic|oblique/g, "");
  if (name === "") return { weight: 400, italic, plain: true };
  for (const [word, weight] of WEIGHT_WORDS) {
    if (name === word) return { weight, italic, plain: true };
  }
  for (const [word, weight] of WEIGHT_WORDS) {
    if (name.includes(word)) return { weight, italic, plain: false };
  }
  return null;
}

/** CSS font matching: the lower the rank, the better `candidate` substitutes for `wanted`. */
function weightRank(wanted: number, candidate: number): number {
  if (candidate === wanted) return 0;
  if (wanted >= 400 && wanted <= 500) {
    if (candidate > wanted && candidate <= 500) return candidate - wanted;
    if (candidate < wanted) return 1000 + wanted - candidate;
    return 2000 + candidate - wanted;
  }
  if (wanted < 400) return candidate < wanted ? wanted - candidate : 1000 + candidate - wanted;
  return candidate > wanted ? candidate - wanted : 1000 + wanted - candidate;
}

const fontKey = (font: FontName) => `${font.family}\u0000${font.style}`;

const squash = (style: string) => style.toLowerCase().replace(/[\s_-]+/g, "");

/**
 * The style of a family that is closest to a weight and slant, by CSS font
 * matching: "SemiBold" for Poppins 600, "Semi Bold" for Inter 600. `exact`
 * is false when the family has no style of that weight and slant. Returns
 * null when no style name has a known weight.
 */
export function pickFontStyle(styles: string[], weight: number, italic: boolean): { style: string; exact: boolean } | null {
  const candidates = styles
    .map((style) => ({ style, info: parseFontStyle(style) }))
    .filter((c): c is { style: string; info: NonNullable<ReturnType<typeof parseFontStyle>> } => c.info !== null);
  if (candidates.length === 0) return null;
  const sameSlant = candidates.filter((c) => c.info.italic === italic);
  const pool = sameSlant.length > 0 ? sameSlant : candidates;
  pool.sort((a, b) => weightRank(weight, a.info.weight) - weightRank(weight, b.info.weight) || Number(b.info.plain) - Number(a.info.plain));
  const best = pool[0];
  return { style: best.style, exact: best.info.weight === weight && best.info.italic === italic };
}

/**
 * Pick the style for a family. An explicit fontStyle must exist (spacing and
 * case may differ: "Semi Bold" finds "SemiBold"). Otherwise the style closest
 * to fontWeight and italic is used, with a warning when it is not exact.
 */
function resolveFont(
  family: string,
  wanted: { fontStyle?: string; fontWeight?: number; italic?: boolean },
  where: string,
  ctx: Context
): FontName {
  const entry = ctx.catalog[family];
  if (!entry) {
    const similar = ctx.suggestions[family] ?? [];
    const hint = similar.length > 0 ? `. Similar families: ${similar.join(", ")}` : ". Check the spelling, or install the font";
    throw specError(where, `font family "${family}" is not available in Figma${hint}`);
  }
  let style: string;
  if (wanted.fontStyle !== undefined) {
    const requested = wanted.fontStyle;
    const found = entry.styles.find((s) => s === requested) ?? entry.styles.find((s) => squash(s) === squash(requested));
    if (!found) throw specError(where, `${entry.family} has no style "${requested}". Available: ${entry.styles.join(", ")}`);
    style = found;
  } else {
    const weight = wanted.fontWeight ?? 400;
    const italic = wanted.italic ?? false;
    const picked = pickFontStyle(entry.styles, weight, italic);
    if (!picked) {
      throw specError(where, `the weights of ${entry.family}'s styles are unknown (${entry.styles.join(", ")}); pass style.fontStyle`);
    }
    if (!picked.exact) {
      ctx.warnings.push(`${where}: ${entry.family} has no weight ${weight}${italic ? " italic" : ""} style; used "${picked.style}"`);
    }
    style = picked.style;
  }
  const font = { family: entry.family, style };
  ctx.fonts.set(fontKey(font), font);
  return font;
}

/**
 * The font families a spec uses, to look up with get_available_fonts before
 * normalizing. Text that names no family uses Inter, Figma's default.
 */
export function fontFamiliesOf(
  specs: Array<NodeSpec | NodeUpdate>,
  mode: Mode,
  nodeFonts: Record<string, NodeFontRun[]> = {}
): string[] {
  const families = new Set<string>();
  const visit = (spec: NodeFields & { children?: unknown; nodeId?: string }) => {
    const isText = mode === "update" || (spec.type ?? "").toUpperCase() === "TEXT";
    if (isText && (mode === "create" || spec.style !== undefined || spec.textRuns !== undefined)) {
      const family = spec.style?.fontFamily ?? (mode === "create" ? DEFAULT_FONT_FAMILY : undefined);
      if (family) families.add(family);
      for (const run of spec.textRuns ?? []) if (run.fontFamily) families.add(run.fontFamily);
      for (const run of (spec.nodeId && nodeFonts[spec.nodeId]) || []) families.add(run.family);
    }
    if (mode === "create" && Array.isArray(spec.children)) (spec.children as NodeSpec[]).forEach(visit);
  };
  specs.forEach(visit);
  return [...families];
}

const FONT_FIELDS = ["fontFamily", "fontStyle", "fontWeight", "italic"] as const;
const hasFontField = (style: Partial<Record<(typeof FONT_FIELDS)[number], unknown>> | undefined) =>
  !!style && FONT_FIELDS.some((key) => style[key] !== undefined);

/** Whether an update changes fonts, so the node's current fonts fill in what it leaves out. */
export function needsNodeFonts(update: NodeUpdate): boolean {
  return hasFontField(update.style) || (update.textRuns ?? []).some(hasFontField);
}

/**
 * The font runs of a text node from its get_node_info result: the base style
 * with the textRuns that override the font. Empty for other nodes.
 */
export function nodeFontRunsOf(node: any): NodeFontRun[] {
  const base = node?.type === "TEXT" && node.style?.fontFamily && node.style.fontStyle
    ? { family: node.style.fontFamily as string, style: node.style.fontStyle as string }
    : null;
  if (!base) return [];
  const length = typeof node.characters === "string" ? node.characters.length : 0;
  const out: NodeFontRun[] = [];
  let cursor = 0;
  for (const run of Array.isArray(node.textRuns) ? node.textRuns : []) {
    if (run.fontFamily === undefined && run.fontStyle === undefined) continue;
    if (run.start > cursor) out.push({ start: cursor, end: run.start, ...base });
    out.push({ start: run.start, end: run.end, family: run.fontFamily ?? base.family, style: run.fontStyle ?? base.style });
    cursor = run.end;
  }
  if (cursor < length || out.length === 0) out.push({ start: cursor, end: Math.max(length, cursor), ...base });
  return out;
}

// ─── Paints and effects ────────────────────────────────────────────────────

function toRgba(color: ColorInput, where: string): { r: number; g: number; b: number; a: number } {
  if (typeof color !== "string") return { r: color.r, g: color.g, b: color.b, a: color.a ?? 1 };
  const rgba = hexToRgba(color);
  if (!rgba) throw specError(where, `"${color}" is not a hex color`);
  return rgba;
}

/**
 * The REST format places a gradient with three handles in the node's 0-1 box;
 * the Plugin API takes the transform from that box to gradient space, where
 * the gradient runs from (0, 0.5) to (1, 0.5) and the width handle is (0, 1).
 * Build the map from gradient space to the handles and invert it. Two handles
 * are enough: the width handle is then perpendicular, at half the length.
 */
export function gradientTransformFromHandles(handles: Array<{ x: number; y: number }>): number[][] | null {
  if (handles.length < 2) return null;
  const [p0, p1] = handles;
  const p2 = handles[2] ?? { x: p0.x - (p1.y - p0.y) / 2, y: p0.y + (p1.x - p0.x) / 2 };
  const a = p1.x - p0.x;
  const d = p1.y - p0.y;
  const b = 2 * (p2.x - p0.x);
  const e = 2 * (p2.y - p0.y);
  const c = 2 * p0.x - p2.x;
  const f = 2 * p0.y - p2.y;
  const det = a * e - b * d;
  if (Math.abs(det) < 1e-9) return null;
  const clean = (n: number) => round(n, 6) + 0; // + 0 turns -0 into 0
  return [
    [clean(e / det), clean(-b / det), clean((b * f - e * c) / det)],
    [clean(-d / det), clean(a / det), clean((d * c - a * f) / det)],
  ];
}

function toPaint(paint: PaintInput, where: string, ctx: Context): Record<string, unknown> | null {
  const extra: Record<string, unknown> = {};
  if (paint.visible === false) extra.visible = false;
  if (paint.blendMode !== undefined && paint.blendMode !== "NORMAL") extra.blendMode = paint.blendMode;
  const opacity = paint.opacity ?? 1;

  switch (paint.type) {
    case "SOLID": {
      if (paint.color === undefined) throw specError(where, "a SOLID paint needs a color");
      const { r, g, b, a } = toRgba(paint.color, where);
      return { type: "SOLID", color: { r, g, b }, opacity: round(opacity * a, 4), ...extra };
    }
    case "GRADIENT_LINEAR":
    case "GRADIENT_RADIAL":
    case "GRADIENT_ANGULAR":
    case "GRADIENT_DIAMOND": {
      if (!paint.gradientStops || paint.gradientStops.length < 2) throw specError(where, "a gradient needs at least 2 gradientStops");
      let gradientTransform = paint.gradientTransform;
      if (!gradientTransform && paint.gradientHandlePositions) {
        gradientTransform = gradientTransformFromHandles(paint.gradientHandlePositions) ?? undefined;
        if (!gradientTransform) ctx.warnings.push(`${where}: the gradient handles are degenerate; used a left-to-right gradient`);
      }
      return {
        type: paint.type,
        gradientStops: paint.gradientStops.map((stop) => ({ position: stop.position, color: toRgba(stop.color, where) })),
        gradientTransform: gradientTransform ?? IDENTITY,
        ...(opacity !== 1 ? { opacity } : {}),
        ...extra,
      };
    }
    case "IMAGE": {
      const imageHash = paint.imageHash ?? paint.imageRef;
      if (!imageHash) throw specError(where, "an IMAGE paint needs imageRef, the image hash that get_node_info returns");
      const image: Record<string, unknown> = {
        type: "IMAGE",
        imageHash,
        scaleMode: paint.scaleMode === "STRETCH" ? "CROP" : paint.scaleMode ?? "FILL",
      };
      if (paint.imageTransform) image.imageTransform = paint.imageTransform;
      if (paint.scalingFactor !== undefined) image.scalingFactor = paint.scalingFactor;
      if (paint.rotation) image.rotation = paint.rotation;
      if (paint.filters) image.filters = paint.filters;
      if (opacity !== 1) image.opacity = opacity;
      return { ...image, ...extra };
    }
    default:
      ctx.warnings.push(`${where}: ${paint.type} paints are not supported; the paint was skipped`);
      return null;
  }
}

function paintsOf(paints: PaintInput[], where: string, ctx: Context): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  paints.forEach((paint, i) => {
    const converted = toPaint(paint, `${where}[${i}]`, ctx);
    if (converted) out.push(converted);
  });
  return out;
}

function effectsOf(effects: EffectInput[], where: string, ctx: Context): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  effects.forEach((effect, i) => {
    const at = `${where}[${i}]`;
    switch (effect.type) {
      case "DROP_SHADOW":
      case "INNER_SHADOW": {
        if (effect.color === undefined) throw specError(at, "a shadow needs a color");
        const shadow: Record<string, unknown> = {
          type: effect.type,
          color: toRgba(effect.color, at),
          offset: effect.offset ?? { x: 0, y: 0 },
          radius: effect.radius ?? 0,
          spread: effect.spread ?? 0,
          visible: effect.visible ?? true,
          blendMode: effect.blendMode ?? "NORMAL",
        };
        // get_node_info omits false, but Figma shows new shadows behind the node.
        if (effect.type === "DROP_SHADOW") shadow.showShadowBehindNode = effect.showShadowBehindNode ?? false;
        out.push(shadow);
        break;
      }
      case "LAYER_BLUR":
      case "BACKGROUND_BLUR":
        out.push({ type: effect.type, radius: effect.radius ?? 0, visible: effect.visible ?? true });
        break;
      case "NOISE":
      case "TEXTURE":
      case "GLASS": {
        // get_node_info reads these from the Plugin API, so their fields are the plugin's.
        const { color, secondaryColor, ...rest } = effect;
        const passed: Record<string, unknown> = { ...rest, visible: effect.visible ?? true };
        if (color !== undefined) passed.color = toRgba(color, at);
        if (secondaryColor !== undefined) passed.secondaryColor = toRgba(secondaryColor, at);
        out.push(passed);
        break;
      }
      default:
        ctx.warnings.push(`${at}: ${effect.type} effects are not supported; the effect was skipped`);
    }
  });
  return out;
}

// ─── Text ──────────────────────────────────────────────────────────────────

type LineHeightFields = Pick<TextStyleInput, "lineHeightUnit" | "lineHeightPx" | "lineHeightPercentFontSize">;

function lineHeightOf(style: LineHeightFields): Record<string, unknown> | undefined {
  const px = style.lineHeightPx;
  const percent = style.lineHeightPercentFontSize;
  switch (style.lineHeightUnit) {
    case "INTRINSIC_%":
      return { unit: "AUTO" };
    case "FONT_SIZE_%":
      if (percent !== undefined) return { unit: "PERCENT", value: percent };
      break;
    case "PIXELS":
      break;
    default:
      if (px === undefined && percent !== undefined) return { unit: "PERCENT", value: percent };
  }
  return px !== undefined ? { unit: "PIXELS", value: px } : undefined;
}

function hyperlinkOf(link: z.infer<typeof hyperlinkSchema>, where: string): Record<string, unknown> {
  const value = link.value ?? (link.type === "URL" ? link.url : link.nodeID);
  if (!value) throw specError(where, `a ${link.type} hyperlink needs ${link.type === "URL" ? "url" : "nodeID"}`);
  return { type: link.type, value };
}

function textPropsOf(style: TextStyleInput, where: string): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  if (style.fontSize !== undefined) out.fontSize = style.fontSize;
  const lineHeight = lineHeightOf(style);
  if (lineHeight) out.lineHeight = lineHeight;
  if (style.letterSpacing !== undefined) out.letterSpacing = { unit: "PIXELS", value: style.letterSpacing };
  if (style.textCase !== undefined) out.textCase = style.textCase;
  if (style.textDecoration !== undefined) out.textDecoration = style.textDecoration;
  if (style.textAlignHorizontal !== undefined) out.textAlignHorizontal = style.textAlignHorizontal;
  if (style.textAlignVertical !== undefined) out.textAlignVertical = style.textAlignVertical;
  if (style.paragraphSpacing !== undefined) out.paragraphSpacing = style.paragraphSpacing;
  if (style.paragraphIndent !== undefined) out.paragraphIndent = style.paragraphIndent;
  // maxLines only takes effect with truncation, so set truncation first.
  if (style.textTruncation !== undefined) out.textTruncation = style.textTruncation;
  if (style.maxLines != null) out.maxLines = style.maxLines;
  if (style.hyperlink) out.hyperlink = hyperlinkOf(style.hyperlink, where);
  return nonEmpty(out);
}

/** The font a run starts from: what it leaves out comes from here. */
type BaseFont = { family?: string; weight?: number; italic?: boolean };

function baseFontOf(font: FontName): BaseFont {
  const parsed = parseFontStyle(font.style);
  return { family: font.family, weight: parsed?.weight, italic: parsed?.italic };
}

function rangesOf(
  spec: NodeFields,
  baseAt: (start: number) => BaseFont,
  label: string,
  ctx: Context
): PluginTextRange[] {
  const characters = spec.characters;
  const ranges: PluginTextRange[] = [];
  let cursor = 0;

  (spec.textRuns ?? []).forEach((run: TextRunInput, i) => {
    const where = `${label}, textRuns[${i}]`;
    let { start, end } = run;
    if (start === undefined || end === undefined) {
      if (run.text === undefined || characters === undefined) {
        throw specError(where, "give start and end, or text that occurs in characters");
      }
      const found = characters.indexOf(run.text, cursor);
      if (found < 0) throw specError(where, `"${run.text}" does not occur in characters after position ${cursor}`);
      start = found;
      end = found + run.text.length;
    }
    if (end <= start) throw specError(where, "end must be greater than start");
    if (characters !== undefined) {
      if (end > characters.length) throw specError(where, `end ${end} is past the end of characters (length ${characters.length})`);
      if (run.text !== undefined && characters.slice(start, end) !== run.text) {
        throw specError(where, `characters ${start}-${end} are "${characters.slice(start, end)}", not "${run.text}"`);
      }
    }
    cursor = end;

    const range: PluginTextRange = { start, end, props: {} };
    if (hasFontField(run)) {
      const base = baseAt(start);
      const family = run.fontFamily ?? base.family;
      if (!family) throw specError(where, "pass fontFamily: the node's font family is not given in style");
      range.fontName = resolveFont(
        family,
        { fontStyle: run.fontStyle, fontWeight: run.fontWeight ?? base.weight, italic: run.italic ?? base.italic },
        where,
        ctx
      );
    }
    if (run.fontSize !== undefined) range.props.fontSize = run.fontSize;
    const lineHeight = lineHeightOf(run);
    if (lineHeight) range.props.lineHeight = lineHeight;
    if (run.letterSpacing !== undefined) range.props.letterSpacing = { unit: "PIXELS", value: run.letterSpacing };
    if (run.textCase !== undefined) range.props.textCase = run.textCase;
    if (run.textDecoration !== undefined) range.props.textDecoration = run.textDecoration;
    if (run.hyperlink) range.props.hyperlink = hyperlinkOf(run.hyperlink, where);
    if (run.fills !== undefined) range.props.fills = paintsOf(run.fills, `${where}, fills`, ctx);

    const paragraphOnly = PARAGRAPH_ONLY_FIELDS.filter((key) => run[key] != null);
    if (paragraphOnly.length > 0) {
      ctx.warnings.push(`${where}: ${paragraphOnly.join(", ")} apply to whole paragraphs, not to a run; ignored`);
    }
    // A run without overrides is the base style, which the node already has.
    if (range.fontName || Object.keys(range.props).length > 0) ranges.push(range);
  });
  return ranges;
}

function textOf(
  spec: NodeFields,
  dims: { width?: number; height?: number },
  label: string,
  ctx: Context
): PluginTextSpec | undefined {
  const creating = ctx.mode === "create";
  const style = spec.style ?? {};
  const text: PluginTextSpec = {};
  const family = style.fontFamily ?? (creating ? DEFAULT_FONT_FAMILY : undefined);
  // update_nodes: the node's fonts, after new characters if there are any (they take the first character's font).
  let current = creating ? [] : ctx.nodeFonts ?? [];
  if (spec.characters !== undefined && current.length > 0) current = [{ ...current[0], start: 0, end: spec.characters.length }];
  let fontRuns: Array<NodeFontRun & { font: FontName }> = current.map((run) => ({ ...run, font: { family: run.family, style: run.style } }));

  if (!creating && hasFontField(style) && current.length > 0) {
    // Each run keeps its own family, weight and slant unless the style gives them.
    fontRuns = current.map((run) => {
      const own = baseFontOf(run);
      const wanted = style.fontStyle !== undefined
        ? { fontStyle: style.fontStyle }
        : { fontWeight: style.fontWeight ?? own.weight, italic: style.italic ?? own.italic };
      return { ...run, font: resolveFont(style.fontFamily ?? run.family, wanted, label, ctx) };
    });
    text.fontName = fontRuns[0].font;
  } else if (creating || hasFontField(style)) {
    if (!family) throw specError(label, "pass style.fontFamily together with fontStyle, fontWeight or italic");
    text.fontName = resolveFont(family, { fontStyle: style.fontStyle, fontWeight: style.fontWeight, italic: style.italic }, label, ctx);
  }
  if (spec.characters !== undefined) text.characters = spec.characters;
  const props = textPropsOf(style, label);
  if (props) text.props = props;

  // Without textAutoResize, a box of both sides is fixed and a width alone wraps.
  let autoResize: string | undefined = style.textAutoResize;
  if (autoResize === undefined && creating) {
    if (dims.width !== undefined && dims.height !== undefined) autoResize = "NONE";
    else if (dims.width !== undefined) autoResize = "HEIGHT";
  }
  if (autoResize) text.autoResize = autoResize;

  const ranges: PluginTextRange[] = [];
  if (text.fontName && fontRuns.length > 0) {
    // fontName sets the whole text; the runs whose font differs follow.
    for (const run of fontRuns.slice(1)) {
      if (fontKey(run.font) !== fontKey(fontRuns[0].font)) ranges.push({ start: run.start, end: run.end, fontName: run.font, props: {} });
    }
  }
  const baseAt = (start: number): BaseFont => {
    const run = fontRuns.find((r) => start >= r.start && start < r.end) ?? fontRuns[0];
    if (run) return baseFontOf(run.font);
    const base: BaseFont = text.fontName ? baseFontOf(text.fontName) : { family };
    return { family: base.family, weight: style.fontWeight ?? base.weight, italic: style.italic ?? base.italic };
  };
  ranges.push(...rangesOf(spec, baseAt, label, ctx));
  if (ranges.length > 0) text.ranges = ranges;
  if (spec.lineTypes !== undefined || spec.lineIndentations !== undefined) {
    ctx.warnings.push(`${label}: list formatting (lineTypes, lineIndentations) is not applied`);
  }
  return nonEmpty(text);
}

// ─── Nodes ─────────────────────────────────────────────────────────────────

function isHiddenStub(spec: NodeSpec): boolean {
  return spec.visible === false && Object.keys(spec).every((key) => ["id", "name", "type", "visible"].includes(key));
}

function createStepOf(spec: NodeSpec, type: string, label: string, ctx: Context): CreateStep | null {
  if (spec.svg !== undefined) return { kind: "svg", svg: spec.svg };
  if ((NATIVE_TYPES as readonly string[]).includes(type)) return { kind: "new", type: type as NativeType };
  if (type === "GROUP") return { kind: "group" };
  if (type === "INSTANCE") {
    if (!spec.id && !spec.componentId) throw specError(label, "an INSTANCE needs componentId, the node ID of its main component");
    return { kind: "instance", sourceId: spec.id, componentId: spec.componentId, hasChildren: (spec.children?.length ?? 0) > 0 };
  }
  if (spec.id) return { kind: "clone", type, sourceId: spec.id };
  ctx.warnings.push(
    `${label}: skipped; ${type} nodes are not built from properties. Pass svg with the node's markup ` +
    `(get_svg returns it), or keep id to clone the original from this file`
  );
  return null;
}

function claimKey(spec: NodeSpec, path: string, label: string, ctx: Context): string {
  if (spec.key !== undefined) {
    if (ctx.keys.has(spec.key)) throw specError(label, `key "${spec.key}" is used twice; keys must be unique`);
    ctx.keys.add(spec.key);
    return spec.key;
  }
  // The source id maps old IDs to new ones when a get_node_info result is
  // copied. If the same subtree is pasted twice, the later copies use paths.
  const key = spec.id !== undefined && !ctx.keys.has(spec.id) ? spec.id : path;
  ctx.keys.add(key);
  return key;
}

/** The size before rotation, from the rotated bounding box that get_node_info reports. */
function unrotatedSize(
  box: { width: number; height: number },
  rotation: number | undefined,
  label: string,
  ctx: Context
): { width: number; height: number } {
  if (!rotation) return { width: box.width, height: box.height };
  const radians = (rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(radians));
  const s = Math.abs(Math.sin(radians));
  const det = c * c - s * s;
  if (Math.abs(det) < 0.1) {
    ctx.warnings.push(`${label}: rotated near 45 degrees, so its size was taken from the bounding box; pass width and height`);
    return { width: box.width, height: box.height };
  }
  return {
    width: Math.max(0, round((c * box.width - s * box.height) / det, 2)),
    height: Math.max(0, round((c * box.height - s * box.width) / det, 2)),
  };
}

function dimensionsOf(spec: NodeFields, label: string, ctx: Context): { width?: number; height?: number } {
  const dims: { width?: number; height?: number } = {};
  if (spec.width !== undefined) dims.width = spec.width;
  if (spec.height !== undefined) dims.height = spec.height;
  // absoluteBoundingBox is what get_node_info reports; update_nodes resizes only on width and height.
  if (ctx.mode === "create" && spec.absoluteBoundingBox && (dims.width === undefined || dims.height === undefined)) {
    const size = unrotatedSize(spec.absoluteBoundingBox, spec.rotation, label, ctx);
    if (dims.width === undefined) dims.width = size.width;
    if (dims.height === undefined) dims.height = size.height;
  }
  return dims;
}

function sizeOf(
  dims: { width?: number; height?: number },
  create: CreateStep | undefined,
  text: PluginTextSpec | undefined
): { width?: number; height?: number } | undefined {
  if (create?.kind === "group") return undefined; // a group takes its size from its children
  if (create?.kind === "new" && create.type === "TEXT") {
    // Text that resizes itself only takes the sides it does not compute.
    if (text?.autoResize === "WIDTH_AND_HEIGHT" || text?.autoResize === undefined) return undefined;
    if (text.autoResize === "HEIGHT") return dims.width === undefined ? undefined : { width: dims.width };
  }
  return nonEmpty({ ...dims });
}

function appearanceOf(spec: NodeFields, create: CreateStep | undefined, label: string, ctx: Context): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  const isNew = ctx.mode === "create" && create?.kind === "new";
  const newType = isNew && create?.kind === "new" ? create.type : undefined;

  if (spec.fills !== undefined) out.fills = paintsOf(spec.fills, `${label}, fills`, ctx);
  else if (newType && EMPTY_FILL_TYPES.has(newType)) out.fills = [];
  if (spec.strokes !== undefined) out.strokes = paintsOf(spec.strokes, `${label}, strokes`, ctx);
  if (spec.strokeWeight !== undefined) out.strokeWeight = spec.strokeWeight;
  if (spec.strokeAlign !== undefined) out.strokeAlign = spec.strokeAlign;
  if (spec.individualStrokeWeights) {
    const { top, right, bottom, left } = spec.individualStrokeWeights;
    Object.assign(out, { strokeTopWeight: top, strokeRightWeight: right, strokeBottomWeight: bottom, strokeLeftWeight: left });
  }
  if (spec.strokeDashes !== undefined) out.dashPattern = spec.strokeDashes;
  if (spec.cornerRadius !== undefined) out.cornerRadius = spec.cornerRadius;
  if (spec.rectangleCornerRadii) {
    const corners = ["topLeftRadius", "topRightRadius", "bottomRightRadius", "bottomLeftRadius"];
    spec.rectangleCornerRadii.forEach((radius, i) => {
      if (radius !== null) out[corners[i]] = radius;
    });
  }
  if (spec.cornerSmoothing !== undefined) out.cornerSmoothing = spec.cornerSmoothing;
  if (spec.effects !== undefined) out.effects = effectsOf(spec.effects, `${label}, effects`, ctx);
  if (spec.opacity !== undefined) out.opacity = spec.opacity;
  if (spec.blendMode !== undefined) out.blendMode = spec.blendMode;
  if (spec.isMask !== undefined) out.isMask = spec.isMask;
  if (spec.locked !== undefined) out.locked = spec.locked;
  if (spec.clipsContent !== undefined) out.clipsContent = spec.clipsContent;
  else if (newType && NO_CLIP_TYPES.has(newType)) out.clipsContent = false;
  if (spec.visible !== undefined) out.visible = spec.visible;
  return nonEmpty(out);
}

/** Auto-layout container properties. Returns the layout mode the node's children see. */
function layoutOf(spec: NodeFields, label: string, ctx: Context): { layout?: Record<string, unknown>; mode?: string } {
  let mode: string | undefined = spec.layoutMode;
  if (mode === "GRID") {
    ctx.warnings.push(`${label}: grid auto-layout is not supported; its children are placed at their positions`);
    mode = "NONE";
  }
  const fields = spec as Record<string, unknown>;
  const given = AUTO_LAYOUT_PROPS.filter((key) => key !== "layoutMode" && fields[key] != null);
  if (ctx.mode === "create" && (mode === undefined || mode === "NONE")) {
    if (given.length > 0) ctx.warnings.push(`${label}: ${given.join(", ")} ignored; they need layoutMode HORIZONTAL or VERTICAL`);
    return { mode: "NONE" };
  }
  const layout: Record<string, unknown> = {};
  if (mode !== undefined) layout.layoutMode = mode;
  for (const key of given) layout[key] = fields[key];
  if (ctx.mode === "create" && mode !== undefined && AUTO_LAYOUT_MODES.has(mode)) {
    Object.assign(layout, defaultSizingModes(spec, mode, layout));
    // get_node_info omits false, but new auto-layout frames include strokes in the layout.
    if (layout.strokesIncludedInLayout === undefined) layout.strokesIncludedInLayout = false;
  }
  return { layout: nonEmpty(layout), mode };
}

/**
 * The sizing modes a new auto-layout frame gets when the spec omits them.
 * Figma's own default is to hug the primary axis and fix the counter axis,
 * while get_node_info omits a mode that is AUTO. So an omitted mode follows
 * the axis's layoutSizing (HUG hugs; FIXED and FILL are fixed), then a width
 * or height given for that axis (fixed), and otherwise hugs, as in the reader.
 */
function defaultSizingModes(spec: NodeFields, mode: string, layout: Record<string, unknown>): Record<string, string> {
  const horizontal = mode === "HORIZONTAL";
  const axes = [
    { key: "primaryAxisSizingMode", sizing: horizontal ? spec.layoutSizingHorizontal : spec.layoutSizingVertical, side: horizontal ? spec.width : spec.height },
    { key: "counterAxisSizingMode", sizing: horizontal ? spec.layoutSizingVertical : spec.layoutSizingHorizontal, side: horizontal ? spec.height : spec.width },
  ];
  const out: Record<string, string> = {};
  for (const { key, sizing, side } of axes) {
    if (layout[key] !== undefined) continue;
    if (sizing !== undefined) out[key] = sizing === "HUG" ? "AUTO" : "FIXED";
    else out[key] = side !== undefined ? "FIXED" : "AUTO";
  }
  return out;
}

function canHug(create: CreateStep | undefined, ownLayout: string | undefined): boolean {
  if (create?.kind !== "new") return true; // unknown until the plugin has the node
  if (create.type === "TEXT") return true;
  return CONTAINER_TYPES.has(create.type) && ownLayout !== undefined && AUTO_LAYOUT_MODES.has(ownLayout);
}

function childPropsOf(
  spec: NodeFields,
  create: CreateStep | undefined,
  ownLayout: string | undefined,
  parentLayout: string | undefined,
  label: string,
  ctx: Context
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  // parentLayout is known for nodes inside the tree; the plugin checks the root.
  const parentLacksAutoLayout = parentLayout !== undefined && !AUTO_LAYOUT_MODES.has(parentLayout);
  const needsAutoLayoutParent = (what: string): boolean => {
    if (!parentLacksAutoLayout) return true;
    ctx.warnings.push(`${label}: ${what} ignored; the parent has no auto-layout`);
    return false;
  };

  if (spec.layoutPositioning === "AUTO" || (spec.layoutPositioning === "ABSOLUTE" && needsAutoLayoutParent("layoutPositioning ABSOLUTE"))) {
    out.layoutPositioning = spec.layoutPositioning;
  }
  for (const axis of ["layoutSizingHorizontal", "layoutSizingVertical"] as const) {
    const value = spec[axis];
    if (value === undefined) continue;
    if (value === "FILL" && !needsAutoLayoutParent(`${axis} FILL`)) continue;
    if (value === "HUG" && !canHug(create, ownLayout)) {
      ctx.warnings.push(`${label}: ${axis} HUG ignored; only text and auto-layout frames hug their content`);
      continue;
    }
    out[axis] = value;
  }
  // layoutGrow and layoutAlign are the older form of FILL; the sizing fields supersede them.
  if (spec.layoutSizingHorizontal === undefined && spec.layoutSizingVertical === undefined) {
    if (spec.layoutGrow !== undefined && (spec.layoutGrow === 0 || needsAutoLayoutParent("layoutGrow"))) out.layoutGrow = spec.layoutGrow;
    if (spec.layoutAlign !== undefined && (spec.layoutAlign === "INHERIT" || needsAutoLayoutParent("layoutAlign"))) out.layoutAlign = spec.layoutAlign;
  }
  for (const key of ["minWidth", "maxWidth", "minHeight", "maxHeight"] as const) {
    if (spec[key] != null) out[key] = spec[key];
  }
  return nonEmpty(out);
}

/** Where the bounding box of a rotated node starts, relative to its x and y (the transform origin). */
export function rotatedBoxOffset(width: number, height: number, rotation: number): { x: number; y: number } {
  const radians = (rotation * Math.PI) / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  // Figma rotates counterclockwise on a y-down canvas: (x, y) -> (x cos + y sin, -x sin + y cos).
  const xs = [0, width * c, height * s, width * c + height * s];
  const ys = [0, -width * s, height * c, height * c - width * s];
  return { x: round(Math.min(...xs), 2) + 0, y: round(Math.min(...ys), 2) + 0 };
}

function positionOf(
  spec: NodeFields,
  create: CreateStep | undefined,
  isRoot: boolean,
  parentLayout: string | undefined,
  childProps: Record<string, unknown> | undefined,
  label: string,
  ctx: Context
): PluginNodeSpec["position"] {
  const explicit = spec.x !== undefined || spec.y !== undefined;
  let base: { x: number; y: number } | undefined;
  let byBox = false;
  if (ctx.mode === "create" && create?.kind === "group") {
    // A new group is not rotated (see ownPropsOf), so its x and y are where its box starts.
    if (!isRoot && spec.parentOffset) base = spec.parentOffset;
    else if (spec.localPosition) {
      base = spec.localPosition;
      if (spec.rotation && spec.width !== undefined && spec.height !== undefined) {
        const offset = rotatedBoxOffset(spec.width, spec.height, spec.rotation);
        base = { x: round(base.x + offset.x, 2), y: round(base.y + offset.y, 2) };
      }
    }
  } else if (ctx.mode === "create") {
    if (spec.localPosition) base = spec.localPosition;
    else if (!isRoot && spec.parentOffset) {
      base = spec.parentOffset;
      byBox = true;
    }
  }
  const x = spec.x ?? base?.x;
  const y = spec.y ?? base?.y;
  if (x === undefined && y === undefined) return undefined;
  const inFlow = parentLayout !== undefined && AUTO_LAYOUT_MODES.has(parentLayout) && childProps?.layoutPositioning !== "ABSOLUTE";
  if (inFlow) {
    if (explicit) {
      ctx.warnings.push(`${label}: x and y ignored; the parent uses auto-layout. Set layoutPositioning to ABSOLUTE to place the node freely`);
    }
    return undefined;
  }
  const position: NonNullable<PluginNodeSpec["position"]> = { byBox: byBox && !explicit, explicit };
  if (x !== undefined) position.x = x;
  if (y !== undefined) position.y = y;
  return position;
}

/** Everything but creation and children: shared by create_node_tree and update_nodes. */
function ownPropsOf(
  spec: NodeFields,
  create: CreateStep | undefined,
  isRoot: boolean,
  parentLayout: string | undefined,
  label: string,
  ctx: Context
): { node: Omit<PluginNodeSpec, "label">; ownLayout?: string } {
  const node: Omit<PluginNodeSpec, "label"> = {};
  if (spec.name !== undefined) node.name = spec.name;
  // A new group takes its size, rotation and place from its children: the
  // children's rotation already includes the group's. Figma has no
  // constraints on groups.
  const newGroup = create?.kind === "group";

  const dims = newGroup ? {} : dimensionsOf(spec, label, ctx);
  const isText = create === undefined || (create.kind === "new" && create.type === "TEXT");
  const hasText = spec.characters !== undefined || spec.style !== undefined || spec.textRuns !== undefined;
  if (isText && (hasText || create !== undefined)) {
    const text = textOf(spec, dims, label, ctx);
    if (text) node.text = text;
  } else if (hasText) {
    ctx.warnings.push(`${label}: characters, style and textRuns apply only to TEXT nodes; ignored`);
  }

  const size = sizeOf(dims, create, node.text);
  if (size) node.size = size;
  const props = appearanceOf(spec, create, label, ctx);
  if (props) node.props = props;
  const { layout, mode } = layoutOf(spec, label, ctx);
  if (layout) node.layout = layout;
  const childProps = childPropsOf(spec, create, mode, parentLayout, label, ctx);
  if (childProps) node.childProps = childProps;
  const position = positionOf(spec, create, isRoot, parentLayout, childProps, label, ctx);
  if (position) node.position = position;
  if (spec.constraints && !newGroup) {
    node.constraints = {
      horizontal: HORIZONTAL_CONSTRAINTS[spec.constraints.horizontal],
      vertical: VERTICAL_CONSTRAINTS[spec.constraints.vertical],
    };
  }
  // A clone keeps its source's transform, which inside a rotated group is
  // relative to the group: set its rotation even when it is 0.
  const copied = create?.kind === "clone" || create?.kind === "instance";
  if (copied && !newGroup) node.rotation = spec.rotation ?? 0;
  else if (spec.rotation !== undefined && !newGroup && (spec.rotation !== 0 || ctx.mode === "update")) node.rotation = spec.rotation;
  return { node, ownLayout: mode };
}

function normalizeNode(
  spec: NodeSpec,
  path: string,
  parentLayout: string | undefined,
  isRoot: boolean,
  ctx: Context
): PluginNodeSpec | null {
  const label = labelOf(path, spec.name);
  if (!isRoot && isHiddenStub(spec)) {
    ctx.warnings.push(`${label}: skipped; get_node_info returns only the id, name and type of hidden layers`);
    return null;
  }
  if (!spec.type) throw specError(label, "type is required: FRAME, TEXT, RECTANGLE, ELLIPSE, LINE, GROUP, COMPONENT or INSTANCE");
  const create = createStepOf(spec, spec.type.toUpperCase(), label, ctx);
  if (!create) return null;

  const key = claimKey(spec, path, label, ctx);
  const { node, ownLayout } = ownPropsOf(spec, create, isRoot, parentLayout, label, ctx);
  const result: PluginNodeSpec = { label, key, create, ...node };

  const children = spec.children ?? [];
  const buildsChildren = create.kind === "group" || (create.kind === "new" && CONTAINER_TYPES.has(create.type));
  if (buildsChildren) {
    if (spec._childrenTruncated) {
      throw specError(label, "its children were cut off at the depth limit of get_node_info; read it again with a larger depth");
    }
    if (create.kind === "group" && children.length === 0) throw specError(label, "a GROUP needs children");
    // A group's children are laid out in a plain frame first (see buildGroup in code.js).
    const childLayout = create.kind === "group" ? "NONE" : ownLayout ?? "NONE";
    result.children = children
      .map((child, i) => normalizeNode(child, `${path}.children[${i}]`, childLayout, false, ctx))
      .filter((child): child is PluginNodeSpec => child !== null);
  } else if (create.kind === "new" && children.length > 0) {
    throw specError(label, `a ${create.type} node cannot have children`);
  }
  // svg, clone and instance nodes bring their own children.
  return result;
}

/**
 * Translate a create_node_tree spec for the plugin. `fonts` are the fonts to
 * load before building; `tree` is null when the root itself was skipped.
 */
export function normalizeNodeTree(
  spec: NodeSpec,
  catalog: FontCatalog,
  suggestions: FontSuggestions = {}
): { tree: PluginNodeSpec | null; fonts: FontName[]; warnings: string[] } {
  const ctx = newContext("create", catalog, suggestions);
  const tree = normalizeNode(spec, "tree", undefined, true, ctx);
  return { tree, fonts: [...ctx.fonts.values()], warnings: ctx.warnings };
}

/** Translate update_nodes updates for the plugin. */
export function normalizeNodeUpdates(
  updates: NodeUpdate[],
  catalog: FontCatalog,
  suggestions: FontSuggestions = {},
  nodeFonts: Record<string, NodeFontRun[]> = {}
): { updates: Array<{ nodeId: string; spec: PluginNodeSpec }>; fonts: FontName[]; warnings: string[] } {
  const ctx = newContext("update", catalog, suggestions);
  const out = updates.map((update, i) => {
    const label = `updates[${i}] (node ${update.nodeId})`;
    ctx.nodeFonts = nodeFonts[update.nodeId];
    if (update.children !== undefined) {
      throw specError(label, "update_nodes changes a node's own properties. To add children, call create_node_tree with this node as parentId");
    }
    if (update.id !== undefined && update.id !== update.nodeId) throw specError(label, `id "${update.id}" does not match nodeId`);
    if (update.svg !== undefined) throw specError(label, "svg applies only when create_node_tree builds a node");
    const { node } = ownPropsOf(update, undefined, false, undefined, label, ctx);
    if (Object.keys(node).length === 0) ctx.warnings.push(`${label}: nothing to change`);
    return { nodeId: update.nodeId, spec: { label, ...node } };
  });
  // A family change resolves each font run, and a missing weight would be reported per run.
  return { updates: out, fonts: [...ctx.fonts.values()], warnings: [...new Set(ctx.warnings)] };
}
