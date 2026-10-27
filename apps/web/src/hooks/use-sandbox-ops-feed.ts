'use client';

import { useEffect, useState, type MutableRefObject } from 'react';

export type OpsLiveMode = 'connecting' | 'stream' | 'polling' | 'hidden' | 'error';

/**
 * SSE-first read model with GET polling fallback.
 * One connection per visible admin tab; no writes, GPS or business dispatch.
 */
export function useSandboxOpsFeed<T>({
  enabled, busy, busyRef, onSnapshot,
}: {
  enabled: boolean;
  busy: boolean;
  busyRef: MutableRefObject<boolean>;
  onSnapshot: (value: T) => void;
}): { mode: OpsLiveMode } {
  const [mode, setMode] = useState<OpsLiveMode>('connecting');

  useEffect(() => {
    if (!enabled || busy) return;
    let closed = false;
    let stream: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retryStreamTimer: ReturnType<typeof setTimeout> | undefined;
    let pending: AbortController | undefined;
    let errors = 0;
    let pollErrors = 0;

    const stopTimer = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
    };
    const stopPoll = () => {
      stopTimer();
      pending?.abort();
      pending = undefined;
    };
    const stopStream = () => {
      stream?.close();
      stream = null;
    };

    function retryPolling(delay: number) {
      stopTimer();
      timer = setTimeout(() => { void poll(); }, delay);
    }
    async function poll() {
      if (closed || document.visibilityState !== 'visible' || busyRef.current) return;
      const controller = new AbortController();
      pending = controller;
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch('/api/admin/sandbox-rides', {
          cache: 'no-store', signal: controller.signal,
        });
        if (!response.ok) throw new Error('GET unavailable');
        const data = await response.json() as T;
        if (closed || busyRef.current || document.visibilityState !== 'visible') return;
        onSnapshot(data);
        pollErrors = 0;
        setMode('polling');
        retryPolling(6000);
      } catch {
        if (closed || document.visibilityState !== 'visible') return;
        pollErrors += 1;
        setMode('error');
        retryPolling(Math.min(30_000, 6000 * 2 ** Math.min(2, pollErrors)));
      } finally {
        clearTimeout(timeout);
        if (pending === controller) pending = undefined;
      }
    }

    function useFallback() {
      stopStream();
      setMode('polling');
      retryPolling(0);
      if (retryStreamTimer) clearTimeout(retryStreamTimer);
      // Retry SSE periodically so a temporary database-listener outage
      // does not permanently lock the dashboard into polling.
      retryStreamTimer = setTimeout(() => {
        if (closed || document.visibilityState !== 'visible') return;
        stopPoll();
        startStream();
      }, 60_000);
    }

    function startStream() {
      if (closed || document.visibilityState !== 'visible') return;
      stopStream();
      stopPoll();
      errors = 0;
      setMode('connecting');
      const current = new EventSource('/api/admin/sandbox-rides/stream');
      stream = current;
      current.addEventListener('snapshot', (event) => {
        if (closed || busyRef.current || document.visibilityState !== 'visible') return;
        try {
          const value = JSON.parse((event as MessageEvent<string>).data) as T;
          onSnapshot(value);
          errors = 0;
          setMode('stream');
        } catch {
          // A bad packet must never replace the last valid dashboard snapshot.
          setMode('error');
        }
      });
      current.addEventListener('unavailable', () => useFallback());
      current.onerror = () => {
        if (closed || stream !== current) return;
        errors += 1;
        if (errors >= 2) useFallback();
        else setMode('connecting'); // EventSource reconnects by itself.
      };
    }

    function onVisibility() {
      if (document.visibilityState !== 'visible') {
        stopStream();
        stopPoll();
        if (retryStreamTimer) clearTimeout(retryStreamTimer);
        setMode('hidden');
      } else {
        if (retryStreamTimer) clearTimeout(retryStreamTimer);
        startStream();
      }
    }
    document.addEventListener('visibilitychange', onVisibility);
    // Defer initial state changes to a callback, never synchronously in the effect.
    timer = setTimeout(onVisibility, 0);

    return () => {
      closed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      stopStream();
      stopPoll();
      if (retryStreamTimer) clearTimeout(retryStreamTimer);
    };
  }, [enabled, busy, busyRef, onSnapshot]);

  return { mode };
}
