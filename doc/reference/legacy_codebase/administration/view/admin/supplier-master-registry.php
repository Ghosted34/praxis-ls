<?php
/**
 * SUPPLIER MASTER REGISTRY
 * -------------------------------------------------------------------------
 * This module manages the Approved Vendor List (AVL).
 * * FEATURES:
 * - CRUD for Suppliers (Identity, Finance, Evaluation)
 * - Document Management (Digital Uploads & Physical References)
 * - Role-Based Access (Admin/Finance/Management/Operations)
 * - Sales Access Restriction (Blocker overlay)
 * - Real-time KPIs (Total, Active, Payables, Overdue)
 * * API DEPENDENCIES:
 * - api/suppliers/list.php (Fetch rows & KPIs with Overdue column)
 * - api/suppliers/get.php  (Fetch single profile + docs)
 * - api/suppliers/save.php (Create/Update + Uploads)
 */

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'FINANCE', 'MANAGEMENT', 'OPERATIONS', 'SALES']); 

// --- Fetch current user details ---
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
    em.avatar_path,
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

// --- Safe Display Values ---
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

// --- Avatar Logic (Actual Photo vs Placeholder) ---
$dbAvatar = $me['avatar_path'] ?? '';

if (!empty($dbAvatar)) {
    // Uses the uploaded photo from the server
    $avatarUrl = '../../' . $dbAvatar; 
} else {
    // Fallback to initials if no photo is uploaded
    $avatarName = urlencode($fullName);
    $avatarUrl = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";
}

