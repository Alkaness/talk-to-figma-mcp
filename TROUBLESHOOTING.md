# Troubleshooting

[README](README.md) · [Installation](INSTALLATION.md) · [Commands](COMMANDS.md) · [Troubleshooting](TROUBLESHOOTING.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)

This guide lists known error messages with their cause and resolution. Headings in quotation marks are the exact text returned to the agent.

## 1. Security model

The relay gives full read and write access to the Figma file that has the plugin connected. The plugin path needs no API token. A Figma personal access token is optional and only enables the REST API tools.

1. **Network exposure.** The relay listens on `127.0.0.1` only. `FIGMA_SOCKET_HOST=0.0.0.0` makes it reachable from the network. The relay has no authentication and the origin check below does not apply to non-browser clients, so set this only on a trusted network. It is required for Windows with WSL; the Docker image sets it inside the container.
2. **Origin allowlist.** Browsers do not apply CORS to WebSocket connections, so the relay rejects browser requests unless the origin is the plugin sandbox (`null`) or `*.figma.com`. Clients that send no `Origin` header, such as the MCP server, are not affected. To allow another browser client, for example a local dashboard:

   ```bash
   FIGMA_SOCKET_ALLOWED_ORIGINS="http://localhost:5173" bun run socket
   ```

   Rejected requests are logged by the relay as `Rejected request from disallowed origin`.
3. **Personal access token.** A token grants REST access to every file the account can open. Store it in the DXT keychain field or an environment variable rather than in a shared `mcp.json`. The server sends it only in the `X-Figma-Token` header and removes it from error messages. Revoke it in **Figma > Settings > Security**.
4. **Debug logging.** `LOG_LEVEL=debug` logs message traffic for the MCP server, the relay, or both. Payloads are truncated, but logs can still contain design content. Leave it unset in normal use.

## 2. Connection errors

### 2.1 "Could not connect to the Figma socket server"

**Cause:** the MCP server could not reach the relay within 15 seconds.

**Resolution:**

1. Start the relay: `bun run socket` in the project folder, or `npx @alkaness/talk-to-figma-mcp`.
2. Confirm that `http://localhost:3055/status` responds.
3. If the relay uses a different port, pass the same `--port=` to the MCP server.

### 2.2 "No Figma plugin is connected"

**Cause:** the relay is running but no plugin is connected to it.

**Resolution:** open the Figma file, run the plugin and click **Connect**.

### 2.3 "N Figma plugins are connected, so auto-routing is ambiguous"

**Cause:** more than one Figma file has the plugin connected.

**Resolution:** tell the agent which file to use and give it the channel ID shown in that file's plugin window. The agent then calls `join_channel`.

### 2.4 "A Figma plugin is connected but has not joined a channel yet"

**Resolution:** click **Connect** in the plugin and retry.

### 2.5 "Figma plugin disconnected while processing command"

The same cause also produces "Figma plugin disconnected before the command could run".

**Cause:** the plugin was closed, Figma reloaded, or the connection dropped. Every pending command is rejected immediately.

**Resolution:** reopen the plugin, click **Connect** and repeat the request. The plugin reconnects on its own after a relay restart.

### 2.6 The plugin does not appear in Figma

**Resolution:**

1. Open **Menu > Plugins > Development > Import plugin from manifest**.
2. Select `src/claude_mcp_plugin/manifest.json`.
3. Restart Figma if the plugin still does not appear.

### 2.7 The MCP server does not appear in the client

**Resolution:**

