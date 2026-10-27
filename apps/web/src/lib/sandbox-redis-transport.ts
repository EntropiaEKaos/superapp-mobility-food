import { createHash, randomUUID } from 'node:crypto';
import { createClient } from 'redis';

/** Redis mode is experimental and explicitly opt-in. No payment/real dispatch. */
export const REDIS_SANDBOX_CHANNEL = 'superapp:sandbox:changed:v1';
export const REDIS_STREAM_CAPACITY = 16;
const LEASE_MS = 60_000; // stream lifetime is max 45 seconds
const PREFIX = 'superapp:sandbox:stream:v1:';
const slotKey = (slot: number) => `${PREFIX}slot:${slot}`;
const adminKey = (id: string) =>
  `${PREFIX}admin:${createHash('sha256').update(id).digest('hex')}`;

export function redisStreamConfigured(): boolean {
  return process.env.SANDBOX_EVENT_TRANSPORT === 'redis' && Boolean(process.env.REDIS_URL);
}

export function makeRedisClient() {
  if (!process.env.REDIS_URL) throw new Error('REDIS_URL is required');
  const client = createClient({
    url: process.env.REDIS_URL,
    socket: { connectTimeout: 2500, reconnectStrategy: false },
  });
  // An explicit error listener avoids unhandled error crashes on lost Redis.
  client.on('error', () => undefined);
  return client;
}

const ADMIT = `
if redis.call('EXISTS', KEYS[1]) == 1 then return -1 end
local prefix = ARGV[1]
local token = ARGV[2]
local ttl = tonumber(ARGV[3])
local cap = tonumber(ARGV[4])
for i = 0, cap - 1 do
  local slot = prefix .. i
  if redis.call('EXISTS', slot) == 0 then
    redis.call('PSETEX', KEYS[1], ttl, token)
    redis.call('PSETEX', slot, ttl, token)
    return i
  end
end
return -2
`;

const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]) end
if redis.call('GET', KEYS[2]) == ARGV[1] then redis.call('DEL', KEYS[2]) end
return 1
`;

export type RedisLease = { token: string; slot: number; userKey: string };
export type RedisAdmission =
  | { outcome: 'accepted'; lease: RedisLease }
  | { outcome: 'user_busy' | 'capacity_reached' };

export async function acquireRedisStream(
  client: ReturnType<typeof makeRedisClient>, userId: string,
): Promise<RedisAdmission> {
  const token = randomUUID();
  const userKey = adminKey(userId);
  const result = Number(await client.eval(ADMIT, {
    keys: [userKey],
    arguments: [`${PREFIX}slot:`, token, String(LEASE_MS), String(REDIS_STREAM_CAPACITY)],
  }));
  if (result === -1) return { outcome: 'user_busy' };
  if (result === -2) return { outcome: 'capacity_reached' };
  if (!Number.isInteger(result) || result < 0 || result >= REDIS_STREAM_CAPACITY) {
    throw new Error('Invalid Redis lease result');
  }
  return { outcome: 'accepted', lease: { token, slot: result, userKey } };
}

export async function releaseRedisStream(
  client: ReturnType<typeof makeRedisClient>, lease: RedisLease,
) {
  if (!client.isOpen) return;
  await client.eval(RELEASE, {
    keys: [lease.userKey, slotKey(lease.slot)],
    arguments: [lease.token],
  });
}

export async function getRedisSandboxStreamHealth() {
  const client = makeRedisClient();
  try {
    await client.connect();
    const keys = Array.from({ length: REDIS_STREAM_CAPACITY }, (_, i) => slotKey(i));
    const occupied = (await client.mGet(keys)).filter(value => value !== null).length;
    return {
      activeConnections: occupied, capacity: REDIS_STREAM_CAPACITY,
      availableSlots: REDIS_STREAM_CAPACITY - occupied,
      utilizationPercent: Math.round(occupied / REDIS_STREAM_CAPACITY * 100),
      transport: 'redis' as const,
    };
  } finally {
    client.destroy();
  }
}
