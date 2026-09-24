import {
  AUTO_LAYOUT_PROPS,
  NODE_PROPS,
  STROKE_PROPS,
  TEXT_STYLE_FIELDS,
  filterFigmaNode,
  hexToRgba,
  rgbaToHex,
} from '../../../src/talk_to_figma_mcp/utils/figma-helpers';
import {
  FontCatalog,
  NODE_SPEC_FIELDS,
  NodeSpecError,
  TEXT_STYLE_SPEC_FIELDS,
  fontFamiliesOf,
  gradientTransformFromHandles,
  normalizeNodeTree,
  normalizeNodeUpdates,
  parseFontStyle,
  parseNodeSpec,
  parseNodeUpdates,
  pickFontStyle,
  rotatedBoxOffset,
} from '../../../src/talk_to_figma_mcp/utils/node-spec';
import { DESIGN_STRATEGY_EXAMPLE } from '../../../src/talk_to_figma_mcp/prompts/index';
import { pricingCardNode } from '../../fixtures/rest-nodes';

const INTER = { family: 'Inter', styles: ['Thin', 'Light', 'Regular', 'Italic', 'Medium', 'Semi Bold', 'Bold', 'Bold Italic', 'Black'] };
const POPPINS = { family: 'Poppins', styles: ['Light', 'Regular', 'Medium', 'SemiBold', 'SemiBold Italic', 'Bold'] };
const catalog: FontCatalog = { Inter: INTER, Poppins: POPPINS };

const build = (tree: unknown, fonts: FontCatalog = catalog) => normalizeNodeTree(parseNodeSpec(tree), fonts);
const update = (updates: unknown, fonts: FontCatalog = catalog) => normalizeNodeUpdates(parseNodeUpdates(updates), fonts);
const childNamed = (tree: any, name: string) => tree.children.find((child: any) => child.name === name);

describe('hexToRgba', () => {
  it('is the inverse of rgbaToHex', () => {
    for (const hex of ['#000000', '#ffffff', '#4f46e5', '#0f172a80']) {
      expect(rgbaToHex(hexToRgba(hex))).toBe(hex);
    }
  });

  it('expands short forms and rejects other strings', () => {
    expect(hexToRgba('#fff')).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(hexToRgba('#0008')).toEqual({ r: 0, g: 0, b: 0, a: 0x88 / 255 });
    expect(hexToRgba('red')).toBeNull();
    expect(hexToRgba('#12345')).toBeNull();
  });
});

describe('the spec format matches the reader', () => {
  it('accepts every field that filterFigmaNode emits', () => {
    for (const key of [...AUTO_LAYOUT_PROPS, ...NODE_PROPS, ...STROKE_PROPS]) {
      expect(NODE_SPEC_FIELDS).toContain(key);
    }
    for (const key of TEXT_STYLE_FIELDS) {
      expect(TEXT_STYLE_SPEC_FIELDS).toContain(key);
    }
  });

  it('parses get_node_info output unchanged', () => {
    const read = filterFigmaNode(pricingCardNode());
    expect(parseNodeSpec(read)).toEqual(read);
  });
});

