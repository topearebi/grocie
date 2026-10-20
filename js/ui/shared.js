// Building blocks shared by the views: thumbnails, price lists, product cards.

import { esc, money, fmtDate } from '../util.js';
import { latestPerStore, unitPriceLabel } from '../domain/catalog.js';

export function itemImageSrc(ctx, item) {
  const pending = (ctx.pendingImages || []).find((p) => p.itemId === item.id);
  if (pending) return pending.dataUrl;
  if (item.image) return item.image;
  return null;
}

export function thumbHTML(ctx, item) {
  const src = itemImageSrc(ctx, item);
  if (src) return `<img class="thumb" src="${esc(src)}" alt="" loading="lazy" decoding="async">`;
  const initial = esc((item.name || '?').trim().charAt(0).toUpperCase() || '?');
  return `<div class="thumb thumb-ph" aria-hidden="true">${initial}</div>`;
}

// Latest price per store, cheapest first.
export function offersFor(item) {
  return [...latestPerStore(item)]
    .map(([store, rec]) => ({ store, record: rec, price: Number(rec.price) }))
    .filter((offer) => Number.isFinite(offer.price))
    .sort((a, b) => a.price - b.price);
}

export function priceListHTML(item) {
  const offers = offersFor(item);
  if (offers.length === 0) {
    return '<li class="muted">No prices recorded yet</li>';
  }
  return offers
    .map(
      (offer) => `<li>
        <span class="p-store">${esc(offer.store)}</span>
        <span class="p-price">${money(offer.price)}</span>
        <span class="p-unit">${unitPriceLabel(offer.record.price, offer.record.size, offer.record.unit)}</span>
        <span class="p-date">${fmtDate(offer.record.date)}</span>
      </li>`
    )
    .join('');
}

export function cardHTML(ctx, item) {
  const inList = ctx.inList(item.id);
  return `<article class="card${inList ? ' in-list' : ''}" data-id="${esc(item.id)}">
    ${thumbHTML(ctx, item)}
    <div class="card-main">
      <h3>${esc(item.name)}</h3>
      <p class="muted">${esc(item.brand || 'No brand')}</p>
      <ul class="price-list">${priceListHTML(item)}</ul>
      <div class="card-actions">
        <button type="button" class="btn btn-small ${inList ? 'btn-ok' : 'btn-primary'}" data-toggle="${esc(item.id)}">${inList ? '✓ In list' : 'Add to list'}</button>
        <button type="button" class="btn btn-small btn-ghost" data-open="${esc(item.id)}">Details</button>
      </div>
    </div>
  </article>`;
}

// Wire up click handlers for cards rendered with cardHTML.
// `onChange` is called after a list toggle so the caller can redraw.
export function bindCards(container, ctx, onChange) {
  container.querySelectorAll('.card').forEach((card) => {
    const id = card.dataset.id;
    card.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      ctx.navigate(`#/item/${id}`);
    });
  });
  container.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      ctx.toggleList(btn.dataset.toggle);
      if (onChange) onChange();
    });
  });
  container.querySelectorAll('[data-open]').forEach((btn) => {
    btn.addEventListener('click', () => ctx.navigate(`#/item/${btn.dataset.open}`));
  });
}
