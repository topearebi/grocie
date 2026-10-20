# 🛒 Grocery Genie

A personal grocery price catalog and basket optimizer. Record prices **while you
shop**, build up your own dataset over time, compare similar products across
stores, and get the cheapest possible combination of stores for your shopping
list.

Fully static — hosted entirely on **GitHub Pages**, with the catalog stored as
data files **in this repository**. No backend, no accounts, no build step.

## Features

- **In-store capture** — enter product name, price, size, unit, store and date,
  with an optional photo taken straight from the camera. Rapid entry flows
  (type-ahead suggestions, "Save & add another", last-used store memory).
- **Fuzzy search** — find products by name, brand or store (Fuse.js). Result
  cards show the photo, price, unit price, store and date recorded.
- **Automatic similarity grouping** — items describing the same product (other
  pack sizes, wording variants) are clustered together; open any product to see
  all similar items and their prices side by side, sorted for comparison.
- **Unit prices** — every record is normalised to £/100g, £/100ml or £/each so
  different pack sizes compare fairly.
- **Basket optimizer** — for each item on your list the app picks the store
  with your lowest recorded price, shows per-store subtotals, the number of
  stops, and how much you save vs. buying everything at a single store.
- **Import / export** — full JSON backup (photos included; imported photos are
  re-uploaded to the repo on the next sync) and CSV export; imports merge with
  existing data instead of overwriting.
- **Offline-friendly** — everything is saved locally first and synced to GitHub
  when you're back online.

## Using it

1. Open the app → **Capture** tab. Fill in what you see on the shelf and save.
2. Repeat as you walk the aisles. Your catalog grows in `data/catalog.json`.
3. **Search** to find products; tap *Add to list* on the ones you need.
4. Open **List** to see the cheapest store for every item, the totals per
   store, and your total savings.
5. Print the list (store-by-store columns) and go shopping.

## Setup (one time)

The catalog lives in this repository, so the app needs permission to write to
it:

1. Create a **fine-grained personal access token** on GitHub:
   *Resource owner*: you · *Only select repositories*: this repo ·
   *Permissions → Repository permissions → Contents: Read and write*.
2. Open the app → **Settings**, paste the token, confirm owner/repository/
   branch (auto-detected when hosted on GitHub Pages), then **Test connection**
   and **Save connection**.

The token is stored only in your browser's localStorage. Don't use a classic
token or a broad fine-grained one — scope it to this repository alone.

## Data

`data/catalog.json`:

```json
{
  "items": [
    {
      "id": "uuid",
      "name": "Baked Beans",
      "brand": "Heinz",
      "image": "data/images/<sha1>.jpg",
      "records": [
        { "store": "Lidl", "price": 0.95, "size": 415, "unit": "g", "date": "2026-10-19" }
      ]
    }
  ],
  "stores": ["Lidl", "Tesco", "Aldi"],
  "updated": "2026-10-20T00:00:00.000Z"
}
```

- **Size and unit live on each record** — pack sizes differ between stores, and
  unit prices are what make them comparable.
- Photos are compressed to ~512px thumbnails and committed to
  `data/images/`, content-addressed by hash so duplicates are never uploaded.
- Supported units: `g`, `kg`, `ml`, `l`, `each` (also `pc`, `pack`, `box`,
  `can`, `jar`, `bottle` for imports).

### CSV format

```
name,brand,store,price,size,unit,date
Baked Beans,Heinz,Lidl,0.95,415,g,2026-10-19
```

`brand` is optional; `date` accepts `YYYY-MM-DD` (falls back to today).

## How it works

| Path | Purpose |
| --- | --- |
| `index.html` | App shell (tabs + view container) |
| `js/app.js` | State, context, hash router, sync orchestration |
| `js/domain/catalog.js` | Items, records, unit pricing, similarity clustering, merging |
| `js/domain/optimize.js` | Pure function: shopping list → cheapest store assignment + totals |
| `js/domain/search.js` | Fuse.js fuzzy search with substring fallback |
| `js/store/github.js` | GitHub Contents API (read/write with sha conflict retry) |
| `js/store/cache.js` | localStorage mirror, settings, offline queue |
| `js/ui/*` | One module per view: capture, search, item, list, settings |
| `js/io.js` | CSV/JSON import & export |
| `data/catalog.json` | The catalog itself (served by Pages, written via API) |

**Sync model:** reads come from the Pages-served `data/catalog.json` (no auth).
Writes go through the GitHub Contents API with the current file `sha`, so a
stale write is detected, re-merged with the server copy (records are
union-merged by store/date/price/size/unit) and retried. Unsynced work is kept
in localStorage and flushed automatically when connectivity returns.

## Development

No build step. Serve the folder with any static server:

```sh
python3 -m http.server 8000
# → http://localhost:8000
```

Note: when running locally the owner/repo fields must be entered manually in
Settings (auto-detection only works on `*.github.io`).

## Deploying

Push to GitHub and enable Pages (*Settings → Pages → Deploy from a branch →
main, / (root)*). `.nojekyll` disables Jekyll processing.
