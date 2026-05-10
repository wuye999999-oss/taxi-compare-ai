// In-memory sandbox session store.
// Sessions are never written to disk or any database.
// Cookies obtained during a sandbox session live only in this Map and are
// evicted automatically when the session expires or is closed.
import { randomUUID } from 'crypto';

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes hard cap

// Map<sessionId, session>
const sessions = new Map();

export function createSession() {
  const id = randomUUID();
  const now = Date.now();
  const session = {
    id,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    platformStatus: {
      jd: 'sandbox_pending',
      pdd: 'sandbox_pending',
    },
    results: {},      // platform -> NormalizedItem[]
    searchKeyword: null,
  };
  sessions.set(id, session);

  // Auto-evict so the Map never leaks indefinitely
  const timer = setTimeout(() => sessions.delete(id), SESSION_TTL_MS);
  if (typeof timer.unref === 'function') timer.unref();

  return session;
}

export function getSession(id) {
  const s = sessions.get(id);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    sessions.delete(id);
    return null;
  }
  return s;
}

export function updateSession(id, patch) {
  const s = getSession(id);
  if (!s) return null;
  // Merge nested fields rather than replace top-level objects wholesale
  if (patch.platformStatus) Object.assign(s.platformStatus, patch.platformStatus);
  if (patch.results) Object.assign(s.results, patch.results);
  if ('searchKeyword' in patch) s.searchKeyword = patch.searchKeyword;
  return s;
}

export function closeSession(id) {
  return sessions.delete(id);
}

export function activeSessionCount() {
  return sessions.size;
}
