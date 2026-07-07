<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['OPERATIONS']); 

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
$role = strtoupper((string)($me['role'] ?? 'OPERATIONS'));
$roleLabel = $roleLabelMap[$role] ?? 'OPERATIONS';
$showMargin = in_array($role, ['ADMIN', 'FINANCE', 'MANAGEMENT','OPERATIONS']);

// Avatar
$avatarName = urlencode($fullName);
$avatarUrl  = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";

// Greeting (optional)
$hour = (int)date('H');
$greeting = ($hour < 12) ? 'Good morning' : (($hour < 18) ? 'Good afternoon' : 'Good evening');

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
  
  <style>
    /* Page Specific Styles */
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

    .ops-offcanvas{ width:800px !important; }
    .ops-sticky-footer{ position: sticky; bottom: 0; z-index: 5; }
    
    /* NEW: Container Logic & Upload Styles */
    .cnt-row { background: #f8f9fa; border-radius: 6px; padding: 8px; margin-bottom: 8px; border: 1px solid #e9ecef; display: flex; gap: 10px; align-items: center; }
    .cnt-row:hover { background: #fff; border-color: #dee2e6; }
    
    .doc-upload-box { border: 2px dashed #cbd5e1; border-radius: 8px; padding: 20px; text-align: center; cursor: pointer; background: #f8fafc; transition: all 0.2s; }
    .doc-upload-box:hover { border-color: var(--smart-blue); background: #f0f9ff; }
    .doc-list-item { background: #fff; border: 1px solid #e2e8f0; padding: 10px; border-radius: 6px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; }
    .doc-ico {
      width: 34px; height: 34px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
      background: #fff;
    }
    .doc-ico:hover { background: #f8fafc; }

    /* Pulse Animation for Late Files */
    @keyframes pulse-red {
      0% { box-shadow: 0 0 0 0 rgba(220, 53, 69, 0.7); }
      70% { box-shadow: 0 0 0 6px rgba(220, 53, 69, 0); }
      100% { box-shadow: 0 0 0 0 rgba(220, 53, 69, 0); }
    }
    .ops-pulse-red {
      animation: pulse-red 2s infinite;
    }
  </style>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css">
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
                <span><i class="fa-solid fa-database category-icon"></i>MASTER DATA MGMT</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="ops1" class="accordion-collapse collapse" data-bs-parent="#opsMenu">
                <div class="sub-menu">
                    <a href="client-master-registry" class="sub-link">Client Master Registry</a>
                    <a href="supplier-master-registry" class="sub-link">Supplier Master Registry</a>
                    <a href="financial-dictionary" class="sub-link">Financial Dictionary</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#ops2">
                <span><i class="fa-solid fa-laptop-code category-icon"></i>SIMULATIONS</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="ops2" class="accordion-collapse collapse" data-bs-parent="#opsMenu">
                <div class="sub-menu">
                    <a href="extra-charges-simulator" class="sub-link">Extra Charges Simulator</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#ops3">
                <span><i class="fa-solid fa-gears category-icon"></i>OPS EXECUTION</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="ops3" class="accordion-collapse collapse show" data-bs-parent="#opsMenu">
                <div class="sub-menu">
                    <a href="operations-registry" class="sub-link active">Operations File Registry</a>
                    <a href="transit-order.php" class="sub-link">Transit Order (OT)</a>
                    <a href="operational-milestone-tracking" class="sub-link">Operational Milestone Tracking</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#ops4">
                <span><i class="fa-solid fa-truck-ramp-box category-icon"></i>OPS DELIVERY</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="ops4" class="accordion-collapse collapse" data-bs-parent="#opsMenu">
                <div class="sub-menu">
                    <a href="delivery-note" class="sub-link">Delivery Note</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#ops5">
                <span><i class="fa-solid fa-money-bill-trend-up category-icon"></i>OPS COST CONTROL</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="ops5" class="accordion-collapse collapse" data-bs-parent="#opsMenu">
                <div class="sub-menu">
                    <a href="costing-module" class="sub-link">Costing Module</a>
                    <a href="cost-tracking" class="sub-link">Cost Tracking Master</a>
                    <a href="operational-cost-reconciliation" class="sub-link">Operational Cost Reconciliation</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#ops6">
                <span><i class="fa-solid fa-building-columns category-icon"></i>FINANCE & TREASURY</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="ops6" class="accordion-collapse collapse" data-bs-parent="#opsMenu">
                <div class="sub-menu">
                    <a href="cash-request" class="sub-link">Cash Request</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#ops7">
                <span><i class="fa-solid fa-box-archive category-icon"></i>COMPANY ARCHIVE</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="ops7" class="accordion-collapse collapse" data-bs-parent="#opsMenu">
                <div class="sub-menu">
                    <a href="documents-vault" class="sub-link">Documents Vault</a>
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
      <h5 class="mb-0 fw-bold text-dark">Operations Registry</h5>
      <small class="text-muted" style="font-size: 0.7rem;">OPS FILE REGISTRY</small>
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
        <h2 class="fw-bold font-heading mb-0">File Management</h2>
        <p class="text-muted mb-0 small">Manage all Logistics Engagements and Cost Controls.</p>
      </div>
      <div class="col-md-6 text-end">
        <button class="btn btn-outline-success fw-bold px-3 py-2 shadow-sm me-2" onclick="exportToExcel()">
          <i class="fa-solid fa-file-csv me-2"></i>Export
        </button>
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
            <div class="ops-kpi-value" id="kpi-total">0</div>
            <small class="text-success fw-bold" style="font-size:.7rem;">All Time</small>
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
            <div class="ops-kpi-value text-primary" id="kpi-active">0</div>
            <small class="text-muted" style="font-size:.7rem;">In Progress</small>
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
            <div class="ops-kpi-value text-warning" id="kpi-fin-pending">0</div>
            <small class="text-muted" style="font-size:.7rem;">Ops Done, Unpaid</small>
          </div>
        </div>
      </div>

      <?php if ($showMargin): ?>
      <div class="col-md-3">
        <div class="ops-card-custom p-3 d-flex align-items-center bg-dark text-white border-0 position-relative overflow-hidden">
          <div class="position-relative z-2">
            <div class="ops-kpi-title text-white-50">Realized Margin (Total)</div>
            <div class="ops-kpi-value text-white" id="kpi-margin">-- <span class="fs-6 fw-normal text-white-50">XAF</span></div>
            <small class="text-success fw-bold" style="font-size:.7rem;">(Invoice - OCR)</small>
          </div>
          <i class="fa-solid fa-chart-pie position-absolute text-white opacity-10" style="font-size:60px; right:-10px; bottom:-10px;"></i>
        </div>
      </div>
      <?php endif; ?>
      
    </div>

    <div class="ops-card-custom p-0 overflow-hidden">
      <div class="p-3 border-bottom bg-light d-flex justify-content-between align-items-center flex-wrap gap-2">
        <h6 class="fw-bold mb-0 text-uppercase text-muted small"><i class="fa-solid fa-list me-2"></i>Master Record List</h6>
        
        <div class="d-flex gap-2">
           <select class="form-select form-select-sm ops-smart-input" style="width:150px;" id="filterType" onchange="onSearchKeyup()">
             <option value="">All Services</option>
             <option value="SEA_FREIGHT_IMPORT">Sea Import</option>
             <option value="SEA_FREIGHT_EXPORT">Sea Export</option>
             <option value="HINTERLAND_TRANSIT">Hinterland</option>
             <option value="AIR_FREIGHT_IMPORT">Air Import</option>
             <option value="AIR_FREIGHT_EXPORT">Air Export</option>
             <option value="WAREHOUSING">Warehousing</option>
           </select>
           
           <div class="input-group input-group-sm" style="width: 200px;">
             <span class="input-group-text bg-white border-end-0"><i class="fa-solid fa-search text-muted"></i></span>
             <input type="text" class="form-control border-start-0 ps-0 ops-smart-input" placeholder="Ref or Client..." id="searchInput" onkeyup="onSearchKeyup()">
           </div>
        </div>
      </div>

      <div class="table-responsive">
        <table class="table table-hover ops-table-custom mb-0 align-middle">
          <thead>
  <th class="ps-4">Ops File Ref</th>
<th>Dates</th>
<th>Client</th>
<th>Service Type</th>
<th>Status</th>

<?php if(in_array($role, ['ADMIN','FINANCE','MANAGEMENT'])): ?>
    <th>Margin</th>
<?php endif; ?>

<th class="text-center">Docs</th>
<th class="text-end pe-4">Actions</th>
</thead>
          <tbody id="table-body"></tbody>
        </table>
      </div>
      
      <div class="p-3 border-top bg-light d-flex justify-content-between align-items-center">
         <div class="small text-muted" id="pagination-info">Showing 0 to 0 of 0</div>
         <nav>
           <ul class="pagination pagination-sm mb-0">
             <li class="page-item"><button class="page-link" onclick="changePage(-1)" id="btn-prev">Previous</button></li>
             <li class="page-item disabled"><span class="page-link" id="page-display">1</span></li>
             <li class="page-item"><button class="page-link" onclick="changePage(1)" id="btn-next">Next</button></li>
           </ul>
         </nav>
      </div>
    </div>

  </div>

  <div class="offcanvas offcanvas-end ops-offcanvas" tabindex="-1" id="opsOffcanvas" data-bs-backdrop="static">
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
              <input type="text" class="form-control ops-smart-input" id="oppIdField" placeholder="e.g. OPP-2024-991" required list="oppIdList">
              <div class="invalid-feedback">Opportunity ID is required.</div>
              <datalist id="oppIdList"></datalist>
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
          <div class="col-md-12 position-relative">
            <label class="form-label">Client (Bill To) <span class="text-danger">*</span></label>
            <input type="text" class="form-control ops-smart-input" id="clientSearch" 
                   placeholder="Type 2+ characters to search..." autocomplete="off" oninput="handleClientSearch(this)">
            <input type="hidden" id="clientBillTo">
            <div id="clientSuggestions" class="list-group position-absolute w-100 shadow-lg d-none" 
                 style="z-index: 1050; max-height: 200px; overflow-y: auto;"></div>
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

        <div class="col-md-6 mt-3">
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
          
          <div class="col-12 mt-4">
            <div class="d-flex justify-content-between align-items-end mb-2">
  <label class="form-label fw-bold text-primary mb-0">
    <i class="fa-solid fa-truck-fast me-2"></i>Container Configuration
  </label>
  
  <div class="d-flex gap-2">
    <button type="button" class="btn btn-sm btn-warning fw-bold d-none text-dark" id="btnAnalyzeCargo" onclick="analyzeCargoSource()" title="Auto-detect containers from description">
        <i class="fa-solid fa-wand-magic-sparkles me-1"></i> Smart Fill
    </button>

    <button type="button" class="btn btn-sm btn-outline-primary fw-bold" onclick="addContainerLine()">
      <i class="fa-solid fa-plus me-1"></i> Add Line
    </button>
  </div>
</div>
            
            <div id="container-rows-wrapper" class="mb-3"></div>

            <label class="small text-muted mb-1">Marks & Numbers (Generated)</label>
            <div class="input-group">
              <span class="input-group-text bg-white border-end-0"><i class="fa-solid fa-barcode text-muted"></i></span>
              <input type="text" class="form-control ops-smart-input border-start-0 bg-light text-dark fw-bold font-monospace" id="marksNumbers" readonly placeholder="No containers added">
            </div>
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
              <div class="form-text small text-muted">Triggers Traffic Light Alerts.</div>
            </div>
          </div>
        </div>

        <div id="dynamic-section-container" class="mt-4"></div>

        <h6 class="ops-form-section-title mt-5"><i class="fa-solid fa-vault me-2 text-warning"></i>Document Vault</h6>
        <div class="bg-white border rounded p-3">
          <div class="mb-3">
            <label class="form-label small fw-bold text-muted">Attached Documents</label>
            <div id="file-list-container">
              <div class="text-muted small fst-italic mb-2">No documents attached yet.</div>
            </div>
          </div>

          <div class="doc-upload-box" onclick="triggerFileUpload()">
            <i class="fa-solid fa-cloud-arrow-up fs-3 text-secondary mb-2"></i>
            <div class="fw-bold text-dark small">Click to Upload Document</div>
            <div class="text-muted" style="font-size: 0.7rem;">PDF, PNG, JPG (Max 5MB)</div>
            <input type="file" id="opsFileInput" class="d-none" accept=".pdf,.jpg,.jpeg,.png" onchange="handleFileSelect(this)">
          </div>
          <div id="upload-status-bar" class="mt-2 small text-primary fw-bold"></div>
        </div>

        <div class="d-flex justify-content-end gap-2 mt-5 pt-3 border-top bg-white ops-sticky-footer">
          <button type="button" class="btn btn-light fw-bold" data-bs-dismiss="offcanvas">Cancel</button>
          <button type="submit" class="btn btn-dark fw-bold" id="btn-submit-text">
            <i class="fa-solid fa-save me-2"></i>Create Operations File
          </button>
        </div>
      </form>
    </div>
  </div>
  
  <div class="modal fade" id="docsModal" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog modal-lg modal-dialog-scrollable">
      <div class="modal-content">
        <div class="modal-header">
          <div>
            <h5 class="modal-title fw-bold mb-0">Attachments</h5>
            <small class="text-muted" id="docsModalSubtitle">—</small>
          </div>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <div id="docsModalBody" class="small text-muted">Loading...</div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-light fw-bold" data-bs-dismiss="modal">Close</button>
        </div>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

<script>
function fmtDate(d) {
    if(!d) return '-';
    // Returns dd/mm/yyyy HH:mm (24h)
    return new Date(d).toLocaleString('en-GB', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
    }).replace(',', '');
}
  if (typeof toggleClock !== 'function') {
    function toggleClock() { /* noop */ }
  }

  function updateClock() {
    const el = document.getElementById('realtime-clock');
    if (el) el.innerText = new Date().toLocaleTimeString();
  }
  setInterval(updateClock, 1000);
  updateClock();

  /* ---------------------------
     ADMIN view only
   ---------------------------- */
  /* ---------------------------
     Role & Permissions
   ---------------------------- */
  // --- PATCH 1: PERMISSION CHECK ---
const currentRole = '<?php echo $role; ?>';
// Define who has full access (Edit everything)
const isSuperUser = ['ADMIN', 'MANAGEMENT'].includes(currentRole);
  
  // This decides if they can see the margin
  const canViewMargin = ['ADMIN', 'FINANCE', 'MANAGEMENT'].includes(currentRole);

  let currentRecordRef = null;

  /* ---------------------------
     API ENDPOINTS
   ---------------------------- */
  const OPS_LIST_API    = '../../api/operations_files/list.php';
  const OPS_GET_API     = '../../api/operations_files/get.php';
  const OPS_SAVE_API    = '../../api/operations_files/save.php';
  const GET_OPPORTUNITY_LIST_API = '../../api/quote_requests/get-opportunity.php';
  const CLIENT_LIST_API = '../../api/operations_files/list-ops.php';
  const DOC_LIST_DOC_API = '../../api/operations_files/list_docs.php';
  const DOC_UPLOAD_API  = '../../api/operations_files/upload.php'; 
  const EXPORT_API      = '../../api/operations_files/export.php'; 

  /* ---------------------------
     STATE
   ---------------------------- */
  let files = [];      
  let listBusy = false;
  let saveBusy = false;
  
  // PAGINATION STATE
  let currentPage = 1;
  let totalRows = 0;
  let totalPages = 1;

  let oppCache = [];
  let oppCacheLoaded = false;
  
  // NEW STATES
  let containerLines = [];
  let tempDocs = [];
  let pendingUploads = [];

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
    const el = document.getElementById('operationsStatus');
    if (!el) return;
    if (isRequired) el.setAttribute('required', '');
    else el.removeAttribute('required');
  }

  // --- TRAFFIC LIGHT LOGIC (Updated per request) ---
  function getTrafficLight(createdStr, expectedStr, status) {
    // 1. Format Creation Date (Top Line) using helper
    const dCreated = fmtDate(createdStr);
    let html = `<div class="text-muted small fw-bold">${dCreated}</div>`;

    // 2. If no expected date, show nothing below
    if (!expectedStr) return html;

    const due = new Date(expectedStr);
    const now = new Date();
    
    // Format the date for the badge (DD/MM/YYYY HH:mm)
    const dateText = fmtDate(expectedStr);
    
    // Logic: Is the file operationally done?
    const isDelivered = ['OPERATIONALLY_COMPLETED', 'FINANCIALLY_PENDING', 'CLOSED'].includes(status);

    let badgeClass = '';
    let label = '';
    let pulseClass = '';

    if (isDelivered) {
        // SCENARIO: Delivered
        badgeClass = 'bg-success text-white border-success';
        label = `Delivered: ${dateText}`;
    } else {
        // SCENARIO: Active / Open
        const diffTime = due - now;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

        if (diffDays < 0) {
            badgeClass = 'bg-danger text-white border-danger';
            pulseClass = 'ops-pulse-red';
        } else if (diffDays <= 2) {
            badgeClass = 'bg-warning text-dark border-warning';
        } else {
            badgeClass = 'bg-light text-dark border-secondary'; 
        }
        label = `Est: ${dateText}`;
    }

    // 3. Render the Box
    html += `
      <div class="mt-1">
        <span class="badge ${badgeClass} ${pulseClass} border" 
              style="font-size:0.75rem; font-weight:600; padding:5px 8px; letter-spacing:0.3px;">
          ${label}
        </span>
      </div>
    `;

    return html;
}

  // --- EXPORT FUNCTION ---
  function exportToExcel() {
    const q = (document.getElementById('searchInput')?.value || '').trim();
    const type = document.getElementById('filterType')?.value || '';
    
    // Build URL query
    let url = `${EXPORT_API}?q=${encodeURIComponent(q)}&type=${encodeURIComponent(type)}`;
    window.location.href = url;
  }

  /* --- CLIENT AUTOFILL --- */
  let clientSearchTimer = null;
  async function handleClientSearch(input) {
    const val = input.value.trim();
    const listDiv = document.getElementById('clientSuggestions');
    const hiddenId = document.getElementById('clientBillTo');
    
    // Clear ID if typing changes
    hiddenId.value = ''; 
    
    if (val.length < 2) {
      listDiv.classList.add('d-none');
      return;
    }

    clearTimeout(clientSearchTimer);
    clientSearchTimer = setTimeout(async () => {
      try {
        const res = await fetch(CLIENT_LIST_API, { credentials: 'same-origin' });
        const data = await res.json();
        if(!data.ok) return;

        const matches = data.rows.filter(c => 
           c.client_name.toLowerCase().includes(val.toLowerCase()) || 
           c.client_id.toLowerCase().includes(val.toLowerCase())
        ).slice(0, 10); // Limit results

        if (matches.length === 0) {
           listDiv.innerHTML = '<div class="list-group-item text-muted small">No clients found</div>';
        } else {
           listDiv.innerHTML = matches.map(c => `
             <a href="#" class="list-group-item list-group-item-action" 
                onclick="selectClient('${c.client_id}', '${c.client_name.replace(/'/g, "\\'")}')">
               <div class="fw-bold text-dark">${c.client_name}</div>
               <small class="text-muted">${c.client_id}</small>
             </a>
           `).join('');
        }
        listDiv.classList.remove('d-none');
      } catch(e) { console.error(e); }
    }, 300);
  }

  function selectClient(id, name) {
    document.getElementById('clientBillTo').value = id;
    document.getElementById('clientSearch').value = name;
    document.getElementById('clientSuggestions').classList.add('d-none');
  }
  
  // Hide suggestions if clicking outside
  document.addEventListener('click', function(e) {
    if (!e.target.closest('#clientSearch')) {
       document.getElementById('clientSuggestions')?.classList.add('d-none');
    }
  });


  /* ============================================================
     DB LOAD
   ============================================================ */
  async function loadFiles() {
    if (listBusy) return;
    listBusy = true;

    const q = (document.getElementById('searchInput')?.value || '').trim();
    const type = document.getElementById('filterType')?.value || '';

    // Pass page and filters
    const url = `${OPS_LIST_API}?q=${encodeURIComponent(q)}&type=${encodeURIComponent(type)}&page=${currentPage}`;

    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      const data = await res.json();
      
      if (!data.ok) {
        files = [];
        alert(data.error || 'Failed to load.');
        return;
      }

      files = data.rows || [];
      
      // Update Pagination UI
      totalRows = data.meta.total_rows;
      totalPages = Math.ceil(totalRows / data.meta.limit) || 1;
      document.getElementById('page-display').innerText = currentPage;
      document.getElementById('pagination-info').innerText = `Showing page ${currentPage} of ${totalPages} (${totalRows} total)`;
      
      document.getElementById('btn-prev').parentElement.classList.toggle('disabled', currentPage <= 1);
      document.getElementById('btn-next').parentElement.classList.toggle('disabled', currentPage >= totalPages);

      // Update KPIs
      if (data.summary) {
        document.getElementById('kpi-total').innerText = data.meta.total_rows;
        document.getElementById('kpi-active').innerText = data.summary.total_active;
        document.getElementById('kpi-fin-pending').innerText = data.summary.total_pending;
        document.getElementById('kpi-margin').innerHTML = `${Number(data.summary.total_margin).toLocaleString()} <span class="fs-6 fw-normal text-white-50">XAF</span>`;
      }

      renderTable();

    } catch (e) {
      console.error(e);
      alert('Network/server error.');
    } finally {
      listBusy = false;
    }
  }

  function changePage(delta) {
    const next = currentPage + delta;
    if (next < 1 || next > totalPages) return;
    currentPage = next;
    loadFiles();
  }

  function renderTable() {
    const tbody = document.getElementById('table-body');
    if (!tbody) return;

    if (files.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">No records found.</td></tr>';
        return;
    }

    tbody.innerHTML = files.map(r => {
      const meta = statusConfig[r.operations_status] || { class: 'bg-dark', tooltip: '' };
      
      // Traffic Light Date
      const dateHtml = getTrafficLight(r.created_at, r.expected_delivery_time, r.operations_status);

      const attachHtml = r.doc_count > 0
        ? `<button type="button" class="btn btn-sm btn-light border fw-bold" onclick="openDocsModal('${r.ref}')">
             <i class="fa-solid fa-paperclip text-muted me-1"></i> ${r.doc_count}
           </button>`
        : `<span class="text-muted small">-</span>`;

      const marginCell = canViewMargin 
        ? `<td><span class="fw-bold text-dark">${Number(r.calculated_margin).toLocaleString()}</span></td>` 
        : '';

      return `
        <tr>
          <td class="ps-4"><span class="ops-ref-badge">${r.ref}</span></td>
          <td>${dateHtml}</td>
          <td class="fw-bold text-dark" style="font-size:.85rem">${r.client_name || r.client_id}</td>
          <td><span class="badge bg-light text-dark border fw-normal">${r.service_type.replace(/_/g,' ')}</span></td>
          <td>
            <span class="badge ${meta.class} ops-status-pill rounded-pill px-3 py-2" title="${meta.tooltip}">
              ${r.operations_status.replace(/_/g,' ')}
            </span>
          </td>
          
          ${marginCell}
          
          <td class="text-center">${attachHtml}</td>
          <td class="text-end pe-4">
  <button onclick="openOffcanvas('view','${r.ref}')" class="btn btn-sm ${isSuperUser ? 'btn-outline-dark' : 'btn-outline-primary'} fw-bold">
    <i class="fa-solid ${isSuperUser ? 'fa-gear' : 'fa-eye'}"></i> 
    ${isSuperUser ? 'Manage' : 'View'}
</button>
</td>
        </tr>
      `;
    }).join('');
  }

  /* ============================================================
     HINTERLAND & FORM LOGIC
   ============================================================ */
  function toggleEtaAta(type) {
    const etaAta = document.getElementById('etaAtaSection');
    if (!etaAta) return;
    const hideFor = ['BUSINESS_REPRESENTATION', 'WAREHOUSING'];
    const shouldShow = type && !hideFor.includes(type);
    etaAta.classList.toggle('d-none', !shouldShow);
  }

  // --- DYNAMIC SECTIONS ---
  function renderDynamicSections(type) {
    const container = document.getElementById('dynamic-section-container');
    if (!container) return;
    let html = '';

    // Helper HTML generators
    const seaHtml = `
       <h6 class="ops-form-section-title text-primary"><i class="fa-solid fa-ship me-2"></i>Sea Freight Details</h6>
       <div class="row g-3">
         <div class="col-md-6"><label class="form-label">Bill of Lading</label><input type="text" class="form-control ops-smart-input" id="sea_bl"></div>
         <div class="col-md-6"><label class="form-label">Vessel Name</label><input type="text" class="form-control ops-smart-input" id="sea_vessel"></div>
         <div class="col-md-4"><label class="form-label">Voyage №</label><input type="text" class="form-control ops-smart-input" id="sea_voyage"></div>
         <div class="col-md-4"><label class="form-label">POL</label><input type="text" class="form-control ops-smart-input" id="sea_pol"></div>
         <div class="col-md-4"><label class="form-label">POD</label><input type="text" class="form-control ops-smart-input" id="sea_pod"></div>
       </div>`;

    const inlandHtml = `
       <h6 class="ops-form-section-title text-warning mt-4"><i class="fa-solid fa-truck me-2"></i>Inland/Transit Details</h6>
       <div class="row g-3">
         <div class="col-md-6"><label class="form-label">Truck Plate / Ref</label><input type="text" class="form-control ops-smart-input" id="inland_truck"></div>
         <div class="col-md-6"><label class="form-label">Transit Declaration</label><input type="text" class="form-control ops-smart-input" id="inland_decl"></div>
         <div class="col-md-12"><label class="form-label">Border Points</label><input type="text" class="form-control ops-smart-input" id="inland_border"></div>
       </div>`;

    // LOGIC
    if (type.includes('SEA') || type === 'END_TO_END_SEA_FREIGHT') {
      html = seaHtml;
    } 
    else if (type === 'HINTERLAND_TRANSIT') {
      html = seaHtml + inlandHtml;
    }
    else if (type.includes('AIR') || type === 'END_TO_END_AIR_FREIGHT') {
      html = `
        <h6 class="ops-form-section-title text-info"><i class="fa-solid fa-plane me-2"></i>Air Freight Details</h6>
        <div class="row g-3">
          <div class="col-md-6"><label class="form-label">MAWB / HAWB</label><input type="text" class="form-control ops-smart-input" id="air_mawb"></div>
          <div class="col-md-6"><label class="form-label">Airline</label><input type="text" class="form-control ops-smart-input" id="air_airline"></div>
          <div class="col-md-4"><label class="form-label">Flight No</label><input type="text" class="form-control ops-smart-input" id="air_flightno"></div>
          <div class="col-md-4"><label class="form-label">Origin Airport</label><input type="text" class="form-control ops-smart-input" id="air_origin"></div>
          <div class="col-md-4"><label class="form-label">Dest. Airport</label><input type="text" class="form-control ops-smart-input" id="air_dest"></div>
        </div>`;
    } 
    else if (type.includes('INLAND')) {
      html = inlandHtml;
    }
    else if (type === 'WAREHOUSING') {
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
    }
    else if (type === 'BUSINESS_REPRESENTATION') {
       html = `
        <h6 class="ops-form-section-title"><i class="fa-solid fa-briefcase me-2"></i>Representation Scope</h6>
        <div class="row g-3">
          <div class="col-12"><label class="form-label">Scope Summary</label><textarea class="form-control ops-smart-input" id="rep_scope"></textarea></div>
          <div class="col-md-6"><label class="form-label">Client Contact</label><input type="text" class="form-control ops-smart-input" id="rep_contact"></div>
        </div>`;
    }

    container.innerHTML = html;
  }

  function handleServiceChange() {
    const type = document.getElementById('serviceType')?.value || '';
    toggleEtaAta(type);
    renderDynamicSections(type);
    
    // Attempt to restore data if available
    const form = document.getElementById('opsForm');
    if (form && form.dataset.detailsJson) {
       try { populateDynamicFields({ details: JSON.parse(form.dataset.detailsJson) }); } catch (_) {}
    }

    // Ref Generation Logic for New Files
    const refDisplay = document.getElementById('display-ref');
    if (refDisplay?.dataset.mode === 'new' && type) {
       const suffix = suffixMap[type] || 'XX';
       const random = Math.floor(1000000 + Math.random() * 9000000);
       refDisplay.innerText = `SL${random}${suffix}`;
    }
  }

  /* ============================================================
     COMMON UTILS
   ============================================================ */
  
  function safeSetValue(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    
    if (el.type === 'datetime-local' && value) {
        el.value = value.replace(' ', 'T').slice(0, 16);
    } else {
        el.value = (value ?? '');
    }
  }

  function safeGetValue(id) {
    const el = document.getElementById(id);
    return el ? (el.value ?? '') : '';
  }

  function populateDynamicFields(file) {
    const d = file.details || {};
    const ids = ['sea_bl','sea_vessel','sea_voyage','sea_pol','sea_pod',
                 'air_mawb','air_airline','air_flightno','air_origin','air_dest',
                 'inland_truck','inland_decl','inland_border',
                 'warehouse_loc','warehouse_bonded','warehouse_stockin',
                 'rep_scope','rep_contact'];
    ids.forEach(id => safeSetValue(id, d[id]));
  }

  function collectDetailsFromForm(type) {
    const details = {
      linkOpportunity: document.getElementById('linkOpportunity')?.checked || false,
      oppIdField: safeGetValue('oppIdField'),
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
    };

    const ids = ['sea_bl','sea_vessel','sea_voyage','sea_pol','sea_pod',
                 'air_mawb','air_airline','air_flightno','air_origin','air_dest',
                 'inland_truck','inland_decl','inland_border',
                 'warehouse_loc','warehouse_bonded','warehouse_stockin',
                 'rep_scope','rep_contact'];
    ids.forEach(id => { details[id] = safeGetValue(id); });

    return details;
  }

  async function openOffcanvas(mode, ref) {
    // --- 1. DEFINE VARIABLES ONCE ---
    const form = document.getElementById('opsForm');
    const blocker = document.getElementById('readonly-blocker');
    const btn = document.getElementById('btn-submit-text');
    const refDisplay = document.getElementById('display-ref'); // Moved this up

    // --- PATCH: If not ADMIN/MANAGEMENT, force read-only mode ---
    if (!isSuperUser && mode !== 'create') {
        blocker.classList.remove('d-none'); // Show the lock screen
        btn.classList.add('d-none');        // Hide the Save button
    } else {
        blocker.classList.add('d-none');
        btn.classList.remove('d-none');
    }

    // --- DELETE THE DUPLICATE LINES THAT WERE HERE ---
    // (I have removed the 4 lines that caused the crash)

    // Reset autofill UI
    document.getElementById('clientSearch').value = '';
    document.getElementById('clientBillTo').value = '';

    // Reset Containers & Docs
    containerLines = []; renderContainerRows(); 
    tempDocs = []; renderFileList();
    pendingUploads = [];
    safeSetValue('marksNumbers', '');

    if (mode === 'create') {
      currentRecordRef = null;
      form.reset();
      setStatusRequired(true);
      
      refDisplay.innerText = "SL-------XX";
      refDisplay.dataset.mode = 'new';
      document.getElementById('offcanvasTitle').innerText = 'New Operations File';
      document.getElementById('dynamic-section-container').innerHTML = '';
      toggleEtaAta('');
      
      toggleOppLogic();
      
      blocker.classList.add('d-none');
      btn.disabled = false;
      
      const bsOffcanvas = bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('opsOffcanvas'));
      bsOffcanvas.show();
      return;
    }

    if (!ref) return;

    try {
      const res = await fetch(`${OPS_GET_API}?ref=${encodeURIComponent(ref)}`, { credentials: 'same-origin' });
      const data = await res.json();
      if (!data.ok) { alert(data.error); return; }

      const record = data.record || {};
      const details = record.details || {};
      currentRecordRef = record.ref;
      
      loadDocsForRef(currentRecordRef);

      form.reset();
      form.dataset.detailsJson = JSON.stringify(details);
      
      refDisplay.innerText = currentRecordRef;
      refDisplay.dataset.mode = 'view';
      document.getElementById('offcanvasTitle').innerText = 'Manage Operations File';

      // ADD THIS LINE HERE:
      document.getElementById('btn-submit-text').innerHTML = '<i class="fa-solid fa-save me-2"></i>Save Changes';

      document.getElementById('clientBillTo').value = record.client_id;
      document.getElementById('clientSearch').value = record.client_name;
      
      safeSetValue('serviceType', record.service_type);
      safeSetValue('serviceTerritory', record.service_territory);
      safeSetValue('oppIdField', record.opportunity_id);
      
      if (document.getElementById('linkOpportunity')) {
         document.getElementById('linkOpportunity').checked = !!details.linkOpportunity;
         toggleOppLogic();
      }

      safeSetValue('operationsStatus', record.operations_status);
      safeSetValue('commodityShort', record.commodity);
      safeSetValue('commodityDesc', details.commodityDesc);
      safeSetValue('grossWeight', record.gross_weight);
      safeSetValue('pkgCount', record.package_count);
      safeSetValue('weightUnit', record.weight_unit);
      safeSetValue('incoterm', details.incoterm);
      
      if (details.marksNumbers) {
          parseMarksToRows(details.marksNumbers);
          safeSetValue('marksNumbers', details.marksNumbers);
      }

      safeSetValue('placeReceipt', details.placeReceipt);
      safeSetValue('placeDelivery', details.placeDelivery);
      safeSetValue('etaField', details.etaField);
      safeSetValue('ataField', details.ataField);
      safeSetValue('expectedDeliveryTime', record.expected_delivery_time);

      handleServiceChange(); 
      
      const isClosed = (record.operations_status === 'CLOSED');
      blocker.classList.toggle('d-none', !isClosed);
      
      // --- PATCH 2: LOCK RESTRICTED USERS ---
    // This runs after all data/dynamic fields are loaded
    if (!isSuperUser && mode !== 'create') {
        const form = document.getElementById('opsForm');
        const btn = document.getElementById('btn-submit-text');
        
        // 1. Disable ALL inputs, selects, and textareas by default
        form.querySelectorAll('input, select, textarea, button').forEach(el => {
            // Don't disable the "X" close buttons
            if (el.getAttribute('data-bs-dismiss')) return; 
            
            el.disabled = true;
            // Add grey background for visual cue (except buttons)
            if(el.tagName !== 'BUTTON') el.classList.add('bg-light');
        });

        // 2. Whitelist: Re-enable ONLY ETA, ATA, Delivery Time, and Uploads
        const allowedIds = ['etaField', 'ataField', 'expectedDeliveryTime', 'opsFileInput', 'btn-submit-text'];
        allowedIds.forEach(id => {
            const el = document.getElementById(id);
            if(el) {
                el.disabled = false;
                el.classList.remove('bg-light');
                el.classList.add('border-primary'); // Blue border to show it's editable
            }
        });

        // 3. Update the Save Button text to be clear
        if(btn) btn.innerHTML = '<i class="fa-solid fa-clock me-2"></i>Update Timing & Docs';
    } else if (mode !== 'create') {
        // Reset for Admins (in case previous open was restricted)
        document.getElementById('btn-submit-text').disabled = false;
        document.getElementById('opsForm').querySelectorAll('.bg-light').forEach(el => el.classList.remove('bg-light'));
        document.getElementById('opsForm').querySelectorAll(':disabled').forEach(el => el.disabled = false);
    }
    // --- END PATCH 2 ---
      
      const bsOffcanvas = bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('opsOffcanvas'));
      bsOffcanvas.show();

    } catch (e) {
      console.error(e);
      alert('Error loading record.');
    }
  }

  function toggleOppLogic() {
     const isLinked = document.getElementById('linkOpportunity')?.checked;
     const div = document.getElementById('opp-input-container');
     const warn = document.getElementById('direct-entry-warning');
     const oppField = document.getElementById('oppIdField');
     const btn = document.getElementById('btn-submit-text');
     const mode = document.getElementById('display-ref')?.dataset.mode; // Check the mode

     if(isLinked) {
        div.classList.remove('d-none');
        warn.classList.add('d-none');
        oppField.setAttribute('required', '');
        loadOpportunityCache(); 
        
        // FIX: Only change text if creating NEW file
        if (mode === 'new') {
            btn.innerHTML = '<i class="fa-solid fa-save me-2"></i>Create Operations File';
            btn.className = 'btn btn-dark fw-bold';
        }
     } else {
        div.classList.add('d-none');
        warn.classList.remove('d-none');
        oppField.removeAttribute('required');
        
        // FIX: Only change text if creating NEW file
        if (mode === 'new') {
            btn.innerHTML = '<i class="fa-solid fa-paper-plane me-2"></i>Notify Sales & Create';
            btn.className = 'btn btn-warning fw-bold';
        }
     }
  }
  
  async function loadOpportunityCache() {
    if (oppCacheLoaded) return;
    try {
      const res = await fetch(GET_OPPORTUNITY_LIST_API, { credentials: 'same-origin' });
      const data = await res.json();
      const list = document.getElementById('oppIdList');
      
      if (list && data.ok) {
         list.innerHTML = data.rows.map(r => {
             // 1. Format the date (e.g., 2024-02-15)
             const dateObj = new Date(r.submission_datetime);
             const dateStr = !isNaN(dateObj) ? dateObj.toLocaleDateString('en-GB') : '';

             // 2. Create the label: "OPP-123 - Client Name (Date)"
             // Note: The 'value' is what fills the box, the text inside option is what displays in the helper
             return `<option value="${r.converted_opportunity_id}">${r.requester_name} (${dateStr})</option>`;
         }).join('');
         
         oppCacheLoaded = true;
      }
    } catch(e) { console.error("Opp Cache Error:", e); }
  }

  // FIXED: Added 'async' keyword at the start
  async function submitFile() {
    if (saveBusy) return;
    const form = document.getElementById('opsForm');
    
    // Validate Form
    if (!form.checkValidity()) {
        form.classList.add('was-validated');
        // Auto-scroll to error
        const firstInvalid = form.querySelector(':invalid');
        if (firstInvalid) {
            firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
            firstInvalid.focus();
        }
        return;
    }

    const refDisplay = document.getElementById('display-ref');
    const mode = refDisplay.dataset.mode;
    
    // Manual Check for Client ID
    const clientId = document.getElementById('clientBillTo').value;
    if (!clientId) {
        alert("Please select a valid client from the search.");
        return;
    }

    // Collect Payload
    const payload = {
       ref: (mode === 'new') ? '' : currentRecordRef,
       client_id: clientId,
       service_type: document.getElementById('serviceType').value,
       service_territory: document.getElementById('serviceTerritory').value,
       operations_status: document.getElementById('operationsStatus').value,
       opportunity_id: document.getElementById('oppIdField').value,
       commodity: document.getElementById('commodityShort').value,
       gross_weight: document.getElementById('grossWeight').value,
       weight_unit: document.getElementById('weightUnit').value,
       package_count: document.getElementById('pkgCount').value,
       expected_delivery_time: document.getElementById('expectedDeliveryTime').value, 
       details: collectDetailsFromForm(document.getElementById('serviceType').value)
    };

    saveBusy = true;
    const btn = document.getElementById('btn-submit-text');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
    btn.disabled = true;

    try {
       const res = await fetch(OPS_SAVE_API, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(payload),
          credentials: 'same-origin'
       });
       const data = await res.json();
       
       if (!data.ok) { 
           alert(data.error || 'Save failed'); 
           return; 
       }
       
       // Handle Queued Uploads (New File Mode)
       if (mode === 'new' && data.ref && pendingUploads.length) {
          // UPDATE: Loop through the objects {file, name} we created in handleFileSelect
          for (const item of pendingUploads) { 
              // 'await' is valid here because submitFile is async
              await uploadOneFile(data.ref, item.file, item.name); 
          }
       }
       
       const bsOffcanvas = bootstrap.Offcanvas.getInstance(document.getElementById('opsOffcanvas'));
       bsOffcanvas.hide();
       
       alert('Saved successfully!');
       loadFiles(); // Refresh table

    } catch (e) {
       console.error(e);
       alert('Save error.');
    } finally {
       saveBusy = false;
       btn.disabled = false;
       btn.innerHTML = originalText;
    }
  }

  let searchTimer = null;
  function onSearchKeyup() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        currentPage = 1;
        loadFiles();
    }, 300);
  }
  
  function addContainerLine(qty="", size="", type="") {
    containerLines.push({ qty, size, type });
    renderContainerRows();
    updateMarksString();
  }
  function renderContainerRows() {
    const wrapper = document.getElementById('container-rows-wrapper');
    if(!wrapper) return;
    
    // Mapped using 'l' (line) and 'i' (index) to match your existing data structure
    wrapper.innerHTML = containerLines.map((l, i) => `
      <div class="cnt-row">
        <input type="number" class="form-control form-control-sm" style="width:60px" value="${l.qty}" oninput="updateLineData(${i},'qty',this.value)" placeholder="Qty">
        
        <select class="form-select form-select-sm" onchange="updateLineData(${i},'size',this.value)">
           <option value="">Size</option>
           <option value="20'" ${l.size=="20'"?'selected':''}>20'</option>
           <option value="40'" ${l.size=="40'"?'selected':''}>40'</option>
           <option value="45'" ${l.size=="45'"?'selected':''}>45'</option>
        </select>

        <select class="form-select form-select-sm" onchange="updateLineData(${i},'type',this.value)">
           <option value="">Type</option>
           <option value="DC" ${l.type=='DC'?'selected':''}>DC (Dry)</option>
           <option value="HC" ${l.type=='HC'?'selected':''}>HC (High Cube)</option>
           <option value="OT" ${l.type=='OT'?'selected':''}>OT (Open Top)</option>
           <option value="FR" ${l.type=='FR'?'selected':''}>FR (Flat Rack)</option>
           <option value="RF" ${l.type=='RF'?'selected':''}>RF (Reefer)</option>
        </select>

        <button type="button" class="btn btn-sm text-danger" onclick="removeContainerLine(${i})">&times;</button>
      </div>
    `).join('');
}
  function updateLineData(i, k, v) { containerLines[i][k] = v; updateMarksString(); }
  function updateMarksString() {
     const str = containerLines.filter(l=>l.qty&&l.size).map(l=>`${l.qty}*${l.size}${l.type}`).join(', ');
     document.getElementById('marksNumbers').value = str;
  }
  function parseMarksToRows(str) {
     containerLines = [];
     if(str) str.split(',').forEach(p => {
        const [q, rest] = p.trim().split('*');
        if(q && rest) containerLines.push({qty:q, size:rest.substr(0,3), type:rest.substr(3)});
     });
     renderContainerRows();
  }

  async function loadDocsForRef(ref) {
     try {
       const res = await fetch(`${DOC_LIST_DOC_API}?ref=${ref}`, {credentials:'same-origin'});
       const data = await res.json();
       tempDocs = data.rows || [];
       renderFileList();
     } catch(e) {}
  }
  
  function renderFileList() {
     const box = document.getElementById('file-list-container');
     if (!box) return;

     if (!tempDocs.length) { 
         box.innerHTML = '<div class="text-muted small fst-italic">No documents attached yet.</div>'; 
         return; 
     }

     box.innerHTML = tempDocs.map(d => {
        // ROBUST NAME CHECK: Check all possible keys API might return
        const fileName = d.name 
                      || d.original_filename 
                      || d.original_name 
                      || d.stored_filename 
                      || 'Attachment';

        const url = d.view_url || d.url; 
        
        return `
        <div class="doc-list-item">
           <div class="d-flex align-items-center text-truncate">
             <i class="fa-solid fa-file text-secondary me-2"></i> 
             <span class="fw-bold text-dark small text-truncate" style="max-width: 200px;" title="${fileName}">
               ${fileName}
             </span>
           </div>
           <div>
            ${d.queued ? '<span class="badge bg-warning me-2" style="font-size:0.6rem">Queued</span>' : ''}
            ${!d.queued && url ? `<a href="${url}" target="_blank" class="btn btn-sm btn-outline-dark border-0 p-1" title="View"><i class="fa-solid fa-eye"></i></a>` : ''}
           </div>
        </div>
     `}).join('');
  }
  
  function triggerFileUpload() { document.getElementById('opsFileInput').click(); }
  function handleFileSelect(inp) {
     if(!inp.files[0]) return;
     const file = inp.files[0];
     
     // 1. Get extension (pdf, jpg, etc)
     const ext = file.name.split('.').pop();
     const baseName = file.name.replace(`.${ext}`, '');
     
     // 2. Ask User for Name
     let newName = prompt("Rename Document (Optional):", baseName);
     
     // Handle Cancel button (stop upload)
     if (newName === null) { inp.value = ''; return; }
     
     // Default if empty
     if (!newName.trim()) newName = baseName;
     
     // 3. Ensure extension is preserved (User might delete it)
     if (!newName.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) {
         newName += `.${ext}`;
     }

     if(!currentRecordRef) {
        // QUEUE MODE (Creating New File)
        // Store as object { file, name } so we can upload later
        pendingUploads.push({ file: file, name: newName });
        
        // Show the NEW name in the list immediately
        tempDocs.push({ name: newName, queued: true });
        renderFileList();
     } else {
        // DIRECT MODE (Editing File)
        // Upload immediately with the new name
        uploadOneFile(currentRecordRef, file, newName);
     }
     
     inp.value = ''; // Reset input to allow selecting same file again
  }
  async function uploadOneFile(ref, file, customName) {
      const fd = new FormData(); 
      fd.append('ref', ref); 
      
      // MAGIC FIX: The 3rd argument renames the file before sending to PHP
      // PHP will see this name in $_FILES['file']['name']
      const finalName = customName || file.name;
      fd.append('file', file, finalName);
      
      try {
          await fetch(DOC_UPLOAD_API, {method:'POST', body:fd, credentials:'same-origin'});
          if(currentRecordRef) loadDocsForRef(currentRecordRef); 
      } catch(e) { console.error(e); }
  }
  
  async function openDocsModal(ref) {
      const modalEl = document.getElementById('docsModal');
      const bodyEl = document.getElementById('docsModalBody');
      const subEl = document.getElementById('docsModalSubtitle');
      
      const bsModal = bootstrap.Modal.getOrCreateInstance(modalEl);
      subEl.textContent = `OPS Ref: ${ref}`;
      bodyEl.innerHTML = '<div class="text-muted small">Loading...</div>';
      bsModal.show();
      
      try {
         const res = await fetch(`${DOC_LIST_DOC_API}?ref=${ref}`, {credentials:'same-origin'});
         const data = await res.json();
         const rows = data.rows || [];
         
         if(!rows.length) {
             bodyEl.innerHTML = '<div class="text-muted small fst-italic">No documents found.</div>';
         } else {
             bodyEl.innerHTML = `<div class="list-group">` + rows.map(d => {
                // ROBUST VARIABLES: Handle different API key names
                const dateStr = d.uploaded_at || d.created_at || '';
                const fileName = d.name || d.original_filename || 'Attachment';
                
                return `
                <div class="list-group-item d-flex justify-content-between align-items-center">
                    <div>
                        <i class="fa-solid fa-file me-2 text-secondary"></i> 
                        <strong class="text-dark">${fileName}</strong>
                        <div class="small text-muted">${dateStr}</div>
                    </div>
                    <a href="${d.view_url}" target="_blank" class="btn btn-sm btn-outline-dark fw-bold">
                        <i class="fa-solid fa-eye me-1"></i> View
                    </a>
                </div>
             `;}).join('') + `</div>`;
         }
      } catch(e) {
         console.error(e);
         bodyEl.innerHTML = '<div class="text-danger">Failed to load documents.</div>';
      }
  }
  window.openDocsModal = openDocsModal;
  
  document.addEventListener('DOMContentLoaded', () => {
     loadFiles(); 
  });
  
  // EXPORTS
  window.loadFiles = loadFiles;
  window.changePage = changePage;
  window.openOffcanvas = openOffcanvas;
  window.submitFile = submitFile;
  window.handleServiceChange = handleServiceChange;
  window.toggleOppLogic = toggleOppLogic;
  window.onSearchKeyup = onSearchKeyup;
  window.handleClientSearch = handleClientSearch;
  window.selectClient = selectClient;
  window.exportToExcel = exportToExcel;
  window.addContainerLine = addContainerLine;
  window.removeContainerLine = removeContainerLine;
  window.updateLineData = updateLineData;
  window.triggerFileUpload = triggerFileUpload;
  window.handleFileSelect = handleFileSelect;
  window.removeContainerLine = removeContainerLine;
  
  /* -------------------------------------------------------------------------
   PHASE 3: SMART FILL LOGIC (OPPORTUNITY -> OPS FILE)
   ------------------------------------------------------------------------- */

