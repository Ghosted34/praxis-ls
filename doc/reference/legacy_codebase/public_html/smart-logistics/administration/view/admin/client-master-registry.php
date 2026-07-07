<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN']); // keep as-is (you can widen later if needed)

// --- Fetch current user details from DB (authoritative profile) ---
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
$fullName  = $me['full_name'] ?: 'Admin';
$firstName = trim(explode(' ', $fullName)[0] ?? 'Admin');

$roleLabelMap = [
  'ADMIN'      => 'SYSTEM ADMIN',
  'FINANCE'    => 'FINANCE',
  'SALES'      => 'SALES',
  'OPERATIONS' => 'OPERATIONS',
  'MANAGEMENT' => 'MANAGEMENT',
];
$role = strtoupper((string)($me['role'] ?? 'ADMIN'));
$roleLabel = $roleLabelMap[$role] ?? 'ADMIN';

// Avatar
$avatarName = urlencode($fullName);
$avatarUrl  = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";

// Greeting (optional)
$hour = (int)date('H');
$greeting = ($hour < 12) ? 'Good morning' : (($hour < 18) ? 'Good afternoon' : 'Good evening');

function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Client Master | Smart LS</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
</head>

<body>

  <!-- SIDEBAR (same as index.php; links updated + active state set) -->
  <nav class="sidebar">
    <div class="sidebar-header">
      <a href="index.php" class="brand-logo">
        <i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span>
      </a>
    </div>

    <div class="sidebar-menu accordion" id="adminMenu">

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu1">
          <span><i class="fa-solid fa-shield-halved category-icon"></i> System & Governance</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu1" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="index.php" class="sub-link">Dashboard</a>
            <a href="user-role-management.php" class="sub-link">User & Role (IAM)</a>
            
          </div>
        </div>
      </div>

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu2">
          <span><i class="fa-solid fa-users category-icon"></i> Workforce & Org</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu2" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="employee-master.php" class="sub-link">Employee Master</a>
            <a href="attendance-logs.php" class="sub-link">Attendance Logs</a>
            <a href="payroll-management.php" class="sub-link">Payroll Management</a>
          </div>
        </div>
      </div>

      <div class="accordion-item border-0">
        <!-- keep Master Data expanded + show active link -->
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu3" aria-expanded="true">
          <span><i class="fa-solid fa-database category-icon"></i> Master Data</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu3" class="accordion-collapse collapse show" data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="client-master-registry.php" class="sub-link active">Client Master</a>
            <a href="supplier-master-registry.php" class="sub-link">Supplier Master</a>
            <a href="financial-dictionary.php" class="sub-link">Financial Dictionary</a>
          </div>
        </div>
      </div>

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu4">
          <span><i class="fa-solid fa-hand-holding-dollar category-icon"></i> Sales & Intake</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu4" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="smart-quote-intake.php" class="sub-link">Smart Quote Intake</a>
            <a href="contact-us-intake.php" class="sub-link">Contact Us Intake</a>
            <a href="partnership-portal-intake.php" class="sub-link">Partnership Intake</a>
            <a href="market-campaign-registration.php" class="sub-link">Campaign Register</a>
            <a href="sales-pipelining.php" class="sub-link">Sales Pipeline</a>
           
            <a href="extra-charges-simulator.php" class="sub-link">Extra Charges Sim.</a>
          </div>
        </div>
      </div>

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu5">
          <span><i class="fa-solid fa-ship category-icon"></i> Operations Exec</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu5" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="operations-registry.php" class="sub-link">Ops File Registry</a>
            <a href="operational-milestone-tracking.php" class="sub-link">Milestone Tracking</a>
            <a href="transit-order.php" class="sub-link">Transit Orders</a>
            <a href="delivery-note.php" class="sub-link">Delivery / POD</a>
          </div>
        </div>
      </div>

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu6">
          <span><i class="fa-solid fa-file-invoice-dollar category-icon"></i> Finance & Billing</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu6" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="costing-module.php" class="sub-link">Costing Module</a>
            <a href="#" class="sub-link">Proforma / Advance</a>
            <a href="#" class="sub-link">Final Invoice</a>
            <a href="#" class="sub-link">Collections</a>
            <a href="cash-request.php" class="sub-link">Cash Requests</a>
            <a href="#" class="sub-link">Expenditure Journal</a>
            <a href="#" class="sub-link">Cost Exposure</a>
          </div>
        </div>
      </div>

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu7">
          <span><i class="fa-solid fa-chart-pie category-icon"></i> Reports & Docs</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu7" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="documents-vault.php" class="sub-link">Document Vault</a>
            <a href="#" class="sub-link">Dashboards & KPIs</a>
            <a href="#" class="sub-link">Exports (Accounting)</a>
          </div>
        </div>
      </div>

    </div>

    <div class="sidebar-footer">
      <a class="btn btn-outline-danger w-100 btn-sm fw-bold" href="../../api/auth/logout.php">
        <i class="fa-solid fa-right-from-bracket me-2"></i> Sign Out
      </a>
    </div>
  </nav>

  <!-- TOP NAVBAR (same pattern as index.php) -->
  <div class="top-navbar">
    <div>
      <h5 class="mb-0 fw-bold text-dark">Client Master</h5>
      <small class="text-muted" style="font-size: 0.7rem;">MASTER DATA REGISTRY</small>
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

  <!-- MAIN CONTENT -->
  <div class="main-content px-4 pb-5">

    <!-- KPI row (kept as your page content; now uses admin.css card styles) -->
    <!-- KPI row (corrected) -->
