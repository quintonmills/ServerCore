const apiUrl = 'https://api.openai.com/v1/images/edits';

function appendImage(form, dataUrl, filename) {
  const [, mimeType, encodedImage] = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(dataUrl);
  const image = Buffer.from(encodedImage, 'base64');
  const extension = mimeType.split('/')[1];
  form.append('image[]', new Blob([image], { type: mimeType }), `${filename}.${extension}`);
}

function buildPrompt(player, game, extraPrompt) {
  const instructions = [
    'Create a polished, photorealistic basketball player portrait for a premium player-stat flyer.',
    'Use the first reference image as the player identity; preserve their recognizable face, skin tone, hair, and build.',
    'Use the second reference image only as a guide to the team identity and colors.',
    'Show the player in a dynamic basketball pose, wearing a uniform that fits the team colors.',
    'Use a dramatic dark arena background with restrained neon-lime accents to match a modern sports graphic.',
    'Do not add text, numbers, watermarks, borders, or logos; these are added accurately by the flyer template.',
    `Player: ${player.name}; jersey: ${player.jersey}; team: ${player.team === 'Team A' ? game.teamA.name : game.teamB.name}.`,
    `Game statistics: ${player.pts} points, ${player.reb} rebounds, ${player.ast} assists.`,
  ];

  if (extraPrompt) instructions.push(`Additional art direction: ${extraPrompt}`);
  return instructions.join(' ');
}

export async function generatePlayerPortrait({
  player,
  game,
  playerImage,
  teamLogoImage,
  imageGeneration = {},
  apiKey = process.env.OPENAI_API_KEY,
  fetchImplementation = fetch,
}) {
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY must be set to generate player portraits');
  }

  const form = new FormData();
  form.append('model', 'gpt-image-1');
  form.append('prompt', buildPrompt(player, game, imageGeneration.prompt));
  form.append('size', imageGeneration.size || '1024x1536');
  form.append('quality', imageGeneration.quality || 'high');
  form.append('input_fidelity', 'high');
  form.append('output_format', 'jpeg');
  appendImage(form, playerImage, 'player-reference');
  appendImage(form, teamLogoImage, 'team-logo-reference');

  const response = await fetchImplementation(apiUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `OpenAI image generation failed (${response.status}): ${responseText.slice(0, 1000)}`,
    );
  }

  const result = await response.json();
  const encodedImage = result.data?.[0]?.b64_json;
  if (typeof encodedImage !== 'string' || encodedImage.length === 0) {
    throw new Error('OpenAI image generation response did not contain an image');
  }
  return Buffer.from(encodedImage, 'base64');
}
