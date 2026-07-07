<?php
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN']);

// --- Fetch current admin details from DB (authoritative profile) ---
$employeeId = (string)($_SESSION['auth']['employee_id'] ?? '');
$userId     = (int)($_SESSION['auth']['user_id'] ?? 0);

if ($employeeId === '' || $userId <= 0) {
  // session is incomplete; force logout for safety
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

// --- Avatar: UI Avatars based on name (no local image storage needed yet) ---
$avatarName = urlencode($fullName);
$avatarUrl  = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";

// --- Greeting based on server time (simple) ---
$hour = (int)date('H');
$greeting = ($hour < 12) ? 'Good morning' : (($hour < 18) ? 'Good afternoon' : 'Good evening');

function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Costing Module | Smart LS Enterprise</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">

  <style>
    /* --- PHASE 3: PAGINATED PRINT ENGINE --- */
    #print-container {
      background-color: #525659;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
      padding: 20px;
      width: 100%;
    }

    .a4-page {
      background: white;
      width: 210mm;
      height: 296mm; /* Slightly less than 297mm to prevent overflow */
      padding: 10mm 15mm;
      position: relative;
      box-shadow: 0 0 15px rgba(0,0,0,0.5);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* --- HEADER --- */
    .print-header-grid {
      display: grid;
      grid-template-columns: 0.8fr 0.8fr 0.6fr;
      align-items: center;
      border-bottom: 3px solid var(--smart-orange);
      padding-bottom: 6px;
      margin-bottom: 4px;
    }

    .print-header-left { text-align: left; }
    .print-header-center { text-align: left; }
    .print-header-right { text-align: center; }

    .company-name-one-line {
      font-family: 'Montserrat', sans-serif;
      font-weight: 750;
      font-size: 1rem;
      color: var(--smart-charcoal);
      line-height: 1;
      display: block;
      margin-bottom: 2px;
    }

    .company-details { font-size: 0.7rem; line-height: 1.1; color: #444; }
    .doc-title-center { font-size: 2.2rem; line-height: 1; font-weight: 800; }
    .print-logo { height: 60px; width: auto; }

    /* --- CONTENT --- */
    .doc-meta-grid {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 5px;
      margin-bottom: 10px;
      background: #f4f4f4;
      padding: 8px;
      border-radius: 4px;
      border-left: 4px solid var(--smart-blue);
    }

    .meta-item label { font-size: 0.6rem; text-transform: uppercase; color: #666; display: block; }
    .meta-item div { font-size: 0.8rem; font-weight: 800; color: #000; }

    .ssdc-print-box { border: 1px solid #ccc; border-radius: 4px; padding: 8px; margin-bottom: 10px; }
    .ssdc-title { font-size: 0.7rem; font-weight: 800; color: var(--smart-orange); border-bottom: 1px solid #eee; margin-bottom: 4px; }
    .ssdc-data-row { font-size: 0.75rem; }
    .ssdc-label { color: #666; font-weight: 700; }
    .ssdc-val { color: #000; font-weight: 800; }

    /* --- TABLE --- */
    .print-table { width: 100%; border-collapse: collapse; font-size: 0.75rem; margin-bottom: 5px; }
    .print-table th { background: var(--smart-orange); color: white; padding: 4px 6px; text-transform: uppercase; font-weight: 800; font-size: 0.65rem; }
    .print-table td { padding: 4px 6px; border-bottom: 1px solid #eee; }
    .print-table tr:last-child td { border-bottom: 2px solid #000; }

    /* --- TOTALS & SIGNATURES AREA --- */
    .bottom-section { margin-top: 8px; }
    .page-footer-container { margin-top: auto; }

    .totals-grid { display: flex; justify-content: space-between; margin-bottom: 10px; align-items: flex-start; }
    .amount-words-box { width: 60%; background: #f8f9fa; padding: 10px; border-radius: 4px; border: 1px solid #eee; }
    .totals-box { width: 35%; }

    .remarks-box { width: 100%; border: 1px solid #ddd; padding: 10px; border-radius: 4px; font-style: italic; font-size: 0.75rem; margin-bottom: 20px; }

    .signature-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 20px;
      margin-bottom: 10px;
    }

    .sig-box {
      border: 1px solid #ccc;
      height: 100px;
      position: relative;
      padding: 10px;
    }

    .sig-role { font-size: 0.65rem; text-transform: uppercase; color: #888; font-weight: 700; }
    .sig-line { position: absolute; bottom: 15px; left: 15px; right: 15px; border-bottom: 1px dotted #000; }

    /* --- FOOTER --- */
    .page-footer-container {
      border-top: 2px solid var(--smart-orange);
      padding-top: 5px;
      font-size: 0.65rem;
      color: #666;
      display: flex;
      justify-content: space-between;
    }

    /* --- PRINTER SETTINGS (CRITICAL) --- */
    @media print {
      @page { margin: 0; size: A4; }

      body * { visibility: hidden !important; }

      #printModal, #printModal * { visibility: visible !important; }
      #printModal{
        position: fixed;
        inset: 0;
        background: #fff;
        margin: 0 !important;
        padding: 0 !important;
        overflow: visible !important;
      }

      .modal-dialog, .modal-content, .modal-body{
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        width: 100% !important;
        max-width: 100% !important;
      }

      #print-container{
        background: #fff !important;
        padding: 0 !important;
      }

      .a4-page{
        width: 210mm;
        height: 297mm;
        margin: 0;
        box-shadow: none !important;
        page-break-after: always;
        break-after: page;
      }
      .a4-page:last-child{
        page-break-after: auto;
        break-after: auto;
      }

      .modal-header, .modal-footer, .btn, .btn-close{ display: none !important; }
      .print-table th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }

    :root {
      --smart-blue: #1F99D8;
      --smart-dark: #055B83;
      --smart-orange: #EE7D04;
      --smart-charcoal: #231F20;
      --smart-bg: #F0F4F8;
      --sidebar-width: 280px;
    }

    body {
      font-family: 'Manrope', sans-serif;
      background-color: var(--smart-bg);
      color: var(--smart-charcoal);
      overflow-x: hidden;
    }

    h1, h2, h3, h4, h5, h6, .font-heading { font-family: 'Montserrat', sans-serif; }

    /* --- COSTING MODULE WIDGETS (kept) --- */
    .card-custom {
      background: white;
      border-radius: 12px;
      border: 1px solid rgba(0,0,0,0.05);
      box-shadow: 0 2px 12px rgba(0,0,0,0.02);
      height: 100%;
      transition: transform 0.2s;
    }
    .card-custom:hover { transform: translateY(-2px); box-shadow: 0 5px 20px rgba(0,0,0,0.05); }

    .kpi-title { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; color: #888; letter-spacing: 0.5px; }
    .kpi-value { font-size: 1.6rem; font-weight: 800; color: var(--smart-charcoal); line-height: 1.2; font-variant-numeric: tabular-nums; }

    .status-pill { font-size: 0.65rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; padding: 5px 10px; border-radius: 6px; }
    .status-draft { background: #e2e8f0; color: #475569; }
    .status-submitted-val { background: #e0f2fe; color: #0369a1; }
    .status-validated { background: #dcfce7; color: #15803d; }
    .status-submitted-app { background: #ffedd5; color: #c2410c; }
    .status-approved { background: #231F20; color: #fff; border: 1px solid #000; }
    .status-rejected { background: #fee2e2; color: #991b1b; }

    .table-custom th { font-size: 0.75rem; text-transform: uppercase; color: #888; font-weight: 700; border-bottom: 2px solid #f0f0f0; padding: 12px; }
    .table-custom td { font-size: 0.85rem; vertical-align: middle; padding: 12px; }
    .hover-row:hover { background-color: #f8fafc; cursor: pointer; }

    .smart-input { border-radius: 8px; font-size: 0.9rem; padding: 0.6rem 0.8rem; border-color: #dee2e6; }
    .smart-input:focus { border-color: var(--smart-blue); box-shadow: 0 0 0 3px rgba(31, 153, 216, 0.1); }

    .clock-pill { background: #f1f5f9; padding: 6px 12px; border-radius: 30px; display: flex; align-items: center; gap: 10px; font-size: 0.85rem; font-weight: 600; color: var(--smart-dark); }
  </style>
</head>

<body>

  <!-- SIDEBAR (FROM index.php) -->
  <nav class="sidebar">
    <div class="sidebar-header">
      <a href="#" class="brand-logo"><i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span></a>
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
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu4">
          <span><i class="fa-solid fa-hand-holding-dollar category-icon"></i> Sales & Intake</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu4" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="smart-quote-intake.php" class="sub-link">Smart Quote Intake</a>
            <a href="#" class="sub-link">Contact Us Intake</a>
            <a href="#" class="sub-link">Partnership Intake</a>
            <a href="#" class="sub-link">Campaign Register</a>
            <a href="#" class="sub-link">Sales Pipeline</a>
            
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
            <a href="#" class="sub-link">Milestone Tracking</a>
            <a href="transit-order.php" class="sub-link">Transit Orders</a>
            <a href="delivery-note.php" class="sub-link">Delivery / POD</a>
          </div>
        </div>
      </div>

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu6" aria-expanded="true">
          <span><i class="fa-solid fa-file-invoice-dollar category-icon"></i> Finance & Billing</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu6" class="accordion-collapse collapse show" data-bs-parent="#adminMenu">
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

  <!-- TOP NAVBAR (FROM index.php) -->
  <div class="top-navbar">
    <div>
      <h5 class="mb-0 fw-bold text-dark">Costing Module</h5>
      <small class="text-muted" style="font-size: 0.7rem;">FINANCE & BILLING / PRE-QUOTATION ANALYSIS</small>
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

  <!-- MAIN CONTENT (YOUR COSTING MODULE CONTENT KEPT) -->
  <div class="main-content px-4 pb-5">

    <div class="row py-4 align-items-center">
      <div class="col-md-6">
        <h2 class="fw-bold font-heading mb-0">Costing Registry</h2>
        <p class="text-muted mb-0 small">Manage internal cost estimations and validations.</p>
      </div>
      <div class="col-md-6 text-end">
        <button class="btn btn-dark fw-bold px-4 py-2 shadow-sm" onclick="openCostingOffcanvas('new')">
          <i class="fa-solid fa-plus me-2"></i>New Costing
        </button>
      </div>
    </div>

    <div class="row g-3 mb-4">
      <div class="col-md-3">
        <div class="card-custom p-3 d-flex align-items-center">
          <div class="me-3 rounded-3 bg-dark bg-opacity-10 text-dark d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
            <i class="fa-solid fa-file-invoice-dollar"></i>
          </div>
          <div>
            <div class="kpi-title">Costings (MTD)</div>
            <div class="kpi-value">42</div>
            <small class="text-success fw-bold" style="font-size: 0.7rem;"><i class="fa-solid fa-arrow-up"></i> 8 this week</small>
          </div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card-custom p-3 d-flex align-items-center">
          <div class="me-3 rounded-3 bg-primary bg-opacity-10 text-primary d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
            <i class="fa-solid fa-user-check"></i>
          </div>
          <div>
            <div class="kpi-title">Pending Validation</div>
            <div class="kpi-value text-primary">5</div>
            <small class="text-muted" style="font-size: 0.7rem;">Needs Ops Lead</small>
          </div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card-custom p-3 d-flex align-items-center">
          <div class="me-3 rounded-3 bg-warning bg-opacity-10 text-warning d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
            <i class="fa-solid fa-stamp"></i>
          </div>
          <div>
            <div class="kpi-title">Pending Approval</div>
            <div class="kpi-value text-warning">3</div>
            <small class="text-muted" style="font-size: 0.7rem;">Needs Management</small>
          </div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card-custom p-3 d-flex align-items-center bg-dark text-white border-0 position-relative overflow-hidden">
          <div class="position-relative z-2">
            <div class="kpi-title text-white-50">Total Est. Cost (MTD)</div>
            <div class="kpi-value text-white">84.2M <span class="fs-6 fw-normal text-white-50">XAF</span></div>
            <small class="text-white-50 fw-bold" style="font-size: 0.7rem;">Accumulated Value</small>
          </div>
          <i class="fa-solid fa-coins position-absolute text-white opacity-10" style="font-size: 60px; right: -10px; bottom: -10px;"></i>
        </div>
      </div>
    </div>

    <div class="card-custom p-0 overflow-hidden">
      <div class="p-3 border-bottom bg-light d-flex justify-content-between align-items-center flex-wrap gap-2">
        <div class="btn-group" role="group">
          <button type="button" class="btn btn-sm btn-outline-secondary active fw-bold" onclick="filterStatus('ALL')">All</button>
          <button type="button" class="btn btn-sm btn-outline-secondary fw-bold" onclick="filterStatus('DRAFT')">Draft</button>
          <button type="button" class="btn btn-sm btn-outline-primary fw-bold" onclick="filterStatus('SUBMITTED_FOR_VALIDATION')">To Validate</button>
          <button type="button" class="btn btn-sm btn-outline-warning text-dark fw-bold" onclick="filterStatus('SUBMITTED_FOR_APPROVAL')">To Approve</button>
          <button type="button" class="btn btn-sm btn-outline-dark fw-bold" onclick="filterStatus('APPROVED_LOCKED')">Locked</button>
        </div>

        <div class="input-group input-group-sm" style="width: 250px;">
          <span class="input-group-text bg-white border-end-0"><i class="fa-solid fa-search text-muted"></i></span>
          <input type="text" class="form-control border-start-0 ps-0 smart-input" placeholder="Search Costing #, Client..." id="searchInput" onkeyup="renderTable()">
        </div>
      </div>

      <div class="table-responsive">
        <table class="table table-hover table-custom mb-0 align-middle">
          <thead class="bg-light text-muted text-uppercase small">
            <tr>
              <th class="ps-4">Costing #</th>
              <th>Date</th>
              <th>Issuer</th>
              <th>File Ref</th>
              <th>Client</th>
              <th class="text-end">Est. Amount (XAF)</th>
              <th>Status</th>
              <th class="text-end pe-4">Action</th>
            </tr>
          </thead>
          <tbody id="table-body"></tbody>
        </table>
      </div>

      <div class="p-2 border-top bg-light d-flex justify-content-end">
        <nav>
          <ul class="pagination pagination-sm mb-0">
            <li class="page-item disabled"><a class="page-link" href="#">Prev</a></li>
            <li class="page-item active"><a class="page-link bg-dark border-dark" href="#">1</a></li>
            <li class="page-item"><a class="page-link text-dark" href="#">2</a></li>
            <li class="page-item"><a class="page-link text-dark" href="#">Next</a></li>
          </ul>
        </nav>
      </div>
    </div>

  </div>

  <div class="offcanvas offcanvas-end" tabindex="-1" id="costingOffcanvas" style="width: 95vw; max-width: 1400px;">
    <div class="offcanvas-header border-bottom bg-light py-2">
      <div class="d-flex align-items-center gap-3">
        <div>
          <h5 class="offcanvas-title font-heading fw-bold" id="offcanvasTitle">New Costing Worksheet</h5>
          <div class="d-flex align-items-center gap-2">
            <span id="costing-status-badge" class="badge bg-secondary">DRAFT</span>
            <small class="text-muted" id="costing-ref-display">SLAS-COST-####</small>
          </div>
        </div>

        <div class="d-flex align-items-center gap-2 ms-4 border-start ps-4">
          <div class="btn-group btn-group-sm">
            <input type="radio" class="btn-check" name="lang" id="lang-en" checked>
            <label class="btn btn-outline-secondary fw-bold" for="lang-en">EN</label>
            <input type="radio" class="btn-check" name="lang" id="lang-fr">
            <label class="btn btn-outline-secondary fw-bold" for="lang-fr">FR</label>
          </div>

          <div class="input-group input-group-sm ms-2" style="width: 180px;">
            <span class="input-group-text fw-bold">Curr</span>
            <select class="form-select fw-bold text-primary" id="currency-selector" onchange="handleCurrencyChange()">
              <option value="XAF" selected>XAF (BEAC)</option>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
            </select>
          </div>

          <button class="btn btn-sm btn-outline-dark fw-bold ms-2" onclick="generatePreview()">
            <i class="fa-solid fa-print me-2"></i>Print / Preview
          </button>
        </div>
      </div>
      <button type="button" class="btn-close" data-bs-dismiss="offcanvas"></button>
    </div>

    <div class="offcanvas-body p-0 bg-white">
      <form id="costingForm" class="h-100 d-flex flex-column" onsubmit="event.preventDefault();">

        <div class="p-4 border-bottom bg-light bg-opacity-50">
          <div class="row g-3">
            <div class="col-md-3 border-end">
              <label class="small fw-bold text-muted text-uppercase mb-1">1. Link Operations File</label>
              <select id="link-file-ref" class="form-select smart-input fw-bold">
                <option value="">Select File Ref...</option>
                </select>


              <div class="mt-2">
                <label class="small text-muted">Costing Date</label>
                <input type="date" id="costing-date" class="form-control form-control-sm smart-input">
              </div>
            </div>

            <div class="col-md-9">
              <div class="p-3 bg-white border rounded-3 shadow-sm">
                <div class="row g-2 small align-items-end">
                  <div class="col-md-2">
                    <span class="text-muted d-block" style="font-size:0.7rem">Client</span>
                    <strong class="text-dark text-truncate d-block" id="ssdc-client">-</strong>
                  </div>

                  <div class="col-md-3">
                    <span class="text-muted d-block" style="font-size:0.7rem">Service Type</span>
                    <strong class="text-dark" id="ssdc-service">-</strong>
                  </div>

                  <div class="col-md-2">
                    <span class="text-muted d-block" style="font-size:0.7rem">Trans. Ref</span>
                    <strong class="text-dark" id="ssdc-transport">-</strong>
                  </div>

                  <div class="col-md-3">
                    <span class="text-muted d-block" style="font-size:0.7rem">Marks &amp; Numbers</span>
                    <strong class="text-dark text-truncate d-block" id="ssdc-marks">-</strong>
                  </div>

                  <div class="col-md-2 text-end">
                    <a href="#ssdc-hidden" data-bs-toggle="collapse" class="text-decoration-none small fw-bold" role="button" aria-expanded="false">
                      Show Details <i class="fa-solid fa-chevron-down ms-1"></i>
                    </a>
                  </div>
                </div>

                <div class="collapse mt-3 pt-2 border-top" id="ssdc-hidden">
                  <div class="row g-2 small mb-3">
                    <div class="col-md-3">
                      <span class="text-muted d-block" style="font-size:0.7rem">ETA / Arrival</span>
                      <strong class="text-dark" id="ssdc-eta">-</strong>
                    </div>

                    <div class="col-md-3">
                      <span class="text-muted d-block" style="font-size:0.7rem">Conveyance</span>
                      <strong class="text-dark" id="ssdc-conveyance">-</strong>
                    </div>

                    <div class="col-md-3">
                      <span class="text-muted d-block" style="font-size:0.7rem">Cargo Weight</span>
                      <strong class="text-dark" id="ssdc-weight">-</strong>
                    </div>

                    <div class="col-md-3">
                      <span class="text-muted d-block" style="font-size:0.7rem">Packages</span>
                      <strong class="text-dark" id="ssdc-packages">-</strong>
                    </div>
                  </div>

                  <div class="row g-2 small">
                    <div class="col-md-3">
                      <span class="text-muted d-block" style="font-size:0.7rem">Place of Delivery</span>
                      <strong class="text-dark" id="ssdc-delivery">-</strong>
                    </div>

                    <div class="col-md-3">
                      <span class="text-muted d-block" style="font-size:0.7rem">Commodity</span>
                      <strong class="text-dark" id="ssdc-commodity">-</strong>
                    </div>

                    <div class="col-md-3">
                      <span class="text-muted d-block" style="font-size:0.7rem">Route (POL→POD)</span>
                      <strong class="text-dark" id="ssdc-route">-</strong>
                    </div>

                    <div class="col-md-3"></div>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>

        <div class="flex-grow-1 overflow-auto p-4">
          <div class="d-flex justify-content-between align-items-center mb-3">
            <h6 class="fw-bold text-uppercase mb-0 text-dark">Costing Lines</h6>
            <div class="d-flex gap-2">
              <button type="button" class="btn btn-sm btn-outline-primary fw-bold" onclick="suggestLines()">
                <i class="fa-solid fa-wand-magic-sparkles me-1"></i> Suggest Lines
              </button>
              <button type="button" class="btn btn-sm btn-dark fw-bold" onclick="addLine()">
                <i class="fa-solid fa-plus me-1"></i> Add Line
              </button>
            </div>
          </div>

          <div class="table-responsive border rounded-3 shadow-sm bg-white">
            <table class="table table-sm table-hover mb-0 align-middle" id="costing-table">
              <thead class="bg-light text-secondary small text-uppercase">
                <tr>
                  <th style="width: 50px;" class="text-center">#</th>
                  <th style="width: 120px;">Code</th>
                  <th>Description (Item)</th>
                  <th style="width: 100px;">Qty</th>
                  <th style="width: 140px;" class="text-end">Unit Cost</th>
                  <th style="width: 150px;" class="text-end">Total HT</th>
                  <th style="width: 80px;" class="text-center">VAT</th>
                  <th style="width: 150px;" class="text-end fw-bold">Total TTC</th>
                  <th style="width: 50px;"></th>
                </tr>
              </thead>
              <tbody id="lines-body"></tbody>
              <tfoot class="bg-light fw-bold">
                <tr>
                  <td colspan="7" class="text-end text-muted text-uppercase small pt-3">Subtotal (HT)</td>
                  <td class="text-end pt-3 font-monospace" id="grand-ht">0</td>
                  <td></td>
                </tr>
                <tr>
                  <td colspan="7" class="text-end text-muted text-uppercase small">VAT (19.25%)</td>
                  <td class="text-end font-monospace" id="grand-vat">0</td>
                  <td></td>
                </tr>
                <tr style="font-size: 1.1rem;">
                  <td colspan="7" class="text-end text-dark text-uppercase pt-2">Total Estimated Cost</td>
                  <td class="text-end pt-2 text-primary fw-black font-monospace" id="grand-ttc">0</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div class="mt-4">
            <label class="form-label fw-bold small text-uppercase text-muted">Enter Remarks / Notes for Print</label>
            <textarea id="costing-remarks" class="form-control smart-input" rows="3" placeholder="Enter remarks (e.g. Costing based on current day exchange rate...)"></textarea>
          </div>
        </div>

        <div class="p-3 border-top bg-white d-flex justify-content-between align-items-center shadow-lg" style="z-index: 10;">
          <div class="d-flex align-items-center gap-3">
            <select id="validator-select" class="form-select form-select-sm">
  <option value="">Select Validator…</option>
</select>

            <small class="text-muted fst-italic ms-2" id="save-status">Last saved: Just now</small>
          </div>

          <div class="d-flex gap-2" id="action-buttons">
            <button type="button" class="btn btn-light fw-bold text-muted" data-bs-dismiss="offcanvas">Close</button>
            <button type="button" class="btn btn-dark fw-bold" onclick="saveDraft()"><i class="fa-regular fa-floppy-disk me-2"></i>Save Draft</button>
            <button type="button" class="btn btn-success fw-bold text-white" onclick="submitForValidation()"><i class="fa-solid fa-paper-plane me-2"></i>Submit for Validation</button>
          </div>
        </div>

      </form>
    </div>
  </div>

  <div class="modal fade" id="printModal" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog modal-xl">
      <div class="modal-content bg-light">
        <div class="modal-header border-0 pb-0">
          <h5 class="modal-title fw-bold text-secondary">
            <i class="fa-solid fa-eye me-2"></i>Print Preview
          </h5>
          <div class="d-flex gap-2">
            <button type="button" class="btn btn-outline-secondary btn-sm fw-bold" data-bs-dismiss="modal">Close</button>
            <button type="button" class="btn btn-dark btn-sm fw-bold" onclick="window.print()">
              <i class="fa-solid fa-print me-2"></i>Print Costing
            </button>
          </div>
        </div>

        <div class="modal-body p-0">
          <div id="print-container"></div>
        </div>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>
  <script src="../../js/api.js"></script>
<script src="../../js/costing-autocomplete.js"></script>
<script src="../../js/costing-module.js"></script>



  <script>

    await loadSSDCFromApi(mockData.fileRef);
    // Guard: if admin.js doesn't define toggleClock, prevent crash.
    if (typeof toggleClock !== 'function') {
      function toggleClock(){ /* noop */ }
    }

    // Keep topbar clock alive regardless of admin.js clock implementation.
    function tickClock(){
      const el = document.getElementById('realtime-clock');
      if (!el) return;
      const now = new Date();
      const hh = String(now.getHours()).padStart(2,'0');
      const mm = String(now.getMinutes()).padStart(2,'0');
      const ss = String(now.getSeconds()).padStart(2,'0');
      el.textContent = `${hh}:${mm}:${ss}`;
    }
    setInterval(tickClock, 1000);
    tickClock();

    // --- 1. GLOBAL VARIABLES & DATA ---
    // --- 1. GLOBAL VARIABLES & DATA ---
let currentRole = 'OPERATIONS';
let activeFilter = 'ALL';

const state = {
  mode: 'new',
  costing_id: null,
  status: 'DRAFT',
  currency: 'XAF',
  exchangeRate: 1,
  lang: 'EN',
  linked_ops_ref: '',
  ssdc: null,
  lines: [],
  validator_user_id: null
};

let currentLang = state.lang;
let currentCurrency = state.currency;
let exchangeRate = state.exchangeRate;




    // Language toggle listeners (Select name_fr/name_en from financial_dictionary data base when toggled between french and english)
    document.getElementById('lang-en')?.addEventListener('change', () => {
  if (document.getElementById('lang-en').checked) {
    currentLang = 'EN';
    state.lang = 'EN';
  }
});
document.getElementById('lang-fr')?.addEventListener('change', () => {
  if (document.getElementById('lang-fr').checked) {
    currentLang = 'FR';
    state.lang = 'FR';
  }
});
if (typeof apiGet !== 'function') {
  async function apiGet(url) {
    const r = await fetch(url, { credentials: 'same-origin' });
    const isJson = (r.headers.get('content-type') || '').includes('application/json');
    const j = isJson ? await r.json() : { ok: false, error: await r.text() };

    if (!r.ok || !j.ok) throw new Error(j.error || 'Request failed');
    return j;
  }
}
// ---------- API HELPERS ----------
if (typeof apiGet !== 'function') {
  async function apiGet(url) {
    const r = await fetch(url, { credentials: 'same-origin' });
    const ct = (r.headers.get('content-type') || '');
    const isJson = ct.includes('application/json');
    const payload = isJson ? await r.json() : { ok: false, error: await r.text() };
    if (!r.ok || !payload.ok) throw new Error(payload.error || `Request failed: ${r.status}`);
    return payload;
  }
}

if (typeof apiPost !== 'function') {
  async function apiPost(url, bodyObj) {
    const r = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyObj || {})
    });
    const ct = (r.headers.get('content-type') || '');
    const isJson = ct.includes('application/json');
    const payload = isJson ? await r.json() : { ok: false, error: await r.text() };
    if (!r.ok || !payload.ok) throw new Error(payload.error || `Request failed: ${r.status}`);
    return payload;
  }
}

// ---------- VALIDATOR LIST ----------
async function loadValidators(selectedUserId = '') {
  const sel = document.getElementById('validator-select');
  if (!sel) return;

  sel.innerHTML = `<option value="">Select Validator…</option>`;

  try {
    // Expect res.data like: [{ user_id, employee_id, full_name, job_title }]
    const res = await apiGet('../../api/hr/validators/list.php');
    const list = Array.isArray(res.data) ? res.data : [];

    if (!list.length) {
      sel.innerHTML = `<option value="">No validators found</option>`;
      console.warn('Validators list is empty:', res);
      return;
    }

    for (const v of list) {
      const opt = document.createElement('option');

      // IMPORTANT: use user_id for workflow assignment
      opt.value = String(v.user_id ?? '');
      opt.textContent = `${v.full_name ?? '—'} — ${v.job_title ?? ''}`.trim();

      sel.appendChild(opt);
    }

    if (selectedUserId) sel.value = String(selectedUserId);
  } catch (err) {
    console.error('Failed to load validators:', err);
    sel.innerHTML = `<option value="">Failed to load validators</option>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadValidators().catch(console.error);
});

// store selected validator user_id
document.getElementById('validator-select')?.addEventListener('change', (e) => {
  state.validator_user_id = e.target.value ? String(e.target.value) : null;
});

// ---------- SUBMIT FOR VALIDATION ----------
async function submitForValidation() {
  if (!state.validator_user_id) {
    alert('Please select a validator.');
    return;
  }

  if (!state.costing_id) {
    alert('Costing ID missing. Please reload the page.');
    return;
  }

  try {
    await apiPost('../../api/finance/costings/transition.php', {
      costing_id: state.costing_id,
      action: 'SUBMIT_FOR_VALIDATION',
      validator_user_id: state.validator_user_id
    });

    bsOffcanvas.hide();
    // optional: refresh registry
    await renderTable();
  } catch (err) {
    console.error(err);
    alert(err?.message || 'Submit failed. Check console.');
  }
}



    // Initialize Bootstrap Offcanvas
    const bsOffcanvas = new bootstrap.Offcanvas(document.getElementById('costingOffcanvas'));

    // Mock Costings Registry Data
    const costings = [
      { id: 'SLAS-COST-001401', date: '2026-01-02', issuer: 'Mike Ross', fileRef: 'SL9928112SM', client: 'TotalEnergies E&P', amount: 4500000, status: 'DRAFT' },
      { id: 'SLAS-COST-001398', date: '2025-12-30', issuer: 'Sarah K.', fileRef: 'SL1102938AX', client: 'Huawei', amount: 1250000, status: 'SUBMITTED_FOR_VALIDATION' },
      { id: 'SLAS-COST-001395', date: '2025-12-28', issuer: 'Mike Ross', fileRef: 'SL3310293IT', client: 'Maersk Cameroon', amount: 8900000, status: 'VALIDATED' },
      { id: 'SLAS-COST-001390', date: '2025-12-20', issuer: 'John Doe', fileRef: 'SL5519201WH', client: 'Perenco', amount: 320000, status: 'SUBMITTED_FOR_APPROVAL' },
      { id: 'SLAS-COST-001388', date: '2025-12-18', issuer: 'Mike Ross', fileRef: 'SL8821002BR', client: 'MTN Cameroon', amount: 15500000, status: 'APPROVED_LOCKED' },
      { id: 'SLAS-COST-001385', date: '2025-12-15', issuer: 'Sarah K.', fileRef: 'SL9910022EF', client: 'Diageo', amount: 2100000, status: 'REJECTED' }
    ];

    // Mock Operations Database (SSDC Source)
    const opsFileDB = {
      'SL9928112SM': {
        client: 'TotalEnergies E&P',
        client_bill_to: 'TotalEnergies E&P',
        service_type: 'SEA_FREIGHT_IMPORT',
        commodity_short: 'OCTG',
        gross_weight: '18500.500',
        weight_unit: 'KG',
        pkg_count: '28',
        incoterm: 'CIF',
        marks_numbers: 'CONT-TE-88312 / PALLET 1-28',
        place_delivery: 'Douala',
        eta: '2026-01-10',
        ata: '',
        sea_bl: 'BL-TE-2025-0011',
        sea_vessel: 'MSC Example',
        sea_voyage: 'VY102',
        sea_pol: 'Shanghai',
        sea_pod: 'Douala'
      },

      'SL1102938AX': {
        client: 'Huawei',
        client_bill_to: 'Huawei',
        service_type: 'AIR_FREIGHT_EXPORT',
        commodity_short: 'ROUTERS',
        gross_weight: '420.000',
        weight_unit: 'KG',
        pkg_count: '12',
        incoterm: 'FCA',
        marks_numbers: 'HUA-EXP-12CTNS',
        place_delivery: 'Paris',
        eta: '2026-01-05',
        ata: '',
        air_mawb: 'MAWB-235-9912',
        air_airline: 'Air France',
        air_flightno: 'AF900',
        air_origin: 'DLA',
        air_dest: 'CDG'
      },

      'SL3310293IT': {
        client: 'Maersk Cameroon',
        client_bill_to: 'Maersk Cameroon',
        service_type: 'INLAND_TRANSPORTATION',
        commodity_short: 'FMCG',
        gross_weight: '12000',
        weight_unit: 'KG',
        pkg_count: '96',
        incoterm: 'CPT',
        marks_numbers: 'MRSK-TR-96',
        place_delivery: "N'Djamena",
        eta: '2025-12-22',
        ata: '2025-12-24',
        inland_truck: 'LT-2389-TRK',
        inland_decl: 'T1-DECL-90012',
        inland_border: 'Douala → Kousseri → N’Djamena'
      },

      'SL5519201WH': {
        client: 'Perenco',
        client_bill_to: 'Perenco',
        service_type: 'WAREHOUSING',
        commodity_short: 'SPARES',
        gross_weight: '9000',
        weight_unit: 'KG',
        pkg_count: '40',
        marks_numbers: 'PRC-WH-LOT-77',
        place_delivery: 'Douala',
        warehouse_loc: 'Bonaberi Warehouse',
        warehouse_bonded: 'NON_BONDED',
        warehouse_stockin: '2026-01-02'
      },

      'SL8821002BR': {
        client: 'MTN Cameroon',
        client_bill_to: 'MTN Cameroon',
        service_type: 'BUSINESS_REPRESENTATION',
        rep_scope: 'Customs liaison and documentation follow-up',
        rep_contact: 'Mr. Alain N.',
        commodity_short: '',
        gross_weight: '',
        weight_unit: '',
        pkg_count: '',
        place_delivery: '',
        marks_numbers: ''
      }
    };

    // Mock Financial Dictionary (Suggestion Logic)
    const finDict = {
      'SEA': [
        { code: '#-1045', desc: 'Ocean Freight Charges', cost: 1200000 },
        { code: '#-1040', desc: 'Import Custom Duties', cost: 450000 },
        { code: '#-2050', desc: 'Terminal Handling (THC)', cost: 185000 },
        { code: '#-2055', desc: 'Port Passage / Wharfage', cost: 65000 }
      ],
      'AIR': [
        { code: '#-1090', desc: 'Air Freight All-In', cost: 850000 },
        { code: '#-1095', desc: 'AWB Documentation Fee', cost: 25000 },
        { code: '#-3010', desc: 'Airport Handling', cost: 45000 }
      ],
      'INLAND': [
        { code: '#-4010', desc: 'Trucking / Haulage Fee', cost: 650000 },
        { code: '#-4020', desc: 'Road Fund / Tolls', cost: 15000 },
        { code: '#-4030', desc: 'Escort Service (Security)', cost: 100000 }
      ]
    };

    const statusConfig = {
      'DRAFT': { class: 'status-draft', label: 'Draft' },
      'SUBMITTED_FOR_VALIDATION': { class: 'status-submitted-val', label: 'To Validate' },
      'VALIDATED': { class: 'status-validated', label: 'Validated' },
      'REJECTED': { class: 'status-rejected', label: 'Rejected' },
      'SUBMITTED_FOR_APPROVAL': { class: 'status-submitted-app', label: 'To Approve' },
      'APPROVED_LOCKED': { class: 'status-approved', label: 'Locked' }
    };

    // --- 2. CORE FUNCTIONS ---
    function switchRole(role) {
      currentRole = role;
      renderTable();
    }

    function filterStatus(status) {
      activeFilter = status;
      document.querySelectorAll('.btn-group button').forEach(btn => {
        const txt = btn.innerText.toUpperCase().replace(' ', '_');
        let isActive = false;
        if(status === 'ALL' && txt === 'ALL') isActive = true;
        else if(status === 'DRAFT' && txt === 'DRAFT') isActive = true;
        else if(status === 'SUBMITTED_FOR_VALIDATION' && txt === 'TO_VALIDATE') isActive = true;
        else if(status === 'SUBMITTED_FOR_APPROVAL' && txt === 'TO_APPROVE') isActive = true;
        else if(status === 'APPROVED_LOCKED' && txt === 'LOCKED') isActive = true;

        if(isActive) btn.classList.add('active'); else btn.classList.remove('active');
      });
      renderTable();
    }

    async function renderTable() {
  const tbody = document.getElementById('table-body');
  const search = (document.getElementById('searchInput').value || '').trim();

  tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">Loading...</td></tr>`;

  try {
    const url = `../../api/finance/costings/list.php?status=${encodeURIComponent(activeFilter || 'ALL')}&q=${encodeURIComponent(search)}`;
    const j = await apiGet('../../api/finance/costings/next_ref.php');
    const nextId = j.data.next_id;
    refDisplay.innerText = nextId;

    state.mode = 'new';
    state.costing_id = nextId;
    state.status = 'DRAFT';


    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">No records found.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(c => {
      const meta = statusConfig[c.status] || { class: 'status-draft', label: c.status };

      let btnClass = 'btn-outline-dark';
      let btnIcon = 'fa-eye';
      let btnText = 'View';

      if (currentRole === 'OPERATIONS' && (c.status === 'DRAFT' || c.status === 'REJECTED')) {
        btnIcon = 'fa-pen-to-square'; btnText = 'Edit';
      } else if (currentRole === 'LEAD' && c.status === 'SUBMITTED_FOR_VALIDATION') {
        btnClass = 'btn-primary'; btnIcon = 'fa-check-circle'; btnText = 'Validate';
      } else if (currentRole === 'MANAGEMENT' && c.status === 'SUBMITTED_FOR_APPROVAL') {
        btnClass = 'btn-warning text-dark'; btnIcon = 'fa-stamp'; btnText = 'Approve';
      }

      return `
        <tr class="hover-row" onclick="openCostingOffcanvas('${c.id}')">
          <td class="ps-4"><span class="font-monospace fw-bold text-dark small bg-light border px-2 py-1 rounded">${c.id}</span></td>
          <td class="small text-muted">${c.date ?? ''}</td>
          <td class="small fw-bold text-dark">${c.issuer ?? '—'}</td>
          <td class="font-monospace small text-primary">${c.fileRef ?? ''}</td>
          <td class="fw-bold text-dark" style="font-size:0.85rem">${c.client ?? '—'}</td>
          <td class="text-end fw-bold font-monospace">${Number(c.amount || 0).toLocaleString()}</td>
          <td><span class="status-pill ${meta.class}">${meta.label}</span></td>
          <td class="text-end pe-4">
            <button class="btn btn-sm ${btnClass} fw-bold" onclick="event.stopPropagation(); openCostingOffcanvas('${c.id}')">
              <i class="fa-solid ${btnIcon} me-1"></i> ${btnText}
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger py-4">Failed to load. Check console.</td></tr>`;
  }
}


    // --- 3. COSTING ENGINE LOGIC (OFFCANVAS) ---
    async function openCostingOffcanvas(id) {
      const title = document.getElementById('offcanvasTitle');
      const refDisplay = document.getElementById('costing-ref-display');
      const badge = document.getElementById('costing-status-badge');

      // Clear Form
      document.getElementById('lines-body').innerHTML = '';
      document.getElementById('link-file-ref').value = '';
      
      loadSSDCFromApi('');
      calculateTotals();
      loadOpsFileOptions('').catch(err => console.error(err));


      if(id === 'new') {
        title.innerText = "New Costing Worksheet";

        let maxNum = 2300;
        costings.forEach(c => {
          const numPart = parseInt(c.id.split('-').pop());
          if (numPart > maxNum) maxNum = numPart;
        });

        const nextNum = maxNum + 1;
        const nextId = `SLAS-COST-${String(nextNum).padStart(7, '0')}`;
        refDisplay.innerText = nextId;

        const now = new Date();
        const localDate = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        document.getElementById('costing-date').value = localDate;

        badge.className = "badge bg-secondary";
        badge.innerText = "DRAFT";

        renderActionButtons('CREATOR');
      } else {
        const mockData = costings.find(c => c.id === id);
        if(!mockData) { alert("Error: Record not found."); return; }

        title.innerText = "Manage Costing";
        refDisplay.innerText = id;
        document.getElementById('costing-date').value = mockData.date;
        document.getElementById('link-file-ref').value = mockData.fileRef;
        await loadOpsFileOptions(mockData.fileRef);


        loadSSDCFromApi(mockData.fileRef);
        suggestLines();

        badge.className = `badge ${statusConfig[mockData.status].class}`;
        badge.innerText = mockData.status;

        if(currentRole === 'LEAD' && mockData.status === 'SUBMITTED_FOR_VALIDATION') {
          renderActionButtons('VALIDATOR');
        } else if (currentRole === 'MANAGEMENT' && mockData.status === 'SUBMITTED_FOR_APPROVAL') {
          renderActionButtons('APPROVER');
        } else if (currentRole === 'OPERATIONS' && (mockData.status === 'DRAFT' || mockData.status === 'REJECTED')) {
          renderActionButtons('CREATOR');
        } else {
          renderActionButtons('VIEWER');
        }
      }
      bsOffcanvas.show();
    }



    // ---- SSDC COMPACT MAPPING ----
    function serviceLabel(serviceTypeRaw = '') {
      return String(serviceTypeRaw || '').replace(/_/g, ' ').trim() || '-';
    }

    function detectServiceGroup(serviceTypeRaw = '') {
      const s = String(serviceTypeRaw).toUpperCase();
      if (s.includes('SEA')) return 'SEA';
      if (s.includes('AIR')) return 'AIR';
      if (s.includes('INLAND') || s.includes('HINTERLAND') || s.includes('TRANSPORT') || s.includes('TRANSIT')) return 'TRANSPORT';
      if (s.includes('WAREHOUS')) return 'WAREHOUSE';
      if (s.includes('BUSINESS_REP') || s.includes('REPRESENTATION')) return 'BUSINESS_REP';
      return 'ALL';
    }

    function valOrDash(v) {
      const x = (v ?? '').toString().trim();
      return x === '' ? '-' : x;
    }

    function smartRoute(d, group) {
      if (group === 'SEA') {
        const pol = valOrDash(d.sea_pol);
        const pod = valOrDash(d.sea_pod);
        return (pol === '-' && pod === '-') ? '-' : `${pol} → ${pod}`;
      }
      if (group === 'AIR') {
        const o = valOrDash(d.air_origin);
        const dest = valOrDash(d.air_dest);
        return (o === '-' && dest === '-') ? '-' : `${o} → ${dest}`;
      }
      if (group === 'TRANSPORT') return valOrDash(d.inland_border);
      return '-';
    }

    function smartTransportRef(d, group) {
      if (group === 'SEA') return valOrDash(d.sea_bl);
      if (group === 'AIR') return valOrDash(d.air_mawb);
      if (group === 'TRANSPORT') return valOrDash(d.inland_truck);
      return '-';
    }

    function smartConveyance(d, group) {
      if (group === 'SEA') {
        const vessel = valOrDash(d.sea_vessel);
        const voyage = valOrDash(d.sea_voyage);
        if (vessel === '-' && voyage === '-') return '-';
        if (voyage === '-') return vessel;
        if (vessel === '-') return `Voyage ${voyage}`;
        return `${vessel} / ${voyage}`;
      }
      if (group === 'AIR') {
        const airline = valOrDash(d.air_airline);
        const flight = valOrDash(d.air_flightno);
        if (airline === '-' && flight === '-') return '-';
        if (flight === '-') return airline;
        if (airline === '-') return `Flight ${flight}`;
        return `${airline} / ${flight}`;
      }
      if (group === 'TRANSPORT') return 'Road Transit';
      return '-';
    }

    function smartEtaArrival(d, group) {
      const ata = valOrDash(d.ata);
      if (ata !== '-') return ata;
      return valOrDash(d.eta);
    }

   async function loadSSDCFromApi(ref) {
  clearSSDCUI();
  if (!ref) return;

  const res = await apiGet(`../../api/operations/files/get_ssdc.php?ref=${encodeURIComponent(ref)}`);
  // Expect a normalized payload:
  // { client_id, client_name, service_type, marks_numbers, eta, ata, gross_weight, weight_unit, package_count,
  //   conveyance_label, transport_ref, route_label, place_delivery, commodity }
  state.ssdc = res.data;

  // Populate SSDC UI
  document.getElementById('ssdc-client').innerText = res.data.client_name || '-';
  document.getElementById('ssdc-service').innerText = (res.data.service_type || '-').replaceAll('_',' ');
  document.getElementById('ssdc-transport').innerText = res.data.transport_ref || '-';
  document.getElementById('ssdc-marks').innerText = res.data.marks_numbers || '-';
  document.getElementById('ssdc-eta').innerText = res.data.ata || res.data.eta || '-';
  document.getElementById('ssdc-conveyance').innerText = res.data.conveyance_label || '-';

  const w = [res.data.gross_weight, res.data.weight_unit].filter(Boolean).join(' ');
  document.getElementById('ssdc-weight').innerText = w || '-';

  document.getElementById('ssdc-packages').innerText = res.data.package_count ?? '-';
  document.getElementById('ssdc-delivery').innerText = res.data.place_delivery || '-';
  document.getElementById('ssdc-commodity').innerText = res.data.commodity || '-';
  document.getElementById('ssdc-route').innerText = res.data.route_label || '-';
}
function clearSSDCUI() {
  [
    'ssdc-client','ssdc-service','ssdc-transport','ssdc-route','ssdc-eta','ssdc-conveyance',
    'ssdc-weight','ssdc-packages','ssdc-delivery','ssdc-commodity','ssdc-marks'
  ].forEach(id => { const el = document.getElementById(id); if (el) el.innerText = '-'; });
}


    function handleCurrencyChange() {
      const newCurr = document.getElementById('currency-selector').value;
      let newRate = 1;

      if(newCurr !== 'XAF') {
        const input = prompt(`Enter Exchange Rate for ${newCurr} to XAF:`, "655.957");
        if(input && !isNaN(input)) {
          newRate = parseFloat(input);
        } else {
          document.getElementById('currency-selector').value = currentCurrency;
          return;
        }
      } else {
        newRate = 1;
      }

      const ratio = exchangeRate / newRate;

      const rows = document.querySelectorAll('#lines-body tr');
      rows.forEach(row => {
        const costInput = row.querySelector('.cost-input');
        let currentCost = parseFloat(costInput.value) || 0;

        let newCost = currentCost * ratio;
        costInput.value = newCost.toFixed(2);
        calculateRow(row.id);
      });

      exchangeRate = newRate;
      currentCurrency = newCurr;
      calculateTotals();
    }
    async function loadOpsFileOptions(selectedRef = '') {
  const sel = document.getElementById('link-file-ref');
  sel.innerHTML = `<option value="">Select File Ref...</option>`;

  const res = await apiGet('../../api/operations/files/list_for_costing.php');
  // Expect: [{ operations_file_reference, client_name }]
  res.data.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.operations_file_reference;
    opt.textContent = `${r.operations_file_reference} (${r.client_name})`;
    sel.appendChild(opt);
  });

  if (selectedRef) sel.value = selectedRef;
}
document.getElementById('link-file-ref').addEventListener('change', async (e) => {
  const ref = e.target.value;
  state.linked_ops_ref = ref;
  await loadSSDCFromApi(ref);
});


    function addLine(data = null) {
      const tbody = document.getElementById('lines-body');
      const rowId = 'row-' + Math.floor(Math.random() * 100000);

      const code = data ? data.code : '';
      const desc = data ? data.desc : '';
      const cost = data ? (data.cost / exchangeRate).toFixed(2) : '0.00';
      const qty = 1;

      const enterAction = "if(event.key === 'Enter') { event.preventDefault(); addLine(); }";

      const row = `
        <tr id="${rowId}">
          <td class="text-center">
            <button type="button" onclick="removeLine('${rowId}')" class="btn btn-sm text-danger">
              <i class="fa-solid fa-times"></i>
            </button>
          </td>

          <td><input type="text" class="form-control form-control-sm smart-input font-monospace"
            value="${code}" placeholder="Code" onkeydown="${enterAction}"></td>

          <td><input type="text" class="form-control form-control-sm smart-input"
            value="${desc}" placeholder="Description" onkeydown="${enterAction}"></td>

          <td><input type="number" class="form-control form-control-sm smart-input text-center qty-input"
            value="${qty}" oninput="calculateRow('${rowId}')" onkeydown="${enterAction}"></td>

          <td><input type="number" class="form-control form-control-sm smart-input text-end cost-input"
            value="${cost}" oninput="calculateRow('${rowId}')" onkeydown="${enterAction}"></td>

          <td class="text-end font-monospace ht-val" id="${rowId}-ht">0.00</td>
          <td class="text-center"><input type="checkbox" checked onchange="calculateRow('${rowId}')" title="Apply 19.25%"></td>
          <td class="text-end fw-bold font-monospace ttc-val" id="${rowId}-ttc">0.00</td>
          <td></td>
        </tr>
      `;
      tbody.insertAdjacentHTML('beforeend', row);
      calculateRow(rowId);

      if(!data) {
        const newRow = document.getElementById(rowId);
        const descInput = newRow.querySelectorAll('input')[1];
        if(descInput) descInput.focus();
      }
    }

    function removeLine(id) {
      const row = document.getElementById(id);
      if(row) row.remove();
      calculateTotals();
    }

    async function suggestLines() {
  const ref = document.getElementById('link-file-ref').value;
  if (!ref) { alert("Please select an Operations File first."); return; }

  if (!state.ssdc || !state.ssdc.service_type) {
    await loadSSDCFromApi(ref);
  }

  const service_type = state.ssdc?.service_type || '';
  if (!service_type) { addLine(); return; }

  try {
    const j = await apiGet(`../../api/finance/financial_dictionary/search.php?service_type=${encodeURIComponent(service_type)}&lang=${encodeURIComponent(state.lang)}`);
    const items = j.data || [];

    if (!items.length) { addLine(); return; }

    // expected: [{code, desc, default_cost, dict_id}]
    items.forEach(it => addLine({ code: it.code, desc: it.desc, cost: it.default_cost || 0 }));
  } catch (e) {
    console.error(e);
    // graceful fallback: at least open an empty line
    addLine();
  }
}


    function calculateRow(rowId) {
      const row = document.getElementById(rowId);
      if(!row) return;

      const qty = parseFloat(row.querySelector('.qty-input').value) || 0;
      const cost = parseFloat(row.querySelector('.cost-input').value) || 0;
      const isVat = row.querySelector('input[type="checkbox"]').checked;
      const vatRate = 0.1925;

      const ht = qty * cost;
      const vat = isVat ? (ht * vatRate) : 0;
      const ttc = ht + vat;

      const fmt = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

      document.getElementById(`${rowId}-ht`).innerText = ht.toLocaleString('en-US', fmt);
      document.getElementById(`${rowId}-ttc`).innerText = ttc.toLocaleString('en-US', fmt);

      row.dataset.ht = ht;
      row.dataset.vat = vat;
      row.dataset.ttc = ttc;

      calculateTotals();
    }

    function calculateTotals() {
      let totalHT = 0;
      let totalVAT = 0;
      let totalTTC = 0;

      document.querySelectorAll('#lines-body tr').forEach(row => {
        totalHT += parseFloat(row.dataset.ht || 0);
        totalVAT += parseFloat(row.dataset.vat || 0);
        totalTTC += parseFloat(row.dataset.ttc || 0);
      });

      const fmt = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

      document.getElementById('grand-ht').innerText = totalHT.toLocaleString('en-US', fmt);
      document.getElementById('grand-vat').innerText = totalVAT.toLocaleString('en-US', fmt);
      document.getElementById('grand-ttc').innerText = totalTTC.toLocaleString('en-US', fmt) + ` ${currentCurrency}`;

      window.__totals = { ht: totalHT, vat: totalVAT, ttc: totalTTC };
    }

   
    document.getElementById('validator-select')?.addEventListener('change', (e) => {
  state.validator_user_id = e.target.value || null;
});


    function renderActionButtons(role) {
      const container = document.getElementById('action-buttons');
      let html = '<button type="button" class="btn btn-light fw-bold text-muted" data-bs-dismiss="offcanvas">Close</button>';

      if(role === 'CREATOR') {
        html += `
          <button type="button" class="btn btn-dark fw-bold" onclick="saveDraft()"><i class="fa-regular fa-floppy-disk me-2"></i>Save Draft</button>
          <button type="button" class="btn btn-success fw-bold text-white" onclick="submitForValidation()"><i class="fa-solid fa-paper-plane me-2"></i>Submit</button>
        `;
      } else if (role === 'VALIDATOR') {
        html += `
          <button type="button" class="btn btn-danger fw-bold" onclick="alert('Rejected back to Draft')"><i class="fa-solid fa-ban me-2"></i>Reject</button>
          <button type="button" class="btn btn-primary fw-bold text-white" onclick="alert('Validated! Sent to Management.')"><i class="fa-solid fa-check-circle me-2"></i>Validate</button>
        `;
      } else if (role === 'APPROVER') {
        html += `
          <button type="button" class="btn btn-danger fw-bold" onclick="alert('Rejected back to Ops')"><i class="fa-solid fa-ban me-2"></i>Reject</button>
          <button type="button" class="btn btn-warning fw-bold text-dark" onclick="alert('APPROVED & LOCKED')"><i class="fa-solid fa-stamp me-2"></i>Approve & Lock</button>
        `;
      }
      container.innerHTML = html;
    }

    function saveDraft() {
      alert("Draft Saved Successfully!");
      document.getElementById('save-status').innerText = "Last saved: Just now";
      document.getElementById('costing-status-badge').className = "badge bg-secondary";
      document.getElementById('costing-status-badge').innerText = "DRAFT";
    }

    function submitForValidation() {
  if (!state.validator_user_id) {
    alert('Please select a validator.');
    return;
  }

  // call backend transition
  apiPost('../../api/finance/costings/transition.php', {
    costing_id: state.costing_id,
    action: 'SUBMIT_FOR_VALIDATION',
    validator_user_id: state.validator_user_id
  });

  bsOffcanvas.hide();
}


    // --- PHASE 3: PREVIEW GENERATION LOGIC ---
    function currencyLabel(currency, lang) {
      const map = {
        XAF: { EN: "CFA francs", FR: "francs CFA" },
        USD: { EN: "US dollars", FR: "dollars américains" },
        EUR: { EN: "euros", FR: "euros" }
      };
      return (map[currency]?.[lang]) || currency;
    }

    function minorUnitLabel(currency, lang) {
      const map = {
        XAF: { EN: "centimes", FR: "centimes" },
        USD: { EN: "cents", FR: "cents" },
        EUR: { EN: "cents", FR: "cents" }
      };
      return (map[currency]?.[lang]) || (lang === 'FR' ? 'centimes' : 'cents');
    }

    function toWordsEN(n) {
      const a = ["zero","one","two","three","four","five","six","seven","eight","nine","ten",
                 "eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
      const b = ["","", "twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];

      function chunk(num) {
        let str = "";
        if (num >= 100) {
          str += a[Math.floor(num/100)] + " hundred";
          num %= 100;
          if (num) str += " ";
        }
        if (num >= 20) {
          str += b[Math.floor(num/10)];
          num %= 10;
          if (num) str += "-" + a[num];
        } else if (num > 0) {
          str += a[num];
        } else if (!str) {
          str = "zero";
        }
        return str;
      }

      if (n === 0) return "zero";
      const scales = ["", "thousand", "million", "billion", "trillion"];
      let i = 0;
      let words = [];
      while (n > 0 && i < scales.length) {
        const part = n % 1000;
        if (part) words.unshift(chunk(part) + (scales[i] ? " " + scales[i] : ""));
        n = Math.floor(n / 1000);
        i++;
      }
      return words.join(" ").trim();
    }

    function toWordsFR(n) {
      const units = ["zéro","un","deux","trois","quatre","cinq","six","sept","huit","neuf","dix",
                     "onze","douze","treize","quatorze","quinze","seize","dix-sept","dix-huit","dix-neuf"];
      const tens = ["","", "vingt","trente","quarante","cinquante","soixante","soixante","quatre-vingt","quatre-vingt"];

      function under100(num) {
        if (num < 20) return units[num];
        const t = Math.floor(num / 10);
        const u = num % 10;

        if (t === 7) return "soixante-" + under100(10 + u);
        if (t === 9) return "quatre-vingt-" + under100(10 + u);
        if (t === 8 && u === 0) return "quatre-vingts";

        if (u === 1 && t !== 8) return tens[t] + " et un";
        if (u > 0) return tens[t] + "-" + units[u];
        return tens[t];
      }

      function under1000(num) {
        if (num < 100) return under100(num);
        const h = Math.floor(num / 100);
        const r = num % 100;
        let str = "";
        if (h === 1) str = "cent";
        else str = units[h] + " cent";
        if (r === 0 && h > 1) str += "s";
        if (r) str += " " + under100(r);
        return str;
      }

      if (n === 0) return "zéro";

      const scales = [
        { v: 1_000_000_000_000, s: "billion" },
        { v: 1_000_000_000, s: "milliard" },
        { v: 1_000_000, s: "million" },
        { v: 1_000, s: "mille" }
      ];

      let num = n;
      let parts = [];

      for (const sc of scales) {
        if (num >= sc.v) {
          const q = Math.floor(num / sc.v);
          num = num % sc.v;

          if (sc.s === "mille") {
            if (q === 1) parts.push("mille");
            else parts.push(under1000(q) + " mille");
          } else {
            const word = under1000(q) + " " + sc.s + (q > 1 ? "s" : "");
            parts.push(word);
          }
        }
      }

      if (num > 0) parts.push(under1000(num));
      return parts.join(" ").trim();
    }

    function amountToWords(amount, currency, lang) {
      const major = Math.floor(amount);
      const minor = Math.round((amount - major) * 100);

      const majorWords = (lang === 'FR' ? toWordsFR(major) : toWordsEN(major));
      const curr = currencyLabel(currency, lang);

      if (lang === 'FR') {
        let s = `Coût arrêté à la somme de ${majorWords} ${curr}`;
        if (minor > 0) {
          const minorWords = toWordsFR(minor);
          s += ` et ${minorWords} ${minorUnitLabel(currency, lang)}`;
        }
        return s + ".";
      } else {
        let s = `Costing held at the sum of ${majorWords} ${curr}`;
        if (minor > 0) {
          const minorWords = toWordsEN(minor);
          s += ` and ${minorWords} ${minorUnitLabel(currency, lang)}`;
        }
        return s + ".";
      }
    }

    function generatePreview() {
      const data = {
        id: document.getElementById('costing-ref-display').innerText,
        date: document.getElementById('costing-date').value || new Date().toLocaleDateString(),
        fileRef: document.getElementById('link-file-ref').value || '-',
        client: document.getElementById('ssdc-client').innerText,
        service: document.getElementById('ssdc-service').innerText,
        remarks: document.getElementById('costing-remarks').value || "No additional remarks.",
        user: currentRole,
        
        totals: window.__totals || { ht: 0, vat: 0, ttc: 0 }
      };

      const ssdc = {
        trans: document.getElementById('ssdc-transport').innerText,
        conv: document.getElementById('ssdc-conveyance').innerText,
        route: document.getElementById('ssdc-route').innerText,
        eta: document.getElementById('ssdc-eta').innerText,
        wgt: document.getElementById('ssdc-weight').innerText,
        pkgs: document.getElementById('ssdc-packages').innerText,
        del: document.getElementById('ssdc-delivery').innerText,
        comm: document.getElementById('ssdc-commodity').innerText,
        marks: document.getElementById('ssdc-marks').innerText
      };

      const rows = [];
      document.querySelectorAll('#lines-body tr').forEach(tr => {
        const inputs = tr.querySelectorAll('input');
        rows.push({
          code: inputs[0].value,
          desc: inputs[1].value,
          qty: inputs[2].value,
          unit: parseFloat(inputs[3].value).toLocaleString('en-US', {minimumFractionDigits: 2}),
          ht: tr.querySelector('.ht-val').innerText,
          isVat: tr.querySelector('input[type="checkbox"]').checked,
          ttc: tr.querySelector('.ttc-val').innerText
        });
      });

      const MAX_LINES_PG1 = 12;
      const MAX_LINES_PGX = 25;

      let totalPages = 1;
      if (rows.length > MAX_LINES_PG1) {
        const remaining = rows.length - MAX_LINES_PG1;
        totalPages = 1 + Math.ceil(remaining / MAX_LINES_PGX);
      }

      const container = document.getElementById('print-container');
      container.innerHTML = '';

      let currentRowIndex = 0;

      for (let p = 1; p <= totalPages; p++) {
        const isPage1 = (p === 1);
        const isLastPage = (p === totalPages);
        const limit = isPage1 ? MAX_LINES_PG1 : MAX_LINES_PGX;

        const sheet = document.createElement('div');
        sheet.className = 'a4-page';

        let html = '';

        if (isPage1) {
          html += `
            <div class="print-header-grid">
              <div class="print-header-left">
                <strong class="company-name-one-line">SMART LOGISTICS AND SERVICES LTD</strong>
                <div class="company-details">
                  1030, Avenue Douala Manga Bell, Bali<br>
                  P.O. Box 5120, Douala, Cameroon<br>
                  Tel: 00237 233 420 281<br>
                  Email: operations@smartls.cm
                </div>
              </div>
              <div class="print-header-center">
                <div class="doc-title-center">COSTING</div>
                <div style="width: 60%; text-align: center;" class="">
                  <div class="badge bg-secondary text-white rounded-0 text-uppercase mt-1">${document.getElementById('costing-status-badge').innerText}</div>
                </div>
              </div>
              <div class="print-header-right">
                <img src="https://i.ibb.co/35MQnHJn/LOGO-SMART.png" alt="Smart LS" class="print-logo">
              </div>
            </div>

            <div class="doc-meta-grid">
              <div class="meta-item"><label>No.</label><div>${data.id}</div></div>
              <div class="meta-item"><label>Date</label><div>${data.date}</div></div>
              <div class="meta-item"><label>File Ref</label><div class="text-primary">${data.fileRef}</div></div>
              <div class="meta-item"><label>Client</label><div>${data.client}</div></div>
              <div class="meta-item"><label>Service</label><div>${data.service}</div></div>
              <div class="meta-item"><label>Est. Total</label><div class="text-danger">${document.getElementById('grand-ttc').innerText}</div></div>
            </div>

            <div class="ssdc-print-box">
              <div class="ssdc-title">SHIPMENT DETAILS</div>
              <div class="row g-1 ssdc-data-row">
                <div class="col-3"><span class="ssdc-label">Trans Ref:</span> <span class="ssdc-val">${ssdc.trans}</span></div>
                <div class="col-3"><span class="ssdc-label">Conveyance:</span> <span class="ssdc-val">${ssdc.conv}</span></div>
                <div class="col-3"><span class="ssdc-label">Route:</span> <span class="ssdc-val">${ssdc.route}</span></div>
                <div class="col-3"><span class="ssdc-label">ETA:</span> <span class="ssdc-val">${ssdc.eta}</span></div>
                <div class="col-3"><span class="ssdc-label">Weight:</span> <span class="ssdc-val">${ssdc.wgt}</span></div>
                <div class="col-3"><span class="ssdc-label">Pkgs:</span> <span class="ssdc-val">${ssdc.pkgs}</span></div>
                <div class="col-3"><span class="ssdc-label">Delivery:</span> <span class="ssdc-val">${ssdc.del}</span></div>
                <div class="col-3"><span class="ssdc-label">Commodity:</span> <span class="ssdc-val">${ssdc.comm}</span></div>
                <div class="col-12 border-top mt-1 pt-1"><span class="ssdc-label">Marks:</span> <span class="ssdc-val">${ssdc.marks}</span></div>
              </div>
            </div>
          `;
        } else {
          html += `<div style="height: 30px;"></div><div class="small fw-bold text-muted mb-2">Continuation Sheet - ${data.id}</div>`;
        }

        html += `
          <table class="print-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Description</th>
                <th class="text-center">Qty</th>
                <th class="text-end">Unit Cost</th>
                <th class="text-end">Total HT</th>
                <th class="text-center">VAT</th>
                <th class="text-end">Total TTC</th>
              </tr>
            </thead>
            <tbody>
        `;

        let linesOnThisPage = 0;
        while (linesOnThisPage < limit && currentRowIndex < rows.length) {
          const r = rows[currentRowIndex];
          html += `
            <tr>
              <td class="font-monospace fw-bold">${r.code}</td>
              <td>${r.desc}</td>
              <td class="text-center">${r.qty}</td>
              <td class="text-end">${r.unit}</td>
              <td class="text-end">${r.ht}</td>
              <td class="text-center">${r.isVat ? 'Y' : '-'}</td>
              <td class="text-end fw-bold">${r.ttc}</td>
            </tr>
          `;
          currentRowIndex++;
          linesOnThisPage++;
        }
        html += `</tbody></table>`;

        if (isLastPage) {
          html += `
            <div class="bottom-section">
              <div class="totals-grid">
                <div class="amount-words-box">
                  <div class="fw-bold text-uppercase small text-muted mb-1">Amount in words:</div>
                  <div class="fst-italic fw-bold text-dark" style="font-size: 0.8rem;">
                    ${amountToWords(data.totals.ttc, currentCurrency, currentLang)}
                  </div>
                </div>
                <div class="totals-box">
                  <div class="d-flex justify-content-between mb-1" style="font-size: 0.8rem;">
                    <span>Subtotal (HT):</span><span class="fw-bold">${document.getElementById('grand-ht').innerText}</span>
                  </div>
                  <div class="d-flex justify-content-between mb-2" style="font-size: 0.8rem;">
                    <span>VAT (19.25%):</span><span class="fw-bold">${document.getElementById('grand-vat').innerText}</span>
                  </div>
                  <div class="d-flex justify-content-between border-top pt-2 border-dark" style="font-size: 1rem; color: var(--smart-orange);">
                    <span class="fw-bold">TOTAL TTC:</span><span class="fw-black">${document.getElementById('grand-ttc').innerText}</span>
                  </div>
                </div>
              </div>

              <div class="remarks-box">
                <strong class="d-block text-uppercase text-muted small mb-1">Remarks / Notes:</strong>
                ${data.remarks}
              </div>

              <div class="signature-grid">
                <div class="sig-box">
                  <div class="sig-role">Issued By</div>
                  <div class="fw-bold small mt-2">${data.user}</div>
                  <div class="sig-line"></div>
                </div>
                <div class="sig-box">
                  <div class="sig-role">Validated By</div>
                  <div class="fw-bold small mt-2">${data.validator}</div>
                  <div class="sig-line"></div>
                </div>
                <div class="sig-box">
                  <div class="sig-role">Approved By</div>
                  <div class="fw-bold small mt-2">MANAGING DIRECTOR</div>
                  <div class="sig-line"></div>
                </div>
              </div>
            </div>
          `;
        } else {
          html += `<div style="margin-top:auto; text-align:center; font-style:italic; font-size:0.7rem; margin-bottom:10px;">...Continued on next page...</div>`;
        }

        html += `
          <div class="page-footer-container">
            <div class="bank-details">
              <div><strong>RC:</strong> RC/DLA/2021/B/2060 &nbsp;|&nbsp; <strong>NIU:</strong> M042116033580Q</div>
              <div><strong>Bank:</strong> AFRILAND FIRST BANK S.A. &nbsp;|&nbsp; <strong>Acct:</strong> 10005000610701841100193</div>
            </div>
            <div class="page-num">Page ${p} of ${totalPages}</div>
          </div>
        `;

        sheet.innerHTML = html;
        container.appendChild(sheet);
      }

      bsOffcanvas.hide();
      const modalEl = document.getElementById('printModal');
      const printModal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);

      modalEl.addEventListener('hidden.bs.modal', function () {
        bsOffcanvas.show();
      }, { once: true });

      setTimeout(() => { printModal.show(); }, 300);
    }

    // Initialize Table on Load
    renderTable();
    
  </script>

</body>
</html>
