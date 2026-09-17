import { createPlatformServer } from './platform-server.mjs';

try { process.umask(0o077); } catch { /* unsupported platform */ }

const platform = createPlatformServer();
const address = await platform.start();
console.log(`[platform] Dawnreach server listening on http://${address.host}:${address.port}`);

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await platform.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
