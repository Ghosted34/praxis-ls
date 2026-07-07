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
$fullName = $me['full_name'] ?: 'Management';
$firstName = trim(explode(' ', $fullName)[0] ?? 'Management');

$roleLabelMap = [
  'ADMIN'      => 'SYSTEM ADMIN',
  'FINANCE'    => 'FINANCE',
  'SALES'      => 'SALES',
  'OPERATIONS' => 'OPERATIONS',
  'MANAGEMENT' => 'MANAGEMENT',
];
$role = strtoupper((string)($me['role'] ?? 'mANAGEMENT'));
$roleLabel = $roleLabelMap[$role] ?? 'MANAGMENT';

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
            <a href="#" class="brand-logo"><i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span></a>
        </div>
        
        <div class="sidebar-menu accordion" id="mgmtMenu">
            
            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu1">
                    <span><i class="fa-solid fa-chart-line category-icon"></i> Executive Overview</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu1" class="accordion-collapse collapse " data-bs-parent="#mgmtMenu">
                    <div class="sub-menu">
                        <a href="index.php" class="sub-link ">Dashboards & KPI Reporting</a>
                    </div>
                </div>
            </div>

            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu2">
                    <span><i class="fa-solid fa-gavel category-icon"></i> Governance & Control</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu2" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
                    <div class="sub-menu">
                        <a href="index.php" class="sub-link">Dashboard</a>
                        <a href="#" class="sub-link">Security & Session Audit</a>
                        <a href="payroll-management.php" class="sub-link">Payroll Management</a>
                    </div>
                </div>
            </div>

            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu3">
                    <span><i class="fa-solid fa-database category-icon"></i> Master Data Oversight</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu3" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
                    <div class="sub-menu">
                      <a href="attendance-logs.php" class="sub-link">Attendance Logs</a>
                        <a href="#" class="sub-link">Client Master</a>
                        <a href="#" class="sub-link">Supplier Master</a>
                        <a href="employee-master.php" class="sub-link">Employee Master</a>
                        
                        <a href="#" class="sub-link">Smart Financial Dictionary</a>
                    </div>
                </div>
            </div>

            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu4">
                    <span><i class="fa-solid fa-briefcase category-icon"></i> Commercial Performance</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu4" class="accordion-collapse collapse show" data-bs-parent="#mgmtMenu">
                    <div class="sub-menu">
                        <a href="sales-pipelining.php" class="sub-link">Sales Pipeline / Opportunity Tracking</a>
                        <a href="market-campaign-registration.php" class="sub-link">Marketing Campaign Register</a>
                        <a href="smart-quote-intake.php" class="sub-link active">Smart Quote Portal Intake</a>
                        <a href="contact-us-intake.php" class="sub-link">Contact Us Intake</a>
                        <a href="#" class="sub-link">Pricing Margin Simulator</a>
                        <a href="#" class="sub-link">Extra Charges Simulator</a>
                    </div>
                </div>
            </div>

            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu5">
                    <span><i class="fa-solid fa-ship category-icon"></i> Operations Visibility</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu5" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
                    <div class="sub-menu">
                        <a href="#" class="sub-link">Operations File Registry</a>
                        <a href="#" class="sub-link">Operational Milestone Tracking</a>
                        <a href="#" class="sub-link">Transit Order Module</a>
                        <a href="#" class="sub-link">Delivery Note / Proof of Delivery (POD)</a>
                    </div>
                </div>
            </div>

            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu6">
                    <span><i class="fa-solid fa-coins category-icon"></i> Financial Performance</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu6" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
                    <div class="sub-menu">
                        <a href="#" class="sub-link">Costing Module</a>
                        <a href="#" class="sub-link">Actual Margin Tracker</a>
                        <a href="#" class="sub-link">Client Engagement & Exposure Register</a>
                        <a href="#" class="sub-link">Ops Cost Exposure & Service Coverage</a>
                        <a href="#" class="sub-link">Final Invoice Module</a>
                        <a href="#" class="sub-link">Collections & Reminder Automation</a>
                    </div>
                </div>
            </div>

            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu7">
                    <span><i class="fa-solid fa-folder-open category-icon"></i> Documents & Int.</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu7" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
                    <div class="sub-menu">
                        <a href="#" class="sub-link">Attachments & Document Vault</a>
                        <a href="#" class="sub-link">Exports & Accounting Integration</a>
                    </div>
                </div>
            </div>

        </div>

        <div class="sidebar-footer">
            <button class="btn btn-outline-danger w-100 btn-sm fw-bold"><i class="fa-solid fa-right-from-bracket me-2"></i> Sign Out</button>
        </div>
    </nav>

  <!-- ✅ TOP NAVBAR (from index.php) -->
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
            <div class="col-md-4">
              <label class="small fw-bold text-muted mb-1 text-uppercase">Search</label>
              <div class="input-group">
                <span class="input-group-text bg-white border-end-0"><i class="fa-solid fa-search text-muted"></i></span>
                <input id="qSearch" type="text" class="form-control smart-input border-start-0 ps-0" placeholder="Ref, Client, Cargo...">
              </div>
            </div>
            <div class="col-md-2">
              <label class="small fw-bold text-muted mb-1 text-uppercase">Status</label>
              <select id="qStatus" class="form-select smart-input">
                <option value="">All Statuses</option>
                <option value="RECEIVED">RECEIVED</option>
                <option value="UNDER_REVIEW">UNDER_REVIEW</option>
                <option value="CLARIFICATION_REQUIRED">CLARIFICATION</option>
                <option value="QUOTED">QUOTED</option>
                <option value="CONVERTED_TO_OPPORTUNITY">CONVERTED</option>
                <option value="CLOSED_NO_ACTION">CLOSED</option>
              </select>
            </div>
            <div class="col-md-2">
              <label class="small fw-bold text-muted mb-1 text-uppercase">Category</label>
              <select id="qCategory" class="form-select smart-input">
                <option value="">All Categories</option>
              </select>
            </div>
            <div class="col-md-2">
              <label class="small fw-bold text-muted mb-1 text-uppercase">Sort</label>
              <select id="qSort" class="form-select smart-input">
                <option value="submission_datetime:desc">Newest First</option>
                <option value="submission_datetime:asc">Oldest First</option>
                <option value="estimated_weight:desc">Weight (High)</option>
              </select>
            </div>
            <div class="col-md-2">
              <button id="btnReset" class="btn btn-light border fw-bold w-100 smart-input text-dark">
                <i class="fa-solid fa-rotate-left me-1"></i> Reset
              </button>
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
                  <th>Requester</th>
                  <th>Service</th>
                  <th>Route / Loc</th>
                  <th>Weight</th>
                  <th>Status</th>
                  <th>Submitted</th>
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
  <div class="offcanvas offcanvas-end" tabindex="-1" id="intakeDrawer" style="width: 800px;">
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
            <label class="form-label small fw-bold text-muted">Category <span class="text-danger">*</span></label>
            <select id="fServiceCategory" class="form-select smart-input"></select>
            <div class="invalid-feedback d-block d-none" id="eServiceCategory">Required</div>
          </div>
          <div class="col-md-6">
            <label class="form-label small fw-bold text-muted">Service Type <span class="text-danger">*</span></label>
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
        <div class="dropdown">
          <button class="btn btn-outline-dark fw-bold dropdown-toggle" type="button" data-bs-toggle="dropdown" id="btnActions">
            Quick Actions
          </button>
          <ul class="dropdown-menu shadow-lg border-0">
            <li><button class="dropdown-item" id="btnMarkUnderReview">Mark UNDER_REVIEW</button></li>
            <li><button class="dropdown-item" id="btnNeedClarification">Request CLARIFICATION</button></li>
            <li><button class="dropdown-item" id="btnMarkQuoted">Mark QUOTED</button></li>
            <li><hr class="dropdown-divider"></li>
            <li><button class="dropdown-item text-danger" id="btnCloseNoAction">Close (No Action)</button></li>
          </ul>
        </div>
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

  <div id="toasts" class="toast-container position-fixed bottom-0 end-0 p-3"></div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

  <script>
