import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateFlyerImage } from './openAiImageGenerator.js';

const outputDirectory = fileURLToPath(new URL('../../output/', import.meta.url));

function safeFilenamePart(value) {
  const part = value
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return part || 'item';
}

export async function generateFlyer(
  playerData,
  gameData,
  {
    publicBaseUrl,
    playerImage,
    teamLogoImage,
    imageGeneration,
    imageGenerator = generateFlyerImage,
  } = {},
) {
  if (!playerImage || !teamLogoImage) {
    throw new Error('A player photo and the player team logo are required to generate a flyer');
  }

  await mkdir(outputDirectory, { recursive: true });

  const flyerBuffer = await imageGenerator({
    player: playerData,
    game: gameData,
    playerImage,
    teamLogoImage,
    imageGeneration,
  });
  const filename = `${safeFilenamePart(gameData.gameId)}-${safeFilenamePart(
    playerData.id,
  )}-${randomUUID()}.jpg`;
  const filePath = path.join(outputDirectory, filename);
  await writeFile(filePath, flyerBuffer, { flag: 'wx' });

  const baseUrl = publicBaseUrl?.replace(/\/+$/, '');
  const publicUrl = `${baseUrl || ''}/output/${encodeURIComponent(filename)}`;
  return { filePath, publicUrl };
}
