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
  teamA: { name: 'Red Team', score: 24, logo: pngDataUrl },
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
      photo: pngDataUrl,
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
  const filename = `game-101-p2-${randomUUID()}.jpg`;
  const flyerBuffer = createGeneratedJpegBuffer();
  const flyerPath = path.join(outputDirectory, filename);
  const multiPlayerPayload = {
    ...payload,
    teamB: { ...payload.teamB, logo: pngDataUrl },
    players: [
      ...payload.players,
      {
        ...payload.players[0],
        id: 'p2',
        team: 'Team B',
        name: 'Alex',
        pts: 18,
        photo: pngDataUrl,
      },
      {
        ...payload.players[0],
        id: 'p3',
        name: 'Jordan',
        pts: 14,
        reb: 8,
      },
    ],
  };
  const GameModel = {
    async findOneAndUpdate(filter, update) {
      savedPayload = update.$set;
      assert.deepEqual(filter, { gameId: 'game-101' });
      return { ...savedPayload, createdAt: new Date('2026-01-01T00:00:00.000Z') };
    },
  };
  const app = createApp({
    GameModel,
    publicBaseUrl: 'https://scorekings-api.example.com',
    flyerGenerator: async (player, game, options) => {
      renderCalls += 1;
      assert.equal(player.id, 'p2');
      assert.equal(options.playerImage, pngDataUrl);
      assert.equal(options.teamLogoImage, pngDataUrl);
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
      assert.equal(body.graphics.length, 1);
      assert.equal(body.graphics[0].playerId, 'p2');
      assert.equal(body.graphics[0].publicUrl, `https://scorekings-api.example.com/output/${filename}`);
      assert.equal(
        body.graphics[0].downloadUrl,
        `https://scorekings-api.example.com/api/games/flyers/${filename}/download`,
      );
      assert.equal(savedPayload.gameId, 'game-101');
      assert.equal(savedPayload.players[0].photo, multiPlayerPayload.players[0].photo);
      assert.equal(savedPayload.teamA.logo, multiPlayerPayload.teamA.logo);
      assert.deepEqual(savedPayload.imageGeneration, {
        ...multiPlayerPayload.imageGeneration,
        size: '1024x1536',
      });
      assert.equal(body.game.players[0].photo, undefined);
      assert.equal(body.game.teamA.logo, undefined);
      assert.equal(renderCalls, 1);

      const downloadUrl = new URL(body.graphics[0].downloadUrl);
      downloadUrl.host = new URL(baseUrl).host;
      const downloadResponse = await fetch(downloadUrl);
      assert.equal(downloadResponse.status, 200);
      assert.equal(downloadResponse.headers.get('content-type'), 'image/jpeg');
      assert.match(downloadResponse.headers.get('content-disposition'), /^attachment;/);
      assert.deepEqual(Buffer.from(await downloadResponse.arrayBuffer()), flyerBuffer);
    });
  } finally {
    await rm(flyerPath, { force: true });
  }
});

test('invalid payload returns a consistent 400 response without persistence', async () => {
  let saveCalls = 0;
  const app = createApp({
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

    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.ok(body.error.details.some((detail) => detail.includes('.photo is required')));
    assert.ok(body.error.details.some((detail) => detail.includes('teamA.logo is required')));
    assert.equal(saveCalls, 0);
  });
});

test('rejects an invalid raster asset with a clear JSON error before persistence', async () => {
  let saveCalls = 0;
  const invalidPayload = structuredClone(payload);
  invalidPayload.players[0].photo = 'data:image/png;base64,aGVsbG8=';
  const app = createApp({
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

test('returns a clear gateway error when image generation fails', async () => {
  const app = createApp({
    GameModel: {
      async findOneAndUpdate(_filter, update) {
        return update.$set;
      },
    },
    flyerGenerator: async () => {
      throw new ImageGenerationError();
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/games/finalize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json();

    assert.equal(response.status, 502);
    assert.deepEqual(body.error, {
      code: 'IMAGE_GENERATION_FAILED',
      message: 'The image-generation service could not create a valid flyer image.',
    });
  });
});

test('a game without an eligible scorer returns a validation error without persistence', async () => {
  let saveCalls = 0;
  const noEligibleScorer = {
    ...payload,
    players: [{ ...payload.players[0], pts: 0 }],
  };
  const app = createApp({
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
      body: JSON.stringify(noEligibleScorer),
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.match(body.error.message, /at least one player/i);
    assert.equal(saveCalls, 0);
  });
});

test('rendering failure returns an error and does not report a generated graphic', async () => {
  let renderCalls = 0;
  const app = createApp({
    GameModel: {
      async findOneAndUpdate() {
        return payload;
      },
    },
    flyerGenerator: async () => {
      renderCalls += 1;
      throw new Error('Rendering failed');
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/games/finalize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(body.error.code, 'INTERNAL_SERVER_ERROR');
    assert.equal(renderCalls, 1);
  });
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

test('CORS allows each configured frontend origin and omits headers for other origins', async () => {
  const app = createApp({
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
