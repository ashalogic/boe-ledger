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
const statKey = (row) =>
  [
    ...new Set(
      (row.modifiers ?? [])
        .filter(({ type }) => type === 29 || type === 30)
        .map(({ value }) => value),
    ),
  ]
    .sort((a, b) => a - b)
    .join('-') || 'none';
const statLabel = (key) =>
  key === 'none'
    ? 'Unspecified'
    : key
        .split('-')
        .map((value) => STAT_NAMES[value] ?? value)
        .join(' / ');
const marketLabel = (metric) => {
  if (!metric || metric.samples < 2) return '⚪ Building history';
  const activity = { high: '🔥 High', medium: '🟡 Medium', low: '🐢 Low' }[metric.activity];
  const wait = metric.estimatedDays === null ? 'no estimate' : `~${metric.estimatedDays}d supply`;
  const trend = `${metric.priceChange > 0 ? '+' : ''}${metric.priceChange}% price`;
  return `${activity} activity · ${wait} · ${trend}`;
};
const updated = (generatedAt) => {
  const timestamp = Math.floor(Date.parse(generatedAt) / 1000);
  return Number.isFinite(timestamp)
    ? `Prices updated <t:${timestamp}:F> (<t:${timestamp}:R>)`
    : 'Price update time unavailable';
};
const itemAuthor = (meta, item) => ({
  name: meta?.name ?? `Item ${item}`,
  ...(meta?.icon ? { icon_url: meta.icon } : {}),
});

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

const realmRows = (snapshot, realm, item, difficulty, selectedStats = 'all') =>
  (snapshot.realms.find(({ name }) => normalize(name) === normalize(realm))?.items ?? []).filter(
    (entry) =>
      entry.itemId === Number(item) &&
      entry.difficulty?.toLowerCase() === difficulty &&
      (selectedStats === 'all' || statKey(entry) === selectedStats),
  );
const rowLabel = (row) => {
  const bonus = extras(row);
  return `${stats(row)}${bonus.length ? ` · ${bonus.join(' · ')}` : ''}`;
};

