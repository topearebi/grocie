// Settings: GitHub sync configuration, sync controls, import/export, danger zone.

import { toast, todayISO, downloadBlob } from '../util.js';
import { stats, mergeCatalogs, addRecord } from '../domain/catalog.js';
import { catalogToCSV, parseCSVEntries, embedImages } from '../io.js';

export function render(container, ctx) {
  const summary = stats(ctx.catalog);
  const s = ctx.settings;
  const sync = ctx.sync;

  container.innerHTML = `
    <div class="view-head"><h2>Settings</h2></div>

    <section class="panel">
      <h3>GitHub sync</h3>
      <p class="muted small">The catalog lives in this repository and is served by GitHub Pages.
      Writes use a fine-grained personal access token with <strong>Contents: Read and write</strong>
      scoped to this repository only. The token stays in this browser.</p>

      <div class="field field-wide">
        <label for="set-token">Personal access token</label>
        <input id="set-token" type="password" autocomplete="off" spellcheck="false"
               placeholder="github_pat_…" value="${escAttr(s.token || '')}">
      </div>

      <div class="field-row">
        <div class="field">
          <label for="set-owner">Owner</label>
          <input id="set-owner" type="text" autocomplete="off" spellcheck="false"
                 placeholder="${escAttr(s.owner || 'github-username')}" value="${escAttr(s.owner || '')}">
        </div>
        <div class="field">
          <label for="set-repo">Repository</label>
          <input id="set-repo" type="text" autocomplete="off" spellcheck="false"
                 placeholder="grocery-price-comparison" value="${escAttr(s.repo || '')}">
        </div>
        <div class="field field-branch">
          <label for="set-branch">Branch</label>
          <input id="set-branch" type="text" autocomplete="off" spellcheck="false"
                 placeholder="main" value="${escAttr(s.branch || 'main')}">
        </div>
      </div>

      <div class="actions">
        <button type="button" class="btn btn-primary" id="btn-save-gh">Save connection</button>
        <button type="button" class="btn" id="btn-test">Test connection</button>
        <button type="button" class="btn" id="btn-sync">Sync now</button>
      </div>
      <p id="conn-result" class="hint">${escAttr(sync.error || '')}</p>
    </section>

    <section class="panel">
      <h3>Your data</h3>
      <div class="stat-grid">
        <div class="stat"><strong>${summary.items}</strong><span>products</span></div>
        <div class="stat"><strong>${summary.records}</strong><span>price records</span></div>
        <div class="stat"><strong>${summary.stores}</strong><span>stores</span></div>
        <div class="stat"><strong>${summary.images}</strong><span>photos</span></div>
        <div class="stat"><strong>${ctx.pendingImages.length}</strong><span>photos waiting to sync</span></div>
      </div>

      <div class="actions">
        <button type="button" class="btn" id="btn-export-json">Export JSON (with photos)</button>
        <button type="button" class="btn" id="btn-export-csv">Export CSV</button>
        <label class="btn" for="import-json">Import JSON</label>
        <input type="file" id="import-json" accept="application/json,.json" hidden>
        <label class="btn" for="import-csv">Import CSV</label>
        <input type="file" id="import-csv" accept=".csv,text/csv" hidden>
      </div>
      <p class="muted small">Imports are merged with your existing data — nothing is overwritten.
      CSV columns: <code>name, brand, store, price, size, unit, date</code>.</p>
      <p id="io-result" class="hint"></p>
    </section>

    <section class="panel panel-danger">
      <h3>Danger zone</h3>
      <p class="muted small">Clears the local cache, settings and shopping list from this browser.
      The copy in GitHub is not affected.</p>
      <div class="actions">
        <button type="button" class="btn btn-danger" id="btn-clear">Clear local data</button>
      </div>
    </section>`;

  const connResult = container.querySelector('#conn-result');

  container.querySelector('#btn-save-gh').addEventListener('click', () => {
    ctx.saveSettings({
      token: container.querySelector('#set-token').value.trim(),
      owner: container.querySelector('#set-owner').value.trim(),
      repo: container.querySelector('#set-repo').value.trim(),
      branch: container.querySelector('#set-branch').value.trim() || 'main',
    });
    toast('Connection saved', 'success');
    if (ctx.sync.dirty) ctx.syncNow(true);
  });

  container.querySelector('#btn-test').addEventListener('click', async () => {
    connResult.textContent = 'Testing…';
    connResult.classList.remove('hint-error');
    try {
      // Pick up unsaved edits so the test reflects what the user typed.
      ctx.saveSettings({
        token: container.querySelector('#set-token').value.trim(),
        owner: container.querySelector('#set-owner').value.trim(),
        repo: container.querySelector('#set-repo').value.trim(),
        branch: container.querySelector('#set-branch').value.trim() || 'main',
      });
      const result = await ctx.testConnection();
      connResult.textContent = result.message;
      toast('Connection OK', 'success');
    } catch (err) {
      connResult.textContent = err.message;
      connResult.classList.add('hint-error');
      toast(err.message, 'error');
    }
  });

  container.querySelector('#btn-sync').addEventListener('click', () => {
    ctx.saveSettings({
      token: container.querySelector('#set-token').value.trim(),
      owner: container.querySelector('#set-owner').value.trim(),
      repo: container.querySelector('#set-repo').value.trim(),
      branch: container.querySelector('#set-branch').value.trim() || 'main',
    });
    ctx.syncNow(true);
  });

  container.querySelector('#btn-export-json').addEventListener('click', async () => {
    try {
      const btn = container.querySelector('#btn-export-json');
      btn.disabled = true;
      // Include photos that are still queued locally, then inline repo-hosted ones.
      const catalogWithPending = {
        ...ctx.catalog,
        items: ctx.catalog.items.map((item) => {
          const pending = ctx.pendingImages.find((p) => p.itemId === item.id);
          return pending ? { ...item, image: pending.dataUrl } : item;
        }),
      };
      const withImages = await embedImages(catalogWithPending);
      downloadBlob(
        `grocery-catalog-${todayISO()}.json`,
        new Blob([JSON.stringify(withImages, null, 2)], { type: 'application/json' })
      );
      toast('JSON exported', 'success');
    } catch (err) {
      toast(`Export failed: ${err.message}`, 'error');
    } finally {
      container.querySelector('#btn-export-json').disabled = false;
    }
  });

  container.querySelector('#btn-export-csv').addEventListener('click', () => {
    downloadBlob(
      `grocery-catalog-${todayISO()}.csv`,
      new Blob([catalogToCSV(ctx.catalog)], { type: 'text/csv' })
    );
    toast('CSV exported', 'success');
  });

  container.querySelector('#import-json').addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.items)) {
        throw new Error('Not a Grocery Genie export (missing "items").');
      }
      const beforeIds = new Set(ctx.catalog.items.map((item) => item.id));
      const beforeRecords = ctx.catalog.items.reduce((n, item) => n + item.records.length, 0);
      let added = { items: 0, records: 0 };
      const embeddedImages = [];
      ctx.commit((cat) => {
        const merged = mergeCatalogs(cat, data);
        added = {
          items: merged.items.filter((item) => !beforeIds.has(item.id)).length,
          records:
            merged.items.reduce((n, item) => n + item.records.length, 0) - beforeRecords,
        };
        cat.items = merged.items;
        cat.stores = merged.stores;
        // Exports embed photos as data URLs; re-queue them for upload instead of
        // keeping megabytes of base64 inside catalog.json.
        for (const item of cat.items) {
          if (typeof item.image === 'string' && item.image.startsWith('data:')) {
            embeddedImages.push([item.id, item.image]);
            item.image = null;
          }
        }
      });
      for (const [itemId, dataUrl] of embeddedImages) ctx.addPendingImage(itemId, dataUrl);
      ctx.refresh();
      toast(
        `Imported ${added.items} new product(s), ${added.records} record(s)` +
          (embeddedImages.length ? ` — ${embeddedImages.length} photo(s) queued` : ''),
        'success'
      );
    } catch (err) {
      toast(`Import failed: ${err.message}`, 'error');
    }
  });

  container.querySelector('#import-csv').addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      const entries = parseCSVEntries(await file.text());
      let created = 0;
      ctx.commit((cat) => {
        for (const entry of entries) {
          const result = addRecord(cat, entry);
          if (result.created) created += 1;
        }
      });
      ctx.refresh();
      toast(`Imported ${entries.length} record(s) — ${created} new product(s)`, 'success');
    } catch (err) {
      toast(`Import failed: ${err.message}`, 'error');
    }
  });

  container.querySelector('#btn-clear').addEventListener('click', () => {
    if (!window.confirm('Clear all local data from this browser? The GitHub copy is unaffected.')) {
      return;
    }
    ctx.clearLocalData();
  });
}

function escAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
