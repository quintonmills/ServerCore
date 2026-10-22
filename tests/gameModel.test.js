import test from 'node:test';
import assert from 'node:assert/strict';
import Game from '../src/models/Game.js';

test('game schema stores reference images and image-generation settings', () => {
  const game = new Game({
    gameId: 'game-101',
    location: 'Marietta Rec League',
    teamA: {
      name: 'Red Team',
      score: 24,
      logo: 'data:image/png;base64,aGVsbG8=',
    },
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
        photo: 'data:image/jpeg;base64,aGVsbG8=',
      },
    ],
    imageGeneration: {
      prompt: 'Arena spotlight',
      size: '1024x1536',
      quality: 'high',
    },
  });

  assert.equal(game.validateSync(), undefined);
  assert.equal(game.teamA.logo, 'data:image/png;base64,aGVsbG8=');
  assert.equal(game.players[0].photo, 'data:image/jpeg;base64,aGVsbG8=');
  assert.equal(game.imageGeneration.prompt, 'Arena spotlight');
});
