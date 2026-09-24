/**
 * A small stand-in for the Figma Plugin API, enough to run the node tree code
 * in src/claude_mcp_plugin/code.js: create_node_tree, update_nodes,
 * get_available_fonts, set_font_weight and batch_operations with create_frame.
 *
 * It enforces the rules the plugin's build order depends on, and throws where
 * Figma throws:
 * 1. FILL and ABSOLUTE need an auto-layout parent.
 * 2. HUG needs an auto-layout frame or a text node.
 * 3. A font must be loaded before fontName, characters, a range style or a
 *    text property that changes the layout is set.
 *
 * It also lays out auto-layout frames (padding, spacing, alignment, HUG and
 * FILL; no wrap) and applies constraints when a frame changes size. A node
 * placed before its parent reaches its final size therefore moves, as it does
 * in Figma. Defaults follow the live test of 2026-09-24: setting layoutMode
 * hugs the primary axis and fixes the counter axis, and new frames include
 * strokes in the layout.
 *
 * Each node type has only its own properties, because code.js checks support
 * with `key in node`. Children of a GROUP are positioned relative to the
 * group's parent, as in Figma, and a group's box is the union of its children.
 */

export interface FontName {
  family: string;
  style: string;
}

type Axis = "FIXED" | "HUG" | "FILL";
type Box = { x: number; y: number; width: number; height: number };
type Constraints = { horizontal: string; vertical: string };

export const MIXED = Symbol("figma.mixed");

const fontKey = (font: FontName) => `${font.family}\u0000${font.style}`;
const round = (n: number) => Math.round(n * 1000) / 1000;

const CONTAINERS = new Set(["PAGE", "FRAME", "COMPONENT", "INSTANCE", "GROUP"]);
const FRAMES = new Set(["FRAME", "COMPONENT", "INSTANCE"]);

/** Plain properties of each node type, with Figma's initial values. */
function plainProps(type: string): Record<string, unknown> {
  if (type === "PAGE") return {};
  const out: Record<string, unknown> = { effects: [], opacity: 1, blendMode: "PASS_THROUGH", isMask: false, visible: true };
  if (type === "GROUP") return out;
  Object.assign(out, {
    fills: [], strokes: [], strokeWeight: 1, strokeAlign: "INSIDE", dashPattern: [],
    layoutGrow: 0, layoutAlign: "INHERIT", minWidth: null, maxWidth: null, minHeight: null, maxHeight: null,
    constraints: { horizontal: "MIN", vertical: "MIN" },
  });
  if (FRAMES.has(type) || type === "RECTANGLE") {
    Object.assign(out, {
      cornerRadius: 0, topLeftRadius: 0, topRightRadius: 0, bottomRightRadius: 0, bottomLeftRadius: 0, cornerSmoothing: 0,
      strokeTopWeight: 1, strokeRightWeight: 1, strokeBottomWeight: 1, strokeLeftWeight: 1,
    });
  }
  if (FRAMES.has(type)) Object.assign(out, { clipsContent: true, layoutGrids: [] });
  if (type === "FRAME" || type === "COMPONENT") out.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 1 }];
  if (type === "RECTANGLE" || type === "ELLIPSE") out.fills = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.85 }, opacity: 1 }];
  if (type === "TEXT") out.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 1 }];
  return out;
}

/** Auto-layout container properties; setting one lays the frame out again. */
const LAYOUT_DEFAULTS: Record<string, unknown> = {
  layoutWrap: "NO_WRAP", itemSpacing: 0, counterAxisSpacing: 0,
  paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
  primaryAxisAlignItems: "MIN", counterAxisAlignItems: "MIN", counterAxisAlignContent: "AUTO",
  itemReverseZIndex: false, strokesIncludedInLayout: true,
};

/** Text properties; the first group changes the layout and needs the node's fonts. */
const TEXT_LAYOUT_DEFAULTS: Record<string, unknown> = {
  fontSize: 12, lineHeight: { unit: "AUTO" }, letterSpacing: { unit: "PERCENT", value: 0 },
  textCase: "ORIGINAL", paragraphSpacing: 0, paragraphIndent: 0,
};
const TEXT_OTHER_DEFAULTS: Record<string, unknown> = {
  textDecoration: "NONE", textAlignHorizontal: "LEFT", textAlignVertical: "TOP",
  textTruncation: "DISABLED", maxLines: null, hyperlink: null,
};

