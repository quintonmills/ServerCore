import { unlink } from 'node:fs/promises';
import { normalizePlayerStats } from '../utils/playerStats.js';
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
    const increment = Object.fromEntries(
      Object.entries(stats).map(([stat, value]) => [`careerStats.${stat}`, value]),
    );
    try {
      await PlayerModel.findOneAndUpdate(
        { playerId: player.playerId, appliedGameIds: { $ne: gameId } },
        {
          $set: {
            firstName: player.firstName,
            lastName: player.lastName,
            ...(player.jersey ? { jersey: player.jersey } : {}),
            ...(player.teamId ? { teamId: player.teamId } : {}),
          },
          $setOnInsert: { playerId: player.playerId },
          $inc: increment,
          $addToSet: { appliedGameIds: gameId },
        },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
      );
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const alreadyApplied = await PlayerModel.exists({
        playerId: player.playerId,
        appliedGameIds: gameId,
      });
      if (!alreadyApplied) throw error;
    }
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

    const selectedPlayers = selectPlayersForCards(request.body.players).slice(0, 1);

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
      status: request.body.status || 'completed',
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
      imageGeneration,
    };

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
            ...(team.logo ? [validateRasterImageDataUrl(team.logo, teamName)] : []),
          ];
        }),
      );

      let finalizedGame = await saveFinalizedGame(GameModel, gamePayload);
      if (!finalizedGame) throw new Error('The finalized game could not be saved');
      await updateTeams(TeamModel, request.body);
      await updateCareerStats(PlayerModel, boxScore, gamePayload.gameId);

      for (const player of players) {
        const input = playerInputs.get(player.id);
        const team = player.team === 'Team A' ? request.body.teamA : request.body.teamB;
        const graphic = await generateFlyer(player, finalizedGame, {
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
        finalizedGame = await GameModel.findOneAndUpdate(
          { gameId: gamePayload.gameId },
          {
            $push: {
              generatedMedia: {
                type: 'flyer',
                playerId: player.id,
                publicUrl: graphic.publicUrl,
                downloadUrl: graphic.downloadUrl,
              },
            },
          },
          { new: true, runValidators: true },
        );
        if (!finalizedGame) throw new Error('The finalized game could not be updated with generated media');
      }

      response.status(200).json({ game: omitStoredImages(finalizedGame), graphics: generated });
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
