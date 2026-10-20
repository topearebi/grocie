// Item detail: full record history plus every similar product for side-by-side
// comparison across stores and pack sizes.

import { esc, money, fmtDate, toast } from '../util.js';
import {
  itemById,
  clusterForItem,
  unitPriceLabel,
  removeRecord,
  removeItem,
} from '../domain/catalog.js';
import { thumbHTML, offersFor, cardHTML, bindCards } from './shared.js';

export function render(container, ctx, id) {
  const item = itemById(ctx.catalog, id);
  if (!item) {
    container.innerHTML = `
      <div class="empty-state">
        <p>This product is no longer in your catalog.</p>
        <button type="button" class="btn btn-primary" id="back">Back to search</button>
      </div>`;
    container.querySelector('#back').addEventListener('click', () => ctx.navigate('#/search'));
    return;
  }

  const inList = ctx.inList(item.id);
  const cluster = clusterForItem(ctx.catalog, item.id).filter((other) => other.id !== item.id);
  const stores = ctx.catalog.stores;

  const recordsHTML = item.records
    .map((rec, index) => {
      const price = Number(rec.price);
      return `<tr>
        <td>${esc(rec.store)}</td>
        <td class="num">${money(price)}</td>
        <td>${esc(rec.size)} ${esc(rec.unit)}</td>
        <td class="num">${unitPriceLabel(rec.price, rec.size, rec.unit)}</td>
        <td>${fmtDate(rec.date)}</td>
        <td class="cell-actions"><button type="button" class="btn btn-small btn-ghost" data-del-rec="${index}">Delete</button></td>
      </tr>`;
    })
    .join('');

  const similarHTML = cluster
    .map((other) => {
      const offers = offersFor(other);
      const storeCells = stores
        .map((store) => {
          const offer = offers.find((o) => o.store === store);
          return `<td class="num">${offer ? money(offer.price) : '<span class="muted">—</span>'}</td>`;
        })
        .join('');
      const best = offers[0];
      const up = best
        ? unitPriceLabel(best.record.price, best.record.size, best.record.unit)
        : '—';
      const otherInList = ctx.inList(other.id);
      return `<tr>
        <td class="sim-name">
          <a href="#/item/${esc(other.id)}">${esc(other.name)}</a>
          <span class="muted small">${esc(other.brand || 'No brand')}</span>
        </td>
        ${storeCells}
        <td class="num">${best ? `<strong>${money(best.price)}</strong> <span class="muted small">${esc(best.store)}</span>` : '<span class="muted">—</span>'}</td>
        <td class="num">${up}</td>
        <td><button type="button" class="btn btn-small ${otherInList ? 'btn-ok' : 'btn-primary'}" data-toggle="${esc(other.id)}">${otherInList ? '✓ In list' : 'Add'}</button></td>
      </tr>`;
    })
    .join('');

  container.innerHTML = `
    <p class="crumbs"><a href="#/search">← Back to search</a></p>

    <div class="item-head">
      ${thumbHTML(ctx, item)}
      <div class="item-title">
        <h2>${esc(item.name)}</h2>
        <p class="muted">${esc(item.brand || 'No brand')} · ${item.records.length} record${item.records.length === 1 ? '' : 's'}</p>
        <div class="item-actions">
          <button type="button" id="toggle-list" class="btn ${inList ? 'btn-ok' : 'btn-primary'}">${inList ? '✓ In list' : 'Add to list'}</button>
          <a class="btn btn-ghost" href="#/capture?item=${esc(item.id)}">Add record</a>
          ${
            item.image || ctx.pendingImages.some((p) => p.itemId === item.id)
              ? '<button type="button" id="del-image" class="btn btn-ghost btn-danger">Remove photo</button>'
              : ''
          }
          <button type="button" id="del-item" class="btn btn-ghost btn-danger">Delete product</button>
        </div>
      </div>
    </div>

    <h3>Price history</h3>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Store</th><th>Price</th><th>Size</th><th>Unit price</th><th>Date</th><th></th></tr></thead>
        <tbody>${recordsHTML || '<tr><td colspan="6" class="muted">No records yet.</td></tr>'}</tbody>
      </table>
    </div>

    <h3>Similar items <span class="muted small">(${cluster.length})</span></h3>
    ${
      cluster.length === 0
        ? '<p class="muted">Nothing similar recorded yet — similar pack sizes and wordings appear here automatically.</p>'
        : `<div class="table-wrap sim-wrap">
             <table class="data-table sim-table">
               <thead>
                 <tr>
                   <th>Product</th>
                   ${stores.map((store) => `<th>${esc(store)}</th>`).join('')}
                   <th>Best</th><th>Unit price</th><th></th>
                 </tr>
               </thead>
               <tbody>${similarHTML}</tbody>
             </table>
           </div>
           <div class="card-grid similar-cards">${cluster
             .map((other) => cardHTML(ctx, other))
             .join('')}</div>`
    }
  `;

  // Hidden by default: the table is the comparison view, cards are a fallback
  // on very narrow screens (CSS decides which one shows).
  container.querySelector('#toggle-list').addEventListener('click', () => {
    ctx.toggleList(item.id);
    render(container, ctx, id);
  });

  const delImageBtn = container.querySelector('#del-image');
  if (delImageBtn) {
    delImageBtn.addEventListener('click', () => {
      if (!window.confirm('Remove the photo for this product?')) return;
      ctx.removeImage(item.id);
    });
  }

  container.querySelector('#del-item').addEventListener('click', () => {
    if (!window.confirm(`Delete “${item.name}” and all its price records?`)) return;
    ctx.commit((cat) => removeItem(cat, item.id));
    ctx.pruneList(item.id);
    toast('Product deleted', 'info');
    ctx.navigate('#/search');
  });

  container.querySelectorAll('[data-del-rec]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const index = Number(btn.dataset.delRec);
      const rec = item.records[index];
      if (!rec) return;
      if (!window.confirm(`Delete the ${money(rec.price)} record at ${rec.store} (${fmtDate(rec.date)})?`)) {
        return;
      }
      ctx.commit((cat) => removeRecord(cat, item.id, index));
      render(container, ctx, id);
    });
  });

  container.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      ctx.toggleList(btn.dataset.toggle);
      render(container, ctx, id);
    });
  });

  // Cards below the table (visible on narrow screens) get the standard binding.
  const cards = container.querySelector('.similar-cards');
  if (cards) bindCards(cards, ctx, () => render(container, ctx, id));
}
