/**
 * This module contains all the prompts used by the Figma MCP server.
 * Prompts provide guidance to Claude on how to work with Figma designs effectively.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * The example tree in the design_strategy prompt. Exported so a test can check
 * that it is a valid create_node_tree spec.
 */
export const DESIGN_STRATEGY_EXAMPLE = {
  type: "FRAME",
  name: "Login card",
  width: 400,
  layoutMode: "VERTICAL",
  itemSpacing: 16,
  paddingTop: 32,
  paddingRight: 32,
  paddingBottom: 32,
  paddingLeft: 32,
  primaryAxisSizingMode: "AUTO",
  counterAxisSizingMode: "FIXED",
  cornerRadius: 16,
  fills: ["#FFFFFF"],
  effects: [{ type: "DROP_SHADOW", color: "#0F172A1F", offset: { x: 0, y: 8 }, radius: 24 }],
  children: [
    {
      type: "TEXT",
      name: "Title",
      characters: "Welcome back",
      style: { fontFamily: "Inter", fontWeight: 700, fontSize: 24 },
      fills: ["#0F172A"],
      layoutSizingHorizontal: "FILL",
    },
    {
      type: "FRAME",
      name: "Email field",
      height: 44,
      layoutMode: "HORIZONTAL",
      counterAxisAlignItems: "CENTER",
      paddingLeft: 12,
      paddingRight: 12,
      cornerRadius: 8,
      strokes: ["#CBD5E1"],
      strokeWeight: 1,
      strokeAlign: "INSIDE",
      layoutSizingHorizontal: "FILL",
      layoutSizingVertical: "FIXED",
      children: [
        { type: "TEXT", name: "Placeholder", characters: "Email", style: { fontSize: 14 }, fills: ["#64748B"] },
      ],
    },
    {
      type: "FRAME",
      name: "Sign in button",
      key: "signIn",
      layoutMode: "HORIZONTAL",
      primaryAxisAlignItems: "CENTER",
      counterAxisAlignItems: "CENTER",
      paddingTop: 12,
      paddingBottom: 12,
      cornerRadius: 8,
      fills: ["#4F46E5"],
      layoutSizingHorizontal: "FILL",
      layoutSizingVertical: "HUG",
      children: [
        {
          type: "TEXT",
          name: "Label",
          characters: "Sign in",
          style: { fontFamily: "Inter", fontWeight: 600, fontSize: 16 },
          fills: ["#FFFFFF"],
        },
      ],
    },
  ],
};

/**
 * Register all prompts with the MCP server
 * @param server - The MCP server instance
 */
