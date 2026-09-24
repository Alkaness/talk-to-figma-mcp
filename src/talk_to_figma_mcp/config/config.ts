import { logger } from "../utils/logger";

// Argumentos de línea de comandos
const args = process.argv.slice(2);
const serverArg = args.find(arg => arg.startsWith('--server='));
const portArg = args.find(arg => arg.startsWith('--port='));
const reconnectArg = args.find(arg => arg.startsWith('--reconnect-interval='));

// Parse a positive integer CLI value, falling back (with a warning) on
// malformed input. A NaN here would otherwise drive an endless failing
// connect loop (NaN port) or a ~0ms hot retry loop (NaN interval).
function parsePositiveInt(raw: string | undefined, fallback: number, label: string, max = Number.MAX_SAFE_INTEGER): number {
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0 || n > max) {
    logger.warn(`Invalid value "${raw}" for ${label} — using default ${fallback}`);
    return fallback;
  }
  return n;
}

// Configuración de conexión extraída de argumentos CLI
export const serverUrl = serverArg ? serverArg.split('=')[1] : 'localhost';
export const defaultPort = parsePositiveInt(portArg?.split('=')[1], 3055, '--port', 65535);
export const reconnectInterval = parsePositiveInt(reconnectArg?.split('=')[1], 2000, '--reconnect-interval');

// URL de WebSocket basada en el servidor (WS para localhost, WSS para remoto).
// Local connections target 127.0.0.1 explicitly: the relay binds IPv4 loopback,
// and "localhost" may resolve to ::1 first (macOS), which would be refused.
export const WS_URL = serverUrl === 'localhost' ? 'ws://127.0.0.1' : `wss://${serverUrl}`;

// Configuración del servidor MCP (Implementation info)
export const SERVER_CONFIG = {
  name: "TalkToFigmaMCP",
  description: "MCP server for the Talk to Figma plugin",
  version: "1.6.0",
};

// Instructions surfaced to the MCP client (Claude) during initialization.
// These remove the "connection handshake" friction: Claude should call Figma
// tools directly instead of asking the user for a channel ID.
export const SERVER_INSTRUCTIONS = `This server reads from and writes to the user's live Figma file via the "Talk to Figma" plugin.

CONNECTION IS ZERO-CONFIG. As long as the user has the plugin open and connected, you can call any Figma tool directly. Do NOT ask the user for a "channel ID" and do NOT call join_channel first — commands are auto-routed to the connected plugin.

If a tool returns an error indicating no plugin is connected, tell the user: "Open the Talk to Figma plugin in your Figma file and click Connect," then retry.

Only call join_channel when a tool reports that MULTIPLE Figma files are connected and you need to disambiguate which file to target.

TO BUILD OR CHANGE DESIGNS, prefer create_node_tree, which builds a whole subtree in one call, and update_nodes, which changes many properties of many nodes in one call. Both take the format that get_node_info returns: auto-layout with FILL and HUG sizing, fonts by family and weight, hex colors and text runs. Read the warnings in their results, then check the design once with get_visual_snapshot.`;