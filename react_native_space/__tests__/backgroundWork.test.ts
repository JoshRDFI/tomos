import { createBackgroundWork, PAUSED_TEXT, replyReadyNotice, type BackgroundNative } from '../lib/backgroundWork';

function fakeNative() {
  const calls: string[] = [];
  const native: BackgroundNative = {
    start: jest.fn((o) => { calls.push(`start:${o.text}:${o.pausedText ? 'watch' : 'nowatch'}`); return true; }),
    stop: jest.fn(() => { calls.push('stop'); }),
    notifyDone: jest.fn(),
    progress: jest.fn((n: number) => { calls.push(`progress:${n}`); }),
    takeSqueezed: jest.fn(() => true),
  };
  return { native, calls };
}

// Timers in JavaScript don't run while the app is in the background, so all
// timing (the delayed stop, the stall check) happens in the native service.
describe('background work', () => {
  it('starts the service for a reply, watching for stalls, and stops it when done', () => {
    const { native, calls } = fakeNative();
    const bg = createBackgroundWork(() => native);
    const end = bg.begin('reply');
    end();
    expect(calls).toEqual(['start:Generating reply…:watch', 'stop']);
  });

  it("a summary doesn't report tokens, so it isn't watched", () => {
    const { native, calls } = fakeNative();
    const bg = createBackgroundWork(() => native);
    bg.begin('summary')();
    expect(calls).toEqual(['start:Condensing earlier messages…:nowatch', 'stop']);
  });

  it('stays on while any work is running', () => {
    const { native } = fakeNative();
    const bg = createBackgroundWork(() => native);
    const a = bg.begin('reply');
    const b = bg.begin('summary');
    a();
    expect(native.stop).not.toHaveBeenCalled();
    b();
    expect(native.stop).toHaveBeenCalledTimes(1);
  });

  it('ending twice counts once', () => {
    const { native } = fakeNative();
    const bg = createBackgroundWork(() => native);
    const a = bg.begin('reply');
    const b = bg.begin('summary');
    a(); a();
    expect(native.stop).not.toHaveBeenCalled();
    b();
    expect(native.stop).toHaveBeenCalledTimes(1);
  });

  it('reports token progress at most once a second', () => {
    const { native, calls } = fakeNative();
    let now = 0;
    const bg = createBackgroundWork(() => native, { now: () => now });
    bg.begin('reply');
    bg.progress(); bg.progress(); bg.progress();
    now = 500; bg.progress();
    now = 1000; bg.progress();
    now = 1200; bg.progress();
    now = 2300; bg.progress();
    expect(calls.filter((c) => c.startsWith('progress'))).toEqual(['progress:1', 'progress:5', 'progress:7']);
  });

  it('a new reply counts from zero', () => {
    const { native, calls } = fakeNative();
    let now = 0;
    const bg = createBackgroundWork(() => native, { now: () => now });
    bg.begin('reply')();
    bg.progress();
    now = 5000;
    bg.begin('reply');
    bg.progress();
    expect(calls.filter((c) => c.startsWith('progress'))).toEqual(['progress:1', 'progress:1']);
  });

  it('asks the service whether a reply was squeezed', () => {
    const { native } = fakeNative();
    expect(createBackgroundWork(() => native).takeSqueezed()).toBe(true);
    expect(createBackgroundWork(() => null).takeSqueezed()).toBe(false);
  });

  it("a service that can't start (or no native module) never breaks generation", () => {
    const bg = createBackgroundWork(() => ({ start: () => { throw new Error('not allowed'); }, stop: () => { throw new Error('x'); }, notifyDone: () => {} }));
    const end = bg.begin('reply');
    expect(() => { bg.progress(); end(); bg.takeSqueezed(); }).not.toThrow();
    const none = createBackgroundWork(() => null);
    expect(() => none.begin('reply')()).not.toThrow();
    expect(() => none.notifyDone({ title: 't', body: 'b', sessionId: 's' })).not.toThrow();
  });

  it('the paused text says what to do', () => expect(PAUSED_TEXT).toMatch(/Open Tomos/));
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