describe('normalizeNodeTree: pricing card round trip', () => {
  const { tree, fonts, warnings } = build(filterFigmaNode(pricingCardNode()));
  const root = tree as any;

  it('builds the auto-layout frame with its sizing, stroke, radii and shadow', () => {
    expect(root).toMatchObject({
      key: '10:1',
      create: { kind: 'new', type: 'FRAME' },
      name: 'Pricing card',
      size: { width: 360, height: 420 },
      layout: {
        layoutMode: 'VERTICAL',
        itemSpacing: 16,
        paddingTop: 32,
        paddingRight: 24,
        paddingBottom: 32,
        paddingLeft: 24,
        primaryAxisAlignItems: 'MIN',
        counterAxisAlignItems: 'CENTER',
        primaryAxisSizingMode: 'AUTO',
        counterAxisSizingMode: 'FIXED',
      },
      childProps: { layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'HUG' },
    });
    expect(root.props).toMatchObject({
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1 }],
      strokeWeight: 1,
      strokeAlign: 'INSIDE',
      topLeftRadius: 16,
      topRightRadius: 16,
      bottomRightRadius: 0,
      bottomLeftRadius: 0,
      opacity: 0.96,
      clipsContent: true,
    });
    expect(root.props.effects).toEqual([
      {
        type: 'DROP_SHADOW',
        color: { r: 0, g: 0, b: 0, a: 0x14 / 255 },
        offset: { x: 0, y: 8 },
        radius: 24,
        spread: -4,
        visible: true,
        blendMode: 'NORMAL',
        showShadowBehindNode: false,
      },
    ]);
  });

  it('gives FILL text its font, line height, letter spacing and case', () => {
    expect(childNamed(root, 'Plan')).toEqual({
      label: 'tree.children[0] ("Plan")',
      key: '10:2',
      create: { kind: 'new', type: 'TEXT' },
      name: 'Plan',
      text: {
        fontName: { family: 'Inter', style: 'Semi Bold' },
        characters: 'Pro',
        props: {
          fontSize: 14,
          lineHeight: { unit: 'PERCENT', value: 150 },
          letterSpacing: { unit: 'PIXELS', value: 1.2 },
          textCase: 'UPPER',
          textAlignHorizontal: 'LEFT',
          textAlignVertical: 'TOP',
        },
        autoResize: 'HEIGHT',
      },
      size: { width: 312 },
      props: { fills: [{ type: 'SOLID', color: hexToRgbOnly('#4f45e6'), opacity: 1 }] },
      // layoutAlign STRETCH is dropped: the sizing fields supersede it.
      childProps: { layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG' },
    });
  });

  it('turns mixed-style text into a range with its own font', () => {
    const price = childNamed(root, 'Price');
    expect(price.text.props.lineHeight).toEqual({ unit: 'AUTO' });
    expect(price.text.ranges).toEqual([
      {
        start: 0,
        end: 3,
        fontName: { family: 'Inter', style: 'Bold' },
        props: {
          fontSize: 48,
          letterSpacing: { unit: 'PIXELS', value: 0 },
          fills: [{ type: 'SOLID', color: hexToRgbOnly('#111827'), opacity: 1 }],
        },
      },
    ]);
  });

  it('places the absolute badge by its offset and maps its constraints', () => {
    expect(childNamed(root, 'Badge')).toMatchObject({
      childProps: { layoutPositioning: 'ABSOLUTE' },
      position: { x: 280, y: 12, byBox: true, explicit: false },
      constraints: { horizontal: 'MAX', vertical: 'MIN' },
      props: { cornerRadius: 12, clipsContent: false },
    });
  });

  it('clones the instance from its source and leaves it to the auto-layout', () => {
    const icon = childNamed(root, 'Icon/check');
    expect(icon.create).toEqual({ kind: 'instance', sourceId: '10:5', componentId: '3:9', hasChildren: true });
    expect(icon.position).toBeUndefined();
    expect(icon.children).toBeUndefined();
  });

  it('keeps the image fill by hash and skips the hidden stub with a warning', () => {
    expect(childNamed(root, 'Photo').props.fills).toEqual([
      { type: 'IMAGE', imageHash: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', scaleMode: 'FILL' },
    ]);
    expect(childNamed(root, 'Old price')).toBeUndefined();
    expect(warnings).toEqual([
      'tree.children[4] ("Old price"): skipped; get_node_info returns only the id, name and type of hidden layers',
    ]);
  });

  it('lists every font to load', () => {
    expect(fonts).toEqual([
      { family: 'Inter', style: 'Semi Bold' },
      { family: 'Inter', style: 'Regular' },
      { family: 'Inter', style: 'Bold' },
    ]);
  });
});

function hexToRgbOnly(hex: string) {
  const { r, g, b } = hexToRgba(hex)!;
  return { r, g, b };
}

