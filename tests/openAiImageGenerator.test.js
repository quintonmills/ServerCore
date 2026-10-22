import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGeneratedJpegBuffer,
  createRasterImageDataUrl,
} from './rasterImageFixtures.js';
import { generateFlyerImage } from '../src/services/openAiImageGenerator.js';

test('sends the player photo, team logo, and tailored flyer details to OpenAI', async () => {
  const playerImage = createRasterImageDataUrl('png');
  const teamLogoImage = createRasterImageDataUrl('jpeg');
  const generatedImage = createGeneratedJpegBuffer();
  let requestUrl;
  let requestOptions;

  const result = await generateFlyerImage({
    player: {
      name: 'Marcus',
      jersey: '3',
      team: 'Team A',
      pts: 14,
      reb: 5,
      ast: 3,
      stl: 1,
      blk: 0,
      to: 2,
    },
    game: {
      teamA: { name: 'Red Team' },
      teamB: { name: 'Blue Team' },
    },
    playerImage,
    teamLogoImage,
    imageGeneration: {
      prompt: 'Add a subtle arena spotlight',
      size: '1024x1024',
      quality: 'medium',
    },
    apiKey: 'test-key',
    fetchImplementation: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return {
        ok: true,
        async json() {
          return { data: [{ b64_json: generatedImage.toString('base64') }] };
        },
      };
    },
  });

  assert.equal(requestUrl, 'https://api.openai.com/v1/images/edits');
  assert.equal(requestOptions.method, 'POST');
  assert.equal(requestOptions.headers.Authorization, 'Bearer test-key');
  const form = requestOptions.body;
  assert.equal(form.get('model'), 'gpt-image-1');
  assert.equal(form.get('size'), '1024x1024');
  assert.equal(form.get('quality'), 'medium');
  assert.equal(form.get('input_fidelity'), 'high');
  assert.equal(form.get('output_format'), 'jpeg');
  assert.match(form.get('prompt'), /Marcus/);
  assert.match(form.get('prompt'), /Red Team/);
  assert.match(form.get('prompt'), /subtle arena spotlight/);
  assert.match(form.get('prompt'), /complete, finished basketball player stat flyer/);
  assert.match(form.get('prompt'), /POINTS: 14/);
  assert.match(form.get('prompt'), /TURNOVERS: 2/);
  const references = form.getAll('image[]');
  assert.equal(references.length, 2);
  assert.equal(references[0].type, 'image/png');
  assert.equal(references[1].type, 'image/jpeg');
  assert.equal(references[0].size, Buffer.from(playerImage.split(',')[1], 'base64').length);
  assert.equal(references[1].size, Buffer.from(teamLogoImage.split(',')[1], 'base64').length);
  assert.deepEqual(result, generatedImage);
});

test('reports OpenAI API failures and missing generated image content', async () => {
  const playerImage = createRasterImageDataUrl('webp');
  const teamLogoImage = createRasterImageDataUrl('png');
  const args = {
    player: { name: 'Marcus', jersey: '3', team: 'Team A', pts: 14, reb: 5, ast: 3 },
    game: { teamA: { name: 'Red Team' }, teamB: { name: 'Blue Team' } },
    playerImage,
    teamLogoImage,
    apiKey: 'test-key',
  };

  await assert.rejects(
    generateFlyerImage({
      ...args,
      fetchImplementation: async () => ({
        ok: false,
        status: 429,
        async text() {
          return 'rate limited';
        },
      }),
    }),
    /image-generation service returned HTTP 429/,
  );
  await assert.rejects(
    generateFlyerImage({
      ...args,
      fetchImplementation: async () => ({
        ok: true,
        async json() {
          return { data: [] };
        },
      }),
    }),
    /image-generation service could not create a valid flyer image/,
  );
  await assert.rejects(
    generateFlyerImage({
      ...args,
      fetchImplementation: async () => ({
        ok: true,
        async json() {
          return { data: [{ b64_json: Buffer.from('not an image').toString('base64') }] };
        },
      }),
    }),
    /image-generation service could not create a valid flyer image/,
  );
});

test('sends valid WebP raster references to the image-edit endpoint', async () => {
  const image = createRasterImageDataUrl('webp');
  const generatedFlyer = createGeneratedJpegBuffer();
  let submittedFiles;

  await generateFlyerImage({
    player: { name: 'Marcus', jersey: '3', team: 'Team A', pts: 14, reb: 5, ast: 3 },
    game: { teamA: { name: 'Red Team' }, teamB: { name: 'Blue Team' } },
    playerImage: image,
    teamLogoImage: image,
    apiKey: 'test-key',
    fetchImplementation: async (_url, { body }) => {
      submittedFiles = body.getAll('image[]');
      return {
        ok: true,
        async json() {
          return { data: [{ b64_json: generatedFlyer.toString('base64') }] };
        },
      };
    },
  });

  assert.equal(submittedFiles.length, 2);
  assert.ok(submittedFiles.every((file) => file.type === 'image/webp'));
});
