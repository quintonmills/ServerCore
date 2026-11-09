import test from 'node:test';
import assert from 'node:assert/strict';
import { selectPlayersForCards } from '../src/services/selectPlayersForCards.js';

test('selects up to five impressive stat lines ranked by points, rebounds, then assists', () => {
  const players = [
    { id: 'a', pts: 18, reb: 4, ast: 2 },
    { id: 'b', pts: 20, reb: 1, ast: 0 },
    { id: 'c', pts: 10, reb: 10, ast: 3 },
    { id: 'd', pts: 10, reb: 10, ast: 3 },
    { id: 'e', pts: 0, reb: 20, ast: 20 },
    { id: 'f', pts: 19, reb: 1, ast: 1 },
    { id: 'ordinary', pts: 17, reb: 4, ast: 2 },
  ];

  assert.deepEqual(selectPlayersForCards(players).map((player) => player.id), ['b', 'f', 'a', 'c', 'd']);
});

test('does not mutate input and skips players without impressive stats', () => {
  const players = [
    { id: 'a', pts: 0, reb: 1, ast: 1 },
    { id: 'b', pts: 17, reb: 0, ast: 0 },
    { id: 'c', pts: 18, reb: 0, ast: 0 },
  ];
  const original = structuredClone(players);

  assert.deepEqual(selectPlayersForCards(players).map((player) => player.id), ['c']);
  assert.deepEqual(players, original);
});

test('selects a top performer even without a standard stat threshold', () => {
  const players = [
    { id: 'ordinary', pts: 12, reb: 3, ast: 2 },
    { id: 'top-performer', pts: 12, reb: 3, ast: 2, topPerformer: true },
  ];

  assert.deepEqual(selectPlayersForCards(players).map((player) => player.id), ['top-performer']);
});
