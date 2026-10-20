# Design Notes & Reference Log — Grocery Genie

Documentation deliverable. Derived entirely from reading the codebase
(`index.html`, `styles.css`, `js/**`, `data/catalog.json`, `README.md`) —
**no source files were modified** for this task.

Sections are grouped by concern (architecture → data → views → a11y →
responsive → open questions). Section 0 is the running change log.

---

## 0. Change Log

| # | Date | Entry |
| --- | --- | --- |
| 0 | 2026-10-20 | Baseline assessment captured before any work (repo as found). |
| 1 | 2026-10-20 | Full codebase read-through; this reference document written: architecture, data model, API/data flow, domain logic, per-view UI/UX state reference, accessibility audit, responsive rules, open questions. Scope confirmed by requester: documentation only, no code edits. |

---

## 1. Baseline Assessment (Entry 0)

- **What it is:** personal grocery price catalog + basket optimizer. Fully
  static, no build step, hosted on GitHub Pages; the catalog is a JSON file in
  the repo, written through the GitHub Contents API.
- **Size:** ~2,150 lines of JS across 16 modules, 844 lines CSS, 38-line app
  shell. `data/catalog.json` currently holds an empty catalog (fresh state).
- **Git state at capture:** clean working tree; latest commit
  `1472e88 "Rebuild Grocery Genie as a personal price catalog"`.
- **Housekeeping notes found:** `.nojekyll` present (correct for Pages);
  a `.DS_Store` file is committed (harmless clutter; suggest `.gitignore`).

---

## 2. System Architecture

### 2.1 Overview

```
┌────────────────────────── Browser (no build step) ──────────────────────────┐
│ index.html (shell: header, tab nav, <main id="view" aria-live="polite">)    │
│                                                                             │
│  js/app.js ── state + ctx façade + hash router + sync orchestration         │
│     │                                                                       │
│     ├── js/ui/*        render(container, ctx, params) → innerHTML + bindings│
│     ├── js/domain/*    pure logic: catalog, search, optimize                │
│     ├── js/store/*     persistence: cache.js (localStorage), github.js (API)│
│     └── js/io.js       CSV/JSON import-export                              │
│                                                                             │
│  CDN globals: Fuse.js 6.6.2, PapaParse 5 (both optional at runtime)        │
└──────────────┬──────────────────────────────────────┬───────────────────────┘
               │ reads (unauthenticated, no-cache)    │ writes (fine-grained PAT,
               ▼                                      ▼  contents r/w, sha-guarded)
   GitHub Pages: data/catalog.json      GitHub API: /repos/{owner}/{repo}/contents/*
                                                 └── data/catalog.json
                                                 └── data/images/<sha1>.jpg
```

### 2.2 Key design decisions, alternatives, and accepted trade-offs

| Decision | Why (as evidenced in code) | Alternative rejected | Trade-off accepted |
| --- | --- | --- | --- |
| Repo file as source of truth; Pages-served reads, API writes | Zero backend/accounts; `fetchPublishedCatalog()` bypasses the API entirely (no auth, no CORS pain, cache-busted with `?t=`) | Backend service; GitHub as write-only with another read store | No auth on reads ⇒ data public if repo is public; writes serialized only by sha check, not by a real lock |
| Single module-level `state` + `ctx` façade with getters/imperative methods | Simple mental model; views stay decoupled from storage | Event store / Redux-style actions | Full re-render on every mutation; scroll/focus/input state lost unless a view guards it (only `adoptRemote()` checks `viewContainsFocus()`) |
| Views are `render(container, ctx, params)` functions that rewrite `innerHTML` | No framework, no build; string templating with manual `esc()` | Virtual DOM / framework | Escaping is developer discipline (`esc` vs `escAttr` duplication in `settings.js`); whole-view rebuild is O(view) each update |
| Union-merge catalogs by record key on sync conflict (`mergeCatalogs`) | Multi-device safe without CRDTs; identical records dedupe, distinct records survive | Last-write-wins on whole file | Records identical on `(store,date,price,size,unit)` collapse into one — genuinely duplicated captures are silently deduped |
| Photos uploaded **before** catalog write in `syncNow` | "the catalog only ever references images that exist" (comment in `app.js`) | Upload after | A failure mid-loop leaves some images uploaded and catalog stale — recoverable (content-addressed, re-skip) but pending queue must survive |
| Content-addressed images (`SHA-1` of base64 → `data/images/<hash>.ext`) | Duplicate photos never re-upload (`uploadImage` returns early if file exists) | UUID filenames | Hash collision risk negligible; non-`crypto.subtle` contexts fall back to `Date.now+random` (dedupe disabled there) |
| Debounced sync (2.5 s) + 120 s safety-net interval + `online` event | Coalesces rapid edits; catches missed debounce (closed tab) | Sync every commit | Up to ~2 min of exposure if the tab closes right after an edit; interval keeps running while idle |
| localStorage mirror written on **every** `commit()` | Offline-first; app "works offline from first run" (explicit `persist()` after bootstrap) | IndexedDB | ~5 MB quota; `writeJSON()` failures are **silently ignored** (returns `false`, callers never check — see §12 risk R2) |
| CDN globals for Fuse/PapaParse instead of bundling | Keeps no-build promise; both degrade gracefully (substring search fallback; CSV import throws a clear error if Papa missing) | Vendor the files locally | First load needs network; PapaParse pinned as floating `@5` (reproducibility risk, see §11 Q6) |
| Hash router (`#/view/...`) | Works on any static host with zero config | History API routing | URLs not shareable outside the app; `#/item/<uuid>` deep links work but carry no pretty slugs |
| `window.confirm()` for destructive actions; `window.open` for print | Native, accessible, zero code | Custom modal / print stylesheet | Popup blockers break print (handled with an error toast); confirms are unstyled and block |

