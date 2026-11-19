import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Card, Chip, Dialog, Portal, Snackbar, Switch, Text, TextInput, useTheme } from 'react-native-paper';
import { Stack, useRouter } from 'expo-router';
import type { AppTheme } from '@/constants/theme';
import { fontFamilies, radii, spacing, typeScale } from '@/constants/theme';
import { parseHfLink, type HfLink } from '@/lib/hfLink';
import { fetchQuantizedRepos, fetchRepo, fileUrl, ggufRows, HfError, rangeReader, type GgufRow, type QuantizedRepo } from '@/lib/hfApi';
import { checkCompatibility, GgufError, readGgufHeader } from '@/lib/ggufHeader';
import { formatBytes, memoryHint, parseQuantFromFilename } from '@/lib/gguf';
import { pendingDownloadBytes, startDownload } from '@/lib/downloads';

const GATED_TEXT = "This model needs a Hugging Face login, which the app doesn't support yet. Download it in a browser and use Add GGUF model.";
const HEADROOM = 500 * 1024 * 1024;

type View_ =
  | { kind: 'idle' }
  | { kind: 'loading'; repo: string }
  | { kind: 'error'; message: string; retry: boolean }
  | { kind: 'files'; repo: string; sha: string; rows: GgufRow[]; selected: string | null }
  | { kind: 'bases'; repo: string; repos: QuantizedRepo[] };

interface CompatAsk {
  label: string;
  types: string[];
  prism: boolean;
}

