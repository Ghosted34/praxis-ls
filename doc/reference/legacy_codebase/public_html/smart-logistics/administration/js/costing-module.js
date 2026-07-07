/* costing-module.js */

(function () {
  // ---- GLOBAL STATE ----
  const state = {
    lang: 'EN',
    currency: 'XAF',
    exchangeRateToXaf: 1.0,
    currentCostingId: null,       // uuid
    currentCostingRef: null,      // SLAS-COST-...
    currentStatus: 'DRAFT',
    vatRate: 0.1925
  };

  // ---- ELEMENTS (expects your existing IDs) ----
  const el = {
    offcanvas: document.getElementById('costingOffcanvas'),
    linkOps: document.getElementById('link-file-ref'),
    costingDate: document.getElementById('costing-date'),
    badge: document.getElementById('costing-status-badge'),
    refDisplay: document.getElementById('costing-ref-display'),
    linesBody: document.getElementById('lines-body'),
    remarks: document.getElementById('costing-remarks'),
    validatorName: document.getElementById('validator-name'),

    grandHT: document.getElementById('grand-ht'),
    grandVAT: document.getElementById('grand-vat'),
    grandTTC: document.getElementById('grand-ttc'),

    langEN: document.getElementById('lang-en'),
    langFR: document.getElementById('lang-fr'),
    currencySel: document.getElementById('currency-selector'),

    saveStatus: document.getElementById('save-status')
  };

  // Bootstrap offcanvas (your page already uses bootstrap global)
  const bsOffcanvas = el.offcanvas ? new bootstrap.Offcanvas(el.offcanvas) : null;

  // ---- CLOCK (keep yours if you want) ----
  function tickClock() {
    const c = document.getElementById('realtime-clock');
    if (!c) return;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    c.textContent = `${hh}:${mm}:${ss}`;
  }
  setInterval(tickClock, 1000);
  tickClock();

  // ---- LANGUAGE TOGGLE ----
  if (el.langEN) el.langEN.addEventListener('change', () => { if (el.langEN.checked) state.lang = 'EN'; });
  if (el.langFR) el.langFR.addEventListener('change', () => { if (el.langFR.checked) state.lang = 'FR'; });

  // ---- OPS FILE SELECT POPULATION ----
  async function loadOpsFilesSelect() {
    if (!el.linkOps) return;

    // expected: { ok:true, items:[{operations_file_reference, client_name, service_type, eta}] }
    const data = await apiGet(`../../api/operations/files/list_for_costing.php`);

    const items = Array.isArray(data.items) ? data.items : [];
    el.linkOps.innerHTML = `<option value="">Select File Ref...</option>` + items.map(it => {
      const label = `${it.operations_file_reference} (${it.client_name || '-'})`;
      return `<option value="${it.operations_file_reference}">${label}</option>`;
    }).join('');
  }

  // ---- SSDC UI HELPERS ----
  function setText(id, v) {
    const n = document.getElementById(id);
    if (n) n.innerText = (v === null || v === undefined || String(v).trim() === '') ? '-' : String(v);
  }

  function detectGroup(serviceType) {
    const s = String(serviceType || '').toUpperCase();
    if (s.includes('SEA')) return 'SEA';
    if (s.includes('AIR')) return 'AIR';
    if (s.includes('INLAND') || s.includes('TRANSPORT') || s.includes('TRANSIT')) return 'TRANSPORT';
    if (s.includes('WAREHOUS')) return 'WAREHOUSE';
    if (s.includes('REPRESENTATION') || s.includes('BUSINESS_REP')) return 'BUSINESS_REP';
    return 'ALL';
  }

  function smartTransportRef(d, group) {
    if (group === 'SEA') return d.sea_bl;
    if (group === 'AIR') return d.air_mawb;
    if (group === 'TRANSPORT') return d.inland_truck;
    return null;
  }

  function smartConveyance(d, group) {
    if (group === 'SEA') {
      const a = [d.sea_vessel, d.sea_voyage].filter(Boolean);
      return a.length ? a.join(' / ') : null;
    }
    if (group === 'AIR') {
      const a = [d.air_airline, d.air_flightno].filter(Boolean);
      return a.length ? a.join(' / ') : null;
    }
    if (group === 'TRANSPORT') return 'Road Transit';
    return null;
  }

  function smartRoute(d, group) {
    if (group === 'SEA') return (d.sea_pol && d.sea_pod) ? `${d.sea_pol} → ${d.sea_pod}` : null;
    if (group === 'AIR') return (d.air_origin && d.air_dest) ? `${d.air_origin} → ${d.air_dest}` : null;
    if (group === 'TRANSPORT') return d.inland_border || null;
    return null;
  }

  function smartEtaArrival(d) {
    return d.ata || d.eta || null;
  }

  function clearSSDC() {
    [
      'ssdc-client','ssdc-service','ssdc-transport','ssdc-marks',
      'ssdc-eta','ssdc-conveyance','ssdc-weight','ssdc-packages',
      'ssdc-delivery','ssdc-commodity'
    ].forEach(id => setText(id, '-'));
  }

  async function loadSSDCFromDB(ref) {
    clearSSDC();
    if (!ref) return;

    // expected: { ok:true, item:{...} }
    const data = await apiGet(`../../api/operations/files/get_ssdc.php?ref=${encodeURIComponent(ref)}`);
    const d = data.item;
    if (!d) return;

    const group = detectGroup(d.service_type);

    setText('ssdc-client', d.client_name);
    setText('ssdc-service', (d.service_type || '').replace(/_/g, ' '));
    setText('ssdc-transport', smartTransportRef(d, group));
    setText('ssdc-marks', d.marks_numbers);
    setText('ssdc-eta', smartEtaArrival(d));
    setText('ssdc-conveyance', smartConveyance(d, group));

    // Weight
    const w = (d.gross_weight ? `${d.gross_weight} ${d.weight_unit || ''}` : null);
    setText('ssdc-weight', w);

    // Packages: your DB field is package_count (not pkg_count)
    setText('ssdc-packages', d.package_count);

    setText('ssdc-delivery', d.place_delivery);
    setText('ssdc-commodity', d.commodity || d.commodity_desc);
    // optional route if you later add an element:
    // setText('ssdc-route', smartRoute(d, group));
  }

  // when ops file changes
  if (el.linkOps) {
    el.linkOps.addEventListener('change', async () => {
      await loadSSDCFromDB(el.linkOps.value);

      // Also store client/service snapshot in state if needed later
      // (we will send full snapshot in save payload anyway)
    });
  }

  // ---- LINES / TOTALS ----
  function format2(n) {
    const x = Number(n || 0);
    return x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function recalcTotals() {
    let ht = 0, vat = 0, ttc = 0;

    document.querySelectorAll('#lines-body tr').forEach(tr => {
      ht += Number(tr.dataset.ht || 0);
      vat += Number(tr.dataset.vat || 0);
      ttc += Number(tr.dataset.ttc || 0);
    });

    if (el.grandHT) el.grandHT.innerText = format2(ht);
    if (el.grandVAT) el.grandVAT.innerText = format2(vat);
    if (el.grandTTC) el.grandTTC.innerText = `${format2(ttc)} ${state.currency}`;

    window.__totals = { ht, vat, ttc };
  }

  function recalcRow(tr) {
    const qty = Number(tr.querySelector('.qty-input')?.value || 0);
    const cost = Number(tr.querySelector('.cost-input')?.value || 0);
    const vatOn = !!tr.querySelector('.vat-check')?.checked;

    const ht = qty * cost;
    const vat = vatOn ? ht * state.vatRate : 0;
    const ttc = ht + vat;

    tr.dataset.ht = ht;
    tr.dataset.vat = vat;
    tr.dataset.ttc = ttc;

    const htEl = tr.querySelector('.ht-val');
    const ttcEl = tr.querySelector('.ttc-val');
    if (htEl) htEl.innerText = format2(ht);
    if (ttcEl) ttcEl.innerText = format2(ttc);

    recalcTotals();
  }

  function removeLine(trId) {
    const tr = document.getElementById(trId);
    if (tr) tr.remove();
    recalcTotals();
  }

  function addLine(initial = {}) {
    const rowId = `row-${Math.random().toString(16).slice(2)}`;
    const lineNo = el.linesBody ? (el.linesBody.querySelectorAll('tr').length + 1) : 1;

    const code = initial.code || '';
    const desc = initial.desc || '';
    const qty = (initial.qty ?? 1);
    const cost = (initial.cost ?? 0);

    const tr = document.createElement('tr');
    tr.id = rowId;
    tr.dataset.dictId = initial.financial_dictionary_id ? String(initial.financial_dictionary_id) : '';

    tr.innerHTML = `
      <td class="text-center">
        <button type="button" class="btn btn-sm text-danger" title="Remove">
          <i class="fa-solid fa-times"></i>
        </button>
      </td>

      <td>
        <input type="text" class="form-control form-control-sm smart-input font-monospace code-input"
          placeholder="Code" value="${code}">
      </td>

      <td>
        <input type="text" class="form-control form-control-sm smart-input desc-input"
          placeholder="Description (Item)" value="${desc}">
      </td>

      <td>
        <input type="number" class="form-control form-control-sm smart-input text-center qty-input"
          value="${qty}" min="0" step="0.001">
      </td>

      <td>
        <input type="number" class="form-control form-control-sm smart-input text-end cost-input"
          value="${cost}" min="0" step="0.01">
      </td>

      <td class="text-end font-monospace ht-val">0.00</td>

      <td class="text-center">
        <input type="checkbox" class="form-check-input vat-check" checked>
      </td>

      <td class="text-end fw-bold font-monospace ttc-val">0.00</td>
      <td></td>
    `;

    // remove
    tr.querySelector('button')?.addEventListener('click', () => removeLine(rowId));

    // recalc handlers
    tr.querySelector('.qty-input')?.addEventListener('input', () => recalcRow(tr));
    tr.querySelector('.cost-input')?.addEventListener('input', () => recalcRow(tr));
    tr.querySelector('.vat-check')?.addEventListener('change', () => recalcRow(tr));

    // autocomplete on description
    const descInput = tr.querySelector('.desc-input');
    const codeInput = tr.querySelector('.code-input');

    if (descInput && codeInput) {
      attachFinancialDictionaryAutocomplete(descInput, {
        getLang: () => state.lang,
        onPick: (item) => {
          // fill code + store dict id + use correct language label
          tr.dataset.dictId = String(item.id);
          codeInput.value = item.code || '';
          descInput.value = (state.lang === 'FR') ? (item.name_fr || item.name_en || '') : (item.name_en || item.name_fr || '');

          // if later you store a default cost in dictionary, you can fill it here
          // tr.querySelector('.cost-input').value = ...

          recalcRow(tr);
        }
      });
    }

    el.linesBody.appendChild(tr);
    recalcRow(tr);
  }

  // expose buttons used in HTML onclick for now (you can refactor later)
  window.addLine = () => addLine();
  window.removeLine = (id) => removeLine(id);

  // ---- COSTING OPEN (NEW) ----
  async function openNewCosting() {
    // reset
    state.currentCostingId = null;
    state.currentCostingRef = null;
    state.currentStatus = 'DRAFT';

    if (el.badge) { el.badge.className = 'badge bg-secondary'; el.badge.innerText = 'DRAFT'; }
    if (el.refDisplay) el.refDisplay.innerText = 'SLAS-COST-####';

    if (el.linesBody) el.linesBody.innerHTML = '';
    if (el.linkOps) el.linkOps.value = '';
    if (el.validatorName) el.validatorName.innerText = 'Select...';
    if (el.remarks) el.remarks.value = '';

    clearSSDC();
    recalcTotals();

    // today date
    if (el.costingDate) {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      el.costingDate.value = `${y}-${m}-${d}`;
    }

    // load ops select from DB
    await loadOpsFilesSelect();

    bsOffcanvas?.show();
  }

  // If your HTML calls openCostingOffcanvas('new'), map it:
  window.openCostingOffcanvas = async (id) => {
    if (id === 'new') return openNewCosting();

    // existing costing load (view/edit) — requires endpoint
    // expected: { ok:true, master:{...}, lines:[...]}
    const data = await apiGet(`../../api/finance/costings/get.php?id=${encodeURIComponent(id)}`);

    // hydrate
    state.currentCostingId = data.master.costing_id;
    state.currentCostingRef = data.master.costing_ref;
    state.currentStatus = data.master.status;

    if (el.refDisplay) el.refDisplay.innerText = data.master.costing_ref;
    if (el.costingDate) el.costingDate.value = data.master.costing_date;
    if (el.linkOps) {
      await loadOpsFilesSelect();
      el.linkOps.value = data.master.operations_file_reference;
      await loadSSDCFromDB(el.linkOps.value);
    }
    if (el.remarks) el.remarks.value = data.master.remarks || '';

    if (el.badge) {
      // keep your CSS mapping if you want; for now plain
      el.badge.className = 'badge bg-secondary';
      el.badge.innerText = data.master.status;
    }

    // lines
    if (el.linesBody) el.linesBody.innerHTML = '';
    (data.lines || []).forEach(ln => addLine({
      financial_dictionary_id: ln.financial_dictionary_id,
      code: ln.code,
      desc: ln.description_used,
      qty: ln.qty,
      cost: ln.unit_cost
    }));

    bsOffcanvas?.show();
  };

  // ---- BUILD SAVE PAYLOAD ----
  function buildPayload(nextStatus) {
    const opsRef = el.linkOps?.value || '';
    const totals = window.__totals || { ht: 0, vat: 0, ttc: 0 };

    const ssdcClientName = document.getElementById('ssdc-client')?.innerText || '';
    const ssdcService = document.getElementById('ssdc-service')?.innerText || '';

    const lines = [];
    document.querySelectorAll('#lines-body tr').forEach((tr, idx) => {
      const code = tr.querySelector('.code-input')?.value || '';
      const desc = tr.querySelector('.desc-input')?.value || '';
      const qty = Number(tr.querySelector('.qty-input')?.value || 0);
      const unitCost = Number(tr.querySelector('.cost-input')?.value || 0);
      const vatOn = !!tr.querySelector('.vat-check')?.checked;

      lines.push({
        line_no: idx + 1,
        financial_dictionary_id: tr.dataset.dictId ? Number(tr.dataset.dictId) : null,
        code,
        description_used: desc,
        qty,
        unit_cost: unitCost,
        vat_applicable: vatOn ? 1 : 0,
        vat_rate: state.vatRate
      });
    });

    return {
      costing_id: state.currentCostingId, // null for new
      costing_ref: state.currentCostingRef, // server can assign if null
      operations_file_reference: opsRef,
      costing_date: el.costingDate?.value || null,
      remarks: el.remarks?.value || null,

      currency: state.currency,
      exchange_rate_to_xaf: state.exchangeRateToXaf,

      status: nextStatus,
      totals,

      // snapshots for auditing/print
      snapshot: {
        client_name: ssdcClientName,
        service_label: ssdcService
      },

      lines
    };
  }

  // ---- WORKFLOW ACTIONS (DB writes) ----
  window.saveDraft = async function () {
    try {
      const payload = buildPayload('DRAFT');
      const data = await apiPost(`../../api/finance/costings/save.php`, payload);

      state.currentCostingId = data.costing_id;
      state.currentCostingRef = data.costing_ref;
      state.currentStatus = data.status;

      if (el.refDisplay) el.refDisplay.innerText = data.costing_ref;
      if (el.badge) { el.badge.className = 'badge bg-secondary'; el.badge.innerText = 'DRAFT'; }
      if (el.saveStatus) el.saveStatus.innerText = 'Last saved: Just now';

      alert('Draft saved.');
    } catch (e) {
      alert(e.message || String(e));
    }
  };

  window.submitForValidation = async function () {
    try {
      if ((el.validatorName?.innerText || '') === 'Select...') {
        alert('Please select a Validator first.');
        return;
      }

      const payload = buildPayload('SUBMITTED_FOR_VALIDATION');
      payload.validator_display_name = el.validatorName?.innerText || null;

      const data = await apiPost(`../../api/finance/costings/transition.php`, payload);

      state.currentCostingId = data.costing_id;
      state.currentCostingRef = data.costing_ref;
      state.currentStatus = data.status;

      if (el.badge) { el.badge.className = 'badge bg-primary'; el.badge.innerText = 'SUBMITTED_FOR_VALIDATION'; }

      alert('Submitted for validation.');
      bsOffcanvas?.hide();
    } catch (e) {
      alert(e.message || String(e));
    }
  };

  // Optional: validator button action
  window.validateCosting = async function () {
    try {
      const payload = buildPayload('VALIDATED');
      const data = await apiPost(`../../api/finance/costings/transition.php`, payload);

      state.currentStatus = data.status;
      if (el.badge) { el.badge.className = 'badge bg-success'; el.badge.innerText = 'VALIDATED'; }

      alert('Validated.');
    } catch (e) {
      alert(e.message || String(e));
    }
  };

  // Optional: management approval
  window.approveCosting = async function () {
    try {
      const payload = buildPayload('APPROVED_LOCKED');
      const data = await apiPost(`../../api/finance/costings/transition.php`, payload);

      state.currentStatus = data.status;
      if (el.badge) { el.badge.className = 'badge bg-dark'; el.badge.innerText = 'APPROVED_LOCKED'; }

      alert('Approved & Locked.');
    } catch (e) {
      alert(e.message || String(e));
    }
  };

  // ---- CURRENCY CHANGE (keep simple) ----
  if (el.currencySel) {
    el.currencySel.addEventListener('change', async () => {
      const newCurr = el.currencySel.value;
      let newRate = 1;

      if (newCurr !== 'XAF') {
        const input = prompt(`Enter Exchange Rate for ${newCurr} to XAF:`, '655.957');
        if (!input || isNaN(input)) {
          el.currencySel.value = state.currency;
          return;
        }
        newRate = Number(input);
      }

      // convert all unit costs from old currency to new currency:
      // ratio = oldRate / newRate  (because values are stored "in current currency")
      const ratio = state.exchangeRateToXaf / newRate;

      document.querySelectorAll('#lines-body tr').forEach(tr => {
        const costEl = tr.querySelector('.cost-input');
        if (!costEl) return;
        const current = Number(costEl.value || 0);
        costEl.value = (current * ratio).toFixed(2);
        recalcRow(tr);
      });

      state.currency = newCurr;
      state.exchangeRateToXaf = newRate;
      recalcTotals();
    });
  }

  // ---- INIT ----
  // On page load, you may want to preload ops files for faster UX:
  // loadOpsFilesSelect().catch(()=>{});
})();
