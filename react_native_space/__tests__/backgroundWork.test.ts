import { createBackgroundWork, overMemoryLimit, PAUSED_TEXT, replyReadyNotice, type BackgroundNative } from '../lib/backgroundWork';

function fakeNative() {
  const calls: string[] = [];
  const native: BackgroundNative = {
    start: jest.fn((o) => { calls.push(`start:${o.text}`); return true; }),
    stop: jest.fn(() => { calls.push('stop'); }),
    notifyDone: jest.fn(),
  };
  return { native, calls };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('background work', () => {
  it('starts the service for a reply and stops it shortly after', () => {
    const { native, calls } = fakeNative();
    const bg = createBackgroundWork(() => native, { stopDelayMs: 5000 });
    const end = bg.begin('reply');
    expect(calls).toEqual(['start:Generating reply…']);
    end();
    expect(native.stop).not.toHaveBeenCalled();
    jest.advanceTimersByTime(5000);
    expect(calls).toEqual(['start:Generating reply…', 'stop']);
  });

  it('a summary right after the reply keeps the service running, with its own text', () => {
    const { native, calls } = fakeNative();
    const bg = createBackgroundWork(() => native, { stopDelayMs: 5000 });
    const endReply = bg.begin('reply');
    endReply();
    jest.advanceTimersByTime(1000);
    const endSummary = bg.begin('summary');
    jest.advanceTimersByTime(10000);
    expect(native.stop).not.toHaveBeenCalled();
    endSummary();
    jest.advanceTimersByTime(5000);
    expect(calls).toEqual(['start:Generating reply…', 'start:Condensing earlier messages…', 'stop']);
  });

  it('stays on while any work is running', () => {
    const { native } = fakeNative();
    const bg = createBackgroundWork(() => native, { stopDelayMs: 5000 });
    const a = bg.begin('reply');
    const b = bg.begin('summary');
    a();
    jest.advanceTimersByTime(10000);
    expect(native.stop).not.toHaveBeenCalled();
    b();
    jest.advanceTimersByTime(5000);
    expect(native.stop).toHaveBeenCalledTimes(1);
  });

  it('ending twice counts once', () => {
    const { native } = fakeNative();
    const bg = createBackgroundWork(() => native, { stopDelayMs: 5000 });
    const a = bg.begin('reply');
    const b = bg.begin('summary');
    a(); a();
    jest.advanceTimersByTime(10000);
    expect(native.stop).not.toHaveBeenCalled();
    b();
  });

  it("a service that can't start (or no native module) never breaks generation", () => {
    const bg = createBackgroundWork(() => ({ start: () => { throw new Error('not allowed'); }, stop: () => { throw new Error('x'); }, notifyDone: () => {} }), { stopDelayMs: 0 });
    const end = bg.begin('reply');
    expect(() => { end(); jest.runAllTimers(); }).not.toThrow();
    const none = createBackgroundWork(() => null, { stopDelayMs: 0 });
    expect(() => none.begin('reply')()).not.toThrow();
    expect(() => none.notifyDone({ title: 't', body: 'b', sessionId: 's' })).not.toThrow();
  });
});

describe('replyReadyNotice', () => {
  it("shows the reply's first line, without thinking", () => {
    expect(replyReadyNotice('<think>plan it</think>\n\nThe storm hits at dawn.\nMore text.', 'Lighthouse')).toEqual({ title: 'Reply ready', body: 'The storm hits at dawn.', subtitle: 'Lighthouse' });
  });
  it('shortens a long first line', () => {
    const n = replyReadyNotice('x'.repeat(300), null);
    expect(n.body).toHaveLength(120);
    expect(n.body.endsWith('…')).toBe(true);
    expect(n.subtitle).toBeNull();
  });
  it('an empty answer still says something', () => expect(replyReadyNotice('<think>only thinking</think>', 'c').body).toBe('Tap to read it.'));
  it('drops markdown markers from the line', () => expect(replyReadyNotice('**She runs.** *fast*', null).body).toBe('She runs. fast'));
});

describe('overMemoryLimit', () => {
  const GB = 1024 ** 3;
  it('at the limit → yes', () => expect(overMemoryLimit({ current: 3.95 * GB, high: 4 * GB })).toBe(true));
  it('well under it → no', () => expect(overMemoryLimit({ current: 2 * GB, high: 4 * GB })).toBe(false));
  it('no limit (on screen) → no', () => expect(overMemoryLimit({ current: 6 * GB, high: null })).toBe(false));
  it('unreadable → no', () => expect(overMemoryLimit(null)).toBe(false));
});

describe('memory limit in the background', () => {
  const GB = 1024 ** 3;
  function setup(state: { background: boolean; current: number }) {
    const calls: string[] = [];
    const memoryState = jest.fn(() => ({ current: state.current, high: state.background ? 4 * GB : null }));
    const native: BackgroundNative = {
      start: jest.fn((o) => { calls.push(`start:${o.text}`); return true; }),
      stop: jest.fn(() => { calls.push('stop'); }),
      notifyDone: jest.fn(),
      memoryState,
    };
    const bg = createBackgroundWork(() => native, { stopDelayMs: 5000, pollMs: 5000, isBackground: () => state.background });
    return { bg, calls, memoryState };
  }

  it('says the reply is paused when the app is squeezed in the background', () => {
    const state = { background: true, current: 4 * GB };
    const { bg, calls } = setup(state);
    bg.begin('reply');
    jest.advanceTimersByTime(5000);
    expect(calls).toEqual(['start:Generating reply…', `start:${PAUSED_TEXT}`]);
    jest.advanceTimersByTime(10000);
    expect(calls).toHaveLength(2);
    expect(bg.takeSqueezed()).toBe(true);
    expect(bg.takeSqueezed()).toBe(false);
  });

  it('a model that fits keeps the normal text', () => {
    const state = { background: true, current: 2 * GB };
    const { bg, calls } = setup(state);
    bg.begin('reply');
    jest.advanceTimersByTime(20000);
    expect(calls).toEqual(['start:Generating reply…']);
    expect(bg.takeSqueezed()).toBe(false);
  });

  it('back on screen, the text goes back to normal', () => {
    const state = { background: true, current: 4 * GB };
    const { bg, calls } = setup(state);
    bg.begin('summary');
    jest.advanceTimersByTime(5000);
    state.background = false;
    jest.advanceTimersByTime(5000);
    expect(calls).toEqual(['start:Condensing earlier messages…', `start:${PAUSED_TEXT}`, 'start:Condensing earlier messages…']);
    expect(bg.takeSqueezed()).toBe(true);
  });

  it('stops checking once the work is done', () => {
    const state = { background: true, current: 2 * GB };
    const { bg, memoryState } = setup(state);
    const end = bg.begin('reply');
    jest.advanceTimersByTime(5000);
    end();
    jest.advanceTimersByTime(5000);
    const n = memoryState.mock.calls.length;
    jest.advanceTimersByTime(30000);
    expect(memoryState.mock.calls.length).toBe(n);
  });
});
