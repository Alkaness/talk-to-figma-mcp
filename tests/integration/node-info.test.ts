/**
 * Integration tests for get_node_info and get_nodes_info. The Figma transport
 * is mocked with nodes in the REST format (the plugin's JSON_REST_V1 export);
 * these verify that the handlers return the layout, sizing, visibility and
 * text data a 1:1 reproduction needs.
 */
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerDocumentTools } from '../../src/talk_to_figma_mcp/tools/document-tools';
import { pricingCardNode, vectorNode } from '../fixtures/rest-nodes';

jest.mock('../../src/talk_to_figma_mcp/utils/websocket', () => ({
  sendCommandToFigma: jest.fn(),
  joinChannel: jest.fn(),
  AUTO_CHANNEL: '__auto__',
}));

const handlers = new Map<string, { handler: Function; schema: z.ZodObject<any> }>();
let mockSend: jest.Mock;

beforeEach(() => {
  handlers.clear();
  mockSend = require('../../src/talk_to_figma_mcp/utils/websocket').sendCommandToFigma;
  mockSend.mockReset();

  const server = new McpServer({ name: 'test', version: '1.5.0' }, { capabilities: { tools: {} } });
  const orig = server.registerTool.bind(server);
  jest.spyOn(server, 'registerTool').mockImplementation((...args: any[]) => {
    if (args.length === 3) {
      const [name, config, handler] = args;
      handlers.set(name, { handler, schema: z.object(config.inputSchema ?? {}) });
    }
    return (orig as any)(...args);
  });

  registerDocumentTools(server);
});

async function call(name: string, args: any) {
  const entry = handlers.get(name);
  if (!entry) throw new Error(`tool not registered: ${name}`);
  return entry.handler(entry.schema.parse(args), { meta: {} });
}

describe('get_node_info', () => {
  it('returns auto-layout, sizing, parentOffset and text runs', async () => {
    // The plugin adds localPosition to the root node.
    mockSend.mockResolvedValueOnce({ ...pricingCardNode(), localPosition: { x: 40, y: 64 } });

    const res = await call('get_node_info', { nodeId: '10:1', depth: 2 });

    expect(mockSend).toHaveBeenCalledWith('get_node_info', { nodeId: '10:1', depth: 2 });
    expect(res.isError).toBeUndefined();
    const node = res.structuredContent;
    expect(node).toMatchObject({
      layoutMode: 'VERTICAL',
      itemSpacing: 16,
      paddingLeft: 24,
      rectangleCornerRadii: [16, 16, 0, 0],
      localPosition: { x: 40, y: 64 },
    });
    const price = node.children.find((c: any) => c.name === 'Price');
    expect(price.parentOffset).toEqual({ x: 24, y: 69 });
    expect(price.textRuns.map((r: any) => r.text)).toEqual(['$29', ' /month']);
    expect(node._note).toMatch(/parentOffset/);
    expect(JSON.parse(res.content[0].text)).toEqual(node);
  });

  it('defaults depth to 1 and returns deeper children as stubs', async () => {
    mockSend.mockResolvedValueOnce(pricingCardNode());

    const res = await call('get_node_info', { nodeId: '10:1' });

    expect(mockSend).toHaveBeenCalledWith('get_node_info', { nodeId: '10:1', depth: 1 });
    const icon = res.structuredContent.children.find((c: any) => c.name === 'Icon/check');
    expect(icon.children).toEqual([{ id: 'I10:5;3:10', name: 'Vector', type: 'VECTOR' }]);
    expect(icon._childrenTruncated).toBe(true);
  });

  it('returns a VECTOR node instead of an error', async () => {
    mockSend.mockResolvedValueOnce(vectorNode());

    const res = await call('get_node_info', { nodeId: '20:1' });

    expect(res.isError).toBeUndefined();
    expect(res.structuredContent).toMatchObject({ id: '20:1', type: 'VECTOR', fills: [{ type: 'SOLID', color: '#000000' }] });
  });
});

describe('get_nodes_info', () => {
  it('serializes every node in the batch', async () => {
    mockSend.mockResolvedValueOnce([
      { nodeId: '10:1', document: pricingCardNode() },
      { nodeId: '20:1', document: vectorNode() },
    ]);

    const res = await call('get_nodes_info', { nodeIds: ['10:1', '20:1'], depth: 1 });

    expect(mockSend).toHaveBeenCalledWith('get_nodes_info', { nodeIds: ['10:1', '20:1'], depth: 1 });
    const { nodes } = res.structuredContent;
    expect(nodes).toHaveLength(2);
    expect(nodes[0].children.find((c: any) => c.name === 'Old price')).toEqual({
      id: '10:6', name: 'Old price', type: 'TEXT', visible: false,
    });
    expect(nodes[0].children.find((c: any) => c.name === 'Badge').layoutPositioning).toBe('ABSOLUTE');
    expect(nodes[1]).toMatchObject({ id: '20:1', type: 'VECTOR' });
  });
});