const RANGE_SETTERS: Array<[string, boolean]> = [
  ["setRangeFontSize", true], ["setRangeLineHeight", true], ["setRangeLetterSpacing", true],
  ["setRangeTextCase", true], ["setRangeTextDecoration", true], ["setRangeHyperlink", false], ["setRangeFills", false],
];

function accessor(node: object, key: string, get: () => unknown, set?: (value: any) => void) {
  Object.defineProperty(node, key, {
    configurable: true,
    enumerable: false,
    get,
    set: set ?? (() => { throw new Error(`in set_${key}: the property is read-only`); }),
  });
}

function method(node: object, key: string, fn: (...args: any[]) => unknown) {
  Object.defineProperty(node, key, { configurable: true, enumerable: false, writable: true, value: fn });
}

export class FakeNode {
  readonly figma: FakeFigma;
  readonly id: string;
  readonly type: string;
  name: string;
  parent: FakeNode | null = null;
  children: FakeNode[] = [];
  removed = false;
  /** Text range styles that were set: [setter, start, end, value]. */
  rangeCalls: Array<[string, number, number, unknown]> = [];
  /** Values behind the accessors, so clone() can copy them. */
  store: Record<string, any> = {};

  constructor(figma: FakeFigma, type: string, id: string) {
    this.figma = figma;
    this.type = type;
    this.id = id;
    this.name = type.charAt(0) + type.slice(1).toLowerCase();
    Object.assign(this.store, {
      x: 0, y: 0, w: type === "PAGE" ? 0 : 100, h: type === "PAGE" || type === "LINE" ? 0 : 100, rotation: 0,
      layoutMode: "NONE", primarySizing: "AUTO", counterSizing: "FIXED", positioning: "AUTO",
      sizing: { h: "FIXED", v: "FIXED" }, chars: "", fonts: [] as FontName[], autoResize: "WIDTH_AND_HEIGHT",
    });
    Object.assign(this, plainProps(type));
    this.install();
    if (type === "TEXT") this.reflow();
  }

  // ─── Per-type API surface ────────────────────────────────────────────────

