import { readFile } from "node:fs/promises";

try {
  const file = await readFile(".env", "utf8");
  for (const line of file.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const { DISCORD_APPLICATION_ID, DISCORD_BOT_TOKEN } = process.env;
if (!DISCORD_APPLICATION_ID || !DISCORD_BOT_TOKEN)
  throw new Error("Set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN");
const commands = [
  {
    name: "boe",
    description: "Look up an EU BOE auction price",
    options: [
      {
        name: "item",
        description: "Start typing a BOE name",
        type: 3,
        required: true,
        autocomplete: true,
      },
    ],
  },
];
const path = `applications/${DISCORD_APPLICATION_ID}/commands`;
const res = await fetch(`https://discord.com/api/v10/${path}`, {
  method: "PUT",
  headers: {
    Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(commands),
});
if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
console.log("Registered /boe globally.");
