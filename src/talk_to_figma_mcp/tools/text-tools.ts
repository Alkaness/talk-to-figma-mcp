import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket";
import { coerceJson } from "../utils/schema-helpers";
import { parseCommandResult } from "../utils/command-results";

/**
 * Register text-related tools to the MCP server
 * This module contains tools for working with text elements in Figma
 * @param server - The MCP server instance
 */
export function registerTextTools(server: McpServer): void {

  // Set Letter Spacing Tool
  server.registerTool(
    "set_letter_spacing",
    {
      description: "Set the letter spacing of a text node in Figma",
      inputSchema: {
      nodeId: z.string().describe("The ID of the text node to modify"),
      letterSpacing: z.coerce.number().describe("Letter spacing value"),
      unit: z.enum(["PIXELS", "PERCENT"]).optional().describe("Unit type (PIXELS or PERCENT)"),
    },
    },
    async ({ nodeId, letterSpacing, unit }) => {
      try {
        const result = await sendCommandToFigma("set_letter_spacing", {
          nodeId,
          letterSpacing,
          unit: unit || "PIXELS"
        });
        const typedResult = result as { name: string, letterSpacing: { value: number, unit: string } };
        return {
          content: [
            {
              type: "text",
              text: `Updated letter spacing of node "${typedResult.name}" to ${typedResult.letterSpacing.value} ${typedResult.letterSpacing.unit}`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting letter spacing: ${error instanceof Error ? error.message : String(error)}`
            }
          ],
          isError: true,
        };
      }
    }
  );

  // Get Styled Text Segments Tool
  const segmentProperty = z.enum([
    "fillStyleId",
    "fontName",
    "fontSize",
    "textCase",
    "textDecoration",
    "textStyleId",
    "fills",
    "letterSpacing",
    "lineHeight",
    "fontWeight",
  ]);
  server.registerTool(
    "get_styled_text_segments",
    {
      description:
        "Split a text node into segments in which the given style properties do not change, with each segment's values. " +
        "Pass properties to read several in one call. get_node_info already returns textRuns with the full style of each " +
        "run; use this tool for fillStyleId and textStyleId, or for the Plugin API's own values.",
      inputSchema: {
      nodeId: z.string().describe("The ID of the text node to analyze"),
      property: segmentProperty.optional().describe("One style property to split by. Give this or properties."),
      properties: coerceJson(z.array(segmentProperty).min(1).max(10))
        .optional()
        .describe("Several style properties to split by; a segment ends where any of them changes."),
    },
      annotations: { readOnlyHint: true },
    },
    async ({ nodeId, property, properties }) => {
      try {
        const list = properties ?? (property ? [property] : []);
        if (list.length === 0) throw new Error("Pass property or properties");
        // property keeps older plugins, which read only property, working for the first one.
        const result = await sendCommandToFigma("get_styled_text_segments", {
          nodeId,
          property: list[0],
          properties: list,
        });
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ],
          structuredContent: { segments: result } as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting styled text segments: ${error instanceof Error ? error.message : String(error)}`
            }
          ],
          isError: true,
        };
      }
    }
  );

  // Set Text Style ID Tool
  server.registerTool(
    "set_text_style_id",
    {
      description: "Apply a text style to a text node in Figma",
      inputSchema: {
      nodeId: z.string().describe("The ID of the text node to modify"),
      textStyleId: z.string().describe("The ID of the text style to apply"),
    },
    },
    async ({ nodeId, textStyleId }) => {
      try {
        const result = await sendCommandToFigma("set_text_style_id", {
          nodeId,
          textStyleId
        });
        const typedResult = result as { name: string, textStyleId: string, styleName: string };
        return {
          content: [
            {
              type: "text",
              text: `Applied text style "${typedResult.styleName}" to node "${typedResult.name}"`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting text style: ${error instanceof Error ? error.message : String(error)}`
            }
          ],
          isError: true,
        };
      }
    }
  );

  // Load Font Async Tool
  server.registerTool(
    "load_font_async",
    {
      description: "Load a font asynchronously in Figma",
      inputSchema: {
      family: z.string().describe("Font family name"),
      style: z.string().optional().describe("Font style (e.g., 'Regular', 'Bold', 'Italic')"),
    },
    },
    async ({ family, style }) => {
      try {
        const result = await sendCommandToFigma("load_font_async", {
          family,
          style: style || "Regular"
        });
        const typedResult = result as { success: boolean, family: string, style: string, message: string };
        return {
          content: [
            {
              type: "text",
              text: typedResult.message || `Loaded font ${family} ${style || "Regular"}`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error loading font: ${error instanceof Error ? error.message : String(error)}`
            }
          ],
          isError: true,
        };
      }
    }
  );

  // Get Fonts Used Tool — inventory fonts in a selection for web-font setup
  server.registerTool(
    "get_fonts_used",
    {
      description: "List every font (family, style, sizes, occurrence count) used within a node's subtree. Use this before generating code to set up @font-face or pick correct web-font equivalents and avoid font mismatches. Defaults to the current selection.",
      inputSchema: {
      nodeId: z.string().optional().describe("Node to inspect. Omit to use the current selection."),
    },
      annotations: { readOnlyHint: true },
    },
    async ({ nodeId }) => {
      try {
        const result = await sendCommandToFigma("get_fonts_used", { nodeId }, 60000);
        const typed = parseCommandResult("get_fonts_used", result);

        if (!typed.fonts.length) {
          return { content: [{ type: "text", text: "No text nodes / fonts found in the selection." }] };
        }

        const lines = typed.fonts
          .sort((a, b) => b.occurrences - a.occurrences)
          .map(
            (f) =>
              `• ${f.family} — ${f.style}  | sizes: ${f.sizes.join(", ")}px  | used ${f.occurrences}×`
          );

        return {
          content: [
            {
              type: "text",
              text: `Fonts used (${typed.fonts.length}):\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting fonts used: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}