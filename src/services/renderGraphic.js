import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';

const outputDirectory = fileURLToPath(new URL('../../output/', import.meta.url));
const width = 1080;
const height = 1350;

function safeFilenamePart(value) {
  const part = value
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return part || 'item';
}

function fitText(context, text, maxWidth, initialSize, minimumSize = 28) {
  let size = initialSize;
  while (size > minimumSize) {
    context.font = `600 ${size}px Arial`;
    if (context.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  context.font = `600 ${size}px Arial`;
  let fittedText = text;
  while (fittedText.length > 1 && context.measureText(fittedText).width > maxWidth) {
    fittedText = `${Array.from(fittedText).slice(0, -2).join('')}…`;
  }
  return { size, text: fittedText };
}

function drawStatCard(playerData, gameData) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  const background = context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, '#111827');
  background.addColorStop(1, '#080b13');
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  context.fillStyle = '#d6ff3f';
  context.fillRect(72, 72, 10, 72);
  context.font = '700 34px Arial';
  context.fillText('SCOREKINGS', 106, 122);
  context.font = '500 22px Arial';
  context.fillStyle = '#8f9bad';
  context.fillText('PLAYER STAT CARD', 106, 158);

  context.strokeStyle = 'rgba(255,255,255,0.12)';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(72, 198);
  context.lineTo(1008, 198);
  context.stroke();

  const playerName = playerData.name || 'Player';
  context.fillStyle = '#f7f9fc';
  const fittedName = fitText(context, playerName, 900, 84, 42);
  context.font = `700 ${fittedName.size}px Arial`;
  context.fillText(fittedName.text, 72, 326);

  context.fillStyle = '#d6ff3f';
  context.font = '600 28px Arial';
  context.fillText(`JERSEY  ${playerData.jersey || '—'}`, 76, 389);
  context.fillStyle = '#c6cedb';
  context.font = '500 28px Arial';
  context.fillText(playerData.team || 'Team not available', 76, 438);

  const location = gameData.location || 'Location not available';
  context.fillStyle = '#8f9bad';
  const fittedLocation = fitText(context, location, 900, 25, 20);
  context.font = `500 ${fittedLocation.size}px Arial`;
  context.fillText(fittedLocation.text, 76, 510);

  const stats = [
    { label: 'POINTS', value: playerData.pts ?? 0 },
    { label: 'REBOUNDS', value: playerData.reb ?? 0 },
    { label: 'ASSISTS', value: playerData.ast ?? 0 },
  ];
  const boxY = 628;
  const boxWidth = 286;
  const gap = 24;

  stats.forEach((stat, index) => {
    const x = 72 + index * (boxWidth + gap);
    context.fillStyle = '#171f2d';
    context.beginPath();
    context.roundRect(x, boxY, boxWidth, 310, 24);
    context.fill();
    context.strokeStyle = 'rgba(214,255,63,0.24)';
    context.lineWidth = 2;
    context.stroke();

    context.fillStyle = '#8f9bad';
    context.font = '600 22px Arial';
    context.textAlign = 'center';
    context.fillText(stat.label, x + boxWidth / 2, boxY + 68);
    context.fillStyle = '#f7f9fc';
    context.font = '700 108px Arial';
    context.fillText(String(stat.value), x + boxWidth / 2, boxY + 204);
    context.textAlign = 'left';
  });

  context.fillStyle = '#263144';
  context.beginPath();
  context.roundRect(72, 1050, 936, 2, 1);
  context.fill();
  context.fillStyle = '#8f9bad';
  context.font = '500 22px Arial';
  context.fillText('BUILT FOR THE GAME', 72, 1112);

  const matchup = `${gameData.teamA?.name || 'Team A'}  ${gameData.teamA?.score ?? '—'}  ·  ${
    gameData.teamB?.score ?? '—'
  }  ${gameData.teamB?.name || 'Team B'}`;
  context.fillStyle = '#c6cedb';
  const fittedMatchup = fitText(context, matchup, 936, 22, 18);
  context.font = `500 ${fittedMatchup.size}px Arial`;
  context.fillText(fittedMatchup.text, 72, 1170);

  return canvas;
}

export async function generateStatCard(playerData, gameData, { publicBaseUrl } = {}) {
  await mkdir(outputDirectory, { recursive: true });

  const filename = `${safeFilenamePart(gameData.gameId)}-${safeFilenamePart(
    playerData.id,
  )}-${randomUUID()}.jpg`;
  const filePath = path.join(outputDirectory, filename);
  const image = await drawStatCard(playerData, gameData).encode('jpeg', 92);
  await writeFile(filePath, image, { flag: 'wx' });

  const baseUrl = publicBaseUrl?.replace(/\/+$/, '');
  const publicUrl = `${baseUrl || ''}/output/${encodeURIComponent(filename)}`;
  return { filePath, publicUrl };
}
