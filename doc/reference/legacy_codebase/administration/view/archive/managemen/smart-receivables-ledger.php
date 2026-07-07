<?php
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['MANAGEMENT']);

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
$fullName  = $me['full_name'] ?: 'MANAGEMENT';
$firstName = trim(explode(' ', $fullName)[0] ?? 'Admin');

$roleLabelMap = [
  'ADMIN'      => 'SYSTEM ADMIN',
  'FINANCE'    => 'FINANCE',
  'SALES'      => 'SALES',
  'OPERATIONS' => 'OPERATIONS',
  'MANAGEMENT' => 'MANAGEMENT',
];
$role = strtoupper((string)($me['role'] ?? 'MANAGEMENT'));
$roleLabel = $roleLabelMap[$role] ?? 'MANAGEMENT';

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
  <title>Smart Receivables & Ageing Ledger | Smart LS</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&family=Montserrat:wght@400;500;600;700;800&family=Inconsolata:wght@400;700&display=swap" rel="stylesheet">

  <style>
    /* Page-specific styles ONLY (keeps index.php sidebar/topbar intact) */
    :root{
      --hs-blue: #1F99D8;
      --hs-blue-dark: #125b80;
      --hs-navy: #0F172A;
      --hs-orange: #EE7D04;
      --hs-bg: #F8FAFC;
      --hs-card: #FFFFFF;
      --hs-border: #E2E8F0;

      --age-current-bg: #DCFCE7; --age-current-text: #166534;
      --age-watch-bg: #FEF9C3; --age-watch-text: #854D0E;
      --age-critical-bg: #FEE2E2; --age-critical-text: #991B1B;
      --age-paid-bg: #F1F5F9; --age-paid-text: #64748B;

      --font-main: 'Manrope', sans-serif;
      --font-head: 'Montserrat', sans-serif;
      --font-mono: 'Inconsolata', monospace;
    }

    .srl-page {
      font-family: var(--font-main);
      color: var(--hs-navy);
      font-size: 0.875rem;
    }
    .srl-page h1, .srl-page h2, .srl-page h3, .srl-page h4, .srl-page h5, .srl-page .font-head { font-family: var(--font-head); }
    .srl-page .font-mono { font-family: var(--font-mono); letter-spacing: -0.3px; }
    .srl-page .fw-black { font-weight: 800; }
    .srl-page .text-orange { color: var(--hs-orange) !important; }

    .srl-page .btn { font-weight: 700; border-radius: 6px; padding: 0.5rem 1rem; font-size: 0.85rem; transition: all 0.2s; }
    .srl-page .btn-primary { background: var(--hs-blue); border-color: var(--hs-blue); }
    .srl-page .btn-primary:hover { background: var(--hs-blue-dark); border-color: var(--hs-blue-dark); }
    .srl-page .btn-orange { background: var(--hs-orange); border-color: var(--hs-orange); color: #fff; }
    .srl-page .btn-orange:hover { background: #d16d02; border-color: #d16d02; color: #fff; }
    .srl-page .btn-outline-secondary { border-color: #CBD5E1; color: #64748B; }
    .srl-page .btn-outline-secondary:hover { background: #F1F5F9; color: #0F172A; }

    .srl-page .page-header { display:flex; justify-content:space-between; align-items:center; gap:16px; margin-bottom: 18px; }
    .srl-page .page-title h2 { margin:0; font-weight:800; color: var(--hs-navy); }
    .srl-page .page-title p { margin:0; color:#64748B; font-size:0.9rem; }

    .srl-page .exchange-ticker {
      background: var(--hs-navy);
      color:#fff;
      padding: 8px 16px;
      border-radius: 30px;
      font-size: 0.8rem;
      font-weight: 600;
      display:flex;
      align-items:center;
      gap: 14px;
      white-space: nowrap;
    }
    .srl-page .rate-item { display:flex; align-items:center; gap:6px; }
    .srl-page .rate-val { font-family: var(--font-mono); color: var(--hs-orange); }

    .srl-page .kpi-row { display:grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 18px 0 20px; }
    @media (max-width: 1200px) { .srl-page .kpi-row { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 576px) { .srl-page .kpi-row { grid-template-columns: 1fr; } }

    .srl-page .kpi-card {
      background: #fff;
      border: 1px solid var(--hs-border);
      border-radius: 12px;
      padding: 18px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.02);
      display:flex;
      flex-direction:column;
    }
    .srl-page .kpi-label { font-size: 0.7rem; font-weight: 800; text-transform: uppercase; color:#64748B; margin-bottom: 6px; letter-spacing: 0.4px; }
    .srl-page .kpi-val { font-size: 1.5rem; font-weight: 900; color: var(--hs-navy); font-family: var(--font-mono); }
    .srl-page .kpi-sub { font-size: 0.75rem; color:#94A3B8; margin-top: 6px; display:flex; justify-content:space-between; align-items:center; }

    .srl-page .ledger-container {
      background: #fff;
      border: 1px solid var(--hs-border);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.02);
    }
    .srl-page .tab-ribbon { display:flex; border-bottom: 1px solid var(--hs-border); background: #F8FAFC; padding: 0 14px; }
    .srl-page .tab-btn {
      background: none;
      border: none;
      padding: 14px 16px;
      font-weight: 800;
      color: #64748B;
      border-bottom: 3px solid transparent;
      cursor: pointer;
      transition: all 0.2s;
      font-size: 0.85rem;
    }
    .srl-page .tab-btn:hover { color: var(--hs-blue); }
    .srl-page .tab-btn.active { color: var(--hs-blue); border-bottom-color: var(--hs-blue); background: #fff; }

    .srl-page .toolbar { padding: 14px 16px; display:flex; justify-content:space-between; align-items:center; gap: 12px; border-bottom: 1px solid var(--hs-border); background: #fff; flex-wrap: wrap; }

    .srl-page .smart-table { width: 100%; border-collapse: collapse; }
    .srl-page .smart-table th {
      background: #F8FAFC;
      padding: 12px 14px;
      text-align:left;
      font-size: 0.7rem;
      font-weight: 900;
      text-transform: uppercase;
      color:#64748B;
      border-bottom: 1px solid var(--hs-border);
      letter-spacing: 0.45px;
    }
    .srl-page .smart-table td { padding: 12px 14px; border-bottom: 1px solid #F1F5F9; font-size: 0.88rem; vertical-align: middle; }
    .srl-page .smart-table tr:hover { background: #FAFAFA; }

    .srl-page .status-badge { padding: 4px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 900; text-transform: uppercase; display:inline-flex; align-items:center; gap: 6px; }
    .srl-page .status-badge::before { content:''; width: 6px; height: 6px; border-radius: 50%; }
    .srl-page .st-current { background: var(--age-current-bg); color: var(--age-current-text); }
    .srl-page .st-current::before { background: var(--age-current-text); }
    .srl-page .st-watch { background: var(--age-watch-bg); color: var(--age-watch-text); }
    .srl-page .st-watch::before { background: var(--age-watch-text); }
    .srl-page .st-critical { background: var(--age-critical-bg); color: var(--age-critical-text); }
    .srl-page .st-critical::before { background: var(--age-critical-text); }
    .srl-page .st-closed { background: var(--age-paid-bg); color: var(--age-paid-text); }
    .srl-page .st-closed::before { background: var(--age-paid-text); }

    .srl-page .money { font-family: var(--font-mono); font-weight: 700; text-align:right; }
    .srl-page .curr-tag { font-size: 0.7rem; color:#94A3B8; font-weight: 900; margin-right: 4px; }

    .srl-page .modal-content { border:none; border-radius: 12px; }
    .srl-page .modal-header { background: #F8FAFC; border-bottom: 1px solid var(--hs-border); padding: 15px 20px; }
    .srl-page .modal-footer { border-top: 1px solid var(--hs-border); padding: 15px 20px; }
    .srl-page .form-label { font-size: 0.75rem; font-weight: 900; color:#475569; text-transform: uppercase; letter-spacing: 0.4px; }
    .srl-page .form-control, .srl-page .form-select { border-radius: 8px; font-size: 0.92rem; border-color: #CBD5E1; }
    .srl-page .form-control:focus, .srl-page .form-select:focus { border-color: var(--hs-blue); box-shadow: 0 0 0 3px rgba(31,153,216,0.15); }

    .srl-page .invoice-card { background: #F0F9FF; border: 1px solid #BAE6FD; padding: 14px; border-radius: 12px; margin-bottom: 16px; }
    .srl-page .inv-detail-row { display:flex; justify-content:space-between; gap: 12px; margin-bottom: 6px; font-size: 0.9rem; }
    .srl-page .inv-lbl { color:#64748B; font-weight: 800; }
    .srl-page .inv-val { color: var(--hs-navy); font-weight: 900; font-family: var(--font-mono); }
  </style>
</head>
<body>

  <!-- SIDEBAR (from index.php) -->
  <nav class="sidebar">
    <div class="sidebar-header">
        <a href="index" class="brand-logo"><i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span></a>
    </div>

    <div class="px-3 mb-2 mt-2">
        <a href="#" class="btn btn-primary w-100 text-start d-flex align-items-center" style="background-color: transparent; color: inherit; border: none; padding-left: 0;">
            <i class="fa-solid fa-house category-icon me-2"></i> 
            <span class="fw-bold">Management Dashboard</span> 
        </a>
    </div>

    <div class="sidebar-menu accordion" id="mgmtMenu">
        
        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#mgmt1">
                <span><i class="fa-solid fa-database category-icon"></i> 1. MASTER DATA MGMT</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="mgmt1" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
                <div class="sub-menu">
                    <a href="client-master-registry.php" class="sub-link">Client Master Registry</a>
                    <a href="supplier-master-registry.php" class="sub-link">Supplier Master Registry</a>
                    <a href="employee-master.php" class="sub-link">Employee Master Registry</a>
                    <a href="financial-dictionary.php" class="sub-link">Financial Dictionary</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#mgmt2">
                <span><i class="fa-solid fa-users category-icon"></i> 2. CRM & ACQUISITION</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="mgmt2" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
                <div class="sub-menu">
                    <a href="contact-us-intake.php" class="sub-link">Contact Us Intake</a>
                    <a href="partnership-portal-intake.php" class="sub-link">Partnership Portal Intake</a>
                    <a href="market-campaign-registration.php" class="sub-link">Marketing Campaign Register</a>
                    <a href="sales-pipelining.php" class="sub-link">Sales Pipeline</a>
                    <a href="smart-quote-intake.php" class="sub-link">Smart Quote Intake</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#mgmt3">
                <span><i class="fa-solid fa-calculator category-icon"></i> 3. COMMERCIAL & PRICING</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="mgmt3" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
                <div class="sub-menu">
                    <a href="margin-simulator-billing.php" class="sub-link">Margin Simulator & Pricing System</a>
                    <a href="extra-charges-simulator.php" class="sub-link">Extra Charges Simulator</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#mgmt4">
                <span><i class="fa-solid fa-truck-fast category-icon"></i> 4. LOGISTICS OPERATIONS</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="mgmt4" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
                <div class="sub-menu">
                    <a href="operations-registry.php" class="sub-link">Operations File Registry</a>
                    <a href="transit-order.php" class="sub-link">Transit Order (OT)</a>
                    <a href="operational-milestone-tracking.php" class="sub-link">Operational Milestone Tracking</a>
                    <a href="delivery-note.php" class="sub-link">Delivery Note</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#mgmt5">
                <span><i class="fa-solid fa-chart-line category-icon"></i> 5. JOB COST CONTROL</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="mgmt5" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
                <div class="sub-menu">
                    <a href="costing-module.php" class="sub-link">Costing Module</a>
                    <a href="cost-tracking.php" class="sub-link">Cost Tracking Master</a>
                    <a href="opportunity-cost-reconciliation.php" class="sub-link">Operational Cost Reconciliation</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#mgmt6">
                <span><i class="fa-solid fa-building-columns category-icon"></i> 6. FINANCE & TREASURY</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="mgmt6" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
                <div class="sub-menu">
                    <a href="cash-request.php" class="sub-link">Cash Request</a>
                    <a href="purchase-order.php" class="sub-link">Purchase Order</a>
                    <a href="performa-invoice-portal.php" class="sub-link">Proforma Invoice Portal</a>
                    <a href="final-invoice.php" class="sub-link">Final Invoice System</a>
                    <a href="smart-receivables-ledger.php" class="sub-link">Smart Receivables Ledger (SRL)</a>
                    <a href="debt-management.php" class="sub-link">Debt Management</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#mgmt7">
                <span><i class="fa-solid fa-folder-open category-icon"></i> 7. HR & ARCHIVE</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="mgmt7" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
                <div class="sub-menu">
                    <a href="user-role-management.php" class="sub-link">User & Role Management (IAM)</a>
                    <a href="payroll-management.php" class="sub-link">Payroll Management</a>
                    <a href="attendance-logs.php" class="sub-link">Attendance & Time Logging</a>
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

  <div class="top-navbar">
    <div>
      <h5 class="mb-0 fw-bold text-dark">Admin Governance</h5>
      <small class="text-muted" style="font-size: 0.7rem;">SYSTEM HEALTH & SECURITY OVERSIGHT</small>
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

  <!-- MAIN -->
  <div class="main-content px-4 pb-5 srl-page">
    <div class="row pt-4 mb-3">
      <div class="col-12">
        <div class="welcome-card d-flex justify-content-between align-items-center">
          <div>
            <h2 class="fw-bold mb-1"><?php echo e($greeting); ?>, <?php echo e($firstName); ?>!</h2>
            <p class="mb-0 opacity-75">Track invoices, monitor ageing buckets, and record receipts with POP references.</p>
          </div>
          <div class="text-end" style="min-width: 160px;">
            <div class="mb-1 text-uppercase text-white-50" style="font-size: 0.7rem; font-weight: 800;">Ledger Status</div>
            <div class="d-flex align-items-center justify-content-end gap-2">
              <i class="fa-solid fa-circle-check text-success fs-5"></i>
              <span class="fw-bold fs-5">ACTIVE</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="page-header">
      <div class="page-title">
        <h2>Receivables Ledger</h2>
        <p>Ageing analysis, balance tracking, and receipt posting.</p>
      </div>
      <div class="exchange-ticker" title="Live Spot Rates from Backend (mocked)">
        <i class="fa-solid fa-globe"></i>
        <div class="rate-item">USD: <span class="rate-val" id="rateUSD">620.50</span></div>
        <div style="opacity:0.25">|</div>
        <div class="rate-item">EUR: <span class="rate-val" id="rateEUR">655.95</span></div>
        <div style="opacity:0.25">|</div>
        <div class="rate-item text-orange">XAF BASE</div>
      </div>
    </div>

    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-label">Total Outstanding (XAF)</div>
        <div class="kpi-val" id="kpiTotal">0</div>
        <div class="kpi-sub">
          <span>Includes USD/EUR conv.</span>
          <i class="fa-solid fa-chart-line text-primary"></i>
        </div>
      </div>

      <div class="kpi-card">
        <div class="kpi-label">Overdue (60+ Days)</div>
        <div class="kpi-val text-danger" id="kpiCritical">0</div>
        <div class="kpi-sub">
          <span id="kpiCriticalCount">0 Files</span>
          <i class="fa-solid fa-triangle-exclamation text-danger"></i>
        </div>
      </div>

      <div class="kpi-card">
        <div class="kpi-label">Incoming / Healthy</div>
        <div class="kpi-val text-success" id="kpiCurrent">0</div>
        <div class="kpi-sub">
          <span>0–30 / not due</span>
          <i class="fa-solid fa-clock text-success"></i>
        </div>
      </div>

      <div class="kpi-card">
        <div class="kpi-label">Collections (All Time)</div>
        <div class="kpi-val" id="kpiCollected">0</div>
        <div class="kpi-sub">
          <span>Receipts logged</span>
          <i class="fa-solid fa-check-double text-muted"></i>
        </div>
      </div>
    </div>

    <div class="ledger-container">
      <div class="tab-ribbon">
        <button class="tab-btn active" onclick="switchTab('ALL', event)">All Open Invoices</button>
        <button class="tab-btn" onclick="switchTab('AGEING', event)">Ageing Analysis</button>
        <button class="tab-btn" onclick="switchTab('CLOSED', event)">Closed / Paid</button>
      </div>

      <div class="toolbar">
        <div class="d-flex align-items-center gap-3">
          <div class="input-group input-group-sm" style="width: 320px;">
            <span class="input-group-text bg-white"><i class="fa-solid fa-search"></i></span>
            <input type="text" class="form-control" id="searchInput" placeholder="Search Client, File Ref, Invoice #..." onkeyup="renderTable()">
          </div>
        </div>
        <div class="d-flex gap-2">
          <button class="btn btn-outline-secondary btn-sm" onclick="importFromOps()">
            <i class="fa-solid fa-cloud-arrow-down me-2"></i>Sync Ops DB
          </button>
          <button class="btn btn-orange btn-sm" onclick="exportLedger()">
            <i class="fa-solid fa-file-excel me-2"></i>Export Report
          </button>
        </div>
      </div>

      <div class="table-responsive">
        <table class="smart-table">
          <thead id="tableHead"></thead>
          <tbody id="tableBody"></tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- PAYMENT MODAL -->
  <div class="modal fade" id="paymentModal" tabindex="-1" data-bs-backdrop="static">
    <div class="modal-dialog modal-lg">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title fw-bold">
            <i class="fa-solid fa-cash-register text-success me-2"></i>Record Payment
          </h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
        </div>

        <div class="modal-body">
          <div class="invoice-card">
            <div class="d-flex justify-content-between align-items-center mb-3">
              <h6 class="fw-bold m-0 text-primary" id="payInvNum">INV-000</h6>
              <span class="badge bg-white text-dark border" id="payClient">Client Name</span>
            </div>
            <div class="inv-detail-row">
              <span class="inv-lbl">Original Amount:</span>
              <span class="inv-val" id="payOrigAmt">0</span>
            </div>
            <div class="inv-detail-row">
              <span class="inv-lbl">Balance Due:</span>
              <span class="inv-val text-danger" id="payBalDue" style="font-size:1.1rem">0</span>
            </div>
            <div class="inv-detail-row">
              <span class="inv-lbl">Currency:</span>
              <span class="inv-val" id="payCurr">XAF</span>
            </div>
          </div>

          <form id="paymentForm">
            <div class="row g-3">
              <div class="col-md-6">
                <label class="form-label">Payment Date</label>
                <input type="date" class="form-control" id="payDate" required>
              </div>
              <div class="col-md-6">
                <label class="form-label">Means of Payment</label>
                <select class="form-select" id="payMethod" onchange="toggleBankFields()" required>
                  <option value="">Select Method...</option>
                  <option value="BANK">Bank Transfer / Cheque</option>
                  <option value="CASH">Cash Deposit</option>
                </select>
              </div>

              <div class="col-md-6 bank-field">
                <label class="form-label">Bank Name</label>
                <select class="form-select" id="payBank">
                  <option value="">Select Bank...</option>
                  <option value="UBA">UBA Cameroon</option>
                  <option value="AFRILAND">Afriland First Bank</option>
                  <option value="ECOBANK">Ecobank</option>
                  <option value="SGC">Société Générale</option>
                </select>
              </div>
              <div class="col-md-6 bank-field">
                <label class="form-label">Transaction Ref / Cheque #</label>
                <input type="text" class="form-control" id="payRef" placeholder="e.g. TRX-9982100">
              </div>

              <div class="col-12">
                <label class="form-label">Proof of Payment (POP) Reference</label>
                <div class="input-group">
                  <span class="input-group-text"><i class="fa-solid fa-file-contract"></i></span>
                  <input type="text" class="form-control" id="payPop" placeholder="Vault Ref (e.g. DOC-V-2025-004)" required>
                </div>
                <div class="form-text text-muted">Enter the unique Document ID generated by the Vault.</div>
              </div>

              <div class="col-12"><hr class="my-2"></div>

              <div class="col-md-6 offset-md-6">
                <label class="form-label text-success">Amount Received</label>
                <div class="input-group">
                  <span class="input-group-text fw-bold" id="payCurrLabel">XAF</span>
                  <input type="number" class="form-control fw-bold text-end" id="payAmount" step="0.01" required>
                </div>
              </div>
            </div>
          </form>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-light border" data-bs-dismiss="modal">Cancel</button>
          <button type="button" class="btn btn-success fw-bold px-4" onclick="submitPayment()">Confirm Receipt</button>
        </div>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

  <script>
    /**
     * SMART RECEIVABLES LEDGER (SRL) ENGINE
     * =====================================
     * Connects to backend APIs for real-time invoice tracking
     */

    // --- CONFIGURATION ---
    const API_BASE = '../../api/receivables-ledger/smart-receivables.php';
    
    const EXCHANGE_RATES = {
      USD: 620.50,
      EUR: 655.95,
      XAF: 1.00
    };

    // Display rates on UI
    document.getElementById('rateUSD').innerText = EXCHANGE_RATES.USD.toFixed(2);
    document.getElementById('rateEUR').innerText = EXCHANGE_RATES.EUR.toFixed(2);

    let LEDGER = [];
    let CURRENT_TAB = 'ALL';

    // --- INITIALIZATION ---
    document.addEventListener('DOMContentLoaded', () => {
      const payDate = document.getElementById('payDate');
      if (payDate) payDate.valueAsDate = new Date();
      
      loadLedger();
      loadKPIs();
    });

    // --- API CALLS ---

    async function loadLedger() {
      try {
        const response = await fetch(`${API_BASE}?action=get_all_invoices`);
        const data = await response.json();
        
        if (data.success) {
          LEDGER = data.invoices;
          renderTable();
        } else {
          alert('Error loading ledger: ' + data.error);
        }
      } catch (error) {
        console.error('Failed to load ledger:', error);
        alert('Network error. Please try again.');
      }
    }

    async function loadKPIs() {
      try {
        const response = await fetch(`${API_BASE}?action=get_kpis`);
        const data = await response.json();
        
        if (data.success) {
          computeAndDisplayKPIs(data.kpis);
        }
      } catch (error) {
        console.error('Failed to load KPIs:', error);
      }
    }

    function computeAndDisplayKPIs(kpis) {
        let totalOutstanding = 0;
        let criticalAmount = 0;
        let criticalCount = 0;
        let incomingAmount = 0;

        // Process open invoices data
        if (kpis.open_invoices_data && Array.isArray(kpis.open_invoices_data)) {
            kpis.open_invoices_data.forEach(inv => {
                const balance = inv.balance || 0;
                
                // All balances are already in XAF from backend
                totalOutstanding += balance;
                
                const daysOverdue = inv.days_overdue || 0;
                
                // Critical: 60+ days overdue
                if (daysOverdue >= 60) {
                    criticalAmount += balance;
                    criticalCount++;
                }
                
                // Incoming/Healthy: 0-30 days (including not yet due)
                if (daysOverdue <= 30) {
                    incomingAmount += balance;
                }
            });
        }

        // Update KPI displays
        document.getElementById('kpiTotal').innerText = formatMoney(totalOutstanding);
        document.getElementById('kpiCritical').innerText = formatMoney(criticalAmount);
        document.getElementById('kpiCriticalCount').innerText = `${criticalCount} Files`;
        document.getElementById('kpiCurrent').innerText = formatMoney(incomingAmount);
        document.getElementById('kpiCollected').innerText = formatMoney(kpis.total_collections_xaf || 0);
    }

    async function importFromOps() {
      if (!confirm('Sync invoices from Operations Database?')) return;
      
      try {
        const response = await fetch(`${API_BASE}?action=sync_from_ops`);
        const data = await response.json();
        
        if (data.success) {
          alert(data.message);
          if (data.missing_invoices && data.missing_invoices.length > 0) {
            console.warn('Missing invoices:', data.missing_invoices);
          }
          loadLedger();
          loadKPIs();
        } else {
          alert('Sync failed: ' + data.error);
        }
      } catch (error) {
        console.error('Sync error:', error);
        alert('Network error during sync.');
      }
    }

    // --- TABLE RENDERING ---

    function switchTab(tab, ev) {
      CURRENT_TAB = tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      if (ev && ev.target) ev.target.classList.add('active');
      renderTable();
    }

    function renderTable() {
        const head = document.getElementById('tableHead');
        const body = document.getElementById('tableBody');
        const search = (document.getElementById('searchInput').value || '').toLowerCase();

        body.innerHTML = '';

        // Different headers for different tabs
        if (CURRENT_TAB === 'AGEING') {
            head.innerHTML = `
                <tr>
                    <th>Client / File</th>
                    <th>Inv #</th>
                    <th class="text-end">Balance (Orig)</th>
                    <th class="text-center">Status</th>
                    <th class="text-center">0-30 Days</th>
                    <th class="text-center">31-60 Days</th>
                    <th class="text-center text-danger">60+ Days</th>
                    <th class="text-end">Action</th>
                </tr>
            `;
        } else {
            head.innerHTML = `
                <tr>
                    <th>Status</th>
                    <th>Inv # / Date</th>
                    <th>Client / File Ref</th>
                    <th>Due Date</th>
                    <th class="text-end">Inv Amount</th>
                    <th class="text-end">Paid</th>
                    <th class="text-end">Balance</th>
                    <th class="text-end">Action</th>
                </tr>
            `;
        }

        // FIXED: Filter logic
        const data = LEDGER.filter(i => {
            // Search filter
            const matchSearch =
                (i.client_name || '').toLowerCase().includes(search) ||
                (i.invoice_no || '').toLowerCase().includes(search) ||
                (i.file_reference || '').toLowerCase().includes(search);

            // Tab filter - FIXED
            let matchTab = true;
            
            if (CURRENT_TAB === 'CLOSED') {
                // Show only closed/paid FINAL INVOICES (exclude proformas)
                matchTab = (
                    i.invoice_type === 'INVOICE' && 
                    (i.status === 'PAID' || i.ageing_status === 'CLOSED' || i.balance <= 0)
                );
            } else if (CURRENT_TAB === 'ALL' || CURRENT_TAB === 'AGEING') {
                // Show only open invoices (not fully paid)
                matchTab = (i.status !== 'PAID' && i.ageing_status !== 'CLOSED' && i.balance > 0);
            }
            
            return matchSearch && matchTab;
        });

        if (data.length === 0) {
            const msg = CURRENT_TAB === 'CLOSED' 
                ? 'No closed/paid invoices found.' 
                : 'No open invoices found matching criteria.';
            body.innerHTML = `<tr><td colspan="8" class="text-center py-5 text-muted">${msg}</td></tr>`;
            return;
        }

        data.forEach(inv => {
            const statusBadge = getStatusBadge(inv.ageing_status, inv.days_overdue);
            const tr = document.createElement('tr');

            if (CURRENT_TAB === 'AGEING') {
                // Ageing Analysis View
                const bal = formatCurr(inv.balance, inv.currency);
                const balInBucket = (days) => {
                    if (days === '0-30' && inv.days_overdue >= 0 && inv.days_overdue <= 30) return bal;
                    if (days === '31-60' && inv.days_overdue > 30 && inv.days_overdue < 60) return bal;
                    if (days === '60+' && inv.days_overdue >= 60) return bal;
                    return '-';
                };

                tr.innerHTML = `
                    <td><div class="fw-bold">${inv.client_name}</div><small class="text-muted">${inv.file_reference}</small></td>
                    <td class="font-mono">${inv.invoice_no}</td>
                    <td class="text-end fw-bold">${bal}</td>
                    <td class="text-center">${statusBadge}</td>
                    <td class="text-center font-mono text-success">${balInBucket('0-30')}</td>
                    <td class="text-center font-mono" style="color:#d97706">${balInBucket('31-60')}</td>
                    <td class="text-center font-mono text-danger fw-bold">${balInBucket('60+')}</td>
                    <td class="text-end">
                        ${inv.balance > 0 && inv.status !== 'PAID'
                            ? `<button class="btn btn-sm btn-outline-primary" onclick="openPayment(${inv.invoice_id}, '${inv.invoice_type}')"><i class="fa-solid fa-money-bill-wave"></i></button>`
                            : `<span class="text-muted small"><i class="fa-solid fa-check"></i></span>`
                        }
                    </td>
                `;
            } else {
                // Standard List View (ALL or CLOSED)
                const isOverdue = inv.days_overdue > 0 && inv.balance > 0;
                const isPaid = inv.status === 'PAID' || inv.balance <= 0;
                
                tr.innerHTML = `
                    <td>${statusBadge}</td>
                    <td><div class="fw-bold">${inv.invoice_no}</div><small class="text-muted">${formatDate(inv.issue_date)}</small></td>
                    <td><div class="fw-bold">${inv.client_name}</div><small class="text-muted">${inv.file_reference}</small></td>
                    <td class="font-mono ${isOverdue && !isPaid ? 'text-danger fw-bold' : ''}">${inv.due_date}</td>
                    <td class="money"><span class="curr-tag">${inv.currency}</span>${formatNumber(inv.invoice_amount)}</td>
                    <td class="money text-success"><span class="curr-tag">${inv.currency}</span>${formatNumber(inv.amount_paid)}</td>
                    <td class="money fw-black ${inv.balance > 0 && !isPaid ? 'text-danger' : 'text-muted'}">
                        <span class="curr-tag">${inv.currency}</span>${formatNumber(inv.balance)}
                    </td>
                    <td class="text-end">
                        ${!isPaid
                            ? `<button class="btn btn-sm btn-primary" onclick="openPayment(${inv.invoice_id}, '${inv.invoice_type}')">Pay</button>`
                            : `<span class="text-success small"><i class="fa-solid fa-check-circle"></i> Paid</span>`
                        }
                    </td>
                `;
            }

            body.appendChild(tr);
        });
    }


    function getStatusBadge(status, daysOverdue) {
      const badges = {
        'CLOSED': '<span class="status-badge st-closed">PAID</span>',
        'CRITICAL': `<span class="status-badge st-critical">CRITICAL (${daysOverdue}D)</span>`,
        'WATCH': `<span class="status-badge st-watch">WATCH (${daysOverdue}D)</span>`,
        'OVERDUE': `<span class="status-badge st-watch">OVERDUE (${daysOverdue}D)</span>`,
        'CURRENT': '<span class="status-badge st-current">CURRENT</span>'
      };
      return badges[status] || '<span class="status-badge">UNKNOWN</span>';
    }

    // --- PAYMENT MODAL ---

    let activePaymentInv = null;

    async function openPayment(invoiceId, invoiceType = null) {
        try {
            let url = `${API_BASE}?action=get_invoice_detail&invoice_id=${invoiceId}`;
            if (invoiceType) {
                url += `&invoice_type=${invoiceType}`;
            }
            
            const response = await fetch(url);
            const data = await response.json();
            
            if (!data.success) {
                alert('Error loading invoice: ' + data.error);
                return;
            }

            const inv = data.invoice;
            activePaymentInv = inv;

            // Check if already paid
            if (inv.balance <= 0) {
                alert('This invoice is already fully paid.');
                return;
            }

            document.getElementById('payInvNum').innerText = inv.invoice_no;
            document.getElementById('payClient').innerText = inv.client_name;
            document.getElementById('payOrigAmt').innerText = formatCurr(inv.invoice_amount, inv.currency);
            document.getElementById('payBalDue').innerText = formatCurr(inv.balance, inv.currency);
            document.getElementById('payCurr').innerText = inv.currency;
            document.getElementById('payCurrLabel').innerText = inv.currency;

            // Set max amount to balance
            const amountInput = document.getElementById('payAmount');
            amountInput.max = inv.balance;
            amountInput.value = inv.balance.toFixed(2);

            document.getElementById('paymentForm').reset();
            document.getElementById('payDate').valueAsDate = new Date();
            amountInput.value = inv.balance.toFixed(2);
            toggleBankFields();

            new bootstrap.Modal(document.getElementById('paymentModal')).show();
        } catch (error) {
            console.error('Error opening payment modal:', error);
            alert('Network error. Please try again.');
        }
    }


    function toggleBankFields() {
      const method = document.getElementById('payMethod').value;
      const fields = document.querySelectorAll('.bank-field');
      const bankInput = document.getElementById('payBank');
      const refInput = document.getElementById('payRef');

      if (method === 'CASH') {
        fields.forEach(f => f.style.opacity = '0.3');
        bankInput.disabled = true;
        refInput.disabled = true;
        bankInput.value = "";
        refInput.value = "CASH-DEP-" + Math.floor(Math.random() * 10000);
      } else {
        fields.forEach(f => f.style.opacity = '1');
        bankInput.disabled = false;
        refInput.disabled = false;
        refInput.value = "";
      }
    }

    async function submitPayment() {
        if (!activePaymentInv) {
            alert("No invoice selected.");
            return;
        }

        const amt = parseFloat(document.getElementById('payAmount').value);
        const popRef = (document.getElementById('payPop').value || '').trim();
        const payDate = document.getElementById('payDate').value;
        const payMethod = document.getElementById('payMethod').value;
        const bankName = document.getElementById('payBank').value;
        const transRef = document.getElementById('payRef').value;

        if (!amt || amt <= 0) {
            alert("Please enter a valid payment amount.");
            return;
        }

        if (amt > activePaymentInv.balance) {
            alert(`Payment amount (${formatCurr(amt, activePaymentInv.currency)}) exceeds balance (${formatCurr(activePaymentInv.balance, activePaymentInv.currency)})`);
            return;
        }

        if (!popRef) {
            alert("POP Reference is mandatory.");
            return;
        }

        if (!payMethod) {
            alert("Please select payment method.");
            return;
        }

        const payload = {
            invoice_id: activePaymentInv.invoice_id,
            invoice_type: activePaymentInv.invoice_type, // IMPORTANT: Include type
            amount_paid: amt,
            payment_date: payDate,
            payment_method: payMethod,
            bank_name: bankName,
            transaction_ref: transRef,
            pop_reference: popRef,
            remarks: ''
        };

        try {
            const response = await fetch(`${API_BASE}?action=record_payment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (data.success) {
                bootstrap.Modal.getInstance(document.getElementById('paymentModal')).hide();
                
                const msg = data.is_fully_paid 
                    ? `Payment recorded! Invoice fully paid and closed.`
                    : `Payment of ${formatCurr(amt, activePaymentInv.currency)} recorded. Remaining balance: ${formatCurr(data.new_balance, activePaymentInv.currency)}`;
                
                alert(msg);
                
                // Reload data
                loadLedger();
                loadKPIs();
            } else {
                alert('Payment failed: ' + data.error);
            }
        } catch (error) {
            console.error('Payment submission error:', error);
            alert('Network error. Payment not recorded.');
        }
    }


    // --- UTILITY FUNCTIONS ---

    function formatMoney(val) {
      const n = Number(val || 0);
      return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }

    function formatNumber(val) {
      const n = Number(val || 0);
      return n.toLocaleString();
    }

    function formatCurr(val, curr) {
      const n = Number(val || 0);
      try {
        return n.toLocaleString(undefined, { style: 'currency', currency: curr });
      } catch (e) {
        return `${curr} ${n.toLocaleString()}`;
      }
    }

    function formatDate(dateStr) {
      if (!dateStr) return 'N/A';
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-GB'); // DD/MM/YYYY
    }

    function exportLedger() {
      alert("Excel export feature coming soon...");
    }
  </script>
</body>
</html>
