import { InvalidImageAssetError, parseRasterImageDataUrl } from './rasterImage.js';

const rootFields = new Set([
  'gameId',
  'location',
  'teamA',
  'teamB',
  'teams',
  'players',
  'boxScore',
  'events',
  'status',
  'startedAt',
  'completedAt',
  'imageGeneration',
]);
const teamFields = new Set(['teamId', 'name', 'score', 'logo', 'logoUrl']);
const playerFields = new Set([
  'id',
  'firstName',
  'lastName',
  'teamId',
  'team',
  'jersey',
  'name',
  'pts',
  'reb',
  'ast',
  'stl',
  'blk',
  'to',
  'photo',
  'photos',
]);
const generationFields = new Set(['prompt', 'size', 'quality']);
const boxScoreFields = new Set([
  'playerId',
  'id',
  'firstName',
  'lastName',
  'name',
  'jersey',
  'teamId',
  'stats',
  'team',
  'PTS',
  'REB',
  'AST',
  'STL',
  'BLK',
  'TOV',
  'TO',
  'MIN',
  'FG',
  'FGA',
  'FG3',
  'FG3A',
  'FT',
  'FTA',
  'FG3M',
  '3PA',
  'FTM',
  'FGM',
  '3PM',
  'pts',
  'reb',
  'ast',
  'stl',
  'blk',
  'to',
  'min',
  'fg',
  'fga',
  'fg3',
  'fg3a',
  'ft',
  'fta',
  'fg3m',
  '3pa',
  'ftm',
  'fgm',
  '3pm',
  'OREB',
  'DREB',
  'PF',
  'PLUS_MINUS',
  'oreb',
  'dreb',
  'pf',
  'plusMinus',
]);
const statFields = [
  'PTS', 'REB', 'AST', 'STL', 'BLK', 'TOV', 'TO', 'MIN',
  'FG', 'FGA', 'FG3', 'FG3A', 'FT', 'FTA',
  'FG3M', '3PA', 'FTM', 'FGM', '3PM',
  'pts', 'reb', 'ast', 'stl', 'blk', 'to', 'min',
  'fg', 'fga', 'fg3', 'fg3a', 'ft', 'fta',
  'fg3m', '3pa', 'ftm', 'fgm', '3pm',
  'OREB',
  'DREB',
  'PF',
  'PLUS_MINUS',
  'oreb',
  'dreb',
  'pf',
  'plusMinus',
];
const statFieldSet = new Set(statFields);
const maxGameDocumentBytes = 14 * 1024 * 1024;
const imageSizes = new Set(['1024x1024', '1024x1536', '1536x1024', 'auto']);
const imageQualities = new Set(['low', 'medium', 'high', 'auto']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkUnknownFields(value, allowedFields, path, errors) {
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) {
      errors.push(`${path}${field} is not allowed`);
    }
  }
}

