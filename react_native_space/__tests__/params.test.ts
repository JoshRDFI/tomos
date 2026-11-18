import {
  APP_DEFAULTS, extractFileParams, loadSignature, parseCliFlags, parseParamSet,
  parseValue, resolveParams, splitParams,
} from '@/lib/params';

describe('parseCliFlags', () => {
  it('parses the Bonsai 2 command from the PrismML docs', () => {
    const r = parseCliFlags(`./llama-cli -m Ternary-Bonsai-2-9B-Q2_0.gguf -ngl 99 -fa on -c 32768
      --temp 1.0 --top-p 0.95 --top-k 20 --min-p 0
      --presence-penalty 1.0 --repeat-penalty 1.0 --repeat-last-n 64
      -p "What is the capital of France?" -n 16384`);
    expect(r.params).toEqual({
      n_gpu_layers: 99, flash_attn_type: 'on', n_ctx: 32768,
      temperature: 1, top_p: 0.95, top_k: 20, min_p: 0,
      penalty_present: 1, penalty_repeat: 1, penalty_last_n: 64,
      n_predict: 16384,
    });
    expect(r.unknown).toEqual([]);
    expect(r.invalid).toEqual([]);
  });

  it('handles --flag=value, switches, negative values and thinking kwargs', () => {
    const r = parseCliFlags(`--temp=0.6 --mlock --seed -1 --chat-template-kwargs '{"enable_thinking": false}'`);
    expect(r.params).toEqual({ temperature: 0.6, use_mlock: true, seed: -1, enable_thinking: false });
  });

  it('reports unknown flags and bad values without stopping', () => {
    const r = parseCliFlags('--frobnicate 3 --top-k abc --temp 0.5 --flash-attn --mlock');
    expect(r.params).toEqual({ temperature: 0.5, use_mlock: true });
    expect(r.unknown).toEqual(['--frobnicate']);
    expect(r.invalid).toEqual(['--top-k', '--flash-attn']);
  });

  it('ignores -c 0 (whole training context is too large for a phone)', () => {
    expect(parseCliFlags('-c 0').params).toEqual({});
  });
});

describe('resolveParams', () => {
  it('applies layers in order and reports where each value came from', () => {
    const r = resolveParams({
      global: { temperature: 0.5, top_k: 30 },
      file: { temperature: 1.0, penalty_present: 1 },
      model: { top_k: 20 },
      chat: { temperature: 0.2 },
    });
    expect(r.values.temperature).toBe(0.2);
    expect(r.sources.temperature).toBe('chat');
    expect(r.values.top_k).toBe(20);
    expect(r.sources.top_k).toBe('model');
    expect(r.sources.penalty_present).toBe('file');
    expect(r.values.n_ctx).toBe(APP_DEFAULTS.n_ctx);
    expect(r.sources.n_ctx).toBe('app');
  });
});

describe('splitParams', () => {
  it('routes load-time keys (catalog and custom) separately and drops reserved keys', () => {
    const { load, completion } = splitParams({
      n_ctx: 8192, n_threads: 4, n_cpu_moe: 2, temperature: 0.7,
      my_custom: 1, prompt: 'x', jinja: false, samplers: '',
    });
    expect(load).toEqual({ n_ctx: 8192, n_threads: 4, n_cpu_moe: 2 });
    expect(completion).toEqual({ temperature: 0.7, my_custom: 1 });
  });

  it('load signature ignores key order', () => {
    expect(loadSignature({ a: 1, b: 2 })).toBe(loadSignature({ b: 2, a: 1 }));
    expect(loadSignature({ a: 1 })).not.toBe(loadSignature({ a: 2 }));
  });
});

describe('parseParamSet', () => {
  it('converts settings saved by the first app version', () => {
    expect(parseParamSet(JSON.stringify({
      temperature: 0.7, topP: 0.9, topK: 40, minP: 0.05, repeatPenalty: 1.1,
      maxTokens: 1024, contextLength: 4096, threads: 6,
    }))).toEqual({
      temperature: 0.7, top_p: 0.9, top_k: 40, min_p: 0.05, penalty_repeat: 1.1,
      n_predict: 1024, n_ctx: 4096, n_threads: 6,
    });
  });
  it('tolerates garbage', () => {
    expect(parseParamSet('nope')).toEqual({});
    expect(parseParamSet('[1,2]')).toEqual({});
    expect(parseParamSet(null)).toEqual({});
  });
});

describe('parseValue', () => {
  it('coerces by catalog kind', () => {
    expect(parseValue('temperature', '0.8')).toBe(0.8);
    expect(parseValue('top_k', '2.5')).toBeUndefined();
    expect(parseValue('enable_thinking', 'off')).toBe(false);
    expect(parseValue('mirostat', '2')).toBe(2);
    expect(parseValue('stop', '["</s>"]')).toEqual(['</s>']);
    expect(parseValue('stop', '[oops')).toBeUndefined();
  });
  it('parses custom keys as JSON when possible, else string', () => {
    expect(parseValue('custom_thing', '3')).toBe(3);
    expect(parseValue('custom_thing', 'true')).toBe(true);
    expect(parseValue('custom_thing', 'hello')).toBe('hello');
    expect(parseValue('custom_thing', '  ')).toBeUndefined();
  });
});

describe('extractFileParams', () => {
  it('reads general.sampling.* metadata (strings from llama.rn)', () => {
    expect(extractFileParams({
      'general.name': 'X',
      'general.sampling.temp': '0.6',
      'general.sampling.top_k': '20',
      'general.sampling.top_p': '0.95',
      'general.sampling.sequence': '[top_k, top_p, temperature]',
      'general.sampling.min_p': 'garbage',
    })).toEqual({ temperature: 0.6, top_k: 20, top_p: 0.95, samplers: 'top_k;top_p;temperature' });
  });
  it('returns {} when there is no metadata', () => {
    expect(extractFileParams(null)).toEqual({});
    expect(extractFileParams({ 'general.name': 'X' })).toEqual({});
  });
});

describe('persona layer', () => {
  it('sits between the model and the chat', () => {
    const r = resolveParams({ model: { temperature: 0.5 }, persona: { temperature: 0.9 }, chat: {} });
    expect(r.values.temperature).toBe(0.9);
    expect(r.sources.temperature).toBe('persona');
    const c = resolveParams({ persona: { temperature: 0.9 }, chat: { temperature: 0.2 } });
    expect(c.values.temperature).toBe(0.2);
  });
});
