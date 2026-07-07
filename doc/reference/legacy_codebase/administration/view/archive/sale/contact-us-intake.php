<?php
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['SALES']);

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
$fullName  = $me['full_name'] ?: 'Sales';
$firstName = trim(explode(' ', $fullName)[0] ?? 'Sales');

$roleLabelMap = [
  'ADMIN'      => 'SYSTEM ADMIN',
  'FINANCE'    => 'FINANCE',
  'SALES'      => 'SALES',
  'OPERATIONS' => 'OPERATIONS',
  'MANAGEMENT' => 'MANAGEMENT',
];
$role = strtoupper((string)($me['role'] ?? 'SALES'));
$roleLabel = $roleLabelMap[$role] ?? 'SALES';

// --- Avatar: UI Avatars based on name (no local image storage needed yet) ---
$avatarName = urlencode($fullName);
$avatarUrl  = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";

function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Contact Us Intake | Smart LS</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">

  <style>
    /* Keep only module-specific helpers here; shell styles come from ../../css/admin.css */
    :root{
      --smart-blue: #1F99D8;
      --smart-dark: #055B83;
      --smart-orange: #EE7D04;
      --smart-charcoal: #231F20;
      --smart-bg: #F0F4F8;
    }

    /* Ensure module controls keep the same polish even under admin.css */
    .card-custom {
      background: white;
      border: 1px solid rgba(0,0,0,0.05);
      border-radius: 12px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.03);
    }

    .kpi-card { border-left: 4px solid transparent; }
    .kpi-card.blue { border-left-color: var(--smart-blue); background: linear-gradient(145deg, #ffffff, #f0f9ff); }
    .kpi-card.dark { border-left-color: var(--smart-charcoal); background: linear-gradient(145deg, #ffffff, #f3f3f3); }
    .kpi-card.orange { border-left-color: var(--smart-orange); background: linear-gradient(145deg, #ffffff, #fff5eb); }
    .kpi-card.teal { border-left-color: #20c997; background: linear-gradient(145deg, #ffffff, #e6fff7); }

    .kpi-icon { width: 45px; height: 45px; display:flex; align-items:center; justify-content:center; border-radius: 10px; font-size: 1.2rem; }
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
    .table-custom td { vertical-align: middle; padding: 1rem; border-bottom: 1px solid #eee; font-size: 0.9rem; }

    .access-gate {
      background: #fff3cd; border: 1px solid #ffeeba; color: #856404; border-radius: 12px; padding: 2rem; text-align: center;
    }

    .btn-smart-primary { background-color: var(--smart-blue); color: white; border: none; }
    .btn-smart-primary:hover { background-color: var(--smart-dark); color: white; }
  </style>
</head>

<body>

  <!-- SIDEBAR (from index.php) -->
  <nav class="sidebar">
    <div class="sidebar-header">
        <a href="index" class="brand-logo"><i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span></a>
    </div>

    <div class="px-3 mb-2 mt-2">
        <a href="index" class="btn btn-primary w-100 text-start d-flex align-items-center" style="background-color: transparent; color: inherit; border: none; padding-left: 0;">
            <i class="fa-solid fa-house category-icon me-2"></i> 
            <span class="fw-bold">Sales Dashboard GM</span> 
        </a>
    </div>

    <div class="sidebar-menu accordion" id="salesMenu">
        
        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#sales1">
                <span><i class="fa-solid fa-database category-icon"></i> 1. MASTER DATA MGMT</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="sales1" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                <div class="sub-menu">
                    <a href="client-master-registry.php" class="sub-link">Client Master Registry</a>
                    <a href="financial-dictionary.php" class="sub-link">Financial Dictionary</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#sales2">
                <span><i class="fa-solid fa-users category-icon"></i> 2. CRM & ACQUISITION</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="sales2" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                <div class="sub-menu">
                    <a href="contact-us-intake.php" class="sub-link">Contact Us Intake</a>
                    <a href="partnership-portal-intake.php" class="sub-link">Partnership Portal Intake</a>
                    <a href="market-campaign-registration.php" class="sub-link">Marketing Campaign Register</a>
                    <a href="smart-quote-intake.php" class="sub-link">Smart Quote Intake</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#sales3">
                <span><i class="fa-solid fa-filter category-icon"></i> 3. SALES FUNNEL</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="sales3" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                <div class="sub-menu">
                    <a href="sales-pipelining.php" class="sub-link">Sales Pipeline</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#sales4">
                <span><i class="fa-solid fa-calculator category-icon"></i> 4. COMMERCIAL & PRICING</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="sales4" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                <div class="sub-menu">
                    <a href="margin-simulator-billing.php" class="sub-link">Margin Simulator & Pricing System</a>
                    <a href="extra-charges-simulator.php" class="sub-link">Extra Charges Simulator</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#sales5">
                <span><i class="fa-solid fa-truck-fast category-icon"></i> 5. LOGISTICS OPERATIONS</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="sales5" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                <div class="sub-menu">
                    <a href="operations-registry.php" class="sub-link">Operations File Registry</a>
                    <a href="operational-milestone-tracking.php" class="sub-link">Operational Milestone Tracking</a>
                    <a href="delivery-note.php" class="sub-link">Delivery Note</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#sales6">
                <span><i class="fa-solid fa-building-columns category-icon"></i> 6. FINANCE & TREASURY</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="sales6" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                <div class="sub-menu">
                    <a href="cash-request.php" class="sub-link">Cash Request</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#sales7">
                <span><i class="fa-solid fa-box-archive category-icon"></i> 7. COMPANY ARCHIVES</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="sales7" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                <div class="sub-menu">
                    <a href="documents-vault.php" class="sub-link">Documents Vault</a>
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
      <small class="text-muted" style="font-size: 0.7rem;">CONTACT ENQUIRIES</small>
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

  <!-- MAIN CONTENT (original Contact Us Intake module kept) -->
  <main class="main-content px-4 pb-5">

    <div id="accessGate" class="d-none mt-4">
      <div class="access-gate shadow-sm">
        <i class="fa-solid fa-lock fs-1 mb-3"></i>
        <h4 class="fw-bold" style="font-family: 'Montserrat', sans-serif;">Access Restricted</h4>
        <p class="mb-0">This module is restricted for your current role.</p>
      </div>
    </div>

    <div id="moduleShell" class="py-4">

      <div class="d-flex justify-content-between align-items-end mb-4">
        <div>
          <h2 class="fw-bold mb-1 text-dark" style="font-family: 'Montserrat', sans-serif;">Contact Us Intake</h2>
          <p class="text-muted small mb-0">Captures unstructured enquiries (Non-Quotation Based).</p>
        </div>
        <div class="d-flex gap-2">
          <button onclick="exportToCSV()" class="btn btn-white border fw-bold shadow-sm text-success">
            <i class="fa-solid fa-file-excel me-2"></i>Export Report
          </button>
        </div>
      </div>

      <div class="row g-3 mb-4">
        <div class="col-md-3">
          <div class="card-custom kpi-card dark p-3 d-flex align-items-center h-100">
            <div class="me-3 kpi-icon bg-dark text-white"><i class="fa-solid fa-comments"></i></div>
            <div><div class="kpi-title">Total Messages</div><div class="kpi-value" id="kpiTotal">-</div></div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card-custom kpi-card orange p-3 d-flex align-items-center h-100">
            <div class="me-3 kpi-icon bg-warning text-dark"><i class="fa-solid fa-envelope"></i></div>
            <div><div class="kpi-title">New (Unread)</div><div class="kpi-value text-warning" id="kpiNew">-</div></div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card-custom kpi-card blue p-3 d-flex align-items-center h-100">
            <div class="me-3 kpi-icon bg-primary text-white"><i class="fa-solid fa-reply"></i></div>
            <div><div class="kpi-title">Responded</div><div class="kpi-value text-primary" id="kpiResponded">-</div></div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card-custom kpi-card teal p-3 d-flex align-items-center h-100">
            <div class="me-3 kpi-icon bg-success text-white"><i class="fa-solid fa-check-double"></i></div>
            <div><div class="kpi-title">Closed</div><div class="kpi-value text-success" id="kpiClosed">-</div></div>
          </div>
        </div>
      </div>

      <div class="card-custom p-4 mb-4">
        <div class="row g-2 align-items-end">
          <div class="col-md-5">
            <label class="small fw-bold text-muted mb-1 text-uppercase">Search</label>
            <div class="input-group">
              <span class="input-group-text bg-white border-end-0"><i class="fa-solid fa-search text-muted"></i></span>
              <input id="qSearch" onkeyup="renderTable()" type="text" class="form-control smart-input border-start-0 ps-0" placeholder="Name, Email, Company or ID...">
            </div>
          </div>
          <div class="col-md-3">
            <label class="small fw-bold text-muted mb-1 text-uppercase">Type</label>
            <select id="qType" onchange="renderTable()" class="form-select smart-input">
              <option value="">All Types</option>
              <option value="GENERAL_ENQUIRY">GENERAL_ENQUIRY</option>
              <option value="PARTNERSHIP">PARTNERSHIP</option>
              <option value="CAREERS">CAREERS</option>
              <option value="MEDIA">MEDIA</option>
            </select>
          </div>
          <div class="col-md-3">
            <label class="small fw-bold text-muted mb-1 text-uppercase">Status</label>
            <select id="qStatus" onchange="renderTable()" class="form-select smart-input">
              <option value="">All Statuses</option>
              <option value="NEW">NEW</option>
              <option value="READ">READ</option>
              <option value="RESPONDED">RESPONDED</option>
              <option value="CLOSED">CLOSED</option>
            </select>
          </div>
          <div class="col-md-1">
            <button onclick="resetFilters()" class="btn btn-light border fw-bold w-100 smart-input text-dark"><i class="fa-solid fa-rotate-left"></i></button>
          </div>
        </div>
      </div>

      <div class="card-custom overflow-hidden p-0 border-0 shadow-sm">
        <div class="table-responsive">
          <table class="table table-hover table-custom mb-0">
            <thead>
              <tr>
                <th class="ps-4">Enquiry ID</th>
                <th>Contact Info</th>
                <th>Type</th>
                <th>Message Preview</th>
                <th>Date</th>
                <th>Status</th>
                <th class="text-end pe-4">Action</th>
              </tr>
            </thead>
            <tbody id="tableBody"></tbody>
          </table>
        </div>
      </div>

    </div>
  </main>

  <div class="offcanvas offcanvas-end" tabindex="-1" id="enquiryDrawer" style="width: 700px;">
    <div class="offcanvas-header border-bottom bg-light py-3">
      <div>
        <h5 class="offcanvas-title fw-bold" style="font-family:'Montserrat',sans-serif;" id="drawerTitle">Enquiry Details</h5>
        <small class="text-muted font-monospace" id="drawerId">ID: -</small>
      </div>
      <button type="button" class="btn-close" data-bs-dismiss="offcanvas"></button>
    </div>

    <div class="offcanvas-body p-0 bg-white">

      <div class="p-4 bg-primary bg-opacity-10 border-bottom border-primary border-opacity-25">
        <div class="d-flex justify-content-between">
          <div>
            <h4 class="fw-bold text-dark mb-0" id="dName">John Doe</h4>
            <p class="text-muted fw-bold mb-2" id="dCompany">ABC Corp</p>
            <div class="d-flex gap-3 text-sm">
              <span class="badge bg-white text-dark border"><i class="fa-solid fa-envelope me-1 text-muted"></i> <span id="dEmail">email@test.com</span></span>
              <span class="badge bg-white text-dark border"><i class="fa-solid fa-phone me-1 text-muted"></i> <span id="dPhone">+123456789</span></span>
            </div>
          </div>
          <div class="text-end">
            <label class="small text-muted fw-bold text-uppercase">Submission Date</label>
            <div class="fw-bold text-dark" id="dDate">Oct 24, 2025</div>
            <div class="small text-muted" id="dTime">14:30</div>
          </div>
        </div>
      </div>

      <form id="enquiryForm" class="p-4">
        <div class="mb-4">
          <label class="small fw-bold text-muted text-uppercase mb-2">Message Content</label>
          <div class="p-3 bg-light border rounded text-dark" style="min-height: 120px;" id="dMessage">
            Loading message content...
          </div>
        </div>

        <hr class="my-4 opacity-10">

        <div class="row g-3">
          <div class="col-md-6">
            <label class="form-label small fw-bold text-muted text-uppercase">Enquiry Type (Catalog)</label>
            <input type="text" class="form-control smart-input bg-light" id="dType" readonly>
          </div>
          <div class="col-md-6">
            <label class="form-label small fw-bold text-muted text-uppercase">Current Status</label>
            <select id="dStatus" class="form-select smart-input fw-bold">
              <option value="NEW">NEW</option>
              <option value="READ">READ</option>
              <option value="RESPONDED">RESPONDED</option>
              <option value="CLOSED">CLOSED</option>
            </select>
          </div>
          <div class="col-12">
            <label class="form-label small fw-bold text-muted text-uppercase">Internal Notes (Sales Only)</label>
            <textarea class="form-control smart-input" id="dNotes" rows="3" placeholder="Add internal remarks here..."></textarea>
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
  const ENQUIRY_LIST_API   = '../../api/contact_enquiries/list.php';
  const ENQUIRY_READ_API   = '../../api/contact_enquiries/read.php';
  const ENQUIRY_UPDATE_API = '../../api/contact_enquiries/update.php';

  const STATUS_COLORS = {
    'NEW': 'bg-danger bg-opacity-10 text-danger border-danger border-opacity-25',
    'READ': 'bg-warning bg-opacity-10 text-warning-emphasis border-warning border-opacity-25',
    'RESPONDED': 'bg-primary bg-opacity-10 text-primary border-primary border-opacity-25',
    'CLOSED': 'bg-success bg-opacity-10 text-success border-success border-opacity-25'
  };

  let rowsCache = [];
  let currentEnquiryId = null;

  const drawer = new bootstrap.Offcanvas(document.getElementById('enquiryDrawer'));

  function toast(msg) { alert(msg); } // replace with your preferred toast system

  async function apiGet(url){
    const res = await fetch(url, { credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  async function apiPost(url, payload){
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  function getFilters(){
    const q = document.getElementById('qSearch').value.trim();
    const type = document.getElementById('qType').value.trim();
    const status = document.getElementById('qStatus').value.trim();
    return { q, type, status };
  }

  async function loadTable(){
    const { q, type, status } = getFilters();

    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (type) params.set('type', type);
    if (status) params.set('status', status);
    params.set('limit', '300');

    const data = await apiGet(`${ENQUIRY_LIST_API}?${params.toString()}`);
    rowsCache = data.rows || [];

    // KPIs from server (authoritative)
    document.getElementById('kpiTotal').innerText = data.kpis?.total ?? rowsCache.length;
    document.getElementById('kpiNew').innerText = data.kpis?.new ?? 0;
    document.getElementById('kpiResponded').innerText = data.kpis?.responded ?? 0;
    document.getElementById('kpiClosed').innerText = data.kpis?.closed ?? 0;

    renderTableBody(rowsCache);
  }

  function renderTableBody(rows){
    const tbody = document.getElementById('tableBody');

    if (!rows || rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center p-5 text-muted fw-bold">No enquiries found matching filters.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(e => {
      const idShort = String(e.enquiry_id || '').substring(0, 8) + '...';
      const company = e.company_name ? escapeHtml(e.company_name) : '<em class="text-light-emphasis">Individual</em>';
      const typeLabel = escapeHtml(String(e.enquiry_type || '').replaceAll('_',' '));
      const msg = escapeHtml(String(e.message || ''));
      const status = String(e.status || 'NEW').toUpperCase();
      const dateStr = e.submission_datetime ? new Date(e.submission_datetime).toLocaleDateString() : '';

      return `
        <tr>
          <td class="ps-4"><span class="font-monospace small text-muted">${escapeHtml(idShort)}</span></td>
          <td>
            <div class="fw-bold text-dark small">${escapeHtml(e.full_name || '')}</div>
            <div class="small text-muted">${company}</div>
          </td>
          <td><span class="badge bg-light text-dark border fw-normal" style="font-size: 0.75rem;">${typeLabel}</span></td>
          <td style="max-width: 250px;">
            <div class="text-truncate text-muted small" title="${msg}">${msg}</div>
          </td>
          <td class="small text-muted">${escapeHtml(dateStr)}</td>
          <td><span class="badge ${STATUS_COLORS[status] || STATUS_COLORS.NEW} rounded-pill px-3 py-2 fw-bold" style="font-size: 0.7rem;">${escapeHtml(status)}</span></td>
          <td class="text-end pe-4">
            <button onclick="openDrawer('${escapeAttr(e.enquiry_id)}')" class="btn btn-sm btn-outline-dark fw-bold">Manage</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  async function openDrawer(id){
    try {
      const data = await apiGet(`${ENQUIRY_READ_API}?id=${encodeURIComponent(id)}`);
      const e = data.row;

      currentEnquiryId = e.enquiry_id;

      document.getElementById('drawerId').innerText = `ID: ${e.enquiry_id}`;
      document.getElementById('dName').innerText = e.full_name || '';
      document.getElementById('dCompany').innerText = e.company_name || 'Individual';
      document.getElementById('dEmail').innerText = e.email || '';
      document.getElementById('dPhone').innerText = e.phone || '';

      const dateObj = e.submission_datetime ? new Date(e.submission_datetime) : null;
      document.getElementById('dDate').innerText = dateObj ? dateObj.toLocaleDateString() : '';
      document.getElementById('dTime').innerText = dateObj ? dateObj.toLocaleTimeString() : '';

      document.getElementById('dMessage').innerText = e.message || '';
      document.getElementById('dType').value = e.enquiry_type || '';
      document.getElementById('dStatus').value = (e.status || 'NEW').toUpperCase();
      document.getElementById('dNotes').value = e.internal_notes || '';

      // Auto-mark NEW -> READ immediately (persist), matching your old behavior
      if ((e.status || '').toUpperCase() === 'NEW') {
        document.getElementById('dStatus').value = 'READ';
        await apiPost(ENQUIRY_UPDATE_API, {
          enquiry_id: e.enquiry_id,
          status: 'READ',
          internal_notes: e.internal_notes || ''
        });
        await loadTable(); // refresh table badges/KPIs
      }

      drawer.show();
    } catch (err) {
      toast(err.message || 'Failed to open enquiry');
    }
  }

  async function saveStatus(){
    try {
      if (!currentEnquiryId) return toast('No enquiry selected.');

      const status = document.getElementById('dStatus').value;
      const internal_notes = document.getElementById('dNotes').value;

      await apiPost(ENQUIRY_UPDATE_API, {
        enquiry_id: currentEnquiryId,
        status,
        internal_notes
      });

      await loadTable();
      drawer.hide();
      toast('Enquiry updated successfully.');
    } catch (err) {
      toast(err.message || 'Update failed');
    }
  }

  function resetFilters(){
    document.getElementById('qSearch').value = '';
    document.getElementById('qType').value = '';
    document.getElementById('qStatus').value = '';
    loadTable();
  }

  function exportToCSV(){
    // Export what is currently loaded (cache)
    const headers = ['Enquiry ID','Full Name','Company','Email','Phone','Type','Message','Date','Status','Internal Notes'];
    const rows = (rowsCache || []).map(e => [
      e.enquiry_id,
      `"${String(e.full_name || '').replace(/"/g,'""')}"`,
      `"${String(e.company_name || '').replace(/"/g,'""')}"`,
      e.email || '',
      `"${String(e.phone || '').replace(/"/g,'""')}"`,
      e.enquiry_type || '',
      `"${String(e.message || '').replace(/"/g,'""')}"`,
      e.submission_datetime || '',
      e.status || '',
      `"${String(e.internal_notes || '').replace(/"/g,'""')}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Enquiries_Export_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
  }

  function escapeHtml(s){
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    }[c]));
  }
  function escapeAttr(s){
    return String(s ?? '').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  // Initial load + filter hooks
  document.getElementById('qSearch').addEventListener('keyup', () => loadTable());
  document.getElementById('qType').addEventListener('change', () => loadTable());
  document.getElementById('qStatus').addEventListener('change', () => loadTable());

  loadTable();
</script>

</body>
</html>
