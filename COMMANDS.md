# Command Reference

[README](README.md) · [Installation](INSTALLATION.md) · [Commands](COMMANDS.md) · [Troubleshooting](TROUBLESHOOTING.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)

This document lists every tool, prompt and resource the MCP server registers. It is kept in sync with `src/talk_to_figma_mcp/tools/*-tools.ts`, `prompts/index.ts` and `resources/index.ts`.

Tool calls are routed to the connected Figma plugin automatically. `join_channel` is only needed when more than one Figma file is connected at the same time.

## 1. Summary

| Section | Tools | Source file |
|---|---:|---|
| 2. Document and pages | 17 | `document-tools.ts` |
| 3. Node trees | 2 | `node-tree-tools.ts` |
| 4. Creation | 12 | `creation-tools.ts` |
| 5. Modification | 24 | `modification-tools.ts` |
| 6. Text | 15 | `text-tools.ts` |
| 7. Styles | 3 | `style-tools.ts` |
| 8. Variables | 4 | `variable-tools.ts` |
| 9. Components and prototyping | 7 | `component-tools.ts` |
| 10. Images and assets | 8 | `image-tools.ts` |
| 11. Asset export | 2 | `asset-tools.ts` |
| 12. SVG | 2 | `svg-tools.ts` |
| 13. Verification | 2 | `verify-tools.ts` |
| 14. FigJam | 6 | `figjam-tools.ts` |
| 15. REST API (requires a token) | 5 | `rest-tools.ts` |
| **Total** | **109** | |

104 tools communicate with the Figma plugin. The 5 REST API tools call the Figma REST API directly and are registered only when a personal access token is configured. The server also provides 5 prompts (section 16) and 2 resources (section 17).

## 2. Document and pages (17)

| Tool | Description |
|---|---|
| `get_document_info` | Returns detailed information about the current document. |
| `get_selection` | Returns information about the current selection. |
| `get_node_info` | Returns one node and its subtree: auto-layout and child sizing, absolute positioning, visibility, clipping, opacity, fills, strokes, corner radii, effects, and the full text style with `textRuns` for mixed-style text. Includes `absoluteBoundingBox`, `localPosition` and `parentOffset`; `rotation` is in degrees. Values equal to Figma's defaults are omitted. Accepts a `depth` limit (default 1). The result is a valid `create_node_tree` spec. |
| `get_nodes_info` | Returns several nodes in the same format as `get_node_info`, exported in batches of 5. Accepts a `depth` limit. |
| `get_css` | Returns Figma's computed Dev Mode CSS for a node: sizing, padding, colors, gradients, radius, shadows and typography. Defaults to the selection; `recursive=true` covers the subtree. |
| `get_styles` | Returns all local styles in the document. |
| `get_local_components` | Returns all local components. |
| `get_remote_components` | Returns components available from team libraries. |
| `scan_text_nodes` | Returns every text node inside the given node. |
| `export_node_as_image` | Exports a node as PNG, JPG, SVG or PDF. PDF output is written to `figma-assets/` and returned as a path. |
| `join_channel` | Targets a specific plugin channel. Needed only when several Figma files are connected. |
| `get_pages` | Lists all pages in the document. |
| `create_page` | Creates a page. |
| `delete_page` | Deletes a page. |
| `rename_page` | Renames a page. |
| `duplicate_page` | Duplicates a page with all of its contents. |
| `set_current_page` | Deprecated and blocked by the relay. Pass the page ID as `parentId` on creation commands instead; use `get_pages` to find page IDs. |

## 3. Node trees (2)

These tools take the format that `get_node_info` returns, so an agent writes in the same format it reads: a `get_node_info` result, edited or not, is a valid spec. One call replaces a chain of single-property calls, and sets properties that no other tool sets: FILL and HUG sizing, absolute positioning, constraints, stroke alignment, per-corner radii, fonts by family and weight, and mixed-style text runs.

| Tool | Description |
|---|---|
| `create_node_tree` | Builds a node and its whole subtree under `parentId`, optionally at `index`. Returns the ID of every created node, keyed by the node's `key`, else its source `id`, else its path (`tree.children[0]`), and a warning for each property that was not applied. |
| `update_nodes` | Changes the given properties of several existing nodes. Each update is `{ nodeId, ...fields }`. Returns a result per node and the warnings. |