function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Supplier Master | Smart LS</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">

  <style>
    /* --- MODULE SPECIFIC STYLES --- */
    .supplier-card-custom {
      background: #fff;
      border-radius: 12px;
      border: 1px solid rgba(0,0,0,0.05);
      box-shadow: 0 2px 12px rgba(0,0,0,0.02);
      height: 100%;
      transition: transform 0.2s;
    }
    .supplier-card-custom:hover { transform: translateY(-2px); box-shadow: 0 5px 20px rgba(0,0,0,0.05); }

    .supplier-kpi-title { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; color: #888; letter-spacing: 0.5px; }
    .supplier-kpi-value { font-size: 1.8rem; font-weight: 800; color: var(--smart-charcoal); line-height: 1.2; }

    .supplier-table-custom th {
      font-size: 0.75rem; text-transform: uppercase; color: #888;
      font-weight: 700; border-bottom: 2px solid #f0f0f0; background: #f9fafb; padding: 12px 16px;
    }
    .supplier-table-custom td { font-size: 0.85rem; vertical-align: middle; padding: 12px 16px; }

    /* Category Tags */
    .supplier-tag { font-size: 0.7rem; padding: 3px 8px; border-radius: 4px; font-weight: 700; text-transform: uppercase; }
    .supplier-tag-transport { background: #e0f2fe; color: #0369a1; } 
    .supplier-tag-shipping { background: #f0fdfa; color: #0f766e; }  
    .supplier-tag-broker { background: #fff7ed; color: #c2410c; }    
    .supplier-tag-vendor { background: #f3e8ff; color: #7e22ce; }    

    /* Drawer & Inputs */
    .offcanvas-custom { width: 650px !important; }
    .smart-input { font-size: 0.9rem; padding: 0.6rem; border-radius: 8px; border: 1px solid #e0e0e0; }
    .smart-input:focus { border-color: #8B5CF6; box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1); outline: none; }

    /* Star Rating */
    .star-rating i { cursor: pointer; transition: color 0.2s; font-size: 1.2rem; }
    .star-rating i.active { color: #EE7D04; }
    .star-rating i.inactive { color: #E2E8F0; }

    /* Sales Blocker Overlay */
    #sales-blocker {
      position: absolute; inset: 0; z-index: 50;
      background: rgba(255, 255, 255, 0.8);
      backdrop-filter: blur(8px);
      display: flex; flex-direction: column; align-items: center; justify-content: center;
    }

    .hidden { display: none !important; }
    .offcanvas-body { overflow-y: auto; overflow-x: hidden; }
    form.tab-content { height: 100%; display: flex; flex-direction: column; }
    .tab-pane { width: 100%; }
    .sub-link.active { color: var(--smart-orange); font-weight: 700; background: rgba(0,0,0,0.03); }
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
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#admin1" aria-expanded="true">
                <span><i class="fa-solid fa-database category-icon"></i> MASTER DATA</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="admin1" class="accordion-collapse collapse show" data-bs-parent="#adminMenu">
                <div class="sub-menu">
                    <a href="client-master-registry.php" class="sub-link">Client Master Registry</a>
                    <a href="supplier-master-registry.php" class="sub-link active">Supplier Master Registry</a>
                    <a href="employee-master.php" class="sub-link">Employee Master Registry</a>
                    <a href="financial-dictionary.php" class="sub-link">Financial Dictionary</a>
                </div>
            </div>
        </div>
        
        <div class="accordion-item border-0">
            <button class="menu-btn collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#admin2">
                <span><i class="fa-solid fa-users category-icon"></i> CRM & ACQUISITION</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="admin2" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
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
            <button class="menu-btn collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#admin3">
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
            <button class="menu-btn collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#admin4">
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
            <button class="menu-btn collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#admin5">
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
            <button class="menu-btn collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#admin6">
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
            <button class="menu-btn collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#admin7">
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
      <h5 class="mb-0 fw-bold text-dark">Supplier Master</h5>
      <small class="text-muted" style="font-size: 0.7rem;">APPROVED VENDOR LIST (AVL)</small>
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
    <div id="sales-blocker" class="hidden">
      <div class="bg-white p-5 rounded-4 shadow-lg border text-center" style="max-width: 400px;">
        <div class="mb-3 bg-danger bg-opacity-10 rounded-circle d-inline-flex align-items-center justify-content-center" style="width: 64px; height: 64px;">
          <i class="fa-solid fa-lock text-danger fs-3"></i>
        </div>
        <h4 class="fw-bold text-dark">Access Restricted</h4>
        <p class="text-muted small mb-0">Sales personnel are not authorized to view or manage the Supplier Master.</p>
      </div>
    </div>

    <div class="row pt-4 mb-4 g-3">
      <div class="col-xl-3 col-md-6">
        <div class="supplier-card-custom p-4 d-flex align-items-center border-start border-4 border-primary">
          <div class="me-3 bg-primary bg-opacity-10 rounded-circle d-flex align-items-center justify-content-center" style="width: 48px; height: 48px;">
            <i class="fa-solid fa-truck-field text-primary fs-5"></i>
          </div>
          <div>
            <div class="supplier-kpi-title">Total Vendors</div>
            <div class="supplier-kpi-value" id="kpi-total">0</div>
          </div>
        </div>
      </div>
      <div class="col-xl-3 col-md-6">
        <div class="supplier-card-custom p-4 d-flex align-items-center border-start border-4 border-success">
          <div class="me-3 bg-success bg-opacity-10 rounded-circle d-flex align-items-center justify-content-center" style="width: 48px; height: 48px;">
            <i class="fa-solid fa-check-circle text-success fs-5"></i>
          </div>
          <div>
            <div class="supplier-kpi-title">Active (AVL)</div>
            <div class="supplier-kpi-value" id="kpi-active">0</div>
          </div>
        </div>
      </div>
      <div class="col-xl-3 col-md-6 finance-only">
        <div class="supplier-card-custom p-4 d-flex align-items-center border-start border-4 border-warning">
          <div class="me-3 bg-warning bg-opacity-10 rounded-circle d-flex align-items-center justify-content-center" style="width: 48px; height: 48px;">
            <i class="fa-solid fa-file-invoice-dollar text-warning fs-5"></i>
          </div>
          <div>
            <div class="supplier-kpi-title">Total Payables</div>
            <div class="supplier-kpi-value fs-4">
              <span id="kpi-payables">0</span> <small class="text-muted fs-6">XAF</small>
            </div>
          </div>
        </div>
      </div>
      <div class="col-xl-3 col-md-6 finance-only">
        <div class="supplier-card-custom p-4 d-flex align-items-center border-start border-4 border-danger">
          <div class="me-3 bg-danger bg-opacity-10 rounded-circle d-flex align-items-center justify-content-center" style="width: 48px; height: 48px;">
            <i class="fa-solid fa-clock text-danger fs-5"></i>
          </div>
          <div>
            <div class="supplier-kpi-title">Overdue</div>
            <div class="supplier-kpi-value fs-4">
              <span id="kpi-overdue">0</span> <small class="text-muted fs-6">XAF</small>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="supplier-card-custom p-4 mb-4">
      <div class="d-flex flex-wrap justify-content-between align-items-center gap-3">
       <div class="d-flex gap-2">
      <button onclick="filterCategory('ALL')" class="btn btn-dark btn-sm fw-bold rounded-pill px-3 filter-btn active">All</button>
      <button onclick="filterCategory('TRANSPORTER')" class="btn btn-outline-secondary btn-sm fw-bold rounded-pill px-3 filter-btn">Transporters</button>
      <button onclick="filterCategory('SHIPPING_LINE')" class="btn btn-outline-secondary btn-sm fw-bold rounded-pill px-3 filter-btn">Shipping Lines</button>
      <button onclick="filterCategory('CUSTOMS_BROKER')" class="btn btn-outline-secondary btn-sm fw-bold rounded-pill px-3 filter-btn">Brokers</button>
      
      <button onclick="filterCategory('OVERDUE')" class="btn btn-outline-danger btn-sm fw-bold rounded-pill px-3 filter-btn">Overdue</button>
    </div>
        <div class="d-flex gap-3">
          <div class="input-group input-group-sm">
            <span class="input-group-text bg-white"><i class="fa-solid fa-magnifying-glass text-muted"></i></span>
            <input type="text" id="search-input" onkeyup="renderTable()" class="form-control" placeholder="Search suppliers..." style="width: 250px;">
          </div>
          <button onclick="openDrawer('new')" id="btn-create" class="btn btn-dark btn-sm fw-bold shadow-sm d-flex align-items-center gap-2">
            <i class="fa-solid fa-plus"></i> New Supplier
          </button>
        </div>
      </div>
    </div>

    <div class="supplier-card-custom">
      <div class="table-responsive">
        <table class="table table-hover supplier-table-custom align-middle mb-0">
          <thead>
            <tr>
              <th class="ps-4">Supplier Entity</th>
              <th>Service Category</th>
              <th>Contact</th>
              <th class="text-center">Rating</th>
              <th class="text-end finance-only">Payables (XAF)</th>
              <th>Status</th>
              <th class="text-end pe-4">Action</th>
            </tr>
          </thead>
          <tbody id="supplier-table-body"></tbody>
        </table>
      </div>
    </div>
  </div>

  <div class="offcanvas offcanvas-end offcanvas-custom" tabindex="-1" id="supplierDrawer" data-bs-backdrop="static">
    <div class="offcanvas-header border-bottom bg-light">
      <div>
        <h5 class="offcanvas-title fw-bold font-heading" id="drawer-title">New Supplier</h5>
        <small class="text-muted">Approved Vendor List (AVL) Entry</small>
      </div>
      <button type="button" class="btn-close" data-bs-dismiss="offcanvas"></button>
    </div>

    <div class="bg-white border-bottom px-3">
      <ul class="nav nav-tabs" id="supplierTabs" role="tablist">
        <li class="nav-item">
          <button class="nav-link active" id="identity-tab" data-bs-toggle="tab" data-bs-target="#identity" type="button">Identity & Finance</button>
        </li>
        <li class="nav-item">
          <button class="nav-link" id="evaluation-tab" data-bs-toggle="tab" data-bs-target="#evaluation" type="button">Evaluation & Docs</button>
        </li>
      </ul>
    </div>

    <div class="offcanvas-body p-4">
      <form id="supplier-form" class="tab-content" onsubmit="event.preventDefault();">
        <div class="tab-pane fade show active" id="identity" role="tabpanel">
          <div class="d-flex justify-content-between align-items-center p-3 bg-light rounded border mb-4">
            <div>
              <div class="text-uppercase small text-muted fw-bold">System ID</div>
              <div class="font-monospace fw-bold" id="inp-system-id">SLAS-SS-NEW</div>
            </div>
            <span class="badge bg-secondary" id="inp-status-badge">NEW</span>
          </div>

          <div class="row g-3 mb-3">
            <div class="col-12">
              <label class="smart-form-label">Legal Name <span class="text-danger">*</span></label>
              <input type="text" id="inp-name" class="form-control smart-input" required>
            </div>
            <div class="col-12">
              <label class="smart-form-label">Category <span class="text-danger">*</span></label>
              <select id="inp-type" class="form-select smart-input" onchange="toggleCategoryOther()">
                <option value="TRANSPORTER">Transporter</option>
                <option value="SHIPPING_LINE">Shipping Line</option>
                <option value="CUSTOMS_BROKER">Customs Broker</option>
                <option value="AIRLINE">Airline</option>
                <option value="WATER_SUPPLIER">Water Supplier</option>
                <option value="ELECTRICITY_SUPPLIER">Electricity Supplier</option>
                <option value="INTERNET_SUPPLIER">Internet Supplier</option>
                <option value="OFFICE_MAINTENANCE">Office Maintenance</option>
                <option value="OFFICE_SUPPLIES">Office Supplies</option>
                <option value="PORT_RTC">Port / RTC</option>
                <option value="CUSTOMS">Customs</option>
                <option value="SGS">SGS</option>
                <option value="SERVICE_PROVIDER">Service Provider</option>
                <option value="OTHER">Other (Specify)</option>
              </select>
              <input type="text" id="inp-type-other" class="form-control smart-input mt-2 hidden" placeholder="Specify Category...">
            </div>
            <div class="col-6">
              <label class="smart-form-label">Tax ID (NIU)</label>
              <input type="text" id="inp-niu" class="form-control smart-input">
            </div>
            <div class="col-6">
              <label class="smart-form-label">RCCM</label>
              <input type="text" id="inp-rccm" class="form-control smart-input" placeholder="e.g. RC/DLA/2020/B/1234">
            </div>
            <div class="col-6">
              <label class="smart-form-label">Contact Person <span class="text-danger">*</span></label>
              <input type="text" id="inp-contact" class="form-control smart-input" required>
            </div>
            <div class="col-6">
              <label class="smart-form-label">Email <span class="text-danger">*</span></label>
              <input type="email" id="inp-email" class="form-control smart-input" required>
            </div>
            <div class="col-6">
              <label class="smart-form-label">Phone <span class="text-danger">*</span></label>
              <input type="text" id="inp-phone" class="form-control smart-input" required>
            </div>
            <div class="col-12">
              <label class="smart-form-label">Address <span class="text-danger">*</span></label>
              <textarea id="inp-address" class="form-control smart-input" rows="2" required></textarea>
            </div>
            <div class="col-12">
              <label class="smart-form-label">Country</label>
              <input type="text" id="inp-country" class="form-control smart-input" value="Cameroon">
            </div>
          </div>

          <h6 class="smart-form-label border-bottom pb-2 mt-4 mb-3 text-primary">Payment Configuration</h6>
          <div class="bg-light p-3 rounded border">
            <div class="row g-3">
              <div class="col-6">
                <label class="smart-form-label">Payment Method</label>
                <select id="inp-method" class="form-select smart-input" onchange="togglePaymentFields()">
                  <option value="BANK_TRANSFER">Bank Transfer</option>
                  <option value="CHEQUE">Cheque</option>
                  <option value="MOBILE_MONEY">Mobile Money</option>
                  <option value="CASH">Cash</option>
                </select>
              </div>
              <div class="col-6">
                <label class="smart-form-label">Terms (Days)</label>
                <input type="number" id="inp-terms" class="form-control smart-input" value="30">
              </div>
            </div>
            <div id="bank-fields" class="mt-3 border-top pt-3">
              <input type="text" id="inp-bank-name" class="form-control smart-input mb-2" placeholder="Bank Name">
              <input type="text" id="inp-account-number" class="form-control smart-input mb-2" placeholder="Account Number / RIB">
              <input type="text" id="inp-account-name" class="form-control smart-input" placeholder="Account Name">
            </div>
            <div id="momo-fields" class="mt-3 border-top pt-3 hidden">
              <select id="inp-momo-network" class="form-select smart-input mb-2">
                <option value="">Select MoMo Network</option>
                <option value="MTN">MTN</option>
                <option value="ORANGE">ORANGE</option>
              </select>
              <input type="text" id="inp-momo-number" class="form-control smart-input" placeholder="MoMo Number">
            </div>
          </div>
        </div>

        <div class="tab-pane fade" id="evaluation" role="tabpanel">
          <div class="p-4 bg-warning bg-opacity-10 rounded border border-warning border-opacity-25 mb-4">
            <h6 class="text-warning text-uppercase fw-bold small mb-2">Vendor Performance (ISO 9001)</h6>
            <div class="d-flex align-items-center gap-2 mb-3 star-rating" id="star-container">
              <i class="fa-solid fa-star inactive" onclick="setRating(1)"></i>
              <i class="fa-solid fa-star inactive" onclick="setRating(2)"></i>
              <i class="fa-solid fa-star inactive" onclick="setRating(3)"></i>
              <i class="fa-solid fa-star inactive" onclick="setRating(4)"></i>
              <i class="fa-solid fa-star inactive" onclick="setRating(5)"></i>
              <span class="ms-2 small fw-bold text-muted" id="rating-text">Not Rated</span>
            </div>
            <textarea class="form-control smart-input" id="inp-eval-notes" rows="3" placeholder="Performance history notes..."></textarea>
          </div>

          <div class="mb-4">
            <label class="smart-form-label mb-2">Compliance Documents</label>
            <div class="bg-light p-3 rounded border">
              <div id="existing-docs-container" class="mb-3"></div>

              <div class="row g-2 mb-2">
                <div class="col-6">
                  <select class="form-select form-select-sm" id="inp-doc-type">
                    <option value="TAXPAYER_CARD">Taxpayer Card (NIU)</option>
                    <option value="BUSINESS_LICENSE">Business License (RCCM)</option>
                    <option value="BANK_RIB">Bank RIB</option>
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

              <div id="doc-input-digital" class="border border-dashed bg-white p-3 text-center rounded"
                   role="button" tabindex="0" style="cursor:pointer;" onclick="document.getElementById('inp-doc-file').click()">
                <input type="file" id="inp-doc-file" class="d-none" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"/>
                <small class="text-muted"><i class="fa-solid fa-cloud-arrow-up"></i> Click to select PDF/JPG/PNG</small>
                <div id="doc-upload-status" class="small text-muted mt-2"></div>
              </div>

              <div id="doc-input-physical" class="hidden mt-2">
                <input type="text" id="inp-physical-ref" class="form-control form-control-sm" placeholder="Archive Reference Number (Required)">
              </div>

              <button type="button" class="btn btn-outline-dark btn-sm w-100 mt-2" onclick="addDocumentRecord()">Add Document</button>
              
              <div class="mt-3">
                <div class="small text-muted fw-bold mb-2">Queued Uploads (Save to Commit)</div>
                <div id="doc-queue" class="d-grid gap-2"></div>
              </div>
            </div>
          </div>

          <div class="form-check mt-4 border-top pt-3 border-danger">
            <input class="form-check-input" type="checkbox" id="inp-deactivate">
            <label class="form-check-label small fw-bold text-danger" for="inp-deactivate">Deactivate Vendor (Remove from AVL)</label>
          </div>
        </div>
      </form>
    </div>

    <div class="p-4 border-top bg-white d-flex justify-content-end gap-2">
      <button type="button" class="btn btn-light text-muted fw-bold" data-bs-dismiss="offcanvas">Cancel</button>
      <button type="button" id="btn-save" onclick="saveSupplier()" class="btn btn-dark fw-bold px-4">Save Supplier</button>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

  <script>
  // --- Constants ---
  const CURRENT_USER_ROLE = <?php echo json_encode($role); ?>;
  const SUPPLIER_LIST_API = '../../api/suppliers/list.php';
  const SUPPLIER_GET_API  = '../../api/suppliers/get.php';
  const SUPPLIER_SAVE_API = '../../api/suppliers/save.php';

  let suppliers = [];
  let activeFilter = 'ALL';
  let supplierDrawer;
  let currentRating = 0;
  let docQueue = []; 

  function escapeHtml(s){
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c]));
  }
  function fmtMoneyXaf(n){
    return Math.round(Number(n || 0)).toLocaleString();
  }

  // --- Loading Spinner Helper ---
  function setLoading(btnId, isLoading) {
      const btn = document.getElementById(btnId);
      if(!btn) return;
      if(isLoading) {
          btn.dataset.originalText = btn.innerHTML;
          btn.disabled = true;
          btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-2"></i> Processing...';
      } else {
          btn.disabled = false;
          btn.innerHTML = btn.dataset.originalText || 'Save Supplier';
      }
  }

  async function fetchSuppliers(){
    const q = (document.getElementById('search-input')?.value || '').trim();
    const url = new URL(SUPPLIER_LIST_API, window.location.href);
    
    // LOGIC CHANGE: If filter is 'OVERDUE', fetch 'ALL' from server (we filter in UI)
    const typeToSend = (activeFilter === 'OVERDUE') ? 'ALL' : (activeFilter || 'ALL');
    url.searchParams.set('type', typeToSend);
    
    if (q) url.searchParams.set('q', q);

    const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Failed to load suppliers');

    const k = data.kpis || {};
    document.getElementById('kpi-total')    && (document.getElementById('kpi-total').innerText = (k.total ?? 0));
    document.getElementById('kpi-active')   && (document.getElementById('kpi-active').innerText = (k.active ?? 0));
    document.getElementById('kpi-payables') && (document.getElementById('kpi-payables').innerText = fmtMoneyXaf(k.payables ?? 0));
    document.getElementById('kpi-overdue')  && (document.getElementById('kpi-overdue').innerText = fmtMoneyXaf(k.overdue ?? 0));

    suppliers = Array.isArray(data.rows) ? data.rows : [];
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const drawerEl = document.getElementById('supplierDrawer');
    if (!drawerEl) return;
    supplierDrawer = bootstrap.Offcanvas.getOrCreateInstance(drawerEl);

    // Scroll Fix
    document.getElementById('supplierTabs').addEventListener('shown.bs.tab', function (event) {
        document.querySelector('.offcanvas-body').scrollTop = 0;
    });

    const fileInp = document.getElementById('inp-doc-file');
    fileInp?.addEventListener('change', () => {
      const f = fileInp.files && fileInp.files[0];
      const status = document.getElementById('doc-upload-status');
      status && (status.innerText = f ? `Selected: ${f.name}` : '');
    });

    toggleDocInput();
    renderDocQueue();
    updateRoleVisibility();
    await renderTable();
  });

  async function renderTable() {
    const tbody = document.getElementById('supplier-table-body');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-muted">Loading suppliers...</td></tr>`;

    try { await fetchSuppliers(); } catch (e) {
      console.error(e);
      tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-danger">Failed to load suppliers.</td></tr>`;
      return;
    }

    // FILTER LOGIC: Apply Overdue Filter here
    const listToRender = suppliers.filter(s => {
        if (activeFilter === 'OVERDUE') return s.overdue > 0;
        return true; // Other filters handled by server
    });

    if (listToRender.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-muted fst-italic">No suppliers found.</td></tr>`;
        updateRoleVisibility();
        return;
    }

    tbody.innerHTML = listToRender.map(s => {
      let typeClass = 'supplier-tag-vendor';
      if (s.type === 'TRANSPORTER') typeClass = 'supplier-tag-transport';
      if (s.type === 'SHIPPING_LINE') typeClass = 'supplier-tag-shipping';
      if (s.type === 'CUSTOMS_BROKER') typeClass = 'supplier-tag-broker';

      let stars = '';
      const r = Number(s.rating || 0);
      for (let i=1; i<=5; i++) {
        stars += `<i class="fa-solid fa-star text-warning" style="font-size: 0.7rem; opacity: ${i <= r ? 1 : 0.2}"></i>`;
      }

      const statusBadge = (String(s.status || '').toUpperCase() === 'ACTIVE')
        ? '<span class="badge bg-success bg-opacity-10 text-success border border-success border-opacity-25 rounded-pill">ACTIVE</span>'
        : '<span class="badge bg-secondary bg-opacity-10 text-secondary border border-secondary border-opacity-25 rounded-pill">DEACTIVATED</span>';

      const canEdit = (CURRENT_USER_ROLE !== 'OPERATIONS');
      const actionBtn = canEdit
        ? `<button type="button" class="btn btn-sm btn-dark fw-bold rounded-pill px-3" onclick="editSupplier('${escapeHtml(s.id)}')">
             <i class="fa-solid fa-pen-to-square me-1"></i> Update
           </button>`
        : `<button type="button" class="btn btn-sm btn-outline-secondary fw-bold rounded-pill px-3" onclick="viewSupplier('${escapeHtml(s.id)}')">
             <i class="fa-solid fa-eye me-1"></i> View
           </button>`;

      const payablesVal = fmtMoneyXaf(s.payables);
      const overdueVal  = fmtMoneyXaf(s.overdue);
      
      const financeCell = `
        <div class="d-flex flex-column align-items-end lh-1">
            <div class="text-success fw-bold">${payablesVal}</div>
            ${s.overdue > 0 ? `<div class="text-danger small fw-bold mt-1" style="font-size:0.75rem;">${overdueVal} Overdue</div>` : ''}
        </div>
      `;

      return `
        <tr>
          <td class="ps-4">
            <div class="fw-bold text-dark">${escapeHtml(s.name)}</div>
            <div class="small text-muted font-monospace">${escapeHtml(s.id)}</div>
          </td>
          <td><span class="supplier-tag ${typeClass}">${escapeHtml(s.type)}</span></td>
          <td class="small text-secondary">
            <div>${escapeHtml(s.contact || '')}</div>
            <div class="text-muted">${escapeHtml(s.email || '')}</div>
          </td>
          <td class="text-center">${stars}</td>
          <td class="text-end finance-only font-monospace text-dark">${financeCell}</td>
          <td>${statusBadge}</td>
          <td class="text-end pe-4">${actionBtn}</td>
        </tr>
      `;
    }).join('');

    updateRoleVisibility();
  }

  function updateRoleVisibility() {
    const isFinance = (CURRENT_USER_ROLE === 'FINANCE' || CURRENT_USER_ROLE === 'ADMIN');
    if (CURRENT_USER_ROLE === 'SALES') {
      document.getElementById('sales-blocker')?.classList.remove('hidden');
      document.body.style.overflow = 'hidden';
    } else {
      document.getElementById('sales-blocker')?.classList.add('hidden');
      document.body.style.overflow = 'auto';
    }
    document.querySelectorAll('.finance-only').forEach(el => {
      if (isFinance) el.classList.remove('hidden');
      else el.classList.add('hidden');
    });
    const btnCreate = document.getElementById('btn-create');
    if (btnCreate) {
      if (CURRENT_USER_ROLE === 'OPERATIONS') btnCreate.classList.add('d-none');
      else btnCreate.classList.remove('d-none');
    }
  }

  function filterCategory(type) {
    activeFilter = type;
    document.querySelectorAll('.filter-btn').forEach(btn => {
      const label = btn.innerText.toUpperCase();
      const active = (type === 'ALL' && btn.innerText === 'All') || label.includes(type);
      if (active) {
        btn.classList.add('btn-dark','active');
        btn.classList.remove('btn-outline-secondary');
      } else {
        btn.classList.remove('btn-dark','active');
        btn.classList.add('btn-outline-secondary');
      }
    });
    renderTable();
  }

  function toggleCategoryOther() {
      const val = document.getElementById('inp-type').value;
      const otherInp = document.getElementById('inp-type-other');
      if(val === 'OTHER') {
          otherInp.classList.remove('hidden');
      } else {
          otherInp.classList.add('hidden');
          otherInp.value = '';
      }
  }

  function openDrawer(mode) {
    document.getElementById('supplier-form')?.reset();
    docQueue = [];
    renderDocQueue();
    document.getElementById('existing-docs-container').innerHTML = '';
    document.getElementById('doc-upload-status').innerText = '';
    document.getElementById('inp-doc-file').value = '';

    const triggerEl = document.querySelector('#supplierTabs button[data-bs-target="#identity"]');
    triggerEl && bootstrap.Tab.getOrCreateInstance(triggerEl).show();

    if (mode === 'new') {
      document.getElementById('drawer-title').innerText = "New Supplier";
      document.getElementById('inp-system-id').innerText = "SLAS-SS-AUTO";
      document.getElementById('inp-status-badge').className = "badge bg-secondary";
      document.getElementById('inp-status-badge').innerText = "NEW";
      document.getElementById('inp-deactivate').checked = false;
      document.getElementById('inp-type').value = 'TRANSPORTER';
      toggleCategoryOther();
      setRating(0);
      togglePaymentFields();
      toggleDocInput();
    }
    supplierDrawer.show();
  }

  async function editSupplier(id){
    try{
      const url = new URL(SUPPLIER_GET_API, window.location.href);
      url.searchParams.set('supplier_id', id);

      const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
      const data = await res.json();
      if (!data.ok) { alert(data.error || 'Failed.'); return; }

      const s = data.supplier;
      docQueue = [];
      renderDocQueue();
      document.getElementById('doc-upload-status').innerText = '';
      document.getElementById('inp-doc-file').value = '';

      document.getElementById('drawer-title').innerText = "Update Supplier";
      document.getElementById('inp-system-id').innerText = s.supplier_id;
      document.getElementById('inp-status-badge').innerText = (String(s.status || 'ACTIVE').toUpperCase());
      document.getElementById('inp-status-badge').className =
        (String(s.status || '').toUpperCase() === 'ACTIVE') ? 'badge bg-success' : 'badge bg-danger';

      document.getElementById('inp-name').value = s.supplier_name || '';
      
      const predef = ['TRANSPORTER','SHIPPING_LINE','CUSTOMS_BROKER','AIRLINE','WATER_SUPPLIER','ELECTRICITY_SUPPLIER','INTERNET_SUPPLIER','OFFICE_MAINTENANCE','OFFICE_SUPPLIES','PORT_RTC','CUSTOMS','SGS','SERVICE_PROVIDER'];
      const dbType = s.supplier_type || '';
      if(predef.includes(dbType)) {
          document.getElementById('inp-type').value = dbType;
          toggleCategoryOther();
      } else {
          document.getElementById('inp-type').value = 'OTHER';
          toggleCategoryOther();
          document.getElementById('inp-type-other').value = dbType.replace('OTHER - ', '') || dbType;
      }

      document.getElementById('inp-niu').value     = s.niu || '';
      document.getElementById('inp-contact').value = s.contact_person || '';
      document.getElementById('inp-email').value   = s.contact_email || '';
      document.getElementById('inp-phone').value   = s.contact_phone || '';
      document.getElementById('inp-rccm').value    = s.rccm || '';
      document.getElementById('inp-address').value = s.address || '';
      document.getElementById('inp-country').value = s.country || 'Cameroon';

      document.getElementById('inp-method').value = s.payment_method || 'CASH';
      document.getElementById('inp-terms').value  = Number(s.payment_terms_days || 30);
      document.getElementById('inp-bank-name').value      = s.bank_name || '';
      document.getElementById('inp-account-number').value = s.account_number || '';
      document.getElementById('inp-account-name').value   = s.account_name || '';
      document.getElementById('inp-momo-network').value   = s.momo_network || '';
      document.getElementById('inp-momo-number').value    = s.momo_number || '';

      setRating(Number(s.rating || 0));
      document.getElementById('inp-eval-notes').value = s.evaluation_notes || '';
      document.getElementById('inp-deactivate').checked = (String(s.status || '').toUpperCase() === 'DEACTIVATED');

      togglePaymentFields();
      toggleDocInput();

      const docBox = document.getElementById('existing-docs-container');
      if(s.documents && s.documents.length > 0) {
          docBox.innerHTML = '<div class="small fw-bold mb-2">Saved Documents:</div>' + s.documents.map(d => `
            <div class="d-flex align-items-center justify-content-between p-2 mb-2 border rounded bg-white">
                <div class="d-flex align-items-center gap-2">
                    <i class="fa-solid fa-file-pdf text-danger"></i>
                    <div>
                        <div class="small fw-bold">${escapeHtml(d.document_type)}</div>
                        <div class="small text-muted" style="font-size:0.7rem;">${d.date}</div>
                    </div>
                </div>
                ${d.storage_mode === 'DIGITAL' && d.path 
                    ? `<a href="${d.path}" target="_blank" class="btn btn-sm btn-light border"><i class="fa-solid fa-download"></i></a>`
                    : `<span class="badge bg-secondary">PHYSICAL</span>`
                }
            </div>
          `).join('');
      } else {
          docBox.innerHTML = '<div class="small text-muted fst-italic mb-3">No documents saved yet.</div>';
      }

      const triggerEl = document.querySelector('#supplierTabs button[data-bs-target="#identity"]');
      triggerEl && bootstrap.Tab.getOrCreateInstance(triggerEl).show();

      supplierDrawer.show();
    }catch(e){
      console.error(e);
      alert('Network error.');
    }
  }

  function viewSupplier(id){ editSupplier(id); }

  function togglePaymentFields() {
    const val = document.getElementById('inp-method')?.value;
    const bankDiv = document.getElementById('bank-fields');
    const momoDiv = document.getElementById('momo-fields');
    bankDiv?.classList.add('hidden');
    momoDiv?.classList.add('hidden');
    if (val === 'BANK_TRANSFER' || val === 'CHEQUE') bankDiv?.classList.remove('hidden');
    if (val === 'MOBILE_MONEY') momoDiv?.classList.remove('hidden');
  }

  function setRating(r) {
    currentRating = r;
    const stars = document.querySelectorAll('#star-container i');
    stars.forEach((s, idx) => {
      if (idx < r) { s.classList.add('active'); s.classList.remove('inactive'); }
      else { s.classList.add('inactive'); s.classList.remove('active'); }
    });
    document.getElementById('rating-text').innerText = r > 0 ? r + '/5 Stars' : 'Not Rated';
  }

  function toggleDocInput() {
    const mode = document.getElementById('doc-type-toggle')?.value || 'DIGITAL';
    const dig = document.getElementById('doc-input-digital');
    const phy = document.getElementById('doc-input-physical');
    const status = document.getElementById('doc-upload-status');
    if (mode === 'PHYSICAL') {
      dig?.classList.add('hidden');
      phy?.classList.remove('hidden');
      status && (status.innerText = '');
      document.getElementById('inp-doc-file').value = '';
    } else {
      phy?.classList.add('hidden');
      dig?.classList.remove('hidden');
    }
  }

  function renderDocQueue() {
    const box = document.getElementById('doc-queue');
    if (!box) return;
    if (!docQueue.length) {
      box.innerHTML = `<div class="small text-muted">No documents queued yet.</div>`;
      return;
    }
    box.innerHTML = docQueue.map((d, idx) => {
      const meta = d.storage_mode === 'PHYSICAL'
        ? `PHYSICAL • Ref: ${escapeHtml(d.physical_ref || '')}`
        : `DIGITAL • File: ${escapeHtml(d.file?.name || '')}`;
      return `
        <div class="p-2 border rounded d-flex justify-content-between align-items-center bg-white">
          <div>
            <div class="fw-bold small">${escapeHtml(d.document_type)}</div>
            <div class="small text-muted">${meta}</div>
          </div>
          <button type="button" class="btn btn-sm btn-outline-danger fw-bold" onclick="removeDocFromQueue(${idx})">Remove</button>
        </div>
      `;
    }).join('');
  }

  function removeDocFromQueue(idx) {
    docQueue.splice(idx, 1);
    renderDocQueue();
  }

  function addDocumentRecord() {
    const docType = document.getElementById('inp-doc-type')?.value || 'TAXPAYER_CARD';
    const mode = document.getElementById('doc-type-toggle')?.value || 'DIGITAL';
    if (mode === 'PHYSICAL') {
      const ref = document.getElementById('inp-physical-ref')?.value?.trim();
      if (!ref) { alert('Archive Ref required.'); return; }
      docQueue.push({ document_type: docType, storage_mode: 'PHYSICAL', file: null, physical_ref: ref });
      document.getElementById('inp-physical-ref').value = '';
    } else {
      const f = document.getElementById('inp-doc-file')?.files?.[0];
      if (!f) { alert('Select a file.'); return; }
      docQueue.push({ document_type: docType, storage_mode: 'DIGITAL', file: f, physical_ref: null });
      document.getElementById('inp-doc-file').value = '';
      document.getElementById('doc-upload-status').innerText = '';
    }
    renderDocQueue();
  }

  async function saveSupplier() {
    setLoading('btn-save', true);

    const supplierIdText = (document.getElementById('inp-system-id')?.innerText || '').trim();
    const deactivate = document.getElementById('inp-deactivate')?.checked;
    const status = deactivate ? 'DEACTIVATED' : 'ACTIVE';
    
    let finalType = document.getElementById('inp-type').value;
    if(finalType === 'OTHER') {
        const otherText = document.getElementById('inp-type-other').value.trim();
        finalType = otherText ? "OTHER - " + otherText : "OTHER";
    }

    const payload = {
      supplier_id: supplierIdText,
      supplier_name: document.getElementById('inp-name')?.value?.trim(),
      supplier_type: finalType,
      contact_person: document.getElementById('inp-contact')?.value?.trim(),
      contact_email: document.getElementById('inp-email')?.value?.trim(),
      contact_phone: document.getElementById('inp-phone')?.value?.trim(),
      niu: document.getElementById('inp-niu')?.value?.trim() || null,
      rccm: document.getElementById('inp-rccm')?.value?.trim() || null,
      address: document.getElementById('inp-address')?.value?.trim(),
      country: document.getElementById('inp-country')?.value?.trim() || 'Cameroon',
      payment_method: document.getElementById('inp-method')?.value,
      payment_terms_days: parseInt(document.getElementById('inp-terms')?.value || '30', 10),
      bank_name: document.getElementById('inp-bank-name')?.value?.trim() || null,
      account_number: document.getElementById('inp-account-number')?.value?.trim() || null,
      account_name: document.getElementById('inp-account-name')?.value?.trim() || null,
      momo_network: document.getElementById('inp-momo-network')?.value || null,
      momo_number: document.getElementById('inp-momo-number')?.value?.trim() || null,
      rating: currentRating || 0,
      evaluation_notes: document.getElementById('inp-eval-notes')?.value?.trim() || null,
      status,
      documents: docQueue.map(d => ({
        document_type: d.document_type,
        storage_mode: d.storage_mode,
        physical_ref: d.storage_mode === 'PHYSICAL' ? (d.physical_ref || null) : null
      }))
    };

    const fd = new FormData();
    fd.append('payload', JSON.stringify(payload));
    docQueue.forEach((d, idx) => {
      if (d.storage_mode === 'DIGITAL' && d.file) {
        fd.append(`doc_file_${idx}`, d.file, d.file.name);
      }
    });

    try {
      const res = await fetch(SUPPLIER_SAVE_API, { method: 'POST', body: fd });
      const data = await res.json().catch(() => null);
      
      if (!res.ok || !data || !data.ok) {
        alert((data && data.error ? data.error : 'Save failed') + (data && data.detail ? ("\n\n" + data.detail) : ""));
        setLoading('btn-save', false);
        return;
      }
      if (data.supplier_id) document.getElementById('inp-system-id').innerText = data.supplier_id;
      docQueue = [];
      renderDocQueue();
      supplierDrawer.hide();
      await renderTable();
      alert('Supplier saved successfully.');

    } catch (err) {
      console.error(err);
      alert('Network/server error while saving.');
    } finally {
        setLoading('btn-save', false);
    }
  }
  </script>
</body>
</html>