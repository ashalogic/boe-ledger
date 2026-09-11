# BOE Ledger

[![Refresh BOE prices](https://github.com/ashalogic/boe-ledger/actions/workflows/refresh.yml/badge.svg?branch=main)](https://github.com/ashalogic/boe-ledger/actions/workflows/refresh.yml)
[![Cloudflare Worker](https://img.shields.io/website?url=https%3A%2F%2Fboe-ledger.ashalogic.workers.dev%2F&label=Cloudflare%20Worker)](https://boe-ledger.ashalogic.workers.dev/)

Discord price bot for a curated list of EU World of Warcraft Bind-on-Equip items.

## Important limitation

The Blizzard auction endpoint supplies item IDs and auction prices, but **does not supply a reliable bind type**. `config/boe-items.json` is therefore the authoritative BOE allow-list. Never infer BOE status from an auction alone.

KV stores one atomic `snapshot:current` object containing item metadata, realm IDs, prices, and variants. Each hourly refresh performs one KV write, and each Discord interaction performs one KV read.

## Local test

Set the five environment variables used by `.github/workflows/refresh.yml`, add at least one verified item to `config/boe-items.json`, then run `npm run fetch`.
