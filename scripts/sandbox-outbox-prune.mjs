import pg from 'pg';

/**
 * Explicit CLI maintenance for the private sandbox outbox only.
 * Default is dry-run; --apply is required to delete already-PUBLISHED rows.
 * Never deletes PENDING or DEAD records, and touches at most 500 per call.
 */
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
const apply = process.argv.includes('--apply');
const daysArg = process.argv.find(arg => arg.startsWith('--days='));
const days = daysArg ? Number(daysArg.slice('--days='.length)) : 7;
if (!Number.isSafeInteger(days) || days < 1 || days > 365) {
  throw new Error('--days must be an integer from 1 to 365');
}
const connection = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await connection.connect();
  const check = await connection.query(`
    SELECT COUNT(*)::int AS "eligible"
    FROM "SandboxEventOutbox"
    WHERE "status" = 'PUBLISHED'
      AND "publishedAt" < NOW() - $1::int * INTERVAL '1 day'
  `, [days]);
  const eligible = check.rows[0].eligible;
  if (!apply) {
    console.log(JSON.stringify({ mode: 'dry-run', days, eligible, deleted: 0 }));
  } else {
    const removed = await connection.query(`
      WITH candidates AS (
        SELECT "id" FROM "SandboxEventOutbox"
        WHERE "status" = 'PUBLISHED'
          AND "publishedAt" < NOW() - $1::int * INTERVAL '1 day'
        ORDER BY "publishedAt", "id"
        LIMIT 500
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM "SandboxEventOutbox"
      WHERE "id" IN (SELECT "id" FROM candidates)
      RETURNING "id"
    `, [days]);
    console.log(JSON.stringify({
      mode: 'apply', days, eligible, deleted: removed.rowCount, maxBatch: 500,
    }));
  }
} finally {
  await connection.end();
}