export function registerPrompts(server: McpServer): void {
  // Design Strategy Prompt
  server.registerPrompt(
    "design_strategy",
    {
      description:
        "Best practices for creating and changing Figma designs",
    },
    (_extra) => {
      return {
        messages: [
          {
            role: "assistant",
            content: {
              type: "text",
              text: `When creating or changing Figma designs, follow these practices:

1. Find the target:
   - Call get_pages or get_selection to find where to build, and pass that node ID as parentId.
   - To copy or adapt an existing design, read it with get_node_info and a depth that covers every level (for example 8). The result is a valid create_node_tree spec.

2. Build with auto-layout, in one call:
   - Describe the whole screen or component as one tree and create it with create_node_tree.
   - Give containers layoutMode (VERTICAL or HORIZONTAL), padding, itemSpacing and alignment instead of x/y positions.
   - Size children with layoutSizingHorizontal and layoutSizingVertical: FILL to stretch, HUG to fit the content, FIXED for a set size.
   - Use layoutPositioning ABSOLUTE only for overlays such as badges; x and y are then relative to the parent.
   - Give text its real font in style: fontFamily with fontStyle or fontWeight, fontSize, lineHeightPx, letterSpacing. Use textRuns for mixed styles within one text node.
   - Write colors as hex strings, for example "#0F172A", or "#0F172A80" with alpha.
   - Use semantic layer names ("Login card", "Email field"), and give a node a key when you need its ID afterwards.

3. Change existing nodes:
   - Use update_nodes to change several properties or several nodes at once.
   - Use set_text_content or set_multiple_text_contents to replace text only.

4. Check once, at the end:
   - Read the warnings in the result. Each one names a node and what was not applied.
   - Call get_visual_snapshot on the root, compare it with the intent, and fix differences with update_nodes.

Example create_node_tree tree for a login card:
${JSON.stringify(DESIGN_STRATEGY_EXAMPLE, null, 2)}`,
            },
          },
        ],
        description: "Best practices for creating and changing Figma designs",
      };
    }
  );

  // Read Design Strategy Prompt
  server.registerPrompt(
    "read_design_strategy",
    {
      description:
        "Best practices for reading Figma designs",
    },
    (_extra) => {
      return {
        messages: [
          {
            role: "assistant",
            content: {
              type: "text",
              text: `When reading Figma designs, follow these best practices:

1. Start with selection:
   - First use get_selection() to understand the current selection
   - If no selection ask user to select single or multiple nodes

2. Get node infos of the selected nodes:
   - Use get_nodes_info() to get the information of the selected nodes
   - If no selection ask user to select single or multiple nodes

3. Read deep enough:
   - get_node_info() and get_nodes_info() return one level of children by default
   - Pass a larger depth (for example 8) to read a whole card or section in one call
   - Children beyond the depth are id/name/type stubs, and their parent is marked _childrenTruncated

4. Read the layout from the properties, not from the coordinates:
   - Auto-layout frames carry layoutMode, padding, itemSpacing, alignment and sizing modes
   - Children carry layoutSizingHorizontal/Vertical (FIXED, HUG or FILL) and layoutPositioning
   - parentOffset is each node's position relative to its parent's bounding box
   - Nodes with visible: false are hidden in the design
   - Mixed-style text has textRuns; image fills have imageRef (pass it to get_asset as hash)

5. Write in the same format:
   - A get_node_info result, edited or not, is a valid create_node_tree spec, and update_nodes takes the same fields
`,
            },
          },
        ],
        description: "Best practices for reading Figma designs",
      };
    }
  );

  // Text Replacement Strategy Prompt
  server.registerPrompt(
    "text_replacement_strategy",
    {
      description:
        "Systematic approach for replacing text in Figma designs",
    },
    (_extra) => {
      return {
        messages: [
          {
            role: "assistant",
            content: {
              type: "text",
              text: `# Intelligent Text Replacement Strategy

## 1. Analyze Design & Identify Structure
- Scan text nodes to understand the overall structure of the design
- Use AI pattern recognition to identify logical groupings:
  * Tables (rows, columns, headers, cells)
  * Lists (items, headers, nested lists)
  * Card groups (similar cards with recurring text fields)
  * Forms (labels, input fields, validation text)
  * Navigation (menu items, breadcrumbs)
\`\`\`
scan_text_nodes(nodeId: "node-id")
get_node_info(nodeId: "node-id")  // optional
\`\`\`

## 2. Strategic Chunking for Complex Designs
- Divide replacement tasks into logical content chunks based on design structure
- Use one of these chunking strategies that best fits the design:
  * **Structural Chunking**: Table rows/columns, list sections, card groups
  * **Spatial Chunking**: Top-to-bottom, left-to-right in screen areas
  * **Semantic Chunking**: Content related to the same topic or functionality
  * **Component-Based Chunking**: Process similar component instances together

## 3. Progressive Replacement with Verification
- Create a safe copy of the node for text replacement
- Replace text chunk by chunk with continuous progress updates
- After each chunk is processed:
  * Export that section as a small, manageable image
  * Verify text fits properly and maintain design integrity
  * Fix issues before proceeding to the next chunk

\`\`\`
// Clone the node to create a safe copy
clone_node(nodeId: "selected-node-id", x: [new-x], y: [new-y])

// Replace text chunk by chunk
set_multiple_text_contents(
  nodeId: "parent-node-id", 
  text: [
    { nodeId: "node-id-1", text: "New text 1" },
    // More nodes in this chunk...
  ]
)

// Verify chunk with small, targeted image exports
export_node_as_image(nodeId: "chunk-node-id", format: "PNG", scale: 0.5)
\`\`\`

## 4. Intelligent Handling for Table Data
- For tabular content:
  * Process one row or column at a time
  * Maintain alignment and spacing between cells
  * Consider conditional formatting based on cell content
  * Preserve header/data relationships

## 5. Smart Text Adaptation
- Adaptively handle text based on container constraints:
  * Auto-detect space constraints and adjust text length
  * Apply line breaks at appropriate linguistic points
  * Maintain text hierarchy and emphasis
  * Consider font scaling for critical content that must fit

## 6. Progressive Feedback Loop
- Establish a continuous feedback loop during replacement:
  * Real-time progress updates (0-100%)
  * Small image exports after each chunk for verification
  * Issues identified early and resolved incrementally
  * Quick adjustments applied to subsequent chunks

## 7. Final Verification & Context-Aware QA
- After all chunks are processed:
  * Export the entire design at reduced scale for final verification
  * Check for cross-chunk consistency issues
  * Verify proper text flow between different sections
  * Ensure design harmony across the full composition

## 8. Chunk-Specific Export Scale Guidelines
- Scale exports appropriately based on chunk size:
  * Small chunks (1-5 elements): scale 1.0
  * Medium chunks (6-20 elements): scale 0.7
  * Large chunks (21-50 elements): scale 0.5
  * Very large chunks (50+ elements): scale 0.3
  * Full design verification: scale 0.2

## Sample Chunking Strategy for Common Design Types

### Tables
- Process by logical rows (5-10 rows per chunk)
- Alternative: Process by column for columnar analysis
- Tip: Always include header row in first chunk for reference

### Card Lists
- Group 3-5 similar cards per chunk
- Process entire cards to maintain internal consistency
- Verify text-to-image ratio within cards after each chunk

### Forms
- Group related fields (e.g., "Personal Information", "Payment Details")
- Process labels and input fields together
- Ensure validation messages and hints are updated with their fields

### Navigation & Menus
- Process hierarchical levels together (main menu, submenu)
- Respect information architecture relationships
- Verify menu fit and alignment after replacement

## Best Practices
- **Preserve Design Intent**: Always prioritize design integrity
- **Structural Consistency**: Maintain alignment, spacing, and hierarchy
- **Visual Feedback**: Verify each chunk visually before proceeding
- **Incremental Improvement**: Learn from each chunk to improve subsequent ones
- **Balance Automation & Control**: Let AI handle repetitive replacements but maintain oversight
- **Respect Content Relationships**: Keep related content consistent across chunks

Remember that text is never just text—it's a core design element that must work harmoniously with the overall composition. This chunk-based strategy allows you to methodically transform text while maintaining design integrity.`,
            },
          },
        ],
        description: "Systematic approach for replacing text in Figma designs",
      };
    }
  );

  // Accessibility Audit Prompt (/audit-accessibility)
  server.registerPrompt(
    "audit-accessibility",
    {
      description:
        "Audit the current Figma selection for accessibility issues (contrast, text size, touch targets, hierarchy)",
    },
    (_extra) => {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Perform an accessibility (WCAG) audit of the current Figma selection.

## Step 1 — Gather context
- Read the live selection resource (figma://local/selection), or call get_selection() if needed.
- If nothing is selected, ask the user to select a frame or screen, then stop.
- Capture a visual reference with get_visual_snapshot() so you can SEE colors, sizing, and layout — don't rely on JSON alone.
- Use get_node_info()/get_nodes_info() on the selection and scan_text_nodes() to enumerate text, and get_styled_text_segments() for per-segment font/color details.

## Step 2 — Check against WCAG 2.1 AA
For each issue, report the node name + id, the rule, the measured value, and a concrete fix.
1. **Color contrast** — text vs. its background: ≥ 4.5:1 for normal text, ≥ 3:1 for large text (≥ 24px, or ≥ 18.66px bold) and UI/graphical elements. Compute ratios from the actual fill colors.
2. **Text size & legibility** — flag body text below ~14–16px; check line-height and letter spacing aren't cramped.
3. **Touch targets** — interactive elements (buttons, inputs, icons) should be ≥ 44×44px.
4. **Hierarchy & semantics** — meaningful, non-generic layer names; logical heading order; clear focus/grouping.
5. **Non-text cues** — information not conveyed by color alone; images/icons have descriptive names (alt-text proxy).
6. **Spacing & density** — adequate spacing so targets and text don't collide.

## Step 3 — Report
Produce a prioritized list grouped by severity (Critical / Serious / Minor), each with: node, problem, measured vs. required, and the exact change (e.g. "darken text from #8A8A8A to #595959 for 4.6:1"). Offer to apply the fixes with the modify tools (set_fill_color, set_font_size, resize_node, etc.) if the user approves.`,
            },
          },
        ],
        description: "Accessibility (WCAG AA) audit of the current Figma selection",
      };
    }
  );

  // Export to Tailwind Prompt (/export-to-tailwind)
  server.registerPrompt(
    "export-to-tailwind",
    {
      description:
        "Convert the current Figma selection into clean HTML + Tailwind CSS markup",
    },
    (_extra) => {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Convert the current Figma selection into responsive HTML + Tailwind CSS.

## Step 1 — Read the design accurately
- Read figma://local/selection (or call get_selection()); if nothing is selected, ask the user to select a frame and stop.
- Call get_node_info()/get_nodes_info() with a depth that covers the whole selection (for example 8) to read the full node tree: sizes, positions, fills, strokes, corner radii, effects, and especially **auto-layout** (layoutMode, padding, itemSpacing, alignment, layoutSizingHorizontal/Vertical).
- Nodes marked \`visible: false\` are hidden in the design: do not render them.
- Text nodes carry their full style (font, weight, size, line-height, letter-spacing, textCase, textDecoration) and, for mixed-style text, \`textRuns\` with the per-range overrides.
- Call get_visual_snapshot() and use it as ground truth — verify your output matches what you SEE (placement and fonts), since JSON alone misses visual nuance.

## Step 2 — Map Figma → Tailwind
- **Auto-layout → flexbox**: HORIZONTAL → \`flex\`, VERTICAL → \`flex flex-col\`; itemSpacing → \`gap-*\`; padding → \`p-*\`/\`px-*\`/\`py-*\`; primary/counter axis alignment → \`justify-*\`/\`items-*\`.
- **Child sizing**: layoutSizingHorizontal/Vertical FILL along the parent's layout direction → \`flex-1\`, across it → \`self-stretch\`; HUG → size to content; FIXED → \`w-[Npx]\`/\`h-[Npx]\`.
- **Absolute children**: layoutPositioning ABSOLUTE → \`absolute\` at the node's parentOffset, with \`relative\` on the parent. Frames without layoutMode have no flex data: derive gaps and padding from the children's parentOffset and sizes.
- **Text runs and case**: render each \`textRuns\` entry as a \`<span>\` with its overrides; textCase UPPER → \`uppercase\`, LOWER → \`lowercase\`, TITLE → \`capitalize\`.
- **Assets**: image fills carry imageRef → save them with get_asset({ hash: imageRef }); VECTOR nodes → get_asset({ nodeId }) for the SVG.
- **Spacing/sizing**: snap px to the nearest Tailwind scale step (4px = 1 unit); use exact values via arbitrary syntax (\`w-[437px]\`) only when no close step exists.
- **Colors**: map fills/strokes to the closest Tailwind palette token; fall back to arbitrary \`bg-[#RRGGBB]\` when there's no good match. Note these as candidate design tokens.
- **Typography**: map font-size/weight/line-height/tracking to \`text-*\`, \`font-*\`, \`leading-*\`, \`tracking-*\`; include the font-family.
- **Radius/shadow/border**: corner radius → \`rounded-*\`; effects → \`shadow-*\`; strokes → \`border\` + \`border-*\`.
- Preserve hierarchy with semantic elements (\`header\`, \`nav\`, \`button\`, \`ul/li\`, \`section\`) and use layer names to derive class/semantic intent.

## Step 3 — Output
- Emit a single clean, indented HTML snippet with Tailwind classes, matching the visual structure top-to-bottom.
- Use real text content from the design.
- After the code, list: (a) any arbitrary values used and the design tokens they suggest, and (b) anything ambiguous you approximated (e.g. fonts not available in Tailwind defaults). Keep it production-ready, not pixel-perfect-absolute-positioned.`,
            },
          },
        ],
        description: "Convert the current Figma selection into HTML + Tailwind CSS",
      };
    }
  );
}