### 2.3 Module dependency map

```
app.js ──► store/cache.js, store/github.js, domain/catalog.js, util.js,
           ui/{capture,search,item,list,settings}.js
ui/*   ──► util.js, domain/*, ui/shared.js        (no cross-view imports)
store/github.js ──► domain/catalog.js (mergeCatalogs only)
domain/* are pure (no DOM, no storage): catalog, search, optimize
io.js  ──► util.js, PapaParse global
```

- Layering is consistent: **ui → domain → store**; only `app.js` touches all
  layers. This is the strongest structural invariant in the codebase and worth
  preserving in any refactor.

---

## 3. Data Model & Structures

### 3.1 Catalog (`data/catalog.json`, also mirrored in `gg.cache.v1`)

```jsonc
{
  "items": [
    {
      "id": "uuid",              // crypto.randomUUID() (fallback: id-<ts>-<rand>)
      "name": "Baked Beans",     // trimmed; identity = (name, brand) normalized
      "brand": "Heinz",          // may be "" / null-ish
      "image": "data/images/<sha1>.jpg" | null | "data:<mime>;base64,…" (transient),
      "records": [
        { "store": "Lidl", "price": 0.95, "size": 415, "unit": "g",
          "date": "2026-10-19" }   // date is YYYY-MM-DD, falls back to today on import
      ]
    }
  ],
  "stores": ["Lidl", "Tesco"],   // first-seen order, deduped case-insensitively
  "updated": "ISO-8601"          // bumped on every commit and every outgoing sync push
}
```

- **Size/unit live on each record**, not the item — pack sizes differ per
  store; unit price is the comparison key (README + `unitPrice()`).
- Item identity: `findItem()` matches exact normalized `name` + `brand`.
  Similarity for *display grouping* is looser (see §5.2).

### 3.2 Settings (`gg.settings.v1`)

| Field | Purpose | Notes |
| --- | --- | --- |
| `token` | fine-grained PAT, `type="password"` input | lives only in localStorage; sent as `Authorization: Bearer` |
| `owner`, `repo` | GitHub coordinates | auto-detected by `detectRepo()` when hostname ends `.github.io`; must be typed manually on localhost |
| `branch` | defaults `'main'` | `testConnection()` warns if it differs from the repo's `default_branch` |
| `lastStore` | last store typed in Capture | pre-fills Store field and is unshifted into the store datalist |

- `loadSettings()` strips empty/null values, so an empty field behaves as unset.

### 3.3 localStorage keys

| Key | Contents | Written when |
| --- | --- | --- |
| `gg.settings.v1` | §3.2 | `ctx.saveSettings()` (Capture store memory, Settings form) |
| `gg.cache.v1` | `{ catalog, baseUpdated, dirty, pendingImages }` | every `commit()`, `addPendingImage()`, sync result, boot |
| `gg.list.v1` | array of item ids | every list toggle/remove/clear |
| — | `localStorage.clear()` on **Danger zone** clear (wipes settings incl. token) | `clearAllLocal()` |

### 3.4 Pending image queue

- Shape: `{ itemId, dataUrl }[]` (base64 JPEG from `compressImage`,
  max 512 px, quality 0.75).
- One pending image per item (new one replaces the previous for that item).
- `shared.js:itemImageSrc()` prefers the pending data URL over the stored path,
  so previews are correct pre-sync.

### 3.5 Derived structures

- **Offer** (shared by cards, item view, list): `{ store, price, date, size,
  unit, record, unitPrice }` — always the *latest* record per store
  (`latestPerStore`), sorted ascending by price, non-finite prices filtered.
- **Plan** (return of `optimizeList`, drives List view + print):

```js
{
  rows: [{ item, best, offers, up } | { item, noData: true }],
  storeTotals:   { [store]: number },
  storeCounts:   { [store]: number },
  grandTotal: number,
  stops: number,                 // count of distinct stores in best-offers
  baseline: { store, total, missing } | null,
  savings: number | null,        // null when baseline has missing items
  noDataCount, itemCount
}
```