describe('gradientTransformFromHandles', () => {
  it('maps the default left-to-right handles to the identity', () => {
    expect(gradientTransformFromHandles([{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }, { x: 0, y: 1 }])).toEqual([[1, 0, 0], [0, 1, 0]]);
  });

  it('maps top-to-bottom handles to the transform Figma uses', () => {
    expect(gradientTransformFromHandles([{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }, { x: 0, y: 0 }])).toEqual([[0, 1, 0], [-1, 0, 1]]);
  });

  it('derives the width handle when only two are given, and rejects degenerate handles', () => {
    expect(gradientTransformFromHandles([{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }])).toEqual([[0, 1, 0], [-1, 0, 1]]);
    expect(gradientTransformFromHandles([{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }])).toBeNull();
  });

  it('is used for gradient paints, with a warning for degenerate handles', () => {
    const { tree, warnings } = build({
      type: 'RECTANGLE',
      fills: [
        { type: 'GRADIENT_LINEAR', gradientStops: [{ position: 0, color: '#000' }, { position: 1, color: '#fff0' }], gradientHandlePositions: [{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }, { x: 0, y: 0 }] },
        { type: 'GRADIENT_RADIAL', gradientStops: [{ position: 0, color: '#000' }, { position: 1, color: '#fff' }], gradientHandlePositions: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }] },
      ],
    });
    const [linear, radial] = (tree as any).props.fills;
    expect(linear).toEqual({
      type: 'GRADIENT_LINEAR',
      gradientStops: [{ position: 0, color: { r: 0, g: 0, b: 0, a: 1 } }, { position: 1, color: { r: 1, g: 1, b: 1, a: 0 } }],
      gradientTransform: [[0, 1, 0], [-1, 0, 1]],
    });
    expect(radial.gradientTransform).toEqual([[1, 0, 0], [0, 1, 0]]);
    expect(warnings).toEqual(['tree, fills[1]: the gradient handles are degenerate; used a left-to-right gradient']);
  });
});

describe('fonts', () => {
  const textStyle = (style: object, fonts: FontCatalog = catalog) => {
    const result = build({ type: 'TEXT', characters: 'Aa', style }, fonts);
    return { font: (result.tree as any).text.fontName, warnings: result.warnings };
  };

  it('reads weight and slant from style names', () => {
    expect(parseFontStyle('Semi Bold Italic')).toEqual({ weight: 600, italic: true, plain: true });
    expect(parseFontStyle('ExtraLight')).toEqual({ weight: 200, italic: false, plain: true });
    expect(parseFontStyle('Italic')).toEqual({ weight: 400, italic: true, plain: true });
    expect(parseFontStyle('Condensed Bold')).toEqual({ weight: 700, italic: false, plain: false });
    expect(parseFontStyle('Display')).toBeNull();
  });

  it('resolves a weight to each family\'s own style name', () => {
    expect(textStyle({ fontFamily: 'Inter', fontWeight: 600 }).font).toEqual({ family: 'Inter', style: 'Semi Bold' });
    expect(textStyle({ fontFamily: 'Poppins', fontWeight: 600 }).font).toEqual({ family: 'Poppins', style: 'SemiBold' });
    expect(textStyle({ fontFamily: 'Poppins', fontWeight: 600, italic: true }).font).toEqual({ family: 'Poppins', style: 'SemiBold Italic' });
    expect(textStyle({}).font).toEqual({ family: 'Inter', style: 'Regular' });
  });

  it('picks the style closest to a weight and slant', () => {
    expect(pickFontStyle(POPPINS.styles, 600, false)).toEqual({ style: 'SemiBold', exact: true });
    expect(pickFontStyle(INTER.styles, 600, false)).toEqual({ style: 'Semi Bold', exact: true });
    expect(pickFontStyle(POPPINS.styles, 700, true)).toEqual({ style: 'SemiBold Italic', exact: false });
    expect(pickFontStyle(POPPINS.styles, 900, false)).toEqual({ style: 'Bold', exact: false });
    expect(pickFontStyle(['Display', 'Text'], 400, false)).toBeNull();
  });

  it('uses the closest weight with a warning when the exact one is missing', () => {
    const { font, warnings } = textStyle({ fontFamily: 'Poppins', fontWeight: 450 });
    expect(font).toEqual({ family: 'Poppins', style: 'Medium' });
    expect(warnings).toEqual(['tree: Poppins has no weight 450 style; used "Medium"']);
  });

  it('matches an explicit style regardless of spacing, and rejects a missing one', () => {
    expect(textStyle({ fontFamily: 'Poppins', fontStyle: 'Semi Bold' }).font).toEqual({ family: 'Poppins', style: 'SemiBold' });
    expect(() => textStyle({ fontFamily: 'Poppins', fontStyle: 'Black' })).toThrow(
      'at tree: Poppins has no style "Black". Available: Light, Regular, Medium, SemiBold, SemiBold Italic, Bold'
    );
  });

  it('rejects a family Figma does not have', () => {
    expect(() => textStyle({ fontFamily: 'Nope' }, { Nope: null })).toThrow(NodeSpecError);
    expect(() => textStyle({ fontFamily: 'Nope' }, { Nope: null })).toThrow(
      'at tree: font family "Nope" is not available in Figma. Check the spelling, or install the font'
    );
  });

  it('names similar families when the plugin suggests them', () => {
    const spec = parseNodeSpec({ type: 'TEXT', characters: 'a', style: { fontFamily: 'Robto' } });
    expect(() => normalizeNodeTree(spec, { Robto: null }, { Robto: ['Roboto', 'Roboto Mono'] })).toThrow(
      'at tree: font family "Robto" is not available in Figma. Similar families: Roboto, Roboto Mono'
    );
  });

  it('lists the families a spec uses', () => {
    const spec = parseNodeSpec({
      type: 'FRAME',
      children: [
        { type: 'TEXT', characters: 'a' },
        { type: 'TEXT', characters: 'b', style: { fontFamily: 'Poppins' }, textRuns: [{ start: 0, end: 1, fontFamily: 'Roboto' }] },
      ],
    });
    expect(fontFamiliesOf([spec], 'create')).toEqual(['Inter', 'Poppins', 'Roboto']);
    expect(fontFamiliesOf(parseNodeUpdates([{ nodeId: '1:1', opacity: 0.5 }]), 'update')).toEqual([]);
  });
});