/********************
 * CONFIG
 ********************/
const STATUS = ["RECEIVED","UNDER_REVIEW","CLARIFICATION_REQUIRED","QUOTED","CONVERTED_TO_OPPORTUNITY","CLOSED_NO_ACTION"];
const SERVICE_CATEGORIES = ["SEA","AIR","INLAND","WAREHOUSING","END_TO_END","BUSINESS_REPRESENTATION"];
const SERVICE_TYPES = ["FCL","LCL","AIR_STANDARD","AIR_EXPRESS","DOUALA_TO_YAOUNDE","HINTERLAND_TRANSIT","BONDED_STORAGE","NON_BONDED_STORAGE","END_TO_END_SEA","END_TO_END_AIR","REPRESENTATION"];
const WAREHOUSE_DURATIONS = ["< 7 DAYS","7–14 DAYS","15–30 DAYS","30+ DAYS","UNKNOWN"];

// NOTE: If you still want RBAC simulation UI, keep this block.
// If not needed, you can remove ROLE_ACCESS + roleSelect handlers cleanly.
const ROLE_ACCESS = {
  SALES: { canView: true, canEdit: true, canConvert: true },
  ADMIN: { canView: true, canEdit: true, canConvert: true },
  MANAGEMENT: { canView: true, canEdit: false, canConvert: false },
  FINANCE: { canView: false, canEdit: false, canConvert: false },
  OPERATIONS: { canView: false, canEdit: false, canConvert: false },
};