1. Compare the client configuration with [Installation, section 4](INSTALLATION.md#4-configure-the-mcp-client). The server entry must sit inside the existing `mcpServers` object (`servers` in VS Code), next to any other servers.
2. For Claude Desktop, reinstall the latest `.dxt` from the [releases page](https://github.com/Alkaness/talk-to-figma-mcp/releases).
3. Restart the client.

## 3. Execution errors

### 3.1 "\<command\> requires a parentId parameter"

**Cause:** creation commands must name their parent. Several agents can edit the same file, so the server does not rely on the current page.

**Resolution:** pass a page ID (from `get_pages`) or a frame ID as `parentId`.

### 3.2 "\<command\> is a stateful command and is not allowed through the relay server"

**Cause:** `set_current_page` is blocked, including inside `batch_operations`.

**Resolution:** use `parentId` to target a page instead.

### 3.3 "Request to Figma timed out"

**Cause:** the relay cancels a command after 120 seconds without progress from the plugin. The timer restarts whenever the plugin reports progress.

**Resolution:**

1. Split the request into smaller steps.
2. Use `create_node_tree` or `update_nodes` for many nodes, and `batch_operations` for other commands. They report progress, so they do not time out while they keep working.
3. In large documents, work on a specific selection or page.

### 3.4 Other command failures

**Resolution:**

1. Open the Figma console: **Menu > Plugins > Development > Show/Hide console**.
2. Read the error message there.
3. Confirm that the account has edit access to the file. View-only access rejects every change.

### 3.5 Font errors: "is not available in Figma", "has no style", "Could not load font(s)"

**Cause:** `create_node_tree` and `update_nodes` check every font against the fonts Figma can load before they change anything. The family is not installed or is spelled differently, or the family has no style of that name. Other tools report fonts that fail to load.

**Resolution:**

1. Use a style from the list in the error. A `fontWeight` without `fontStyle` selects the closest available style.
2. For an unknown family, the error names up to 5 similarly spelled families that Figma has. Otherwise install the font, then restart Figma so that it loads the font.
3. Team fonts may need to be loaded manually in Figma first.
4. Call `load_font_async` to check whether a font can be loaded.

### 3.6 "Figma lists no fonts at all"

**Cause:** `figma.listAvailableFontsAsync()` returned no fonts, so the Figma client cannot load any font and no plugin can create or edit text. On 2026-09-24 this was seen with figma-linux (snap, build 197): the plugin received 0 families, and `loadFontAsync` failed even for Inter Regular. `create_text` fails in the same session with `The font "Inter Regular" could not be loaded`.

**Resolution:**

1. Restart Figma, then run the plugin again.
2. In figma-linux, check the font directories in its settings, or try another build of the client.
3. Tools that do not create or edit text keep working.

### 3.7 "The Figma plugin is older than this server" or "Unexpected response shape from the Figma plugin"

**Cause:** the server sent a command that the plugin does not know, or the plugin returned a result in an older format. Figma keeps running the plugin code it imported until the plugin is imported again.

**Resolution:** in Figma Desktop, open **Menu > Plugins > Development > Import plugin from manifest**, select `src/claude_mcp_plugin/manifest.json` from the updated project folder, and run the plugin again.

## 4. REST API errors

### 4.1 "No Figma personal access token is configured"

**Resolution:**

1. Create a token in **Figma > Settings > Security > Personal access tokens**.
2. Provide it as `FIGMA_PERSONAL_TOKEN` (see [Installation, section 5](INSTALLATION.md#5-optional-figma-personal-access-token)).
3. Restart the client and run `rest_whoami`.

### 4.2 "The Figma personal access token is invalid or has been revoked" (HTTP 401)

**Resolution:** generate a new token and update `FIGMA_PERSONAL_TOKEN`. If the `rest_*` tools are missing entirely, the variable is not reaching the MCP server.

### 4.3 "The token does not grant access to this resource" (HTTP 403)

**Resolution:** confirm that the token's account can open the file and that the token has the **File content** read scope (and **Comments** write for `rest_post_comment`).

### 4.4 "rate limit reached" (HTTP 429)

**Cause:** the server already retried using `Retry-After` or exponential backoff, and the retries ran out.

**Resolution:** wait one minute and retry. Render specific node IDs with `rest_render_image` instead of whole files.

## 5. Performance

| Symptom | Resolution |
|---|---|
| Slow responses in large documents | Work on a page or selection instead of the whole document. `get_node_info` and `get_nodes_info` default to `depth=1`; raise it only when needed. |
| Frequent disconnections | The MCP server reconnects with backoff up to 30 seconds, and the plugin reconnects after relay restarts. If it continues, restart the relay. |
| High memory use in Figma | Close unused Figma tabs and restart Figma after long sessions. |

## 6. General procedures

### 6.1 Restart sequence

1. Stop the relay (`Ctrl+C`).
2. Close the MCP client.
3. Close Figma.
4. Start the relay.
5. Open Figma, run the plugin and click **Connect**.
6. Open the MCP client.

### 6.2 Clean reinstall (source checkout)

```bash
rm -rf node_modules
bun install
bun run build   # bun run build:win on Windows
```

### 6.3 Port 3055 already in use

1. Find the process:
   - macOS and Linux: `lsof -i :3055`
   - Windows: `netstat -ano | findstr :3055`
2. Stop that process, or run the relay on another port with `--port=` and pass the same port to the MCP server.

## 7. Reporting an issue

Check the [open issues](https://github.com/Alkaness/talk-to-figma-mcp/issues) first. A new issue should include:

1. A description of the problem.
2. Steps to reproduce it.
3. Operating system.
4. MCP client and version.
5. The exact error message.
