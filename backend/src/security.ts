import {
  scryptSync,
  randomBytes,
  timingSafeEqual,
  createHash,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { db } from './db.js';
export const roles: Record<string, string[]> = {
  'Super Administrator': [
    'read',
    'registry',
    'ingestion',
    'users',
    'export',
    'audit',
    'settings',
    'raw',
  ],
  'ICT Administrator': [
    'read',
    'ingestion',
    'users',
    'audit',
    'settings',
    'raw',
  ],
  'Production Administrator': ['read', 'registry', 'export', 'audit'],
  'Operations Manager': ['read', 'export'],
  'Regional Manager': ['read', 'export'],
  'Plant Operator': ['read'],
  Analyst: ['read', 'export'],
  'Executive Viewer': ['dashboard'],
};
export type Actor = {
  id: string;
  email: string;
  roles: string[];
  permissions: string[];
  region_id: string | null;
  facility_id: string | null;
  csrf: string;
};
declare global {
  namespace Express {
    interface Request {
      actor?: Actor;
    }
  }
}
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export function passwordHash(p: string) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(p, salt, 64).toString('hex');
}
export function verifyPassword(p: string, stored: string) {
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const computed = scryptSync(p, salt, 64);
  const b = Buffer.from(key, 'hex');
  return b.length === computed.length && timingSafeEqual(b, computed);
}
export function encrypt(value: string) {
  const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY || '', 'hex');
  if (key.length !== 32)
    throw new Error('TOKEN_ENCRYPTION_KEY must be 32 random bytes in hex');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([c.update(value, 'utf8'), c.final()]);
  return [
    iv.toString('hex'),
    c.getAuthTag().toString('hex'),
    encrypted.toString('hex'),
  ].join(':');
}
export function decrypt(value: string) {
  const [iv, tag, data] = value.split(':');
  const c = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(process.env.TOKEN_ENCRYPTION_KEY || '', 'hex'),
    Buffer.from(iv, 'hex'),
  );
  c.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([
    c.update(Buffer.from(data, 'hex')),
    c.final(),
  ]).toString('utf8');
}
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const token = req.cookies?.gwl_session;
  if (!token) return res.status(401).json({ error: 'Sign in to continue' });
  const result = await db.query(
    `SELECT u.id,u.email,u.region_id,u.facility_id,s.csrf,array_agg(ur.role) roles FROM sessions s JOIN users u ON u.id=s.user_id JOIN user_roles ur ON ur.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active GROUP BY u.id,s.csrf`,
    [hash(token)],
  );
  if (!result.rowCount)
    return res.status(401).json({ error: 'Session expired' });
  const actor = result.rows[0];
  actor.permissions = [
    ...new Set(actor.roles.flatMap((r: string) => roles[r] || [])),
  ];
  if (
    actor.roles.some((r: string) =>
      ['Regional Manager', 'Plant Operator'].includes(r),
    )
  )
    actor.permissions = actor.permissions.filter((p: string) =>
      ['read', 'export', 'dashboard'].includes(p),
    );
  req.actor = actor;
  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
    (req.get('x-csrf-token') !== actor.csrf ||
      req.get('origin') !== process.env.APP_ORIGIN)
  )
    return res
      .status(403)
      .json({ error: 'Invalid request origin or CSRF token' });
  next();
}
export function allow(permission: string) {
  return (req: Request, res: Response, next: NextFunction) =>
    req.actor?.permissions.includes(permission)
      ? next()
      : res.status(403).json({ error: 'Permission denied' });
}
// Any assigned regional/facility role constrains all row reads, including users with multiple roles.
export function scope(actor: Actor, offset = 1, alias = 'f') {
  const values: string[] = [];
  const conditions: string[] = [];
  if (actor.roles.includes('Regional Manager')) {
    if (!actor.region_id) return { sql: 'FALSE', values };
    values.push(actor.region_id);
    conditions.push(`${alias}.region_id=$${offset++}`);
  }
  if (actor.roles.includes('Plant Operator')) {
    if (!actor.facility_id) return { sql: 'FALSE', values };
    values.push(actor.facility_id);
    conditions.push(`${alias}.id=$${offset++}`);
  }
  return { sql: conditions.join(' AND ') || 'TRUE', values };
}
