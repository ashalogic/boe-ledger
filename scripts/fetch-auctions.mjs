import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const required = [
  "BLIZZARD_CLIENT_ID",
  "BLIZZARD_CLIENT_SECRET",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_KV_NAMESPACE_ID",
  "CLOUDFLARE_API_TOKEN",
];
for (const name of required)
  if (!process.env[name]) throw new Error(`Missing ${name}`);

const region = "eu";
const namespace = "dynamic-eu";
const realms = JSON.parse(await readFile("config/realms.json"));
const boeConfig = JSON.parse(await readFile("config/boe-items.json"));
const difficultyConfig = JSON.parse(await readFile("config/boe-difficulties.json"));
const boeIds = new Set(boeConfig.items.map(({ itemId }) => itemId));
if (!boeIds.size)
  throw new Error(
    "config/boe-items.json has no BOE item IDs. Refusing to publish non-BOE data.",
  );

async function token() {
  const basic = Buffer.from(
    `${process.env.BLIZZARD_CLIENT_ID}:${process.env.BLIZZARD_CLIENT_SECRET}`,
  ).toString("base64");
  const res = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok)
    throw new Error(`OAuth failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}
async function blizzard(path, accessToken) {
  const url = new URL(`https://${region}.api.blizzard.com${path}`);
  url.searchParams.set("namespace", namespace);
  url.searchParams.set("locale", "en_GB");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok)
    throw new Error(`Blizzard ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}
async function kv(key, value) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CLOUDFLARE_KV_NAMESPACE_ID}/values/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
    body: JSON.stringify(value),
  });
  if (!res.ok)
    throw new Error(`KV write ${key}: ${res.status} ${await res.text()}`);
}
const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const difficultyFor = (item) => {
  const bonusKey = [...(item.bonus_lists ?? [])].sort((a, b) => a - b).join(",");
  return difficultyConfig.bonusLists[bonusKey] ?? difficultyConfig.contexts[String(item.context)] ?? "Unknown";
};
const accessToken = await token();
const realmIds = new Map();
const wantedRealms = new Set(realms.map(normalize));
const connectedIndex = await blizzard('/data/wow/connected-realm/index', accessToken);
for (const entry of connectedIndex.connected_realms ?? []) {
  if (!wantedRealms.size) break;
  const id = Number(entry.href.match(/connected-realm\/(\d+)/)?.[1]);
  if (!id) continue;
  const connected = await blizzard(`/data/wow/connected-realm/${id}`, accessToken);
  for (const realm of connected.realms ?? []) {
    const key = normalize(realm.name);
    if (wantedRealms.has(key)) {
      realmIds.set(key, id);
      wantedRealms.delete(key);
    }
  }
}
if (wantedRealms.size) throw new Error(`Could not resolve realms: ${[...wantedRealms].join(', ')}`);

const itemMeta = Object.fromEntries(
  boeConfig.items.map((i) => [
    i.itemId,
    { itemId: i.itemId, name: i.name || String(i.itemId) },
  ]),
);
const itemIndex = {};
for (const item of Object.values(itemMeta))
  itemIndex[normalize(item.name)] = item.itemId;
await kv("items:index", itemIndex);
await kv(
  "items:choices",
  Object.values(itemMeta).sort((a, b) => a.name.localeCompare(b.name)),
);
await Promise.all(
  Object.values(itemMeta).map((item) => kv(`item:${item.itemId}`, item)),
);

const now = new Date().toISOString();
for (const realmName of realms) {
  const connectedRealmId = realmIds.get(normalize(realmName));
  if (!connectedRealmId)
    throw new Error(`Could not resolve realm: ${realmName}`);
  const dump = await blizzard(
    `/data/wow/connected-realm/${connectedRealmId}/auctions`,
    accessToken,
  );
  const prices = new Map();
  for (const auction of dump.auctions) {
    const itemId = auction.item?.id;
    if (!boeIds.has(itemId)) continue;
    const unit =
      auction.unit_price ??
      Math.ceil((auction.buyout ?? 0) / Math.max(auction.quantity ?? 1, 1));
    if (!unit) continue;
    const variant = {
      context: auction.item.context ?? 0,
      bonusLists: [...(auction.item.bonus_lists ?? [])].sort((a, b) => a - b),
      modifiers: [...(auction.item.modifiers ?? [])].sort((a, b) => a.type - b.type || a.value - b.value),
    };
    const variantKey = JSON.stringify(variant);
    const key = `${itemId}:${variantKey}`;
    const current = prices.get(key) ?? { itemId, variantKey, difficulty: difficultyFor(auction.item), ...variant, min: unit, quantity: 0 };
    current.min = Math.min(current.min, unit);
    current.quantity += auction.quantity ?? 1;
    prices.set(key, current);
  }
  const realmKey = normalize(realmName);
  await kv(`realm:${realmKey}`, {
    realm: realmName,
    connectedRealmId,
    updatedAt: now,
    items: [...prices.values()],
  });
  console.log(`${realmName}: ${prices.size} BOE items`);
}
await kv("meta:realms", { realms, updatedAt: now });
