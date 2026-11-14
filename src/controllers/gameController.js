import { createHash } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { normalizePlayerStats } from '../utils/playerStats.js';
import { selectPlayersForCards } from '../services/selectPlayersForCards.js';
import { validateRasterImageDataUrl } from '../utils/rasterImage.js';
import { validateGamePayload } from '../utils/validateGamePayload.js';

function isDuplicateKeyError(error) {
  return error?.code === 11000;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => key !== '_id' && key !== '__v')
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function hashPayload(payload) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(payload)))
    .digest('hex');
}

function createConflictError(message) {
  const error = new Error(message);
  error.status = 409;
  error.code = 'GAME_CONFLICT';
  return error;
}

function hashStoredPayload(game, payload) {
  const storedGame = typeof game.toObject === 'function' ? game.toObject() : game;
  const content = Object.fromEntries(
    Object.keys(payload)
      .filter((key) => key !== 'payloadHash' && key !== 'flyerGeneration')
      .map((key) => [key, storedGame[key]]),
  );
  return hashPayload(content);
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
  delete safeGame.payloadHash;
  safeGame.players.forEach((player) => {
    delete player.photo;
    delete player.photos;
  });
  return safeGame;
}

function getPlayerImages(input) {
  return input.photos || (input.photo ? [input.photo] : []);
}

function getEligibleFlyerPlayers(game) {
  return selectPlayersForCards(game.players || []).filter((player) => {
    const team = player.team === 'Team A' ? game.teamA : game.teamB;
    return getPlayerImages(player).length > 0 && Boolean(team?.logo);
  });
}

