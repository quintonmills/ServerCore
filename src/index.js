import 'dotenv/config';
import path from 'node:path';
import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const DEFAULT_MONGO_URI = 'mongodb://127.0.0.1:27017/scorekings';

function safeConnectionError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(mongodb(?:\+srv)?:\/\/)[^@/\s]+@/gi, '$1[redacted]@');
}

export async function startServer() {
  const { MONGO_URI, MONGODB_URI, PORT = '5000' } = process.env;
  const mongoUri = MONGO_URI || MONGODB_URI || DEFAULT_MONGO_URI;
  const port = Number(PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('[startup] PORT must be an integer between 1 and 65535');
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  mongoose.connection.on('connected', () => {
    console.log('[startup] MongoDB connection established');
  });
  mongoose.connection.on('disconnected', () => {
    console.error('[startup] MongoDB connection lost');
  });
  mongoose.connection.on('error', (error) => {
    console.error(`[startup] MongoDB connection error: ${safeConnectionError(error)}`);
  });

  try {
    await mongoose.connect(mongoUri);
  } catch (error) {
    console.error(`[startup] MongoDB connection failed: ${safeConnectionError(error)}`);
    throw error;
  }

  console.log(`[startup] MongoDB connection readyState: ${mongoose.connection.readyState}`);

  const server = createApp().listen(port, () => {
    console.log(`[startup] ScoreKings API listening on port ${port}`);
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().catch(() => {
    process.exitCode = 1;
  });
}