---

## 4. API & Data Flow

### 4.1 GitHub API surface (all in `store/github.js`)

Base `https://api.github.com`, headers `Accept: application/vnd.github+json`,
`X-GitHub-Api-Version: 2022-11-28`, `Authorization: Bearer <token>`.

| Operation | Method & endpoint | Behavior |
| --- | --- | --- |
| Read catalog from server | `GET /repos/{owner}/{repo}/contents/data/catalog.json?ref={branch}` | 404 → `{exists:false}`; base64-decoded; non-file → 400; non-base64/oversized → 413 |
| Write catalog | `PUT .../contents/data/catalog.json` `{message, content, branch, sha?}` | `sha` required for existing files; missing `sha` on existing file ⇒ 409/422 |
| Upload image | `PUT .../contents/data/images/{hash}.{ext}` | skipped entirely if `GET` says it exists |
| Test connection | `GET /repos/{owner}/{repo}` | reports `full_name`, `default_branch`, catalog presence, branch mismatch |
| Read published catalog | `GET <baseURI>data/catalog.json?t=<now>` with `cache:'no-cache'` | **not** the API — served by Pages, unauthenticated; returns `null` unless `items` is an array |

**Error mapping** (`errorFrom`): message taken from response body; 401 →
"Invalid or expired token — check Settings."; 403 → "Access denied or rate
limited: …"; everything else surfaces the GitHub message via `GitHubError(status)`.

### 4.2 Boot sequence (`bootstrap()` in `app.js`)

1. `detectRepo()` → merge with stored settings (`branch` defaults `main`).
2. `loadCache()` → restore catalog, `baseUpdated`, `dirty`, `pendingImages`;
   `loadList()` → restore shopping list.
3. Bind events: `hashchange` → `route()`, `online`/`offline` → status +
   opportunistic sync, 120 s safety-net interval, sync pill → Settings.
4. `renderNav()`, `renderStatus()`, `route()` (renders `#/capture` by default),
   then `persist()` — snapshots state so a first-run offline load works.
5. `fetchPublishedCatalog()` → `adoptRemote(remote)`:
   - **local dirty** → keep local; only store `remote.updated` as `baseUpdated`
     so the next sync union-merges ("Local unsynced work wins for now").
   - **local empty or remote `updated` newer** → adopt remote, and re-render
     *only if focus is not inside the view* (`viewContainsFocus()` guard).
   - else if remote newer than base → just refresh `baseUpdated`.
6. If dirty or images pending → `syncNow(false)`.

### 4.3 Mutation path (single funnel)

```
view code → ctx.commit(mutator)
   1. mutator(state.catalog)          // domain function mutates in place
   2. catalog.updated = now
   3. state.dirty = true
   4. persist()  → localStorage gg.cache.v1
   5. renderStatus()                  // sync pill update
   6. scheduleSync()                  // debounce 2500ms → syncNow(false)
```

All catalog writes go through `commit()` — this is the invariant that keeps
`dirty`/`persist`/sync consistent. List mutations and settings use their own
lighter paths (`toggleList` → `saveList` + `renderNav`).

### 4.4 Sync write path (`syncNow`)

Guard order: already syncing → not configured (`idle` + toast on manual) →
`navigator.onLine === false` (`offline` pill) → nothing to do (`idle` + toast)
→ else `syncing`.

Then:
1. **Images first:** `while (pendingImages.length)` → `uploadImage()` → set
   `item.image = path`, `dirty = true`, `shift()` + `persist()` per image.
2. `syncCatalog(settings, catalog, baseUpdated)`:
   - No server file yet → PUT local as-is (`"Add grocery catalog"`).
   - Server file present → `buildOutgoing`:
     - server parses & `remote.updated === baseUpdated` ⇒ send local as-is
       (fast path, no merge),
     - otherwise ⇒ `mergeCatalogs(remote, local)`,
     - unreadable server copy ⇒ local wins.
     - stamp fresh `updated`.
   - PUT with server `sha`; on **409/422 conflict** → re-GET, re-merge with the
     fresh remote ("always merge the fresh remote copy"), retry once; if the
     file vanished, PUT without sha to recreate.
3. Success → `catalog = merged`, `baseUpdated = merged.updated`,
   `dirty = false`, `idle`. Failure → `error` pill, `syncError`, toast only on
   manual sync (auto-sync failures are *silent except the pill + tooltip*).

### 4.5 Merge semantics (`mergeCatalogs(preferred, other)`)

- Items keyed by `id`; `preferred` wins for `name`/`brand`/`image` on conflict,
  but only empty fields get filled — first non-empty wins in iteration order
  (preferred first).
- Records unioned by key `store|date|price|size|unit` (normalized) — exact
  duplicates collapse; order preserved first-seen.
