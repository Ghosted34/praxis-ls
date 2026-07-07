
<?php


require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN','MANAGEMENT','OPERATIONS','FINANCE']);


/**
 * Use the same "authoritative profile" pattern from management index.php
 */
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

function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }

$fullName  = trim((string)($me['full_name'] ?? 'User'));
$firstName = trim(explode(' ', $fullName)[0] ?? 'User');

$role = strtoupper((string)($me['role'] ?? ''));
$roleLabelMap = [
  'ADMIN'      => 'SYSTEM ADMIN',
  'FINANCE'    => 'FINANCE',
  'SALES'      => 'SALES',
  'OPERATIONS' => 'OPERATIONS',
  'MANAGEMENT' => 'MANAGEMENT',
  'LEAD'       => 'LEAD',
];
$roleLabel = $roleLabelMap[$role] ?? ($role !== '' ? $role : 'USER');

$jobTitle = trim((string)($me['job_title'] ?? ''));
$topRoleLabel = ($jobTitle !== '') ? strtoupper($jobTitle) : $roleLabel;

$avatarName = urlencode($fullName);
$avatarUrl  = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";

$hour = (int)date('H');
$greeting = ($hour < 12) ? 'Good morning' : (($hour < 18) ? 'Good afternoon' : 'Good evening');
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Costing Module | Smart LS</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">

  <style>
    :root{
      --smart-blue:#1F99D8;
      --smart-dark:#055B83;
      --smart-orange:#EE7D04;
      --smart-charcoal:#231F20;
      --smart-bg:#F0F4F8;
      --sidebar-width:280px;
    }
    body{ font-family:'Manrope',sans-serif; background:var(--smart-bg); color:var(--smart-charcoal); overflow-x:hidden; }
    h1,h2,h3,h4,h5,h6{ font-family:'Montserrat',sans-serif; }

    /* Sidebar (from management index style) */
    .sidebar{
      width:var(--sidebar-width);
      height:100vh;
      position:fixed; top:0; left:0;
      background:#fff;
      border-right:1px solid #e0e0e0;
      z-index:1000;
      display:flex;
      flex-direction:column;
      box-shadow:2px 0 10px rgba(0,0,0,0.02);
    }
    .sidebar-header{
      height:70px;
      display:flex;
      align-items:center;
      padding:0 20px;
      border-bottom:1px solid #f0f0f0;
    }
    .brand-logo{
      font-weight:800; font-size:1.1rem; color:var(--smart-charcoal);
      text-decoration:none; letter-spacing:-0.5px;
    }
    .sidebar-menu{ overflow-y:auto; flex-grow:1; padding:10px 0; }

    .menu-btn{
      width:100%;
      text-align:left;
      background:none;
      border:none;
      padding:12px 20px;
      font-size:0.8rem;
      font-weight:700;
      color:#555;
      display:flex;
      justify-content:space-between;
      align-items:center;
      transition:all 0.2s;
      border-left:3px solid transparent;
    }
    .menu-btn:hover, .menu-btn[aria-expanded="true"]{
      color:var(--smart-charcoal);
      background-color:#f0f7fa;
      border-left-color:var(--smart-charcoal);
    }
    .menu-btn i.category-icon{ width:20px; margin-right:8px; color:#888; transition:color 0.2s; }
    .menu-btn:hover i.category-icon{ color:var(--smart-charcoal); }
    .menu-chevron{ font-size:0.7rem; transition:transform 0.3s; }
    .menu-btn[aria-expanded="true"] .menu-chevron{ transform:rotate(180deg); }
    .sub-link{
      display:block;
      padding:8px 20px 8px 48px;
      font-size:0.75rem;
      color:#666;
      text-decoration:none;
      font-weight:500;
      transition:all 0.2s;
      line-height:1.3;
    }
    .sub-link:hover{ color:var(--smart-orange); background-color:#fff9f2; }
    .sub-link.active{ color:var(--smart-orange); font-weight:800; background-color:#fff9f2; }

    .sidebar-footer{ border-top:1px solid #f0f0f0; padding:16px; }

    .main-content{
      margin-left:var(--sidebar-width);
      padding-top:70px;
      min-height:100vh;
      width:calc(100% - var(--sidebar-width));
    }
    .top-navbar{
      height:70px;
      position:fixed;
      top:0;
      right:0;
      left:var(--sidebar-width);
      background:rgba(255,255,255,0.95);
      backdrop-filter:blur(12px);
      border-bottom:1px solid #e0e0e0;
      z-index:900;
      padding:0 30px;
      display:flex;
      align-items:center;
      justify-content:space-between;
    }

    .card-custom{
      background:white;
      border-radius:12px;
      border:1px solid rgba(0,0,0,0.05);
      box-shadow:0 2px 12px rgba(0,0,0,0.02);
      height:100%;
    }

    .kpi-title{
      font-size:0.7rem;
      font-weight:700;
      text-transform:uppercase;
      color:#888;
      letter-spacing:0.5px;
      white-space:nowrap;
    }
    .kpi-value{
      font-size:1.6rem;
      font-weight:800;
      color:var(--smart-charcoal);
      line-height:1.2;
      font-variant-numeric:tabular-nums;
    }

    .table-custom th{
      font-size:0.75rem;
      text-transform:uppercase;
      color:#888;
      font-weight:700;
      border-bottom:2px solid #f0f0f0;
      padding:12px;
      white-space:nowrap;
    }
    .table-custom td{
      font-size:0.85rem;
      vertical-align:middle;
      padding:12px;
    }

    .status-pill{
      font-size:0.65rem;
      font-weight:800;
      text-transform:uppercase;
      letter-spacing:0.5px;
      padding:5px 10px;
      border-radius:6px;
      white-space:nowrap;
    }
    .status-draft{ background:#e2e8f0; color:#475569; }
    .status-submitted-val{ background:#e0f2fe; color:#0369a1; }
    .status-submitted-app{ background:#ffedd5; color:#c2410c; }
    .status-approved{ background:#231F20; color:#fff; border:1px solid #000; }
    .status-rejected{ background:#fee2e2; color:#991b1b; }

    .smart-input{ border-radius:8px; font-size:0.9rem; padding:0.6rem 0.8rem; border-color:#dee2e6; }
    .smart-input:focus{ border-color:var(--smart-blue); box-shadow:0 0 0 3px rgba(31,153,216,0.1); }

    .clock-pill{
      background:#f1f5f9;
      padding:6px 12px;
      border-radius:30px;
      display:flex;
      align-items:center;
      gap:10px;
      font-size:0.85rem;
      font-weight:600;
      color:var(--smart-dark);
    }
  </style>
</head>

<body>

  <nav class="sidebar">
    <div class="sidebar-header">
        <a href="#" class="brand-logo"><i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span></a>
    </div>

    <div class="px-3 mb-2 mt-2">
        <a href="index" class="btn btn-primary w-100 text-start d-flex align-items-center" style="background-color: transparent; color: inherit; border: none; padding-left: 0;">
            <i class="fa-solid fa-house category-icon me-2"></i> 
            <span class="fw-bold">Operations Dashboard</span> 
        </a>
    </div>

    <div class="sidebar-menu accordion" id="opsMenu">
        
        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#ops1">
                <span><i class="fa-solid fa-database category-icon"></i> 1. MASTER DATA MGMT</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="ops1" class="accordion-collapse collapse" data-bs-parent="#opsMenu">
                <div class="sub-menu">
                    <a href="client-master-registry.php" class="sub-link">Client Master Registry</a>
                    <a href="supplier-master-registry.php" class="sub-link">Supplier Master Registry</a>
                    <a href="financial-dictionary.php" class="sub-link">Financial Dictionary</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#ops2">
                <span><i class="fa-solid fa-laptop-code category-icon"></i> 2. SIMULATIONS</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="ops2" class="accordion-collapse collapse" data-bs-parent="#opsMenu">
                <div class="sub-menu">
                    <a href="extra-charges-simulator.php" class="sub-link">Extra Charges Simulator</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#ops3">
                <span><i class="fa-solid fa-gears category-icon"></i> 3. OPS EXECUTION</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="ops3" class="accordion-collapse collapse" data-bs-parent="#opsMenu">
                <div class="sub-menu">
                    <a href="operations-registry.php" class="sub-link">Operations File Registry</a>
                    <a href="transit-order.php" class="sub-link">Transit Order (OT)</a>
                    <a href="operational-milestone-tracking.php" class="sub-link">Operational Milestone Tracking</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#ops4">
                <span><i class="fa-solid fa-truck-ramp-box category-icon"></i> 4. OPS DELIVERY</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="ops4" class="accordion-collapse collapse" data-bs-parent="#opsMenu">
                <div class="sub-menu">
                    <a href="documents-vault.php" class="sub-link">Delivery Note</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#ops5">
                <span><i class="fa-solid fa-money-bill-trend-up category-icon"></i> 5. OPS COST CONTROL</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="ops5" class="accordion-collapse collapse" data-bs-parent="#opsMenu">
                <div class="sub-menu">
                    <a href="costing-module.php" class="sub-link">Costing Module</a>
                    <a href="cost-tracking.php" class="sub-link">Cost Tracking Master</a>
                    <a href="#" class="sub-link">Operational Cost Reconciliation</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#ops6">
                <span><i class="fa-solid fa-building-columns category-icon"></i> 6. FINANCE & TREASURY</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="ops6" class="accordion-collapse collapse" data-bs-parent="#opsMenu">
                <div class="sub-menu">
                    <a href="#" class="sub-link">Cash Request</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#ops7">
                <span><i class="fa-solid fa-box-archive category-icon"></i> 7. COMPANY ARCHIVE</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="ops7" class="accordion-collapse collapse" data-bs-parent="#opsMenu">
                <div class="sub-menu">
                    <a href="#" class="sub-link">Documents Vault</a>
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

  <div class="main-content px-4 pb-5">

    <div class="row py-4 align-items-center">
      <div class="col-md-6">
        <h2 class="fw-bold mb-0">Costing Registry</h2>
        <p class="text-muted mb-0 small">Create, validate and approve internal cost estimates.</p>
      </div>
      <div class="col-md-6 text-end">
        <button class="btn btn-dark fw-bold px-4 py-2 shadow-sm" onclick="openCostingOffcanvas('new')">
          <i class="fa-solid fa-plus me-2"></i>New Costing
        </button>
      </div>
    </div>

    <div class="row g-3 mb-4">
      <div class="col-md-3">
        <div class="card-custom p-3">
          <div class="kpi-title">Costings (MTD)</div>
          <div class="kpi-value" id="kpi-mtd">-</div>
          <small class="text-muted" style="font-size:0.75rem;">From DB</small>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card-custom p-3">
          <div class="kpi-title">Pending Validation</div>
          <div class="kpi-value text-primary" id="kpi-val">-</div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card-custom p-3">
          <div class="kpi-title">Pending Approval</div>
          <div class="kpi-value text-warning" id="kpi-app">-</div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card-custom p-3">
          <div class="kpi-title">Total TTC (MTD)</div>
          <div class="kpi-value" id="kpi-ttc">-</div>
        </div>
      </div>
    </div>

    <div class="card-custom p-0 overflow-hidden">
      <div class="p-3 border-bottom bg-light d-flex justify-content-between align-items-center flex-wrap gap-2">
        <div class="btn-group" role="group">
          <button type="button" class="btn btn-sm btn-outline-secondary fw-bold active" data-status="ALL">All</button>
          <button type="button" class="btn btn-sm btn-outline-secondary fw-bold" data-status="DRAFT">Draft</button>
          <button type="button" class="btn btn-sm btn-outline-primary fw-bold" data-status="SUBMITTED_FOR_VALIDATION">To Validate</button>
          <button type="button" class="btn btn-sm btn-outline-warning text-dark fw-bold" data-status="SUBMITTED_FOR_APPROVAL">To Approve</button>
          <button type="button" class="btn btn-sm btn-outline-dark fw-bold" data-status="APPROVED_LOCKED">Locked</button>
          <button type="button" class="btn btn-sm btn-outline-danger fw-bold" data-status="REJECTED">Rejected</button>
        </div>

        <div class="input-group input-group-sm" style="width: 280px;">
          <span class="input-group-text bg-white border-end-0"><i class="fa-solid fa-search text-muted"></i></span>
          <input type="text" class="form-control border-start-0 ps-0 smart-input" placeholder="Search Costing #, Client..." id="searchInput">
        </div>
      </div>

      <div class="table-responsive">
        <table class="table table-hover table-custom mb-0 align-middle">
          <thead class="bg-light">
            <tr>
              <th class="ps-4">Costing #</th>
              <th>Date</th>
              <th>File Ref</th>
              <th>Client</th>
              <th class="text-end">Total TTC</th>
              <th>Status</th>
              <th class="text-end pe-4">Action</th>
            </tr>
          </thead>
          <tbody id="table-body"></tbody>
        </table>
      </div>

      <div class="p-2 border-top bg-light d-flex justify-content-end">
        <nav>
          <ul class="pagination pagination-sm mb-0" id="pager"></ul>
        </nav>
      </div>
    </div>

  </div>

  <div class="offcanvas offcanvas-end" tabindex="-1" id="costingOffcanvas" style="width: 95vw; max-width: 1400px;">
    <div class="offcanvas-header border-bottom bg-light py-2">
      <div class="d-flex align-items-center gap-3">
        <div>
          <h5 class="offcanvas-title fw-bold" id="offcanvasTitle">New Costing Worksheet</h5>
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

          <div class="input-group input-group-sm ms-2" style="width: 190px;">
            <span class="input-group-text fw-bold">Curr</span>
            <select class="form-select fw-bold text-primary" id="currency-selector">
              <option value="XAF" selected>XAF</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </div>

          <div class="input-group input-group-sm ms-2" style="width: 220px;">
            <span class="input-group-text fw-bold">Rate</span>
            <input class="form-control fw-bold" id="exchange-rate" value="1.000000" inputmode="decimal">
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
              <select id="link-file-ref" class="form-select smart-input fw-bold"></select>

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
                    <div class="col-md-3"><span class="text-muted d-block" style="font-size:0.7rem">ETA / Arrival</span><strong class="text-dark" id="ssdc-eta">-</strong></div>
                    <div class="col-md-3"><span class="text-muted d-block" style="font-size:0.7rem">Conveyance</span><strong class="text-dark" id="ssdc-conveyance">-</strong></div>
                    <div class="col-md-3"><span class="text-muted d-block" style="font-size:0.7rem">Cargo Weight</span><strong class="text-dark" id="ssdc-weight">-</strong></div>
                    <div class="col-md-3"><span class="text-muted d-block" style="font-size:0.7rem">Packages</span><strong class="text-dark" id="ssdc-packages">-</strong></div>
                  </div>

                  <div class="row g-2 small">
                    <div class="col-md-3"><span class="text-muted d-block" style="font-size:0.7rem">Place of Delivery</span><strong class="text-dark" id="ssdc-delivery">-</strong></div>
                    <div class="col-md-3"><span class="text-muted d-block" style="font-size:0.7rem">Commodity</span><strong class="text-dark" id="ssdc-commodity">-</strong></div>
                    <div class="col-md-3"><span class="text-muted d-block" style="font-size:0.7rem">Route (POL→POD)</span><strong class="text-dark" id="ssdc-route">-</strong></div>
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
                  <th>Description</th>
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
                  <td class="text-end pt-3 font-monospace" id="grand-ht">0.00</td>
                  <td></td>
                </tr>
                <tr>
                  <td colspan="7" class="text-end text-muted text-uppercase small">VAT (19.25%)</td>
                  <td class="text-end font-monospace" id="grand-vat">0.00</td>
                  <td></td>
                </tr>
                <tr style="font-size: 1.1rem;">
                  <td colspan="7" class="text-end text-dark text-uppercase pt-2">Total Estimated Cost</td>
                  <td class="text-end pt-2 text-primary fw-black font-monospace" id="grand-ttc">0.00</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div class="mt-4">
            <label class="form-label fw-bold small text-uppercase text-muted">Remarks / Notes for Print</label>
            <textarea id="costing-remarks" class="form-control smart-input" rows="3" placeholder="Enter remarks..."></textarea>
          </div>
        </div>

        <div class="p-3 border-top bg-white d-flex justify-content-between align-items-center shadow-lg" style="z-index: 10;">
          <div class="mt-2">
            <label class="small fw-bold text-muted text-uppercase mb-1">Validator</label>
            <select id="validator-employee-id" class="form-select smart-input fw-bold" required></select>
            <small class="text-muted" style="font-size:0.7rem;">Select an employee with VALIDATOR authority.</small>
          </div>

          <small class="text-muted fst-italic" id="save-status">Not saved yet</small>

          <div class="d-flex gap-2" id="action-buttons">
            <button type="button" class="btn btn-light fw-bold text-muted" data-bs-dismiss="offcanvas">Close</button>
            <button type="button" class="btn btn-dark fw-bold" onclick="saveDraft()"><i class="fa-regular fa-floppy-disk me-2"></i>Save Draft</button>
            <button type="button" class="btn btn-success fw-bold text-white" onclick="submitForValidation()"><i class="fa-solid fa-paper-plane me-2"></i>Submit</button>
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
          <div id="print-container" class="p-3"></div>
        </div>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

  <script>
    // Clock
    function tickClock(){
      const el = document.getElementById('realtime-clock');
      if (!el) return;
      const now = new Date();
      const hh = String(now.getHours()).padStart(2,'0');
      const mm = String(now.getMinutes()).padStart(2,'0');
      const ss = String(now.getSeconds()).padStart(2,'0');
      el.textContent = `${hh}:${mm}:${ss}`;
    }
    setInterval(tickClock, 1000); tickClock();

    // ---- State ----
    const state = {
      page: 1,
      pageSize: 10,
      status: 'ALL',
      q: '',
      currentCostingId: null,
      currentCostingRef: null,
      currentStatus: 'DRAFT',
      vatRate: 0.1925
    };
    window.AUTH_ROLE = <?php echo json_encode($role); ?>;

    const statusConfig = {
      'DRAFT': { cls: 'status-draft', label: 'Draft' },
      'SUBMITTED_FOR_VALIDATION': { cls: 'status-submitted-val', label: 'To Validate' },
      'SUBMITTED_FOR_APPROVAL': { cls: 'status-submitted-app', label: 'To Approve' },
      'APPROVED_LOCKED': { cls: 'status-approved', label: 'Locked' },
      'REJECTED': { cls: 'status-rejected', label: 'Rejected' }
    };

    const bsOffcanvas = new bootstrap.Offcanvas(document.getElementById('costingOffcanvas'));

    function valOrDash(v){
      const s = (v ?? '').toString().trim();
      return s === '' ? '-' : s;
    }

    function serviceLabel(raw){
      const s = (raw ?? '').toString().trim();
      return s ? s.replaceAll('_',' ') : '-';
    }

    function detectServiceGroup(serviceTypeRaw=''){
      const s = String(serviceTypeRaw).toUpperCase();
      if (s.includes('SEA')) return 'SEA';
      if (s.includes('AIR')) return 'AIR';
      if (s.includes('INLAND') || s.includes('HINTERLAND') || s.includes('TRANSPORT') || s.includes('TRANSIT')) return 'TRANSPORT';
      if (s.includes('WAREHOUS')) return 'WAREHOUSE';
      if (s.includes('BUSINESS_REP') || s.includes('REPRESENTATION')) return 'BUSINESS_REP';
      return 'ALL';
    }

    function smartRoute(d, group){
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

    function smartTransportRef(d, group){
      if (group === 'SEA') return valOrDash(d.sea_bl);
      if (group === 'AIR') return valOrDash(d.air_mawb);
      if (group === 'TRANSPORT') return valOrDash(d.inland_truck);
      return '-';
    }

    function smartConveyance(d, group){
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

    function smartEtaArrival(d){
      // prefer ATA if present, fallback ETA
      return valOrDash(d.ata) !== '-' ? valOrDash(d.ata) : valOrDash(d.eta);
    }

    function setCompactSSDC(d){
      const group = detectServiceGroup(d.service_type);

      document.getElementById('ssdc-client').innerText = valOrDash(d.client_name);
      document.getElementById('ssdc-service').innerText = serviceLabel(d.service_type);

      // warehouse/business_rep keep minimal
      if (group === 'WAREHOUSE' || group === 'BUSINESS_REP') return;

      document.getElementById('ssdc-transport').innerText = smartTransportRef(d, group);
      document.getElementById('ssdc-route').innerText = smartRoute(d, group);
      document.getElementById('ssdc-eta').innerText = smartEtaArrival(d);
      document.getElementById('ssdc-conveyance').innerText = smartConveyance(d, group);

      const w = `${valOrDash(d.gross_weight)} ${valOrDash(d.weight_unit)}`.trim();
      document.getElementById('ssdc-weight').innerText = (w === '-' ? '-' : w);

      document.getElementById('ssdc-packages').innerText = valOrDash(d.package_count);
      document.getElementById('ssdc-delivery').innerText = valOrDash(d.place_delivery);
      document.getElementById('ssdc-commodity').innerText = valOrDash(d.commodity);
      document.getElementById('ssdc-marks').innerText = valOrDash(d.marks_numbers);
    }

    function clearSSDC(){
      ['ssdc-client','ssdc-service','ssdc-transport','ssdc-route','ssdc-eta','ssdc-conveyance','ssdc-weight','ssdc-packages','ssdc-delivery','ssdc-commodity','ssdc-marks']
        .forEach(id => { const el = document.getElementById(id); if (el) el.innerText='-'; });
    }

    async function apiGet(url){
      const res = await fetch(url, { credentials: 'same-origin' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.ok) throw new Error((data && (data.error || data.message)) || 'Request failed');
      return data;
    }

    async function apiPost(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    credentials: 'same-origin'
  });

  // Always read raw response first
  const raw = await res.text();
  let data = null;

  try {
    data = JSON.parse(raw);
  } catch (e) {
    // Not JSON (likely PHP error or redirect)
  }

  if (!res.ok || !data || data.ok !== true) {
    console.error('API POST FAILED', {
      url,
      status: res.status,
      statusText: res.statusText,
      rawResponse: raw,
      parsed: data
    });

    const msg =
      (data && (data.error || data.message)) ||
      `HTTP ${res.status} ${res.statusText}`;

    throw new Error(msg);
  }

  return data;
}


    // ---- Registry ----
    async function loadRegistry(){
      const url = `../../api/costing/list.php?page=${state.page}&pageSize=${state.pageSize}&status=${encodeURIComponent(state.status)}&q=${encodeURIComponent(state.q)}`;
      const data = await apiGet(url);

      const tbody = document.getElementById('table-body');
      tbody.innerHTML = (data.items || []).map(r => {
        const meta = statusConfig[r.status] || { cls:'status-draft', label:r.status };
        const ttc = Number(r.total_ttc || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return `
          <tr onclick="openCostingOffcanvasById('${r.costing_id}')">
            <td class="ps-4"><span class="font-monospace fw-bold text-dark small bg-light border px-2 py-1 rounded">${r.costing_ref}</span></td>
            <td class="small text-muted">${r.costing_date}</td>
            <td class="font-monospace small text-primary">${r.operations_file_reference}</td>
            <td class="fw-bold text-dark" style="font-size:0.85rem">${r.client_name_cached}</td>
            <td class="text-end fw-bold font-monospace">${ttc} ${r.currency}</td>
            <td><span class="status-pill ${meta.cls}">${meta.label}</span></td>
            <td class="text-end pe-4">
              <button class="btn btn-sm btn-outline-dark fw-bold" onclick="event.stopPropagation(); openCostingOffcanvasById('${r.costing_id}')">
                <i class="fa-solid fa-eye me-1"></i> View
              </button>
            </td>
          </tr>
        `;
      }).join('');

      renderPager(data.page, data.totalPages);

      // KPI quick calc from loaded page (lightweight). If you want exact KPIs, create a dedicated KPI API.
      const items = data.items || [];
      document.getElementById('kpi-mtd').innerText = items.length.toString();
      document.getElementById('kpi-val').innerText = items.filter(x => x.status === 'SUBMITTED_FOR_VALIDATION').length.toString();
      document.getElementById('kpi-app').innerText = items.filter(x => x.status === 'SUBMITTED_FOR_APPROVAL').length.toString();
      const sumTTC = items.reduce((a,x) => a + Number(x.total_ttc || 0), 0);
      document.getElementById('kpi-ttc').innerText = sumTTC.toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 });
    }

    function renderPager(page, totalPages){
      const ul = document.getElementById('pager');
      if (!ul) return;

      const safeTotal = Math.max(1, totalPages || 1);

      const prevDisabled = page <= 1 ? 'disabled' : '';
      const nextDisabled = page >= safeTotal ? 'disabled' : '';

      ul.innerHTML = `
        <li class="page-item ${prevDisabled}">
          <a class="page-link" href="#" onclick="event.preventDefault(); if(${page}>1){ state.page=${page}-1; loadRegistry(); }">Prev</a>
        </li>
        ${Array.from({length: safeTotal}).slice(0, 7).map((_,i)=>{
          const p = i+1;
          const active = p===page ? 'active' : '';
          return `<li class="page-item ${active}">
            <a class="page-link ${active ? 'bg-dark border-dark' : 'text-dark'}" href="#" onclick="event.preventDefault(); state.page=${p}; loadRegistry();">${p}</a>
          </li>`;
        }).join('')}
        <li class="page-item ${nextDisabled}">
          <a class="page-link" href="#" onclick="event.preventDefault(); if(${page}<${safeTotal}){ state.page=${page}+1; loadRegistry(); }">Next</a>
        </li>
      `;
    }

    // ---- Ops dropdown + SSDC ----
    async function loadOpsDropdown(){
      const sel = document.getElementById('link-file-ref');
      sel.innerHTML = `<option value="">Select File Ref...</option>`;
      const data = await apiGet(`../../api/costing/ops-files.php?limit=25`);
      (data.items || []).forEach(it => {
        const opt = document.createElement('option');
        opt.value = it.operations_file_reference;
        opt.textContent = `${it.operations_file_reference} (${it.client_name})`;
        sel.appendChild(opt);
      });

      sel.addEventListener('change', async () => {
        const ref = sel.value;
        clearSSDC();
        if (!ref) return;
        const d = await apiGet(`../../api/costing/ops-file-details.php?ref=${encodeURIComponent(ref)}`);
        setCompactSSDC(d.item);
      });
    }

    // ---- Lines ----
    function addLine(line=null){
      const tbody = document.getElementById('lines-body');
      const rowId = 'row-' + Math.floor(Math.random()*1000000);

      const code = line ? (line.item_code || '') : '';
      const desc = line ? (line.item_description || '') : '';
      const qty  = line ? (line.qty || 1) : 1;
      const unit = line ? (line.unit_cost || 0) : 0;
      const vat  = line ? (Number(line.vat_applicable) ? 1 : 0) : 1;

      const tr = document.createElement('tr');
      tr.id = rowId;
      tr.innerHTML = `
        <td class="text-center">
          <button type="button" class="btn btn-sm text-danger" onclick="removeLine('${rowId}')"><i class="fa-solid fa-times"></i></button>
        </td>
        <td><input class="form-control form-control-sm smart-input font-monospace code" value="${code}"></td>
        <td><input class="form-control form-control-sm smart-input desc" value="${desc}"></td>
        <td><input type="number" class="form-control form-control-sm smart-input text-center qty" value="${qty}" min="0" step="0.001"></td>
        <td><input type="number" class="form-control form-control-sm smart-input text-end unit" value="${unit}" min="0" step="0.0001"></td>
        <td class="text-end font-monospace ht" data-raw="0">0.00</td>
        <td class="text-center"><input type="checkbox" class="vat" ${vat ? 'checked' : ''}></td>
        <td class="text-end fw-bold font-monospace ttc" data-raw="0">0.00</td>
        <td></td>
      `;
      tbody.appendChild(tr);

      ['input','change'].forEach(ev=>{
        tr.querySelector('.qty').addEventListener(ev, () => calcRow(tr));
        tr.querySelector('.unit').addEventListener(ev, () => calcRow(tr));
        tr.querySelector('.vat').addEventListener(ev, () => calcRow(tr));
      });

      calcRow(tr);
    }

    function removeLine(rowId){
      const tr = document.getElementById(rowId);
      if (tr) tr.remove();
      calcTotals();
    }

    function calcRow(tr){
      const qty = Number(tr.querySelector('.qty').value || 0);
      const unit = Number(tr.querySelector('.unit').value || 0);
      const vatOn = tr.querySelector('.vat').checked;
      const ht = qty * unit;
      const vat = vatOn ? ht * state.vatRate : 0;
      const ttc = ht + vat;

      tr.querySelector('.ht').dataset.raw = ht.toString();
      tr.querySelector('.ttc').dataset.raw = ttc.toString();

      tr.querySelector('.ht').innerText = ht.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
      tr.querySelector('.ttc').innerText = ttc.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});

      calcTotals();
    }
    async function loadValidatorsDropdown(selectedId = ''){
  const sel = document.getElementById('validator-employee-id');
  sel.innerHTML = `<option value="">Select Validator...</option>`;
  const data = await apiGet(`../../api/costing/validators.php?limit=50`);
  (data.items || []).forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.employee_id;
    opt.textContent = `${v.full_name} (${v.department}${v.job_title ? ' - ' + v.job_title : ''})`;
    if (selectedId && selectedId === v.employee_id) opt.selected = true;
    sel.appendChild(opt);
  });
}


    function calcTotals(){
      let ht = 0, vat = 0, ttc = 0;
      document.querySelectorAll('#lines-body tr').forEach(tr => {
        const qty = Number(tr.querySelector('.qty').value || 0);
        const unit = Number(tr.querySelector('.unit').value || 0);
        const vatOn = tr.querySelector('.vat').checked;
        const rowHT = qty * unit;
        const rowVAT = vatOn ? rowHT * state.vatRate : 0;
        const rowTTC = rowHT + rowVAT;
        ht += rowHT; vat += rowVAT; ttc += rowTTC;
      });

      document.getElementById('grand-ht').innerText = ht.toLocaleString('en-US',{minimumFractionDigits:2, maximumFractionDigits:2});
      document.getElementById('grand-vat').innerText = vat.toLocaleString('en-US',{minimumFractionDigits:2, maximumFractionDigits:2});
      const curr = document.getElementById('currency-selector').value;
      document.getElementById('grand-ttc').innerText = ttc.toLocaleString('en-US',{minimumFractionDigits:2, maximumFractionDigits:2}) + ` ${curr}`;

      window.__totals = { ht, vat, ttc };
    }

    function gatherLines(){
      const out = [];
      document.querySelectorAll('#lines-body tr').forEach((tr, idx) => {
        out.push({
          line_no: idx + 1,
          item_code: tr.querySelector('.code').value,
          item_description: tr.querySelector('.desc').value,
          qty: Number(tr.querySelector('.qty').value || 0),
          unit_cost: Number(tr.querySelector('.unit').value || 0),
          vat_applicable: tr.querySelector('.vat').checked ? 1 : 0,
          vat_rate: state.vatRate
        });
      });
      return out;
    }

    // ---- Offcanvas open/load ----
    function resetFormForNew(){
      state.currentCostingId = null;
      state.currentCostingRef = null;
      state.currentStatus = 'DRAFT';
      
      document.getElementById('validator-employee-id').value = '';

      document.getElementById('offcanvasTitle').innerText = 'New Costing Worksheet';
      document.getElementById('costing-ref-display').innerText = 'SLAS-COST-####';
      document.getElementById('costing-status-badge').className = 'badge bg-secondary';
      document.getElementById('costing-status-badge').innerText = 'DRAFT';
      document.getElementById('costing-remarks').value = '';
      document.getElementById('lines-body').innerHTML = '';
      clearSSDC();
      document.getElementById('link-file-ref').value = '';
      document.getElementById('currency-selector').value = 'XAF';
      document.getElementById('exchange-rate').value = '1.000000';

      const now = new Date();
      const localDate = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
      document.getElementById('costing-date').value = localDate;

      calcTotals();
      document.getElementById('save-status').innerText = 'Not saved yet';

      // start with one line
      addLine();
      renderDrawerActions();
    }

    async function openCostingOffcanvas(mode){
      if (mode === 'new'){
        resetFormForNew();
        bsOffcanvas.show();
        return;
      }
    }

    async function openCostingOffcanvasById(id){
      const data = await apiGet(`../../api/costing/get.php?id=${encodeURIComponent(id)}`);
      const item = data.item;
      const lines = data.lines || [];

      state.currentCostingId = item.costing_id;
      state.currentCostingRef = item.costing_ref;
      state.currentStatus = item.status;
      renderDrawerActions();


      document.getElementById('offcanvasTitle').innerText = 'Manage Costing';
      document.getElementById('costing-ref-display').innerText = item.costing_ref;

      // badge
      const meta = statusConfig[item.status] || { cls:'status-draft', label:item.status };
      document.getElementById('costing-status-badge').className = `badge ${meta.cls}`;
      document.getElementById('costing-status-badge').innerText = item.status;

      // header fields
      document.getElementById('costing-date').value = item.costing_date;
      document.getElementById('currency-selector').value = item.currency;
      document.getElementById('exchange-rate').value = item.exchange_rate_to_xaf;
      document.getElementById('costing-remarks').value = item.remarks || '';

      // ops file dropdown
      document.getElementById('link-file-ref').value = item.operations_file_reference;

      // load ssdc
      clearSSDC();
      const ss = await apiGet(`../../api/costing/ops-file-details.php?ref=${encodeURIComponent(item.operations_file_reference)}`);
      setCompactSSDC(ss.item);

      // lines
      document.getElementById('lines-body').innerHTML = '';
      if (lines.length === 0) addLine();
      else lines.forEach(l => addLine(l));

      calcTotals();
      document.getElementById('save-status').innerText = `Loaded from DB: ${item.updated_at || item.created_at || ''}`;

      bsOffcanvas.show();
      await loadValidatorsDropdown(item.validator_employee_id || '');
      document.getElementById('validator-employee-id').value = item.validator_employee_id || '';

    }
function can(role, action) {
  role = String(role || '').toUpperCase();

  // Adjust these to your real policy
  const policy = {
    SUBMIT:   ['ADMIN','SALES','OPERATIONS','MANAGEMENT'],
    VALIDATE:  ['ADMIN','MANAGEMENT','LEAD'],          // or VALIDATOR role if you have it
    APPROVE:   ['ADMIN','FINANCE','MANAGEMENT'],
    REJECT:    ['ADMIN','FINANCE','MANAGEMENT','LEAD']
  };

  return (policy[action] || []).includes(role);
}

function isEditableStatus(status) {
  return ['DRAFT','REJECTED'].includes(String(status || '').toUpperCase());
}

function renderDrawerActions() {
  const role = String(window.AUTH_ROLE || '').toUpperCase();
  const status = String(state.currentStatus || 'DRAFT').toUpperCase();
  const box = document.getElementById('action-buttons');
  if (!box) return;

  // Always keep Close
  const btnClose = `
    <button type="button" class="btn btn-light fw-bold text-muted" data-bs-dismiss="offcanvas">
      Close
    </button>
  `;

  // Save button:
  // Your requirement: if status == DRAFT, "Save Draft" should not be visible.
  // Practical UI: replace it with "Save" (same functionality, better label).
  let btnSave = '';
  if (isEditableStatus(status)) {
    const label = (status === 'DRAFT') ? 'Save' : 'Save Changes';
    btnSave = `
      <button type="button" class="btn btn-dark fw-bold" onclick="saveDraft()">
        <i class="fa-regular fa-floppy-disk me-2"></i>${label}
      </button>
    `;
  }

  // Submit button: only from DRAFT/REJECTED
  let btnSubmit = '';
  if (['DRAFT','REJECTED'].includes(status) && can(role, 'SUBMIT')) {
    btnSubmit = `
      <button type="button" class="btn btn-success fw-bold text-white" onclick="submitForValidation()">
        <i class="fa-solid fa-paper-plane me-2"></i>Submit
      </button>
    `;
  }

  // Validate button: only from SUBMITTED_FOR_VALIDATION
  let btnValidate = '';
  if (status === 'SUBMITTED_FOR_VALIDATION' && can(role, 'VALIDATE')) {
    btnValidate = `
      <button type="button" class="btn btn-primary fw-bold text-white" onclick="validateCosting()">
        <i class="fa-solid fa-check me-2"></i>Validate
      </button>
    `;
  }

  // Approve button: only from SUBMITTED_FOR_APPROVAL
  let btnApprove = '';
  if (status === 'SUBMITTED_FOR_APPROVAL' && can(role, 'APPROVE')) {
    btnApprove = `
      <button type="button" class="btn btn-dark fw-bold" onclick="approveCosting()">
        <i class="fa-solid fa-stamp me-2"></i>Approve
      </button>
    `;
  }

  // Reject button: from submitted states
  let btnReject = '';
  if (['SUBMITTED_FOR_VALIDATION','SUBMITTED_FOR_APPROVAL'].includes(status) && can(role, 'REJECT')) {
    btnReject = `
      <button type="button" class="btn btn-outline-danger fw-bold" onclick="rejectCosting()">
        <i class="fa-solid fa-ban me-2"></i>Reject
      </button>
    `;
  }

  // Locked/Approved: no workflow buttons. Keep Close and Print if you want.
  // Example: allow print in all statuses
  // (You already have Print/Preview in header, so optional)

  box.innerHTML = [
    btnClose,
    btnReject,
    btnSave,
    btnSubmit,
    btnValidate,
    btnApprove
  ].filter(Boolean).join('');
}

    // ---- Save + Workflow ----
  async function saveDraft() {
  const opsRef = document.getElementById('link-file-ref').value;
  if (!opsRef) { alert('Select an Operations File first.'); return; }

  const validatorId = (document.getElementById('validator-employee-id').value || '').trim();

  const payload = {
    costing_id: state.currentCostingId || null,
    operations_file_reference: opsRef,
    costing_date: document.getElementById('costing-date').value,
    remarks: document.getElementById('costing-remarks').value,
    currency: document.getElementById('currency-selector').value,
    exchange_rate_to_xaf: Number(document.getElementById('exchange-rate').value || 1),
    validator_employee_id: validatorId || null,   // ✅ ADD THIS
    lines: gatherLines()
  };

  const res = await apiPost(`../../api/costing/save.php`, payload);

  if (!res || !res.costing_id) throw new Error('Save succeeded but costing_id was not returned');

  state.currentCostingId = res.costing_id;
  document.getElementById('save-status').innerText = 'Saved: Just now';

  if (!payload.costing_id) {
    await openCostingOffcanvasById(res.costing_id);
  } else {
    await loadRegistry();
  }
}



  async function submitForValidation() {
  const v = (document.getElementById('validator-employee-id').value || '').trim();
  if (!v) { alert('Select a validator before submitting.'); return; }

  // Ensure validator gets saved
  await saveDraft();

  await apiPost(`../../api/costing/transition.php`, {
    costing_id: state.currentCostingId,
    action: 'SUBMIT'
  });

  await openCostingOffcanvasById(state.currentCostingId);
  await loadRegistry();
}



    async function validateCosting(){
      if (!state.currentCostingId) return;
      await apiPost(`../../api/costing/transition.php`, { costing_id: state.currentCostingId, action: 'VALIDATE' });
      await openCostingOffcanvasById(state.currentCostingId);
      await loadRegistry();
    }

    async function approveCosting(){
      if (!state.currentCostingId) return;
      await apiPost(`../../api/costing/transition.php`, { costing_id: state.currentCostingId, action: 'APPROVE' });
      await openCostingOffcanvasById(state.currentCostingId);
      await loadRegistry();
    }

    async function rejectCosting(){
      if (!state.currentCostingId) return;
      const reason = prompt('Enter rejection reason (optional):') || '';
      await apiPost(`../../api/costing/transition.php`, { costing_id: state.currentCostingId, action: 'REJECT', reason });
      await openCostingOffcanvasById(state.currentCostingId);
      await loadRegistry();
    }

    // Minimal print preview placeholder (keep your existing full generator if you want)
    function generatePreview(){
      const wrap = document.getElementById('print-container');
      wrap.innerHTML = `
        <div class="bg-white p-4">
          <div class="fw-bold mb-2">Costing Preview (DB-backed)</div>
          <div>Ref: ${document.getElementById('costing-ref-display').innerText}</div>
          <div>Client: ${document.getElementById('ssdc-client').innerText}</div>
          <div>Total: ${document.getElementById('grand-ttc').innerText}</div>
        </div>
      `;
      const modalEl = document.getElementById('printModal');
      const modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
      modal.show();
    }

    // Filters
    document.querySelectorAll('[data-status]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('[data-status]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.status = btn.getAttribute('data-status');
        state.page = 1;
        loadRegistry();
      });
    });

    document.getElementById('searchInput').addEventListener('input', () => {
      state.q = document.getElementById('searchInput').value.trim();
      state.page = 1;
      loadRegistry();
    });

    // --- Suggest Lines Logic ---
    function mapServiceToDictionaryKey(serviceTypeRaw) {
        // Maps Ops File ServiceType (e.g. SEA_FREIGHT_IMPORT) to Financial Dictionary Applicability String
        const s = String(serviceTypeRaw || '').toUpperCase();
        if (s.includes('SEA') && s.includes('IMPORT')) return 'Sea Import';
        if (s.includes('SEA') && s.includes('EXPORT')) return 'Sea Export';
        if (s.includes('AIR') && s.includes('IMPORT')) return 'Air Import';
        if (s.includes('AIR') && s.includes('EXPORT')) return 'Air Export';
        if (s.includes('TRANSIT') || s.includes('INLAND')) return 'Transit';
        // Fallback or empty if no specific match
        return '';
    }

    async function suggestLines() {
        // 1. Get Service Type from UI
        const serviceText = document.getElementById('ssdc-service').innerText;
        
        // 2. Identify Applicability Key
        // Note: serviceLabel() function transforms underscores to spaces, so we reverse-check or rely on logic
        // But better is to grab the raw service type if stored, or parse the label. 
        // Our mapServiceToDictionaryKey handles the label broadly.
        const appKey = mapServiceToDictionaryKey(serviceText);

        if (!appKey) {
            alert('Could not determine service category for suggestion (Requires Sea Import, Sea Export, etc.)');
            return;
        }

        try {
            // 3. Fetch Suggestions
            const data = await apiGet(`../../api/costing/get-suggestions.php?applicability=${encodeURIComponent(appKey)}`);
            const suggestions = data.items || [];

            if (suggestions.length === 0) {
                alert('No standard lines found for: ' + appKey);
                return;
            }

            // 4. Identify Existing Codes to avoid duplicates (Option 6B)
            const existingCodes = [];
            document.querySelectorAll('#lines-body tr .code').forEach(input => {
                const val = input.value.trim();
                if (val) existingCodes.push(val);
            });

            // 5. Determine Language (Option 3A)
            const isFr = document.getElementById('lang-fr').checked;

            let addedCount = 0;
            suggestions.forEach(item => {
                if (existingCodes.includes(item.code)) {
                    // Skip existing
                    return;
                }

                // Add Line
                addLine({
                    item_code: item.code,
                    item_description: isFr ? (item.name_fr || item.name_en) : (item.name_en || item.name_fr),
                    qty: 1,           // Default 1
                    unit_cost: 0,     // Default 0
                    vat_applicable: 1 // Default Checked
                });
                addedCount++;
            });

            // 6. Feedback (Option 9A)
            if (addedCount > 0) {
                alert(`Successfully suggested ${addedCount} lines for ${appKey}.`);
            } else {
                alert(`All suggested lines for ${appKey} are already present.`);
            }

        } catch (e) {
            console.error(e);
            alert('Failed to fetch suggestions: ' + e.message);
        }
    }

    // Boot
    (async function init(){
      await loadOpsDropdown();
      await loadValidatorsDropdown('');
      await loadRegistry();
    })();

    // expose
    window.openCostingOffcanvas = openCostingOffcanvas;
    window.openCostingOffcanvasById = openCostingOffcanvasById;
    window.addLine = addLine;
    window.saveDraft = saveDraft;
    window.submitForValidation = submitForValidation;
    window.validateCosting = validateCosting;
    window.approveCosting = approveCosting;
    window.rejectCosting = rejectCosting;
    window.generatePreview = generatePreview;
    window.suggestLines = suggestLines; // Expose suggestion function
  </script>

</body>
</html>