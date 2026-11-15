import { toMdAst } from '../lib/markdown';
import { getHighlightLang, highlightCode } from '../lib/highlight';

describe('toMdAst', () => {
  it('parses GFM blocks', () => {
    const ast = toMdAst('# Title\n\n| a | b |\n|---|--:|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n```py\nprint(1)\n```\n\n> quote\n\n---');
    expect(ast.children.map((n) => n.type)).toEqual(['heading', 'table', 'list', 'code', 'blockquote', 'thematicBreak']);
  });

  it('keeps indented list items as lists, not code', () => {
    const ast = toMdAst('    - one\n    - two');
    expect(ast.children[0]?.type).toBe('list');
  });

  it('parses inline formatting', () => {
    const p = toMdAst('**b** *i* ~~s~~ `c` [l](https://x.y)').children[0] as any;
    expect(p.children.map((n: any) => n.type)).toEqual(['strong', 'text', 'emphasis', 'text', 'delete', 'text', 'inlineCode', 'text', 'link']);
  });

  it('shows reference links and footnotes as their source text', () => {
    const p = toMdAst('see [x][ref] and [^1]').children[0] as any;
    const text = p.children.map((n: any) => n.value).join('');
    expect(text).toBe('see [x][ref] and [^1]');
  });

  it('copes with an unterminated code fence while streaming', () => {
    const ast = toMdAst('Here:\n\n```js\nconst a = 1');
    expect(ast.children.map((n) => n.type)).toEqual(['paragraph', 'code']);
    expect((ast.children[1] as any).value).toBe('const a = 1');
  });
});

describe('highlight', () => {
  it('resolves aliases and rejects unknown languages', () => {
    expect(getHighlightLang('py')).toBe('python');
    expect(getHighlightLang('TS')).toBe('typescript');
    expect(getHighlightLang('tsx')).toBe('tsx');
    expect(getHighlightLang('cpp')).toBe('cpp');
    expect(getHighlightLang('nonsense')).toBeNull();
    expect(getHighlightLang('')).toBeNull();
  });

  it('produces runs that reassemble to the source', () => {
    const code = 'def f(x):\n    # add one\n    return x + 1  # "s"';
    const runs = highlightCode(code, 'python');
    expect(runs.map((r) => r.text).join('')).toBe(code);
    expect(runs.find((r) => r.kind === 'keyword')?.text).toBe('def');
    expect(runs.some((r) => r.kind === 'comment' && r.text.includes('# add one'))).toBe(true);
  });

  it('returns plain text for unsupported languages', () => {
    expect(highlightCode('abc', null)).toEqual([{ text: 'abc', kind: null }]);
  });
});