function controls(snapshot, owner, item, difficulty, selectedStats, selectedRealm, page) {
  const pageCount = Math.max(1, Math.ceil(snapshot.items.length / 25));
  const safePage = Math.min(Math.max(page, 0), pageCount - 1);
  const start = safePage * 25;
  const result = [
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: `boe:item:${difficulty || 'none'}:${selectedStats}:${safePage}:${owner}`,
          placeholder: `1. Select a BOE item · page ${safePage + 1}/${pageCount}`,
          options: snapshot.items.slice(start, start + 25).map((choice) => ({
            label: choice.name,
            value: String(choice.itemId),
            default: String(choice.itemId) === String(item),
            ...(choice.emojiId
              ? { emoji: { id: choice.emojiId, name: `item_${choice.itemId}` } }
              : {}),
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
          custom_id: `boe:page:${Math.max(0, safePage - 1)}:${item || 'none'}:${difficulty || 'none'}:${selectedStats}:${owner}`,
          disabled: safePage === 0,
        },
        {
          type: 2,
          style: 2,
          label: 'Next items',
          custom_id: `boe:page:${Math.min(pageCount - 1, safePage + 1)}:${item || 'none'}:${difficulty || 'none'}:${selectedStats}:${owner}`,
          disabled: safePage === pageCount - 1,
        },
      ],
    });
  result.push({
    type: 1,
    components: [
      {
        type: 3,
        custom_id: `boe:difficulty:${item || 'none'}:${selectedStats}:${safePage}:${owner}`,
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
          custom_id: `boe:stats:${item}:${difficulty}:${safePage}:${owner}`,
          placeholder: '3. Filter secondary stats',
          options: [
            { label: 'All secondary stats', value: 'all', default: selectedStats === 'all' },
            ...[
              ...new Set(
                snapshot.realms.flatMap(({ name }) =>
                  realmRows(snapshot, name, item, difficulty).map(statKey),
                ),
              ),
            ]
              .sort((a, b) => statLabel(a).localeCompare(statLabel(b)))
              .map((key) => ({
                label: statLabel(key),
                value: key,
                default: selectedStats === key,
              })),
          ].slice(0, 25),
        },
      ],
    });
  if (item && difficulty)
    result.push({
      type: 1,
      components: [
        {
          type: 3,
          custom_id: `boe:realm:${item}:${difficulty}:${selectedStats}:${safePage}:${owner}`,
          placeholder: '4. Optional: inspect one realm',
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

async function render(
  snapshot,
  owner,
  item = '',
  difficulty = '',
  selectedStats = 'all',
  selectedRealm = '',
  page = 0,
) {
  const components = controls(
    snapshot,
    owner,
    item,
    difficulty,
    selectedStats,
    selectedRealm,
    page,
  );
  if (!item || !difficulty)
    return {
      embeds: [
        { title: '📘 BOE Ledger', description: 'Select an item and difficulty.', color: 0x2f6fed },
      ],
      components,
    };
  const meta = snapshot.items.find((entry) => entry.itemId === Number(item));
  if (selectedRealm) {
    const rows = realmRows(snapshot, selectedRealm, item, difficulty, selectedStats).sort(
      (a, b) => a.min - b.min,
    );
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
    const fields = [...grouped.values()]
      .sort((a, b) => a.min - b.min)
      .slice(0, 25)
      .map((row) => {
        const metric = snapshot.market?.[`${selectedRealm}|${item}|${difficulty}|${statKey(row)}`];
        return {
          name: `⚔️ ${row.label}`,
          value: `⭐ **ilvl ${row.itemLevel ?? '?'}**  ·  💰 **${gold(row.min)}**  ·  📦 **${row.quantity} available**\n${marketLabel(metric)}`,
          inline: false,
        };
      });
    return {
      embeds: [
        {
          author: itemAuthor(meta, item),
          description: `**${selectedRealm} · ${difficulty} · ${selectedStats === 'all' ? 'All stats' : statLabel(selectedStats)}**\n${updated(snapshot.generatedAt)}`,
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
    .map(({ name }) => ({
      name,
      rows: realmRows(snapshot, name, item, difficulty, selectedStats),
    }))
    .filter(({ rows }) => rows.length)
    .map(({ name, rows }) => ({
      name,
      cheapest: [...rows].sort((a, b) => a.min - b.min)[0],
      total: rows.reduce((sum, row) => sum + row.quantity, 0),
    }))
    .sort((a, b) => a.cheapest.min - b.cheapest.min);
  const fields = summaries.map(({ name, cheapest, total }, index) => {
    const bonus = extras(cheapest);
    const metric = snapshot.market?.[`${name}|${item}|${difficulty}|${statKey(cheapest)}`];
    return {
      name: `${index === 0 ? '🏆' : '🌐'} ${name}`,
      value: `💰 **${gold(cheapest.min)}**  ·  📦 **${cheapest.quantity} cheapest / ${total} total**\n⭐ **ilvl ${cheapest.itemLevel ?? '?'}**  ·  ⚔️ ${stats(cheapest)}${bonus.length ? `  ·  ✨ ${bonus.join(' · ')}` : ''}\n${marketLabel(metric)}`,
      inline: false,
    };
  });
  return {
    embeds: [
      {
        author: itemAuthor(meta, item),
        description: `**${difficulty} · ${selectedStats === 'all' ? 'All stats' : statLabel(selectedStats)} · EU comparison**\n${updated(snapshot.generatedAt)}\n*Activity estimates use listing disappearances; cancellations can affect them.*`,
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
            parts[3],
            '',
            Number(parts[4]),
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
            parts[3],
            '',
            Number(parts[4]),
          ),
        });
      if (action === 'stats')
        return json({
          type: 7,
          data: await render(snapshot, owner, parts[2], parts[3], value, '', Number(parts[4])),
        });
      if (action === 'realm')
        return json({
          type: 7,
          data: await render(
            snapshot,
            owner,
            parts[2],
            parts[3],
            parts[4],
            value === '__all__' ? '' : value,
            Number(parts[5]),
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
            parts[5],
            '',
            Number(parts[2]),
          ),
        });
    }
    return json({ type: 4, data: { content: 'Unknown interaction.' } });
  },
};
