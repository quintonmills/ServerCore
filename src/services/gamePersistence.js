import { normalizePlayerStats } from '../utils/playerStats.js';

function isDuplicateKeyError(error) {
  return error?.code === 11000;
}

export function omitStoredImages(game) {
  const safeGame = typeof game.toObject === 'function' ? game.toObject() : { ...game };
  if (safeGame.gameData?.players && !Array.isArray(safeGame.gameData.players)) {
    const players = safeGame.gameData.players instanceof Map
      ? [...safeGame.gameData.players.values()]
      : Object.values(safeGame.gameData.players);
    safeGame.gameData = { ...safeGame.gameData, players };
  }
  if (safeGame.gameData?.events && !Array.isArray(safeGame.gameData.events)) {
    const events = safeGame.gameData.events instanceof Map
      ? [...safeGame.gameData.events.values()]
      : Object.values(safeGame.gameData.events);
    safeGame.gameData = { ...safeGame.gameData, events };
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

export async function saveFinalizedGame(GameModel, payload) {
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
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
        strict: false,
      },
    );
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;

    const finalizedGame = await GameModel.findOneAndUpdate(
      { idempotencyKey: payload.idempotencyKey },
      { $set, $unset: update.$unset },
      { new: true, runValidators: true, strict: false },
    );
    if (!finalizedGame) throw error;
    return finalizedGame;
  }
}

export async function updateCareerStats(PlayerModel, players) {
  for (const player of players) {
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
      { playerId: player.id },
      {
        $set: {
          firstName: player.firstName,
          lastName: player.lastName,
          ...(player.jersey ? { jersey: player.jersey } : {}),
          ...(player.teamId ? { teamId: player.teamId } : {}),
        },
        $setOnInsert: { playerId: player.id },
        $inc: increment,
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );
  }
}

export async function updateTeams(TeamModel, team) {
  if (!team.teamId) return;
  await TeamModel.findOneAndUpdate(
    { teamId: team.teamId },
    { $set: { name: team.name, ...(team.logoUrl ? { logoUrl: team.logoUrl } : {}) } },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  );
}

export async function saveGeneratedMedia(GameModel, idempotencyKey, generated) {
  return GameModel.findOneAndUpdate(
    { idempotencyKey },
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
}
