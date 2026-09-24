/**
 * Integration tests for create_node_tree and update_nodes. The Figma
 * transport is mocked; these verify the calls the handlers send to the plugin
 * (font lookup, normalized payload) and how results and errors come back.
 */
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { NO_FONTS_MESSAGE, registerNodeTreeTools } from '../../src/talk_to_figma_mcp/tools/node-tree-tools';
import { filterFigmaNode } from '../../src/talk_to_figma_mcp/utils/figma-helpers';
import { pricingCardNode } from '../fixtures/rest-nodes';

jest.mock('../../src/talk_to_figma_mcp/utils/websocket', () => ({
  sendCommandToFigma: jest.fn(),
  joinChannel: jest.fn(),
  AUTO_CHANNEL: '__auto__',
}));

const handlers = new Map<string, { handler: Function; schema: z.ZodObject<any> }>();
let mockSend: jest.Mock;

const INTER = { family: 'Inter', styles: ['Regular', 'Medium', 'Semi Bold', 'Bold'] };

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

  registerNodeTreeTools(server);
});

async function call(name: string, args: any) {
  const entry = handlers.get(name);
  if (!entry) throw new Error(`tool not registered: ${name}`);
  return entry.handler(entry.schema.parse(args), { meta: {} });
}

const textOf = (result: any) => result.content.map((c: any) => c.text).join('\n');

describe('create_node_tree', () => {
  it('looks up fonts, sends the normalized tree and reports the new IDs', async () => {
    mockSend
      .mockResolvedValueOnce({ fonts: { Inter: INTER } })
      .mockResolvedValueOnce({ rootId: '50:1', ids: { '10:1': '50:1', '10:2': '50:2' }, created: 2, warnings: ['tree.children[5] ("Photo"): image a1b2 is not in this file; the image fill was skipped'] });

    const result = await call('create_node_tree', { parentId: '0:1', tree: filterFigmaNode(pricingCardNode()) });

    expect(mockSend).toHaveBeenNthCalledWith(1, 'get_available_fonts', { families: ['Inter'] }, expect.any(Number));
    const [command, params] = mockSend.mock.calls[1];
    expect(command).toBe('create_node_tree');
    expect(params.parentId).toBe('0:1');
    expect(params.index).toBeUndefined();
    expect(params.tree).toMatchObject({ key: '10:1', create: { kind: 'new', type: 'FRAME' }, layout: { layoutMode: 'VERTICAL' } });
    expect(params.fonts).toEqual([
      { family: 'Inter', style: 'Semi Bold' },
      { family: 'Inter', style: 'Regular' },
      { family: 'Inter', style: 'Bold' },
    ]);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      rootId: '50:1',
      created: 2,
      ids: { '10:1': '50:1', '10:2': '50:2' },
      warnings: [
        'tree.children[4] ("Old price"): skipped; get_node_info returns only the id, name and type of hidden layers',
        'tree.children[5] ("Photo"): image a1b2 is not in this file; the image fill was skipped',
      ],
    });
    const text = textOf(result);
    expect(text).toContain('Created 2 node(s) under 0:1; the root is 50:1.');
    expect(text).toContain('IDs: {"10:1":"50:1","10:2":"50:2"}');
    expect(text).toContain('  - tree.children[4] ("Old price"): skipped');
  });

  it('skips the font lookup for a tree without text, and accepts JSON strings', async () => {
    mockSend.mockResolvedValueOnce({ rootId: '50:1', ids: { tree: '50:1' }, created: 1, warnings: [] });

    await call('create_node_tree', { parentId: '0:1', tree: JSON.stringify({ type: 'RECTANGLE', width: 10, height: 10 }), index: '2' });

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(
      'create_node_tree',
      {
        parentId: '0:1',
        index: 2,
        tree: { label: 'tree', key: 'tree', create: { kind: 'new', type: 'RECTANGLE' }, size: { width: 10, height: 10 }, props: { fills: [] } },
        fonts: [],
      },
      expect.any(Number)
    );
  });

  it('returns a validation error with its path and sends nothing', async () => {
    const result = await call('create_node_tree', { parentId: '0:1', tree: { type: 'FRAME', children: [{ type: 'TEXT', fill: '#fff' }] } });

    expect(mockSend).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Error creating the node tree: at tree.children[0]: Unrecognized key(s) in object: 'fill'");
  });

  it('reports a font family that Figma does not have', async () => {
    mockSend.mockResolvedValueOnce({ fonts: { Nope: null } });

    const result = await call('create_node_tree', { parentId: '0:1', tree: { type: 'TEXT', characters: 'a', style: { fontFamily: 'Nope' } } });

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('font family "Nope" is not available in Figma');
  });

  it('passes similar families from the plugin into the error', async () => {
    mockSend.mockResolvedValueOnce({ fonts: { Robto: null }, suggestions: { Robto: ['Roboto'] }, fontCount: 120 });

    const result = await call('create_node_tree', { parentId: '0:1', tree: { type: 'TEXT', characters: 'a', style: { fontFamily: 'Robto' } } });

    expect(textOf(result)).toBe(
      'Error creating the node tree: at tree: font family "Robto" is not available in Figma. Similar families: Roboto'
    );
  });

  it('says so when Figma lists no fonts at all', async () => {
    mockSend.mockResolvedValueOnce({ fonts: { Inter: null }, suggestions: { Inter: [] }, fontCount: 0 });

    const result = await call('create_node_tree', { parentId: '0:1', tree: { type: 'TEXT', characters: 'a' } });

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(`Error creating the node tree: ${NO_FONTS_MESSAGE}`);
  });

  it('tells the user to update an older plugin', async () => {
    mockSend.mockRejectedValueOnce(new Error('Unknown command: get_available_fonts'));

    const result = await call('create_node_tree', { parentId: '0:1', tree: { type: 'TEXT', characters: 'a' } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('re-import the plugin (src/claude_mcp_plugin/manifest.json)');
  });

  it('is an error when the root itself cannot be built', async () => {
    const result = await call('create_node_tree', { parentId: '0:1', tree: { type: 'VECTOR' } });

    expect(mockSend).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^Nothing was created\.\nWarnings:\n {2}- tree: skipped; VECTOR nodes are not built from properties/);
  });
});

