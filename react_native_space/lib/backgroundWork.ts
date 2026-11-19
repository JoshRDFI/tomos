// Keeps a reply or summary running with the screen off. Android freezes a
// backgrounded app unless it runs a foreground service, so the service is on
// while any generation is; modules/generation-service is the native side.
//
// JavaScript timers don't run while the app is in the background, so anything
// timed (stopping the service shortly after the work ends, noticing a stalled
// reply) happens in the service itself.
import { Platform } from 'react-native';
import { splitThinking } from './thinking';

export interface BackgroundNative {
  /**
   * Start the service or update its notification. With `pausedText`, the
   * service watches the reported progress and shows that text when a reply
   * stalls while the app is off screen. False when Android refused.
   */
  start(o: { title: string; text: string; pausedText?: string | null }): boolean;
  /** The service stops itself a few seconds later, unless started again. */
  stop(): void;
  notifyDone(o: { title: string; body: string; subtitle: string | null; sessionId: string }): void;
  /** Tokens generated so far by the current reply. */
  progress?(count: number): void;
  /** Whether a reply stalled in the background since the last call. */
  takeSqueezed?(): boolean;
}

export type WorkKind = 'reply' | 'summary';

const TEXT: Record<WorkKind, string> = {
  reply: 'Generating reply…',
  summary: 'Condensing earlier messages…',
};

/**
 * Shown when a reply all but stops while the app is off screen. The usual
 * cause is Android 17's memory limit for apps that aren't visible (4 GB on a
 * 16 GB phone, foreground service or not): a bigger model is pushed into swap.
 */
export const PAUSED_TEXT = 'Paused: this model needs more memory than Android allows in the background. Open Tomos to continue.';

/**
 * `begin()` turns the service on and returns the matching `end()`. Native
 * failures are logged, never thrown: without the service, generation still
 * works in the foreground.
 */
export function createBackgroundWork(getNative: () => BackgroundNative | null, opts: { now?: () => number } = {}) {
  const now = opts.now ?? Date.now;
  let active = 0;
  let tokens = 0;
  let lastReport = -Infinity;

  const call = (what: string, f: (n: BackgroundNative) => void) => {
    try {
      const n = getNative();
      if (n) f(n);
    } catch (e) {
      console.warn(`[bg] ${what} failed`, e);
    }
  };

  return {
    begin(kind: WorkKind): () => void {
      active++;
      if (kind === 'reply') { tokens = 0; lastReport = -Infinity; }
      call('start', (n) => {
        if (!n.start({ title: 'Tomos', text: TEXT[kind], pausedText: kind === 'reply' ? PAUSED_TEXT : null })) console.warn('[bg] service not started');
      });
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        active--;
        if (active === 0) call('stop', (n) => n.stop());
      };
    },
    /** Call once per streamed token of a reply; reported to the service at most once a second. */
    progress() {
      tokens++;
      const t = now();
      if (t - lastReport < 1000) return;
      lastReport = t;
      call('progress', (n) => n.progress?.(tokens));
    },
    takeSqueezed(): boolean {
      let was = false;
      call('squeezed', (n) => { was = n.takeSqueezed?.() ?? false; });
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

export const backgroundWork = createBackgroundWork(nativeModule);

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
