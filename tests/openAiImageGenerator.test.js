import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePlayerPortrait } from '../src/services/openAiImageGenerator.js';

test('sends the player photo, team logo, and tailored flyer details to OpenAI', async () => {
  let requestUrl;
  let requestOptions;
  const portrait = Buffer.from('generated portrait');

  const result = await generatePlayerPortrait({
    player: {
      name: 'Marcus',
      jersey: '3',
      team: 'Team A',
      pts: 14,
      reb: 5,
      ast: 3,
    },
    game: {
      teamA: { name: 'Red Team' },
      teamB: { name: 'Blue Team' },
    },
    playerImage: 'data:image/png;base64,cGxheWVy',
    teamLogoImage: 'data:image/jpeg;base64,bG9nbw==',
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
          return { data: [{ b64_json: portrait.toString('base64') }] };
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
  const references = form.getAll('image[]');
  assert.equal(references.length, 2);
  assert.equal(references[0].type, 'image/png');
  assert.equal(references[1].type, 'image/jpeg');
  assert.deepEqual(result, portrait);
});

test('reports OpenAI API failures and missing generated image content', async () => {
  const args = {
    player: { name: 'Marcus', jersey: '3', team: 'Team A', pts: 14, reb: 5, ast: 3 },
    game: { teamA: { name: 'Red Team' }, teamB: { name: 'Blue Team' } },
    playerImage: 'data:image/png;base64,cGxheWVy',
    teamLogoImage: 'data:image/png;base64,bG9nbw==',
    apiKey: 'test-key',
  };

  await assert.rejects(
    generatePlayerPortrait({
      ...args,
      fetchImplementation: async () => ({
        ok: false,
        status: 429,
        async text() {
          return 'rate limited';
        },
      }),
    }),
    /OpenAI image generation failed \(429\): rate limited/,
  );
  await assert.rejects(
    generatePlayerPortrait({
      ...args,
      fetchImplementation: async () => ({
        ok: true,
        async json() {
          return { data: [] };
        },
      }),
    }),
    /did not contain an image/,
  );
});
