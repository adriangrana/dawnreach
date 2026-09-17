function normalizeKey(value) {
  return String(value || '').trim().toLowerCase() || 'unknown';
}

function prune(times, windowMs, now) {
  while (times.length && now - times[0] >= windowMs) times.shift();
  return times;
}

function retryAfter(times, windowMs, now) {
  return times.length ? Math.max(1, Math.ceil((windowMs - (now - times[0])) / 1000)) : 1;
}

export class AuthRateLimiter {
  #loginBySource = new Map();
  #loginByAccount = new Map();
  #registerBySource = new Map();

  constructor(policy) {
    this.policy = policy;
  }

  #bucket(map, key, windowMs, now) {
    const normalized = normalizeKey(key);
    const times = prune(map.get(normalized) || [], windowMs, now);
    if (times.length) map.set(normalized, times);
    else map.delete(normalized);
    return { key: normalized, times };
  }

  checkLogin(source, username, now = Date.now()) {
    const windowMs = this.policy.loginWindowSeconds * 1000;
    const sourceTimes = this.#bucket(this.#loginBySource, source, windowMs, now).times;
    const accountTimes = this.#bucket(this.#loginByAccount, username, windowMs, now).times;
    const sourceBlocked = sourceTimes.length >= this.policy.loginMaxFailuresPerSource;
    const accountBlocked = accountTimes.length >= this.policy.loginMaxFailuresPerAccount;
    if (!sourceBlocked && !accountBlocked) return { allowed: true, retryAfterSeconds: 0 };
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        sourceBlocked ? retryAfter(sourceTimes, windowMs, now) : 0,
        accountBlocked ? retryAfter(accountTimes, windowMs, now) : 0,
      ),
    };
  }

  recordLoginFailure(source, username, now = Date.now()) {
    const windowMs = this.policy.loginWindowSeconds * 1000;
    for (const [map, key] of [[this.#loginBySource, source], [this.#loginByAccount, username]]) {
      const bucket = this.#bucket(map, key, windowMs, now);
      bucket.times.push(now);
      map.set(bucket.key, bucket.times);
    }
  }

  recordLoginSuccess(username) {
    this.#loginByAccount.delete(normalizeKey(username));
  }

  consumeRegister(source, now = Date.now()) {
    const windowMs = this.policy.registerWindowSeconds * 1000;
    const bucket = this.#bucket(this.#registerBySource, source, windowMs, now);
    if (bucket.times.length >= this.policy.registerMaxAttemptsPerSource) {
      return { allowed: false, retryAfterSeconds: retryAfter(bucket.times, windowMs, now) };
    }
    bucket.times.push(now);
    this.#registerBySource.set(bucket.key, bucket.times);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
