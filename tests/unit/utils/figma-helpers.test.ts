import { filterFigmaNode } from '../../../src/talk_to_figma_mcp/utils/figma-helpers';
import { pricingCardNode, vectorNode } from '../../fixtures/rest-nodes';

const childNamed = (tree: any, name: string) => tree.children.find((c: any) => c.name === name);

describe('filterFigmaNode', () => {
  describe('auto-layout', () => {
    it('keeps the container properties and omits defaults', () => {
      const out = filterFigmaNode(pricingCardNode());
      expect(out).toMatchObject({
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
        layoutSizingHorizontal: 'FIXED',
        layoutSizingVertical: 'HUG',
        clipsContent: true,
        opacity: 0.96,
      });
      expect(out.blendMode).toBeUndefined();
      expect(out.layoutWrap).toBeUndefined();
    });

    it('omits container properties on frames without auto-layout', () => {
      const out = filterFigmaNode({
        id: '1:1', name: 'Frame', type: 'FRAME', layoutMode: 'NONE', paddingLeft: 10, itemSpacing: 8, primaryAxisAlignItems: 'CENTER',
      });
      expect(out).toEqual({ id: '1:1', name: 'Frame', type: 'FRAME' });
    });

    it('keeps child sizing, absolute positioning and non-default constraints', () => {
      const out = filterFigmaNode(pricingCardNode());
      expect(childNamed(out, 'Plan')).toMatchObject({ layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG', layoutAlign: 'STRETCH' });
      expect(childNamed(out, 'Plan').layoutGrow).toBeUndefined();
      expect(childNamed(out, 'Badge')).toMatchObject({
        layoutPositioning: 'ABSOLUTE',
        constraints: { vertical: 'TOP', horizontal: 'RIGHT' },
      });
      expect(childNamed(out, 'Icon/check').constraints).toBeUndefined();
    });
  });

  describe('geometry', () => {
    it('adds parentOffset relative to the parent box and rounds lengths to 2 decimals', () => {
      const out = filterFigmaNode(pricingCardNode());
      expect(out.parentOffset).toBeUndefined();
      expect(childNamed(out, 'Plan').absoluteBoundingBox).toEqual({ x: 1224, y: 872, width: 312, height: 21 });
      expect(childNamed(out, 'Plan').parentOffset).toEqual({ x: 24, y: 32 });
      expect(childNamed(out, 'Badge').parentOffset).toEqual({ x: 280, y: 12 });
      expect(childNamed(out, 'Icon/check').children[0].parentOffset).toEqual({ x: 3, y: 4 });
    });

    it('keeps localPosition on the root', () => {
      const out = filterFigmaNode({ ...vectorNode(), localPosition: { x: 5.004, y: 9.996 } });
      expect(out.localPosition).toEqual({ x: 5, y: 10 });
    });
  });

  describe('visibility', () => {
    it('returns hidden nodes below the root as stubs', () => {
      const out = filterFigmaNode(pricingCardNode());
      expect(childNamed(out, 'Old price')).toEqual({ id: '10:6', name: 'Old price', type: 'TEXT', visible: false });
    });

    it('serializes a hidden root in full', () => {
      const hidden = childNamed(pricingCardNode(), 'Old price');
      const out = filterFigmaNode(hidden, 1);
      expect(out.visible).toBe(false);
      expect(out.characters).toBe('$49');
      expect(out.style.textDecoration).toBe('STRIKETHROUGH');
    });

    it('drops invisible paints and effects', () => {
      const out = filterFigmaNode(pricingCardNode());
      expect(out.effects).toEqual([{ type: 'DROP_SHADOW', color: '#00000014', offset: { x: 0, y: 8 }, radius: 24, spread: -4 }]);
      const photo = childNamed(out, 'Photo');
      expect(photo.fills).toHaveLength(1);
      expect(photo.strokes).toBeUndefined();
      expect(photo.strokeWeight).toBeUndefined();
    });
  });

  describe('paints, strokes and radii', () => {
    it('keeps imageRef on image fills and drops default paint values', () => {
      const photo = childNamed(filterFigmaNode(pricingCardNode()), 'Photo');
      expect(photo.fills).toEqual([
        { type: 'IMAGE', scaleMode: 'FILL', imageRef: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678' },
      ]);
    });

    it('converts colors and gradient stops to hex', () => {
      const out = filterFigmaNode({
        id: '1:1', name: 'Gradient', type: 'RECTANGLE',
        fills: [{
          type: 'GRADIENT_LINEAR', blendMode: 'NORMAL', opacity: 0.5,
          gradientHandlePositions: [{ x: 0.123456, y: 0 }, { x: 1, y: 1 }],
          gradientStops: [
            { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
            { position: 1, color: { r: 0, g: 0, b: 1, a: 0.5 } },
          ],
        }],
      });
      expect(out.fills).toEqual([{
        type: 'GRADIENT_LINEAR',
        opacity: 0.5,
        gradientHandlePositions: [{ x: 0.1235, y: 0 }, { x: 1, y: 1 }],
        gradientStops: [{ position: 0, color: '#ff0000' }, { position: 1, color: '#0000ff80' }],
      }]);
    });

    it('keeps stroke geometry when a visible stroke exists', () => {
      expect(filterFigmaNode(pricingCardNode())).toMatchObject({
        strokes: [{ type: 'SOLID', color: '#e5e7eb' }],
        strokeWeight: 1,
        strokeAlign: 'INSIDE',
      });
      const out = filterFigmaNode({
        id: '1:1', name: 'Divider', type: 'FRAME',
        strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }],
        strokeWeight: 1, strokeAlign: 'CENTER', strokeDashes: [4, 2],
        individualStrokeWeights: { top: 0, right: 0, bottom: 1, left: 0 },
      });
      expect(out).toMatchObject({
        strokeWeight: 1,
        strokeAlign: 'CENTER',
        strokeDashes: [4, 2],
        individualStrokeWeights: { top: 0, right: 0, bottom: 1, left: 0 },
      });
    });

    it('keeps rectangleCornerRadii only when the corners differ', () => {
      expect(filterFigmaNode(pricingCardNode()).rectangleCornerRadii).toEqual([16, 16, 0, 0]);
      const uniform = filterFigmaNode({ id: '1:1', name: 'Card', type: 'RECTANGLE', rectangleCornerRadii: [8, 8, 8, 8] });
      expect(uniform.cornerRadius).toBe(8);
      expect(uniform.rectangleCornerRadii).toBeUndefined();
    });
  });

  describe('text', () => {
    it('keeps the full base style and omits text defaults', () => {
      const plan = childNamed(filterFigmaNode(pricingCardNode()), 'Plan');
      expect(plan.characters).toBe('Pro');
      expect(plan.style).toEqual({
        fontFamily: 'Inter',
        fontPostScriptName: 'Inter-SemiBold',
        fontStyle: 'Semi Bold',
        fontWeight: 600,
        fontSize: 14,
        textCase: 'UPPER',
        textAlignHorizontal: 'LEFT',
        textAlignVertical: 'TOP',
        letterSpacing: 1.2,
        lineHeightPx: 21,
        lineHeightUnit: 'FONT_SIZE_%',
        lineHeightPercentFontSize: 150,
        textAutoResize: 'HEIGHT',
      });
      expect(plan.textRuns).toBeUndefined();
    });

    it('builds textRuns from style overrides, including omitted trailing entries', () => {
      const price = childNamed(filterFigmaNode(pricingCardNode()), 'Price');
      expect(price.style).toMatchObject({ fontStyle: 'Regular', fontSize: 16, letterSpacing: 0.16, lineHeightPx: 58.09 });
      expect(price.textRuns).toEqual([
        {
          start: 0, end: 3, text: '$29',
          fontStyle: 'Bold', fontWeight: 700, fontSize: 48,
          // A default value inside an override is a real change, so it is kept.
          letterSpacing: 0,
          fills: [{ type: 'SOLID', color: '#111827' }],
        },
        { start: 3, end: 10, text: ' /month' },
      ]);
    });

    it('keeps lineTypes only for lists', () => {
      const list = filterFigmaNode({ id: '1:1', name: 'List', type: 'TEXT', characters: 'a\nb', lineTypes: ['UNORDERED', 'UNORDERED'], lineIndentations: [1, 1] });
      expect(list.lineTypes).toEqual(['UNORDERED', 'UNORDERED']);
      expect(list.lineIndentations).toEqual([1, 1]);
      const plain = filterFigmaNode({ id: '1:2', name: 'Plain', type: 'TEXT', characters: 'a', lineTypes: ['NONE'] });
      expect(plain.lineTypes).toBeUndefined();
    });
  });

  describe('depth and node types', () => {
    it('keeps VECTOR nodes in the tree', () => {
      const icon = childNamed(filterFigmaNode(pricingCardNode()), 'Icon/check');
      expect(icon.componentId).toBe('3:9');
      expect(icon.children).toEqual([{
        id: 'I10:5;3:10',
        name: 'Vector',
        type: 'VECTOR',
        absoluteBoundingBox: { x: 1227, y: 987, width: 14, height: 11 },
        parentOffset: { x: 3, y: 4 },
        strokes: [{ type: 'SOLID', color: '#21c45e' }],
        strokeWeight: 2,
      }]);
    });

    it('returns a VECTOR root instead of null', () => {
      expect(filterFigmaNode(vectorNode(), 1)).toEqual({
        id: '20:1',
        name: 'Arrow',
        type: 'VECTOR',
        absoluteBoundingBox: { x: 10, y: 20, width: 16, height: 16 },
        fills: [{ type: 'SOLID', color: '#000000' }],
      });
    });

    it('truncates deeper levels to stubs that keep VECTOR children and hidden flags', () => {
      const depth1 = filterFigmaNode(pricingCardNode(), 1);
      const icon = childNamed(depth1, 'Icon/check');
      expect(icon.children).toEqual([{ id: 'I10:5;3:10', name: 'Vector', type: 'VECTOR' }]);
      expect(icon._childrenTruncated).toBe(true);

      const depth0 = filterFigmaNode(pricingCardNode(), 0);
      expect(depth0._childrenTruncated).toBe(true);
      expect(depth0.children).toHaveLength(6);
      expect(childNamed(depth0, 'Plan')).toEqual({ id: '10:2', name: 'Plan', type: 'TEXT' });
      expect(childNamed(depth0, 'Old price')).toEqual({ id: '10:6', name: 'Old price', type: 'TEXT', visible: false });
    });

    it('does not modify its input', () => {
      const input = pricingCardNode();
      filterFigmaNode(input);
      expect(input).toEqual(pricingCardNode());
    });
  });
});
