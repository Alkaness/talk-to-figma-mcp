/**
 * Tools that create_node_tree and update_nodes cover completely. They stay
 * registered for now, and their descriptions name the replacement, so agents
 * move to the node-tree tools before these are removed. Each value is the
 * replacement as the description states it.
 */
export const DEPRECATED_TOOLS: Record<string, string> = {
  set_fill_color: 'update_nodes with fills: ["#RRGGBB"]',
  set_stroke_color: "update_nodes with strokes and strokeWeight",
  set_gradient: 'update_nodes with fills: [{ type: "GRADIENT_LINEAR", gradientStops, gradientTransform }]',
  set_effects: "update_nodes with effects",
  set_auto_layout: "update_nodes with layoutMode, padding, itemSpacing and the alignment fields",
  move_node: "update_nodes with x and y",
  resize_node: "update_nodes with width and height",
  rename_node: "update_nodes with name",
  set_node_properties: "update_nodes with visible, locked and opacity",
  set_corner_radius: "update_nodes with cornerRadius, or rectangleCornerRadii [topLeft, topRight, bottomRight, bottomLeft] with null for the corners to keep",
  set_font_name: "update_nodes with style: { fontFamily, fontStyle }",
  set_font_weight: "update_nodes with style: { fontWeight }",
  set_font_size: "update_nodes with style: { fontSize }",
  set_line_height: 'update_nodes with style: { lineHeightPx }, { lineHeightPercentFontSize } or { lineHeightUnit: "INTRINSIC_%" }',
  set_paragraph_spacing: "update_nodes with style: { paragraphSpacing }",
  set_text_align: "update_nodes with style: { textAlignHorizontal, textAlignVertical }",
  set_text_case: "update_nodes with style: { textCase }",
  set_text_decoration: "update_nodes with style: { textDecoration }",
  set_text_content: "update_nodes with characters",
  set_multiple_text_contents: "update_nodes with one { nodeId, characters } per text node",
  create_frame: "create_node_tree",
  create_rectangle: "create_node_tree",
  create_ellipse: "create_node_tree",
  create_text: "create_node_tree",
};

/** A deprecated tool's description, prefixed with its replacement. */
export function deprecated(tool: keyof typeof DEPRECATED_TOOLS, description: string): string {
  const replacement = DEPRECATED_TOOLS[tool];
  if (!replacement) throw new Error(`${tool} is not in DEPRECATED_TOOLS`);
  return `Deprecated: use ${replacement}. ${description}`;
}
