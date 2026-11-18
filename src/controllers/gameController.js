import { unlink } from 'node:fs/promises';
import { validateRasterImageDataUrl } from '../utils/rasterImage.js';
import { validateGamePayload } from '../utils/validateGamePayload.js';
import logger, { serializeError } from '../logger.js';
import { createGamePayload, getPlayerImages } from '../services/gamePayload.js';
import {
  omitStoredImages,
  saveFinalizedGame,
  saveGeneratedMedia,
  updateCareerStats,
  updateTeams,
} from '../services/gamePersistence.js';

function logWarning(error, requestId, message) {
  logger.error({ err: serializeError(error), requestId }, message);
}

async function validateFlyerImages(players, playerInputs, team) {
  await Promise.all(
    players.flatMap((player) => {
      const input = playerInputs.get(player.id);
      return [
        ...getPlayerImages(input).map((image, index) =>
          validateRasterImageDataUrl(image, `Player ${player.id} photo ${index + 1}`),
        ),
        ...(team.logo ? [validateRasterImageDataUrl(team.logo, 'teamLogo')] : []),
      ];
    }),
  );
}

async function generatePlayerGraphics({
  generateFlyer,
  players,
  playerInputs,
  finalizedGame,
  team,
  imageGeneration,
  publicBaseUrl,
  requestId,
}) {
  return Promise.allSettled(players.map(async (player) => {
    const input = playerInputs.get(player.id);
    const graphic = await generateFlyer(player, finalizedGame, {
      publicBaseUrl,
      playerImages: getPlayerImages(input),
      teamLogoImage: team.logo,
      imageGeneration,
      requestId,
    });
    return {
      playerId: player.id,
      playerName: player.name,
      ...graphic,
    };
  }));
}

async function cleanupGeneratedGraphics(generated, requestId) {
  const cleanupResults = await Promise.allSettled(
    generated.map((graphic) => unlink(graphic.filePath)),
  );
  cleanupResults.forEach((result) => {
    if (result.status === 'rejected') {
      logWarning(
        result.reason,
        requestId,
        'Failed to remove a generated graphic after request failure',
      );
    }
  });
}

export function createGameController({
  GameModel,
  PlayerModel,
  TeamModel,
  generateFlyer,
  publicBaseUrl,
}) {
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

    const {
      gamePayload,
      canonicalPlayers,
      imageGeneration,
      playerInputs,
      players,
      team,
    } = createGamePayload(request.body);
    const generated = [];

    try {
      await validateFlyerImages(players, playerInputs, team);

      let finalizedGame = await saveFinalizedGame(GameModel, gamePayload);
      if (!finalizedGame) throw new Error('The finalized game could not be saved');
      const warnings = [];
      try {
        await updateTeams(TeamModel, team);
      } catch (error) {
        logWarning(error, request.id, 'Failed to update team records after saving a game');
        warnings.push('The game was saved, but team records could not be updated.');
      }
      try {
        await updateCareerStats(PlayerModel, canonicalPlayers);
      } catch (error) {
        logWarning(error, request.id, 'Failed to update player career stats after saving a game');
        warnings.push('The game was saved, but player career stats could not be updated.');
      }

      const generationResults = await generatePlayerGraphics({
        generateFlyer,
        players,
        playerInputs,
        finalizedGame,
        team,
        imageGeneration,
        publicBaseUrl,
        requestId: request.id,
      });
      for (const result of generationResults) {
        if (result.status === 'fulfilled') {
          generated.push(result.value);
        } else {
          logWarning(result.reason, request.id, 'Failed to generate a game flyer');
          warnings.push('The game was saved, but one or more flyer graphics could not be generated.');
        }
      }

      if (generated.length > 0) {
        try {
          const updatedGame = await saveGeneratedMedia(
            GameModel,
            gamePayload.idempotencyKey,
            generated,
          );
          if (updatedGame) {
            finalizedGame = updatedGame;
          } else {
            throw new Error('The finalized game could not be updated with generated media');
          }
        } catch (error) {
          logWarning(error, request.id, 'Failed to save generated flyer links');
          warnings.push('The game was saved, but flyer links could not be recorded.');
        }
      }

      response.status(200).json({
        game: omitStoredImages(finalizedGame),
        graphics: generated,
        ...(warnings.length > 0 ? { warnings: [...new Set(warnings)] } : {}),
      });
    } catch (error) {
      await cleanupGeneratedGraphics(generated, request.id);
      next(error);
    }
  };
}
