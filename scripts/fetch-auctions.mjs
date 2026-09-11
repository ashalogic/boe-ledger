import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

const required = [
  'BLIZZARD_CLIENT_ID',
  'BLIZZARD_CLIENT_SECRET',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_KV_NAMESPACE_ID',
  'CLOUDFLARE_API_TOKEN',
];
for (const name of required) if (!process.env[name]) throw new Error(`Missing ${name}`);

const realms = JSON.parse(await readFile('config/realms.json'));
const boeConfig = JSON.parse(await readFile('config/boe-items.json'));
const difficultyConfig = JSON.parse(await readFile('config/boe-difficulties.json'));
const boeIds = new Set(boeConfig.items.map(({ itemId }) => itemId));
const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
if (!boeIds.size) throw new Error('The BOE allow-list is empty.');

async function getToken() {
  const credentials = Buffer.from(
    `${process.env.BLIZZARD_CLIENT_ID}:${process.env.BLIZZARD_CLIENT_SECRET}`,
  ).toString('base64');
  const result = await fetch('https://oauth.battle.net/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!result.ok) throw new Error(`OAuth failed: ${result.status} ${await result.text()}`);
  return (await result.json()).access_token;
}

async function blizzard(path, token, namespace = 'dynamic-eu') {
  const url = new URL(`https://eu.api.blizzard.com${path}`);
  url.searchParams.set('namespace', namespace);
  url.searchParams.set('locale', 'en_GB');
  const result = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!result.ok) throw new Error(`Blizzard ${path}: ${result.status} ${await result.text()}`);
  return result.json();
}

const kvUrl = (key) =>
  `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CLOUDFLARE_KV_NAMESPACE_ID}/values/${encodeURIComponent(key)}`;
const kvHeaders = { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` };
async function kvGet(key) {
  const result = await fetch(kvUrl(key), { headers: kvHeaders });
  if (result.status === 404) return null;
  if (!result.ok) throw new Error(`KV read ${key}: ${result.status} ${await result.text()}`);
  return result.json();
}
async function kvPut(key, value) {
  const result = await fetch(kvUrl(key), {
    method: 'PUT',
    headers: { ...kvHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  if (!result.ok) throw new Error(`KV write ${key}: ${result.status} ${await result.text()}`);
}

function startCalculator() {
  const child = spawn('python', ['scripts/item-level-server.py'], {
    env: { ...process.env, BONUS_ID_TOOL_PATH: process.env.BONUS_ID_TOOL_PATH ?? '.bonus-id-tool' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const queue = [];
  let failure;
  createInterface({ input: child.stdout }).on('line', (line) =>
    queue.shift()?.resolve(JSON.parse(line).itemLevel),
  );
  child.on('error', (error) => {
    failure = error;
    queue.splice(0).forEach(({ reject }) => reject(error));
  });
  child.on('exit', (code) => {
    if (code) {
      failure = new Error(`Item-level calculator exited with ${code}`);
      queue.splice(0).forEach(({ reject }) => reject(failure));
    }
  });
  return {
    calculate(itemId, variant) {
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => {
        queue.push({ resolve, reject });
        child.stdin.write(`${JSON.stringify({ itemId, ...variant })}\n`, (error) => {
          if (error) reject(error);
        });
      });
    },
    close() {
      child.stdin.end();
    },
  };
}

const difficultyFor = (item) => {
  const bonuses = [...(item.bonus_lists ?? [])].sort((a, b) => a - b).join(',');
  return (
    difficultyConfig.bonusLists[bonuses] ??
    difficultyConfig.contexts[String(item.context)] ??
    'Unknown'
  );
};

const previous = await kvGet('snapshot:current');
const token = await getToken();
const realmIds = new Map(
  (previous?.realms ?? []).map(({ name, connectedRealmId }) => [normalize(name), connectedRealmId]),
);
const missing = new Set(realms.map(normalize).filter((realm) => !realmIds.has(realm)));
if (missing.size) {
  const index = await blizzard('/data/wow/connected-realm/index', token);
  for (const entry of index.connected_realms ?? []) {
    if (!missing.size) break;
    const id = Number(entry.href.match(/connected-realm\/(\d+)/)?.[1]);
    if (!id) continue;
    const connected = await blizzard(`/data/wow/connected-realm/${id}`, token);
    for (const realm of connected.realms ?? []) {
      const key = normalize(realm.name);
      if (missing.delete(key)) realmIds.set(key, id);
    }
  }
}
if (missing.size) throw new Error(`Could not resolve realms: ${[...missing].join(', ')}`);

const calculator = startCalculator();
const itemLevelCache = new Map();
const processedRealms = new Map();
async function processConnectedRealm(connectedRealmId) {
  if (processedRealms.has(connectedRealmId)) return processedRealms.get(connectedRealmId);
  const dump = await blizzard(`/data/wow/connected-realm/${connectedRealmId}/auctions`, token);
  const prices = new Map();
  for (const auction of dump.auctions ?? []) {
    const itemId = auction.item?.id;
    if (!boeIds.has(itemId)) continue;
    const unit =
      auction.unit_price ?? Math.ceil((auction.buyout ?? 0) / Math.max(auction.quantity ?? 1, 1));
    if (!unit) continue;
    const variant = {
      context: auction.item.context ?? 0,
      bonusLists: [...(auction.item.bonus_lists ?? [])].sort((a, b) => a - b),
      modifiers: [...(auction.item.modifiers ?? [])].sort(
        (a, b) => a.type - b.type || a.value - b.value,
      ),
    };
    const variantKey = JSON.stringify(variant);
    const key = `${itemId}:${variantKey}`;
    let current = prices.get(key);
    if (!current) {
      let itemLevel = itemLevelCache.get(key);
      if (itemLevel === undefined) {
        itemLevel = await calculator.calculate(itemId, variant);
        itemLevelCache.set(key, itemLevel);
      }
      current = {
        itemId,
        variantKey,
        difficulty: difficultyFor(auction.item),
        itemLevel,
        ...variant,
        min: unit,
        quantity: 0,
      };
      prices.set(key, current);
    }
    current.min = Math.min(current.min, unit);
    current.quantity += auction.quantity ?? 1;
  }
  const result = [...prices.values()];
  processedRealms.set(connectedRealmId, result);
  return result;
}

const snapshotRealms = [];
for (const name of realms) {
  const connectedRealmId = realmIds.get(normalize(name));
  const items = await processConnectedRealm(connectedRealmId);
  snapshotRealms.push({ name, connectedRealmId, items });
  console.log(`${name}: ${items.length} BOE variants`);
}
calculator.close();

const previousItems = new Map((previous?.items ?? []).map((item) => [item.itemId, item]));
const snapshotItems = await Promise.all(
  boeConfig.items.map(async ({ itemId, name }) => {
    let icon = previousItems.get(itemId)?.icon;
    try {
      const media = await blizzard(`/data/wow/media/item/${itemId}`, token, 'static-eu');
      icon = media.assets?.find(({ key }) => key === 'icon')?.value ?? icon;
    } catch (error) {
      console.warn(`Could not refresh icon for item ${itemId}: ${error.message}`);
    }
    return {
      itemId,
      name: name || String(itemId),
      icon,
    };
  }),
);

await kvPut('snapshot:current', {
  schemaVersion: 3,
  generatedAt: new Date().toISOString(),
  items: snapshotItems.sort((a, b) => a.name.localeCompare(b.name)),
  realms: snapshotRealms,
});
