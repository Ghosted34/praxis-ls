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
$fullName = $me['full_name'] ?: 'Admin';
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
  <title>Smart Quote Intake | Smart LS Enterprise</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">

  <style>
    :root{
      --smart-blue: #1F99D8;
      --smart-dark: #055B83;
      --smart-orange: #EE7D04;
      --smart-charcoal: #231F20;
      --smart-bg: #F0F4F8;
      --sidebar-width: 280px; /* keep aligned with admin shell */
    }

    /* --- Module-only styling (does NOT redefine sidebar/topbar layout) --- */
    body{
      font-family: 'Manrope', sans-serif;
      background-color: var(--smart-bg);
      color: var(--smart-charcoal);
      overflow-x: hidden;
    }
    h1,h2,h3,h4,h5,h6,.font-heading{ font-family: 'Montserrat', sans-serif; }

    .card-custom{
      background:#fff;
      border:1px solid rgba(0,0,0,0.05);
      border-radius:12px;
      box-shadow:0 4px 15px rgba(0,0,0,0.03);
      transition:transform .2s, box-shadow .2s;
    }
    .card-custom:hover{ transform: translateY(-3px); box-shadow:0 8px 20px rgba(0,0,0,0.06); }

    .kpi-card{ position:relative; overflow:hidden; border-left:4px solid transparent; }
    .kpi-card.blue{ border-left-color:var(--smart-blue); background:linear-gradient(145deg,#fff,#f0f9ff); }
    .kpi-card.dark{ border-left-color:var(--smart-charcoal); background:linear-gradient(145deg,#fff,#f3f3f3); }
    .kpi-card.orange{ border-left-color:var(--smart-orange); background:linear-gradient(145deg,#fff,#fff5eb); }
    .kpi-card.teal{ border-left-color:#20c997; background:linear-gradient(145deg,#fff,#e6fff7); }
    .kpi-card.purple{ border-left-color:#6f42c1; background:linear-gradient(145deg,#fff,#f3eaff); }

    .kpi-icon{ width:45px;height:45px;display:flex;align-items:center;justify-content:center;border-radius:10px;font-size:1.2rem; }
    .kpi-title{ font-size:.75rem;font-weight:700;text-transform:uppercase;color:#6c757d;letter-spacing:.5px; }
    .kpi-value{ font-size:1.8rem;font-weight:800;color:var(--smart-charcoal);line-height:1.2; }

    .smart-input{ border-radius:8px;font-size:.9rem;padding:.6rem .8rem;border-color:#dee2e6;background-color:#fcfcfc; }
    .smart-input:focus{ border-color:var(--smart-blue);background-color:#fff;box-shadow:0 0 0 3px rgba(31,153,216,.15);outline:none; }

    .table-custom{ border-collapse:separate;border-spacing:0; }
    .table-custom thead th{
      background-color:var(--smart-dark);
      color:#fff;
      font-weight:600;
      text-transform:uppercase;
      font-size:.75rem;
      letter-spacing:.5px;
      padding:1rem;
      border:none;
    }
    .table-custom thead th:first-child{ border-top-left-radius:8px; }
    .table-custom thead th:last-child{ border-top-right-radius:8px; }
    .table-custom tbody tr{ transition:background-color .2s; }
    .table-custom tbody tr:hover{ background-color:#f1f8fc !important; }
    .table-custom td{ vertical-align:middle;padding:1rem;border-bottom:1px solid #eee;font-size:.9rem; }

    .access-gate{
      background:#fff3cd;border:1px solid #ffeeba;color:#856404;border-radius:12px;padding:2rem;text-align:center;
    }

    .btn-smart-primary{ background-color:var(--smart-blue); color:#fff; border:none; }
    .btn-smart-primary:hover{ background-color:var(--smart-dark); color:#fff; }
  </style>
</head>
<body>

  <!-- ✅ SIDEBAR (from index.php) -->
  <nav class="sidebar">
    <div class="sidebar-header">
        <a href="index.php" class="brand-logo"><i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span></a>
    </div>

    <div class="px-3 mb-2 mt-2">
        <a href="index.php" class="btn btn-primary w-100 text-start d-flex align-items-center" style="background-color: transparent; color: inherit; border: none; padding-left: 0;">
            <i class="fa-solid fa-house category-icon me-2"></i> 
            <span class="fw-bold">Admin Dashboard GM</span> 
        </a>
    </div>

    <div class="sidebar-menu accordion" id="adminMenu">
        
        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#admin1">
                <span><i class="fa-solid fa-database category-icon"></i> MASTER DATA</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="admin1" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
                <div class="sub-menu">
                    <a href="client-master-registry.php" class="sub-link">Client Master Registry</a>
                    <a href="supplier-master-registry.php" class="sub-link">Supplier Master Registry</a>
                    <a href="employee-master.php" class="sub-link">Employee Master Registry</a>
                    <a href="financial-dictionary.php" class="sub-link">Financial Dictionary</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#admin2">
                <span><i class="fa-solid fa-users category-icon"></i> CRM & ACQUISITION</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="admin2" class="accordion-collapse collapse show" data-bs-parent="#adminMenu">
                <div class="sub-menu">
                    <a href="smart-quote-leads.php" class="sub-link">Leads & Proposal Generator</a>
                    <a href="smart-quote-intake.php" class="sub-link">Smart Quote Intake</a>
                    <a href="sales-pipelining.php" class="sub-link">Sales Pipeline</a>
                    <a href="market-campaign-registration.php" class="sub-link">Marketing Campaign Register</a>
                    <a href="contact-us-intake.php" class="sub-link">Contact Us Intake</a>
                    <a href="partnership-portal-intake.php" class="sub-link">Partnership Portal Intake</a>
                    </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#admin3">
                <span><i class="fa-solid fa-calculator category-icon"></i> COMMERCIAL & PRICING</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="admin3" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
                <div class="sub-menu">
                    <a href="margin-simulator-billing.php" class="sub-link">Margin Simulator & Pricing System</a>
                    <a href="extra-charges-simulator.php" class="sub-link">Extra Charges Simulator</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#admin4">
                <span><i class="fa-solid fa-truck-fast category-icon"></i> LOGISTICS OPERATIONS</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="admin4" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
                <div class="sub-menu">
                    <a href="operations-registry.php" class="sub-link">Operations File Registry</a>
                    <a href="transit-order.php" class="sub-link">Transit Order (OT)</a>
                    <a href="operational-milestone-tracking.php" class="sub-link">Operational Milestone Tracking</a>
                    <a href="delivery-note.php" class="sub-link">Delivery Note</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#admin5">
                <span><i class="fa-solid fa-money-bill-trend-up category-icon"></i> OPS COST CONTROL</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="admin5" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
                <div class="sub-menu">
                    <a href="costing-module.php" class="sub-link">Costing Module</a>
                    <a href="cost-tracking.php" class="sub-link">Cost Tracking Master</a>
                    <a href="operational-cost-reconciliation.php" class="sub-link">Operational Cost Reconciliation</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#admin6">
                <span><i class="fa-solid fa-building-columns category-icon"></i> FINANCE & TREASURY</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="admin6" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
                <div class="sub-menu">
                    <a href="cash-request.php" class="sub-link">Cash Request</a>
                    <a href="purchase-order.php" class="sub-link">Purchase Order</a>
                    <a href="proforma-invoice-portal.php" class="sub-link">Proforma Invoice Portal</a>
                    <a href="final-invoice.php" class="sub-link">Final Invoice System</a>
                    <a href="smart-receivables-ledger.php" class="sub-link">Smart Receivables Ledger (SRL)</a>
                    <a href="debt-management.php" class="sub-link">Debt Management</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#admin7">
                <span><i class="fa-solid fa-folder-open category-icon"></i> HR & ARCHIVE</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="admin7" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
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

  <!-- ✅ TOP NAVBAR (from index.php) -->
  <div class="top-navbar">
    <div>
      <h5 class="mb-0 fw-bold text-dark">Smart Quote Intake</h5>
      <small class="text-muted" style="font-size: 0.7rem;">Manage Requests for Quotes and Convert to Opportunities</small>
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

  <!-- ✅ MAIN CONTENT: keep Smart Quote Intake module intact -->
  <div class="main-content px-4 pb-5">
    <main class="py-4">

      <div id="accessGate" class="d-none mt-4">
        <div class="access-gate shadow-sm">
          <i class="fa-solid fa-lock fs-1 mb-3"></i>
          <h4 class="fw-bold font-heading">Access Restricted</h4>
          <p class="mb-0">This module is restricted for your current role. Please contact Administrator.</p>
        </div>
      </div>

      <div id="moduleShell">
        <div class="d-flex justify-content-between align-items-end mb-4">
          <div>
            <h2 class="fw-bold font-heading mb-1 text-dark">Quote Requests</h2>
            <p class="text-muted small mb-0">Process intake, review requirements, and convert to Opportunities.</p>
          </div>
          <div class="d-flex gap-2">
            <button id="btnExport" class="btn btn-white border fw-bold shadow-sm text-primary">
              <i class="fa-solid fa-file-csv me-2"></i>Export CSV
            </button>
            <button id="btnNew" class="btn btn-smart-primary fw-bold shadow-sm">
              <i class="fa-solid fa-plus me-2"></i>New Manual Entry
            </button>
          </div>
        </div>

        <div class="row g-3 mb-4">
          <div class="col-md">
            <div class="card-custom kpi-card dark p-3 d-flex align-items-center h-100">
              <div class="me-3 kpi-icon bg-dark text-white"><i class="fa-solid fa-list"></i></div>
              <div><div class="kpi-title">Total</div><div class="kpi-value" id="kpiTotal">-</div></div>
            </div>
          </div>
          <div class="col-md">
            <div class="card-custom kpi-card blue p-3 d-flex align-items-center h-100">
              <div class="me-3 kpi-icon bg-primary text-white"><i class="fa-solid fa-inbox"></i></div>
              <div><div class="kpi-title">Received</div><div class="kpi-value" id="kpiReceived">-</div></div>
            </div>
          </div>
          <div class="col-md">
            <div class="card-custom kpi-card orange p-3 d-flex align-items-center h-100">
              <div class="me-3 kpi-icon bg-warning text-dark"><i class="fa-solid fa-glasses"></i></div>
              <div><div class="kpi-title">Under Review</div><div class="kpi-value text-warning" id="kpiReview">-</div></div>
            </div>
          </div>
          <div class="col-md">
            <div class="card-custom kpi-card teal p-3 d-flex align-items-center h-100">
              <div class="me-3 kpi-icon bg-success text-white"><i class="fa-solid fa-file-invoice-dollar"></i></div>
              <div><div class="kpi-title">Quoted</div><div class="kpi-value text-success" id="kpiQuoted">-</div></div>
            </div>
          </div>
          <div class="col-md">
            <div class="card-custom kpi-card purple p-3 d-flex align-items-center h-100">
              <div class="me-3 kpi-icon" style="background-color:#6f42c1;color:#fff;"><i class="fa-solid fa-trophy"></i></div>
              <div><div class="kpi-title">Converted</div><div class="kpi-value" style="color:#6f42c1;" id="kpiConverted">-</div></div>
            </div>
          </div>
        </div>

        <div class="card-custom p-4 mb-4">
  <div class="row g-2 align-items-end">
    <div class="col-md-3">
      <label class="small fw-bold text-muted mb-1 text-uppercase">Search</label>
      <div class="input-group">
        <span class="input-group-text bg-white border-end-0"><i class="fa-solid fa-search text-muted"></i></span>
        <input id="qSearch" type="text" class="form-control smart-input border-start-0 ps-0" placeholder="Ref, Client...">
      </div>
    </div>
    <div class="col-md-2">
      <label class="small fw-bold text-muted mb-1 text-uppercase">Status</label>
      <select id="qStatus" class="form-select smart-input">
        <option value="">All Statuses</option>
        <option value="RECEIVED">RECEIVED</option>
        <option value="UNDER_REVIEW">UNDER_REVIEW</option>
        <option value="QUOTED">QUOTED</option>
        <option value="CONVERTED_TO_OPPORTUNITY">CONVERTED</option>
      </select>
    </div>
    <div class="col-md-2">
      <label class="small fw-bold text-muted mb-1 text-uppercase">Month</label>
      <select id="qMonth" class="form-select smart-input">
        <option value="">All</option>
        <option value="1">Jan</option><option value="2">Feb</option><option value="3">Mar</option>
        <option value="4">Apr</option><option value="5">May</option><option value="6">Jun</option>
        <option value="7">Jul</option><option value="8">Aug</option><option value="9">Sep</option>
        <option value="10">Oct</option><option value="11">Nov</option><option value="12">Dec</option>
      </select>
    </div>
    <div class="col-md-2">
      <label class="small fw-bold text-muted mb-1 text-uppercase">Year</label>
      <select id="qYear" class="form-select smart-input">
        <option value="">All</option>
        <option value="2024">2024</option>
        <option value="2025" selected>2025</option>
        <option value="2026">2026</option>
      </select>
    </div>
    <div class="col-md-3">
       <div class="d-flex gap-2">
          <button id="btnFilter" class="btn btn-smart-primary fw-bold w-100 smart-input">Apply</button>
          <button id="btnReset" class="btn btn-light border fw-bold w-100 smart-input text-dark">Reset</button>
       </div>
    </div>
  </div>
</div>

        <div class="card-custom overflow-hidden p-0 border-0 shadow-sm">
          <div class="p-3 border-bottom d-flex justify-content-between align-items-center" style="background:#fff;">
            <h6 class="fw-bold mb-0 text-uppercase text-dark small"><i class="fa-solid fa-list me-2 text-primary"></i>Intake Register</h6>
            <small class="fw-bold text-primary bg-primary bg-opacity-10 px-2 py-1 rounded" id="tableMeta">-</small>
          </div>

          <div id="stateLoading" class="p-5 text-center d-none">
            <div class="spinner-border text-primary" role="status"></div>
            <p class="mt-2 text-muted small">Loading data...</p>
          </div>

          <div id="stateError" class="p-5 text-center d-none">
            <div class="text-danger mb-3"><i class="fa-solid fa-triangle-exclamation fs-1"></i></div>
            <h5 class="fw-bold text-danger">Data Load Error</h5>
            <p class="text-muted">Simulated error state active.</p>
            <button id="btnRetry" class="btn btn-sm btn-danger fw-bold rounded-pill px-4">Retry</button>
          </div>

          <div id="stateEmpty" class="p-5 text-center d-none">
            <div class="text-muted mb-3 opacity-25"><i class="fa-solid fa-folder-open fs-1"></i></div>
            <h5 class="fw-bold text-secondary">No Records Found</h5>
            <p class="text-muted">Try adjusting filters or seed data.</p>
          </div>

          <div class="table-responsive">
            <table class="table table-custom mb-0">
              <thead>
                <tr>
                  <th class="ps-4">Ref</th>
                  <th>Date</th>
                  <th>Requester</th>
                  <th>Service</th>
                  <th>Route / Loc</th>
                  <th>Weight</th>
                  <th>Status</th>
                  <th>Attachment</th>
                  <th class="text-end pe-4">Actions</th>
                </tr>
              </thead>
              <tbody id="tbody"></tbody>
            </table>
          </div>

          <div class="d-flex justify-content-between align-items-center p-3 border-top bg-white">
            <small class="text-muted fw-bold" id="pageMeta">-</small>
            <div class="d-flex align-items-center gap-2">
              <select id="pageSize" class="form-select form-select-sm" style="width:80px;">
                <option value="5">5</option>
                <option value="10" selected>10</option>
                <option value="20">20</option>
              </select>
              <button id="btnPrev" class="btn btn-sm btn-outline-secondary"><i class="fa-solid fa-chevron-left"></i></button>
              <button id="btnNext" class="btn btn-sm btn-outline-secondary"><i class="fa-solid fa-chevron-right"></i></button>
            </div>
          </div>
        </div>

        <div class="alert alert-light border mt-4 d-flex align-items-start gap-3 shadow-sm">
          <i class="fa-solid fa-circle-info text-primary mt-1"></i>
          <div>
            <h6 class="fw-bold small mb-1 text-dark">Process Control</h6>
            <ul class="mb-0 small text-muted ps-3">
              <li>Intake is non-financial; do not create Master Records here.</li>
              <li>Conversion to Opportunity is irreversible (One-way sync).</li>
            </ul>
          </div>
        </div>
      </div>
    </main>
  </div>

  <!-- Drawer + Toasts (unchanged) -->
  <div class="offcanvas offcanvas-end" tabindex="-1" id="intakeDrawer" style="width: 800px;" data-bs-backdrop="static">
    <div class="offcanvas-header border-bottom bg-light py-3">
      <div>
        <h5 class="offcanvas-title font-heading fw-bold" id="modalTitle">Quote Request</h5>
        <small class="text-muted" id="modalSub">-</small>
      </div>
      <button type="button" class="btn-close" data-bs-dismiss="offcanvas"></button>
    </div>

    <div class="offcanvas-body p-0 bg-white">
      <div id="bannerReadOnly" class="alert alert-warning m-3 d-none border-warning border-opacity-25 bg-warning bg-opacity-10 text-warning-emphasis fw-bold small">
        <i class="fa-solid fa-lock me-2"></i> Record is read-only.
      </div>

      <form id="form" class="p-4">
        <div class="row g-3">
          <div class="col-md-6">
            <label class="form-label small fw-bold text-muted text-uppercase">Public Ref</label>
            <input id="fPublicRef" disabled class="form-control smart-input bg-light fw-bold text-dark">
          </div>
          <div class="col-md-6">
            <label class="form-label small fw-bold text-muted text-uppercase">Status</label>
            <select id="fStatus" class="form-select smart-input fw-bold text-primary"></select>
          </div>

          <div class="col-12"><hr class="my-2 opacity-10"></div>

          <div class="col-md-6">
            <label class="form-label small fw-bold text-muted">Requester Name <span class="text-danger">*</span></label>
            <input id="fRequesterName" class="form-control smart-input">
            <div class="invalid-feedback d-block d-none" id="eRequesterName">Required</div>
          </div>
          <div class="col-md-6">
            <label class="form-label small fw-bold text-muted">Company</label>
            <input id="fRequesterCompany" class="form-control smart-input">
          </div>
          <div class="col-md-6">
            <label class="form-label small fw-bold text-muted">Email <span class="text-danger">*</span></label>
            <input id="fRequesterEmail" type="email" class="form-control smart-input">
            <div class="invalid-feedback d-block d-none" id="eRequesterEmail">Valid email required</div>
          </div>
          <div class="col-md-6">
            <label class="form-label small fw-bold text-muted">Phone <span class="text-danger">*</span></label>
            <input id="fRequesterPhone" class="form-control smart-input">
            <div class="invalid-feedback d-block d-none" id="eRequesterPhone">Required</div>
          </div>

          <div class="col-12"><hr class="my-2 opacity-10"></div>

          <div class="col-md-6">
            <label class="form-label small fw-bold text-muted">Service Type <span class="text-danger">*</span></label>
            <select id="fServiceCategory" class="form-select smart-input"></select>
            <div class="invalid-feedback d-block d-none" id="eServiceCategory">Required</div>
          </div>
          <div class="col-md-6">
            <label class="form-label small fw-bold text-muted">Incoterm <span class="text-danger">*</span></label>
            <select id="fServiceType" class="form-select smart-input"></select>
            <div class="invalid-feedback d-block d-none" id="eServiceType">Required</div>
          </div>

          <div class="col-md-6">
            <label class="form-label small fw-bold text-muted">Origin</label>
            <input id="fOrigin" class="form-control smart-input" placeholder="City, Country">
          </div>
          <div class="col-md-6">
            <label class="form-label small fw-bold text-muted">Destination</label>
            <input id="fDestination" class="form-control smart-input" placeholder="City, Country">
          </div>

          <div class="col-md-6">
            <label class="form-label small fw-bold text-muted">Warehouse Loc</label>
            <input id="fWarehouseLoc" class="form-control smart-input">
          </div>
          <div class="col-md-6">
            <label class="form-label small fw-bold text-muted">Duration</label>
            <select id="fWarehouseDur" class="form-select smart-input"></select>
          </div>

          <div class="col-md-6">
            <label class="form-label small fw-bold text-muted">Est. Weight</label>
            <div class="input-group">
              <input id="fWeight" type="number" step="0.01" class="form-control smart-input">
              <span class="input-group-text bg-light">kg</span>
            </div>
          </div>
          <div class="col-md-6 d-flex align-items-center pt-4">
            <div class="form-check form-switch">
              <input class="form-check-input" type="checkbox" id="fProjectCargo">
              <label class="form-check-label fw-bold small text-dark" for="fProjectCargo">Project Cargo Flag</label>
            </div>
          </div>

          <div class="col-12 d-none" id="wrapCargoDesc">
            <label class="form-label small fw-bold text-muted">Description <span class="text-danger">*</span></label>
            <textarea id="fCargoDesc" rows="2" class="form-control smart-input"></textarea>
        </div>

          <div class="col-12">
            <label class="form-label small fw-bold text-muted">Notes</label>
            <textarea id="fNotes" rows="2" class="form-control smart-input"></textarea>
          </div>

          <div class="col-12">
            <label class="form-label small fw-bold text-muted">Attachments</label>
            <div id="attachmentsChips" class="d-flex flex-wrap gap-2 mb-2"></div>
            <button type="button" id="btnAddAttachment" class="btn btn-sm btn-light border fw-bold text-primary">
              <i class="fa-solid fa-paperclip me-1"></i> Add Reference
            </button>
          </div>
        </div>
        <input type="file" id="fAttachment" class="d-none" />

      </form>

      <div class="p-4 bg-light border-top">
        <h6 class="fw-bold small text-muted mb-3">Change History</h6>
        <div id="changeHistory" class="small text-muted font-monospace bg-white p-3 rounded border shadow-sm" style="white-space: pre-line;"></div>
      </div>

      <div class="p-4 border-top sticky-bottom bg-white d-flex justify-content-between align-items-center shadow-lg">
        
        <div class="d-flex gap-2">
          <button id="btnConvert" class="btn btn-dark fw-bold">Convert to Opp</button>
          <button id="btnSave" class="btn btn-smart-primary fw-bold">Save Changes</button>
        </div>
      </div>

      <div id="convertWarning" class="p-4 bg-danger bg-opacity-10 border-top border-danger border-opacity-25 d-none">
        <div class="d-flex gap-3">
          <i class="fa-solid fa-triangle-exclamation text-danger fs-4 mt-1"></i>
          <div>
            <h6 class="fw-bold text-danger">Irreversible Action</h6>
            <p class="small text-danger mb-2">Once converted, this record becomes locked and an Opportunity ID is generated.</p>
            <div class="d-flex gap-2">
              <button id="btnConfirmConvert" class="btn btn-sm btn-danger fw-bold">Confirm Convert</button>
              <button id="btnCancelConvert" class="btn btn-sm btn-outline-danger fw-bold">Cancel</button>
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>
  <div class="modal fade" id="docsModal" tabindex="-1">
  <div class="modal-dialog modal-lg modal-dialog-scrollable">
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title fw-bold">Documents</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
      </div>
      <div class="modal-body">
        <div id="docsList" class="list-group"></div>
      </div>
    </div>
  </div>
</div>


  <div id="toasts" class="toast-container position-fixed bottom-0 end-0 p-3"></div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

  <script>
/********************
 * CONFIG & CONSTANTS
 ********************/
const STATUS = ["RECEIVED","UNDER_REVIEW","CLARIFICATION_REQUIRED","QUOTED","CLOSED_NO_ACTION"];
const SERVICE_CATEGORIES = ["SEA_FREIGHT_IMPORT","SEA_FREIGHT_EXPORT","AIR_FREIGHT_IMPORT","AIR_FREIGHT_EXPORT","HINTERLAND_TRANSIT","INLAND_TRANSPORTATION","END_TO_END_AIR_FREIGHT","WAREHOUSING","END_TO_END_SEA_FREIGHT","BUSINESS_REPRESENTATION"];
const SERVICE_TYPES = ["EXW", "FCA", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"];
const WAREHOUSE_DURATIONS = ["< 7 DAYS","7–14 DAYS","15–30 DAYS","30+ DAYS","UNKNOWN"];

// RBAC Configuration
const ROLE_ACCESS = {
  SALES: { canView: true, canEdit: true, canConvert: true },
  ADMIN: { canView: true, canEdit: true, canConvert: true },
  MANAGEMENT: { canView: true, canEdit: false, canConvert: false },
  FINANCE: { canView: false, canEdit: false, canConvert: false },
  OPERATIONS: { canView: false, canEdit: false, canConvert: false },
};

let state = {
  role: "<?php echo $role; ?>", // Injected from PHP
  loading: false,
  simulateError: false,
  page: 1,
  pageSize: 10,
  total: 0,
  data: [],
  // Updated Filters including Date (Challenge 6.S4)
  filters: { 
      search: "", 
      status: "", 
      category: "", 
      month: "", 
      year: "<?php echo date('Y'); ?>", // Default to current year
      sort: "submission_datetime:desc" 
  },
  modal: { activeId: null }
};

const drawerEl = document.getElementById("intakeDrawer");
const drawer = new bootstrap.Offcanvas(drawerEl);

/********************
 * UTILITIES
 ********************/
function fmtDate(iso) {
  try {
    if(!iso) return "-";
    // Challenge 8: Clean Date Format
    return new Date(iso).toLocaleString('en-GB', {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
    });
  } catch { return iso; }
}

function chipStatus(s, isPipeline = false) {
  // If it's a pipeline record, visually prefix it and force dark styling
  if (isPipeline && s !== 'CONVERTED_TO_OPPORTUNITY') {
    return `<span class="badge bg-dark text-white border border-secondary rounded-pill fw-bold px-3 py-2" style="font-size:0.75rem">
              <i class="fa-solid fa-code-branch me-1"></i> SP-${String(s).replace(/_/g," ")}
            </span>`;
  }

  const map = {
    RECEIVED: "bg-light text-dark border",
    UNDER_REVIEW: "bg-warning bg-opacity-10 text-warning-emphasis border-warning border-opacity-25",
    CLARIFICATION_REQUIRED: "bg-danger bg-opacity-10 text-danger border-danger border-opacity-25",
    QUOTED: "bg-success bg-opacity-10 text-success border-success border-opacity-25",
    CONVERTED_TO_OPPORTUNITY: "bg-dark text-white",
    CLOSED_NO_ACTION: "bg-secondary bg-opacity-10 text-secondary border-secondary border-opacity-25",
  };
  return `<span class="badge ${map[s] || "bg-secondary"} rounded-pill fw-normal px-3 py-2" style="font-size:0.75rem">${String(s||"").replace(/_/g," ")}</span>`;
}

function toast(msg, type="primary") {
  const tContainer = document.getElementById("toasts");
  if (!tContainer) return alert(msg);
  const el = document.createElement("div");
  el.className = `toast align-items-center text-bg-${type} border-0 show`;
  el.role = "alert";
  el.innerHTML = `<div class="d-flex">
    <div class="toast-body fw-bold">${msg}</div>
    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
  </div>`;
  tContainer.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function setDisabled(selector, disabled) {
  document.querySelectorAll(selector).forEach(el => { el.disabled = !!disabled; });
}

/********************
 * UI LOGIC (Project Cargo)
 ********************/
function syncProjectCargoUI() {
  const flagEl = document.getElementById("fProjectCargo");
  const descWrap = document.getElementById("wrapCargoDesc");
  const desc = document.getElementById("fCargoDesc");
  if (!flagEl || !descWrap || !desc) return;

  if (flagEl.checked) {
    descWrap.classList.remove("d-none");
    desc.setAttribute("required", "required");
  } else {
    descWrap.classList.add("d-none");
    desc.removeAttribute("required");
    desc.value = "";
  }
}

/********************
 * DATA LOADING (List & KPIs)
 ********************/
async function loadTableFromDb() {
  state.loading = true;
  render();

  // Include new Date filters in params
  const params = new URLSearchParams({
    q: state.filters.search || "",
    status: state.filters.status || "",
    category: state.filters.category || "",
    month: state.filters.month || "",
    year: state.filters.year || "",
    sort: state.filters.sort || "submission_datetime:desc",
    page: String(state.page),
    pageSize: String(state.pageSize),
  });

  try {
    const r = await fetch(`../../api/quote_requests/list.php?${params.toString()}`, { credentials: "same-origin" });
    const j = await r.json();

    if (!j.ok) {
      toast("Failed to load table", "danger");
      state.data = [];
      state.total = 0;
    } else {
      state.data = j.rows || [];
      state.total = Number(j.total || 0);
      if (j.page) state.page = Number(j.page);
      
      // Challenge 4: Update KPIs from Server Response
      if(j.kpi) {
          const k = j.kpi;
          if(document.getElementById("kpiTotal")) document.getElementById("kpiTotal").textContent = k.TOTAL || 0;
          if(document.getElementById("kpiReceived")) document.getElementById("kpiReceived").textContent = k.RECEIVED || 0;
          if(document.getElementById("kpiReview")) document.getElementById("kpiReview").textContent = k.UNDER_REVIEW || 0;
          if(document.getElementById("kpiQuoted")) document.getElementById("kpiQuoted").textContent = k.QUOTED || 0;
          if(document.getElementById("kpiConverted")) document.getElementById("kpiConverted").textContent = k.CONVERTED_TO_OPPORTUNITY || 0;
      }
    }
  } catch (e) {
    console.error(e);
    toast("Network error loading table", "danger");
  } finally {
    state.loading = false;
    render();
  }
}

function render() {
  // 1. Permissions Check
  const perm = ROLE_ACCESS[state.role] || { canView: false };
  const gate = document.getElementById("accessGate");
  const shell = document.getElementById("moduleShell");
  if (gate && shell) {
    gate.classList.toggle("d-none", perm.canView);
    shell.classList.toggle("d-none", !perm.canView);
  }

  // 2. Populate Filter Dropdowns (only once)
  const qCat = document.getElementById("qCategory");
  if (qCat && qCat.options.length <= 1) {
    SERVICE_CATEGORIES.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      qCat.appendChild(opt);
    });
  }

  // 3. Loading State
  const loadingEl = document.getElementById("stateLoading");
  const tableWrap = document.querySelector(".table-responsive");
  const emptyEl = document.getElementById("stateEmpty");
  
  if (loadingEl) loadingEl.classList.toggle("d-none", !state.loading);
  if (tableWrap) tableWrap.classList.toggle("d-none", state.loading);
  if (state.loading) return;

  if (emptyEl) emptyEl.classList.toggle("d-none", (state.total || 0) > 0);

  // 4. Render Rows
  const tbody = document.getElementById("tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  state.data.forEach(r => {
    // LOCK LOGIC: If an Opportunity ID exists, it belongs to the Pipeline now.
    const isConverted = (r.converted_opportunity_id && r.converted_opportunity_id !== '');
    const rowClass = isConverted ? "opacity-50 bg-light" : "";
    const rowStyle = isConverted ? "background-color: #fcfcfc;" : "";

    const tr = document.createElement("tr");
    tr.className = rowClass;
    if(isConverted) tr.style.cssText = rowStyle;

    tr.innerHTML = `
      <td class="ps-4">
        <div class="fw-bold text-dark font-monospace">${r.public_quote_ref || "-"}</div>
        <div class="small text-muted">${r.intake_channel || "-"}</div>
      </td>
      
      <td class="small fw-bold text-dark">
        ${fmtDate(r.submission_datetime)}
      </td>

      <td>
        <div class="fw-bold text-dark small">${r.requester_name || "-"}</div>
        <div class="small text-muted">${r.requester_email || ""}</div>
      </td>
      <td>
        <div class="fw-bold small text-primary">${r.service_category || "-"}</div>
        <div class="small text-muted">${r.service_type || "-"}</div>
      </td>
      <td>
        <div class="fw-bold small text-dark">
          ${r.origin_location || "-"} <i class="fa-solid fa-arrow-right mx-1 text-muted"></i> ${r.destination_location || "-"}
        </div>
      </td>
      <td class="small fw-bold">${r.estimated_weight ? Number(r.estimated_weight).toLocaleString() + " kg" : "-"}</td>
      <td>${chipStatus(r.status, isConverted)}</td>

      <td class="small">
        ${(r.attachment_url || r.documents_count > 0)
          ? `${r.attachment_url ? `<a class="fw-bold text-primary text-decoration-none me-2" href="${r.attachment_url}" target="_blank"><i class="fa-solid fa-paperclip me-1"></i>Open</a>` : ""}
             ${Number(r.documents_count || 0) > 0 ? `<a href="#" class="fw-bold text-dark text-decoration-none btnDocs" data-id="${r.quote_request_id}">Docs (${Number(r.documents_count)})</a>` : ""}`
          : `<span class="text-muted">-</span>`
        }
      </td>

      <td class="text-end pe-4">
        <button class="btn btn-sm btn-outline-dark fw-bold btnView" style="pointer-events: auto;" data-id="${r.quote_request_id}">Manage</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Bind Row Buttons
  document.querySelectorAll(".btnView").forEach(btn => {
    btn.addEventListener("click", () => openDrawerFromDb(btn.getAttribute("data-id")));
  });
  
  // Bind Docs Modal (preserving your original code)
  document.querySelectorAll(".btnDocs").forEach(a => {
    a.addEventListener("click", async (ev) => {
      ev.preventDefault();
      await openDocumentsModal(a.getAttribute("data-id"));
    });
  });

  // Pagination UI
  const pageMeta = document.getElementById("pageMeta");
  if (pageMeta) pageMeta.textContent = `Page ${state.page} (Total: ${state.total})`;
  const prev = document.getElementById("btnPrev");
  const next = document.getElementById("btnNext");
  if (prev) prev.disabled = state.page <= 1;
  if (next) next.disabled = (state.page * state.pageSize) >= state.total;
}

/********************
 * DOCUMENTS MODAL
 ********************/
async function openDocumentsModal(quoteRequestId) {
  const modalEl = document.getElementById("docsModal");
  const listEl  = document.getElementById("docsList");
  if (!modalEl || !listEl) return;
  
  listEl.innerHTML = `<div class="text-muted small">Loading...</div>`;
  new bootstrap.Modal(modalEl).show();

  try {
    const r = await fetch(`../../api/quote_requests/list-documents.php?quote_request_id=${encodeURIComponent(quoteRequestId)}`, { credentials: "same-origin" });
    const j = await r.json();
    if (!j.ok) {
      listEl.innerHTML = `<div class="text-danger small">${j.error || "Failed to load"}</div>`;
    } else {
      const docs = j.documents || [];
      if (!docs.length) listEl.innerHTML = `<div class="text-muted small">No documents found.</div>`;
      else {
        listEl.innerHTML = docs.map(d => `
          <a class="list-group-item list-group-item-action d-flex justify-content-between align-items-center" href="${d.url}" target="_blank">
            <div><div class="fw-bold">${d.original_name}</div><div class="small text-muted">${d.uploaded_at}</div></div>
            <i class="fa-solid fa-up-right-from-square text-muted"></i>
          </a>`).join("");
      }
    }
  } catch (e) {
    listEl.innerHTML = `<div class="text-danger small">Network error.</div>`;
  }
}

/********************
 * DRAWER: OPEN & EDIT
 ********************/
async function openDrawerFromDb(id) {
  const r = await fetch(`../../api/quote_requests/get.php?id=${encodeURIComponent(id)}`, { credentials: "same-origin" });
  const j = await r.json();
  if (!j.ok) return toast("Failed to load record", "danger");

  const rec = j.record;
  state.modal.activeId = rec.quote_request_id;

  // Populate Select Options
  const populate = (id, opts) => {
    const el = document.getElementById(id);
    if(el) el.innerHTML = opts.map(x => `<option value="${x}">${x}</option>`).join("");
  };
  populate("fStatus", STATUS);
  document.getElementById("fStatus").value = rec.status;

  const fCat = document.getElementById("fServiceCategory");
  fCat.innerHTML = `<option value="">Select...</option>` + SERVICE_CATEGORIES.map(x => `<option value="${x}">${x}</option>`).join("");
  fCat.value = rec.service_category || "";

  const fType = document.getElementById("fServiceType");
  fType.innerHTML = `<option value="">Select...</option>` + SERVICE_TYPES.map(x => `<option value="${x}">${x}</option>`).join("");
  fType.value = rec.service_type || "";

  const fWD = document.getElementById("fWarehouseDur");
  fWD.innerHTML = WAREHOUSE_DURATIONS.map(x => `<option value="${x}">${x}</option>`).join("");
  fWD.value = rec.warehouse_duration || "UNKNOWN";

  // Hydrate Text Fields
  document.getElementById("fPublicRef").value = rec.public_quote_ref || "";
  document.getElementById("fRequesterName").value = rec.requester_name ?? "";
  document.getElementById("fRequesterCompany").value = rec.requester_company ?? "";
  document.getElementById("fRequesterEmail").value = rec.requester_email ?? "";
  document.getElementById("fRequesterPhone").value = rec.requester_phone ?? "";
  document.getElementById("fOrigin").value = rec.origin_location ?? "";
  document.getElementById("fDestination").value = rec.destination_location ?? "";
  document.getElementById("fWarehouseLoc").value = rec.warehouse_location ?? "";
  document.getElementById("fWeight").value = rec.estimated_weight ?? "";
  document.getElementById("fCargoDesc").value = rec.cargo_description ?? "";
  document.getElementById("fNotes").value = rec.additional_notes ?? "";

  // Project Cargo Flag
  document.getElementById("fProjectCargo").checked = (Number(rec.project_cargo_flag) === 1);
  syncProjectCargoUI();

  // Attachments Chips
  const chips = document.getElementById("attachmentsChips");
  if (chips) {
    chips.innerHTML = "";
    (j.attachments || []).forEach(a => {
      if(!a.url) return;
      const link = document.createElement("a");
      link.className = "badge bg-light text-primary border p-2 fw-normal text-decoration-none";
      link.href = a.url;
      link.target = "_blank";
      link.innerHTML = `<i class="fa-solid fa-paperclip me-1"></i>${a.original_name}`;
      chips.appendChild(link);
    });
  }
  document.getElementById("fAttachment").value = "";

  // Title
  document.getElementById("modalTitle").innerText = `Quote Request - ${rec.public_quote_ref}`;

  // Permissions / Read Only
  const perm = ROLE_ACCESS[state.role] || { canEdit: false, canConvert: false };
  const isConverted = (rec.status === "CONVERTED_TO_OPPORTUNITY");
  const canEdit = perm.canEdit && !isConverted;
  const canConvert = perm.canConvert && !isConverted && rec.status !== "CLOSED_NO_ACTION";

  const banner = document.getElementById("bannerReadOnly");
  if(banner) banner.classList.toggle("d-none", canEdit);

  setDisabled("#form input, #form select, #form textarea", !canEdit);
  document.getElementById("btnAddAttachment").disabled = !canEdit;
  
  const btnSave = document.getElementById("btnSave");
  const btnConvert = document.getElementById("btnConvert");
  if (btnSave) btnSave.disabled = !canEdit;
  if (btnConvert) btnConvert.disabled = !canConvert;

  drawer.show();
}

/********************
 * DRAWER: NEW ENTRY
 ********************/
async function openNewDrawerOnly() {
  state.modal.activeId = null;
  document.getElementById("form").reset();

  // Set Placeholder
  const refInput = document.getElementById("fPublicRef");
  refInput.value = "(Auto-Generated)";

  // Populate Defaults
  const populate = (id, opts) => { document.getElementById(id).innerHTML = opts.map(x => `<option value="${x}">${x}</option>`).join(""); };
  populate("fStatus", STATUS); document.getElementById("fStatus").value = "RECEIVED";
  
  const fCat = document.getElementById("fServiceCategory");
  fCat.innerHTML = `<option value="">Select...</option>` + SERVICE_CATEGORIES.map(x => `<option value="${x}">${x}</option>`).join("");
  
  const fType = document.getElementById("fServiceType");
  fType.innerHTML = `<option value="">Select...</option>` + SERVICE_TYPES.map(x => `<option value="${x}">${x}</option>`).join("");
  
  const fWD = document.getElementById("fWarehouseDur");
  fWD.innerHTML = WAREHOUSE_DURATIONS.map(x => `<option value="${x}">${x}</option>`).join("");
  fWD.value = "UNKNOWN";

  // Reset UI
  document.getElementById("attachmentsChips").innerHTML = "";
  document.getElementById("fAttachment").value = "";
  document.getElementById("fProjectCargo").checked = false;
  syncProjectCargoUI();
  
  document.getElementById("modalTitle").innerText = "New Quote Request";

  // Ensure Edit Mode
  const perm = ROLE_ACCESS[state.role] || { canEdit: false };
  const canEdit = !!perm.canEdit;
  
  // 1. Enable all fields first
  setDisabled("#form input, #form select, #form textarea", !canEdit);
  
  // 2. PATCH: Explicitly disable the Public Ref field so user cannot edit "(Auto-Generated)"
  refInput.disabled = true; 

  document.getElementById("btnAddAttachment").disabled = !canEdit;
  document.getElementById("btnSave").disabled = !canEdit;
  document.getElementById("btnConvert").disabled = true; 

  if(document.getElementById("bannerReadOnly")) 
    document.getElementById("bannerReadOnly").classList.toggle("d-none", canEdit);

  drawer.show();
}

/********************
 * SAVE & UPDATE
 ********************/
async function saveRecordToDb() {
  const perm = ROLE_ACCESS[state.role] || { canEdit: false };
  if (!perm.canEdit) return toast("Read-only role", "danger");

  const isProject = document.getElementById("fProjectCargo").checked;
  if (isProject && !document.getElementById("fCargoDesc").value.trim()) {
    return toast("Description required for Project Cargo", "danger");
  }

  const fd = new FormData();
  if (state.modal.activeId) fd.append("quote_request_id", state.modal.activeId);

  // Challenge 6.S2: These fields are only sent on save
  fd.append("public_quote_ref", document.getElementById("fPublicRef").value);
  fd.append("status", document.getElementById("fStatus").value);
  fd.append("requester_name", document.getElementById("fRequesterName").value);
  fd.append("requester_company", document.getElementById("fRequesterCompany").value);
  fd.append("requester_email", document.getElementById("fRequesterEmail").value);
  fd.append("requester_phone", document.getElementById("fRequesterPhone").value);
  fd.append("service_category", document.getElementById("fServiceCategory").value);
  fd.append("service_type", document.getElementById("fServiceType").value);
  fd.append("origin_location", document.getElementById("fOrigin").value);
  fd.append("destination_location", document.getElementById("fDestination").value);
  fd.append("warehouse_location", document.getElementById("fWarehouseLoc").value);
  fd.append("warehouse_duration", document.getElementById("fWarehouseDur").value);
  fd.append("estimated_weight", document.getElementById("fWeight").value);
  fd.append("project_cargo_flag", isProject ? "1" : "0");
  fd.append("cargo_description", document.getElementById("fCargoDesc").value);
  fd.append("additional_notes", document.getElementById("fNotes").value);

  const file = document.getElementById("fAttachment")?.files?.[0];
  if (file) fd.append("attachment", file);

  try {
    const r = await fetch("../../api/quote_requests/save.php", { method: "POST", body: fd, credentials: "same-origin" });
    const text = await r.text();
    let j; 
    try { j = JSON.parse(text); } catch { return toast("Server Error (Invalid JSON)", "danger"); }

    if (!r.ok || !j.ok) return toast(j.error || "Save Failed", "danger");

    toast("Saved Successfully", "success");
    state.modal.activeId = j.quote_request_id;
    
    // Clear file input
    document.getElementById("fAttachment").value = "";
    
    await loadTableFromDb();
    await openDrawerFromDb(state.modal.activeId);
  } catch (e) {
    toast("Network error during save", "danger");
  }
}

async function convertToOpp() {
  if (!state.modal.activeId) return toast("Save first", "warning");
  if (!confirm("Are you sure you want to convert this to an Opportunity? This cannot be undone.")) return;

  try {
    const r = await fetch("../../api/quote_requests/convert.php", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quote_request_id: state.modal.activeId })
    });
    const j = await r.json();
    if (!j.ok) return toast(j.error || "Convert failed", "danger");

    toast(`Converted: ${j.converted_opportunity_id}`, "success");
    await loadTableFromDb();
    await openDrawerFromDb(state.modal.activeId);
  } catch {
    toast("Network error converting", "danger");
  }
}

/********************
 * EXPORT (Challenge 5)
 ********************/
function exportToCSV() {
    // Challenge 5: Redirect to Server-Side Export Script
    const params = new URLSearchParams({
        q: state.filters.search,
        status: state.filters.status,
        category: state.filters.category,
        month: state.filters.month,
        year: state.filters.year
    });
    window.location.href = `../../api/quote_requests/export_quotes.php?${params.toString()}`;
}

/********************
 * EVENT BINDINGS
 ********************/
(function init() {
  // Global Buttons
  const btnNew = document.getElementById("btnNew");
  const btnExport = document.getElementById("btnExport");
  const btnSave = document.getElementById("btnSave");
  const btnConvert = document.getElementById("btnConvert");
  
  if (btnNew) btnNew.onclick = openNewDrawerOnly;
  if (btnExport) btnExport.onclick = exportToCSV;
  if (btnSave) btnSave.onclick = saveRecordToDb;
  if (btnConvert) btnConvert.onclick = convertToOpp;

  // Attachment Preview
  const fAttachment = document.getElementById("fAttachment");
  const btnAddAttachment = document.getElementById("btnAddAttachment");
  if (btnAddAttachment) btnAddAttachment.onclick = () => fAttachment.click();
  
  if (fAttachment) {
    fAttachment.addEventListener("change", () => {
      const f = fAttachment.files?.[0];
      const chips = document.getElementById("attachmentsChips");
      if (f && chips) {
        // Temporary chip for UI feedback
        const el = document.createElement("span");
        el.className = "badge bg-light text-dark border p-2 fw-normal";
        el.textContent = "Pending: " + f.name;
        chips.prepend(el);
      }
    });
  }

  // Project Cargo Toggle
  const fProjectCargo = document.getElementById("fProjectCargo");
  if (fProjectCargo) fProjectCargo.addEventListener("change", syncProjectCargoUI);

  // Filters (Challenge 6.S4)
  const btnFilter = document.getElementById("btnFilter");
  if(btnFilter) {
      btnFilter.onclick = () => {
          state.filters.search = document.getElementById("qSearch").value;
          state.filters.status = document.getElementById("qStatus").value;
          if(document.getElementById("qCategory")) state.filters.category = document.getElementById("qCategory").value; // Assuming you add this filter to UI
          state.filters.month = document.getElementById("qMonth").value;
          state.filters.year = document.getElementById("qYear").value;
          state.page = 1;
          loadTableFromDb();
      };
  }

  const btnReset = document.getElementById("btnReset");
  if(btnReset) {
      btnReset.onclick = () => {
          document.getElementById("qSearch").value = "";
          document.getElementById("qStatus").value = "";
          document.getElementById("qMonth").value = "";
          document.getElementById("qYear").value = "<?php echo date('Y'); ?>";
          if(btnFilter) btnFilter.click();
      };
  }
  
  // Sorting (if dropdown exists)
  const qSort = document.getElementById("qSort");
  if(qSort) qSort.onchange = (e) => { state.filters.sort = e.target.value; loadTableFromDb(); };

  // Pagination
  document.getElementById("btnPrev").onclick = () => { if(state.page>1) { state.page--; loadTableFromDb(); }};
  document.getElementById("btnNext").onclick = () => { state.page++; loadTableFromDb(); };
  
  const pageSize = document.getElementById("pageSize");
  if(pageSize) pageSize.onchange = (e) => { state.pageSize = Number(e.target.value); state.page=1; loadTableFromDb(); };

  // Initial Load
  syncProjectCargoUI();
  loadTableFromDb();
})();
</script>

</body>
</html>






