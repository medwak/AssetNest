import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';

import { apiRouter } from './routes/api.js';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp(db) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.db = db;
    next();
  });

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', apiRouter());
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(express.static(publicDir));

  app.use((err, _req, res, _next) => {
    const isConstraint = err.code === 'ERR_SQLITE_ERROR' && /constraint/i.test(err.message);
    const status = err.status ?? err.statusCode ?? (isConstraint ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
  });

  return app;
}
