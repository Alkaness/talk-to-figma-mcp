/**
 * set_font_weight resolves the weight against the text node's own family,
 * the way create_node_tree does (pickFontStyle in utils/node-spec.ts).
 */
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTextTools } from '../../src/talk_to_figma_mcp/tools/text-tools';
import { NO_FONTS_MESSAGE } from '../../src/talk_to_figma_mcp/tools/node-tree-tools';

jest.mock('../../src/talk_to_figma_mcp/utils/websocket', () => ({
  sendCommandToFigma: jest.fn(),
  joinChannel: jest.fn(),
  AUTO_CHANNEL: '__auto__',
}));

const POPPINS = { family: 'Poppins', styles: ['Regular', 'Medium', 'SemiBold', 'SemiBold Italic', 'Bold'] };
const textNode = (style: object) => ({ id: '1:2', name: 'Title', type: 'TEXT', characters: 'Hi', style });

let mockSend: jest.Mock;
let handler: Function;
let schema: z.ZodObject<any>;

beforeEach(() => {
  mockSend = require('../../src/talk_to_figma_mcp/utils/websocket').sendCommandToFigma;
  mockSend.mockReset();
  const server = new McpServer({ name: 'test', version: '1.5.0' }, { capabilities: { tools: {} } });
  const orig = server.registerTool.bind(server);
  jest.spyOn(server, 'registerTool').mockImplementation((...args: any[]) => {
    if (args[0] === 'set_font_weight') {
      handler = args[2];
      schema = z.object(args[1].inputSchema);
    }
    return (orig as any)(...args);
  });
  registerTextTools(server);
});

const call = (args: object) => handler(schema.parse(args), { meta: {} });
const textOf = (result: any) => result.content.map((c: any) => c.text).join('\n');

describe('set_font_weight', () => {
  it("sends the family's own style name", async () => {
    mockSend
      .mockResolvedValueOnce(textNode({ fontFamily: 'Poppins', fontWeight: 400 }))
      .mockResolvedValueOnce({ fonts: { Poppins: POPPINS }, suggestions: {}, fontCount: 20 })
      .mockResolvedValueOnce({ name: 'Title', fontName: { family: 'Poppins', style: 'SemiBold' }, weight: 600 });

    const result = await call({ nodeId: '1:2', weight: 600 });

    expect(mockSend.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ['get_node_info', { nodeId: '1:2', depth: 0 }],
      ['get_available_fonts', { families: ['Poppins'] }],
      ['set_font_weight', { nodeId: '1:2', weight: 600, family: 'Poppins', style: 'SemiBold' }],
    ]);
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toBe('Updated font weight of node "Title" to 600 (Poppins SemiBold)');
  });

  it('keeps italic, and names the style it used when the weight is missing', async () => {
    mockSend
      .mockResolvedValueOnce(textNode({ fontFamily: 'Poppins', fontWeight: 400, italic: true }))
      .mockResolvedValueOnce({ fonts: { Poppins: POPPINS }, fontCount: 20 })
      .mockResolvedValueOnce({ name: 'Title', fontName: { family: 'Poppins', style: 'SemiBold Italic' }, weight: 700 });

    const result = await call({ nodeId: '1:2', weight: 700 });

    expect(mockSend.mock.calls[2][1]).toEqual({ nodeId: '1:2', weight: 700, family: 'Poppins', style: 'SemiBold Italic' });
    expect(textOf(result)).toBe(
      'Updated font weight of node "Title" to 700 (Poppins SemiBold Italic). Poppins has no weight 700 italic style; used "SemiBold Italic"'
    );
  });

  it('rejects a node that is not text, and a session without fonts', async () => {
    mockSend.mockResolvedValueOnce({ id: '1:3', name: 'Box', type: 'RECTANGLE' });
    expect(textOf(await call({ nodeId: '1:3', weight: 700 }))).toBe('Error setting font weight: Node is not a text node: 1:3');

    mockSend
      .mockResolvedValueOnce(textNode({ fontFamily: 'Inter' }))
      .mockResolvedValueOnce({ fonts: { Inter: null }, suggestions: { Inter: [] }, fontCount: 0 });
    const result = await call({ nodeId: '1:2', weight: 700 });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(`Error setting font weight: ${NO_FONTS_MESSAGE}`);
    expect(mockSend).toHaveBeenCalledTimes(3);
  });
});
