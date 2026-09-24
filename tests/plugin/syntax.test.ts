/**
 * The plugin code keeps to the JavaScript subset it has always used in the
 * Figma sandbox: no optional chaining (?.), no nullish coalescing (??), no
 * object spread and no Promise.allSettled.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const FILE = path.join(__dirname, '../../src/claude_mcp_plugin/code.js');

function forbiddenSyntax(source: string): string[] {
  const file = ts.createSourceFile('code.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const found: string[] = [];
  const report = (node: ts.Node, what: string) => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
    found.push(`line ${line + 1}: ${what}`);
  };
  const visit = (node: ts.Node) => {
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isCallExpression(node)) && node.questionDotToken) {
      report(node, 'optional chaining (?.)');
    }
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.QuestionQuestionEqualsToken].includes(node.operatorToken.kind)) {
      report(node, 'nullish coalescing (??)');
    }
    if (ts.isSpreadAssignment(node)) report(node, 'object spread');
    if (ts.isIdentifier(node) && node.text === 'allSettled') report(node, 'Promise.allSettled');
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe('plugin syntax', () => {
  it('finds each construct the check looks for', () => {
    const sample = 'a?.b; a ?? b; const c = { ...d }; Promise.allSettled([]); const e = [...f];';
    expect(forbiddenSyntax(sample)).toEqual([
      'line 1: optional chaining (?.)',
      'line 1: nullish coalescing (??)',
      'line 1: object spread',
      'line 1: Promise.allSettled',
    ]);
  });

  it('code.js uses none of them', () => {
    expect(forbiddenSyntax(fs.readFileSync(FILE, 'utf8'))).toEqual([]);
  });
});