- `stores` unioned case-insensitively, preferred order first.
- `updated` = max of the two (string sort of ISO timestamps).

### 4.6 Potential bottlenecks & refactoring debt

- **O(n²) similarity clustering:** `groupItems()` runs union-find over all
  pairwise item comparisons, and `clusterForItem()` calls it from scratch on
  every Item-view render. Fine at hundreds of items; degrades at thousands and
  recomputes identical work. *Debt: memoize per render or precompute a cluster
  index on commit.*
- **Fuse index rebuilt per keystroke:** `searchItems()` constructs a new
  `Fuse` instance (full index build) on every debounced draw (120 ms).
  *Debt: cache the instance, invalidate on catalog change.*
- **Full innerHTML re-render** of the active view on every toggle/delete —
  simple but discards scroll position and re-runs focus() calls; the Item view
  re-renders itself recursively after each action.
- **Dirty-flag race window:** a mutation landing *while* `syncCatalog` is
  awaiting can be folded into the outgoing payload and then cleared by
  `dirty = false` on success; if the mutation occurs after the payload was
  built but before the flag reset, it stays persisted locally but marked clean
  (a later `online`/interval pass may not reschedule it). Narrow window,
  low likelihood, but real — worth a "dirty epoch" counter in a refactor.
- **localStorage quota:** `saveCache` serializes the whole catalog *plus*
  base64 `pendingImages` on every commit; `writeJSON` returns `false` on
  quota/serialization failure and **no caller checks it** (silent data-loss
  path). See risk R2.
- **`compressImage` always emits `image/jpeg`**, so the PNG/WebP extension
  logic in `uploadImage()` is effectively dead code (harmless).

---

## 5. Domain Logic Reference (pure modules)

### 5.1 Unit pricing — `catalog.js: unitPrice(price, size, unit)`

| Basis | Units (factors) | Formula | Label |
| --- | --- | --- | --- |
| mass | mg 0.001, g 1, kg 1000 | `price / grams × 100` | `£x.xx/100g` |
| volume | ml 1, cl 10, l 1000 | `price / ml × 100` | `£x.xx/100ml` |
| each | each/pc/pcs/pack/box/can/jar/bottle (all 1) | `price / size` | `£x.xx/each` |

- Returns `null` for unknown units, non-finite inputs, `size <= 0`,
  or negative price; UI renders `'—'` (`unitPriceLabel`).
- `UNIT_OPTIONS` (capture dropdown) = `g, kg, ml, l, each` — narrower than the
  accepted import set (imports may add `cl`, `pc`, `pack`, `can`, …).
- Currency is hard-coded `£` / `en-GB` formatting throughout (`money`,
  `fmtDate`) — locale is a product decision, see §11 Q7.

### 5.2 Similarity grouping — `groupItems(items)`

Two items cluster together if either:
1. `canonicalName` equal (lowercased, all non-letter/digit stripped), **or**
2. `tokenSim ≥ 0.85` where tokens = lowercased words, punctuation split out,
   **stop words removed** (`the a an of and`), and **any token starting with a
   digit is dropped** (so "415g Baked Beans" ≈ "Baked Beans"), and
   `tokenSim = |A∩B| / min(|A|, |B|)` (overlap coefficient, not Jaccard).
- Union-find clusters transitively; `GROUP_THRESHOLD = 0.85` exported.
- *Design intent (comment): different pack sizes, wording variants and missing
  brand all count as "similar".* Brand is **not** part of similarity — Heinz
  and store-brand beans with identical wording will group (flagged as Q3).

### 5.3 Basket optimization — `optimize.js: optimizeList(catalog, listIds)`

- Skips ids no longer in the catalog (deleted after being added).
- Per item: latest record per store → offers sorted by **absolute price**
  (deliberate: "what you actually pay", comment in `bestOffer`); row takes
  cheapest (`best`); zero offers ⇒ `{item, noData:true}` row (excluded from
  totals, counted in `noDataCount`).
- **Baseline** = best *single* store for the same basket: among all stores that
  appear in any offer, minimize `missing` first, then `total`. `savings` is
  only reported when `missing === 0` (clamped ≥ 0).
- If any item lacks data, the "You save" comparison is suppressed and instead
  "No single store has everything — X lacks N items" is shown (only when
  `baseline.missing > 0`); items with no records are footnoted separately.

### 5.4 Search — `search.js: searchItems(items, term)`

- Empty term → all items sorted A→Z.
- With Fuse (threshold 0.4, ignoreLocation, keys `name .6 / brand .25 /
  records.store .15`): if Fuse returns **0 results the function returns `[]`**
  — the substring fallback only runs when the Fuse global is absent (CDN
  blocked/offline), *not* when Fuse finds nothing. (Asymmetry worth knowing:
  the "fallback" is an availability fallback, not a relevance fallback.)

---

