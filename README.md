# Talk to Figma MCP

[README](README.md) · [Installation](INSTALLATION.md) · [Commands](COMMANDS.md) · [Troubleshooting](TROUBLESHOOTING.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)

A Model Context Protocol (MCP) server that lets AI agents read, inspect and edit Figma files. It provides 109 tools, 5 prompts and 2 resources, and works with any Figma account, including free accounts. Figma Dev Mode is not required.

## 1. Overview

The agent talks to the MCP server. The MCP server sends each command through a local relay to a plugin running in the open Figma file, and the result comes back the same way.

Supported MCP clients:

1. [Claude Desktop](https://claude.ai/)
2. [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
3. [Cursor](https://cursor.com/)
4. [Antigravity](https://antigravity.google/)
5. [Windsurf](https://windsurf.com/)
6. [VS Code](https://code.visualstudio.com/) with [GitHub Copilot](https://github.com/features/copilot)
7. [Cline](https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev)
8. [Roo Code](https://marketplace.visualstudio.com/items?itemName=RooVeterinaryInc.roo-cline)

## 2. Requirements

- [Node.js](https://nodejs.org/en/download) 20 or later.
- [Figma Desktop](https://www.figma.com/downloads/).
- One of the MCP clients listed above.

[Bun](https://bun.sh) is recommended. The launcher offers to install it and otherwise uses npm.

## 3. Installation

The full guide, including every client, is in [INSTALLATION.md](INSTALLATION.md).

1. **Start the relay.** In the folder where the project should be installed, run:

   ```bash
   npx @alkaness/talk-to-figma-mcp
   ```

   The launcher clones the repository, installs dependencies and starts the relay on `127.0.0.1:3055`. In later sessions, run `bun run socket` inside the project folder.

2. **Install the plugin.** In Figma Desktop, open **Menu > Plugins > Development > Import plugin from manifest** and select `src/claude_mcp_plugin/manifest.json` from the project folder.

3. **Configure the MCP client.** For Claude Desktop, install `talk-to-figma-mcp.dxt` from the [releases page](https://github.com/Alkaness/talk-to-figma-mcp/releases). For other clients, add this server entry (file locations are listed in [INSTALLATION.md, section 4](INSTALLATION.md#4-configure-the-mcp-client)):

   ```json
   {
     "mcpServers": {
       "TalkToFigma": {
         "command": "npx",
         "args": ["-p", "@alkaness/talk-to-figma-mcp@latest", "talk-to-figma-mcp-server"]
       }
     }
   }
   ```

4. **Connect.** Run the plugin in Figma and click **Connect**.

## 4. Usage

With one Figma file connected, no further setup is needed. The server sends every tool call to that plugin automatically; no channel ID is exchanged.

- If no plugin is connected, the agent receives an error that tells it to ask the user to open the plugin.
- The plugin reconnects on its own when the relay restarts. Connections that stop answering heartbeats for 25 seconds are closed.
- With more than one file connected, the agent asks which file to use and calls `join_channel` with the channel ID shown in that file's plugin window.

Example requests:

1. "Find all text with a contrast ratio below 4.5:1 and suggest colors that meet WCAG AA."
2. "Change #FF6B6B to #E63946 in every primary button in the document."
3. "Generate a React component for the CardProduct frame, with styles in CSS modules."
4. "Compare my implementation at http://localhost:3000/pricing with the Pricing frame and list the differences."

## 5. Parallel agents

Several agents, for example Claude Code subagents, can work on the same file at the same time. The relay keeps a queue per channel and sends commands to the plugin one at a time, so the plugin is never given two commands at once.

Because agents cannot rely on a shared "current page":

1. `set_current_page` is blocked by the relay.
2. Every creation command requires `parentId` (a page or frame ID).

The command queue was contributed by [@mmabas77](https://github.com/mmabas77).

## 6. Capabilities

| Area | Tools | Examples |
|---|---:|---|
| Document and pages | 17 | `get_document_info`, `get_node_info`, `get_css`, `get_pages` |
| Node trees | 2 | `create_node_tree` and `update_nodes`, in the `get_node_info` format |
| Creation | 12 | `clone_node`, `group_nodes`, `boolean_operation`, `create_polygon` |
| Modification | 24 | `batch_operations`, `rotate_node`, `reorder_node`, `delete_node` |
| Text | 15 | `set_font_weight`, `get_styled_text_segments`, `get_fonts_used` |
| Styles and variables | 7 | `create_text_style`, `get_variables`, `apply_variable_to_node` |
| Components and prototyping | 7 | `create_component_instance`, `set_instance_variant`, `set_reactions` |
| Images, assets and SVG | 12 | `get_visual_snapshot`, `scan_assets`, `get_asset`, `extract_asset`, `get_svg` |
| Verification | 2 | `compare_to_figma` (SSIM score and diff heatmap), `capture_render` |
| FigJam | 6 | `create_sticky`, `create_connector`, `create_section` |
| REST API | 5 | `rest_get_file`, `rest_render_image`, `rest_get_comments` |
| **Total** | **109** | |

21 of these tools are deprecated because `create_node_tree` and `update_nodes` cover them: the single-property setters for fills, strokes, gradients, effects, auto-layout, position, size, name and text style, the text content setters, and `create_frame`, `create_rectangle`, `create_ellipse` and `create_text`. They still work, and each description names its replacement. See [COMMANDS.md, section 3](COMMANDS.md#3-node-trees-2).

The 5 REST API tools require a Figma personal access token ([INSTALLATION.md, section 5](INSTALLATION.md#5-optional-figma-personal-access-token)). They read and render any file the token's owner can open, without the plugin.

The server also provides 5 prompts, including `audit-accessibility` and `export-to-tailwind`, and 2 live resources: `figma://local/selection` and `figma://local/document`. The complete list is in [COMMANDS.md](COMMANDS.md).

## 7. Alternative deployments

**Standalone binaries.** These run without Bun or Node.js installed:

```bash
npm run build:compile           # dist/bin/figma-mcp-server and dist/bin/figma-socket
npm run compile:all-platforms   # Linux x64, macOS arm64, Windows x64
./dist/bin/figma-socket --port=3055
```

Point the MCP client at `dist/bin/figma-mcp-server`.

**Docker.** The provided `Dockerfile` runs the relay only. See [INSTALLATION.md, section 2.2](INSTALLATION.md#22-using-docker).

## 8. Documentation

| Document | Contents |
|---|---|
| [INSTALLATION.md](INSTALLATION.md) | Relay, plugin and client setup; Docker; personal access token |
| [COMMANDS.md](COMMANDS.md) | All 109 tools, 5 prompts and 2 resources |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Security model and known error messages |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Architecture, invariants, development and testing |
| [CHANGELOG.md](CHANGELOG.md) | Version history |

## 9. Credits and license

Based on [cursor-talk-to-figma-mcp](https://github.com/sonnylazuardi/cursor-talk-to-figma-mcp) by Sonny Lazuardi. Adapted for Claude Desktop and extended with new tools by [Xúlio Zé](https://github.com/arinspunk) in [claude-talk-to-figma-mcp](https://github.com/arinspunk/claude-talk-to-figma-mcp). This repository continues from that project with zero-config routing, visual snapshots, fidelity tools and the Figma REST API by [Alkaness](https://github.com/Alkaness). All contributors are listed in [CONTRIBUTING.md, section 7](CONTRIBUTING.md#7-contributors).

Released under the [MIT License](LICENSE). Issues and feature requests: [GitHub Issues](https://github.com/Alkaness/talk-to-figma-mcp/issues).
