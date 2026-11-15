import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable, TextInput } from 'react-native';
import { Text, Button, IconButton, Switch, SegmentedButtons, Dialog, Portal, useTheme } from 'react-native-paper';
import Slider from '@react-native-community/slider';
import type { AppTheme } from '@/constants/theme';
import { fontFamilies, radii, spacing } from '@/constants/theme';
import {
  CATALOG_BY_KEY, PARAM_CATALOG, PARAM_GROUPS, RESERVED_KEYS, isLoadParam, type ParamDef,
} from '@/lib/paramCatalog';
import {
  SOURCE_LABELS, formatValue, parseCliFlags, parseValue,
  type ParamSet, type ParamValue, type ResolvedParams,
} from '@/lib/params';

interface Props {
  /** Values set at this level. */
  overrides: ParamSet;
  /** Effective values from the levels below this one. */
  inherited: ResolvedParams;
  onChange: (next: ParamSet) => void;
}

const CATALOG_ORDER = new Map(PARAM_CATALOG.map((d, i) => [d.key, i]));
const sortKeys = (keys: string[]) =>
  [...keys].sort((a, b) => (CATALOG_ORDER.get(a) ?? 1e6) - (CATALOG_ORDER.get(b) ?? 1e6) || a.localeCompare(b));

const LONG_TEXT_KEYS = new Set(['chat_template', 'grammar', 'json_schema']);
const KEY_PATTERN = /^[a-z_][a-z0-9_]*$/i;

/**
 * Editor for one level of llama.cpp settings. Shows what is set at this level
 * (editable), what is inherited from lower levels (tap to override), and lets
 * the user add any catalog setting, a custom key, or paste command-line flags.
 */
export default function ParamEditor({ overrides, inherited, onChange }: Props) {
  const theme = useTheme<AppTheme>();
  const c = theme.appColors;
  const [addOpen, setAddOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [showInherited, setShowInherited] = useState(false);

  const setKeys = sortKeys(Object.keys(overrides));
  const inheritedKeys = sortKeys(Object.keys(inherited.values).filter((k) => !(k in overrides)));

  const setValue = (key: string, value: ParamValue) => onChange({ ...overrides, [key]: value });
  const remove = (key: string) => {
    const next = { ...overrides };
    delete next[key];
    onChange(next);
  };
  const startValue = (key: string): ParamValue => {
    if (key in inherited.values) return inherited.values[key]!;
    const def = CATALOG_BY_KEY[key];
    if (def?.llamaDefault !== undefined) return def.llamaDefault as ParamValue;
    if (def?.kind === 'bool') return false;
    if (def?.kind === 'json') return [];
    if (def?.kind === 'string') return '';
    return def?.min ?? 0;
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.toolbar}>
        <Button mode="contained-tonal" icon="plus" compact onPress={() => setAddOpen(true)}>Add setting</Button>
        <Button mode="outlined" icon="console" compact onPress={() => setPasteOpen(true)}>Paste flags</Button>
      </View>

      {setKeys.length === 0 && (
        <Text style={[styles.hint, { color: c.textSecondary }]}>Nothing set here yet. Values below are inherited.</Text>
      )}
      {setKeys.map((key) => (
        <ParamRow
          key={key}
          paramKey={key}
          value={overrides[key]!}
          fallback={key in inherited.values ? `${formatValue(inherited.values[key])} from ${SOURCE_LABELS[inherited.sources[key]!]}` : 'llama.cpp default'}
          onChange={(v) => setValue(key, v)}
          onRemove={() => remove(key)}
        />
      ))}

      {inheritedKeys.length > 0 && (
        <Pressable onPress={() => setShowInherited((v) => !v)} style={styles.inheritedHeader} accessibilityRole="button">
          <Text style={{ color: c.text, fontFamily: fontFamilies.interMedium, fontSize: 14, flex: 1 }}>
            Inherited ({inheritedKeys.length})
          </Text>
          <IconButton icon={showInherited ? 'chevron-up' : 'chevron-down'} size={20} iconColor={c.textSecondary} style={{ margin: 0 }} />
        </Pressable>
      )}
      {showInherited && inheritedKeys.map((key) => (
        <Pressable
          key={key}
          onPress={() => setValue(key, inherited.values[key]!)}
          style={[styles.inheritedRow, { borderColor: c.hairline }]}
          accessibilityHint="Override this setting here"
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontFamily: fontFamilies.inter, fontSize: 14 }}>{CATALOG_BY_KEY[key]?.label ?? key}</Text>
            <Text style={{ color: c.textSecondary, fontFamily: fontFamilies.inter, fontSize: 12 }}>{SOURCE_LABELS[inherited.sources[key]!]}</Text>
          </View>
          <Text style={{ color: c.text, fontFamily: fontFamilies.mono, fontSize: 13, maxWidth: '50%' }} numberOfLines={1}>
            {formatValue(inherited.values[key])}
          </Text>
          <IconButton icon="pencil-outline" size={16} iconColor={c.textSecondary} style={{ margin: 0 }} />
        </Pressable>
      ))}

      <AddSettingDialog
        visible={addOpen}
        exclude={new Set(setKeys)}
        inherited={inherited}
        onDismiss={() => setAddOpen(false)}
        onAdd={(key, value) => {
          setValue(key, value ?? startValue(key));
          setAddOpen(false);
        }}
      />
      <PasteFlagsDialog
        visible={pasteOpen}
        onDismiss={() => setPasteOpen(false)}
        onApply={(params) => {
          onChange({ ...overrides, ...params });
          setPasteOpen(false);
        }}
      />
    </View>
  );
}

