/**
 * The plugin's node tree code (src/claude_mcp_plugin/code.js) run against a
 * fake Figma (fake-figma.ts). Specs go through the server's real normalizer
 * first, so these cover the path from get_node_info output to the canvas.
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';

import { FakeFigma, FakeFigmaOptions, FakeNode, FontName } from './fake-figma';
import { filterFigmaNode } from '../../src/talk_to_figma_mcp/utils/figma-helpers';
import {
  fontFamiliesOf,
  normalizeNodeTree,
  normalizeNodeUpdates,
  parseNodeSpec,
  parseNodeUpdates,
} from '../../src/talk_to_figma_mcp/utils/node-spec';
import { DESIGN_STRATEGY_EXAMPLE } from '../../src/talk_to_figma_mcp/prompts/index';
import { pricingCardNode } from '../fixtures/rest-nodes';

const CODE = fs.readFileSync(path.join(__dirname, '../../src/claude_mcp_plugin/code.js'), 'utf8');

const styles = (family: string, names: string[]): FontName[] => names.map((style) => ({ family, style }));
const FONTS = [
  ...styles('Inter', ['Regular', 'Medium', 'Semi Bold', 'Bold']),
  ...styles('Poppins', ['Regular', 'Medium', 'SemiBold', 'Bold']),
  ...styles('Roboto', ['Regular', 'Bold']),
  ...styles('Roboto Mono', ['Regular']),
];
const PHOTO_HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

interface Plugin {
  figma: FakeFigma;
  page: FakeNode;
  run: (command: string, params?: Record<string, unknown>) => Promise<any>;
  /** create_node_tree as the MCP tool runs it: font lookup, normalizer, plugin. */
  createTree: (spec: unknown, parentId?: string) => Promise<{ rootId: string | null; ids: Record<string, string>; created: number; warnings: string[] }>;
  /** update_nodes as the MCP tool runs it. */
  updateNodes: (updates: unknown) => Promise<{ total: number; succeeded: number; results: any[]; warnings: string[] }>;
}

function loadPlugin(options: FakeFigmaOptions = {}): Plugin {
  const figma = new FakeFigma({ fonts: FONTS, ...options });
  const context = vm.createContext({ figma, __html__: '', console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout });
  vm.runInContext(CODE, context, { filename: 'code.js' });
  const handleCommand = context.handleCommand as (command: string, params: unknown) => Promise<any>;
  const run = (command: string, params: Record<string, unknown> = {}) => handleCommand(command, params);
  return {
    figma,
    page: figma.currentPage,
    run,
    async createTree(spec, parentId = figma.currentPage.id) {
      const parsed = parseNodeSpec(spec);
      const lookup = await run('get_available_fonts', { families: fontFamiliesOf([parsed], 'create') });
      const normalized = normalizeNodeTree(parsed, lookup.fonts, lookup.suggestions);
      const result = await run('create_node_tree', { parentId, tree: normalized.tree, fonts: normalized.fonts });
      return { ...result, warnings: [...normalized.warnings, ...result.warnings] };
    },
    async updateNodes(updates) {
      const parsed = parseNodeUpdates(updates);
      const lookup = await run('get_available_fonts', { families: fontFamiliesOf(parsed, 'update') });
      const normalized = normalizeNodeUpdates(parsed, lookup.fonts, lookup.suggestions);
      const result = await run('update_nodes', { updates: normalized.updates, fonts: normalized.fonts });
      return { ...result, warnings: [...normalized.warnings, ...result.warnings] };
    },
  };
}

const node = (plugin: Plugin, id: string | null | undefined) => plugin.figma.nodes.get(id as string) as any;
const named = (parent: any, name: string) => parent.children.find((child: any) => child.name === name);
/** A node's box relative to another node's box. */
const offset = (child: any, parent: any) => {
  const a = child.absoluteBoundingBox;
  const b = parent.absoluteBoundingBox ?? { x: 0, y: 0 };
  return { x: Math.round((a.x - b.x) * 100) / 100, y: Math.round((a.y - b.y) * 100) / 100 };
};

