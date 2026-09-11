const enc = new TextEncoder();
const normalize = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const gold = (copper) =>
  `${Math.floor(copper / 10000).toLocaleString()}g ${Math.floor((copper % 10000) / 100)}s`;

async function validRequest(request, env) {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  if (!signature || !timestamp) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(env.DISCORD_PUBLIC_KEY.match(/.{2}/g), (x) =>
      parseInt(x, 16),
    ),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "Ed25519",
    key,
    Uint8Array.from(signature.match(/.{2}/g), (x) => parseInt(x, 16)),
    enc.encode(timestamp + (await request.clone().text())),
  );
}
const response = (data) => Response.json(data);
async function lookupItem(env, value) {
  if (/^\d+$/.test(value)) return value;
  const index = (await env.BOE_DATA.get("items:index", "json")) ?? {};
  return index[normalize(value)];
}
async function price(env, realm, item) {
  const data = await env.BOE_DATA.get(`realm:${normalize(realm)}`, "json");
  const found = data?.items?.find((entry) => entry.itemId === Number(item));
  return found && { ...found, realm: data.realm, updatedAt: data.updatedAt };
}
function message(content) {
  return response({ type: 4, data: { content } });
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST")
      return new Response("BOE Ledger Discord endpoint", { status: 200 });
    if (!(await validRequest(request, env)))
      return new Response("invalid request signature", { status: 401 });
    const interaction = await request.json();
    if (interaction.type === 1) return response({ type: 1 });
    const opts = Object.fromEntries(
      (interaction.data.options ?? []).map((o) => [o.name, o.value]),
    );
    const item = await lookupItem(env, opts.item);
    if (!item)
      return message(
        "Unknown BOE item. Use its item ID or add it to the BOE allow-list.",
      );
    if (interaction.data.name === "price") {
      const data = await price(env, opts.realm, item);
      return message(
        data
          ? `**${data.realm}** — ${data.itemId}: **${gold(data.min)}** (quantity: ${data.quantity}, updated ${data.updatedAt})`
          : "No current listing found.",
      );
    }
    const realms =
      (await env.BOE_DATA.get("meta:realms", "json"))?.realms ?? [];
    if (interaction.data.name === "compare") {
      const rows = (
        await Promise.all(realms.map(async (r) => await price(env, r, item)))
      )
        .filter(Boolean)
        .sort((a, b) => a.min - b.min);
      return message(
        rows.length
          ? rows
              .map((r) => `${r.realm}: **${gold(r.min)}** (${r.quantity})`)
              .join("\n")
          : "No current listings found.",
      );
    }
    if (interaction.data.name === "realm") {
      const data = await price(env, opts.realm, item);
      return message(
        data
          ? `**${data.realm}** — ${data.itemId}: **${gold(data.min)}** (quantity: ${data.quantity})`
          : "No current listing found.",
      );
    }
    return message("Unknown command.");
  },
};