// Global variable to store description for the "Smart Fill" button
let cachedCargoDesc = "";

// 1. Event Listener for Opportunity ID (Triggers Auto-Fill)
document.getElementById('oppIdField').addEventListener('change', async function() {
    const oppId = this.value.trim();
    if (oppId.length < 5) return; 

    // Visual loading cue
    this.style.backgroundColor = "#eef7fc"; 

    try {
        const res = await fetch(`../../api/quote_requests/get-opportunity-details.php?opp_id=${encodeURIComponent(oppId)}`, { credentials: 'same-origin' });
        const json = await res.json();

        if (json.ok && json.data) {
            const d = json.data;

            // A. Service Type (Flexible Matcher)
                if (d.service_type) {
                    const svcSelect = document.getElementById('serviceType');
                    if (svcSelect) {
                        const val = d.service_type.trim();
                        
                        // Try exact match first
                        svcSelect.value = val;

                        // If it didn't work, try replacing underscores with spaces or vice versa
                        if (svcSelect.value === "") {
                             const altVal = val.replace(/_/g, ' ');
                             svcSelect.value = altVal;
                        }

                        // If still nothing, loop through options and find partial match
                        if (svcSelect.value === "") {
                            for (let opt of svcSelect.options) {
                                if (opt.text === val || opt.value === val) {
                                    svcSelect.value = opt.value;
                                    break;
                                }
                            }
                        }

                        handleServiceChange(); 
                    }
                }

            // B. Client (Bill To) - Auto-Search
            // We fill the name and trigger the search so you can click the correct ID
            if (d.client_name) {
                const searchInput = document.getElementById('clientSearch');
                searchInput.value = d.client_name;
                searchInput.focus(); // Focus to show we are searching
                handleClientSearch(searchInput); // Trigger your existing search function
            }

            // C. Weight & Unit (Option A: Force KG)
            if (d.weight) {
                document.getElementById('grossWeight').value = d.weight;
                document.getElementById('weightUnit').value = 'KG';
            }

            // D. Places (Option A: Direct Copy)
            if (d.origin) document.getElementById('placeReceipt').value = d.origin;
            if (d.destination) document.getElementById('placeDelivery').value = d.destination;

            // E. Container Smart Fill Setup
            cachedCargoDesc = d.cargo_desc || "";
            const btnAnalyze = document.getElementById('btnAnalyzeCargo');
            
            if (cachedCargoDesc) {
                btnAnalyze.classList.remove('d-none');
                // Optional: Flash the button to draw attention
                btnAnalyze.classList.add('ops-pulse-red'); 
                setTimeout(() => btnAnalyze.classList.remove('ops-pulse-red'), 2000);
            } else {
                btnAnalyze.classList.add('d-none');
            }
        }
    } catch (e) {
        console.error("Auto-fill error", e);
    } finally {
        this.style.backgroundColor = ""; // Remove loading cue
    }
});

