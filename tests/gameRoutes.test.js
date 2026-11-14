import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { ImageGenerationError } from '../src/utils/rasterImage.js';
import { createGeneratedJpegBuffer, createRasterImageDataUrl } from './rasterImageFixtures.js';

const pngDataUrl = createRasterImageDataUrl();
const outputDirectory = fileURLToPath(new URL('../output/', import.meta.url));
const payload = {
  gameId: 'game-101',
  location: 'Marietta Rec League',
  teamA: { teamId: 'red-team', name: 'Red Team', score: 24, logo: pngDataUrl },
  teamB: { teamId: 'blue-team', name: 'Blue Team', score: 18 },
  imageGeneration: { prompt: 'arena spotlight', quality: 'medium' },
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
      photos: [pngDataUrl, pngDataUrl, pngDataUrl],
    },
  ],
  boxScore: [
    {
      playerId: 'p1',
      firstName: 'Marcus',
      jersey: '3',
      PTS: 14,
      REB: 5,
      AST: 3,
      STL: 1,
      BLK: 0,
      TOV: 2,
    },
  ],
  events: [{
    period: 1,
    playerId: 'p1',
    action: 'PTS_2',
    timestamp: '2026-10-26T12:00:00.000Z',
    resultingScore: { teamA: 2, teamB: 0 },
  }],
  metadata: { testMode: false, verifiedForLicensing: true },
};

function createTestApp(options = {}) {
  return createApp({
    PlayerModel: {
      async findOneAndUpdate() {},
      async exists() { return null; },
    },
    TeamModel: { async findOneAndUpdate() {} },
    ...options,
  });
}

function createGameModel(onCreate = () => {}) {
  const games = new Map();
  return {
    async findOneAndUpdate(filter, update) {
      let game = games.get(filter.gameId);
      if (filter.payloadHash?.$exists === false) {
        if (!game || game.payloadHash !== undefined) return null;
        game.payloadHash = update.$set.payloadHash;
        return game;
      }
      if (typeof filter.payloadHash === 'string') {
        if (game && game.payloadHash !== filter.payloadHash) {
          const error = new Error('Duplicate game ID');
          error.code = 11000;
          throw error;
        }
        if (!game) {
          game = {
            ...update.$setOnInsert,
            _id: 'mongo-game-id',
            generatedMedia: [],
          };
          games.set(filter.gameId, game);
          onCreate(game, update.$setOnInsert);
        }
        return game;
      }

      if (!game) return null;
      const eligibleStates = filter.$or?.some((condition) => {
        const status = condition['flyerGeneration.status'];
        if (status?.$in) return status.$in.includes(game.flyerGeneration.status);
        return status === game.flyerGeneration.status &&
          game.flyerGeneration.updatedAt < condition['flyerGeneration.updatedAt'].$lt;
      });
      if (filter.$or && !eligibleStates) {
        return null;
      }
      for (const [key, value] of Object.entries(update.$set || {})) {
        const [parent, child] = key.split('.');
        if (child) game[parent][child] = value;
        else game[key] = value;
      }
      for (const key of Object.keys(update.$unset || {})) {
        const [parent, child] = key.split('.');
        if (child) delete game[parent][child];
        else delete game[key];
      }
      for (const [key, value] of Object.entries(update.$inc || {})) {
        const [parent, child] = key.split('.');
        game[parent][child] += value;
      }
      if (update.$push?.generatedMedia) {
        game.generatedMedia.push(...update.$push.generatedMedia.$each);
      }
      return game;
    },
    async findOne(filter) {
      return games.get(filter.gameId) || null;
    },
  };
}

