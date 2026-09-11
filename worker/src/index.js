const encoder = new TextEncoder();
const normalize = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
const json = (data) => Response.json(data);
const STAT_NAMES = { 32: 'Critical Strike', 36: 'Haste', 40: 'Versatility', 49: 'Mastery' };
const BONUS_NAMES = {
  40: 'Avoidance',
  41: 'Leech',
  42: 'Speed',
  43: 'Indestructible',
  565: 'Socket',
  1808: 'Socket',
};
const actorId = (interaction) => interaction.member?.user?.id ?? interaction.user?.id;
const gold = (copper) =>
  `${Math.floor(copper / 10000).toLocaleString('en-US')}g ${Math.floor((copper % 10000) / 100)}s`;
const stats = (row) =>
  [
    ...new Set(
      (row.modifiers ?? [])
        .filter(({ type }) => type === 29 || type === 30)
        .map(({ value }) => STAT_NAMES[value])
        .filter(Boolean),
    ),
  ].join(' / ') || 'Unspecified';
const extras = (row) => [
  ...new Set((row.bonusLists ?? []).map((id) => BONUS_NAMES[id]).filter(Boolean)),
];
const updated = (generatedAt) => {
  const timestamp = Math.floor(Date.parse(generatedAt) / 1000);
  return Number.isFinite(timestamp)
    ? `Prices updated <t:${timestamp}:F> (<t:${timestamp}:R>)`
    : 'Price update time unavailable';
};
const twoColumns = (fields) =>
  fields.flatMap((field, index) =>
    index % 2 === 1 && index < fields.length - 1
      ? [field, { name: '\u200b', value: '\u200b', inline: true }]
      : [field],
  );

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

const realmRows = (snapshot, realm, item, difficulty) =>
  (snapshot.realms.find(({ name }) => normalize(name) === normalize(realm))?.items ?? []).filter(
    (entry) => entry.itemId === Number(item) && entry.difficulty?.toLowerCase() === difficulty,
  );
const rowLabel = (row) => {
  const bonus = extras(row);
  return `${stats(row)}${bonus.length ? ` · ${bonus.join(' · ')}` : ''}`;
};

function controls(snapshot, owner, item, difficulty, selectedRealm, page) {
  const pageCount = Math.max(1, Math.ceil(snapshot.items.length / 25));
  const safePage = Math.min(Math.max(page, 0), pageCount - 1);
  const start = safePage * 25;
  const result = [
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: `boe:item:${difficulty || 'none'}:${safePage}:${owner}`,
          placeholder: `1. Select a BOE item · page ${safePage + 1}/${pageCount}`,
          options: snapshot.items.slice(start, start + 25).map((choice) => ({
            label: choice.name,
            value: String(choice.itemId),
            default: String(choice.itemId) === String(item),
          })),
        },
      ],
    },
  ];
  if (pageCount > 1)
    result.push({
      type: 1,
      components: [
        {
          type: 2,
          style: 2,
          label: 'Previous items',
          custom_id: `boe:page:${Math.max(0, safePage - 1)}:${item || 'none'}:${difficulty || 'none'}:${owner}`,
          disabled: safePage === 0,
        },
        {
          type: 2,
          style: 2,
          label: 'Next items',
          custom_id: `boe:page:${Math.min(pageCount - 1, safePage + 1)}:${item || 'none'}:${difficulty || 'none'}:${owner}`,
          disabled: safePage === pageCount - 1,
        },
      ],
    });
  result.push({
    type: 1,
    components: [
      {
        type: 3,
        custom_id: `boe:difficulty:${item || 'none'}:${safePage}:${owner}`,
        placeholder: '2. Select a difficulty',
        options: ['Normal', 'Heroic', 'Mythic'].map((name) => ({
          label: name,
          value: name.toLowerCase(),
          default: name.toLowerCase() === difficulty,
        })),
      },
    ],
  });
  if (item && difficulty)
    result.push({
      type: 1,
      components: [
        {
          type: 3,
          custom_id: `boe:realm:${item}:${difficulty}:${safePage}:${owner}`,
          placeholder: 'Optional: inspect one realm',
          options: [
            { label: 'All realms', value: '__all__', default: !selectedRealm },
            ...snapshot.realms
              .slice(0, 24)
              .map(({ name }) => ({ label: name, value: name, default: name === selectedRealm })),
          ],
        },
      ],
    });
  return result;
}

