# BOE Ledger

Discord price bot for a curated list of EU World of Warcraft Bind-on-Equip items.

## Important limitation

The Blizzard auction endpoint supplies item IDs and auction prices, but **does not supply a reliable bind type**. `config/boe-items.json` is therefore the authoritative BOE allow-list. Never infer BOE status from an auction alone.

KV stores one compact JSON object per realm, plus a small item index and metadata. This stays within the free daily KV write allowance; individual item keys would not.

## Local test

Set the five environment variables used by `.github/workflows/refresh.yml`, add at least one verified item to `config/boe-items.json`, then run `npm run fetch`.