async function withServer(app, run) {
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test('finalize persists the supplied game ID and returns generated graphics', async () => {
  let savedPayload;
  let savedGame;
  const renderedPlayers = [];
  const statUpdates = [];
  const teamUpdates = [];
  const flyerBuffer = createGeneratedJpegBuffer();
  const flyerPaths = [];
  const multiPlayerPayload = {
    ...payload,
    teamB: { ...payload.teamB, logo: pngDataUrl },
    boxScore: [
      ...payload.boxScore,
      { playerId: 'p2', firstName: 'Alex', PTS: 18 },
      { playerId: 'p3', firstName: 'Jordan', PTS: 14, REB: 8 },
    ],
    events: [...payload.events, { type: 'rebound', period: 2, playerId: 'p3' }],
    players: [
      ...payload.players,
      {
        ...payload.players[0],
        id: 'p2',
        team: 'Team B',
        name: 'Alex',
        pts: 18,
        photos: [pngDataUrl, pngDataUrl, pngDataUrl],
      },
      {
        ...payload.players[0],
        id: 'p3',
        name: 'Jordan',
        pts: 14,
        reb: 10,
      },
    ],
  };
  const GameModel = createGameModel((game, gamePayload) => {
    savedPayload = gamePayload;
    savedGame = game;
    savedGame._id = 'mongo-game-id';
  });
  const app = createTestApp({
    GameModel,
    PlayerModel: {
      async findOneAndUpdate(filter, update) { statUpdates.push({ filter, update }); },
      async exists() { return null; },
    },
    TeamModel: {
      async findOneAndUpdate(filter, update) { teamUpdates.push({ filter, update }); },
    },
    publicBaseUrl: 'https://scorekings-api.example.com',
    flyerGenerator: async (player, game, options) => {
      renderedPlayers.push(player.id);
      assert.deepEqual(options.playerImages, [pngDataUrl, pngDataUrl, pngDataUrl]);
      assert.equal(options.teamLogoImage, pngDataUrl);
      const filename = `game-101-${player.id}-${randomUUID()}.jpg`;
      const flyerPath = path.join(outputDirectory, filename);
      flyerPaths.push(flyerPath);
      await mkdir(outputDirectory, { recursive: true });
      await writeFile(flyerPath, flyerBuffer);
      return {
        filePath: flyerPath,
        publicUrl: `https://scorekings-api.example.com/output/${filename}`,
        downloadUrl: `https://scorekings-api.example.com/api/games/flyers/${filename}/download`,
      };
    },
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/games/finalize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(multiPlayerPayload),
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.game.gameId, 'game-101');
      assert.equal(body.game._id, 'mongo-game-id');
      assert.equal(body.game.events.length, 2);
      assert.equal(body.game.boxScore.length, 3);
      assert.equal(body.game.generatedMedia[0].publicUrl, body.graphics[0].publicUrl);
      assert.equal(body.graphics.length, 3);
      assert.deepEqual(renderedPlayers, ['p2', 'p3', 'p1']);
      assert.equal(body.graphics[0].playerId, 'p2');
      const graphicFilename = path.basename(body.graphics[0].filePath);
      assert.equal(
        body.graphics[0].publicUrl,
        `https://scorekings-api.example.com/output/${graphicFilename}`,
      );
      assert.equal(
        body.graphics[0].downloadUrl,
        `https://scorekings-api.example.com/api/games/flyers/${graphicFilename}/download`,
      );
      assert.equal(savedPayload.gameId, 'game-101');
      assert.equal(savedPayload.status, 'COMPLETED');
      assert.equal(savedPayload.boxScore[0].PTS, 14);
      assert.equal(savedPayload.events.length, 2);
      assert.equal(savedPayload.events[0].action, 'PTS_2');
      assert.equal(savedPayload.events[0].resultingScore.teamA, 2);
      assert.equal(statUpdates.length, 3);
      assert.deepEqual(statUpdates[0].filter, {
        playerId: 'p1',
        'careerStats.appliedGameIds': { $ne: 'game-101' },
      });
      assert.equal(statUpdates[0].update.$inc['careerStats.pts'], 14);
      assert.equal(statUpdates[0].update.$inc['careerStats.gamesPlayed'], 1);
      assert.equal(savedPayload.metadata.verifiedForLicensing, true);
      assert.equal(statUpdates[0].update.$set.teamId, 'red-team');
      assert.equal(teamUpdates.length, 2);
      assert.equal(savedPayload.teams.home.teamId, 'red-team');
      assert.deepEqual(savedPayload.players[0].photos, multiPlayerPayload.players[0].photos);
      assert.equal(savedPayload.teamA.logo, multiPlayerPayload.teamA.logo);
      assert.deepEqual(savedPayload.imageGeneration, {
        ...multiPlayerPayload.imageGeneration,
        size: '1024x1536',
      });
      assert.equal(body.game.players[0].photos, undefined);
      assert.equal(body.game.teamA.logo, undefined);
      assert.equal(renderedPlayers.length, 3);

      const downloadUrl = new URL(body.graphics[0].downloadUrl);
      downloadUrl.host = new URL(baseUrl).host;
      downloadUrl.protocol = new URL(baseUrl).protocol;
      const downloadResponse = await fetch(downloadUrl);
      assert.equal(downloadResponse.status, 200);
      assert.equal(downloadResponse.headers.get('content-type'), 'image/jpeg');
      assert.match(downloadResponse.headers.get('content-disposition'), /^attachment;/);
      assert.deepEqual(Buffer.from(await downloadResponse.arrayBuffer()), flyerBuffer);
    });
  } finally {
    await Promise.all(flyerPaths.map((flyerPath) => rm(flyerPath, { force: true })));
  }
});

