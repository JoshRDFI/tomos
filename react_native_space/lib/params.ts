import { CATALOG_BY_KEY, RESERVED_KEYS, isLoadParam, type ParamDef } from './paramCatalog';

export type ParamValue = number | boolean | string | unknown[] | { [k: string]: unknown };
/** A sparse set of llama.rn parameters, keyed by llama.rn name. */
export type ParamSet = Record<string, ParamValue>;

/** Where an effective value came from, lowest priority first. */
export type ParamSource = 'app' | 'global' | 'file' | 'model' | 'persona' | 'chat';

export const SOURCE_LABELS: Record<ParamSource, string> = {
  app: 'App default',
  global: 'All chats',
  file: 'Model file',
  model: 'This model',
  persona: 'Persona',
  chat: 'This chat',
};

/** The app's own starting values (the bottom layer). */
/** Default context length, when the model was trained for at least this much. */
export const DEFAULT_N_CTX = 8192;

export const APP_DEFAULTS: ParamSet = {
  temperature: 0.7,
  top_p: 0.9,
  top_k: 40,
  min_p: 0.05,
  penalty_repeat: 1.1,
  // DRY catches a model copying whole sentences from earlier replies, which the
  // repeat penalty (last 64 tokens only) can't see.
  dry_multiplier: 0.8,
  // Presence, frequency and repeat penalty only see this many recent tokens;
  // llama.cpp's 64 is a few sentences, too short to see the previous reply.
  penalty_last_n: 512,
  n_predict: 1024,
  n_ctx: DEFAULT_N_CTX,
  // Used when the phone's fast-core count can't be read (see lib/device.ts).
  n_threads: 4,
};

/**
 * Defaults of the first app version. Its saved settings always held all of
 * these, so values equal to them weren't chosen by the user.
 */
export const LEGACY_DEFAULTS: ParamSet = {
  temperature: 0.7, top_p: 0.9, top_k: 40, min_p: 0.05, penalty_repeat: 1.1, n_predict: 1024, n_ctx: 4096, n_threads: 6,
};

/** Keys used by the app's first version, mapped to llama.rn names. */
const LEGACY_KEYS: Record<string, string> = {
  topP: 'top_p',
  topK: 'top_k',
  minP: 'min_p',
  repeatPenalty: 'penalty_repeat',
  maxTokens: 'n_predict',
  contextLength: 'n_ctx',
  threads: 'n_threads',
};

/** Parse a stored JSON param set, converting legacy keys. Bad input → {}. */
export function parseParamSet(raw: string | null | undefined): ParamSet {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    const out: ParamSet = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined) continue;
      out[LEGACY_KEYS[k] ?? k] = v as ParamValue;
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeParamSet(set: ParamSet): string | null {
  return Object.keys(set).length ? JSON.stringify(set) : null;
}

export interface LayeredParams {
  app?: ParamSet;
  global?: ParamSet;
  file?: ParamSet;
  model?: ParamSet;
  persona?: ParamSet;
  chat?: ParamSet;
}

export interface ResolvedParams {
  values: ParamSet;
  sources: Record<string, ParamSource>;
}

/** App defaults for a model: the default context, capped at what it was trained for, and the phone's thread count when known. */
export function appDefaultsFor(trainedContext: number | null | undefined, threads?: number): ParamSet {
  const d = threads ? { ...APP_DEFAULTS, n_threads: threads } : APP_DEFAULTS;
  return trainedContext && trainedContext < DEFAULT_N_CTX ? { ...d, n_ctx: trainedContext } : d;
}

const LAYER_ORDER: ParamSource[] = ['app', 'global', 'file', 'model', 'persona', 'chat'];

/** Merge layers; later layers win. */
export function resolveParams(layers: LayeredParams): ResolvedParams {
  const values: ParamSet = {};
  const sources: Record<string, ParamSource> = {};
  for (const layer of LAYER_ORDER) {
    const set = layer === 'app' ? (layers.app ?? APP_DEFAULTS) : layers[layer];
    if (!set) continue;
    for (const [k, v] of Object.entries(set)) {
      values[k] = v;
      sources[k] = layer;
    }
  }
  return { values, sources };
}

/** Split a resolved set into load-time and per-completion parameters. */
/** Whether thinking is on for a chat: its own setting, else what it inherits, else on. */
export function thinkingEnabled(chat: ParamSet, inherited: ResolvedParams): boolean {
  const v = chat.enable_thinking ?? inherited.values.enable_thinking;
  return v === undefined ? true : !!v;
}

export function splitParams(set: ParamSet): { load: ParamSet; completion: ParamSet } {
  const load: ParamSet = {};
  const completion: ParamSet = {};
  for (const [k, v] of Object.entries(set)) {
    if (RESERVED_KEYS.has(k)) continue;
    if (k === 'samplers' && v === '') continue;
    (isLoadParam(k) ? load : completion)[k] = v;
  }
  return { load, completion };
}

/** Stable identity for a load-param set, to decide whether to reload. */
export function loadSignature(load: ParamSet): string {
  return JSON.stringify(Object.keys(load).sort().map((k) => [k, load[k]]));
}