<div class="row pt-4 mb-4 g-3">

  <!-- Total Clients -->
  <div class="col-xl-3 col-md-6">
    <div class="card-custom p-4 d-flex align-items-center border-start border-4 border-warning">
      <div class="me-3 bg-warning bg-opacity-10 rounded-circle d-flex align-items-center justify-content-center" style="width: 48px; height: 48px;">
        <i class="fa-solid fa-users text-warning fs-5"></i>
      </div>
      <div>
        <div class="kpi-title">Total Clients</div>
        <div class="kpi-value" id="kpi-total-clients">0</div>
      </div>
    </div>
  </div>

  <!-- Active -->
  <div class="col-xl-3 col-md-6">
    <div class="card-custom p-4 d-flex align-items-center border-start border-4 border-primary">
      <div class="me-3 bg-primary bg-opacity-10 rounded-circle d-flex align-items-center justify-content-center" style="width: 48px; height: 48px;">
        <i class="fa-solid fa-user-check text-primary fs-5"></i>
      </div>
      <div>
        <div class="kpi-title">Active</div>
        <div class="kpi-value" id="kpi-active-clients">0</div>
      </div>
    </div>
  </div>

  <!-- Receivables -->
  <div class="col-xl-3 col-md-6 finance-only">
    <div class="card-custom p-4 d-flex align-items-center border-start border-4 border-success">
      <div class="me-3 bg-success bg-opacity-10 rounded-circle d-flex align-items-center justify-content-center" style="width: 48px; height: 48px;">
        <i class="fa-solid fa-sack-dollar text-success fs-5"></i>
      </div>
      <div>
        <div class="kpi-title">Receivables</div>
        <div class="kpi-value fs-4">
          <span id="kpi-receivables">0</span> <small class="text-muted fs-6">XAF</small>
        </div>
      </div>
    </div>
  </div>

  <!-- Over Limit -->
  <div class="col-xl-3 col-md-6 finance-only">
    <div class="card-custom p-4 d-flex align-items-center border-start border-4 border-danger">
      <div class="me-3 bg-danger bg-opacity-10 rounded-circle d-flex align-items-center justify-content-center" style="width: 48px; height: 48px;">
        <i class="fa-solid fa-ban text-danger fs-5"></i>
      </div>
      <div>
        <div class="kpi-title">Over Limit</div>
        <div class="kpi-value" id="kpi-over-limit">0</div>
      </div>
    </div>
  </div>