// 2. The "Smart Fill" / Analyze Function
function analyzeCargoSource() {
    if (!cachedCargoDesc) return;

    // Regex to find patterns like "10x40", "10*40", "5 20ft", "1x40HC"
    // Captures: 1=Qty, 2=Size(20/40/45), 3=Type(DC/HC/etc)
    const regex = /(\d+)\s*(?:x|\*|\s|-)?\s*(20|40|45)(?:'|ft|qt)?\s*(DC|HC|OT|FR|RF)?/gi;
    
    let matches = [...cachedCargoDesc.matchAll(regex)];
    let foundLines = [];

    if (matches.length > 0) {
        matches.forEach(m => {
            foundLines.push({
                qty: m[1],
                size: m[2] + "'", // Format for your dropdown (e.g., 40')
                type: m[3] || 'DC' // Default to DC if type is missing
            });
        });
    } else {
        // Fallback: Look for generic "10 containers" or "10 units"
        const simpleRegex = /(\d+)\s*(?:containers|cntrs|boxes|units)/gi;
        let simpleMatch = simpleRegex.exec(cachedCargoDesc);
        if (simpleMatch) {
            // Found Qty, but Size unknown. Leave size empty for user to pick.
            foundLines.push({ qty: simpleMatch[1], size: "", type: "DC" });
        }
    }

    // Confirmation Logic
    if (foundLines.length > 0) {
        const summary = foundLines.map(l => `${l.qty} x ${l.size || '?'} ${l.type}`).join('\n');
        if(confirm(`Smart Fill detected:\n${summary}\n\nAdd these to the list?`)) {
            // Clear existing lines to prevent duplicates? (Optional, currently appending)
            // containerLines = []; 
            foundLines.forEach(l => addContainerLine(l.qty, l.size, l.type));
        }
    } else {
        alert(`Could not auto-detect configuration.\n\nDescription:\n"${cachedCargoDesc}"\n\nPlease enter manually.`);
    }
}

/* --- DELETE CONTAINER ROW LOGIC --- */
function removeContainerLine(index) {
    if (confirm("Remove this container configuration?")) {
        // Remove the item from the state array
        containerLines.splice(index, 1);
        // Refresh the HTML table
        renderContainerRows();
        // Update the generated Marks & Numbers string
        updateMarksString();
    }
}
</script>

</body>
</html>