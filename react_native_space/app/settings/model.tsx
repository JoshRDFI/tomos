import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, Platform } from 'react-native';
import { Text, Button, useTheme, ActivityIndicator } from 'react-native-paper';
import { Stack, useLocalSearchParams } from 'expo-router';
import type { AppTheme } from '@/constants/theme';
import { spacing, fontFamilies, radii } from '@/constants/theme';
import type { ModelRecord } from '@/types';
import * as db from '@/lib/db';
import { ensureFileParams } from '@/lib/modelMeta';
import { CATALOG_BY_KEY } from '@/lib/paramCatalog';
import ParamEditor from '@/components/params/ParamEditor';
import { defaultThreads } from '@/lib/device';
import {
  formatValue, parseParamSet, resolveParams, appDefaultsFor, serializeParamSet,
  type ParamSet, type ResolvedParams,
} from '@/lib/params';

export default function ModelSettingsScreen() {
  const theme = useTheme<AppTheme>();
  const c = theme.appColors;
  const { modelId = '' } = useLocalSearchParams<{ modelId: string }>();
  const isWeb = Platform.OS === 'web';

  const [model, setModel] = useState<ModelRecord | null>(null);
  const [overrides, setOverrides] = useState<ParamSet>({});
  const [fileParams, setFileParams] = useState<ParamSet>({});
  const [inherited, setInherited] = useState<ResolvedParams>(() => resolveParams({}));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isWeb || !modelId) { setLoading(false); return; }
    (async () => {
      let m = await db.getModel(modelId);
      if (m) m = await ensureFileParams(m);
      setModel(m);
      const file = parseParamSet(m?.fileParams);
      setFileParams(file);
      setOverrides(parseParamSet(m?.paramsOverride));
      setInherited(resolveParams({ app: appDefaultsFor(m?.trainedContext, defaultThreads()), global: await db.getGlobalParams(), file }));
      setLoading(false);
    })().catch(() => setLoading(false));
  }, [isWeb, modelId]);

  // Debounced save, flushed when leaving.
  const pending = useRef<ParamSet | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (pending.current && modelId) {
      db.updateModel(modelId, { paramsOverride: serializeParamSet(pending.current) }).catch(() => {});
      pending.current = null;
    }
  }, [modelId]);
  useEffect(() => flush, [flush]);
  const update = (next: ParamSet) => {
    setOverrides(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 300);
  };

  const fileKeys = Object.keys(fileParams);

  return (
    <>
      <Stack.Screen options={{ title: model?.displayName ?? 'Model settings', headerStyle: { backgroundColor: c.surface }, headerTintColor: c.text }} />
      <ScrollView
        style={{ flex: 1, backgroundColor: c.background }}
        contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        {loading ? <ActivityIndicator /> : !model ? (
          <Text style={{ color: c.textSecondary, fontFamily: fontFamilies.inter }}>Model not found.</Text>
        ) : (
          <>
            <View style={[styles.card, { backgroundColor: c.brandTint }]}>
              <Text style={{ color: c.brand, fontFamily: fontFamilies.interSemiBold, fontSize: 14 }}>Recommended by the model file</Text>
              {fileKeys.length === 0 ? (
                <Text style={{ color: c.text, fontFamily: fontFamilies.inter, fontSize: 13 }}>
                  This file doesn't include recommended settings. If the model card lists some, use Paste flags below.
                </Text>
              ) : fileKeys.map((k) => (
                <View key={k} style={{ flexDirection: 'row' }}>
                  <Text style={{ color: c.text, fontFamily: fontFamilies.inter, fontSize: 13, flex: 1 }}>{CATALOG_BY_KEY[k]?.label ?? k}</Text>
                  <Text style={{ color: c.text, fontFamily: fontFamilies.mono, fontSize: 13 }}>{formatValue(fileParams[k])}</Text>
                </View>
              ))}
            </View>

            <Text style={[styles.section, { color: c.text }]}>Settings for this model</Text>
            <Text style={{ color: c.textSecondary, fontFamily: fontFamilies.inter, fontSize: 13, marginTop: -8 }}>
              Used in every chat with this model, over the file's recommendations and the settings for all chats. A chat can still override them.
            </Text>
            <ParamEditor overrides={overrides} inherited={inherited} onChange={update} />
            {Object.keys(overrides).length > 0 && (
              <Button mode="text" textColor={c.error} onPress={() => update({})} style={{ alignSelf: 'flex-start' }}>
                Clear this model's settings
              </Button>
            )}
          </>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 16, lineHeight: 22, fontFamily: fontFamilies.interSemiBold },
  card: { padding: 14, borderRadius: radii.card, gap: 4 },
});