</div>


    <!-- Filters -->
    <div class="card-custom p-4 mb-4">
      <div class="d-flex flex-wrap justify-content-between align-items-center gap-3">
        <div class="d-flex gap-2">
          <button onclick="filterType('ALL')" class="btn btn-dark btn-sm fw-bold rounded-pill px-3 filter-btn active">All</button>
          <button onclick="filterType('SHIPPER')" class="btn btn-outline-secondary btn-sm fw-bold rounded-pill px-3 filter-btn">Shippers</button>
          <button onclick="filterType('CONSIGNEE')" class="btn btn-outline-secondary btn-sm fw-bold rounded-pill px-3 filter-btn">Consignees</button>
          <button onclick="filterType('BOTH')" class="btn btn-outline-secondary btn-sm fw-bold rounded-pill px-3 filter-btn">Both</button>
        </div>

        <div class="d-flex gap-3">
          <div class="input-group input-group-sm">
            <span class="input-group-text bg-white"><i class="fa-solid fa-magnifying-glass text-muted"></i></span>
            <input type="text" id="search-input" onkeyup="renderTable()" class="form-control" placeholder="Search clients..." style="width: 250px;">
          </div>
          <button type="button" onclick="openDrawer('new')" id="btn-create"
            class="btn btn-dark btn-sm fw-bold shadow-sm d-flex align-items-center gap-2">
            <i class="fa-solid fa-plus"></i> New Client
            </button>

        </div>
      </div>
    </div>

    <!-- Table -->
    <div class="card-custom">
      <div class="table-responsive">
        <table class="table table-hover table-custom align-middle mb-0">
          <thead>
            <tr>
              <th class="ps-4">Client ID / Name</th>
              <th>Type</th>
              <th>Contact Person</th>
              <th class="text-end finance-only">Outstanding (XAF)</th>
              <th>Status</th>
              <th class="text-end pe-4">Action</th>
            </tr>
          </thead>
          <tbody id="client-table-body"></tbody>
        </table>
      </div>
    </div>

  </div>

  <!-- Drawer -->
  <div class="offcanvas offcanvas-end offcanvas-custom" tabindex="-1" id="clientDrawer">
    <div class="offcanvas-header border-bottom bg-light">
      <div>
        <h5 class="offcanvas-title fw-bold font-heading" id="drawer-title">Client Profile</h5>
        <small class="text-muted">Manage Counterparty Details</small>
      </div>
      <button type="button" class="btn-close" data-bs-dismiss="offcanvas"></button>
    </div>

    <div class="bg-white border-bottom px-3">
      <ul class="nav nav-tabs" id="clientTabs" role="tablist">
        <li class="nav-item">
          <button class="nav-link active" id="identity-tab" data-bs-toggle="tab" data-bs-target="#identity" type="button">Identity</button>
        </li>
        <li class="nav-item">
          <button class="nav-link" id="finance-tab" data-bs-toggle="tab" data-bs-target="#finance" type="button">Finance & Docs</button>
        </li>
      </ul>
    </div>

    <div class="offcanvas-body p-4 tab-content">
      <form id="client-form" enctype="multipart/form-data" onsubmit="event.preventDefault(); saveClient();">

        <div class="tab-pane fade show active" id="identity" role="tabpanel">
          <div class="d-flex justify-content-between align-items-center p-3 bg-light rounded border mb-4">
            <div>
              <div class="text-uppercase small text-muted fw-bold">System ID (Immutable)</div>
              <div class="font-monospace fw-bold" id="inp-system-id">SLAS-CL-NEW</div>
            </div>
            <span class="badge bg-secondary" id="inp-status-badge">NEW</span>
          </div>

          <div class="mb-3">
            <label class="smart-form-label">Legal Entity Name <span class="text-danger">*</span></label>
            <input type="text" id="inp-name" class="form-control smart-input" required>
          </div>

          <div class="row g-3 mb-3">
            <div class="col-6">
              <label class="smart-form-label">Client Type</label>
              <select id="inp-type" class="form-select smart-input">
                <option value="SHIPPER">SHIPPER</option>
                <option value="CONSIGNEE">CONSIGNEE</option>
                <option value="BOTH">BOTH (Shipper & Consignee)</option>
                <option value="BUSINESS_PARTNER">BUSINESS PARTNER</option>
              </select>
            </div>
            <div class="col-6">
              <label class="smart-form-label">Tax ID (NIU) <span class="text-danger">*</span></label>
              <input type="text" id="inp-niu" class="form-control smart-input" required>
            </div>
          </div>

          <div class="row g-3 mb-3">
            <div class="col-6">
              <label class="smart-form-label">RCCM</label>
              <input type="text" id="inp-rccm" class="form-control smart-input">
            </div>
            <div class="col-6">
              <label class="smart-form-label">Country</label>
              <input type="text" id="inp-country" class="form-control smart-input" value="Cameroon">
            </div>
          </div>

          <div class="mb-3">
            <label class="smart-form-label">Business Address <span class="text-danger">*</span></label>
            <textarea id="inp-address" class="form-control smart-input" rows="2" required></textarea>
          </div>

          <h6 class="smart-form-label border-bottom pb-2 mt-4 mb-3">Primary Contact</h6>
          <div class="row g-3">
            <div class="col-6">
              <label class="smart-form-label">Full Name <span class="text-danger">*</span></label>
              <input type="text" id="inp-contact" class="form-control smart-input" required>
            </div>
            <div class="col-6">
              <label class="smart-form-label">Phone <span class="text-danger">*</span></label>
              <input type="tel" id="inp-phone" class="form-control smart-input" required>
            </div>
            <div class="col-12">
              <label class="smart-form-label">Email (Invoicing) <span class="text-danger">*</span></label>
              <input type="email" id="inp-email" class="form-control smart-input" required>
            </div>
          </div>
        </div>

        <div class="tab-pane fade" id="finance" role="tabpanel">
          <div class="finance-only">
            <div class="p-3 bg-warning bg-opacity-10 rounded border border-warning border-opacity-25 mb-4">
              <h6 class="text-warning text-uppercase fw-bold small mb-2">Credit Control</h6>
              <div class="row g-2">
                <div class="col-6">
                  <label class="small text-muted fw-bold">Payment Terms (Days)</label>
                  <input type="number" id="inp-terms" class="form-control form-control-sm border-warning" value="30">
                </div>
                <div class="col-6">
                  <label class="small text-muted fw-bold">Credit Limit (XAF)</label>
                  <input type="number" id="inp-limit" class="form-control form-control-sm border-warning" placeholder="Optional">
                </div>
              </div>
            </div>
          </div>

          <div class="mb-4">
            <label class="smart-form-label mb-2">KYC Documents</label>
            <div class="bg-light p-3 rounded border">
              <div class="row g-2 mb-2">
                <div class="col-6">
                  <select class="form-select form-select-sm">
                    <option>Taxpayer Card (NIU)</option>
                    <option>Business License</option>
                    <option>Contract</option>
                  </select>
                </div>
                <div class="col-6">
                  <select class="form-select form-select-sm" id="doc-type-toggle" onchange="toggleDocInput()">
                    <option value="DIGITAL">Digital Upload</option>
                    <option value="PHYSICAL">Physical Archive</option>
                  </select>
                </div>
              </div>

             <div id="doc-input-digital" class="border border-dashed bg-white p-3 rounded">
                <label class="small text-muted d-block mb-2"><i class="fa-solid fa-cloud-arrow-up"></i> Upload PDF/JPG/PNG</label>
                <input type="file" id="inp-doc-file" name="doc_file" accept=".pdf,.jpg,.jpeg,.png" class="form-control form-control-sm">
                <input type="text" id="inp-doc-category" class="form-control form-control-sm mt-2" placeholder="Document name / description (optional)">
                </div>


              <div id="doc-input-physical" class="hidden">
                <input type="text" class="form-control form-control-sm" placeholder="Archive Reference Number">
              </div>

              <button type="button" class="btn btn-outline-dark btn-sm w-100 mt-2">Add Document</button>
            </div>
          </div>

          <div class="form-check mt-4 border-top pt-3 border-danger">
            <input class="form-check-input" type="checkbox" id="inp-deactivate">
            <label class="form-check-label small fw-bold text-danger" for="inp-deactivate">
              Deactivate Client (Hide from Operations)
            </label>
          </div>
        </div>

      </form>
    </div>

    <div class="p-4 border-top bg-white d-flex justify-content-end gap-2">
      <button type="button" class="btn btn-light text-muted fw-bold" data-bs-dismiss="offcanvas">Cancel</button>
      <button type="button" onclick="saveClient()" class="btn btn-dark fw-bold px-4">Save Changes</button>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

