import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text, IconButton, useTheme, Icon, ActivityIndicator } from 'react-native-paper';
import type { AppTheme } from '@/constants/theme';
import { spacing, radii, fontFamilies } from '@/constants/theme';
import Markdown from './Markdown';
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

interface Props {
  message: MessageRecord;
  isLast: boolean;
  isStreaming: boolean;
  /** Thinking and answer so far, while this reply streams. */
  stream?: StreamView;
  onCopy: (text: string) => void;
  onRegenerate?: () => void;
  /** Continue this stopped or cut-off reply. */
  onContinue?: () => void;
  onLongPress?: () => void;
  /** Show the previous (-1) or next (+1) version of this message. */
  onSwitchVersion?: (delta: number) => void;
}

/** "‹ 2/3 ›" for a message that has other versions. */
function VersionSwitcher({ index, count, onSwitch }: { index: number; count: number; onSwitch: (delta: number) => void }) {
  const theme = useTheme<AppTheme>();
  const c = theme.appColors;
  return (
    <View style={styles.versions}>
      <IconButton icon="chevron-left" size={16} iconColor={c.textSecondary} disabled={index === 0} onPress={() => onSwitch(-1)} accessibilityLabel="Previous version" style={styles.footerBtn} />
      <Text style={[styles.stats, { color: c.textSecondary, fontFamily: fontFamilies.mono }]} accessibilityLabel={`Version ${index + 1} of ${count}`}>
        {index + 1}/{count}
      </Text>
      <IconButton icon="chevron-right" size={16} iconColor={c.textSecondary} disabled={index === count - 1} onPress={() => onSwitch(1)} accessibilityLabel="Next version" style={styles.footerBtn} />
    </View>
  );
}

/** "Reading the conversation…" with seconds elapsed, so a slow start doesn't look frozen. */
export function StatusLine({ text, onStop }: { text: string; onStop?: () => void }) {
  const c = useTheme<AppTheme>().appColors;
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <View style={styles.status}>
      <ActivityIndicator size={14} color={c.textSecondary} />
      <Text style={{ color: c.textSecondary, fontFamily: fontFamilies.inter, fontSize: 13, flexShrink: 1 }}>
        {text}{secs >= 3 ? ` ${secs} s` : ''}
      </Text>
      {onStop && (
        <Pressable onPress={onStop} accessibilityRole="button" hitSlop={8}>
          <Text style={{ color: c.brand, fontFamily: fontFamilies.interMedium, fontSize: 13 }}>Stop</Text>
        </Pressable>
      )}
    </View>
  );
}

export default React.memo(function MessageBubble({ message, isLast, isStreaming, stream, onCopy, onRegenerate, onContinue, onLongPress, onSwitchVersion }: Props) {
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
  const versions = message.versions && onSwitchVersion
    ? <VersionSwitcher index={message.versions.index} count={message.versions.ids.length} onSwitch={onSwitchVersion} />
    : null;

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
            {(displayText.length > 0 || (isStreaming && !thinkingActive)) && (
              <Markdown content={displayText} streaming={isStreaming} onCopy={onCopy} />
            )}
            {isStreaming && !!stream?.status && <StatusLine text={stream.status} />}
          </View>
        )}
      </View>
      {isUser && versions && (
        <View style={[styles.footer, { alignSelf: 'flex-end' }]}>{versions}</View>
      )}
      {!isUser && !isStreaming && (answer.length > 0 || thinking.length > 0 || !!versions) && (
        <View style={styles.footer}>
          {versions}
          {(message.tokenCount ?? 0) > 0 && (
            <Text style={[styles.stats, { color: c.textSecondary, fontFamily: fontFamilies.mono }]}>
              {message.tokenCount} tok · {(message.tokensPerSec ?? 0)?.toFixed?.(1)} tok/s
              {message.stopped === 2 ? ' · cut off' : message.stopped ? ' · stopped' : ''}
            </Text>
          )}
          <IconButton icon="content-copy" size={16} iconColor={c.textSecondary} onPress={() => onCopy(answer)} accessibilityLabel="Copy message" style={styles.footerBtn} />
          {isLast && onContinue && (
            <IconButton icon="play-outline" size={16} iconColor={c.textSecondary} onPress={onContinue} accessibilityLabel="Continue response" style={styles.footerBtn} />
          )}
          {isLast && onRegenerate && (
            <IconButton icon="refresh" size={16} iconColor={c.textSecondary} onPress={onRegenerate} accessibilityLabel="Regenerate response" style={styles.footerBtn} />
          )}
        </View>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  wrapper: { paddingHorizontal: spacing.md, marginBottom: spacing.xs },
  bubble: { padding: spacing.sm, paddingHorizontal: spacing.md },
  footer: { flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.md, marginTop: 2 },
  stats: { fontSize: 12, lineHeight: 16 },
  footerBtn: { margin: 0, width: 32, height: 32 },
  versions: { flexDirection: 'row', alignItems: 'center', marginRight: 4 },
});
