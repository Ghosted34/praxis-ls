<?php
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['SALES']);

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
$fullName = $me['full_name'] ?: 'Sales';
$firstName = trim(explode(' ', $fullName)[0] ?? 'Sales');

$roleLabelMap = [
  'ADMIN'      => 'SYSTEM ADMIN',
  'FINANCE'    => 'FINANCE',
  'SALES'      => 'SALES',
  'OPERATIONS' => 'OPERATIONS',
  'MANAGEMENT' => 'MANAGEMENT',
];
$role = strtoupper((string)($me['role'] ?? 'Sales'));
$roleLabel = $roleLabelMap[$role] ?? 'Sales';

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
    /* PATCH: KPI Input Styling */
.input-target { background-color: #ffffff; border: 1px dashed #adb5bd; color: #495057; }
.input-actual { background-color: #f0fff4; border: 1px solid #198754; color: #198754; font-weight: 700; }
.locked-input { background-color: #f8f9fa; border: 1px solid #dee2e6; color: #6c757d; cursor: not-allowed; }
.calc-pill-sm { font-size: 0.7rem; font-weight: 700; padding: 2px 8px; border-radius: 10px; background: #eef7fc; color: var(--smart-blue); }
/* PATCH: Rejection UI Styling */
.badge-rejected { background-color: #fff5f5; color: #e53e3e; border: 1px solid #feb2b2; font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; font-weight: 800; text-transform: uppercase; }
.alert-rejection { background-color: #fff5f5; border-left: 4px solid #e53e3e; color: #c53030; padding: 12px; border-radius: 8px; margin-bottom: 20px; }
.rejection-input-area { background-color: #fffaf0; border: 1px solid #feebc8; padding: 15px; border-radius: 8px; margin-top: 10px; }
  </style>
</head>
<body>

  <!-- SIDEBAR (from index.php) -->
   <nav class="sidebar">
    <div class="sidebar-header">
        <a href="index.php" class="brand-logo"><i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span></a>
    </div>

    <div class="px-3 mb-2 mt-2">
        <a href="index.php" class="btn btn-primary w-100 text-start d-flex align-items-center" style="background-color: transparent; color: inherit; border: none; padding-left: 0;">
            <i class="fa-solid fa-house category-icon me-2"></i> 
            <span class="fw-bold">Sales Dashboard</span> 
        </a>
    </div>

    <div class="sidebar-menu accordion" id="salesMenu">
        
        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#sales1">
                <span><i class="fa-solid fa-database category-icon"></i>MASTER DATA MGMT</span>
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
                <span><i class="fa-solid fa-users category-icon"></i>CRM & ACQUISITION</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="sales2" class="accordion-collapse collapse show" data-bs-parent="#salesMenu">
                <div class="sub-menu">
                    <a href="contact-us-intake.php" class="sub-link">Contact Us Intake</a>
                    <a href="partnership-portal-intake.php" class="sub-link">Partnership Portal Intake</a>
                    <a href="market-campaign-registration.php" class="sub-link active">Marketing Campaign Register</a>
                    <a href="smart-quote-intake.php" class="sub-link">Smart Quote Intake</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#sales3">
                <span><i class="fa-solid fa-filter category-icon"></i>SALES FUNNEL</span>
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
                <span><i class="fa-solid fa-calculator category-icon"></i>COMMERCIAL & PRICING</span>
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
                <span><i class="fa-solid fa-truck-fast category-icon"></i>LOGISTICS OPERATIONS</span>
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
                <span><i class="fa-solid fa-building-columns category-icon"></i>FINANCE & TREASURY</span>
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
                <span><i class="fa-solid fa-box-archive category-icon"></i>COMPANY ARCHIVES</span>
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
        <div class="d-flex gap-2">
          <button onclick="exportCampaigns()" class="btn btn-white border fw-bold shadow-sm text-primary">
          <i class="fa-solid fa-download me-2"></i>Export Report
        </button>

          <button onclick="openDrawer('create')" class="btn btn-smart-primary fw-bold shadow-sm"><i class="fa-solid fa-plus me-2"></i>New Campaign</button>
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
    <div id="rejectionAlert" class="alert-rejection d-none">
    <div class="d-flex align-items-center gap-2 mb-1">
        <i class="fa-solid fa-circle-exclamation"></i>
        <strong class="small text-uppercase">Management Feedback</strong>
    </div>
    <div id="rejectionText" class="small fw-bold"></div>
</div>

<div id="managementRejectAction" class="col-12 d-none mt-2">
    <div class="rejection-input-area">
        <label class="form-label small fw-bold text-warning-emphasis text-uppercase" style="font-size: 0.65rem;">Reason for Rejection (Visible to Sales)</label>
        <textarea class="form-control smart-input border-warning" id="dManageRejectReason" rows="2" placeholder="e.g., Budget exceeds Q1 allocation for Sea Freight. Please reduce by 20%..."></textarea>
        <button type="button" class="btn btn-danger btn-sm fw-bold mt-2 w-100" onclick="performRejection()">
            <i class="fa-solid fa-xmark me-1"></i> Send Back for Correction
        </button>
    </div>
</div>
    <div class="offcanvas-body p-0 bg-white">
      <form id="campaignForm" class="p-4">
        <h6 class="text-uppercase small fw-bold text-muted border-bottom pb-2 mb-3">Campaign Setup</h6>
        <div class="row g-3 mb-4">
          <div class="col-md-8">
            <label class="form-label small fw-bold text-muted">Campaign Name <span class="text-danger">*</span></label>
            <input type="text" class="form-control smart-input" id="dName" required>
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
            <input type="date" class="form-control smart-input" id="dStartDate">
          </div>
          <div class="col-md-6">
            <label class="form-label small fw-bold text-muted">End Date</label>
            <input type="date" class="form-control smart-input" id="dEndDate">
          </div>
        </div>

        <h6 class="text-uppercase small fw-bold text-muted border-bottom pb-2 mb-3">Financials & Strategy</h6>
        <div class="row g-3 mb-4">
            <div class="col-md-4">
                <label class="form-label small fw-bold text-muted">Budget (XAF)</label>
                <input type="number" class="form-control smart-input fw-bold" id="dBudget" oninput="calculateCalculatedMetrics()">
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
            <div class="col-12">
                <label class="form-label small fw-bold text-muted">Campaign Remarks / Management Justification</label>
                <textarea class="form-control smart-input" id="dRemarks" rows="2" placeholder="Detail campaign objectives..."></textarea>
            </div>
        </div>

        <div class="row g-3 mb-4">
            <div class="col-md-6">
                <div class="p-3 bg-light rounded border">
                    <div class="d-flex justify-content-between mb-2">
                        <h6 class="text-uppercase mb-0" style="font-size: 0.7rem; font-weight: 800; color: #6c757d;">Planned Targets</h6>
                        <span class="calc-pill-sm" id="calcTargetCPL">CPL: -</span>
                    </div>
                    <div class="row g-2">
                        <div class="col-4"><input type="number" class="form-control smart-input text-center input-target" id="dTargetLeads" value="0" oninput="calculateCalculatedMetrics()"></div>
                        <div class="col-4"><input type="number" class="form-control smart-input text-center input-target" id="dTargetOps" value="0"></div>
                        <div class="col-4"><input type="number" class="form-control smart-input text-center input-target" id="dTargetWon" value="0"></div>
                    </div>
                    <div class="d-flex justify-content-between mt-1 px-1" style="font-size: 0.6rem; font-weight: 700; color: #adb5bd;">
                        <span>LEADS</span><span>OPS</span><span>WINS</span>
                    </div>
                </div>
            </div>
            <div class="col-md-6">
                <div class="p-3 rounded border" style="background-color: #e6fffa; border-color: #b2f5ea !important;">
                    <div class="d-flex justify-content-between mb-2">
                        <h6 class="text-uppercase mb-0" style="font-size: 0.7rem; font-weight: 800; color: #198754;">Real Amounts</h6>
                        <span class="calc-pill-sm" id="calcRealCPL" style="background:#d1e7dd; color:#0f5132;">CPL: -</span>
                    </div>
                    <div class="row g-2">
                        <div class="col-4"><input type="number" class="form-control smart-input text-center input-actual" id="dLeads" value="0" oninput="calculateCalculatedMetrics()"></div>
                        <div class="col-4"><input type="number" class="form-control smart-input text-center input-actual" id="dOps" value="0"></div>
                        <div class="col-4"><input type="number" class="form-control smart-input text-center input-actual" id="dWon" value="0"></div>
                    </div>
                    <div class="d-flex justify-content-between mt-1 px-1" style="font-size: 0.6rem; font-weight: 700; color: #198754;">
                        <span>LEADS</span><span>OPS</span><span>WINS</span>
                    </div>
                </div>
            </div>
        </div>

        <h6 class="text-uppercase small fw-bold text-muted border-bottom pb-2 mb-3">Ownership</h6>
        <div class="row g-3">
            <div class="col-md-6">
                <label class="form-label small fw-bold text-muted">Campaign Owner</label>
                <input type="text" class="form-control smart-input locked-input" id="dOwner" value="<?php echo e($fullName); ?>" readonly>
            </div>
            <div class="col-md-6">
                <label class="form-label small fw-bold text-muted">Status</label>
                <select class="form-select smart-input fw-bold" id="dStatus" onchange="toggleInputLocking()">
                    <option value="PLANNED">DRAFT (Planned)</option>
                    <option value="PENDING_APPROVAL">PENDING APPROVAL</option>
                    <option value="ACTIVE">ACTIVE (Running)</option>
                    <option value="PAUSED">PAUSED</option>
                    <option value="COMPLETED">COMPLETED</option>
                </select>
            </div>
        </div>
      </form>

      <div class="p-4 border-top sticky-bottom bg-white d-flex justify-content-between align-items-center">
        <div id="approvalBadge"></div>
        <div class="d-flex gap-2">
            <button type="button" class="btn btn-light fw-bold border" data-bs-dismiss="offcanvas">Cancel</button>
            <button type="button" class="btn btn-smart-primary fw-bold" onclick="saveCampaign()">Save</button>
            
            <a id="cashRequestLink" href="#" class="btn btn-warning fw-bold d-none">
                <i class="fa-solid fa-money-bill-transfer me-1"></i> Request Cash
            </a>
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
    'COMPLETED': 'bg-secondary bg-opacity-10 text-secondary border border-secondary border-opacity-25',
    'PENDING_APPROVAL': 'bg-warning bg-opacity-25 text-dark border border-warning'
  };

  let campaigns = [];
  let currentMode = 'create';
  let editingId = null;

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    }[c]));
  }

  // --- LOAD FROM DB ---
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
        console.error(data?.error); 
        return;
      }

      campaigns = Array.isArray(data.rows) ? data.rows : [];

      // KPIs
      const totalSpend = Number(data.kpis?.total_spend || 0);
      const totalLeads = Number(data.kpis?.total_leads || 0);
      const totalWon   = Number(data.kpis?.total_won || 0);
      const avgConv    = Number(data.kpis?.avg_conv || 0);

      if(document.getElementById('kpiSpend')) document.getElementById('kpiSpend').innerText = (totalSpend / 1000000).toFixed(1) + 'M';
      if(document.getElementById('kpiLeads')) document.getElementById('kpiLeads').innerText = totalLeads;
      if(document.getElementById('kpiWon')) document.getElementById('kpiWon').innerText = totalWon;
      if(document.getElementById('kpiConv')) document.getElementById('kpiConv').innerText = avgConv.toFixed(1) + '%';

      renderTable();
    } catch (err) {
      console.error(err);
    }
  }
    
  // --- LOCKING LOGIC ---
  function toggleInputLocking() {
    // 1. Define status FIRST
    const statusEl = document.getElementById('dStatus');
    if (!statusEl) return;
    const status = statusEl.value;
    
    // 2. Define roles and other elements
    const userRole = '<?php echo $role; ?>';
    const rejectActionArea = document.getElementById('managementRejectAction');
    const cashLink = document.getElementById('cashRequestLink');
    const saveBtn = document.querySelector('button[onclick*="saveCampaign"]');

    // 3. Logic for Rejection Box
    if (rejectActionArea) {
        if (status === 'PENDING_APPROVAL' && (userRole === 'ADMIN' || userRole === 'MANAGEMENT')) {
            rejectActionArea.classList.remove('d-none');
        } else {
            rejectActionArea.classList.add('d-none');
        }
    }

    // 4. Logic for Cash Link
    if (cashLink) {
        if (status === 'ACTIVE') {
            cashLink.classList.remove('d-none');
            const campName = encodeURIComponent(document.getElementById('dName').value);
            const campBudget = document.getElementById('dBudget').value;
            cashLink.href = `cash-request.php?ref=${campName}&amt=${campBudget}`;
        } else {
            cashLink.classList.add('d-none');
        }
    }
    
    // 5. Logic for Fields
    const targetFields = ['dTargetLeads', 'dTargetOps', 'dTargetWon', 'dBudget', 'dRemarks'];
    const realFields = ['dLeads', 'dOps', 'dWon'];

    const setLock = (ids, isLocked) => {
        ids.forEach(id => { 
            const el = document.getElementById(id); 
            if(el) {
                el.readOnly = isLocked;
                if(isLocked) el.classList.add('locked-input');
                else el.classList.remove('locked-input');
            }
        });
    };

    if (status === 'PLANNED') {
        // Planning: Targets Open, Real Closed
        setLock(targetFields, false);
        setLock(realFields, true);
        if(saveBtn) { saveBtn.innerText = "Save Draft"; saveBtn.className = "btn btn-secondary fw-bold"; saveBtn.disabled = false; }
    } 
    else if (status === 'PENDING_APPROVAL') {
        // Review: ALL Locked
        setLock(targetFields, true);
        setLock(realFields, true);
        if(saveBtn) {
            if (userRole === 'ADMIN' || userRole === 'MANAGEMENT') {
                saveBtn.innerText = "Approve & Activate";
                saveBtn.className = "btn btn-success fw-bold";
                saveBtn.disabled = false;
            } else {
                saveBtn.innerText = "Awaiting Management...";
                saveBtn.disabled = true;
            }
        }
    }
    else if (status === 'ACTIVE') {
        // Active: Targets Locked, Real Open
        setLock(targetFields, true);
        setLock(realFields, false);
        if(saveBtn) { saveBtn.innerText = "Update Performance"; saveBtn.className = "btn btn-smart-primary fw-bold"; saveBtn.disabled = false; }
    }
    else {
        // Completed/Paused: All Locked
        setLock(targetFields, true);
        setLock(realFields, true);
    }
  }

  // --- REJECTION LOGIC ---
  async function performRejection() {
    const reason = document.getElementById('dManageRejectReason').value.trim();
    if (!reason) {
        alert("Please provide a reason for rejection so the team knows what to fix.");
        return;
    }

    if (!confirm("Are you sure you want to reject this campaign and send it back to Sales?")) return;

    // Set status back to PLANNED and include the reason
    document.getElementById('dStatus').value = 'PLANNED';
    
    // Call the existing save function
    await saveCampaign(reason); 
  }

  // --- RENDER TABLE ---
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
      const badgeClass = STATUS_BADGES[c.status] || 'bg-secondary text-white';

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
          <td>
            <span class="badge ${badgeClass} rounded-pill px-3 py-2 fw-bold" style="font-size:0.7rem;">${escapeHtml(c.status)}</span>
            ${c.rejection_reason ? `<div class="mt-1"><span class="badge-rejected"><i class="fa-solid fa-triangle-exclamation me-1"></i>Rejected</span></div>` : ''}
          </td>
          <td class="text-end pe-4">
            <button onclick="openDrawer('edit', '${c.id}')" class="btn btn-sm btn-outline-dark fw-bold">Manage</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // --- DRAWER ACTIONS ---
  const drawerEl = document.getElementById('campaignDrawer');
  const drawer = new bootstrap.Offcanvas(drawerEl);

  function openDrawer(mode, id) {
    currentMode = mode;
    const form = document.getElementById('campaignForm');
    const rejectionAlert = document.getElementById('rejectionAlert');

    if (mode === 'create') {
        editingId = null;
        form.reset();
        document.getElementById('drawerTitle').innerText = "Create Campaign";
        document.getElementById('drawerId').innerText = "ID: New";
        
        // Hide rejection alert
        if (rejectionAlert) rejectionAlert.classList.add('d-none');
        
        // Defaults
        document.getElementById('dStatus').value = "PLANNED";
        ['dLeads', 'dOps', 'dWon', 'dTargetLeads', 'dTargetOps', 'dTargetWon'].forEach(id => {
            const el = document.getElementById(id);
            if(el) el.value = "0";
        });
        
        calculateCalculatedMetrics();
    } else {
        const c = campaigns.find(x => x.id === id);
        if (!c) return;
        editingId = id;

        // Rejection Alert Logic
        if (rejectionAlert) {
            if (c.rejection_reason) {
                rejectionAlert.classList.remove('d-none');
                document.getElementById('rejectionText').innerText = c.rejection_reason;
            } else {
                rejectionAlert.classList.add('d-none');
            }
        }

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
        
        document.getElementById('dRemarks').value = c.remarks || '';
        document.getElementById('dTargetLeads').value = c.target_leads || 0;
        document.getElementById('dTargetOps').value = c.target_opportunities || 0;
        document.getElementById('dTargetWon').value = c.target_won || 0;

        document.getElementById('dLeads').value = c.leads ?? 0;
        document.getElementById('dOps').value = c.opportunities ?? 0;
        document.getElementById('dWon').value = c.won ?? 0;

        calculateCalculatedMetrics();
    }
    
    toggleInputLocking();
    drawer.show();
  }

  function calculateCalculatedMetrics() {
    const budget = parseFloat(document.getElementById('dBudget').value) || 0;
    
    // Planned KPI
    const tLeads = parseFloat(document.getElementById('dTargetLeads').value) || 0;
    const tCpl = tLeads > 0 ? (budget / tLeads).toLocaleString('en-US', {maximumFractionDigits: 0}) : '-';
    if(document.getElementById('calcTargetCPL')) document.getElementById('calcTargetCPL').innerText = `CPL: ${tCpl} XAF`;

    // Real KPI
    const rLeads = parseFloat(document.getElementById('dLeads').value) || 0;
    const rCpl = rLeads > 0 ? (budget / rLeads).toLocaleString('en-US', {maximumFractionDigits: 0}) : '-';
    if(document.getElementById('calcRealCPL')) document.getElementById('calcRealCPL').innerText = `CPL: ${rCpl} XAF`;
  }

  // --- SAVE ---
  async function saveCampaign(manageReason = null) {
    const name = document.getElementById('dName').value.trim();
    const start = document.getElementById('dStartDate').value;
    
    if (!name || !start) {
      alert("Please fill required fields (Name, Start Date).");
      return;
    }

    const id = (currentMode === 'create') ? crypto.randomUUID() : editingId;

    const payload = {
      id,
      name,
      remarks: document.getElementById('dRemarks').value,
      rejection_reason: manageReason,
      platform: document.getElementById('dPlatform').value,
      start_date: start,
      end_date: document.getElementById('dEndDate').value || null,
      budget_amount: parseFloat(document.getElementById('dBudget').value) || 0,
      target_service: document.getElementById('dTarget').value,
      
      // Targets
      target_leads: parseInt(document.getElementById('dTargetLeads').value, 10) || 0,
      target_opportunities: parseInt(document.getElementById('dTargetOps').value, 10) || 0,
      target_won: parseInt(document.getElementById('dTargetWon').value, 10) || 0,
      
      // Actuals
      leads: parseInt(document.getElementById('dLeads').value, 10) || 0,
      opportunities: parseInt(document.getElementById('dOps').value, 10) || 0,
      won: parseInt(document.getElementById('dWon').value, 10) || 0,
      
      status: document.getElementById('dStatus').value,
      owner_name: document.getElementById('dOwner').value
    };

    try {
      const res = await fetch(CAMPAIGN_SAVE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
  
  function exportCampaigns() {
    const q = document.getElementById('qSearch')?.value || '';
    const platform = document.getElementById('qPlatform')?.value || '';
    const status = document.getElementById('qStatus')?.value || '';
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (platform) qs.set('platform', platform);
    if (status) qs.set('status', status);
    window.location.href = `../../api/marketing_campaign/export.php?${qs.toString()}`;
  }

  // Init
  document.addEventListener('DOMContentLoaded', () => {
    loadCampaigns();
  });

</script>

</body>
</html>