1. **Fields.** The fields are those of `get_node_info` output, plus `key`, `width`, `height`, `x`, `y` and `svg`. Colors are hex strings (`"#0F172A"`, or `"#0F172A80"` with alpha) or `{ r, g, b, a }`. `rotation` is in degrees.
2. **Omitted fields** mean what they mean in `get_node_info` output: new frames, rectangles and ellipses have no fill, and frames do not clip. Text without fills is black; text without `fontFamily` uses Inter.
3. **Fonts** are resolved against the fonts Figma has. `fontWeight` selects the family's own style name (Inter "Semi Bold", Poppins "SemiBold"). When the exact weight is missing, the closest one is used and a warning names it. A `fontStyle` the family lacks is an error that lists the available styles.
4. **Position.** Children of an auto-layout frame are placed by the layout. `x` and `y` apply outside auto-layout and to children with `layoutPositioning: "ABSOLUTE"`.
5. **Other node types.** `VECTOR`, `BOOLEAN_OPERATION`, `STAR` and other types without a builder take `svg` with their markup, or are cloned when `id` names a node in the same file. An `INSTANCE` is cloned from its source when the source exists, which keeps its overrides; otherwise it is created from `componentId`.
6. **Errors.** A spec is validated before anything is created, and each error names its path, for example `at tree.children[2] ("Badge"): ...`. If building fails partway, the partly built subtree is removed.
7. **Truncated input.** `get_node_info` output cut off by its `depth` limit is rejected; read the node again with a larger depth. Hidden layers below the root are returned by `get_node_info` as stubs, and are skipped with a warning.

## 4. Creation (12)

All creation tools require `parentId`. See section 18.

| Tool | Description |
|---|---|
| `create_rectangle` | Creates a rectangle. |
| `create_frame` | Creates a frame. |
| `create_text` | Creates a text node in Inter. Accepts a fixed `width` for wrapping. For other fonts, use `create_node_tree`. |
| `create_ellipse` | Creates an ellipse. |
| `create_polygon` | Creates a polygon. |
| `create_star` | Creates a star. |
| `group_nodes` | Groups nodes. |
| `ungroup_nodes` | Ungroups a group. |
| `clone_node` | Clones a node into the given parent. |
| `insert_child` | Moves a node into a new parent. |
| `flatten_node` | Flattens a node into a single vector. |
| `boolean_operation` | Applies union, subtract, intersect or exclude to two or more nodes with the same parent. |

## 5. Modification (24)

| Tool | Description |
|---|---|
| `set_fill_color` | Sets a solid fill. Alpha defaults to 1; alpha 0 is fully transparent. |
| `set_stroke_color` | Sets the stroke color. Defaults: opacity 1, weight 1. A weight of 0 is allowed. |
| `set_selection_colors` | Recolors every fill and stroke in a node and its descendants, like Figma's "Selection colors". |
| `set_gradient` | Sets a linear, radial, angular or diamond gradient. Replaces existing fills. |
| `set_image` | Sets an image fill from base64 data (PNG, JPEG, GIF, WebP; about 5 MB maximum after decoding). |
| `move_node` | Moves a node. Coordinates are local to the parent. |
| `resize_node` | Resizes a node. |
| `rotate_node` | Rotates a node clockwise by degrees. `relative=true` adds to the current rotation. |
| `reorder_node` | Changes the layer order of a node within its parent. |
| `delete_node` | Deletes a node. |
| `rename_node` | Renames a node. |
| `set_node_properties` | Sets visibility, lock state and opacity. Omitted properties are unchanged. |
| `convert_to_frame` | Converts a group or shape into a frame, keeping position, size, styling and children. |
| `set_corner_radius` | Sets corner radius, per corner if needed. |
| `set_auto_layout` | Configures auto layout. |
| `set_effects` | Sets shadows and blurs. |
| `set_effect_style_id` | Applies an effect style. |
| `set_grid` | Applies column, row or grid layout grids to a frame. |
| `get_grid` | Reads the layout grids of a frame. |
| `set_guide` | Replaces all guides on a page. |
| `get_guide` | Reads the guides on a page. |
| `set_annotation` | Adds an annotation label. Uses the proposed Annotations API (Figma Desktop only). |
| `get_annotation` | Reads the annotations on a node. |
| `batch_operations` | Runs many `{ command, params }` plugin commands in one call and returns a result per operation, with the IDs of the nodes it created. Parameters use the plugin's own shape, which can differ from the tool of the same name. |

