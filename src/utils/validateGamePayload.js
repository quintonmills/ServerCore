import { InvalidImageAssetError, parseRasterImageDataUrl } from './rasterImage.js';

const rootFields = new Set([
  'gameId',
  'location',
  'teamA',
  'teamB',
  'players',
  'imageGeneration',
]);
const teamFields = new Set(['name', 'score', 'logo']);
const playerFields = new Set([
  'id',
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
]);
const generationFields = new Set(['prompt', 'size', 'quality']);
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
  checkString(team.name, `${path}.name`, errors, 200);
  checkNumber(team.score, `${path}.score`, errors);
  checkImageDataUrl(team.logo, `${path}.logo`, errors);
}

function validatePlayer(player, path, errors) {
  if (!isRecord(player)) {
    errors.push(`${path} must be an object`);
    return;
  }

  checkUnknownFields(player, playerFields, `${path}.`, errors);
  checkString(player.id, `${path}.id`, errors, 100);
  checkString(player.jersey, `${path}.jersey`, errors, 10);
  checkString(player.name, `${path}.name`, errors, 200);
  checkImageDataUrl(player.photo, `${path}.photo`, errors);

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