async function saveFinalizedGame(GameModel, payload) {
  try {
    const game = await GameModel.findOneAndUpdate(
      { gameId: payload.gameId, payloadHash: payload.payloadHash },
      { $setOnInsert: payload },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
    return { game, isLegacy: false };
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;

    const existingGame = await GameModel.findOne({ gameId: payload.gameId });
    if (existingGame?.payloadHash === payload.payloadHash) {
      return { game: existingGame, isLegacy: false };
    }
    if (
      existingGame &&
      !existingGame.payloadHash &&
      hashStoredPayload(existingGame, payload) === payload.payloadHash
    ) {
      const needsFlyers = getEligibleFlyerPlayers(existingGame).length > 0;
      const migratedGame = await GameModel.findOneAndUpdate(
        { gameId: payload.gameId, payloadHash: { $exists: false } },
        {
          $set: {
            payloadHash: payload.payloadHash,
            flyerGeneration: {
              status: needsFlyers ? 'pending' : 'not_requested',
              attemptCount: 0,
            },
          },
        },
        { new: true, runValidators: true },
      );
      return {
        game: migratedGame || await GameModel.findOne({ gameId: payload.gameId }),
        isLegacy: true,
      };
    }
    throw createConflictError('A different payload has already been finalized for this game ID.');
  }
}

function getCanonicalBoxScore(payload) {
  const source = payload.boxScore || payload.players;
  return source.map((player) => {
    const playerId = player.playerId || player.id;
    const legacyPlayer = payload.players.find((entry) => (entry.playerId || entry.id) === playerId);
    const homeTeam = payload.teams?.home || payload.teamA;
    const awayTeam = payload.teams?.away || payload.teamB;
    const team = player.team === 'Team B' || legacyPlayer?.team === 'Team B'
      ? awayTeam
      : homeTeam;
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

async function updateCareerStats(PlayerModel, boxScore, gameId) {
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
    const filter = {
      playerId: player.playerId,
      'careerStats.appliedGameIds': { $ne: gameId },
    };
    const update = {
      $set: {
        firstName: player.firstName,
        lastName: player.lastName,
        ...(player.jersey ? { jersey: player.jersey } : {}),
        ...(player.teamId ? { teamId: player.teamId } : {}),
      },
      $setOnInsert: { playerId: player.playerId },
      $inc: increment,
      $addToSet: { 'careerStats.appliedGameIds': gameId },
    };
    try {
      await PlayerModel.findOneAndUpdate(filter, update, {
        upsert: true,
        new: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      await PlayerModel.findOneAndUpdate(filter, update, {
        new: true,
        runValidators: true,
      });
    }
  }
}

async function markLegacyCareerStatsApplied(PlayerModel, boxScore, gameId) {
  for (const player of boxScore) {
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
        $addToSet: { 'careerStats.appliedGameIds': gameId },
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );
  }
}

async function updateTeams(TeamModel, payload) {
  for (const team of [
    payload.teams?.home || payload.teamA,
    payload.teams?.away || payload.teamB,
  ]) {
    if (!team.teamId) continue;
    await TeamModel.findOneAndUpdate(
      { teamId: team.teamId },
      { $set: { name: team.name, ...(team.logoUrl ? { logoUrl: team.logoUrl } : {}) } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );
  }
}

export function createGameController({
  GameModel,
  PlayerModel,
  TeamModel,
  generateFlyer,
  publicBaseUrl,
}) {
  async function runFlyerGeneration(gameId) {
    const retryableBefore = new Date(Date.now() - 30 * 60 * 1000);
    const claimedGame = await GameModel.findOneAndUpdate(
      {
        gameId,
        $or: [
          { 'flyerGeneration.status': { $in: ['pending', 'failed'] } },
          {
            'flyerGeneration.status': 'processing',
            'flyerGeneration.updatedAt': { $lt: retryableBefore },
          },
        ],
      },
      {
        $set: {
          'flyerGeneration.status': 'processing',
          'flyerGeneration.updatedAt': new Date(),
        },
        $unset: { 'flyerGeneration.lastError': 1 },
        $inc: { 'flyerGeneration.attemptCount': 1 },
      },
      { new: true, runValidators: true },
    );
    if (!claimedGame) {
      const currentGame = await GameModel.findOne({ gameId });
      if (!currentGame) {
        const error = new Error('The finalized game could not be found');
        error.status = 404;
        throw error;
      }
      return { game: currentGame, graphics: [] };
    }

    const pendingPlayers = getEligibleFlyerPlayers(claimedGame).filter(
      (player) => !(claimedGame.generatedMedia || []).some(
        (media) => media.type === 'flyer' && media.playerId === player.id,
      ),
    );
    const generated = [];

    try {
      const generationResults = await Promise.allSettled(
        pendingPlayers.map(async (player) => {
          const team = player.team === 'Team A' ? claimedGame.teamA : claimedGame.teamB;
          const graphic = await generateFlyer(player, claimedGame, {
            publicBaseUrl,
            playerImages: getPlayerImages(player),
            teamLogoImage: team.logo,
            imageGeneration: claimedGame.imageGeneration,
          });
          return { playerId: player.id, playerName: player.name, ...graphic };
        }),
      );
      generated.push(
        ...generationResults
          .filter((result) => result.status === 'fulfilled')
          .map((result) => result.value),
      );
      const failedGeneration = generationResults.find((result) => result.status === 'rejected');
      const flyerStatus = {
        'flyerGeneration.status': failedGeneration ? 'failed' : 'completed',
        'flyerGeneration.updatedAt': new Date(),
      };
      if (failedGeneration) {
        const reason = failedGeneration.reason;
        console.error('[games/finalize] Flyer generation failed', {
          gameId,
          message: String(reason instanceof Error ? reason.message : reason)
            .replace(/[\r\n]+/g, ' ')
            .slice(0, 500),
        });
        flyerStatus['flyerGeneration.lastError'] = 'Flyer generation failed. Retry the flyer job to try again.';
      }
      const mediaUpdate = {
        $set: flyerStatus,
        ...(!failedGeneration ? { $unset: { 'flyerGeneration.lastError': 1 } } : {}),
        ...(generated.length > 0
          ? {
              $push: {
                generatedMedia: {
                  $each: generated.map((graphic) => ({
                    type: 'flyer',
                    playerId: graphic.playerId,
                    publicUrl: graphic.publicUrl,
                    downloadUrl: graphic.downloadUrl,
                  })),
                },
              },
            }
          : {}),
      };
      const finalizedGame = await GameModel.findOneAndUpdate(
        { gameId },
        mediaUpdate,
        { new: true, runValidators: true },
      );
      if (!finalizedGame) throw new Error('The finalized game could not be updated with flyer status');
      return { game: finalizedGame, graphics: generated };
    } catch (error) {
      const cleanupResults = await Promise.allSettled(
        generated.map((graphic) => unlink(graphic.filePath)),
      );
      cleanupResults.forEach((result) => {
        if (result.status === 'rejected') {
          console.error('[games/finalize] Failed to remove a generated graphic after failure:', result.reason);
        }
      });
      try {
        await GameModel.findOneAndUpdate(
          { gameId },
          {
            $set: {
              'flyerGeneration.status': 'failed',
              'flyerGeneration.lastError': 'Flyer generation failed. Retry the flyer job to try again.',
              'flyerGeneration.updatedAt': new Date(),
            },
          },
          { new: true, runValidators: true },
        );
      } catch (statusError) {
        console.error('[games/finalize] Failed to persist flyer-generation failure status:', statusError);
      }
      throw error;
    }
  }

  async function finalizeGame(request, response, next) {
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
    const players = selectedPlayers.filter((player) => {
      const input = playerInputs.get(player.id);
      const team = player.team === 'Team A' ? request.body.teamA : request.body.teamB;
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
    const homeTeam = request.body.teams?.home || request.body.teamA;
    const awayTeam = request.body.teams?.away || request.body.teamB;
    const gamePayload = {
      ...request.body,
      status: (request.body.status || 'COMPLETED').toUpperCase(),
      teams: {
        home: {
          teamId: homeTeam.teamId,
          name: homeTeam.name,
          score: homeTeam.score,
        },
        away: {
          teamId: awayTeam.teamId,
          name: awayTeam.name,
          score: awayTeam.score,
        },
      },
      boxScore,
      events: request.body.events || [],
      metadata: request.body.metadata || {},
      imageGeneration,
    };

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
            ...(team.logo ? [validateRasterImageDataUrl(team.logo, teamName)] : []),
          ];
        }),
      );

      const payloadHash = hashPayload(gamePayload);
      gamePayload.payloadHash = payloadHash;
      gamePayload.flyerGeneration = {
        status: players.length > 0 ? 'pending' : 'not_requested',
        attemptCount: 0,
      };
      const savedGame = await saveFinalizedGame(GameModel, gamePayload);
      let finalizedGame = savedGame.game;
      if (!finalizedGame) throw new Error('The finalized game could not be saved');
      await updateTeams(TeamModel, request.body);
      if (savedGame.isLegacy) {
        await markLegacyCareerStatsApplied(PlayerModel, boxScore, gamePayload.gameId);
      } else {
        await updateCareerStats(PlayerModel, boxScore, gamePayload.gameId);
      }
      if (players.length > 0) {
        const generation = await runFlyerGeneration(gamePayload.gameId);
        finalizedGame = generation.game;
        response.status(200).json({
          game: omitStoredImages(finalizedGame),
          graphics: generation.graphics,
        });
        return;
      }
      response.status(200).json({ game: omitStoredImages(finalizedGame), graphics: [] });
    } catch (error) {
      next(error);
    }
  }

  async function retryFlyerGeneration(request, response, next) {
    try {
      const currentGame = await GameModel.findOne({ gameId: request.params.gameId });
      if (!currentGame) {
        const error = new Error('The finalized game could not be found');
        error.status = 404;
        throw error;
      }
      const staleProcessing =
        currentGame.flyerGeneration?.status === 'processing' &&
        currentGame.flyerGeneration.updatedAt instanceof Date &&
        currentGame.flyerGeneration.updatedAt.getTime() < Date.now() - 30 * 60 * 1000;
      if (!['failed', 'pending'].includes(currentGame.flyerGeneration?.status) && !staleProcessing) {
        throw createConflictError('Flyer generation is not currently eligible for retry.');
      }
      const generation = await runFlyerGeneration(request.params.gameId);
      response.status(200).json({
        game: omitStoredImages(generation.game),
        graphics: generation.graphics,
      });
    } catch (error) {
      next(error);
    }
  }

  async function getFlyerGenerationStatus(request, response, next) {
    try {
      const game = await GameModel.findOne({ gameId: request.params.gameId });
      if (!game) {
        const error = new Error('The finalized game could not be found');
        error.status = 404;
        throw error;
      }
      response.status(200).json({
        gameId: game.gameId,
        flyerGeneration: game.flyerGeneration,
        graphics: (game.generatedMedia || []).filter((media) => media.type === 'flyer'),
      });
    } catch (error) {
      next(error);
    }
  }

  return { finalizeGame, retryFlyerGeneration, getFlyerGenerationStatus };
}
