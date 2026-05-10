// Sandbox price-compare API routes.
//
// Security invariants enforced here:
//   - Sessions expire in 30 min (enforced by session-store TTL)
//   - No cookie or credential is written to disk or logged
//   - We never bypass CAPTCHA — when PDD/JD blocks us we surface
//     'sandbox_manual_verify' so the user knows exactly what happened
//   - TB and Douyin are marked 'unsupported'; we never fake results for them
import { Router } from 'express';
import { createSession, getSession, closeSession, updateSession } from '../services/session-store.js';
import { searchJD } from '../scrapers/jd.js';
import { searchPDD } from '../scrapers/pdd.js';
import { log } from '../utils/sanitize-log.js';

const router = Router();

// ── POST /api/sandbox/session ──────────────────────────────────────────────
// Creates a fresh one-shot sandbox session. Returns the session ID and TTL.
router.post('/session', (_req, res) => {
  const session = createSession();
  log('info', 'sandbox.session.created', { id: session.id, expiresAt: session.expiresAt });

  res.json({
    sessionId: session.id,
    expiresAt: session.expiresAt,
    ttlSeconds: 1800,
    platforms: {
      jd:     { status: 'sandbox_pending', label: '京东' },
      pdd:    { status: 'sandbox_pending', label: '拼多多' },
      tb:     { status: 'unsupported',    label: '淘宝' },
      douyin: { status: 'unsupported',    label: '抖音' },
    },
  });
});

// ── POST /api/sandbox/search ──────────────────────────────────────────────
// Kicks off async scraping for the given keyword across requested platforms.
// Responds immediately with 202; poll /status for results.
router.post('/search', async (req, res) => {
  const { sessionId, keyword, platforms = ['jd', 'pdd'] } = req.body || {};

  if (!sessionId || !keyword) {
    return res.status(400).json({ error: 'sessionId and keyword are required' });
  }

  const session = getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }

  // Supported sandbox platforms only — never attempt TB/Douyin
  const supported = platforms.filter(p => ['jd', 'pdd'].includes(p));

  updateSession(sessionId, { searchKeyword: keyword });

  // Mark all requested platforms as 'searching' synchronously before we respond
  const initialStatus = {};
  for (const p of supported) initialStatus[p] = 'sandbox_searching';
  updateSession(sessionId, { platformStatus: initialStatus });

  // Fire-and-forget — client polls /status
  (async () => {
    const statusPatch = {};
    const resultsPatch = {};

    await Promise.allSettled(
      supported.map(async platform => {
        try {
          let items;
          if (platform === 'jd')  items = await searchJD(keyword);
          if (platform === 'pdd') items = await searchPDD(keyword);

          if (items && items.length > 0) {
            resultsPatch[platform] = items;
            statusPatch[platform] = 'sandbox_success';
          } else {
            statusPatch[platform] = 'sandbox_failed_fallback';
          }
        } catch (err) {
          log('warn', `sandbox.${platform}.scrape_error`, { keyword, error: err.message });
          // 401/403/CAPTCHA → tell user they need to log in manually
          const code = err?.response?.status;
          statusPatch[platform] =
            code === 401 || code === 403 || /captcha|verify|slide/i.test(err.message)
              ? 'sandbox_manual_verify'
              : 'sandbox_failed_fallback';
        }

        updateSession(sessionId, { platformStatus: statusPatch, results: resultsPatch });
      })
    );

    log('info', 'sandbox.search.complete', { keyword, statuses: statusPatch });
  })();

  res.status(202).json({ accepted: true, sessionId, keyword });
});

// ── GET /api/sandbox/status/:sessionId ────────────────────────────────────
// Returns current scraping status and accumulated results for all platforms.
router.get('/status/:sessionId', (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }

  const allItems = Object.values(session.results).flat();

  res.json({
    sessionId: session.id,
    keyword: session.searchKeyword,
    expiresAt: session.expiresAt,
    platformStatus: session.platformStatus,
    totalItems: allItems.length,
    results: allItems,
  });
});

// ── POST /api/sandbox/close ────────────────────────────────────────────────
// Immediately destroys the session and all in-memory data associated with it.
router.post('/close', (req, res) => {
  const { sessionId } = req.body || {};
  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId required' });
  }
  closeSession(sessionId);
  log('info', 'sandbox.session.closed', { id: sessionId });
  res.json({ closed: true });
});

export default router;
