import type { ChatMessage } from '@/types';

export interface TemplateResult {
  prompt: string;
  stop: string[];
}

type Formatter = (messages: ChatMessage[]) => TemplateResult;

const chatML: Formatter = (messages) => {
  let prompt = '';
  for (const m of messages) {
    prompt += `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`;
  }
  prompt += '<|im_start|>assistant\n';
  return { prompt, stop: ['<|im_end|>'] };
};

const llama3: Formatter = (messages) => {
  let prompt = '<|begin_of_text|>';
  for (const m of messages) {
    prompt += `<|start_header_id|>${m.role}<|end_header_id|>\n\n${m.content}<|eot_id|>`;
  }
  prompt += '<|start_header_id|>assistant<|end_header_id|>\n\n';
  return { prompt, stop: ['<|eot_id|>'] };
};

const gemma: Formatter = (messages) => {
  let prompt = '';
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    if (m.role === 'system') {
      prompt += `<start_of_turn>user\n${m.content}<end_of_turn>\n`;
    } else {
      prompt += `<start_of_turn>${role}\n${m.content}<end_of_turn>\n`;
    }
  }
  prompt += '<start_of_turn>model\n';
  return { prompt, stop: ['<end_of_turn>'] };
};

const mistral: Formatter = (messages) => {
  let prompt = '';
  for (const m of messages) {
    if (m.role === 'system') {
      prompt += `[INST] ${m.content} [/INST]`;
    } else if (m.role === 'user') {
      prompt += `[INST] ${m.content} [/INST]`;
    } else {
      prompt += ` ${m.content}</s>`;
    }
  }
  return { prompt, stop: ['</s>'] };
};

const phi: Formatter = (messages) => {
  let prompt = '';
  for (const m of messages) {
    prompt += `<|${m.role}|>\n${m.content}<|end|>\n`;
  }
  prompt += '<|assistant|>\n';
  return { prompt, stop: ['<|end|>'] };
};

const zephyr: Formatter = (messages) => {
  let prompt = '';
  for (const m of messages) {
    prompt += `<|${m.role}|>\n${m.content}</s>\n`;
  }
  prompt += '<|assistant|>\n';
  return { prompt, stop: ['</s>'] };
};

const vicuna: Formatter = (messages) => {
  let prompt = '';
  for (const m of messages) {
    if (m.role === 'system') {
      prompt += `${m.content}\n\n`;
    } else if (m.role === 'user') {
      prompt += `USER: ${m.content}\n`;
    } else {
      prompt += `ASSISTANT: ${m.content}</s>\n`;
    }
  }
  prompt += 'ASSISTANT:';
  return { prompt, stop: ['</s>', 'USER:'] };
};

const alpaca: Formatter = (messages) => {
  let prompt = '';
  for (const m of messages) {
    if (m.role === 'system') {
      prompt += `### Instruction:\n${m.content}\n\n`;
    } else if (m.role === 'user') {
      prompt += `### Instruction:\n${m.content}\n\n### Response:\n`;
    } else {
      prompt += `${m.content}\n\n`;
    }
  }
  if (!prompt.endsWith('### Response:\n')) prompt += '### Response:\n';
  return { prompt, stop: ['### Instruction:', '###'] };
};

const raw: Formatter = (messages) => {
  const prompt = messages.map((m) => m.content).join('\n');
  return { prompt, stop: [] };
};

export const formatters: Record<string, Formatter> = {
  chatml: chatML,
  llama3,
  gemma,
  mistral,
  phi,
  zephyr,
  vicuna,
  alpaca,
  raw,
};

export function formatPrompt(templateKey: string, messages: ChatMessage[]): TemplateResult {
  const fn = formatters[templateKey];
  if (!fn) return chatML(messages); // fallback
  return fn(messages);
}
