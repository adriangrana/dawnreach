import crypto from 'node:crypto';

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/** Bearer tokens are returned once; Dawnreach only persists this digest. */
export function hashBearerToken(token) {
  return sha256(String(token || ''));
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, encoded) {
  const [salt, expected] = String(encoded || '').split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(String(password), salt, 64);
  const target = Buffer.from(expected, 'hex');
  return target.length === actual.length && crypto.timingSafeEqual(target, actual);
}
