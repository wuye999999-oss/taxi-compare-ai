// Strips sensitive fields before writing to stdout so cookies and credentials
// never appear in logs, even accidentally.
const SENSITIVE_SUBSTRINGS = ['cookie', 'password', 'token', 'authorization', 'set-cookie', 'secret'];

function sanitize(obj, depth = 0) {
  if (depth > 6 || typeof obj !== 'object' || obj === null) return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    const lower = k.toLowerCase();
    if (SENSITIVE_SUBSTRINGS.some(s => lower.includes(s))) {
      out[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      out[k] = sanitize(v, depth + 1);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function log(level, msg, data) {
  const entry = { level, time: new Date().toISOString(), msg };
  if (data !== undefined) entry.data = sanitize(data);
  process.stdout.write(JSON.stringify(entry) + '\n');
}
