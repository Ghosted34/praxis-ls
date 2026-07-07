<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['FINANCE']); // keep as-is (you can widen later if needed)

// --- Fetch current user details from DB (authoritative profile) ---
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
$role = strtoupper((string)($me['role'] ?? 'FINANCE'));
$roleLabel = $roleLabelMap[$role] ?? 'FINANCE';

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
  <title>Client Master | Smart LS</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  
  <style>
    /* Custom Modal Styles for Preview */
    .preview-frame {
        width: 100%;
        height: 500px;
        border: none;
        background: #f8f9fa;
    }
    .doc-row:hover {
        background-color: #f8f9fa;
    }
    .doc-icon {
        width: 32px;
        text-align: center;
        color: #6c757d;
    }
    /* Ensure modals are on top */
    .modal { z-index: 1060; }
    .offcanvas { z-index: 1050; }
    .modal-backdrop { z-index: 1055; }
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
            <span class="fw-bold">Finance Dashboard</span> 
        </a>
    </div>

    <div class="sidebar-menu accordion" id="financeMenu">
        
        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#fin1">
                <span><i class="fa-solid fa-database category-icon"></i> 1. MASTER DATA MGMT</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="fin1" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                <div class="sub-menu">
                    <a href="client-master-registry.php" class="sub-link">Client Master Registry</a>
                    <a href="supplier-master-registry.php" class="sub-link">Supplier Master Registry</a>
                    <a href="employee-master.php" class="sub-link">Employee Master Registry</a>
                    <a href="financial-dictionary copy.php" class="sub-link">Financial Dictionary</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#fin2">
                <span><i class="fa-solid fa-users category-icon"></i> 2. CRM & ACQUISITION</span>
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
                <span><i class="fa-solid fa-calculator category-icon"></i> 3. COMMERCIAL & PRICING</span>
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
                <span><i class="fa-solid fa-truck-fast category-icon"></i> 4. LOGISTICS OPERATIONS</span>
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
                <span><i class="fa-solid fa-chart-line category-icon"></i> 5. JOB COST CONTROL</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="fin5" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                <div class="sub-menu">
                    <a href="costing-module.php" class="sub-link">Costing Module</a>
                    <a href="cost-tracking.php" class="sub-link">Cost Tracking Master</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#fin6">
                <span><i class="fa-solid fa-building-columns category-icon"></i> 6. FINANCE & TREASURY</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="fin6" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                <div class="sub-menu">
                    <a href="cash-request.php" class="sub-link">Cash Request</a>
                    <a href="purchase-order.php" class="sub-link">Purchase Order</a>
                    <a href="performa-invoice-portal.php" class="sub-link">Proforma Invoice Portal</a>
                    <a href="final-invoice-portal.php" class="sub-link">Final Invoice System</a>
                    <a href="smart-receivable.php" class="sub-link">Smart Receivables Ledger (SRL)</a>
                    <a href="debt-management.php" class="sub-link">Debt Management</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#fin7">
                <span><i class="fa-solid fa-folder-open category-icon"></i> 7. HR & ARCHIVE</span>
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
      <h5 class="mb-0 fw-bold text-dark">Client Master</h5>
      <small class="text-muted" style="font-size: 0.7rem;">MASTER DATA REGISTRY</small>
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

    <div class="row pt-4 mb-4 g-3">

  <div class="col-xl-3 col-md-6">
    <div class="card-custom p-4 d-flex align-items-center border-start border-4 border-warning">
      <div class="me-3 bg-warning bg-opacity-10 rounded-circle d-flex align-items-center justify-content-center" style="width: 48px; height: 48px;">
        <i class="fa-solid fa-users text-warning fs-5"></i>
      </div>
      <div>
        <div class="kpi-title">Total Clients</div>
        <div class="kpi-value" id="kpi-total-clients">0</div>
      </div>
    </div>
  </div>

  <div class="col-xl-3 col-md-6">
    <div class="card-custom p-4 d-flex align-items-center border-start border-4 border-primary">
      <div class="me-3 bg-primary bg-opacity-10 rounded-circle d-flex align-items-center justify-content-center" style="width: 48px; height: 48px;">
        <i class="fa-solid fa-user-check text-primary fs-5"></i>
      </div>
      <div>
        <div class="kpi-title">Active</div>
        <div class="kpi-value" id="kpi-active-clients">0</div>
      </div>
    </div>
  </div>

  <div class="col-xl-3 col-md-6 finance-only">
    <div class="card-custom p-4 d-flex align-items-center border-start border-4 border-success">
      <div class="me-3 bg-success bg-opacity-10 rounded-circle d-flex align-items-center justify-content-center" style="width: 48px; height: 48px;">
        <i class="fa-solid fa-sack-dollar text-success fs-5"></i>
      </div>
      <div>
        <div class="kpi-title">Receivables</div>
        <div class="kpi-value fs-4">
          <span id="kpi-receivables">0</span> <small class="text-muted fs-6">XAF</small>
        </div>
      </div>
    </div>
  </div>

  <div class="col-xl-3 col-md-6 finance-only">
    <div class="card-custom p-4 d-flex align-items-center border-start border-4 border-danger">
      <div class="me-3 bg-danger bg-opacity-10 rounded-circle d-flex align-items-center justify-content-center" style="width: 48px; height: 48px;">
        <i class="fa-solid fa-ban text-danger fs-5"></i>
      </div>
      <div>
        <div class="kpi-title">Over Limit</div>
        <div class="kpi-value" id="kpi-over-limit">0</div>
      </div>
    </div>
  </div>