<script>
/* ============================================================
   ROLE (Injected from PHP)
============================================================ */
const CURRENT_USER_ROLE = <?php echo json_encode($role); ?>;

/* ============================================================
   API PATHS
============================================================ */
const CLIENT_LIST_API = '../../api/clients/list.php';     // GET  -> expects { ok:true, rows:[], kpis:{} }
const CLIENT_SAVE_API = '../../api/clients/create.php';   // POST -> expects { success:true, client_id:"..." }

/* ============================================================
   STATE
============================================================ */
let clients = [];
let activeFilter = 'ALL';
let clientDrawer = null;
let isEditMode = false;

/* ============================================================
   INIT
============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  const drawerEl = document.getElementById('clientDrawer');
  if (drawerEl) clientDrawer = new bootstrap.Offcanvas(drawerEl);

  // Role-based UI restrictions
  if (CURRENT_USER_ROLE === 'OPERATIONS') {
    document.getElementById('btn-create')?.classList.add('hidden');
    document.querySelectorAll('.finance-only').forEach(el => el.classList.add('hidden'));
  }

  // Initial load
  loadClients();

  // Search triggers DB reload (debounced)
  const searchEl = document.getElementById('search-input');
  let t = null;
  if (searchEl) {
    searchEl.addEventListener('keyup', () => {
      clearTimeout(t);
      t = setTimeout(() => loadClients(), 250);
    });
  }
});

/* ============================================================
   KPI RENDER
============================================================ */
function renderKpis(k) {
  const totalEl = document.getElementById('kpi-total-clients');
  const activeEl = document.getElementById('kpi-active-clients');
  const recvEl  = document.getElementById('kpi-receivables');
  const overEl  = document.getElementById('kpi-over-limit');

  if (totalEl) totalEl.textContent = Number(k?.total || 0).toLocaleString();
  if (activeEl) activeEl.textContent = Number(k?.active || 0).toLocaleString();

  // Receivables shown compact: 154.2M, etc.
  if (recvEl) recvEl.textContent = formatXafCompact(Number(k?.receivables || 0));

  if (overEl) overEl.textContent = Number(k?.over_limit || 0).toLocaleString();
}