async function render(snapshot, owner, item = '', difficulty = '', selectedRealm = '', page = 0) {
  const components = controls(snapshot, owner, item, difficulty, selectedRealm, page);
  if (!item || !difficulty)
    return {
      embeds: [
        { title: '📘 BOE Ledger', description: 'Select an item and difficulty.', color: 0x2f6fed },
      ],
      components,
    };
  const meta = snapshot.items.find((entry) => entry.itemId === Number(item));
  if (selectedRealm) {
    const rows = realmRows(snapshot, selectedRealm, item, difficulty).sort((a, b) => a.min - b.min);
    const grouped = new Map();
    for (const row of rows) {
      const key = `${row.itemLevel}:${rowLabel(row)}`;
      const current = grouped.get(key) ?? {
        label: rowLabel(row),
        itemLevel: row.itemLevel,
        min: row.min,
        quantity: 0,
      };
      current.min = Math.min(current.min, row.min);
      current.quantity += row.quantity;
      grouped.set(key, current);
    }
    const fields = twoColumns(
      [...grouped.values()]
        .sort((a, b) => a.min - b.min)
        .slice(0, 16)
        .map((row) => ({
          name: `⚔️ ${row.label}`,
          value: `⭐ **ilvl ${row.itemLevel ?? '?'}**\n💰 **${gold(row.min)}**\n📦 **${row.quantity}** available`,
          inline: true,
        })),
    );
    return {
      embeds: [
        {
          title: `📘 ${meta?.name ?? `Item ${item}`}`,
          description: `**${selectedRealm} · ${difficulty}**\n${updated(snapshot.generatedAt)}`,
          thumbnail: meta?.icon ? { url: meta.icon } : undefined,
          fields: fields.length
            ? fields
            : [{ name: 'No listings', value: 'No matching auctions found.' }],
          color: 0x2f6fed,
        },
      ],
      components,
    };
  }
  const summaries = snapshot.realms
    .map(({ name }) => ({ name, rows: realmRows(snapshot, name, item, difficulty) }))
    .filter(({ rows }) => rows.length)
    .map(({ name, rows }) => ({
      name,
      cheapest: [...rows].sort((a, b) => a.min - b.min)[0],
      total: rows.reduce((sum, row) => sum + row.quantity, 0),
    }))
    .sort((a, b) => a.cheapest.min - b.cheapest.min);
  const fields = twoColumns(
    summaries.map(({ name, cheapest, total }) => {
      const bonus = extras(cheapest);
      return {
        name,
        value: `⭐ **ilvl ${cheapest.itemLevel ?? '?'}**\n💰 **${gold(cheapest.min)}**\n📦 **${cheapest.quantity} at this variant · ${total} total**\n⚔️ ${stats(cheapest)}${bonus.length ? `\n✨ ${bonus.join(' · ')}` : ''}`,
        inline: true,
      };
    }),
  );
  return {
    embeds: [
      {
        title: `📘 ${meta?.name ?? `Item ${item}`}`,
        description: `**${difficulty} · EU realm comparison**\n${updated(snapshot.generatedAt)}`,
        thumbnail: meta?.icon ? { url: meta.icon } : undefined,
        fields: fields.length
          ? fields
          : [{ name: 'No listings', value: 'No matching auctions found.' }],
        color: 0x2f6fed,
      },
    ],
    components,
  };
}

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('BOE Ledger Discord endpoint');
    if (!(await validRequest(request, env)))
      return new Response('invalid request signature', { status: 401 });
    const interaction = await request.json();
    if (interaction.type === 1) return json({ type: 1 });
    const snapshot = await env.BOE_DATA.get('snapshot:current', 'json');
    if (!snapshot)
      return json({ type: 4, data: { content: 'Price data is not ready yet.', flags: 64 } });
    if (interaction.type === 2 && interaction.data.name === 'boe')
      return json({ type: 4, data: await render(snapshot, actorId(interaction)) });
    if (interaction.type === 3) {
      const parts = interaction.data.custom_id?.split(':') ?? [];
      const owner = parts.at(-1);
      if (actorId(interaction) !== owner)
        return json({
          type: 4,
          data: { content: 'Run `/boe` to open your own browser.', flags: 64 },
        });
      const [, action] = parts;
      const value = interaction.data.values?.[0] ?? '';
      if (action === 'item')
        return json({
          type: 7,
          data: await render(
            snapshot,
            owner,
            value,
            parts[2] === 'none' ? '' : parts[2],
            '',
            Number(parts[3]),
          ),
        });
      if (action === 'difficulty')
        return json({
          type: 7,
          data: await render(
            snapshot,
            owner,
            parts[2] === 'none' ? '' : parts[2],
            value,
            '',
            Number(parts[3]),
          ),
        });
      if (action === 'realm')
        return json({
          type: 7,
          data: await render(
            snapshot,
            owner,
            parts[2],
            parts[3],
            value === '__all__' ? '' : value,
            Number(parts[4]),
          ),
        });
      if (action === 'page')
        return json({
          type: 7,
          data: await render(
            snapshot,
            owner,
            parts[3] === 'none' ? '' : parts[3],
            parts[4] === 'none' ? '' : parts[4],
            '',
            Number(parts[2]),
          ),
        });
    }
    return json({ type: 4, data: { content: 'Unknown interaction.' } });
  },
};
