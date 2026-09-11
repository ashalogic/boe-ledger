import { mkdir, readFile, writeFile } from 'node:fs/promises';

try {
  const file = await readFile('.env', 'utf8');
  for (const line of file.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const { BLIZZARD_CLIENT_ID, BLIZZARD_CLIENT_SECRET } = process.env;
if (!BLIZZARD_CLIENT_ID || !BLIZZARD_CLIENT_SECRET)
  throw new Error('Set BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET');

const items = JSON.parse(await readFile('config/boe-items.json')).items;
const credentials = Buffer.from(`${BLIZZARD_CLIENT_ID}:${BLIZZARD_CLIENT_SECRET}`).toString(
  'base64',
);
const tokenResponse = await fetch('https://oauth.battle.net/token', {
  method: 'POST',
  headers: {
    Authorization: `Basic ${credentials}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: 'grant_type=client_credentials',
});
if (!tokenResponse.ok) throw new Error(`OAuth failed: ${tokenResponse.status}`);
const token = (await tokenResponse.json()).access_token;

await mkdir('discord-emojis', { recursive: true });
const manifest = {};
for (const { itemId, name } of items) {
  const mediaUrl = new URL(`https://eu.api.blizzard.com/data/wow/media/item/${itemId}`);
  mediaUrl.searchParams.set('namespace', 'static-eu');
  mediaUrl.searchParams.set('locale', 'en_GB');
  const mediaResponse = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!mediaResponse.ok) throw new Error(`Media ${itemId}: ${mediaResponse.status}`);
  const media = await mediaResponse.json();
  const iconUrl = media.assets?.find(({ key }) => key === 'icon')?.value;
  if (!iconUrl) throw new Error(`No icon found for ${itemId}`);
  const iconResponse = await fetch(iconUrl);
  if (!iconResponse.ok) throw new Error(`Icon ${itemId}: ${iconResponse.status}`);
  const emojiName = `boe_${itemId}`;
  const fileName = `${emojiName}.jpg`;
  await writeFile(`discord-emojis/${fileName}`, Buffer.from(await iconResponse.arrayBuffer()));
  manifest[itemId] = { name, emojiName, fileName };
  console.log(`${name}: ${fileName}`);
}
await writeFile('discord-emojis/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
