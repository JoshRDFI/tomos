import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions, BackHandler, KeyboardAvoidingView, Pressable, AppState } from 'react-native';
import * as downloader from '@/lib/downloader';
import { syncDownloads } from '@/lib/downloads';
import { Text, IconButton, Menu, useTheme, Snackbar, Portal, Dialog, Button, TextInput as PaperInput, ActivityIndicator, Divider } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Drawer as DrawerLayout } from 'react-native-drawer-layout';
import { FlashList } from '@shopify/flash-list';
import { useRouter, useFocusEffect } from 'expo-router';
import type { AppTheme } from '@/constants/theme';
import { spacing, fontFamilies, typeScale } from '@/constants/theme';
import { useModelContext } from '@/contexts/ModelContext';
import { useSettings } from '@/contexts/SettingsContext';
import * as db from '@/lib/db';
import * as llama from '@/lib/llama';
import { prepareModel } from '@/lib/modelMeta';
import { loadSignature } from '@/lib/params';
import { splitThinking } from '@/lib/thinking';
import { withDate } from '@/lib/dateContext';
import type { SessionRecord, MessageRecord, ModelRecord } from '@/types';
import MessageBubble from '@/components/chat/MessageBubble';
import ChatInput from '@/components/chat/ChatInput';
import EmptyChat from '@/components/chat/EmptyChat';
import { toChatMessages } from '@/lib/prompt';
import DrawerContent from '@/components/drawer/DrawerContent';
import WebNotice from '@/components/WebNotice';

const EMPTY_STREAM: llama.StreamView = { thinking: '', answer: '', thinkingOpen: false };

