import React, { useState, useRef, useEffect } from 'react';
import { View, TextInput, StyleSheet, Pressable, Animated, Platform, Keyboard } from 'react-native';
import { Text, useTheme, Icon } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AppTheme } from '@/constants/theme';
import { spacing, radii, fontFamilies } from '@/constants/theme';

interface Props {
  onSend: (text: string) => void;
  onStop: () => void;
  isGenerating: boolean;
  modelReady: boolean;
  editMode?: { text: string; onCancel: () => void } | null;
  /** Text to put in the box for the user to finish (suggestion chips); a new `key` re-applies it. */
  draft?: { text: string; key: number } | null;
}

export default function ChatInput({ onSend, onStop, isGenerating, modelReady, editMode, draft }: Props) {
  const theme = useTheme<AppTheme>();
  const c = theme.appColors;
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (editMode?.text) setText(editMode.text);
  }, [editMode?.text]);

  useEffect(() => {
    if (!draft) return;
    setText(draft.text);
    // Focus after the text lands so the cursor sits at the end.
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [draft?.key]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
    Keyboard.dismiss();
  };

  const handlePress = () => {
    if (isGenerating) {
      onStop();
      if (Platform.OS !== 'web') {
        import('expo-haptics').then((H) => H.impactAsync(H.ImpactFeedbackStyle.Medium)).catch(() => {});
      }
    } else {
      handleSend();
    }
  };

  const onPressIn = () => {
    Animated.spring(scaleAnim, { toValue: 0.95, useNativeDriver: true }).start();
  };
  const onPressOut = () => {
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true }).start();
  };

  const canSend = text.trim().length > 0 && modelReady && !isGenerating;
  const btnColor = isGenerating ? c.accent : (canSend ? c.brand : c.hairline);
  const btnIcon = isGenerating ? 'stop' : 'arrow-up';
  const btnLabel = isGenerating ? 'Stop generating' : 'Send';
  const disabled = !isGenerating && !canSend;

  return (
    <View style={[styles.container, { backgroundColor: c.surface, borderTopColor: c.hairline, paddingBottom: Math.max(insets.bottom, spacing.xs) }]}>
      {editMode && (
        <View style={[styles.editChip, { backgroundColor: c.brandTint }]}>
          <Text style={{ color: c.brand, fontSize: 13, fontFamily: fontFamilies.interMedium }}>Editing message</Text>
          <Pressable onPress={editMode.onCancel} hitSlop={8}>
            <Icon source="close" size={16} color={c.brand} />
          </Pressable>
        </View>
      )}
      <View style={styles.row}>
        <TextInput
          ref={inputRef}
          style={[styles.input, { backgroundColor: c.surfaceRaised, color: c.text, fontFamily: fontFamilies.inter, borderColor: c.hairline }]}
          value={text}
          onChangeText={setText}
          placeholder="Message"
          placeholderTextColor={c.textSecondary}
          multiline
          maxLength={100000}
          textAlignVertical="top"
          onSubmitEditing={handleSend}
          blurOnSubmit={false}
        />
        <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
          <Pressable
            onPress={handlePress}
            onPressIn={onPressIn}
            onPressOut={onPressOut}
            disabled={disabled}
            accessibilityLabel={btnLabel}
            accessibilityRole="button"
            style={[styles.sendBtn, { backgroundColor: btnColor, opacity: disabled ? 0.4 : 1 }]}
          >
            <Icon source={btnIcon} size={22} color={c.background} />
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.sm, paddingTop: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs },
  input: { flex: 1, fontSize: 16, lineHeight: 22, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radii.input, borderWidth: StyleSheet.hairlineWidth, maxHeight: 140, minHeight: 44 },
  sendBtn: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
  editChip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, marginBottom: 6 },
});