  private install() {
    const type = this.type;
    const s = this.store;
    if (CONTAINERS.has(type)) {
      method(this, "appendChild", (child: FakeNode) => this.doInsertChild(this.children.length, child));
      method(this, "insertChild", (index: number, child: FakeNode) => this.doInsertChild(index, child));
    }
    if (type === "PAGE") {
      method(this, "loadAsync", async () => {});
      return;
    }
    accessor(this, "x", () => (type === "GROUP" ? this.groupBox().x : s.x), (v: number) => this.moveTo("x", v));
    accessor(this, "y", () => (type === "GROUP" ? this.groupBox().y : s.y), (v: number) => this.moveTo("y", v));
    accessor(this, "width", () => (type === "GROUP" ? this.groupBox().width : s.w));
    accessor(this, "height", () => (type === "GROUP" ? this.groupBox().height : s.h));
    accessor(this, "rotation", () => s.rotation, (v: number) => {
      // Figma rotates around the node's origin, which is its x and y.
      s.rotation = v;
      this.parentChanged();
    });
    accessor(this, "absoluteBoundingBox", () => this.absoluteBox());
    accessor(this, "layoutPositioning", () => s.positioning, (v: string) => this.setPositioning(v));
    accessor(this, "layoutSizingHorizontal", () => this.axisSizing("h"), (v: Axis) => this.setAxisSizing("h", v));
    accessor(this, "layoutSizingVertical", () => this.axisSizing("v"), (v: Axis) => this.setAxisSizing("v", v));
    method(this, "remove", () => this.doRemove());
    method(this, "clone", () => this.doClone());
    if (type !== "GROUP") method(this, "resize", (w: number, h: number) => this.doResize(w, h));
    if (type === "COMPONENT") method(this, "createInstance", () => this.doCreateInstance());

    if (FRAMES.has(type)) {
      accessor(this, "layoutMode", () => s.layoutMode, (v: string) => this.setLayoutMode(v));
      accessor(this, "primaryAxisSizingMode", () => s.primarySizing, (v: string) => { s.primarySizing = v; this.relayout(); });
      accessor(this, "counterAxisSizingMode", () => s.counterSizing, (v: string) => { s.counterSizing = v; this.relayout(); });
      for (const [key, initial] of Object.entries(LAYOUT_DEFAULTS)) {
        s[key] = initial;
        accessor(this, key, () => s[key], (v) => { s[key] = v; this.relayout(); });
      }
    }

    if (type === "TEXT") {
      accessor(this, "fontName", () => this.fontNameOf(), (v: FontName) => this.setFontName(v));
      accessor(this, "characters", () => s.chars, (v: string) => this.setCharacters(v));
      accessor(this, "textAutoResize", () => s.autoResize, (v: string) => {
        this.requireFonts("textAutoResize");
        s.autoResize = v;
        this.reflow();
      });
      for (const [key, initial] of Object.entries(TEXT_LAYOUT_DEFAULTS)) {
        s[key] = initial;
        accessor(this, key, () => s[key], (v) => { this.requireFonts(key); s[key] = v; this.reflow(); });
      }
      for (const [key, initial] of Object.entries(TEXT_OTHER_DEFAULTS)) {
        s[key] = initial;
        accessor(this, key, () => s[key], (v) => { s[key] = v; });
      }
      method(this, "getRangeFontName", (start: number, end: number) => {
        const fonts = this.rangeFonts(start, end);
        return fonts.length === 1 ? { ...fonts[0] } : MIXED;
      });
      method(this, "getRangeAllFontNames", (start: number, end: number) => this.rangeFonts(start, end).map((f) => ({ ...f })));
      method(this, "setRangeFontName", (start: number, end: number, font: FontName) => {
        this.checkRange("setRangeFontName", start, end);
        this.requireFonts("rangeFontName", [font, ...this.rangeFonts(start, end)]);
        for (let i = start; i < end; i++) s.fonts[i] = { ...font };
        this.rangeCalls.push(["setRangeFontName", start, end, font]);
      });
      for (const [name, needsFonts] of RANGE_SETTERS) {
        method(this, name, (start: number, end: number, value: unknown) => {
          this.checkRange(name, start, end);
          if (needsFonts) this.requireFonts(name, this.rangeFonts(start, end));
          this.rangeCalls.push([name, start, end, value]);
        });
      }
    }
  }

  // ─── Tree ────────────────────────────────────────────────────────────────

  private doInsertChild(index: number, child: FakeNode) {
    const old = child.parent;
    if (old) old.children.splice(old.children.indexOf(child), 1);
    child.parent = this;
    this.children.splice(Math.min(index, this.children.length), 0, child);
    if (old && old !== this) old.childrenChanged();
    this.childrenChanged();
  }

  private doRemove() {
    const parent = this.parent;
    if (parent) parent.children.splice(parent.children.indexOf(this), 1);
    this.parent = null;
    const mark = (node: FakeNode) => {
      node.removed = true;
      node.children.forEach(mark);
    };
    mark(this);
    if (parent) parent.childrenChanged();
  }

  private doClone(): FakeNode {
    const copy = this.doCopy();
    if (this.parent) this.parent.doInsertChild(this.parent.children.indexOf(this) + 1, copy);
    return copy;
  }

  private doCopy(): FakeNode {
    const copy = this.figma.create(this.type);
    copy.name = this.name;
    for (const key of Object.keys(plainProps(this.type))) (copy as any)[key] = structuredClone((this as any)[key]);
    Object.assign(copy.store, structuredClone(this.store));
    for (const child of this.children) {
      const childCopy = child.doCopy();
      childCopy.parent = copy;
      copy.children.push(childCopy);
    }
    return copy;
  }

  private doCreateInstance(): FakeNode {
    const instance = this.figma.create("INSTANCE");
    instance.store.w = this.store.w;
    instance.store.h = this.store.h;
    (this.figma.currentPage as any).appendChild(instance);
    return instance;
  }

  // ─── Geometry ────────────────────────────────────────────────────────────

  private moveTo(axis: "x" | "y", value: number) {
    if (this.type === "GROUP") {
      const delta = value - this.groupBox()[axis];
      this.walkLeaves((leaf) => (leaf.store[axis] += delta));
      this.parentChanged();
      return;
    }
    if (this.inFlow()) return; // auto-layout decides
    this.store[axis] = value;
  }

