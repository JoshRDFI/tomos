import React, { useMemo } from 'react';
import { View, StyleSheet, Pressable, ScrollView, Platform } from 'react-native';
import { Text, IconButton, useTheme } from 'react-native-paper';
import type { AppTheme } from '@/constants/theme';
import { spacing, radii, typeScale, fontFamilies } from '@/constants/theme';
import type { MessageRecord } from '@/types';

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
  streamingText?: string;
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

export default React.memo(function MessageBubble({ message, isLast, isStreaming, streamingText, onCopy, onRegenerate, onLongPress }: Props) {
  const theme = useTheme<AppTheme>();
  const c = theme.appColors;
  const isUser = message.role === 'user';
  const displayText = isStreaming ? (streamingText ?? '') : (message.content ?? '');

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
          <View>{renderContent(displayText + (isStreaming ? ' █' : ''), onCopy, c)}</View>
        )}
      </View>
      {!isUser && !isStreaming && message.content?.length > 0 && (
        <View style={styles.footer}>
          {(message.tokenCount ?? 0) > 0 && (
            <Text style={[styles.stats, { color: c.textSecondary, fontFamily: fontFamilies.mono }]}>
              {message.tokenCount} tok · {(message.tokensPerSec ?? 0)?.toFixed?.(1)} tok/s
              {message.stopped ? ' · stopped' : ''}
            </Text>
          )}
          <IconButton icon="content-copy" size={16} iconColor={c.textSecondary} onPress={() => onCopy(message.content ?? '')} accessibilityLabel="Copy message" style={styles.footerBtn} />
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
