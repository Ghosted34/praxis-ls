<?php
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['FINANCE']); // adjust if FINANCE should access

// --- Fetch current admin details from DB (authoritative profile) ---
$employeeId = (string)($_SESSION['auth']['employee_id'] ?? '');
$userId     = (int)($_SESSION['auth']['user_id'] ?? 0);

if ($employeeId === '' || $userId <= 0) {
  header('Location: ../../api/auth/logout.php');
  exit;
}

$conn = db();
$sql = "
  SELECT
    em.employee_id,
    em.full_name,
    em.email,
    em.department,
    em.job_title,
    ua.username,
    ua.role,
    ua.authority_capabilities,
    ua.last_login
  FROM user_auth ua
  JOIN employee_master em ON em.employee_id = ua.employee_id
  WHERE ua.user_id = ? AND em.employee_id = ?
  LIMIT 1
";
$stmt = $conn->prepare($sql);
$stmt->bind_param('is', $userId, $employeeId);
$stmt->execute();
$me = $stmt->get_result()->fetch_assoc();

if (!$me) {
  header('Location: ../../api/auth/logout.php');
  exit;
}

// --- Safe display values ---
$fullName  = $me['full_name'] ?: 'FINANCE';
$firstName = trim(explode(' ', $fullName)[0] ?? 'FINANCE');

$roleLabelMap = [
  'ADMIN'      => 'SYSTEM ADMIN',
  'FINANCE'    => 'FINANCE',
  'SALES'      => 'SALES',
  'OPERATIONS' => 'OPERATIONS',
  'MANAGEMENT' => 'MANAGEMENT',
];
$role = strtoupper((string)($me['role'] ?? 'FINANCE'));
$roleLabel = $roleLabelMap[$role] ?? 'FINANCE';

// --- Avatar ---
$avatarName = urlencode($fullName);
$avatarUrl  = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";

