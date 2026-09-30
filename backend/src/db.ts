import 'dotenv/config';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
export const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});
export const uuid = randomUUID;
export async function transaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const result = await fn(c);
    await c.query('COMMIT');
    return result;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
export async function audit(
  c: pg.Pool | pg.PoolClient,
  user: string | null,
  action: string,
  entity: string | null,
  before: unknown = null,
  after: unknown = null,
  ip: string | null = null,
) {
  await c.query(
    'INSERT INTO audit_logs(id,user_id,action,entity_id,previous_value,new_value,ip) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [
      uuid(),
      user,
      action,
      entity,
      JSON.stringify(before),
      JSON.stringify(after),
      ip,
    ],
  );
}
