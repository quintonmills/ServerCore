import { unlink } from 'node:fs/promises';
import { selectPlayersForCards } from '../services/selectPlayersForCards.js';
import { validateGamePayload } from '../utils/validateGamePayload.js';

function isDuplicateKeyError(error) {
  return error?.code === 11000;
}

async function saveFinalizedGame(GameModel, payload) {
  try {
    return await GameModel.findOneAndUpdate(
      { gameId: payload.gameId },
      { $set: payload },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;

    return GameModel.findOneAndUpdate(
      { gameId: payload.gameId },
      { $set: payload },
      { new: true, runValidators: true },
    );
  }
}

export function createGameController({ GameModel, generateStatCard, publicBaseUrl }) {
  return async function finalizeGame(request, response, next) {
    const errors = validateGamePayload(request.body);
    if (errors.length > 0) {
      response.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid game payload',
          details: errors,
        },
      });
      return;
    }

    const generated = [];
    try {
      const game = await saveFinalizedGame(GameModel, request.body);
      const players = selectPlayersForCards(game.players);

      for (const player of players) {
        const graphic = await generateStatCard(player, game, { publicBaseUrl });
        generated.push({
          playerId: player.id,
          playerName: player.name,
          ...graphic,
        });
      }

      response.status(200).json({ game, graphics: generated });
    } catch (error) {
      const cleanupResults = await Promise.allSettled(
        generated.map((graphic) => unlink(graphic.filePath)),
      );
      cleanupResults.forEach((result) => {
        if (result.status === 'rejected') {
          console.error('[games/finalize] Failed to remove a generated graphic after failure:', result.reason);
        }
      });
      next(error);
    }
  };
}
