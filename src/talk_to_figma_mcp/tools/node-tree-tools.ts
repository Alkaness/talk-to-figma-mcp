import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket";
import { coerceJson } from "../utils/schema-helpers";
import { parseCommandResult } from "../utils/command-results";
import {
  FontCatalog,
  fontFamiliesOf,
  normalizeNodeTree,
  normalizeNodeUpdates,
  parseNodeSpec,
  parseNodeUpdates,
} from "../utils/node-spec";

// Large trees take a while. Progress updates from the plugin keep the request
// alive, so this is only a ceiling (the same as batch_operations).
const NODE_TREE_TIMEOUT_MS = 600000;

const CREATE_NODE_TREE_DESCRIPTION =
  "Build a node and its whole subtree in one call, in the format that get_node_info returns: a get_node_info result " +
  "(read with a depth that covers every level), edited or not, can be passed as it is. Returns the ID of every created node, " +
  "keyed by the node's key, else its source id, else its path (tree.children[0]), and a warning for anything that was not " +
  "applied. Prefer it to chains of create_* and set_* calls.\n" +
  "Node fields: type (FRAME, TEXT, RECTANGLE, ELLIPSE, LINE, GROUP, COMPONENT, or INSTANCE with componentId); name; key; " +
  "width, height; x, y relative to the parent; rotation in degrees; visible, opacity, blendMode; fills and strokes as hex " +
  "strings (\"#0F172A\", \"#0F172A80\") or paints {type: SOLID, GRADIENT_LINEAR, GRADIENT_RADIAL or IMAGE, color, opacity, " +
  "gradientStops, gradientHandlePositions, imageRef, scaleMode}; strokeWeight, strokeAlign, strokeDashes, " +
  "individualStrokeWeights; cornerRadius, or rectangleCornerRadii [topLeft, topRight, bottomRight, bottomLeft]; effects " +
  "(DROP_SHADOW, INNER_SHADOW, LAYER_BLUR, BACKGROUND_BLUR); clipsContent. Auto-layout: layoutMode, paddingTop/Right/" +
  "Bottom/Left, itemSpacing, counterAxisSpacing, layoutWrap, primaryAxisAlignItems, counterAxisAlignItems, " +
  "primaryAxisSizingMode, counterAxisSizingMode. As a child of an auto-layout frame: layoutSizingHorizontal and " +
  "layoutSizingVertical (FIXED, HUG or FILL), layoutPositioning (ABSOLUTE places it by x, y), minWidth, maxWidth, " +
  "minHeight, maxHeight; elsewhere, constraints. Text: characters; style {fontFamily, fontStyle or fontWeight, italic, " +
  "fontSize, lineHeightPx, letterSpacing, textCase, textDecoration, textAlignHorizontal, textAutoResize}; textRuns " +
  "[{start, end, fontWeight, fontSize, fills, ...}] for mixed styles. children.\n" +
  "An omitted field means what it means in get_node_info output: no fills, no strokes, no clipping. Text without fills " +
  "is black; text without fontFamily is Inter. Other types (VECTOR, BOOLEAN_OPERATION, STAR) take svg with their markup, " +
  "or are cloned when id names a node in this file.";

const UPDATE_NODES_DESCRIPTION =
  "Change the properties of several existing nodes in one call. Each update is { nodeId, ...fields } with the fields of " +
  "create_node_tree except type and children; only the fields given change, and a get_node_info result without its " +
  "children can be passed as it is. Use it for what the single-property tools cannot set: FILL and HUG sizing, absolute " +
  "positioning, constraints, stroke alignment, per-corner radii, fonts by family and weight, and mixed-style text runs. " +
  "width and height resize; absoluteBoundingBox, localPosition and parentOffset are read-only and ignored. Changing " +
  "fontStyle, fontWeight or italic needs fontFamily in the same style.";

/** Look up the styles of the families a spec uses, to resolve weights to style names. */
async function fontCatalogFor(families: string[]): Promise<FontCatalog> {
  if (families.length === 0) return {};
  const result = await sendCommandToFigma("get_available_fonts", { families }, 60000);
  return parseCommandResult("get_available_fonts", result).fonts;
}