// ── One editable setting ──

function ParamRow({ paramKey, value, fallback, onChange, onRemove }: {
  paramKey: string;
  value: ParamValue;
  fallback: string;
  onChange: (v: ParamValue) => void;
  onRemove: () => void;
}) {
  const theme = useTheme<AppTheme>();
  const c = theme.appColors;
  const def = CATALOG_BY_KEY[paramKey];
  const [text, setText] = useState(formatValue(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setText(formatValue(value)); setInvalid(false); }, [value]);

  const commit = (t: string) => {
    const v = parseValue(paramKey, t);
    if (v === undefined) { setInvalid(true); return; }
    setInvalid(false);
    if (formatValue(v) !== formatValue(value)) onChange(v);
  };

  const kind = def?.kind ?? 'json';
  const showSlider = (kind === 'number' || kind === 'int') && def?.min !== undefined && def?.max !== undefined;
  const numeric = typeof value === 'number' ? value : Number(value);

  return (
    <View style={[styles.row, { backgroundColor: c.surface, borderColor: c.hairline }]}>
      <View style={styles.rowHeader}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.text, fontFamily: fontFamilies.interMedium, fontSize: 14 }}>{def?.label ?? paramKey}</Text>
          <Text style={{ color: c.textSecondary, fontFamily: fontFamilies.mono, fontSize: 11 }}>
            {paramKey}{isLoadParam(paramKey) ? ' · reloads model' : ''}
          </Text>
        </View>
        {kind === 'bool' && <Switch value={value === true} onValueChange={onChange} color={c.brand} />}
        <IconButton icon="close" size={18} iconColor={c.textSecondary} onPress={onRemove} accessibilityLabel={`Remove ${def?.label ?? paramKey}`} style={{ margin: 0 }} />
      </View>

      {def?.help ? <Text style={[styles.help, { color: c.textSecondary }]}>{def.help}</Text> : null}

      {kind === 'select' && def?.options && (
        <SegmentedButtons
          density="small"
          value={String(value)}
          onValueChange={(v) => onChange(def.options!.find((o) => String(o.value) === v)!.value)}
          buttons={def.options.map((o) => ({ value: String(o.value), label: o.label }))}
        />
      )}

      {(kind === 'number' || kind === 'int') && (
        <View style={styles.numberRow}>
          {showSlider && (
            <Slider
              style={{ flex: 1, height: 36 }}
              value={Number.isFinite(numeric) ? Math.min(Math.max(numeric, def!.min!), def!.max!) : def!.min!}
              minimumValue={def!.min!}
              maximumValue={def!.max!}
              step={def!.step}
              onValueChange={(v) => setText(formatValue(kind === 'int' ? Math.round(v) : v))}
              onSlidingComplete={(v) => commit(String(kind === 'int' ? Math.round(v) : Number(v.toFixed(4))))}
              minimumTrackTintColor={c.brand}
              maximumTrackTintColor={c.hairline}
              thumbTintColor={c.brand}
            />
          )}
          <TextInput
            value={text}
            onChangeText={setText}
            onEndEditing={(e) => commit(e.nativeEvent.text)}
            onSubmitEditing={(e) => commit(e.nativeEvent.text)}
            keyboardType="numbers-and-punctuation"
            style={[styles.numberInput, { color: c.text, borderColor: invalid ? c.error : c.hairline, backgroundColor: c.surfaceRaised, fontFamily: fontFamilies.mono }]}
            accessibilityLabel={`${def?.label ?? paramKey} value`}
          />
        </View>
      )}

      {(kind === 'string' || kind === 'json') && (
        <TextInput
          value={text}
          onChangeText={setText}
          onEndEditing={(e) => commit(e.nativeEvent.text)}
          multiline={LONG_TEXT_KEYS.has(paramKey) || text.length > 40}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={kind === 'json' ? 'JSON value' : 'Text'}
          placeholderTextColor={c.textSecondary}
          style={[styles.textInput, { color: c.text, borderColor: invalid ? c.error : c.hairline, backgroundColor: c.surfaceRaised, fontFamily: fontFamilies.mono }]}
        />
      )}

      {invalid && <Text style={{ color: c.error, fontSize: 12, fontFamily: fontFamilies.inter }}>Not a valid value{def ? ` for ${def.label}` : ' (use JSON, e.g. 3, true, "text", [1,2])'}.</Text>}
      <Text style={{ color: c.textSecondary, fontSize: 11, fontFamily: fontFamilies.inter }}>Without this: {fallback}</Text>
    </View>
  );
}