## 6. Text (15)

| Tool | Description |
|---|---|
| `set_text_content` | Replaces the text of a text node. |
| `set_multiple_text_contents` | Replaces the text of several text nodes in one call. |
| `set_font_name` | Sets font family and style. |
| `set_font_size` | Sets font size. |
| `set_font_weight` | Sets font weight. |
| `set_letter_spacing` | Sets letter spacing. |
| `set_line_height` | Sets line height. |
| `set_paragraph_spacing` | Sets paragraph spacing. |
| `set_text_case` | Sets text case. |
| `set_text_decoration` | Sets text decoration. |
| `set_text_align` | Sets horizontal and vertical alignment. Use `RIGHT` for right-to-left text. |
| `set_text_style_id` | Applies a text style. |
| `get_styled_text_segments` | Returns the styled segments of a text node. |
| `get_fonts_used` | Lists every font family, style and size used in a subtree, with occurrence counts. Defaults to the selection. |
| `load_font_async` | Loads a font so it can be used. |

## 7. Styles (3)

| Tool | Description |
|---|---|
| `create_text_style` | Creates a local text style. |
| `create_paint_style` | Creates a local solid paint style. |
| `create_effect_style` | Creates a local effect style (shadows, blurs). |

## 8. Variables (4)

| Tool | Description |
|---|---|
| `get_variables` | Lists all variable collections with their modes and variables. |
| `set_variable` | Creates or updates a variable, creating the collection if needed. |
| `apply_variable_to_node` | Binds a variable to one node property. Call once per property. |
| `switch_variable_mode` | Sets which mode of a collection a node uses. |

## 9. Components and prototyping (7)

| Tool | Description |
|---|---|
| `create_component_instance` | Creates an instance of a component. |
| `create_component_from_node` | Converts a frame, group or other node into a component. |
| `create_component_set` | Combines several components into a variant set. |
| `set_instance_variant` | Changes an instance's variant properties while keeping its overrides. |
| `detach_instance` | Detaches an instance into a regular frame. |
| `set_reactions` | Sets prototype interactions (for example hover or click) on a node. |
| `get_reactions` | Reads the prototype interactions on a node. |

## 10. Images and assets (8)

| Tool | Description |
|---|---|
| `get_visual_snapshot` | Returns a PNG of the selection or a node so the agent can inspect layout, spacing and fonts. Default scale 2x; large frames are scaled down. |
| `scan_assets` | Lists image fills (deduplicated by hash, with size and usage) and vector nodes in a subtree. Returns no image bytes. |
| `get_asset` | Saves one asset to a file: an image fill by `hash`, or a node export by `nodeId` (SVG by default, or PNG/JPG). Returns the path; SVG markup is also returned inline. Repeated hashes are served from a 64 MB in-memory cache. |
| `set_image_fill` | Applies an image fill from a URL or base64 data. |
| `get_image_from_node` | Returns image fill metadata for a node. |
| `replace_image_fill` | Replaces an image fill while keeping its transform. |
| `apply_image_transform` | Adjusts position, scale and rotation of the image inside a node. |
| `set_image_filters` | Applies color and light adjustments to image fills. |

## 11. Asset export (2)

| Tool | Description |
|---|---|
| `classify_asset` | Recommends raster PNG, inline SVG or pure CSS for a node, with reasons. |
| `extract_asset` | Exports a node without its effects (at the same resolution) and returns the effects as CSS (`box-shadow`, `filter`). Works on a temporary clone, so the document is not modified. |

## 12. SVG (2)

| Tool | Description |
|---|---|
| `set_svg` | Imports an SVG string as a vector node. Scripts and external resources are removed first. Maximum 500 KB. |
| `get_svg` | Exports a node and its children as SVG markup. |

## 13. Verification (2)

