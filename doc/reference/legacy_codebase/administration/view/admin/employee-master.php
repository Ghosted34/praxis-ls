<?php
/**
 * EMPLOYEE MASTER REGISTRY
 * -------------------------------------------------------------------------
 * This module manages the full lifecycle of employee data.
 * Features:
 * 1. Employee List: Searchable, filterable (Dept, Contract, Date).
 * 2. Profile Management: Personal info, Avatar, Employment details.
 * 3. Document Vault: Upload/Download CVs, Contracts, and IDs.
 * 4. Finance Control: Payroll data, Bank info, and System Authority.
 * 5. KPI Dashboard: Real-time headcount and financial exposure metrics.
 * * Dependencies:
 * - api/employees/list.php (Fetch data)
 * - api/employees/save.php (Handle multipart form save)
 * - api/employees/get.php  (Fetch single record + docs)
 */

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'FINANCE', 'MANAGEMENT']);

// --- Fetch current admin details ---
$employeeId = (string)($_SESSION['auth']['employee_id'] ?? '');
$userId     = (int)($_SESSION['auth']['user_id'] ?? 0);

if ($employeeId === '' || $userId <= 0) {
  header('Location: ../../api/auth/logout.php');
  exit;
}

$conn = db();
$sql = "
  SELECT 
    em.employee_id, em.full_name, em.avatar_path, ua.role, ua.username
  FROM user_auth ua
  JOIN employee_master em ON em.employee_id = ua.employee_id
  WHERE ua.user_id = ? AND em.employee_id = ? LIMIT 1
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

$fullName  = $me['full_name'] ?: 'Admin';
$firstName = trim(explode(' ', $fullName)[0] ?? 'Admin');
$role      = strtoupper((string)($me['role'] ?? 'ADMIN'));
$roleLabel = ($role === 'ADMIN') ? 'SYSTEM ADMIN' : $role;

$dbAvatar = $me['avatar_path'] ?? '';
if (!empty($dbAvatar)) {
    // We go up two levels to reach the root where 'administration/' folder usually sits
    $myAvatarUrl = '../../' . $dbAvatar; 
} else {
    $avatarName = urlencode($fullName);
    $myAvatarUrl = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";
}

?>
<!DOCTYPE html>
<html lang="en">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.5.13/cropper.min.css" rel="stylesheet">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.5.13/cropper.min.js"></script>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Employee Master | Smart LS</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  
  <style>
    /* Custom Tweaks for Avatar & Docs */
    .avatar-preview {
      width: 100px; height: 100px;
      object-fit: cover;
      border-radius: 50%;
      border: 3px solid #fff;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }
    .doc-item {
      transition: background 0.2s;
    }
    .doc-item:hover {
      background-color: #f8f9fa;
    }
  </style>
  
  <style>
  /* PATCH: Prevent KPI overflow */
  #stat-payroll {
      font-size: 1.1rem !important; /* Reduces size from standard 1.5rem */
      white-space: nowrap;          /* Prevents wrapping */
      overflow: hidden;             /* Safety clip */
      text-overflow: ellipsis;      /* Adds ... if still too long */
  }
</style>

</head>

