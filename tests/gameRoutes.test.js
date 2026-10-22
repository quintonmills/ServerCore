import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

const payload = {
  gameId: 'game-101',
  location: 'Marietta Rec League',
  teamA: { name: 'Red Team', score: 24, logo: 'data:image/png;base64,aGVsbG8=' },
  teamB: { name: 'Blue Team', score: 18 },
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
      photo: 'data:image/png;base64,aGVsbG8=',
    },
  ],
};

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
  let renderCalls = 0;
  const GameModel = {
    async findOneAndUpdate(filter, update) {
      savedPayload = update.$set;
      assert.deepEqual(filter, { gameId: 'game-101' });
      return { ...savedPayload, createdAt: new Date('2026-01-01T00:00:00.000Z') };
    },
  };
  const app = createApp({
    GameModel,
    publicBaseUrl: 'http://localhost:5000',
    graphicGenerator: async (player, game, options) => {
      renderCalls += 1;
      assert.equal(options.playerImage, payload.players[0].photo);
      assert.equal(options.teamLogoImage, payload.teamA.logo);
      return { filePath: '/tmp/test-card.jpg', publicUrl: `/output/${player.id}.jpg` };
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/games/finalize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.game.gameId, 'game-101');
    assert.equal(body.graphics[0].playerId, 'p1');
    assert.equal(body.graphics[0].publicUrl, '/output/p1.jpg');
    assert.equal(savedPayload.gameId, 'game-101');
    assert.equal(savedPayload.players[0].photo, payload.players[0].photo);
    assert.equal(savedPayload.teamA.logo, payload.teamA.logo);
    assert.deepEqual(savedPayload.imageGeneration, {
      ...payload.imageGeneration,
      size: '1024x1536',
    });
    assert.equal(body.game.players[0].photo, undefined);
    assert.equal(body.game.teamA.logo, undefined);
    assert.equal(renderCalls, 1);
  });
});

test('invalid payload returns a consistent 400 response without persistence', async () => {
  let saveCalls = 0;
  const app = createApp({
    GameModel: {
      async findOneAndUpdate() {
        saveCalls += 1;
      },
    },
    graphicGenerator: async () => {
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

test('selected players must include a photo and their team must include a logo', async () => {
  let saveCalls = 0;
  const incompletePayload = structuredClone(payload);
  delete incompletePayload.players[0].photo;
  delete incompletePayload.teamA.logo;
  const app = createApp({
    GameModel: {
      async findOneAndUpdate() {
        saveCalls += 1;
      },
    },
    graphicGenerator: async () => {
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

    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.ok(body.error.details.some((detail) => detail.includes('.photo is required')));
    assert.ok(body.error.details.some((detail) => detail.includes('teamA.logo is required')));
    assert.equal(saveCalls, 0);
  });
});

test('rendering failure returns an error and removes cards already generated in the request', async () => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'scorekings-test-'));
  const generatedPath = path.join(temporaryDirectory, 'first-card.jpg');
  let renderCalls = 0;
  const game = {
    ...payload,
    players: [
      payload.players[0],
      { ...payload.players[0], id: 'p2', name: 'Alex', pts: 8 },
    ],
  };
  const app = createApp({
    GameModel: {
      async findOneAndUpdate() {
        return game;
      },
    },
    graphicGenerator: async () => {
      renderCalls += 1;
      if (renderCalls === 1) {
        await writeFile(generatedPath, 'test graphic');
        return { filePath: generatedPath, publicUrl: '/output/first-card.jpg' };
      }
      throw new Error('Rendering failed');
    },
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/games/finalize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(game),
      });
      const body = await response.json();

      assert.equal(response.status, 500);
      assert.equal(body.error.code, 'INTERNAL_SERVER_ERROR');
      assert.equal(renderCalls, 2);
      await assert.rejects(access(generatedPath), { code: 'ENOENT' });
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('health endpoint is available without a database', async () => {
  const app = createApp();
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

test('malformed JSON returns a 400 JSON error envelope', async () => {
  const app = createApp();
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
