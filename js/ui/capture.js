// Capture: the in-store entry point. Name, price, size, unit, store, date, photo.

import { esc, money, toast, todayISO } from '../util.js';
import { addRecord, findItem, UNIT_OPTIONS } from '../domain/catalog.js';

let pendingFile = null;
let pendingPreviewUrl = null;

function datalistHTML(id, values) {
  return `<datalist id="${id}">${values
    .map((v) => `<option value="${esc(v)}"></option>`)
    .join('')}</datalist>`;
}

export function render(container, ctx, { params }) {
  pendingFile = null;
  revokePreview();

  const catalog = ctx.catalog;
  const names = [...new Set(catalog.items.map((item) => item.name))].sort();
  const brands = [...new Set(catalog.items.map((item) => item.brand).filter(Boolean))].sort();
  const stores = [...catalog.stores];
  if (ctx.settings.lastStore && !stores.includes(ctx.settings.lastStore)) {
    stores.unshift(ctx.settings.lastStore);
  }

  const prefillItem = params.get('item')
    ? catalog.items.find((item) => item.id === params.get('item'))
    : null;

  container.innerHTML = `
    <div class="view-head">
      <h2>Capture a price</h2>
      <p class="muted">Standing in the aisle? Log what you see — the date and store are kept with every record.</p>
    </div>

    <form id="capture-form" class="form" novalidate>
      <div class="field field-wide">
        <label for="f-name">Product name <span class="req">*</span></label>
        <input id="f-name" name="name" type="text" required autocomplete="off" list="dl-names"
               placeholder="e.g. Baked Beans" value="${esc(prefillItem?.name || '')}">
        <p id="match-hint" class="hint" hidden></p>
      </div>
      ${datalistHTML('dl-names', names)}

      <div class="field">
        <label for="f-brand">Brand</label>
        <input id="f-brand" name="brand" type="text" autocomplete="off" list="dl-brands"
               placeholder="e.g. Heinz" value="${esc(prefillItem?.brand || '')}">
      </div>
      ${datalistHTML('dl-brands', brands)}

      <div class="field">
        <label for="f-price">Price (£) <span class="req">*</span></label>
        <input id="f-price" name="price" type="number" inputmode="decimal" min="0" step="0.01" required
               placeholder="0.95">
      </div>

      <div class="field">
        <label for="f-size">Size <span class="req">*</span></label>
        <input id="f-size" name="size" type="number" inputmode="decimal" min="0" step="any" required
               placeholder="415">
      </div>

      <div class="field">
        <label for="f-unit">Unit <span class="req">*</span></label>
        <select id="f-unit" name="unit">
          ${UNIT_OPTIONS.map(
            (u) => `<option value="${u}"${u === 'g' ? ' selected' : ''}>${u}</option>`
          ).join('')}
        </select>
      </div>

      <div class="field">
        <label for="f-store">Store <span class="req">*</span></label>
        <input id="f-store" name="store" type="text" required autocomplete="off" list="dl-stores"
               placeholder="e.g. Lidl" value="${esc(ctx.settings.lastStore || '')}">
      </div>
      ${datalistHTML('dl-stores', stores)}

      <div class="field">
        <label for="f-date">Date</label>
        <input id="f-date" name="date" type="date" value="${todayISO()}">
      </div>

      <div class="field field-wide">
        <label for="f-image">Photo (optional)</label>
        <input id="f-image" name="image" type="file" accept="image/*" capture="environment">
        <div id="image-preview" class="image-preview" hidden>
          <img id="preview-img" alt="Product preview">
          <button type="button" id="remove-image" class="btn btn-small btn-ghost">Remove photo</button>
        </div>
      </div>

      <div class="form-actions field-wide">
        <button type="submit" class="btn btn-primary">Save entry</button>
        <button type="button" id="btn-another" class="btn">Save &amp; add another</button>
        <button type="button" id="btn-goto-list" class="btn btn-ghost">View list</button>
      </div>
    </form>`;

  const form = container.querySelector('#capture-form');
  const nameInput = container.querySelector('#f-name');
  const brandInput = container.querySelector('#f-brand');
  const matchHint = container.querySelector('#match-hint');
  const imageInput = container.querySelector('#f-image');
  const preview = container.querySelector('#image-preview');
  const previewImg = container.querySelector('#preview-img');

  const updateMatchHint = () => {
    const name = nameInput.value.trim();
    if (!name) {
      matchHint.hidden = true;
      return;
    }
    const existing = findItem(catalog, name, brandInput.value.trim());
    if (existing) {
      const count = existing.records.length;
      matchHint.textContent = `Existing product (${count} record${count === 1 ? '' : 's'}) — this will be added to it.`;
      matchHint.classList.remove('hint-new');
      matchHint.classList.add('hint-match');
    } else {
      matchHint.textContent = 'New product — will be added to your catalog.';
      matchHint.classList.remove('hint-match');
      matchHint.classList.add('hint-new');
    }
    matchHint.hidden = false;
  };

  nameInput.addEventListener('input', updateMatchHint);
  brandInput.addEventListener('input', updateMatchHint);
  updateMatchHint();

  imageInput.addEventListener('change', () => {
    revokePreview();
    const file = imageInput.files && imageInput.files[0];
    pendingFile = file || null;
    if (file) {
      pendingPreviewUrl = URL.createObjectURL(file);
      previewImg.src = pendingPreviewUrl;
      preview.hidden = false;
    } else {
      preview.hidden = true;
    }
  });

  container.querySelector('#remove-image').addEventListener('click', () => {
    imageInput.value = '';
    pendingFile = null;
    revokePreview();
    preview.hidden = true;
  });

  const collectEntry = () => {
    form.querySelectorAll('input').forEach((input) => input.setCustomValidity(''));
    const name = nameInput.value.trim();
    const store = container.querySelector('#f-store').value.trim();
    const price = container.querySelector('#f-price').value;
    const size = container.querySelector('#f-size').value;
    const unit = container.querySelector('#f-unit').value;

    if (!name) {
      nameInput.setCustomValidity('Enter the product name');
    }
    if (!(Number(price) > 0)) {
      container.querySelector('#f-price').setCustomValidity('Enter a price greater than zero');
    }
    if (size === '' && unit !== 'each') {
      container.querySelector('#f-size').setCustomValidity(
        'Enter the pack size so a unit price can be calculated'
      );
    }
    if (!form.reportValidity()) return null;

    return {
      name,
      brand: brandInput.value.trim(),
      store,
      price: Number(price),
      size: size === '' ? 1 : Number(size),
      unit,
      date: container.querySelector('#f-date').value || todayISO(),
    };
  };

  const save = (keepStoreAndDate) => {
    const entry = collectEntry();
    if (!entry) return;

    let savedItem = null;
    ctx.commit((cat) => {
      const result = addRecord(cat, entry);
      savedItem = result.item;
    });
    ctx.saveSettings({ lastStore: entry.store });

    if (pendingFile && savedItem) {
      const file = pendingFile;
      pendingFile = null;
      ctx.attachImage(savedItem.id, file);
    }

    toast(`Recorded ${entry.name} at ${entry.store} — ${money(entry.price)}`, 'success');

    revokePreview();
    preview.hidden = true;
    imageInput.value = '';
    nameInput.value = '';
    brandInput.value = '';
    container.querySelector('#f-price').value = '';
    container.querySelector('#f-size').value = '';
    if (!keepStoreAndDate) {
      container.querySelector('#f-store').value = '';
      container.querySelector('#f-date').value = todayISO();
    }
    updateMatchHint();
    nameInput.focus();
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    save(false);
  });
  container.querySelector('#btn-another').addEventListener('click', () => save(true));
  container.querySelector('#btn-goto-list').addEventListener('click', () => {
    ctx.navigate('#/list');
  });

  if (prefillItem) {
    container.querySelector('#f-price').focus();
  } else {
    nameInput.focus();
  }
}

function revokePreview() {
  if (pendingPreviewUrl) {
    URL.revokeObjectURL(pendingPreviewUrl);
    pendingPreviewUrl = null;
  }
}