  private doResize(width: number, height: number) {
    if (width < 0.01 || (height < 0.01 && this.type !== "LINE")) throw new Error("in resize: width and height must be >= 0.01");
    if (this.type === "LINE" && height !== 0) throw new Error("in resize: a line's height must be 0");
    const dw = width - this.store.w;
    const dh = height - this.store.h;
    this.store.w = width;
    this.store.h = height;
    if (this.type === "TEXT") {
      if (this.store.autoResize === "WIDTH_AND_HEIGHT") this.store.autoResize = "NONE";
      this.reflow();
    }
    this.resized(dw, dh);
  }

  /** The box relative to the container's origin: rotated around x and y. */
  localBox(): Box {
    if (this.type === "GROUP") return this.groupBox();
    const { x, y, w, h, rotation } = this.store;
    const r = (rotation * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    const xs = [0, w * c, h * s, w * c + h * s];
    const ys = [0, -w * s, h * c, h * c - w * s];
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return { x: x + minX, y: y + minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
  }

  private groupBox(): Box {
    const boxes = this.children.map((child) => child.localBox());
    if (boxes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    return {
      x,
      y,
      width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
      height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
    };
  }

  /** The nearest ancestor that is not a group: x and y are relative to it. */
  private container(): FakeNode | null {
    let parent = this.parent;
    while (parent && parent.type === "GROUP") parent = parent.parent;
    return parent;
  }

  absoluteBox(): Box {
    const container = this.container();
    const origin = container && container.type !== "PAGE" ? container.absoluteBox() : { x: 0, y: 0 };
    const box = this.localBox();
    return { x: round(origin.x + box.x), y: round(origin.y + box.y), width: round(box.width), height: round(box.height) };
  }

  private walkLeaves(fn: (node: FakeNode) => void) {
    for (const child of this.children) {
      if (child.type === "GROUP") child.walkLeaves(fn);
      else fn(child);
    }
  }

  // ─── Auto-layout ─────────────────────────────────────────────────────────

  hasAutoLayout(): boolean {
    return this.store.layoutMode === "HORIZONTAL" || this.store.layoutMode === "VERTICAL";
  }

  private inFlow(): boolean {
    return !!this.parent && this.parent.hasAutoLayout() && this.store.positioning !== "ABSOLUTE";
  }

  private setLayoutMode(mode: string) {
    const had = this.hasAutoLayout();
    this.store.layoutMode = mode;
    if (!had && this.hasAutoLayout()) {
      this.store.primarySizing = "AUTO";
      this.store.counterSizing = "FIXED";
    }
    this.relayout();
  }

  private setPositioning(value: string) {
    if (value === "ABSOLUTE" && !(this.parent && this.parent.hasAutoLayout())) {
      throw new Error("in set_layoutPositioning: ABSOLUTE can only be set on children of auto-layout frames");
    }
    this.store.positioning = value;
    this.parentChanged();
  }

  private isPrimary(axis: "h" | "v"): boolean {
    return (this.store.layoutMode === "HORIZONTAL") === (axis === "h");
  }

  private axisSizing(axis: "h" | "v"): Axis {
    const s = this.store;
    if (this.type === "TEXT") {
      if (s.sizing[axis] === "FILL") return "FILL";
      if (s.autoResize === "WIDTH_AND_HEIGHT" || (s.autoResize === "HEIGHT" && axis === "v")) return "HUG";
      return "FIXED";
    }
    if (this.hasAutoLayout() && (this.isPrimary(axis) ? s.primarySizing : s.counterSizing) === "AUTO") return "HUG";
    return s.sizing[axis] === "FILL" ? "FILL" : "FIXED";
  }

  private setAxisSizing(axis: "h" | "v", value: Axis) {
    const where = `in set_layoutSizing${axis === "h" ? "Horizontal" : "Vertical"}`;
    if (value === "FILL" && !(this.parent && this.parent.hasAutoLayout())) {
      throw new Error(`${where}: FILL can only be set on children of auto-layout frames`);
    }
    if (value === "HUG" && this.type !== "TEXT" && !this.hasAutoLayout()) {
      throw new Error(`${where}: HUG can only be set on auto-layout frames and text nodes`);
    }
    const s = this.store;
    s.sizing[axis] = value;
    if (this.type === "TEXT") {
      this.requireFonts("layoutSizing");
      if (axis === "h") {
        if (value === "HUG") s.autoResize = "WIDTH_AND_HEIGHT";
        else if (s.autoResize === "WIDTH_AND_HEIGHT") s.autoResize = "HEIGHT";
      } else if (value === "HUG") {
        if (s.autoResize === "NONE") s.autoResize = "HEIGHT";
      } else if (s.autoResize !== "NONE") {
        s.autoResize = "NONE";
      }
      this.reflow();
    } else if (this.hasAutoLayout()) {
      const mode = value === "HUG" ? "AUTO" : "FIXED";
      if (this.isPrimary(axis)) s.primarySizing = mode;
      else s.counterSizing = mode;
      this.relayout();
    }
    this.parentChanged();
  }

  private childrenChanged() {
    this.relayout();
    if (this.type === "GROUP") this.parentChanged();
  }

  parentChanged() {
    if (this.parent) this.parent.relayout();
  }

  private resized(dw: number, dh: number) {
    if (dw === 0 && dh === 0) return;
    // Children that keep a constraint react to the new size.
    for (const child of this.children) {
      if (!this.hasAutoLayout() || child.store.positioning === "ABSOLUTE") child.applyConstraints(dw, dh);
    }
    this.relayout();
    this.parentChanged();
  }

  private applyConstraints(dw: number, dh: number) {
    if (this.type === "GROUP") {
      this.children.forEach((child) => child.applyConstraints(dw, dh));
      return;
    }
    const constraints = (this as any).constraints as Constraints;
    const shift = (value: string, delta: number) => (value === "MAX" ? delta : value === "CENTER" ? delta / 2 : 0);
    this.store.x += shift(constraints.horizontal, dw);
    this.store.y += shift(constraints.vertical, dh);
    if (constraints.horizontal === "STRETCH") this.store.w += dw;
    if (constraints.vertical === "STRETCH") this.store.h += dh;
  }

  private laying = false;

  /** Hug, fill and place the flow children, as auto-layout does (no wrap). */
  relayout() {
    if (!this.hasAutoLayout() || this.laying) return;
    this.laying = true;
    const s = this.store;
    const oldW = s.w;
    const oldH = s.h;
    try {
      const horizontal = s.layoutMode === "HORIZONTAL";
      const main = horizontal ? "h" : "v";
      const cross = horizontal ? "v" : "h";
      const flow = this.children.filter((child) => child.store.positioning !== "ABSOLUTE" && (child as any).visible !== false);
      const padMain = horizontal ? [s.paddingLeft, s.paddingRight] : [s.paddingTop, s.paddingBottom];
      const padCross = horizontal ? [s.paddingTop, s.paddingBottom] : [s.paddingLeft, s.paddingRight];
      const mainOf = (node: FakeNode) => (horizontal ? node.localBox().width : node.localBox().height);
      const crossOf = (node: FakeNode) => (horizontal ? node.localBox().height : node.localBox().width);
      const spacing = flow.length > 1 ? s.itemSpacing * (flow.length - 1) : 0;
      const setMain = (node: FakeNode, v: number) => (horizontal ? (node.store.w = v) : (node.store.h = v));
      const setCross = (node: FakeNode, v: number) => (horizontal ? (node.store.h = v) : (node.store.w = v));

      if (s.primarySizing === "AUTO") {
        setMain(this, Math.max(0.01, padMain[0] + padMain[1] + spacing + flow.reduce((sum, c) => sum + mainOf(c), 0)));
      }
      if (s.counterSizing === "AUTO") {
        const sizes = flow.filter((c) => c.store.sizing[cross] !== "FILL").map(crossOf);
        setCross(this, Math.max(0.01, padCross[0] + padCross[1] + Math.max(0, ...sizes)));
      }
      const innerMain = (horizontal ? s.w : s.h) - padMain[0] - padMain[1];
      const innerCross = (horizontal ? s.h : s.w) - padCross[0] - padCross[1];

      // FILL children share what is left on the main axis and stretch across it.
      const filling = flow.filter((c) => c.store.sizing[main] === "FILL");
      const taken = flow.filter((c) => c.store.sizing[main] !== "FILL").reduce((sum, c) => sum + mainOf(c), 0);
      const share = filling.length > 0 ? Math.max(0.01, (innerMain - spacing - taken) / filling.length) : 0;
      for (const child of flow) {
        if (child.type === "GROUP") continue;
        if (child.store.sizing[main] === "FILL") setMain(child, share);
        if (child.store.sizing[cross] === "FILL") setCross(child, Math.max(0.01, innerCross));
        if (child.type === "TEXT") child.reflow(false);
        child.relayout();
      }

      const used = flow.reduce((sum, c) => sum + mainOf(c), 0);
      let cursor = padMain[0];
      let gap = s.itemSpacing;
      if (s.primaryAxisAlignItems === "CENTER") cursor += (innerMain - used - spacing) / 2;
      else if (s.primaryAxisAlignItems === "MAX") cursor += innerMain - used - spacing;
      else if (s.primaryAxisAlignItems === "SPACE_BETWEEN" && flow.length > 1) gap = (innerMain - used) / (flow.length - 1);
      for (const child of flow) {
        let crossPos = padCross[0];
        if (s.counterAxisAlignItems === "CENTER") crossPos += (innerCross - crossOf(child)) / 2;
        else if (s.counterAxisAlignItems === "MAX") crossPos += innerCross - crossOf(child);
        const box = child.localBox();
        const dx = (horizontal ? cursor : crossPos) - box.x;
        const dy = (horizontal ? crossPos : cursor) - box.y;
        if (child.type === "GROUP") {
          child.walkLeaves((leaf) => {
            leaf.store.x += dx;
            leaf.store.y += dy;
          });
        } else {
          child.store.x += dx;
          child.store.y += dy;
        }
        cursor += mainOf(child) + gap;
      }
    } finally {
      this.laying = false;
    }
    if (s.w !== oldW || s.h !== oldH) {
      for (const child of this.children) {
        if (child.store.positioning === "ABSOLUTE") child.applyConstraints(s.w - oldW, s.h - oldH);
      }
      this.parentChanged();
    }
  }

  // ─── Text ────────────────────────────────────────────────────────────────

  private fontsInUse(): FontName[] {
    const s = this.store;
    return s.chars.length > 0 ? this.rangeFonts(0, s.chars.length) : [s.fonts[0] ?? this.figma.defaultFont];
  }

  private rangeFonts(start: number, end: number): FontName[] {
    const seen = new Map<string, FontName>();
    for (const font of (this.store.fonts as FontName[]).slice(start, end)) seen.set(fontKey(font), font);
    return [...seen.values()];
  }

  private checkRange(name: string, start: number, end: number) {
    if (start < 0 || end > this.store.chars.length || end <= start) throw new Error(`in ${name}: Range outside of available characters`);
  }

  requireFonts(what: string, fonts: FontName[] = this.fontsInUse()) {
    for (const font of fonts) {
      if (!this.figma.loadedFonts.has(fontKey(font))) {
        throw new Error(
          `in set_${what}: Cannot write to node with unloaded font "${font.family} ${font.style}". ` +
          `Please call figma.loadFontAsync({ family: "${font.family}", style: "${font.style}" }) and await the returned promise first.`
        );
      }
    }
  }

  private fontNameOf(): FontName | symbol {
    const fonts = this.fontsInUse();
    return fonts.length === 1 ? { ...fonts[0] } : MIXED;
  }

  private setFontName(font: FontName) {
    this.requireFonts("fontName", [font]);
    const s = this.store;
    s.fonts = s.chars.length > 0 ? s.chars.split("").map(() => ({ ...font })) : [{ ...font }];
    this.reflow();
  }

  private setCharacters(value: string) {
    this.requireFonts("characters");
    const s = this.store;
    const font = s.fonts[0] ?? this.figma.defaultFont;
    s.chars = value;
    s.fonts = value.length > 0 ? value.split("").map(() => ({ ...font })) : [{ ...font }];
    this.reflow();
  }

  /** Text size from its characters: 0.6 em per character, 1.2 em per line. */
  reflow(notify = true) {
    if (this.type !== "TEXT") return;
    const s = this.store;
    const size = s.fontSize;
    const lineWidth = s.chars.length * size * 0.6;
    const oldW = s.w;
    const oldH = s.h;
    if (s.autoResize === "WIDTH_AND_HEIGHT") {
      s.w = Math.max(lineWidth, 0.01);
      s.h = size * 1.2;
    } else if (s.autoResize === "HEIGHT") {
      s.h = Math.max(1, Math.ceil(lineWidth / Math.max(s.w, 0.01))) * size * 1.2;
    }
    if (notify && (s.w !== oldW || s.h !== oldH)) this.parentChanged();
  }
}

export interface FakeFigmaOptions {
  /** Fonts Figma lists and can load. */
  fonts?: FontName[];
  /** Image hashes the file has. */
  images?: string[];
}

export class FakeFigma {
  readonly mixed = MIXED;
  readonly loadedFonts = new Set<string>();
  readonly defaultFont: FontName = { family: "Inter", style: "Regular" };
  /** Everything the plugin posted to its UI (results and progress). */
  readonly messages: unknown[] = [];
  readonly nodes = new Map<string, FakeNode>();
  readonly root: { children: FakeNode[]; getPluginData: () => string; setPluginData: () => void };
  readonly currentPage: FakeNode;
  readonly ui = {
    postMessage: (message: unknown) => {
      this.messages.push(message);
    },
    onmessage: null as unknown,
  };
  readonly clientStorage = { getAsync: async () => undefined, setAsync: async () => undefined };
  private nextId = 1;
  private readonly fonts: FontName[];
  private readonly images: Set<string>;

  constructor(options: FakeFigmaOptions = {}) {
    this.fonts = options.fonts ?? [];
    this.images = new Set(options.images ?? []);
    this.currentPage = this.create("PAGE");
    this.currentPage.name = "Page 1";
    this.root = { children: [this.currentPage], getPluginData: () => "", setPluginData: () => {} };
  }

  create(type: string, id?: string): FakeNode {
    const node = new FakeNode(this, type, id ?? `${this.nextId++}:1`);
    this.nodes.set(node.id, node);
    return node;
  }

  /**
   * Put a node into the document, optionally under a fixed ID. Typed `any`
   * because each node type has its own API surface (see FakeNode.install).
   */
  add(type: string, parent: FakeNode, props: Record<string, unknown> = {}, id?: string): any {
    const node = this.create(type, id);
    (parent as any).appendChild(node);
    for (const [key, value] of Object.entries(props)) (node as any)[key] = value;
    return node;
  }

  /** Every node below `root`, depth first. */
  descendants(root: FakeNode = this.currentPage): FakeNode[] {
    return root.children.flatMap((child) => [child, ...this.descendants(child)]);
  }

  // ─── The Plugin API surface that code.js uses ────────────────────────────

  showUI() {}
  on() {}
  notify() {}
  closePlugin() {}

  private made(type: string): FakeNode {
    const node = this.create(type);
    (this.currentPage as any).appendChild(node);
    return node;
  }

  createFrame = () => this.made("FRAME");
  createComponent = () => this.made("COMPONENT");
  createRectangle = () => this.made("RECTANGLE");
  createEllipse = () => this.made("ELLIPSE");
  createLine = () => this.made("LINE");
  createText = () => this.made("TEXT");

  createNodeFromSvg = (svg: string) => {
    if (!/^\s*<svg[\s\S]*<\/svg>\s*$/.test(svg)) throw new Error("in createNodeFromSvg: Failed to convert SVG file");
    const frame = this.made("FRAME");
    (frame as any).fills = [];
    (frame as any).appendChild(this.create("VECTOR"));
    return frame;
  };

  group = (nodes: FakeNode[], parent: FakeNode) => {
    if (nodes.length === 0) throw new Error("in group: First argument must be an array of at least one node");
    const group = this.create("GROUP");
    (parent as any).appendChild(group);
    for (const node of nodes) (group as any).appendChild(node);
    return group;
  };

  getNodeByIdAsync = async (id: string) => {
    const node = this.nodes.get(id);
    return node && !node.removed ? node : null;
  };

  getImageByHash = (hash: string) => (this.images.has(hash) ? { hash } : null);

  loadFontAsync = async (font: FontName) => {
    if (!this.fonts.some((f) => fontKey(f) === fontKey(font))) {
      throw new Error(`The font "${font.family} ${font.style}" could not be loaded`);
    }
    this.loadedFonts.add(fontKey(font));
  };

  listAvailableFontsAsync = async () => this.fonts.map((fontName) => ({ fontName: { ...fontName } }));
}
