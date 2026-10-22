import { unlink } from 'node:fs/promises';
import { selectPlayersForCards } from '../services/selectPlayersForCards.js';
import { validateGamePayload } from '../utils/validateGamePayload.js';

function isDuplicateKeyError(error) {
  return error?.code === 11000;
}

function omitStoredImages(game) {
  const safeGame = typeof game.toObject === 'function'
    ? game.toObject()
    : {
        ...game,
        teamA: { ...game.teamA },
        teamB: { ...game.teamB },
        players: game.players.map((player) => ({ ...player })),
      };
  delete safeGame.teamA.logo;
  delete safeGame.teamB.logo;
  safeGame.players.forEach((player) => delete player.photo);
  return safeGame;
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

    const players = selectPlayersForCards(request.body.players);
    const playerInputs = new Map(request.body.players.map((player) => [player.id, player]));
    const assetErrors = [];
    for (const player of players) {
      const input = playerInputs.get(player.id);
      const team = player.team === 'Team A' ? request.body.teamA : request.body.teamB;
      if (!input.photo) assetErrors.push(`players[id=${player.id}].photo is required to generate a flyer`);
      if (!team.logo) {
        assetErrors.push(
          `${player.team === 'Team A' ? 'teamA' : 'teamB'}.logo is required to generate this player's flyer`,
        );
      }
    }
    if (assetErrors.length > 0) {
      response.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Player photos and team logos are required for flyer generation',
          details: assetErrors,
        },
      });
      return;
    }

    const suppliedImageGeneration = request.body.imageGeneration || {};
    const imageGeneration = {
      ...suppliedImageGeneration,
      size: suppliedImageGeneration.size || '1024x1536',
      quality: suppliedImageGeneration.quality || 'high',
    };
    const gamePayload = { ...request.body, imageGeneration };

    const generated = [];
    try {
      const game = await saveFinalizedGame(GameModel, gamePayload);

      for (const player of players) {
        const input = playerInputs.get(player.id);
        const team = player.team === 'Team A' ? request.body.teamA : request.body.teamB;
        const graphic = await generateStatCard(player, game, {
          publicBaseUrl,
          playerImage: input.photo,
          teamLogoImage: team.logo,
          imageGeneration,
        });
        generated.push({
          playerId: player.id,
          playerName: player.name,
          ...graphic,
        });
      }

      response.status(200).json({ game: omitStoredImages(game), graphics: generated });
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
