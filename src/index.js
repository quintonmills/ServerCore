import 'dotenv/config';
import path from 'node:path';
import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

function safeConnectionError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(mongodb(?:\+srv)?:\/\/)[^@/\s]+@/gi, '$1[redacted]@');
}

export async function startServer() {
  const { MONGODB_URI, PORT = '5000' } = process.env;
  if (!MONGODB_URI) {
    console.error('[startup] MONGODB_URI must be set before starting the server');
    throw new Error('MONGODB_URI must be set before starting the server');
  }

  const port = Number(PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('[startup] PORT must be an integer between 1 and 65535');
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  try {
    await mongoose.connect(MONGODB_URI);
  } catch (error) {
    console.error(`[startup] MongoDB connection failed: ${safeConnectionError(error)}`);
    throw error;
  }

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