function formatXafCompact(v) {
  const n = Number(v || 0);
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toLocaleString();
}

/* ============================================================
   LOAD CLIENTS FROM DB
============================================================ */
async function loadClients() {
  const q = (document.getElementById('search-input')?.value || '').trim();

  const params = new URLSearchParams();
  if (activeFilter && activeFilter !== 'ALL') params.set('type', activeFilter);
  if (q) params.set('q', q);

  const url = params.toString() ? `${CLIENT_LIST_API}?${params.toString()}` : CLIENT_LIST_API;

  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });

    // Read as text first to prevent JSON parse crash when server returns HTML
    const text = await res.text();

    if (text.trim().startsWith('<')) {
      console.error('Client list API returned HTML instead of JSON. URL:', url);
      console.error(text.slice(0, 500));
      alert('Client list API returned HTML (not JSON). Check console.');
      return;
    }

    const j = JSON.parse(text);

    if (!j.ok) {
      console.error('List API error:', j);
      alert(j.error || 'Failed to load clients');
      return;
    }

    clients = Array.isArray(j.rows) ? j.rows : [];

    // KPIs
    if (j.kpis) renderKpis(j.kpis);

    renderTable();

  } catch (err) {
    console.error(err);
    alert('Network/server error while loading clients.');
  }
}

