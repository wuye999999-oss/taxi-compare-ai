// Sandbox price-compare client module.
//
// Manages one-shot sandbox sessions: creates a session, submits a search,
// polls for results, and closes the session when done or timed out.
//
// Security boundaries enforced here:
//   - We never collect or store user credentials
//   - Sessions are closed automatically after POLL_TIMEOUT_MS
//   - Results are passed through as-is (source='sandbox' already set by server)

export const SANDBOX_API = 'http://localhost:3001';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 60_000; // stop polling after 60 s regardless

// Human-readable labels for each status value
export const STATUS_LABELS = {
  api_ok:                 'API 可用',
  sandbox_pending:        '沙盒待搜索',
  sandbox_searching:      '沙盒搜索中',
  sandbox_success:        '沙盒读取成功',
  sandbox_manual_verify:  '需要用户手动验证',
  sandbox_failed_fallback:'失败，回退 API',
  unsupported:            '未接入',
};

export class SandboxSession {
  constructor(apiBase = SANDBOX_API) {
    this._api = apiBase;
    this.sessionId = null;
    this.expiresAt = null;
    this.platformStatus = {};
    this.results = [];
    this._pollTimer = null;
    this._startedAt = null;
    this._listeners = {};
  }

  // Register event handlers: 'created', 'status', 'done', 'error'
  on(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
    return this;
  }

  _emit(event, data) {
    (this._listeners[event] || []).forEach(fn => fn(data));
  }

  async create() {
    const resp = await fetch(`${this._api}/api/sandbox/session`, { method: 'POST' });
    if (!resp.ok) throw new Error(`Sandbox server error: ${resp.status}`);
    const data = await resp.json();
    this.sessionId = data.sessionId;
    this.expiresAt = data.expiresAt;
    this.platformStatus = Object.fromEntries(
      Object.entries(data.platforms).map(([k, v]) => [k, v.status])
    );
    this._emit('created', data);
    return data;
  }

  async search(keyword, platforms = ['jd', 'pdd']) {
    if (!this.sessionId) throw new Error('Call create() first');
    const resp = await fetch(`${this._api}/api/sandbox/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: this.sessionId, keyword, platforms }),
    });
    if (!resp.ok) throw new Error(`Search submit failed: ${resp.status}`);
    this._startedAt = Date.now();
    this._startPolling();
    return resp.json();
  }

  _startPolling() {
    this._stopPolling();
    this._pollTimer = setInterval(() => this._poll(), POLL_INTERVAL_MS);
  }

  async _poll() {
    if (!this.sessionId) return this._stopPolling();
    if (Date.now() - this._startedAt > POLL_TIMEOUT_MS) {
      this._stopPolling();
      this._emit('done', { results: this.results, platformStatus: this.platformStatus });
      return;
    }

    try {
      const resp = await fetch(`${this._api}/api/sandbox/status/${this.sessionId}`);
      if (!resp.ok) { this._stopPolling(); return; }

      const data = await resp.json();
      this.platformStatus = data.platformStatus || {};
      this.results = data.results || [];
      this._emit('status', data);

      // Stop when no platform is still actively searching
      const stillBusy = Object.values(this.platformStatus)
        .some(s => s === 'sandbox_searching' || s === 'sandbox_pending');
      if (!stillBusy) {
        this._stopPolling();
        this._emit('done', { results: this.results, platformStatus: this.platformStatus });
      }
    } catch (_err) {
      this._stopPolling();
    }
  }

  _stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  async close() {
    this._stopPolling();
    if (!this.sessionId) return;
    try {
      await fetch(`${this._api}/api/sandbox/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.sessionId }),
      });
    } catch (_) { /* best-effort */ }
    this.sessionId = null;
    this.results = [];
    this.platformStatus = {};
  }
}
