# BOE Ledger

[![Refresh BOE prices](https://github.com/ashalogic/boe-ledger/actions/workflows/refresh.yml/badge.svg?branch=main)](https://github.com/ashalogic/boe-ledger/actions/workflows/refresh.yml)
[![Cloudflare Worker](https://img.shields.io/website?url=https%3A%2F%2Fboe-ledger.ashalogic.workers.dev%2F&label=Cloudflare%20Worker)](https://boe-ledger.ashalogic.workers.dev/)

Discord price bot for a curated list of EU World of Warcraft Bind-on-Equip items.

## Important limitation

The Blizzard auction endpoint supplies item IDs and auction prices, but **does not supply a reliable bind type**. `config/boe-items.json` is therefore the authoritative BOE allow-list. Never infer BOE status from an auction alone.

KV stores one current snapshot plus a compact 14-day hourly history per tracked item. Sale-speed values are estimates from disappearing listings; cancellations and expirations can affect them.

The Discord browser can filter exact secondary-stat pairs. Tertiary bonuses such as Speed, Leech, Avoidance, sockets, and Indestructible do not affect that filter.

## Discord item emojis

Run the `Export Discord emojis` workflow manually and download its `boe-ledger-discord-emojis` artifact. Upload the JPG files under **Discord Developer Portal → BOE Ledger → Emojis**, then copy each emoji ID into `config/discord-emojis.json` using the item ID as its key.

## Local test

Set the five environment variables used by `.github/workflows/refresh.yml`, add at least one verified item to `config/boe-items.json`, then run `npm run fetch`.
