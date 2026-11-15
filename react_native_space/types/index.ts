export interface ModelRecord {
  id: string;
  displayName: string;
  fileName: string;
  filePath: string;
  fileSizeBytes: number;
  quantization: string | null;
  architecture: string | null;
  parameterLabel: string | null;
  detectedTemplate: string | null;
  templateOverride: string;
  trainedContext: number | null;
  addedAt: number;
  /** Recommended settings read from the GGUF metadata (JSON ParamSet); null = not read yet. */
  fileParams: string | null;
  /** User overrides for this model (JSON ParamSet). */
  paramsOverride: string | null;
}

export interface SessionRecord {
  id: string;
  title: string;
  modelId: string | null;
  systemPromptOverride: string | null;
  paramsOverride: string | null; // JSON ParamSet (overrides for this chat)
  createdAt: number;
  updatedAt: number;
}

export interface MessageRecord {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  modelName: string | null;
  tokenCount: number | null;
  tokensPerSec: number | null;
  stopped: number;
  createdAt: number;
  /** Assistant thinking, kept apart from the answer (null if none). */
  reasoning?: string | null;
  /** How long the model thought, in ms. */
  thinkingMs?: number | null;
}

export interface PromptPreset {
  id: string;
  name: string;
  content: string;
  createdAt: number;
}

export interface SearchResult {
  messageId: string;
  sessionId: string;
  sessionTitle: string;
  content: string;
  snippet: string;
  role: string;
  createdAt: number;
}

export type ThemeMode = 'dark' | 'light' | 'system';

export type TemplateKey = 'auto' | 'chatml' | 'llama3' | 'gemma' | 'mistral' | 'phi' | 'zephyr' | 'vicuna' | 'alpaca' | 'raw';

export const TEMPLATE_OPTIONS: { key: TemplateKey; label: string }[] = [
  { key: 'auto', label: 'Auto' },
  { key: 'chatml', label: 'ChatML' },
  { key: 'llama3', label: 'Llama 3' },
  { key: 'gemma', label: 'Gemma' },
  { key: 'mistral', label: 'Mistral' },
  { key: 'phi', label: 'Phi' },
  { key: 'zephyr', label: 'Zephyr' },
  { key: 'vicuna', label: 'Vicuna' },
  { key: 'alpaca', label: 'Alpaca' },
  { key: 'raw', label: 'Raw / None' },
];

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
