const rootFields = new Set(['gameId', 'location', 'teamA', 'teamB', 'players']);
const teamFields = new Set(['name', 'score']);
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
]);

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

function validateTeam(team, path, errors) {
  if (!isRecord(team)) {
    errors.push(`${path} must be an object`);
    return;
  }

  checkUnknownFields(team, teamFields, `${path}.`, errors);
  checkString(team.name, `${path}.name`, errors, 200);
  checkNumber(team.score, `${path}.score`, errors);
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

  if (player.team !== 'Team A' && player.team !== 'Team B') {
    errors.push(`${path}.team must be "Team A" or "Team B"`);
  }

  for (const stat of ['pts', 'reb', 'ast', 'stl', 'blk', 'to']) {
    checkNumber(player[stat], `${path}.${stat}`, errors);
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

  return errors;
}