// ── Add setting ──

function AddSettingDialog({ visible, exclude, inherited, onDismiss, onAdd }: {
  visible: boolean;
  exclude: Set<string>;
  inherited: ResolvedParams;
  onDismiss: () => void;
  onAdd: (key: string, value?: ParamValue) => void;
}) {
  const theme = useTheme<AppTheme>();
  const c = theme.appColors;
  const [query, setQuery] = useState('');
  const [custom, setCustom] = useState(false);
  const [customKey, setCustomKey] = useState('');
  const [customValue, setCustomValue] = useState('');

  useEffect(() => {
    if (!visible) { setQuery(''); setCustom(false); setCustomKey(''); setCustomValue(''); }
  }, [visible]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (d: ParamDef) =>
      !exclude.has(d.key) && (!q || d.label.toLowerCase().includes(q) || d.key.includes(q) || d.help.toLowerCase().includes(q));
    return PARAM_GROUPS.map((g) => ({ group: g, items: PARAM_CATALOG.filter((d) => d.group === g && match(d)) }))
      .filter((g) => g.items.length > 0);
  }, [query, exclude]);

  const keyError = !customKey.trim() ? null
    : !KEY_PATTERN.test(customKey.trim()) ? 'Use letters, digits and underscores (llama.rn parameter name).'
    : RESERVED_KEYS.has(customKey.trim()) ? 'The app sets this itself.'
    : exclude.has(customKey.trim()) ? 'Already set here.'
    : null;
  const parsedCustom = customKey.trim() && !keyError ? parseValue(customKey.trim(), customValue) : undefined;

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss} style={{ maxHeight: '85%' }}>
        <Dialog.Title>{custom ? 'Custom setting' : 'Add setting'}</Dialog.Title>
        {!custom ? (
          <>
            <View style={{ paddingHorizontal: 24, paddingBottom: 8 }}>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search settings"
                placeholderTextColor={c.textSecondary}
                autoCapitalize="none"
                style={[styles.textInput, { color: c.text, borderColor: c.hairline, backgroundColor: c.surfaceRaised, fontFamily: fontFamilies.inter }]}
              />
            </View>
            <Dialog.ScrollArea style={{ paddingHorizontal: 0 }}>
              <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingVertical: 8 }} keyboardShouldPersistTaps="handled">
                {groups.map(({ group, items }) => (
                  <View key={group} style={{ marginBottom: 12 }}>
                    <Text style={{ color: c.brand, fontFamily: fontFamilies.interSemiBold, fontSize: 12, marginBottom: 4 }}>{group.toUpperCase()}</Text>
                    {items.map((d) => (
                      <Pressable key={d.key} onPress={() => onAdd(d.key)} style={[styles.addItem, { borderColor: c.hairline }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                          <Text style={{ color: c.text, fontFamily: fontFamilies.interMedium, fontSize: 14, flex: 1 }}>{d.label}</Text>
                          {d.key in inherited.values && (
                            <Text style={{ color: c.textSecondary, fontFamily: fontFamilies.mono, fontSize: 12 }} numberOfLines={1}>{formatValue(inherited.values[d.key])}</Text>
                          )}
                        </View>
                        <Text style={{ color: c.textSecondary, fontFamily: fontFamilies.inter, fontSize: 12 }} numberOfLines={2}>{d.help}</Text>
                      </Pressable>
                    ))}
                  </View>
                ))}
                {groups.length === 0 && (
                  <Text style={{ color: c.textSecondary, fontFamily: fontFamilies.inter, fontSize: 14 }}>No matching settings. Add it as a custom setting instead.</Text>
                )}
              </ScrollView>
            </Dialog.ScrollArea>
            <Dialog.Actions>
              <Button onPress={() => { setCustom(true); setCustomKey(query.trim().replace(/\s+/g, '_')); }}>Custom…</Button>
              <Button onPress={onDismiss}>Cancel</Button>
            </Dialog.Actions>
          </>
        ) : (
          <>
            <Dialog.Content style={{ gap: 8 }}>
              <Text style={[styles.help, { color: c.textSecondary }]}>
                Any llama.rn parameter, by its llama.rn name (e.g. n_cpu_moe, top_n_sigma). It is passed through unchanged.
              </Text>
              <TextInput
                value={customKey}
                onChangeText={setCustomKey}
                placeholder="parameter_name"
                placeholderTextColor={c.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.textInput, { color: c.text, borderColor: keyError ? c.error : c.hairline, backgroundColor: c.surfaceRaised, fontFamily: fontFamilies.mono }]}
              />
              {keyError && <Text style={{ color: c.error, fontSize: 12 }}>{keyError}</Text>}
              <TextInput
                value={customValue}
                onChangeText={setCustomValue}
                placeholder='Value: 3, 0.5, true, "text", [1,2]'
                placeholderTextColor={c.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.textInput, { color: c.text, borderColor: c.hairline, backgroundColor: c.surfaceRaised, fontFamily: fontFamilies.mono }]}
              />
              {customKey.trim() && !keyError ? (
                <Text style={{ color: c.textSecondary, fontSize: 12, fontFamily: fontFamilies.inter }}>
                  {isLoadParam(customKey.trim()) ? 'Applied when the model loads (reloads the model).' : 'Sent with each reply request.'}
                  {customValue.trim() && parsedCustom === undefined ? ' Value is not valid for this setting.' : ''}
                </Text>
              ) : null}
            </Dialog.Content>
            <Dialog.Actions>
              <Button onPress={() => setCustom(false)}>Back</Button>
              <Button
                disabled={!customKey.trim() || !!keyError || (!!customValue.trim() && parsedCustom === undefined)}
                onPress={() => onAdd(customKey.trim(), parsedCustom)}
              >Add</Button>
            </Dialog.Actions>
          </>
        )}
      </Dialog>
    </Portal>
  );
}

