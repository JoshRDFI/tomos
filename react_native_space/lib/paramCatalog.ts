/**
 * Catalog of llama.cpp settings the app knows how to edit, keyed by the
 * llama.rn parameter name. Anything not listed here can still be added as a
 * custom setting and is passed through to llama.rn unchanged.
 *
 * `scope: 'load'` settings are applied when the model is loaded (changing one
 * reloads the model); everything else is sent with each completion request.
 */

export type ParamKind = 'number' | 'int' | 'bool' | 'select' | 'string' | 'json';

export interface ParamDef {
  key: string;
  label: string;
  help: string;
  kind: ParamKind;
  group: ParamGroup;
  scope: 'load' | 'completion';
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string | number; label: string }[];
  /** llama.cpp's own default, shown when nothing overrides it. */
  llamaDefault?: unknown;
}

export const PARAM_GROUPS = [
  'Sampling',
  'Repetition',
  'Thinking',
  'Output',
  'Model loading',
  'Advanced',
] as const;
export type ParamGroup = (typeof PARAM_GROUPS)[number];

export const PARAM_CATALOG: ParamDef[] = [
  // ── Sampling ──
  { key: 'temperature', label: 'Temperature', group: 'Sampling', scope: 'completion', kind: 'number', min: 0, max: 2, step: 0.05, llamaDefault: 0.8,
    help: 'Randomness. Lower is more focused and deterministic; higher is more varied.' },
  { key: 'top_k', label: 'Top K', group: 'Sampling', scope: 'completion', kind: 'int', min: 0, max: 200, step: 1, llamaDefault: 40,
    help: 'Only consider the K most likely next tokens. 0 disables.' },
  { key: 'top_p', label: 'Top P', group: 'Sampling', scope: 'completion', kind: 'number', min: 0, max: 1, step: 0.01, llamaDefault: 0.95,
    help: 'Only consider tokens within this cumulative probability. 1.0 disables.' },
  { key: 'min_p', label: 'Min P', group: 'Sampling', scope: 'completion', kind: 'number', min: 0, max: 1, step: 0.01, llamaDefault: 0.05,
    help: 'Drop tokens less likely than this fraction of the most likely token. 0 disables.' },
  { key: 'typical_p', label: 'Typical P', group: 'Sampling', scope: 'completion', kind: 'number', min: 0, max: 1, step: 0.01, llamaDefault: 1,
    help: 'Locally typical sampling. 1.0 disables.' },
  { key: 'top_n_sigma', label: 'Top-nσ', group: 'Sampling', scope: 'completion', kind: 'number', min: -1, max: 5, step: 0.1, llamaDefault: -1,
    help: 'Keep tokens within n standard deviations of the top logit. -1 disables.' },
  { key: 'xtc_probability', label: 'XTC probability', group: 'Sampling', scope: 'completion', kind: 'number', min: 0, max: 1, step: 0.01, llamaDefault: 0,
    help: 'Chance of removing the most likely tokens (Exclude Top Choices) for more creative text. 0 disables.' },
  { key: 'xtc_threshold', label: 'XTC threshold', group: 'Sampling', scope: 'completion', kind: 'number', min: 0, max: 1, step: 0.01, llamaDefault: 0.1,
    help: 'Minimum probability for a token to be removed by XTC. Above 0.5 disables XTC.' },
  { key: 'mirostat', label: 'Mirostat', group: 'Sampling', scope: 'completion', kind: 'select', llamaDefault: 0,
    options: [{ value: 0, label: 'Off' }, { value: 1, label: 'v1' }, { value: 2, label: 'v2' }],
    help: 'Adaptive sampling that targets a perplexity level. Replaces top-k/top-p when on.' },
  { key: 'mirostat_tau', label: 'Mirostat tau', group: 'Sampling', scope: 'completion', kind: 'number', min: 0, max: 10, step: 0.1, llamaDefault: 5,
    help: 'Mirostat target entropy.' },
  { key: 'mirostat_eta', label: 'Mirostat eta', group: 'Sampling', scope: 'completion', kind: 'number', min: 0, max: 1, step: 0.01, llamaDefault: 0.1,
    help: 'Mirostat learning rate.' },
  { key: 'seed', label: 'Seed', group: 'Sampling', scope: 'completion', kind: 'int', llamaDefault: -1,
    help: 'Random seed. -1 picks a new one each time; a fixed seed makes output reproducible.' },
  { key: 'samplers', label: 'Sampler order', group: 'Sampling', scope: 'completion', kind: 'string',
    help: 'Order of samplers, e.g. "penalties;dry;top_k;top_p;min_p;temperature". Empty uses the model file\'s order, else llama.cpp\'s.' },

  // ── Repetition ──
  { key: 'penalty_repeat', label: 'Repeat penalty', group: 'Repetition', scope: 'completion', kind: 'number', min: 1, max: 2, step: 0.01, llamaDefault: 1,
    help: 'Penalize tokens that already appeared. 1.0 disables.' },
  { key: 'penalty_present', label: 'Presence penalty', group: 'Repetition', scope: 'completion', kind: 'number', min: 0, max: 2, step: 0.05, llamaDefault: 0,
    help: 'Flat penalty on any token that already appeared. 0 disables.' },
  { key: 'penalty_freq', label: 'Frequency penalty', group: 'Repetition', scope: 'completion', kind: 'number', min: 0, max: 2, step: 0.05, llamaDefault: 0,
    help: 'Penalty that grows with how often a token appeared. 0 disables.' },
  { key: 'penalty_last_n', label: 'Repeat last N', group: 'Repetition', scope: 'completion', kind: 'int', min: -1, max: 4096, step: 16, llamaDefault: 64,
    help: 'How many recent tokens presence, frequency and repeat penalty look at. 0 disables, -1 uses the whole context; the app default is 512.' },
  { key: 'dry_multiplier', label: 'DRY multiplier', group: 'Repetition', scope: 'completion', kind: 'number', min: 0, max: 5, step: 0.05, llamaDefault: 0,
    help: 'DRY ("Don\'t Repeat Yourself") penalty strength for repeated sequences anywhere in the chat. 0 disables; the app default is 0.8.' },
  { key: 'dry_base', label: 'DRY base', group: 'Repetition', scope: 'completion', kind: 'number', min: 1, max: 4, step: 0.05, llamaDefault: 1.75,
    help: 'How fast the DRY penalty grows with sequence length. Has no effect unless DRY multiplier is above 0.' },
  { key: 'dry_allowed_length', label: 'DRY allowed length', group: 'Repetition', scope: 'completion', kind: 'int', min: 0, max: 20, step: 1, llamaDefault: 2,
    help: 'Repeated sequences up to this length are not penalized. Has no effect unless DRY multiplier is above 0.' },
  { key: 'dry_penalty_last_n', label: 'DRY last N', group: 'Repetition', scope: 'completion', kind: 'int', min: -1, max: 4096, step: 16, llamaDefault: -1,
    help: 'How many recent tokens DRY scans. 0 disables, -1 uses the whole context. Has no effect unless DRY multiplier is above 0.' },

  // ── Thinking ──
  { key: 'enable_thinking', label: 'Thinking', group: 'Thinking', scope: 'completion', kind: 'bool', llamaDefault: true,
    help: 'Let reasoning models think before answering. Needs a model with a built-in chat template.' },
  { key: 'reasoning_format', label: 'Reasoning format', group: 'Thinking', scope: 'completion', kind: 'select', llamaDefault: 'auto',
    options: [{ value: 'none', label: 'None' }, { value: 'auto', label: 'Auto' }, { value: 'deepseek', label: 'DeepSeek' }],
    help: 'How thinking is separated from the answer. Auto shows it in a collapsible Thinking section; None shows the raw output, tags included.' },
  { key: 'thinking_budget_tokens', label: 'Thinking budget', group: 'Thinking', scope: 'completion', kind: 'int', min: -1, max: 32768, step: 256, llamaDefault: -1,
    help: 'Maximum tokens of thinking before it is forced to close. -1 is unlimited.' },

  // ── Output ──
  { key: 'n_predict', label: 'Max tokens', group: 'Output', scope: 'completion', kind: 'int', min: 16, max: 32768, step: 16, llamaDefault: -1,
    help: 'Maximum length of a reply. Thinking models need room for their thinking too. Capped at half the context length.' },
  { key: 'stop', label: 'Stop strings', group: 'Output', scope: 'completion', kind: 'json',
    help: 'JSON array of strings that end the reply, e.g. ["</answer>"].' },
  { key: 'ignore_eos', label: 'Ignore end-of-text', group: 'Output', scope: 'completion', kind: 'bool', llamaDefault: false,
    help: 'Keep generating past the model\'s end token. Rarely useful.' },
  { key: 'grammar', label: 'Grammar (GBNF)', group: 'Output', scope: 'completion', kind: 'string',
    help: 'Constrain output with a GBNF grammar.' },
  { key: 'json_schema', label: 'JSON schema', group: 'Output', scope: 'completion', kind: 'string',
    help: 'Constrain output to JSON matching this schema.' },

  // ── Model loading ──
  { key: 'n_ctx', label: 'Context length', group: 'Model loading', scope: 'load', kind: 'int', min: 512, max: 131072, step: 512, llamaDefault: 512,
    help: 'Tokens of conversation the model can see at once. Larger uses more memory.' },
  { key: 'n_threads', label: 'Threads', group: 'Model loading', scope: 'load', kind: 'int', min: 1, max: 16, step: 1,
    help: 'CPU threads for generation. Usually best at the number of performance cores.' },
  { key: 'n_batch', label: 'Batch size', group: 'Model loading', scope: 'load', kind: 'int', min: 32, max: 4096, step: 32, llamaDefault: 512,
    help: 'Prompt tokens processed per step. Larger reads prompts faster but uses more memory.' },
  { key: 'n_ubatch', label: 'Micro-batch size', group: 'Model loading', scope: 'load', kind: 'int', min: 32, max: 4096, step: 32, llamaDefault: 512,
    help: 'Physical batch size. Must not exceed batch size.' },
  { key: 'n_gpu_layers', label: 'GPU layers', group: 'Model loading', scope: 'load', kind: 'int', min: 0, max: 999, step: 1, llamaDefault: 0,
    help: 'Layers to offload to the GPU. On Android this needs a GPU backend (see Devices).' },
  { key: 'devices', label: 'Devices', group: 'Model loading', scope: 'load', kind: 'json',
    help: 'JSON array of backend devices, e.g. ["HTP0"] for the Hexagon NPU. Empty uses the platform default.' },
  { key: 'flash_attn_type', label: 'Flash attention', group: 'Model loading', scope: 'load', kind: 'select', llamaDefault: 'auto',
    options: [{ value: 'auto', label: 'Auto' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }],
    help: 'Faster attention kernel; mainly helps on GPU.' },
  { key: 'cache_type_k', label: 'KV cache type (K)', group: 'Model loading', scope: 'load', kind: 'select', llamaDefault: 'f16',
    options: ['f16', 'q8_0', 'q4_0'].map((v) => ({ value: v, label: v })),
    help: 'Quantize the key cache to save memory with long contexts.' },
  { key: 'cache_type_v', label: 'KV cache type (V)', group: 'Model loading', scope: 'load', kind: 'select', llamaDefault: 'f16',
    options: ['f16', 'q8_0', 'q4_0'].map((v) => ({ value: v, label: v })),
    help: 'Quantize the value cache. Usually needs flash attention.' },
  { key: 'use_mmap', label: 'Memory-map model', group: 'Model loading', scope: 'load', kind: 'bool', llamaDefault: true,
    help: 'Map the file instead of reading it into memory. Faster loading.' },
  { key: 'use_mlock', label: 'Lock in memory', group: 'Model loading', scope: 'load', kind: 'bool', llamaDefault: false,
    help: 'Keep the model from being swapped out. Can fail on phones.' },
  { key: 'ctx_shift', label: 'Context shift', group: 'Model loading', scope: 'load', kind: 'bool', llamaDefault: true,
    help: 'Let llama.cpp shift the context when it fills during a reply.' },
  { key: 'rope_freq_base', label: 'RoPE frequency base', group: 'Model loading', scope: 'load', kind: 'number', llamaDefault: 0,
    help: 'Override RoPE base frequency for context extension. 0 uses the model\'s.' },
  { key: 'rope_freq_scale', label: 'RoPE frequency scale', group: 'Model loading', scope: 'load', kind: 'number', llamaDefault: 0,
    help: 'Override RoPE frequency scaling. 0 uses the model\'s.' },
  { key: 'chat_template', label: 'Chat template (Jinja)', group: 'Advanced', scope: 'load', kind: 'string',
    help: 'Replace the model\'s built-in Jinja chat template.' },

  // ── Advanced ──
  { key: 'n_keep', label: 'Tokens to keep', group: 'Advanced', scope: 'completion', kind: 'int', min: -1, max: 4096, step: 16, llamaDefault: 0,
    help: 'Prompt tokens kept when llama.cpp shifts a full context. -1 keeps the whole prompt.' },
  { key: 'logit_bias', label: 'Logit bias', group: 'Advanced', scope: 'completion', kind: 'json',
    help: 'JSON array of [token, bias] pairs, e.g. [[15043, -1]].' },
];

