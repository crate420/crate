const cache = new Map();

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      if (value[key] !== undefined) result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function cacheKey(namespace, parts = {}) {
  return `${namespace}:${JSON.stringify(stableValue(parts))}`;
}

function shouldForceRefresh(options = {}) {
  return options.forceRefresh === true || options.force_refresh === true || options.forceRefresh === "true" || options.force_refresh === "true";
}

function getOrSet(namespace, parts, ttlSeconds, producer, options = {}) {
  const key = cacheKey(namespace, parts);
  const now = Date.now();
  const cached = cache.get(key);
  if (!shouldForceRefresh(options) && cached && cached.expiresAt > now) {
    return { ...cached.value, cached: true, cache_expires_at: new Date(cached.expiresAt).toISOString() };
  }

  const value = producer();
  const expiresAt = now + Math.max(Number(ttlSeconds || 0), 0) * 1000;
  cache.set(key, { value, expiresAt });
  return { ...value, cached: false, cache_expires_at: new Date(expiresAt).toISOString() };
}

async function getOrSetAsync(namespace, parts, ttlSeconds, producer, options = {}) {
  const key = cacheKey(namespace, parts);
  const now = Date.now();
  const cached = cache.get(key);
  if (!shouldForceRefresh(options) && cached && cached.expiresAt > now) {
    return { ...cached.value, cached: true, cache_expires_at: new Date(cached.expiresAt).toISOString() };
  }

  const value = await producer();
  const expiresAt = now + Math.max(Number(ttlSeconds || 0), 0) * 1000;
  cache.set(key, { value, expiresAt });
  return { ...value, cached: false, cache_expires_at: new Date(expiresAt).toISOString() };
}

function invalidate(prefix) {
  const normalized = String(prefix || "");
  for (const key of cache.keys()) {
    if (!normalized || key.startsWith(normalized)) cache.delete(key);
  }
}

module.exports = {
  getOrSet,
  getOrSetAsync,
  invalidate,
  shouldForceRefresh,
};
