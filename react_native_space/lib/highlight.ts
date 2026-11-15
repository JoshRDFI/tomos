/**
 * Code highlighting with Prism, flattened into styled runs for React Native.
 *
 * The language list and aliases follow DeepSeek's chat demo
 * (src/services/markdown/highlight.ts, MIT, Copyright (c) 2026 DeepSeek; full
 * notice in lib/markdown.ts). Languages are bundled rather than loaded on demand.
 */
import Prism from 'prismjs';
// Order matters: a language must load after the ones it extends.
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-kotlin';
import 'prismjs/components/prism-swift';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-ruby';
import 'prismjs/components/prism-lua';
import 'prismjs/components/prism-markup-templating';
import 'prismjs/components/prism-php';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-powershell';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-ini';
import 'prismjs/components/prism-docker';
import 'prismjs/components/prism-diff';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-makefile';
import 'prismjs/components/prism-scss';
import 'prismjs/components/prism-dart';
import 'prismjs/components/prism-r';

const ALIASES: Record<string, string> = {
  html: 'markup',
  xml: 'markup',
  svg: 'markup',
  vue: 'markup',
  js: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
  shell: 'bash',
  sh: 'bash',
  zsh: 'bash',
  console: 'bash',
  'c++': 'cpp',
  cc: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  'c#': 'csharp',
  dockerfile: 'docker',
  golang: 'go',
  kt: 'kotlin',
  md: 'markdown',
  py: 'python',
  python3: 'python',
  rb: 'ruby',
  rs: 'rust',
  yml: 'yaml',
  ps1: 'powershell',
  pwsh: 'powershell',
};

/** Prism language name for a code fence's info string, or null if unsupported. */
export function getHighlightLang(infostring: string): string | null {
  const key = infostring.trim().toLowerCase().split(/\s+/)[0] ?? '';
  const lang = ALIASES[key] ?? key;
  return lang && Object.prototype.hasOwnProperty.call(Prism.languages, lang) && typeof Prism.languages[lang] === 'object'
    ? lang
    : null;
}

export type SyntaxKind = 'comment' | 'keyword' | 'string' | 'number' | 'function' | 'type' | 'punct' | null;

export interface CodeRun {
  text: string;
  kind: SyntaxKind;
}

const KIND_BY_TOKEN: Record<string, SyntaxKind> = {
  comment: 'comment', prolog: 'comment', doctype: 'comment', cdata: 'comment',
  keyword: 'keyword', boolean: 'keyword', important: 'keyword', atrule: 'keyword', rule: 'keyword', selector: 'keyword', tag: 'keyword', deleted: 'keyword',
  string: 'string', char: 'string', 'attr-value': 'string', 'template-string': 'string', regex: 'string', url: 'string', inserted: 'string',
  number: 'number', constant: 'number', symbol: 'number', entity: 'number', unit: 'number',
  function: 'function', 'function-variable': 'function', method: 'function', macro: 'function', 'attr-name': 'function', property: 'function', key: 'function',
  'class-name': 'type', builtin: 'type', namespace: 'type', 'type-annotation': 'type', decorator: 'type', annotation: 'type',
  punctuation: 'punct', operator: 'punct',
};

function kindOf(token: Prism.Token): SyntaxKind | undefined {
  const k = KIND_BY_TOKEN[token.type];
  if (k !== undefined) return k;
  const aliases = Array.isArray(token.alias) ? token.alias : token.alias ? [token.alias] : [];
  for (const a of aliases) {
    if (KIND_BY_TOKEN[a] !== undefined) return KIND_BY_TOKEN[a];
  }
  return undefined;
}

/**
 * Highlight `code` as a flat list of runs. Adjacent runs of the same kind are
 * merged so long code doesn't produce thousands of nested Text nodes.
 */
export function highlightCode(code: string, lang: string | null): CodeRun[] {
  const grammar = lang ? Prism.languages[lang] : undefined;
  if (!grammar) return [{ text: code, kind: null }];
  const runs: CodeRun[] = [];
  const push = (text: string, kind: SyntaxKind) => {
    if (!text) return;
    const prev = runs[runs.length - 1];
    if (prev && prev.kind === kind) prev.text += text;
    else runs.push({ text, kind });
  };
  const walk = (stream: Prism.TokenStream, inherited: SyntaxKind) => {
    if (typeof stream === 'string') {
      push(stream, inherited);
    } else if (Array.isArray(stream)) {
      for (const t of stream) walk(t, inherited);
    } else {
      walk(stream.content, kindOf(stream) ?? inherited);
    }
  };
  try {
    walk(Prism.tokenize(code, grammar), null);
  } catch {
    return [{ text: code, kind: null }];
  }
  return runs;
}
