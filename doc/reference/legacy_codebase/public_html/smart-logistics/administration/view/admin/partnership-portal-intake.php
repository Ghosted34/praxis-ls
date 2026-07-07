<?php
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN']);

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

// --- Avatar: UI Avatars based on name ---
$avatarName = urlencode($fullName);
$avatarUrl = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";

// --- Greeting ---
$hour = (int)date('H');
$greeting = ($hour < 12) ? 'Good morning' : (($hour < 18) ? 'Good afternoon' : 'Good evening');

function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Partnership Intake | Smart LS</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">

  <!-- Keep only module-specific styles (avoid redefining .sidebar/.top-navbar/.main-content) -->
  <style>
    :root{
      --smart-blue: #1F99D8;
      --smart-dark: #055B83;
      --smart-orange: #EE7D04;
      --smart-charcoal: #231F20;
      --smart-bg: #F0F4F8;
    }

    /* Module visuals (safe) */
    .card-custom {
      background: white;
      border: 1px solid rgba(0,0,0,0.05);
      border-radius: 12px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.03);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .card-custom:hover { transform: translateY(-3px); box-shadow: 0 8px 20px rgba(0,0,0,0.06); }

    .kpi-card { position: relative; overflow: hidden; border-left: 4px solid transparent; }
    .kpi-card.purple { border-left-color: #6f42c1; background: linear-gradient(145deg, #ffffff, #f3eaff); }
    .kpi-card.teal { border-left-color: #20c997; background: linear-gradient(145deg, #ffffff, #e6fff7); }
    .kpi-card.blue { border-left-color: var(--smart-blue); background: linear-gradient(145deg, #ffffff, #f0f9ff); }
    .kpi-card.orange { border-left-color: var(--smart-orange); background: linear-gradient(145deg, #ffffff, #fff5eb); }

    .kpi-icon { width: 45px; height: 45px; display: flex; align-items: center; justify-content: center; border-radius: 10px; font-size: 1.2rem; }
    .kpi-title { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: #6c757d; letter-spacing: 0.5px; }
    .kpi-value { font-size: 1.8rem; font-weight: 800; color: var(--smart-charcoal); line-height: 1.2; }

    .smart-input { border-radius: 8px; font-size: 0.9rem; padding: 0.6rem 0.8rem; border-color: #dee2e6; background-color: #fcfcfc; }
    .smart-input:focus { border-color: var(--smart-blue); background-color: #fff; box-shadow: 0 0 0 3px rgba(31, 153, 216, 0.15); outline: none; }

    .table-custom thead th {
      background-color: var(--smart-dark);
      color: white;
      font-weight: 600;
      text-transform: uppercase;
      font-size: 0.75rem;
      letter-spacing: 0.5px;
      padding: 1rem;
      border: none;
    }
    .table-custom thead th:first-child { border-top-left-radius: 8px; }
    .table-custom thead th:last-child { border-top-right-radius: 8px; }
    .table-custom tbody tr { transition: background-color 0.2s; }
    .table-custom tbody tr:hover { background-color: #f1f8fc !important; }
    .table-custom td { vertical-align: middle; padding: 1rem; border-bottom: 1px solid #eee; font-size: 0.9rem; }

    .access-gate {
      background: #fff3cd; border: 1px solid #ffeeba; color: #856404; border-radius: 12px; padding: 2rem; text-align: center;
    }

    .network-pill { font-size: 0.7rem; font-weight: 700; padding: 2px 8px; border-radius: 4px; background: #e9ecef; color: #495057; margin-right: 4px; display: inline-block; margin-bottom: 2px; }
  </style>
</head>
<body>

  <!-- SIDEBAR (from index.php) -->
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
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu3">
          <span><i class="fa-solid fa-database category-icon"></i> Master Data</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu3" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="client-master-registry.php" class="sub-link">Client Master</a>
            <a href="supplier-master-registry.php" class="sub-link">Supplier Master</a>
            <a href="financial-dictionary.php" class="sub-link">Financial Dictionary</a>
          </div>
        </div>
      </div>

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu4" aria-expanded="true">
          <span><i class="fa-solid fa-hand-holding-dollar category-icon"></i> Sales & Intake</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu4" class="accordion-collapse collapse show" data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="smart-quote-intake.php" class="sub-link">Smart Quote Intake</a>
            <a href="contact-portal-intake.php" class="sub-link">Contact Us Intake</a>
            <a href="partnership-portal-intake.php" class="sub-link active">Partnership Intake</a>
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

  <!-- TOP NAVBAR (from index.php) -->
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

  <!-- MAIN CONTENT (unchanged content; only wrapper aligned to admin shell) -->
  <div class="main-content px-4 pb-5">

    <div id="accessGate" class="d-none mt-4">
      <div class="access-gate shadow-sm">
        <i class="fa-solid fa-lock fs-1 mb-3"></i>
        <h4 class="fw-bold font-heading">Access Restricted</h4>
        <p class="mb-0">This module is restricted for your current role.</p>
      </div>
    </div>

    <div id="moduleShell" class="py-4">

      <div class="d-flex justify-content-between align-items-end mb-4">
        <div>
          <h2 class="fw-bold font-heading mb-1 text-dark">Partnership Requests</h2>
          <p class="text-muted small mb-0">Review Agency Proposals and Vendor Registrations.</p>
        </div>
        <div class="d-flex gap-2">
          <button onclick="exportToCSV()" class="btn btn-white border fw-bold shadow-sm text-success">
            <i class="fa-solid fa-file-excel me-2"></i>Export CSV
          </button>
        </div>
      </div>

      <div class="row g-3 mb-4">
        <div class="col-md-3">
          <div class="card-custom kpi-card purple p-3 d-flex align-items-center h-100">
            <div class="me-3 kpi-icon" style="background-color: #6f42c1; color: white;"><i class="fa-solid fa-handshake"></i></div>
            <div><div class="kpi-title">Total Proposals</div><div class="kpi-value" id="kpiTotal">-</div></div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card-custom kpi-card blue p-3 d-flex align-items-center h-100">
            <div class="me-3 kpi-icon bg-primary text-white"><i class="fa-solid fa-building"></i></div>
            <div><div class="kpi-title">Agency Partnerships</div><div class="kpi-value text-primary" id="kpiAgency">-</div></div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card-custom kpi-card teal p-3 d-flex align-items-center h-100">
            <div class="me-3 kpi-icon text-white" style="background-color: #20c997;"><i class="fa-solid fa-truck-fast"></i></div>
            <div><div class="kpi-title">Vendor Registration</div><div class="kpi-value" style="color: #20c997;" id="kpiVendor">-</div></div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card-custom kpi-card orange p-3 d-flex align-items-center h-100">
            <div class="me-3 kpi-icon bg-warning text-dark"><i class="fa-solid fa-hourglass-half"></i></div>
            <div><div class="kpi-title">Pending Review</div><div class="kpi-value text-warning" id="kpiPending">-</div></div>
          </div>
        </div>
      </div>

      <div class="card-custom p-4 mb-4">
        <div class="row g-2 align-items-end">
          <div class="col-md-5">
            <label class="small fw-bold text-muted mb-1 text-uppercase">Search</label>
            <div class="input-group">
              <span class="input-group-text bg-white border-end-0"><i class="fa-solid fa-search text-muted"></i></span>
              <input id="qSearch" onkeyup="renderTable()" type="text" class="form-control smart-input border-start-0 ps-0" placeholder="Company, Country, Contact Person...">
            </div>
          </div>
          <div class="col-md-3">
            <label class="small fw-bold text-muted mb-1 text-uppercase">Proposal Type</label>
            <select id="qType" onchange="renderTable()" class="form-select smart-input">
              <option value="">All Types</option>
              <option value="AGENCY_PARTNERSHIP">AGENCY_PARTNERSHIP</option>
              <option value="VENDOR_REGISTRATION">VENDOR_REGISTRATION</option>
            </select>
          </div>
          <div class="col-md-3">
            <label class="small fw-bold text-muted mb-1 text-uppercase">Status</label>
            <select id="qStatus" onchange="renderTable()" class="form-select smart-input">
              <option value="">All Statuses</option>
              <option value="NEW">NEW</option>
              <option value="IN_REVIEW">UNDER REVIEW</option>
              <option value="APPROVED">APPROVED</option>
              <option value="REJECTED">REJECTED</option>
            </select>
          </div>
          <div class="col-md-1">
            <button onclick="resetFilters()" class="btn btn-light border fw-bold w-100 smart-input text-dark">
              <i class="fa-solid fa-rotate-left"></i>
            </button>
          </div>
        </div>
      </div>

      <div class="card-custom overflow-hidden p-0 border-0 shadow-sm">
        <div class="table-responsive">
          <table class="table table-hover table-custom mb-0">
            <thead>
              <tr>
                <th class="ps-4">Company / Origin</th>
                <th>Proposal Type</th>
                <th>Network Memberships</th>
                <th>Contact Person</th>
                <th>Date</th>
                <th>Status</th>
                <th class="text-end pe-4">Action</th>
              </tr>
            </thead>
            <tbody id="tableBody"></tbody>
          </table>
        </div>
      </div>

      <div class="alert alert-light border mt-4 d-flex align-items-start gap-3 shadow-sm">
        <i class="fa-solid fa-circle-info text-primary mt-1"></i>
        <div>
          <h6 class="fw-bold small mb-1 text-dark">Process Control</h6>
          <ul class="mb-0 small text-muted ps-3">
            <li>This module captures intake only. It does <strong>not</strong> auto-create suppliers.</li>
            <li>Approved vendors must be manually onboarded in the Supplier Master Registry.</li>
          </ul>
        </div>
      </div>

    </div>
  </div>

  <!-- DRAWER (unchanged) -->
  <div class="offcanvas offcanvas-end" tabindex="-1" id="partnerDrawer" style="width: 750px;">
    <div class="offcanvas-header border-bottom bg-light py-3">
      <div>
        <h5 class="offcanvas-title font-heading fw-bold" id="drawerTitle">Company Name</h5>
        <small class="text-muted font-monospace" id="drawerId">ID: -</small>
      </div>
      <button type="button" class="btn-close" data-bs-dismiss="offcanvas"></button>
    </div>

    <div class="offcanvas-body p-0 bg-white">

      <div class="p-4 bg-light border-bottom">
        <div class="d-flex align-items-start justify-content-between">
          <div>
            <span class="badge bg-dark text-white mb-2" id="dTypeBadge">TYPE</span>
            <h3 class="fw-black text-dark mb-1" id="dCompany">Company Name</h3>
            <div class="d-flex align-items-center gap-2 text-muted fw-bold small">
              <i class="fa-solid fa-location-dot text-danger"></i> <span id="dCountry">Country</span>
            </div>
          </div>
          <div class="text-end">
            <label class="small fw-bold text-muted text-uppercase">Submission</label>
            <div class="fw-bold" id="dDate">Date</div>
          </div>
        </div>
        <div class="mt-3" id="dNetworks"></div>
      </div>

      <form id="partnerForm" class="p-4">
        <h6 class="text-uppercase small fw-bold text-muted border-bottom pb-2 mb-3">Contact Information</h6>
        <div class="row g-3 mb-4">
          <div class="col-md-6">
            <label class="form-label small fw-bold text-muted">Contact Person</label>
            <input type="text" class="form-control smart-input" id="dPerson" readonly>
          </div>
          <div class="col-md-6">
            <label class="form-label small fw-bold text-muted">Title</label>
            <input type="text" class="form-control smart-input" id="dTitle" readonly>
          </div>
          <div class="col-md-12">
            <label class="form-label small fw-bold text-muted">Email Address</label>
            <div class="input-group">
              <span class="input-group-text bg-light border-end-0"><i class="fa-solid fa-envelope text-muted"></i></span>
              <input type="text" class="form-control smart-input border-start-0 ps-0" id="dEmail" readonly>
            </div>
          </div>
        </div>
        <div id="docSection" class="mb-4">
            <h6 class="text-uppercase small fw-bold text-muted border-bottom pb-2 mb-3">Documentation</h6>
            <div id="docBlock" class="p-3 border rounded bg-light d-flex justify-content-between align-items-center mb-4">
            <div class="d-flex align-items-center gap-3">
                <div class="bg-white p-2 rounded border text-danger"><i class="fa-solid fa-file-pdf fs-4"></i></div>
                <div>
                <div class="fw-bold text-dark small">Corporate_Profile.pdf</div>
                <div class="text-muted small" style="font-size: 0.7rem;">Uploaded by applicant</div>
                </div>
            </div>
            <button type="button" class="btn btn-sm btn-outline-dark fw-bold" onclick="alert('Downloading Mock File...')">
                <i class="fa-solid fa-download"></i> View
            </button>
            </div>
        </div>

        <h6 class="text-uppercase small fw-bold text-muted border-bottom pb-2 mb-3">Admin Actions</h6>
        <div class="row g-3">
          <div class="col-md-6">
            <label class="form-label small fw-bold text-muted">Status</label>
            <select id="dStatus" class="form-select smart-input fw-bold">
              <option value="NEW">NEW</option>
              <option value="IN_REVIEW">UNDER_REVIEW</option>
              <option value="APPROVED">APPROVED</option>
              <option value="REJECTED">REJECTED</option>
            </select>
          </div>
          <div class="col-12">
            <label class="form-label small fw-bold text-muted">Internal Notes</label>
            <textarea class="form-control smart-input" id="dNotes" rows="2" placeholder="Notes regarding due diligence..."></textarea>
          </div>
        </div>
      </form>

      <div class="p-4 border-top sticky-bottom bg-white d-flex justify-content-end gap-2">
        <button type="button" class="btn btn-light fw-bold border" data-bs-dismiss="offcanvas">Close</button>
        <button type="button" class="btn btn-smart-primary fw-bold" onclick="saveStatus()">Save Updates</button>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

  <script>
  // --- API CONFIG ---
  const PR_LIST_API   = '../../api/partnership_requests/list.php';
  const PR_READ_API   = '../../api/partnership_requests/read.php';
  const PR_UPDATE_API = '../../api/partnership_requests/update.php';

  // IMPORTANT:
  // Set this to your actual file-manager download/view path.
  // Example options:
  // 1) '../../file-manager/download.php?file='
  // 2) '../../uploads/partnership_profiles/'
  // Documents are stored here (relative to this admin page location)
const PR_DOC_BASE = '../../upload/partnership/'; 


  const STATUS_COLORS = {
    'NEW': 'bg-primary bg-opacity-10 text-primary border-primary border-opacity-25',
    'IN_REVIEW': 'bg-warning bg-opacity-10 text-warning-emphasis border-warning border-opacity-25',
    'APPROVED': 'bg-success bg-opacity-10 text-success border-success border-opacity-25',
    'REJECTED': 'bg-danger bg-opacity-10 text-danger border-danger border-opacity-25'
  };

  const TYPE_COLORS = {
    'AGENCY_PARTNERSHIP': 'text-primary fw-bold',
    'VENDOR_REGISTRATION': 'text-success fw-bold'
  };

  let requests = [];
  let currentRequestId = null;

  // --- LOAD FROM DB ---
  async function loadRequests() {
    const q = (document.getElementById('qSearch')?.value || '').trim();
    const type = document.getElementById('qType')?.value || '';
    const status = document.getElementById('qStatus')?.value || '';

    const url = new URL(PR_LIST_API, window.location.href);
    if (q) url.searchParams.set('q', q);
    if (type) url.searchParams.set('type', type);
    if (status) url.searchParams.set('status', status);

    const res = await fetch(url.toString(), { credentials: 'same-origin' });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) {}

    if (!res.ok || !data?.ok) {
      alert(`Failed to load partnership requests (HTTP ${res.status}).\n${data?.error || text.substring(0, 300)}`);
      return;
    }

    // KPIs from DB (already computed server-side)
    document.getElementById('kpiTotal').innerText = data.kpis.total;
    document.getElementById('kpiAgency').innerText = data.kpis.agency;
    document.getElementById('kpiVendor').innerText = data.kpis.vendor;
    document.getElementById('kpiPending').innerText = data.kpis.pending;

    requests = data.rows || [];
    renderTable();
  }

  // --- RENDER TABLE ---
  function renderTable() {
    const tbody = document.getElementById('tableBody');
    if (!tbody) return;

    if (!requests.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center p-5 text-muted fw-bold">No proposals found.</td></tr>`;
      return;
    }

    tbody.innerHTML = requests.map(r => {
      const nets = Array.isArray(r.network_memberships) ? r.network_memberships : [];
      const networksHtml = nets.length
        ? nets.map(n => `<span class="network-pill">${escapeHtml(n)}</span>`).join('')
        : '<span class="text-muted small fst-italic">None listed</span>';

      const dateStr = r.submission_datetime ? new Date(r.submission_datetime).toLocaleDateString() : '';

      return `
        <tr>
          <td class="ps-4">
            <div class="fw-bold text-dark">${escapeHtml(r.company_name)}</div>
            <div class="small text-muted"><i class="fa-solid fa-earth-americas me-1"></i> ${escapeHtml(r.country_of_origin)}</div>
          </td>
          <td class="small ${TYPE_COLORS[r.proposal_type] || ''}">${escapeHtml((r.proposal_type || '').replace('_', ' '))}</td>
          <td>${networksHtml}</td>
          <td>
            <div class="small fw-bold text-dark">${escapeHtml(r.contact_person)}</div>
            <div class="small text-muted">${escapeHtml(r.contact_email)}</div>
          </td>
          <td class="small text-muted">${escapeHtml(dateStr)}</td>
          <td>
            <span class="badge ${STATUS_COLORS[r.status] || 'bg-light text-dark border'} rounded-pill px-3 py-2 fw-bold" style="font-size: 0.7rem;">
              ${escapeHtml((r.status || '').replace('_',' '))}
            </span>
          </td>
          <td class="text-end pe-4">
            <button onclick="openDrawer('${escapeHtml(r.partnership_request_id)}')" class="btn btn-sm btn-outline-dark fw-bold">Review</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // --- DRAWER ---
  const drawer = new bootstrap.Offcanvas(document.getElementById('partnerDrawer'));

  async function openDrawer(id) {
    // Read fresh from DB (authoritative)
    const url = new URL(PR_READ_API, window.location.href);
    url.searchParams.set('id', id);

    const res = await fetch(url.toString(), { credentials: 'same-origin' });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) {}

    if (!res.ok || !data?.ok) {
      alert(`Failed to open request (HTTP ${res.status}).\n${data?.error || text.substring(0, 300)}`);
      return;
    }

    const r = data.row;
    currentRequestId = r.partnership_request_id;

    // Header
    document.getElementById('drawerTitle').innerText = r.company_name || 'Request';
    document.getElementById('drawerId').innerText = `ID: ${(r.partnership_request_id || '').substring(0, 8)}...`;
    document.getElementById('dCompany').innerText = r.company_name || '';
    document.getElementById('dCountry').innerText = r.country_of_origin || '';
    document.getElementById('dDate').innerText = r.submission_datetime ? new Date(r.submission_datetime).toLocaleDateString() : '';

    // Type badge
    const badge = document.getElementById('dTypeBadge');
    const typeLabel = (r.proposal_type || '').replace('_', ' ');
    badge.innerText = typeLabel || 'TYPE';
    badge.className = r.proposal_type === 'AGENCY_PARTNERSHIP'
      ? 'badge bg-primary text-white mb-2'
      : 'badge bg-success text-white mb-2';

    // Networks
    const netDiv = document.getElementById('dNetworks');
    const nets = Array.isArray(r.network_memberships) ? r.network_memberships : [];
    netDiv.innerHTML = nets.length
      ? nets.map(n => `<span class="badge bg-secondary me-1">${escapeHtml(n)}</span>`).join('')
      : '<span class="text-muted small">No memberships listed.</span>';

    // Contact
    document.getElementById('dPerson').value = r.contact_person || '';
    document.getElementById('dTitle').value = r.contact_title || '';
    document.getElementById('dEmail').value = r.contact_email || '';

    // Admin fields
    document.getElementById('dStatus').value = r.status || 'NEW';
    document.getElementById('dNotes').value = r.internal_notes || '';

    // Documentation block (use corporate_profile_ref from DB)
    renderDocBlock(r.corporate_profile_ref);

    drawer.show();
  }

  function renderDocBlock(fileRef) {
  const section = document.getElementById('docSection');
  const panel = document.getElementById('docBlock');
  if (!panel) return;

  const hasFile = !!(fileRef && String(fileRef).trim() !== '');

  // Hide entire section if no file
  if (section) section.classList.toggle('d-none', !hasFile);

  if (!hasFile) {
    panel.innerHTML = ''; // keep clean; hidden anyway
    return;
  }

  const safeName = String(fileRef).split('/').pop();

  panel.innerHTML = `
    <div class="d-flex align-items-center gap-3">
      <div class="bg-white p-2 rounded border text-danger"><i class="fa-solid fa-file-pdf fs-4"></i></div>
      <div>
        <div class="fw-bold text-dark small">${escapeHtml(safeName)}</div>
        <div class="text-muted small" style="font-size: 0.7rem;">From uploads/partnership</div>
      </div>
    </div>
    <button type="button" class="btn btn-sm btn-outline-dark fw-bold" onclick="viewDocument('${encodeURIComponent(fileRef)}')">
      <i class="fa-solid fa-eye"></i> View
    </button>
  `;
}




 function viewDocument(encodedFileRef) {
  // corporate_profile_ref might be "file.pdf" or "some/folder/file.pdf"
  const raw = decodeURIComponent(encodedFileRef || '');
  const fileName = String(raw).split('/').pop(); // basename only

  // Open directly from ../../../upload/partnership/
  window.open(PR_DOC_BASE + encodeURIComponent(fileName), '_blank');
}


  // --- UPDATE STATUS/NOTES ---
  async function saveStatus() {
    if (!currentRequestId) return;

    const payload = {
      id: currentRequestId,
      status: document.getElementById('dStatus').value,
      internal_notes: document.getElementById('dNotes').value || ''
    };

    const res = await fetch(PR_UPDATE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    });

    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) {}

    if (!res.ok || !data?.ok) {
      alert(`Update failed (HTTP ${res.status}).\n${data?.error || text.substring(0, 300)}`);
      return;
    }

    drawer.hide();
    await loadRequests(); // refresh KPIs + table
    alert("Proposal updated successfully.");
  }

  // --- EXPORT CSV (from current loaded DB rows) ---
  function exportToCSV() {
    const headers = ['Request ID','Company','Country','Networks','Type','Contact Person','Title','Email','Date','Status','Internal Notes','Document'];

    const rows = requests.map(r => [
      r.partnership_request_id,
      `"${csvEscape(r.company_name)}"`,
      `"${csvEscape(r.country_of_origin)}"`,
      `"${csvEscape((Array.isArray(r.network_memberships) ? r.network_memberships.join('; ') : ''))}"`,
      r.proposal_type,
      `"${csvEscape(r.contact_person)}"`,
      `"${csvEscape(r.contact_title)}"`,
      r.contact_email,
      r.submission_datetime,
      r.status,
      `"${csvEscape(r.internal_notes || '')}"`,
      `"${csvEscape(r.corporate_profile_ref || '')}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Partnership_Export_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
  }

  // --- FILTER RESET ---
  function resetFilters() {
    document.getElementById('qSearch').value = '';
    document.getElementById('qType').value = '';
    document.getElementById('qStatus').value = '';
    loadRequests();
  }

  // --- UTILS ---
  function escapeHtml(s){
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    }[c]));
  }
  function viewDocument(encodedFileRef) {
  const file = decodeURIComponent(encodedFileRef);
  window.open('../../../assets/uploads/' + encodeURIComponent(file), '_blank');
}

  function csvEscape(s){
    return String(s ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ');
  }

  // INIT: load from DB; also hook live filters to DB
  document.addEventListener('DOMContentLoaded', () => {
    // Call loadRequests initially
    loadRequests();

    // Optional: if you want DB filtering as user types
    let t = null;
    document.getElementById('qSearch').addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(loadRequests, 250);
    });

    document.getElementById('qType').addEventListener('change', loadRequests);
    document.getElementById('qStatus').addEventListener('change', loadRequests);
  });
</script>

</body>
</html>