</div>


    <div class="card-custom p-4 mb-4">
      <div class="d-flex flex-wrap justify-content-between align-items-center gap-3">
        <div class="d-flex gap-2">
          <button onclick="filterType('ALL')" class="btn btn-dark btn-sm fw-bold rounded-pill px-3 filter-btn active">All</button>
          <button onclick="filterType('SHIPPER')" class="btn btn-outline-secondary btn-sm fw-bold rounded-pill px-3 filter-btn">Shippers</button>
          <button onclick="filterType('CONSIGNEE')" class="btn btn-outline-secondary btn-sm fw-bold rounded-pill px-3 filter-btn">Consignees</button>
          <button onclick="filterType('BOTH')" class="btn btn-outline-secondary btn-sm fw-bold rounded-pill px-3 filter-btn">Both</button>
        </div>

        <div class="d-flex gap-3">
          <div class="input-group input-group-sm">
            <span class="input-group-text bg-white"><i class="fa-solid fa-magnifying-glass text-muted"></i></span>
            <input type="text" id="search-input" onkeyup="renderTable()" class="form-control" placeholder="Search clients..." style="width: 250px;">
          </div>
          <button type="button" onclick="openDrawer('new')" id="btn-create"
            class="btn btn-dark btn-sm fw-bold shadow-sm d-flex align-items-center gap-2">
            <i class="fa-solid fa-plus"></i> New Client
            </button>

        </div>
      </div>
    </div>

    <div class="card-custom">
      <div class="table-responsive">
        <table class="table table-hover table-custom align-middle mb-0">
          <thead>
            <tr>
              <th class="ps-4">Client ID / Name</th>
              <th>Type</th>
              <th>Contact Person</th>
              <th class="text-end finance-only">Outstanding (XAF)</th>
              <th>Status</th>
              <th class="text-center">Documents</th>
              <th class="text-end pe-4">Action</th>
            </tr>
          </thead>
          <tbody id="client-table-body"></tbody>
        </table>
      </div>
    </div>

  </div>

  <div class="offcanvas offcanvas-end offcanvas-custom" tabindex="-1" id="clientDrawer" style="">
    <div class="offcanvas-header border-bottom bg-light">
      <div>
        <h5 class="offcanvas-title fw-bold font-heading" id="drawer-title">Client Profile</h5>
        <small class="text-muted">Manage Counterparty Details</small>
      </div>
      <button type="button" class="btn-close" data-bs-dismiss="offcanvas"></button>
    </div>

    <div class="bg-white border-bottom px-3">
      <ul class="nav nav-tabs" id="clientTabs" role="tablist">
        <li class="nav-item">
          <button class="nav-link active" id="identity-tab" data-bs-toggle="tab" data-bs-target="#identity" type="button">Identity</button>
        </li>
        <li class="nav-item">
          <button class="nav-link" id="finance-tab" data-bs-toggle="tab" data-bs-target="#finance" type="button">Finance & Docs</button>
        </li>
      </ul>
    </div>

    <div class="offcanvas-body p-4">
    
      <form id="client-form" class="tab-content" enctype="multipart/form-data" onsubmit="event.preventDefault(); saveClient();">

        <div class="tab-pane fade show active" id="identity" role="tabpanel">
          <div class="d-flex justify-content-between align-items-center p-3 bg-light rounded border mb-4">
            <div>
              <div class="text-uppercase small text-muted fw-bold">System ID (Immutable)</div>
              <div class="font-monospace fw-bold" id="inp-system-id">SLAS-CL-NEW</div>
            </div>
            <span class="badge bg-secondary" id="inp-status-badge">NEW</span>
          </div>

          <div class="mb-3">
            <label class="smart-form-label">Legal Entity Name <span class="text-danger">*</span></label>
            <input type="text" id="inp-name" class="form-control smart-input" required>
          </div>

          <div class="row g-3 mb-3">
            <div class="col-6">
              <label class="smart-form-label">Client Type</label>
              <select id="inp-type" class="form-select smart-input">
                <option value="SHIPPER">SHIPPER</option>
                <option value="CONSIGNEE">CONSIGNEE</option>
                <option value="BOTH">BOTH (Shipper & Consignee)</option>
                <option value="BUSINESS_PARTNER">BUSINESS PARTNER</option>
              </select>
            </div>
            <div class="col-6">
              <label class="smart-form-label">Tax ID (NIU) <span class="text-danger">*</span></label>
              <input type="text" id="inp-niu" class="form-control smart-input" required>
            </div>
          </div>

          <div class="row g-3 mb-3">
            <div class="col-6">
              <label class="smart-form-label">RCCM</label>
              <input type="text" id="inp-rccm" class="form-control smart-input">
            </div>
            <div class="col-6">
              <label class="smart-form-label">Country</label>
              <input type="text" id="inp-country" class="form-control smart-input" value="Cameroon">
            </div>
          </div>

          <div class="mb-3">
            <label class="smart-form-label">Business Address <span class="text-danger">*</span></label>
            <textarea id="inp-address" class="form-control smart-input" rows="2" required></textarea>
          </div>

          <h6 class="smart-form-label border-bottom pb-2 mt-4 mb-3">Primary Contact</h6>
          <div class="row g-3">
            <div class="col-6">
              <label class="smart-form-label">Full Name <span class="text-danger">*</span></label>
              <input type="text" id="inp-contact" class="form-control smart-input" required>
            </div>
            <div class="col-6">
              <label class="smart-form-label">Phone <span class="text-danger">*</span></label>
              <input type="tel" id="inp-phone" class="form-control smart-input" required>
            </div>
            <div class="col-12">
              <label class="smart-form-label">Email (Invoicing) <span class="text-danger">*</span></label>
              <input type="email" id="inp-email" class="form-control smart-input" required>
            </div>
          </div>
        </div>

        <div class="tab-pane fade pt-0 mt-0"  id="finance" role="tabpanel">

          <div class="finance-only">
            <div class="p-3 bg-warning bg-opacity-10 rounded border border-warning border-opacity-25 mb-4">
              <h6 class="text-warning text-uppercase fw-bold small mb-2">Credit Control</h6>
              <div class="row g-2">
                <div class="col-6">
                  <label class="small text-muted fw-bold">Payment Terms (Days)</label>
                  <input type="number" id="inp-terms" class="form-control form-control-sm border-warning" value="30">
                </div>
                <div class="col-6">
                  <label class="small text-muted fw-bold">Credit Limit (XAF)</label>
                  <input type="number" id="inp-limit" class="form-control form-control-sm border-warning" placeholder="Optional">
                </div>
              </div>
            </div>
          </div>

          <div class="mb-4">
            <label class="smart-form-label mb-2">KYC Documents</label>
            <div class="bg-light p-3 rounded border">
              <div class="row g-2 mb-2">
                <div class="col-6">
                  <select class="form-select form-select-sm" id="inp-doc-type">
                    <option value="TAXPAYER_CARD">Taxpayer Card (NIU)</option>
                    <option value="BUSINESS_LICENSE">Business License</option>
                    <option value="CONTRACT">Contract</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
                <div class="col-6">
                  <select class="form-select form-select-sm" id="doc-type-toggle" onchange="toggleDocInput()">
                    <option value="DIGITAL">Digital Upload</option>
                    <option value="PHYSICAL">Physical Archive</option>
                  </select>
                </div>
              </div>

             <div id="doc-input-digital" class="border border-dashed bg-white p-3 rounded text-center" role="button" onclick="document.getElementById('inp-doc-file').click()">
                <label class="small text-muted d-block mb-2"><i class="fa-solid fa-cloud-arrow-up"></i> Click to Select PDF/JPG/PNG</label>
                <input type="file" id="inp-doc-file" name="doc_file" accept=".pdf,.jpg,.jpeg,.png" class="d-none">
                <div id="doc-upload-status" class="small text-muted mt-2 fw-bold text-primary"></div>
             </div>

             <div class="mt-2">
                <input type="text" id="inp-doc-category" class="form-control form-control-sm" placeholder="Document name / description (Required if 'Other')">
             </div>

              <div id="doc-input-physical" class="hidden mt-2">
                <input type="text" id="inp-physical-ref" class="form-control form-control-sm" placeholder="Archive Reference Number">
              </div>

              <button type="button" class="btn btn-outline-dark btn-sm w-100 mt-2" onclick="addDocumentRecord()">Add Document</button>
              
              <div class="mt-3">
                <div class="small text-muted fw-bold mb-2">Queued documents</div>
                <div id="doc-queue" class="d-grid gap-2"></div>
              </div>

            </div>
          </div>

          <div class="form-check mt-4 border-top pt-3 border-danger">
            <input class="form-check-input" type="checkbox" id="inp-deactivate">
            <label class="form-check-label small fw-bold text-danger" for="inp-deactivate">
              Deactivate Client (Hide from Operations)
            </label>
          </div>
        </div>

      </form>
    </div>

    <div class="p-4 border-top bg-white d-flex justify-content-end gap-2">
      <button type="button" class="btn btn-light text-muted fw-bold" data-bs-dismiss="offcanvas">Cancel</button>
      <button type="button" onclick="saveClient()" class="btn btn-dark fw-bold px-4">Save Changes</button>
    </div>
  </div>

  <div class="modal fade" id="docListModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered modal-lg">
      <div class="modal-content">
        <div class="modal-header border-bottom">
          <h5 class="modal-title fw-bold">Client Documents</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body p-0">
          <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
              <thead class="bg-light">
                <tr>
                  <th class="ps-4">Type / Name</th>
                  <th>Storage</th>
                  <th>Date</th>
                  <th class="text-end pe-4">Action</th>
                </tr>
              </thead>
              <tbody id="doc-list-body">
                </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="modal fade" id="docPreviewModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered modal-xl">
      <div class="modal-content h-100">
        <div class="modal-header bg-dark text-white">
          <h6 class="modal-title mb-0" id="preview-title">Document Preview</h6>
          <div class="d-flex gap-2">
            <a href="#" id="btn-download-doc" class="btn btn-sm btn-outline-light" download target="_blank"><i class="fa-solid fa-download"></i> Download</a>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
        </div>
        <div class="modal-body p-0 bg-light d-flex justify-content-center align-items-center" style="min-height: 500px;">
             <iframe id="preview-frame" class="preview-frame" src=""></iframe>
             <img id="preview-img" class="img-fluid hidden" style="max-height: 80vh;" src="" alt="Preview">
        </div>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