// ── Value parsing ──

/**
 * Turn text typed by the user into a value for `key`. Catalog keys are
 * coerced to their kind; unknown keys are parsed as JSON when possible
 * (numbers, true/false, arrays, objects) and kept as a string otherwise.
 * Returns undefined if the text is not valid for a catalog key.
 */
export function parseValue(key: string, text: string): ParamValue | undefined {
  const def: ParamDef | undefined = CATALOG_BY_KEY[key];
  const t = text.trim();
  if (!def) {
    if (t === '') return undefined;
    try { return JSON.parse(t) as ParamValue; } catch { return t; }
  }
  switch (def.kind) {
    case 'number': {
      const n = Number(t);
      return t !== '' && Number.isFinite(n) ? n : undefined;
    }
    case 'int': {
      const n = Number(t);
      return t !== '' && Number.isInteger(n) ? n : undefined;
    }
    case 'bool': {
      const l = t.toLowerCase();
      if (['true', 'on', '1', 'yes'].includes(l)) return true;
      if (['false', 'off', '0', 'no'].includes(l)) return false;
      return undefined;
    }
    case 'select': {
      const opt = def.options?.find((o) => String(o.value).toLowerCase() === t.toLowerCase());
      return opt ? opt.value : undefined;
    }
    case 'json': {
      try { return JSON.parse(t) as ParamValue; } catch { return undefined; }
    }
    default:
      return text;
  }
}

export function formatValue(v: ParamValue | undefined): string {
  if (v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(4)));
  return JSON.stringify(v);
}

// ── Model file (GGUF) recommendations ──

/** GGUF `general.sampling.*` keys (written by model authors) → llama.rn names. */
const GGUF_SAMPLING_KEYS: Record<string, string> = {
  'general.sampling.temp': 'temperature',
  'general.sampling.top_k': 'top_k',
  'general.sampling.top_p': 'top_p',
  'general.sampling.min_p': 'min_p',
  'general.sampling.xtc_probability': 'xtc_probability',
  'general.sampling.xtc_threshold': 'xtc_threshold',
  'general.sampling.penalty_last_n': 'penalty_last_n',
  'general.sampling.penalty_repeat': 'penalty_repeat',
  'general.sampling.penalty_freq': 'penalty_freq',
  'general.sampling.penalty_present': 'penalty_present',
  'general.sampling.mirostat': 'mirostat',
  'general.sampling.mirostat_tau': 'mirostat_tau',
  'general.sampling.mirostat_eta': 'mirostat_eta',
  'general.sampling.dry_multiplier': 'dry_multiplier',
  'general.sampling.dry_base': 'dry_base',
  'general.sampling.dry_allowed_length': 'dry_allowed_length',
  'general.sampling.dry_penalty_last_n': 'dry_penalty_last_n',
};

/**
 * Read recommended settings embedded in a GGUF's metadata. llama.rn returns
 * every metadata value as a string.
 */
