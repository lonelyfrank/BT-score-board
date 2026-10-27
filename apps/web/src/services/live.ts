import { useEffect, useRef, useState } from 'react';
import { decode } from '../../../worker/src/codec.js';
import type { LiveState } from '../../../worker/src/live.js';

/**
 * - connecting: the first state has not arrived yet.
 * - live: the channel is open and the state is current.
 * - stale: the channel dropped; the last state is shown frozen while the app reconnects.
 * - denied: the session ended or the access was revoked.
 */
export type LiveStatus = 'connecting' | 'live' | 'stale' | 'denied';
export interface LiveView {
  state: LiveState | null;
  status: LiveStatus;
  /** When the state shown was received (not when the match changed). */
  receivedAt: number | null;
}

/** Applies an update only when it is newer: duplicates and out-of-order messages are dropped. */
export function applyState(current: LiveState | null, next: LiveState): LiveState | null {
  return !current || next.version > current.version ? next : null;
}
const backoff = (attempt: number) => Math.min(15_000, 1000 * 2 ** Math.min(attempt, 4));

/**
 * Follows one match over the live channel and reconnects with a growing delay. While the
 * channel is down it keeps a single slow poll as a fallback, so the screen does not stay frozen
 * for good; it never shows an unconfirmed command as saved (the follower sends none).
 */
export function useLiveMatch(
  tournamentId: string,
  fallback: () => Promise<LiveState | null>,
): LiveView {
  const [view, setView] = useState<LiveView>({
    state: null,
    status: 'connecting',
    receivedAt: null,
  });
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  useEffect(() => {
    let socket: WebSocket | null = null;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;
    let stopped = false;
    const take = (next: LiveState) =>
      setView((v) => {
        const state = applyState(v.state, next);
        return state ? { ...v, state, receivedAt: Date.now() } : v;
      });
    const stopPoll = () => {
      if (poll) clearInterval(poll);
      poll = undefined;
    };
    const startPoll = () => {
      if (poll) return;
      poll = setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        void fallbackRef.current().then(
          (s) => s && take(s),
          () => undefined,
        );
      }, 5000);
    };
    const open = () => {
      if (stopped) return;
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${scheme}://${location.host}/api/live/${tournamentId}`);
      socket.onopen = () => {
        attempt = 0;
        stopPoll();
        setView((v) => ({ ...v, status: 'live' }));
        ping = setInterval(() => socket?.readyState === 1 && socket.send('ping'), 25_000);
      };
      socket.onmessage = (event) => {
        // The runtime answers 'ping' itself, without waking the object.
        if (event.data === 'pong') return;
        const message = decode(String(event.data)) as LiveState | { type: string };
        if (message.type === 'state') take(message as LiveState);
        if (message.type === 'revoked') setView((v) => ({ ...v, status: 'denied' }));
      };
      socket.onclose = (event) => {
        if (ping) clearInterval(ping);
        if (stopped) return;
        if (event.code === 4401 || event.code === 4403) {
          setView((v) => ({ ...v, status: 'denied' }));
          return;
        }
        setView((v) => ({ ...v, status: v.state ? 'stale' : 'connecting' }));
        startPoll();
        retry = setTimeout(open, backoff(attempt++));
      };
      socket.onerror = () => socket?.close();
    };
    const reconnectNow = () => {
      if (stopped || socket?.readyState === 0 || socket?.readyState === 1) return;
      clearTimeout(retry);
      open();
    };
    window.addEventListener('online', reconnectNow);
    document.addEventListener('visibilitychange', reconnectNow);
    open();
    return () => {
      stopped = true;
      window.removeEventListener('online', reconnectNow);
      document.removeEventListener('visibilitychange', reconnectNow);
      clearTimeout(retry);
      stopPoll();
      if (ping) clearInterval(ping);
      socket?.close();
    };
  }, [tournamentId]);
  return view;
}
