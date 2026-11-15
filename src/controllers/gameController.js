import { unlink } from 'node:fs/promises';
import { normalizePlayerStats } from '../utils/playerStats.js';
import { selectPlayersForCards } from '../services/selectPlayersForCards.js';
import { validateRasterImageDataUrl } from '../utils/rasterImage.js';
import { validateGamePayload } from '../utils/validateGamePayload.js';
import logger, { serializeError } from '../logger.js';

function isDuplicateKeyError(error) {
  return error?.code === 11000;
}

function omitStoredImages(game) {
  const safeGame = typeof game.toObject === 'function' ? game.toObject() : { ...game };
  if (safeGame.gameData?.players && !Array.isArray(safeGame.gameData.players)) {
    const players = safeGame.gameData.players instanceof Map
      ? [...safeGame.gameData.players.values()]
      : Object.values(safeGame.gameData.players);
    safeGame.gameData = { ...safeGame.gameData, players };
  }
  if (!safeGame.media || typeof safeGame.media !== 'object') return safeGame;

  safeGame.media = { ...safeGame.media };
  if (safeGame.media.team) {
    safeGame.media.team = { ...safeGame.media.team };
    delete safeGame.media.team.logo;
  }
  if (Array.isArray(safeGame.media.players)) {
    safeGame.media.players = safeGame.media.players.map((player) => ({ ...player }));
    safeGame.media.players.forEach((player) => {
      delete player.photo;
      delete player.photos;
    });
  }
  return safeGame;
}

function readableGameId(location, timestamp) {
  const locationPart = location
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .toLowerCase() || 'game';
  const timestampPart = new Date(timestamp)
    .toISOString()
    .replace(/[-:.]/g, '')
    .replace('T', '-');
  return `${locationPart}-${timestampPart}`;
}

function getPlayerImages(input) {
  return input.photos || (input.photo ? [input.photo] : []);
}

function playersByName(players) {
  const keyedPlayers = [];
  const usedKeys = new Set();
  for (const player of players) {
    const name = player.name.trim().replace(/[.$\0]/g, '_') || player.id;
    let key = name;
    let suffix = 2;
    while (usedKeys.has(key)) {
      key = `${name} (${suffix})`;
      suffix += 1;
    }
    usedKeys.add(key);
    keyedPlayers.push([key, player]);
  }
  return Object.fromEntries(keyedPlayers);
}

function getTeamData(payload) {
  if (payload.teamName !== undefined) {
    return {
      teamId: payload.teamId,
      name: payload.teamName,
      logo: payload.teamLogo,
      logoUrl: payload.teamLogoUrl,
    };
  }
  return payload.teams?.home || payload.teamA;
}