test('finalize evaluates and generates a five-player graphic pack concurrently', async () => {
  const statUpdates = [];
  let savedGame;
  let activeGenerations = 0;
  let maxActiveGenerations = 0;
  const fivePlayerPayload = {
    ...payload,
    players: Array.from({ length: 5 }, (_, index) => ({
      ...payload.players[0],
      id: `p${index + 1}`,
      name: `Player ${index + 1}`,
      pts: index + 18,
      photos: [pngDataUrl],
    })),
    boxScore: undefined,
  };
  const app = createTestApp({
    GameModel: createGameModel(),
    PlayerModel: {
      async findOneAndUpdate(filter, update) { statUpdates.push({ filter, update }); },
      async exists() { return null; },
    },
    publicBaseUrl: 'https://scorekings-api.example.com',
    flyerGenerator: async (player) => {
      activeGenerations += 1;
      maxActiveGenerations = Math.max(maxActiveGenerations, activeGenerations);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeGenerations -= 1;
      return {
        filePath: `/tmp/${player.id}.jpg`,
        publicUrl: `https://scorekings-api.example.com/output/${player.id}.jpg`,
        downloadUrl: `https://scorekings-api.example.com/api/games/flyers/${player.id}.jpg/download`,
      };
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/games/finalize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(fivePlayerPayload),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.graphics.map((graphic) => graphic.playerId), ['p5', 'p4', 'p3', 'p2', 'p1']);
    assert.equal(body.game.boxScore.length, 5);
    assert.equal(body.game.generatedMedia.length, 5);
    assert.equal(statUpdates.length, 5);
    assert.equal(maxActiveGenerations, 5);
    assert.deepEqual(body.graphics.map((graphic) => graphic.playerName), [
      'Player 5',
      'Player 4',
      'Player 3',
      'Player 2',
      'Player 1',
    ]);
  });
});

test('invalid payload returns a consistent 400 response without persistence', async () => {
  let saveCalls = 0;
  const app = createTestApp({
    GameModel: {
      async findOneAndUpdate() {
        saveCalls += 1;
      },
    },
    flyerGenerator: async () => {
      throw new Error('Renderer must not be called');
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/games/finalize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, gameId: '' }),
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.ok(body.error.details.some((detail) => detail.includes('gameId')));
    assert.equal(saveCalls, 0);
  });
});

test('persists game history when optional flyer photos or team logos are not supplied', async () => {
  let savedPayload;
  const incompletePayload = structuredClone(payload);
  delete incompletePayload.boxScore;
  incompletePayload.status = 'COMPLETED';
  incompletePayload.startedAt = '2026-10-26T12:00:00.000Z';
  incompletePayload.completedAt = '2026-10-26T13:00:00.000Z';
  delete incompletePayload.players[0].photos;
  delete incompletePayload.teamA.logo;
  const app = createTestApp({
    GameModel: createGameModel((game, gamePayload) => {
      savedPayload = gamePayload;
      game._id = 'saved-without-flyer';
    }),
    flyerGenerator: async () => {
      throw new Error('Renderer must not be called');
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/games/finalize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(incompletePayload),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.game._id, 'saved-without-flyer');
    assert.deepEqual(body.graphics, []);
    assert.equal(savedPayload.players[0].photos, undefined);
    assert.equal(savedPayload.status, 'COMPLETED');
    assert.equal(savedPayload.startedAt, incompletePayload.startedAt);
    assert.equal(savedPayload.completedAt, incompletePayload.completedAt);
    assert.equal(savedPayload.boxScore[0].playerId, 'p1');
    assert.equal(savedPayload.boxScore[0].PTS, 14);
    assert.equal(savedPayload.events.length, 1);
    assert.deepEqual(savedPayload.metadata, { testMode: false, verifiedForLicensing: true });
  });
});

test('rejects an invalid raster asset with a clear JSON error before persistence', async () => {
  let saveCalls = 0;
  const invalidPayload = structuredClone(payload);
  invalidPayload.players[0].photos[0] = 'data:image/png;base64,aGVsbG8=';
  const app = createTestApp({
    GameModel: {
      async findOneAndUpdate() {
        saveCalls += 1;
      },
    },
    flyerGenerator: async () => {
      throw new Error('Renderer must not be called');
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/games/finalize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(invalidPayload),
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'INVALID_IMAGE_ASSET');
    assert.match(body.error.details[0], /contents do not match the declared image\/png format/);
    assert.equal(saveCalls, 0);
  });
});