export default function ChatScreen() {
  const theme = useTheme<AppTheme>();
  const c = theme.appColors;
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const router = useRouter();
  const modelCtx = useModelContext();
  const settings = useSettings();

  // State
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [snack, setSnack] = useState('');
  const [stream, setStream] = useState<llama.StreamView>(EMPTY_STREAM);
  const [isStreaming, setIsStreaming] = useState(false);
  const [editMode, setEditMode] = useState<{ messageId: string; text: string } | null>(null);
  // Suggestion chip text for the user to finish in the message box.
  const [draft, setDraft] = useState<{ text: string; key: number } | null>(null);
  const [renameDialog, setRenameDialog] = useState<SessionRecord | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<SessionRecord | null>(null);
  const [renameText, setRenameText] = useState('');
  const [longPressMsg, setLongPressMsg] = useState<MessageRecord | null>(null);

  // refs removed - DrawerLayout and FlashList v2 don't support them in this way
  const isWeb = Platform.OS === 'web';

  // Init
  useEffect(() => {
    if (isWeb) return;
    (async () => {
      try {
        const allSessions = await db.getAllSessions();
        setSessions(allSessions);
        const allModels = await db.getAllModels();
        setModels(allModels);

        const lastId = await db.getSetting('lastSessionId');
        let s = lastId ? await db.getSession(lastId) : null;
        if (!s && allSessions.length > 0) s = allSessions[0] ?? null;
        if (!s) {
          const lastModelId = await db.getSetting('lastModelId');
          s = await db.createSession(lastModelId);
          setSessions((prev) => [s!, ...prev]);
        }
        if (s) {
          setSession(s);
          db.setSetting('lastSessionId', s.id).catch(() => {});
          const msgs = await db.getSessionMessages(s.id);
          setMessages(msgs);
        }

        // Auto-load last model
        if (modelCtx.status === 'idle') {
          const lastModelId = await db.getSetting('lastModelId');
          if (lastModelId) {
            const model = await db.getModel(lastModelId);
            if (model) {
              const prepared = await prepareModel(model, s);
              modelCtx.loadModel(prepared.model, prepared.load);
            }
          }
        }
      } catch (e) {
        console.warn('Init error', e);
      }
    })();
  }, [isWeb]);

  // Refresh sessions/models on focus (simplified for non-web)
  const refreshSessions = useCallback(async () => {
    if (isWeb) return;
    const s = await db.getAllSessions();
    setSessions(s);
    const m = await db.getAllModels();
    setModels(m);
  }, [isWeb]);

  // Hugging Face downloads that finished while the app was away become models
  // here too, not only on the Models screen.
  useEffect(() => {
    if (isWeb || !downloader.isSupported()) return;
    const check = async () => {
      try {
        const { finished } = await syncDownloads();
        if (finished.length === 0) return;
        refreshSessions();
        setSnack(finished.length === 1 ? `${finished[0].displayName} downloaded` : `${finished.length} models downloaded`);
      } catch (e) {
        console.warn('Download sync failed', e);
      }
    };
    check();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') check(); });
    return () => sub.remove();
  }, [isWeb, refreshSessions]);

  // On returning to this screen: pick up session edits (chat settings), a
  // session chosen from search, and models added/removed on the Models screen.
  // Guards against a second send while one is generating (state updates are
  // async, so isStreaming alone can let a fast double-tap through).
  const generatingRef = useRef(false);

  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = session?.id ?? null;
  useFocusEffect(
    useCallback(() => {
      if (isWeb) return;
      let cancelled = false;
      (async () => {
        const currentId = sessionIdRef.current;
        if (!currentId) return; // initial load not finished yet
        const targetId = (await db.getSetting('lastSessionId')) ?? currentId;
        let target = (await db.getSession(targetId)) ?? (await db.getSession(currentId));
        if (!target) {
          // Both gone (e.g. a backup was restored): newest chat, or a new one.
          target = (await db.getAllSessions())[0] ?? (await db.createSession(modelCtx.loadedModelId));
          db.setSetting('lastSessionId', target.id).catch(() => {});
        }
        if (cancelled) return;
        setSession(target);
        // Reload messages too: a search hit may have selected another branch.
        // Not while generating, which shows the history being replied to.
        if (target.id !== currentId || !generatingRef.current) {
          const msgs = await db.getSessionMessages(target.id);
          if (!cancelled) setMessages(msgs);
          if (target.id !== currentId) setEditMode(null);
        }
        refreshSessions();
      })().catch((e) => console.warn('Focus refresh error', e));
      return () => { cancelled = true; };
    }, [isWeb, refreshSessions, modelCtx.loadedModelId]),
  );

  // Drawer back handler
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (drawerOpen) {
        setDrawerOpen(false);
        return true;
      }
      return false;
    });
    return () => handler.remove();
  }, [drawerOpen]);

  // Switch session
  const switchSession = useCallback(async (id: string) => {
    if (isWeb) return;
    const s = await db.getSession(id);
    if (!s) return;
    setSession(s);
    const msgs = await db.getSessionMessages(s.id);
    setMessages(msgs);
    setDrawerOpen(false);
    db.setSetting('lastSessionId', s.id).catch(() => {});
  }, [isWeb]);

  // New chat
  const newChat = useCallback(async () => {
    if (isWeb) return;
    const modelId = modelCtx.loadedModelId ?? (await db.getSetting('lastModelId'));
    const s = await db.createSession(modelId);
    setSession(s);
    setMessages([]);
    setSessions((prev) => [s, ...prev]);
    setDrawerOpen(false);
    db.setSetting('lastSessionId', s.id).catch(() => {});
  }, [isWeb, modelCtx.loadedModelId]);


  // Generate a reply to `parentId` (a user message) from the conversation
  // leading up to it. The reply is added as a new version under that message,
  // or, with `cont`, appended to that stopped or cut-off reply.
  const runGeneration = useCallback(async (sessionId: string, loadedModel: ModelRecord, parentId: string, cont?: MessageRecord) => {
    // Re-read the session so edits made on the chat-settings screen apply.
    const fresh = await db.getSession(sessionId);
    if (!fresh) return;
    setSession(fresh);

    // While regenerating, the reply being replaced is hidden.
    const currentMsgs = await db.getMessagePath(sessionId, parentId);
    setMessages(currentMsgs);

    // Effective settings (all chats < model file < this model < this chat);
    // reload if any load-time setting changed.
    const { model, load, completion } = await prepareModel(loadedModel, fresh);
    const needReload = llama.getLoadedModelId() !== model.id ||
      llama.getLoadedSignature() !== loadSignature(load);
    if (needReload) {
      const ok = await modelCtx.loadModel(model, load);
      if (!ok) return;
    }

    // Generate
    // A continuation is the old reply (thinking split out, also for replies
    // saved before thinking was stored separately) plus what comes next.
    const partial = cont
      ? (cont.reasoning
        ? { content: cont.content ?? '', reasoning: cont.reasoning }
        : (() => { const t = splitThinking(cont.content ?? ''); return { content: t.answer, reasoning: t.thinking }; })())
      : undefined;
    setIsStreaming(true);
    setStream(partial
      ? { thinking: partial.reasoning, answer: partial.content, thinkingOpen: !partial.content && !!partial.reasoning }
      : EMPTY_STREAM);
    modelCtx.setGenerating(true);

    // Keep awake
    try {
      const KA = await import('expo-keep-awake');
      KA.activateKeepAwakeAsync('gen').catch(() => {});
    } catch {}

    try {
      let systemPrompt = await db.getEffectiveSystemPrompt(fresh);
      if ((await db.getSetting('includeDate')) !== '0') systemPrompt = withDate(systemPrompt, new Date());
      const chatMessages = [
        ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
        ...toChatMessages(currentMsgs),
      ];

      const result = await llama.generate(model, chatMessages, completion, setStream, partial);

      if (result.droppedMessages > 0) {
        setSnack(`Conversation is longer than the context window; the oldest ${result.droppedMessages} message${result.droppedMessages === 1 ? ' was' : 's were'} left out.`);
      }

      // 1 = stopped by the user, 2 = cut off by the length limit.
      const stopped = result.stopped ? 1 : result.cutOff ? 2 : 0;
      if (cont && partial) {
        await db.updateMessage(cont.id, {
          content: result.content,
          reasoning: result.reasoning || null,
          tokenCount: (cont.tokenCount ?? 0) + result.tokenCount,
          tokensPerSec: result.tokensPerSec || cont.tokensPerSec,
          stopped,
          // Thinking time grows only if the thinking itself was continued.
          thinkingMs: partial.content ? (cont.thinkingMs ?? null) : ((cont.thinkingMs ?? 0) + (result.thinkingMs ?? 0)) || null,
        });
      } else if (result.content.length > 0 || result.reasoning.length > 0 || !result.stopped) {
        // Save the reply (skipped if stopped before anything was produced)
        const asstMsg: MessageRecord = {
          id: db.generateId(),
          sessionId,
          role: 'assistant',
          content: result.content,
          modelName: model.displayName,
          tokenCount: result.tokenCount,
          tokensPerSec: result.tokensPerSec,
          stopped,
          createdAt: Date.now(),
          reasoning: result.reasoning || null,
          thinkingMs: result.thinkingMs,
          parentId,
        };
        await db.insertMessage(asstMsg);
      }
      await db.updateSession(sessionId, { updatedAt: Date.now() });

      const finalMsgs = await db.getSessionMessages(sessionId);
      setMessages(finalMsgs);
    } catch (e) {
      console.warn('Generation error', e);
      setSnack('Generation failed: ' + String((e as any)?.message ?? e));
    } finally {
      setIsStreaming(false);
      setStream(EMPTY_STREAM);
      modelCtx.setGenerating(false);
      try {
        const KA = await import('expo-keep-awake');
        KA.deactivateKeepAwake('gen');
      } catch {}
    }
  }, [modelCtx]);

  // Send message
  const sendMessage = useCallback(async (text: string) => {
    if (isWeb || !session || generatingRef.current) return;
    const model = modelCtx.loadedModel;
    if (!model) return;
    generatingRef.current = true;
    try {
      // An edit becomes a new version of the edited message; the old version
      // and the replies after it stay available through the version switcher.
      let parentId: string | null;
      if (editMode) {
        const editMsg = messages.find((m) => m.id === editMode.messageId);
        parentId = editMsg ? (editMsg.parentId ?? null) : (messages[messages.length - 1]?.id ?? null);
        setEditMode(null);
      } else {
        const path = await db.getSessionMessages(session.id);
        parentId = path[path.length - 1]?.id ?? null;
      }
      const userMsg: MessageRecord = {
        id: db.generateId(),
        sessionId: session.id,
        role: 'user',
        content: text,
        modelName: model.displayName,
        tokenCount: null,
        tokensPerSec: null,
        stopped: 0,
        createdAt: Date.now(),
        parentId,
      };
      await db.insertMessage(userMsg);

      // Auto-title on first user message
      const count = await db.getSessionMessageCount(session.id);
      if (count <= 1) {
        await db.updateSession(session.id, { title: text.slice(0, 40), updatedAt: Date.now() });
      }

      await runGeneration(session.id, model, userMsg.id);
    } finally {
      generatingRef.current = false;
    }
    refreshSessions();
  }, [isWeb, session, modelCtx.loadedModel, editMode, messages, runGeneration, refreshSessions]);

  // Stop
  const handleStop = useCallback(() => {
    llama.stopGeneration();
  }, []);

  // Copy
  const handleCopy = useCallback(async (text: string) => {
    if (Platform.OS !== 'web') {
      try {
        const Clip = await import('expo-clipboard');
        await Clip.setStringAsync(text);
        const H = await import('expo-haptics');
        H.impactAsync(H.ImpactFeedbackStyle.Light).catch(() => {});
      } catch {}
    }
    setSnack('Copied');
  }, []);

  // Regenerate: a new version of the last reply; the old one is kept.
  const handleRegenerate = useCallback(async () => {
    if (!session || messages.length === 0 || generatingRef.current) return;
    const model = modelCtx.loadedModel;
    if (!model) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role !== 'assistant' || !lastMsg.parentId) return;
    generatingRef.current = true;
    try {
      await runGeneration(session.id, model, lastMsg.parentId);
    } finally {
      generatingRef.current = false;
    }
    refreshSessions();
  }, [session, messages, modelCtx.loadedModel, runGeneration, refreshSessions]);

  // Continue the last reply where it stopped or was cut off.
  const handleContinue = useCallback(async () => {
    if (!session || messages.length === 0 || generatingRef.current) return;
    const model = modelCtx.loadedModel;
    if (!model) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role !== 'assistant' || !lastMsg.parentId || !lastMsg.stopped) return;
    generatingRef.current = true;
    try {
      await runGeneration(session.id, model, lastMsg.parentId, lastMsg);
    } finally {
      generatingRef.current = false;
    }
    refreshSessions();
  }, [session, messages, modelCtx.loadedModel, runGeneration, refreshSessions]);

  // Show another version of a message (and the conversation that followed it).
  const handleSwitchVersion = useCallback(async (msg: MessageRecord, delta: number) => {
    if (!session || !msg.versions || generatingRef.current) return;
    const id = msg.versions.ids[msg.versions.index + delta];
    if (!id) return;
    await db.selectMessage({ id, sessionId: session.id, parentId: msg.parentId ?? null });
    setMessages(await db.getSessionMessages(session.id));
    setEditMode(null);
  }, [session]);

  // Model switch
  const handleModelSwitch = useCallback(async (model: ModelRecord) => {
    setModelMenuOpen(false);
    if (!session) return;
    // Releasing the model mid-generation would kill the reply in progress.
    if (generatingRef.current) {
      setSnack('Stop generating before switching models');
      return;
    }
    await db.updateSession(session.id, { modelId: model.id, updatedAt: Date.now() });
    setSession((s) => s ? { ...s, modelId: model.id } : s);
    const prepared = await prepareModel(model, await db.getSession(session.id));
    await modelCtx.loadModel(prepared.model, prepared.load);
  }, [session, modelCtx]);

  // Rename
  const handleRename = useCallback(async () => {
    if (!renameDialog || !renameText.trim()) return;
    await db.updateSession(renameDialog.id, { title: renameText.trim() });
    if (session?.id === renameDialog.id) {
      setSession((s) => s ? { ...s, title: renameText.trim() } : s);
    }
    setRenameDialog(null);
    refreshSessions();
  }, [renameDialog, renameText, session, refreshSessions]);

  // Delete session
  const handleDelete = useCallback(async () => {
    if (!deleteDialog) return;
    await db.deleteSession(deleteDialog.id);
    if (session?.id === deleteDialog.id) {
      const remaining = sessions.filter((s) => s.id !== deleteDialog.id);
      if (remaining.length > 0) {
        await switchSession(remaining[0]!.id);
      } else {
        await newChat();
      }
    }
    setDeleteDialog(null);
    refreshSessions();
  }, [deleteDialog, session, sessions, switchSession, newChat, refreshSessions]);

  // Export
  const handleExport = useCallback(async (s: SessionRecord, format: 'md' | 'txt') => {
    if (isWeb) return;
    try {
      const msgs = await db.getSessionMessages(s.id);
      let content = `${s.title}\n\n`;
      for (const m of msgs) {
        if (format === 'md') {
          content += `**${m.role === 'user' ? 'You' : 'Assistant'}:**\n`;
          if (m.reasoning) content += `<details><summary>Thinking</summary>\n\n${m.reasoning}\n\n</details>\n\n`;
          content += `${m.content}\n\n`;
        } else {
          content += `${m.role === 'user' ? 'You' : 'Assistant'}:\n${m.content}\n\n`;
        }
      }
      const ext = format === 'md' ? '.md' : '.txt';
      const { Paths, File } = await import('expo-file-system');
      const file = new File(Paths.cache, `${s.title?.replace(/[^a-zA-Z0-9]/g, '_') ?? 'chat'}${ext}`);
      await file.write(content);
      const Sharing = await import('expo-sharing');
      await Sharing.shareAsync(file.uri);
    } catch (e) {
      console.warn('Export error', e);
    }
  }, [isWeb]);

  // Long press actions
  const handleEditResend = useCallback(() => {
    if (!longPressMsg || longPressMsg.role !== 'user') return;
    setEditMode({ messageId: longPressMsg.id, text: longPressMsg.content });
    setLongPressMsg(null);
  }, [longPressMsg]);

  // Render
  const drawerWidth = Math.min(screenWidth * 0.84, 360);
  const modelReady = modelCtx.status === 'ready';
  const hasMessages = (messages?.length ?? 0) > 0;

  // Chronological order (oldest first); the list starts rendering from the
  // bottom. While streaming, a placeholder reply is appended at the end.
  const displayMessages = React.useMemo(() => {
    const base = messages ?? [];
    if (isStreaming) {
      const streamMsg: MessageRecord = {
        id: '__streaming__',
        sessionId: session?.id ?? '',
        role: 'assistant',
        content: '',
        modelName: modelCtx.loadedModel?.displayName ?? null,
        tokenCount: null,
        tokensPerSec: null,
        stopped: 0,
        createdAt: Date.now(),
      };
      return [...base, streamMsg];
    }
    return base;
  }, [messages, isStreaming, session?.id, modelCtx.loadedModel?.displayName]);
  const displayCount = displayMessages.length;

  const renderMessage = useCallback(({ item, index }: { item: MessageRecord; index: number }) => {
    const streaming = isStreaming && item.id === '__streaming__';
    const isLastAssistant = item.role === 'assistant' && index === displayCount - 1 && !isStreaming;
    return (
      <MessageBubble
        message={item}
        isLast={isLastAssistant}
        isStreaming={streaming}
        stream={streaming ? stream : undefined}
        onCopy={handleCopy}
        onRegenerate={isLastAssistant ? handleRegenerate : undefined}
        onContinue={isLastAssistant && !!item.stopped ? handleContinue : undefined}
        onLongPress={() => setLongPressMsg(item)}
        onSwitchVersion={!isStreaming && item.versions ? (delta) => handleSwitchVersion(item, delta) : undefined}
      />
    );
  }, [isStreaming, stream, handleCopy, handleRegenerate, handleContinue, handleSwitchVersion, displayCount]);

  const chatTopBar = (
    <View style={[styles.topBar, { backgroundColor: c.surface, borderBottomColor: c.hairline, paddingTop: insets.top, height: 56 + insets.top, zIndex: 1 }]}>
      <IconButton icon="menu" size={24} iconColor={c.text} onPress={() => setDrawerOpen(true)} accessibilityLabel="Open menu" />
      <Pressable onPress={() => setModelMenuOpen(true)} style={styles.modelInfo}>
        <Text numberOfLines={1} style={[styles.modelName, { color: c.text, fontFamily: typeScale.titleSmall.fontFamily }]}>
          {modelCtx.loadedModel?.displayName ?? 'No model'}
        </Text>
        {modelCtx.loadedModel && (
          <Text style={[styles.modelMeta, { color: c.textSecondary, fontFamily: fontFamilies.mono }]}>
            {[modelCtx.loadedModel.quantization, modelCtx.loadedModel.parameterLabel].filter(Boolean).join(' · ')}
          </Text>
        )}
      </Pressable>
      <Menu
        visible={modelMenuOpen}
        onDismiss={() => setModelMenuOpen(false)}
        anchor={<View />}
        anchorPosition="bottom"
      >
        {models.map((m) => (
          <Menu.Item
            key={m.id}
            onPress={() => handleModelSwitch(m)}
            title={m.displayName}
            leadingIcon={m.id === modelCtx.loadedModelId ? 'check' : undefined}
          />
        ))}
        <Divider />
        <Menu.Item onPress={() => { setModelMenuOpen(false); router.push('/models'); }} title="Manage models…" leadingIcon="chip" />
      </Menu>
      <IconButton
        icon="tune-variant"
        size={24}
        iconColor={c.text}
        onPress={() => session && router.push({ pathname: '/chat-settings', params: { sessionId: session.id } })}
        accessibilityLabel="Chat settings"
      />
    </View>
  );

  // Status banner
  const statusBanner = modelCtx.status === 'loading' ? (
    <View style={[styles.banner, { backgroundColor: c.brandTint }]}>
      <ActivityIndicator size="small" color={c.brand} />
      <Text style={{ color: c.brand, fontFamily: fontFamilies.inter, fontSize: 13, flex: 1 }}>
        Loading {modelCtx.loadedModel?.displayName ?? 'model'}… (first load can take 10–30 s)
      </Text>
    </View>
  ) : modelCtx.error ? (
    <View style={[styles.banner, { backgroundColor: c.accent + '22' }]}>
      <Text style={{ color: c.accent, fontFamily: fontFamilies.inter, fontSize: 13, flex: 1 }}>{modelCtx.error}</Text>
    </View>
  ) : null;

  const mainContent = (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={[styles.container, { backgroundColor: c.background }]}>
        {chatTopBar}
        {statusBanner}
        {isWeb && <WebNotice />}
        {!hasMessages && !isStreaming ? (
          <EmptyChat
            hasModels={(models?.length ?? 0) > 0}
            loadedModel={modelCtx.loadedModel}
            hasModelInLib={(models?.length ?? 0) > 0}
            onSuggestion={(s) => setDraft({ text: s, key: Date.now() })}
            onOpenModelMenu={() => setModelMenuOpen(true)}
          />
        ) : (
          // Clip the list so a tall message can never extend over (and take
          // the taps of) the top bar.
          <View style={{ flex: 1, overflow: 'hidden' }}>
            <FlashList
              key={session?.id ?? 'none'}
              data={displayMessages}
              maintainVisibleContentPosition={{
                startRenderingFromBottom: true,
                autoscrollToBottomThreshold: 0.2,
              }}
              renderItem={renderMessage}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingVertical: spacing.xs }}
            />
          </View>
        )}
        <ChatInput
          onSend={sendMessage}
          onStop={handleStop}
          isGenerating={isStreaming}
          modelReady={modelReady}
          editMode={editMode ? { text: editMode.text, onCancel: () => setEditMode(null) } : null}
          draft={draft}
        />
      </View>
    </KeyboardAvoidingView>
  );

  return (
    <>
      <DrawerLayout
        drawerStyle={{ width: drawerWidth }}
        drawerPosition="left"
        open={drawerOpen}
        onOpen={() => { setDrawerOpen(true); refreshSessions(); }}
        onClose={() => setDrawerOpen(false)}
        renderDrawerContent={() => (
          <View style={{ flex: 1, paddingTop: insets.top }}>
            <DrawerContent
              sessions={sessions}
              activeSessionId={session?.id ?? null}
              onNewChat={newChat}
              onSelectSession={switchSession}
              onRename={(s) => { setRenameText(s.title); setRenameDialog(s); }}
              onDelete={(s) => setDeleteDialog(s)}
              onExport={handleExport}
              onClose={() => setDrawerOpen(false)}
            />
          </View>
        )}
      >
        {mainContent}
      </DrawerLayout>

      <Portal>
        {/* Rename Dialog */}
        <Dialog visible={!!renameDialog} onDismiss={() => setRenameDialog(null)}>
          <Dialog.Title>Rename chat</Dialog.Title>
          <Dialog.Content>
            <PaperInput value={renameText} onChangeText={setRenameText} mode="outlined" />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setRenameDialog(null)}>Cancel</Button>
            <Button onPress={handleRename}>Save</Button>
          </Dialog.Actions>
        </Dialog>

        {/* Delete Dialog */}
        <Dialog visible={!!deleteDialog} onDismiss={() => setDeleteDialog(null)}>
          <Dialog.Title>Delete this chat?</Dialog.Title>
          <Dialog.Content><Text>This can't be undone.</Text></Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDeleteDialog(null)}>Cancel</Button>
            <Button onPress={handleDelete} textColor={c.error}>Delete</Button>
          </Dialog.Actions>
        </Dialog>

        {/* Long press menu */}
        <Dialog visible={!!longPressMsg} onDismiss={() => setLongPressMsg(null)}>
          <Dialog.Content style={{ gap: 4 }}>
            <Button icon="content-copy" onPress={() => { handleCopy(longPressMsg?.role === 'assistant' && !longPressMsg.reasoning ? splitThinking(longPressMsg.content ?? '').answer : (longPressMsg?.content ?? '')); setLongPressMsg(null); }}>Copy</Button>
            {longPressMsg?.role === 'user' && (
              <Button icon="pencil" onPress={handleEditResend}>Edit & resend</Button>
            )}
            {longPressMsg?.role === 'assistant' && longPressMsg?.id === messages?.[messages.length - 1]?.id && (
              <Button icon="refresh" onPress={() => { setLongPressMsg(null); handleRegenerate(); }}>Regenerate</Button>
            )}
            {longPressMsg?.role === 'assistant' && !!longPressMsg.stopped && longPressMsg?.id === messages?.[messages.length - 1]?.id && (
              <Button icon="play-outline" onPress={() => { setLongPressMsg(null); handleContinue(); }}>Continue</Button>
            )}
          </Dialog.Content>
        </Dialog>
      </Portal>

      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={2000}>{snack}</Snackbar>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', height: 56, borderBottomWidth: StyleSheet.hairlineWidth },
  modelInfo: { flex: 1 },
  modelName: { fontSize: 15, lineHeight: 20 },
  modelMeta: { fontSize: 12, lineHeight: 16 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
});
