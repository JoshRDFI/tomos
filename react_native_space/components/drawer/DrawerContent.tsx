import React, { useMemo, useCallback } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text, Button, IconButton, Menu, Divider, useTheme, Icon } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import type { AppTheme } from '@/constants/theme';
import { spacing, fontFamilies, typeScale } from '@/constants/theme';
import type { SessionRecord } from '@/types';

interface Props {
  sessions: SessionRecord[];
  activeSessionId: string | null;
  onNewChat: () => void;
  onSelectSession: (id: string) => void;
  onRename: (session: SessionRecord) => void;
  onDelete: (session: SessionRecord) => void;
  onExport: (session: SessionRecord, format: 'md' | 'txt') => void;
  onClose: () => void;
}

function dateGroup(ts: number): string {
  const now = new Date();
  const d = new Date(ts);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = today.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (diff < 0) return 'Today';
  if (diff === 0) return 'Today';
  if (diff <= 86400000) return 'Yesterday';
  if (diff <= 7 * 86400000) return 'Previous 7 days';
  return 'Older';
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

type ListItem = { type: 'header'; title: string } | { type: 'session'; session: SessionRecord };

function SessionRow({ session, isActive, c, onSelect, onRename, onDelete, onExport }: {
  session: SessionRecord;
  isActive: boolean;
  c: any;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
  onExport: (f: 'md' | 'txt') => void;
}) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  return (
    <Pressable onPress={onSelect} style={[rowStyles.row, isActive && { backgroundColor: c.brandTint }]}>
      {isActive && <View style={[rowStyles.indicator, { backgroundColor: c.brand }]} />}
      <View style={rowStyles.textCol}>
        <Text numberOfLines={1} style={[rowStyles.title, { color: c.text, fontFamily: fontFamilies.inter }]}>{session.title ?? 'New chat'}</Text>
        <Text numberOfLines={1} style={[rowStyles.subtitle, { color: c.textSecondary, fontFamily: fontFamilies.inter }]}>{timeAgo(session.updatedAt)}</Text>
      </View>
      <Menu
        visible={menuOpen}
        onDismiss={() => setMenuOpen(false)}
        anchor={<IconButton icon="dots-vertical" size={18} iconColor={c.textSecondary} onPress={() => setMenuOpen(true)} accessibilityLabel="Session options" />}
      >
        <Menu.Item onPress={() => { setMenuOpen(false); onRename(); }} title="Rename" leadingIcon="pencil-outline" />
        <Menu.Item onPress={() => { setMenuOpen(false); onExport('md'); }} title="Export as Markdown" leadingIcon="file-document-outline" />
        <Menu.Item onPress={() => { setMenuOpen(false); onExport('txt'); }} title="Export as text" leadingIcon="text-box-outline" />
        <Divider />
        <Menu.Item onPress={() => { setMenuOpen(false); onDelete(); }} title="Delete" leadingIcon="delete-outline" titleStyle={{ color: c.error }} />
      </Menu>
    </Pressable>
  );
}

const rowStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', height: 52, paddingHorizontal: 16 },
  indicator: { width: 3, height: 32, borderRadius: 2, marginRight: 8 },
  textCol: { flex: 1, gap: 2 },
  title: { fontSize: 14, lineHeight: 18 },
  subtitle: { fontSize: 12, lineHeight: 16 },
});

export default function DrawerContent({ sessions, activeSessionId, onNewChat, onSelectSession, onRename, onDelete, onExport, onClose }: Props) {
  const theme = useTheme<AppTheme>();
  const c = theme.appColors;
  const router = useRouter();

  const items = useMemo(() => {
    const result: ListItem[] = [];
    let lastGroup = '';
    for (const s of sessions ?? []) {
      const g = dateGroup(s.updatedAt);
      if (g !== lastGroup) {
        result.push({ type: 'header', title: g });
        lastGroup = g;
      }
      result.push({ type: 'session', session: s });
    }
    return result;
  }, [sessions]);

  const nav = useCallback((route: string) => {
    onClose();
    setTimeout(() => router.push(route as any), 100);
  }, [onClose, router]);

  return (
    <View style={[styles.container, { backgroundColor: c.surface }]}>
      <View style={styles.header}>
        <Text style={[styles.appTitle, { color: c.text, fontFamily: typeScale.title.fontFamily }]}>Local Chat</Text>
        <Button mode="contained" icon="plus" onPress={onNewChat} style={styles.newBtn} labelStyle={{ fontFamily: fontFamilies.interMedium }}>New chat</Button>
      </View>
      <Pressable onPress={() => nav('/search')} style={[styles.searchRow, { backgroundColor: c.surfaceRaised, borderColor: c.hairline }]}>
        <Icon source="magnify" size={18} color={c.textSecondary} />
        <Text style={{ color: c.textSecondary, fontFamily: fontFamilies.inter, fontSize: 14 }}>Search chats</Text>
      </Pressable>
      <Text style={[styles.sectionLabel, { color: c.textSecondary, fontFamily: fontFamilies.interMedium }]}>Chats</Text>
      <View style={{ flex: 1 }}>
        <FlashList
          data={items}
          keyExtractor={(item, idx) => item.type === 'header' ? `h-${item.title}` : `s-${item.session.id}`}
          renderItem={({ item }) => {
            if (item.type === 'header') {
              return <Text style={[styles.groupHeader, { color: c.textSecondary, fontFamily: fontFamilies.inter }]}>{item.title}</Text>;
            }
            return (
              <SessionRow
                session={item.session}
                isActive={item.session.id === activeSessionId}
                c={c}
                onSelect={() => onSelectSession(item.session.id)}
                onRename={() => onRename(item.session)}
                onDelete={() => onDelete(item.session)}
                onExport={(f) => onExport(item.session, f)}
              />
            );
          }}
          getItemType={(item) => item.type}
        />
      </View>
      <View style={[styles.bottomNav, { borderTopColor: c.hairline }]}>
        <Pressable onPress={() => nav('/models')} style={styles.navRow}>
          <Icon source="chip" size={20} color={c.textSecondary} />
          <Text style={[styles.navText, { color: c.text, fontFamily: fontFamilies.inter }]}>Models</Text>
        </Pressable>
        <Pressable onPress={() => nav('/settings')} style={styles.navRow}>
          <Icon source="cog-outline" size={20} color={c.textSecondary} />
          <Text style={[styles.navText, { color: c.text, fontFamily: fontFamilies.inter }]}>Settings</Text>
        </Pressable>
        <Pressable onPress={() => nav('/help')} style={styles.navRow}>
          <Icon source="help-circle-outline" size={20} color={c.textSecondary} />
          <Text style={[styles.navText, { color: c.text, fontFamily: fontFamilies.inter }]}>Help</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, gap: 12 },
  appTitle: { fontSize: 18, lineHeight: 24 },
  newBtn: { borderRadius: 24 },
  searchRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, gap: 8, marginBottom: 12 },
  sectionLabel: { fontSize: 12, paddingHorizontal: 16, marginBottom: 4 },
  groupHeader: { fontSize: 12, lineHeight: 16, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  bottomNav: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  navRow: { flexDirection: 'row', alignItems: 'center', height: 48, paddingHorizontal: 16, gap: 12 },
  navText: { fontSize: 15 },
});