| Tool | Description |
|---|---|
| `compare_to_figma` | Compares an implemented UI with a Figma node. Takes either `renderPath` (a PNG) or `url` (captured headlessly at the node's exact size). Reports SSIM similarity, color difference, a 3×3 region map, edge overflow and an optional brand-color check, and writes a diff heatmap PNG. |
| `capture_render` | Captures a local URL with headless Chromium at an exact size and saves a PNG. Requires Chromium or Chrome; `CHROME_PATH` overrides the binary. |

## 14. FigJam (6)

| Tool | Description |
|---|---|
| `get_figjam_elements` | Returns all stickies, connectors, shapes with text, sections and stamps on the current page. |
| `create_sticky` | Creates a sticky note. |
| `set_sticky_text` | Replaces the text of a sticky note. |
| `create_shape_with_text` | Creates a shape with text. Shapes: `SQUARE`, `ELLIPSE`, `ROUNDED_RECTANGLE`, `DIAMOND`, `TRIANGLE_UP`, `TRIANGLE_DOWN`, `PARALLELOGRAM_RIGHT`, `PARALLELOGRAM_LEFT`. |
| `create_connector` | Creates an arrow or line between two nodes or two canvas positions. |
| `create_section` | Creates a section. |

## 15. REST API (5)

These tools are registered only when `FIGMA_PERSONAL_TOKEN` is set (see [Installation, section 5](INSTALLATION.md#5-optional-figma-personal-access-token)). They work without the plugin, on any file the token's owner can open, addressed by figma.com URL or file key. The REST API cannot edit document content; `rest_post_comment` is its only write operation.

| Tool | Description |
|---|---|
| `rest_whoami` | Returns the handle and email of the token's owner. |
| `rest_get_file` | Returns a file's node tree up to the requested depth, in the same format as `get_node_info`. |
| `rest_render_image` | Renders nodes to PNG, JPG or SVG on Figma's servers, saves them to disk and returns the first raster image inline. |
| `rest_get_comments` | Lists a file's comments with author, message, anchored node and resolved state. |
| `rest_post_comment` | Posts a comment or a reply, optionally anchored to a node. |

The token is read once from the environment, sent only in the `X-Figma-Token` header and removed from error messages. HTTP 429 responses are retried using `Retry-After` or exponential backoff.

## 16. MCP prompts (5)

| Prompt | Description |
|---|---|
| `design_strategy` | Best practices for creating and editing Figma designs. |
| `read_design_strategy` | Best practices for reading Figma designs. |
| `text_replacement_strategy` | A step-by-step method for replacing text across a design. |
| `audit-accessibility` | Audits the selection against WCAG AA: contrast, text size, 44 px touch targets and hierarchy. |
| `export-to-tailwind` | Converts the selection to HTML with Tailwind CSS classes. |

## 17. MCP resources (2)

| URI | Contents |
|---|---|
| `figma://local/selection` | The current selection (IDs, names, types), read live. |
| `figma://local/document` | The current page, the page list and the top-level children, read live. |

## 18. Rules for creation and layout

1. **`parentId` is required** on every creation command, including `create_node_tree`. Pass a page ID (from `get_pages`) or a frame ID. Several agents can edit the same file at once, so the server never relies on the "current page".
2. **Coordinates are local.** `move_node` and all creation tools use coordinates relative to the parent. `get_node_info` returns both:
   - `absoluteBoundingBox`: position relative to the canvas origin.
   - `localPosition`: position relative to the parent. Use this with `move_node`. It is returned for the requested node only.
   - `parentOffset`: returned for every child node. It is the position of the child's bounding box relative to its parent's bounding box, for CSS `left` and `top`. Inside a group it differs from the `move_node` coordinates, because the children of a group are positioned relative to the group's parent.

   ```
   Frame at (100, 50)
     Rectangle
       absoluteBoundingBox: { x: 150, y: 80 }   global
       localPosition:       { x: 50,  y: 30 }   get_node_info on the rectangle; use with move_node
       parentOffset:        { x: 50,  y: 30 }   get_node_info on the frame; use for CSS
   ```
3. **Build and edit in one call.** Use `create_node_tree` to build a subtree and `update_nodes` to change several nodes; both take the `get_node_info` format (section 3). `batch_operations` runs other plugin commands with the plugin's own parameter shapes.

## 19. Writing effective requests

Specific requests produce predictable results:

- "Create a dashboard with side navigation, a header with a user profile, and a main area with metric cards."
- "Redesign this button component with hover states and a contrast ratio of at least 4.5:1."
- "Find every text layer with contrast below 4.5:1 and propose compliant colors."

Requests without criteria, such as "make it pretty" or "improve the design", give the agent nothing to measure against.

Additional guidance:

1. Refer to existing elements by name ("like the button in the header") to keep results consistent.
2. Split large changes into several smaller requests.
3. Check that the intended element is selected before asking for a modification.
