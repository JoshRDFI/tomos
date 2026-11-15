/**
 * Markdown → mdast for chat replies.
 *
 * Adapted from DeepSeek's chat demo (src/services/markdown/parse.ts).
 * Copyright (c) 2026 DeepSeek. MIT License:
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy
 *   of this software and associated documentation files (the "Software"), to deal
 *   in the Software without restriction, including without limitation the rights
 *   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *   copies of the Software, and to permit persons to whom the Software is
 *   furnished to do so, subject to the following conditions:
 *
 *   The above copyright notice and this permission notice shall be included in all
 *   copies or substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 *   SOFTWARE.
 *
 * Changes: no citations or math (KaTeX needs a browser); strikethrough is
 * rendered rather than shown as raw tildes.
 */
import type { Nodes, Parent, Root, RootContent, Text } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';

const text = (value: string): Text => ({ type: 'text', value });

/**
 * Parse a reply. Nodes the renderer doesn't draw are replaced up front:
 * footnotes, reference links and definitions show their source text.
 */
export function toMdAst(input: string): Root {
  const ast = fromMarkdown(input, {
    extensions: [
      // Indented code would turn lists with leading spaces into code blocks.
      { ...gfm(), disable: { null: ['codeIndented'] } },
    ],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const raw = (node: Nodes) => input.slice(node.position?.start.offset, node.position?.end.offset);
  const simplify = (node: Nodes): Nodes[] => {
    if ('children' in node) {
      (node as Parent).children = node.children.flatMap(simplify) as RootContent[];
    }
    switch (node.type) {
      case 'footnoteReference':
      case 'imageReference':
      case 'linkReference':
        return [text(raw(node))];
      case 'footnoteDefinition':
      case 'definition':
        return [{ type: 'paragraph', children: [text(raw(node))] }];
      default:
        return [node];
    }
  };
  simplify(ast);
  return ast;
}
