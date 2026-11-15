export interface GenParams {
  temperature: number;
  topP: number;
  topK: number;
  minP: number;
  repeatPenalty: number;
  maxTokens: number;
  contextLength: number;
  threads: number;
}

export const DEFAULT_GEN_PARAMS: GenParams = {
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  minP: 0.05,
  repeatPenalty: 1.1,
  maxTokens: 1024,
  contextLength: 4096,
  threads: 6,
};

export const PARAM_RANGES: Record<keyof GenParams, { min: number; max: number; step: number }> = {
  temperature: { min: 0, max: 2, step: 0.05 },
  topP: { min: 0, max: 1, step: 0.01 },
  topK: { min: 0, max: 200, step: 1 },
  minP: { min: 0, max: 1, step: 0.01 },
  repeatPenalty: { min: 1.0, max: 2.0, step: 0.01 },
  maxTokens: { min: 16, max: 8192, step: 1 },
  contextLength: { min: 512, max: 32768, step: 512 },
  threads: { min: 1, max: 8, step: 1 },
};

export const PARAM_LABELS: Record<keyof GenParams, string> = {
  temperature: 'Temperature',
  topP: 'Top P',
  topK: 'Top K',
  minP: 'Min P',
  repeatPenalty: 'Repeat Penalty',
  maxTokens: 'Max Tokens',
  contextLength: 'Context Length',
  threads: 'Threads',
};

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
}

export interface SessionRecord {
  id: string;
  title: string;
  modelId: string | null;
  systemPromptOverride: string | null;
  paramsOverride: string | null; // JSON GenParams
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