describe('text runs', () => {
  it('locates a run by its text', () => {
    const { tree } = build({ type: 'TEXT', characters: 'Hello world', textRuns: [{ text: 'world', fontWeight: 700 }] });
    expect((tree as any).text.ranges).toEqual([{ start: 6, end: 11, fontName: { family: 'Inter', style: 'Bold' }, props: {} }]);
  });

  it('rejects a run whose text does not match its range', () => {
    expect(() => build({ type: 'TEXT', characters: 'Hello', textRuns: [{ start: 0, end: 2, text: 'lo', fontSize: 20 }] })).toThrow(
      'at tree, textRuns[0]: characters 0-2 are "He", not "lo"'
    );
  });

  it('warns about paragraph properties in a run', () => {
    const { warnings } = build({ type: 'TEXT', characters: 'Hi', textRuns: [{ start: 0, end: 2, fontSize: 20, textAlignHorizontal: 'CENTER' }] });
    expect(warnings).toEqual(['tree, textRuns[0]: textAlignHorizontal apply to whole paragraphs, not to a run; ignored']);
  });
});

describe('validation', () => {
  it('names the path of an unknown key', () => {
    expect(() => parseNodeSpec({ type: 'FRAME', children: [{ type: 'TEXT', fill: '#fff' }] })).toThrow(
      "at tree.children[0]: Unrecognized key(s) in object: 'fill'"
    );
  });

  it('names the path of a bad color', () => {
    expect(() => parseNodeSpec({ type: 'RECTANGLE', fills: ['red'] })).toThrow('at tree.fills[0].color: a color is #RGB');
  });

  it('rejects a tree that get_node_info truncated', () => {
    expect(() => build(filterFigmaNode(pricingCardNode(), 0))).toThrow(
      'at tree ("Pricing card"): its children were cut off at the depth limit of get_node_info; read it again with a larger depth'
    );
  });

  it('requires a type and unique keys', () => {
    expect(() => build({ name: 'x' })).toThrow('at tree ("x"): type is required');
    expect(() => build({ type: 'FRAME', children: [{ type: 'FRAME', key: 'a' }, { type: 'FRAME', key: 'a' }] })).toThrow(
      'at tree.children[1]: key "a" is used twice'
    );
  });

  it('keys a repeated source id by path', () => {
    const { tree } = build({ type: 'FRAME', children: [{ type: 'FRAME', id: '5:1' }, { type: 'FRAME', id: '5:1' }] });
    expect((tree as any).children.map((child: any) => child.key)).toEqual(['5:1', 'tree.children[1]']);
  });
});

