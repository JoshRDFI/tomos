// Keeps a reply or summary running with the screen off. Android freezes a
// backgrounded app unless it runs a foreground service, so the service is on
// while any generation is; modules/generation-service is the native side.
import { AppState, Platform } from 'react-native';
import { splitThinking } from './thinking';

export interface BackgroundNative {
  /** Start the service or update its notification. False when Android refused (e.g. started from the background). */
  start(o: { title: string; text: string }): boolean;
  stop(): void;
  notifyDone(o: { title: string; body: string; subtitle: string | null; sessionId: string }): void;
  /** The app's memory use and Android's limit for it, in bytes; high is null when there's no limit. */
  memoryState?(): MemoryState | null;
}

export interface MemoryState {
  current: number;
  high: number | null;
}

/**
 * Android 17 limits an app's memory while it isn't on screen (4 GB on a 16 GB
 * phone), foreground service or not. A model bigger than that is squeezed into
 * swap and generation all but stops until the app is back on screen.
 */
export function overMemoryLimit(m: MemoryState | null): boolean {
  return !!m && m.high != null && m.current >= 0.9 * m.high;
}

export const PAUSED_TEXT = 'Paused: this model needs more memory than Android allows in the background. Open Tomos to continue.';

export type WorkKind = 'reply' | 'summary';

const TEXT: Record<WorkKind, string> = {
  reply: 'Generating reply…',
  summary: 'Condensing earlier messages…',
};

/**
 * `begin()` turns the service on and returns the matching `end()`. The service
 * stops `stopDelayMs` after the last work ends, so a summary that starts right
 * after a reply keeps it running: Android won't let a backgrounded app start
 * it again. Native failures are logged, never thrown: without the service,
 * generation still works in the foreground.
 */
export function createBackgroundWork(
  getNative: () => BackgroundNative | null,
  opts: { stopDelayMs: number; pollMs?: number; isBackground?: () => boolean },
) {
  let active = 0;
  let stopTimer: ReturnType<typeof setTimeout> | null = null;
  let kind: WorkKind = 'reply';
  let paused = false;
  let squeezed = false;
  let poll: ReturnType<typeof setInterval> | null = null;

  const call = (what: string, f: (n: BackgroundNative) => void) => {
    try {
      const n = getNative();
      if (n) f(n);
    } catch (e) {
      console.warn(`[bg] ${what} failed`, e);
    }
  };

  const show = (text: string) =>
    call('start', (n) => { if (!n.start({ title: 'Tomos', text })) console.warn('[bg] service not started'); });

  // While work runs, watch for the background memory limit: say so in the
  // notification, and put the normal text back once the app is on screen.
  const check = () => {
    const background = opts.isBackground?.() ?? false;
    let over = false;
    if (background) call('memory', (n) => { over = overMemoryLimit(n.memoryState?.() ?? null); });
    if (over && !paused) { paused = true; squeezed = true; show(PAUSED_TEXT); }
    else if (!background && paused) { paused = false; show(TEXT[kind]); }
  };

  return {
    begin(next: WorkKind): () => void {
      if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
      active++;
      kind = next;
      paused = false;
      show(TEXT[kind]);
      if (!poll && opts.pollMs) poll = setInterval(check, opts.pollMs);
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        active--;
        if (active > 0) return;
        if (poll) { clearInterval(poll); poll = null; }
        paused = false;
        stopTimer = setTimeout(() => {
          stopTimer = null;
          if (active === 0) call('stop', (n) => n.stop());
        }, opts.stopDelayMs);
      };
    },
    /** Whether work was squeezed by the memory limit since the last call. */
    takeSqueezed(): boolean {
      const was = squeezed;
      squeezed = false;
      return was;
    },
    notifyDone(o: { title: string; body: string; subtitle?: string | null; sessionId: string }) {
      call('notify', (n) => n.notifyDone({ ...o, subtitle: o.subtitle ?? null }));
    },
  };
}

const MAX_BODY = 120;

/** The "Reply ready" notification: the answer's first line, plain text. */
export function replyReadyNotice(content: string, chatTitle: string | null): { title: string; body: string; subtitle: string | null } {
  const answer = splitThinking(content).answer;
  const line = (answer.split('\n').map((l) => l.replace(/[*_`#>]+/g, '').trim()).find(Boolean) ?? '');
  const body = !line ? 'Tap to read it.' : line.length > MAX_BODY ? line.slice(0, MAX_BODY - 1) + '…' : line;
  return { title: 'Reply ready', body, subtitle: chatTitle };
}

function nativeModule(): BackgroundNative | null {
  if (Platform.OS !== 'android') return null;
  // Loaded lazily so tests and other platforms never touch the native module.
  return require('../modules/generation-service').default as BackgroundNative;
}

export const backgroundWork = createBackgroundWork(nativeModule, {
  stopDelayMs: 5000,
  pollMs: 5000,
  isBackground: () => AppState.currentState !== 'active',
});

/** The ongoing notification's Stop button. Returns the unsubscribe. */
export function onStopRequest(listener: () => void): () => void {
  try {
    const n = nativeModule() as (BackgroundNative & { addListener?: (e: 'onStopRequest', l: () => void) => { remove(): void } }) | null;
    const sub = n?.addListener?.('onStopRequest', listener);
    return () => sub?.remove();
  } catch (e) {
    console.warn('[bg] listener failed', e);
    return () => {};
  }
}