function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Financial Dictionary | Smart LS</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">

  <!-- Page-specific ONLY (no sidebar/topbar/layout redefinitions) -->
  <style>
    .fd-card {
      background: #fff;
      border-radius: 12px;
      border: 1px solid rgba(0,0,0,0.05);
      box-shadow: 0 2px 12px rgba(0,0,0,0.02);
      height: 100%;
    }
    .fd-table th {
      font-size: 0.75rem;
      text-transform: uppercase;
      color: #888;
      font-weight: 700;
      border-bottom: 2px solid #f0f0f0;
      background: #f9fafb;
      padding: 12px 16px;
    }
    .fd-table td { font-size: 0.85rem; vertical-align: middle; padding: 12px 16px; }

    .fd-badge-rev { background:#dcfce7; color:#166534; border:1px solid #bbf7d0; }
    .fd-badge-disb{ background:#f3e8ff; color:#7e22ce; border:1px solid #e9d5ff; }
    .fd-badge-stat{ background:#fee2e2; color:#991b1b; border:1px solid #fecaca; }
    .fd-badge-int { background:#f1f5f9; color:#475569; border:1px solid #e2e8f0; }

    .offcanvas-custom { width: 800px !important; }
    .smart-input { font-size: 0.9rem; padding: 0.6rem; border-radius: 8px; border: 1px solid #e0e0e0; }
    .smart-input:focus { border-color: var(--smart-blue); box-shadow: 0 0 0 3px rgba(31, 153, 216, 0.12); outline: none; }
    .smart-input:disabled { background: #f8fafc; cursor: not-allowed; color: #94a3b8; }

    .hidden { display:none !important; }
  </style>
</head>

<body>

  <!-- EXACT SIDEBAR FROM index.php baseline -->
  <nav class="sidebar">
        <div class="sidebar-header">
            <a href="#" class="brand-logo"><i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span></a>
        </div>
        
        <div class="sidebar-menu accordion" id="financeMenu">
            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu1">
                    <span><i class="fa-solid fa-house category-icon"></i> Home</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu1" class="accordion-collapse collapse " data-bs-parent="#financeMenu">
                    <div class="sub-menu">
                        <a href="index.php" class="sub-link fw-bold ">Dashboards & KPI</a>
                    </div>
                </div>
            </div>
            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu2">
                    <span><i class="fa-solid fa-database category-icon"></i> Master Data</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu2" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                    <div class="sub-menu">
                       <a href="attendance-logs.php" class="sub-link">Attendance Logs</a>
                        <a href="client-master-registry.php" class="sub-link">Client Master</a>
                        <a href="supplier-master-registry.php" class="sub-link">Supplier Master</a>
                        <a href="#" class="sub-link">Employee Master</a>
                        
                        <a href="financial-dictionary.php" class="sub-link">Financial Dictionary</a>
                    </div>
                </div>
            </div>
             <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#fmenu1">
          <span><i class="fa-solid fa-house category-icon"></i> Employee Management</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="fmenu1" class="accordion-collapse collapse " data-bs-parent="#financeMenu">
          <div class="sub-menu">
            <a href="payroll-management.php" class="sub-link ">Payroll Management</a>
          </div>
        </div>
      </div>
            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu3">
                    <span><i class="fa-solid fa-cart-shopping category-icon"></i> Procurement (AP)</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu3" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                    <div class="sub-menu">
                        <a href="purchase-order.php" class="sub-link">Purchase Orders</a>
                        <a href="#" class="sub-link">Expenditure Journal</a>
                        <a href="#" class="sub-link">Cash Request Workflow</a>
                    </div>
                </div>
            </div>
            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu4">
                    <span><i class="fa-solid fa-file-invoice-dollar category-icon"></i> Billing (AR)</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu4" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                    <div class="sub-menu">
                        <a href="#" class="sub-link">Proforma / Advance</a>
                        <a href="#" class="sub-link">Final Invoice Module</a>
                        <a href="#" class="sub-link">Receipts & Allocation</a>
                        <a href="#" class="sub-link">Collections & Reminders</a>
                    </div>
                </div>
            </div>
            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu5">
                    <span><i class="fa-solid fa-chart-line category-icon"></i> Costing & Profit</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu5" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                    <div class="sub-menu">
                        <a href="#" class="sub-link">Costing Module</a>
                        <a href="#" class="sub-link">Actual Margin Tracker</a>
                    </div>
                </div>
            </div>
            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu6">
                    <span><i class="fa-solid fa-triangle-exclamation category-icon"></i> Exposure & Risk</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu6" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                    <div class="sub-menu">
                        <a href="#" class="sub-link">Client Exposure</a>
                        <a href="#" class="sub-link">Ops Cost Coverage</a>
                    </div>
                </div>
            </div>
            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu7">
                    <span><i class="fa-solid fa-folder-tree category-icon"></i> Docs & Outputs</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu7" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                    <div class="sub-menu">
                        <a href="#" class="sub-link">Document Vault</a>
                        <a href="#" class="sub-link">Accounting Exports</a>
                    </div>
                </div>
            </div>
        </div>

        <div class="sidebar-footer">
            <button class="btn btn-outline-danger w-100 btn-sm fw-bold"><i class="fa-solid fa-right-from-bracket me-2"></i> Sign Out</button>
        </div>
    </nav>

  <!-- EXACT TOP NAVBAR FROM index.php baseline -->
  <div class="top-navbar">
    <div>
      <h5 class="mb-0 fw-bold text-dark">Sales & Intake</h5>
      <small class="text-muted" style="font-size: 0.7rem;">PARTNERSHIP PORTAL INTAKE</small>
    </div>

    <div class="d-flex align-items-center gap-4">
      <div class="clock-pill">
        <span id="realtime-clock" style="font-family: monospace;">12:00:00</span>
        <button class="btn-clock" id="btn-clock" onclick="toggleClock()">
          <i class="fa-solid fa-fingerprint"></i> <span>Clock In</span>
        </button>
      </div>

      <div class="d-flex align-items-center gap-3 ps-3 border-start">
        <div class="text-end lh-1 d-none d-md-block">
          <div class="fw-bold fs-6"><?php echo e($fullName); ?></div>
          <small class="text-primary fw-bold" style="font-size: 0.65rem; letter-spacing: 0.5px;">
            <?php echo e($roleLabel); ?>
          </small>
        </div>
        <img src="<?php echo e($avatarUrl); ?>" class="rounded-circle shadow-sm" width="38" height="38" alt="<?php echo e($firstName); ?>">
      </div>
    </div>
  </div>

  <!-- Main content wrapper EXACT like index.php -->
  <div class="main-content px-4 pb-5">

    <!-- Filters + actions -->
    <div class="fd-card p-4 mb-4 mt-4">
      <div class="d-flex flex-wrap justify-content-between align-items-center gap-3">
        <div class="d-flex gap-2 flex-wrap">
          <button onclick="filterNature('ALL')" class="btn btn-dark btn-sm fw-bold rounded-pill px-3 filter-btn active">All Items</button>
          <button onclick="filterNature('CHARGEABLE_SERVICE')" class="btn btn-outline-success btn-sm fw-bold rounded-pill px-3 filter-btn">Revenue</button>
          <button onclick="filterNature('DISBURSEMENT')" class="btn btn-outline-primary btn-sm fw-bold rounded-pill px-3 filter-btn">Disbursements</button>
          <button onclick="filterNature('STATUTORY_PAYMENT')" class="btn btn-outline-danger btn-sm fw-bold rounded-pill px-3 filter-btn">Statutory</button>
        </div>

        <div class="d-flex gap-3">
          <div class="input-group input-group-sm w-auto">
            <span class="input-group-text bg-white"><i class="fa-solid fa-magnifying-glass text-muted"></i></span>
            <input type="text" id="search-input" onkeyup="debouncedSearch()" class="form-control" placeholder="Search code or name..." style="width: 250px;">
          </div>
          <button onclick="openDrawer()" class="btn btn-dark btn-sm fw-bold shadow-sm d-flex align-items-center gap-2">
            <i class="fa-solid fa-plus"></i> New Line Item
          </button>
        </div>
      </div>
    </div>

    <!-- Table -->
    <div class="fd-card">
      <div class="table-responsive">
        <table class="table table-hover fd-table align-middle mb-0">
          <thead>
            <tr>
              <th class="ps-4">Code</th>
              <th>Name (EN / FR)</th>
              <th>Category</th>
              <th>Cost Nature</th>
              <th>Receipt Req.</th>
              <th>VAT Rule</th>
              <th class="text-end pe-4">Action</th>
            </tr>
          </thead>
          <tbody id="dict-table-body"></tbody>
        </table>
      </div>
    </div>

  </div>

  <!-- Drawer -->
  <div class="offcanvas offcanvas-end offcanvas-custom" tabindex="-1" id="dictDrawer">
    <div class="offcanvas-header border-bottom bg-light">
      <div>
        <h5 class="offcanvas-title fw-bold font-heading">Financial Line Item</h5>
        <small class="text-muted">Single Source of Truth (ISO 9001 Compliant)</small>
      </div>
      <button type="button" class="btn-close" data-bs-dismiss="offcanvas"></button>
    </div>

    <div class="offcanvas-body p-4 bg-light bg-opacity-25">
      <!-- keep your existing form content as-is -->
      <form id="dict-form" onsubmit="event.preventDefault(); saveItem();">

        <!-- 1. Identification -->
        <div class="p-3 bg-white border rounded mb-4">
          <h6 class="text-primary small fw-bold text-uppercase border-bottom pb-2 mb-3">1. Identification</h6>
          <div class="row g-3">
            <div class="col-3">
              <label class="smart-form-label">Code (Auto)</label>
              <input type="text" class="form-control smart-input bg-light font-monospace text-muted" value="#-NEW" disabled>
            </div>
            <div class="col-9">
              <label class="smart-form-label">Status</label>
              <select class="form-select smart-input">
                <option value="ACTIVE">Active</option>
                <option value="DEPRECATED">Deprecated</option>
              </select>
            </div>
            <div class="col-6">
              <label class="smart-form-label">English Name <span class="text-danger">*</span></label>
              <input type="text" id="inp-name-en" class="form-control smart-input" placeholder="e.g. Customs Inspection" required>
            </div>
            <div class="col-6">
              <label class="smart-form-label">French Name <span class="text-danger">*</span></label>
              <input type="text" id="inp-name-fr" class="form-control smart-input" placeholder="e.g. Inspection Douanière" required>
            </div>
          </div>
        </div>

        <!-- 2. Categorization -->
        <div class="p-3 bg-white border rounded mb-4">
          <h6 class="text-dark small fw-bold text-uppercase border-bottom pb-2 mb-3">2. Categorization</h6>
          <div class="row g-3">
            <div class="col-6">
              <label class="smart-form-label">Category <span class="text-danger">*</span></label>
              <select id="inp-category" onchange="updateSubCat()" class="form-select smart-input">
                <option value="">Select...</option>
                <option value="CARRIER_CHARGES">Carrier Charges</option>
                <option value="PORT_TERMINAL_CHARGES">Port & Terminal</option>
                <option value="CUSTOMS_REGULATORY">Customs & Regulatory</option>
                <option value="LOGISTICS_HANDLING">Logistics Handling</option>
                <option value="INLAND_TRANSPORT">Inland Transport</option>
                <option value="ADMIN_OVERHEADS">Admin Overheads</option>
              </select>
            </div>
            <div class="col-6">
              <label class="smart-form-label">Sub-Category</label>
              <select id="inp-subcategory" class="form-select smart-input">
                <option value="">Select Category First</option>
              </select>
            </div>
          </div>

          <div class="mt-3">
            <label class="smart-form-label mb-2">Applicability</label>
            <div class="bg-light p-2 rounded border d-flex flex-wrap gap-3 small">
              <div class="form-check"><input class="form-check-input" type="checkbox"><label class="form-check-label">Sea Import</label></div>
              <div class="form-check"><input class="form-check-input" type="checkbox"><label class="form-check-label">Sea Export</label></div>
              <div class="form-check"><input class="form-check-input" type="checkbox"><label class="form-check-label">Air Import</label></div>
              <div class="form-check"><input class="form-check-input" type="checkbox"><label class="form-check-label">Air Export</label></div>
              <div class="form-check"><input class="form-check-input" type="checkbox"><label class="form-check-label">Transit</label></div>
            </div>
          </div>
        </div>

        <!-- 3. Financial Logic & Controls -->
        <div class="p-3 bg-warning bg-opacity-10 border border-warning border-opacity-25 rounded mb-4">
          <h6 class="text-warning text-uppercase fw-bold small mb-3">3. Financial Logic & Controls</h6>
          <div class="row g-3">
            <div class="col-6">
              <label class="smart-form-label">Cost Nature <span class="text-danger">*</span></label>
              <select id="inp-nature" onchange="runLogic()" class="form-select smart-input">
                <option value="CHARGEABLE_SERVICE">Revenue (Service)</option>
                <option value="DISBURSEMENT">Disbursement (Pass-Thru)</option>
                <option value="STATUTORY_PAYMENT">Statutory (Tax/Duty)</option>
                <option value="INTERNAL_COST">Internal Cost</option>
              </select>
            </div>
            <div class="col-6">
              <label class="smart-form-label">Service Territory</label>
              <select id="inp-territory" onchange="runLogic()" class="form-select smart-input">
                <option value="DOMESTIC_INLAND">Domestic</option>
                <option value="PORT_AIRPORT_ZONE">Port / Airport Zone</option>
                <option value="INTERNATIONAL_IMPORT">International</option>
                <option value="TRANSIT_HINTERLAND">Transit / Hinterland</option>
              </select>
            </div>
            <div class="col-12">
              <label class="smart-form-label">VAT Treatment (System Locked)</label>
              <select id="inp-vat" disabled class="form-select smart-input bg-white text-muted">
                <option value="VAT_APPLICABLE_STANDARD">VAT_APPLICABLE_STANDARD</option>
                <option value="VAT_EXEMPT_STATUTORY">VAT_EXEMPT_STATUTORY</option>
                <option value="VAT_OUT_OF_SCOPE_TRANSIT">VAT_OUT_OF_SCOPE_TRANSIT</option>
              </select>
            </div>
            <div class="col-12 d-flex gap-4">
              <div class="form-check form-switch">
                <input class="form-check-input" type="checkbox" id="inp-negotiable">
                <label class="form-check-label small fw-bold" for="inp-negotiable">Negotiable?</label>
              </div>
              <div class="form-check form-switch">
                <input class="form-check-input" type="checkbox" id="inp-billable" checked>
                <label class="form-check-label small fw-bold" for="inp-billable">Billable?</label>
              </div>
            </div>
          </div>
        </div>

        <!-- 4. Audit Requirements -->
        <div class="p-3 bg-white border rounded">
          <h6 class="text-dark small fw-bold text-uppercase border-bottom pb-2 mb-3">4. Audit Requirements</h6>
          <div class="row g-3">
            <div class="col-4">
              <label class="smart-form-label">Receipt Req.</label>
              <select id="inp-receipt" onchange="runLogic()" class="form-select smart-input">
                <option value="ALWAYS_REQUIRED">Always Required</option>
                <option value="CONDITIONALLY_REQUIRED">Conditional</option>
                <option value="NOT_APPLICABLE">N/A</option>
              </select>
            </div>
            <div class="col-8">
              <label class="smart-form-label">Valid Source</label>
              <select id="inp-source" class="form-select smart-input">
                <option value="GOVERNMENT_AUTHORITY">Government Authority</option>
                <option value="CARRIER_AIRLINE">Carrier / Airline</option>
                <option value="PORT_TERMINAL">Port / Terminal</option>
                <option value="THIRD_PARTY_VENDOR">Vendor</option>
              </select>
            </div>
            <div class="col-12">
              <div class="form-check">
                <input class="form-check-input bg-danger border-danger" type="checkbox" id="inp-justification" disabled>
                <label class="form-check-label small text-danger fw-bold" for="inp-justification">Justification Mandatory (System Flag)</label>
              </div>
            </div>
          </div>
        </div>

      </form>
    </div>

    <div class="p-4 border-top bg-white d-flex justify-content-end gap-2">
      <button type="button" class="btn btn-light text-muted fw-bold" data-bs-dismiss="offcanvas">Cancel</button>
      <button type="button" onclick="saveItem()" class="btn btn-dark fw-bold px-4">Save Item</button>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
<script src="../../js/admin.js"></script>

<script>
  /* ============================================================
     Guards / Globals
  ============================================================ */
  // Keep guard to prevent errors if admin.js already defines toggleClock()
  if (typeof toggleClock !== 'function') {
    function toggleClock(){ /* noop */ }
  }

  // Server role (authoritative)
  const CURRENT_USER_ROLE = <?php echo json_encode($role); ?>;

  // APIs
  const FD_LIST_API = '../../api/financial_dictionary/list.php';
  const FD_SAVE_API = '../../api/financial_dictionary/save.php';

  // State
  let items = [];
  let activeFilter = 'ALL';
  let dictDrawer = null;
  let editId = 0; // 0=create, >0=update

  /* ============================================================
     Boot
  ============================================================ */
  document.addEventListener('DOMContentLoaded', async () => {
    dictDrawer = bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('dictDrawer'));

    // Bind search (DB-backed)
    const searchEl = document.getElementById('search-input');
    if (searchEl) searchEl.addEventListener('keyup', debouncedSearch);

    // Initial load
    await loadItems();
    renderTable();
  });

  /* ============================================================
     Helpers
  ============================================================ */
  function escapeHtml(s){
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    }[c]));
  }

  function toUpperSnake(label){
    return String(label || '').trim().toUpperCase().replace(/\s+/g,'_');
  }

  function getApplicabilityFromUI(){
    // NOTE: best practice is to set explicit value="" attributes on checkboxes.
    // For now we derive from the label text (your current markup).
    const arr = [];
    document.querySelectorAll('#dict-form .bg-light .form-check-input[type="checkbox"]').forEach(cb => {
      if (!cb.checked) return;
      const label = cb.nextElementSibling?.textContent || '';
      const v = toUpperSnake(label);
      if (v) arr.push(v);
    });
    // unique
    return [...new Set(arr)];
  }

  function applyApplicabilityToUI(values){
    const set = new Set((values || []).map(v => String(v).toUpperCase()));
    document.querySelectorAll('#dict-form .bg-light .form-check-input[type="checkbox"]').forEach(cb => {
      const label = cb.nextElementSibling?.textContent || '';
      const v = toUpperSnake(label);
      cb.checked = set.has(v);
    });
  }

  function setSelectValue(id, value){
    const el = document.getElementById(id);
    if (!el) return;
    el.value = value ?? '';
  }

  /* ============================================================
     Data Load (DB)
  ============================================================ */
  async function loadItems(){
    const q = (document.getElementById('search-input')?.value || '').trim();

    const url = new URL(FD_LIST_API, window.location.href);
    if (q) url.searchParams.set('q', q);
    if (activeFilter && activeFilter !== 'ALL') url.searchParams.set('nature', activeFilter);

    const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
    const data = await res.json();

    if (!data.ok) {
      alert((data.error || 'Failed to load dictionary') + (data.detail ? ("\n\n" + data.detail) : ""));
      items = [];
      return;
    }

    // Expect rows from list.php as:
    // {id, code, name_en, name_fr, category, subcategory, service_applicability, territory,
    //  cost_nature, is_negotiable, is_billable, receipt_required, receipt_source, vat_treatment, status}
    items = Array.isArray(data.rows) ? data.rows : [];
  }

  let _searchT = null;
  function debouncedSearch(){
    clearTimeout(_searchT);
    _searchT = setTimeout(async () => {
      await loadItems();
      renderTable();
    }, 250);
  }

  /* ============================================================
     UI Logic (your existing chemistry)
  ============================================================ */
  function runLogic() {
    const nature = document.getElementById('inp-nature')?.value;
    const territory = document.getElementById('inp-territory')?.value;
    const receipt = document.getElementById('inp-receipt')?.value;

    const elNegotiable = document.getElementById('inp-negotiable');
    const elBillable = document.getElementById('inp-billable');
    const elVat = document.getElementById('inp-vat');
    const elJustification = document.getElementById('inp-justification');
    const elSource = document.getElementById('inp-source');

    if (!elNegotiable || !elBillable || !elVat || !elJustification || !elSource) return;

    // 1. Nature logic
    if (nature === 'DISBURSEMENT' || nature === 'STATUTORY_PAYMENT') {
      elNegotiable.checked = false;
      elNegotiable.disabled = true;
      elBillable.checked = true;
      elBillable.disabled = false;
    } else if (nature === 'INTERNAL_COST') {
      elBillable.checked = false;
      elBillable.disabled = true;
      elNegotiable.disabled = false;
    } else {
      elNegotiable.disabled = false;
      elBillable.disabled = false;
    }

    // 2. VAT logic
    if (territory === 'TRANSIT_HINTERLAND') elVat.value = 'VAT_OUT_OF_SCOPE_TRANSIT';
    else if (nature === 'STATUTORY_PAYMENT') elVat.value = 'VAT_EXEMPT_STATUTORY';
    else elVat.value = 'VAT_APPLICABLE_STANDARD';

    // 3. Receipt logic
    if (receipt === 'NOT_APPLICABLE' && nature !== 'INTERNAL_COST') {
      elJustification.checked = true;
      elSource.disabled = true;
      elSource.value = "";
    } else {
      elJustification.checked = false;
      elSource.disabled = false;
    }
  }

  function updateSubCat() {
    const cat = document.getElementById('inp-category')?.value;
    const sub = document.getElementById('inp-subcategory');
    if (!sub) return;

    sub.innerHTML = '<option value="">Select...</option>';

    let options = [];
    if (cat === 'CUSTOMS_REGULATORY') options = ['Inspection', 'Declaration', 'Duties', 'Penalties'];
    if (cat === 'CARRIER_CHARGES') options = ['Ocean Freight', 'Air Freight', 'Surcharges (BAF/CAF)', 'Demurrage'];
    if (cat === 'PORT_TERMINAL_CHARGES') options = ['THC', 'Storage', 'Weighing', 'Scanning'];

    options.forEach(opt => {
      const el = document.createElement('option');
      el.value = opt.toUpperCase().replace(/\s+/g, '_');
      el.innerText = opt;
      sub.appendChild(el);
    });
  }

  /* ============================================================
     Render Table (DB-backed)
  ============================================================ */
  function renderTable(){
    const tbody = document.getElementById('dict-table-body');
    if (!tbody) return;

    tbody.innerHTML = (items || []).map(i => {
      const nature = i.cost_nature || '';
      let badge = 'badge-rev';
      if (nature === 'DISBURSEMENT') badge = 'badge-disb';
      if (nature === 'STATUTORY_PAYMENT') badge = 'badge-stat';
      if (nature === 'INTERNAL_COST') badge = 'badge-int';

      return `
        <tr>
          <td class="ps-4 font-monospace small fw-bold text-dark">${escapeHtml(i.code)}</td>
          <td>
            <div class="fw-bold text-dark small">${escapeHtml(i.name_en)}</div>
            <div class="small text-muted fst-italic">${escapeHtml(i.name_fr)}</div>
          </td>
          <td class="small text-secondary">${escapeHtml(String(i.category || '').replace(/_/g,' '))}</td>
          <td><span class="badge ${badge} text-uppercase" style="font-size:0.65rem;">${escapeHtml(String(nature).replace(/_/g,' '))}</span></td>
          <td class="small text-muted">${escapeHtml(String(i.receipt_required || '').replace(/_/g,' '))}</td>
          <td class="small font-monospace text-muted">${escapeHtml(i.vat_treatment || '')}</td>
          <td class="text-end pe-4">
            <button onclick="openDrawer(${Number(i.id)})" class="btn btn-sm btn-link text-secondary p-0">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  /* ============================================================
     Filters (DB-backed)
  ============================================================ */
  async function filterNature(nature){
    activeFilter = nature;

    // Button state (keep simple, consistent)
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.classList.remove('btn-dark','active');
      // do not destroy your outline classes; only ensure active one is dark
    });

    // Make clicked one active (works when called from onclick inline with "this" not available)
    // So we re-evaluate by text and known mapping
    document.querySelectorAll('.filter-btn').forEach(btn => {
      const t = (btn.innerText || '').trim().toUpperCase();
      const isActive =
        (nature === 'ALL' && t.includes('ALL')) ||
        (nature === 'CHARGEABLE_SERVICE' && t === 'REVENUE') ||
        (nature === 'DISBURSEMENT' && t.includes('DISBURSE')) ||
        (nature === 'STATUTORY_PAYMENT' && t === 'STATUTORY');

      if (isActive) btn.classList.add('btn-dark','active');
    });

    await loadItems();
    renderTable();
  }

  /* ============================================================
     Drawer: Create / Edit
  ============================================================ */
  function openDrawer(id = 0){
    editId = parseInt(id || 0, 10);

    document.getElementById('dict-form')?.reset();

    if (editId > 0) {
      const row = (items || []).find(x => Number(x.id) === editId);
      if (row) {
        // Names
        document.getElementById('inp-name-en').value = row.name_en || '';
        document.getElementById('inp-name-fr').value = row.name_fr || '';

        // Category/Subcategory
        setSelectValue('inp-category', row.category || '');
        updateSubCat();
        setSelectValue('inp-subcategory', row.subcategory || '');

        // Applicability
        applyApplicabilityToUI(row.service_applicability || []);

        // Financial logic fields
        setSelectValue('inp-nature', row.cost_nature || 'CHARGEABLE_SERVICE');
        setSelectValue('inp-territory', row.territory || 'DOMESTIC_INLAND');
        setSelectValue('inp-receipt', row.receipt_required || 'ALWAYS_REQUIRED');
        setSelectValue('inp-source', row.receipt_source || '');

        // VAT is system locked in UI, but we still set it for view
        setSelectValue('inp-vat', row.vat_treatment || 'VAT_APPLICABLE_STANDARD');

        // switches
        const neg = document.getElementById('inp-negotiable');
        const bill = document.getElementById('inp-billable');
        if (neg) neg.checked = !!row.is_negotiable;
        if (bill) bill.checked = !!row.is_billable;

        const statusSel = document.querySelector('#dict-form select[name="status"], #dict-form #inp-status');
        // If you later add an actual status select with an id, wire it here.

        runLogic();
      }
    } else {
      // New defaults
      applyApplicabilityToUI([]);
      setSelectValue('inp-category', '');
      updateSubCat();
      setSelectValue('inp-subcategory', '');
      setSelectValue('inp-nature', 'CHARGEABLE_SERVICE');
      setSelectValue('inp-territory', 'DOMESTIC_INLAND');
      setSelectValue('inp-receipt', 'ALWAYS_REQUIRED');
      setSelectValue('inp-source', 'GOVERNMENT_AUTHORITY'); // optional default
      runLogic();
    }

    dictDrawer.show();
  }

  /* ============================================================
     Save (Create / Update)
  ============================================================ */
  async function saveItem(){
    const name_en = document.getElementById('inp-name-en')?.value?.trim() || '';
    const name_fr = document.getElementById('inp-name-fr')?.value?.trim() || '';
    const category = document.getElementById('inp-category')?.value || '';
    const subcategory = document.getElementById('inp-subcategory')?.value || '';

    if (!name_en || !name_fr || !category) {
      alert('Please fill required fields: English Name, French Name, Category.');
      return;
    }

    // Ensure chemistry is applied before reading VAT/source flags
    runLogic();

    const payload = {
      id: editId > 0 ? editId : 0,
      name_en,
      name_fr,
      category,
      subcategory,

      service_applicability: getApplicabilityFromUI(),

      territory: document.getElementById('inp-territory')?.value,
      cost_nature: document.getElementById('inp-nature')?.value,

      is_negotiable: document.getElementById('inp-negotiable')?.checked ? 1 : 0,
      is_billable: document.getElementById('inp-billable')?.checked ? 1 : 0,

      receipt_required: document.getElementById('inp-receipt')?.value,
      receipt_source: (document.getElementById('inp-source')?.disabled ? null : (document.getElementById('inp-source')?.value || null)),

      vat_treatment: document.getElementById('inp-vat')?.value,
      status: 'ACTIVE' // if you add status select in UI, bind it here
    };

    try {
      const res = await fetch(FD_SAVE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!data.ok) {
        alert((data.error || 'Save failed') + (data.detail ? ("\n\n" + data.detail) : ""));
        return;
      }

      dictDrawer.hide();
      await loadItems();
      renderTable();

      alert(data.mode === 'updated' ? 'Line item updated successfully.' : 'Line item created successfully.');

      // Reset editId after save
      editId = 0;

    } catch (e) {
      console.error(e);
      alert('Network/server error while saving.');
    }
  }

  /* ============================================================
     Clock
  ============================================================ */
  function updateClock() {
    const now = new Date();
    const el = document.getElementById('realtime-clock');
    if (el) el.innerText = now.toLocaleTimeString();
  }
  setInterval(updateClock, 1000);
  updateClock();

  // Expose functions for inline onclick handlers
  window.filterNature = filterNature;
  window.openDrawer = openDrawer;
  window.saveItem = saveItem;
  window.updateSubCat = updateSubCat;
  window.runLogic = runLogic;
</script>


</body>
</html>