export const CATALOG_BY_KEY: Record<string, ParamDef> = Object.fromEntries(
  PARAM_CATALOG.map((d) => [d.key, d]),
);

/**
 * Every load-time parameter llama.rn's initLlama accepts. Used to route
 * custom (non-catalog) keys to the right place.
 */
export const LOAD_PARAM_KEYS = new Set<string>([
  'n_ctx', 'n_batch', 'n_ubatch', 'n_parallel', 'n_threads', 'cpu_mask', 'cpu_strict',
  'n_gpu_layers', 'devices', 'no_gpu_devices', 'flash_attn_type', 'flash_attn',
  'cache_type_k', 'cache_type_v', 'use_mlock', 'use_mmap', 'no_extra_bufts',
  'lora', 'lora_scaled', 'lora_list', 'rope_freq_base', 'rope_freq_scale',
  'ctx_shift', 'kv_unified', 'swa_full', 'n_cpu_moe', 'chat_template',
  'state_cache_budget_mb', 'state_cache_max_checkpoints',
  'model_draft', 'draft_model', 'spec_type', 'spec_draft_n_max', 'spec_draft_n_min',
  'spec_draft_p_min', 'spec_draft_p_split', 'spec_draft_n_gpu_layers',
  'spec_draft_cache_type_k', 'spec_draft_cache_type_v',
]);

/** Keys the app sets itself; user values for these are ignored. */
export const RESERVED_KEYS = new Set<string>([
  'model', 'prompt', 'messages', 'jinja', 'emit_partial_completion', 'embedding',
  'vocab_only', 'is_model_asset', 'use_progress_callback', 'media_paths',
]);

export function isLoadParam(key: string): boolean {
  return CATALOG_BY_KEY[key]?.scope === 'load' || LOAD_PARAM_KEYS.has(key);
}
