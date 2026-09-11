const enc = new TextEncoder();
const normalize = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const gold = copper => `${Math.floor(copper / 10000).toLocaleString()}g ${Math.floor(copper % 10000 / 100)}s`;
const response = data => Response.json(data);
async function validRequest(request, env) {
  const signature = request.headers.get('X-Signature-Ed25519'), timestamp = request.headers.get('X-Signature-Timestamp');
  if (!signature || !timestamp || !env.DISCORD_PUBLIC_KEY) return false;
  const hex = value => Uint8Array.from(value.match(/.{2}/g) ?? [], x => parseInt(x, 16));
  const key = await crypto.subtle.importKey('raw', hex(env.DISCORD_PUBLIC_KEY), { name: 'Ed25519' }, false, ['verify']);
  return crypto.subtle.verify('Ed25519', key, hex(signature), enc.encode(timestamp + await request.clone().text()));
}
async function price(env, realm, item) { const data = await env.BOE_DATA.get(`realm:${normalize(realm)}`, 'json'); return (data?.items ?? []).filter(entry => entry.itemId === Number(item)).map(entry => ({ ...entry, realm: data.realm, updatedAt: data.updatedAt })); }
async function allPrices(env, item) { const realms = (await env.BOE_DATA.get('meta:realms', 'json'))?.realms ?? []; return (await Promise.all(realms.map(realm => price(env, realm, item)))).flat().sort((a, b) => a.min - b.min); }
function components(item, realms) { return [{ type: 1, components: [{ type: 3, custom_id: `boe:difficulty:${item}`, placeholder: 'Filter difficulty', options: ['All', 'Normal', 'Heroic', 'Mythic'].map(value => ({ label: value, value: value.toLowerCase() })) }] }, { type: 1, components: [{ type: 2, style: 1, label: 'All variants', custom_id: `boe:compare:${item}` }] }, { type: 1, components: [{ type: 3, custom_id: `boe:realm:${item}`, placeholder: 'Choose a realm', options: realms.slice(0, 25).map(realm => ({ label: realm, value: realm })) }] }]; }
const variant = row => `${row.difficulty ?? 'Unknown'} · bonuses ${row.bonusLists?.join(',') || 'none'} · modifiers ${(row.modifiers ?? []).map(m => `${m.type}:${m.value}`).join(',') || 'none'}`;
async function embed(env, item, mode = 'summary', selectedRealm) {
  const meta = await env.BOE_DATA.get(`item:${item}`, 'json'), allRows = await allPrices(env, item), realms = (await env.BOE_DATA.get('meta:realms', 'json'))?.realms ?? [], title = meta?.name ?? `Item ${item}`;
  const rows = mode === 'difficulty' ? allRows.filter(row => selectedRealm === 'all' || row.difficulty?.toLowerCase() === selectedRealm) : allRows;
  if (!rows.length) return { embeds: [{ title, description: 'No current listings on tracked realms.', color: 0x5865F2 }], components: components(item, realms) };
  if (mode === 'realm') { const realmRows = rows.filter(entry => normalize(entry.realm) === normalize(selectedRealm)); return { embeds: [{ title, description: realmRows.length ? realmRows.slice(0, 20).map(row => `**${row.realm}** — ${variant(row)}\n${gold(row.min)} · ${row.quantity} listings`).join('\n') : `No current listing on **${selectedRealm}**.`, color: 0x5865F2 }], components: components(item, realms) }; }
  if (mode === 'compare' || mode === 'difficulty') return { embeds: [{ title, description: rows.slice(0, 20).map((row, i) => `**${i + 1}. ${row.realm} — ${gold(row.min)}**\n${variant(row)} · ${row.quantity} listings`).join('\n'), footer: { text: `${rows.length} variants${rows.length > 20 ? ' — showing first 20' : ''}` }, color: 0x5865F2 }], components: components(item, realms) };
  const cheapest = rows[0]; return { embeds: [{ title, description: `Cheapest: **${cheapest.realm}**`, fields: [{ name: 'Lowest price', value: `**${gold(cheapest.min)}**`, inline: true }, { name: 'Listings', value: String(cheapest.quantity), inline: true }, { name: 'Tracked realms', value: String(rows.length), inline: true }], footer: { text: `Updated ${new Date(cheapest.updatedAt).toLocaleString('en-GB')} UTC` }, color: 0x5865F2 }], components: components(item, realms) };
}
export default { async fetch(request, env) {
  if (request.method !== 'POST') return new Response('BOE Ledger Discord endpoint');
  if (!await validRequest(request, env)) return new Response('invalid request signature', { status: 401 });
  const interaction = await request.json();
  if (interaction.type === 1) return response({ type: 1 });
  if (interaction.type === 4) { const query = normalize(interaction.data.options?.find(option => option.focused)?.value); const choices = (await env.BOE_DATA.get('items:choices', 'json') ?? []).filter(item => normalize(item.name).includes(query)).slice(0, 25); return response({ type: 8, data: { choices: choices.map(item => ({ name: item.name, value: String(item.itemId) })) } }); }
  if (interaction.type === 2 && interaction.data.name === 'boe') return response({ type: 4, data: await embed(env, interaction.data.options?.[0]?.value) });
  const [prefix, action, item] = interaction.data.custom_id?.split(':') ?? [];
  if (interaction.type === 3 && prefix === 'boe') return response({ type: 7, data: await embed(env, item, action, interaction.data.values?.[0]) });
  return response({ type: 4, data: { content: 'Unknown interaction.' } });
} };
