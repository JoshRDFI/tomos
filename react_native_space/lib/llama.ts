import { Platform } from 'react-native';
import type { ChatMessage, ModelRecord } from '@/types';
import { loadSignature, type ParamSet } from './params';
import { formatPrompt } from './templates';
import { resolveStreamView, type StreamState, type StreamView } from './thinking';
import { fitToContext } from './contextWindow';

let _context: any = null;
let _loadedModelId: string | null = null;
let _loadedParams: ParamSet | null = null;

// The completion currently running on _context, if any. Releasing the native
// context while a completion is in flight crashes, so release waits on this.
let _inflight: Promise<unknown> | null = null;

export const isNative = Platform.OS !== 'web';

/** Load `model` with the given load-time llama.rn parameters (n_ctx, n_threads, ...). */
export async function loadModel(model: ModelRecord, loadParams: ParamSet): Promise<void> {
  if (!isNative) return;
  await releaseModel();
  const { initLlama } = await import('llama.rn');
  _context = await initLlama({
    use_mlock: false,
    ...(loadParams as object),
    model: model.filePath,
  } as any);
  _loadedModelId = model.id;
  _loadedParams = { ...loadParams };
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
  _loadedParams = null;
}

export function getLoadedModelId(): string | null {
  return _loadedModelId;
}

/** Identity of the load parameters currently in effect, or null if nothing is loaded. */
export function getLoadedSignature(): string | null {
  return _loadedParams ? loadSignature(_loadedParams) : null;
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
  /** The answer, without thinking. */
  content: string;
  /** The model's thinking, separated from the answer ('' if none). */
  reasoning: string;
  /** Time from the first thinking token to the start of the answer. */
  thinkingMs: number | null;
  tokenCount: number;
  tokensPerSec: number;
  stopped: boolean;
  /** Number of oldest history messages left out to fit the context window. */
  droppedMessages: number;
}

export type { StreamView } from './thinking';

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
  /** Per-completion llama.rn parameters (temperature, top_k, n_predict, ...). */
  params: ParamSet,
  /** Called as the reply streams in, with the thinking and answer so far. */
  onUpdate: (view: StreamView) => void,
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

  const nCtx = Number(_loadedParams?.n_ctx) || 512;
  // Never ask for more output than leaves room for at least some prompt.
  // n_predict <= 0 means "no limit" in llama.cpp; cap it the same way.
  const requested = Number(params.n_predict);
  const half = Math.floor(nCtx / 2);
  const nPredict = Math.max(16, requested > 0 ? Math.min(requested, half) : half);
  const { messages: fitted, dropped } = await fitToContext(messages, nCtx, nPredict, countTokens);

  const templateKey = model.templateOverride ?? 'auto';
  const hasJinjaTemplate = model.detectedTemplate === 'auto-available' || !!_loadedParams?.chat_template;
  const useJinja = templateKey === 'auto' && hasJinjaTemplate;

  // Everything the user configured passes straight through to llama.rn.
  const sampling = { ...params, n_predict: nPredict };

  // Thinking vs answer. With a jinja template llama.rn parses the output and
  // reports reasoning_content/content on every token (only when non-empty);
  // otherwise, or when it finds no thinking, split <think> tags ourselves.
  // reasoning_format 'none' means: show the raw output, don't split.
  const splitEnabled = params.reasoning_format !== 'none';
  const st: StreamState = { raw: '', nativeThinking: null, nativeContent: null };
  const view = () => resolveStreamView(st, splitEnabled);

  let firstTokenAt: number | null = null;
  let answerAt: number | null = null;
  let last: StreamView = { thinking: '', answer: '', thinkingOpen: false };
  const onData = (data: any) => {
    if (stopRef.stop) return;
    const now = Date.now();
    if (firstTokenAt === null) firstTokenAt = now;
    if (typeof data?.token === 'string') st.raw += data.token;
    if (typeof data?.reasoning_content === 'string') st.nativeThinking = data.reasoning_content;
    if (typeof data?.content === 'string') st.nativeContent = data.content;
    last = view();
    if (answerAt === null && last.answer.trim()) answerAt = now;
    onUpdate(last);
  };

  let request: any;
  if (useJinja) {
    request = {
      ...sampling,
      messages: fitted.map((m) => ({ role: m.role, content: m.content })),
      jinja: true,
    };
    // Ask llama.rn to separate thinking unless the user chose otherwise.
    if (request.reasoning_format === undefined) request.reasoning_format = 'auto';
  } else {
    const effectiveKey = templateKey === 'auto' ? 'chatml' : templateKey;
    const { prompt, stop } = formatPrompt(effectiveKey, fitted);
    const userStop = Array.isArray(params.stop) ? (params.stop as unknown[]).filter((x) => typeof x === 'string') as string[] : [];
    request = { ...sampling, prompt, stop: [...stop, ...userStop] };
  }

  const run = ctx.completion(request, onData);
  _inflight = run;
  let result: any;
  try {
    result = await run;
  } finally {
    _inflight = null;
  }

  // When stopped, keep exactly what the user saw rather than the full native
  // result, which can include tokens produced after the stop request.
  let final = last;
  if (!stopRef.stop && result) {
    if (typeof result.reasoning_content === 'string' && result.reasoning_content) st.nativeThinking = result.reasoning_content;
    if (typeof result.content === 'string' && (result.content || st.nativeContent !== null)) st.nativeContent = result.content;
    if (st.nativeThinking === null && st.nativeContent === null && typeof result.text === 'string') st.raw = result.text;
    const v = view();
    // Never lose text that was already on screen.
    final = v.answer.trim() || !last.answer.trim() ? v : last;
  }
  const thinkingMs = final.thinking && firstTokenAt !== null
    ? (answerAt ?? Date.now()) - firstTokenAt
    : null;

  return {
    content: final.answer.trim(),
    reasoning: final.thinking,
    thinkingMs,
    tokenCount: result?.timings?.predicted_n ?? 0,
    tokensPerSec: result?.timings?.predicted_per_second ?? 0,
    stopped: stopRef.stop,
    droppedMessages: dropped,
  };
}