let state = {
  role: "MANAGEMENT",
  loading: false,
  simulateError: false,
  page: 1,
  pageSize: 10,
  total: 0,
  data: [],               // server-paged rows
  filters: { search: "", status: "", category: "", sort: "submission_datetime:desc" },
  modal: { activeId: null }
};

const drawerEl = document.getElementById("intakeDrawer");
const drawer = new bootstrap.Offcanvas(drawerEl);

/********************
 * UTILS
 ********************/
function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year:"numeric", month:"short", day:"2-digit", hour:"2-digit", minute:"2-digit"
    });
  } catch {
    return iso;
  }
}

function chipStatus(s) {
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
 * PROJECT CARGO UI
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
 * TABLE (DB)
 ********************/
async function loadTableFromDb() {
  state.loading = true;
  render();

  // If you want to support qSort on server later, pass it.
  const params = new URLSearchParams({
    q: state.filters.search || "",
    status: state.filters.status || "",
    category: state.filters.category || "",
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
      state.loading = false;
      render();
      return;
    }

    state.data = j.rows || [];
    state.total = Number(j.total || 0);
    // keep server page number if returned
    if (j.page) state.page = Number(j.page);
    if (j.pageSize) state.pageSize = Number(j.pageSize);
  } catch (e) {
    toast("Network / server error loading table", "danger");
    state.data = [];
    state.total = 0;
  } finally {
    state.loading = false;
    render();
  }
}

function render() {
  // RBAC gating (optional)
  const perm = ROLE_ACCESS[state.role] || { canView: false, canEdit: false, canConvert: false };
  const gate = document.getElementById("accessGate");
  const shell = document.getElementById("moduleShell");
  if (gate && shell) {
    gate.classList.toggle("d-none", perm.canView);
    shell.classList.toggle("d-none", !perm.canView);
  }

  // Populate Category Filter once
  const qCat = document.getElementById("qCategory");
  if (qCat && qCat.options.length <= 1) {
    SERVICE_CATEGORIES.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      qCat.appendChild(opt);
    });
  }

  // Loading / Error / Table show/hide
  const loadingEl = document.getElementById("stateLoading");
  const errEl = document.getElementById("stateError");
  if (loadingEl) loadingEl.classList.toggle("d-none", !state.loading);
  if (errEl) errEl.classList.toggle("d-none", !state.simulateError);

  const tableWrap = document.querySelector(".table-responsive");
  const tableHidden = state.loading || state.simulateError;
  if (tableWrap) tableWrap.classList.toggle("d-none", tableHidden);
  if (state.loading || state.simulateError) return;

  const emptyEl = document.getElementById("stateEmpty");
  if (emptyEl) emptyEl.classList.toggle("d-none", (state.total || 0) > 0);

  // KPIs: computed from current page data (server-wide KPIs require server support)
  const counts = STATUS.reduce((acc, s) => (acc[s] = 0, acc), {});
  state.data.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });

  const elTotal = document.getElementById("kpiTotal");
  const elReceived = document.getElementById("kpiReceived");
  const elReview = document.getElementById("kpiReview");
  const elQuoted = document.getElementById("kpiQuoted");
  const elConverted = document.getElementById("kpiConverted");

  if (elTotal) elTotal.textContent = String(state.total || 0);
  if (elReceived) elReceived.textContent = String(counts.RECEIVED || 0);
  if (elReview) elReview.textContent = String(counts.UNDER_REVIEW || 0);
  if (elQuoted) elQuoted.textContent = String(counts.QUOTED || 0);
  if (elConverted) elConverted.textContent = String(counts.CONVERTED_TO_OPPORTUNITY || 0);

  const meta = document.getElementById("tableMeta");
  if (meta) meta.textContent = `${state.total || 0} Records • Role: ${state.role}`;

  // Render rows (server-paged)
  const tbody = document.getElementById("tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  state.data.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="ps-4">
        <div class="fw-bold text-dark font-monospace">${r.public_quote_ref || "-"}</div>
        <div class="small text-muted">${r.intake_channel || "-"}</div>
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
        <div class="small text-muted">${r.warehouse_location ? "WH: " + r.warehouse_location : ""}</div>
      </td>
      <td class="small fw-bold">${r.estimated_weight ? Number(r.estimated_weight).toLocaleString() + " kg" : "-"}</td>
      <td>${chipStatus(r.status)}</td>
      <td class="small text-muted">${r.submission_datetime ? fmtDate(r.submission_datetime) : "-"}</td>
      
    `;
    tbody.appendChild(tr);
  });

  // Bind Manage
  document.querySelectorAll(".btnView").forEach(btn => {
    btn.addEventListener("click", () => openDrawerFromDb(btn.getAttribute("data-id")));
  });

  // Pagination meta/buttons (based on server total)
  const totalPages = Math.max(1, Math.ceil((state.total || 0) / state.pageSize));
  const pageMeta = document.getElementById("pageMeta");
  if (pageMeta) pageMeta.textContent = `Page ${state.page} of ${totalPages}`;

  const prev = document.getElementById("btnPrev");
  const next = document.getElementById("btnNext");
  if (prev) prev.disabled = state.page <= 1;
  if (next) next.disabled = state.page >= totalPages;
}

/********************
 * DRAWER (DB)
 ********************/
async function openDrawerFromDb(id) {
  const r = await fetch(`../../api/quote_requests/get.php?id=${encodeURIComponent(id)}`, { credentials: "same-origin" });
  const j = await r.json();
  if (!j.ok) return toast("Failed to load record", "danger");

  const rec = j.record;
  state.modal.activeId = rec.quote_request_id;

  // Populate dropdowns (ensure they contain options)
  const fStatus = document.getElementById("fStatus");
  if (fStatus) {
    fStatus.innerHTML = STATUS.map(s => `<option value="${s}">${s}</option>`).join("");
    fStatus.value = rec.status || "RECEIVED";
  }

  const fCat = document.getElementById("fServiceCategory");
  if (fCat) {
    fCat.innerHTML = `<option value="">Select...</option>` + SERVICE_CATEGORIES.map(x => `<option value="${x}">${x}</option>`).join("");
    fCat.value = rec.service_category || "";
  }

  const fType = document.getElementById("fServiceType");
  if (fType) {
    fType.innerHTML = `<option value="">Select...</option>` + SERVICE_TYPES.map(x => `<option value="${x}">${x}</option>`).join("");
    fType.value = rec.service_type || "";
  }

  const fWD = document.getElementById("fWarehouseDur");
  if (fWD) {
    fWD.innerHTML = WAREHOUSE_DURATIONS.map(x => `<option value="${x}">${x}</option>`).join("");
    fWD.value = rec.warehouse_duration || "UNKNOWN";
  }

  // Hydrate fields
  document.getElementById("fPublicRef").value = rec.public_quote_ref || "";
  document.getElementById("fRequesterName").value = rec.requester_name ?? "";
  document.getElementById("fRequesterCompany").value = rec.requester_company ?? "";
  document.getElementById("fRequesterEmail").value = rec.requester_email ?? "";
  document.getElementById("fRequesterPhone").value = rec.requester_phone ?? "";

  document.getElementById("fOrigin").value = rec.origin_location ?? "";
  document.getElementById("fDestination").value = rec.destination_location ?? "";
  document.getElementById("fWarehouseLoc").value = rec.warehouse_location ?? "";
  document.getElementById("fWeight").value = rec.estimated_weight ?? "";

  document.getElementById("fProjectCargo").checked = Number(rec.project_cargo_flag) === 1;
  document.getElementById("fCargoDesc").value = rec.cargo_description ?? "";
  document.getElementById("fNotes").value = rec.additional_notes ?? "";

  // Attachments from DB
  const chips = document.getElementById("attachmentsChips");
  if (chips) {
    chips.innerHTML = "";
    (j.attachments || []).forEach(a => {
      const el = document.createElement("span");
      el.className = "badge bg-light text-dark border p-2 fw-normal";
      el.textContent = a.original_name;
      chips.appendChild(el);
    });
  }

  // Reset file input preview
  const fAttachment = document.getElementById("fAttachment");
  if (fAttachment) fAttachment.value = "";

  // UI (project cargo)
  syncProjectCargoUI();

  // Title
  const title = document.getElementById("modalTitle");
  if (title) title.innerText = `Quote Request - ${rec.public_quote_ref || ""}`;

  // RBAC / lock state
  const perm = ROLE_ACCESS[state.role] || { canEdit: false, canConvert: false };
  const isConverted = (rec.status === "CONVERTED_TO_OPPORTUNITY");
  const canEdit = !!perm.canEdit && !isConverted;
  const canConvert = !!perm.canConvert && !isConverted && rec.status !== "CLOSED_NO_ACTION";

  const banner = document.getElementById("bannerReadOnly");
  if (banner) banner.classList.toggle("d-none", canEdit);

  setDisabled("#form input, #form select, #form textarea", !canEdit);
  const btnAddAttachment = document.getElementById("btnAddAttachment");
  const btnActions = document.getElementById("btnActions");
  if (btnAddAttachment) btnAddAttachment.disabled = !canEdit;
  if (btnActions) btnActions.disabled = !canEdit;

  const btnSave = document.getElementById("btnSave");
  const btnConvert = document.getElementById("btnConvert");
  if (btnSave) btnSave.disabled = !canEdit;
  if (btnConvert) btnConvert.disabled = !canConvert;

  drawer.show();
}

async function openNewDrawerOnly() {
  state.modal.activeId = null;

  // Clear form
  const form = document.getElementById("form");
  form?.reset?.();

  // Populate selects
  const fStatus = document.getElementById("fStatus");
  if (fStatus) {
    fStatus.innerHTML = STATUS.map(s => `<option value="${s}">${s}</option>`).join("");
    fStatus.value = "RECEIVED";
  }

  const fCat = document.getElementById("fServiceCategory");
  if (fCat) {
    fCat.innerHTML = `<option value="">Select...</option>` + SERVICE_CATEGORIES.map(x => `<option value="${x}">${x}</option>`).join("");
    fCat.value = "";
  }

  const fType = document.getElementById("fServiceType");
  if (fType) {
    fType.innerHTML = `<option value="">Select...</option>` + SERVICE_TYPES.map(x => `<option value="${x}">${x}</option>`).join("");
    fType.value = "";
  }

  const fWD = document.getElementById("fWarehouseDur");
  if (fWD) {
    fWD.innerHTML = WAREHOUSE_DURATIONS.map(x => `<option value="${x}">${x}</option>`).join("");
    fWD.value = "UNKNOWN";
  }

  // Fetch next public ref from DB
  const r = await fetch("../../api/quote_requests/next_public_ref.php", { credentials: "same-origin" });
  const j = await r.json();
  if (!j.ok) return toast("Failed to get Public Ref", "danger");

  document.getElementById("fPublicRef").value = j.public_quote_ref;

  // Clear attachments UI + input
  const chips = document.getElementById("attachmentsChips");
  if (chips) chips.innerHTML = "";
  const fAttachment = document.getElementById("fAttachment");
  if (fAttachment) fAttachment.value = "";

  // Default project cargo off
  const flag = document.getElementById("fProjectCargo");
  if (flag) flag.checked = false;
  syncProjectCargoUI();

  // Title
  const title = document.getElementById("modalTitle");
  if (title) title.innerText = `Quote Request - ${j.public_quote_ref}`;

  // Ensure editing enabled (create mode uses RBAC)
  const perm = ROLE_ACCESS[state.role] || { canEdit: false, canConvert: false };
  const canEdit = !!perm.canEdit;

  const banner = document.getElementById("bannerReadOnly");
  if (banner) banner.classList.toggle("d-none", canEdit);

  setDisabled("#form input, #form select, #form textarea", !canEdit);
  const btnAddAttachment = document.getElementById("btnAddAttachment");
  const btnActions = document.getElementById("btnActions");
  if (btnAddAttachment) btnAddAttachment.disabled = !canEdit;
  if (btnActions) btnActions.disabled = !canEdit;

  const btnSave = document.getElementById("btnSave");
  const btnConvert = document.getElementById("btnConvert");
  if (btnSave) btnSave.disabled = !canEdit;
  if (btnConvert) btnConvert.disabled = true; // cannot convert until saved

  drawer.show();
}

/********************
 * SAVE (DB) + OPTIONAL UPLOAD
 ********************/
async function saveRecordToDb() {
  const perm = ROLE_ACCESS[state.role] || { canEdit: false };
  if (!perm.canEdit) return toast("Read-only role", "danger");

  const isProject = document.getElementById("fProjectCargo").checked;
  if (isProject && !document.getElementById("fCargoDesc").value.trim()) {
    return toast("Description is required when Project Cargo is ON", "danger");
  }

  const fd = new FormData();
  if (state.modal.activeId) fd.append("quote_request_id", state.modal.activeId);

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
  fd.append("project_cargo_flag", document.getElementById("fProjectCargo").checked ? "1" : "0");
  fd.append("cargo_description", document.getElementById("fCargoDesc").value);
  fd.append("additional_notes", document.getElementById("fNotes").value);

  const file = document.getElementById("fAttachment")?.files?.[0];
  if (file) fd.append("attachment", file);

  let resp;
  let rawText = "";
  try {
    resp = await fetch("../../api/quote_requests/save.php", {
      method: "POST",
      body: fd,
      credentials: "same-origin",
    });

    // Always read text first so we can show it if JSON parse fails
    rawText = await resp.text();

    // Try to parse JSON
    let j;
    try {
      j = JSON.parse(rawText);
    } catch {
      // Non-JSON response: usually PHP fatal error or HTML 404 page
      console.error("save.php non-JSON response:", rawText);
      return toast(`Save failed (${resp.status}). Server returned non-JSON. Check console.`, "danger");
    }

    if (!resp.ok || !j.ok) {
      console.error("save.php error payload:", j, "HTTP:", resp.status, rawText);
      return toast(j.error || `Save failed (${resp.status})`, "danger");
    }

    // Success
    state.modal.activeId = j.quote_request_id;
    document.getElementById("fAttachment").value = "";
    toast("Saved", "success");
    await loadTableFromDb();
    await openDrawerFromDb(state.modal.activeId);

  } catch (e) {
    console.error("save.php fetch failed:", e, "rawText:", rawText);
    toast("Network error calling save.php (see console + Network tab)", "danger");
  }
}


/********************
 * QUICK STATUS UPDATE (DB)
 ********************/
async function quickStatusUpdate(status) {
  if (!state.modal.activeId) return toast("No record selected", "warning");

  try {
    const r = await fetch("../../api/quote_requests/update_status.php", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quote_request_id: state.modal.activeId, status })
    });
    const j = await r.json();
    if (!j.ok) return toast("Status update failed", "danger");
  } catch {
    return toast("Network / server error updating status", "danger");
  }

  toast("Status updated", "success");
  await loadTableFromDb();
  await openDrawerFromDb(state.modal.activeId);
}

/********************
 * CONVERT (DB)
 ********************/
async function convertToOpp() {
  if (!state.modal.activeId) return toast("Save first before converting", "warning");

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
    toast("Network / server error converting record", "danger");
  }
}

/********************
 * CSV EXPORT
 * NOTE: Exports current loaded page only.
 * For full export, implement server-side export endpoint.
 ********************/
function exportToCSV() {
  if (!state.data.length) return toast("No data to export", "warning");

  const headers = ["Public Ref","Requester","Company","Email","Phone","Category","Type","Origin","Destination","Status","Submitted"];
  const rows = state.data.map(r => [
    r.public_quote_ref || "",
    `"${String(r.requester_name || "").replace(/"/g,'""')}"`,
    `"${String(r.requester_company || "").replace(/"/g,'""')}"`,
    r.requester_email || "",
    `"${String(r.requester_phone || "").replace(/"/g,'""')}"`,
    r.service_category || "",
    r.service_type || "",
    `"${String(r.origin_location || "").replace(/"/g,'""')}"`,
    `"${String(r.destination_location || "").replace(/"/g,'""')}"`,
    r.status || "",
    r.submission_datetime || ""
  ]);

  const csvContent = [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Smart_Quote_Export_${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
  toast("CSV Export Downloaded", "success");
}

/********************
 * ATTACHMENT UI (preview only)
 ********************/
function bindAttachmentPreview() {
  const fAttachment = document.getElementById("fAttachment");
  const chips = document.getElementById("attachmentsChips");
  if (!fAttachment || !chips) return;

  fAttachment.addEventListener("change", () => {
    const f = fAttachment.files?.[0];
    if (!f) return;

    // show a temporary "selected" chip (will be replaced by DB chips after save+reload)
    const el = document.createElement("span");
    el.className = "badge bg-light text-dark border p-2 fw-normal";
    el.textContent = f.name;
    chips.prepend(el);
  });
}

/********************
 * EVENT BINDINGS
 ********************/
(function init() {
  // RBAC simulation dropdown (optional)
  const roleSelect = document.getElementById("roleSelect");
  if (roleSelect) {
    roleSelect.onchange = async (e) => {
      state.role = e.target.value;
      // refresh UI + table (table data is not role-filtered server-side)
      render();
      await loadTableFromDb();
    };
  }

  // New / Export / Save / Convert
  const btnNew = document.getElementById("btnNew");
  const btnExport = document.getElementById("btnExport");
  const btnSave = document.getElementById("btnSave");
  const btnConvert = document.getElementById("btnConvert");
  if (btnNew) btnNew.onclick = openNewDrawerOnly;
  if (btnExport) btnExport.onclick = exportToCSV;
  if (btnSave) btnSave.onclick = saveRecordToDb;
  if (btnConvert) btnConvert.onclick = convertToOpp;

  // Quick Actions
  const btnMarkUnderReview = document.getElementById("btnMarkUnderReview");
  const btnNeedClarification = document.getElementById("btnNeedClarification");
  const btnMarkQuoted = document.getElementById("btnMarkQuoted");
  const btnCloseNoAction = document.getElementById("btnCloseNoAction");
  if (btnMarkUnderReview) btnMarkUnderReview.onclick = () => quickStatusUpdate("UNDER_REVIEW");
  if (btnNeedClarification) btnNeedClarification.onclick = () => quickStatusUpdate("CLARIFICATION_REQUIRED");
  if (btnMarkQuoted) btnMarkQuoted.onclick = () => quickStatusUpdate("QUOTED");
  if (btnCloseNoAction) btnCloseNoAction.onclick = () => quickStatusUpdate("CLOSED_NO_ACTION");

  // Cancel Convert warning panel (if still present)
  const btnCancelConvert = document.getElementById("btnCancelConvert");
  if (btnCancelConvert) btnCancelConvert.onclick = () => document.getElementById("convertWarning")?.classList.add("d-none");

  // Attachment button -> open file dialog
  const btnAddAttachment = document.getElementById("btnAddAttachment");
  if (btnAddAttachment) btnAddAttachment.onclick = () => document.getElementById("fAttachment")?.click();

  // Project cargo toggle
  const fProjectCargo = document.getElementById("fProjectCargo");
  if (fProjectCargo) fProjectCargo.addEventListener("change", syncProjectCargoUI);

  // Filters -> DB
  const qSearch = document.getElementById("qSearch");
  const qStatus = document.getElementById("qStatus");
  const qCategory = document.getElementById("qCategory");
  const qSort = document.getElementById("qSort");

  if (qSearch) qSearch.onkeyup = async (e) => { state.filters.search = e.target.value; state.page = 1; await loadTableFromDb(); };
  if (qStatus) qStatus.onchange = async (e) => { state.filters.status = e.target.value; state.page = 1; await loadTableFromDb(); };
  if (qCategory) qCategory.onchange = async (e) => { state.filters.category = e.target.value; state.page = 1; await loadTableFromDb(); };
  if (qSort) qSort.onchange = async (e) => { state.filters.sort = e.target.value; state.page = 1; await loadTableFromDb(); };

  const btnReset = document.getElementById("btnReset");
  if (btnReset) btnReset.onclick = async () => {
    if (qSearch) qSearch.value = "";
    if (qStatus) qStatus.value = "";
    if (qCategory) qCategory.value = "";
    if (qSort) qSort.value = "submission_datetime:desc";
    state.filters = { search: "", status: "", category: "", sort: "submission_datetime:desc" };
    state.page = 1;
    await loadTableFromDb();
  };

  // Pagination -> DB
  const btnPrev = document.getElementById("btnPrev");
  const btnNext = document.getElementById("btnNext");
  const pageSize = document.getElementById("pageSize");

  if (btnPrev) btnPrev.onclick = async () => { if (state.page > 1) { state.page--; await loadTableFromDb(); } };
  if (btnNext) btnNext.onclick = async () => { state.page++; await loadTableFromDb(); };
  if (pageSize) pageSize.onchange = async (e) => { state.pageSize = Number(e.target.value); state.page = 1; await loadTableFromDb(); };

  // Retry (optional simulated error UI)
  const btnRetry = document.getElementById("btnRetry");
  if (btnRetry) btnRetry.onclick = async () => { state.simulateError = false; await loadTableFromDb(); };

  // Attachment preview
  bindAttachmentPreview();

  // Ensure cargo UI is consistent
  syncProjectCargoUI();

  // Initial load
  loadTableFromDb();
})();
</script>

</body>
</html>






