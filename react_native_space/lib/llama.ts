import { Platform } from 'react-native';
import type { ChatMessage, GenParams, ModelRecord } from '@/types';
import { formatPrompt } from './templates';
import { fitToContext } from './contextWindow';

let _context: any = null;
let _loadedModelId: string | null = null;
let _loadedCtxParams: { contextLength: number; threads: number } | null = null;

// The completion currently running on _context, if any. Releasing the native
// context while a completion is in flight crashes, so release waits on this.
let _inflight: Promise<unknown> | null = null;

export const isNative = Platform.OS !== 'web';

export async function loadModel(
  model: ModelRecord,
  params: { contextLength: number; threads: number },
): Promise<void> {
  if (!isNative) return;
  await releaseModel();
  const { initLlama } = await import('llama.rn');
  _context = await initLlama({
    model: model.filePath,
    n_ctx: params.contextLength,
    n_threads: params.threads,
    use_mlock: false,
  });
  _loadedModelId = model.id;
  _loadedCtxParams = { ...params };
}

export async function releaseModel(): Promise<void> {
  if (_context) {
    if (_inflight) {
      try { await _context.stopCompletion(); } catch {}
      try { await _inflight; } catch {}
    }
    try { await _context.release(); } catch {}
    _context = null;
  }
  _loadedModelId = null;
  _loadedCtxParams = null;
}

export function getLoadedModelId(): string | null {
  return _loadedModelId;
}

export function getLoadedCtxParams() {
  return _loadedCtxParams;
}

export async function loadModelInfo(filePath: string): Promise<Record<string, any> | null> {
  if (!isNative) return null;
  try {
    const { loadLlamaModelInfo } = await import('llama.rn');
    return await loadLlamaModelInfo(filePath);
  } catch {
    return null;
  }
}

let _stopRef: { stop: boolean } = { stop: false };

export function stopGeneration() {
  _stopRef.stop = true;
  // Actually interrupt native generation; the completion promise then resolves
  // promptly with what was produced so far.
  if (_context && _inflight) {
    _context.stopCompletion().catch(() => {});
  }
}

export interface GenerateResult {
  content: string;
  tokenCount: number;
  tokensPerSec: number;
  stopped: boolean;
  /** Number of oldest history messages left out to fit the context window. */
  droppedMessages: number;
}

async function countTokens(text: string): Promise<number> {
  try {
    const res = await _context.tokenize(text);
    return res?.tokens?.length ?? Math.ceil(text.length / 3);
  } catch {
    // Conservative fallback (~3 chars per token)
    return Math.ceil(text.length / 3);
  }
}

export async function generate(
  model: ModelRecord,
  messages: ChatMessage[],
  params: GenParams,
  onToken: (token: string) => void,
): Promise<GenerateResult> {
  if (!isNative || !_context) {
    throw new Error('Model not loaded');
  }
  if (_inflight) {
    throw new Error('A response is already being generated');
  }

  _stopRef = { stop: false };
  const stopRef = _stopRef;
  const ctx = _context;

  const nCtx = _loadedCtxParams?.contextLength ?? params.contextLength;
  // Never ask for more output than leaves room for at least some prompt.
  const nPredict = Math.max(16, Math.min(params.maxTokens, Math.floor(nCtx / 2)));
  const { messages: fitted, dropped } = await fitToContext(messages, nCtx, nPredict, countTokens);

  const templateKey = model.templateOverride ?? 'auto';
  const useJinja = templateKey === 'auto' && model.detectedTemplate === 'auto-available';

  const sampling = {
    temperature: params.temperature,
    top_p: params.topP,
    top_k: params.topK,
    min_p: params.minP,
    penalty_repeat: params.repeatPenalty,
    n_predict: nPredict,
  };

  let shown = '';
  const onData = (data: any) => {
    if (stopRef.stop) return;
    const tok = data?.token ?? '';
    if (tok) {
      shown += tok;
      onToken(tok);
    }
  };

  let request: any;
  if (useJinja) {
    request = {
      ...sampling,
      messages: fitted.map((m) => ({ role: m.role, content: m.content })),
      jinja: true,
    };
  } else {
    const effectiveKey = templateKey === 'auto' ? 'chatml' : templateKey;
    const { prompt, stop } = formatPrompt(effectiveKey, fitted);
    request = { ...sampling, prompt, stop };
  }

  const run = ctx.completion(request, onData);
  _inflight = run;
  let result: any;
  try {
    result = await run;
  } finally {
    _inflight = null;
  }

  return {
    // When stopped, keep exactly what the user saw rather than the full native
    // result, which can include tokens produced after the stop request.
    content: stopRef.stop ? shown : (result?.text ?? shown),
    tokenCount: result?.timings?.predicted_n ?? 0,
    tokensPerSec: result?.timings?.predicted_per_second ?? 0,
    stopped: stopRef.stop,
    droppedMessages: dropped,
  };
}
