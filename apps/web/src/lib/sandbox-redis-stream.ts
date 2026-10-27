import type { NextRequest } from 'next/server';
import { sandboxOperationsSnapshot } from '@/lib/sandbox-ops';
import {
  REDIS_SANDBOX_CHANNEL, acquireRedisStream, makeRedisClient, releaseRedisStream,
} from '@/lib/sandbox-redis-transport';

/**
 * Optional Redis Pub/Sub SSE transport. This path holds no dedicated PostgreSQL
 * LISTEN connection per browser. An external bridge forwards PG commit signals.
 * Full snapshots on connect prevent silent state drift across disconnections.
 */
export async function openRedisSandboxStream(req: NextRequest, adminId: string): Promise<Response> {
  if (!process.env.REDIS_URL) {
    return Response.json({ error: 'Redis não configurado.' }, { status: 503 });
  }

  const command = makeRedisClient();
  const subscriber = makeRedisClient();
  let lease: Awaited<ReturnType<typeof acquireRedisStream>> | undefined;
  try {
    await command.connect();
    lease = await acquireRedisStream(command, adminId);
    if (lease.outcome !== 'accepted') {
      command.destroy();
      return Response.json({
        code: lease.outcome,
        error: lease.outcome === 'user_busy' ? 'Transmissão já ativa para este administrador.'
          : 'Limite de transmissões Redis atingido.',
      }, { status: 429, headers: { 'Retry-After': '30', 'Cache-Control': 'private, no-store' } });
    }
    await subscriber.connect();
  } catch {
    if (lease?.outcome === 'accepted') {
      await releaseRedisStream(command, lease.lease).catch(() => undefined);
    }
    subscriber.destroy();
    command.destroy();
    return Response.json({ error: 'Transmissão Redis indisponível.' }, { status: 503 });
  }

  const granted = lease.lease;
  const encoder = new TextEncoder();
  let active = true;
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let sending = false;
  let queued = false;

  function write(frame: string) {
    if (!active || !streamController) return;
    try { streamController.enqueue(encoder.encode(frame)); }
    catch { close(); }
  }
  function close() {
    if (!active) return;
    active = false;
    if (heartbeat) clearInterval(heartbeat);
    if (deadline) clearTimeout(deadline);
    if (debounce) clearTimeout(debounce);
    req.signal.removeEventListener('abort', close);
    subscriber.destroy();
    // Token-checked release cannot delete a replacement holder's lease.
    void releaseRedisStream(command, granted).catch(() => undefined)
      .finally(() => command.destroy());
    try { streamController?.close(); } catch { /* already disconnected */ }
  }

  async function sendSnapshot() {
    if (!active) return;
    if (sending) { queued = true; return; }
    sending = true;
    try {
      const snapshot = await sandboxOperationsSnapshot();
      write(`event: snapshot\nid: ${Date.now()}\ndata: ${JSON.stringify(snapshot)}\n\n`);
    } catch {
      write('event: unavailable\ndata: {}\n\n');
      close();
    } finally {
      sending = false;
      if (queued && active) { queued = false; schedule(); }
    }
  }
  function schedule() {
    if (!active || debounce) return;
    debounce = setTimeout(() => {
      debounce = undefined;
      void sendSnapshot();
    }, 150);
  }

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      req.signal.addEventListener('abort', close, { once: true });
      subscriber.on('error', fail);
      subscriber.on('end', fail);
      function fail() {
        write('event: unavailable\ndata: {}\n\n');
        close();
      }
      // Register before sending initial snapshot: Redis may notify during read.
      void subscriber.subscribe(REDIS_SANDBOX_CHANNEL, () => schedule())
        .then(() => {
          if (!active) return;
          write('retry: 3000\n\n');
          void sendSnapshot();
        })
        .catch(fail);
      heartbeat = setInterval(() => write(': heartbeat\n\n'), 12_000);
      deadline = setTimeout(close, 45_000);
    },
    cancel: close,
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'private, no-store, no-transform',
      'Connection': 'keep-alive', 'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
