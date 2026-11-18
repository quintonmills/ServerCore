import { normalizePlayerStats } from '../utils/playerStats.js';
import { selectPlayersForCards } from './selectPlayersForCards.js';
import { eventsByAction } from '../utils/eventsByAction.js';

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

export function getPlayerImages(input) {
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

export function getTeamData(payload) {
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

export function getCanonicalPlayers(payload) {
  const team = getTeamData(payload);
  const playerInputs = new Map(payload.players.map((player) => [player.id, player]));
  const scoreEntries = new Map(
    (payload.boxScore || []).map((player) => [player.playerId || player.id, player]),
  );
  const playerIds = [...new Set([...playerInputs.keys(), ...scoreEntries.keys()])];

  return playerIds.map((playerId) => {
    const playerInput = playerInputs.get(playerId) || {};
    const scoreEntry = scoreEntries.get(playerId) || {};
    const player = { ...playerInput, ...scoreEntry };
    const [fallbackFirstName, ...fallbackLastName] =
      (scoreEntry.name || playerInput.name || '').split(' ');
    const firstName = player.firstName || fallbackFirstName || playerId;
    const lastName = player.lastName || fallbackLastName.join(' ');
    return {
      id: playerId,
      ...(playerInput.team ? { team: playerInput.team } : {}),
      firstName,
      lastName,
      name: playerInput.name || scoreEntry.name || [firstName, lastName].filter(Boolean).join(' '),
      ...(player.jersey ? { jersey: player.jersey } : {}),
      ...(player.teamId || team.teamId ? { teamId: player.teamId || team.teamId } : {}),
      ...(playerInput.topPerformer !== undefined ? { topPerformer: playerInput.topPerformer } : {}),
      ...normalizePlayerStats(player),
    };
  });
}

export function createGamePayload(payload) {
  const selectedPlayers = selectPlayersForCards(payload.players);
  const playerInputs = new Map(payload.players.map((player) => [player.id, player]));
  const team = getTeamData(payload);
  const players = selectedPlayers.filter((player) => {
    const input = playerInputs.get(player.id);
    const imageCount = getPlayerImages(input).length;
    return (imageCount === 1 || imageCount === 2 || imageCount === 3) && Boolean(team.logo);
  });

  const suppliedImageGeneration = payload.imageGeneration || {};
  const imageGeneration = {
    ...suppliedImageGeneration,
    size: suppliedImageGeneration.size || '1024x1536',
    quality: suppliedImageGeneration.quality || 'high',
  };
  const canonicalPlayers = getCanonicalPlayers(payload);
  const now = new Date();
  const gameTimestamp = payload.startedAt || payload.completedAt || now;
  const status = (payload.status || 'COMPLETED').toUpperCase();
  const playerData = playersByName(
    canonicalPlayers.map(({ firstName, lastName, ...player }) => player),
  );
  const gamePayload = {
    gameId: readableGameId(payload.location, gameTimestamp),
    idempotencyKey: payload.idempotencyKey ?? payload.gameId,
    location: payload.location,
    status,
    timestamps: {
      ...(payload.startedAt ? { startedAt: payload.startedAt } : {}),
      ...(payload.completedAt
        ? { completedAt: payload.completedAt }
        : status === 'COMPLETED' ? { completedAt: now } : {}),
      createdAt: now,
      updatedAt: now,
    },
    gameData: {
      teamName: team.name,
      players: playerData,
      events: eventsByAction(payload.events || []),
    },
    metadata: payload.metadata || {},
    media: {
      team: {
        ...(team.logo ? { logo: team.logo } : {}),
        ...(team.logoUrl ? { logoUrl: team.logoUrl } : {}),
      },
      players: payload.players
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

  return { gamePayload, canonicalPlayers, imageGeneration, playerInputs, players, team };
}