// ── Paste command-line flags ──

function PasteFlagsDialog({ visible, onDismiss, onApply }: {
  visible: boolean;
  onDismiss: () => void;
  onApply: (params: ParamSet) => void;
}) {
  const theme = useTheme<AppTheme>();
  const c = theme.appColors;
  const [text, setText] = useState('');
  useEffect(() => { if (!visible) setText(''); }, [visible]);
  const parsed = useMemo(() => parseCliFlags(text), [text]);
  const keys = sortKeys(Object.keys(parsed.params));

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss} style={{ maxHeight: '85%' }}>
        <Dialog.Title>Paste llama.cpp flags</Dialog.Title>
        <Dialog.ScrollArea style={{ paddingHorizontal: 0 }}>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingVertical: 8, gap: 8 }} keyboardShouldPersistTaps="handled">
            <Text style={[styles.help, { color: c.textSecondary }]}>
              Paste a llama-cli or llama-server command from a model card. Settings found are added here; the model path and prompt are ignored.
            </Text>
            <TextInput
              value={text}
              onChangeText={setText}
              multiline
              placeholder="--temp 1.0 --top-p 0.95 --top-k 20 --presence-penalty 1.0"
              placeholderTextColor={c.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.textInput, { minHeight: 96, textAlignVertical: 'top', color: c.text, borderColor: c.hairline, backgroundColor: c.surfaceRaised, fontFamily: fontFamilies.mono }]}
            />
            {keys.map((k) => (
              <View key={k} style={{ flexDirection: 'row', gap: 8 }}>
                <Text style={{ color: c.text, fontFamily: fontFamilies.inter, fontSize: 13, flex: 1 }}>{CATALOG_BY_KEY[k]?.label ?? k}</Text>
                <Text style={{ color: c.brand, fontFamily: fontFamilies.mono, fontSize: 13 }}>{formatValue(parsed.params[k])}</Text>
              </View>
            ))}
            {parsed.invalid.length > 0 && (
              <Text style={{ color: c.error, fontSize: 12, fontFamily: fontFamilies.inter }}>Missing or invalid value: {parsed.invalid.join(', ')}</Text>
            )}
            {parsed.unknown.length > 0 && (
              <Text style={{ color: c.accent, fontSize: 12, fontFamily: fontFamilies.inter }}>
                Not recognized (skipped): {parsed.unknown.join(', ')}. Add these with Add setting → Custom if llama.rn supports them.
              </Text>
            )}
          </ScrollView>
        </Dialog.ScrollArea>
        <Dialog.Actions>
          <Button onPress={onDismiss}>Cancel</Button>
          <Button disabled={keys.length === 0} onPress={() => onApply(parsed.params)}>
            {keys.length ? `Add ${keys.length} setting${keys.length === 1 ? '' : 's'}` : 'Add'}
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  hint: { fontSize: 13, fontFamily: fontFamilies.inter },
  row: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: 12, gap: 6 },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  help: { fontSize: 12, lineHeight: 16, fontFamily: fontFamilies.inter },
  numberRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  numberInput: { width: 96, height: 40, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 10, fontSize: 14, textAlign: 'right' },
  textInput: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
  inheritedHeader: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  inheritedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  addItem: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
});
