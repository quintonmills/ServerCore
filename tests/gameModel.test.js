import test from 'node:test';
import assert from 'node:assert/strict';
import Game from '../src/models/Game.js';
import Player from '../src/models/Player.js';
import Team from '../src/models/Team.js';

test('game schema stores reference images and image-generation settings', () => {
  const game = new Game({
    gameId: 'game-101',
    location: 'Marietta Rec League',
    timestamps: {
      createdAt: '2026-10-26T12:00:00.000Z',
      updatedAt: '2026-10-26T12:00:00.000Z',
    },
    gameData: {
      teamName: 'Red Team',
      players: {
      Marcus: {
        id: 'p1',
        firstName: 'Marcus',
        lastName: 'Example',
        teamId: 'red-team',
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
      Jordan: {
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
      },
    },
    media: {
      team: { logo: 'data:image/png;base64,aGVsbG8=' },
      players: [{
        playerId: 'p1',
        photos: [
          'data:image/jpeg;base64,aGVsbG8=',
          'data:image/jpeg;base64,aGVsbG8=',
          'data:image/jpeg;base64,aGVsbG8=',
        ],
      }],
      imageGeneration: {
        prompt: 'Arena spotlight',
        size: '1024x1536',
        quality: 'high',
      },
    },
  });

  assert.equal(game.validateSync(), undefined);
  assert.equal(game.media.team.logo, 'data:image/png;base64,aGVsbG8=');
  assert.equal(game.media.players[0].photos.length, 3);
  assert.equal(game.gameData.players.Marcus.firstName, 'Marcus');
  assert.equal(game.gameData.players.Marcus.lastName, 'Example');
  assert.equal(game.gameData.players.Marcus.teamId, 'red-team');
  assert.equal(game.media.players.length, 1);
  assert.equal(game.media.imageGeneration.prompt, 'Arena spotlight');
  assert.equal(game.createdAt, undefined);
  assert.equal(Game.schema.path('gameData.players').instance, 'Mixed');
  assert.equal(Game.schema.path('gameData.events').instance, 'Map');
  assert.equal(Game.schema.path('gameData.boxScore').instance, 'Array');
  assert.equal(Game.schema.path('timestamps.startedAt').instance, 'Date');
  assert.equal(Game.schema.path('generatedMedia'), undefined);
});

test('game schema stores an optional idempotency key', () => {
  const game = new Game({
    gameId: 'game-idempotency',
    idempotencyKey: 'finalize-request-1',
    location: 'ScoreKings Arena',
    timestamps: { createdAt: new Date(), updatedAt: new Date() },
    gameData: {
      teamName: 'Red Team',
      players: [],
    },
  });

  assert.equal(game.validateSync(), undefined);
  assert.equal(game.idempotencyKey, 'finalize-request-1');
  assert.equal(Game.schema.indexes().some(([index, options]) =>
    index.idempotencyKey === 1 && options.unique && options.sparse,
  ), true);
  assert.equal(Game.schema.indexes().some(([index, options]) =>
    index.gameId === 1 && options.unique,
  ), false);
});

test('game schema stores a team name, box scores, play-by-play events, and generated media', () => {
  const game = new Game({
    gameId: 'game-102',
    location: 'ScoreKings Arena',
    timestamps: {
      startedAt: '2026-10-26T12:00:00.000Z',
      completedAt: '2026-10-26T13:00:00.000Z',
      createdAt: '2026-10-26T12:00:00.000Z',
      updatedAt: '2026-10-26T13:00:00.000Z',
    },
    gameData: {
      teamName: 'Red Team',
      players: [],
      boxScore: [{
        playerId: 'player-1',
        PTS: 14,
        REB: 5,
        AST: 3,
        STL: 1,
        BLK: 2,
        TOV: 1,
        MIN: 32,
        FG: 6,
        FGA: 12,
        FG3: 2,
        FG3A: 5,
        FT: 2,
        FTA: 3,
        OREB: 1,
        DREB: 4,
        PF: 2,
        PLUS_MINUS: -3,
      }],
      events: { shot_made: { type: 'shot_made', period: 1, points: 2 } },
    },
    media: {
      generatedMedia: [{
        type: 'flyer',
        playerId: 'player-1',
        publicUrl: 'https://cdn.example.com/flyer.jpg',
        downloadUrl: 'https://api.example.com/flyer/download',
      }],
    },
  });

  test('game schema accepts the variable one-to-three photo payload from the frontend', () => {
    const game = new Game({
      gameId: 'game-103',
      location: 'ScoreKings Arena',
      timestamps: { createdAt: new Date(), updatedAt: new Date() },
      gameData: {
        teamName: 'Red Team',
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
        }],
      },
      media: { players: [{ playerId: 'player-1', photos: ['one', 'two'] }] },
    });

    assert.equal(game.validateSync(), undefined);
  });

  assert.equal(game.validateSync(), undefined);
  assert.equal(game.gameData.boxScore[0].PTS, 14);
  assert.equal(game.gameData.boxScore[0].PLUS_MINUS, -3);
  assert.equal(game.gameData.boxScore[0].FG3A, 5);
  assert.equal(game.gameData.events.get('shot_made').type, 'shot_made');
  assert.equal(game.media.generatedMedia[0].downloadUrl, 'https://api.example.com/flyer/download');
  assert.equal(game.gameData.teamName, 'Red Team');
});

test('player and team schemas expose the identifiers and metric fields used by the API', () => {
  const player = new Player({
    playerId: 'player-1',
    firstName: 'Marcus',
    lastName: 'Example',
    jersey: '3',
    teamId: 'red',
    careerStats: { pts: 14, reb: 5, gamesPlayed: 1 },
  });
  const team = new Team({ teamId: 'red', name: 'Red Team', logoUrl: 'https://cdn.example.com/red.png' });

  assert.equal(player.validateSync(), undefined);
  assert.equal(team.validateSync(), undefined);
  assert.equal(player.careerStats.pts, 14);
  assert.equal(team.logoUrl, 'https://cdn.example.com/red.png');
});

test('game and player schemas store licensing metadata and typed play-by-play fields', () => {
  const game = new Game({
    gameId: 'game-104',
    location: 'ScoreKings Arena',
    timestamps: { createdAt: new Date(), updatedAt: new Date() },
    gameData: {
      teamName: 'Red Team',
      players: [],
      events: {
        pts_2: {
          period: 'Q1',
          playerId: 'player-1',
          action: 'PTS_2',
          timestamp: '2026-10-26T12:00:00.000Z',
          resultingScore: { teamA: 2, teamB: 0 },
        },
      },
    },
    status: 'COMPLETED',
    metadata: { testMode: false, verifiedForLicensing: true },
  });
  const player = new Player({
    playerId: 'player-2',
    firstName: 'Alex',
    careerStats: { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, to: 0, gamesPlayed: 0 },
  });

  assert.equal(game.validateSync(), undefined);
  assert.equal(game.status, 'COMPLETED');
  assert.equal(game.metadata.verifiedForLicensing, true);
  assert.equal(game.gameData.events.get('pts_2').action, 'PTS_2');
  assert.equal(game.gameData.events.get('pts_2').resultingScore.teamA, 2);
  assert.equal(player.validateSync(), undefined);
  assert.equal(game.media.generatedMedia.length, 0);
});
