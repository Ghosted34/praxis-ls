<?php
declare(strict_types=1);

// ============================================================================
// 1. BACKEND ENGINE (DO NOT TOUCH)
// ============================================================================
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['FINANCE']);

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
$role      = strtoupper((string)($me['role'] ?? 'FINANCE'));
$roleLabel = $roleLabelMap[$role] ?? 'FINANCE';

// --- Avatar ---
$avatarName = urlencode($fullName);
$avatarUrl  = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";

function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cost Tracking Master Sheet | Smart LS</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&family=Montserrat:wght@400;600;700;800;900&family=Inconsolata:wght@500;700&display=swap" rel="stylesheet">

  <style>
    /* ==========================================================================
       2. YOUR UI/UX OVERRIDES (RESTORED DESIGN SYSTEM)
       ========================================================================== */
    :root {
       /* Smart LS Brand */
       --brand-blue: #1F99D8;
       --brand-dark: #055B83;
       --brand-orange: #EE7D04;
       --brand-bg: #F8FAFC;
       --brand-text: #231F20;

       /* Sheet Specific Colors */
       --header-orange: #EE7D04;
       --header-blue: #1F99D8;
       --cell-bg-balance: #E0F2FE; /* Light Blue for Balance Columns */
       --cell-bg-total: #FFF7ED;   /* Light Orange for Totals */

       /* Backend Sidebar Variable Match */
       --sidebar-width: 280px; 
    }

    body {
       font-family: 'Manrope', sans-serif;
       background: var(--brand-bg);
       color: var(--brand-text);
       font-size: 0.85rem; /* RESTORED: Compact Text */
       overflow-x: hidden;
    }

    h1, h2, h3, h4, h5, h6 { font-family: 'Montserrat', sans-serif; }

    /* UTILITIES */
    .font-mono { font-family: 'Inconsolata', monospace; letter-spacing: -0.5px; }
    .fw-black { font-weight: 800; }
    .text-orange { color: var(--brand-orange) !important; }

    /* OVERRIDING CONTENT CONTAINER */
    .main-content {
      margin-left: var(--sidebar-width);
      padding-top: 70px;
      padding-left: 30px; 
      padding-right: 30px;
      min-height: 100vh;
      padding-bottom: 100px;
    }

    /* EDITOR CARD STYLE (Your Design) */
    .editor-card {
        background: white; border: 1px solid #E2E8F0; border-radius: 12px;
        box-shadow: 0 4px 6px -1px rgba(0,0,0,0.02); overflow: hidden; margin-bottom: 30px;
    }
    .editor-header {
        padding: 20px 24px; background: #F8FAFC; border-bottom: 1px solid #E2E8F0;
        display: flex; justify-content: space-between; align-items: center;
    }

    /* TABS */
    .nav-tabs .nav-link { border: none; color: #64748B; font-weight: 700; padding: 12px 20px; }
    .nav-tabs .nav-link.active { color: var(--brand-blue); background: none; border-bottom: 3px solid var(--brand-blue); }
    .tab-content { padding: 24px; }

    /* FORM INPUTS (RESTORED: Right Aligned & Compact) */
    .form-label { font-size: 0.7rem; font-weight: 800; text-transform: uppercase; color: #64748B; margin-bottom: 5px; }
    .form-control, .form-select { font-size: 0.9rem; border-color: #CBD5E1; border-radius: 6px; }
    .form-control:focus, .form-select:focus { border-color: var(--brand-blue); box-shadow: 0 0 0 3px rgba(31, 153, 216, 0.15); }
    
    .inp-money { 
        font-family: 'Inconsolata', monospace; 
        font-weight: 700; 
        text-align: right; /* RESTORED: Calculator Style */
    }
    .inp-money:focus { background: #F0F9FF; }

    /* --- THE MASTER SHEET (RESTORED: High Contrast Grid) --- */
    .sheet-container {
        background: white; border: 1px solid #E2E8F0; border-radius: 8px;
        overflow-x: auto; /* Horizontal Scroll */
        position: relative;
    }
    
    .master-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 0.75rem; white-space: nowrap; }
    
    /* Headers */
    .master-table th { position: sticky; top: 0; z-index: 10; border-bottom: 2px solid #fff; color: white; text-transform: uppercase; font-weight: 800; padding: 12px 10px; text-align: center; }
    .th-orange { background: var(--header-orange) !important; color: white !important; }
    .th-blue { background: var(--brand-dark) !important; color: white !important; }
    .th-sub { background: #F1F5F9 !important; color: #475569 !important; border-bottom: 1px solid #CBD5E1; font-size: 0.7rem; }

    /* Cells */
    .master-table td { border-bottom: 1px solid #E2E8F0; border-right: 1px solid #F1F5F9; padding: 6px 10px; vertical-align: middle; }
    .master-table tr:hover td { background: #FFF7ED; }

    /* Column Specifics */
    .col-desc { text-align: left; font-weight: 700; min-width: 150px; position: sticky; left: 0; background: white; z-index: 5; border-right: 2px solid #E2E8F0; }
    .col-money { text-align: right; font-family: 'Inconsolata', monospace; }
    .col-bal { background: var(--cell-bg-balance); font-weight: 700; color: var(--brand-dark); }
    .col-total { font-weight: 900; background: #FFF7ED; }
    
    /* Status Badges in Grid */
    .status-cell { font-weight: 800; text-align: center; }
    .st-not-started { color: #94A3B8; }
    .st-in-progress { color: var(--brand-orange); }
    .st-completed { color: #16A34A; }
    .st-hold { color: #DC2626; }

    /* Spinner */
    .loading-overlay {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(255,255,255,0.8);
      display: none; justify-content: center; align-items: center; z-index: 9999;
      backdrop-filter: blur(2px);
    }
    .loading-overlay.active { display: flex; }
    .spinner { width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid var(--brand-dark); border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

    /* Preserve Backend Sidebar Styling */
    .sidebar{ width:var(--sidebar-width); height:100vh; position:fixed; top:0; left:0; background:#fff; border-right:1px solid #e0e0e0; z-index:1000; display:flex; flex-direction:column; box-shadow:2px 0 10px rgba(0,0,0,0.02); }
    .sidebar-header{ height:70px; display:flex; align-items:center; padding:0 20px; border-bottom:1px solid #f0f0f0; }
    .brand-logo{ font-weight:800; font-size:1.1rem; color:var(--smart-charcoal); text-decoration:none; letter-spacing:-0.5px; }
    .sidebar-menu{ overflow-y:auto; flex-grow:1; padding:10px 0; }
    .menu-btn{ width:100%; text-align:left; background:none; border:none; padding:12px 20px; font-size:0.8rem; font-weight:700; color:#555; display:flex; justify-content:space-between; align-items:center; transition:all 0.2s; border-left:3px solid transparent; }
    .menu-btn:hover, .menu-btn[aria-expanded="true"]{ color:var(--smart-charcoal); background-color:#f0f7fa; border-left-color:var(--smart-charcoal); }
    .menu-btn i.category-icon{ width:20px; margin-right:8px; color:#888; transition:color 0.2s; }
    .menu-btn:hover i.category-icon{ color:var(--smart-charcoal); }
    .menu-chevron{ font-size:0.7rem; transition:transform 0.3s; }
    .menu-btn[aria-expanded="true"] .menu-chevron{ transform:rotate(180deg); }
    .sub-link{ display:block; padding:8px 20px 8px 48px; font-size:0.75rem; color:#666; text-decoration:none; font-weight:500; transition:all 0.2s; line-height:1.3; }
    .sub-link:hover{ color:var(--brand-orange); background-color:#fff9f2; }
    .sub-link.active{ color:var(--brand-orange); font-weight:800; background-color:#fff9f2; }
    .sidebar-footer{ border-top:1px solid #f0f0f0; padding:16px; }

    .top-navbar{ height:70px; position:fixed; top:0; right:0; left:var(--sidebar-width); background:rgba(255,255,255,0.95); backdrop-filter:blur(12px); border-bottom:1px solid #e0e0e0; z-index:900; padding:0 30px; display:flex; align-items:center; justify-content:space-between; }
    .clock-pill{ background:#f1f5f9; padding:6px 12px; border-radius:30px; display:flex; align-items:center; gap:10px; font-size:0.85rem; font-weight:600; color:var(--smart-dark); }
  </style>
</head>

<body>

  <div class="loading-overlay" id="loadingOverlay">
    <div class="spinner"></div>
  </div>

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
                <span><i class="fa-solid fa-database category-icon"></i>MASTER DATA MGMT</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="fin1" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                <div class="sub-menu">
                    <a href="client-master-registry.php" class="sub-link">Client Master Registry</a>
                    <a href="supplier-master-registry.php" class="sub-link">Supplier Master Registry</a>
                    <a href="employee-master.php" class="sub-link">Employee Master Registry</a>
                    <a href="financial-dictionary" class="sub-link">Financial Dictionary</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#fin2">
                <span><i class="fa-solid fa-users category-icon"></i>CRM & ACQUISITION</span>
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
                <span><i class="fa-solid fa-calculator category-icon"></i>COMMERCIAL & PRICING</span>
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
                <span><i class="fa-solid fa-truck-fast category-icon"></i>LOGISTICS OPERATIONS</span>
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
                <span><i class="fa-solid fa-chart-line category-icon"></i>JOB COST CONTROL</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="fin5" class="accordion-collapse collapse show" data-bs-parent="#financeMenu">
                <div class="sub-menu">
                    <a href="costing-module.php" class="sub-link">Costing Module</a>
                    <a href="cost-tracking.php" class="sub-link active">Cost Tracking Master</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#fin6">
                <span><i class="fa-solid fa-building-columns category-icon"></i>FINANCE & TREASURY</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="fin6" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                <div class="sub-menu">
                    <a href="cash-request.php" class="sub-link">Cash Request</a>
                    <a href="purchase-order.php" class="sub-link">Purchase Order</a>
                    <a href="proforma-invoice-portal.php" class="sub-link">Proforma Invoice Portal</a>
                    <a href="final-invoice-portal.php" class="sub-link">Final Invoice System</a>
                    <a href="smart-receivable.php" class="sub-link">Smart Receivables Ledger (SRL)</a>
                    <a href="debt-management.php" class="sub-link">Debt Management</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#fin7">
                <span><i class="fa-solid fa-folder-open category-icon"></i>HR & ARCHIVE</span>
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

  <div class="main-content">

    <div class="d-flex justify-content-between align-items-end mb-4 pt-2">
      <div>
         <h2 class="fw-black mb-0 text-dark">Master Ledger</h2>
         <p class="text-muted mb-0 small">Track actuals versus advances per Sea Freight File.</p>
      </div>

      <div class="d-flex gap-2 align-items-end flex-wrap">
        <div class="bg-white border rounded p-2 px-3 text-center shadow-sm">
          <div class="small text-muted fw-bold text-uppercase" style="font-size: 0.65rem;">Total Spend</div>
          <div class="fw-black font-mono text-dark" id="kpiTotalCost">0 XAF</div>
        </div>
        <div class="bg-white border rounded p-2 px-3 text-center shadow-sm">
          <div class="small text-muted fw-bold text-uppercase" style="font-size: 0.65rem;">Total Balance</div>
          <div class="fw-black font-mono text-danger" id="kpiTotalBal">0 XAF</div>
        </div>
        <button class="btn btn-outline-success fw-bold shadow-sm" onclick="exportToCSV()">
          <i class="fa-solid fa-file-excel me-2"></i>Export
        </button>
      </div>
    </div>

    <div class="editor-card" id="editorSection">
      <div class="editor-header">
        <div class="d-flex align-items-center gap-3" style="min-width: 320px; flex: 1;">
          <div class="bg-white border rounded p-2 text-center" style="width: 40px; height: 40px;">
            <i class="fa-solid fa-pen-to-square text-dark mt-1"></i>
          </div>
          <div style="flex: 1;">
            <label class="form-label mb-0">Select File to Track</label>
            <select class="form-select fw-bold border-dark font-mono" id="fileSelector" onchange="loadFile()">
              <option value="">-- Choose Active Operation --</option>
            </select>
          </div>
        </div>
        <div class="text-end">
          <div class="small text-muted fw-bold text-uppercase">Status</div>
          <span class="badge bg-light text-muted border px-3 py-2 fs-6" id="statusDisplay">NOT STARTED</span>
        </div>
      </div>

      <div class="card-body p-0">
        <ul class="nav nav-tabs" role="tablist">
          <li class="nav-item"><a class="nav-link active" data-bs-toggle="tab" href="#tabCosts">1. Actual Costs</a></li>
          <li class="nav-item"><a class="nav-link" data-bs-toggle="tab" href="#tabAdvances">2. Advances Received</a></li>
          <li class="nav-item"><a class="nav-link" data-bs-toggle="tab" href="#tabSummary">3. Summary & Balance</a></li>
        </ul>

        <div class="tab-content">
          <div class="tab-pane fade show active" id="tabCosts">
            <div class="alert alert-light border py-2 small mb-3 text-muted">
              <i class="fa-solid fa-circle-info me-2 text-primary"></i>
              Enter the <strong>Total Cost</strong> incurred for each line item (Gross XAF).
            </div>
            <div class="row g-3" id="costInputs"></div>
          </div>

          <div class="tab-pane fade" id="tabAdvances">
            <div class="alert alert-light border py-2 small mb-3 text-muted">
              <i class="fa-solid fa-circle-info me-2 text-warning"></i>
              Enter the <strong>Advance Amount</strong> received/allocated for each line item.
            </div>
            <div class="row g-3" id="advInputs"></div>
          </div>

          <div class="tab-pane fade" id="tabSummary">
            <div class="row g-4">
              <div class="col-md-8">
                <h6 class="fw-bold text-dark mb-3 text-uppercase small">Balance Due (Auto-Calculated)</h6>
                <div class="table-responsive border rounded bg-white">
                  <table class="table table-sm table-striped m-0 align-middle">
                    <thead class="bg-light">
                      <tr>
                        <th class="text-uppercase small text-muted">Item</th>
                        <th class="text-end text-uppercase small text-muted">Cost</th>
                        <th class="text-end text-uppercase small text-muted">Advance</th>
                        <th class="text-end text-uppercase small text-primary fw-bold">Balance</th>
                      </tr>
                    </thead>
                    <tbody id="summaryTableBody"></tbody>
                  </table>
                </div>
              </div>

              <div class="col-md-4">
                <div class="bg-light p-3 rounded border h-100">
                  <h6 class="fw-bold mb-3 text-uppercase small text-muted">Performance</h6>

                  <div class="mb-3">
                    <label class="form-label">Total Cost</label>
                    <input type="text" class="form-control fw-bold inp-money bg-white" id="sumTotalCost" readonly>
                  </div>
                  <div class="mb-3">
                    <label class="form-label">Total Advance</label>
                    <input type="text" class="form-control fw-bold inp-money bg-white" id="sumTotalAdv" readonly>
                  </div>
                  <div class="mb-3">
                    <label class="form-label text-danger">Total Balance</label>
                    <input type="text" class="form-control fw-black text-danger border-danger inp-money bg-white" id="sumTotalBal" readonly>
                  </div>

                  <div class="mb-3">
                    <label class="form-label">Coverage %</label>
                    <div class="progress" style="height: 10px;">
                      <div class="progress-bar bg-success" id="coverageBar" style="width: 0%"></div>
                    </div>
                    <div class="text-end small mt-1 fw-bold font-mono" id="coverageText">0%</div>
                  </div>

                  <div class="mb-3">
                    <label class="form-label">Manual Override Status</label>
                    <select class="form-select form-select-sm" id="manualStatus" onchange="overrideStatus()">
                      <option value="AUTO">Auto-Detect</option>
                      <option value="ON HOLD">On Hold</option>
                    </select>
                  </div>

                  <button class="btn btn-dark w-100 fw-bold mt-2 shadow-sm" onclick="saveData()">
                    <i class="fa-solid fa-save me-2"></i>Save Updates
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="d-flex justify-content-between align-items-center mb-2">
      <h6 class="fw-bold m-0 text-uppercase text-muted small">Global Overview</h6>
      <div class="small text-muted">
        <i class="fa-solid fa-arrows-left-right me-1"></i> Scroll horizontally
      </div>
    </div>

    <div class="sheet-container">
      <table class="master-table">
        <thead>
          <tr>
            <th class="th-blue" colspan="6">File Info</th>
            <th class="th-orange" colspan="13">Cost</th>
            <th class="th-orange" colspan="13">Advance</th>
            <th class="th-orange" colspan="13">Balance</th>
            <th class="th-blue" colspan="2">Status</th>
          </tr>
          <tr id="gridHeaderRow"></tr>
        </thead>
        <tbody id="gridBody"></tbody>
      </table>
    </div>

  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

  <script>
    /**
     * ============================================================================
     * SMART LS - COST TRACKING ENGINE
     * MERGED: Backend Logic + User UI/UX
     * ============================================================================
     */

    const COST_ITEMS = [
    "Brokerage Fees",   
    "Caution",
    "Customs Clearance",  
    "Demurrage",
    "Destination Fees",
    "Detention",
    "Endorsement",
    "Freight Cost",
    "Port Charges",          
    "Scanning Fees",       
    "Shipping Line Charges", 
    "Staff Transportation",
    "Storage",
    "Transport",
    "Yard Occupancy"
];

    let OPS_DB = [];
    let TRACKER_DB = {};
    let currentFileId = null;

    document.addEventListener('DOMContentLoaded', async () => {
      showLoading();
      await initializeData();
      initFormInputs();
      renderGrid();
      await loadKPIs();
      hideLoading();
    });

    async function initializeData() {
      try {
        const filesResp = await fetch('../../api/cost-tracking/cost-tracking-api.php?action=get_files');
        const filesData = await filesResp.json();
        
        if (filesData.success) {
          OPS_DB = filesData.files;
          initFileSelector();
        } else {
          throw new Error(filesData.error || 'Failed to load files');
        }
        
        const trackerResp = await fetch('../../api/cost-tracking/cost-tracking-api.php?action=get_tracker_data');
        const trackerData = await trackerResp.json();
        
        if (trackerData.success) {
          TRACKER_DB = trackerData.data;
        } else {
          console.warn('No existing tracker data:', trackerData.error);
          TRACKER_DB = {};
        }
        
      } catch (error) {
        console.error('Initialization error:', error);
        alert('Failed to load data. Please refresh. Error: ' + error.message);
      }
    }

    function initFileSelector() {
      const sel = document.getElementById('fileSelector');
      sel.innerHTML = '<option value="">-- Choose Active Operation --</option>';
      OPS_DB.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.text = `${f.id} - ${f.client} (${f.service})`;
        sel.appendChild(opt);
      });
    }

    function initFormInputs() {
      const costContainer = document.getElementById('costInputs');
      const advContainer = document.getElementById('advInputs');
      
      costContainer.innerHTML = '';
      advContainer.innerHTML = '';
      
      COST_ITEMS.forEach((item, idx) => {
        // RESTORED: Your Right-Aligned Input Style
        costContainer.innerHTML += `
          <div class="col-md-3">
            <label class="form-label">${item}</label>
            <input type="number" class="form-control inp-money" 
              id="cost_${idx}" placeholder="0" step="0.01" min="0" oninput="calculate()">
          </div>
        `;
        
        advContainer.innerHTML += `
          <div class="col-md-3">
            <label class="form-label">Adv: ${item}</label>
            <input type="number" class="form-control inp-money" 
              id="adv_${idx}" placeholder="0" step="0.01" min="0" oninput="calculate()">
          </div>
        `;
      });
    }

    function loadFile() {
      currentFileId = document.getElementById('fileSelector').value;
      if (!currentFileId) { resetForm(); return; }
      
      const data = TRACKER_DB[currentFileId] || {
        costs: Array(COST_ITEMS.length).fill(0),
        adv: Array(COST_ITEMS.length).fill(0),
        status: "NOT STARTED"
      };
      
      data.costs.forEach((val, idx) => {
        const input = document.getElementById(`cost_${idx}`);
        if (input) input.value = val > 0 ? val : '';
      });
      
      data.adv.forEach((val, idx) => {
        const input = document.getElementById(`adv_${idx}`);
        if (input) input.value = val > 0 ? val : '';
      });
      
      const statusSelect = document.getElementById('manualStatus');
      if (data.status === 'ON HOLD') {
        statusSelect.value = 'ON HOLD';
      } else {
        statusSelect.value = 'AUTO';
      }
      calculate();
    }

    function calculate() {
      if (!currentFileId) return;
      
      let totalCost = 0;
      let totalAdv = 0;
      let summaryHTML = '';
      let hasAnyCost = false;
      
      COST_ITEMS.forEach((item, idx) => {
        const costInput = document.getElementById(`cost_${idx}`);
        const advInput = document.getElementById(`adv_${idx}`);
        
        const c = parseFloat(costInput?.value || 0);
        const a = parseFloat(advInput?.value || 0);
        const b = c - a;
        
        totalCost += c;
        totalAdv += a;
        if (c > 0) hasAnyCost = true;
        
        // RESTORED: Summary table using your font-mono class
        summaryHTML += `
          <tr>
            <td>${item}</td>
            <td class="text-end font-mono text-muted">${c > 0 ? c.toLocaleString('en-US', {minimumFractionDigits: 2}) : '-'}</td>
            <td class="text-end font-mono text-muted">${a > 0 ? a.toLocaleString('en-US', {minimumFractionDigits: 2}) : '-'}</td>
            <td class="text-end font-mono fw-bold ${b > 0 ? 'text-danger' : 'text-success'}">
              ${b !== 0 ? b.toLocaleString('en-US', {minimumFractionDigits: 2}) : '-'}
            </td>
          </tr>
        `;
      });
      
      const totalBal = totalCost - totalAdv;
      const coverage = totalCost > 0 ? (totalAdv / totalCost) * 100 : 0;
      
      document.getElementById('summaryTableBody').innerHTML = summaryHTML;
      document.getElementById('sumTotalCost').value = totalCost.toLocaleString('en-US', {minimumFractionDigits: 2}) + " XAF";
      document.getElementById('sumTotalAdv').value = totalAdv.toLocaleString('en-US', {minimumFractionDigits: 2}) + " XAF";
      document.getElementById('sumTotalBal').value = totalBal.toLocaleString('en-US', {minimumFractionDigits: 2}) + " XAF";
      
      const bar = document.getElementById('coverageBar');
      bar.style.width = `${Math.min(coverage, 100)}%`;
      document.getElementById('coverageText').innerText = `${coverage.toFixed(1)}%`;
      
      const manStatus = document.getElementById('manualStatus')?.value || 'AUTO';
      let status = "NOT STARTED";
      let statusClass = "bg-light text-muted border";
      
      if (manStatus !== 'AUTO') {
        status = manStatus;
        statusClass = status === 'ON HOLD' ? "bg-danger text-white border-danger" : "bg-secondary text-white";
      } else {
        if (!hasAnyCost) {
          status = "NOT STARTED";
          statusClass = "bg-light text-muted border";
        } else if (totalBal <= 0) {
          status = "COMPLETED";
          statusClass = "bg-success text-white border-success";
        } else {
          status = "IN PROGRESS";
          statusClass = "bg-warning text-dark border-warning";
        }
      }
      
      const badge = document.getElementById('statusDisplay');
      badge.innerText = status;
      badge.className = `badge px-3 py-2 fs-6 ${statusClass}`;
    }

    async function saveData() {
      if (!currentFileId) { alert('Please select a file first'); return; }
      
      const costs = COST_ITEMS.map((_, i) => parseFloat(document.getElementById(`cost_${i}`)?.value || 0));
      const advances = COST_ITEMS.map((_, i) => parseFloat(document.getElementById(`adv_${i}`)?.value || 0));
      const manualStatus = document.getElementById('manualStatus')?.value || 'AUTO';
      
      const payload = { file_ref_no: currentFileId, costs: costs, advances: advances, status: manualStatus };
      
      showLoading();
      try {
        const response = await fetch('../../api/cost-tracking/cost-tracking-api.php?action=save_costs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const result = await response.json();
        
        if (result.success) {
          TRACKER_DB[currentFileId] = { costs: costs, adv: advances, status: document.getElementById('statusDisplay').innerText };
          renderGrid();
          await loadKPIs();
          alert('✓ Cost data saved successfully!');
        } else {
          alert('Error saving data: ' + result.error);
        }
      } catch (error) {
        console.error('Save error:', error);
        alert('Failed to save data. Error: ' + error.message);
      } finally {
        hideLoading();
      }
    }

    function overrideStatus() { calculate(); }

    function renderGrid() {
      const hRow = document.getElementById('gridHeaderRow');
      const tbody = document.getElementById('gridBody');
      hRow.innerHTML = '';
      
      // RESTORED: Your Table Headers (th-sub, col-desc)
      if (!hRow.innerHTML) {
        const descs = ["Ref", "Client", "BL No", "ATA", "Dest", "Service"];
        descs.forEach(d => hRow.innerHTML += `<th class="th-sub col-desc">${d}</th>`);
        
        COST_ITEMS.forEach(d => hRow.innerHTML += `<th class="th-sub">${d}</th>`);
        hRow.innerHTML += `<th class="th-sub col-total">TOTAL COST</th>`;
        
        COST_ITEMS.forEach(d => hRow.innerHTML += `<th class="th-sub">Adv ${d}</th>`);
        hRow.innerHTML += `<th class="th-sub col-total">TOTAL ADV</th>`;
        
        COST_ITEMS.forEach(d => hRow.innerHTML += `<th class="th-sub">Bal ${d}</th>`);
        hRow.innerHTML += `<th class="th-sub col-total">TOTAL BAL</th>`;
        
        hRow.innerHTML += `<th class="th-sub">Status</th><th class="th-sub">Coverage</th>`;
      }
      
      tbody.innerHTML = '';
      let globalCost = 0, globalBal = 0;
      
      OPS_DB.forEach(f => {
        const data = TRACKER_DB[f.id] || { costs: Array(COST_ITEMS.length).fill(0), adv: Array(COST_ITEMS.length).fill(0), status: "NOT STARTED" };
        let rowCost = 0, rowAdv = 0;
        let costCells = '', advCells = '', balCells = '';
        
        COST_ITEMS.forEach((_, i) => {
          const c = data.costs[i] || 0;
          const a = data.adv[i] || 0;
          const b = c - a;
          rowCost += c;
          rowAdv += a;
          
          // RESTORED: Your Table Cells (col-money, col-bal)
          costCells += `<td class="col-money">${c > 0 ? c.toLocaleString('en-US', {minimumFractionDigits: 2}) : '-'}</td>`;
          advCells += `<td class="col-money">${a > 0 ? a.toLocaleString('en-US', {minimumFractionDigits: 2}) : '-'}</td>`;
          balCells += `<td class="col-money col-bal ${b > 0 ? 'text-danger' : 'text-success'}">${b > 0 ? b.toLocaleString('en-US', {minimumFractionDigits: 2}) : '-'}</td>`;
        });
        
        const rowBal = rowCost - rowAdv;
        const cov = rowCost > 0 ? (rowAdv / rowCost) * 100 : 0;
        
        // RESTORED: Your Status Classes
        let stClass = "st-not-started";
        if (data.status === "COMPLETED") stClass = "st-completed";
        if (data.status === "IN PROGRESS") stClass = "st-in-progress";
        if (data.status === "ON HOLD") stClass = "st-hold";
        
        globalCost += rowCost;
        globalBal += rowBal;
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="col-desc fw-bold text-primary font-mono">${f.id}</td>
          <td>${f.client}</td>
          <td>${f.bl || '-'}</td>
          <td>${f.ata || 'TBD'}</td>
          <td>${f.dest || '-'}</td>
          <td><span class="badge bg-light text-dark border">${f.service}</span></td>
          
          ${costCells}
          <td class="col-money col-total">${rowCost.toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
          
          ${advCells}
          <td class="col-money col-total">${rowAdv.toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
          
          ${balCells}
          <td class="col-money col-total text-danger">${rowBal.toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
          
          <td class="status-cell ${stClass}">${data.status}</td>
          <td class="text-center font-mono">${cov.toFixed(0)}%</td>
        `;
        tbody.appendChild(tr);
      });
      
      document.getElementById('kpiTotalCost').innerText = globalCost.toLocaleString('en-US', {minimumFractionDigits: 2}) + " XAF";
      document.getElementById('kpiTotalBal').innerText = globalBal.toLocaleString('en-US', {minimumFractionDigits: 2}) + " XAF";
    }

    async function loadKPIs() {
      try {
        const response = await fetch('../../api/cost-tracking/cost-tracking-api.php?action=get_kpis');
        const result = await response.json();
        if (result.success && result.kpis) console.log('KPIs loaded:', result.kpis);
      } catch (error) { console.error('KPI loading error:', error); }
    }

    function resetForm() {
      currentFileId = null;
      document.querySelectorAll('input[type="number"]').forEach(i => i.value = '');
      document.getElementById('summaryTableBody').innerHTML = '';
      document.getElementById('sumTotalCost').value = '';
      document.getElementById('sumTotalAdv').value = '';
      document.getElementById('sumTotalBal').value = '';
      document.getElementById('coverageBar').style.width = '0%';
      document.getElementById('coverageText').innerText = '0%';
      document.getElementById('statusDisplay').innerText = "NOT STARTED";
      document.getElementById('statusDisplay').className = "badge bg-light text-muted border px-3 py-2 fs-6";
      document.getElementById('manualStatus').value = 'AUTO';
    }

    function exportToCSV() { window.location.href = '../../api/cost-tracking/cost-tracking-api.php?action=export_data'; }
    function showLoading() { document.getElementById('loadingOverlay').classList.add('active'); }
    function hideLoading() { document.getElementById('loadingOverlay').classList.remove('active'); }
  </script>
</body>
</html>