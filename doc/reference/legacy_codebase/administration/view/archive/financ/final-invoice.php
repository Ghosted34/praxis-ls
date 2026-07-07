<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'FINANCE', 'MANAGEMENT']);

// --- Fetch current user details ---
$employeeId = (string)($_SESSION['auth']['employee_id'] ?? '');
$userId     = (int)($_SESSION['auth']['user_id'] ?? 0);
$userRole   = strtoupper($_SESSION['auth']['role'] ?? 'GUEST');

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
$fullName  = $me['full_name'] ?: 'User';
$firstName = trim(explode(' ', $fullName)[0] ?? 'User');

$roleLabelMap = [
  'ADMIN'      => 'SYSTEM ADMIN',
  'FINANCE'    => 'FINANCE',
  'SALES'      => 'SALES',
  'OPERATIONS' => 'OPERATIONS',
  'MANAGEMENT' => 'MANAGEMENT',
];
$role = strtoupper((string)($me['role'] ?? 'GUEST'));
$roleLabel = $roleLabelMap[$role] ?? $role;

// --- Avatar ---
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
  <meta name="description" content="Smart LS Enterprise - Final Invoice & Profitability System">
  <meta name="author" content="Smart Logistics IT Division">
  <title>Final Invoice System | Smart LS</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&family=Montserrat:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">

  <style>
    /* ==================================================================================
       FINAL INVOICE (page-only styling)
       NOTE: Topbar + Sidebar are inherited from ../../css/admin.css (index.php shell).
       ================================================================================== */

    :root {
      /* Brand palette */
      --brand-blue: #1F99D8;
      --brand-blue-hover: #167ab0;
      --brand-dark: #055B83;
      --brand-orange: #EE7D04;
      --brand-surface: #F8FAFC;
      --brand-white: #FFFFFF;
      --brand-text: #1E293B;
      --brand-muted: #64748B;
      --brand-border: #E2E8F0;

      /* Semantic status colors */
      --st-draft-bg: #F1F5F9;  --st-draft-fg: #475569;
      --st-pending-bg: #FFF7ED; --st-pending-fg: #C2410C;
      --st-approved-bg: #F0FDF4; --st-approved-fg: #15803D;
      --st-paid-bg: #ECFCCB; --st-paid-fg: #365314;
      --st-void-bg: #FEF2F2; --st-void-fg: #991B1B;

      /* Layering (ensure editor stays above fixed shell) */
      --z-offcanvas: 1100;
      --z-modal: 1200;
    }

    body {
      font-family: 'Manrope', sans-serif;
      background-color: var(--brand-surface);
      color: var(--brand-text);
      overflow-x: hidden;
    }

    .font-head { font-family: 'Montserrat', sans-serif; letter-spacing: -0.02em; }
    .font-mono { font-family: 'JetBrains Mono', monospace; }
    .fw-900 { font-weight: 900; }
    .fw-800 { font-weight: 800; }
    .fw-700 { font-weight: 700; }
    .fw-600 { font-weight: 600; }

    .text-orange { color: var(--brand-orange) !important; }
    .border-orange { border-color: var(--brand-orange) !important; }
    .cursor-pointer { cursor: pointer; }

    /* KPI grid */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 24px;
      margin-bottom: 24px;
    }
    .kpi-card {
      background: #FFFFFF;
      border: 1px solid var(--brand-border);
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 2px 4px -2px rgba(0,0,0,0.05);
      transition: transform 0.2s, box-shadow 0.2s;
      position: relative;
      overflow: hidden;
    }
    .kpi-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 15px 30px -5px rgba(0,0,0,0.08);
    }
    .kpi-title {
      font-size: 0.75rem;
      font-weight: 800;
      color: var(--brand-muted);
      text-transform: uppercase;
      margin-bottom: 10px;
      letter-spacing: 0.5px;
    }
    .kpi-metric {
      font-size: 1.7rem;
      font-weight: 800;
      color: var(--brand-text);
      margin-bottom: 4px;
      line-height: 1;
      letter-spacing: -1px;
      font-family: 'JetBrains Mono', monospace;
    }
    .kpi-sub {
      font-size: 0.75rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--brand-muted);
    }
    .kpi-profit {
      background: linear-gradient(135deg, #0f172a 0%, #334155 100%);
      border: none;
      color: #fff;
    }
    .kpi-profit .kpi-title { color: #94a3b8; }
    .kpi-profit .kpi-metric { color: #fff; }
    .kpi-profit i { color: #4ade80; }

    /* Register container */
    .register-container {
      background: #FFFFFF;
      border: 1px solid var(--brand-border);
      border-radius: 12px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      min-height: 560px;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.02);
    }
    .reg-header {
      padding: 16px 18px;
      border-bottom: 1px solid var(--brand-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #FFFFFF;
      gap: 12px;
      flex-wrap: wrap;
    }
    .reg-body {
      flex: 1;
      overflow: auto;
      background: #fff;
    }
    .data-table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      min-width: 980px;
    }
    .data-table th {
      position: sticky;
      top: 0;
      background: #F8FAFC;
      z-index: 10;
      padding: 14px 16px;
      text-align: left;
      font-size: 0.7rem;
      font-weight: 800;
      text-transform: uppercase;
      color: var(--brand-muted);
      border-bottom: 2px solid var(--brand-border);
      white-space: nowrap;
      box-shadow: 0 2px 4px rgba(0,0,0,0.03);
    }
    .data-table td {
      padding: 14px 16px;
      border-bottom: 1px solid var(--brand-border);
      font-size: 0.9rem;
      color: #334155;
      vertical-align: middle;
    }
    .data-table tr:hover { background-color: #F1F5F9; cursor: pointer; }

    .status-pill {
      padding: 5px 12px;
      border-radius: 50px;
      font-size: 0.7rem;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .status-pill::before {
      content: '';
      display: block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }
    .st-draft { background: var(--st-draft-bg); color: var(--st-draft-fg); border: 1px solid #CBD5E1; }
    .st-pending { background: var(--st-pending-bg); color: var(--st-pending-fg); border: 1px solid #FFEDD5; }
    .st-approved { background: var(--st-approved-bg); color: var(--st-approved-fg); border: 1px solid #DCFCE7; }
    .st-paid { background: var(--st-paid-bg); color: var(--st-paid-fg); border: 1px solid #BEF264; }
    .st-void { background: var(--st-void-bg); color: var(--st-void-fg); border: 1px solid #FECACA; }

    /* Editor / Offcanvas */
    .offcanvas-xl {
      width: 96vw !important;
      max-width: 1800px;
      border-left: none;
      box-shadow: -10px 0 40px rgba(0,0,0,0.15);
      z-index: var(--z-offcanvas) !important;
    }
    .editor-shell { display: flex; flex-direction: column; height: 100%; background: #F1F5F9; }
    .editor-top {
      background: #FFFFFF;
      border-bottom: 1px solid var(--brand-border);
      padding: 18px 22px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
      gap: 12px;
      flex-wrap: wrap;
    }
    .editor-nav {
      padding: 0 22px;
      background: #fff;
      border-bottom: 1px solid var(--brand-border);
      display: flex;
      gap: 24px;
      flex-shrink: 0;
      flex-wrap: wrap;
    }
    .editor-tab {
      padding: 14px 0;
      border-bottom: 3px solid transparent;
      font-weight: 700;
      color: var(--brand-muted);
      cursor: pointer;
      transition: all 0.2s;
      font-size: 0.9rem;
    }
    .editor-tab.active { color: var(--brand-dark); border-bottom-color: var(--brand-orange); }

    .editor-content { flex: 1; overflow-y: auto; padding: 22px; display: none; }
    .editor-content.active { display: block; }

    .sheet-card {
      background: #FFFFFF;
      border-radius: 10px;
      border: 1px solid var(--brand-border);
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.02);
      overflow: hidden;
      margin-bottom: 18px;
    }
    .sheet-table { width: 100%; border-collapse: collapse; }
    .sheet-table th {
      background: #F8FAFC;
      padding: 12px 14px;
      text-transform: uppercase;
      font-size: 0.7rem;
      color: var(--brand-muted);
      border-bottom: 1px solid var(--brand-border);
      font-weight: 800;
      white-space: nowrap;
    }
    .sheet-table td { padding: 8px 14px; border-bottom: 1px solid var(--brand-border); vertical-align: top; }

    .sheet-input {
      width: 100%;
      border: 1px solid transparent;
      border-radius: 6px;
      padding: 6px 8px;
      font-size: 0.9rem;
      transition: all 0.2s;
    }
    .sheet-input:hover { background: #F1F5F9; }
    .sheet-input:focus {
      background: #FFFFFF;
      border-color: var(--brand-blue);
      outline: none;
      box-shadow: 0 0 0 3px rgba(31, 153, 216, 0.1);
    }
    .input-mono { font-family: 'JetBrains Mono', monospace; font-weight: 700; text-align: right; }

    .calc-box {
      background: #fff;
      padding: 18px;
      border: 1px solid var(--brand-border);
      border-radius: 10px;
    }
    .calc-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 0.9rem; color: var(--brand-muted); }
    .calc-row.grand { border-top: 1px solid var(--brand-border); padding-top: 10px; margin-top: 10px; font-weight: 900; color: var(--brand-text); font-size: 1.05rem; }
    .calc-row.balance {
      background: #F0FDF4;
      padding: 10px;
      border-radius: 8px;
      color: #166534;
      font-weight: 900;
      border: 1px solid #bbf7d0;
      margin-top: 10px;
    }

    /* Print stage (kept from your engine) */
    @media print {
      @page { size: A4; margin: 0; }
      body { background: white; margin: 0; }
      body > *:not(#print-stage) { display: none !important; }
      #print-stage {
        display: block !important;
        position: absolute;
        top: 0; left: 0;
        width: 100%;
        height: 100%;
        background: white;
      }
    }
    #print-stage { display: none; background: #525659; padding: 40px; min-height: 100vh; }

    /* Small shell helpers */
    .page-head {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
  </style>
</head>
<body>

  <!-- SIDEBAR (copied from index.php shell) -->
   <nav class="sidebar">
    <div class="sidebar-header">
        <a href="index.php" class="brand-logo"><i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span></a>
    </div>

    <div class="px-3 mb-2 mt-2">
        <a href="index.php" class="btn btn-primary w-100 text-start d-flex align-items-center" style="background-color: transparent; color: inherit; border: none; padding-left: 0;">
            <i class="fa-solid fa-house category-icon me-2"></i> 
            <span class="fw-bold">Finance Dashboard</span> 
        </a>
    </div>

    <div class="sidebar-menu accordion" id="financeMenu">
        
        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#fin1">
                <span><i class="fa-solid fa-database category-icon"></i> 1. MASTER DATA MGMT</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="fin1" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                <div class="sub-menu">
                    <a href="client-master-registry.php" class="sub-link">Client Master Registry</a>
                    <a href="supplier-master-registry.php" class="sub-link">Supplier Master Registry</a>
                    <a href="employee-master.php" class="sub-link">Employee Master Registry</a>
                    <a href="financial-dictionary copy.php" class="sub-link">Financial Dictionary</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#fin2">
                <span><i class="fa-solid fa-users category-icon"></i> 2. CRM & ACQUISITION</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="fin2" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                <div class="sub-menu">
                    <a href="partnership-portal-intake.php" class="sub-link">Partnership Portal Intake</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#fin3">
                <span><i class="fa-solid fa-calculator category-icon"></i> 3. COMMERCIAL & PRICING</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="fin3" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                <div class="sub-menu">
                    <a href="margin-simulator-billing.php" class="sub-link">Margin Simulator & Pricing System</a>
                    <a href="extra-charges-simulator.php" class="sub-link">Extra Charges Simulator</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#fin4">
                <span><i class="fa-solid fa-truck-fast category-icon"></i> 4. LOGISTICS OPERATIONS</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="fin4" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                <div class="sub-menu">
                    <a href="operations-registry.php" class="sub-link">Operations File Registry</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#fin5">
                <span><i class="fa-solid fa-chart-line category-icon"></i> 5. JOB COST CONTROL</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="fin5" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                <div class="sub-menu">
                    <a href="costing-module.php" class="sub-link">Costing Module</a>
                    <a href="cost-tracking.php" class="sub-link">Cost Tracking Master</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#fin6">
                <span><i class="fa-solid fa-building-columns category-icon"></i> 6. FINANCE & TREASURY</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="fin6" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                <div class="sub-menu">
                    <a href="cash-request.php" class="sub-link">Cash Request</a>
                    <a href="purchase-order.php" class="sub-link">Purchase Order</a>
                    <a href="performa-invoice-portal.php" class="sub-link">Proforma Invoice Portal</a>
                    <a href="final-invoice-portal.php" class="sub-link">Final Invoice System</a>
                    <a href="smart-receivable.php" class="sub-link">Smart Receivables Ledger (SRL)</a>
                    <a href="debt-management.php" class="sub-link">Debt Management</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#fin7">
                <span><i class="fa-solid fa-folder-open category-icon"></i> 7. HR & ARCHIVE</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="fin7" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                <div class="sub-menu">
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
      <h5 class="mb-0 fw-bold text-dark">Cost Tracking</h5>
      <small class="text-muted" style="font-size: 0.7rem;">OPERATIONAL EXPENSE MONITORING</small>
    </div>

    <div class="d-flex align-items-center gap-4">
      <div class="clock-pill">
        <span id="realtime-clock" class="font-mono">12:00:00</span>
        <button class="btn-clock border-0 bg-transparent p-0 ms-2" id="btn-clock" onclick="toggleClock()">
          <i class="fa-solid fa-fingerprint"></i>
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
  <!-- MAIN CONTENT (index.php shell container) -->
  <div class="main-content px-4 pb-5">

    <div class="pt-4 mb-3 page-head">
      <div>
        <div class="small text-muted mb-1"><?php echo e($greeting); ?>, <?php echo e($firstName); ?>.</div>
        <h3 class="fw-800 font-head mb-0">Invoice Register</h3>
        <div class="text-muted small">Manage Final Invoices, Actual Profit analysis and Payments.</div>
      </div>
      
      <!-- New Invoice Button moved here -->
      <button class="btn btn-dark fw-bold shadow-sm px-3" id="btn-create" onclick="app.createInvoice()">
        <i class="fa-solid fa-plus me-2"></i>New Invoice
      </button>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-title">Total Invoiced (MTD)</div>
        <div class="kpi-metric" id="kpi-rev">0</div>
        <div class="kpi-sub text-success"><i class="fa-solid fa-arrow-up"></i> Gross Revenue</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-title">Total Actual Costs (MTD)</div>
        <div class="kpi-metric" id="kpi-cost">0</div>
        <div class="kpi-sub text-danger"><i class="fa-solid fa-arrow-down"></i> Ops Expenses</div>
      </div>

      <div class="kpi-card kpi-profit">
        <div class="kpi-title">Net Realized Margin</div>
        <div class="kpi-metric" id="kpi-margin">0</div>
        <div class="kpi-sub"><i class="fa-solid fa-chart-pie"></i> Revenue - Actual Cost (OCR)</div>
      </div>

      <div class="kpi-card border-orange">
        <div class="kpi-title text-orange">Outstanding / Unpaid</div>
        <div class="kpi-metric text-orange" id="kpi-due">0</div>
        <div class="kpi-sub">Awaiting Payment</div>
      </div>
    </div>

    <div class="register-container">
      <div class="reg-header">
        <div class="btn-group shadow-sm">
          <button class="btn btn-sm btn-outline-secondary active fw-bold" onclick="app.filterData('ALL')" id="btn-flt-all">All</button>
          <button class="btn btn-sm btn-outline-secondary" onclick="app.filterData('DRAFT')" id="btn-flt-draft">Drafts</button>
          <button class="btn btn-sm btn-outline-secondary text-orange" onclick="app.filterData('PENDING')" id="btn-flt-pending">Pending</button>
          <button class="btn btn-sm btn-outline-secondary text-success" onclick="app.filterData('APPROVED')" id="btn-flt-approved">Approved</button>
        </div>

        <div class="input-group" style="width: 340px;">
          <span class="input-group-text bg-white text-muted"><i class="fa-solid fa-search"></i></span>
          <input type="text" class="form-control border-start-0 ps-0" placeholder="Search Ref, Client, File..." onkeyup="app.searchData(this.value)">
        </div>
      </div>

      <div class="reg-body">
        <table class="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Invoice #</th>
              <th>Ver</th>
              <th>Client / Account</th>
              <th>File Ref</th>
              <th class="text-end">Revenue (TTC)</th>
              <th class="text-end">Margin (XAF)</th>
              <th>Status</th>
              <th class="text-end">Action</th>
            </tr>
          </thead>
          <tbody id="invoice-table-body"></tbody>
        </table>
      </div>
    </div>

  </div>

  <!-- EDITOR -->
  <div class="offcanvas offcanvas-end offcanvas-xl" tabindex="-1" id="invoiceEditor" data-bs-backdrop="static">
    <div class="editor-shell">

      <div class="editor-top">
        <div class="d-flex align-items-center gap-3 flex-wrap">
          <h4 class="fw-800 font-head mb-0">Invoice Worksheet</h4>
          <span class="status-pill st-draft" id="ed-status-badge">DRAFT</span>
          <span class="font-mono text-muted fw-bold" id="ed-ref-display">SLAS-FI-NEW</span>
        </div>
        <div class="d-flex gap-2" id="ed-actions"></div>
      </div>

      <div class="editor-nav">
        <div class="editor-tab active" id="btn-tab-invoice" onclick="app.switchTab('tab-invoice')"><i class="fa-solid fa-file-invoice me-2"></i>Invoice Details</div>
        <div class="editor-tab" id="btn-tab-payments" onclick="app.switchTab('tab-payments')"><i class="fa-solid fa-money-bill-wave me-2"></i>Payment History</div>
      </div>

      <div class="editor-content active" id="tab-invoice">
        <div class="sheet-card p-4 mb-4">
          <div class="row g-3">
            <div class="col-md-3">
              <label class="small fw-bold text-muted text-uppercase mb-1">Link File (Ops Master)</label>
              <select class="form-select form-select-sm fw-bold" id="ed-src" onchange="app.importSource(this.value)">
                <option value="">Select File...</option>
              </select>
            </div>
            <div class="col-md-3">
              <label class="small fw-bold text-muted text-uppercase mb-1">Client</label>
              <input class="form-control form-control-sm bg-light fw-bold" id="ed-client" disabled>
            </div>
            <div class="col-md-3">
              <label class="small fw-bold text-muted text-uppercase mb-1">File Ref</label>
              <input class="form-control form-control-sm font-mono bg-light" id="ed-file" disabled>
            </div>
            <div class="col-md-3">
              <label class="small fw-bold text-muted text-uppercase mb-1 text-primary">Linked OCR Cost</label>
              <input class="form-control form-control-sm font-mono bg-light text-primary fw-bold" id="ed-ocr-display" disabled value="0">
            </div>

            <!-- NEW FIELD: PRI Amount Display -->
            <div class="col-md-3">
              <label class="small fw-bold text-muted text-uppercase mb-1 text-danger">Total Proforma Advances</label>
              <input class="form-control form-control-sm font-mono bg-light text-danger fw-bold" id="ed-pri-display" disabled value="0 XAF">
              <small class="text-muted" style="font-size: 0.65rem;">Amount already collected via proformas</small>
            </div>

            <div class="col-md-3">
              <label class="small fw-bold text-muted text-uppercase mb-1">Invoice Date</label>
              <input type="date" class="form-control form-control-sm" id="ed-date">
            </div>
            <div class="col-md-3">
              <label class="small fw-bold text-muted text-uppercase mb-1">Payment Terms</label>
              <input class="form-control form-control-sm fw-bold" list="terms-list" id="ed-terms" placeholder="Select or Type...">
              <datalist id="terms-list">
                <option value="Immediate">
                <option value="15 Days">
                <option value="30 Days">
                <option value="45 Days">
                <option value="60 Days">
                <option value="90 Days">
              </datalist>
            </div>
            <div class="col-md-3">
              <label class="small fw-bold text-muted text-uppercase mb-1">Currency</label>
              <select class="form-select form-select-sm font-mono" id="ed-curr" onchange="app.convertCurrency()">
                <option value="XAF">XAF (BEAC)</option>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
              </select>
            </div>
            <div class="col-md-3">
              <label class="small fw-bold text-muted text-uppercase mb-1">Exchange Rate</label>
              <input type="number" class="form-control form-control-sm font-mono" id="ed-rate" value="1" onchange="app.convertCurrency()">
            </div>
          </div>
        </div>

        <div class="sheet-card">
          <table class="sheet-table">
            <thead>
              <tr>
                <th width="5%">#</th>
                <th width="10%">Code</th>
                <th width="35%">Description</th>
                <th width="8%" class="text-center">Qty</th>
                <th width="12%" class="text-end">Unit Price</th>
                <th width="12%" class="text-end">Total HT</th>
                <th width="8%" class="text-center">VAT?</th>
                <th width="10%"></th>
              </tr>
            </thead>
            <tbody id="ed-lines"></tbody>
          </table>
          <div class="p-3 bg-light border-top">
            <button class="btn btn-sm btn-outline-primary fw-bold" id="btn-add-line" onclick="app.addLineItem()">
              <i class="fa-solid fa-plus me-1"></i> Add Line
            </button>
          </div>
        </div>

        <div class="row">
          <div class="col-md-6">
            <div class="mb-3">
              <label class="small fw-bold text-muted text-uppercase mb-1">Bank Details</label>
              <textarea class="form-control font-mono small" id="ed-bank" rows="3"></textarea>
            </div>
            <div>
              <label class="small fw-bold text-muted text-uppercase mb-1">Remarks / Notes</label>
              <textarea class="form-control" id="ed-remarks" rows="3"></textarea>
            </div>
          </div>

          <div class="col-md-6">
            <div class="calc-box">
              <div class="calc-row"><span>Total HT</span><span class="font-mono fw-bold" id="disp-ht">0</span></div>
              <div class="calc-row"><span>Total VAT (19.25%)</span><span class="font-mono fw-bold" id="disp-vat">0</span></div>
              <div class="calc-row grand"><span>GROSS TOTAL (TTC)</span><span class="font-mono" id="disp-ttc">0</span></div>
              
              <!-- UPDATED: Show PRI deduction clearly -->
              <div class="calc-row text-danger mt-2 pt-2 border-top">
                <span><i class="fa-solid fa-minus-circle me-2"></i>Less: Proforma Advances</span>
                <span class="font-mono fw-bold" id="disp-advance">0</span>
              </div>
              
              <div class="calc-row balance">
                <span class="fw-900">BALANCE DUE</span>
                <span class="font-mono fw-900" id="disp-balance">0</span>
              </div>
              
              <div class="mt-2 pt-2 border-top">
                <small class="text-muted d-block">
                  <i class="fa-solid fa-info-circle me-1"></i>
                  Balance = Gross Total - Proforma Advances
                </small>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="editor-content" id="tab-payments">
        <div class="d-flex justify-content-between align-items-center mb-3">
          <h5 class="fw-bold mb-0">Receivable History</h5>
          <button class="btn btn-success fw-bold btn-sm" onclick="alert('Simulating Link to Receivables Module')">
            <i class="fa-solid fa-plus me-2"></i>Record Payment
          </button>
        </div>
        <div class="sheet-card">
          <table class="sheet-table">
            <thead>
              <tr>
                <th>Transaction Date</th>
                <th>Ref ID</th>
                <th>Method</th>
                <th class="text-end">Amount Paid</th>
                <th class="text-end">Balance Remaining</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colspan="5" class="text-center text-muted p-4">
                  <i class="fa-solid fa-database me-2"></i> No records found in Receivables DB.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

    </div>
  </div>

  <div id="print-stage"></div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

<script>
/**
 * SMART LS FINAL INVOICE SYSTEM - PROFORMA INTEGRATION
 */

const app = (function() {

  // --- STATE ---
  let CURRENT_ROLE = '<?php echo $role; ?>';
  let activeInv = null;
  let editorInstance = null;
  let filterState = 'ALL';
  let searchState = '';
  let OPERATIONS_FILES = [];
  let FINANCIAL_DICT = [];

  // --- UTILITIES ---
  const fmt = (n) => new Intl.NumberFormat('en-US').format(Math.round(n));
  const parse = (s) => parseFloat(String(s).replace(/,/g, '')) || 0;
  const today = () => new Date().toISOString().split('T')[0];

  // --- INIT ---
  function init() {
    editorInstance = new bootstrap.Offcanvas('#invoiceEditor');
    loadFinancialDictionary();
    loadOperationsFiles();
    loadKPIs();
    loadAllInvoices();
    updateUI();
  }

  // --- API CALLS ---
  async function apiCall(action, method = 'GET', data = null) {
    const url = `../../api/final-invoice/final-invoice.php?action=${action}`;
    const options = {
      method: method,
      headers: { 'Content-Type': 'application/json' }
    };
    
    if (data && method !== 'GET') {
      options.body = JSON.stringify(data);
    }
    
    const response = await fetch(url, options);
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || 'API request failed');
    }
    
    return result;
  }

  async function loadOperationsFiles() {
    try {
      const result = await apiCall('get_operations_files');
      OPERATIONS_FILES = result.data;
    } catch (error) {
      console.error('Error loading operations files:', error);
      alert('Failed to load operations files');
    }
  }

  async function loadFinancialDictionary() {
    try {
      const result = await apiCall('get_financial_dictionary');
      FINANCIAL_DICT = result.data;
    } catch (error) {
      console.error('Error loading financial dictionary:', error);
    }
  }

  async function loadKPIs() {
    try {
      const result = await apiCall('get_kpis');
      const kpi = result.data;
      
      document.getElementById('kpi-rev').innerText = fmt(kpi.total_invoiced);
      document.getElementById('kpi-cost').innerText = fmt(kpi.total_cost);
      document.getElementById('kpi-margin').innerText = fmt(kpi.net_margin);
      document.getElementById('kpi-due').innerText = fmt(kpi.outstanding);
    } catch (error) {
      console.error('Error loading KPIs:', error);
    }
  }

  async function loadAllInvoices() {
    try {
      const result = await apiCall('get_all_invoices');
      renderDashboard(result.data);
    } catch (error) {
      console.error('Error loading invoices:', error);
      alert('Failed to load invoices');
    }
  }

  // --- DASHBOARD RENDERER ---
  function renderDashboard(invoices) {
    const tbody = document.getElementById('invoice-table-body');
    tbody.innerHTML = '';

    const filtered = invoices.filter(inv => {
      const matchesStatus = filterState === 'ALL' ? true : inv.approval_status === filterState;
      const matchesSearch = searchState === '' ? true :
        (inv.invoice_no.toLowerCase().includes(searchState) ||
         inv.operations_file_reference.toLowerCase().includes(searchState) ||
         (inv.client_name || '').toLowerCase().includes(searchState));
      return matchesStatus && matchesSearch;
    });

    filtered.forEach(inv => {
      const margin = inv.margin_amount || 0;
      
      let badge = 'st-draft';
      let statusText = inv.approval_status;
      if(inv.approval_status === 'PENDING') { badge = 'st-pending'; statusText = 'PENDING'; }
      if(inv.approval_status === 'APPROVED') { badge = 'st-approved'; statusText = 'APPROVED'; }
      if(inv.approval_status === 'REJECTED') { badge = 'st-void'; statusText = 'REJECTED'; }

      const tr = document.createElement('tr');
      tr.onclick = () => openEditor(inv.invoice_id);
      tr.innerHTML = `
        <td class="font-mono text-muted small">${inv.issue_date.split(' ')[0]}</td>
        <td class="fw-bold font-mono text-primary">${inv.invoice_no}</td>
        <td class="text-muted small">V1</td>
        <td class="fw-bold text-dark">${inv.client_name || 'N/A'}</td>
        <td class="font-mono text-muted small">${inv.operations_file_reference}</td>
        <td class="text-end font-mono">${fmt(inv.total_xaf)}</td>
        <td class="text-end font-mono fw-bold ${margin>0?'text-success':'text-danger'}">${fmt(margin)}</td>
        <td><span class="status-pill ${badge}">${statusText}</span></td>
        <td class="text-end">${getActionIcon(inv)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function getActionIcon(inv) {
    if(inv.approval_status === 'APPROVED') return `<i class="fa-solid fa-print text-dark fs-6" title="View/Print"></i>`;
    return `<i class="fa-solid fa-pen text-muted"></i>`;
  }

  // --- FILTER & SEARCH ---
  function filterData(status) {
    filterState = status;
    document.querySelectorAll('.reg-header .btn-group .btn').forEach(b => b.classList.remove('active','fw-bold'));
    let btnId = 'btn-flt-all';
    if(status === 'PENDING') btnId = 'btn-flt-pending';
    if(status === 'APPROVED') btnId = 'btn-flt-approved';
    if(status === 'REJECTED') btnId = 'btn-flt-draft';
    document.getElementById(btnId).classList.add('active','fw-bold');
    loadAllInvoices();
  }

  function searchData(val) {
    searchState = String(val || '').toLowerCase();
    loadAllInvoices();
  }

  // --- EDITOR LOGIC ---
  function createInvoice() {
    if(CURRENT_ROLE !== 'FINANCE' && CURRENT_ROLE !== 'ADMIN') { 
      alert("Only Finance role can create invoices."); 
      return; 
    }

    activeInv = {
      invoice_id: 0,
      invoice_no: 'NEW',
      issue_date: today(),
      due_date: null,
      operations_file_reference: '',
      client_id: '',
      client_name: '',
      client_address: '',
      client_niu: '',
      currency: 'XAF',
      rate: 1,
      lines: [],
      subtotal_xaf: 0,
      vat_xaf: 0,
      total_xaf: 0,
      
      // FIX: Initialize with correct field name
      total_pri_amount_xaf: 0,
      
      payable_amount_xaf: 0,
      bank_details: "Bank: AFRILAND FIRST BANK\nAccount: 10005-0006-107018411001-93",
      remarks: '',
      approval_status: 'DRAFT',
      linked_quote_ref: '',
      ocr_amount: 0
    };

    populateFileDropdown();
    loadEditor();
    editorInstance.show();
  }

  async function openEditor(invoiceId) {
    try {
      const result = await apiCall(`get_invoice&invoice_id=${invoiceId}`);
      activeInv = result.data.invoice;
      activeInv.lines = result.data.lines.map(l => ({
        dict_code: l.dict_code,
        description: l.description,
        qty: parseFloat(l.qty),
        unit_price_xaf: parseFloat(l.unit_price_xaf),
        line_total_xaf: parseFloat(l.line_total_xaf),
        vat_amount_xaf: parseFloat(l.vat_amount_xaf),
        vat: parseFloat(l.vat_amount_xaf) > 0
      }));
      activeInv.ocr_amount = result.data.ocr_amount;
      
      // FIX: Properly load PRI amount from API response
      activeInv.total_pri_amount_xaf = parseFloat(result.data.total_pri_amount_xaf || 0);
      
      populateFileDropdown(true);
      loadEditor();
      editorInstance.show();
    } catch (error) {
      console.error('Error loading invoice:', error);
      alert('Failed to load invoice');
    }
  }

  function populateFileDropdown(isEdit = false) {
    const sel = document.getElementById('ed-src');
    sel.innerHTML = '<option value="">Select Ops File...</option>';
    
    if (isEdit) {
      sel.innerHTML = `<option value="${activeInv.operations_file_reference}" selected>${activeInv.operations_file_reference}</option>`;
      sel.disabled = true;
    } else {
      OPERATIONS_FILES.forEach(file => {
        sel.innerHTML += `<option value="${file.operations_file_reference}">${file.operations_file_reference} - ${file.commodity || 'N/A'}</option>`;
      });
      sel.disabled = false;
    }
  }

  async function importSource(fileRef) {
    if(!fileRef) return;
    
    try {
      const result = await apiCall(`get_file_details&file_ref=${fileRef}`);
      const data = result.data;
      
      activeInv.operations_file_reference = fileRef;
      activeInv.client_id = data.file.client_id;
      activeInv.client_name = data.file.client_name;
      activeInv.client_address = data.file.address || '';
      activeInv.client_niu = data.file.niu || '';
      activeInv.ocr_amount = parseFloat(data.ocr_amount || 0);
      activeInv.linked_quote_ref = data.quote_ref || '';
      
      // FIX: Properly set the PRI amount from API
      activeInv.total_pri_amount_xaf = parseFloat(data.total_pri_amount_xaf || 0);

      document.getElementById('ed-client').value = data.file.client_name || '';
      document.getElementById('ed-file').value = fileRef;
      document.getElementById('ed-ocr-display').value = fmt(activeInv.ocr_amount) + " XAF";
      
      // FIX: Display PRI amount in the new field
      document.getElementById('ed-pri-display').value = fmt(activeInv.total_pri_amount_xaf) + " XAF";

      // Pre-fill lines from latest proforma or quote
      if (data.lines && data.lines.length > 0 && activeInv.lines.length === 0) {
        activeInv.lines = data.lines.map(l => ({
          dict_code: l.dict_code || l.item_code,
          description: l.description || l.item_description,
          qty: parseFloat(l.qty),
          unit_price_xaf: parseFloat(l.unit_price_xaf || l.sell_unit),
          line_total_xaf: parseFloat(l.line_total_xaf || l.sell_total_ht),
          vat_amount_xaf: parseFloat(l.vat_amount_xaf || l.sell_total_vat || 0),
          vat: (l.vat_applicable == 1) || (parseFloat(l.vat_amount_xaf || 0) > 0)
        }));
      }
      
      renderLines();
    } catch (error) {
      console.error('Error importing file:', error);
      alert('Failed to load file details');
    }
  }

  function displayProformaSummary() {
    const container = document.getElementById('proforma-summary');
    if (!container) return;

    if (activeInv.proformas && activeInv.proformas.length > 0) {
      let html = `
        <div class="alert alert-info mb-3">
          <h6 class="fw-bold mb-2"><i class="fa-solid fa-file-invoice me-2"></i>Linked Proforma Invoices (${activeInv.proformas.length})</h6>
          <table class="table table-sm table-bordered mb-0">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Date</th>
                <th class="text-end">Amount Paid</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
      `;
      
      activeInv.proformas.forEach(pf => {
        html += `
          <tr>
            <td class="font-mono small">${pf.invoice_no}</td>
            <td class="small">${pf.issue_date.split(' ')[0]}</td>
            <td class="text-end font-mono small">${fmt(pf.payable_amount_xaf)} XAF</td>
            <td><span class="badge bg-success">${pf.status}</span></td>
          </tr>
        `;
      });
      
      html += `
            </tbody>
            <tfoot>
              <tr class="fw-bold">
                <td colspan="2">TOTAL ADVANCES</td>
                <td class="text-end font-mono">${fmt(activeInv.total_advance_xaf)} XAF</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      `;
      
      container.innerHTML = html;
    } else {
      container.innerHTML = '<div class="alert alert-warning mb-3"><i class="fa-solid fa-info-circle me-2"></i>No proforma invoices found for this file.</div>';
    }
  }

  function loadEditor() {
    let statusBadge = 'st-draft';
    let statusText = activeInv.approval_status;
    if(activeInv.approval_status === 'PENDING') { statusBadge = 'st-pending'; statusText = 'PENDING'; }
    if(activeInv.approval_status === 'APPROVED') { statusBadge = 'st-approved'; statusText = 'APPROVED'; }
    if(activeInv.approval_status === 'REJECTED') { statusBadge = 'st-void'; statusText = 'REJECTED'; }
    
    document.getElementById('ed-status-badge').innerText = statusText;
    document.getElementById('ed-status-badge').className = `status-pill ${statusBadge}`;
    document.getElementById('ed-ref-display').innerText = activeInv.invoice_no;

    document.getElementById('ed-date').value = activeInv.issue_date.split(' ')[0];
    document.getElementById('ed-curr').value = activeInv.currency;
    document.getElementById('ed-rate').value = activeInv.rate || 1;
    document.getElementById('ed-remarks').value = activeInv.remarks || '';
    document.getElementById('ed-terms').value = calculateTerms(activeInv.issue_date, activeInv.due_date);
    document.getElementById('ed-bank').value = activeInv.bank_details || "Bank: AFRILAND FIRST BANK\nAccount: 10005-0006-107018411001-93";

    if(activeInv.operations_file_reference) {
      document.getElementById('ed-client').value = activeInv.client_name || '';
      document.getElementById('ed-file').value = activeInv.operations_file_reference;
      document.getElementById('ed-ocr-display').value = fmt(activeInv.ocr_amount || 0) + " XAF";
      
      // FIX: Display PRI amount
      document.getElementById('ed-pri-display').value = fmt(activeInv.total_pri_amount_xaf || 0) + " XAF";
    } else {
      document.getElementById('ed-client').value = '';
      document.getElementById('ed-file').value = '';
      document.getElementById('ed-ocr-display').value = '0 XAF';
      document.getElementById('ed-pri-display').value = '0 XAF';
    }

    renderLines();
    renderActions();
    
    const isLocked = activeInv.approval_status === 'APPROVED' || 
                     (activeInv.approval_status === 'PENDING' && CURRENT_ROLE === 'FINANCE');
    toggleInputs(!isLocked);
    switchTab('tab-invoice');
  }

  function calculateTerms(issueDate, dueDate) {
    if (!dueDate) return '30 Days';
    const issue = new Date(issueDate);
    const due = new Date(dueDate);
    const days = Math.round((due - issue) / (1000 * 60 * 60 * 24));
    return days + ' Days';
  }

  function calculateDueDate(issueDate, terms) {
    const days = parseInt(terms) || 30;
    const due = new Date(issueDate);
    due.setDate(due.getDate() + days);
    return due.toISOString().split('T')[0];
  }

  function toggleInputs(enabled) {
    const inputs = document.querySelectorAll('#tab-invoice input:not([disabled]), #tab-invoice select:not([disabled]), #tab-invoice textarea, #btn-add-line');
    inputs.forEach(el => {
      if (el.id !== 'ed-client' && el.id !== 'ed-file' && el.id !== 'ed-ocr-display') {
        el.disabled = !enabled;
      }
    });
  }

  function convertCurrency() {
    activeInv.currency = document.getElementById('ed-curr').value;
    activeInv.rate = parseFloat(document.getElementById('ed-rate').value) || 1;
  }

  function renderLines() {
    const tbody = document.getElementById('ed-lines');
    tbody.innerHTML = '';
    
    activeInv.lines.forEach((l, idx) => {
      const ht = l.qty * l.unit_price_xaf;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${idx+1}</td>
        <td><input class="sheet-input font-mono small" value="${l.dict_code}" onchange="app.updateLine(${idx},'dict_code',this.value)" list="dict-list-${idx}">
            <datalist id="dict-list-${idx}">
              ${FINANCIAL_DICT.map(d => `<option value="${d.code}">${d.description}</option>`).join('')}
            </datalist>
        </td>
        <td><input class="sheet-input fw-bold" value="${l.description}" onchange="app.updateLine(${idx},'description',this.value)"></td>
        <td><input type="number" step="0.01" class="sheet-input text-center" value="${l.qty}" onchange="app.updateLine(${idx},'qty',this.value)"></td>
        <td><input class="sheet-input text-end font-mono" value="${fmt(l.unit_price_xaf)}" onchange="app.updateLine(${idx},'unit_price_xaf',this.value)"></td>
        <td class="text-end font-mono py-2">${fmt(ht)}</td>
        <td class="text-center align-middle"><input type="checkbox" ${l.vat?'checked':''} onchange="app.updateLine(${idx},'vat',this.checked)"></td>
        <td class="text-center"><i class="fa-solid fa-trash text-danger cursor-pointer" onclick="app.delLine(${idx})"></i></td>
      `;
      tbody.appendChild(tr);
    });
    calcInvoiceTotals();
  }

  function updateLine(i, f, v) {
    if(f==='qty') v=parseFloat(v)||0;
    if(f==='unit_price_xaf') v=parse(v);
    activeInv.lines[i][f] = v;
    
    // Auto-populate description from financial dictionary
    if(f === 'dict_code') {
      const dict = FINANCIAL_DICT.find(d => d.code === v);
      if(dict) {
        activeInv.lines[i].description = dict.description;
      }
    }
    
    renderLines();
  }

  function addLineItem() { 
    activeInv.lines.push({
      dict_code:'', 
      description:'', 
      qty:1, 
      unit_price_xaf:0, 
      line_total_xaf:0,
      vat_amount_xaf:0,
      vat:false
    }); 
    renderLines(); 
  }

  function delLine(i) { 
    activeInv.lines.splice(i,1); 
    renderLines(); 
  }

  function calcInvoiceTotals() {
    let ht=0, vat=0;
    
    activeInv.lines.forEach(l => {
      const lh = l.qty * l.unit_price_xaf;
      l.line_total_xaf = lh;
      ht += lh;
      if(l.vat) {
        const lv = lh * 0.1925;
        l.vat_amount_xaf = lv;
        vat += lv;
      } else {
        l.vat_amount_xaf = 0;
      }
    });
    
    const ttc = ht + vat;
    
    // FIX: Use the correct field name
    const totalPriAmount = activeInv.total_pri_amount_xaf || 0;
    const bal = ttc - totalPriAmount;

    document.getElementById('disp-ht').innerText = fmt(ht);
    document.getElementById('disp-vat').innerText = fmt(vat);
    document.getElementById('disp-ttc').innerText = fmt(ttc);
    document.getElementById('disp-balance').innerText = fmt(bal);
    document.getElementById('disp-advance').innerText = fmt(totalPriAmount);

    activeInv.subtotal_xaf = ht;
    activeInv.vat_xaf = vat;
    activeInv.total_xaf = ttc;
    activeInv.payable_amount_xaf = bal;
  }

  // --- WORKFLOW & SAVING ---
  function renderActions() {
    const c = document.getElementById('ed-actions');
    c.innerHTML = `<button class="btn btn-sm btn-outline-secondary" data-bs-dismiss="offcanvas">Close</button>`;

    if(activeInv.approval_status === 'APPROVED') {
      c.innerHTML += `<button class="btn btn-sm btn-dark" onclick="app.printInvoice()"><i class="fa-solid fa-print me-2"></i>Print / View</button>`;
      return;
    }

    if((CURRENT_ROLE === 'FINANCE' || CURRENT_ROLE === 'ADMIN') && (activeInv.approval_status === 'DRAFT' || activeInv.approval_status === 'REJECTED')) {
      c.innerHTML += `<button class="btn btn-sm btn-outline-primary" onclick="app.save(false)">Save Draft</button>`;
      c.innerHTML += `<button class="btn btn-sm btn-primary fw-bold px-3" onclick="app.save(true)">Submit for Approval</button>`;
    }

    if((CURRENT_ROLE === 'MANAGEMENT' || CURRENT_ROLE === 'ADMIN') && activeInv.approval_status === 'PENDING') {
      c.innerHTML += `<button class="btn btn-sm btn-outline-danger" onclick="app.reject()">Reject</button>`;
      c.innerHTML += `<button class="btn btn-sm btn-success fw-bold px-3" onclick="app.approve()">Approve & Lock</button>`;
    }
  }

  async function save(submit = false) {
    try {
      activeInv.issue_date = document.getElementById('ed-date').value;
      activeInv.remarks = document.getElementById('ed-remarks').value;
      activeInv.bank_details = document.getElementById('ed-bank').value;
      
      const terms = document.getElementById('ed-terms').value;
      activeInv.due_date = calculateDueDate(activeInv.issue_date, terms);

      const payload = {
        invoice_id: activeInv.invoice_id,
        operations_file_reference: activeInv.operations_file_reference,
        linked_quote_ref: activeInv.linked_quote_ref,
        client_id: activeInv.client_id,
        issue_date: activeInv.issue_date,
        due_date: activeInv.due_date,
        currency: activeInv.currency,
        subtotal_xaf: activeInv.subtotal_xaf,
        vat_xaf: activeInv.vat_xaf,
        total_xaf: activeInv.total_xaf,
        
        // FIX: Include PRI amount in payload
        total_pri_amount_xaf: activeInv.total_pri_amount_xaf || 0,
        
        payable_amount_xaf: activeInv.payable_amount_xaf,
        bank_details: activeInv.bank_details,
        remarks: activeInv.remarks,
        lines: activeInv.lines
      };

      const result = await apiCall('save_invoice', 'POST', payload);
      
      if (submit) {
        await apiCall('submit_invoice', 'POST', { invoice_id: result.invoice_id || activeInv.invoice_id });
        alert('Invoice submitted for approval');
      } else {
        alert('Invoice saved as draft');
      }
      
      editorInstance.hide();
      loadAllInvoices();
      loadKPIs();
    } catch (error) {
      console.error('Error saving invoice:', error);
      alert('Failed to save invoice: ' + error.message);
    }
  }

  async function approve() {
    if(!confirm("Approve this invoice? It will be locked and the operations file will be updated.")) return;
    
    try {
      await apiCall('approve_invoice', 'POST', { invoice_id: activeInv.invoice_id });
      alert('Invoice approved successfully');
      editorInstance.hide();
      loadAllInvoices();
      loadKPIs();
    } catch (error) {
      console.error('Error approving invoice:', error);
      alert('Failed to approve invoice: ' + error.message);
    }
  }

  async function reject() {
    const reason = prompt("Reason for rejection:");
    if(!reason) return;
    
    try {
      await apiCall('reject_invoice', 'POST', { 
        invoice_id: activeInv.invoice_id,
        reason: reason
      });
      alert('Invoice rejected and returned to draft');
      editorInstance.hide();
      loadAllInvoices();
    } catch (error) {
      console.error('Error rejecting invoice:', error);
      alert('Failed to reject invoice: ' + error.message);
    }
  }

  function updateUI() {
    const btn = document.getElementById('btn-create');
    if(!btn) return;
    if(CURRENT_ROLE === 'FINANCE' || CURRENT_ROLE === 'ADMIN') btn.classList.remove('d-none');
    else btn.classList.add('d-none');
  }

  function switchTab(tId) {
    document.querySelectorAll('.editor-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.editor-content').forEach(c => c.classList.remove('active'));
    if(tId === 'tab-invoice') document.getElementById('btn-tab-invoice').classList.add('active');
    if(tId === 'tab-payments') document.getElementById('btn-tab-payments').classList.add('active');
    document.getElementById(tId).classList.add('active');
  }

  // --- PRINT ENGINE (ENHANCED FOR ACCURACY) ---
  function printInvoice() {
    const container = document.getElementById('print-stage');
    
    // Calculate terms display
    let termsDisplay = document.getElementById('ed-terms').value || '30 Days';
    let dueDate = activeInv.due_date || calculateDueDate(activeInv.issue_date, termsDisplay);
    
    const words = convertNumberToWords(activeInv.payable_amount_xaf);
    const bankLines = String(activeInv.bank_details || '').split('\n').map(line => line.trim()).filter(Boolean);

    const html = `
      <div class="a4-page" style="width:210mm; min-height:297mm; background:white; margin:0 auto; padding:10mm 15mm; position:relative; font-family:'Montserrat',sans-serif; color:#000; box-shadow:0 0 20px rgba(0,0,0,0.3);">
        <div style="display:flex; justify-content:space-between; margin-bottom:30px; align-items:flex-start;">
          <div style="width:40%;">
            <img src="https://i.ibb.co/35MQnHJn/LOGO-SMART.png" style="height:70px; display:block;">
          </div>
          <div style="text-align:right; font-size:8pt; line-height:1.4; color:#333;">
            <div style="font-weight:800; text-transform:uppercase; font-size:10pt; color:#231F20; margin-bottom:2px;">SMART LOGISTICS AND SERVICES LTD</div>
            <div>1030, Avenue Douala Manga Bell, Bali</div>
            <div>PO Box 5120, Douala, Cameroon</div>
            <div>+237 233 420 281 | info@smartls.cm</div>
          </div>
        </div>

        <div style="display:flex; gap:20px; margin-bottom:20px;">
          <div style="flex:1; border:1px solid #000; font-size:8pt;">
            <div style="background:#E5E5E5; padding:4px 8px; font-weight:800; border-bottom:1px solid #000; font-size:7.5pt; text-transform:uppercase;">BILL TO / CLIENT</div>
            <div style="padding:6px 8px; line-height:1.5;">
              <div style="font-weight:800; font-size:9pt; text-transform:uppercase;">${activeInv.client_name || '-'}</div>
              <div>${activeInv.client_address || '-'}</div>
              <div style="margin-top:4px;"><b>NIU:</b> ${activeInv.niu_number || '-'}</div>
            </div>
          </div>

          <div style="flex:1; border:1px solid #000; font-size:8pt;">
            <div style="background:#E5E5E5; padding:4px 8px; font-weight:800; border-bottom:1px solid #000; font-size:7.5pt; text-transform:uppercase;">INVOICE INFO</div>
            <div style="padding:6px 8px; line-height:1.5;">
              <div><b>Number:</b> ${activeInv.invoice_no}</div>
              <div><b>Date:</b> ${activeInv.issue_date.split(' ')[0]}</div>
              <div><b>Terms:</b> ${termsDisplay}</div>
              <div><b>Due Date:</b> ${dueDate}</div>
              <div><b>Ref:</b> ${activeInv.operations_file_reference}</div>
            </div>
          </div>
        </div>

        <table style="width:100%; border-collapse:collapse; font-size:8.5pt; margin-bottom:20px;">
          <thead>
            <tr>
              <th style="background:#E0E0E0; color:#000; padding:5px; border:1px solid #000; text-transform:uppercase; font-size:7.5pt;">CODE</th>
              <th style="background:#E0E0E0; color:#000; padding:5px; border:1px solid #000; text-transform:uppercase; font-size:7.5pt;">DESCRIPTION</th>
              <th style="background:#E0E0E0; color:#000; padding:5px; border:1px solid #000; text-transform:uppercase; font-size:7.5pt;">QTY</th>
              <th style="background:#E0E0E0; color:#000; padding:5px; border:1px solid #000; text-transform:uppercase; font-size:7.5pt;">UNIT PRICE</th>
              <th style="background:#E0E0E0; color:#000; padding:5px; border:1px solid #000; text-transform:uppercase; font-size:7.5pt;">TOTAL HT</th>
              <th style="background:#E0E0E0; color:#000; padding:5px; border:1px solid #000; text-transform:uppercase; font-size:7.5pt;">VAT</th>
            </tr>
          </thead>
          <tbody>
            ${activeInv.lines.map(l => `
              <tr>
                <td style="border:1px solid #000; padding:5px;">${l.dict_code}</td>
                <td style="border:1px solid #000; padding:5px;">${l.description}</td>
                <td style="border:1px solid #000; padding:5px; text-align:center;">${l.qty}</td>
                <td style="border:1px solid #000; padding:5px; text-align:right;">${fmt(l.unit_price_xaf)}</td>
                <td style="border:1px solid #000; padding:5px; text-align:right;">${fmt(l.line_total_xaf)}</td>
                <td style="border:1px solid #000; padding:5px; text-align:right;">${l.vat ? fmt(l.vat_amount_xaf) : '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div style="display:flex; gap:20px; margin-bottom:20px; align-items:flex-start;">
          <div style="flex:1;">
            <div style="font-size:7pt; margin-bottom:2px; font-weight:700;">AMOUNT IN WORDS:</div>
            <div style="font-size:9pt; font-weight:700; font-style:italic; border:1px solid #000; padding:8px; background:#F9F9F9; margin-bottom:15px; min-height:40px;">
              ${words} ${activeInv.currency}
            </div>

            <div style="font-size:7pt; margin-bottom:2px; margin-top:10px; font-weight:700;">REMARKS:</div>
            <div style="font-size:8pt; border:1px solid #000; padding:8px; min-height:60px;">
              ${activeInv.remarks || ''}
            </div>
          </div>

            <div style="width:45%;">
            <table style="width:100%; border-collapse:collapse; font-size:9pt; border:1px solid #000;">
              <tr><td style="padding:5px 8px; border-bottom:1px solid #ccc;">Total H.T.</td><td style="padding:5px 8px; border-bottom:1px solid #ccc; text-align:right;">${fmt(activeInv.subtotal_xaf)}</td></tr>
              <tr><td style="padding:5px 8px; border-bottom:1px solid #ccc;">TVA (19.25%)</td><td style="padding:5px 8px; border-bottom:1px solid #ccc; text-align:right;">${fmt(activeInv.vat_xaf)}</td></tr>
              <tr style="background:#f0f0f0;"><td style="padding:5px 8px; border-bottom:1px solid #ccc;"><b>GROSS TOTAL</b></td><td style="padding:5px 8px; border-bottom:1px solid #ccc; text-align:right;"><b>${fmt(activeInv.total_xaf)}</b></td></tr>
              ${activeInv.advance_percentage > 0 ? `
                <tr><td style="padding:5px 8px; border-bottom:1px solid #ccc; color:#b91c1c; font-style:italic;">Less Advance (${activeInv.advance_percentage}%)</td><td style="padding:5px 8px; border-bottom:1px solid #ccc; text-align:right; color:#b91c1c;">(${fmt((activeInv.total_xaf * activeInv.advance_percentage) / 100)})</td></tr>
              ` : ``}
              <tr style="border-top:2px solid #000;">
                <td style="padding:5px 8px; font-weight:900; font-size:10pt;">BALANCE DUE</td>
                <td style="padding:5px 8px; text-align:right; font-weight:900; font-size:11pt;">${fmt(activeInv.payable_amount_xaf)}</td>
              </tr>
            </table>

            <div style="margin-top:30px; display:flex; justify-content:center;">
              <div style="text-align:center; position:relative; width:200px;">
                <div style="font-weight:850; font-size:10pt; margin-bottom:5px; text-transform:uppercase;">MANAGEMENT</div>
                <img src="https://i.ibb.co/m58kKZdd/signature-dg-smart.png" style="width:200px; height:auto; display:${activeInv.approval_status === 'APPROVED'?'block':'none'}; margin:0 auto;">
                <div style="height:${activeInv.approval_status === 'APPROVED'?'0':'60'}px;"></div>
                <div style="border-bottom:1px solid #000; width:100%; margin-top:5px;"></div>
              </div>
            </div>
          </div>
        </div>

        <div style="position:absolute; bottom:12mm; left:15mm; right:15mm; border-top:2px solid #EE7D04; padding-top:8px; text-align:center;">
          <div style="margin-bottom:4px; font-size:8pt;">
            ${bankLines.map(line => `<span>${line}</span>`).join(' &nbsp;|&nbsp; ')}
          </div>
          <div style="font-size:8pt; color:#000;">
            <b>NIU:</b> M0421160335800 &nbsp;&nbsp;|&nbsp;&nbsp; <b>RC:</b> 357-0114542 &nbsp;&nbsp;|&nbsp;&nbsp; Generated by Smart LS Enterprise
          </div>
        </div>
      </div>
    `;

    container.innerHTML = html;
    container.style.display = 'block';
    setTimeout(() => { 
      window.print(); 
      setTimeout(() => { container.style.display = 'none'; }, 1000);
    }, 500);
  }
    
  function convertNumberToWords(amount) {
    if (amount === 0 || amount === '0') return "ZERO";
    const str = String(Math.round(amount));
    const arr = x => Array.from(x);
    const num = x => Number(x) || 0;
    const isEmpty = xs => xs.length === 0;
    const take = n => xs => xs.slice(0,n);
    const drop = n => xs => xs.slice(n);
    const reverse = xs => xs.slice(0).reverse();
    const comp = f => g => x => f(g(x));
    const not = x => !x;
    const chunk = n => xs => isEmpty(xs) ? [] : [take(n)(xs), ...chunk(n)(drop(n)(xs))];

    const a = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
    const b = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
    const g = ['','Thousand','Million','Billion','Trillion','Quadrillion'];

    const makeGroup = ([ones,tens,huns]) => {
      return [
        num(huns) === 0 ? '' : a[huns] + ' Hundred ',
        num(ones) === 0 ? b[tens] : (b[tens] && (b[tens] + '-') || ''),
        a[tens+ones] || a[ones]
      ].join('');
    };

    const thousand = (group,i) => group === '' ? group : `${group} ${g[i]}`;

    return comp(chunk(3))(reverse)(arr(str))
      .map(makeGroup)
      .map(thousand)
      .filter(comp(not)(isEmpty))
      .reverse()
      .join(' ')
      .trim()
      .toUpperCase();
    }
    return {
      init, createInvoice, filterData, searchData,
      updateLine, addLineItem, delLine,
      calcInvoiceTotals, convertCurrency, importSource,
      save, approve, reject, printInvoice,
      switchTab
  };
})();

document.addEventListener('DOMContentLoaded', app.init);
</script>
</body>
</html>