export function extractFileParams(info: Record<string, unknown> | null | undefined): ParamSet {
  const out: ParamSet = {};
  if (!info) return out;
  for (const [ggufKey, key] of Object.entries(GGUF_SAMPLING_KEYS)) {
    const raw = info[ggufKey];
    if (raw === undefined || raw === null || raw === '') continue;
    const v = parseValue(key, String(raw));
    if (v !== undefined) out[key] = v;
  }
  const seq = info['general.sampling.sequence'];
  if (typeof seq === 'string' && seq.trim()) {
    out.samplers = seq.trim().replace(/^\[|\]$/g, '').replace(/["\s]/g, '').replace(/,/g, ';');
  }
  return out;
}

// ── llama.cpp command-line flags ──

/** llama-cli / llama-server flags → llama.rn names. */
const CLI_FLAGS: Record<string, string> = {
  '--temp': 'temperature', '--temperature': 'temperature',
  '--top-k': 'top_k', '--top-p': 'top_p', '--min-p': 'min_p',
  '--typical': 'typical_p', '--typical-p': 'typical_p',
  '--top-nsigma': 'top_n_sigma', '--top-n-sigma': 'top_n_sigma',
  '--xtc-probability': 'xtc_probability', '--xtc-threshold': 'xtc_threshold',
  '--mirostat': 'mirostat', '--mirostat-ent': 'mirostat_tau', '--mirostat-lr': 'mirostat_eta',
  '--seed': 'seed', '-s': 'seed', '--samplers': 'samplers',
  '--repeat-penalty': 'penalty_repeat', '--repeat-last-n': 'penalty_last_n',
  '--presence-penalty': 'penalty_present', '--frequency-penalty': 'penalty_freq',
  '--dry-multiplier': 'dry_multiplier', '--dry-base': 'dry_base',
  '--dry-allowed-length': 'dry_allowed_length', '--dry-penalty-last-n': 'dry_penalty_last_n',
  '--n-predict': 'n_predict', '-n': 'n_predict', '--predict': 'n_predict',
  '--ctx-size': 'n_ctx', '-c': 'n_ctx',
  '--threads': 'n_threads', '-t': 'n_threads',
  '--batch-size': 'n_batch', '-b': 'n_batch', '--ubatch-size': 'n_ubatch', '-ub': 'n_ubatch',
  '--n-gpu-layers': 'n_gpu_layers', '--gpu-layers': 'n_gpu_layers', '-ngl': 'n_gpu_layers',
  '--flash-attn': 'flash_attn_type', '-fa': 'flash_attn_type',
  '--cache-type-k': 'cache_type_k', '-ctk': 'cache_type_k',
  '--cache-type-v': 'cache_type_v', '-ctv': 'cache_type_v',
  '--keep': 'n_keep', '--grammar': 'grammar', '--json-schema': 'json_schema',
  '--rope-freq-base': 'rope_freq_base', '--rope-freq-scale': 'rope_freq_scale',
  '--reasoning-format': 'reasoning_format', '--reasoning-budget': 'thinking_budget_tokens',
};

/** Flags that take no value. */
const CLI_SWITCHES: Record<string, [string, ParamValue]> = {
  '--mlock': ['use_mlock', true],
  '--no-mmap': ['use_mmap', false],
  '--ignore-eos': ['ignore_eos', true],
  '--no-context-shift': ['ctx_shift', false],
  '--context-shift': ['ctx_shift', true],
};

/** Flags that only matter on desktop and are skipped silently. */
const CLI_IGNORED = new Set([
  '-m', '--model', '-p', '--prompt', '--port', '--host', '-hf', '--hf-repo', '-f', '--file',
  '--jinja', '-cnv', '--conversation', '-i', '--interactive', '-no-cnv', '--log-disable',
  '--verbose', '-v', '--color', '-sys', '--system-prompt', '--chat-template-file',
]);
const CLI_IGNORED_WITH_VALUE = new Set([
  '-m', '--model', '-p', '--prompt', '--port', '--host', '-hf', '--hf-repo', '-f', '--file',
  '-sys', '--system-prompt', '--chat-template-file',
]);

function tokenizeArgs(text: string): string[] {
  const out: string[] = [];
  const re = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  const cleaned = text.replace(/\\\r?\n/g, ' ');
  while ((m = re.exec(cleaned)) !== null) {
    out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : (m[2] ?? m[3] ?? ''));
  }
  return out;
}

export interface FlagParseResult {
  params: ParamSet;
  /** Flags that were recognised but had an invalid value. */
  invalid: string[];
  /** Flags the app does not know. */
  unknown: string[];
}

/**
 * Parse llama.cpp command-line flags, as published on model cards, e.g.
 * `--temp 1.0 --top-p 0.95 --top-k 20 --presence-penalty 1.0 -c 32768`.
 * Also accepts `--flag=value` and handles `--chat-template-kwargs` for the
 * enable_thinking switch.
 */
export function parseCliFlags(text: string): FlagParseResult {
  const args = tokenizeArgs(text);
  const params: ParamSet = {};
  const invalid: string[] = [];
  const unknown: string[] = [];

  for (let i = 0; i < args.length; i++) {
    let flag = args[i]!;
    if (!flag.startsWith('-')) continue; // program name, stray values
    let inlineValue: string | undefined;
    const eq = flag.indexOf('=');
    if (flag.startsWith('--') && eq > 0) {
      inlineValue = flag.slice(eq + 1);
      flag = flag.slice(0, eq);
    }
    const takeValue = (): string | undefined => {
      if (inlineValue !== undefined) return inlineValue;
      const next = args[i + 1];
      // A following flag is not a value (but a negative number like -1 is).
      if (next === undefined || (next.startsWith('-') && !/^-\d/.test(next))) return undefined;
      i++;
      return next;
    };

    if (CLI_SWITCHES[flag]) {
      const [k, v] = CLI_SWITCHES[flag]!;
      params[k] = v;
      continue;
    }
    if (flag === '--chat-template-kwargs') {
      const raw = takeValue();
      try {
        const kw = JSON.parse(raw ?? '');
        if (typeof kw?.enable_thinking === 'boolean') params.enable_thinking = kw.enable_thinking;
        else invalid.push(flag);
      } catch { invalid.push(flag); }
      continue;
    }
    if (CLI_IGNORED.has(flag)) {
      if (CLI_IGNORED_WITH_VALUE.has(flag)) takeValue();
      continue;
    }
    const key = CLI_FLAGS[flag];
    if (!key) {
      unknown.push(flag);
      // Skip a following value so it isn't mistaken for a flag.
      const next = args[i + 1];
      if (inlineValue === undefined && next !== undefined && !next.startsWith('-')) i++;
      continue;
    }
    const raw = takeValue();
    if (raw === undefined) { invalid.push(flag); continue; }
    let value: ParamValue | undefined;
    if (key === 'samplers') value = raw;
    else if (key === 'n_ctx' && raw === '0') value = undefined; // "use training context": too big for a phone
    else value = parseValue(key, raw);
    if (value === undefined) invalid.push(flag);
    else params[key] = value;
  }
  return { params, invalid, unknown };
}
