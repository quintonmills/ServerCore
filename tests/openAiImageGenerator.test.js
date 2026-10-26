import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGeneratedJpegBuffer,
  createRasterImageDataUrl,
} from './rasterImageFixtures.js';
import { generateFlyerImage } from '../src/services/openAiImageGenerator.js';

test('sends the style reference, three player photos, team logo, and tailored details to OpenAI', async () => {
  const playerImages = [
    createRasterImageDataUrl('png'),
    createRasterImageDataUrl('jpeg'),
    createRasterImageDataUrl('webp'),
  ];
  const templateImage = createRasterImageDataUrl('png');
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
    playerImages,
    templateImage,
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
  assert.equal(form.get('model'), 'gpt-image-2.5-sunburst');
  assert.equal(form.get('size'), '1024x1024');
  assert.equal(form.get('quality'), 'medium');
  assert.equal(form.get('input_fidelity'), 'high');
  assert.equal(form.get('output_format'), 'jpeg');
  assert.match(form.get('prompt'), /Marcus/);
  assert.match(form.get('prompt'), /Red Team/);
  assert.match(form.get('prompt'), /subtle arena spotlight/);
  assert.match(form.get('prompt'), /one complete, original portrait-format basketball achievement flyer/);
  assert.match(form.get('prompt'), /visual art-direction guidance only/);
  assert.match(form.get('prompt'), /Ignore all text and numbers in the reference image/);
  assert.match(form.get('prompt'), /exactly three depictions of this player total/);
  assert.match(form.get('prompt'), /exactly two smaller, lighter monochrome supporting photos placed around the flyer border/);
  assert.match(form.get('prompt'), /flattering enough for a public team post/);
  assert.match(form.get('prompt'), /avoid excessive retouching, artificial perfection/);
  assert.match(form.get('prompt'), /Pay close attention to small details/);
  assert.match(form.get('prompt'), /POINTS VALUE — SOURCE OF TRUTH: 14/);
  assert.match(form.get('prompt'), /must say exactly "14 POINTS"/);
  assert.match(form.get('prompt'), /do not estimate it, infer it from any image, add digits/);
  assert.match(form.get('prompt'), /Do not add rebounds, assists, other statistics/);
  const references = form.getAll('image[]');
  assert.equal(references.length, 5);
  assert.deepEqual(references.map((reference) => reference.type), [
    'image/png',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/jpeg',
  ]);
  assert.equal(references[0].size, Buffer.from(templateImage.split(',')[1], 'base64').length);
  assert.deepEqual(
    references.slice(1, 4).map((reference) => reference.size),
    playerImages.map((image) => Buffer.from(image.split(',')[1], 'base64').length),
  );
  assert.equal(references[4].size, Buffer.from(teamLogoImage.split(',')[1], 'base64').length);
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
        async json() {
          return { error: { type: 'rate_limit_error', message: 'rate limited' } };
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

test('logs concise provider details for rejected image-generation requests', async () => {
  const playerImage = createRasterImageDataUrl('jpeg');
  const teamLogoImage = createRasterImageDataUrl('png');
  const loggedErrors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => loggedErrors.push(args);

  try {
    await assert.rejects(
      generateFlyerImage({
        player: { name: 'Marcus', jersey: '3', team: 'Team A', pts: 14, reb: 5, ast: 3 },
        game: { teamA: { name: 'Red Team' }, teamB: { name: 'Blue Team' } },
        playerImage,
        teamLogoImage,
        apiKey: 'test-key',
        fetchImplementation: async () => ({
          ok: false,
          status: 400,
          async json() {
            return {
              error: {
                type: 'invalid_request_error',
                code: 'unsupported_value',
                message: 'Invalid image dimensions',
              },
            };
          },
        }),
      }),
      /image-generation service returned HTTP 400/,
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(loggedErrors, [[
    '[openai] Image generation request failed',
    {
      status: 400,
      type: 'invalid_request_error',
      code: 'unsupported_value',
      message: 'Invalid image dimensions',
    },
  ]]);
});

test('sends valid legacy player, style, and team references to the image-edit endpoint', async () => {
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

  assert.equal(submittedFiles.length, 3);
  assert.deepEqual(submittedFiles.map((file) => file.type), ['image/png', 'image/webp', 'image/webp']);
});
