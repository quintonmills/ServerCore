import 'dotenv/config';
import path from 'node:path';
import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import Game from './models/Game.js';
import logger, { serializeError } from './logger.js';

const DEFAULT_MONGO_URI = 'mongodb://127.0.0.1:27017/scorekings';

const instrumentedConnections = new WeakSet();

function logConnectionEvents(connection) {
  if (instrumentedConnections.has(connection)) return;
  instrumentedConnections.add(connection);

  const logState = (event, level = 'info') => {
    logger[level](
      { event: `mongoose.connection.${event}`, readyState: connection.readyState },
      `MongoDB connection ${event}`,
    );
  };

  for (const event of ['connecting', 'connected', 'open', 'disconnecting', 'disconnected', 'reconnected', 'close']) {
    connection.on(event, () => {
      logState(event, event === 'disconnected' || event === 'close' ? 'warn' : 'info');
    });
  }
  connection.on('error', (error) => {
    logger.error(
      {
        event: 'mongoose.connection.error',
        readyState: connection.readyState,
        err: serializeError(error),
      },
      'MongoDB connection error',
    );
  });
}

export async function startServer() {
  const { MONGO_URI, MONGODB_URI, PORT = '5000' } = process.env;
  const mongoUri = MONGO_URI || MONGODB_URI || DEFAULT_MONGO_URI;
  const port = Number(PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    logger.error({ port: PORT }, 'PORT must be an integer between 1 and 65535');
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  logConnectionEvents(mongoose.connection);

  try {
    await mongoose.connect(mongoUri);
  } catch (error) {
    logger.error({ err: serializeError(error) }, 'MongoDB connection failed');
    throw error;
  }

  try {
    await Game.collection.dropIndex('gameId_1');
    logger.info({ index: 'gameId_1' }, 'Removed legacy unique MongoDB index');
  } catch (error) {
    const indexOrCollectionMissing =
      error.code === 27 ||
      error.code === 26 ||
      error.codeName === 'IndexNotFound' ||
      error.codeName === 'NamespaceNotFound';
    if (!indexOrCollectionMissing) {
      logger.error(
        { index: 'gameId_1', err: serializeError(error) },
        'Failed to remove legacy unique MongoDB index',
      );
      throw error;
    }
  }

  logger.info(
    { event: 'mongoose.connection.ready', readyState: mongoose.connection.readyState },
    'MongoDB connection ready',
  );

  const server = createApp().listen(port);
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      logger.info({ port }, 'ScoreKings API listening');
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().catch((error) => {
    logger.fatal({ err: serializeError(error) }, 'Server startup failed');
    process.exitCode = 1;
  });
}
