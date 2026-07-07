/* costing-autocomplete.js
 * Attach to a description input to suggest financial_dictionary rows.
 */

function createSuggestionBox() {
  const box = document.createElement('div');
  box.className = 'list-group position-absolute shadow-sm';
  box.style.zIndex = 2000;
  box.style.maxHeight = '260px';
  box.style.overflowY = 'auto';
  box.style.width = '100%';
  box.style.display = 'none';
  return box;
}

/**
 * @param {HTMLInputElement} inputEl - description input
 * @param {Object} opts
 * @param {() => string} opts.getLang - returns 'EN'|'FR'
 * @param {(item) => void} opts.onPick - callback with picked dict item
 */
function attachFinancialDictionaryAutocomplete(inputEl, opts) {
  const wrapper = inputEl.closest('td') || inputEl.parentElement;
  if (!wrapper) return;

  wrapper.style.position = 'relative';

  const box = createSuggestionBox();
  wrapper.appendChild(box);

  const hide = () => { box.style.display = 'none'; box.innerHTML = ''; };

  const doSearch = debounce(async () => {
    const q = (inputEl.value || '').trim();
    if (q.length < 2) { hide(); return; }

    // your API endpoint (you will create it in PHP)
    // expected: { ok:true, items:[{id,code,name_en,name_fr}] }
    let data;
    try {
      const lang = opts.getLang?.() || 'EN';
      data = await apiGet(`../../api/finance/financial_dictionary/search.php?q=${encodeURIComponent(q)}&lang=${encodeURIComponent(lang)}`);
    } catch (e) {
      // Fail quietly but safely
      hide();
      return;
    }

    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) { hide(); return; }

    box.innerHTML = items.map(it => {
      const name = (opts.getLang?.() === 'FR') ? (it.name_fr || it.name_en) : (it.name_en || it.name_fr);
      const safeName = String(name || '').replace(/[<>&]/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[s]));
      const safeCode = String(it.code || '').replace(/[<>&]/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[s]));

      return `
        <button type="button"
          class="list-group-item list-group-item-action d-flex justify-content-between align-items-start"
          data-id="${it.id}"
          data-code="${safeCode}"
          data-name-en="${String(it.name_en || '').replace(/"/g,'&quot;')}"
          data-name-fr="${String(it.name_fr || '').replace(/"/g,'&quot;')}"
        >
          <div class="me-2">
            <div class="fw-bold small">${safeName}</div>
            <div class="text-muted" style="font-size:0.75rem">${safeCode}</div>
          </div>
          <span class="badge bg-light text-dark border">Use</span>
        </button>
      `;
    }).join('');

    box.style.display = 'block';
  }, 250);

  inputEl.addEventListener('input', doSearch);

  // pick item
  box.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-id]');
    if (!btn) return;

    const item = {
      id: parseInt(btn.dataset.id, 10),
      code: btn.dataset.code,
      name_en: btn.dataset.nameEn,
      name_fr: btn.dataset.nameFr
    };

    opts.onPick?.(item);
    hide();
  });

  // close on blur (small delay so click registers)
  inputEl.addEventListener('blur', () => setTimeout(hide, 150));

  // Esc closes
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
}
