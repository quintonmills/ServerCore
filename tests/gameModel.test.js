import test from 'node:test';
import assert from 'node:assert/strict';
import Game from '../src/models/Game.js';
import Player from '../src/models/Player.js';
import Team from '../src/models/Team.js';

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
        photos: [
          'data:image/jpeg;base64,aGVsbG8=',
          'data:image/jpeg;base64,aGVsbG8=',
          'data:image/jpeg;base64,aGVsbG8=',
        ],
      },
      {
        id: 'p2',
        team: 'Team B',
        jersey: '4',
        name: 'Jordan',
        pts: 0,
        reb: 0,
        ast: 0,
        stl: 0,
        blk: 0,
        to: 0,
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
  assert.equal(game.players[0].photos.length, 3);
  assert.equal(game.players[1].photos, undefined);
  assert.equal(game.imageGeneration.prompt, 'Arena spotlight');
});

test('game schema stores teams, box scores, play-by-play events, and generated media', () => {
  const game = new Game({
    gameId: 'game-102',
    location: 'ScoreKings Arena',
    teamA: { name: 'Red Team', score: 24 },
    teamB: { name: 'Blue Team', score: 18 },
    teams: {
      home: { teamId: 'red', name: 'Red Team', score: 24 },
      away: { teamId: 'blue', name: 'Blue Team', score: 18 },
    },
    players: [],
    boxScore: [{ playerId: 'player-1', PTS: 14, REB: 5 }],
    events: [{ type: 'shot_made', period: 1, points: 2 }],
    generatedMedia: [{
      type: 'flyer',
      playerId: 'player-1',
      publicUrl: 'https://cdn.example.com/flyer.jpg',
      downloadUrl: 'https://api.example.com/flyer/download',
    }],
    startedAt: '2026-10-26T12:00:00.000Z',
    completedAt: '2026-10-26T13:00:00.000Z',
  });

  test('game schema accepts the variable one-to-three photo payload from the frontend', () => {
    const game = new Game({
      gameId: 'game-103',
      location: 'ScoreKings Arena',
      teamA: { name: 'Red Team', score: 4 },
      teamB: { name: 'Blue Team', score: 0 },
      players: [{
        id: 'player-1',
        team: 'Team A',
        jersey: '3',
        name: 'Marcus',
        pts: 4,
        reb: 0,
        ast: 0,
        stl: 0,
        blk: 0,
        to: 0,
        photos: ['one', 'two'],
      }],
    });

    assert.equal(game.validateSync(), undefined);
  });

  assert.equal(game.validateSync(), undefined);
  assert.equal(game.boxScore[0].PTS, 14);
  assert.equal(game.events[0].type, 'shot_made');
  assert.equal(game.generatedMedia[0].downloadUrl, 'https://api.example.com/flyer/download');
  assert.equal(game.teams.home.teamId, 'red');
});

test('player and team schemas expose the identifiers and metric fields used by the API', () => {
  const player = new Player({
    playerId: 'player-1',
    firstName: 'Marcus',
    lastName: 'Example',
    jersey: '3',
    teamId: 'red',
    careerStats: { PTS: 14, REB: 5 },
  });
  const team = new Team({ teamId: 'red', name: 'Red Team', logoUrl: 'https://cdn.example.com/red.png' });

  assert.equal(player.validateSync(), undefined);
  assert.equal(team.validateSync(), undefined);
  assert.equal(player.careerStats.PTS, 14);
  assert.equal(team.logoUrl, 'https://cdn.example.com/red.png');
});
