import { Platform } from 'react-native';
import type { ChatMessage, GenParams, ModelRecord } from '@/types';
import { formatPrompt } from './templates';

let _context: any = null;
let _loadedModelId: string | null = null;
let _loadedCtxParams: { contextLength: number; threads: number } | null = null;

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
}

export interface GenerateResult {
  content: string;
  tokenCount: number;
  tokensPerSec: number;
  stopped: boolean;
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

  _stopRef = { stop: false };
  const stopRef = _stopRef;

  const templateKey = model.templateOverride ?? 'auto';
  const useJinja = templateKey === 'auto' && model.detectedTemplate === 'auto-available';

  let result: any;

  if (useJinja) {
    // Use llama.rn's built-in template with jinja
    const llamaMessages = messages.map((m) => ({ role: m.role, content: m.content }));
    result = await _context.completion(
      {
        messages: llamaMessages,
        jinja: true,
        temperature: params.temperature,
        top_p: params.topP,
        top_k: params.topK,
        min_p: params.minP,
        penalty_repeat: params.repeatPenalty,
        n_predict: params.maxTokens,
      },
      (data: any) => {
        if (stopRef.stop) return;
        const tok = data?.token ?? '';
        if (tok) onToken(tok);
      },
    );
  } else {
    // Manual template
    const effectiveKey = templateKey === 'auto' ? 'chatml' : templateKey;
    const { prompt, stop } = formatPrompt(effectiveKey, messages);

    result = await _context.completion(
      {
        prompt,
        stop,
        temperature: params.temperature,
        top_p: params.topP,
        top_k: params.topK,
        min_p: params.minP,
        penalty_repeat: params.repeatPenalty,
        n_predict: params.maxTokens,
      },
      (data: any) => {
        if (stopRef.stop) return;
        const tok = data?.token ?? '';
        if (tok) onToken(tok);
      },
    );
  }

  if (stopRef.stop) {
    try { await _context.stopCompletion(); } catch {}
  }

  return {
    content: result?.text ?? '',
    tokenCount: result?.timings?.predicted_n ?? 0,
    tokensPerSec: result?.timings?.predicted_per_second ?? 0,
    stopped: stopRef.stop,
  };
}