test('persists flyer failure status without failing game finalization', async () => {
  const impressivePayload = {
    ...payload,
    players: [{ ...payload.players[0], pts: 18 }],
  };
  const app = createTestApp({
    GameModel: createGameModel(),
    flyerGenerator: async () => {
      throw new ImageGenerationError();
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/games/finalize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(impressivePayload),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.game.status, 'COMPLETED');
    assert.equal(body.game.flyerGeneration.status, 'failed');
    assert.equal(
      body.game.flyerGeneration.lastError,
      'Flyer generation failed. Retry the flyer job to try again.',
    );
    assert.deepEqual(body.graphics, []);

    const statusResponse = await fetch(`${baseUrl}/api/games/game-101/flyers`);
    const status = await statusResponse.json();
    assert.equal(statusResponse.status, 200);
    assert.equal(status.flyerGeneration.status, 'failed');
    assert.deepEqual(status.graphics, []);
  });
});

test('persists games without an eligible flyer scorer', async () => {
  let saveCalls = 0;
  const noEligibleScorer = {
    ...payload,
    players: [{ ...payload.players[0], pts: 0 }],
  };
  const app = createTestApp({
    GameModel: createGameModel(() => {
      saveCalls += 1;
    }),
    flyerGenerator: async () => {
      throw new Error('Renderer must not be called');
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/games/finalize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(noEligibleScorer),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.graphics, []);
    assert.equal(body.game.gameId, 'game-101');
    assert.equal(saveCalls, 1);
  });
});

test('repeated finalization applies career totals once and rejects a conflicting game ID', async () => {
  const replayPayload = structuredClone(payload);
  delete replayPayload.players[0].photos;
  delete replayPayload.teamA.logo;
  const appliedGameIds = new Set();
  const totals = { pts: 0, gamesPlayed: 0 };
  let careerUpdateCalls = 0;
  const app = createTestApp({
    GameModel: createGameModel(),
    PlayerModel: {
      async findOneAndUpdate(filter, update) {
        careerUpdateCalls += 1;
        assert.deepEqual(filter, {
          playerId: 'p1',
          'careerStats.appliedGameIds': { $ne: 'game-101' },
        });
        if (appliedGameIds.has(update.$addToSet['careerStats.appliedGameIds'])) return;
        appliedGameIds.add(update.$addToSet['careerStats.appliedGameIds']);
        totals.pts += update.$inc['careerStats.pts'];
        totals.gamesPlayed += update.$inc['careerStats.gamesPlayed'];
      },
    },
  });

  await withServer(app, async (baseUrl) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/games/finalize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(replayPayload),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.game.payloadHash, undefined);
    }

    const conflictingResponse = await fetch(`${baseUrl}/api/games/finalize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...replayPayload, location: 'Different game' }),
    });
    const conflict = await conflictingResponse.json();
    assert.equal(conflictingResponse.status, 409);
    assert.equal(conflict.error.code, 'GAME_CONFLICT');
    assert.equal(careerUpdateCalls, 2);
    assert.deepEqual(totals, { pts: 14, gamesPlayed: 1 });
  });
});

test('a matching pre-ledger game is migrated without incrementing its career totals again', async () => {
  const replayPayload = structuredClone(payload);
  delete replayPayload.players[0].photos;
  delete replayPayload.teamA.logo;
  let storedGame;
  let incrementCalls = 0;
  let markerCalls = 0;
  const app = createTestApp({
    GameModel: createGameModel((game) => {
      storedGame = game;
    }),
    PlayerModel: {
      async findOneAndUpdate(_filter, update) {
        if (update.$inc) incrementCalls += 1;
        if (update.$addToSet && !update.$inc) markerCalls += 1;
      },
    },
  });

  await withServer(app, async (baseUrl) => {
    const finalize = () => fetch(`${baseUrl}/api/games/finalize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(replayPayload),
    });
    assert.equal((await finalize()).status, 200);
    delete storedGame.payloadHash;
    assert.equal((await finalize()).status, 200);
    assert.equal(incrementCalls, 1);
    assert.equal(markerCalls, 1);
    assert.match(storedGame.payloadHash, /^[a-f0-9]{64}$/);
  });
});