<body class="page employee-master">

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
                    <a href="supplier-master-registry.php" class="sub-link">Supplier Master Registry</a>
                    <a href="employee-master.php" class="sub-link active">Employee Master Registry</a>
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

  <div class="top-navbar">
    <div>
      <h5 class="mb-0 fw-bold text-dark">Employee Master</h5>
      <small class="text-muted" style="font-size: 0.7rem;">HR DIRECTORY & PERSONNEL CONTROLS</small>
    </div> 

    <div class="d-flex align-items-center gap-4">
      <div class="clock-pill">
        <span id="realtime-clock" style="font-family: monospace;">12:00:00</span>
        <button class="btn-clock" id="btn-clock" type="button">
          <i class="fa-solid fa-fingerprint"></i> <span>Clock In</span>
        </button>
      </div>

      <div class="d-flex align-items-center gap-3 ps-3 border-start">
        <div class="text-end lh-1 d-none d-md-block">
          <div class="fw-bold fs-6"><?php echo e($fullName); ?></div>
          <small class="text-primary fw-bold" style="font-size: 0.65rem; letter-spacing: 0.5px;" id="user-role-label">
            <?php echo e($roleLabel); ?>
          </small>
        </div>
        <img src="<?php echo e($myAvatarUrl); ?>" class="rounded-circle shadow-sm" width="38" height="38" alt="<?php echo e($firstName); ?>">
      </div>
    </div>
  </div>

  <div class="main-content px-4 pb-5 position-relative">

    <div class="row pt-4 mb-4 g-3">
      <div class="col-xl-3 col-md-6">
        <div class="card-custom p-4 d-flex align-items-center">
          <div class="me-3 rounded-circle d-flex align-items-center justify-content-center bg-info bg-opacity-10" style="width: 48px; height: 48px;">
            <i class="fa-solid fa-users text-info fs-5"></i>
          </div>
          <div>
            <div class="kpi-title">Headcount</div>
            <div class="kpi-value" id="stat-total">0</div>
          </div>
        </div>
      </div>

      <div class="col-xl-3 col-md-6">
        <div class="card-custom p-4 d-flex align-items-center">
          <div class="me-3 rounded-circle d-flex align-items-center justify-content-center bg-primary bg-opacity-10" style="width: 48px; height: 48px;">
            <i class="fa-solid fa-briefcase text-primary fs-5"></i>
          </div>
          <div>
            <div class="kpi-title">Permanent</div>
            <div class="kpi-value" id="stat-permanent">0</div>
          </div>
        </div>
      </div>

      <div class="col-xl-3 col-md-6">
        <div class="card-custom p-4 d-flex align-items-center">
          <div class="me-3 rounded-circle d-flex align-items-center justify-content-center bg-warning bg-opacity-10" style="width: 48px; height: 48px;">
            <i class="fa-solid fa-file-contract text-warning fs-5"></i>
          </div>
          <div>
            <div class="kpi-title">Contract/Temp</div>
            <div class="kpi-value" id="stat-contract">0</div>
          </div>
        </div>
      </div>

      <div class="col-xl-3 col-md-6">
        <div class="card-custom p-4 d-flex align-items-center">
          <div class="me-3 rounded-circle d-flex align-items-center justify-content-center bg-danger bg-opacity-10" style="width: 48px; height: 48px;">
            <i class="fa-solid fa-coins text-danger fs-5"></i>
          </div>
          <div>
            <div class="kpi-title">Payroll Exposure</div>
            <div class="kpi-value" id="stat-payroll">0</div>
          </div>
        </div>
      </div>
    </div>

    <div class="card-custom p-4 mb-4">
      <div class="d-flex flex-wrap justify-content-between align-items-end gap-3">
        
        <div class="d-flex gap-2 flex-wrap">
            <div class="input-group input-group-sm w-auto">
              <span class="input-group-text bg-white"><i class="fa-solid fa-magnifying-glass text-muted"></i></span>
              <input type="text" id="filter-search" class="form-control" placeholder="Search staff..." style="width: 200px;">
            </div>

            <select id="filter-dept" class="form-select form-select-sm w-auto">
                <option value="">All Depts</option>
                <option value="OPERATIONS">OPERATIONS</option>
                <option value="SALES">SALES</option>
                <option value="FINANCE">FINANCE</option>
                <option value="ADMIN">ADMIN</option>
                <option value="MANAGEMENT">MANAGEMENT</option>
            </select>

            <select id="filter-type" class="form-select form-select-sm w-auto">
                <option value="">All Contracts</option>
                <option value="PERMANENT">Permanent</option>
                <option value="FULL_TIME">Full Time</option>
                <option value="PART_TIME">Part Time</option>
                <option value="FIXED_TERM">Fixed Term</option>
                <option value="FREELANCE">Freelance</option>
                <option value="INTERNSHIP">Internship</option>
            </select>

            <div class="input-group input-group-sm w-auto">
                <span class="input-group-text bg-white">Joined</span>
                <input type="date" id="filter-start" class="form-control">
                <span class="input-group-text bg-white">-</span>
                <input type="date" id="filter-end" class="form-control">
            </div>
        </div>

        <div class="d-flex gap-2">
            <button id="btn-export" class="btn btn-outline-dark btn-sm fw-bold shadow-sm" type="button">
                <i class="fa-solid fa-download me-1"></i> Export DB
            </button>
            
            <button id="btn-contract" class="btn btn-primary btn-sm fw-bold shadow-sm d-flex align-items-center gap-2" type="button" onclick="openContractModal()">
                <i class="fa-solid fa-file-signature"></i> Generate Contract
            </button>

            <button id="btn-create" class="btn btn-dark btn-sm fw-bold shadow-sm d-flex align-items-center gap-2" type="button">
                <i class="fa-solid fa-user-plus"></i> Add Employee
            </button>
        </div>
      </div>
    </div>

    <div class="card-custom">
      <div class="table-responsive">
        <table class="table table-hover table-custom align-middle mb-0">
          <thead class="bg-light">
            <tr>
              <th class="ps-4">Employee</th>
              <th>Role & Dept</th>
              <th>Phone</th> <th>Contract Type</th>
              <th>Join Date</th>
              <th>Line Manager</th>
              <th>Status</th>
              <th class="text-end pe-4">Action</th>
            </tr>
          </thead>
          <tbody id="emp-table-body"></tbody>
        </table>
      </div>
    </div>

  </div>

  <div class="offcanvas offcanvas-end offcanvas-custom smart-offcanvas--medium smart-offcanvas--wide" 
       tabindex="-1" id="empDrawer" data-bs-backdrop="static">
    
    <div class="offcanvas-header border-bottom bg-light">
      <div>
        <h5 class="offcanvas-title fw-bold" id="drawer-title">Employee Profile</h5>
        <small class="text-muted">Personnel Management</small>
      </div>
      <button type="button" class="btn-close" data-bs-dismiss="offcanvas"></button>
    </div>

    <div class="px-4 py-3 bg-white border-bottom d-flex align-items-center justify-content-between">
      <div class="d-flex align-items-center gap-3">
        <div class="bg-light rounded-circle border d-flex align-items-center justify-content-center text-muted fw-bold" 
             style="width: 48px; height: 48px;" id="drawer-initials">SL</div>
        <div>
          <div class="small fw-bold text-muted text-uppercase">Employee ID</div>
          <div class="font-monospace fw-bold fs-5" id="drawer-id">SL-000</div>
        </div>
      </div>
      <div id="status-toggle-container">
        <select id="inp-status" class="form-select form-select-sm fw-bold border-success text-success bg-success bg-opacity-10">
          <option value="PENDING">PENDING</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="SUSPENDED">SUSPENDED</option>
          <option value="EXITED">EXITED</option>
        </select>
      </div>
    </div>

    <div class="bg-white border-bottom px-3">
      <ul class="nav nav-tabs smart-tabs" id="empTabs" role="tablist">
        <li class="nav-item">
          <button class="nav-link active" data-bs-toggle="tab" data-bs-target="#personal" type="button">Personal Info</button>
        </li>
        <li class="nav-item">
          <button class="nav-link" data-bs-toggle="tab" data-bs-target="#employment" type="button">Employment</button>
        </li>
        <li class="nav-item">
          <button class="nav-link" data-bs-toggle="tab" data-bs-target="#documents" type="button">Documents</button>
        </li>
        <li class="nav-item">
          <button class="nav-link" data-bs-toggle="tab" data-bs-target="#finance" type="button">Finance & Access</button>
        </li>
      </ul>
    </div>

    <div class="offcanvas-body p-4 bg-light bg-opacity-25 d-flex flex-column justify-content-start">
      <form id="emp-form" class="tab-content h-auto w-100" enctype="multipart/form-data">

        <div class="tab-pane fade show active" id="personal" role="tabpanel">
          <div class="row g-3">
            <div class="col-12 d-flex flex-column align-items-center mb-3">
                <img id="preview-avatar" src="https://ui-avatars.com/api/?name=New+User&background=ccc&color=fff" class="avatar-preview mb-2">
                <label class="btn btn-sm btn-outline-primary">
                    <i class="fa-solid fa-camera"></i> Upload Photo
                    <input type="file" id="inp-avatar" accept="image/*" hidden>
                </label>
            </div>

            <div class="col-12">
              <label class="smart-form-label">Full Legal Name <span class="text-danger">*</span></label>
              <input type="text" id="inp-name" class="form-control smart-input" required>
            </div>
            
            <div class="col-6">
                <label class="smart-form-label">Phone Number</label>
                <input type="text" id="inp-phone" class="form-control smart-input" placeholder="+237...">
            </div>
            <div class="col-6">
                <label class="smart-form-label">Residential Address</label>
                <input type="text" id="inp-address" class="form-control smart-input" placeholder="City, Quarter">
            </div>
            
            <div class="col-6">
                <label class="smart-form-label">Nationality</label>
                <input type="text" id="inp-nationality" class="form-control smart-input">
            </div>
            <div class="col-6">
                <label class="smart-form-label">ID Card / Passport No.</label>
                <input type="text" id="inp-idcard" class="form-control smart-input">
            </div>

            <div class="col-6">
              <label class="smart-form-label">Date of Birth</label>
              <input type="date" id="inp-dob" class="form-control smart-input">
            </div>
            <div class="col-6">
              <label class="smart-form-label">Marital Status</label>
              <select id="inp-marital" class="form-select smart-input">
                <option value="SINGLE">Single</option>
                <option value="MARRIED">Married</option>
              </select>
            </div>
            
            <div class="col-6">
                <label class="smart-form-label">No. of Children</label>
                <input type="number" id="inp-children" class="form-control smart-input" min="0" value="0">
            </div>
            
            <div class="col-12">
              <label class="smart-form-label">System Email <span class="text-danger">*</span></label>
              <input type="email" id="inp-email" class="form-control smart-input" required>
            </div>
          </div>
        </div>

        <div class="tab-pane fade" id="employment" role="tabpanel">
          <div class="row g-3">
            <div class="col-6">
              <label class="smart-form-label">Department <span class="text-danger">*</span></label>
              <select id="inp-dept" class="form-select smart-input">
                <option value="OPERATIONS">OPERATIONS</option>
                <option value="SALES">SALES</option>
                <option value="FINANCE">FINANCE</option>
                <option value="ADMIN">ADMIN</option>
                <option value="MANAGEMENT">MANAGEMENT</option>
              </select>
            </div>
            <div class="col-6">
              <label class="smart-form-label">Job Title <span class="text-danger">*</span></label>
              <input type="text" id="inp-title" class="form-control smart-input" required>
            </div>
            
            <div class="col-6">
              <label class="smart-form-label">Contract Type <span class="text-danger">*</span></label>
              <select id="inp-type" class="form-select smart-input">
                <option value="PERMANENT">Permanent Contract</option>
                <option value="FULL_TIME">Full Time Contract</option>
                <option value="PART_TIME">Part Time Contract</option>
                <option value="FIXED_TERM">Fixed Term Contract</option>
                <option value="FREELANCE">Freelance Contract</option>
                <option value="INTERNSHIP">Internship Contract</option>
              </select>
            </div>
            
            <div class="col-6">
                <label class="smart-form-label">Contract Reference No.</label>
                <input type="text" id="inp-contract-ref" class="form-control smart-input" placeholder="Ref...">
            </div>

            <div class="col-6">
              <label class="smart-form-label">Join Date <span class="text-danger">*</span></label>
              <input type="date" id="inp-date" class="form-control smart-input" required>
            </div>
            
            <div class="col-6">
                <label class="smart-form-label">Line Manager (Reports To)</label>
                <select id="inp-reports-to" class="form-select smart-input">
                    <option value="">-- None --</option>
                    </select>
            </div>

            <div class="col-12">
              <label class="smart-form-label">Signatory Name (For Docs)</label>
              <input type="text" id="inp-signatory" class="form-control smart-input">
            </div>
          </div>
        </div>

        <div class="tab-pane fade" id="documents" role="tabpanel">
            <div class="alert alert-info py-2 small mb-3">
                <i class="fa-solid fa-circle-info me-1"></i> Uploaded files are saved to the secure vault.
            </div>

            <div class="row g-3">
                <div class="col-12">
                    <label class="smart-form-label">Upload CV (PDF)</label>
                    <input type="file" id="file-cv" class="form-control smart-input" accept=".pdf,.doc,.docx">
                </div>
                <div class="col-12">
                    <label class="smart-form-label">Upload Contract (Signed)</label>
                    <input type="file" id="file-contract" class="form-control smart-input" accept=".pdf">
                </div>
                <div class="col-12">
                    <label class="smart-form-label">Upload ID Card / Passport</label>
                    <input type="file" id="file-id" class="form-control smart-input" accept=".pdf,.jpg,.png">
                </div>
                <div class="col-12">
                    <label class="smart-form-label">Other Document</label>
                    <input type="file" id="file-other" class="form-control smart-input">
                </div>
            </div>

            <hr class="my-4">
            
            <h6 class="fw-bold small text-muted text-uppercase mb-3">Document Vault History</h6>
            <div id="doc-list-container" class="vstack gap-2">
                <div class="text-center text-muted small fst-italic py-3">No documents found.</div>
            </div>
        </div>

        <div class="tab-pane fade" id="finance" role="tabpanel">
          <div class="p-3 bg-white border rounded mb-4">
            <h6 class="text-primary small fw-bold text-uppercase border-bottom pb-2 mb-3">Payroll Data</h6>
            <div class="row g-3">
              <div class="col-6">
                <label class="smart-form-label">Base Salary (XAF)</label>
                <input type="number" id="inp-salary" class="form-control smart-input">
              </div>
              <div class="col-6">
                <label class="smart-form-label">Method</label>
                <select id="inp-pay-method" class="form-select smart-input">
                  <option value="BANK_TRANSFER">Bank Transfer</option>
                  <option value="CASH">Cash</option>
                  <option value="CHEQUE">Cheque</option>
                </select>
              </div>
              <div class="col-12">
                <label class="smart-form-label">Bank Details</label>
                <input type="text" id="inp-bank" class="form-control smart-input" placeholder="Bank Name & Account No.">
              </div>
              <div class="col-12">
                <label class="smart-form-label">CNPS Number</label>
                <input type="text" id="inp-cnps" class="form-control smart-input" placeholder="Social Security No.">
              </div>
            </div>
          </div>

          <div class="p-3 bg-danger bg-opacity-10 border border-danger border-opacity-25 rounded position-relative">
            <h6 class="text-danger small fw-bold text-uppercase mb-3">System Authority</h6>
            <div class="vstack gap-2">
              <div class="form-check">
                <input class="form-check-input" type="checkbox" id="auth-issuer" checked>
                <label class="form-check-label small fw-bold" for="auth-issuer">Level 1: ISSUER (Draft)</label>
              </div>
              <div class="form-check">
                <input class="form-check-input" type="checkbox" id="auth-validator">
                <label class="form-check-label small fw-bold" for="auth-validator">Level 2: VALIDATOR (Check)</label>
              </div>
              <div class="form-check">
                <input class="form-check-input" type="checkbox" id="auth-approver">
                <label class="form-check-label small fw-bold" for="auth-approver">Level 3: APPROVER (Lock)</label>
              </div>
            </div>
            
            <div class="mt-3 pt-3 border-top border-danger border-opacity-25">
              <label class="smart-form-label text-danger">Login Username</label>
              <input type="text" id="inp-login-user" class="form-control form-control-sm border-danger text-danger fw-bold" placeholder="e.g. j.doe">
              <div class="form-check mt-2">
                 <input class="form-check-input" type="checkbox" id="inp-create-login" checked>
                 <label class="form-check-label small text-muted" for="inp-create-login">Create/Update Login Access</label>
              </div>
            </div>
          </div>
        </div>

      </form>
    </div>

    <div class="p-4 border-top bg-white d-flex justify-content-end gap-2">
      <button type="button" class="btn btn-light text-muted fw-bold" data-bs-dismiss="offcanvas">Cancel</button>
      <button type="button" id="btn-save" class="btn btn-dark fw-bold px-4">Save Employee</button>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>
  
  <div class="modal fade" id="cropModal" tabindex="-1" data-bs-backdrop="static" data-bs-keyboard="false">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content">
      <div class="modal-header">
        <h6 class="modal-title fw-bold">Crop Profile Photo</h6>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>
      <div class="modal-body p-0" style="height: 400px; background: #000;">
        <img id="image-to-crop" style="max-width: 100%; display: block;">
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-light btn-sm fw-bold" data-bs-dismiss="modal">Cancel</button>
        <button type="button" id="btn-perform-crop" class="btn btn-primary btn-sm fw-bold">
            <i class="fa-solid fa-crop-simple me-1"></i> Crop & Set
        </button>
      </div>
    </div>
  </div>
