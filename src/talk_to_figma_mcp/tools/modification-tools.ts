import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket";
import { applyColorDefaults } from "../utils/defaults";
import { Color } from "../types/color";
import { coerceJson, coerceBoolean } from "../utils/schema-helpers";

/**
 * Register modification tools to the MCP server
 * This module contains tools for modifying existing elements in Figma
 * @param server - The MCP server instance
 */
export function registerModificationTools(server: McpServer): void {

  // Set Selection Colors Tool - recursively change all descendant stroke/fill colors
  server.registerTool(
    "set_selection_colors",
    {
      description: "Recursively change all stroke and fill colors of a node and all its descendants. Works like Figma's 'Selection colors' feature - perfect for recoloring icon instances.",
      inputSchema: {
      nodeId: z.string().describe("The ID of the node to modify (typically an icon instance)"),
      r: z.coerce.number().min(0).max(1).describe("Red component (0-1)"),
      g: z.coerce.number().min(0).max(1).describe("Green component (0-1)"),
      b: z.coerce.number().min(0).max(1).describe("Blue component (0-1)"),
      a: z.coerce.number().min(0).max(1).optional().describe("Alpha component (0-1, defaults to 1)"),
    },
    },
    async ({ nodeId, r, g, b, a }) => {
      try {
        if (r === undefined || g === undefined || b === undefined) {
          throw new Error("RGB components (r, g, b) are required");
        }

        const colorWithDefaults = applyColorDefaults({ r, g, b, a } as Color);

        const result = await sendCommandToFigma("set_selection_colors", {
          nodeId,
          r: colorWithDefaults.r,
          g: colorWithDefaults.g,
          b: colorWithDefaults.b,
          a: colorWithDefaults.a,
        });
        const typedResult = result as { name: string; nodesChanged: number };
        return {
          content: [
            {
              type: "text",
              text: `Changed selection colors of "${typedResult.name}" and descendants (${typedResult.nodesChanged} paint(s) updated) to RGBA(${r}, ${g}, ${b}, ${colorWithDefaults.a})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting selection colors: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Delete Node Tool
  server.registerTool(
    "delete_node",
    {
      description: "Delete a node from Figma",
      inputSchema: {
      nodeId: z.string().describe("The ID of the node to delete"),
    },
      annotations: { destructiveHint: true },
    },
    async ({ nodeId }) => {
      try {
        await sendCommandToFigma("delete_node", { nodeId });
        return {
          content: [
            {
              type: "text",
              text: `Deleted node with ID: ${nodeId}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error deleting node: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Set Effect Style ID Tool
  server.registerTool(
    "set_effect_style_id",
    {
      description: "Apply an effect style to a node in Figma",
      inputSchema: {
      nodeId: z.string().describe("The ID of the node to modify"),
      effectStyleId: z.string().describe("The ID of the effect style to apply")
    },
    },
    async ({ nodeId, effectStyleId }) => {
      try {
        const result = await sendCommandToFigma("set_effect_style_id", {
          nodeId,
          effectStyleId
        });

        const typedResult = result as { name: string, effectStyleId: string };

        return {
          content: [
            {
              type: "text",
              text: `Successfully applied effect style to node "${typedResult.name}"`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting effect style: ${error instanceof Error ? error.message : String(error)}`
            }
          ],
          isError: true,
        };
      }
    }
  );

  // Rotate Node Tool
  server.registerTool(
    "rotate_node",
    {
      description: "Rotate a node in Figma by a specified angle in degrees (counterclockwise, as Figma's rotation field). Use relative=true to add to the current rotation instead of setting an absolute value. Note: locked nodes can still be rotated — the Plugin API bypasses the UI lock by design.",
      inputSchema: {
      nodeId: z.string().describe("The ID of the node to rotate"),
      angle: z.coerce.number().describe("Rotation angle in degrees (counterclockwise)"),
      relative: coerceBoolean.optional().describe("If true, add angle to current rotation instead of setting absolute value (default: false)"),
    },
    },
    async ({ nodeId, angle, relative }) => {
      try {
        const result = await sendCommandToFigma("rotate_node", {
          nodeId,
          angle,
          relative: relative || false,
        });
        const typedResult = result as { name: string; rotation: number };
        return {
          content: [
            {
              type: "text",
              text: `Rotated node "${typedResult.name}" to ${typedResult.rotation}°`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error rotating node: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Reorder Node Tool (z-order within same parent)
  server.registerTool(
    "reorder_node",
    {
      description: "Change the z-order (layer order) of a node within its parent. Distinct from insert_child which re-parents a node — reorder_node changes position within the same parent.",
      inputSchema: {
      nodeId: z.string().describe("The ID of the node to reorder"),
      position: z.enum(["front", "back", "forward", "backward"]).optional().describe("Move to front/back or one step forward/backward"),
      index: z.coerce.number().optional().describe("Direct index position within parent's children (0 = bottom). Overrides position if both provided."),
    },
    },
    async ({ nodeId, position, index }) => {
      try {
        const result = await sendCommandToFigma("reorder_node", {
          nodeId,
          position,
          index,
        });
        const typedResult = result as { name: string; newIndex: number; parentChildCount: number };
        return {
          content: [
            {
              type: "text",
              text: `Reordered node "${typedResult.name}" to index ${typedResult.newIndex} of ${typedResult.parentChildCount} siblings`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error reordering node: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Convert to Frame Tool
  server.registerTool(
    "convert_to_frame",
    {
      description: "Convert a group or shape node into a frame in Figma. Preserves position, size, visual properties, and children. Useful for converting groups into auto-layout-capable frames.",
      inputSchema: {
      nodeId: z.string().describe("The ID of the node to convert to a frame"),
    },
    },
    async ({ nodeId }) => {
      try {
        const result = await sendCommandToFigma("convert_to_frame", { nodeId });
        const typedResult = result as { id: string; name: string; originalType: string; childCount: number };
        return {
          content: [
            {
              type: "text",
              text: `Converted ${typedResult.originalType} "${typedResult.name}" to FRAME with ID: ${typedResult.id} (${typedResult.childCount} children preserved)`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error converting to frame: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Set Image Fill Tool
  server.registerTool(
    "set_image",
    {
      description: "Set an image fill on a node from base64-encoded image data. Supports PNG, JPEG, GIF, WebP. Max ~5MB after decode.",
      inputSchema: {
      nodeId: z.string().describe("The ID of the node to apply the image fill to"),
      imageData: z.string().max(7_000_000).describe("Base64-encoded image data (PNG, JPEG, GIF, or WebP). Max ~5MB after decode."),
      scaleMode: z.enum(["FILL", "FIT", "CROP", "TILE"]).optional().describe("How the image is scaled within the node (default: FILL)"),
    },
    },
    async ({ nodeId, imageData, scaleMode }) => {
      try {
        const result = await sendCommandToFigma("set_image", {
          nodeId,
          imageData,
          scaleMode: scaleMode || "FILL",
        });
        const typedResult = result as { name: string; imageHash: string };
        return {
          content: [
            {
              type: "text",
              text: `Set image fill on node "${typedResult.name}" with scale mode ${scaleMode || "FILL"} (hash: ${typedResult.imageHash})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting image fill: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Set Layout Grid Tool
  server.registerTool(
    "set_grid",
    {
      description: "Apply layout grids to a frame node in Figma. Supports columns, rows, and grid patterns.",
      inputSchema: {
      nodeId: z.string().describe("The ID of the frame node to apply grids to"),
      grids: coerceJson(z.array(
        z.object({
          pattern: z.enum(["COLUMNS", "ROWS", "GRID"]).describe("Grid pattern type"),
          count: z.coerce.number().optional().describe("Number of columns/rows (ignored for GRID)"),
          sectionSize: z.coerce.number().optional().describe("Size of each section in pixels"),
          gutterSize: z.coerce.number().optional().describe("Gutter size between sections in pixels"),
          offset: z.coerce.number().optional().describe("Offset from the edge in pixels"),
          alignment: z.enum(["MIN", "CENTER", "MAX", "STRETCH"]).optional().describe("Grid alignment"),
          visible: z.boolean().optional().describe("Whether the grid is visible (default: true)"),
          color: z.object({
            r: z.coerce.number().min(0).max(1).describe("Red (0-1)"),
            g: z.coerce.number().min(0).max(1).describe("Green (0-1)"),
            b: z.coerce.number().min(0).max(1).describe("Blue (0-1)"),
            a: z.coerce.number().min(0).max(1).describe("Alpha (0-1)")
          }).optional().describe("Grid color")
        })
      )).describe("Array of layout grids to apply")
    },
    },
    async ({ nodeId, grids }) => {
      try {
        const result = await sendCommandToFigma("set_grid", { nodeId, grids });
        const typedResult = result as { name: string; gridCount: number };
        return {
          content: [
            {
              type: "text",
              text: `Applied ${typedResult.gridCount} layout grid(s) to frame "${typedResult.name}"`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting layout grids: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Get Layout Grid Tool
  server.registerTool(
    "get_grid",
    {
      description: "Read layout grids from a frame node in Figma",
      inputSchema: {
      nodeId: z.string().describe("The ID of the frame node to read grids from"),
    },
      annotations: { readOnlyHint: true },
    },
    async ({ nodeId }) => {
      try {
        const result = await sendCommandToFigma("get_grid", { nodeId });
        const typedResult = result as { name: string; grids: any[] };
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ name: typedResult.name, grids: typedResult.grids }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting layout grids: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Set Guide Tool
  server.registerTool(
    "set_guide",
    {
      description: "Set guides on a page in Figma. Replaces all existing guides on the page.",
      inputSchema: {
      pageId: z.string().describe("The ID of the page to add guides to"),
      guides: coerceJson(z.array(
        z.object({
          axis: z.enum(["X", "Y"]).describe("Guide axis: X for vertical, Y for horizontal"),
          offset: z.coerce.number().describe("Offset position of the guide in pixels")
        })
      )).describe("Array of guides to set on the page")
    },
    },
    async ({ pageId, guides }) => {
      try {
        const result = await sendCommandToFigma("set_guide", { pageId, guides });
        const typedResult = result as { name: string; guideCount: number };
        return {
          content: [
            {
              type: "text",
              text: `Set ${typedResult.guideCount} guide(s) on page "${typedResult.name}"`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting guides: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Get Guide Tool
  server.registerTool(
    "get_guide",
    {
      description: "Read guides from a page in Figma",
      inputSchema: {
      pageId: z.string().describe("The ID of the page to read guides from"),
    },
      annotations: { readOnlyHint: true },
    },
    async ({ pageId }) => {
      try {
        const result = await sendCommandToFigma("get_guide", { pageId });
        const typedResult = result as { name: string; guides: any[] };
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ name: typedResult.name, guides: typedResult.guides }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting guides: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Set Annotation Tool
  server.registerTool(
    "set_annotation",
    {
      description: "Add an annotation label to a node in Figma. Uses the proposed Annotations API — requires Figma Desktop with enableProposedApi.",
      inputSchema: {
      nodeId: z.string().describe("The ID of the node to annotate"),
      label: z.string().describe("The annotation label text"),
    },
    },
    async ({ nodeId, label }) => {
      try {
        const result = await sendCommandToFigma("set_annotation", { nodeId, label });
        const typedResult = result as { name: string; annotationCount: number };
        return {
          content: [
            {
              type: "text",
              text: `Added annotation "${label}" to node "${typedResult.name}" (${typedResult.annotationCount} total annotations)`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting annotation: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Get Annotation Tool
  server.registerTool(
    "get_annotation",
    {
      description: "Read annotations from a node in Figma. Uses the proposed Annotations API.",
      inputSchema: {
      nodeId: z.string().describe("The ID of the node to read annotations from"),
    },
      annotations: { readOnlyHint: true },
    },
    async ({ nodeId }) => {
      try {
        const result = await sendCommandToFigma("get_annotation", { nodeId });
        const typedResult = result as { name: string; annotations: any[] };
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ name: typedResult.name, annotations: typedResult.annotations }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting annotations: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Batch Operations Tool — apply many edits in ONE payload (timeout-safe)
  server.registerTool(
    "batch_operations",
    {
      description: "Run many plugin commands in one call. Pass an array of { command, params } operations with the " +
      "plugin's command names (for example set_text_content, move_node, resize_node, rename_node, set_fill_color); the " +
      "commands of removed tools still work here. params use the plugin's own shape: set_fill_color takes " +
      "{ nodeId, color: { r, g, b, a } }. The plugin " +
      "streams progress, so the call does not time out, and returns each operation's result with the node ID it " +
      "returned. To change properties of several nodes, update_nodes is simpler: it takes the get_node_info format " +
      "and validates it. To build nodes, use create_node_tree.",
      inputSchema: {
      operations: coerceJson(
        z
          .array(
            z.object({
              command: z
                .string()
                .describe("The Figma command to run, e.g. 'set_text_content', 'move_node', 'set_fill_color'."),
              params: z
                .record(z.any())
                .describe("Parameters object for that command (must include nodeId where the command requires one)."),
            })
          )
          .min(1)
          .describe("Array of operations to apply in order.")
      ),
      stopOnError: coerceBoolean
        .optional()
        .describe("If true, halt at the first failed operation. Default false (apply all, collect failures)."),
    },
    },
    async ({ operations, stopOnError }) => {
      try {
        const result = await sendCommandToFigma(
          "batch_operations",
          { operations, stopOnError: stopOnError ?? false },
          600000 // 10 min ceiling; progress updates keep the request alive
        );
        const typed = result as {
          total: number;
          succeeded: number;
          failed: number;
          results: { index: number; command: string; ok: boolean; error?: string; id?: string }[];
        };

        const failures = typed.results.filter((r) => !r.ok);
        // Edits return the node they changed; list only nodes an operation created.
        const created = typed.results.filter((r) => r.ok && r.id && r.id !== operations[r.index]?.params?.nodeId);
        const lines = [
          `Batch complete: ${typed.succeeded}/${typed.total} succeeded, ${typed.failed} failed.`,
        ];
        if (created.length > 0) {
          lines.push("", "Created nodes:");
          for (const r of created) {
            lines.push(`  [#${r.index}] ${r.command}: ${r.id}`);
          }
        }
        if (failures.length > 0) {
          lines.push("", "Failed operations:");
          for (const f of failures) {
            lines.push(`  [#${f.index}] ${f.command}: ${f.error}`);
          }
          lines.push("", "Fix the inputs above and re-send just the failed operations.");
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error running batch operations: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
