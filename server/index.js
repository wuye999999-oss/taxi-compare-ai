import express from 'express';
import cors from 'cors';
import sandboxRouter from './routes/sandbox.js';
import { log } from './utils/sanitize-log.js';

const PORT = Number(process.env.SANDBOX_PORT || 3001);

const app = express();

// Allow the local frontend dev server (any origin in dev; tighten for prod)
app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: '32kb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'jiabibi-sandbox', ts: Date.now() });
});

app.use('/api/sandbox', sandboxRouter);

// 404
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Unhandled error — never leak stack traces or session data
app.use((err, _req, res, _next) => {
  log('error', 'unhandled_error', { error: err.message });
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  log('info', 'server.start', { port: PORT });
});
