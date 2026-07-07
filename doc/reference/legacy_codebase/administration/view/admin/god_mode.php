<?php
/*
 * ======================================================================================
 * SMART LS ENTERPRISE - GOD MODE COMMAND CENTER
 * ======================================================================================
 * DESCRIPTION: High-stakes UI for executing hard deletions and viewing the immutable vault.
 * ACCESS: Strictly ADMIN role. Hidden from standard navigation.
 * ======================================================================================
 */

declare(strict_types=1);
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

// --- Extreme RBAC Enforcement ---
require_role(['ADMIN', 'MANAGEMENT']);

$employeeId = (string)($_SESSION['auth']['employee_id'] ?? '');
$userId     = (int)($_SESSION['auth']['user_id'] ?? 0);
$userEmail  = (string)($_SESSION['auth']['email'] ?? '');

if ($employeeId === '' || $userId <= 0) {
    header('Location: ../../api/auth/logout.php');
    exit;
}

function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Command Center | Smart LS God Mode</title>

    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">

    <style>
        :root {
            --smart-charcoal: #231F20;
            --smart-danger: #D32F2F;
            --smart-danger-bg: #FFF0F0;
            --smart-bg: #F8F9FA;
        }

        body {
            font-family: 'Manrope', sans-serif;
            background: var(--smart-bg);
            color: var(--smart-charcoal);
            overflow-x: hidden;
        }

        /* --- COMMAND CENTER TOPBAR --- */
        .command-topbar {
            background: var(--smart-charcoal);
            color: white;
            height: 70px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 30px;
            border-bottom: 4px solid var(--smart-danger);
            box-shadow: 0 4px 15px rgba(0,0,0,0.1);
        }

        .brand-logo { font-weight: 800; font-size: 1.2rem; letter-spacing: 1px; color: white; text-decoration: none; }
        .danger-stripes {
            background: repeating-linear-gradient(45deg, var(--smart-danger), var(--smart-danger) 10px, #b71c1c 10px, #b71c1c 20px);
            height: 5px;
            width: 100%;
        }

        /* --- COMPONENTS --- */
        .card-custom {
            background: white;
            border-radius: 12px;
            border: 1px solid rgba(0,0,0,0.08);
            box-shadow: 0 4px 20px rgba(0,0,0,0.03);
            overflow: hidden;
        }
        
        .card-header-danger {
            background: var(--smart-danger-bg);
            color: var(--smart-danger);
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 1px;
            padding: 15px 20px;
            border-bottom: 1px solid rgba(211, 47, 47, 0.2);
        }

        .smart-input {
            border-radius: 6px;
            font-size: 0.95rem;
            padding: 0.6rem 1rem;
            border: 2px solid #E0E0E0;
            transition: all 0.2s ease;
        }
        .smart-input:focus { border-color: var(--smart-charcoal); box-shadow: none; outline: none; }
        
        .input-danger:focus { border-color: var(--smart-danger); box-shadow: 0 0 0 3px rgba(211,47,47,0.1); }

        .form-label { font-size: 0.75rem; font-weight: 800; text-transform: uppercase; color: #666; letter-spacing: 0.5px; }

        /* --- SEARCH RESULTS --- */
        .result-item {
            padding: 12px 20px;
            border-bottom: 1px solid #F0F0F0;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .result-item:hover { background: #F8F9FA; }
        .result-item.selected { background: var(--smart-charcoal); color: white; }
        .result-item.selected .text-muted { color: #BBB !important; }

        /* --- KILL SWITCH AREA --- */
        .kill-switch-area {
            background: #FAFAFA;
            border: 2px dashed #CCC;
            border-radius: 8px;
            padding: 30px;
            text-align: center;
            transition: all 0.3s;
        }
        .kill-switch-area.active {
            border-color: var(--smart-danger);
            background: var(--smart-danger-bg);
        }

        .btn-eradicate {
            background: var(--smart-danger);
            color: white;
            font-weight: 800;
            letter-spacing: 2px;
            text-transform: uppercase;
            padding: 12px 30px;
            border: none;
            border-radius: 6px;
            transition: all 0.2s;
        }
        .btn-eradicate:hover:not(:disabled) { background: #b71c1c; transform: scale(1.02); }
        .btn-eradicate:disabled { background: #E0E0E0; color: #999; cursor: not-allowed; }

        /* --- LEDGER TABLE --- */
        .table-ledger th {
            font-size: 0.75rem; text-transform: uppercase; color: #888; font-weight: 800; 
            background: #F8F9FA; border-bottom: 2px solid #E0E0E0;
        }
        .table-ledger td { font-size: 0.85rem; vertical-align: middle; }
        .font-mono { font-family: 'JetBrains Mono', monospace; }

        /* --- TABS --- */
        .nav-pills .nav-link { color: var(--smart-charcoal); font-weight: 700; border-radius: 6px; padding: 10px 20px; }
        .nav-pills .nav-link.active { background-color: var(--smart-charcoal); color: white; }
    </style>
</head>
<body>

<div class="toast-container position-fixed bottom-0 end-0 p-3" id="toastContainer" style="z-index: 1100;"></div>

<div class="danger-stripes"></div>
<div class="command-topbar">
    <div class="d-flex align-items-center gap-3">
        <i class="fa-solid fa-triangle-exclamation text-danger fs-4"></i>
        <span class="brand-logo">ERADICATION PROTOCOL</span>
    </div>
    <div class="d-flex align-items-center gap-4">
        <span class="font-mono text-warning fw-bold" id="clock">00:00:00</span>
        <div class="border-start border-secondary ps-4">
            <span class="fw-bold me-3"><?php echo e($userEmail); ?></span>
            <a href="index.php" class="btn btn-sm btn-outline-light fw-bold"><i class="fa-solid fa-person-walking-arrow-right me-1"></i> Exit God Mode</a>
        </div>
    </div>
</div>

<div class="container py-5" style="max-width: 1200px;">
    
    <div class="text-center mb-5">
        <h2 class="fw-black text-dark" style="letter-spacing: -1px;">SYSTEM DATA CLEANER</h2>
        <p class="text-muted">Warning: Actions taken here bypass standard application safeguards. Data is vaulted, then permanently erased from operational tables.</p>
    </div>

    <ul class="nav nav-pills justify-content-center mb-4 gap-2" id="godModeTabs" role="tablist">
        <li class="nav-item" role="presentation">
            <button class="nav-link active" id="eradicate-tab" data-bs-toggle="pill" data-bs-target="#eradicate-pane" type="button" role="tab"><i class="fa-solid fa-skull me-2"></i>Target Selection</button>
        </li>
        <li class="nav-item" role="presentation">
            <button class="nav-link" id="ledger-tab" data-bs-toggle="pill" data-bs-target="#ledger-pane" type="button" role="tab" onclick="GOD_MODE.fetchLedger()"><i class="fa-solid fa-vault me-2"></i>Vault Ledger</button>
        </li>
    </ul>

    <div class="tab-content" id="godModeTabsContent">
        
        <div class="tab-pane fade show active" id="eradicate-pane" role="tabpanel">
            <div class="row g-4">
                
                <div class="col-lg-5">
                    <div class="card-custom h-100">
                        <div class="p-4 border-bottom">
                            <h6 class="fw-bold mb-3"><i class="fa-solid fa-crosshairs me-2"></i> 1. Locate Target</h6>
                            
                            <label class="form-label">Module Hierarchy</label>
                            <select class="form-select smart-input mb-3 fw-bold" id="targetModule" onchange="GOD_MODE.resetSelection()">
                                <optgroup label="CRM & Pre-Sales">
                                    <option value="LEAD">Leads & Proposals</option>
                                    <option value="QUOTE_REQUEST">Quote Requests</option>
                                </optgroup>
                                <optgroup label="Pricing & Costing">
                                    <option value="MARGIN_SIMULATION">Margin Simulations</option>
                                    <option value="COSTING">Costings Master</option>
                                    <option value="OCR">Operational Cost Reconciliation (OCR)</option>
                                </optgroup>
                                <optgroup label="Finance & Treasury">
                                    <option value="INVOICE">Final Invoices</option>
                                    <option value="PROFORMA">Proforma Invoices</option>
                                    <option value="CASH_REQUEST">Cash Requests</option>
                                    <option value="PURCHASE_ORDER">Purchase Orders</option>
                                    <option value="DEBT">Debt Engagements</option>
                                </optgroup>
                                <optgroup label="Logistics Operations">
                                    <option value="OPS_FILE">Operations File (DANGER: Deep Cascade)</option>
                                    <option value="TRANSIT_ORDER">Transit Orders (OT)</option>
                                    <option value="DELIVERY_NOTE">Delivery Notes</option>
                                </optgroup>
                                <optgroup label="Master Registries">
                                    <option value="CLIENT">Client Registry</option>
                                    <option value="SUPPLIER">Supplier Registry</option>
                                </optgroup>
                            </select>

                            <label class="form-label">Identifier (ID or Ref)</label>
                            <div class="input-group">
                                <input type="text" class="form-control smart-input font-mono" id="searchInput" placeholder="e.g. SLAS-FI-0001">
                                <button class="btn btn-dark fw-bold px-4" type="button" onclick="GOD_MODE.searchRecords()"><i class="fa-solid fa-search"></i></button>
                            </div>
                        </div>
                        
                        <div class="p-0" id="searchResults" style="max-height: 400px; overflow-y: auto;">
                            <div class="p-4 text-center text-muted small">
                                <i class="fa-solid fa-satellite-dish fa-2x mb-2 opacity-50"></i><br>Awaiting search parameters...
                            </div>
                        </div>
                    </div>
                </div>

                <div class="col-lg-7">
                    <div class="card-custom h-100">
                        <div class="card-header-danger">
                            <i class="fa-solid fa-fire-flame-curved me-2"></i> 2. Execution Authorization
                        </div>
                        <div class="p-4 d-flex flex-column h-100">
                            
                            <div id="targetDisplay" class="mb-4">
                                <h5 class="fw-bold text-muted opacity-50">No Target Selected</h5>
                                <p class="small text-muted">Select a record from the left panel to proceed.</p>
                            </div>

                            <div class="kill-switch-area mt-auto" id="killSwitchArea">
                                <h6 class="fw-bold text-danger mb-3"><i class="fa-solid fa-lock me-2"></i> Authorization Required</h6>
                                <p class="small text-muted mb-4">Enter the weekly 6-character eradication token emailed to the CEO to unlock the kill switch.</p>
                                
                                <div class="d-flex justify-content-center gap-2 mb-4">
                                    <input type="text" class="form-control smart-input input-danger text-center font-mono fw-bold fs-5" id="authPassword" placeholder="••••••" maxlength="6" style="width: 150px; letter-spacing: 4px;" disabled oninput="GOD_MODE.checkInput()">
                                </div>

                                <button class="btn-eradicate w-100" id="btnExecute" disabled onclick="GOD_MODE.executeEradication()">
                                    Eradicate Record
                                </button>
                            </div>

                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="tab-pane fade" id="ledger-pane" role="tabpanel">
            <div class="card-custom">
                <div class="p-4 border-bottom d-flex justify-content-between align-items-center">
                    <h6 class="fw-bold mb-0"><i class="fa-solid fa-server me-2"></i> Immutable Deletion Vault</h6>
                    <button class="btn btn-sm btn-outline-secondary fw-bold" onclick="GOD_MODE.fetchLedger()"><i class="fa-solid fa-rotate-right me-1"></i> Refresh</button>
                </div>
                <div class="table-responsive">
                    <table class="table table-hover table-ledger mb-0">
                        <thead>
                            <tr>
                                <th class="ps-4">Timestamp (WAT)</th>
                                <th>Module</th>
                                <th>Primary Reference</th>
                                <th>Authorized By</th>
                                <th class="text-end pe-4">Vault ID</th>
                            </tr>
                        </thead>
                        <tbody id="ledgerBody">
                            <tr><td colspan="5" class="text-center py-4 text-muted">Loading vault data...</td></tr>
                        </tbody>
                    </table>
                </div>
                <div class="p-3 bg-light border-top text-end">
                    <button class="btn btn-sm btn-dark fw-bold px-3" onclick="GOD_MODE.changePage(-1)">Previous</button>
                    <span class="mx-3 fw-bold font-mono" id="pageIndicator">Page 1</span>
                    <button class="btn btn-sm btn-dark fw-bold px-3" onclick="GOD_MODE.changePage(1)">Next</button>
                </div>
            </div>
        </div>

    </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
<script>
    /**
     * ==================================================================================
     * GOD MODE FRONTEND CONTROLLER
     * ==================================================================================
     */
    const GOD_MODE = (function() {
        'use strict';

        let state = {
            targetId: null,
            targetRef: null,
            targetModule: 'INVOICE',
            ledgerPage: 1
        };

        const API_URL = '../../api/god_mode_api.php';

        const utils = {
            showToast: (title, message, type = 'success') => {
                const container = document.getElementById('toastContainer');
                const bg = type === 'success' ? 'bg-dark' : 'bg-danger';
                const html = `
                    <div class="toast align-items-center text-white ${bg} border-0 show" role="alert" aria-live="assertive" aria-atomic="true">
                      <div class="d-flex">
                        <div class="toast-body fw-bold">
                          <i class="fa-solid ${type === 'success' ? 'fa-check-circle' : 'fa-triangle-exclamation'} me-2"></i>
                          <strong>${title}</strong>: ${message}
                        </div>
                        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
                      </div>
                    </div>`;
                const div = document.createElement('div');
                div.innerHTML = html;
                container.appendChild(div.firstElementChild);
                setTimeout(() => { if(container.firstChild) container.removeChild(container.firstElementChild); }, 5000);
            },
            formatDate: (dateString) => {
                const d = new Date(dateString);
                return d.toLocaleString('en-GB', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
            }
        };

        // --- Clock ---
        function tickClock(){
            const d = new Date();
            document.getElementById('clock').innerText = d.toLocaleTimeString('en-US', { hour12: false });
        }
        setInterval(tickClock, 1000); tickClock();

        // --- Step 1: Search ---
        async function searchRecords() {
            const query = document.getElementById('searchInput').value.trim();
            const module = document.getElementById('targetModule').value;
            const resDiv = document.getElementById('searchResults');
            
            if (query.length < 2) {
                resDiv.innerHTML = `<div class="p-4 text-center text-muted small">Enter at least 2 characters.</div>`;
                return;
            }

            resDiv.innerHTML = `<div class="p-4 text-center"><i class="fa-solid fa-circle-notch fa-spin text-muted"></i></div>`;
            state.targetModule = module;

            try {
                const res = await fetch(API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'search_records', target_module: module, query: query })
                });
                const data = await res.json();

                if (data.success && data.results.length > 0) {
                    resDiv.innerHTML = data.results.map(r => `
                        <div class="result-item" onclick="GOD_MODE.selectRecord(${r.id}, '${r.ref}', '${r.details}', this)">
                            <div>
                                <div class="font-mono fw-bold">${r.ref}</div>
                                <div class="small text-muted">${r.details}</div>
                            </div>
                            <i class="fa-solid fa-chevron-right text-muted opacity-50"></i>
                        </div>
                    `).join('');
                } else {
                    resDiv.innerHTML = `<div class="p-4 text-center text-muted small">No active records found matching criteria.</div>`;
                }
            } catch (e) {
                resDiv.innerHTML = `<div class="p-4 text-center text-danger small">Network error occurred.</div>`;
            }
        }

        // --- Step 2: Select ---
        function selectRecord(id, ref, details, element) {
            // UI Selection
            document.querySelectorAll('.result-item').forEach(el => el.classList.remove('selected'));
            element.classList.add('selected');

            // State Update
            state.targetId = id;
            state.targetRef = ref;

            // Unlock Kill Switch Area
            const targetDisplay = document.getElementById('targetDisplay');
            const killSwitch = document.getElementById('killSwitchArea');
            const pwdInput = document.getElementById('authPassword');

            targetDisplay.innerHTML = `
                <span class="badge bg-dark mb-2 px-3 py-2 border border-secondary">${state.targetModule}</span>
                <h3 class="fw-black text-danger font-mono mb-1">${ref}</h3>
                <p class="text-dark fw-bold mb-0">${details}</p>
                <div class="alert alert-danger mt-3 mb-0 border-0 bg-danger bg-opacity-10 text-danger fw-bold small">
                    <i class="fa-solid fa-triangle-exclamation me-1"></i> Proceeding will destroy this parent record and cascade delete all associated child dependencies.
                </div>
            `;

            killSwitch.classList.add('active');
            pwdInput.disabled = false;
            pwdInput.value = '';
            pwdInput.focus();
            checkInput();
        }

        function resetSelection() {
            state.targetId = null;
            document.getElementById('searchResults').innerHTML = `<div class="p-4 text-center text-muted small"><i class="fa-solid fa-satellite-dish fa-2x mb-2 opacity-50"></i><br>Awaiting search parameters...</div>`;
            document.getElementById('targetDisplay').innerHTML = `
                <h5 class="fw-bold text-muted opacity-50">No Target Selected</h5>
                <p class="small text-muted">Select a record from the left panel to proceed.</p>
            `;
            document.getElementById('killSwitchArea').classList.remove('active');
            document.getElementById('authPassword').disabled = true;
            document.getElementById('authPassword').value = '';
            checkInput();
        }

        function checkInput() {
            const pwd = document.getElementById('authPassword').value;
            const btn = document.getElementById('btnExecute');
            btn.disabled = !(state.targetId && pwd.length === 6);
        }

        // --- Step 3: Execute ---
        async function executeEradication() {
            if (!confirm(`FINAL WARNING:\n\nYou are about to permanently eradicate ${state.targetModule} [ ${state.targetRef} ] and all linked data.\n\nAre you absolutely sure?`)) return;

            const pwd = document.getElementById('authPassword').value;
            const btn = document.getElementById('btnExecute');
            const originalHtml = btn.innerHTML;

            btn.innerHTML = `<i class="fa-solid fa-skull fa-fade me-2"></i> ERADICATING...`;
            btn.disabled = true;

            try {
                const res = await fetch(API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        action: 'execute_delete', 
                        target_module: state.targetModule, 
                        target_id: state.targetId,
                        auth_token: pwd
                    })
                });
                const data = await res.json();

                if (data.success) {
                    utils.showToast('Protocol Successful', data.message, 'success');
                    resetSelection();
                    document.getElementById('searchInput').value = '';
                } else {
                    utils.showToast('Eradication Failed', data.error, 'error');
                }
            } catch (e) {
                utils.showToast('System Error', 'Failed to communicate with eradication engine.', 'error');
            } finally {
                btn.innerHTML = originalHtml;
                checkInput();
            }
        }

        // --- Ledger Functions ---
        async function fetchLedger() {
            const tbody = document.getElementById('ledgerBody');
            tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-muted"><i class="fa-solid fa-circle-notch fa-spin me-2"></i> Accessing Vault...</td></tr>`;
            
            try {
                const res = await fetch(`${API_URL}?action=fetch_logs&page=${state.ledgerPage}`);
                const data = await res.json();

                if (data.success) {
                    if (data.logs.length === 0) {
                        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-muted fw-bold">Vault is currently empty.</td></tr>`;
                        return;
                    }

                    tbody.innerHTML = data.logs.map(log => `
                        <tr>
                            <td class="ps-4 fw-bold text-muted">${utils.formatDate(log.deleted_at)}</td>
                            <td><span class="badge bg-dark">${log.module_name}</span></td>
                            <td class="font-mono fw-bold text-danger">${log.primary_reference}</td>
                            <td class="small fw-bold">${log.deleted_by_email}</td>
                            <td class="text-end pe-4 font-mono text-muted">VLT-${String(log.vault_id).padStart(5, '0')}</td>
                        </tr>
                    `).join('');
                }
            } catch (e) {
                tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-danger fw-bold">Failed to load ledger data.</td></tr>`;
            }
        }

        function changePage(direction) {
            const newPage = state.ledgerPage + direction;
            if (newPage < 1) return;
            state.ledgerPage = newPage;
            document.getElementById('pageIndicator').innerText = `Page ${state.ledgerPage}`;
            fetchLedger();
        }

        return { searchRecords, selectRecord, resetSelection, checkInput, executeEradication, fetchLedger, changePage };

    })();
</script>
</body>
</html>