/**
 * Markdown renderer for assistant replies (React Native).
 *
 * Structure follows DeepSeek's chat demo (src/components/markdown/MarkdownAstRenderer.tsx,
 * MIT, Copyright (c) 2026 DeepSeek; full notice in lib/markdown.ts), rewritten
 * for React Native views and text.
 */
import React, { createContext, memo, useContext, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import type { BlockContent, DefinitionContent, List as ListNode, PhrasingContent, Root, Table as TableNode } from 'mdast';
import type { AppColors, AppTheme } from '@/constants/theme';
import { fontFamilies } from '@/constants/theme';
import { toMdAst } from '@/lib/markdown';
import { getHighlightLang, highlightCode, type SyntaxKind } from '@/lib/highlight';
import { useThrottledText } from './useThrottledText';

interface Ctx {
  c: AppColors;
  onCopy: (text: string) => void;
}
const MdContext = createContext<Ctx | null>(null);
const useMd = () => useContext(MdContext)!;

const BODY = { fontSize: 16, lineHeight: 24 };
const HEADING_SIZE = [0, 22, 20, 18, 17, 16, 16];
const CURSOR = ' █';

type Block = BlockContent | DefinitionContent;

// ── Inline ──

function Phrasing({ nodes }: { nodes: PhrasingContent[] }) {
  return <>{nodes.map((n, i) => <PhrasingItem key={i} node={n} />)}</>;
}

function safeUrl(url: string): string | null {
  return /^(https?:|mailto:)/i.test(url) ? url : null;
}

function PhrasingItem({ node }: { node: PhrasingContent }) {
  const { c } = useMd();
  switch (node.type) {
    case 'text':
      return <>{node.value}</>;
    case 'break':
      return <>{'\n'}</>;
    case 'strong':
      return <Text style={{ fontFamily: fontFamilies.interSemiBold }}><Phrasing nodes={node.children} /></Text>;
    case 'emphasis':
      return <Text style={{ fontStyle: 'italic' }}><Phrasing nodes={node.children} /></Text>;
    case 'delete':
      return <Text style={{ textDecorationLine: 'line-through' }}><Phrasing nodes={node.children} /></Text>;
    case 'inlineCode':
      return (
        <Text style={{ fontFamily: fontFamilies.mono, fontSize: 14, backgroundColor: c.codeBg }}>
          {` ${node.value} `}
        </Text>
      );
    case 'link': {
      const url = safeUrl(node.url);
      return (
        <Text
          style={{ color: c.brand, textDecorationLine: 'underline' }}
          onPress={url ? () => { Linking.openURL(url).catch(() => {}); } : undefined}
        >
          <Phrasing nodes={node.children} />
        </Text>
      );
    }
    case 'image': {
      const url = safeUrl(node.url);
      const label = `[image${node.alt ? `: ${node.alt}` : ''}]`;
      return url
        ? <Text style={{ color: c.brand, textDecorationLine: 'underline' }} onPress={() => { Linking.openURL(url).catch(() => {}); }}>{label}</Text>
        : <>{label}</>;
    }
    case 'html':
      return <>{node.value}</>;
    default:
      return null;
  }
}

// ── Blocks ──

function Blocks({ nodes, cursor }: { nodes: Block[]; cursor?: boolean }) {
  const last = nodes[nodes.length - 1];
  // The streaming cursor goes at the end of a trailing paragraph; otherwise on its own line.
  const inline = !!cursor && last?.type === 'paragraph';
  return (
    <View style={styles.blocks}>
      {nodes.map((n, i) => <BlockItem key={i} node={n} cursor={inline && i === nodes.length - 1} />)}
      {cursor && !inline && <CursorLine />}
    </View>
  );
}

function CursorLine() {
  const { c } = useMd();
  return <Text style={[BODY, { color: c.text }]}>{CURSOR.trim()}</Text>;
}

function BlockItem({ node, cursor }: { node: Block; cursor?: boolean }) {
  const { c } = useMd();
  switch (node.type) {
    case 'paragraph':
      return (
        <Text style={[BODY, { color: c.text, fontFamily: fontFamilies.inter }]} selectable>
          <Phrasing nodes={node.children} />{cursor ? CURSOR : ''}
        </Text>
      );
    case 'heading':
      if (node.children.length === 0) return null;
      return (
        <Text
          style={{ color: c.text, fontFamily: fontFamilies.interSemiBold, fontSize: HEADING_SIZE[node.depth], lineHeight: HEADING_SIZE[node.depth]! + 8, marginTop: 4 }}
          selectable
          accessibilityRole="header"
        >
          <Phrasing nodes={node.children} />
        </Text>
      );
    case 'code':
      return <CodeBlock code={node.value} infostring={node.lang ?? ''} />;
    case 'blockquote':
      return (
        <View style={[styles.quote, { borderLeftColor: c.hairline }]}>
          <Blocks nodes={node.children} />
        </View>
      );
    case 'list':
      return <MdList node={node} />;
    case 'table':
      return <MdTable node={node} />;
    case 'thematicBreak':
      return <View style={[styles.rule, { backgroundColor: c.hairline }]} />;
    case 'html':
      return <Text style={[BODY, { color: c.text, fontFamily: fontFamilies.inter }]} selectable>{node.value}</Text>;
    default:
      return null;
  }
}

function MdList({ node }: { node: ListNode }) {
  const { c } = useMd();
  const start = node.start ?? 1;
  return (
    <View style={node.spread ? styles.listSpread : styles.list}>
      {node.children.map((item, i) => {
        const marker = typeof item.checked === 'boolean'
          ? (item.checked ? '☑' : '☐')
          : node.ordered ? `${start + i}.` : '•';
        return (
          <View key={i} style={styles.listItem}>
            <Text style={[BODY, styles.marker, { color: c.textSecondary, fontFamily: fontFamilies.inter }]}>{marker}</Text>
            <View style={{ flex: 1 }}>
              <Blocks nodes={item.children} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Rough column width from the longest cell, so wide tables scroll sideways. */
function columnWidths(node: TableNode): number[] {
  const widths: number[] = [];
  for (const row of node.children) {
    row.children.forEach((cell, i) => {
      const len = cell.children.reduce((n, ch) => n + ('value' in ch ? String(ch.value).length : 8), 0);
      widths[i] = Math.max(widths[i] ?? 0, len);
    });
  }
  return widths.map((len) => Math.min(260, Math.max(64, len * 8 + 20)));
}

function MdTable({ node }: { node: TableNode }) {
  const { c } = useMd();
  const widths = useMemo(() => columnWidths(node), [node]);
  const align = node.align ?? [];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={[styles.table, { borderColor: c.hairline }]}>
        {node.children.map((row, r) => (
          <View key={r} style={[styles.row, r > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline }, r === 0 && { backgroundColor: c.surfaceRaised }]}>
            {widths.map((w, i) => {
              const cell = row.children[i];
              return (
                <View key={i} style={[styles.cell, { width: w }, i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: c.hairline }]}>
                  <Text
                    style={{ color: c.text, fontSize: 14, lineHeight: 20, fontFamily: r === 0 ? fontFamilies.interSemiBold : fontFamilies.inter, textAlign: align[i] === 'right' ? 'right' : align[i] === 'center' ? 'center' : 'left' }}
                    selectable
                  >
                    {cell ? <Phrasing nodes={cell.children} /> : null}
                  </Text>
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const SYNTAX_COLOR: Record<Exclude<SyntaxKind, null>, keyof AppColors> = {
  comment: 'synComment',
  keyword: 'synKeyword',
  string: 'synString',
  number: 'synNumber',
  function: 'synFunction',
  type: 'synType',
  punct: 'synPunct',
};

const CodeBlock = memo(function CodeBlock({ code, infostring }: { code: string; infostring: string }) {
  const { c, onCopy } = useMd();
  const label = infostring.trim().split(/\s+/)[0] || 'code';
  const runs = useMemo(() => highlightCode(code, getHighlightLang(infostring)), [code, infostring]);
  const [copied, setCopied] = useState(false);
  return (
    <View style={[styles.code, { backgroundColor: c.codeBg, borderColor: c.hairline }]}>
      <View style={[styles.codeHeader, { borderBottomColor: c.hairline }]}>
        <Text style={{ color: c.textSecondary, fontFamily: fontFamilies.mono, fontSize: 11 }}>{label}</Text>
        <Pressable
          onPress={() => { onCopy(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Copy code"
        >
          <Text style={{ color: c.brand, fontFamily: fontFamilies.monoMedium, fontSize: 12 }}>{copied ? 'Copied' : 'Copy'}</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text style={[styles.codeText, { color: c.text, fontFamily: fontFamilies.mono }]} selectable>
          {runs.map((run, i) => run.kind
            ? <Text key={i} style={{ color: c[SYNTAX_COLOR[run.kind]] }}>{run.text}</Text>
            : run.text)}
        </Text>
      </ScrollView>
    </View>
  );
});

// ── Entry ──

interface Props {
  content: string;
  /** Reply is still streaming: throttle updates and show a cursor. */
  streaming?: boolean;
  onCopy: (text: string) => void;
}

/** Throttle → parse → render. */
export default memo(function Markdown({ content, streaming = false, onCopy }: Props) {
  const theme = useTheme<AppTheme>();
  const c = theme.appColors;
  const text = useThrottledText(content, streaming);
  const ast: Root | null = useMemo(() => {
    try {
      return toMdAst(text);
    } catch {
      return null;
    }
  }, [text]);
  const ctx = useMemo(() => ({ c, onCopy }), [c, onCopy]);

  if (!ast) {
    return <Text style={[BODY, { color: c.text, fontFamily: fontFamilies.inter }]} selectable>{text}{streaming ? CURSOR : ''}</Text>;
  }
  return (
    <MdContext.Provider value={ctx}>
      <Blocks nodes={ast.children as Block[]} cursor={streaming} />
    </MdContext.Provider>
  );
});

const styles = StyleSheet.create({
  blocks: { gap: 8 },
  quote: { borderLeftWidth: 3, paddingLeft: 10 },
  list: { gap: 2 },
  listSpread: { gap: 8 },
  listItem: { flexDirection: 'row' },
  marker: { minWidth: 22, paddingRight: 6 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 6, overflow: 'hidden' },
  row: { flexDirection: 'row' },
  cell: { paddingHorizontal: 8, paddingVertical: 6 },
  code: { borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  codeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  codeText: { fontSize: 13, lineHeight: 19, padding: 12 },
});
