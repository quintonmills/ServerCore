import test from 'node:test';
import assert from 'node:assert/strict';
import { createRasterImageDataUrl } from './rasterImageFixtures.js';
import { validateGamePayload } from '../src/utils/validateGamePayload.js';

const validPayload = {
  gameId: 'game-101',
  location: 'Marietta Rec League',
  teamA: { name: 'Red Team', score: 24 },
  teamB: { name: 'Blue Team', score: 18 },
  players: [
    {
      id: 'p1',
      team: 'Team A',
      jersey: '3',
      name: 'Marcus',
      pts: 14,
      reb: 5,
      ast: 3,
      stl: 1,
      blk: 0,
      to: 2,
    },
  ],
};

test('accepts the frontend game-finalization payload without quarter, clock, or date', () => {
  assert.deepEqual(validateGamePayload(validPayload), []);
});

test('accepts game history fields and nested or flattened box-score metrics', () => {
  const payload = structuredClone(validPayload);
  payload.status = 'completed';
  payload.startedAt = '2026-10-26T12:00:00.000Z';
  payload.completedAt = '2026-10-26T13:00:00.000Z';
  payload.events = [{ type: 'shot_made', period: 1, playerId: 'p1' }];
  payload.teams = {
    home: { teamId: 'team-a', name: 'Red Team', score: 24 },
    away: { teamId: 'team-b', name: 'Blue Team', score: 18 },
  };
  payload.boxScore = [
    { playerId: 'p1', teamId: 'team-a', stats: { PTS: 14, PLUS_MINUS: -2 } },
    { playerId: 'p2', PTS: 8, REB: 4, AST: 2 },
  ];

  assert.deepEqual(validateGamePayload(payload), []);
});

test('rejects malformed play-by-play entries, timestamps, and box-score metrics', () => {
  const payload = structuredClone(validPayload);
  payload.startedAt = 'not-a-date';
  payload.events = ['shot made'];
  payload.boxScore = [{ playerId: 'p1', PTS: -1 }];

  const errors = validateGamePayload(payload);
  assert.ok(errors.some((error) => error.includes('startedAt')));
  assert.ok(errors.some((error) => error.includes('events[0]')));
  assert.ok(errors.some((error) => error.includes('boxScore[0].PTS')));
});

test('reports invalid types, negative stats, invalid teams, and extra path fields', () => {
  const payload = structuredClone(validPayload);
  payload.teamA.score = '24';
  payload.players[0].pts = -1;
  payload.players[0].team = 'Team C';
  payload.outputPath = '/tmp/card.jpg';

  const errors = validateGamePayload(payload);
  assert.ok(errors.some((error) => error.includes('teamA.score')));
  assert.ok(errors.some((error) => error.includes('players[0].pts')));
  assert.ok(errors.some((error) => error.includes('players[0].team')));
  assert.ok(errors.some((error) => error.includes('outputPath is not allowed')));
});

test('rejects duplicate player IDs and non-object request bodies', () => {
  const payload = structuredClone(validPayload);
  payload.players.push({ ...payload.players[0] });

  assert.ok(validateGamePayload(payload).some((error) => error.includes('must be unique')));
  assert.deepEqual(validateGamePayload(null), ['Request body must be a JSON object']);
});

test('validates uploaded image data URLs and image-generation options', () => {
  const payload = structuredClone(validPayload);
  payload.players[0].photo = 'https://example.com/player.png';
  payload.teamA.logo = 'data:image/gif;base64,aGVsbG8=';
  payload.imageGeneration = { size: '500x500', quality: 'ultra', extra: true };

  const errors = validateGamePayload(payload);
  assert.ok(errors.some((error) => error.includes('players[0].photo')));
  assert.ok(errors.some((error) => error.includes('teamA.logo')));
  assert.ok(errors.some((error) => error.includes('imageGeneration.size')));
  assert.ok(errors.some((error) => error.includes('imageGeneration.quality')));
  assert.ok(errors.some((error) => error.includes('imageGeneration.extra')));
});

test('accepts one to three player reference photos and rejects empty or oversized arrays', () => {
  const payload = structuredClone(validPayload);
  payload.players[0].photos = [
    createRasterImageDataUrl('png'),
    createRasterImageDataUrl('jpeg'),
  ];
  assert.deepEqual(validateGamePayload(payload), []);

  payload.players[0].photos = [];
  assert.ok(validateGamePayload(payload).some((error) => error.includes('between one and three')));
  payload.players[0].photos = [
    createRasterImageDataUrl('png'),
    createRasterImageDataUrl('jpeg'),
    createRasterImageDataUrl('webp'),
    createRasterImageDataUrl('png'),
  ];
  assert.ok(validateGamePayload(payload).some((error) => error.includes('between one and three')));
});

test('rejects malformed base64, unsupported MIME types, and MIME/signature mismatches', async () => {
  const payload = structuredClone(validPayload);
  const jpeg = createRasterImageDataUrl('jpeg');
  payload.players[0].photo = 'data:image/png;base64,not-base64!';
  payload.teamA.logo = jpeg.replace('image/jpeg', 'image/png');

  const errors = validateGamePayload(payload);
  assert.ok(errors.some((error) => error.includes('players[0].photo')));
  assert.ok(errors.some((error) => error.includes('teamA.logo contents do not match')));
});
