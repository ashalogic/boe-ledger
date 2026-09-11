const encoder = new TextEncoder();
const normalize = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const response = (data) => Response.json(data);
const STAT_NAMES = { 32: 'Critical Strike', 36: 'Haste', 40: 'Versatility', 49: 'Mastery' };

function gold(copper) {
  const amount = Math.floor(copper / 10000).toLocaleString('en-US');
  const silver = Math.floor((copper % 10000) / 100);
  return `${amount}g ${silver}s`;
}

function stats(row) {
  const names = (row.modifiers ?? [])
    .map(({ value }) => STAT_NAMES[value])
    .filter(Boolean);
  return [...new Set(names)].join(' / ') || 'Unspecified';
}

async function validRequest(request, env) {
  const signature = request.headers.get('X-Signature-Ed25519');
  const timestamp = request.headers.get('X-Signature-Timestamp');
  if (!signature || !timestamp || !env.DISCORD_PUBLIC_KEY) return false;
  const hex = (value) => Uint8Array.from(value.match(/.{2}/g) ?? [], (part) => parseInt(part, 16));
  const key = await crypto.subtle.importKey(
    'raw',
    hex(env.DISCORD_PUBLIC_KEY),
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    'Ed25519',
    key,
    hex(signature),
    encoder.encode(timestamp + (await request.clone().text())),
  );
}

async function loadRealm(env, realm, item, difficulty) {
  const data = await env.BOE_DATA.get(`realm:${normalize(realm)}`, 'json');
  return (data?.items ?? [])
    .filter(
      (entry) =>
        entry.itemId === Number(item) &&
        entry.difficulty?.toLowerCase() === difficulty.toLowerCase(),
    )
    .map((entry) => ({ ...entry, realm: data.realm, updatedAt: data.updatedAt }));
}

async function picker(env, item = '', difficulty = '', selectedRealm = '') {
  const choices = (await env.BOE_DATA.get('items:choices', 'json')) ?? [];
  const realms = (await env.BOE_DATA.get('meta:realms', 'json'))?.realms ?? [];
  const components = [
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: `boe:item:${difficulty || 'none'}`,
          placeholder: '1. Select a BOE item',
          options: choices.slice(0, 25).map((choice) => ({
            label: choice.name,
            value: String(choice.itemId),
            default: String(choice.itemId) === String(item),
          })),
        },
      ],
    },
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: `boe:difficulty:${item || 'none'}`,
          placeholder: '2. Select a difficulty',
          options: ['Normal', 'Heroic', 'Mythic'].map((name) => ({
            label: name,
            value: name.toLowerCase(),
            default: name.toLowerCase() === difficulty,
          })),
        },
      ],
    },
  ];

  const itemMeta = item ? await env.BOE_DATA.get(`item:${item}`, 'json') : null;
  if (!item || !difficulty) {
    return {
      embeds: [
        {
          title: '📘 BOE Ledger',
          description: 'Select both an item and a difficulty to compare EU realm prices.',
          color: 0x2f6fed,
        },
      ],
      components,
    };
  }

  const realmRows = await Promise.all(realms.map((realm) => loadRealm(env, realm, item, difficulty)));
  const summaries = realmRows
    .filter((rows) => rows.length)
    .map((rows) => ({ realm: rows[0].realm, cheapest: rows.sort((a, b) => a.min - b.min)[0], count: rows.reduce((sum, row) => sum + row.quantity, 0) }))
    .sort((a, b) => a.cheapest.min - b.cheapest.min);

  components.push({
    type: 1,
    components: [
      {
        type: 3,
        custom_id: `boe:realm:${item}:${difficulty}`,
        placeholder: 'Optional: inspect one realm',
        options: realms.slice(0, 25).map((realm) => ({ label: realm, value: realm, default: realm === selectedRealm })),
      },
    ],
  });

  if (selectedRealm) {
    const rows = (await loadRealm(env, selectedRealm, item, difficulty)).sort((a, b) => a.min - b.min);
    const grouped = new Map();
    for (const row of rows) {
      const name = stats(row);
      const current = grouped.get(name) ?? { name, min: row.min, quantity: 0 };
      current.min = Math.min(current.min, row.min);
      current.quantity += row.quantity;
      grouped.set(name, current);
    }
    return {
      embeds: [
        {
          title: `📘 ${itemMeta?.name ?? `Item ${item}`}`,
          description: `**${selectedRealm} · ${difficulty[0].toUpperCase() + difficulty.slice(1)}**`,
          fields: [...grouped.values()].sort((a, b) => a.min - b.min).map((row) => ({
            name: `⚔️ ${row.name}`,
            value: `💰 **${gold(row.min)}**\n📦 **${row.quantity}** available`,
            inline: true,
          })),
          color: 0x2f6fed,
        },
      ],
      components,
    };
  }

  return {
    embeds: [
      {
        title: `📘 ${itemMeta?.name ?? `Item ${item}`}`,
        description: `**${difficulty[0].toUpperCase() + difficulty.slice(1)} · EU realm comparison**`,
        fields: summaries.length
          ? summaries.map(({ realm, cheapest, count }) => ({
              name: realm,
              value: `💰 **${gold(cheapest.min)}**\n📦 **${count}** available\n⚔️ ${stats(cheapest)}`,
              inline: true,
            }))
          : [{ name: 'No listings', value: 'No matching auctions were found.' }],
        color: 0x2f6fed,
      },
    ],
    components,
  };
}

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('BOE Ledger Discord endpoint');
    if (!(await validRequest(request, env))) return new Response('invalid request signature', { status: 401 });
    const interaction = await request.json();
    if (interaction.type === 1) return response({ type: 1 });
    if (interaction.type === 2 && interaction.data.name === 'boe') {
      return response({ type: 4, data: await picker(env) });
    }
    if (interaction.type === 3) {
      const [prefix, action, first, second] = interaction.data.custom_id?.split(':') ?? [];
      if (prefix !== 'boe') return response({ type: 4, data: { content: 'Unknown interaction.' } });
      const value = interaction.data.values?.[0] ?? '';
      if (action === 'item') return response({ type: 7, data: await picker(env, value, first === 'none' ? '' : first) });
      if (action === 'difficulty') return response({ type: 7, data: await picker(env, first === 'none' ? '' : first, value) });
      if (action === 'realm') return response({ type: 7, data: await picker(env, first, second, value) });
    }
    return response({ type: 4, data: { content: 'Unknown interaction.' } });
  },
};
