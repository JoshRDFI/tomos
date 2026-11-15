import { formatPrompt } from '@/lib/templates';

describe('llama3 template', () => {
  const r = formatPrompt('llama3', [
    { role: 'system', content: 'S' },
    { role: 'user', content: 'U' },
  ]);
  it('does not add a BOS token (llama.cpp adds it)', () => {
    expect(r.prompt).not.toContain('<|begin_of_text|>');
  });
  it('ends with the assistant header and stops on eot/eos', () => {
    expect(r.prompt.endsWith('<|start_header_id|>assistant<|end_header_id|>\n\n')).toBe(true);
    expect(r.stop).toEqual(expect.arrayContaining(['<|eot_id|>', '<|end_of_text|>']));
  });
});
