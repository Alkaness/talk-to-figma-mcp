# Contributing

[README](README.md) · [Installation](INSTALLATION.md) · [Commands](COMMANDS.md) · [Troubleshooting](TROUBLESHOOTING.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)

This guide describes the architecture, the rules that changes must preserve, the development setup and the test suites.

## 1. Architecture

```
+------------+  stdio  +------------+  WebSocket  +-----------------+  WebSocket  +---------------+
| MCP client | <-----> | MCP server | <---------> |      Relay      | <---------> | Figma plugin  |
|  (agent)   |         |            |             | 127.0.0.1:3055  |             | (code.js, UI) |
+------------+         +------------+             +-----------------+             +---------------+
```

| Component | Source | Responsibility |
|---|---|---|
| MCP server | `src/talk_to_figma_mcp/` | Tool, prompt and resource definitions, input validation, defaults, result validation. |
| Relay | `src/socket.ts` | Routing between agents and plugins, one command queue per channel, origin checks, heartbeats. |
| Plugin | `src/claude_mcp_plugin/` | Executes commands with the Figma Plugin API. Contains no business logic. |

Routing and timing:

1. Agents join a shared automatic channel. The relay forwards each command to the only connected plugin. With 0 plugins or more than 1, it returns an error that tells the agent what to do.
2. Each channel processes one command at a time. A command is cancelled after 120 seconds without progress from the plugin.
3. The relay pings plugins every 10 seconds and closes a plugin connection after 25 seconds without a reply, unless it is still running a command.
4. The MCP server waits up to 15 seconds for a connection before failing a call, and reconnects with backoff of up to 30 seconds.

## 2. Project structure

```
src/
  socket.ts                  Relay (WebSocket server)
  shared/commands.ts         Command registry used by the MCP server, relay and tests
  talk_to_figma_mcp/         MCP server
    server.ts                Entry point
    config/config.ts         CLI arguments and server metadata (version)
    tools/                   14 *-tools.ts files, 109 tools; index.ts registers them
    prompts/index.ts         5 MCP prompts
    resources/index.ts       2 MCP resources
    utils/                   WebSocket client, logger, result schemas, node reader and
                             writer formats, image comparison, headless capture,
                             REST client, CSS and asset helpers
    types/                   Shared TypeScript types
  claude_mcp_plugin/         Figma plugin
    manifest.json            Plugin manifest (import this in Figma)
    code.js                  Command handlers
    ui.html                  Connection UI
tests/
  unit/utils/                Jest unit tests for utilities
  unit/*.test.ts             Relay tests (bun:test)
  integration/               Jest tests for tool handlers against a mocked plugin
  fixtures/                  Shared test data
scripts/                     Launcher, Claude Desktop configurator, guided integration test
manifest.json                DXT (Claude Desktop extension) manifest
```

## 3. Invariants

These rules protect against earlier bugs. Each one is also commented where it lives in the code.

1. **Relay disconnect order** (`src/socket.ts`, close handler). `cleanupClient()` must run before empty channels are removed. In zero-config mode the plugin is alone in its channel, so deleting the channel first drops the error flush and the agent waits for the full timeout. Covered by `tests/unit/relay-disconnect.test.ts`.
2. **No side effects on import** (`src/socket.ts`). The relay starts only through `startRelay()`, behind `isMainModule()`. Tests import the module, so do not add a top-level `Bun.serve` or timers.
3. **Loopback bind.** `startRelay()` binds `127.0.0.1` unless a hostname is passed. Bun's own default binds every interface. Covered by `tests/unit/relay-disconnect.test.ts`.
4. **Origin allowlist.** The relay has no authentication, so the Origin check (no Origin, `null`, `*.figma.com`, plus `FIGMA_SOCKET_ALLOWED_ORIGINS`) is what stops a web page from controlling the user's Figma file. Do not loosen it. See [Troubleshooting, section 1](TROUBLESHOOTING.md#1-security-model).
5. **Command names** live in `src/shared/commands.ts`. A new command is added there and to `handleCommand` in `code.js`.
6. **Plugin results** are validated with `parseCommandResult()` and a schema in `utils/command-results.ts` only when the result feeds logic. Display-only results stay unvalidated on purpose; add a schema when that changes.
7. **`parentId` is required** in every creation tool schema. The relay enforces it as well.
8. **Logging** goes through `logger` in `utils/logger.ts`, which writes to stderr because stdout carries the MCP protocol. Debug output requires `LOG_LEVEL=debug`. Never log whole payloads (snapshots can be several MB of base64); use `truncateForLog()`.
9. **One node format for reading and writing.** `filterFigmaNode` (`utils/figma-helpers.ts`) defines what `get_node_info` returns, and `create_node_tree` and `update_nodes` accept the same fields (`utils/node-spec.ts`). A field added to the reader's lists must be accepted by the writer; `tests/unit/utils/node-spec.test.ts` checks this and that `get_node_info` output parses unchanged. The server translates specs to Plugin API names; `applyNodeSpec` in `code.js` only applies them, and reports a property it cannot set as a warning.

## 4. Development setup

```bash
git clone https://github.com/Alkaness/talk-to-figma-mcp.git
cd talk-to-figma-mcp
bun install
bun run build        # bun run build:win on Windows
```

| Command | Output |
|---|---|
| `bun run build` | `dist/` (MCP server and relay) |
| `bun run build:watch` | Rebuilds on change |
| `bun run socket` | Starts the relay from `dist/` |
| `npm run build:dxt` | Syncs versions, builds, and packs `talk-to-figma-mcp.dxt` |
| `npm run build:compile` | Standalone binaries for the current platform in `dist/bin/` |
| `npm run compile:all-platforms` | Binaries for Linux x64, macOS arm64 and Windows x64 |

