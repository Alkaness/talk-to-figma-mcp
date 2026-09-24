/**
 * The 24 tools that create_node_tree and update_nodes cover were deprecated in
 * 1.6.0 and removed in the following release. Their plugin commands stay: batch_operations and
 * 1.6.0 servers still send them.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from '../../src/talk_to_figma_mcp/tools/index';

jest.mock('../../src/talk_to_figma_mcp/utils/websocket', () => ({
  sendCommandToFigma: jest.fn(),
  joinChannel: jest.fn(),
  AUTO_CHANNEL: '__auto__',
}));

// With a token the REST API tools register too, so every registerTool call is counted.
jest.mock('../../src/talk_to_figma_mcp/utils/figma-rest', () => ({
  ...jest.requireActual('../../src/talk_to_figma_mcp/utils/figma-rest'),
  hasRestToken: () => true,
}));

const REMOVED = [
  'set_fill_color', 'set_stroke_color', 'set_gradient', 'set_effects', 'set_auto_layout',
  'move_node', 'resize_node', 'rename_node', 'set_node_properties', 'set_corner_radius',
  'set_font_name', 'set_font_weight', 'set_font_size', 'set_line_height', 'set_paragraph_spacing',
  'set_text_align', 'set_text_case', 'set_text_decoration', 'set_text_content', 'set_multiple_text_contents',
  'create_frame', 'create_rectangle', 'create_ellipse', 'create_text',
];

const descriptions = new Map<string, string>();

beforeAll(() => {
  const server = new McpServer({ name: 'test', version: 'test' }, { capabilities: { tools: {} } });
  const orig = server.registerTool.bind(server);
  jest.spyOn(server, 'registerTool').mockImplementation((...args: any[]) => {
    descriptions.set(args[0], args[1].description ?? '');
    return (orig as any)(...args);
  });
  registerTools(server);
});

describe('removed tools', () => {
  it('registers none of the 24 removed tools and 85 tools in all', () => {
    expect(REMOVED).toHaveLength(24);
    expect(REMOVED.filter((name) => descriptions.has(name))).toEqual([]);
    expect(descriptions.size).toBe(85);
  });

  it('marks no tool as deprecated', () => {
    expect([...descriptions].filter(([, description]) => description.startsWith('Deprecated:'))).toEqual([]);
  });
});
