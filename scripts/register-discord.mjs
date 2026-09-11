const { DISCORD_APPLICATION_ID, DISCORD_BOT_TOKEN, DISCORD_GUILD_ID } = process.env;
if (!DISCORD_APPLICATION_ID || !DISCORD_BOT_TOKEN) throw new Error('Set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN');
const commands = [{ name: 'boe', description: 'Look up an EU BOE auction price', options: [{ name: 'item', description: 'Start typing a BOE name', type: 3, required: true, autocomplete: true }] }];
const path = DISCORD_GUILD_ID ? `applications/${DISCORD_APPLICATION_ID}/guilds/${DISCORD_GUILD_ID}/commands` : `applications/${DISCORD_APPLICATION_ID}/commands`;
const res = await fetch(`https://discord.com/api/v10/${path}`, { method: 'PUT', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(commands) });
if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
console.log(`Registered /boe as a ${DISCORD_GUILD_ID ? 'guild' : 'global'} command.`);
