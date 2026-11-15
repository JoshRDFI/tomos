import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Pressable, ScrollView, Platform } from 'react-native';
import { Text, IconButton, useTheme, Icon } from 'react-native-paper';
import type { AppTheme } from '@/constants/theme';
import { spacing, radii, typeScale, fontFamilies } from '@/constants/theme';
import type { MessageRecord } from '@/types';
import type { StreamView } from '@/lib/llama';
import { splitThinking, formatThinkingTime } from '@/lib/thinking';

// While streaming, only the end of a long thought is drawn (it re-renders on
// every token); the full text is shown once the reply is complete.
const LIVE_TAIL = 1500;

interface ThinkingProps {
  text: string;
  /** The model is still thinking. */
  active: boolean;
  /** Reply is still streaming (thinking may be done). */
  streaming: boolean;
  ms: number | null | undefined;
}

function ThinkingBlock({ text, active, streaming, ms }: ThinkingProps) {
  const theme = useTheme<AppTheme>();
  const c = theme.appColors;
  // Open while thinking, closed once the answer starts, unless the user chose.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? active;

  // Live timer while thinking.
  const startRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) return;
    if (startRef.current === null) startRef.current = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - (startRef.current ?? Date.now())), 1000);
    return () => clearInterval(id);
  }, [active]);

  const label = active
    ? `Thinking… ${elapsed >= 1000 ? formatThinkingTime(elapsed) : ''}`.trim()
    : ms ? `Thought for ${formatThinkingTime(ms)}` : 'Thinking';
  const shown = streaming && text.length > LIVE_TAIL ? '…' + text.slice(-LIVE_TAIL) : text;

  return (
    <View style={[thinkStyles.container, { borderLeftColor: c.brand }]}>
      <Pressable
        onPress={() => setUserOpen(!open)}
        style={thinkStyles.header}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${label}. ${open ? 'Hide' : 'Show'} thinking`}
      >
        <Icon source="lightbulb-outline" size={16} color={c.textSecondary} />
        <Text style={[thinkStyles.label, { color: c.textSecondary, fontFamily: fontFamilies.interMedium }]}>{label}</Text>
        <Icon source={open ? 'chevron-up' : 'chevron-down'} size={16} color={c.textSecondary} />
      </Pressable>
      {open && (
        <Text style={[thinkStyles.text, { color: c.textSecondary, fontFamily: fontFamilies.inter }]} selectable>
          {shown}{active ? ' █' : ''}
        </Text>
      )}
    </View>
  );
}

const thinkStyles = StyleSheet.create({
  container: { borderLeftWidth: 2, paddingLeft: 10, marginBottom: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  label: { fontSize: 13, lineHeight: 18 },
  text: { fontSize: 14, lineHeight: 21, marginTop: 4 },
});

interface CodeBlockProps {
  language: string;
  code: string;
  onCopy: (text: string) => void;
}

function CodeBlock({ language, code, onCopy }: CodeBlockProps) {
  const theme = useTheme<AppTheme>();
  const c = theme.appColors;
  return (
    <View style={[codeStyles.container, { backgroundColor: c.codeBg, borderColor: c.hairline }]}>
      <View style={codeStyles.header}>
        <Text style={[codeStyles.lang, { color: c.textSecondary, fontFamily: fontFamilies.mono }]}>{language || 'code'}</Text>
        <Pressable onPress={() => onCopy(code)} hitSlop={8}>
          <Text style={[codeStyles.copyBtn, { color: c.brand, fontFamily: fontFamilies.monoMedium }]}>Copy</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text style={[codeStyles.code, { color: c.text, fontFamily: fontFamilies.mono }]} selectable>{code}</Text>
      </ScrollView>
    </View>
  );
}

const codeStyles = StyleSheet.create({
  container: { borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, marginVertical: 6, overflow: 'hidden' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2A3035' },
  lang: { fontSize: 11 },
  copyBtn: { fontSize: 12 },
  code: { fontSize: 13, lineHeight: 18, padding: 12 },
});

interface Props {
  message: MessageRecord;
  isLast: boolean;
  isStreaming: boolean;
  /** Thinking and answer so far, while this reply streams. */
  stream?: StreamView;
  onCopy: (text: string) => void;
  onRegenerate?: () => void;
  onLongPress?: () => void;
}

function renderContent(text: string, onCopy: (t: string) => void, c: any) {
  const parts: React.ReactNode[] = [];
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <Text key={key++} style={[{ color: c.text, fontFamily: fontFamilies.inter, fontSize: 16, lineHeight: 24 }]} selectable>
          {text.slice(lastIndex, match.index)}
        </Text>
      );
    }
    parts.push(<CodeBlock key={key++} language={match[1] ?? ''} code={match[2] ?? ''} onCopy={onCopy} />);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(
      <Text key={key++} style={[{ color: c.text, fontFamily: fontFamilies.inter, fontSize: 16, lineHeight: 24 }]} selectable>
        {renderInlineMarkdown(text.slice(lastIndex), c)}
      </Text>
    );
  }
  if (parts.length === 0) {
    parts.push(
      <Text key="empty" style={[{ color: c.text, fontFamily: fontFamilies.inter, fontSize: 16, lineHeight: 24 }]} selectable>
        {text}
      </Text>
    );
  }
  return parts;
}

function renderInlineMarkdown(text: string, c: any): React.ReactNode[] {
  // Simple bold / inline code rendering
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*)|(`(.+?)`)/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push(text.slice(lastIdx, m.index));
    if (m[2]) parts.push(<Text key={k++} style={{ fontFamily: fontFamilies.interSemiBold }}>{m[2]}</Text>);
    if (m[4]) parts.push(<Text key={k++} style={{ fontFamily: fontFamilies.mono, fontSize: 14, backgroundColor: c.codeBg, borderRadius: 3, paddingHorizontal: 3 }}>{m[4]}</Text>);
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts;
}

export default React.memo(function MessageBubble({ message, isLast, isStreaming, stream, onCopy, onRegenerate, onLongPress }: Props) {
  const theme = useTheme<AppTheme>();
  const c = theme.appColors;
  const isUser = message.role === 'user';

  // Thinking and answer. Replies saved before thinking was stored separately
  // may still have it inline in <think> tags; split those for display.
  const { thinking, answer } = useMemo(() => {
    if (isStreaming) return { thinking: stream?.thinking ?? '', answer: stream?.answer ?? '' };
    if (isUser || message.reasoning) return { thinking: message.reasoning ?? '', answer: message.content ?? '' };
    const s = splitThinking(message.content ?? '');
    return { thinking: s.thinking, answer: s.answer };
  }, [isStreaming, stream, isUser, message.reasoning, message.content]);
  const displayText = answer;
  const thinkingActive = isStreaming && !!stream?.thinkingOpen;

  const bubbleStyle = useMemo(() => ([
    styles.bubble,
    {
      backgroundColor: isUser ? c.userBubble : c.assistantBubble,
      alignSelf: isUser ? 'flex-end' as const : 'flex-start' as const,
      maxWidth: isUser ? '85%' : '100%',
      borderTopLeftRadius: isUser ? radii.bubble : radii.bubbleTail,
      borderTopRightRadius: radii.bubble,
      borderBottomLeftRadius: radii.bubble,
      borderBottomRightRadius: isUser ? radii.bubbleTail : radii.bubble,
      borderWidth: !isUser && !theme.dark ? StyleSheet.hairlineWidth : 0,
      borderColor: c.hairline,
    },
  ]), [isUser, c, theme.dark]);

  return (
    <Pressable onLongPress={onLongPress} style={styles.wrapper}>
      <View style={bubbleStyle as any}>
        {isUser ? (
          <Text style={{ color: c.text, fontFamily: fontFamilies.inter, fontSize: 16, lineHeight: 24 }} selectable>
            {displayText}
          </Text>
        ) : (
          <View>
            {(thinking.length > 0 || thinkingActive) && (
              <ThinkingBlock text={thinking} active={thinkingActive} streaming={isStreaming} ms={message.thinkingMs} />
            )}
            {(displayText.length > 0 || (isStreaming && !thinkingActive)) &&
              renderContent(displayText + (isStreaming ? ' █' : ''), onCopy, c)}
          </View>
        )}
      </View>
      {!isUser && !isStreaming && (answer.length > 0 || thinking.length > 0) && (
        <View style={styles.footer}>
          {(message.tokenCount ?? 0) > 0 && (
            <Text style={[styles.stats, { color: c.textSecondary, fontFamily: fontFamilies.mono }]}>
              {message.tokenCount} tok · {(message.tokensPerSec ?? 0)?.toFixed?.(1)} tok/s
              {message.stopped ? ' · stopped' : ''}
            </Text>
          )}
          <IconButton icon="content-copy" size={16} iconColor={c.textSecondary} onPress={() => onCopy(answer)} accessibilityLabel="Copy message" style={styles.footerBtn} />
          {isLast && onRegenerate && (
            <IconButton icon="refresh" size={16} iconColor={c.textSecondary} onPress={onRegenerate} accessibilityLabel="Regenerate response" style={styles.footerBtn} />
          )}
        </View>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  wrapper: { paddingHorizontal: spacing.md, marginBottom: spacing.xs },
  bubble: { padding: spacing.sm, paddingHorizontal: spacing.md },
  footer: { flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.md, marginTop: 2 },
  stats: { fontSize: 12, lineHeight: 16 },
  footerBtn: { margin: 0, width: 32, height: 32 },
});