## 6. UI/UX Component Reference

Shell + one section per route. "States" lists default / loading / empty /
error / disabled / permission behavior as implemented.

### 6.1 App shell (`index.html` + `app.js` chrome)

- **Header:** brand + tagline (left), sync pill `<button id="sync-status">`
  (right, sticky `top:0`); click → `#/settings`.
- **Sync pill states** (`renderStatus`, evaluated top-down):

| Condition | Text | Class |
| --- | --- | --- |
| offline **and** unsynced work | `Offline — unsynced` | `s-warn` |
| sync in flight | `Syncing…` | `s-busy` |
| last sync failed | `Sync failed` (tooltip = `syncError`) | `s-error` |
| dirty or pending images | `Unsynced changes` (or `Local changes` if unconfigured) | `s-warn` |
| configured & clean | `Synced` | `s-ok` |
| fallback | `Local only` | `s-local` |

- **Tab nav:** 4 anchors (`Capture, Search, List, Settings`); active = `.active`
  class from `setActiveTab()`; List badge shows count, hidden at 0
  (`renderNav`). Horizontally scrollable (`overflow-x:auto`), sticky at
  `top: 57px`.
- **Toast** (`util.js`): single reused element, `role="status"`, types
  success/error/info, auto-hide 3.2 s, centered bottom pill. Overwrites any
  in-flight toast (last message wins).
- **Router:** default `#/capture`; `#/item/:id` maps to the Search tab;
  unknown routes fall through to Search. On each route change: `#view`
  cleared, `view.scrollTop` + `window.scrollTo(0,0)` reset.

### 6.2 Capture (`#/capture`) — `ui/capture.js`

*Rapid-entry form: name, brand, price, size, unit, store, date, photo.*

| State | Behavior |
| --- | --- |
| Default | Unit defaults `g`, date defaults today, Store pre-filled with `lastStore`; name autofocuses (price autofocuses when arriving from `#/capture?item=`) |
| Live match hint | On name/brand input, `#match-hint` says "Existing product (N records) — this will be added to it." (green) or "New product — will be added to your catalog." (blue); hidden when name empty |
| Validation (error) | `setCustomValidity` + `reportValidity()`: name required, price > 0, size required unless unit = `each` ("Enter the pack size so a unit price can be calculated"). `novalidate` on form → custom messages only |
| Save | `commit()` + persist `lastStore` + toast success; photo queued async (`attachImage` → its own toast). "Save entry" resets store/date too; **"Save & add another" keeps store+date** (in-aisle flow); focus returns to name |
| Photo states | hidden preview → object-URL preview + "Remove photo" button → cleared on save; compression failure → error toast, entry unaffected |
| Disabled | none (buttons always enabled; no double-submit guard — rapid taps could double-record, see Q8) |

Notes: `datalist` type-ahead over existing names/brands/stores (lastStore
unshifted if missing). `inputmode="decimal"` + `capture="environment"` are
deliberate phone-in-aisle affordances.

### 6.3 Search (`#/search`) — `ui/search.js`

| State | Behavior |
| --- | --- |
| Default | Header shows live stats (`N products · N price records · N stores`); input focused; unsorted query → A→Z list |
| Loading | *none* — results render synchronously (debounced 120 ms) |
| Empty (no catalog) | `.empty-state`: "No products yet." + primary CTA → `#/capture` |
| Empty (no match) | `.empty-state`: `No matches for “term”.` (escaped) |
| Results | `card-grid` cards via `shared.cardHTML`: thumb/initial placeholder, name, brand ("No brand" fallback), per-store latest-price list (store, price, unit price, date), actions **Add to list / ✓ In list** and **Details** |
| Card affordances | whole card click → `#/item/:id` (mouse only); `Details` button is the keyboard path |
| Errors | none possible locally; Fuse absent → substring results silently |

### 6.4 Item detail (`#/item/:id`) — `ui/item.js`

| State | Behavior |
| --- | --- |
| Not found (deleted / bad link) | empty state "This product is no longer in your catalog." + **Back to search** |
| Default | Back-crumb, 96 px thumb (72 px ≤720 px), title, record count, actions: **Add/✓ list** (re-renders in place), **Add record** (→ capture prefill), **Remove photo** (only when image/pending exists), **Delete product** (confirm → commit + prune from list + toast → search) |
| Price history | table of all records (store, price, size+unit, unit price, date, per-row **Delete** with confirm → re-render); empty ⇒ single "No records yet." row |
| Similar items | count in heading; cluster ≠ 0 ⇒ comparison **table** (one column per catalog store + Best + Unit price + Add button) **and** an identical card grid; cluster = 0 ⇒ explanatory muted line |
| Responsive duality | `.sim-wrap` table hidden ≤720 px while `.similar-cards` grid shows only ≤720 px (CSS-controlled, same data rendered twice) |
| Errors | none local; deletes are confirmed and reversible only via sync history |

