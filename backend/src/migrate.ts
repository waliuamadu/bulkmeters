import { readFile, readdir } from 'node:fs/promises';
import { db, transaction } from './db.js';
const root = new URL('../../database/migrations/', import.meta.url);
try {
  for (const file of (await readdir(root))
    .filter((x) => x.endsWith('.sql'))
    .sort()) {
    await transaction(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(829304)');
      const exists = await c.query(
        "SELECT to_regclass('public.schema_migrations') AS name",
      );
      if (
        exists.rows[0].name &&
        (await c.query('SELECT 1 FROM schema_migrations WHERE name=$1', [file]))
          .rowCount
      )
        return;
      await c.query(await readFile(new URL(file, root), 'utf8'));
      await c.query('INSERT INTO schema_migrations(name) VALUES($1)', [file]);
      console.log('Applied', file);
    });
  }
} finally {
  await db.end();
}