async function saveFinalizedGame(GameModel, payload) {
  const { gameId, timestamps, ...setPayload } = payload;
  const { media, ...gameFields } = setPayload;
  const $set = {
    ...gameFields,
    'timestamps.updatedAt': timestamps.updatedAt,
    'media.team': media.team,
    'media.players': media.players,
    'media.imageGeneration': media.imageGeneration,
  };
  if (timestamps.startedAt !== undefined) {
    $set['timestamps.startedAt'] = timestamps.startedAt;
  }
  if (timestamps.completedAt !== undefined) {
    $set['timestamps.completedAt'] = timestamps.completedAt;
  }
  const update = {
    $set,
    $unset: {
      'media.teamA': '',
      'media.teamB': '',
    },
    $setOnInsert: {
      gameId,
      'timestamps.createdAt': timestamps.createdAt,
      'media.generatedMedia': media.generatedMedia,
    },
  };
  try {
    return await GameModel.findOneAndUpdate(
      { idempotencyKey: payload.idempotencyKey },
      update,
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;

    const finalizedGame = await GameModel.findOneAndUpdate(
      { idempotencyKey: payload.idempotencyKey },
      { $set, $unset: update.$unset },
      { new: true, runValidators: true },
    );
    if (!finalizedGame) throw error;
    return finalizedGame;
  }
}

function getCanonicalBoxScore(payload) {
  const source = payload.boxScore || payload.players;
  return source.map((player) => {
    const playerId = player.playerId || player.id;
    const legacyPlayer = payload.players.find((entry) => (entry.playerId || entry.id) === playerId);
    const team = getTeamData(payload);
    const [fallbackFirstName, ...fallbackLastName] = (player.name || legacyPlayer?.name || '').split(' ');
    return {
      playerId,
      firstName: player.firstName || legacyPlayer?.firstName || fallbackFirstName || playerId,
      lastName: player.lastName || legacyPlayer?.lastName || fallbackLastName.join(' '),
      name: player.name || legacyPlayer?.name,
      jersey: player.jersey || legacyPlayer?.jersey,
      teamId: player.teamId || legacyPlayer?.teamId || team.teamId,
      ...normalizePlayerStats(player),
    };
  });
}

async function updateCareerStats(PlayerModel, boxScore) {
  for (const player of boxScore) {
    const stats = normalizePlayerStats(player);
    const increment = {
      'careerStats.pts': stats.PTS,
      'careerStats.reb': stats.REB,
      'careerStats.ast': stats.AST,
      'careerStats.stl': stats.STL,
      'careerStats.blk': stats.BLK,
      'careerStats.to': stats.TOV,
      'careerStats.gamesPlayed': 1,
    };
    await PlayerModel.findOneAndUpdate(
      { playerId: player.playerId },
      {
        $set: {
          firstName: player.firstName,
          lastName: player.lastName,
          ...(player.jersey ? { jersey: player.jersey } : {}),
          ...(player.teamId ? { teamId: player.teamId } : {}),
        },
        $setOnInsert: { playerId: player.playerId },
        $inc: increment,
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );
  }
}

async function updateTeams(TeamModel, payload) {
  const team = getTeamData(payload);
  if (!team.teamId) return;
  await TeamModel.findOneAndUpdate(
    { teamId: team.teamId },
    { $set: { name: team.name, ...(team.logoUrl ? { logoUrl: team.logoUrl } : {}) } },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  );
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

    const selectedPlayers = selectPlayersForCards(request.body.players);

    const playerInputs = new Map(request.body.players.map((player) => [player.id, player]));
    const team = getTeamData(request.body);
    const players = selectedPlayers.filter((player) => {
      const input = playerInputs.get(player.id);
      const imageCount = getPlayerImages(input).length;
      return (imageCount === 1 || imageCount === 2 || imageCount === 3) && Boolean(team.logo);
    });

    const suppliedImageGeneration = request.body.imageGeneration || {};
    const imageGeneration = {
      ...suppliedImageGeneration,
      size: suppliedImageGeneration.size || '1024x1536',
      quality: suppliedImageGeneration.quality || 'high',
    };
    const boxScore = getCanonicalBoxScore(request.body);
    const now = new Date();
    const gameTimestamp = request.body.startedAt || request.body.completedAt || now;
    const status = (request.body.status || 'COMPLETED').toUpperCase();
    const playerData = playersByName(
      request.body.players.map(({ photo, photos, ...player }) => player),
    );
    const gamePayload = {
      gameId: readableGameId(request.body.location, gameTimestamp),
      idempotencyKey: request.body.idempotencyKey ?? request.body.gameId,
      location: request.body.location,
      status,
      timestamps: {
        ...(request.body.startedAt ? { startedAt: request.body.startedAt } : {}),
        ...(request.body.completedAt
          ? { completedAt: request.body.completedAt }
          : status === 'COMPLETED' ? { completedAt: now } : {}),
        createdAt: now,
        updatedAt: now,
      },
      gameData: {
        teamName: team.name,
        players: playerData,
        boxScore,
        events: request.body.events || [],
      },
      metadata: request.body.metadata || {},
      media: {
        team: {
          ...(team.logo ? { logo: team.logo } : {}),
          ...(team.logoUrl ? { logoUrl: team.logoUrl } : {}),
        },
        players: request.body.players
          .filter((player) => player.photo || player.photos)
          .map((player) => ({
            playerId: player.id,
            ...(player.photo ? { photo: player.photo } : {}),
            ...(player.photos ? { photos: player.photos } : {}),
          })),
        generatedMedia: [],
        imageGeneration,
      },
    };

    const generated = [];
    try {
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

      let finalizedGame = await saveFinalizedGame(GameModel, gamePayload);
      if (!finalizedGame) throw new Error('The finalized game could not be saved');
      const warnings = [];
      try {
        await updateTeams(TeamModel, request.body);
      } catch (error) {
        logger.error(
          { err: serializeError(error), requestId: request.id },
          'Failed to update team records after saving a game',
        );
        warnings.push('The game was saved, but team records could not be updated.');
      }
      try {
        await updateCareerStats(PlayerModel, boxScore);
      } catch (error) {
        logger.error(
          { err: serializeError(error), requestId: request.id },
          'Failed to update player career stats after saving a game',
        );
        warnings.push('The game was saved, but player career stats could not be updated.');
      }

      const generationResults = await Promise.allSettled(players.map(async (player) => {
        const input = playerInputs.get(player.id);
        const graphic = await generateFlyer(player, finalizedGame, {
          publicBaseUrl,
          playerImages: getPlayerImages(input),
          teamLogoImage: team.logo,
          imageGeneration,
          requestId: request.id,
        });
        return {
          playerId: player.id,
          playerName: player.name,
          ...graphic,
        };
      }));
      for (const result of generationResults) {
        if (result.status === 'fulfilled') {
          generated.push(result.value);
        } else {
          logger.error(
            { err: serializeError(result.reason), requestId: request.id },
            'Failed to generate a game flyer',
          );
          warnings.push('The game was saved, but one or more flyer graphics could not be generated.');
        }
      }

      if (generated.length > 0) {
        try {
          const updatedGame = await GameModel.findOneAndUpdate(
            { idempotencyKey: gamePayload.idempotencyKey },
            {
              $push: {
                'media.generatedMedia': {
                  $each: generated.map((graphic) => ({
                    type: 'flyer',
                    playerId: graphic.playerId,
                    publicUrl: graphic.publicUrl,
                    downloadUrl: graphic.downloadUrl,
                  })),
                },
              },
            },
            { new: true, runValidators: true },
          );
          if (updatedGame) {
            finalizedGame = updatedGame;
          } else {
            throw new Error('The finalized game could not be updated with generated media');
          }
        } catch (error) {
          logger.error(
            { err: serializeError(error), requestId: request.id },
            'Failed to save generated flyer links',
          );
          warnings.push('The game was saved, but flyer links could not be recorded.');
        }
      }

      response.status(200).json({
        game: omitStoredImages(finalizedGame),
        graphics: generated,
        ...(warnings.length > 0 ? { warnings: [...new Set(warnings)] } : {}),
      });
    } catch (error) {
      const cleanupResults = await Promise.allSettled(
        generated.map((graphic) => unlink(graphic.filePath)),
      );
      cleanupResults.forEach((result) => {
        if (result.status === 'rejected') {
          logger.error(
            { err: serializeError(result.reason), requestId: request.id },
            'Failed to remove a generated graphic after request failure',
          );
        }
      });
      next(error);
    }
  };
}
