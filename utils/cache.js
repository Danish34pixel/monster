// Simple in-memory cache with TTL support. This removes the Redis
// dependency and provides the same async API used across the project.
const store = new Map();

function setItem(key, value, ttlSeconds) {
  const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
  store.set(key, { value, expiresAt });
  if (ttlSeconds) {
    setTimeout(() => {
      const item = store.get(key);
      if (!item) return;
      if (item.expiresAt && Date.now() >= item.expiresAt) store.delete(key);
    }, Math.min(1000 * 60 * 60, ttlSeconds * 1000));
  }
}

function getItem(key) {
  const item = store.get(key);
  if (!item) return null;
  if (item.expiresAt && Date.now() >= item.expiresAt) {
    store.delete(key);
    return null;
  }
  return item.value;
}

module.exports = {
  async getJson(key) {
    try {
      const val = getItem(key);
      return val === undefined ? null : val;
    } catch (e) {
      return null;
    }
  },

  async setJson(key, obj, ttlSeconds) {
    try {
      setItem(key, obj, ttlSeconds);
      return true;
    } catch (e) {
      return false;
    }
  },

  async del(key) {
    try {
      store.delete(key);
      return true;
    } catch (e) {
      return false;
    }
  },
};