### 4.1 Using a local build in Claude Desktop

`bun run configure-claude` is meant for end users and points Claude Desktop at the published npm package. For local development, edit `claude_desktop_config.json` instead:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "TalkToFigma-Local": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/talk-to-figma-mcp/dist/talk_to_figma_mcp/server.js"]
    }
  }
}
```

Run `bun run build` and restart Claude Desktop after each change to the server.

## 5. Testing

### 5.1 Automated tests

| Command | Runs |
|---|---|
| `bun run test` | Jest suite (`tests/unit/utils`, `tests/integration`) |
| `bun run test:socket` | Relay tests (`tests/unit/*.test.ts`, `bun:test`) |
| `bun run test:all` | Typecheck, then both suites. CI runs this on Node 20 and 22. |
| `bun run test:watch` | Jest in watch mode |
| `bun run test:coverage` | Jest with a coverage report |

Use `bun run test`, not `bun test`. The latter runs the Jest files under Bun's test runner, and they fail there.

To add a test:

1. **Utility:** add `tests/unit/utils/<name>.test.ts`.
2. **Tool handler:** add a file to `tests/integration/` and use the data in `tests/fixtures/`.
3. **Relay behavior:** extend `tests/unit/relay-disconnect.test.ts`. It starts the real relay with `startRelay({ port: 0 })`. Any new `bun:test` file must also be added to `testPathIgnorePatterns` in `jest.config.cjs` and to the `test:socket` script.

### 5.2 Guided integration test

```bash
bun run test:integration
```

The script walks through the full path from MCP client to relay to Figma, step by step.

### 5.3 Manual verification

1. `bun install` completes without errors.
2. The relay starts and `http://localhost:3055/status` returns JSON with the relay status and statistics.
3. `ss -ltn 'sport = :3055'` (Linux) or `lsof -i :3055` (macOS) shows the relay on `127.0.0.1` only.
4. The plugin imports from `src/claude_mcp_plugin/manifest.json` and connects.
5. The MCP client lists the server (`TalkToFigma`).
6. Asking "Show me information about my current Figma selection" returns the selection without any channel ID.
7. Creating and recoloring a rectangle works, with `parentId` set.
8. After the relay restarts, the plugin and the MCP server reconnect on their own.

### 5.4 Diagnostics

1. **Relay log:** the terminal running the relay. Set `LOG_LEVEL=debug` for message traffic.
2. **Status endpoint:** `http://localhost:3055/status`.
3. **Figma console:** **Menu > Plugins > Development > Show/Hide console**.
4. **Restart order:** see [Troubleshooting, section 6.1](TROUBLESHOOTING.md#61-restart-sequence).

## 6. Submitting changes

1. Create a branch: `git checkout -b feature/<name>`.
2. Follow the existing TypeScript patterns, type every public function and use English names.
3. Add tests for new behavior and edge cases. `bun run test:all` must pass.
4. Update the documentation:
   - `COMMANDS.md` for any new or changed tool, including the counts in section 1.
   - `CHANGELOG.md` under `[Unreleased]`.
   - For a release, set the version in `package.json` and run `npm run sync-version` to copy it to `manifest.json` and `config/config.ts`.
5. Open a pull request with a description of the change, related issues, and screenshots for visual changes.

## 7. Contributors

Contributions to this project and to the project it continues from ([arinspunk/claude-talk-to-figma-mcp](https://github.com/arinspunk/claude-talk-to-figma-mcp)):

- **[Rob Dearborn](https://github.com/rfdearborn)**: FigJam support (6 tools), component lookup optimization, `set_text_style_id`.
- **[sometimesdante](https://github.com/sometimesdante)**: full instruction copy on channel click.
- **[ehs208](https://github.com/ehs208)**: configuration script, Korean localization, channel verification ping, `set_instance_variant`, coordinate system unification, Docker setup, image tools, Zod coercion helpers.
- **[mmabas77](https://github.com/mmabas77)**: text alignment and right-to-left support, `set_selection_colors`, more than 20 tools (variables, gradients, grids, transformations), the parallel command queue, node info depth control.
- **[leeyc09](https://github.com/leeyc09)**: fixed-width text, dependency stability.
- **[sk (kovalevsky)](https://github.com/kovalevsky)**: page management tools, SVG export fix.
- **[Beomsu Koh](https://github.com/GoBeromsu)**: `rename_node`.
- **[Timur](https://github.com/Mirsmog)**: Zod validation improvements.
- **[Taylor Smits](https://github.com/smitstay)**: DXT package, CI workflows, tests.
- **[hoxinzhen](https://github.com/hoxinzhen)**: `detach_instance`.
- **[Kejsaren](https://github.com/hello-amed)**: style creation tools (`create_text_style`, `create_paint_style`, `create_effect_style`).
- **[ravszmig](https://github.com/ravszmig)**: prototype interaction tools (`set_reactions`, `get_reactions`).
- **[easyhak](https://github.com/easyhak)**: Windows script compatibility.

Community pull requests integrated manually upstream:

1. **#90 (mmabas77), node info depth control.** `depth` parameter for `get_node_info` and `get_nodes_info`; deeper nodes are returned as `{id, name, type}` stubs, which reduces payload size by about 98% on large documents.
2. **#87 (mmabas77), plugin quality improvements.** Layout grid handling (stretch and fixed modes), `clone_node` with `parentId`, text wrapping, numeric font weights, unified fill and stroke on shape tools, automatic column grids for top-level frames, safe color utilities.
3. **#85 (hoxinzhen), component detaching.**
4. **#83 (Kejsaren), local style creation.**

## 8. License

Contributions are licensed under the project's [MIT License](LICENSE).