</div>

 <script>
(function EmployeeMasterPage(){
  let employees = [];
  const $ = (id) => document.getElementById(id);
  let empDrawer;
  
  // --- CROPPER VARIABLES ---
  let cropper; 
  let croppedBlob = null; 
  const cropModalEl = document.getElementById('cropModal');
  const cropModal = new bootstrap.Modal(cropModalEl);
  const imageToCrop = document.getElementById('image-to-crop');

  // --- HELPER: LOADING SPINNER ---
  function setLoading(btnId, isLoading) {
      const btn = $(btnId);
      if(!btn) return;
      if(isLoading) {
          btn.dataset.originalText = btn.innerHTML;
          btn.disabled = true;
          btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-2"></i> Processing...';
      } else {
          btn.disabled = false;
          btn.innerHTML = btn.dataset.originalText || 'Save';
      }
  }

  // --- 1. LOAD DATA ---
  async function loadEmployees() {
    const search = $('filter-search').value.trim();
    const dept   = $('filter-dept').value;
    const type   = $('filter-type').value;
    const start  = $('filter-start').value;
    const end    = $('filter-end').value;

    const params = new URLSearchParams({ q: search, dept, type, start, end });

    try {
      const res = await fetch(`../../api/employees/list.php?${params}`);
      const data = await res.json();
      
      if (!data.ok) throw new Error(data.message || 'Load failed');
      
      employees = data.rows || [];
      
      // Update KPIs
      $('stat-total').innerText = data.kpis.total;
      $('stat-permanent').innerText = data.kpis.permanent;
      $('stat-contract').innerText = data.kpis.contract;
      
      // FIX: US Locale for Comma separators + XAF currency
      $('stat-payroll').innerText = new Intl.NumberFormat('en-US', { 
          style: 'currency', 
          currency: 'XAF', 
          maximumFractionDigits: 0 
      }).format(data.kpis.payrollExposure);

      renderTable();
      populateManagerDropdown(employees);

    } catch (e) {
      console.error(e);
    }
  }

  function renderTable(){
    const tbody = $('emp-table-body');
    tbody.innerHTML = employees.map(e => {
      const badgeClass = (e.status === 'ACTIVE' || e.status === 'PENDING') 
        ? 'bg-success text-success bg-opacity-10' 
        : 'bg-danger text-danger bg-opacity-10';

      return `
        <tr>
          <td class="ps-4">
            <div class="d-flex align-items-center gap-3">
              <img src="${e.avatar}" class="rounded-circle border" width="36" height="36" style="object-fit:cover;">
              <div>
                <div class="fw-bold text-dark">${escapeHtml(e.name)}</div>
                <div class="small text-muted font-monospace">${e.id}</div>
              </div>
            </div>
          </td>
          <td>
            <div class="fw-bold text-secondary small">${escapeHtml(e.title)}</div>
            <span class="badge bg-light text-dark border fw-normal">${escapeHtml(e.dept)}</span>
          </td>
          <td class="small text-muted">${escapeHtml(e.phone || '-')}</td>
          <td class="small text-muted">${escapeHtml(e.type.replace('_',' '))}</td>
          <td class="small text-muted">${e.joinDate}</td>
          <td class="small text-muted">${escapeHtml(e.managerName || '-')}</td>
          <td><span class="badge ${badgeClass}">${e.status}</span></td>
          <td class="text-end pe-4">
            <button class="btn btn-sm btn-link text-secondary p-0" onclick="window.editEmployee('${e.id}')">
               <i class="fa-solid fa-pen-to-square"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // --- CHANGE: Use NAMES as value ---
  function populateManagerDropdown(list){
    const sel = $('inp-reports-to');
    const currentVal = sel.value; 
    sel.innerHTML = '<option value="">-- None --</option>';
    
    list.filter(e => e.status !== 'EXITED').forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.name; // <--- Sending NAME now
        opt.text = e.name; 
        sel.appendChild(opt);
    });
    
    if(currentVal) sel.value = currentVal; 
  }

  // --- 2. CREATE / EDIT ---
  window.createEmployee = function() {
    $('drawer-title').innerText = 'New Employee';
    $('drawer-id').innerText = 'SL-XXX';
    $('emp-form').reset();
    
    // Reset Avatar
    $('preview-avatar').src = "https://ui-avatars.com/api/?name=New+User&background=ccc&color=fff";
    croppedBlob = null; 
    $('inp-avatar').value = ''; 
    
    $('status-toggle-container').classList.add('d-none'); 
    $('inp-status').value = 'PENDING';
    $('doc-list-container').innerHTML = '<div class="text-center text-muted small fst-italic py-3">Save employee first to upload documents.</div>';
    
    bootstrap.Tab.getOrCreateInstance(document.querySelector('#empTabs button[data-bs-target="#personal"]')).show();
    empDrawer.show();
  };

  window.editEmployee = async function(id) {
    try {
      $('drawer-title').innerText = 'Manage Employee';
      $('status-toggle-container').classList.remove('d-none');

      croppedBlob = null;
      $('inp-avatar').value = '';

      const res = await fetch(`../../api/employees/get.php?employee_id=${id}`);
      const data = await res.json();
      if(!data.ok) throw new Error(data.message);

      const e = data.employee;
      
      $('drawer-id').innerText = e.id;
      $('drawer-initials').innerText = e.name.charAt(0);
      $('inp-name').value = e.name;
      $('inp-phone').value = e.phone || ''; 
      $('inp-address').value = e.address || '';
      $('inp-nationality').value = e.nationality || '';
      $('inp-idcard').value = e.idCard || '';
      $('inp-dob').value = e.dob || '';
      $('inp-marital').value = e.marital || 'SINGLE';
      $('inp-children').value = e.numChildren || 0;
      $('inp-email').value = e.email;
      $('preview-avatar').src = e.avatar;

      $('inp-dept').value = e.dept;
      $('inp-title').value = e.title;
      $('inp-type').value = e.type || 'PERMANENT';
      $('inp-contract-ref').value = e.contractRef || '';
      $('inp-date').value = e.joinDate;
      $('inp-signatory').value = e.signatory || '';

      // CHANGE: Simple string match for Manager Name
      $('inp-reports-to').value = e.managerName || "";

      $('inp-salary').value = e.salary || '';
      $('inp-pay-method').value = e.payMethod;
      $('inp-bank').value = e.bank || '';
      $('inp-cnps').value = e.cnps || '';
      
      $('inp-status').value = e.status;
      $('inp-login-user').value = e.username || '';
      
      const caps = e.authority || [];
      $('auth-issuer').checked = caps.includes('ISSUER');
      $('auth-validator').checked = caps.includes('VALIDATOR');
      $('auth-approver').checked = caps.includes('APPROVER');

      renderDocs(e.documents || []);

      bootstrap.Tab.getOrCreateInstance(document.querySelector('#empTabs button[data-bs-target="#personal"]')).show();
      empDrawer.show();

    } catch(err) {
      alert(err.message);
    }
  };

  function toggleDurationField(val) {
    const field = document.getElementById('duration_field');
    if(val === 'PERMANENT') {
        field.classList.add('d-none');
    } else {
        field.classList.remove('d-none');
    }
}
  function renderDocs(docs){
    const container = $('doc-list-container');
    if(!docs.length) {
        container.innerHTML = '<div class="text-center text-muted small fst-italic py-3">No documents found.</div>';
        return;
    }
    
    container.innerHTML = docs.map(d => `
        <div class="d-flex align-items-center justify-content-between p-2 border rounded doc-item">
            <div class="d-flex align-items-center gap-3">
                <div class="text-danger"><i class="fa-solid fa-file-pdf fs-4"></i></div>
                <div>
                    <div class="fw-bold text-dark small">${escapeHtml(d.type)}</div>
                    <div class="text-muted" style="font-size: 0.7rem;">${d.date}</div>
                </div>
            </div>
            <a href="${d.path}" target="_blank" class="btn btn-sm btn-light border" title="Download">
                <i class="fa-solid fa-download"></i>
            </a>
        </div>
    `).join('');
  }

  // --- 3. CROPPER LOGIC ---
  $('inp-avatar').addEventListener('change', function(e){
      const files = e.target.files;
      if (files && files.length > 0) {
          const file = files[0];
          const url = URL.createObjectURL(file);
          if(cropper) { cropper.destroy(); cropper = null; }
          
          imageToCrop.src = url;
          cropModal.show();
          
          cropModalEl.addEventListener('shown.bs.modal', function () {
              if(!cropper) {
                  cropper = new Cropper(imageToCrop, {
                      aspectRatio: 1, 
                      viewMode: 1,    
                      autoCropArea: 0.8
                  });
              }
          }, { once: true });
      }
  });

  $('btn-perform-crop').addEventListener('click', function() {
      if(cropper) {
          const canvas = cropper.getCroppedCanvas({ width: 400, height: 400 });
          $('preview-avatar').src = canvas.toDataURL();
          canvas.toBlob(function(blob) {
              croppedBlob = blob;
              cropModal.hide();
          }, 'image/jpeg', 0.9);
      }
  });

  // --- 4. SAVE ---
  $('btn-save').addEventListener('click', async () => {
    setLoading('btn-save', true);

    const formData = new FormData();
    formData.append('id', $('drawer-id').innerText);
    formData.append('name', $('inp-name').value);
    formData.append('email', $('inp-email').value);
    formData.append('phone', $('inp-phone').value);
    formData.append('address', $('inp-address').value);
    formData.append('dept', $('inp-dept').value);
    formData.append('title', $('inp-title').value);
    formData.append('joinDate', $('inp-date').value);
    
    formData.append('nationality', $('inp-nationality').value);
    formData.append('idCard', $('inp-idcard').value);
    formData.append('dob', $('inp-dob').value);
    formData.append('marital', $('inp-marital').value);
    formData.append('numChildren', $('inp-children').value);
    
    formData.append('type', $('inp-type').value);
    formData.append('contractRef', $('inp-contract-ref').value);
    
    // CHANGE: Send 'lineManager' (text) instead of reportsTo
    formData.append('lineManager', $('inp-reports-to').value);
    
    formData.append('signatory', $('inp-signatory').value);
    
    formData.append('salary', $('inp-salary').value);
    formData.append('payMethod', $('inp-pay-method').value);
    formData.append('bank', $('inp-bank').value);
    formData.append('cnps', $('inp-cnps').value);
    formData.append('status', $('inp-status').value);
    formData.append('loginUser', $('inp-login-user').value);
    formData.append('createLogin', $('inp-create-login').checked);
    
    if($('auth-issuer').checked) formData.append('authority[]', 'ISSUER');
    if($('auth-validator').checked) formData.append('authority[]', 'VALIDATOR');
    if($('auth-approver').checked) formData.append('authority[]', 'APPROVER');

    if(croppedBlob) {
        formData.append('avatarFile', croppedBlob, 'avatar.jpg');
    } else {
        const rawFile = $('inp-avatar').files[0];
        if(rawFile) formData.append('avatarFile', rawFile);
    }

    if($('file-cv').files[0]) formData.append('doc_CV', $('file-cv').files[0]);
    if($('file-contract').files[0]) formData.append('doc_CONTRACT', $('file-contract').files[0]);
    if($('file-id').files[0]) formData.append('doc_ID_CARD', $('file-id').files[0]);
    if($('file-other').files[0]) formData.append('doc_OTHER', $('file-other').files[0]);

    try {
        const res = await fetch('../../api/employees/save.php', {
            method: 'POST',
            body: formData 
        });
        const json = await res.json();
        
        if(!json.ok) throw new Error(json.message);
        
        alert('Saved successfully!');
        empDrawer.hide();
        loadEmployees();
        
    } catch(e) {
        alert('Save failed: ' + e.message);
    } finally {
        setLoading('btn-save', false);
    }
  });

  $('btn-export').addEventListener('click', () => {
     window.location.href = '../../api/employees/export_employees.php';
  });

  empDrawer = bootstrap.Offcanvas.getOrCreateInstance($('empDrawer'));
  $('btn-create').addEventListener('click', window.createEmployee);
  
  ['filter-search','filter-dept','filter-type','filter-start','filter-end'].forEach(id => {
      $(id).addEventListener('change', loadEmployees);
      if(id === 'filter-search') $(id).addEventListener('keyup', loadEmployees);
  });

  loadEmployees();

  function escapeHtml(s) {
    if(!s) return '';
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

})();
</script>
<div class="modal fade" id="contractModal" data-bs-backdrop="static" tabindex="-1">
    <div class="modal-dialog modal-lg modal-dialog-centered">
        <div class="modal-content">
            <div class="modal-header border-0 pb-0 pt-4 px-4">
                <div>
                    <h5 class="fw-bold modal-title text-dark">
                        <i class="fa-solid fa-file-signature text-primary me-2"></i>New Employment Contract
                    </h5>
                    <div class="small text-muted">Generate a compliant contract based on the standard template.</div>
                </div>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body p-4">
                <form id="contractForm" onsubmit="return false;">
                    <input type="hidden" name="target_employee_id" id="target_employee_id">
                    <input type="hidden" name="mode" id="contract_mode" value="PREVIEW">

                    <div id="contract-step-1">
    <div class="mb-4">
        <label class="form-label fw-bold small text-muted text-uppercase">Select Employee</label>
        <select class="form-select form-select-lg shadow-sm border-primary" onchange="fetchContractEmployeeDetails(this)">
            <option value="">-- Choose Employee --</option>
            <?php
            // We use a fresh query to ensure we get exactly what we need
            $empListSql = "SELECT employee_id, full_name FROM employee_master WHERE status='ACTIVE' ORDER BY full_name ASC";
            $empListRes = $conn->query($empListSql);
            while($row = $empListRes->fetch_assoc()) {
                // Ensure the value is the STRING employee_id (e.g. SL-101)
                $eid = e($row['employee_id']);
                $ename = e($row['full_name']);
                echo "<option value='{$eid}'>{$ename} ({$eid})</option>";
            }
            ?>
        </select>
    </div>

    <div id="emp-details-preview" class="mb-4">
        <div class="alert alert-light border text-center text-muted py-4">
            <i class="fa-solid fa-user-tag fs-3 mb-2 opacity-50"></i><br>
            Select an employee to generate their contract reference.
        </div>
    </div>

    <div class="mb-3">
        <label class="form-label fw-bold small text-muted">Contract Reference</label>
        <div class="input-group">
            <span class="input-group-text bg-white"><i class="fa-solid fa-hashtag text-primary"></i></span>
            <input type="text" class="form-control bg-light font-mono fw-bold text-dark" name="contract_ref" id="contract_ref" readonly>
        </div>
        <div class="text-xs text-muted mt-1">Automatically formatted: [Company]/[Dept]/[ID]-[Initials]</div>
    </div>

    <div class="text-end pt-3">
        <button type="button" class="btn btn-primary fw-bold px-4 shadow-sm" id="btn-to-step-2" onclick="goToContractStep(2)" disabled>
            Configure Contract Details <i class="fa-solid fa-arrow-right ms-2"></i>
        </button>
    </div>
</div>

                    <div id="contract-step-2" class="d-none">
    
    <div class="row g-3 mb-3">
        <div class="col-md-6">
            <label class="form-label fw-bold small text-muted text-uppercase">Contract Nature</label>
            <select class="form-select border-primary fw-bold" name="contract_type" id="ctr_type" onchange="toggleDurationField(this.value)">
                <option value="PERMANENT" selected>Indefinite (CDI)</option>
                <option value="FIXED_TERM">Fixed-Term (CDD)</option>
                <option value="INTERNSHIP">Internship</option>
                <option value="TRIAL">Trial / Test</option>
            </select>
        </div>
        
        <div class="col-md-6 d-none" id="duration_field">
            <label class="form-label fw-bold small text-muted text-uppercase">Duration</label>
            <div class="input-group">
                <input type="number" class="form-control fw-bold" name="duration_months" value="12" min="1" max="24">
                <span class="input-group-text bg-white text-muted">Months</span>
            </div>
        </div>

        <div class="col-md-6">
            <label class="form-label fw-bold small text-muted text-uppercase">Start Date</label>
            <input type="date" class="form-control" name="start_date" id="ctr_start_date" required>
        </div>

        <div class="col-md-6">
            <label class="form-label fw-bold small text-muted text-uppercase">Probation Period</label>
            <div class="input-group">
                <div class="input-group-text bg-white">
                    <input class="form-check-input mt-0" type="checkbox" name="has_probation" value="true" checked id="chk_probation" 
                           onchange="document.getElementById('prob_months_input').disabled = !this.checked; document.getElementById('prob_months_input').value = this.checked ? 3 : 0;">
                </div>
                <input type="number" class="form-control" name="probation_months" id="prob_months_input" value="3" min="1" max="6">
                <span class="input-group-text bg-white small">Months</span>
            </div>
        </div>

        <div class="col-12">
            <label class="form-label fw-bold small text-muted text-uppercase">Place of Birth</label>
            <input type="text" class="form-control" name="place_of_birth" placeholder="e.g. Douala, Littoral Region" required>
            <div class="form-text text-xs">As it appears on the National ID Card.</div>
        </div>

        <div class="col-md-4">
            <label class="form-label fw-bold small text-muted text-uppercase">Category</label>
            <select class="form-select" name="salary_category" id="salary_category">
                <option value="Category 1">Category 1 (E.g. Laborer)</option>
                <option value="Category 2">Category 2</option>
                <option value="Category 3">Category 3</option>
                <option value="Category 4">Category 4</option>
                <option value="Category 5">Category 5</option>
                <option value="Category 6">Category 6</option>
                <option value="Category 7">Category 7 (Supervisor)</option>
                <option value="Category 8" selected>Category 8 (Manager)</option>
                <option value="Category 9">Category 9 (Senior Mgr)</option>
                <option value="Category 10">Category 10 (Director)</option>
                <option value="Category 11">Category 11 (Hors Catégorie)</option>
                <option value="Category 12">Category 12 (Executive)</option>
            </select>
        </div>

        <div class="col-md-4">
            <label class="form-label fw-bold small text-muted text-uppercase">Echelon / Grade</label>
            <select class="form-select" name="salary_grade" id="salary_grade">
                <option value="A" selected>Echelon A</option>
                <option value="B">Echelon B</option>
                <option value="C">Echelon C</option>
                <option value="D">Echelon D</option>
                <option value="E">Echelon E</option>
                <option value="F">Echelon F</option>
                <option value="G">Echelon G</option>
            </select>
        </div>

        <div class="col-md-4">
            <label class="form-label fw-bold small text-muted text-uppercase">Gross Salary (XAF)</label>
            <input type="number" class="form-control text-end fw-black text-dark" name="gross_salary" id="ctr_salary" placeholder="0" min="0" step="1000">
        </div>
    </div>

    <div class="card bg-light border-0 mb-3">
        <div class="card-body p-3">
            <div class="d-flex justify-content-between align-items-center mb-2">
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" name="include_jd" value="true" id="chk_include_jd" checked 
                           onchange="document.getElementById('jd_area').classList.toggle('d-none')">
                    <label class="form-check-label fw-bold small" for="chk_include_jd">Include "Annex: Job Description"?</label>
                </div>
                <span class="badge bg-white text-muted border">Page 2</span>
            </div>
            
            <div id="jd_area">
                <textarea class="form-control border-0 shadow-sm" name="jd_text" rows="5" 
                          placeholder="Paste the detailed list of duties and responsibilities here..." maxlength="2000"></textarea>
                <div class="d-flex justify-content-between mt-1">
                    <div class="text-xs text-muted">Supports basic text formatting (newlines).</div>
                    <div class="text-xs text-primary fw-bold cursor-pointer" onclick="document.querySelector('[name=jd_text]').value = ''">Clear Text</div>
                </div>
            </div>
        </div>
    </div>

    <div class="d-flex justify-content-between pt-3 border-top">
        <button type="button" class="btn btn-light border fw-bold text-muted" onclick="goToContractStep(1)">
            <i class="fa-solid fa-arrow-left me-2"></i>Back
        </button>
        <div class="d-flex gap-2">
            <button type="button" class="btn btn-outline-dark fw-bold shadow-sm" id="btn-preview-contract" onclick="previewContract()">
                <i class="fa-solid fa-print me-2"></i>Preview & Print
            </button>
            <button type="button" class="btn btn-success fw-bold shadow-sm" id="btn-save-contract" onclick="saveContractRecord()">
                <i class="fa-solid fa-floppy-disk me-2"></i>Save Record
            </button>
        </div>
    </div>

</div>
                </form>
            </div>
        </div>
    </div>
</div>

<script>
/**
 * ========================================================================
 * HR CONTRACT MODULE - FRONTEND LOGIC
 * ========================================================================
 */
const CONTRACT_API = '../../api/hr_contract_handler.php';

// 1. OPEN MODAL
function openContractModal() {
    // Reset the form
    document.getElementById('contractForm').reset();
    
    // Reset Steps
    document.getElementById('contract-step-1').classList.remove('d-none');
    document.getElementById('contract-step-2').classList.add('d-none');
    
    // Set Date to Today
    document.getElementById('ctr_start_date').valueAsDate = new Date();
    
    // Open Bootstrap Modal
    const modalEl = document.getElementById('contractModal');
    if (modalEl) {
        new bootstrap.Modal(modalEl).show();
    } else {
        alert("Error: Modal not found in HTML.");
    }
}

// 2. FETCH DETAILS
async function fetchContractEmployeeDetails(selectElement) {
    const empId = selectElement.value;
    if(!empId) {
        document.getElementById('btn-to-step-2').disabled = true;
        return;
    }

    const container = document.getElementById('emp-details-preview');
    container.innerHTML = '<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div></div>';

    try {
        // Encode ID to handle special characters safely
        const res = await fetch(`${CONTRACT_API}?action=fetch_employee_data&employee_id=${encodeURIComponent(empId)}`);
        const json = await res.json();

        if(json.status === 'success') {
            const d = json.data;
            
            // Render ID Badge
            container.innerHTML = `
                <div class="card border-primary bg-primary bg-opacity-10 shadow-sm">
                    <div class="card-body d-flex align-items-center gap-3">
                        <div class="rounded-circle bg-primary text-white d-flex align-items-center justify-content-center fw-bold shadow-sm" 
                             style="width:50px; height:50px; font-size:1.4rem;">
                            ${d.full_name.charAt(0)}
                        </div>
                        <div class="lh-sm">
                            <div class="fw-black text-dark fs-5">${d.full_name}</div>
                            <div class="badge bg-white text-primary border border-primary font-mono mb-1">${d.employee_id}</div>
                            <div class="small text-muted fw-bold">${d.job_title}</div>
                        </div>
                    </div>
                </div>
            `;

            // Fill Hidden Fields
            document.getElementById('target_employee_id').value = d.employee_id;
            document.getElementById('contract_ref').value = json.suggested_ref;
            
            // Enable Next Button
            document.getElementById('btn-to-step-2').disabled = false;
        } else {
            throw new Error(json.message);
        }
    } catch (e) {
        container.innerHTML = `<div class="alert alert-danger small p-2"><i class="fa-solid fa-circle-exclamation me-2"></i>${e.message}</div>`;
    }
}

// 3. WIZARD STEPPER
function goToContractStep(step) {
    if(step === 2) {
        if(!document.getElementById('target_employee_id').value) {
            alert("Please select an employee first.");
            return;
        }
        document.getElementById('contract-step-1').classList.add('d-none');
        document.getElementById('contract-step-2').classList.remove('d-none');
    } else {
        document.getElementById('contract-step-2').classList.add('d-none');
        document.getElementById('contract-step-1').classList.remove('d-none');
    }
}

// 4. PREVIEW / PRINT
async function previewContract() {
    const btn = document.getElementById('btn-preview-contract');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Generating...';

    const fd = new FormData(document.getElementById('contractForm'));
    fd.append('action', 'preview_contract');

    try {
        const res = await fetch(CONTRACT_API, { method: 'POST', body: fd });
        const json = await res.json();

        if(json.status === 'success') {
            const printWindow = window.open('', '_blank', 'width=900,height=800');
            printWindow.document.write(json.html_content);
            printWindow.document.close();
            printWindow.focus();
            
            // Wait for images to load
            setTimeout(() => {
                printWindow.print();
                // Optional: printWindow.close(); 
            }, 800);
        } else {
            alert("Generation Failed: " + json.message);
        }
    } catch (e) {
        console.error(e);
        alert("System Error: " + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// 5. SAVE RECORD
async function saveContractRecord() {
    if(!confirm("Have you printed the PDF? This will save the record to the Vault history.")) return;

    const btn = document.getElementById('btn-save-contract');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Saving...';

    const fd = new FormData(document.getElementById('contractForm'));
    fd.append('action', 'save_contract_data');

    try {
        const res = await fetch(CONTRACT_API, { method: 'POST', body: fd });
        const json = await res.json();

        if(json.status === 'success') {
            // Close Modal
            const modalEl = document.getElementById('contractModal');
            bootstrap.Modal.getInstance(modalEl).hide();
            alert("Contract Recorded Successfully");
        } else {
            alert("Save Failed: " + json.message);
        }
    } catch (e) {
        console.error(e);
        alert("System Error: " + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-floppy-disk me-2"></i>Save Record';
    }
}

// Helper for Duration Field
function toggleDurationField(val) {
    const field = document.getElementById('duration_field');
    if(val === 'PERMANENT') {
        field.classList.add('d-none');
    } else {
        field.classList.remove('d-none');
    }
}
</script>
</body>
</html>