### 6.5 List (`#/list`) — `ui/list.js`

| State | Behavior |
| --- | --- |
| Empty | `.empty-state`: "Your list is empty…" + **Search products** CTA |
| Default | two-column layout ≥900 px (table + 300 px summary aside); rows show thumb, best store badge + price, all-offer chips (`.alt-best` marks the winner), unit price, cost, **Remove** |
| No-data rows | `.row-nodata`: "No price records yet — record a price" (link pre-fills capture); excluded from totals, counted in summary footnote |
| Summary | per-store totals with item counts → grand total → "N stores to visit" → savings note: either "Best single store (X) would be £Y — **You save £Z**" or "No single store has everything — X lacks N items." |
| Actions | **Print list** (opens popup with a standalone HTML doc; blocked popup → error toast "Allow pop-ups to print the list"), **Clear list** (confirm → re-render) |
| Disabled/errors | no disabled states; print is the only failure-capable action |

### 6.6 Settings (`#/settings`) — `ui/settings.js`

| State | Behavior |
| --- | --- |
| Permission / not configured | explanatory paragraph on token scope; **Save connection** persists trimmed fields (branch falls back `main`), toasts, and auto-syncs if dirty |
| Testing (loading) | `#conn-result` shows "Testing…" during `testConnection()`; success message includes repo name, default branch, catalog presence, branch-mismatch warning; failure → message + `.hint-error` + error toast |
| Sync pill echo | `#conn-result` is pre-seeded with the current `sync.error` on render |
| Data stats | 5-tile stat grid: products, records, stores, photos, **photos waiting to sync** |
| Export | **Export JSON (with photos)** disables its own button while `embedImages()` inlines every repo-hosted image (per-image fetch failure keeps the path and continues); **Export CSV** immediate |
| Import | labels styled as buttons over hidden file inputs; JSON validates `items` array, `mergeCatalogs` merges, reports `N new products / N records`, **embedded base64 photos are stripped from the catalog and re-queued** via `addPendingImage` (avoids megabytes in `catalog.json`); CSV via PapaParse with row validation; both reset the input value so re-picking the same file works; all failures → error toast |
| Danger zone | confirm → `clearAllLocal()` → full page reload; copy explicitly states GitHub copy is untouched |

---

## 7. Cross-View State Handling Matrix

| State | Where handled | Notes |
| --- | --- | --- |
| Default | every `render()` | autofocus conventions: capture→name, search→input, settings→none |
| Loading | sync pill (`Syncing…`), Settings "Testing…", JSON export button `disabled` | **no skeleton/progress UI anywhere else** — an explicit gap |
| Empty | Search (2 variants), List, Item (missing item, no records, no similar), price lists, no-data list rows | all empty states carry a CTA or an explanatory line — consistent `.empty-state` styling |
| Error | sync pill + tooltip, Settings connection hint (`.hint-error`), toast everywhere, CSV/JSON import, print popup, image attach/encode | auto-sync errors do **not** toast (pill only) — intentional de-noising |
| Disabled | JSON export while running; `.btn:disabled` style (55 % opacity) | no form-level disabled/loading state |
| Permission | not-configured sync (`Local only` / "Set token, owner and repository first"), 401/403 GitHub mapping, offline (`Offline — unsynced`) | token permission requirements are documented in Settings copy |
| Success | toasts on save/sync/import/export/delete + pill `Synced` | |

---

## 8. Accessibility Reference (WCAG 2.2)

### 8.1 What's already good

- Real `<label for>` on every form control; `aria-label` on the search input
  and `<nav aria-label="Main">`; native `<main>`, `<header>`, `<nav>`.
- Toast uses `role="status"` (polite live region).
- Destructive actions confirmed via native `window.confirm` (keyboard
  accessible, focus handled by the browser).
- Focus indicators never suppressed: no `outline:none` anywhere; inputs get a
  2 px green focus outline + offset.
- Empty/error text is never color-only (always accompanied by copy);
  `aria-hidden` on decorative initial-letter placeholders; `alt=""` on
  decorative thumbnails.
- `lang="en"`, meta viewport, `<noscript>` fallback, semantic headings h1→h2→h3
  in every view.
- Skip-navigation is partially covered: tabs are only 4 links before `<main>`.

### 8.2 Findings (severity · WCAG criterion · recommendation)