function errorResult(action: string, error: unknown) {
  let message = error instanceof Error ? error.message : String(error);
  if (message.includes("Unknown command")) {
    message += ". The Figma plugin is older than this server: re-import the plugin (src/claude_mcp_plugin/manifest.json) in Figma to update it.";
  }
  return {
    content: [{ type: "text" as const, text: `Error ${action}: ${message}` }],
    isError: true,
  };
}

function warningLines(warnings: string[]): string[] {
  return warnings.length > 0 ? ["Warnings:", ...warnings.map((warning) => `  - ${warning}`)] : [];
}

/**
 * Register create_node_tree and update_nodes: the write path in the format
 * that get_node_info reads (see utils/node-spec.ts).
 * @param server - The MCP server instance
 */
export function registerNodeTreeTools(server: McpServer): void {
  server.registerTool(
    "create_node_tree",
    {
      description: CREATE_NODE_TREE_DESCRIPTION,
      inputSchema: {
        parentId: z.string().describe("Parent node ID (required): a page or a frame. Get page IDs with get_pages."),
        tree: coerceJson(z.record(z.any())).describe("The root node spec. A get_node_info result works as it is."),
        index: z.coerce.number().int().min(0).optional().describe("Position among the parent's children (default: last)."),
      },
    },
    async ({ parentId, tree, index }) => {
      try {
        const spec = parseNodeSpec(tree);
        const catalog = await fontCatalogFor(fontFamiliesOf([spec], "create"));
        const normalized = normalizeNodeTree(spec, catalog);
        if (!normalized.tree) {
          return {
            content: [{ type: "text", text: ["Nothing was created.", ...warningLines(normalized.warnings)].join("\n") }],
            isError: true,
          };
        }

        const raw = await sendCommandToFigma(
          "create_node_tree",
          { parentId, index, tree: normalized.tree, fonts: normalized.fonts },
          NODE_TREE_TIMEOUT_MS
        );
        const result = parseCommandResult("create_node_tree", raw);
        const warnings = [...normalized.warnings, ...result.warnings];
        const payload = { rootId: result.rootId, created: result.created, ids: result.ids, warnings };
        const summary = result.rootId
          ? `Created ${result.created} node(s) under ${parentId}; the root is ${result.rootId}.`
          : `Nothing was created under ${parentId}.`;
        return {
          content: [{ type: "text", text: [summary, `IDs: ${JSON.stringify(result.ids)}`, ...warningLines(warnings)].join("\n") }],
          structuredContent: payload,
          ...(result.rootId ? {} : { isError: true }),
        };
      } catch (error) {
        return errorResult("creating the node tree", error);
      }
    }
  );

  server.registerTool(
    "update_nodes",
    {
      description: UPDATE_NODES_DESCRIPTION,
      inputSchema: {
        updates: coerceJson(z.array(z.record(z.any())).min(1)).describe("Array of { nodeId, ...fields }. Only the given fields change."),
      },
    },
    async ({ updates }) => {
      try {
        const parsed = parseNodeUpdates(updates);
        const catalog = await fontCatalogFor(fontFamiliesOf(parsed, "update"));
        const normalized = normalizeNodeUpdates(parsed, catalog);

        const raw = await sendCommandToFigma(
          "update_nodes",
          { updates: normalized.updates, fonts: normalized.fonts },
          NODE_TREE_TIMEOUT_MS
        );
        const result = parseCommandResult("update_nodes", raw);
        const warnings = [...normalized.warnings, ...result.warnings];
        const failures = result.results.filter((entry) => !entry.ok);
        const payload = { total: result.total, succeeded: result.succeeded, failed: result.failed, failures, warnings };
        const lines = [
          `Updated ${result.succeeded} of ${result.total} node(s); ${result.failed} failed.`,
          ...failures.map((entry) => `  ${entry.nodeId}: ${entry.error ?? "unknown error"}`),
          ...warningLines(warnings),
        ];
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          structuredContent: payload,
          ...(result.succeeded === 0 ? { isError: true } : {}),
        };
      } catch (error) {
        return errorResult("updating nodes", error);
      }
    }
  );
}