<script>
/* ============================================================
   ROLE (Injected from PHP)
============================================================ */
const CURRENT_USER_ROLE = <?php echo json_encode($role); ?>;

/* ============================================================
   API PATHS
============================================================ */
const CLIENT_LIST_API = '../../api/clients/list.php';     // GET  -> expects { ok:true, rows:[], kpis:{} }
const CLIENT_SAVE_API = '../../api/clients/create.php';   // POST -> expects { success:true, client_id:"..." }
const CLIENT_DOCS_API = '../../api/clients/documents.php'; // Mocking API for fetching docs

/* ============================================================
   STATE
============================================================ */
let clients = [];
let activeFilter = 'ALL';
let clientDrawer = null;
let docListModal = null;
let docPreviewModal = null;
let isEditMode = false;
let docQueue = []; // Queue for multi-file uploads

/* ============================================================
   INIT
============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  const drawerEl = document.getElementById('clientDrawer');
  if (drawerEl) clientDrawer = new bootstrap.Offcanvas(drawerEl);
  
  const docListEl = document.getElementById('docListModal');
  if (docListEl) docListModal = new bootstrap.Modal(docListEl);
  
  const docPreviewEl = document.getElementById('docPreviewModal');
  if (docPreviewEl) docPreviewModal = new bootstrap.Modal(docPreviewEl);

  // File input change listener for UI feedback
  const fileInp = document.getElementById('inp-doc-file');
  if(fileInp) {
      fileInp.addEventListener('change', () => {
          const f = fileInp.files[0];
          const status = document.getElementById('doc-upload-status');
          if(status) status.innerText = f ? `Selected: ${f.name}` : '';
      });
  }

  // Role-based UI restrictions
  if (CURRENT_USER_ROLE === 'OPERATIONS') {
   document.getElementById('btn-create')?.classList.add('hidden');
   document.querySelectorAll('.finance-only').forEach(el => el.classList.add('hidden'));
  }

  loadClients();

  // Search triggers DB reload (debounced)
  const searchEl = document.getElementById('search-input');
  let t = null;
  if (searchEl) {
   searchEl.addEventListener('keyup', () => {
      clearTimeout(t);
      t = setTimeout(() => loadClients(), 250);
    });
  }
});

/* ============================================================
   KPI RENDER
============================================================ */
function renderKpis(k) {
  const totalEl = document.getElementById('kpi-total-clients');
  const activeEl = document.getElementById('kpi-active-clients');
  const recvEl  = document.getElementById('kpi-receivables');
  const overEl  = document.getElementById('kpi-over-limit');

  if (totalEl) totalEl.textContent = Number(k?.total || 0).toLocaleString();
  if (activeEl) activeEl.textContent = Number(k?.active || 0).toLocaleString();
  if (recvEl) recvEl.textContent = formatXafCompact(Number(k?.receivables || 0));
  if (overEl) overEl.textContent = Number(k?.over_limit || 0).toLocaleString();
}