| # | Severity | Finding | Recommendation |
| --- | --- | --- | --- |
| A1 | **High** | `<main id="view" aria-live="polite">` announces *every full-view re-render* (search keystrokes debounced at 120 ms, list toggles, record deletes) as one giant polite announcement — chatty and unpredictable (4.1.3 or 1.3.1 misuse) | Remove `aria-live` from `#view`; announce targeted updates (result counts, save confirmations) via a dedicated small live region. Toast's `role=status` already covers confirmations |
| A2 | **High** | Route changes do not move focus to the new view heading — after any navigation, focus lands on `<body>` and screen-reader/keyboard users must tab from the top (2.4.3 Focus Order, 3.2.3 Consistent Navigation) | On `route()`, focus the view's `h2` (add `tabindex="-1"`) |
| A3 | Medium | Active tab marked only with `.active` class — no `aria-current="page"` (implicit in nav patterns; 4.1.2 Name/Role/Value for state) | Set `aria-current` in `setActiveTab()` |
| A4 | Medium | Match hint (`#match-hint`) updates on typing but is not referenced by the name input nor a live region — invisible to SR users (3.3.2 Labels/Instructions) | Add `aria-describedby="match-hint"` on `#f-name` (and keep it non-live to avoid chatter) |
| A5 | Medium | No skip link; 4 tabs + header precede content (2.4.1 Bypass Blocks) | Add a visually-hidden-until-focus "Skip to content" link |
| A6 | Medium | Cards are click-navigable `<article>`s with `cursor:pointer` but not focusable — mouse-only shortcut (acceptable only because `Details` button exists; document the intent) | Either make the card heading a link or drop the click handler |
| A7 | Low | Data tables lack `<th scope="col">` (1.3.1) | Add `scope="col"` to generated `<thead>` cells |
| A8 | Low | `title` attribute is the sole extra description on the sync pill (unreliable for SR/touch users) | Add `aria-describedby` or visually rendered error text in Settings (already partly present) |
| A9 | Low | `.btn-small` targets ≈ 29 px tall — passes 2.5.8 (24 px) but marginally; `.badge`/`.alt` are non-interactive so unaffected | Keep ≥ 24 px; prefer 44 px for primary phone actions |
| A10 | Low | `p-date`/`.small` muted text at ~12 px on `#f2f4f5` chips sits near the 4.5:1 contrast edge (1.4.3); `:disabled` at 0.55 opacity is exempt but looks broken | Verify with a contrast checker; darken `--muted` for small sizes |
| A11 | Info | Product photos have `alt=""` even though the image may be the primary product cue on the Item view (1.1.1) | Use `alt="<name> product photo"` on the Item view thumbnail, keep decorative on cards |
| A12 | Info | Print output is generated via `document.write` into a popup — SR and popup-blocker edge cases | Consider an `@media print` stylesheet + hidden print container (see Q5) |

*Reviewed statically (code + CSS only); no assistive-technology testing was
performed — flagged for human verification (§11 Q9).*

---

## 9. Responsive Design Rules

Mobile-first CSS (comment in `styles.css`); breakpoints and behaviors:

| Breakpoint | Applies to | Effect |
| --- | --- | --- |
| base (mobile) | everything | single-column forms; sticky header + scrollable tab strip; `.view` max-width 1060 px centered; cards `repeat(auto-fill, minmax(260px,1fr))` |
| `≥640px` | Capture form | grid becomes 2 columns; `.field-wide`/`.form-actions` span both |
| `≥720px` | Settings `.field-row` | token/owner/repo row → `1fr 1fr 140px` |
| `≥900px` | List view | `.list-layout` → `minmax(0,1fr) 300px` (table + summary aside); below that, summary stacks under the table |
| `≤720px` | Item view | comparison **table hidden** (`.sim-wrap{display:none}`) → **card grid shown** (`.similar-cards`); thumb 96→72 px; price-list date wraps to its own full-width row |
| auto-fit | Settings stats | `minmax(110px,1fr)` tiles flow 1–5 across |

Additional rules:

- All wide tables live in `.table-wrap { overflow-x:auto }` — horizontal
  scroll instead of page overflow; `.cell-item` has `min-width:210px` so item
  columns don't crush.
- Sticky offsets: header `top:0` (z 20), tabs `top:57px` (z 19) — **hard-coded
  assumption of header height**; if the header wraps on very narrow screens the
  tabs will overlap (see Q10).
- Prices use `font-variant-numeric: tabular-nums` for column alignment;
  `.num{white-space:nowrap}` prevents currency wrapping.
- Touch affordances: `inputmode="decimal"` on price/size,
  `capture="environment"` on the photo input, system font stack (no webfont
  flash), `toast` max-width `min(92vw, 480px)`.

---

## 10. Import / Export Formats

- **CSV export** (`io.js:catalogToCSV`): header
  `name,brand,store,price,size,unit,date`; one row per record; `csvEscape`
  quotes commas/quotes/newlines. (Item identity and images are *not* in CSV —
  round-trip loses clustering keys and photos; documented behavior.)
- **CSV import** (`parseCSVEntries`, PapaParse `header:true`):
  - accepts `name` or `item` column; strips `£`/spaces from price; size
    stripped to digits/dot, invalid → `1`; unit lowercased, default `each`.
  - date: `YYYY-MM-DD` → as-is; `d/m/yyyy` (also `.`/`-`) validated → ISO;
    otherwise `new Date()` parse; unparseable → **today**.
  - rows without name/store/finite non-negative price are skipped; zero valid
    rows ⇒ throw with expected-columns message.
