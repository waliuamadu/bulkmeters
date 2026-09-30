import { db, transaction, uuid } from './db.js';
import { roles, passwordHash } from './security.js';
const email = process.env.SEED_ADMIN_EMAIL,
  password = process.env.SEED_ADMIN_PASSWORD;
if (!email || !password || password.length < 14)
  throw new Error(
    'Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (minimum 14 characters)',
  );
try {
  await transaction(async (c) => {
    for (const [role, permissions] of Object.entries(roles)) {
      await c.query(
        'INSERT INTO roles(name) VALUES($1) ON CONFLICT DO NOTHING',
        [role],
      );
      for (const p of permissions) {
        await c.query(
          'INSERT INTO permissions(name) VALUES($1) ON CONFLICT DO NOTHING',
          [p],
        );
        await c.query(
          'INSERT INTO role_permissions VALUES($1,$2) ON CONFLICT DO NOTHING',
          [role, p],
        );
      }
    }
    const user = await c.query(
      'INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING RETURNING id',
      [uuid(), email.toLowerCase(), passwordHash(password)],
    );
    if (user.rowCount)
      await c.query('INSERT INTO user_roles VALUES($1,$2)', [
        user.rows[0].id,
        'Super Administrator',
      ]);
    console.log(
      'Role seed complete. Existing administrator credentials unchanged. No telemetry seeded.',
    );
  });
} finally {
  await db.end();
}
