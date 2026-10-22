import cors from 'cors';
import express from 'express';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Game from './models/Game.js';
import { errorHandler } from './middleware/errorHandler.js';
import { generateFlyer } from './services/generateFlyer.js';
import { createGameRouter } from './routes/gameRoutes.js';

const outputDirectory = fileURLToPath(new URL('../output/', import.meta.url));

export function createApp({
  GameModel = Game,
  flyerGenerator = generateFlyer,
  corsOrigin = process.env.CORS_ORIGIN || '*',
  publicBaseUrl = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 5000}`,
} = {}) {
  mkdirSync(outputDirectory, { recursive: true });

  const app = express();
  const allowedOrigins =
    corsOrigin === '*'
      ? '*'
      : (Array.isArray(corsOrigin) ? corsOrigin : corsOrigin.split(','))
          .map((origin) => origin.trim())
          .filter(Boolean);
  app.use(cors({ origin: allowedOrigins }));
  app.use(express.json({ limit: '35mb' }));
  app.use('/output', express.static(path.resolve(outputDirectory), { fallthrough: false }));
  app.get('/api/health', (request, response) => response.json({ status: 'ok' }));
  app.use(
    '/api/games',
    createGameRouter({
      GameModel,
      generateFlyer: flyerGenerator,
      publicBaseUrl,
    }),
  );
  app.use((request, response, next) => {
    const error = new Error('Resource not found');
    error.status = 404;
    next(error);
  });
  app.use(errorHandler);
  return app;
}
