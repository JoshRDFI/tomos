import { parseHfLink } from '../lib/hfLink';

describe('parseHfLink', () => {
  it('reads a model card link', () => {
    expect(parseHfLink('https://huggingface.co/unsloth/Qwen3-8B-GGUF')).toEqual({ repo: 'unsloth/Qwen3-8B-GGUF', revision: null, file: null });
  });
  it('ignores www, trailing slash, query and fragment', () => {
    expect(parseHfLink('https://www.huggingface.co/Qwen/Qwen3-8B/?utm_source=x#usage')).toEqual({ repo: 'Qwen/Qwen3-8B', revision: null, file: null });
  });
  it('reads hf.co without a scheme and a tree revision', () => {
    expect(parseHfLink('hf.co/unsloth/Qwen3-8B-GGUF/tree/main')).toEqual({ repo: 'unsloth/Qwen3-8B-GGUF', revision: 'main', file: null });
  });
  it('reads a file page link', () => {
    expect(parseHfLink('https://huggingface.co/unsloth/Qwen3-8B-GGUF/blob/main/Qwen3-8B-Q4_K_M.gguf')).toEqual({ repo: 'unsloth/Qwen3-8B-GGUF', revision: 'main', file: 'Qwen3-8B-Q4_K_M.gguf' });
  });
  it('reads a resolve link with a folder and query', () => {
    expect(parseHfLink('https://huggingface.co/u/R-GGUF/resolve/abc123/BF16/R-BF16-00001-of-00002.gguf?download=true')).toEqual({ repo: 'u/R-GGUF', revision: 'abc123', file: 'BF16/R-BF16-00001-of-00002.gguf' });
  });
  it('reads a bare owner/repo', () => {
    expect(parseHfLink('  unsloth/Qwen3-8B-GGUF  ')).toEqual({ repo: 'unsloth/Qwen3-8B-GGUF', revision: null, file: null });
  });
  it('finds the link inside pasted post text', () => {
    expect(parseHfLink('Check this out https://huggingface.co/Qwen/Qwen3-8B 🔥')).toEqual({ repo: 'Qwen/Qwen3-8B', revision: null, file: null });
  });
  it.each(['', 'hello', 'https://github.com/a/b', 'https://huggingface.co/docs/hub', 'https://huggingface.co/spaces/a/b', 'https://huggingface.co/datasets/a/b', 'https://huggingface.co/unsloth'])(
    'rejects %p', (bad) => {
      expect(parseHfLink(bad)).toBeNull();
    });
  it('drops sentence punctuation after a pasted link', () => {
    expect(parseHfLink('Try this: https://huggingface.co/Qwen/Qwen3-8B.')).toEqual({ repo: 'Qwen/Qwen3-8B', revision: null, file: null });
    expect(parseHfLink('(https://hf.co/unsloth/Qwen3-8B-GGUF),')?.repo).toBe('unsloth/Qwen3-8B-GGUF');
  });

  it('returns null instead of throwing on a malformed escape', () => {
    expect(() => parseHfLink('https://huggingface.co/u/r/blob/main/a%zz.gguf')).not.toThrow();
  });
});