- **JSON export**: full catalog with `image` paths resolved to data URLs via
  `embedImages()` (pending local photos substituted first); filename
  `grocery-catalog-YYYY-MM-DD.json`.
- **JSON import**: requires `items` array; merged with `mergeCatalogs`;
  stats delta computed *before* mutation for the toast; data-URL images are
  extracted, removed from the catalog, and re-queued for upload.

---

## 11. Open Questions & Assumptions

Assumptions made where the brief/code was ambiguous — each needs sign-off
where marked.

1. **Scope of "primary task"** — confirmed with requester: this deliverable is
   *documentation only*; no source files edited. ✅ resolved.
2. **Q1 — Product review:** auto-sync failures are silent (pill only, tooltip
   carries the message). Is silent failure acceptable, or should errors toast
   after N retries? *(human product review)*
3. **Q2 — Product review:** deleting products/records/whole list uses native
   `confirm()` with no undo; sync history is the only recovery. Is "undo
   toast" needed? *(human product review)*
4. **Q3 — Product review:** similarity grouping ignores brand (overlap
   coefficient 0.85) — store-brand vs premium items with identical wording can
   cluster. Intended? *(human design review)*
5. **Q4 — Design:** `#/item` renders *both* a comparison table and an
   equivalent card grid (one hidden by CSS). Duplicate DOM doubles render cost
   and screen-reader exposure — one responsive representation preferred?
6. **Q5 — Engineering:** print uses `window.open` + `document.write` (popup
   blocker risk, deprecated API). Migrate to `@media print` + hidden
   container? *(needs design review of print layout)*
7. **Q6 — Engineering:** PapaParse is loaded as floating `@5`; Fuse pinned
   `6.6.2`. Pin both for reproducible deploys?
8. **Q7 — Product:** GBP (`£`) and `en-GB` dates are hard-coded; size units
   metric-only. Is UK-only a stable assumption?
9. **Q8 — Product:** Capture has no double-submit guard; two fast taps on
   "Save entry" record two identical-priced rows (merge dedupe only kicks in
   at sync with identical store/date/price/size). Disable-while-saving needed?
10. **Q9 — A11y sign-off:** §8 is a static audit; human AT testing
    (NVDA/VoiceOver + keyboard-only pass) required before claiming WCAG 2.2 AA.
11. **Q10 — Engineering:** sticky tab bar offset `top:57px` is hard-coded;
    verify header height on 320 px-wide screens (tagline may wrap).
12. **Assumption:** single primary user/device is the norm; multi-device is
    supported only through union-merge (no auth, no locking). Concurrent
    editing from two devices within the same sync window is best-effort.
13. **Assumption:** "fully static / no build" is a hard constraint — any
    recommendation above (skip link, `aria-current`, etc.) must be hand-written
    into templates, not generated by a framework.

---

## 12. Known Risks & Refactoring Debt (prioritized)

| ID | Risk / debt | Impact | Likelihood | Suggested direction |
| --- | --- | --- | --- | --- |
| R1 | `aria-live="polite"` on full view + no focus management on route change | SR/keyboard users disoriented (A1/A2) | certain | targeted live regions + focus the view heading |
| R2 | `writeJSON`/`saveCache` failures silently ignored (quota with base64 `pendingImages`) | silent data loss despite "offline-first" promise | med | check return value; warn + evict images to a queue file / use IndexedDB |
| R3 | `groupItems` O(n²) recomputed per Item render; Fuse rebuilt per keystroke | UI lag as catalog grows | med (scale) | memoize cluster/search indexes; invalidate on commit |
| R4 | Dirty-flag race around in-flight `sync` | missed auto-sync until next trigger | low | dirty epoch counter; re-check after sync resolves |
| R5 | PAT in localStorage; XSS would leak it (templating relies on manual `esc`) | token theft scoped to one repo's Contents r/w | low | CSP meta tag; keep scope narrow (already recommended in README) |
| R6 | Print via popup + `document.write` | print feature breaks under strict popup settings | med | `@media print` route (Q5) |
| R7 | Auto-sync errors only visible in pill tooltip | users unaware data isn't landing | med | Q2 decision → toast after repeated failure |
| R8 | Floating PapaParse version / CDN dependency on first load | non-reproducible deploys; offline CSV import fails with clear error (handled) | low | pin + vendor locally (Q6) |
| R9 | No test suite, no CI, no lint config | regressions in pure domain logic undetected | certain | `domain/*` is pure and testable first — start there |
| R10 | `.DS_Store` committed | repo noise | certain | `.gitignore` |

---

*End of document. Append new entries to §0 and update grouped sections as
further milestones complete.*
