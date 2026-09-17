import fs from 'node:fs';
import path from 'node:path';

/**
 * Persists small platform state atomically. Windows can transiently reject a rename over an
 * existing file, so mirror TCL's proven copy fallback instead of losing auth/account state.
 */
export function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  try {
    fs.renameSync(temp, file);
  } catch (error) {
    const code = error?.code;
    if (!['EPERM', 'EEXIST', 'EBUSY'].includes(String(code || ''))) throw error;
    fs.copyFileSync(temp, file);
    try { fs.chmodSync(file, 0o600); } catch { /* Windows ACLs own the effective permissions. */ }
    fs.rmSync(temp, { force: true });
  }
}