export default function DownloadScreen() {
  const theme = useTheme<AppTheme>();
  const c = theme.appColors;
  const router = useRouter();

  const [text, setText] = useState('');
  const [view, setView] = useState<View_>({ kind: 'idle' });
  const [lastLink, setLastLink] = useState<HfLink | null>(null);
  const [totalRam, setTotalRam] = useState(0);
  const [checking, setChecking] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ repo: string; sha: string; row: GgufRow } | null>(null);
  const [wifiOnly, setWifiOnly] = useState(true);
  const [starting, setStarting] = useState(false);
  const [snack, setSnack] = useState('');
  const [compat, setCompat] = useState<CompatAsk | null>(null);
  const compatResolve = useRef<((ok: boolean) => void) | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const rowY = useRef(new Map<string, number>());
  const listY = useRef(0);

  useEffect(() => {
    (async () => {
      try {
        const Clipboard = await import('expo-clipboard');
        const clip = await Clipboard.getStringAsync();
        if (clip && parseHfLink(clip)) setText(clip.trim());
      } catch {}
      try {
        const Device = await import('expo-device');
        setTotalRam((Device as any)?.totalMemory ?? 0);
      } catch {}
    })();
  }, []);

  const load = useCallback(async (link: HfLink) => {
    setLastLink(link);
    setView({ kind: 'loading', repo: link.repo });
    try {
      const info = await fetchRepo(link.repo, link.revision);
      const rows = ggufRows(info.siblings);
      if (rows.length > 0) {
        const selected = link.file ? rows.find((r) => r.files.some((f) => f.path === link.file))?.key ?? null : null;
        rowY.current.clear();
        setView({ kind: 'files', repo: info.id, sha: info.sha, rows, selected });
        return;
      }
      setView({ kind: 'bases', repo: info.id, repos: await fetchQuantizedRepos(info.id) });
    } catch (e) {
      if (e instanceof HfError) {
        if (e.kind === 'not_found') {
          const where = link.revision ? `${link.repo} (version ${link.revision})` : link.repo;
          return setView({ kind: 'error', message: `No public model at ${where}. Check the link.`, retry: false });
        }
        if (e.kind === 'gated') return setView({ kind: 'error', message: GATED_TEXT, retry: false });
        if (e.kind === 'network') return setView({ kind: 'error', message: "Couldn't reach Hugging Face.", retry: true });
      }
      setView({ kind: 'error', message: String((e as any)?.message ?? e), retry: true });
    }
  }, []);

  const find = useCallback(() => {
    const link = parseHfLink(text);
    if (!link) {
      setView({ kind: 'error', message: "That doesn't look like a Hugging Face model link.", retry: false });
      return;
    }
    load(link);
  }, [text, load]);

  const askAnyway = useCallback((a: CompatAsk) =>
    new Promise<boolean>((resolve) => {
      compatResolve.current = resolve;
      setCompat(a);
    }), []);
  const answerCompat = useCallback((ok: boolean) => {
    compatResolve.current?.(ok);
    compatResolve.current = null;
    setCompat(null);
  }, []);

  const pick = useCallback(async (repo: string, sha: string, row: GgufRow) => {
    if (checking) return;
    try {
      const { Paths } = await import('expo-file-system');
      const free = Paths.availableDiskSpace;
      // Downloads already running will take their share of the space too.
      const pending = await pendingDownloadBytes().catch(() => 0);
      const needed = row.totalBytes + pending + HEADROOM;
      if (free > 0 && free < needed) {
        setSnack(pending > 0
          ? `Not enough storage (needs ${formatBytes(needed)}, including ${formatBytes(pending)} for downloads in progress).`
          : `Not enough storage (needs ${formatBytes(needed)}).`);
        return;
      }
    } catch {}
    setChecking(row.key);
    try {
      const report = checkCompatibility(await readGgufHeader(rangeReader(fileUrl(repo, sha, row.files[0].path))));
      if (!report.ok || row.prism) {
        setChecking(null);
        if (!(await askAnyway({ label: row.label, types: report.unsupportedTypes, prism: row.prism }))) return;
      }
    } catch (e) {
      setChecking(null);
      if (e instanceof GgufError) return setSnack(`Can't download ${row.label}: ${e.message}.`);
      return setSnack(e instanceof HfError && e.kind === 'network' ? "Couldn't reach Hugging Face." : `Can't check ${row.label}: ${String((e as any)?.message ?? e)}`);
    }
    setChecking(null);
    setWifiOnly(true);
    setConfirm({ repo, sha, row });
  }, [checking, askAnyway]);

  const start = useCallback(async () => {
    if (!confirm) return;
    setStarting(true);
    try {
      await startDownload({ repo: confirm.repo, sha: confirm.sha, row: confirm.row, wifiOnly });
      setConfirm(null);
      router.back();
    } catch (e) {
      setSnack('Download failed to start: ' + String((e as any)?.message ?? e));
    } finally {
      setStarting(false);
    }
  }, [confirm, wifiOnly, router]);

  // Scroll to the file the link named once its row has been laid out.
  const onRowLayout = useCallback((key: string, y: number) => {
    rowY.current.set(key, y);
    if (view.kind === 'files' && view.selected === key) scrollRef.current?.scrollTo({ y: listY.current + y - spacing.md, animated: true });
  }, [view]);

  const chip = (label: string, color = c.textSecondary, outline = false) => (
    <Chip compact style={[styles.chip, outline && { borderColor: color, borderWidth: 1, backgroundColor: 'transparent' }]} textStyle={[styles.chipText, { fontFamily: fontFamilies.mono, color }]}>{label}</Chip>
  );

  return (
    <>
      <Stack.Screen options={{ title: 'Download from Hugging Face', headerStyle: { backgroundColor: c.surface }, headerTintColor: c.text }} />
      <ScrollView ref={scrollRef} style={{ flex: 1, backgroundColor: c.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.md }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: c.textSecondary, fontFamily: fontFamilies.inter, fontSize: 14 }}>
          Paste a Hugging Face model link, or owner/model.
        </Text>
        <TextInput
          mode="outlined"
          value={text}
          onChangeText={setText}
          placeholder="https://huggingface.co/owner/model"
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={find}
          right={text ? <TextInput.Icon icon="close" onPress={() => setText('')} /> : undefined}
        />
        <Button mode="contained" icon="magnify" onPress={find} disabled={!text.trim() || view.kind === 'loading'} style={{ borderRadius: radii.button }}>
          Find files
        </Button>

        {view.kind === 'loading' && (
          <View style={styles.center}>
            <ActivityIndicator />
            <Text style={{ color: c.textSecondary }}>Looking up {view.repo}…</Text>
          </View>
        )}

        {view.kind === 'error' && (
          <View style={[styles.notice, { backgroundColor: c.brandTint }]}>
            <Text style={{ color: c.text, fontFamily: fontFamilies.inter, fontSize: 14 }}>{view.message}</Text>
            {view.retry && lastLink && <Button onPress={() => load(lastLink)}>Retry</Button>}
          </View>
        )}

        {view.kind === 'bases' && (
          <View style={{ gap: spacing.sm }}>
            <Text style={{ color: c.text, fontFamily: typeScale.title.fontFamily, fontSize: 15 }}>
              No GGUF files here. GGUF versions of {view.repo}:
            </Text>
            {view.repos.length === 0 && <Text style={{ color: c.textSecondary }}>No GGUF versions found on Hugging Face.</Text>}
            {view.repos.map((r) => (
              <Card key={r.id} onPress={() => load({ repo: r.id, revision: null, file: null })} style={[styles.row, { backgroundColor: c.surface, borderColor: c.hairline }]}>
                <Card.Content style={{ gap: 4 }}>
                  <Text style={{ color: c.text, fontFamily: fontFamilies.interMedium, fontSize: 15 }}>{r.id}</Text>
                  <Text style={{ color: c.textSecondary, fontFamily: fontFamilies.mono, fontSize: 12 }}>
                    {r.downloads.toLocaleString()} downloads · {r.likes.toLocaleString()} likes
                  </Text>
                </Card.Content>
              </Card>
            ))}
          </View>
        )}

        {view.kind === 'files' && (
          <View style={{ gap: spacing.sm }} onLayout={(e) => { listY.current = e.nativeEvent.layout.y; }}>
            <Text style={{ color: c.text, fontFamily: typeScale.title.fontFamily, fontSize: 15 }}>{view.repo}</Text>
            <Text style={{ color: c.textSecondary, fontSize: 13 }}>Tap a file to download it.</Text>
            {view.rows.map((row) => {
              const hint = memoryHint(row.totalBytes, totalRam);
              const hintColor = hint === 'fits' ? '#4CAF50' : hint === 'tight' ? c.accent : c.error;
              const hintLabel = hint === 'fits' ? 'Fits' : hint === 'tight' ? 'Tight' : 'Too large';
              const selected = view.selected === row.key;
              return (
                <Card
                  key={row.key}
                  onLayout={(e) => onRowLayout(row.key, e.nativeEvent.layout.y)}
                  onPress={() => pick(view.repo, view.sha, row)}
                  style={[styles.row, { backgroundColor: selected ? c.brandTint : c.surface, borderColor: selected ? c.brand : c.hairline, borderWidth: selected ? 2 : StyleSheet.hairlineWidth }]}
                >
                  <Card.Content style={{ gap: 6 }}>
                    <Text style={{ color: c.text, fontFamily: fontFamilies.interMedium, fontSize: 15 }}>{row.label}</Text>
                    <View style={styles.chips}>
                      {row.quant && chip(row.quant)}
                      {chip(formatBytes(row.totalBytes))}
                      {row.files.length > 1 && chip(`${row.files.length} parts`)}
                      {totalRam > 0 && chip(hintLabel, hintColor, true)}
                      {row.prism && chip('Needs PrismML llama.cpp', c.error, true)}
                    </View>
                    {checking === row.key && (
                      <View style={styles.checking}>
                        <ActivityIndicator size="small" />
                        <Text style={{ color: c.textSecondary, fontSize: 13 }}>Checking {row.label}…</Text>
                      </View>
                    )}
                  </Card.Content>
                </Card>
              );
            })}
          </View>
        )}
      </ScrollView>

      <Portal>
        <Dialog visible={!!confirm} onDismiss={() => !starting && setConfirm(null)}>
          <Dialog.Title>Download {confirm?.row.label}?</Dialog.Title>
          <Dialog.Content style={{ gap: 12 }}>
            <Text>{confirm ? formatBytes(confirm.row.totalBytes) : ''}. Android downloads it in the background, with a notification. You can leave the app.</Text>
            <View style={styles.switchRow}>
              <Text>Wi-Fi only</Text>
              <Switch value={wifiOnly} onValueChange={setWifiOnly} />
            </View>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirm(null)} disabled={starting}>Cancel</Button>
            <Button onPress={start} loading={starting} disabled={starting}>Download</Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog visible={!!compat} dismissable={false} dismissableBackButton={false}>
          <Dialog.Title>This model may not load</Dialog.Title>
          <Dialog.Content style={{ gap: 8 }}>
            <Text>
              {compat?.types.length
                ? `${compat.label} uses tensor formats the llama.cpp in this app can't load: ${compat.types.join(', ')}.`
                : `${compat?.label} looks like a PrismML ${parseQuantFromFilename(compat?.label ?? '')} file.`}
            </Text>
            {compat?.prism && (
              <Text>PQ2_0 and PTQ1_0 need PrismML's own llama.cpp fork. Download the Q2_0 version of the model instead; it has the same weights and runs on standard llama.cpp.</Text>
            )}
            <Text style={{ color: c.textSecondary }}>Downloading fetches the whole file, and loading it will most likely fail.</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => answerCompat(true)}>Download anyway</Button>
            <Button onPress={() => answerCompat(false)}>Cancel</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={snack.length > 60 ? 5000 : 2500}>{snack}</Snackbar>
    </>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: 8, padding: 16 },
  notice: { padding: 16, borderRadius: radii.card, gap: 8 },
  row: { borderRadius: radii.card },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderRadius: 8 },
  // Paper's MD3 chip label has lineHeight 24 + 6px margins; shrink both so small chips don't clip.
  chipText: { fontSize: 11, lineHeight: 16, marginVertical: 3 },
  checking: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
