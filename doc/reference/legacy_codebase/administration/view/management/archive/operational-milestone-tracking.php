<?php
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN','OPERATIONS','MANAGEMENT','SALES']); // FINANCE handled by UI overlay below (no access)

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

// --- Safe display values ---
$fullName  = (string)($me['full_name'] ?? 'User');
$fullName  = $fullName !== '' ? $fullName : 'User';
$firstName = trim(explode(' ', $fullName)[0] ?? 'User');

$roleLabelMap = [
  'ADMIN'      => 'SYSTEM ADMIN',
  'FINANCE'    => 'FINANCE',
  'SALES'      => 'SALES',
  'OPERATIONS' => 'OPERATIONS',
  'MANAGEMENT' => 'MANAGEMENT',
];
$role = strtoupper((string)($me['role'] ?? 'OPERATIONS'));
$roleLabel = $roleLabelMap[$role] ?? $role;

$avatarName = urlencode($fullName);
$avatarUrl  = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Operational Milestone Tracking | Smart LS</title>

  <!-- Bootstrap 5 -->
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet" />
  <!-- Admin base UI -->
  <link rel="stylesheet" href="../../css/admin.css">
  <!-- Font Awesome -->
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
  <!-- Fonts -->
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

  <style>
    :root{
      --smart-blue:#1F99D8;
      --smart-dark:#055B83;
      --smart-orange:#EE7D04;
      --smart-charcoal:#231F20;
      --smart-bg:#F0F4F8;
      --sidebar-width:280px;
    }

    body{
      font-family:'Manrope',sans-serif;
      background:var(--smart-bg);
      color:var(--smart-charcoal);
      overflow-x:hidden;
    }
    h1,h2,h3,h4,h5,h6,.font-heading{ font-family:'Montserrat',sans-serif; }

    /* Page components (KEEP) */
    .card-custom{
      background:#fff;
      border-radius:12px;
      border:1px solid rgba(0,0,0,0.05);
      box-shadow:0 2px 12px rgba(0,0,0,0.02);
      height:100%;
      transition:transform .2s;
    }
    .card-custom:hover{ transform:translateY(-2px); box-shadow:0 5px 20px rgba(0,0,0,0.05); }

    .kpi-title{
      font-size:.7rem; font-weight:700;
      text-transform:uppercase;
      color:#888;
      letter-spacing:.5px;
      white-space:nowrap;
    }
    .kpi-value{
      font-size:1.6rem; font-weight:800;
      color:var(--smart-charcoal);
      line-height:1.2;
      font-variant-numeric:tabular-nums;
    }

    .table-custom th{
      font-size:.75rem;
      text-transform:uppercase;
      color:#888;
      font-weight:700;
      border-bottom:2px solid #f0f0f0;
      background:#f9fafb;
      padding:12px 16px;
      white-space:nowrap;
    }
    .table-custom td{
      font-size:.85rem;
      vertical-align:middle;
      padding:12px 16px;
    }

    .smart-input{
      border-radius:8px;
      font-size:.9rem;
      padding:.6rem .8rem;
      border:1px solid #e0e0e0;
    }
    .smart-input:focus{
      border-color:var(--smart-blue);
      box-shadow:0 0 0 3px rgba(31,153,216,.12);
      outline:none;
    }

    .tag-pill{
      font-size:.65rem;
      font-weight:800;
      text-transform:uppercase;
      letter-spacing:.4px;
      padding:4px 8px;
      border-radius:999px;
      border:1px solid transparent;
      display:inline-flex;
      align-items:center;
      gap:6px;
      white-space:nowrap;
    }
    .tag-service{ background:#e0f2fe; color:#0369a1; border-color:#bae6fd; }
    .tag-route{ background:#f1f5f9; color:#475569; border-color:#e2e8f0; }
    .tag-risk{ background:#fee2e2; color:#991b1b; border-color:#fecaca; }
    .tag-ok{ background:#dcfce7; color:#166534; border-color:#bbf7d0; }
    .tag-due{ background:#fff7ed; color:#9a3412; border-color:#fed7aa; }
    .tag-closed{ background:#f3e8ff; color:#6b21a8; border-color:#e9d5ff; }

    /* Drawer */
    .drawer{ transform:translateX(100%); transition:transform .4s cubic-bezier(0.16,1,0.3,1); }
    .drawer.open{ transform:translateX(0); }

    .timeline-line{
      position:absolute;
      left:24px;
      top:10px;
      bottom:10px;
      width:2px;
      background:#E5E7EB;
      z-index:0;
    }
    .timeline-item{ position:relative; z-index:1; padding-bottom:1.25rem; }
    .timeline-dot{
      width:50px; height:50px;
      border-radius:50%;
      display:flex; align-items:center; justify-content:center;
      background:#fff;
      border:2px solid #E5E7EB;
      transition:all .3s;
      flex-shrink:0;
    }
    .timeline-dot.completed{ background:#22c55e; border-color:#22c55e; color:#fff; }
    .timeline-dot.active{ background:var(--smart-blue); border-color:var(--smart-blue); color:#fff; box-shadow:0 0 0 4px rgba(31,153,216,.2); }
    .timeline-dot.pending{ color:#9CA3AF; }

    /* Access Denied Overlay */
    #access-denied-overlay{
      position:fixed;
      inset:0;
      z-index:2000;
      background:rgba(255,255,255,.88);
      backdrop-filter:blur(10px);
      display:none;
      align-items:center;
      justify-content:center;
      text-align:center;
      padding:24px;
    }
  </style>
</head>

<body>

  <!-- FINANCE ACCESS BLOCK -->
  <div id="access-denied-overlay">
    <div class="card-custom p-4 p-md-5" style="max-width:680px;">
      <div class="mx-auto mb-3 d-flex align-items-center justify-content-center rounded-circle"
           style="width:76px;height:76px;background:#fee2e2;color:#991b1b;font-size:32px;">
        <i class="fa-solid fa-ban"></i>
      </div>
      <h2 class="font-heading fw-black mb-2" style="font-weight:900;">Restricted Access</h2>
      <p class="text-muted mb-4">
        Per <strong>ISO-9001 Segregation of Duties</strong> (Section 5.7.4), the
        <span class="fw-bold">FINANCE</span> role cannot access Operational Milestone Tracking.
      </p>
      <a class="btn btn-dark fw-bold w-100" href="index.php">Go to Dashboard</a>
    </div>
  </div>

  <!-- SIDEBAR (FROM index.php) -->
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
                    <a href="supplier-master-registry" class="sub-link">Supplier Master Registry</a>
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
            <div id="admin2" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
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

  <!-- TOP NAVBAR (FROM index.php) -->
  <div class="top-navbar">
    <div>
      <h5 class="mb-0 fw-bold text-dark">Operational Milestone Tracking</h5>
      <small class="text-muted" style="font-size: 0.7rem;">FEED THE SMART TRACKk</small>
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

  <!-- MAIN CONTENT -->
  <main class="main-content px-4 pb-5">
    <div class="container-fluid px-0 px-md-2 py-4">

      <!-- KPI CARDS -->
      <div class="row g-3 mb-3">
        <div class="col-12 col-sm-6 col-lg-3">
          <div class="card-custom p-3">
            <div class="d-flex justify-content-between align-items-start">
              <div>
                <div class="kpi-title">Total Active Files</div>
                <div class="kpi-value" id="kpi-total">0</div>
              </div>
              <div class="rounded-circle d-flex align-items-center justify-content-center"
                   style="width:42px;height:42px;background:#e0f2fe;color:#0369a1;">
                <i class="fa-solid fa-folder-tree"></i>
              </div>
            </div>
            <small class="text-muted">In progress (not closed)</small>
          </div>
        </div>

        <div class="col-12 col-sm-6 col-lg-3">
          <div class="card-custom p-3">
            <div class="d-flex justify-content-between align-items-start">
              <div>
                <div class="kpi-title">At Risk</div>
                <div class="kpi-value" id="kpi-risk">0</div>
              </div>
              <div class="rounded-circle d-flex align-items-center justify-content-center"
                   style="width:42px;height:42px;background:#fee2e2;color:#991b1b;">
                <i class="fa-solid fa-triangle-exclamation"></i>
              </div>
            </div>
            <small class="text-muted">Flagged delay risk</small>
          </div>
        </div>

        <div class="col-12 col-sm-6 col-lg-3">
          <div class="card-custom p-3">
            <div class="d-flex justify-content-between align-items-start">
              <div>
                <div class="kpi-title">Due Today</div>
                <div class="kpi-value" id="kpi-due">0</div>
              </div>
              <div class="rounded-circle d-flex align-items-center justify-content-center"
                   style="width:42px;height:42px;background:#fff7ed;color:#9a3412;">
                <i class="fa-solid fa-calendar-day"></i>
              </div>
            </div>
            <small class="text-muted">Next milestone due today</small>
          </div>
        </div>

        <div class="col-12 col-sm-6 col-lg-3">
          <div class="card-custom p-3">
            <div class="d-flex justify-content-between align-items-start">
              <div>
                <div class="kpi-title">Completed</div>
                <div class="kpi-value" id="kpi-closed">0</div>
              </div>
              <div class="rounded-circle d-flex align-items-center justify-content-center"
                   style="width:42px;height:42px;background:#f3e8ff;color:#6b21a8;">
                <i class="fa-solid fa-circle-check"></i>
              </div>
            </div>
            <small class="text-muted">Closed files</small>
          </div>
        </div>
      </div>

      <!-- FILTERS -->
      <div class="card-custom p-3 mb-3">
        <div class="row g-2 align-items-end">
          <div class="col-12 col-md-4">
            <label class="form-label small fw-bold text-muted mb-1">Search</label>
            <div class="input-group">
              <span class="input-group-text bg-white border-end-0"><i class="fa-solid fa-magnifying-glass text-muted"></i></span>
              <input type="text" id="search-input" class="form-control smart-input border-start-0"
                     placeholder="Search file ref or client..." />
            </div>
          </div>

          <div class="col-12 col-md-3">
            <label class="form-label small fw-bold text-muted mb-1">Service Type</label>
            <!-- IMPORTANT: value MUST be the enum keys coming from DB -->
            <select id="filter-type" class="form-select smart-input">
              <option value="">All</option>
              <option value="SEA_FREIGHT_IMPORT">SEA FREIGHT IMPORT</option>
              <option value="SEA_FREIGHT_EXPORT">SEA FREIGHT EXPORT</option>
              <option value="HINTERLAND_TRANSIT">HINTERLAND TRANSIT</option>
              <option value="AIR_FREIGHT_IMPORT">AIR FREIGHT IMPORT</option>
              <option value="AIR_FREIGHT_EXPORT">AIR FREIGHT EXPORT</option>
            </select>
          </div>

          <div class="col-12 col-md-3">
            <label class="form-label small fw-bold text-muted mb-1">Route</label>
            <select id="filter-route" class="form-select smart-input">
              <option value="">All</option>
            </select>
          </div>

          <div class="col-12 col-md-2">
            <label class="form-label small fw-bold text-muted mb-1">Status</label>
            <select id="filter-status" class="form-select smart-input">
              <option value="">All</option>
              <option value="OK">OK</option>
              <option value="DUE">DUE</option>
              <option value="RISK">RISK</option>
              <option value="CLOSED">CLOSED</option>
            </select>
          </div>
        </div>
      </div>

      <!-- TABLE -->
      <div class="card-custom overflow-hidden">
        <div class="table-responsive">
          <table class="table mb-0 table-custom">
            <thead>
              <tr>
                <th style="min-width:160px;">File Reference</th>
                <th style="min-width:200px;">Client</th>
                <th style="min-width:180px;">Service Type</th>
                <th style="min-width:120px;">Route</th>
                <th style="min-width:220px;">Current Stage</th>
                <th style="min-width:120px;">Status</th>
                <th class="text-end" style="min-width:120px;">Action</th>
              </tr>
            </thead>
            <tbody id="files-table-body"></tbody>
          </table>
        </div>
      </div>

    </div>
  </main>

  <!-- DRAWER OVERLAY -->
  <div id="drawer-overlay" class="position-fixed top-0 start-0 w-100 h-100"
       style="z-index:1200; background:rgba(15,23,42,.18); backdrop-filter: blur(6px); display:none;"
       onclick="closeDrawer()"></div>

  <!-- TRACK DRAWER -->
  <div id="track-drawer" class="position-fixed top-0 end-0 h-100 bg-white shadow-lg drawer"
       style="z-index:1300; width:100%; max-width:900px; display:flex; flex-direction:column;">
    <div class="px-4 px-md-5 py-4 border-bottom d-flex justify-content-between align-items-center" style="background:#f9fafb;">
      <div>
        <h4 class="mb-0 fw-black font-heading" id="drawer-ref">SLAS-REF-XXXX</h4>
        <small class="text-muted" id="drawer-client">Client Name</small>
      </div>
      <button class="btn btn-light border" type="button" onclick="closeDrawer()">
        <i class="fa-solid fa-xmark text-muted"></i>
      </button>
    </div>

    <div class="flex-grow d-flex overflow-hidden">
      <!-- Timeline -->
      <div class="w-50 border-end p-4 p-md-5 overflow-auto bg-white position-relative">
        <div class="d-flex align-items-center justify-content-between mb-3">
          <div>
            <div class="text-muted fw-bold small" style="letter-spacing:.12em;">PROGRESS TIMELINE</div>
            <div class="small text-muted">Select the active stage to update (Operations/Admin only).</div>
          </div>
        </div>
        <div class="position-relative ps-1" id="timeline-container"></div>
      </div>

      <!-- Update form -->
      <div class="w-50 p-4 p-md-5 overflow-auto" style="background:#f9fafb; position:relative;">
        <div id="read-only-msg" class="d-none position-absolute top-0 start-0 w-100 h-100 d-flex flex-column align-items-center justify-content-center text-center px-4"
             style="background:rgba(249,250,251,.92); backdrop-filter: blur(6px); z-index:5;">
          <div class="rounded-circle d-flex align-items-center justify-content-center mb-2"
               style="width:64px;height:64px;background:#e2e8f0;color:#64748b;font-size:22px;">
            <i class="fa-solid fa-eye"></i>
          </div>
          <h5 class="fw-bold text-muted mb-1">Read Only View</h5>
          <p class="small text-muted mb-0">Your role permits viewing status but not executing operational milestones.</p>
        </div>

        <div id="update-form-container" class="d-none">
          <h5 class="fw-bold mb-3">Update Milestone</h5>

          <div class="card-custom p-3 p-md-4">
            <div class="mb-3">
              <div class="small fw-bold text-muted text-uppercase" style="letter-spacing:.08em;">Selected Stage</div>
              <div class="fw-black" style="color:var(--smart-blue); font-size:1.15rem;" id="selected-stage-name">Loading</div>
            </div>

            <form onsubmit="event.preventDefault(); saveMilestone();">
              <div class="row g-2 mb-3">
                <div class="col-6">
                  <label class="form-label small fw-bold mb-1">Date</label>
                  <input type="date" id="inp-date" class="form-control smart-input" />
                </div>
                <div class="col-6">
                  <label class="form-label small fw-bold mb-1">Time</label>
                  <input type="time" id="inp-time" class="form-control smart-input" />
                </div>
              </div>

              <div class="mb-2">
                <label class="form-label small fw-bold text-muted">Location</label>
                <input id="inp-location" type="text" class="form-control smart-input" placeholder="e.g., Douala Port" />
              </div>

              <div class="mb-2">
                <label class="form-label small fw-bold text-muted">Reference Number</label>
                <input id="inp-reference" type="text" class="form-control smart-input" placeholder="e.g., BL/MAWB/Entry No." />
              </div>

              <div class="mb-2">
                <label class="form-label small fw-bold text-muted">Notes</label>
                <textarea id="inp-notes" class="form-control smart-input" rows="3"></textarea>
              </div>

              <div class="mb-2">
                <label class="form-label small fw-bold text-muted">Completed At</label>
                <input id="inp-completed-at" type="datetime-local" class="form-control smart-input" />
              </div>

              <button type="button" class="btn btn-primary fw-bold" onclick="saveMilestone()">
                <i class="fa-solid fa-check me-2"></i>Mark Completed
              </button>
            </form>
          </div>
        </div>

        <div id="empty-state" class="d-flex flex-column align-items-center justify-content-center text-center opacity-75" style="height:100%;">
          <div class="rounded-circle d-flex align-items-center justify-content-center mb-2"
               style="width:72px;height:72px;background:#eef2ff;color:#6366f1;font-size:26px;">
            <i class="fa-solid fa-hand-pointer"></i>
          </div>
          <div class="fw-bold text-muted">Select the active stage to update.</div>
          <small class="text-muted">Timeline is on the left panel.</small>
        </div>

      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

  <script>
    // Guard: if admin.js doesn't define toggleClock, prevent crash.
    if (typeof toggleClock !== 'function') {
      function toggleClock(){ /* noop */ }
    }

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

    // =========================
    // ENUMS + STAGE TEMPLATES
    // =========================
    const stageTemplates = {
      'SEA_FREIGHT_IMPORT': ["Pre-Alert / Work Order","Docs Review","Import Declaration Lodged","Cargo Discharge","Customs Clearance","Duties Paid","Carrier Release","Port Release","Loading on Truck","Inland Transport","Offloading","Empty Return","Final Invoice","Closed"],
      'SEA_FREIGHT_EXPORT': ["Booking Request","Docs Check","Export Formalities","Booking Confirmed","Stuffing","Customs Inspection","Transfer to Port","Boarding Auth","Port Release","Loading on Vessel","Freight Paid","OBL Release","Final Invoice","Closed"],
      'HINTERLAND_TRANSIT': ["Transport Order","Transit Docs","Transit Declaration (CM)","Carrier Release","Loading on Truck","Sealing","Inland Leg 1","Border Crossing","Inland Leg 2","Arrival Dest","Clearance Dest","Delivery","Final Invoice","Closed"],
      'AIR_FREIGHT_IMPORT': ["Pre-Alert","Docs Review","Arrival Notice","Arrival Dest","Discharge","Import Decl.","Customs Insp.","Duties Paid","Customs Release","Cargo Release","Dispatch","Delivery","Final Invoice","Closed"],
      'AIR_FREIGHT_EXPORT': ["Booking","Docs Check","Export Formalities","Cargo Handover","Security Screening","Airline Acceptance","Departure","Arrival","Customs","Release","Dispatch","Delivery","Final Invoice","Closed"]
    };

    const SERVICE_LABEL = {
      SEA_FREIGHT_IMPORT: 'SEA FREIGHT IMPORT',
      SEA_FREIGHT_EXPORT: 'SEA FREIGHT EXPORT',
      AIR_FREIGHT_IMPORT: 'AIR FREIGHT IMPORT',
      AIR_FREIGHT_EXPORT: 'AIR FREIGHT EXPORT',
      HINTERLAND_TRANSIT: 'HINTERLAND TRANSIT',
      INLAND_TRANSPORTATION: 'INLAND TRANSPORTATION',
      WAREHOUSING: 'WAREHOUSING',
      END_TO_END_AIR_FREIGHT: 'END TO END AIR FREIGHT',
      END_TO_END_SEA_FREIGHT: 'END TO END SEA FREIGHT',
      BUSINESS_REPRESENTATION: 'BUSINESS REPRESENTATION'
    };

    // =========================
    // SESSION ROLE
    // =========================
    const currentRole = <?php echo json_encode($role, JSON_UNESCAPED_SLASHES); ?>;

    if (currentRole === 'FINANCE') {
      const ov = document.getElementById('access-denied-overlay');
      if (ov) ov.style.display = 'flex';
    }

    // =========================
    // API (DB BACKED)
    // =========================
    const API_BASE = '../../api/operations_milestones';

    async function apiGet(path) {
      const res = await fetch(`${API_BASE}/${path}`, { credentials: 'same-origin' });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); }
      catch { throw new Error(`Non-JSON response: ${text.slice(0, 200)}`); }
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      return json.data;
    }

    async function apiPost(path, obj) {
      const body = new URLSearchParams();
      Object.entries(obj || {}).forEach(([k, v]) => {
        if (v === undefined || v === null) return;
        body.append(k, String(v));
      });

      const res = await fetch(`${API_BASE}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body,
        credentials: 'same-origin'
      });

      const text = await res.text();
      let json;
      try { json = JSON.parse(text); }
      catch { throw new Error(`Non-JSON response: ${text.slice(0, 200)}`); }
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      return json.data;
    }

    // =========================
    // STATE
    // =========================
    let files = [];
    let currentFile = null;
    let currentManage = null;
    let selectedStageIdx = -1;

    // =========================
    // UI HELPERS
    // =========================
    function statusPillFromComputed(computedStatus){
      if (computedStatus === 'CLOSED') return `<span class="tag-pill tag-closed"><i class="fa-solid fa-circle-check"></i> Closed</span>`;
      if (computedStatus === 'DELAYED') return `<span class="tag-pill tag-risk"><i class="fa-solid fa-triangle-exclamation"></i> Delayed</span>`;
      if (computedStatus === 'RISK') return `<span class="tag-pill tag-risk"><i class="fa-solid fa-triangle-exclamation"></i> Risk</span>`;
      if (computedStatus === 'DUE') return `<span class="tag-pill tag-due"><i class="fa-solid fa-calendar-day"></i> Due</span>`;
      return `<span class="tag-pill tag-ok"><i class="fa-solid fa-check"></i> OK</span>`;
    }

    function canEditMilestones(){
      return (currentRole === 'OPERATIONS' || currentRole === 'ADMIN' || currentRole === 'MANAGEMENT');
    }

    function toLocalDateValue(dateStr){
      if (!dateStr) return '';
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return '';
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth()+1).padStart(2,'0');
      const dd = String(d.getDate()).padStart(2,'0');
      return `${yyyy}-${mm}-${dd}`;
    }

    function toMysqlDatetimeFromDateAndTime(dateVal, timeVal){
      if (!dateVal) return '';
      const t = timeVal || '00:00';
      return `${dateVal} ${t}:00`;
    }

    function readCompletedAtFromInputs(){
      const dtLocal = document.getElementById('inp-completed-at');
      if (dtLocal && dtLocal.value) return dtLocal.value.replace('T', ' ') + ':00';

      const d = document.getElementById('inp-date');
      const t = document.getElementById('inp-time');
      return toMysqlDatetimeFromDateAndTime(d?.value || '', t?.value || '');
    }

    function escapeHtml(s){
      return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
    }

    function populateRouteFilter(list){
      const sel = document.getElementById('filter-route');
      if (!sel) return;

      const current = sel.value;
      const routes = Array.from(new Set((list || []).map(f => f.route).filter(r => r && r !== '—'))).sort();

      sel.innerHTML = `<option value="">All</option>` + routes.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');
      sel.value = routes.includes(current) ? current : '';
    }

    // =========================
    // KPI (DB)
    // =========================
    async function refreshKpis(){
      const k = await apiGet('kpis.php');
      document.getElementById('kpi-total').innerText  = k.total_active ?? 0;
      document.getElementById('kpi-risk').innerText   = k.at_risk ?? 0;
      document.getElementById('kpi-due').innerText    = k.due_today ?? 0;
      document.getElementById('kpi-closed').innerText = k.completed ?? 0;
    }

    // =========================
    // LIST TABLE (DB)
    // =========================
    async function refreshFiles(){
      const rows = await apiGet('list.php');

      files = (rows || []).map(r => {
        const serviceType = r.service_type;
        const ref = r.operations_file_reference;
        const client = r.client_name || r.client_id || '—';

        // REQUIRE backend to supply route_label; else falls back to —
        const route = (r.route_label && String(r.route_label).trim() !== '') ? String(r.route_label) : '—';

        return {
          ref,
          client,
          type: serviceType,
          route,
          stageIdx: Number(r.current_stage_index || 0),
          computed_status: r.computed_status || 'OK',
          current_stage_name: r.current_stage_name || '',
          current_stage_due_at: r.current_stage_due_at || null,
          operations_status: r.operations_status || ''
        };
      });

      populateRouteFilter(files);
      renderFiles();
    }

    function renderFiles(){
      const tbody = document.getElementById('files-table-body');

      const search = (document.getElementById('search-input')?.value || '').toLowerCase().trim();
      const type   = document.getElementById('filter-type')?.value || '';
      const route  = document.getElementById('filter-route')?.value || '';
      const status = document.getElementById('filter-status')?.value || '';

      const filtered = files.filter(f => {
        const matchSearch = !search || f.ref.toLowerCase().includes(search) || f.client.toLowerCase().includes(search);
        const matchType   = !type || f.type === type;
        const matchRoute  = !route || f.route === route;

        let matchStatus = true;
        if (status === 'CLOSED') matchStatus = (f.computed_status === 'CLOSED' || f.operations_status === 'CLOSED');
        if (status === 'RISK')   matchStatus = (f.computed_status === 'RISK' || f.computed_status === 'DELAYED');
        if (status === 'DUE')    matchStatus = (f.computed_status === 'DUE');
        if (status === 'OK')     matchStatus = (f.computed_status === 'OK');

        return matchSearch && matchType && matchRoute && matchStatus;
      });

      tbody.innerHTML = filtered.map((f) => {
        const stageName = f.current_stage_name || (stageTemplates[f.type]?.[f.stageIdx] || "Unknown");

        const canEdit = canEditMilestones();
        const btnText = canEdit ? 'Manage' : 'View';
        const btnClass = canEdit
          ? 'btn btn-sm fw-bold border-primary text-primary'
          : 'btn btn-sm fw-bold border-secondary text-secondary';

        return `
          <tr class="align-middle">
            <td class="fw-bold" style="font-family: monospace;">${escapeHtml(f.ref)}</td>
            <td class="fw-bold text-dark">${escapeHtml(f.client)}</td>
            <td><span class="tag-pill tag-service"><i class="fa-solid fa-ship"></i> ${escapeHtml(SERVICE_LABEL[f.type] || f.type)}</span></td>
            <td><span class="tag-pill tag-route"><i class="fa-solid fa-route"></i> ${escapeHtml(f.route)}</span></td>
            <td class="fw-bold" style="color: var(--smart-orange);">${escapeHtml(stageName)}</td>
            <td>${statusPillFromComputed(f.computed_status)}</td>
            <td class="text-end">
              <button type="button" onclick="openTracker('${String(f.ref).replace(/'/g, "\\'")}')" class="${btnClass}">${btnText}</button>
            </td>
          </tr>
        `;
      }).join('');

      if(!tbody.innerHTML){
        tbody.innerHTML = `
          <tr>
            <td colspan="7" class="text-center text-muted py-4">
              No records match the selected filters.
            </td>
          </tr>
        `;
      }
    }

    // =========================
    // MANAGE DRAWER (DB)
    // =========================
    async function openTracker(fileRef){
      const fileIdx = files.findIndex(x => x.ref === fileRef);
      if (fileIdx < 0) return;

      currentFile = files[fileIdx];

      document.getElementById('drawer-ref').innerText = currentFile.ref;
      document.getElementById('drawer-client').innerText = currentFile.client;

      try {
        currentManage = await apiGet(`get.php?ref=${encodeURIComponent(currentFile.ref)}`);
        selectedStageIdx = -1;
        renderTimeline();

        document.getElementById('drawer-overlay').style.display = 'block';
        document.getElementById('track-drawer').classList.add('open');

        document.getElementById('update-form-container').classList.add('d-none');
        document.getElementById('empty-state').classList.remove('d-none');

        const canEdit = canEditMilestones();
        document.getElementById('read-only-msg').classList.toggle('d-none', canEdit);
      } catch (err) {
        console.error(err);
        alert("Failed to load file: " + err.message);
      }
    }

    function renderTimeline(){
      const container = document.getElementById('timeline-container');
      if (!currentManage || !currentManage.timeline) {
        container.innerHTML = '<div class="text-muted small">No timeline data.</div>';
        return;
      }

      const canEdit = canEditMilestones();

      const file = currentManage.file;
      const milestones = currentManage.timeline.milestones || [];
      const currentIdx = Number(file.current_stage_index || 0);

      // --- FIX: LOOKUP TEMPLATE NAMES ---
      // We use currentFile.type (which comes from the main list) to find the correct label array
      const serviceType = currentFile.type || ''; 
      const templateLabels = stageTemplates[serviceType] || [];
      // ----------------------------------

      let html = '<div class="timeline-line"></div>';

      milestones.forEach((m) => {
        const idx = Number(m.index);
        const isCompleted = !!m.completed_at;
        const isActive = idx === currentIdx && !isCompleted && file.computed_status !== 'CLOSED';

        let status = 'pending';
        if (isCompleted) status = 'completed';
        else if (isActive) status = 'active';

        let icon = status === 'completed'
          ? '<i class="fa-solid fa-check"></i>'
          : (status === 'active'
              ? '<i class="fa-solid fa-circle-dot"></i>'
              : `<span class="small fw-bold">${idx+1}</span>`);

        const isClickable = (status === 'active' && canEdit && file.computed_status !== 'CLOSED');
        const cursorStyle = isClickable ? 'cursor:pointer;' : 'cursor:default;';

        const completedInfo = isCompleted
          ? `<div class="small text-success">Completed: ${escapeHtml(String(m.completed_at).slice(0,16))}</div>`
          : '';

        const dueInfo = m.due_at
          ? `<div class="small text-muted">Due: ${escapeHtml(String(m.due_at).slice(0,16))}</div>`
          : '';

        // --- FIX: INTELLIGENT NAMING ---
        // If m.stage_name is empty/null, grab the label from our template array
        const displayName = m.stage_name || templateLabels[idx] || ('Stage ' + (idx + 1));
        // -------------------------------

        html += `
          <div class="timeline-item d-flex gap-3" style="${cursorStyle}" ${isClickable ? `onclick='selectStage(${idx})'` : ''}>
            <div class="timeline-dot ${status}">${icon}</div>
            <div class="pt-2 flex-grow-1">
              <div class="small fw-bold text-uppercase ${status === 'pending' ? 'text-muted' : 'text-dark'}" style="letter-spacing:.06em;">
                ${escapeHtml(displayName)}
              </div>
              ${dueInfo}
              ${completedInfo}
              ${(!isClickable && status === 'active' && !canEdit) ? '<div class="small text-muted">Read-only</div>' : ''}
              ${(file.computed_status === 'CLOSED') ? '<div class="small text-muted">File Closed</div>' : ''}
            </div>
          </div>
        `;
      });

      container.innerHTML = html;
    }

    function selectStage(idx){
      selectedStageIdx = idx;

      const m = (currentManage?.timeline?.milestones || []).find(x => Number(x.index) === Number(idx));
      document.getElementById('selected-stage-name').innerText = m?.stage_name || '—';

      document.getElementById('empty-state').classList.add('d-none');
      document.getElementById('update-form-container').classList.remove('d-none');

      document.getElementById('inp-location').value = m?.location || '';
      document.getElementById('inp-reference').value = m?.reference || '';
      document.getElementById('inp-notes').value = m?.notes || '';

      const dateEl = document.getElementById('inp-date');
      const base = m?.completed_at || null;
      dateEl.value = base ? toLocalDateValue(base) : toLocalDateValue(new Date());

      const dtLocal = document.getElementById('inp-completed-at');
      if (m?.completed_at) {
        dtLocal.value = String(m.completed_at).replace(' ', 'T').slice(0,16);
      } else {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth()+1).padStart(2,'0');
        const dd = String(now.getDate()).padStart(2,'0');
        const hh = String(now.getHours()).padStart(2,'0');
        const mi = String(now.getMinutes()).padStart(2,'0');
        dtLocal.value = `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
      }
    }

    // =========================
    // SAVE MILESTONE (DB)
    // =========================
    async function saveMilestone(){
      if(!currentManage || !currentManage.file) return;
      if(selectedStageIdx < 0) return alert("Select the active stage first.");
      if (!canEditMilestones()) return alert("Read-only role.");

      const ref = currentManage.file.operations_file_reference;

      const loc = document.getElementById('inp-location')?.value?.trim() || '';
      const reference = document.getElementById('inp-reference')?.value?.trim() || '';
      const notes = document.getElementById('inp-notes')?.value?.trim() || '';
      const completedAt = readCompletedAtFromInputs();

      try {
        await apiPost('save_milestone.php', {
          operations_file_reference: ref,
          stage_index: selectedStageIdx,
          location: loc,
          reference: reference,
          notes: notes,
          completed_at: completedAt,
          mark_completed: 1,
          advance_next: 1
        });

        currentManage = await apiGet(`get.php?ref=${encodeURIComponent(ref)}`);
        await refreshFiles();
        await refreshKpis();
        renderTimeline();

        document.getElementById('update-form-container').classList.add('d-none');
        document.getElementById('empty-state').classList.remove('d-none');

        alert("Milestone Updated Successfully.");
      } catch (err) {
        console.error(err);
        alert("Save failed: " + err.message);
      }
    }

    function closeDrawer(){
      document.getElementById('track-drawer').classList.remove('open');
      document.getElementById('drawer-overlay').style.display = 'none';
      currentFile = null;
      currentManage = null;
      selectedStageIdx = -1;
    }

    // =========================
    // FILTER HOOKS
    // =========================
    ['search-input','filter-type','filter-route','filter-status'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', renderFiles);
      el.addEventListener('change', renderFiles);
    });

    // init: load from DB
    (async function init(){
      try {
        await refreshKpis();
        await refreshFiles();
      } catch (err) {
        console.error(err);
        alert("Failed to load files: " + err.message);
      }
    })();
  </script>

</body>
</html>