function formatXafCompact(v) {
  const n = Number(v || 0);
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toLocaleString();
}

/* ============================================================
   LOAD CLIENTS FROM DB
============================================================ */
async function loadClients() {
  const q = (document.getElementById('search-input')?.value || '').trim();
  const params = new URLSearchParams();
  if (activeFilter && activeFilter !== 'ALL') params.set('type', activeFilter);
  if (q) params.set('q', q);

  const url = params.toString() ? `${CLIENT_LIST_API}?${params.toString()}` : CLIENT_LIST_API;

  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const text = await res.text();

    if (text.trim().startsWith('<')) {
     console.error('Client list API returned HTML:', text.slice(0, 500));
     alert('Client list API returned HTML (not JSON). Check console.');
     return;
    }

    const j = JSON.parse(text);
    if (!j.ok) {
     alert(j.error || 'Failed to load clients');
     return;
    }

    clients = Array.isArray(j.rows) ? j.rows : [];
    if (j.kpis) renderKpis(j.kpis);
    renderTable();

  } catch (err) {
   console.error(err);
   alert('Network/server error while loading clients.');
  }
}

/* ============================================================
   TABLE RENDER
============================================================ */
function renderTable() {
  const tbody = document.getElementById('client-table-body');
  if (!tbody) return;

  const search = (document.getElementById('search-input')?.value || '').toLowerCase();

  const filtered = clients.filter(c => {
    const name = String(c.name || '');
    const id = String(c.id || '');
    const matchSearch = name.toLowerCase().includes(search) || id.toLowerCase().includes(search);
    const matchType = activeFilter === 'ALL' || String(c.type || '').toUpperCase() === activeFilter;
    return matchSearch && matchType;
  });

  tbody.innerHTML = filtered.map(c => {
    const type = String(c.type || '').toUpperCase();
    let typeClass = 'tag-partner';
    if (type === 'SHIPPER') typeClass = 'tag-shipper';
    if (type === 'CONSIGNEE') typeClass = 'tag-consignee';
    if (type === 'BOTH') typeClass = 'tag-both';

    const status = String(c.status || '').toUpperCase();
    const statusBadge = status === 'ACTIVE'
      ? `<span class="badge bg-success bg-opacity-10 text-success rounded-pill">ACTIVE</span>`
      : `<span class="badge bg-secondary bg-opacity-10 text-secondary rounded-pill">DEACTIVATED</span>`;

    const actionIcon = (CURRENT_USER_ROLE === 'OPERATIONS') ? 'fa-eye' : 'fa-pen-to-square';
    const receivables = Number(c.receivables || 0);

    return `
      <tr>
        <td class="ps-4">
          <div class="fw-bold">${escapeHtml(c.name)}</div>
          <div class="small text-muted font-monospace">${escapeHtml(c.id)}</div>
        </td>
        <td><span class="tag ${typeClass}">${escapeHtml(type)}</span></td>
        <td class="small">${escapeHtml(c.contact)}</td>
        <td class="text-end finance-only fw-bold">${receivables.toLocaleString()}</td>
        <td>${statusBadge}</td>
        <td class="text-center">
            <button class="btn btn-sm btn-light border" onclick="viewDocuments('${escapeJs(c.id)}')">
                <i class="fa-solid fa-paperclip text-muted"></i>
            </button>
        </td>
        <td class="text-end pe-4">
          <button class="btn btn-sm btn-link text-secondary p-0" onclick="editClient('${escapeJs(c.id)}')">
            <i class="fa-solid ${actionIcon}"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  if (CURRENT_USER_ROLE === 'OPERATIONS' || CURRENT_USER_ROLE === 'SALES') {
   document.querySelectorAll('.finance-only').forEach(el => el.classList.add('hidden'));
  }
}

/* ============================================================
   VIEW DOCUMENTS (List Modal)
============================================================ */
/* ============================================================
   VIEW DOCUMENTS (DEBUG VERSION)
============================================================ */
async function viewDocuments(clientId) {
    const tbody = document.getElementById('doc-list-body');
    tbody.innerHTML = '<tr><td colspan="4" class="text-center p-3">Loading documents...</td></tr>';
    docListModal.show();

    try {
        // 1. Log the ID we are requesting
        console.log("Requesting docs for Client ID:", clientId);

        // 2. Build URL
        const url = `${CLIENT_DOCS_API}?client_id=${clientId}`; 
        console.log("Fetching URL:", url);

        const res = await fetch(url);

        // 3. Check for HTTP errors (404, 500)
        if (!res.ok) {
            throw new Error(`HTTP Error: ${res.status} ${res.statusText}`);
        }

        // 4. Read text first to catch PHP errors
        const text = await res.text();
        console.log("Raw Server Response:", text); // Check your browser console (F12) for this

        // 5. Try parsing JSON
        let json;
        try {
            json = JSON.parse(text);
        } catch (e) {
            throw new Error("Server returned Invalid JSON. Check console for output.");
        }
        
        if (!json.ok) {
            throw new Error(json.error || "API reported failure");
        }

        if (!json.documents || json.documents.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center p-3 text-muted">No documents found for this client.</td></tr>';
            return;
        }

        // 6. Render Success
        tbody.innerHTML = json.documents.map(d => {
            let actionBtn = '';
            if (d.storage_mode === 'DIGITAL') {
                actionBtn = `<button class="btn btn-sm btn-primary py-0" onclick="previewDoc('${escapeJs(d.file_path)}', '${escapeJs(d.document_type)}')">View</button>`;
            } else {
                actionBtn = `<span class="badge bg-secondary">Physical</span>`;
            }

            return `
                <tr>
                    <td class="ps-4 fw-bold small">${escapeHtml(d.document_type)}</td>
                    <td class="small">${d.storage_mode === 'DIGITAL' ? '<i class="fa-solid fa-cloud text-primary"></i> Digital' : '<i class="fa-solid fa-box-archive text-warning"></i> Archive: '+escapeHtml(d.archive_ref)}</td>
                    <td class="small text-muted">${new Date(d.uploaded_at).toLocaleDateString()}</td>
                    <td class="text-end pe-4">${actionBtn}</td>
                </tr>
            `;
        }).join('');

    } catch (e) {
        console.error(e);
        // Alert the actual error to the user for easier debugging
        alert("Debug Error: " + e.message);
        tbody.innerHTML = '<tr><td colspan="4" class="text-center p-3 text-danger">Error loading documents.</td></tr>';
    }
}

/* ============================================================
   PREVIEW DOCUMENT
============================================================ */
function previewDoc(url, title) {
    // Hide List Modal
    docListModal.hide();
    
    document.getElementById('preview-title').innerText = title;
    const frame = document.getElementById('preview-frame');
    const img = document.getElementById('preview-img');
    const btnDown = document.getElementById('btn-download-doc');

    btnDown.href = url;
    
    // Determine extension
    const ext = url.split('.').pop().toLowerCase();
    if(['jpg','jpeg','png','gif'].includes(ext)) {
        frame.classList.add('hidden');
        img.classList.remove('hidden');
        img.src = url;
    } else {
        img.classList.add('hidden');
        frame.classList.remove('hidden');
        frame.src = url;
    }

    docPreviewModal.show();
     console.log("Preview URL (as received):", url);
    // Re-open list modal when preview closes? Optional. 
    // Usually simpler to just close preview.
}

/* ============================================================
   FILTERS & DRAWER
============================================================ */
function filterType(type, ev) {
  activeFilter = type;
  document.querySelectorAll('.filter-btn').forEach(btn => {
   btn.classList.remove('btn-dark', 'active');
   btn.classList.add('btn-outline-secondary');
  });
  const e = ev || window.event;
  const target = e?.target || null;
  if (target) {
   target.classList.remove('btn-outline-secondary');
   target.classList.add('btn-dark', 'active');
  }
  loadClients();
}

function openDrawer(mode, clientId = null) {
 document.getElementById('client-form')?.reset();
 docQueue = []; // Reset queue
 renderDocQueue();
 
 bootstrap.Tab.getOrCreateInstance(
   document.querySelector('#clientTabs button[data-bs-target="#identity"]')
  ).show();

  if (mode === 'new') {
    isEditMode = false;
    document.getElementById('drawer-title').innerText = 'New Client';
    document.getElementById('inp-system-id').innerText = 'SLAS-CL-AUTO';
    document.getElementById('inp-status-badge').innerText = 'NEW';
    document.getElementById('inp-status-badge').className = 'badge bg-secondary';
    document.getElementById('inp-country').value = 'Cameroon';
    document.getElementById('inp-terms').value = 30;
  } else {
    isEditMode = true;
    const c = clients.find(x => x.id === clientId);
    if (!c) return;

    document.getElementById('drawer-title').innerText = 'Edit Client';
    document.getElementById('inp-system-id').innerText = c.id;
    document.getElementById('inp-name').value = c.name || '';
    document.getElementById('inp-type').value = c.type || 'BOTH';
    document.getElementById('inp-niu').value = c.niu || '';
    document.getElementById('inp-rccm').value = c.rccm || '';
    document.getElementById('inp-address').value = c.address || '';
    document.getElementById('inp-contact').value = c.contact || '';
    document.getElementById('inp-phone').value = c.phone || '';
    document.getElementById('inp-email').value = c.email || '';
    document.getElementById('inp-terms').value = c.terms ?? 30;

    const badge = document.getElementById('inp-status-badge');
    const chk = document.getElementById('inp-deactivate');
    if ((c.status || '').toUpperCase() === 'ACTIVE') {
      badge.innerText = 'ACTIVE';
      badge.className = 'badge bg-success';
      chk.checked = false;
    } else {
      badge.innerText = 'DEACTIVATED';
      badge.className = 'badge bg-danger';
      chk.checked = true;
    }
  }
 clientDrawer?.show();
}

function editClient(id) {
  openDrawer('edit', id);
}

/* ============================================================
   DOCUMENT QUEUE LOGIC
============================================================ */
function toggleDocInput() {
  const mode = document.getElementById('doc-type-toggle')?.value || 'DIGITAL';
  document.getElementById('doc-input-digital')?.classList.toggle('hidden', mode !== 'DIGITAL');
  document.getElementById('doc-input-physical')?.classList.toggle('hidden', mode !== 'PHYSICAL');
}

function renderDocQueue() {
    const box = document.getElementById('doc-queue');
    if(!box) return;
    if(!docQueue.length) {
        box.innerHTML = `<div class="small text-muted fst-italic">No documents added yet.</div>`;
        return;
    }
    
    box.innerHTML = docQueue.map((d, idx) => {
        const meta = d.storage_mode === 'PHYSICAL' 
            ? `Archive: ${escapeHtml(d.physical_ref)}` 
            : `File: ${escapeHtml(d.file.name)}`;
        
        // Show the custom name if "OTHER"
        const displayType = d.document_type === 'OTHER' ? `OTHER (${escapeHtml(d.custom_name)})` : d.document_type;

        return `
            <div class="p-2 border rounded bg-white d-flex justify-content-between align-items-center shadow-sm">
                <div>
                    <div class="fw-bold small text-dark">${displayType}</div>
                    <div class="small text-muted" style="font-size:0.75rem;">${meta}</div>
                </div>
                <button type="button" class="btn btn-sm btn-outline-danger py-0" onclick="removeFromQueue(${idx})">&times;</button>
            </div>
        `;
    }).join('');
}

function removeFromQueue(idx) {
    docQueue.splice(idx, 1);
    renderDocQueue();
}

function addDocumentRecord() {
    const typeSelect = document.getElementById('inp-doc-type');
    const modeSelect = document.getElementById('doc-type-toggle');
    const nameInput = document.getElementById('inp-doc-category'); // Description field
    
    const docType = typeSelect.value;
    const mode = modeSelect.value;
    const customName = nameInput.value.trim();

    // Validations
    if(docType === 'OTHER' && !customName) {
        alert("Please enter a document name/description for 'Other'.");
        nameInput.focus();
        return;
    }

    if(mode === 'PHYSICAL') {
        const ref = document.getElementById('inp-physical-ref').value.trim();
        if(!ref) { alert("Archive Reference Number is required for physical docs."); return; }
        
        docQueue.push({
            document_type: docType,
            storage_mode: 'PHYSICAL',
            physical_ref: ref,
            custom_name: customName // Save this for backend
        });
        document.getElementById('inp-physical-ref').value = '';
    } else {
        // Digital
        const fileInp = document.getElementById('inp-doc-file');
        if(!fileInp.files || !fileInp.files[0]) { alert("Please select a file."); return; }
        
        docQueue.push({
            document_type: docType,
            storage_mode: 'DIGITAL',
            file: fileInp.files[0],
            custom_name: customName // Save this for backend
        });
        
        // Reset file input
        fileInp.value = '';
        document.getElementById('doc-upload-status').innerText = '';
    }
    
    // Clear description input
    nameInput.value = '';
    renderDocQueue();
}

/* ============================================================
   SAVE CLIENT
============================================================ */
async function saveClient() {
  const fd = new FormData();
 
  fd.append('client_id', document.getElementById('inp-system-id').innerText.trim());
  fd.append('client_name', document.getElementById('inp-name').value.trim());
  fd.append('client_type', document.getElementById('inp-type').value);
  fd.append('niu', document.getElementById('inp-niu').value.trim());
  fd.append('rccm', document.getElementById('inp-rccm').value.trim());
  fd.append('country', document.getElementById('inp-country').value.trim());
  fd.append('address', document.getElementById('inp-address').value.trim());
 
  fd.append('contact_person', document.getElementById('inp-contact').value.trim());
  fd.append('contact_phone', document.getElementById('inp-phone').value.trim());
  fd.append('contact_email', document.getElementById('inp-email').value.trim());
 
  fd.append('payment_terms_days', document.getElementById('inp-terms').value);
  fd.append('credit_limit', document.getElementById('inp-limit').value);
  fd.append('status', document.getElementById('inp-deactivate').checked ? 'DEACTIVATED' : 'ACTIVE');
 
  // --- Append Queued Documents ---
  // We send them as an array of metadata, and individual files
  // Backend must handle: $_POST['docs_meta'] (JSON) and $_FILES['doc_file_0'], etc.
  
  const docsMeta = docQueue.map((d, idx) => ({
      type: d.document_type,
      mode: d.storage_mode,
      ref: d.physical_ref || null,
      custom_name: d.custom_name || null // Pass the typed name
  }));
  
  fd.append('docs_meta', JSON.stringify(docsMeta));
  
  docQueue.forEach((d, idx) => {
      if(d.storage_mode === 'DIGITAL' && d.file) {
          fd.append(`doc_file_${idx}`, d.file);
      }
  });

  try {
    const res = await fetch(CLIENT_SAVE_API, { method:'POST', body: fd });
    const text = await res.text();
    if (text.trim().startsWith('<')) {
     console.error('Save API returned HTML:', text.slice(0, 500));
     alert('Save API returned HTML (not JSON). Check console.');
     return;
    }
    const json = JSON.parse(text);
    if (!json.success) {
      alert(json.error || 'Save failed');
      return;
    }
    alert('Client saved: ' + json.client_id);
    clientDrawer?.hide();
    loadClients();
  } catch (e) {
    console.error(e);
    alert('Network or server error');
  }
}

/* ============================================================
   SAFE OUTPUT HELPERS
============================================================ */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
   '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[c]));
}
function escapeJs(s) {
  return String(s ?? '').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
}

function updateClock() {
 document.getElementById('realtime-clock').innerText = new Date().toLocaleTimeString();
}
setInterval(updateClock, 1000);
updateClock();
</script>

</body>
</html>