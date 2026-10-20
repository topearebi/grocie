// Shopping list: cheapest recorded store per item, per-store subtotals, and the
// savings vs. buying the whole basket from one single store.

import { esc, money, toast } from '../util.js';
import { optimizeList } from '../domain/optimize.js';
import { thumbHTML } from './shared.js';

function rowsHTML(ctx, plan) {
  return plan.rows
    .map((row) => {
      const { item } = row;
      if (row.noData) {
        return `<tr class="row-nodata">
          <td class="cell-item">${thumbHTML(ctx, item)}
            <span><strong>${esc(item.name)}</strong><span class="muted small">${esc(item.brand || '')}</span></span>
          </td>
          <td colspan="4" class="muted">No price records yet —
            <a href="#/capture?item=${esc(item.id)}">record a price</a></td>
          <td class="cell-actions"><button type="button" class="btn btn-small btn-ghost" data-remove="${esc(item.id)}">Remove</button></td>
        </tr>`;
      }

      const alternatives = row.offers
        .map(
          (offer) =>
            `<span class="alt${offer.store === row.best.store ? ' alt-best' : ''}">${esc(offer.store)} ${money(offer.price)}</span>`
        )
        .join('');

      return `<tr>
        <td class="cell-item">${thumbHTML(ctx, item)}
          <span><strong>${esc(item.name)}</strong><span class="muted small">${esc(item.brand || '')}</span></span>
        </td>
        <td><span class="store-badge">${esc(row.best.store)}</span> <strong>${money(row.best.price)}</strong></td>
        <td class="cell-alts">${alternatives}</td>
        <td class="num">${row.up ? esc(row.up.label) : '—'}</td>
        <td class="num">${money(row.best.price)}</td>
        <td class="cell-actions"><button type="button" class="btn btn-small btn-ghost" data-remove="${esc(item.id)}">Remove</button></td>
      </tr>`;
    })
    .join('');
}

function summaryHTML(plan) {
  const totals = Object.entries(plan.storeTotals)
    .map(
      ([store, total]) => `<div class="total-row">
        <span>${esc(store)} <span class="muted small">(${plan.storeCounts[store]} item${plan.storeCounts[store] === 1 ? '' : 's'})</span></span>
        <span>${money(total)}</span>
      </div>`
    )
    .join('');

  let comparison = '';
  if (plan.baseline && plan.baseline.missing === 0 && plan.savings !== null) {
    comparison = `<div class="total-row total-note">
      <span>Best single store (${esc(plan.baseline.store)}) would be ${money(plan.baseline.total)}</span>
      <span class="saving">You save ${money(plan.savings)}</span>
    </div>`;
  } else if (plan.baseline && plan.baseline.missing > 0) {
    comparison = `<div class="total-row total-note">
      <span>No single store has everything — ${esc(plan.baseline.store)} lacks ${plan.baseline.missing} item${plan.baseline.missing === 1 ? '' : 's'}.</span>
      <span></span>
    </div>`;
  }

  return `${totals}
    <div class="total-row total-grand"><span>Grand total</span><span>${money(plan.grandTotal)}</span></div>
    <div class="total-row total-note"><span>${plan.stops} store${plan.stops === 1 ? '' : 's'} to visit</span><span></span></div>
    ${comparison}`;
}

export function render(container, ctx) {
  const plan = optimizeList(ctx.catalog, ctx.list);

  if (plan.rows.length === 0) {
    container.innerHTML = `
      <div class="view-head"><h2>My grocery list</h2></div>
      <div class="empty-state">
        <p>Your list is empty. Search for products and tap “Add to list”.</p>
        <button type="button" class="btn btn-primary" id="go-search">Search products</button>
      </div>`;
    container.querySelector('#go-search').addEventListener('click', () => ctx.navigate('#/search'));
    return;
  }

  container.innerHTML = `
    <div class="view-head">
      <h2>My grocery list</h2>
      <p class="muted">Cheapest recorded price per item, optimised across stores.</p>
    </div>

    <div class="list-layout">
      <div class="table-wrap list-table-wrap">
        <table class="data-table list-table">
          <thead>
            <tr><th>Item</th><th>Best store</th><th>All prices</th><th>Unit price</th><th>Cost</th><th></th></tr>
          </thead>
          <tbody>${rowsHTML(ctx, plan)}</tbody>
        </table>
      </div>

      <aside class="summary" id="summary">
        <h3>Cost by store</h3>
        ${summaryHTML(plan)}
        ${plan.noDataCount > 0 ? `<p class="muted small">${plan.noDataCount} item${plan.noDataCount === 1 ? '' : 's'} not counted — no records yet.</p>` : ''}
        <div class="summary-actions">
          <button type="button" class="btn btn-primary" id="print-list">Print list</button>
          <button type="button" class="btn btn-ghost btn-danger" id="clear-list">Clear list</button>
        </div>
      </aside>
    </div>`;

  container.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      ctx.removeFromList(btn.dataset.remove);
      render(container, ctx);
    });
  });

  container.querySelector('#clear-list').addEventListener('click', () => {
    if (!window.confirm('Clear the whole shopping list?')) return;
    ctx.clearList();
    render(container, ctx);
  });

  container.querySelector('#print-list').addEventListener('click', () => printList(plan));
}

function printList(plan) {
  const win = window.open('', '', 'height=640,width=860');
  if (!win) {
    toast('Allow pop-ups to print the list', 'error');
    return;
  }
  const rows = plan.rows
    .map((row) => {
      if (row.noData) {
        return `<tr><td>${esc(row.item.name)}</td><td colspan="3">No price recorded</td></tr>`;
      }
      return `<tr>
        <td>${esc(row.item.name)}${row.item.brand ? ` <small>${esc(row.item.brand)}</small>` : ''}</td>
        <td>${esc(row.best.store)}</td>
        <td>${money(row.best.price)}</td>
        <td>${row.up ? esc(row.up.label) : ''}</td>
      </tr>`;
    })
    .join('');

  const totals = Object.entries(plan.storeTotals)
    .map(([store, total]) => `<p>${esc(store)}: ${money(total)}</p>`)
    .join('');

  win.document.write(`<!DOCTYPE html><html><head><title>Grocery list</title>
    <style>
      body{font-family:sans-serif;padding:24px}
      table{border-collapse:collapse;width:100%}
      th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
      th{background:#f2f2f2}
      .grand{font-weight:bold;font-size:1.1em}
      small{color:#666}
    </style></head><body>
    <h1>Shopping list</h1>
    <table><thead><tr><th>Item</th><th>Store</th><th>Price</th><th>Unit price</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div>${totals}<p class="grand">Total: ${money(plan.grandTotal)} across ${plan.stops} store${plan.stops === 1 ? '' : 's'}</p></div>
    </body></html>`);
  win.document.close();
  win.focus();
  win.print();
}
