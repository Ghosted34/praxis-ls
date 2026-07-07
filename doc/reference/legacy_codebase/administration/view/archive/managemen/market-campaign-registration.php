<?php
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['MANAGEMENT']);

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
$fullName = $me['full_name'] ?: 'MANAGEMENT';
$firstName = trim(explode(' ', $fullName)[0] ?? 'MANAGEMENT');

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
$avatarUrl = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";

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
  <title>Marketing Campaigns | Smart LS Enterprise</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">

  <style>
    :root{
      --sidebar-width: 280px;
      --smart-blue: #1F99D8;
      --smart-dark: #055B83;
      --smart-orange: #EE7D04;
      --smart-charcoal: #231F20;
      --smart-bg: #F0F4F8;
    }

    body {
      font-family: 'Manrope', sans-serif;
      background-color: var(--smart-bg);
      color: var(--smart-charcoal);
      overflow-x: hidden;
    }

    h1, h2, h3, h4, h5, h6, .font-heading { font-family: 'Montserrat', sans-serif; }

    /* --- LAYOUT (match index.php shell) --- */
    .main-content {
      margin-left: var(--sidebar-width);
      padding-top: 70px;
      min-height: 100vh;
      width: calc(100% - var(--sidebar-width));
    }
    .top-navbar {
      height: 70px;
      position: fixed;
      top: 0;
      right: 0;
      left: var(--sidebar-width);
      z-index: 900;
    }

    /* --- VIBRANT COMPONENTS (kept from original page) --- */
    .card-custom {
      background: white;
      border: 1px solid rgba(0,0,0,0.05);
      border-radius: 12px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.03);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .card-custom:hover { transform: translateY(-3px); box-shadow: 0 8px 20px rgba(0,0,0,0.06); }

    .kpi-card { position: relative; overflow: hidden; border-left: 4px solid transparent; }
    .kpi-card.blue { border-left-color: var(--smart-blue); background: linear-gradient(145deg, #ffffff, #f0f9ff); }
    .kpi-card.orange { border-left-color: var(--smart-orange); background: linear-gradient(145deg, #ffffff, #fff5eb); }
    .kpi-card.teal { border-left-color: #20c997; background: linear-gradient(145deg, #ffffff, #e6fff7); }
    .kpi-card.purple { border-left-color: #6f42c1; background: linear-gradient(145deg, #ffffff, #f3eaff); }

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

    .platform-icon { width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; color: white; font-size: 0.8rem; margin-right: 8px; }
    .pf-meta { background-color: #1877F2; }
    .pf-google { background-color: #DB4437; }
    .pf-linkedin { background-color: #0077B5; }
    .pf-email { background-color: var(--smart-orange); }
    .pf-offline { background-color: var(--smart-charcoal); }

    .metric-badge { font-size: 0.75rem; font-weight: 700; padding: 4px 8px; border-radius: 6px; background: #f8f9fa; border: 1px solid #dee2e6; color: #495057; display: inline-block; min-width: 60px; text-align: center; }
    .calc-pill { font-size: 0.75rem; font-weight: 700; background: #eef7fc; color: var(--smart-blue); padding: 4px 10px; border-radius: 20px; }
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

  <!-- TOP NAVBAR (from index.php; title adjusted) -->
  <div class="top-navbar">
    <div>
      <h5 class="mb-0 fw-bold text-dark">Campaign Register</h5>
      <small class="text-muted" style="font-size: 0.7rem;">MARKETING PERFORMANCE & ATTRIBUTION</small>
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

  <!-- MAIN CONTENT (unchanged module content) -->
  <main class="main-content px-4 pb-5">

    <div id="moduleShell" class="py-4">

      <div class="d-flex justify-content-between align-items-end mb-4">
        <div>
          <h2 class="fw-bold font-heading mb-1 text-dark">Campaigns</h2>
          <p class="text-muted small mb-0">Track spend, ROI, and attribution across all channels.</p>
        </div>
        <div class="d-none gap-2">
          <button class="btn btn-white border fw-bold shadow-sm text-primary"><i class="fa-solid fa-download me-2"></i>Export Report</button>
          
        </div>
      </div>

      <div class="row g-3 mb-4">
        <div class="col-md-3">
          <div class="card-custom kpi-card blue p-3 d-flex align-items-center h-100">
            <div class="me-3 kpi-icon bg-primary text-white"><i class="fa-solid fa-wallet"></i></div>
            <div><div class="kpi-title">Total Spend (Q1)</div><div class="kpi-value" id="kpiSpend">-</div></div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card-custom kpi-card purple p-3 d-flex align-items-center h-100">
            <div class="me-3 kpi-icon" style="background-color: #6f42c1; color: white;"><i class="fa-solid fa-filter"></i></div>
            <div><div class="kpi-title">Leads Generated</div><div class="kpi-value" id="kpiLeads">-</div></div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card-custom kpi-card teal p-3 d-flex align-items-center h-100">
            <div class="me-3 kpi-icon text-white" style="background-color: #20c997;"><i class="fa-solid fa-hand-holding-dollar"></i></div>
            <div><div class="kpi-title">Deals Won</div><div class="kpi-value" style="color: #20c997;" id="kpiWon">-</div></div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card-custom kpi-card orange p-3 d-flex align-items-center h-100">
            <div class="me-3 kpi-icon bg-warning text-dark"><i class="fa-solid fa-percent"></i></div>
            <div><div class="kpi-title">Avg. Conversion</div><div class="kpi-value text-warning" id="kpiConv">-</div></div>
          </div>
        </div>
      </div>

      <div class="card-custom p-4 mb-4">
        <div class="row g-2 align-items-end">
          <div class="col-md-4">
            <label class="small fw-bold text-muted mb-1 text-uppercase">Search</label>
            <div class="input-group">
              <span class="input-group-text bg-white border-end-0"><i class="fa-solid fa-search text-muted"></i></span>
              <input id="qSearch" onkeyup="renderTable()" type="text" class="form-control smart-input border-start-0 ps-0" placeholder="Campaign Name, Owner...">
            </div>
          </div>
          <div class="col-md-3">
            <label class="small fw-bold text-muted mb-1 text-uppercase">Platform</label>
            <select id="qPlatform" onchange="renderTable()" class="form-select smart-input">
              <option value="">All Platforms</option>
              <option value="META">Meta Ads</option>
              <option value="GOOGLE">Google Ads</option>
              <option value="LINKEDIN">LinkedIn</option>
              <option value="EMAIL">Email</option>
              <option value="OFFLINE">Offline Event</option>
            </select>
          </div>
          <div class="col-md-3">
            <label class="small fw-bold text-muted mb-1 text-uppercase">Status</label>
            <select id="qStatus" onchange="renderTable()" class="form-select smart-input">
              <option value="">All Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="PLANNED">Planned</option>
              <option value="COMPLETED">Completed</option>
              <option value="PAUSED">Paused</option>
            </select>
          </div>
          <div class="col-md-2">
            <button onclick="resetFilters()" class="btn btn-light border fw-bold w-100 smart-input text-dark"><i class="fa-solid fa-rotate-left"></i> Reset</button>
          </div>
        </div>
      </div>

      <div class="card-custom overflow-hidden p-0 border-0 shadow-sm">
        <div class="table-responsive">
          <table class="table table-hover table-custom mb-0">
            <thead>
              <tr>
                <th class="ps-4">Campaign Name</th>
                <th>Platform</th>
                <th>Budget</th>
                <th>Perf (L / O / W)</th>
                <th>Dates</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody id="tableBody"></tbody>
          </table>
        </div>
      </div>

      <div class="alert alert-light border mt-4 d-flex align-items-start gap-3 shadow-sm">
        <i class="fa-solid fa-circle-info text-primary mt-1"></i>
        <div>
          <h6 class="fw-bold small mb-1 text-dark">Data Input Mode</h6>
          <ul class="mb-0 small text-muted ps-3">
            <li>Performance metrics (Leads, Wins) are currently in <strong>Manual Entry Mode</strong>.</li>
            <li>Update these figures weekly based on external ad manager reports.</li>
          </ul>
        </div>
      </div>

    </div>
  </main>

  <div class="offcanvas offcanvas-end" tabindex="-1" id="campaignDrawer" style="width: 800px;">
    <div class="offcanvas-header border-bottom bg-light py-3">
      <div>
        <h5 class="offcanvas-title font-heading fw-bold" id="drawerTitle">Create Campaign</h5>
        <small class="text-muted font-monospace" id="drawerId">ID: New</small>
      </div>
      <button type="button" class="btn-close" data-bs-dismiss="offcanvas"></button>
    </div>

    <div class="offcanvas-body p-0 bg-white">
      <form id="campaignForm" class="p-4">
        <h6 class="text-uppercase small fw-bold text-muted border-bottom pb-2 mb-3">Campaign Setup</h6>
        <div class="row g-3 mb-4">
          <div class="col-md-8">
            <label class="form-label small fw-bold text-muted">Campaign Name <span class="text-danger">*</span></label>
            <input type="text" class="form-control smart-input" id="dName" readonly>
          </div>
          <div class="col-md-4">
            <label class="form-label small fw-bold text-muted">Platform <span class="text-danger">*</span></label>
            <select class="form-select smart-input" id="dPlatform">
              <option value="META">Meta Ads</option>
              <option value="GOOGLE">Google Ads</option>
              <option value="LINKEDIN">LinkedIn</option>
              <option value="EMAIL">Email Blast</option>
              <option value="OFFLINE">Offline / Event</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <div class="col-md-6">
            <label class="form-label small fw-bold text-muted">Start Date <span class="text-danger">*</span></label>
            <input type="date" class="form-control smart-input" id="dStartDate" readonly>
          </div>
          <div class="col-md-6">
            <label class="form-label small fw-bold text-muted">End Date</label>
            <input type="date" class="form-control smart-input" id="dEndDate">
          </div>
        </div>

        <h6 class="text-uppercase small fw-bold text-muted border-bottom pb-2 mb-3">Financials & Target</h6>
        <div class="row g-3 mb-4">
          <div class="col-md-4">
            <label class="form-label small fw-bold text-muted">Budget Amount</label>
            <div class="input-group">
              <input type="number" class="form-control smart-input" id="dBudget" oninput="calculateCalculatedMetrics()" readonly>
              <span class="input-group-text bg-light">XAF</span>
            </div>
          </div>
          <div class="col-md-8">
            <label class="form-label small fw-bold text-muted">Target Service</label>
            <select class="form-select smart-input" id="dTarget">
              <option value="ALL">General Brand Awareness</option>
              <option value="SEA_FREIGHT">Sea Freight Import/Export</option>
              <option value="AIR_FREIGHT">Air Freight</option>
              <option value="WAREHOUSING">Warehousing Solutions</option>
            </select>
          </div>
        </div>

        <div class="p-3 bg-light rounded border mb-4">
          <div class="d-flex align-items-center justify-content-between mb-3">
            <h6 class="text-uppercase small fw-bold text-primary mb-0"><i class="fa-solid fa-pen-to-square me-2"></i>Performance Results (Manual)</h6>
            <span class="badge bg-white text-muted border">Editable</span>
          </div>
          <div class="row g-3 text-center">
            <div class="col-4">
              <div class="bg-white p-2 rounded border">
                <label class="small fw-bold text-muted mb-1">Leads Generated</label>
                <input type="number" class="form-control smart-input text-center fw-bold text-dark fs-5" id="dLeads" value="0" oninput="calculateCalculatedMetrics()" readonly>
              </div>
            </div>
            <div class="col-4">
              <div class="bg-white p-2 rounded border">
                <label class="small fw-bold text-muted mb-1">Opportunities</label>
                <input type="number" class="form-control smart-input text-center fw-bold text-primary fs-5" id="dOps" value="0" oninput="calculateCalculatedMetrics()" readonly>
              </div>
            </div>
            <div class="col-4">
              <div class="bg-white p-2 rounded border">
                <label class="small fw-bold text-muted mb-1">Conversions Won</label>
                <input type="number" class="form-control smart-input text-center fw-bold text-success fs-5" id="dWon" value="0" oninput="calculateCalculatedMetrics()" readonly>
              </div>
            </div>
            <div class="col-12 mt-2">
              <div class="d-flex justify-content-center gap-3">
                <span class="calc-pill" id="calcCPL">CPL: -</span>
                <span class="calc-pill" id="calcCPW">Cost/Win: -</span>
              </div>
            </div>
          </div>
        </div>

        <h6 class="text-uppercase small fw-bold text-muted border-bottom pb-2 mb-3">Ownership</h6>
        <div class="row g-3">
          <div class="col-md-6">
            <label class="form-label small fw-bold text-muted">Campaign Owner</label>
            <input type="text" class="form-control smart-input" id="dOwner" value="Current User" readonly>
          </div>
          <div class="col-md-6">
            <label class="form-label small fw-bold text-muted">Status</label>
            <select class="form-select smart-input fw-bold" id="dStatus">
              <option value="PLANNED">PLANNED</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="PAUSED">PAUSED</option>
              <option value="COMPLETED">COMPLETED</option>
            </select>
          </div>
        </div>
      </form>

      <div class="p-4 border-top sticky-bottom bg-white d-flex justify-content-end gap-2">
        <button type="button" class="btn btn-light fw-bold border" data-bs-dismiss="offcanvas">Cancel</button>
        
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

  <script>
  // --- API CONFIG ---
  const CAMPAIGN_LIST_API = '../../api/marketing_campaign/list.php';
  const CAMPAIGN_SAVE_API = '../../api/marketing_campaign/save.php';

  // --- CONFIG ---
  const PLATFORM_CONFIG = {
    'META': { icon: '<i class="fa-brands fa-facebook-f"></i>', class: 'pf-meta', label: 'Meta Ads' },
    'GOOGLE': { icon: '<i class="fa-brands fa-google"></i>', class: 'pf-google', label: 'Google Ads' },
    'LINKEDIN': { icon: '<i class="fa-brands fa-linkedin-in"></i>', class: 'pf-linkedin', label: 'LinkedIn' },
    'EMAIL': { icon: '<i class="fa-solid fa-envelope"></i>', class: 'pf-email', label: 'Email' },
    'OFFLINE': { icon: '<i class="fa-solid fa-handshake"></i>', class: 'pf-offline', label: 'Offline' },
    'OTHER': { icon: '<i class="fa-solid fa-globe"></i>', class: 'bg-secondary', label: 'Other' }
  };

  const STATUS_BADGES = {
    'ACTIVE': 'bg-success bg-opacity-10 text-success border border-success border-opacity-25',
    'PLANNED': 'bg-primary bg-opacity-10 text-primary border border-primary border-opacity-25',
    'PAUSED': 'bg-warning bg-opacity-10 text-warning-emphasis border border-warning border-opacity-25',
    'COMPLETED': 'bg-secondary bg-opacity-10 text-secondary border border-secondary border-opacity-25'
  };

  let campaigns = [];
  let currentMode = 'create';
  let editingId = null;

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    }[c]));
  }

  // --- LOAD FROM DB (rows + KPIs) ---
  async function loadCampaigns() {
    const q = (document.getElementById('qSearch')?.value || '').trim();
    const platform = document.getElementById('qPlatform')?.value || '';
    const status = document.getElementById('qStatus')?.value || '';

    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (platform) qs.set('platform', platform);
    if (status) qs.set('status', status);

    try {
      const res = await fetch(`${CAMPAIGN_LIST_API}?${qs.toString()}`, { credentials: 'same-origin' });
      const data = await res.json();

      if (!data?.ok) {
        alert(data?.error || 'Failed to load campaigns');
        return;
      }

      campaigns = Array.isArray(data.rows) ? data.rows : [];

      // KPIs (DB-backed)
      const totalSpend = Number(data.kpis?.total_spend || 0);
      const totalLeads = Number(data.kpis?.total_leads || 0);
      const totalWon   = Number(data.kpis?.total_won || 0);
      const avgConv    = Number(data.kpis?.avg_conv || 0);

      document.getElementById('kpiSpend').innerText = (totalSpend / 1000000).toFixed(1) + 'M';
      document.getElementById('kpiLeads').innerText = totalLeads;
      document.getElementById('kpiWon').innerText = totalWon;
      document.getElementById('kpiConv').innerText = avgConv.toFixed(1) + '%';

      renderTable();
    } catch (err) {
      console.error(err);
      alert('Network error while loading campaigns.');
    }
  }

  // --- RENDER (no client-side filtering; DB already did it) ---
  function renderTable() {
    const tbody = document.getElementById('tableBody');

    if (!Array.isArray(campaigns) || campaigns.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center p-5 text-muted fw-bold">No campaigns found.</td></tr>`;
      return;
    }

    tbody.innerHTML = campaigns.map(c => {
      const pf = PLATFORM_CONFIG[c.platform] || PLATFORM_CONFIG['OTHER'];

      const budget = Number(c.budget_amount || 0);
      const leads  = Number(c.leads || 0);
      const ops    = Number(c.opportunities || 0);
      const won    = Number(c.won || 0);

      const startLabel = c.start_date ? new Date(c.start_date).toLocaleDateString() : '--';
      const endLabel   = c.end_date ? new Date(c.end_date).toLocaleDateString() : null;

      const badgeClass = STATUS_BADGES[c.status] || 'bg-secondary bg-opacity-10 text-secondary border border-secondary border-opacity-25';

      return `
        <tr>
          <td class="ps-4">
            <div class="d-flex align-items-center">
              <div class="platform-icon ${pf.class}">${pf.icon}</div>
              <div>
                <div class="fw-bold text-dark" style="font-size:0.9rem;">${escapeHtml(c.name)}</div>
                <div class="small text-muted" style="font-size:0.7rem;">ID: ${escapeHtml(String(c.id).substring(0,6))}...</div>
              </div>
            </div>
          </td>
          <td><span class="fw-bold small text-muted">${pf.label}</span></td>
          <td class="font-monospace fw-bold small text-dark">${budget.toLocaleString()}</td>
          <td>
            <span class="metric-badge me-1" title="Leads">${leads}</span>
            <span class="metric-badge me-1 bg-light text-primary" title="Opportunities">${ops}</span>
            <span class="metric-badge bg-light text-success" title="Won">${won}</span>
          </td>
          <td class="small text-muted">
            <div>${startLabel}</div>
            ${endLabel ? `<div>to ${endLabel}</div>` : '<div class="fst-italic">Ongoing</div>'}
          </td>
          <td><span class="badge ${badgeClass} rounded-pill px-3 py-2 fw-bold" style="font-size:0.7rem;">${escapeHtml(c.status)}</span></td>
          
        </tr>
      `;
    }).join('');
  }

  // --- DRAWER ACTIONS ---
  const drawer = new bootstrap.Offcanvas(document.getElementById('campaignDrawer'));

  function openDrawer(mode, id) {
    currentMode = mode;
    const form = document.getElementById('campaignForm');

    if (mode === 'create') {
      editingId = null;
      form.reset();
      document.getElementById('drawerTitle').innerText = "Create Campaign";
      document.getElementById('drawerId').innerText = "ID: New";
      document.getElementById('dLeads').value = "0";
      document.getElementById('dOps').value = "0";
      document.getElementById('dWon').value = "0";
      calculateCalculatedMetrics();
    } else {
      const c = campaigns.find(x => x.id === id);
      if (!c) return;
      editingId = id;

      document.getElementById('drawerTitle').innerText = "Manage Campaign";
      document.getElementById('drawerId').innerText = `ID: ${c.id}`;

      document.getElementById('dName').value = c.name || '';
      document.getElementById('dPlatform').value = c.platform || 'META';
      document.getElementById('dStartDate').value = c.start_date || '';
      document.getElementById('dEndDate').value = c.end_date || '';
      document.getElementById('dBudget').value = c.budget_amount ?? 0;
      document.getElementById('dTarget').value = c.target_service || 'ALL';
      document.getElementById('dOwner').value = c.owner_name || 'Current User';
      document.getElementById('dStatus').value = c.status || 'PLANNED';

      document.getElementById('dLeads').value = c.leads ?? 0;
      document.getElementById('dOps').value = c.opportunities ?? 0;
      document.getElementById('dWon').value = c.won ?? 0;

      calculateCalculatedMetrics();
    }

    drawer.show();
  }

  function calculateCalculatedMetrics() {
    const budget = parseFloat(document.getElementById('dBudget').value) || 0;
    const leads = parseFloat(document.getElementById('dLeads').value) || 0;
    const won = parseFloat(document.getElementById('dWon').value) || 0;

    const cpl = leads > 0 ? (budget / leads).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '-';
    const cpw = won > 0 ? (budget / won).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '-';

    document.getElementById('calcCPL').innerText = `CPL: ${cpl} XAF`;
    document.getElementById('calcCPW').innerText = `Cost/Win: ${cpw} XAF`;
  }

  // --- SAVE TO DB (create/update) ---
  async function saveCampaign() {
    const name = document.getElementById('dName').value.trim();
    const platform = document.getElementById('dPlatform').value;
    const start = document.getElementById('dStartDate').value;
    const end = document.getElementById('dEndDate').value || null;

    const budget = parseFloat(document.getElementById('dBudget').value) || 0;
    const target = document.getElementById('dTarget').value;
    const owner = document.getElementById('dOwner').value || 'Current User';
    const status = document.getElementById('dStatus').value;

    const leads = parseInt(document.getElementById('dLeads').value, 10) || 0;
    const ops = parseInt(document.getElementById('dOps').value, 10) || 0;
    const won = parseInt(document.getElementById('dWon').value, 10) || 0;

    if (!name || !start) {
      alert("Please fill required fields (Name, Start Date).");
      return;
    }

    const id = (currentMode === 'create') ? crypto.randomUUID() : editingId;

    const payload = {
      id,
      name,
      platform,
      start_date: start,
      end_date: end,
      budget_amount: budget,
      currency: 'XAF',
      target_service: target,
      leads,
      opportunities: ops,
      won,
      status,
      owner_name: owner
    };

    try {
      const res = await fetch(CAMPAIGN_SAVE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!data?.ok) {
        alert(data?.error || 'Save failed');
        return;
      }

      drawer.hide();
      await loadCampaigns();
      alert("Campaign Saved Successfully.");
    } catch (err) {
      console.error(err);
      alert('Network error while saving campaign.');
    }
  }

  function resetFilters() {
    document.getElementById('qSearch').value = '';
    document.getElementById('qPlatform').value = '';
    document.getElementById('qStatus').value = '';
    loadCampaigns();
  }

  // Init (DB-backed)
  document.addEventListener('DOMContentLoaded', () => {
    loadCampaigns();
  });
</script>

</body>
</html>
