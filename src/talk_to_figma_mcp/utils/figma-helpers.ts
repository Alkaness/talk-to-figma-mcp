/**
 * Helpers for processing Figma nodes and responses.
 */

/**
 * Convert an RGBA color (channels between 0 and 1) to hex.
 * @param color - The color, with r/g/b/a between 0 and 1
 * @returns #RRGGBB, or #RRGGBBAA when the color is not fully opaque
 */
export function rgbaToHex(color: any): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  // Missing alpha means opaque; a === 0 must stay 0 (transparent), so no `||`.
  const a = Math.round((color.a ?? 1) * 255);

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}${a === 255 ? '' : a.toString(16).padStart(2, '0')}`;
}

/**
 * Parse a hex color into channels between 0 and 1. The inverse of rgbaToHex.
 * @param hex - #RGB, #RGBA, #RRGGBB or #RRGGBBAA
 * @returns The color, or null when the string is not a hex color
 */
export function hexToRgba(hex: string): { r: number; g: number; b: number; a: number } | null {
  const match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex.trim());
  if (!match) return null;
  const digits = match[1].length <= 4 ? match[1].replace(/./g, "$&$&") : match[1];
  const channel = (i: number) => parseInt(digits.slice(i, i + 2), 16) / 255;
  return { r: channel(0), g: channel(2), b: channel(4), a: digits.length === 8 ? channel(6) : 1 };
}

type Box = { x: number; y: number; width: number; height: number };

/** Round to `dp` decimals. Float noise such as 119.99999237 costs tokens and invites arithmetic slips. */
function round(n: number, dp = 2): number {
  const factor = 10 ** dp;
  return Math.round(n * factor) / factor;
}

/** Round every number inside a plain JSON value. */
function roundDeep(value: any, dp = 2): any {
  if (typeof value === "number") return round(value, dp);
  if (Array.isArray(value)) return value.map((item) => roundDeep(item, dp));
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [key, item] of Object.entries(value)) out[key] = roundDeep(item, dp);
    return out;
  }
  return value;
}

function roundBox(box: any): Box | undefined {
  if (!box || typeof box.x !== "number") return undefined;
  return { x: round(box.x), y: round(box.y), width: round(box.width), height: round(box.height) };
}

// The property lists below define the node format. create_node_tree and
// update_nodes accept the same fields (utils/node-spec.ts); a test checks that
// every field listed here is accepted there.

/** Auto-layout container properties. Copied only when the node has a layoutMode. */
export const AUTO_LAYOUT_PROPS = [
  "layoutMode", "layoutWrap", "itemSpacing", "counterAxisSpacing",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "primaryAxisAlignItems", "counterAxisAlignItems", "counterAxisAlignContent",
  "primaryAxisSizingMode", "counterAxisSizingMode", "itemReverseZIndex", "strokesIncludedInLayout",
];

/** Layout-child and appearance properties. */
export const NODE_PROPS = [
  "clipsContent",
  "layoutSizingHorizontal", "layoutSizingVertical", "layoutPositioning", "layoutGrow", "layoutAlign",
  "constraints", "minWidth", "maxWidth", "minHeight", "maxHeight",
  "opacity", "blendMode", "isMask", "cornerRadius", "cornerSmoothing", "componentId",
];

/** Stroke geometry. Copied only when the node has a visible stroke. */
export const STROKE_PROPS = ["strokeWeight", "strokeAlign", "individualStrokeWeights", "strokeDashes"];

export const TEXT_STYLE_FIELDS = [
  "fontFamily", "fontPostScriptName", "fontStyle", "fontWeight", "fontSize", "italic",
  "textCase", "textDecoration", "textAlignHorizontal", "textAlignVertical",
  "letterSpacing", "lineHeightPx", "lineHeightUnit", "lineHeightPercentFontSize",
  "paragraphSpacing", "paragraphIndent", "textAutoResize", "maxLines", "textTruncation", "hyperlink",
];

/** Values equal to Figma's defaults. They are omitted to keep the output compact. */
const NO_OP_VALUES: Record<string, unknown[]> = {
  layoutMode: ["NONE"],
  layoutWrap: ["NO_WRAP"],
  itemSpacing: [0],
  counterAxisSpacing: [0],
  paddingTop: [0],
  paddingRight: [0],
  paddingBottom: [0],
  paddingLeft: [0],
  counterAxisAlignContent: ["AUTO"],
  itemReverseZIndex: [false],
  strokesIncludedInLayout: [false],
  clipsContent: [false],
  layoutPositioning: ["AUTO"],
  layoutGrow: [0],
  layoutAlign: ["INHERIT"],
  opacity: [1],
  blendMode: ["PASS_THROUGH", "NORMAL"],
  isMask: [false],
  cornerRadius: [0],
  cornerSmoothing: [0],
  italic: [false],
  textCase: ["ORIGINAL"],
  textDecoration: ["NONE"],
  letterSpacing: [0],
  paragraphSpacing: [0],
  paragraphIndent: [0],
  textTruncation: ["DISABLED"],
};

function isNoOp(key: string, value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (key === "constraints") {
    const c = value as { vertical?: string; horizontal?: string };
    return c.vertical === "TOP" && c.horizontal === "LEFT";
  }
  return (NO_OP_VALUES[key] ?? []).includes(value);
}

function copyProps(source: any, target: Record<string, any>, keys: string[]): void {
  for (const key of keys) {
    if (!isNoOp(key, source[key])) target[key] = roundDeep(source[key]);
  }
}

/**
 * The REST format stores an image's contrast at 0.3 times the Plugin API
 * value (0.9 exports as 0.27; measured on the JSON_REST_V1 export). The other
 * filters use the Plugin API's -1 to 1 scale already. Returned in Plugin API
 * units, which set_image_filters and create_node_tree take.
 */
function pluginImageFilters(filters: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (typeof value !== "number") continue;
    out[key] = key === "contrast" ? round(Math.max(-1, Math.min(1, value / 0.3)), 4) : round(value, 4);
  }
  return out;
}

/** Visible paints only, colors as hex, defaults dropped. imageRef is kept: it is the hash get_asset takes. */
function compactPaints(paints: unknown): Record<string, any>[] {
  if (!Array.isArray(paints)) return [];
  return paints
    .filter((paint) => paint && paint.visible !== false)
    .map((paint) => {
      const out: Record<string, any> = {};
      for (const [key, value] of Object.entries(paint)) {
        if (key === "visible" || key === "boundVariables") continue;
        if (key === "blendMode" && value === "NORMAL") continue;
        if (key === "opacity" && value === 1) continue;
        if (key === "color") {
          out.color = rgbaToHex(value);
        } else if (key === "gradientStops" && Array.isArray(value)) {
          out.gradientStops = value.map((stop: any) => ({ position: round(stop.position, 4), color: rgbaToHex(stop.color) }));
        } else if (key === "opacity") {
          out.opacity = round(value as number);
        } else if (key === "filters" && value && typeof value === "object") {
          out.filters = pluginImageFilters(value as Record<string, number>);
        } else {
          // Gradient handles and image transforms are 0-1 fractions: keep 4 decimals.
          out[key] = roundDeep(value, 4);
        }
      }
      return out;
    });
}

/** Visible effects only, colors as hex, defaults dropped. */
function compactEffects(effects: unknown): Record<string, any>[] {
  if (!Array.isArray(effects)) return [];
  return effects
    .filter((effect) => effect && effect.visible !== false)
    .map((effect) => {
      const out: Record<string, any> = {};
      for (const [key, value] of Object.entries(effect)) {
        if (key === "visible" || key === "boundVariables") continue;
        if (key === "blendMode" && value === "NORMAL") continue;
        if ((key === "spread" && value === 0) || (key === "showShadowBehindNode" && value === false)) continue;
        out[key] = key === "color" ? rgbaToHex(value) : roundDeep(value);
      }
      return out;
    });
}

/**
 * @param keepDefaults - true for run overrides: a default value there (for
 *   example letterSpacing 0 over a -1 base) is a real change and must be kept.
 */
function compactTextStyle(style: any, keepDefaults: boolean): Record<string, any> {
  const out: Record<string, any> = {};
  for (const key of TEXT_STYLE_FIELDS) {
    const value = style[key];
    if (value === undefined || value === null) continue;
    if (!keepDefaults && isNoOp(key, value)) continue;
    out[key] = roundDeep(value);
  }
  return out;
}

/**
 * Mixed-style text. The REST format stores one override id per character
 * (characterStyleOverrides) and a table of partial styles (styleOverrideTable).
 * Consecutive characters with the same id become one run; id 0, or a missing
 * trailing entry, is the node's base style.
 */
function buildTextRuns(characters: unknown, overrides: unknown, table: unknown): Record<string, any>[] | undefined {
  if (typeof characters !== "string" || characters.length === 0) return undefined;
  if (!Array.isArray(overrides) || !table || typeof table !== "object") return undefined;
  const ids: unknown[] = overrides;
  const styles = table as Record<string, any>;
  if (!ids.some((id) => id !== 0 && styles[String(id)])) return undefined;

  const idAt = (i: number): number => {
    const id = ids[i];
    return typeof id === "number" ? id : 0;
  };
  const runs: Record<string, any>[] = [];
  let start = 0;
  for (let i = 1; i <= characters.length; i++) {
    if (i < characters.length && idAt(i) === idAt(start)) continue;
    const run: Record<string, any> = { start, end: i, text: characters.slice(start, i) };
    const override = idAt(start) !== 0 ? styles[String(idAt(start))] : undefined;
    if (override) {
      Object.assign(run, compactTextStyle(override, true));
      const fills = compactPaints(override.fills);
      if (fills.length > 0) run.fills = fills;
    }
    runs.push(run);
    start = i;
  }
  return runs;
}

/**
 * Serialize a Figma node in the REST format (the plugin's JSON_REST_V1 export,
 * or the REST API) into the tree that get_node_info, get_nodes_info and
 * rest_get_file return.
 *
 * It keeps what a 1:1 reproduction needs: auto-layout and child sizing,
 * absolute positioning, visibility, clipping, opacity, fills, strokes with
 * weight and alignment, per-corner radii, effects, the full text style with
 * runs for mixed-style text, and image hashes. Values equal to Figma's
 * defaults are omitted, colors become hex and lengths are rounded to
 * 2 decimals. The input is not modified.
 *
 * - Never returns null. A hidden node below the root becomes a
 *   `{ id, name, type, visible: false }` stub; a hidden root is serialized in
 *   full with `visible: false`.
 * - `parentOffset` is the position of the node's bounding box relative to its
 *   parent's (CSS left/top). Inside a GROUP it differs from move_node
 *   coordinates, which are relative to the group's parent.
 * - Children deeper than `maxDepth` become `{ id, name, type }` stubs and the
 *   parent gets `_childrenTruncated: true`.
 * - `rotation` is in degrees, counterclockwise, as the Plugin API reports it.
 *   The REST format stores radians with the opposite sign: the plugin
 *   replaces the value before export (annotateRotation in code.js), and
 *   rest_get_file converts it with restRotationToDegrees.
 * - A rotated node also gets `width` and `height` before rotation, from the
 *   REST `size` field, which the plugin adds. Without them the size must be
 *   derived from the rotated box, which fails near 45 degrees.
 *
 * @param node - The node in REST format
 * @param maxDepth - Child levels returned in full detail (default: all)
 * @param currentDepth - Depth of `node` in the recursion
 * @param parentBox - The parent's rounded absoluteBoundingBox, for parentOffset
 */
export function filterFigmaNode(
  node: any,
  maxDepth: number = Infinity,
  currentDepth: number = 0,
  parentBox?: Box
): Record<string, any> {
  const filtered: Record<string, any> = {
    id: node.id,
    name: node.name,
    type: node.type,
  };

  if (node.visible === false) {
    filtered.visible = false;
    // Hidden layers are not rendered, so below the root a stub is enough.
    if (currentDepth > 0) return filtered;
  }

  const box = roundBox(node.absoluteBoundingBox);
  if (box) {
    filtered.absoluteBoundingBox = box;
  }

  if (node.localPosition) {
    filtered.localPosition = roundDeep(node.localPosition);
  }

  if (box && parentBox) {
    filtered.parentOffset = { x: round(box.x - parentBox.x), y: round(box.y - parentBox.y) };
  }

  if (typeof node.rotation === "number" && round(node.rotation, 4) !== 0) {
    filtered.rotation = round(node.rotation, 4);
    // The box of a rotated node is larger than the node itself.
    if (node.size && typeof node.size.x === "number" && typeof node.size.y === "number") {
      filtered.width = round(node.size.x);
      filtered.height = round(node.size.y);
    }
  }

  if (!isNoOp("layoutMode", node.layoutMode)) {
    copyProps(node, filtered, AUTO_LAYOUT_PROPS);
  }
  copyProps(node, filtered, NODE_PROPS);

  const radii = node.rectangleCornerRadii;
  if (Array.isArray(radii) && radii.length === 4) {
    if (radii.some((r: number) => r !== radii[0])) {
      filtered.rectangleCornerRadii = radii.map((r: number) => round(r));
    } else if (filtered.cornerRadius === undefined && radii[0] !== 0) {
      filtered.cornerRadius = round(radii[0]);
    }
  }

  const fills = compactPaints(node.fills);
  if (fills.length > 0) {
    filtered.fills = fills;
  }

  const strokes = compactPaints(node.strokes);
  if (strokes.length > 0) {
    filtered.strokes = strokes;
    copyProps(node, filtered, STROKE_PROPS);
  }

  const effects = compactEffects(node.effects);
  if (effects.length > 0) {
    filtered.effects = effects;
  }

  if (typeof node.characters === "string") {
    filtered.characters = node.characters;
  }

  if (node.style) {
    filtered.style = compactTextStyle(node.style, false);
  }

  const textRuns = buildTextRuns(node.characters, node.characterStyleOverrides, node.styleOverrideTable);
  if (textRuns) {
    filtered.textRuns = textRuns;
  }

  if (Array.isArray(node.lineTypes) && node.lineTypes.some((t: string) => t !== "NONE")) {
    filtered.lineTypes = node.lineTypes;
    if (Array.isArray(node.lineIndentations)) filtered.lineIndentations = node.lineIndentations;
  }

  if (Array.isArray(node.children)) {
    if (currentDepth >= maxDepth) {
      // Beyond depth: return only minimal child stubs so the model can request deeper info on demand
      filtered.children = node.children.map((child: any) =>
        child.visible === false
          ? { id: child.id, name: child.name, type: child.type, visible: false }
          : { id: child.id, name: child.name, type: child.type }
      );
      if (filtered.children.length > 0) {
        filtered._childrenTruncated = true;
      }
    } else {
      filtered.children = node.children.map((child: any) =>
        filterFigmaNode(child, maxDepth, currentDepth + 1, box)
      );
    }
  }

  return filtered;
}

/**
 * Convert the `rotation` of a REST API node tree to the degrees that
 * get_node_info reports. The REST API stores radians with the opposite sign:
 * a node rotated 30 degrees in Figma has rotation -0.5236. Measured on the
 * plugin's JSON_REST_V1 export, which uses the same format. Modifies the tree
 * in place and returns it.
 */
export function restRotationToDegrees<T>(node: T): T {
  const doc = node as any;
  if (!doc || typeof doc !== "object") return node;
  if (typeof doc.rotation === "number") doc.rotation = (-doc.rotation * 180) / Math.PI;
  if (Array.isArray(doc.children)) doc.children.forEach((child: unknown) => restRotationToDegrees(child));
  return node;
}

/**
 * Convert global coordinates to local coordinates relative to a parent
 */
export function globalToLocal(
  globalX: number,
  globalY: number,
  parentGlobalX: number = 0,
  parentGlobalY: number = 0
): { x: number; y: number } {
  return {
    x: globalX - parentGlobalX,
    y: globalY - parentGlobalY
  };
}

/**
 * Convert local coordinates to global coordinates
 */
export function localToGlobal(
  localX: number,
  localY: number,
  parentGlobalX: number = 0,
  parentGlobalY: number = 0
): { x: number; y: number } {
  return {
    x: localX + parentGlobalX,
    y: localY + parentGlobalY
  };
}
