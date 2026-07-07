<?php
declare(strict_types=1);

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

  </style>
</head>

<body>

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
            <div class="ops-kpi-value" id="kpi-total">0</div>
            <small class="text-success fw-bold" style="font-size:.7rem;"><i class="fa-solid fa-arrow-up"></i> Live</small>
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

      <div class="col-md-3">
        <div class="ops-card-custom p-3 d-flex align-items-center bg-dark text-white border-0 position-relative overflow-hidden">
          <div class="position-relative z-2">
            <div class="ops-kpi-title text-white-50">Realized Margin (MTD)</div>
            <div class="ops-kpi-value text-white" id="kpi-margin">-- <span class="fs-6 fw-normal text-white-50">XAF</span></div>
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
              <th class="ps-4">Ref</th>
              <th>Client</th>
              <th>Service</th>
              <th>Route / Loc</th>
              <th>Status</th>
              <th class="text-center">Attachments</th>
              <th class="text-end pe-4">Actions</th>
            </tr>
          </thead>
          <tbody id="table-body"></tbody>
        </table>
      </div>
    </div>

  </div>

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
          <div class="col-md-12">
            <label class="form-label">Client (Bill To) <span class="text-danger">*</span></label>
            <select class="form-select ops-smart-input" id="clientBillTo" required>
              <option value="">Select Client...</option>
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
              <label class="form-label fw-bold text-primary mb-0"><i class="fa-solid fa-truck-fast me-2"></i>Container Configuration</label>
              <button type="button" class="btn btn-sm btn-outline-primary fw-bold" onclick="addContainerLine()">
                <i class="fa-solid fa-plus me-1"></i> Add Line
              </button>
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
              <div class="form-text small text-muted">Optional. Operational expectation for delivery completion.</div>
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

            <!-- You can add 'multiple' if desired -->
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
  <!-- Document Vault Modal -->
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
  const currentRole = 'ADMIN';
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


  // IMPORTANT: define this (you were using DOC_UPLOAD_API but never declared it)
  const DOC_UPLOAD_API  = '../../api/operations_files/upload.php'; // adjust path if yours differs

  /* ---------------------------
     STATE
   ---------------------------- */
  let files = [];     
  let listBusy = false;
  let saveBusy = false;
  let clientsLoaded = false;
  let oppCache = [];
  let oppCacheLoaded = false;
  
  // NEW STATES
  let containerLines = [];
  let tempDocs = [];
  let pendingUploads = []; // FIX: declare it

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

  async function loadOpportunityCache() {
    if (oppCacheLoaded) return;
    const data = await safeJsonFetch(GET_OPPORTUNITY_LIST_API, { credentials: 'same-origin' });
    if (!data.ok || !Array.isArray(data.rows)) throw new Error(data.error || 'Failed to load opportunities');
    oppCache = data.rows
      .map(r => ({
        id: String(r.converted_opportunity_id || '').trim(),
        name: String(r.requester_name || '').trim()
      }))
      .filter(x => x.id !== '');
    oppCacheLoaded = true;
  }

  function renderOppDatalist() {
    const dl = document.getElementById('oppIdList');
    if (!dl) return;
    dl.innerHTML = oppCache.map(x => {
      const label = x.name ? ` — ${x.name}` : '';
      return `<option value="${escapeHtml(x.id)}">${escapeHtml(x.id + label)}</option>`;
    }).join('');
  }

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
      if (el.closest('.offcanvas-header')) return;
      if (el.id === 'btn-submit-text') return; 
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

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

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

  function normalizeDateTimeLocal(v) {
    const s = String(v ?? '').trim();
    if (!s) return null;
    const t = s.replace('T', ' ');
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(t)) return `${t}:00`;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(t)) return t;
    return null;
  }

  /* ============================================================
     CONTAINER & UPLOAD LOGIC
   ============================================================ */

  // --- CONTAINER LOGIC ---
  function addContainerLine(qty="", size="", type="") {
    containerLines.push({ qty, size, type });
    renderContainerRows();
    updateMarksString();
  }

  function removeContainerLine(index) {
    containerLines.splice(index, 1);
    renderContainerRows();
    updateMarksString();
  }

  function updateLineData(index, field, value) {
    if (!containerLines[index]) return;
    containerLines[index][field] = value;
    updateMarksString();
  }

  function renderContainerRows() {
    const wrapper = document.getElementById('container-rows-wrapper');
    if (!wrapper) return;
    wrapper.innerHTML = containerLines.map((line, idx) => `
      <div class="cnt-row">
        <div style="width: 80px;">
          <input type="number" class="form-control form-control-sm border-0 bg-transparent fw-bold text-center" 
            placeholder="Qty" value="${escapeAttr(line.qty)}" oninput="updateLineData(${idx}, 'qty', this.value)">
        </div>
        <div class="text-muted fw-bold small">*</div>
        <div style="flex:1;">
          <select class="form-select form-select-sm border-0 bg-transparent" onchange="updateLineData(${idx}, 'size', this.value)">
            <option value="" ${line.size===''?'selected':''}>Size...</option>
            <option value="20'" ${line.size==="20'"?'selected':''}>20'</option>
            <option value="40'" ${line.size==="40'"?'selected':''}>40'</option>
            <option value="45'" ${line.size==="45'"?'selected':''}>45'</option>
          </select>
        </div>
        <div class="text-muted fw-bold small">*</div>
        <div style="flex:2;">
          <select class="form-select form-select-sm border-0 bg-transparent" onchange="updateLineData(${idx}, 'type', this.value)">
            <option value="" ${line.type===''?'selected':''}>Type...</option>
            <option value="DC" ${line.type==='DC'?'selected':''}>DC (Dry)</option>
            <option value="HC" ${line.type==='HC'?'selected':''}>HC (High Cube)</option>
            <option value="OT" ${line.type==='OT'?'selected':''}>OT (Open Top)</option>
            <option value="RF" ${line.type==='RF'?'selected':''}>RF (Reefer)</option>
            <option value="FR" ${line.type==='FR'?'selected':''}>FR (Flat Rack)</option>
            <option value="GENERAL" ${line.type==='GENERAL'?'selected':''}>General/Breakbulk</option>
          </select>
        </div>
        <button type="button" class="btn btn-sm text-danger" onclick="removeContainerLine(${idx})">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    `).join('');
  }

  function updateMarksString() {
    const str = containerLines
      .filter(l => l.qty && l.size && l.type) 
      .map(l => {
        const q = String(l.qty).padStart(2, '0');
        return `${q}*${l.size}${l.type}`;
      })
      .join(', ');
    const marks = document.getElementById('marksNumbers');
    if (marks) marks.value = str;
  }

  function parseMarksToRows(str) {
    containerLines = []; 
    if(!str) { renderContainerRows(); return; }

    const parts = String(str).split(',');
    parts.forEach(part => {
      part = part.trim();
      const segments = part.split('*');
      if(segments.length >= 3) {
        const qty = segments[0];
        const size = segments[1];
        const type = segments[2];
        containerLines.push({ qty, size, type });
      }
    });
    renderContainerRows();
  }

  // --- UPLOAD LOGIC ---
  function triggerFileUpload() {
    const inp = document.getElementById('opsFileInput');
    if (inp) inp.click();
  }

  async function handleFileSelect(input) {
  if (!input.files || !input.files[0]) return;

  const file = input.files[0];
  const status = document.getElementById('upload-status-bar');

  // Clear native input UI (fine)
  input.value = '';

  // CREATE MODE: queue it AND show it in the list
  if (!currentRecordRef) {
    pendingUploads.push(file);

    // Show in UI list as "queued"
    tempDocs.push({
      id: `QUEUED_${Date.now()}`,   // temporary UI id
      name: file.name,
      type: file.type || 'application/octet-stream',
      queued: true
    });
    renderFileList();

    status.innerText = `Queued: ${file.name}`;
    // Optional: don't auto-clear, or clear later
    // setTimeout(() => { status.innerText = ''; }, 3000);
    return;
  }

  // EDIT MODE: upload immediately
  await uploadOneFile(currentRecordRef, file);
}


  async function uploadOneFile(ref, file) {
    const status = document.getElementById('upload-status-bar');
    if (status) status.innerText = `Uploading ${file.name}...`;

    const fd = new FormData();
    fd.append('ref', ref);
    fd.append('file', file);

    try {
      const res = await fetch(DOC_UPLOAD_API, {
        method: 'POST',
        credentials: 'same-origin',
        body: fd
      });

      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('application/json') ? await res.json().catch(() => null) : null;
      if (!res.ok || !data || !data.ok) throw new Error((data && (data.error || data.message)) || `Upload failed (HTTP ${res.status})`);

      // Minimal UI feedback (you can reload from DB if you implement list endpoint)
      if (data.file) {
        tempDocs.push({
          id: data.file.stored_name || data.file.id || '',
          name: data.file.original_name || file.name,
          type: data.file.mime_type || file.type || ''
        });
        renderFileList();
      }

      if (status) status.innerText = 'Upload complete.';
      setTimeout(() => { if (status) status.innerText = ''; }, 1000);

    } catch (e) {
      console.error(e);
      if (status) status.innerText = '';
      showAlert(e.message || 'Upload failed.');
    }
  }

  function renderFileList() {
  const box = document.getElementById('file-list-container');
  if (tempDocs.length === 0) {
    box.innerHTML = '<div class="text-muted small fst-italic">No documents attached yet.</div>';
    return;
  }

  box.innerHTML = tempDocs.map(d => `
    <div class="doc-list-item">
      <div class="d-flex align-items-center gap-2">
        <i class="fa-solid fa-file-pdf text-danger"></i>
        <div class="lh-1">
          <div class="fw-bold text-dark small">${d.name}</div>
          ${
            d.queued
              ? `<span class="badge bg-warning text-dark" style="font-size:0.6rem">QUEUED</span>`
              : `<span class="badge bg-secondary" style="font-size:0.6rem">${d.id}</span>`
          }
        </div>
      </div>
      ${
        d.queued
          ? `<button type="button" class="btn btn-sm btn-light text-danger" onclick="removeQueuedDoc('${d.id}')">&times;</button>`
          : `<button type="button" class="btn btn-sm btn-light text-danger" onclick="removeDoc('${d.id}')">&times;</button>`
      }
    </div>
  `).join('');
}

  
  function removeDoc(id) {
    tempDocs = tempDocs.filter(d => d.id !== id);
    renderFileList();
  }

  /* ============================================================
     CLIENTS DROPDOWN
   ============================================================ */
  async function loadClientsIntoSelect() {
    const sel = $('clientBillTo');
    if (!sel) return;

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
        opt.value = c.client_id; 
        opt.textContent = `${c.client_name} (${c.client_id})`;
        sel.appendChild(opt);
      });
      clientsLoaded = true;
    } catch (e) {
  console.error(e);
  files = [];
  showAlert(e.message || 'Network/server error while loading Operations Registry.');
} finally {
  listBusy = false;
}
  }

  /* ============================================================
     DB LOAD
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
      files = (Array.isArray(data.rows) ? data.rows : []).map(r => ({
        ref: r.ref ?? r.operations_file_reference ?? '',
        client_id: r.client_id ?? '',
        client_name: r.client_name ?? '',
        service_type: r.service_type ?? '',
        service_territory: r.service_territory ?? '',
        operations_status: r.operations_status ?? '',
        doc_count: r.doc_count || 0
      }));
    } catch (e) {
      console.error(e);
      files = [];
      showAlert('Network/server error while loading Operations Registry.');
    } finally {
      listBusy = false;
    }
  }

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

    const marginEl = $('kpi-margin');
    if (marginEl) marginEl.innerHTML = '-- <span class="fs-6 fw-normal text-white-50">XAF</span>';
  }

  function renderTable() {
    const tbody = $('table-body');
    if (!tbody) return;

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
      const attachHtml = r.doc_count > 0
  ? `
    <button type="button"
      class="btn btn-sm btn-light border fw-bold"
      onclick="openDocsModal('${escapeAttr(r.ref)}')"
      title="View attachments">
      <i class="fa-solid fa-paperclip text-muted me-1"></i> ${r.doc_count}
    </button>`
  : `<span class="text-muted small">-</span>`;


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
          <td>
            <span class="badge ${meta.class} ops-status-pill rounded-pill px-3 py-2"
              data-bs-toggle="tooltip" title="${escapeHtml(meta.tooltip)}">
              ${escapeHtml(String(r.operations_status || '').replace(/_/g,' '))} <i class="fa-solid fa-info-circle ms-1"></i>
            </span>
          </td>
          <td class="text-center">${attachHtml}</td>
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

    const form = $('opsForm');
    if (form && form.dataset.detailsJson) {
      try {
        const details = JSON.parse(form.dataset.detailsJson);
        populateDynamicFields({ details });
      } catch (_) {}
    }

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

  async function openOffcanvas(mode, ref) {
    const form = $('opsForm');
    const refDisplay = $('display-ref');
    const blocker = $('readonly-blocker');
    const btn = $('btn-submit-text');

    if (!form || !refDisplay || !blocker || !btn) return;

    await loadClientsIntoSelect();

    // RESET CONTAINERS & DOCS
    containerLines = []; renderContainerRows(); 
    tempDocs = []; renderFileList();
    pendingUploads = []; // reset queued uploads on new open
    safeSetValue('marksNumbers', '');

    if (mode === 'create') {
      currentRecordRef = null;
      form.reset();

      setStatusRequired(true);
      
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

      try {
        await loadOpportunityCache();
        renderOppDatalist();
      } catch (e) { console.warn(e); }

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
      
      const details = record.details || {};
      currentRecordRef = record.ref || ref;
      form.reset();
      form.classList.remove('was-validated');
      form.dataset.detailsJson = JSON.stringify(details || {});
      refDisplay.innerText = currentRecordRef;
      refDisplay.dataset.mode = 'view';
      $('offcanvasTitle').innerText = 'Manage Operations File';

      const badge = $('modal-status-badge');
      badge.innerText = String(record.operations_status || 'OPEN').replace(/_/g, ' ');
      badge.className = `badge ${statusConfig[record.operations_status]?.class || 'bg-dark'} text-white`;

      safeSetValue('clientBillTo', record.client_id || '');
      safeSetValue('serviceType', record.service_type || '');
      safeSetValue('serviceTerritory', record.service_territory || '');
      safeSetValue('oppIdField', record.opportunity_id || details.oppIdField || '');

      const linkEl = $('linkOpportunity');
      if (linkEl) linkEl.checked = !!details.linkOpportunity;
      toggleOppLogic();

      safeSetValue('operationsStatus', record.operations_status || details.operationStatus || '');
      safeSetValue('commodityShort', record.commodity || details.commodityShort || '');
      safeSetValue('commodityDesc', details.commodityDesc || '');
      safeSetValue('grossWeight', (record.gross_weight ?? details.grossWeight ?? ''));
      safeSetValue('weightUnit', record.weight_unit || details.weightUnit || 'KG');
      safeSetValue('pkgCount', (record.package_count ?? details.pkgCount ?? ''));
      safeSetValue('incoterm', details.incoterm || 'EXW');
      
      // CONTAINER LOGIC RESTORE
      safeSetValue('marksNumbers', details.marksNumbers || '');
      parseMarksToRows(details.marksNumbers || '');

      safeSetValue('placeReceipt', details.placeReceipt || '');
      safeSetValue('placeDelivery', details.placeDelivery || '');
      safeSetValue('etaField', details.etaField || '');
      safeSetValue('ataField', details.ataField || '');
      safeSetValue('expectedDeliveryTime', details.expectedDeliveryTime || '');

      handleServiceChange();
      populateDynamicFields({ details });

      const isClosed = (record.operations_status === 'CLOSED');
      const canEdit = !isClosed; 
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

  async function submitFile() {
    if (saveBusy) return;

    const form = $('opsForm');
    const refDisplay = $('display-ref');
    const blocker = $('readonly-blocker');
    const btn = $('btn-submit-text');

    if (!form || !refDisplay || !btn || !blocker) return;
    if (!blocker.classList.contains('d-none')) return; 

    if (!form.checkValidity()) {
      form.classList.add('was-validated');
      const firstInvalid = form.querySelector(':invalid');
      if (firstInvalid) {
        firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
        firstInvalid.focus();
      }
      return;
    }

    const mode = refDisplay.dataset.mode; 
    const chosenStatus = safeGetValue('operationsStatus');
    const serviceType = safeGetValue('serviceType');
    const territory = safeGetValue('serviceTerritory');
    const clientId = safeGetValue('clientBillTo');      
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
      operations_status: (mode === 'new') ? (chosenStatus || 'NOT_AWARDED') : (chosenStatus || null),
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

      // FIX: set ref first, then upload queued docs
      if (data.ref) currentRecordRef = data.ref;

      if (mode === 'new' && currentRecordRef && pendingUploads.length) {
        const uploads = [...pendingUploads];
        pendingUploads = [];
        for (const f of uploads) {
          await uploadOneFile(currentRecordRef, f);
        }
      }

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
      showAlert(e.message || 'Network/server error while saving.');
    } finally {
      saveBusy = false;
      btn.disabled = false;
      btn.innerHTML = prevHtml || '<i class="fa-solid fa-save me-2"></i>Save';
    }
  }

  let searchTimer = null;
  function onSearchKeyup() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      await loadFiles();
      renderTable();
    }, 250);
  }

  let docsModalInstance = null;

function iconForMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('pdf')) return 'fa-file-pdf text-danger';
  if (m.includes('image')) return 'fa-file-image text-primary';
  return 'fa-file text-secondary';
}

async function openDocsModal(ref) {
  const modalEl = document.getElementById('docsModal');
  const bodyEl = document.getElementById('docsModalBody');
  const subEl = document.getElementById('docsModalSubtitle');
  if (!modalEl || !bodyEl || !subEl) return;

  if (!docsModalInstance) docsModalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);

  subEl.textContent = `OPS Ref: ${ref}`;
  bodyEl.innerHTML = `<div class="text-muted small">Loading...</div>`;
  docsModalInstance.show();

  try {
    const data = await safeJsonFetch(`${DOC_LIST_DOC_API}?ref=${encodeURIComponent(ref)}`, { credentials: 'same-origin' });
    if (!data.ok) throw new Error(data.error || 'Failed to load documents');

    const rows = Array.isArray(data.rows) ? data.rows : [];
    if (!rows.length) {
      bodyEl.innerHTML = `<div class="text-muted small fst-italic">No documents found.</div>`;
      return;
    }

    bodyEl.innerHTML = `
      <div class="list-group">
        ${rows.map(d => {
          const viewUrl = d.view_url; // returned by API
          const ico = iconForMime(d.mime_type);
          const name = escapeHtml(d.original_filename || d.stored_filename || 'Document');
          const meta = [
            d.doc_type ? `Type: ${escapeHtml(d.doc_type)}` : '',
            d.version_no ? `v${escapeHtml(d.version_no)}` : '',
            d.created_at ? `Uploaded: ${escapeHtml(d.created_at)}` : ''
          ].filter(Boolean).join(' • ');

          return `
            <div class="list-group-item d-flex justify-content-between align-items-center">
              <div class="d-flex align-items-center gap-3">
                <span class="doc-ico"><i class="fa-solid ${ico}"></i></span>
                <div class="lh-1">
                  <div class="fw-bold">${name}</div>
                  <div class="text-muted small">${meta}</div>
                </div>
              </div>

              <div class="d-flex gap-2">
                <a class="btn btn-sm btn-outline-dark fw-bold"
                   href="${escapeAttr(viewUrl)}"
                   target="_blank" rel="noopener">
                  <i class="fa-solid fa-eye me-1"></i> View
                </a>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } catch (e) {
    console.error(e);
    bodyEl.innerHTML = `<div class="alert alert-danger mb-0">${escapeHtml(e.message || 'Failed to load documents')}</div>`;
  }
}

window.openDocsModal = openDocsModal;


  document.addEventListener('DOMContentLoaded', async () => {
    const oc = document.getElementById('opsOffcanvas');
    if (oc) myOffcanvas = bootstrap.Offcanvas.getOrCreateInstance(oc);
    toggleOppLogic();
    $('serviceType')?.addEventListener('change', handleServiceChange);
    $('linkOpportunity')?.addEventListener('change', toggleOppLogic);
    await loadClientsIntoSelect();
    await loadFiles();
    renderTable();
  });

  window.openOffcanvas = openOffcanvas;
  window.submitFile = submitFile;
  window.handleServiceChange = handleServiceChange;
  window.toggleOppLogic = toggleOppLogic;
  window.onSearchKeyup = onSearchKeyup;
  window.addContainerLine = addContainerLine;
  window.removeContainerLine = removeContainerLine;
  window.updateLineData = updateLineData;
  window.triggerFileUpload = triggerFileUpload;
  window.handleFileSelect = handleFileSelect;
  window.removeDoc = removeDoc;
</script>

</body>
</html>
