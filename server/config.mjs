import path from 'node:path';

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadPlatformConfig(root = process.cwd(), env = process.env) {
  return {
    host: String(env.DAWNREACH_PLATFORM_HOST || '127.0.0.1'),
    port: positiveInt(env.DAWNREACH_PLATFORM_PORT, 8790),
    dataDir: path.resolve(root, String(env.DAWNREACH_PLATFORM_DATA_DIR || 'data/platform')),
    queueSize: positiveInt(env.DAWNREACH_QUEUE_SIZE, 10),
    readyTimeoutSeconds: positiveInt(env.DAWNREACH_READY_TIMEOUT_SECONDS, 30),
    auth: {
      minPasswordLength: positiveInt(env.DAWNREACH_AUTH_MIN_PASSWORD_LENGTH, 10),
      sessionAbsoluteTtlHours: positiveInt(env.DAWNREACH_AUTH_SESSION_ABSOLUTE_TTL_HOURS, 24 * 14),
      sessionIdleTtlHours: positiveInt(env.DAWNREACH_AUTH_SESSION_IDLE_TTL_HOURS, 24),
      maxSessionsPerUser: positiveInt(env.DAWNREACH_AUTH_MAX_SESSIONS_PER_USER, 5),
      loginWindowSeconds: positiveInt(env.DAWNREACH_AUTH_LOGIN_WINDOW_SECONDS, 15 * 60),
      loginMaxFailuresPerSource: positiveInt(env.DAWNREACH_AUTH_LOGIN_MAX_FAILURES_SOURCE, 20),
      loginMaxFailuresPerAccount: positiveInt(env.DAWNREACH_AUTH_LOGIN_MAX_FAILURES_ACCOUNT, 8),
      registerWindowSeconds: positiveInt(env.DAWNREACH_AUTH_REGISTER_WINDOW_SECONDS, 60 * 60),
      registerMaxAttemptsPerSource: positiveInt(env.DAWNREACH_AUTH_REGISTER_MAX_ATTEMPTS_SOURCE, 8),
    },
  };
}