describe('create defaults and layout rules', () => {
  it('gives new frames no fill and no clipping unless the spec says so, and leaves text black', () => {
    const { tree } = build({ type: 'FRAME', children: [{ type: 'TEXT', characters: 'a' }] });
    expect((tree as any).props).toEqual({ fills: [], clipsContent: false });
    expect((tree as any).children[0].props).toBeUndefined();
  });

  it('drops FILL and ABSOLUTE outside auto-layout, and HUG on a plain frame, with warnings', () => {
    const { tree, warnings } = build({
      type: 'FRAME',
      children: [
        { type: 'RECTANGLE', layoutSizingHorizontal: 'FILL' },
        { type: 'FRAME', layoutPositioning: 'ABSOLUTE', layoutSizingVertical: 'HUG' },
      ],
    });
    expect((tree as any).children[0].childProps).toBeUndefined();
    expect((tree as any).children[1].childProps).toBeUndefined();
    expect(warnings).toEqual([
      'tree.children[0]: layoutSizingHorizontal FILL ignored; the parent has no auto-layout',
      'tree.children[1]: layoutPositioning ABSOLUTE ignored; the parent has no auto-layout',
      'tree.children[1]: layoutSizingVertical HUG ignored; only text and auto-layout frames hug their content',
    ]);
  });

  it('ignores x and y inside auto-layout unless the node is absolute', () => {
    const { tree, warnings } = build({
      type: 'FRAME',
      layoutMode: 'VERTICAL',
      children: [
        { type: 'RECTANGLE', x: 5, y: 5 },
        { type: 'RECTANGLE', x: 5, y: 5, layoutPositioning: 'ABSOLUTE' },
      ],
    });
    expect((tree as any).children[0].position).toBeUndefined();
    expect((tree as any).children[1].position).toEqual({ x: 5, y: 5, byBox: false, explicit: true });
    expect(warnings).toEqual([
      'tree.children[0]: x and y ignored; the parent uses auto-layout. Set layoutPositioning to ABSOLUTE to place the node freely',
    ]);
  });

  it('fixes or hugs each axis of a new auto-layout frame the way get_node_info means it', () => {
    const modes = (spec: object) => {
      const { layout } = build({ type: 'FRAME', layoutMode: 'VERTICAL', ...spec }).tree as any;
      return [layout.primaryAxisSizingMode, layout.counterAxisSizingMode];
    };
    // get_node_info omits AUTO, so an omitted mode hugs...
    expect(modes({ absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 200 } })).toEqual(['AUTO', 'AUTO']);
    // ...unless the axis has layoutSizing, or a width or height of its own.
    expect(modes({ layoutSizingVertical: 'FIXED', layoutSizingHorizontal: 'HUG' })).toEqual(['FIXED', 'AUTO']);
    expect(modes({ layoutSizingHorizontal: 'FILL' })).toEqual(['AUTO', 'FIXED']);
    expect(modes({ width: 300, height: 200 })).toEqual(['FIXED', 'FIXED']);
    expect(modes({ width: 300 })).toEqual(['AUTO', 'FIXED']);
    expect(modes({ height: 200, primaryAxisSizingMode: 'AUTO' })).toEqual(['AUTO', 'AUTO']);
    const horizontal = build({ type: 'FRAME', layoutMode: 'HORIZONTAL', width: 300 }).tree as any;
    expect(horizontal.layout).toMatchObject({ primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'AUTO' });
  });

  it('keeps strokes out of a new auto-layout frame unless the spec includes them', () => {
    expect((build({ type: 'FRAME', layoutMode: 'VERTICAL' }).tree as any).layout.strokesIncludedInLayout).toBe(false);
    expect((build({ type: 'FRAME', layoutMode: 'VERTICAL', strokesIncludedInLayout: true }).tree as any).layout.strokesIncludedInLayout).toBe(true);
    expect((build({ type: 'FRAME' }).tree as any).layout).toBeUndefined();
    expect(update([{ nodeId: '1:1', layoutMode: 'VERTICAL' }]).updates[0].spec.layout).toEqual({ layoutMode: 'VERTICAL' });
  });

  it('keeps a new drop shadow in front of the node unless the spec says otherwise', () => {
    const shadow = (extra: object) =>
      (build({ type: 'RECTANGLE', effects: [{ type: 'DROP_SHADOW', color: '#000', ...extra }] }).tree as any).props.effects[0];
    expect(shadow({}).showShadowBehindNode).toBe(false);
    expect(shadow({ showShadowBehindNode: true }).showShadowBehindNode).toBe(true);
  });

  it('passes NOISE, TEXTURE and GLASS effects back in the form the plugin read them', () => {
    // node.effects as the plugin puts them into get_node_info.
    const effects = [
      { type: 'NOISE', noiseType: 'DUOTONE', noiseSize: 0.5, density: 1, color: { r: 0, g: 0, b: 0, a: 0.25 }, secondaryColor: { r: 1, g: 0.4, b: 0, a: 0.1 }, visible: true },
      { type: 'TEXTURE', noiseSize: 2, radius: 4, clipToShape: true, visible: true },
      { type: 'GLASS', lightIntensity: 0.5, lightAngle: -45, refraction: 0.8, depth: 20, dispersion: 0.5, splay: 0, radius: 4, visible: true },
    ];
    const read = filterFigmaNode({ id: '1:1', name: 'Glass', type: 'RECTANGLE', effects }, 0);
    const written = (build(read).tree as any).props.effects;
    const hex = (c: { r: number; g: number; b: number; a: number }) => hexToRgba(rgbaToHex(c));
    expect(written).toEqual([{ ...effects[0], color: hex(effects[0].color as any), secondaryColor: hex(effects[0].secondaryColor as any) }, effects[1], effects[2]]);
  });

  it('finds where the box of a rotated node starts', () => {
    expect(rotatedBoxOffset(100, 40, 30)).toEqual({ x: 0, y: -50 });
    expect(rotatedBoxOffset(80, 30, -45)).toEqual({ x: -21.21, y: 0 });
    expect(rotatedBoxOffset(10, 20, 0)).toEqual({ x: 0, y: 0 });
  });

  it('builds a group unrotated and places it by its box, because its children carry the rotation', () => {
    const { tree, warnings } = build({
      type: 'GROUP',
      rotation: 30,
      width: 100,
      height: 40,
      localPosition: { x: 60, y: 40 },
      constraints: { horizontal: 'CENTER', vertical: 'TOP' },
      absoluteBoundingBox: { x: 0, y: 0, width: 106.6, height: 84.64 },
      children: [
        { type: 'RECTANGLE', rotation: 30, width: 100, height: 40, parentOffset: { x: 0, y: 0 } },
        { type: 'GROUP', rotation: 45, parentOffset: { x: 5, y: 6 }, children: [{ type: 'ELLIPSE', rotation: 45, width: 5, height: 5, parentOffset: { x: 1, y: 1 } }] },
      ],
    });
    const root = tree as any;
    expect(warnings).toEqual([]);
    expect(root.rotation).toBeUndefined();
    expect(root.constraints).toBeUndefined();
    expect(root.size).toBeUndefined();
    expect(root.position).toEqual({ x: 60, y: -10, byBox: false, explicit: false });
    expect(root.children[0].rotation).toBe(30);
    expect(root.children[1].rotation).toBeUndefined();
    expect(root.children[1].position).toEqual({ x: 5, y: 6, byBox: false, explicit: false });
  });

  it('sets the rotation of clones and instances even when it is 0', () => {
    const { tree } = build({
      type: 'FRAME',
      children: [
        { type: 'VECTOR', id: '7:1' },
        { type: 'INSTANCE', id: '7:2', rotation: 15 },
        { type: 'RECTANGLE' },
      ],
    });
    expect((tree as any).children.map((child: any) => child.rotation)).toEqual([0, 15, undefined]);
  });

  it('recovers the size of a rotated node from its bounding box', () => {
    const { tree } = build({ type: 'RECTANGLE', rotation: 90, absoluteBoundingBox: { x: 0, y: 0, width: 20, height: 100 } });
    expect((tree as any).size).toEqual({ width: 100, height: 20 });
    expect((tree as any).rotation).toBe(90);
  });

  it('wraps text that has only a width, and fixes text that has a whole box', () => {
    const wrap = build({ type: 'TEXT', characters: 'a', width: 200 }).tree as any;
    expect(wrap.text.autoResize).toBe('HEIGHT');
    expect(wrap.size).toEqual({ width: 200 });
    const fixed = build({ type: 'TEXT', characters: 'a', width: 200, height: 40 }).tree as any;
    expect(fixed.text.autoResize).toBe('NONE');
    expect(fixed.size).toEqual({ width: 200, height: 40 });
  });

  it('skips unsupported types unless they can be cloned or imported as SVG', () => {
    const { tree, warnings } = build({
      type: 'FRAME',
      children: [
        { type: 'VECTOR', name: 'a' },
        { type: 'VECTOR', name: 'b', id: '7:1' },
        { type: 'VECTOR', name: 'c', svg: '<svg/>' },
      ],
    });
    expect((tree as any).children.map((child: any) => child.create)).toEqual([
      { kind: 'clone', type: 'VECTOR', sourceId: '7:1' },
      { kind: 'svg', svg: '<svg/>' },
    ]);
    expect(warnings[0]).toMatch(/^tree\.children\[0\] \("a"\): skipped; VECTOR nodes are not built from properties/);
  });

  it('lays out group children in a plain frame', () => {
    const { tree } = build({
      type: 'FRAME',
      layoutMode: 'HORIZONTAL',
      children: [{ type: 'GROUP', children: [{ type: 'RECTANGLE', parentOffset: { x: 4, y: 2 } }] }],
    });
    const group = (tree as any).children[0];
    expect(group.create).toEqual({ kind: 'group' });
    expect(group.size).toBeUndefined();
    expect(group.children[0].position).toEqual({ x: 4, y: 2, byBox: true, explicit: false });
  });

  it('accepts the example tree of the design_strategy prompt without warnings', () => {
    const { tree, warnings } = build(DESIGN_STRATEGY_EXAMPLE);
    expect(warnings).toEqual([]);
    expect((tree as any).children.map((child: any) => child.key)).toEqual(['tree.children[0]', 'tree.children[1]', 'signIn']);
  });
});

