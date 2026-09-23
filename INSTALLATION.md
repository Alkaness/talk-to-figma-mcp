# Installation

[README](README.md) · [Installation](INSTALLATION.md) · [Commands](COMMANDS.md) · [Troubleshooting](TROUBLESHOOTING.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)

This guide covers the three parts of a working setup and the configuration for each supported MCP client.

| Part | Role | Started by |
|---|---|---|
| Relay (WebSocket server) | Routes commands between the MCP server and the plugin. Listens on `127.0.0.1:3055`. | You, section 2 |
| Figma plugin | Executes commands inside the open Figma file. | You, section 3 |
| MCP server | Exposes the tools to the agent. | The MCP client, section 4 |

## 1. Requirements

- [Node.js](https://nodejs.org/en/download) 20 or later. CI tests versions 20 and 22.
- [Bun](https://bun.sh), recommended. If it is missing, the launcher in section 2.1 offers to install it and otherwise uses npm.
- [Figma Desktop](https://www.figma.com/downloads/).
- One MCP client:
  - [Claude Desktop](https://claude.ai/download)
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
  - [Cursor](https://cursor.com/downloads)
  - [Antigravity](https://antigravity.google/download)
  - [Windsurf](https://windsurf.com/download)
  - [VS Code](https://code.visualstudio.com/) with [GitHub Copilot](https://github.com/features/copilot)
  - [Cline](https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev)
  - [Roo Code](https://marketplace.visualstudio.com/items?itemName=RooVeterinaryInc.roo-cline)

## 2. Start the relay

### 2.1 Using the launcher

In the folder where the project should be installed, run:

```bash
npx claude-talk-to-figma-mcp
```

The launcher performs 3 steps:

1. Clones the repository.
2. Installs dependencies with Bun, or npm if Bun is not installed.
3. Starts the relay.

Confirm that `http://localhost:3055/status` responds. In later sessions, run `bun run socket` (or `npm run socket`) inside the project folder instead.

Relay settings:

| Setting | Default | Purpose |
|---|---|---|
| `--port=` or `FIGMA_SOCKET_PORT` | `3055` | Listening port. |
| `FIGMA_SOCKET_HOST` | `127.0.0.1` | Listening address. Set `0.0.0.0` only on a trusted network (required for Windows with WSL). See [Troubleshooting, section 1](TROUBLESHOOTING.md#1-security-model). |
| `FIGMA_SOCKET_ALLOWED_ORIGINS` | empty | Extra browser origins allowed to connect, comma-separated. |
| `LOG_LEVEL` | not set | Set `debug` to log message traffic (payloads are truncated). |

### 2.2 Using Docker

Docker runs only the relay, so Bun and Node.js are not needed on the host for this part. Docker must be installed and running.

1. Build the image:

   ```bash
   git clone https://github.com/Alkaness/talk-to-figma-mcp.git
   cd talk-to-figma-mcp
   docker build -t figma-websocket .
   ```

2. Start the container:

   ```bash
   docker run -d -p 127.0.0.1:3055:3055 --name figma-ws figma-websocket
   ```

3. Confirm that `http://localhost:3055/status` responds.
4. Continue with section 3 and section 4.

The image sets `FIGMA_SOCKET_HOST=0.0.0.0` inside the container. The `127.0.0.1:` prefix in `-p` keeps the port reachable only from the host. For a relay shared by a team, publish with `-p 3055:3055` on a trusted network only: the relay has no authentication.

## 3. Install the Figma plugin

1. In Figma Desktop, open **Menu > Plugins > Development > Import plugin from manifest**.
2. Go to the folder from section 2.
3. Select `src/claude_mcp_plugin/manifest.json`.
4. Run the plugin and click **Connect**.

## 4. Configure the MCP client

Each client starts the MCP server itself. The configuration below is the same for every client except for the file it is stored in.

### 4.1 Claude Desktop

**Option A: DXT package**

1. Download `claude-talk-to-figma-mcp.dxt` from the [releases page](https://github.com/Alkaness/talk-to-figma-mcp/releases).
2. Open the file. Claude Desktop installs the extension.

**Option B: JSON configuration**

Open **Settings > Developer > Edit Config** and add the following to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ClaudeTalkToFigma": {
      "command": "npx",
      "args": ["-p", "claude-talk-to-figma-mcp@latest", "claude-talk-to-figma-mcp-server"]
    }
  }
}
```

Restart Claude Desktop.

### 4.2 Claude Code

```bash
claude mcp add ClaudeTalkToFigma -- npx -p claude-talk-to-figma-mcp@latest claude-talk-to-figma-mcp-server
claude mcp list
```

For a per-project setup, create `.mcp.json` in the project root instead:

```json
{
  "mcpServers": {
    "ClaudeTalkToFigma": {
      "command": "npx",
      "args": ["-p", "claude-talk-to-figma-mcp@latest", "claude-talk-to-figma-mcp-server"]
    }
  }
}
```

Inside Claude Code, `/mcp` shows the server status.

### 4.3 Cursor

1. Open **Cursor Settings > Tools & MCP**.
2. Click **New MCP Server** to open `mcp.json`.
3. Add:

   ```json
   {
     "mcpServers": {
       "ClaudeTalkToFigma": {
         "command": "npx",
         "args": ["-p", "claude-talk-to-figma-mcp@latest", "claude-talk-to-figma-mcp-server"]
       }
     }
   }
   ```

4. Save the file and restart Cursor.

### 4.4 Antigravity

1. In the Agent chat, open **Additional options** (the three-dot menu, top right) **> MCP Servers > Manage MCP Servers > View raw config** to open `mcp_config.json`.
2. Add:

   ```json
   {
     "mcpServers": {
       "ClaudeTalkToFigma": {
         "command": "npx",
         "args": [
           "-p",
           "claude-talk-to-figma-mcp@latest",
           "claude-talk-to-figma-mcp-server"
         ]
       }
     }
   }
   ```

3. Save the file and restart Antigravity.

### 4.5 Windsurf

1. Open **Windsurf Settings > Cascade > MCP Servers**, or click the MCP icon in the Cascade panel.
2. Click **View raw config** to edit `mcp_config.json`:
   - macOS: `~/.codeium/windsurf/mcp_config.json`
   - Windows: `%USERPROFILE%\.codeium\windsurf\mcp_config.json`
3. Add:

   ```json
   {
     "mcpServers": {
       "ClaudeTalkToFigma": {
         "command": "npx",
         "args": ["-p", "claude-talk-to-figma-mcp@latest", "claude-talk-to-figma-mcp-server"]
       }
     }
   }
   ```

4. Save and click **Refresh** in the Cascade panel.

### 4.6 VS Code with GitHub Copilot

GitHub Copilot must be enabled on the account.

**Option A: command line**

```bash
code --add-mcp "{\"name\":\"ClaudeTalkToFigma\",\"command\":\"npx\",\"args\":[\"-p\",\"claude-talk-to-figma-mcp@latest\",\"claude-talk-to-figma-mcp-server\"]}"
```

**Option B: Command Palette**

1. Open the Command Palette (`Cmd+Shift+P` or `Ctrl+Shift+P`).
2. Run **MCP: Add Server**.
3. Select **Command (stdio)**.
4. Command: `npx`
5. Arguments: `-p claude-talk-to-figma-mcp@latest claude-talk-to-figma-mcp-server`
6. Name: `ClaudeTalkToFigma`
7. Choose global or workspace scope.

The resulting entry in `mcp.json` (or `.vscode/mcp.json` for a workspace):

```json
{
  "servers": {
    "ClaudeTalkToFigma": {
      "type": "stdio",
      "command": "npx",
      "args": ["-p", "claude-talk-to-figma-mcp@latest", "claude-talk-to-figma-mcp-server"]
    }
  }
}
```

Type `#` in the Copilot chat to list the available tools.

### 4.7 Cline

1. Open the Cline extension in VS Code.
2. Open **Settings > MCP Servers** (or **Installed > Configure MCP Servers**). This opens `cline_mcp_settings.json`:
   - macOS: `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
   - Windows: `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`
3. Add under `mcpServers`:

   ```json
   {
     "mcpServers": {
       "ClaudeTalkToFigma": {
         "command": "npx",
         "args": ["-p", "claude-talk-to-figma-mcp@latest", "claude-talk-to-figma-mcp-server"],
         "disabled": false,
         "alwaysAllow": []
       }
     }
   }
   ```

4. Save. Cline detects the server automatically.

### 4.8 Roo Code

1. Open Roo Code in VS Code.
2. Click the MCP icon in the Roo Code panel.
3. Select **Edit MCP Settings** to open `mcp_settings.json`:
   - macOS: `~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json`
   - Windows: `%APPDATA%\Code\User\globalStorage\rooveterinaryinc.roo-cline\settings\mcp_settings.json`
4. Add under `mcpServers`:

   ```json
   {
     "mcpServers": {
       "ClaudeTalkToFigma": {
         "command": "npx",
         "args": ["-p", "claude-talk-to-figma-mcp@latest", "claude-talk-to-figma-mcp-server"],
         "disabled": false,
         "alwaysAllow": []
       }
     }
   }
   ```

5. Save and restart Roo Code.

Roo Code also reads a per-project `.roo/mcp.json` with the same structure.

## 5. Optional: Figma personal access token

The plugin tools operate on the file that is open in Figma. A personal access token additionally enables the 5 REST API tools ([Commands, section 14](COMMANDS.md#14-rest-api-5)), which read and render any file the token's owner can open, without the plugin. The REST API cannot modify document content; all edits go through the plugin.

### 5.1 Create the token

In Figma, open **Settings > Security > Personal access tokens > Generate new token** and grant at least:

| Scope | Access | Used by |
|---|---|---|
| File content | Read | `rest_get_file`, `rest_render_image` |
| Comments | Write | `rest_post_comment` (reading comments works with either setting) |

Figma shows the token only once.

### 5.2 Provide the token to the MCP server

**DXT (section 4.1, option A):** paste the token into the extension's **Figma personal access token** setting. It is stored in the operating system keychain.

**JSON configuration (any client):** add an `env` block to the server entry:

```json
{
  "mcpServers": {
    "ClaudeTalkToFigma": {
      "command": "npx",
      "args": ["-p", "claude-talk-to-figma-mcp@latest", "claude-talk-to-figma-mcp-server"],
      "env": {
        "FIGMA_PERSONAL_TOKEN": "figd_your_token_here"
      }
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add ClaudeTalkToFigma --env FIGMA_PERSONAL_TOKEN=figd_your_token_here \
  -- npx -p claude-talk-to-figma-mcp@latest claude-talk-to-figma-mcp-server
```

Restart the client and run `rest_whoami` to confirm the token works. The server also accepts `FIGMA_API_TOKEN`, `FIGMA_TOKEN` or `--figma-token=`.

The token grants access to every file the account can open. Store it in the keychain or an environment variable rather than in a shared `mcp.json`, and revoke it in Figma settings when it is no longer needed.