/* ============================================================
   TABLE RENDER
============================================================ */
function renderTable() {
  const tbody = document.getElementById('client-table-body');
  if (!tbody) return;

  const search = (document.getElementById('search-input')?.value || '').toLowerCase();

  const filtered = clients.filter(c => {
    const name = String(c.name || '');
    const id = String(c.id || '');

    const matchSearch =
      name.toLowerCase().includes(search) ||
      id.toLowerCase().includes(search);

    const matchType =
      activeFilter === 'ALL' || String(c.type || '').toUpperCase() === activeFilter;

    return matchSearch && matchType;
  });

  tbody.innerHTML = filtered.map(c => {
    const type = String(c.type || '').toUpperCase();

    let typeClass = 'tag-partner';
    if (type === 'SHIPPER') typeClass = 'tag-shipper';
    if (type === 'CONSIGNEE') typeClass = 'tag-consignee';
    if (type === 'BOTH') typeClass = 'tag-both';

    const status = String(c.status || '').toUpperCase();
    const statusBadge = status === 'ACTIVE'
      ? `<span class="badge bg-success bg-opacity-10 text-success rounded-pill">ACTIVE</span>`
      : `<span class="badge bg-secondary bg-opacity-10 text-secondary rounded-pill">DEACTIVATED</span>`;

    const actionIcon = (CURRENT_USER_ROLE === 'OPERATIONS') ? 'fa-eye' : 'fa-pen-to-square';

    const receivables = Number(c.receivables || 0);

    return `
      <tr>
        <td class="ps-4">
          <div class="fw-bold">${escapeHtml(c.name)}</div>
          <div class="small text-muted font-monospace">${escapeHtml(c.id)}</div>
        </td>
        <td><span class="tag ${typeClass}">${escapeHtml(type)}</span></td>
        <td class="small">${escapeHtml(c.contact)}</td>
        <td class="text-end finance-only fw-bold">${receivables.toLocaleString()}</td>
        <td>${statusBadge}</td>
        <td class="text-end pe-4">
          <button class="btn btn-sm btn-link text-secondary p-0" onclick="editClient('${escapeJs(c.id)}')">
            <i class="fa-solid ${actionIcon}"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  if (CURRENT_USER_ROLE === 'OPERATIONS' || CURRENT_USER_ROLE === 'SALES') {
    document.querySelectorAll('.finance-only').forEach(el => el.classList.add('hidden'));
  }
}

/* ============================================================
   FILTERS
============================================================ */
function filterType(type, ev) {
  activeFilter = type;

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.remove('btn-dark', 'active');
    btn.classList.add('btn-outline-secondary');
  });

  const e = ev || window.event;
  const target = e?.target || null;

  if (target) {
    target.classList.remove('btn-outline-secondary');
    target.classList.add('btn-dark', 'active');
  }

  // Reload from DB so KPIs match filter
  loadClients();
}

/* ============================================================
   DRAWER HANDLING
============================================================ */
function openDrawer(mode, clientId = null) {
  document.getElementById('client-form')?.reset();

  bootstrap.Tab.getOrCreateInstance(
    document.querySelector('#clientTabs button[data-bs-target="#identity"]')
  ).show();

  if (mode === 'new') {
    isEditMode = false;
    document.getElementById('drawer-title').innerText = 'New Client';
    document.getElementById('inp-system-id').innerText = 'SLAS-CL-AUTO';
    document.getElementById('inp-status-badge').innerText = 'NEW';
    document.getElementById('inp-status-badge').className = 'badge bg-secondary';
    document.getElementById('inp-country').value = 'Cameroon';
    document.getElementById('inp-terms').value = 30;
  } else {
    isEditMode = true;
    const c = clients.find(x => x.id === clientId);
    if (!c) return;

    document.getElementById('drawer-title').innerText = 'Edit Client';
    document.getElementById('inp-system-id').innerText = c.id;

    document.getElementById('inp-name').value = c.name || '';
    document.getElementById('inp-type').value = c.type || 'BOTH';
    document.getElementById('inp-niu').value = c.niu || '';
    document.getElementById('inp-rccm').value = c.rccm || '';
    document.getElementById('inp-address').value = c.address || '';
    document.getElementById('inp-contact').value = c.contact || '';
    document.getElementById('inp-phone').value = c.phone || '';
    document.getElementById('inp-email').value = c.email || '';
    document.getElementById('inp-terms').value = c.terms ?? 30;

    const badge = document.getElementById('inp-status-badge');
    const chk = document.getElementById('inp-deactivate');
    if ((c.status || '').toUpperCase() === 'ACTIVE') {
      badge.innerText = 'ACTIVE';
      badge.className = 'badge bg-success';
      chk.checked = false;
    } else {
      badge.innerText = 'DEACTIVATED';
      badge.className = 'badge bg-danger';
      chk.checked = true;
    }
  }

  clientDrawer?.show();
}

function editClient(id) {
  openDrawer('edit', id);
}

/* ============================================================
   DOCUMENT TOGGLE
============================================================ */
function toggleDocInput() {
  const mode = document.getElementById('doc-type-toggle')?.value || 'DIGITAL';
  document.getElementById('doc-input-digital')?.classList.toggle('hidden', mode !== 'DIGITAL');
  document.getElementById('doc-input-physical')?.classList.toggle('hidden', mode !== 'PHYSICAL');
}

/* ============================================================
   SAVE CLIENT
============================================================ */
async function saveClient() {
  const fd = new FormData();

  fd.append('client_id', document.getElementById('inp-system-id').innerText.trim());
  fd.append('client_name', document.getElementById('inp-name').value.trim());
  fd.append('client_type', document.getElementById('inp-type').value);
  fd.append('niu', document.getElementById('inp-niu').value.trim());
  fd.append('rccm', document.getElementById('inp-rccm').value.trim());
  fd.append('country', document.getElementById('inp-country').value.trim());
  fd.append('address', document.getElementById('inp-address').value.trim());

  fd.append('contact_person', document.getElementById('inp-contact').value.trim());
  fd.append('contact_phone', document.getElementById('inp-phone').value.trim());
  fd.append('contact_email', document.getElementById('inp-email').value.trim());

  fd.append('payment_terms_days', document.getElementById('inp-terms').value);
  fd.append('credit_limit', document.getElementById('inp-limit').value);
  fd.append('status', document.getElementById('inp-deactivate').checked ? 'DEACTIVATED' : 'ACTIVE');

  fd.append('doc_category', document.getElementById('inp-doc-category').value);
  fd.append('doc_storage_mode', document.getElementById('doc-type-toggle').value);

  const fileInput = document.getElementById('inp-doc-file');
  if (fileInput && fileInput.files && fileInput.files.length) {
    fd.append('doc_file', fileInput.files[0]);
  }

  const physicalInput = document.querySelector('#doc-input-physical input');
  if (physicalInput) {
    fd.append('doc_physical_ref', physicalInput.value.trim());
  }

  try {
    const res = await fetch(CLIENT_SAVE_API, { method:'POST', body: fd });

    const text = await res.text();
    if (text.trim().startsWith('<')) {
      console.error('Save API returned HTML instead of JSON.');
      console.error(text.slice(0, 500));
      alert('Save API returned HTML (not JSON). Check console.');
      return;
    }

    const json = JSON.parse(text);

    if (!json.success) {
      alert(json.error || 'Save failed');
      return;
    }

    alert('Client saved: ' + json.client_id);
    clientDrawer?.hide();

    // refresh from DB (table + KPIs)
    loadClients();

  } catch (e) {
    console.error(e);
    alert('Network or server error');
  }
}

/* ============================================================
   SAFE OUTPUT HELPERS
============================================================ */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[c]));
}
function escapeJs(s) {
  return String(s ?? '').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
}

/* ============================================================
   CLOCK (UI)
============================================================ */
function updateClock() {
  document.getElementById('realtime-clock').innerText =
    new Date().toLocaleTimeString();
}
setInterval(updateClock, 1000);
updateClock();
</script>


</body>
</html>