function checkString(value, path, errors, maxLength) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string`);
  } else if (value.length > maxLength) {
    errors.push(`${path} must be at most ${maxLength} characters`);
  }
}

function checkNumber(value, path, errors) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    errors.push(`${path} must be a non-negative number`);
  }
}

function checkImageDataUrl(value, path, errors) {
  if (value === undefined) return;
  try {
    parseRasterImageDataUrl(value, path);
  } catch (error) {
    if (!(error instanceof InvalidImageAssetError)) throw error;
    errors.push(error.message);
  }
}

function validateTeam(team, path, errors) {
  if (!isRecord(team)) {
    errors.push(`${path} must be an object`);
    return;
  }

  checkUnknownFields(team, teamFields, `${path}.`, errors);
  if (team.teamId !== undefined) checkString(team.teamId, `${path}.teamId`, errors, 100);
  checkString(team.name, `${path}.name`, errors, 200);
  checkNumber(team.score, `${path}.score`, errors);
  checkImageDataUrl(team.logo, `${path}.logo`, errors);
  if (team.logoUrl !== undefined) checkString(team.logoUrl, `${path}.logoUrl`, errors, 2048);
}

function validateTeams(teams, errors) {
  if (teams === undefined) return;
  if (!isRecord(teams)) {
    errors.push('teams must be an object');
    return;
  }
  checkUnknownFields(teams, new Set(['home', 'away']), 'teams.', errors);
  validateTeam(teams.home, 'teams.home', errors);
  validateTeam(teams.away, 'teams.away', errors);
}

function validatePlayer(player, path, errors) {
  if (!isRecord(player)) {
    errors.push(`${path} must be an object`);
    return;
  }

  checkUnknownFields(player, playerFields, `${path}.`, errors);
  checkString(player.id, `${path}.id`, errors, 100);
  if (player.firstName !== undefined) checkString(player.firstName, `${path}.firstName`, errors, 100);
  if (player.lastName !== undefined) checkString(player.lastName, `${path}.lastName`, errors, 100);
  if (player.teamId !== undefined) checkString(player.teamId, `${path}.teamId`, errors, 100);
  checkString(player.jersey, `${path}.jersey`, errors, 10);
  checkString(player.name, `${path}.name`, errors, 200);
  checkImageDataUrl(player.photo, `${path}.photo`, errors);
  if (player.photos !== undefined) {
    if (!Array.isArray(player.photos) || player.photos.length < 1 || player.photos.length > 3) {
      errors.push(`${path}.photos must contain between one and three image data URLs`);
    } else {
      player.photos.forEach((photo, index) => {
        if (photo === undefined) {
          errors.push(`${path}.photos[${index}] must be a PNG, JPEG, or WebP base64 data URL`);
        } else {
          checkImageDataUrl(photo, `${path}.photos[${index}]`, errors);
        }
      });
    }
    if (player.photo !== undefined) {
      errors.push(`${path} must provide either photo or photos, not both`);
    }
  }

  if (player.team !== 'Team A' && player.team !== 'Team B') {
    errors.push(`${path}.team must be "Team A" or "Team B"`);
  }

  for (const stat of ['pts', 'reb', 'ast', 'stl', 'blk', 'to']) {
    checkNumber(player[stat], `${path}.${stat}`, errors);
  }
}

function validateImageGeneration(settings, errors) {
  if (settings === undefined) return;
  if (!isRecord(settings)) {
    errors.push('imageGeneration must be an object');
    return;
  }

  checkUnknownFields(settings, generationFields, 'imageGeneration.', errors);
  if (settings.prompt !== undefined) {
    checkString(settings.prompt, 'imageGeneration.prompt', errors, 1000);
  }
  if (settings.size !== undefined && !imageSizes.has(settings.size)) {
    errors.push('imageGeneration.size must be 1024x1024, 1024x1536, 1536x1024, or auto');
  }
  if (settings.quality !== undefined && !imageQualities.has(settings.quality)) {
    errors.push('imageGeneration.quality must be low, medium, high, or auto');
  }
}

function validateBoxScore(boxScore, errors) {
  if (!Array.isArray(boxScore)) {
    errors.push('boxScore must be an array');
    return;
  }
  const playerIds = new Set();
  boxScore.forEach((player, index) => {
    const path = `boxScore[${index}]`;
    if (!isRecord(player)) {
      errors.push(`${path} must be an object`);
      return;
    }
    checkUnknownFields(player, boxScoreFields, `${path}.`, errors);
    const playerId = player.playerId ?? player.id;
    checkString(playerId, `${path}.playerId`, errors, 100);
    if (typeof playerId === 'string') {
      if (playerIds.has(playerId)) errors.push(`${path}.playerId must be unique within the game`);
      playerIds.add(playerId);
    }
    for (const field of ['firstName', 'lastName', 'name', 'jersey', 'teamId']) {
      if (player[field] !== undefined) {
        const maxLength = {
          firstName: 100,
          lastName: 100,
          name: 200,
          jersey: 10,
          teamId: 100,
        }[field];
        checkString(player[field], `${path}.${field}`, errors, maxLength);
      }
    }
    if (player.stats !== undefined) {
      if (!isRecord(player.stats)) {
        errors.push(`${path}.stats must be an object`);
      } else {
        checkUnknownFields(player.stats, statFieldSet, `${path}.stats.`, errors);
        for (const stat of statFields) {
          if (player.stats[stat] !== undefined) {
            if (stat === 'PLUS_MINUS' || stat === 'plusMinus') {
              if (typeof player.stats[stat] !== 'number' || !Number.isFinite(player.stats[stat])) {
                errors.push(`${path}.stats.${stat} must be a finite number`);
              }
            } else {
              checkNumber(player.stats[stat], `${path}.stats.${stat}`, errors);
            }
          }
        }
      }
    }
    for (const stat of statFields) {
      if (player[stat] === undefined) continue;
      if (stat === 'PLUS_MINUS' || stat === 'plusMinus') {
        if (typeof player[stat] !== 'number' || !Number.isFinite(player[stat])) {
          errors.push(`${path}.${stat} must be a finite number`);
        }
      } else {
        checkNumber(player[stat], `${path}.${stat}`, errors);
      }
    }
  });
}

export function validateGamePayload(payload) {
  const errors = [];

  if (!isRecord(payload)) {
    return ['Request body must be a JSON object'];
  }

  checkUnknownFields(payload, rootFields, '', errors);
  checkString(payload.gameId, 'gameId', errors, 100);
  checkString(payload.location, 'location', errors, 200);
  validateTeam(payload.teamA, 'teamA', errors);
  validateTeam(payload.teamB, 'teamB', errors);
  validateTeams(payload.teams, errors);
  for (const field of ['status']) {
    if (payload[field] !== undefined) checkString(payload[field], field, errors, 50);
  }
  for (const field of ['startedAt', 'completedAt']) {
    if (payload[field] !== undefined && (
      typeof payload[field] !== 'string' ||
      Number.isNaN(Date.parse(payload[field]))
    )) {
      errors.push(`${field} must be a valid date string`);
    }
  }
  if (payload.boxScore !== undefined) validateBoxScore(payload.boxScore, errors);
  if (payload.events !== undefined) {
    if (!Array.isArray(payload.events)) {
      errors.push('events must be an array');
    } else {
      payload.events.forEach((event, index) => {
        if (!isRecord(event)) errors.push(`events[${index}] must be an object`);
      });
    }
  }
  validateImageGeneration(payload.imageGeneration, errors);

  if (!Array.isArray(payload.players)) {
    errors.push('players must be an array');
  } else {
    const playerIds = new Set();
    payload.players.forEach((player, index) => {
      const path = `players[${index}]`;
      validatePlayer(player, path, errors);
      if (isRecord(player) && typeof player.id === 'string') {
        if (playerIds.has(player.id)) {
          errors.push(`${path}.id must be unique within the game`);
        }
        playerIds.add(player.id);
      }
    });
  }

  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > maxGameDocumentBytes) {
    errors.push('The complete game payload must be at most 14 MB so it fits safely in MongoDB');
  }

  return errors;
}
