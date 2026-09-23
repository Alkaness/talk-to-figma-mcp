/**
 * Nodes in the REST format (the plugin's JSON_REST_V1 export and the REST API
 * return the same shape) for the node-filter tests. Each function returns a
 * fresh object, so tests can check that the filter does not modify its input.
 */

const rgba = (r: number, g: number, b: number, a = 1) => ({ r, g, b, a });

/**
 * A pricing card that exercises every rule of filterFigmaNode: an auto-layout
 * parent, a FILL text with textCase, a mixed-style text, an absolute badge,
 * an icon instance with a VECTOR, a hidden text, an image fill, top-only
 * radii, an inside stroke, a shadow, and hidden paints and effects.
 */
export function pricingCardNode(): any {
  return {
    id: "10:1",
    name: "Pricing card",
    type: "FRAME",
    blendMode: "PASS_THROUGH",
    opacity: 0.9599999785423279,
    clipsContent: true,
    absoluteBoundingBox: { x: 1200, y: 840, width: 360, height: 420 },
    layoutMode: "VERTICAL",
    primaryAxisSizingMode: "AUTO",
    counterAxisSizingMode: "FIXED",
    primaryAxisAlignItems: "MIN",
    counterAxisAlignItems: "CENTER",
    itemSpacing: 16,
    paddingTop: 32,
    paddingBottom: 32,
    paddingLeft: 24,
    paddingRight: 24,
    layoutSizingHorizontal: "FIXED",
    layoutSizingVertical: "HUG",
    rectangleCornerRadii: [16, 16, 0, 0],
    strokeWeight: 1,
    strokeAlign: "INSIDE",
    fills: [{ blendMode: "NORMAL", type: "SOLID", color: rgba(1, 1, 1) }],
    strokes: [{ blendMode: "NORMAL", type: "SOLID", color: rgba(0.898, 0.906, 0.922) }],
    effects: [
      { type: "DROP_SHADOW", visible: true, color: rgba(0, 0, 0, 0.08), offset: { x: 0, y: 8 }, radius: 24, spread: -4, blendMode: "NORMAL", showShadowBehindNode: false },
      { type: "INNER_SHADOW", visible: false, color: rgba(0, 0, 0, 0.5), offset: { x: 0, y: 1 }, radius: 2, spread: 0, blendMode: "NORMAL" },
    ],
    children: [
      {
        id: "10:2",
        name: "Plan",
        type: "TEXT",
        absoluteBoundingBox: { x: 1223.9999923706055, y: 872.0000076293945, width: 312, height: 21 },
        layoutAlign: "STRETCH",
        layoutGrow: 0,
        layoutSizingHorizontal: "FILL",
        layoutSizingVertical: "HUG",
        characters: "Pro",
        fills: [{ blendMode: "NORMAL", type: "SOLID", color: rgba(0.31, 0.27, 0.9) }],
        style: {
          fontFamily: "Inter",
          fontPostScriptName: "Inter-SemiBold",
          fontStyle: "Semi Bold",
          fontWeight: 600,
          fontSize: 14,
          italic: false,
          textCase: "UPPER",
          textDecoration: "NONE",
          textAlignHorizontal: "LEFT",
          textAlignVertical: "TOP",
          letterSpacing: 1.2,
          lineHeightPx: 21,
          lineHeightPercentFontSize: 150,
          lineHeightUnit: "FONT_SIZE_%",
          textAutoResize: "HEIGHT",
        },
        characterStyleOverrides: [],
        styleOverrideTable: {},
      },
      {
        id: "10:3",
        name: "Price",
        type: "TEXT",
        absoluteBoundingBox: { x: 1224, y: 909, width: 312, height: 58 },
        layoutSizingHorizontal: "FILL",
        layoutSizingVertical: "HUG",
        characters: "$29 /month",
        fills: [{ blendMode: "NORMAL", type: "SOLID", color: rgba(0.42, 0.447, 0.502) }],
        style: {
          fontFamily: "Inter",
          fontStyle: "Regular",
          fontWeight: 400,
          fontSize: 16,
          textAlignHorizontal: "LEFT",
          letterSpacing: 0.16,
          lineHeightPx: 58.09090805053711,
          lineHeightUnit: "INTRINSIC_%",
          textAutoResize: "HEIGHT",
        },
        // "$29" uses override 1. The REST format omits trailing 0 entries, so
        // " /month" has no entries and uses the base style.
        characterStyleOverrides: [1, 1, 1],
        styleOverrideTable: {
          "1": {
            fontStyle: "Bold",
            fontWeight: 700,
            fontSize: 48,
            letterSpacing: 0,
            fills: [{ blendMode: "NORMAL", type: "SOLID", color: rgba(0.067, 0.094, 0.153) }],
          },
        },
      },
      {
        id: "10:4",
        name: "Badge",
        type: "FRAME",
        layoutPositioning: "ABSOLUTE",
        constraints: { vertical: "TOP", horizontal: "RIGHT" },
        absoluteBoundingBox: { x: 1480, y: 852, width: 64, height: 24 },
        cornerRadius: 12,
        fills: [{ blendMode: "NORMAL", type: "SOLID", color: rgba(1, 0.93, 0.8) }],
        children: [],
      },
      {
        id: "10:5",
        name: "Icon/check",
        type: "INSTANCE",
        componentId: "3:9",
        constraints: { vertical: "TOP", horizontal: "LEFT" },
        absoluteBoundingBox: { x: 1224, y: 983, width: 20, height: 20 },
        children: [
          {
            id: "I10:5;3:10",
            name: "Vector",
            type: "VECTOR",
            absoluteBoundingBox: { x: 1227, y: 987, width: 14, height: 11 },
            strokes: [{ blendMode: "NORMAL", type: "SOLID", color: rgba(0.13, 0.77, 0.37) }],
            strokeWeight: 2,
            strokeCap: "ROUND",
            fills: [],
          },
        ],
      },
      {
        id: "10:6",
        name: "Old price",
        type: "TEXT",
        visible: false,
        absoluteBoundingBox: { x: 1224, y: 1019, width: 80, height: 19 },
        characters: "$49",
        fills: [{ blendMode: "NORMAL", type: "SOLID", color: rgba(0.6, 0.6, 0.6) }],
        style: { fontFamily: "Inter", fontWeight: 400, fontSize: 16, textDecoration: "STRIKETHROUGH" },
      },
      {
        id: "10:7",
        name: "Photo",
        type: "RECTANGLE",
        absoluteBoundingBox: { x: 1224, y: 1054, width: 312, height: 120 },
        strokeWeight: 1,
        strokes: [{ blendMode: "NORMAL", type: "SOLID", visible: false, color: rgba(0, 0, 0) }],
        fills: [
          { blendMode: "NORMAL", type: "SOLID", visible: false, color: rgba(0.5, 0.5, 0.5) },
          { blendMode: "NORMAL", type: "IMAGE", scaleMode: "FILL", imageRef: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678" },
        ],
      },
    ],
  };
}

/** A single VECTOR node, as returned when get_node_info targets an icon path. */
export function vectorNode(): any {
  return {
    id: "20:1",
    name: "Arrow",
    type: "VECTOR",
    absoluteBoundingBox: { x: 10, y: 20, width: 16, height: 16 },
    fills: [{ blendMode: "NORMAL", type: "SOLID", color: rgba(0, 0, 0) }],
  };
}
