import { buildContinuation, splitContinued } from '../lib/continuation';

describe('buildContinuation', () => {
  it('continues a plain answer', () => {
    const c = buildContinuation({ content: 'The capital of France', reasoning: '' });
    expect(c.promptSuffix).toBe('The capital of France');
    expect(splitContinued(c.displayPrefix, ' is Paris.')).toEqual({ thinking: '', answer: 'The capital of France is Paris.', open: false });
  });

  it('continues inside unfinished thinking', () => {
    const c = buildContinuation({ content: '', reasoning: 'First, consider' });
    expect(c.promptSuffix).toBe('<think>First, consider');
    expect(splitContinued(c.displayPrefix, ' the input.')).toEqual({ thinking: 'First, consider the input.', answer: '', open: true });
    expect(splitContinued(c.displayPrefix, ' x.</think>\n\nDone.')).toEqual({ thinking: 'First, consider x.', answer: 'Done.', open: false });
  });

  it('closes finished thinking before the answer', () => {
    const c = buildContinuation({ content: 'Step 1', reasoning: 'plan' });
    expect(c.promptSuffix).toBe('<think>plan</think>\n\nStep 1');
    expect(splitContinued(c.displayPrefix, ', step 2')).toEqual({ thinking: 'plan', answer: 'Step 1, step 2', open: false });
  });

  it("doesn't repeat a start tag the template already added", () => {
    const c = buildContinuation({ content: '', reasoning: 'hmm' }, { start: '<think>', end: '</think>' }, true);
    expect(c.promptSuffix).toBe('hmm');
    expect(c.displayPrefix).toBe('<think>hmm');
  });

  it('uses the model’s own tags', () => {
    const c = buildContinuation({ content: 'A', reasoning: 'r' }, { start: '[THINK]', end: '[/THINK]' });
    expect(c.promptSuffix).toBe('[THINK]r[/THINK]\n\nA');
    expect(splitContinued(c.displayPrefix, 'B')).toEqual({ thinking: 'r', answer: 'AB', open: false });
  });
});
