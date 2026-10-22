import test from 'node:test';
import assert from 'node:assert/strict';
import { selectPlayersForCards } from '../src/services/selectPlayersForCards.js';

test('selects up to three scorers ranked by points, rebounds, then assists', () => {
  const players = [
    { id: 'a', pts: 10, reb: 4, ast: 2 },
    { id: 'b', pts: 12, reb: 1, ast: 0 },
    { id: 'c', pts: 10, reb: 4, ast: 3 },
    { id: 'd', pts: 10, reb: 4, ast: 3 },
    { id: 'e', pts: 0, reb: 20, ast: 20 },
  ];

  assert.deepEqual(selectPlayersForCards(players).map((player) => player.id), ['b', 'c', 'd']);
});

test('does not mutate input and returns fewer than three when fewer players scored', () => {
  const players = [
    { id: 'a', pts: 0, reb: 1, ast: 1 },
    { id: 'b', pts: 2, reb: 0, ast: 0 },
  ];
  const original = structuredClone(players);

  assert.deepEqual(selectPlayersForCards(players).map((player) => player.id), ['b']);
  assert.deepEqual(players, original);
});
