// Search & browse: fuzzy search over the catalog with rich result cards.

import { debounce, esc } from '../util.js';
import { searchItems } from '../domain/search.js';
import { stats } from '../domain/catalog.js';
import { cardHTML, bindCards } from './shared.js';

export function render(container, ctx) {
  const summary = stats(ctx.catalog);
  container.innerHTML = `
    <div class="view-head">
      <h2>Search products</h2>
      <p class="muted">${summary.items} product${summary.items === 1 ? '' : 's'} ·
        ${summary.records} price record${summary.records === 1 ? '' : 's'} ·
        ${summary.stores} store${summary.stores === 1 ? '' : 's'}</p>
    </div>
    <div class="search-bar">
      <input id="q" type="search" placeholder="Search by name, brand or store…"
             autocomplete="off" aria-label="Search products">
    </div>
    <div id="results" class="card-grid"></div>`;

  const input = container.querySelector('#q');
  const results = container.querySelector('#results');

  const draw = () => {
    const term = input.value;
    const matches = searchItems(ctx.catalog.items, term);

    if (ctx.catalog.items.length === 0) {
      results.innerHTML = `
        <div class="empty-state">
          <p>No products yet.</p>
          <button type="button" class="btn btn-primary" id="go-capture">Capture your first price</button>
        </div>`;
      const btn = results.querySelector('#go-capture');
      if (btn) btn.addEventListener('click', () => ctx.navigate('#/capture'));
      return;
    }

    if (matches.length === 0) {
      results.innerHTML = `<div class="empty-state"><p>No matches for “${esc(term)}”.</p></div>`;
      return;
    }

    results.innerHTML = matches.map((item) => cardHTML(ctx, item)).join('');
    bindCards(results, ctx, draw);
  };

  input.addEventListener('input', debounce(draw, 120));
  draw();
  input.focus();
}
