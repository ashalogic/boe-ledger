const { DISCORD_APPLICATION_ID, DISCORD_BOT_TOKEN, DISCORD_GUILD_ID } =
  process.env;
if (!DISCORD_APPLICATION_ID || !DISCORD_BOT_TOKEN)
  throw new Error("Set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN");
const commands = [
  {
    name: "price",
    description: "Price for one BOE on one realm",
    options: [
      {
        name: "item",
        description: "BOE item name or ID",
        type: 3,
        required: true,
      },
      { name: "realm", description: "Realm name", type: 3, required: true },
    ],
  },
  {
    name: "compare",
    description: "Compare a BOE across tracked realms",
    options: [
      {
        name: "item",
        description: "BOE item name or ID",
        type: 3,
        required: true,
      },
    ],
  },
  {
    name: "realm",
    description: "Price for one BOE on one realm",
    options: [
      { name: "realm", description: "Realm name", type: 3, required: true },
      {
        name: "item",
        description: "BOE item name or ID",
        type: 3,
        required: true,
      },
    ],
  },
];
const path = DISCORD_GUILD_ID
  ? `applications/${DISCORD_APPLICATION_ID}/guilds/${DISCORD_GUILD_ID}/commands`
  : `applications/${DISCORD_APPLICATION_ID}/commands`;
const res = await fetch(`https://discord.com/api/v10/${path}`, {
  method: "PUT",
  headers: {
    Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(commands),
});
if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
console.log(
  `Registered ${commands.length} ${DISCORD_GUILD_ID ? "guild" : "global"} commands.`,
);
