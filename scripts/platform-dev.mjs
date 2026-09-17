import { spawn } from 'node:child_process';

function spawnNode(args) {
  return spawn(process.execPath, args, {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
  });
}

function spawnNpm(args) {
  // When this script is launched through `npm run`, npm exposes the absolute
  // path to its JS CLI in npm_execpath. Running that CLI through the current
  // Node executable avoids spawning npm.cmd directly, which can fail with
  // EINVAL on Windows/Node 22 (notably from Git Bash).
  const npmExecPath = process.env.npm_execpath;
  if (!npmExecPath) {
    throw new Error('npm_execpath is missing. Launch this script with `npm run platform:dev`.');
  }
  return spawnNode([npmExecPath, ...args]);
}

const children = [
  spawnNode(['--watch', 'server/index.mjs']),
  spawnNpm(['run', 'dev']),
];

let closing = false;
function shutdown(signal = 'SIGTERM') {
  if (closing) return;
  closing = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

for (const child of children) {
  child.on('error', error => {
    console.error('[platform:dev] child process failed to start:', error);
    if (!closing) {
      shutdown();
      process.exitCode = 1;
    }
  });
  child.on('exit', code => {
    if (!closing && code !== 0) {
      shutdown();
      process.exitCode = code ?? 1;
    }
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
