/**
 * The tools that create_node_tree and update_nodes cover are marked
 * deprecated, and each names a replacement that exists.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from '../../src/talk_to_figma_mcp/tools/index';
import { DEPRECATED_TOOLS } from '../../src/talk_to_figma_mcp/utils/deprecation';

jest.mock('../../src/talk_to_figma_mcp/utils/websocket', () => ({
  sendCommandToFigma: jest.fn(),
  joinChannel: jest.fn(),
  AUTO_CHANNEL: '__auto__',
}));

const descriptions = new Map<string, string>();

beforeAll(() => {
  const server = new McpServer({ name: 'test', version: '1.5.0' }, { capabilities: { tools: {} } });
  const orig = server.registerTool.bind(server);
  jest.spyOn(server, 'registerTool').mockImplementation((...args: any[]) => {
    descriptions.set(args[0], args[1].description ?? '');
    return (orig as any)(...args);
  });
  registerTools(server);
});

describe('deprecated tools', () => {
  it('lists 21 registered tools, each described as deprecated with its replacement', () => {
    const names = Object.keys(DEPRECATED_TOOLS);
    expect(names).toHaveLength(21);
    for (const name of names) {
      expect(descriptions.get(name)).toMatch(new RegExp(`^Deprecated: use ${DEPRECATED_TOOLS[name].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\. \\S`));
    }
  });

  it('names replacements that are registered and not deprecated', () => {
    for (const replacement of Object.values(DEPRECATED_TOOLS)) {
      const tool = replacement.split(' ')[0];
      expect(descriptions.has(tool)).toBe(true);
      expect(DEPRECATED_TOOLS[tool]).toBeUndefined();
    }
  });

  it('marks no other tool as deprecated', () => {
    const marked = [...descriptions].filter(([, description]) => description.startsWith('Deprecated:')).map(([name]) => name);
    expect(marked.sort()).toEqual(Object.keys(DEPRECATED_TOOLS).sort());
  });
});
