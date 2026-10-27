import { NextRequest, NextResponse } from 'next/server';
import { Client } from 'pg';
import { authConfigured, getAuth } from '@/lib/auth';
import { db } from '@superapp/database';
import { sandboxEnabled } from '@/lib/sandbox-dispatch';
import { sandboxOperationsSnapshot } from '@/lib/sandbox-ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Authenticated, bounded Server-Sent Events over PostgreSQL LISTEN/NOTIFY.
 * Initial/reconnection packets are complete snapshots; NO incremental event
 * replay is promised. Notifications carry only a generic "changed" signal.
 */
export async function GET(req: NextRequest) {
  if (!sandboxEnabled() || !authConfigured()) {
    return NextResponse.json({ error: 'Laboratório desabilitado.' }, { status: 503 });
  }
  try {
    const session = await getAuth().api.getSession({ headers: req.headers });
    if (!session) return NextResponse.json({ error: 'Login necessário.' }, { status: 401 });
    const profile = await db().user.findUnique({
      where: { id: session.user.id }, select: { role: true },
    });
    if (profile?.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Acesso reservado ao administrador.' }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: 'Falha ao validar acesso.' }, { status: 503 });
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 3000,
    application_name: 'superapp-sandbox-sse',
  });
  try {
    await client.connect();
    await client.query('LISTEN superapp_sandbox_changed');
  } catch {
    await client.end().catch(() => undefined);
    return NextResponse.json({ error: 'Stream indisponível neste ambiente.' }, { status: 503 });
  }

  const encoder = new TextEncoder();
  let open = true;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let lifetime: ReturnType<typeof setTimeout> | undefined;
  let coalescer: ReturnType<typeof setTimeout> | undefined;
  let reading = false;
  let queued = false;

  function write(frame: string) {
    if (!open || !controllerRef) return;
    try { controllerRef.enqueue(encoder.encode(frame)); }
    catch { close(); }
  }
  function close() {
    if (!open) return;
    open = false;
    if (heartbeat) clearInterval(heartbeat);
    if (lifetime) clearTimeout(lifetime);
    if (coalescer) clearTimeout(coalescer);
    client.removeListener('notification', notify);
    client.removeListener('error', failure);
    req.signal.removeEventListener('abort', close);
    void client.end().catch(() => undefined);
    try { controllerRef?.close(); } catch { /* already disconnected */ }
  }

  async function sendSnapshot() {
    if (!open) return;
    if (reading) { queued = true; return; }
    reading = true;
    try {
      const snapshot = await sandboxOperationsSnapshot();
      if (open) {
        write(`event: snapshot\nid: ${Date.now()}\ndata: ${JSON.stringify(snapshot)}\n\n`);
      }
    } catch {
      failure();
    } finally {
      reading = false;
      if (open && queued) {
        queued = false;
        notify();
      }
    }
  }
  function notify() {
    if (!open || coalescer) return;
    coalescer = setTimeout(() => {
      coalescer = undefined;
      void sendSnapshot();
    }, 150);
  }
  function failure() {
    if (!open) return;
    write('event: unavailable\ndata: {}\n\n');
    close();
  }

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      client.on('notification', notify);
      client.on('error', failure);
      req.signal.addEventListener('abort', close, { once: true });
      // A bounded connection allows revocation to take effect on reconnection
      // and prevents holding a PostgreSQL connection indefinitely.
      lifetime = setTimeout(close, 45_000);
      heartbeat = setInterval(() => write(': heartbeat\n\n'), 12_000);
      write('retry: 3000\n\n');
      void sendSnapshot();
    },
    cancel: close,
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'private, no-store, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