describe('normalizeNodeUpdates', () => {
  it('changes only the given fields, without create defaults', () => {
    const { updates, warnings } = update([
      { nodeId: '1:2', layoutSizingHorizontal: 'FILL', x: 10, fills: ['#fff'], absoluteBoundingBox: { x: 0, y: 0, width: 9, height: 9 } },
    ]);
    expect(updates).toEqual([
      {
        nodeId: '1:2',
        spec: {
          label: 'updates[0] (node 1:2)',
          props: { fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1 }] },
          childProps: { layoutSizingHorizontal: 'FILL' },
          position: { x: 10, byBox: false, explicit: true },
        },
      },
    ]);
    expect(warnings).toEqual([]);
  });

  it('changes a font only with its family', () => {
    const { updates, fonts } = update([{ nodeId: '1:2', style: { fontFamily: 'Poppins', fontWeight: 700, fontSize: 18 } }]);
    expect(updates[0].spec.text).toEqual({ fontName: { family: 'Poppins', style: 'Bold' }, props: { fontSize: 18 } });
    expect(fonts).toEqual([{ family: 'Poppins', style: 'Bold' }]);
    expect(() => update([{ nodeId: '1:2', style: { fontWeight: 700 } }])).toThrow(
      'at updates[0] (node 1:2): pass style.fontFamily together with fontStyle, fontWeight or italic'
    );
  });

  it('sets locked and only the corners that are not null', () => {
    const { updates } = update([{ nodeId: '1:2', locked: true, rectangleCornerRadii: [8, null, null, 0] }]);
    expect(updates[0].spec.props).toEqual({ topLeftRadius: 8, bottomLeftRadius: 0, locked: true });
  });

  it('rejects children, a mismatched id and svg', () => {
    expect(() => update([{ nodeId: '1:2', children: [] }])).toThrow('update_nodes changes a node\'s own properties');
    expect(() => update([{ nodeId: '1:2', id: '9:9' }])).toThrow('id "9:9" does not match nodeId');
    expect(() => update([{ nodeId: '1:2', svg: '<svg/>' }])).toThrow('svg applies only when create_node_tree builds a node');
  });

  it('warns about an update with nothing to change', () => {
    expect(update([{ nodeId: '1:2', id: '1:2', type: 'FRAME' }]).warnings).toEqual(['updates[0] (node 1:2): nothing to change']);
  });
});
