import { createBackgroundWork, replyReadyNotice, type BackgroundNative } from '../lib/backgroundWork';

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
