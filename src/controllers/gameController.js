import { unlink } from 'node:fs/promises';
import { selectPlayersForCards } from '../services/selectPlayersForCards.js';
import { validateRasterImageDataUrl } from '../utils/rasterImage.js';
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
  safeGame.players.forEach((player) => {
    delete player.photo;
    delete player.photos;
  });
  return safeGame;
}

function getPlayerImages(input) {
  return input.photos || (input.photo ? [input.photo] : []);
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

export function createGameController({ GameModel, generateFlyer, publicBaseUrl }) {
  return async function finalizeGame(request, response, next) {
    const errors = validateGamePayload(request.body);
    if (errors.length > 0) {
      const invalidImage = errors.some((error) => error.includes('.photo') || error.includes('.logo'));
      response.status(400).json({
        error: {
          code: invalidImage ? 'INVALID_IMAGE_ASSET' : 'VALIDATION_ERROR',
          message: invalidImage ? 'One or more uploaded images are invalid' : 'Invalid game payload',
          details: errors,
        },
      });
      return;
    }

    const players = selectPlayersForCards(request.body.players).slice(0, 1);
    if (players.length === 0) {
      response.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'At least one player with one or more points is required to generate a flyer',
          details: ['players must include at least one player with one or more points'],
        },
      });
      return;
    }

    const playerInputs = new Map(request.body.players.map((player) => [player.id, player]));
    const assetErrors = [];
    for (const player of players) {
      const input = playerInputs.get(player.id);
      const team = player.team === 'Team A' ? request.body.teamA : request.body.teamB;
      if (getPlayerImages(input).length === 0) {
        assetErrors.push(`players[id=${player.id}].photos is required to generate a flyer`);
      }
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
      await Promise.all(
        players.flatMap((player) => {
          const input = playerInputs.get(player.id);
          const team = player.team === 'Team A' ? request.body.teamA : request.body.teamB;
          const teamName = player.team === 'Team A' ? 'teamA.logo' : 'teamB.logo';
          return [
            ...getPlayerImages(input).map((image, index) =>
              validateRasterImageDataUrl(image, `Player ${player.id} photo ${index + 1}`),
            ),
            validateRasterImageDataUrl(team.logo, teamName),
          ];
        }),
      );

      const game = await saveFinalizedGame(GameModel, gamePayload);

      for (const player of players) {
        const input = playerInputs.get(player.id);
        const team = player.team === 'Team A' ? request.body.teamA : request.body.teamB;
        const graphic = await generateFlyer(player, game, {
          publicBaseUrl,
          playerImages: getPlayerImages(input),
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
