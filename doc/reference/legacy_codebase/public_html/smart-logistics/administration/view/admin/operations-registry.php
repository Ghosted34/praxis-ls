<?php
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN']); // ADMIN view only

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
  <title>Operations Registry | Smart LS</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">

  <!-- Keep ONLY page-specific CSS here. DO NOT redefine sidebar/topbar/main layout. -->
  <style>
    /* Ops Registry page only */
    .ops-card-custom{
      background:#fff;
      border-radius:12px;
      border:1px solid rgba(0,0,0,0.05);
      box-shadow:0 2px 12px rgba(0,0,0,0.02);
      height:100%;
      transition:transform .2s;
    }
    .ops-card-custom:hover{ transform:translateY(-2px); box-shadow:0 5px 20px rgba(0,0,0,0.05); }

    .ops-kpi-title{ font-size:.7rem; font-weight:700; text-transform:uppercase; color:#888; letter-spacing:.5px; }
    .ops-kpi-value{ font-size:1.6rem; font-weight:800; color:var(--smart-charcoal); line-height:1.2; font-variant-numeric:tabular-nums; }

    .ops-ref-badge{
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-weight:800;
      letter-spacing:.5px;
      background:#eef7fc;
      color:var(--smart-dark-blue);
      padding:4px 8px;
      border-radius:6px;
      border:1px solid #cfe7f5;
      font-size:.85rem;
      display:inline-block;
    }

    .ops-form-section-title{
      font-size:.8rem;
      font-weight:800;
      color:var(--smart-charcoal);
      border-bottom:2px solid #f1f5f9;
      padding-bottom:8px;
      margin:24px 0 16px;
      text-transform:uppercase;
      letter-spacing:.3px;
    }

    .ops-table-custom th{
      font-size:.75rem;
      text-transform:uppercase;
      color:#888;
      font-weight:700;
      border-bottom:2px solid #f0f0f0;
      background:#f9fafb;
      padding:12px 16px;
    }
    .ops-table-custom td{
      font-size:.85rem;
      vertical-align:middle;
      padding:12px 16px;
    }

    .ops-smart-input{
      border-radius:8px;
      font-size:.9rem;
      padding:.6rem .8rem;
      border:1px solid #dee2e6;
    }
    .ops-smart-input:focus{
      border-color:var(--smart-blue);
      box-shadow:0 0 0 3px rgba(31,153,216,.1);
    }

    .ops-status-pill{ font-size:.7rem; font-weight:800; text-transform:uppercase; letter-spacing:.5px; }

    /* Offcanvas width + sticky footer only */
    .ops-offcanvas{ width:800px !important; }
    .ops-sticky-footer{ position: sticky; bottom: 0; z-index: 5; }
  </style>
</head>
<body>

  <!-- EXACT SIDEBAR FROM index.php -->
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
            <a href="supply-master-registry.php" class="sub-link">Supplier Master</a>
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
            <a href="contact-us-intake.php" class="sub-link">Contact Us Intake</a>
            <a href="partnership-portal-intake.php" class="sub-link">Partnership Intake</a>
            <a href="market-campaign-registration.php" class="sub-link">Campaign Register</a>
            <a href="sales-pipelining.php" class="sub-link">Sales Pipeline</a>
           
            <a href="extra-charges-simulator.php" class="sub-link">Extra Charges Sim.</a>
          </div>
        </div>
      </div>

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu5">
          <span><i class="fa-solid fa-ship category-icon"></i> Operations Exec</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu5" class="accordion-collapse collapse show" data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="operations-registry.php" class="sub-link active">Ops File Registry</a>
            <a href="operational-milestone-tracking.php" class="sub-link">Milestone Tracking</a>
            <a href="transit-order.php" class="sub-link">Transit Orders</a>
            <a href="delivery-note.php" class="sub-link">Delivery / POD</a>
          </div>
        </div>
      </div>

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu6">
          <span><i class="fa-solid fa-file-invoice-dollar category-icon"></i> Finance & Billing</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu6" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
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

  <!-- EXACT TOP NAVBAR FROM index.php -->
  <div class="top-navbar">
    <div>
      <h5 class="mb-0 fw-bold text-dark">Operations Registry</h5>
      <small class="text-muted" style="font-size: 0.7rem;">OPS FILE REGISTRY (ADMIN VIEW)</small>
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

  <!-- Main content wrapper EXACT like index.php -->
  <div class="main-content px-4 pb-5">

    <div class="row py-4 align-items-center">
      <div class="col-md-6">
        <h2 class="fw-bold font-heading mb-0">File Management</h2>
        <p class="text-muted mb-0 small">Manage all Logistics Engagements and Cost Controls.</p>
      </div>
      <div class="col-md-6 text-end">
        <button class="btn btn-dark fw-bold px-4 py-2 shadow-sm" onclick="openOffcanvas('create')">
          <i class="fa-solid fa-plus me-2"></i>New Operations File
        </button>
      </div>
    </div>

    <div class="row g-3 mb-4">
      <div class="col-md-3">
        <div class="ops-card-custom p-3 d-flex align-items-center border-start border-4 border-dark">
          <div class="me-3 rounded-3 bg-dark bg-opacity-10 text-dark d-flex align-items-center justify-content-center" style="width:45px;height:45px;font-size:1.2rem;">
            <i class="fa-solid fa-folder-tree"></i>
          </div>
          <div>
            <div class="ops-kpi-title">Total Files</div>
            <div class="ops-kpi-value" id="kpi-total">1,248</div>
            <small class="text-success fw-bold" style="font-size:.7rem;"><i class="fa-solid fa-arrow-up"></i> 12 this week</small>
          </div>
        </div>
      </div>

      <div class="col-md-3">
        <div class="ops-card-custom p-3 d-flex align-items-center border-start border-4 border-primary">
          <div class="me-3 rounded-3 bg-primary bg-opacity-10 text-primary d-flex align-items-center justify-content-center" style="width:45px;height:45px;font-size:1.2rem;">
            <i class="fa-solid fa-spinner"></i>
          </div>
          <div>
            <div class="ops-kpi-title">Active (WIP)</div>
            <div class="ops-kpi-value text-primary" id="kpi-active">86</div>
            <small class="text-muted" style="font-size:.7rem;">In Progress / Open</small>
          </div>
        </div>
      </div>

      <div class="col-md-3">
        <div class="ops-card-custom p-3 d-flex align-items-center border-start border-4 border-warning">
          <div class="me-3 rounded-3 bg-warning bg-opacity-10 text-warning d-flex align-items-center justify-content-center" style="width:45px;height:45px;font-size:1.2rem;">
            <i class="fa-solid fa-file-invoice-dollar"></i>
          </div>
          <div>
            <div class="ops-kpi-title">Financially Pending</div>
            <div class="ops-kpi-value text-warning" id="kpi-fin-pending">14</div>
            <small class="text-muted" style="font-size:.7rem;">Ops Done, Unpaid</small>
          </div>
        </div>
      </div>

      <div class="col-md-3">
        <div class="ops-card-custom p-3 d-flex align-items-center bg-dark text-white border-0 position-relative overflow-hidden">
          <div class="position-relative z-2">
            <div class="ops-kpi-title text-white-50">Realized Margin (MTD)</div>
            <div class="ops-kpi-value text-white" id="kpi-margin">45.2M <span class="fs-6 fw-normal text-white-50">XAF</span></div>
            <small class="text-success fw-bold" style="font-size:.7rem;">Target Reached</small>
          </div>
          <i class="fa-solid fa-chart-pie position-absolute text-white opacity-10" style="font-size:60px; right:-10px; bottom:-10px;"></i>
        </div>
      </div>
    </div>

    <div class="ops-card-custom p-0 overflow-hidden">
      <div class="p-3 border-bottom bg-light d-flex justify-content-between align-items-center">
        <h6 class="fw-bold mb-0 text-uppercase text-muted small"><i class="fa-solid fa-list me-2"></i>Master Record List</h6>
        <div class="input-group input-group-sm" style="width: 250px;">
          <span class="input-group-text bg-white border-end-0"><i class="fa-solid fa-search text-muted"></i></span>
          <input type="text" class="form-control border-start-0 ps-0 ops-smart-input" placeholder="Search..." id="searchInput" onkeyup="onSearchKeyup()">
        </div>
      </div>
      <div class="table-responsive">
        <table class="table table-hover ops-table-custom mb-0 align-middle">
          <thead>
            <tr>
              <th class="ps-4">Reference</th>
              <th>Client</th>
              <th>Service Type</th>
              <th>Territory</th>
              <th class="text-end">Margin</th>
              <th>Status</th>
              <th class="text-end pe-4">Action</th>
            </tr>
          </thead>
          <tbody id="table-body"></tbody>
        </table>
      </div>
    </div>

  </div>

  <!-- Offcanvas -->
  <div class="offcanvas offcanvas-end ops-offcanvas" tabindex="-1" id="opsOffcanvas">
    <div class="offcanvas-header border-bottom bg-light py-3">
      <div>
        <h5 class="offcanvas-title font-heading fw-bold" id="offcanvasTitle">New Operations File</h5>
        <div class="d-flex align-items-center gap-2 mt-1">
          <span class="badge bg-dark text-white" id="modal-status-badge">DRAFT</span>
          <small class="text-muted" id="modal-subtitle">Operational Record Overview & Control</small>
        </div>
      </div>
      <button type="button" class="btn-close" data-bs-dismiss="offcanvas"></button>
    </div>

    <div class="offcanvas-body p-0 bg-white position-relative">
      <div id="readonly-blocker" class="d-none position-absolute top-0 start-0 w-100 h-100 bg-white bg-opacity-75 z-3 d-flex justify-content-center align-items-center">
        <div class="bg-white shadow-lg p-4 rounded-4 text-center border">
          <i class="fa-solid fa-lock text-muted fs-1 mb-3"></i>
          <h5 class="fw-bold">Read Only Access</h5>
          <p class="text-muted small mb-0">Role Restriction or File Closed.</p>
        </div>
      </div>

      <form id="opsForm" class="p-4 needs-validation" novalidate onsubmit="event.preventDefault(); submitFile();">

        <div class="bg-primary bg-opacity-10 p-4 rounded-3 mb-4 border border-primary border-opacity-25 d-flex justify-content-between align-items-center">
          <div>
            <label class="small fw-bold text-primary text-uppercase mb-1">File Reference (Locked)</label>
            <h3 class="font-monospace fw-black mb-0 text-dark" id="display-ref">SL-------XX</h3>
            <small class="text-muted fst-italic">System Generated</small>
          </div>
          <div class="text-end">
            <label class="small fw-bold text-muted text-uppercase mb-1">Created By</label>
            <div class="d-flex align-items-center gap-2">
              <div class="bg-dark text-white rounded-circle d-flex align-items-center justify-content-center fw-bold" style="width: 24px; height: 24px; font-size: 10px;">AD</div>
              <span class="fw-bold text-dark small"><?php echo e($firstName); ?></span>
            </div>
          </div>
        </div>

        <div class="card bg-light border-0 mb-4">
          <div class="card-body">
            <div class="form-check form-switch mb-2">
              <input class="form-check-input" type="checkbox" id="linkOpportunity" onchange="toggleOppLogic()" checked>
              <label class="form-check-label fw-bold" for="linkOpportunity">Linked to WON Opportunity?</label>
            </div>
            <div id="opp-input-container">
              <label class="form-label">Opportunity ID <span class="text-danger">*</span></label>
              <input type="text" class="form-control ops-smart-input" id="oppIdField" placeholder="e.g. OPP-2024-991" required>
              <div class="invalid-feedback">Opportunity ID is required.</div>
            </div>
            <div id="direct-entry-warning" class="d-none mt-2 p-2 bg-warning bg-opacity-10 border border-warning rounded">
              <div class="d-flex gap-2">
                <i class="fa-solid fa-triangle-exclamation text-warning mt-1"></i>
                <small class="text-dark fw-bold">Direct Entry Mode: Data will be forwarded to SALES for regularization.</small>
              </div>
            </div>
          </div>
        </div>

        <h6 class="ops-form-section-title">1. Engagement Classification</h6>
        <div class="row g-3">
          <div class="col-md-12">
            <label class="form-label">Client (Bill To) <span class="text-danger">*</span></label>
            <select class="form-select ops-smart-input" id="clientBillTo" required>
  <option value="">Select Client...</option>
  <option value="CL-0001">TotalEnergies E&P</option>
  <option value="CL-0002">Maersk Cameroon</option>
  <option value="CL-0003">Perenco</option>
  <option value="CL-0004">Huawei</option>
</select>

            <div class="invalid-feedback">Client is required.</div>
          </div>
          <div class="col-md-6">
            <label class="form-label">Service Type <span class="text-danger">*</span></label>
            <select class="form-select ops-smart-input" id="serviceType" onchange="handleServiceChange()" required>
              <option value="">Select Type...</option>
              <option value="SEA_FREIGHT_IMPORT">SEA FREIGHT IMPORT</option>
              <option value="SEA_FREIGHT_EXPORT">SEA FREIGHT EXPORT</option>
              <option value="AIR_FREIGHT_IMPORT">AIR FREIGHT IMPORT</option>
              <option value="AIR_FREIGHT_EXPORT">AIR FREIGHT EXPORT</option>
              <option value="HINTERLAND_TRANSIT">HINTERLAND TRANSIT</option>
              <option value="INLAND_TRANSPORTATION">INLAND TRANSPORTATION</option>
              <option value="WAREHOUSING">WAREHOUSING</option>
              <option value="END_TO_END_AIR_FREIGHT">END-TO-END AIR FREIGHT</option>
              <option value="END_TO_END_SEA_FREIGHT">END-TO-END SEA FREIGHT</option>
              <option value="BUSINESS_REPRESENTATION">BUSINESS REPRESENTATION</option>
            </select>
            <div class="invalid-feedback">Service Type is required.</div>
          </div>
          <div class="col-md-6">
            <label class="form-label">Service Territory <span class="text-danger">*</span></label>
            <select class="form-select ops-smart-input" id="serviceTerritory" required>
              <option value="">Select Territory...</option>
              <option value="DOMESTIC_INLAND">DOMESTIC INLAND</option>
              <option value="PORT_AIRPORT_ZONE">PORT AIRPORT ZONE</option>
              <option value="INTERNATIONAL_IMPORT">INTERNATIONAL IMPORT</option>
              <option value="INTERNATIONAL_EXPORT">INTERNATIONAL EXPORT</option>
              <option value="TRANSIT_HINTERLAND">TRANSIT HINTERLAND</option>
              <option value="END_TO_END_INTERNATIONAL">END-TO-END INTERNATIONAL</option>
            </select>
            <div class="invalid-feedback">Territory is required.</div>
          </div>
        </div>
        <div class="col-md-6">
      <label class="form-label">Operations Status <span class="text-danger">*</span></label>
      <select class="form-select ops-smart-input" id="operationsStatus">
        <option value="NOT_AWARDED">NOT AWARDED</option>
        <option value="OPEN">OPEN</option>
        <option value="IN_PROGRESS">IN PROGRESS</option>
        <option value="OPERATIONALLY_COMPLETED">OPERATIONALLY COMPLETED</option>
        <option value="FINANCIALLY_PENDING">FINANCIALLY PENDING</option>
        <option value="CLOSED">CLOSED</option>
      </select>

      <div class="invalid-feedback">Operations status is required.</div>
    </div>


        <h6 class="ops-form-section-title">2. Shared Shipment Details (SSDC)</h6>
        <div class="row g-3">
          <div class="col-md-4">
            <label class="form-label">Commodity (Short) <span class="text-danger">*</span></label>
            <input type="text" class="form-control ops-smart-input" id="commodityShort" required>
            <div class="invalid-feedback">Required.</div>
          </div>
          <div class="col-md-8">
            <label class="form-label">Description</label>
            <input type="text" class="form-control ops-smart-input" id="commodityDesc">
          </div>
          <div class="col-md-4">
            <label class="form-label">Weight</label>
            <input type="number" step="0.001" class="form-control ops-smart-input" id="grossWeight" placeholder="0.000">
          </div>
          <div class="col-md-2">
            <label class="form-label">Unit</label>
            <select class="form-select ops-smart-input" id="weightUnit">
              <option value="KG">KG</option>
              <option value="TONNE">TONNE</option>
            </select>
          </div>
          <div class="col-md-3">
            <label class="form-label">Pkgs</label>
            <input type="number" class="form-control ops-smart-input" id="pkgCount">
          </div>
          <div class="col-md-3">
            <label class="form-label">Incoterm</label>
            <select class="form-select ops-smart-input" id="incoterm">
              <option value="EXW">EXW</option><option value="FCA">FCA</option><option value="FAS">FAS</option><option value="FOB">FOB</option>
              <option value="CFR">CFR</option><option value="CIF">CIF</option><option value="CPT">CPT</option><option value="CIP">CIP</option>
              <option value="DAP">DAP</option><option value="DPU">DPU</option><option value="DDP">DDP</option>
            </select>
          </div>
          <div class="col-12">
            <label class="form-label">Marks & Numbers</label>
            <textarea class="form-control ops-smart-input" id="marksNumbers" placeholder="Format must be 05*20'DC" rows="2"></textarea>
          </div>
          <div class="col-md-6">
            <label class="form-label">Receipt</label>
            <input type="text" class="form-control ops-smart-input" id="placeReceipt" placeholder="Origin">
          </div>
          <div class="col-md-6">
            <label class="form-label">Delivery</label>
            <input type="text" class="form-control ops-smart-input" id="placeDelivery" placeholder="Destination">
          </div>
          <div id="etaAtaSection" class="row g-3 mt-1 d-none">
            <div class="col-md-6">
              <label class="form-label">ETA (Estimated)</label>
              <input type="datetime-local" class="form-control ops-smart-input" id="etaField">
            </div>
            <div class="col-md-6">
              <label class="form-label">ATA (Actual)</label>
              <input type="datetime-local" class="form-control ops-smart-input" id="ataField">
            </div>
            <div class="col-md-6">
              <label class="form-label">Expected Delivery Time</label>
              <input type="datetime-local" class="form-control ops-smart-input" id="expectedDeliveryTime">
              <div class="form-text small text-muted">Optional. Operational expectation for delivery completion.</div>
            </div>

          </div>
        </div>

        <div id="dynamic-section-container" class="mt-4"></div>

        <div class="d-flex justify-content-end gap-2 mt-5 pt-3 border-top bg-white ops-sticky-footer">
          <button type="button" class="btn btn-light fw-bold" data-bs-dismiss="offcanvas">Cancel</button>
          <button type="submit" class="btn btn-dark fw-bold" id="btn-submit-text">
            <i class="fa-solid fa-save me-2"></i>Create Operations File
          </button>
        </div>
      </form>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

  <script>
  /* ============================================================
     OPS REGISTRY (ADMIN ONLY) — DB-READY SCRIPT (CORRECTED)
     FIXES / IMPROVEMENTS:
     - Removed PHP code mistakenly embedded inside JS (hard runtime break)
     - Added safe JSON fetch guard (catches HTML/PHP warnings/login redirects)
     - Safe Offcanvas init (avoids null element errors)
     - Normalizes datetime-local into "YYYY-MM-DD HH:MM:SS" for expected_delivery_time
     ============================================================ */

  // Guard: prevent errors if admin.js already defines toggleClock()
  if (typeof toggleClock !== 'function') {
    function toggleClock() { /* noop */ }
  }

  /* ---------------------------
     CLOCK (top bar)
  ---------------------------- */
  function updateClock() {
    const el = document.getElementById('realtime-clock');
    if (el) el.innerText = new Date().toLocaleTimeString();
  }
  setInterval(updateClock, 1000);
  updateClock();

  /* ---------------------------
     ADMIN view only
  ---------------------------- */
  const currentRole = 'ADMIN';
  let currentRecordRef = null;

  /* ---------------------------
     API ENDPOINTS (adjust paths if needed)
  ---------------------------- */
  const OPS_LIST_API    = '../../api/operations_files/list.php';
  const OPS_GET_API     = '../../api/operations_files/get.php';
  const OPS_SAVE_API    = '../../api/operations_files/save.php';

  // NOTE: Ensure this endpoint actually returns JSON {ok:true, rows:[{client_id, client_name},...]}
  const CLIENT_LIST_API = '../../api/operations_files/list-ops.php';

  /* ---------------------------
     STATE
  ---------------------------- */
  let files = [];     // loaded from DB
  let listBusy = false;
  let saveBusy = false;
  let clientsLoaded = false;

  const suffixMap = {
    'SEA_FREIGHT_IMPORT': 'SM', 'SEA_FREIGHT_EXPORT': 'SX',
    'AIR_FREIGHT_IMPORT': 'AM', 'AIR_FREIGHT_EXPORT': 'AX',
    'HINTERLAND_TRANSIT': 'HT', 'INLAND_TRANSPORTATION': 'IT',
    'WAREHOUSING': 'WH', 'END_TO_END_AIR_FREIGHT': 'AF',
    'END_TO_END_SEA_FREIGHT': 'EF', 'BUSINESS_REPRESENTATION': 'BR'
  };

  const statusConfig = {
    'NOT_AWARDED': { class: 'bg-secondary', tooltip: 'Quotation issued, client has not confirmed. No costs allowed.' },
    'OPEN': { class: 'bg-info text-dark', tooltip: 'Job awarded, pre-operational state.' },
    'IN_PROGRESS': { class: 'bg-primary', tooltip: 'Operational activities ongoing. Costs allowed.' },
    'OPERATIONALLY_COMPLETED': { class: 'bg-success', tooltip: 'Logistics done. delivered. Financials pending.' },
    'FINANCIALLY_PENDING': { class: 'bg-warning text-dark', tooltip: 'Ops complete, Invoice unpaid.' },
    'CLOSED': { class: 'bg-dark', tooltip: 'Fully paid and archived. Read-only.' }
  };

  function setStatusRequired(isRequired) {
    const el = $('operationsStatus');
    if (!el) return;
    if (isRequired) el.setAttribute('required', '');
    else el.removeAttribute('required');
  }

  /* ---------------------------
     Offcanvas (safe init)
  ---------------------------- */
  let myOffcanvas = null;

  /* ============================================================
     UTIL
  ============================================================ */
  function $(id){ return document.getElementById(id); }

  function safeSetValue(id, value) {
    const el = $(id);
    if (!el) return;
    el.value = (value ?? '');
  }
  function safeGetValue(id) {
    const el = $(id);
    if (!el) return '';
    return el.value ?? '';
  }

  function setFormLocked(locked) {
    const form = $('opsForm');
    if (!form) return;
    const elements = form.querySelectorAll('input, select, textarea, button');
    elements.forEach(el => {
      // keep close button enabled; but form inputs locked
      if (el.closest('.offcanvas-header')) return;
      if (el.id === 'btn-submit-text') return; // controlled elsewhere
      el.disabled = locked;
    });
  }

  function showAlert(msg) { alert(msg); }

  function toNumberOrNull(v) {
    const s = String(v ?? '').trim();
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function initTooltips() {
    [...document.querySelectorAll('[data-bs-toggle="tooltip"]')].forEach(t => {
      const old = bootstrap.Tooltip.getInstance(t);
      if (old) old.dispose();
      new bootstrap.Tooltip(t);
    });
  }

  // basic html escaping helpers (avoid XSS from DB)
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // Safer JSON fetch: catches "Non-JSON response" issues early
  async function safeJsonFetch(url, options) {
    const res = await fetch(url, options);
    const ct = res.headers.get('content-type') || '';
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}. ${text.slice(0, 200)}`);
    }
    if (!ct.includes('application/json')) {
      const text = await res.text().catch(() => '');
      throw new Error(`Non-JSON response. ${text.slice(0, 200)}`);
    }
    return res.json();
  }

  // Normalize datetime-local to "YYYY-MM-DD HH:MM:SS" or null
  function normalizeDateTimeLocal(v) {
    const s = String(v ?? '').trim();
    if (!s) return null;
    const t = s.replace('T', ' ');
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(t)) return `${t}:00`;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(t)) return t;
    return null;
  }

  /* ============================================================
     CLIENTS DROPDOWN (DB)
     - clientBillTo <select> value = client_id
  ============================================================ */
  async function loadClientsIntoSelect() {
    const sel = $('clientBillTo');
    if (!sel) return;

    // avoid reloading if already loaded and not empty
    if (clientsLoaded && sel.options.length > 1) return;

    sel.innerHTML = '<option value="">Select Client...</option>';

    try {
      const data = await safeJsonFetch(CLIENT_LIST_API, { credentials: 'same-origin' });

      if (!data.ok || !Array.isArray(data.rows)) {
        showAlert(data.error || 'Failed to load clients.');
        return;
      }

      data.rows.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.client_id; // IMPORTANT: client_id
        opt.textContent = `${c.client_name} (${c.client_id})`;
        sel.appendChild(opt);
      });

      clientsLoaded = true;
    } catch (e) {
      console.error(e);
      showAlert('Network/server error while loading clients.');
    }
  }

  /* ============================================================
     DB LOAD — LIST
     Expected list.php response:
       { ok:true, rows:[ {ref, client_id, client_name, service_type, service_territory, operations_status}, ... ] }
  ============================================================ */
  async function loadFiles() {
    if (listBusy) return;
    listBusy = true;

    const q = (document.getElementById('searchInput')?.value || '').trim();
    const url = q ? `${OPS_LIST_API}?q=${encodeURIComponent(q)}` : OPS_LIST_API;

    try {
      const data = await safeJsonFetch(url, { credentials: 'same-origin' });

      if (!data.ok) {
        files = [];
        showAlert(data.error || 'Failed to load Operations Registry.');
        return;
      }

      // Normalize rows to our internal schema used by renderTable()
      files = (Array.isArray(data.rows) ? data.rows : []).map(r => ({
        ref: r.ref ?? r.operations_file_reference ?? '',
        client_id: r.client_id ?? '',
        client_name: r.client_name ?? '',
        service_type: r.service_type ?? '',
        service_territory: r.service_territory ?? '',
        operations_status: r.operations_status ?? ''
      }));
    } catch (e) {
      console.error(e);
      files = [];
      showAlert('Network/server error while loading Operations Registry.');
    } finally {
      listBusy = false;
    }
  }

  /* ============================================================
     KPIs + TABLE
  ============================================================ */
  function renderKPIs() {
    const total = files.length;
    const active = files.filter(f => ['OPEN','IN_PROGRESS','NOT_AWARDED'].includes(f.operations_status)).length;
    const finPending = files.filter(f => ['FINANCIALLY_PENDING','OPERATIONALLY_COMPLETED'].includes(f.operations_status)).length;

    const totalEl = $('kpi-total');
    const activeEl = $('kpi-active');
    const finEl = $('kpi-fin-pending');

    if (totalEl) totalEl.textContent = total.toLocaleString();
    if (activeEl) activeEl.textContent = active.toLocaleString();
    if (finEl) finEl.textContent = finPending.toLocaleString();

    // Margin KPI placeholder until wired
    const marginEl = $('kpi-margin');
    if (marginEl) marginEl.innerHTML = '-- <span class="fs-6 fw-normal text-white-50">XAF</span>';
  }

  function renderTable() {
    const tbody = $('table-body');
    if (!tbody) return;

    // local filter is optional; DB already filters by q, but keep it as instant UI filter
    const search = (document.getElementById('searchInput')?.value || '').toLowerCase();

    const rows = files.filter(r => {
      if (!search) return true;
      const ref = (r.ref || '').toLowerCase();
      const cname = (r.client_name || '').toLowerCase();
      const cid = (r.client_id || '').toLowerCase();
      return ref.includes(search) || cname.includes(search) || cid.includes(search);
    });

    tbody.innerHTML = rows.map(r => {
      const meta = statusConfig[r.operations_status] || { class: 'bg-dark', tooltip: '' };

      return `
        <tr>
          <td class="ps-4"><span class="ops-ref-badge">${escapeHtml(r.ref)}</span></td>
          <td class="fw-bold text-dark" style="font-size:.85rem">${escapeHtml(r.client_name || r.client_id || '--')}</td>
          <td>
            <span class="badge bg-light text-dark border fw-normal" style="font-size:.7rem">
              ${escapeHtml(String(r.service_type || '').replace(/_/g,' '))}
            </span>
          </td>
          <td class="small text-muted">${escapeHtml(String(r.service_territory || '').replace(/_/g,' '))}</td>
          <td class="text-end fw-bold font-monospace">-- <span class="text-muted" style="font-size:.7em">XAF</span></td>
          <td>
            <span class="badge ${meta.class} ops-status-pill rounded-pill px-3 py-2"
              data-bs-toggle="tooltip" title="${escapeHtml(meta.tooltip)}">
              ${escapeHtml(String(r.operations_status || '').replace(/_/g,' '))} <i class="fa-solid fa-info-circle ms-1"></i>
            </span>
          </td>
          <td class="text-end pe-4">
            <button onclick="openOffcanvas('view','${escapeAttr(r.ref)}')" class="btn btn-sm btn-outline-dark fw-bold">
              <i class="fa-solid fa-gear"></i> Manage
            </button>
          </td>
        </tr>
      `;
    }).join('');

    initTooltips();
    renderKPIs();
  }

  /* ============================================================
     FORM LOGIC
  ============================================================ */
  function toggleEtaAta(type) {
    const etaAta = $('etaAtaSection');
    if (!etaAta) return;
    const hideFor = ['BUSINESS_REPRESENTATION', 'WAREHOUSING'];
    const shouldShow = type && !hideFor.includes(type);
    etaAta.classList.toggle('d-none', !shouldShow);
    if (!shouldShow) {
      safeSetValue('etaField', '');
      safeSetValue('ataField', '');
    }
  }

  function handleServiceChange() {
    const type = $('serviceType')?.value || '';
    toggleEtaAta(type);
    renderDynamicSections(type);

    // If viewing an existing record, dynamic section is re-rendered — repopulate from cached details
    const form = $('opsForm');
    if (form && form.dataset.detailsJson) {
      try {
        const details = JSON.parse(form.dataset.detailsJson);
        populateDynamicFields({ details });
      } catch (_) {}
    }

    // For "new", show a temporary preview ref (server remains authoritative)
    const refDisplay = $('display-ref');
    if (refDisplay?.dataset.mode === 'new' && type) {
      const suffix = suffixMap[type] || 'XX';
      const random = Math.floor(1000000 + Math.random() * 9000000);
      refDisplay.innerText = `SL${random}${suffix}`;
    }
  }

  function renderDynamicSections(type) {
    const container = $('dynamic-section-container');
    if (!container) return;

    let html = '';

    if (type.includes('SEA')) {
      html = `
        <h6 class="ops-form-section-title text-primary"><i class="fa-solid fa-ship me-2"></i>Sea Freight Details</h6>
        <div class="row g-3">
          <div class="col-md-6"><label class="form-label">Bill of Lading</label><input type="text" class="form-control ops-smart-input" id="sea_bl"></div>
          <div class="col-md-6"><label class="form-label">Vessel Name</label><input type="text" class="form-control ops-smart-input" id="sea_vessel"></div>
          <div class="col-md-4"><label class="form-label">Voyage №</label><input type="text" class="form-control ops-smart-input" id="sea_voyage"></div>
          <div class="col-md-4"><label class="form-label">POL</label><input type="text" class="form-control ops-smart-input" id="sea_pol"></div>
          <div class="col-md-4"><label class="form-label">POD</label><input type="text" class="form-control ops-smart-input" id="sea_pod"></div>
        </div>`;
    } else if (type.includes('AIR')) {
      html = `
        <h6 class="ops-form-section-title text-info"><i class="fa-solid fa-plane me-2"></i>Air Freight Details</h6>
        <div class="row g-3">
          <div class="col-md-6"><label class="form-label">MAWB / HAWB</label><input type="text" class="form-control ops-smart-input" id="air_mawb"></div>
          <div class="col-md-6"><label class="form-label">Airline</label><input type="text" class="form-control ops-smart-input" id="air_airline"></div>
          <div class="col-md-4"><label class="form-label">Flight No</label><input type="text" class="form-control ops-smart-input" id="air_flightno"></div>
          <div class="col-md-4"><label class="form-label">Origin Airport</label><input type="text" class="form-control ops-smart-input" id="air_origin"></div>
          <div class="col-md-4"><label class="form-label">Dest. Airport</label><input type="text" class="form-control ops-smart-input" id="air_dest"></div>
        </div>`;
    } else if (type.includes('INLAND') || type.includes('HINTERLAND')) {
      html = `
        <h6 class="ops-form-section-title text-warning"><i class="fa-solid fa-truck me-2"></i>Inland/Transit Details</h6>
        <div class="row g-3">
          <div class="col-md-6"><label class="form-label">Truck Plate / Ref</label><input type="text" class="form-control ops-smart-input" id="inland_truck"></div>
          <div class="col-md-6"><label class="form-label">Transit Declaration</label><input type="text" class="form-control ops-smart-input" id="inland_decl"></div>
          <div class="col-md-12"><label class="form-label">Border Points</label><input type="text" class="form-control ops-smart-input" id="inland_border"></div>
        </div>`;
    } else if (type === 'WAREHOUSING') {
      html = `
        <h6 class="ops-form-section-title"><i class="fa-solid fa-warehouse me-2"></i>Warehousing Details</h6>
        <div class="row g-3">
          <div class="col-md-6"><label class="form-label">Warehouse Loc</label><input type="text" class="form-control ops-smart-input" id="warehouse_loc"></div>
          <div class="col-md-6">
            <label class="form-label">Bonded Status</label>
            <select class="form-select ops-smart-input" id="warehouse_bonded">
              <option value="BONDED">BONDED</option>
              <option value="NON_BONDED">NON_BONDED</option>
            </select>
          </div>
          <div class="col-md-6"><label class="form-label">Stock In</label><input type="date" class="form-control ops-smart-input" id="warehouse_stockin"></div>
        </div>`;
    } else if (type === 'BUSINESS_REPRESENTATION') {
      html = `
        <h6 class="ops-form-section-title"><i class="fa-solid fa-briefcase me-2"></i>Representation Scope</h6>
        <div class="row g-3">
          <div class="col-12"><label class="form-label">Scope Summary</label><textarea class="form-control ops-smart-input" id="rep_scope"></textarea></div>
          <div class="col-md-6"><label class="form-label">Client Contact</label><input type="text" class="form-control ops-smart-input" id="rep_contact"></div>
        </div>`;
    }

    container.innerHTML = html;
  }

  function populateDynamicFields(file) {
    const d = file.details || {};
    safeSetValue('sea_bl', d.sea_bl);
    safeSetValue('sea_vessel', d.sea_vessel);
    safeSetValue('sea_voyage', d.sea_voyage);
    safeSetValue('sea_pol', d.sea_pol);
    safeSetValue('sea_pod', d.sea_pod);

    safeSetValue('air_mawb', d.air_mawb);
    safeSetValue('air_airline', d.air_airline);
    safeSetValue('air_flightno', d.air_flightno);
    safeSetValue('air_origin', d.air_origin);
    safeSetValue('air_dest', d.air_dest);

    safeSetValue('inland_truck', d.inland_truck);
    safeSetValue('inland_decl', d.inland_decl);
    safeSetValue('inland_border', d.inland_border);

    safeSetValue('warehouse_loc', d.warehouse_loc);
    safeSetValue('warehouse_bonded', d.warehouse_bonded);
    safeSetValue('warehouse_stockin', d.warehouse_stockin);

    safeSetValue('rep_scope', d.rep_scope);
    safeSetValue('rep_contact', d.rep_contact);
  }

  function collectDetailsFromForm(type) {
    const details = {
      linkOpportunity: $('linkOpportunity')?.checked || false,

      // convenience mirrors (details store)
      oppIdField: safeGetValue('oppIdField'),
      clientBillTo: safeGetValue('clientBillTo'),
      serviceTerritory: safeGetValue('serviceTerritory'),

      commodityShort: safeGetValue('commodityShort'),
      commodityDesc: safeGetValue('commodityDesc'),
      grossWeight: safeGetValue('grossWeight'),
      weightUnit: safeGetValue('weightUnit'),
      pkgCount: safeGetValue('pkgCount'),
      incoterm: safeGetValue('incoterm'),
      marksNumbers: safeGetValue('marksNumbers'),
      placeReceipt: safeGetValue('placeReceipt'),
      placeDelivery: safeGetValue('placeDelivery'),
      etaField: safeGetValue('etaField'),
      ataField: safeGetValue('ataField'),
      expectedDeliveryTime: safeGetValue('expectedDeliveryTime'),

      sea_bl: safeGetValue('sea_bl'),
      sea_vessel: safeGetValue('sea_vessel'),
      sea_voyage: safeGetValue('sea_voyage'),
      sea_pol: safeGetValue('sea_pol'),
      sea_pod: safeGetValue('sea_pod'),

      air_mawb: safeGetValue('air_mawb'),
      air_airline: safeGetValue('air_airline'),
      air_flightno: safeGetValue('air_flightno'),
      air_origin: safeGetValue('air_origin'),
      air_dest: safeGetValue('air_dest'),

      inland_truck: safeGetValue('inland_truck'),
      inland_decl: safeGetValue('inland_decl'),
      inland_border: safeGetValue('inland_border'),

      warehouse_loc: safeGetValue('warehouse_loc'),
      warehouse_bonded: safeGetValue('warehouse_bonded'),
      warehouse_stockin: safeGetValue('warehouse_stockin'),

      rep_scope: safeGetValue('rep_scope'),
      rep_contact: safeGetValue('rep_contact')
    };

    if (['BUSINESS_REPRESENTATION','WAREHOUSING'].includes(type)) {
      details.etaField = '';
      details.ataField = '';
    }
    return details;
  }

  function toggleOppLogic() {
    const isLinked = $('linkOpportunity')?.checked || false;
    const btn = $('btn-submit-text');
    const oppField = $('oppIdField');

    $('opp-input-container')?.classList.toggle('d-none', !isLinked);
    $('direct-entry-warning')?.classList.toggle('d-none', isLinked);

    if (!btn || !oppField) return;

    if (isLinked) {
      oppField.setAttribute('required', '');
      btn.className = 'btn btn-dark fw-bold';
      if ($('display-ref')?.dataset.mode === 'new') {
        btn.innerHTML = '<i class="fa-solid fa-save me-2"></i>Create Operations File';
      }
    } else {
      oppField.removeAttribute('required');
      btn.className = 'btn btn-warning fw-bold';
      if ($('display-ref')?.dataset.mode === 'new') {
        btn.innerHTML = '<i class="fa-solid fa-paper-plane me-2"></i>Notify Sales & Create';
      }
    }
  }

  /* ============================================================
     OFFCANVAS OPEN (CREATE / VIEW)
     get.php expected:
       { ok:true, record:{ ref, client_id, service_type, ..., details:{...} } }
  ============================================================ */
  async function openOffcanvas(mode, ref) {
    const form = $('opsForm');
    const refDisplay = $('display-ref');
    const blocker = $('readonly-blocker');
    const btn = $('btn-submit-text');

    if (!form || !refDisplay || !blocker || !btn) return;

    // ensure clients are loaded before any setValue('clientBillTo')
    await loadClientsIntoSelect();

    if (mode === 'create') {
      currentRecordRef = null;

      form.reset();

      // status required only for NEW
      setStatusRequired(true);
      safeSetValue('operationsStatus', 'NOT_AWARDED');

      form.classList.remove('was-validated');
      delete form.dataset.detailsJson;

      refDisplay.innerText = "SL-------XX";
      refDisplay.dataset.mode = 'new';

      $('offcanvasTitle').innerText = 'New Operations File';
      $('modal-status-badge').innerText = 'DRAFT';
      $('modal-status-badge').className = 'badge bg-dark text-white';

      $('dynamic-section-container').innerHTML = '';
      toggleEtaAta('');
      toggleOppLogic();

      blocker.classList.add('d-none');
      setFormLocked(false);

      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-save me-2"></i>Create Operations File';
      btn.className = 'btn btn-dark fw-bold';

      myOffcanvas?.show();
      return;
    }

    if (!ref) return;

    try {
      const data = await safeJsonFetch(`${OPS_GET_API}?ref=${encodeURIComponent(ref)}`, { credentials: 'same-origin' });

      if (!data.ok) {
        showAlert(data.error || 'Failed to load operations file.');
        return;
      }

      const record = data.record || {};
      setStatusRequired(false);
      safeSetValue('operationsStatus', record.operations_status || 'OPEN');

      const details = record.details || {};
      currentRecordRef = record.ref || ref;

      form.reset();
      form.classList.remove('was-validated');

      // cache details so serviceType re-render can repopulate
      form.dataset.detailsJson = JSON.stringify(details || {});

      refDisplay.innerText = currentRecordRef;
      refDisplay.dataset.mode = 'view';

      $('offcanvasTitle').innerText = 'Manage Operations File';

      const badge = $('modal-status-badge');
      badge.innerText = String(record.operations_status || 'OPEN').replace(/_/g, ' ');
      badge.className = `badge ${statusConfig[record.operations_status]?.class || 'bg-dark'} text-white`;

      // MASTER fields
      safeSetValue('clientBillTo', record.client_id || '');
      safeSetValue('serviceType', record.service_type || '');
      safeSetValue('serviceTerritory', record.service_territory || '');

      // Opportunity
      safeSetValue('oppIdField', record.opportunity_id || details.oppIdField || '');

      // linkOpportunity stored in details
      const linkEl = $('linkOpportunity');
      if (linkEl) linkEl.checked = !!details.linkOpportunity;
      toggleOppLogic();

      // Commodity etc
      safeSetValue('commodityShort', record.commodity || details.commodityShort || '');
      safeSetValue('commodityDesc', details.commodityDesc || '');

      safeSetValue('grossWeight', (record.gross_weight ?? details.grossWeight ?? ''));
      safeSetValue('weightUnit', record.weight_unit || details.weightUnit || 'KG');
      safeSetValue('pkgCount', (record.package_count ?? details.pkgCount ?? ''));

      safeSetValue('incoterm', details.incoterm || 'EXW');
      safeSetValue('marksNumbers', details.marksNumbers || '');
      safeSetValue('placeReceipt', details.placeReceipt || '');
      safeSetValue('placeDelivery', details.placeDelivery || '');

      safeSetValue('etaField', details.etaField || '');
      safeSetValue('ataField', details.ataField || '');
      safeSetValue('expectedDeliveryTime', details.expectedDeliveryTime || '');

      // render + populate dynamic
      handleServiceChange();
      populateDynamicFields({ details });

      // Lock if CLOSED
      const isClosed = (record.operations_status === 'CLOSED');
      const canEdit = !isClosed; // ADMIN can edit unless closed

      blocker.classList.toggle('d-none', canEdit);
      setFormLocked(!canEdit);

      if (canEdit) {
        btn.innerHTML = '<i class="fa-solid fa-save me-2"></i>Save Changes';
        btn.className = 'btn btn-dark fw-bold';
        btn.disabled = false;
      } else {
        btn.disabled = true;
      }

      myOffcanvas?.show();

    } catch (e) {
      console.error(e);
      showAlert('Network/server error while loading record.');
    }
  }

  /* ============================================================
     SUBMIT (CREATE / UPDATE) — SAVES TO DB
     save.php expects:
       ref: "" for create OR existing ref for update
  ============================================================ */
  async function submitFile() {
    if (saveBusy) return;

    const form = $('opsForm');
    const refDisplay = $('display-ref');
    const blocker = $('readonly-blocker');
    const btn = $('btn-submit-text');

    if (!form || !refDisplay || !btn || !blocker) return;
    if (!blocker.classList.contains('d-none')) return; // blocked

    if (!form.checkValidity()) {
      form.classList.add('was-validated');
      const firstInvalid = form.querySelector(':invalid');
      if (firstInvalid) {
        firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
        firstInvalid.focus();
      }
      return;
    }

    const mode = refDisplay.dataset.mode; // 'new' or 'view'
    const chosenStatus = safeGetValue('operationsStatus');

    const serviceType = safeGetValue('serviceType');
    const territory = safeGetValue('serviceTerritory');
    const clientId = safeGetValue('clientBillTo');       // IMPORTANT: client_id
    const opportunityId = safeGetValue('oppIdField');

    const details = collectDetailsFromForm(serviceType);
    const commodity = safeGetValue('commodityShort');

    const payload = {
      ref: (mode === 'new') ? '' : (currentRecordRef || ''),
      legacy_reference: null,
      opportunity_id: opportunityId || null,
      client_id: clientId,
      service_type: serviceType,
      service_territory: territory,
      commodity: commodity || null,
      gross_weight: toNumberOrNull(safeGetValue('grossWeight')),
      weight_unit: safeGetValue('weightUnit') || 'KG',
      package_count: toNumberOrNull(safeGetValue('pkgCount')),
      operations_status: (mode === 'new')
        ? (chosenStatus || 'NOT_AWARDED')
        : (chosenStatus || null),

      // Backend column: expected_delivery_time (datetime)
      expected_delivery_time: normalizeDateTimeLocal(safeGetValue('expectedDeliveryTime')),

      details
    };

    saveBusy = true;
    const prevHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-2"></i>Saving...';

    try {
      const data = await safeJsonFetch(OPS_SAVE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
      });

      if (!data.ok) {
        showAlert(data.error || 'Save failed.');
        return;
      }

      // after create, update local state pointer
      if (mode === 'new' && data.ref) currentRecordRef = data.ref;

      // refresh list
      await loadFiles();
      renderTable();

      myOffcanvas?.hide();
      form.classList.remove('was-validated');

      showAlert(mode === 'new'
        ? `Operations file created: ${data.ref || '(ref)'}`
        : 'Changes saved successfully.'
      );

    } catch (e) {
      console.error(e);
      showAlert('Network/server error while saving.');
    } finally {
      saveBusy = false;
      btn.disabled = false;
      btn.innerHTML = prevHtml || '<i class="fa-solid fa-save me-2"></i>Save';
    }
  }

  /* ============================================================
     SEARCH HANDLER — reload from DB
     IMPORTANT: update your input:
       onkeyup="onSearchKeyup()"
     (not renderTable()) if you want DB searching.
  ============================================================ */
  let searchTimer = null;
  function onSearchKeyup() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      await loadFiles();
      renderTable();
    }, 250);
  }

  /* ============================================================
     INIT
  ============================================================ */
  document.addEventListener('DOMContentLoaded', async () => {
    // Safe offcanvas init
    const oc = document.getElementById('opsOffcanvas');
    if (oc) myOffcanvas = bootstrap.Offcanvas.getOrCreateInstance(oc);

    // Ensure opp logic is aligned on load
    toggleOppLogic();

    // Ensure change handlers exist
    $('serviceType')?.addEventListener('change', handleServiceChange);
    $('linkOpportunity')?.addEventListener('change', toggleOppLogic);

    // Load clients (dropdown) and initial registry
    await loadClientsIntoSelect();
    await loadFiles();
    renderTable();
  });

  // Expose functions used by inline HTML onclick handlers
  window.openOffcanvas = openOffcanvas;
  window.submitFile = submitFile;
  window.handleServiceChange = handleServiceChange;
  window.toggleOppLogic = toggleOppLogic;
  window.onSearchKeyup = onSearchKeyup;
</script>


</body>
</html>