describe('update_nodes', () => {
  it('sends normalized updates and lists failures and warnings', async () => {
    mockSend
      .mockResolvedValueOnce({ fonts: { Inter: INTER } })
      .mockResolvedValueOnce({
        total: 2, succeeded: 1, failed: 1,
        results: [{ nodeId: '1:2', ok: true }, { nodeId: '9:9', ok: false, error: 'Node not found with ID: 9:9' }],
        warnings: ['updates[0] (node 1:2): layoutSizingHorizontal not set: FILL can only be set on children of auto-layout frames'],
      });

    const result = await call('update_nodes', {
      updates: [
        { nodeId: '1:2', layoutSizingHorizontal: 'FILL', style: { fontFamily: 'Inter', fontWeight: 500 } },
        { nodeId: '9:9', opacity: 0.5 },
      ],
    });

    expect(mockSend).toHaveBeenNthCalledWith(1, 'get_available_fonts', { families: ['Inter'] }, expect.any(Number));
    expect(mockSend).toHaveBeenNthCalledWith(
      2,
      'update_nodes',
      {
        updates: [
          {
            nodeId: '1:2',
            spec: {
              label: 'updates[0] (node 1:2)',
              text: { fontName: { family: 'Inter', style: 'Medium' } },
              childProps: { layoutSizingHorizontal: 'FILL' },
            },
          },
          { nodeId: '9:9', spec: { label: 'updates[1] (node 9:9)', props: { opacity: 0.5 } } },
        ],
        fonts: [{ family: 'Inter', style: 'Medium' }],
      },
      expect.any(Number)
    );
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toBe(
      [
        'Updated 1 of 2 node(s); 1 failed.',
        '  9:9: Node not found with ID: 9:9',
        'Warnings:',
        '  - updates[0] (node 1:2): layoutSizingHorizontal not set: FILL can only be set on children of auto-layout frames',
      ].join('\n')
    );
  });

  it('is an error when no update succeeded', async () => {
    mockSend.mockResolvedValueOnce({
      total: 1, succeeded: 0, failed: 1,
      results: [{ nodeId: '9:9', ok: false, error: 'Node not found with ID: 9:9' }],
      warnings: [],
    });

    const result = await call('update_nodes', { updates: [{ nodeId: '9:9', visible: false }] });

    expect(result.isError).toBe(true);
  });
});