test('generic flyer failure is recorded and can be retried without resaving the game', async () => {
  const impressivePayload = {
    ...payload,
    players: [{ ...payload.players[0], pts: 18 }],
  };
  let renderCalls = 0;
  const app = createTestApp({
    GameModel: createGameModel(),
    flyerGenerator: async () => {
      renderCalls += 1;
      if (renderCalls === 1) throw new Error('Rendering failed');
      return {
        filePath: '/tmp/retry.jpg',
        publicUrl: 'https://scorekings-api.example.com/output/retry.jpg',
        downloadUrl: 'https://scorekings-api.example.com/api/games/flyers/retry.jpg/download',
      };
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/games/finalize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(impressivePayload),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.game.flyerGeneration.status, 'failed');
    assert.equal(body.graphics.length, 0);
    assert.equal(renderCalls, 1);

    const retryResponse = await fetch(`${baseUrl}/api/games/game-101/flyers/retry`, {
      method: 'POST',
    });
    const retryBody = await retryResponse.json();
    assert.equal(retryResponse.status, 200);
    assert.equal(retryBody.game.flyerGeneration.status, 'completed');
    assert.equal(retryBody.game.generatedMedia.length, 1);
    assert.equal(retryBody.graphics[0].playerId, 'p1');
    assert.equal(renderCalls, 2);

    const statusResponse = await fetch(`${baseUrl}/api/games/game-101/flyers`);
    const status = await statusResponse.json();
    assert.equal(status.flyerGeneration.status, 'completed');
    assert.equal(status.graphics.length, 1);
  });
});

test('retry generates only missing flyers after a partial generation failure', async () => {
  const multiPlayerPayload = {
    ...payload,
    players: [
      { ...payload.players[0], id: 'p1', pts: 18 },
      { ...payload.players[0], id: 'p2', name: 'Alex', pts: 17 },
    ],
    boxScore: undefined,
  };
  const calls = [];
  let firstPlayerAttempts = 0;
  const app = createTestApp({
    GameModel: createGameModel(),
    flyerGenerator: async (player) => {
      calls.push(player.id);
      if (player.id === 'p1' && firstPlayerAttempts++ === 0) {
        throw new Error('Temporary provider error');
      }
      return {
        filePath: `/tmp/${player.id}.jpg`,
        publicUrl: `https://scorekings-api.example.com/output/${player.id}.jpg`,
        downloadUrl: `https://scorekings-api.example.com/api/games/flyers/${player.id}.jpg/download`,
      };
    },
  });

  await withServer(app, async (baseUrl) => {
    const finalizeResponse = await fetch(`${baseUrl}/api/games/finalize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(multiPlayerPayload),
    });
    const finalized = await finalizeResponse.json();
    assert.equal(finalized.game.flyerGeneration.status, 'failed');
    assert.deepEqual(finalized.graphics.map((graphic) => graphic.playerId), ['p2']);

    const retryResponse = await fetch(`${baseUrl}/api/games/game-101/flyers/retry`, {
      method: 'POST',
    });
    const retried = await retryResponse.json();
    assert.equal(retried.game.flyerGeneration.status, 'completed');
    assert.deepEqual(calls, ['p1', 'p2', 'p1']);
    assert.deepEqual(
      retried.game.generatedMedia.map((graphic) => graphic.playerId),
      ['p2', 'p1'],
    );
    assert.deepEqual(retried.graphics.map((graphic) => graphic.playerId), ['p1']);
  });
});

test('health endpoint is available without a database', async () => {
  const app = createTestApp();
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });

    const missingRoute = await fetch(`${baseUrl}/api/does-not-exist`);
    assert.equal(missingRoute.status, 404);
    assert.deepEqual(await missingRoute.json(), {
      error: { code: 'NOT_FOUND', message: 'Resource not found' },
    });
  });
});

test('CORS allows each configured frontend origin and omits headers for other origins', async () => {
  const app = createTestApp({
    corsOrigin: 'https://scorekings.example.com, https://admin.example.com',
  });
  await withServer(app, async (baseUrl) => {
    for (const origin of ['https://scorekings.example.com', 'https://admin.example.com']) {
      const response = await fetch(`${baseUrl}/api/health`, {
        headers: { Origin: origin },
      });
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
    }

    const disallowedResponse = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'https://untrusted.example.com' },
    });
    assert.equal(disallowedResponse.headers.get('access-control-allow-origin'), null);
  });
});

test('malformed JSON returns a 400 JSON error envelope', async () => {
  const app = createTestApp();
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/games/finalize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: { code: 'BAD_REQUEST', message: 'Request body must contain valid JSON' },
    });
  });
});