describe('create_node_tree in the plugin', () => {
  it('rebuilds the pricing card from get_node_info output', async () => {
    const plugin = loadPlugin({ images: [PHOTO_HASH] });
    plugin.figma.add('INSTANCE', plugin.page, { name: 'Icon/check' }, '10:5');

    const result = await plugin.createTree(filterFigmaNode(pricingCardNode()));

    expect(result.warnings).toEqual([
      'tree.children[4] ("Old price"): skipped; get_node_info returns only the id, name and type of hidden layers',
    ]);
    expect(Object.keys(result.ids)).toEqual(['10:1', '10:2', '10:3', '10:4', '10:5', '10:7']);
    const card = node(plugin, result.rootId);
    expect(card).toMatchObject({
      name: 'Pricing card',
      layoutMode: 'VERTICAL',
      primaryAxisSizingMode: 'AUTO',
      counterAxisSizingMode: 'FIXED',
      layoutSizingVertical: 'HUG',
      width: 360,
      strokesIncludedInLayout: false,
      strokeAlign: 'INSIDE',
      topLeftRadius: 16,
      bottomRightRadius: 0,
      opacity: 0.96,
      clipsContent: true,
    });
    expect(card.effects[0]).toMatchObject({ type: 'DROP_SHADOW', showShadowBehindNode: false });

    const plan = named(card, 'Plan');
    expect(plan).toMatchObject({ layoutSizingHorizontal: 'FILL', textAutoResize: 'HEIGHT', width: 312, textCase: 'UPPER', characters: 'Pro' });
    expect(plan.fontName).toEqual({ family: 'Inter', style: 'Semi Bold' });

    const price = named(card, 'Price');
    expect(price.getRangeFontName(0, 3)).toEqual({ family: 'Inter', style: 'Bold' });
    expect(price.getRangeFontName(3, 10)).toEqual({ family: 'Inter', style: 'Regular' });
    expect(price.rangeCalls).toContainEqual(['setRangeFontSize', 0, 3, 48]);

    // Placed after the card reached its final height, so its RIGHT constraint did not move it.
    const badge = named(card, 'Badge');
    expect(badge).toMatchObject({ layoutPositioning: 'ABSOLUTE', constraints: { horizontal: 'MAX', vertical: 'MIN' } });
    expect(offset(badge, card)).toEqual({ x: 280, y: 12 });

    expect(named(card, 'Icon/check')).toMatchObject({ type: 'INSTANCE', rotation: 0 });
    expect(named(card, 'Photo').fills).toEqual([{ type: 'IMAGE', imageHash: PHOTO_HASH, scaleMode: 'FILL' }]);
  });

  it('builds the example tree of the design_strategy prompt as intended', async () => {
    const plugin = loadPlugin();

    const result = await plugin.createTree(DESIGN_STRATEGY_EXAMPLE);

    expect(result.warnings).toEqual([]);
    const card = node(plugin, result.rootId);
    expect(card).toMatchObject({ width: 400, layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'HUG' });
    const [title, email, button] = card.children;
    expect(title).toMatchObject({ layoutSizingHorizontal: 'FILL', textAutoResize: 'HEIGHT', width: 336 });
    expect(title.fontName).toEqual({ family: 'Inter', style: 'Bold' });
    expect(email).toMatchObject({ width: 336, height: 44, layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'FIXED', strokeAlign: 'INSIDE' });
    expect(button).toMatchObject({ width: 336, layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG' });
    expect(button.children[0].fontName).toEqual({ family: 'Inter', style: 'Semi Bold' });
    expect(result.ids.signIn).toBe(button.id);
  });

  it('places an absolute child after its HUG parent has grown', async () => {
    const plugin = loadPlugin();

    const result = await plugin.createTree({
      type: 'FRAME', layoutMode: 'VERTICAL', itemSpacing: 10, paddingTop: 10, paddingRight: 10, paddingBottom: 10, paddingLeft: 10,
      children: [
        { type: 'RECTANGLE', name: 'badge', width: 20, height: 20, layoutPositioning: 'ABSOLUTE', x: 170, y: 150, constraints: { horizontal: 'RIGHT', vertical: 'BOTTOM' } },
        { type: 'RECTANGLE', width: 180, height: 60 },
        { type: 'RECTANGLE', width: 120, height: 100 },
      ],
    });

    const frame = node(plugin, result.rootId);
    expect([frame.width, frame.height]).toEqual([200, 190]);
    expect(offset(named(frame, 'badge'), frame)).toEqual({ x: 170, y: 150 });
  });

  it('keeps the offsets of group children inside auto-layout and removes the scratch frame', async () => {
    const plugin = loadPlugin();

    const result = await plugin.createTree({
      type: 'FRAME', layoutMode: 'VERTICAL', itemSpacing: 8,
      children: [
        { type: 'RECTANGLE', width: 100, height: 20 },
        { type: 'GROUP', name: 'G', children: [
          { type: 'RECTANGLE', name: 'g1', x: 0, y: 0, width: 40, height: 40 },
          { type: 'ELLIPSE', name: 'g2', x: 30, y: 25, width: 50, height: 30 },
        ] },
      ],
    });

    const group = named(node(plugin, result.rootId), 'G');
    expect(group.type).toBe('GROUP');
    expect(offset(named(group, 'g2'), group)).toEqual({ x: 30, y: 25 });
    expect(offset(group, node(plugin, result.rootId))).toEqual({ x: 0, y: 28 });
    expect(plugin.figma.descendants().filter((n) => n.name === 'create_node_tree scratch')).toEqual([]);
  });

  it('rebuilds a rotated group unrotated, with its children where they were', async () => {
    const plugin = loadPlugin();

    // A group rotated 30 degrees: its box is larger than its children, which start at 10, 20.
    const result = await plugin.createTree({
      type: 'FRAME', width: 300, height: 300,
      children: [{
        type: 'GROUP', name: 'G', rotation: 30, width: 80, height: 90, parentOffset: { x: 100, y: 50 },
        children: [
          { type: 'RECTANGLE', name: 'a', rotation: 30, width: 20, height: 20, parentOffset: { x: 10, y: 20 } },
          { type: 'RECTANGLE', name: 'b', width: 20, height: 20, parentOffset: { x: 40, y: 60 } },
        ],
      }],
    });

    const frame = node(plugin, result.rootId);
    const group = named(frame, 'G');
    expect(group.rotation).toBe(0);
    expect(named(group, 'a').rotation).toBe(30);
    expect(offset(named(group, 'a'), frame)).toEqual({ x: 110, y: 70 });
    expect(offset(named(group, 'b'), frame)).toEqual({ x: 140, y: 110 });
  });

  it('resets the rotation of a clone and keeps the size it already has', async () => {
    const plugin = loadPlugin();
    const source = plugin.figma.add('VECTOR', plugin.page, { name: 'arrow' }, '5:5');
    source.store.rotation = 147.68; // a child of a rotated group keeps a rotation relative to the group
    const line = plugin.figma.add('VECTOR', plugin.page, { name: 'rule' }, '5:6');
    line.store.w = 0; // a vertical rule is 0 wide
    line.store.h = 30;

    const result = await plugin.createTree({
      type: 'FRAME', width: 100, height: 100,
      children: [
        { type: 'VECTOR', id: '5:5', name: 'arrow', parentOffset: { x: 10, y: 10 }, absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 } },
        { type: 'VECTOR', id: '5:6', name: 'rule', parentOffset: { x: 50, y: 0 }, absoluteBoundingBox: { x: 0, y: 0, width: 0, height: 30 } },
      ],
    });

    expect(result.warnings).toEqual([]);
    const frame = node(plugin, result.rootId);
    expect(named(frame, 'arrow').rotation).toBe(0);
    expect(offset(named(frame, 'arrow'), frame)).toEqual({ x: 10, y: 10 });
    expect([named(frame, 'rule').width, named(frame, 'rule').height]).toEqual([0, 30]);
  });

  it('names the path of a node that fails deep in the tree and leaves nothing behind', async () => {
    const plugin = loadPlugin();
    plugin.figma.add('FRAME', plugin.page, { name: 'existing' });
    const before = plugin.figma.descendants().length;

    const failing = plugin.createTree({
      type: 'FRAME', width: 100, height: 100,
      children: [{
        type: 'FRAME', width: 50, height: 50,
        children: [
          { type: 'RECTANGLE', width: 10, height: 10 },
          { type: 'GROUP', children: [
            { type: 'RECTANGLE', width: 5, height: 5 },
            { type: 'VECTOR', name: 'bad', svg: "<svg><path d='M 0 0 L'></svg" },
          ] },
        ],
      }],
    });

    await expect(failing).rejects.toThrow(
      'at tree.children[0].children[1].children[1] ("bad"): in createNodeFromSvg: Failed to convert SVG file'
    );
    expect(plugin.figma.descendants().length).toBe(before);
  });

  it('stops before creating anything when a font cannot be loaded', async () => {
    const plugin = loadPlugin();
    const tree = normalizeNodeTree(parseNodeSpec({ type: 'TEXT', characters: 'a', style: { fontFamily: 'Inter', fontStyle: 'Black' } }), {
      Inter: { family: 'Inter', styles: ['Black'] },
    }).tree;

    await expect(plugin.run('create_node_tree', { parentId: plugin.page.id, tree, fonts: [{ family: 'Inter', style: 'Black' }] })).rejects.toThrow(
      'Could not load font(s): Inter Black'
    );
    expect(plugin.figma.descendants()).toEqual([]);
  });

  it('accepts every property the server emits', async () => {
    const plugin = loadPlugin({ images: [PHOTO_HASH] });
    const paint = { type: 'IMAGE', imageRef: PHOTO_HASH, scaleMode: 'FILL', filters: { contrast: 0.5 } };

    const result = await plugin.createTree({
      type: 'FRAME', layoutMode: 'HORIZONTAL', layoutWrap: 'WRAP', itemSpacing: 4, counterAxisSpacing: 6,
      paddingTop: 1, paddingRight: 2, paddingBottom: 3, paddingLeft: 4,
      primaryAxisAlignItems: 'SPACE_BETWEEN', counterAxisAlignItems: 'CENTER', counterAxisAlignContent: 'SPACE_BETWEEN',
      primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'AUTO', itemReverseZIndex: true, strokesIncludedInLayout: true,
      width: 400, fills: ['#FFFFFF', paint], strokes: ['#000000'], strokeWeight: 2, strokeAlign: 'OUTSIDE',
      individualStrokeWeights: { top: 1, right: 2, bottom: 3, left: 4 }, strokeDashes: [4, 2],
      cornerRadius: 8, rectangleCornerRadii: [1, 2, 3, 4], cornerSmoothing: 0.6, opacity: 0.9, blendMode: 'MULTIPLY',
      isMask: false, clipsContent: true, visible: true,
      effects: [
        { type: 'DROP_SHADOW', color: '#0000001A', offset: { x: 0, y: 2 }, radius: 4 },
        { type: 'INNER_SHADOW', color: '#000', radius: 1 },
        { type: 'LAYER_BLUR', radius: 2 },
      ],
      children: [
        { type: 'RECTANGLE', layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'FIXED', minWidth: 10, maxWidth: 300, minHeight: 5, maxHeight: 50 },
        { type: 'RECTANGLE', layoutGrow: 1, layoutAlign: 'STRETCH' },
        { type: 'ELLIPSE', layoutPositioning: 'ABSOLUTE', x: 5, y: 5, constraints: { horizontal: 'SCALE', vertical: 'CENTER' }, rotation: 15 },
        {
          type: 'TEXT', characters: 'Hello world',
          style: {
            fontFamily: 'Poppins', fontWeight: 500, fontSize: 14, lineHeightPx: 20, letterSpacing: 0.5, textCase: 'TITLE',
            textDecoration: 'UNDERLINE', textAlignHorizontal: 'CENTER', textAlignVertical: 'CENTER', paragraphSpacing: 4,
            paragraphIndent: 2, textTruncation: 'ENDING', maxLines: 2, hyperlink: { type: 'URL', url: 'https://example.com' },
            textAutoResize: 'HEIGHT',
          },
          layoutSizingHorizontal: 'HUG',
          textRuns: [{
            start: 0, end: 5, fontWeight: 700, fontSize: 18, lineHeightPercentFontSize: 120, letterSpacing: 0,
            textCase: 'UPPER', textDecoration: 'NONE', hyperlink: { type: 'URL', url: 'https://example.org' }, fills: ['#FF0000'],
          }],
        },
      ],
    });

    expect(result.warnings).toEqual([]);
    const frame = node(plugin, result.rootId);
    expect(frame).toMatchObject({ layoutWrap: 'WRAP', strokeTopWeight: 1, strokeLeftWeight: 4, dashPattern: [4, 2], topLeftRadius: 1, bottomLeftRadius: 4, blendMode: 'MULTIPLY' });
    const text = frame.children[3];
    expect(text).toMatchObject({ textTruncation: 'ENDING', maxLines: 2, hyperlink: { type: 'URL', value: 'https://example.com' } });
    expect(text.rangeCalls.map((call: unknown[]) => call[0])).toEqual([
      'setRangeFontName', 'setRangeFontSize', 'setRangeLineHeight', 'setRangeLetterSpacing',
      'setRangeTextCase', 'setRangeTextDecoration', 'setRangeHyperlink', 'setRangeFills',
    ]);
  });
});

describe('update_nodes in the plugin', () => {
  function textInStack(plugin: Plugin) {
    const stack = plugin.figma.add('FRAME', plugin.page, { layoutMode: 'VERTICAL' });
    stack.resize(300, 100);
    const text = plugin.figma.add('TEXT', stack, {}, '8:1');
    // "Hello world" in Inter Regular with "world" in Inter Bold, as the file had it.
    text.store.chars = 'Hello world';
    text.store.fonts = 'Hello world'.split('').map((_, i) => ({ family: 'Inter', style: i >= 6 ? 'Bold' : 'Regular' }));
    return { stack, text: text as any };
  }

  it('sets FILL, a new font and runs on mixed-font text', async () => {
    const plugin = loadPlugin();
    const { text } = textInStack(plugin);

    const result = await plugin.updateNodes([
      { nodeId: '8:1', layoutSizingHorizontal: 'FILL', style: { fontFamily: 'Poppins', fontWeight: 600 }, textRuns: [{ start: 0, end: 5, fontWeight: 700 }] },
    ]);

    expect(result).toMatchObject({ total: 1, succeeded: 1, warnings: [] });
    expect(text.layoutSizingHorizontal).toBe('FILL');
    expect(text.width).toBe(300);
    expect(text.getRangeFontName(0, 5)).toEqual({ family: 'Poppins', style: 'Bold' });
    expect(text.getRangeFontName(5, 11)).toEqual({ family: 'Poppins', style: 'SemiBold' });
  });

  it('loads the fonts a text already uses before changing its characters', async () => {
    const plugin = loadPlugin();
    const { text } = textInStack(plugin);

    const result = await plugin.updateNodes([{ nodeId: '8:1', characters: 'Bye' }]);

    expect(result.succeeded).toBe(1);
    expect(text.characters).toBe('Bye');
  });

  it('reports a node it cannot find and changes the others', async () => {
    const plugin = loadPlugin();
    const target = plugin.figma.add('RECTANGLE', plugin.page, {}, '8:2');

    const result = await plugin.updateNodes([{ nodeId: '9:9', opacity: 0.5 }, { nodeId: '8:2', opacity: 0.5, rotation: 45 }]);

    expect(result.results).toEqual([
      { nodeId: '9:9', ok: false, error: 'Node not found with ID: 9:9' },
      { nodeId: '8:2', ok: true },
    ]);
    expect([target.opacity, target.rotation]).toEqual([0.5, 45]);
  });
});

describe('other commands in the plugin', () => {
  it('batch_operations returns the ID of every frame it creates', async () => {
    const plugin = loadPlugin();

    const result = await plugin.run('batch_operations', {
      operations: [
        { command: 'create_frame', params: { parentId: plugin.page.id, x: 0, y: 0, width: 50, height: 50, name: 'one' } },
        { command: 'create_frame', params: { parentId: plugin.page.id, x: 60, y: 0, width: 50, height: 50, name: 'two' } },
      ],
    });

    const ids = plugin.page.children.map((child) => child.id);
    expect(result).toMatchObject({ total: 2, succeeded: 2, failed: 0 });
    expect(result.results.map((entry: any) => entry.id)).toEqual(ids);
  });

  it('get_available_fonts lists styles, and similar families for a missing one', async () => {
    const plugin = loadPlugin();

    const result = await plugin.run('get_available_fonts', { families: ['poppins', 'Robto'] });

    expect(result).toEqual({
      fonts: { poppins: { family: 'Poppins', styles: ['Regular', 'Medium', 'SemiBold', 'Bold'] }, Robto: null },
      suggestions: { Robto: ['Roboto'] },
      fontCount: 4,
    });
  });
});
