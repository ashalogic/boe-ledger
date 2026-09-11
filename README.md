[![Refresh BOE prices](https://github.com/ashalogic/boe-ledger/actions/workflows/refresh.yml/badge.svg?branch=main)](https://github.com/ashalogic/boe-ledger/actions/workflows/refresh.yml)
[![Cloudflare Worker](https://img.shields.io/website?url=https%3A%2F%2Fboe-ledger.ashalogic.workers.dev%2F&label=Cloudflare%20Worker)](https://boe-ledger.ashalogic.workers.dev/)
[![Add to Discord](https://img.shields.io/badge/Add%20to-Discord-5865F2?logo=discord&logoColor=white)](https://discord.com/oauth2/authorize?client_id=1547962017506267136&permissions=0&scope=bot%20applications.commands)

<p align="center">
  <img src="docs/c4cd7c2a-f4a4-4709-aff2-2c6fe75b2fec.png" alt="BOE Ledger" width="100%">
</p>

# BOE Ledger

Discord bot for tracking selected EU World of Warcraft BOE item prices.

## Features

- Automatic BOE price refresh
- Current prices stored in Cloudflare KV
- Discord commands for price lookup
- Short-term price history
- Curated BOE item list

## Data

Tracked items are defined in:

```text
config/boe-items.json
```
