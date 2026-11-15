import 'dotenv/config';
import mongoose from 'mongoose';
import Game from '../src/models/Game.js';
import { eventsByAction } from '../src/utils/eventsByAction.js';
import logger, { serializeError } from '../src/logger.js';

const mongoUri = process.env.MONGO_URI
  || process.env.MONGODB_URI
  || 'mongodb://127.0.0.1:27017/scorekings';

async function migrateEvents() {
  let migrated = 0;
  await mongoose.connect(mongoUri);
  try {
    const cursor = Game.collection.find(
      { 'gameData.events': { $exists: true } },
      { projection: { _id: 1, 'gameData.events': 1 } },
    );
    for await (const game of cursor) {
      const result = await Game.collection.updateOne(
        { _id: game._id },
        { $set: { 'gameData.events': eventsByAction(game.gameData.events) } },
      );
      migrated += result.modifiedCount;
    }
  } finally {
    await mongoose.disconnect();
  }
  logger.info({ migrated }, 'Migrated game events to action-keyed objects');
}

migrateEvents().catch((error) => {
  logger.error({ err: serializeError(error) }, 'Failed to migrate game events');
  process.exitCode = 1;
});
