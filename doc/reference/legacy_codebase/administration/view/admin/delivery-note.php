<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN','OPERATIONS','MANAGEMENT','FINANCE']);

// --- Fetch current user details from DB (authoritative profile) ---
$employeeId = (string)($_SESSION['auth']['employee_id'] ?? '');
$userId     = (int)($_SESSION['auth']['user_id'] ?? 0);

if ($employeeId === '' || $userId <= 0) {
  // session is incomplete; force logout for safety
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

// --- Safe display values ---
$fullName  = $me['full_name'] ?: 'User';
$firstName = trim(explode(' ', $fullName)[0] ?? 'User');

$roleLabelMap = [
  'ADMIN'      => 'SYSTEM ADMIN',
  'FINANCE'    => 'FINANCE',
  'SALES'      => 'SALES',
  'OPERATIONS' => 'OPERATIONS',
  'MANAGEMENT' => 'MANAGEMENT',
];
$role      = strtoupper((string)($me['role'] ?? 'OPERATIONS'));
$roleLabel = $roleLabelMap[$role] ?? $role;

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
  <title>Delivery Note Module | Smart LS Enterprise</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&family=Caveat:wght@700&display=swap" rel="stylesheet">

  <style>
    :root {
      --smart-blue: #1F99D8;
      --smart-dark: #055B83;
      --smart-orange: #EE7D04;
      --smart-charcoal: #231F20;
      --smart-bg: #F0F4F8;
      --font-body: 'Manrope', sans-serif;
      --font-heading: 'Montserrat', sans-serif;
      --font-hand: 'Caveat', cursive;
    }

    body {
      font-family: var(--font-body);
      background-color: var(--smart-bg);
      color: var(--smart-charcoal);
      overflow-x: hidden;
    }

    /* --- MODULE UI --- */
    .card-custom {
      background: white;
      border-radius: 8px;
      border: 1px solid rgba(0,0,0,0.05);
      box-shadow: 0 2px 6px rgba(0,0,0,0.02);
      padding: 0.8rem;
    }
    .smart-input {
      border-radius: 4px; font-size: 0.8rem; padding: 0.3rem 0.5rem; border: 1px solid #dee2e6;
    }
    .smart-input:focus { border-color: var(--smart-orange); outline: none; }
    .smart-input[readonly] { background: #f8f9fa; color: #666; }
    .form-label {
      font-size: 0.65rem; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 2px;
    }
    .card-header-compact {
      font-size: 0.75rem; font-weight: 800; text-transform: uppercase; color: var(--smart-blue);
      border-bottom: 1px solid #f1f5f9; padding-bottom: 4px; margin-bottom: 8px;
    }

    /* --- PRINT STYLES --- */
    #print-area { display: none; }

    @media print {
      @page { size: A4; margin: 8mm; }
      body { background: white; -webkit-print-color-adjust: exact; }
      body * { visibility: hidden; }
      .sidebar, .top-navbar, .main-content { display: none !important; }
      
      #print-area, #print-area * { visibility: visible; }

      #print-area {
        display: flex; flex-direction: column;
        position: absolute; left: 0; top: 0;
        width: 100%; min-height: 98vh;
        background: white; padding: 0;
        font-family: Arial, sans-serif; color: #000;
      }

      /* 1. Header */
      .dn-header {
        display: flex; justify-content: space-between; align-items: flex-start;
        border-bottom: 3px solid var(--smart-orange); /* Req #3 */
        padding-bottom: 10px; margin-bottom: 10px;
      }
      .dn-logo img { width: 180px; height: auto; } /* Req #4 */
      .dn-address { 
        text-align: right; font-size: 9px; line-height: 1.4; color: #333; 
        max-width: 250px; 
      }

      /* 2. Title Block (Moved down) */
      .dn-title-row {
        display: flex; justify-content: space-between; align-items: flex-end;
        margin-bottom: 15px;
      }
      .dn-title-main { font-size: 22px; font-weight: 900; text-transform: uppercase; line-height: 1; }
      .dn-subtitle { font-size: 11px; color: #666; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; }
      .dn-meta-box { text-align: right; }
      .dn-meta-label { font-size: 8px; font-weight: 700; color: #666; text-transform: uppercase; }
      .dn-meta-val { font-size: 14px; font-weight: 800; font-family: monospace; }

      /* 3. Info Grid */
      .dn-info-grid {
        display: grid; grid-template-columns: 1fr 1fr; gap: 20px;
        margin-bottom: 15px;
      }
      .dn-panel { border: 1px solid #000; padding: 10px; }
      .dn-panel-title { 
        font-size: 9px; font-weight: 800; text-transform: uppercase; 
        background: #eee; padding: 2px 5px; margin: -10px -10px 8px -10px; border-bottom: 1px solid #000;
      }
      
      /* Vertical Stack for Client */
      .client-stack div { margin-bottom: 3px; font-size: 10px; }
      .client-name { font-size: 13px; font-weight: 800; }

      /* 4. Cargo Table */
      .dn-table { width: 100%; border-collapse: collapse; margin-bottom: 15px; border: 1px solid #000; }
      .dn-table th { background: #eee; border: 1px solid #000; padding: 4px; font-size: 9px; text-transform: uppercase; }
      .dn-table td { border: 1px solid #000; padding: 6px; font-size: 11px; vertical-align: top; }

      /* 5. Container Grid (WFP Style) */
      .manifest-container { margin-bottom: 15px; border: 1px solid #000; padding: 0; }
      .manifest-header { background: #333; color: white; padding: 4px; font-size: 9px; font-weight: 700; text-transform: uppercase; text-align: center; }
      .manifest-grid {
        display: grid; 
        grid-template-columns: 1fr 1fr 1fr; /* 3 Columns */
        grid-template-rows: repeat(6, 22px); /* 6 Rows fixed height */
      }
      .manifest-cell {
        border-right: 1px solid #ccc; border-bottom: 1px solid #ccc;
        font-size: 10px; display: flex; align-items: center; padding-left: 8px; font-family: monospace;
      }
      .manifest-cell:nth-child(3n) { border-right: none; } /* Remove right border on last col */
      .manifest-cell.empty { color: #ccc; } /* Styling for empty slots */

      /* 6. Comments Box */
      .reservations-box {
        border: 1px solid #000; height: 150px; margin-bottom: 15px; padding: 5px;
        position: relative;
      }
      .res-label { font-size: 8px; font-weight: 700; text-transform: uppercase; color: #666; position: absolute; top: 3px; left: 3px;}

      /* 7. Signatures */
      .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; height: 150px; margin-bottom: 10px; }
      .sig-box { border: 1px solid #000; position: relative; }
      .sig-header { 
        border-bottom: 1px solid #000; background: #eee; 
        font-size: 8px; font-weight: 700; padding: 3px; text-align: center; text-transform: uppercase;
      }
      .sig-img { position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%); height: 100px; mix-blend-mode: multiply; }
      .handwritten-date { 
        position: absolute; bottom: 5px; right: 5px; 
        font-family: var(--font-hand); color: var(--smart-blue); font-size: 16px; 
      }

      /* 8. Footer */
      .footer-spacer { flex-grow: 1; }
      .dn-footer {
        border-top: 3px solid var(--smart-orange); /* Req #3 */
        padding-top: 6px;
        display: flex; justify-content: space-between; align-items: flex-end;
      }
      .footer-text { font-size: 8px; color: #444; line-height: 1.4; }
      .qr-code { width: 50px; height: 50px; }
    }
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
        <div id="admin4" class="accordion-collapse collapse show" data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="operations-registry.php" class="sub-link">Operations File Registry</a>
            <a href="transit-order.php" class="sub-link">Transit Order (OT)</a>
            <a href="operational-milestone-tracking.php" class="sub-link">Operational Milestone Tracking</a>
            <a href="delivery-note.php" class="sub-link active">Delivery Note</a>
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
      <h5 class="mb-0 fw-bold text-dark">Delivery Note Module</h5>
      <small class="text-muted" style="font-size: 0.7rem;">BORDEREAU DE LIVRAISON</small>
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
    <div class="row py-3 align-items-center">
      <div class="col-md-8">
        <h4 class="fw-bold font-heading mb-0">Delivery Notes Worksheet</h4>
        <small class="text-muted">CREATE <strong>/</strong> EDIT</small>
      </div>
    </div>

    <div class="row g-2">
      <div class="col-lg-8">
        <div class="card-custom">

          <div class="d-flex justify-content-between align-items-center border-bottom pb-2 mb-2">
            <h6 class="card-header-compact mb-0 border-0">
              <i class="fa-solid fa-file-lines me-2"></i>Delivery Note Details
            </h6>
            <span class="badge bg-light text-dark border py-1" style="font-size:0.6rem;">SP</span>
          </div>

          <div class="mb-3">
            <div class="d-flex justify-content-between align-items-center mb-2">
              <div class="fw-bold text-uppercase" style="font-size:0.72rem; letter-spacing:0.6px; color:var(--smart-blue);">
                <i class="fa-solid fa-database me-2"></i>1. Source Data
              </div>
              <span class="badge bg-light text-dark border" style="font-size:0.6rem;">Linked</span>
            </div>

            <div class="row g-1">
              <div class="col-12">
                <label class="form-label">Search Active File</label>
                <div class="input-group input-group-sm">
                  <span class="input-group-text bg-white"><i class="fa-solid fa-search"></i></span>
                  <input class="form-control smart-input" list="fileOptions" id="fileSearch"
                         placeholder="Ref, Client..." autocomplete="off">
                  <datalist id="fileOptions"></datalist>
                </div>
              </div>

              <div class="col-md-6">
                <label class="form-label">Service Type</label>
                <input type="text" id="inp-service" class="form-control smart-input" readonly>
              </div>
              <div class="col-md-6">
                <label class="form-label">BL / Tracking</label>
                <input type="text" id="inp-bl" class="form-control smart-input" readonly>
              </div>
            </div>
          </div>

          <hr class="my-2">

          <div class="mb-3">
            <div class="fw-bold text-uppercase mb-2" style="font-size:0.72rem; letter-spacing:0.6px; color:var(--smart-blue);">
              <i class="fa-solid fa-user-tie me-2"></i>2. Delivery To
            </div>

            <div class="row g-1">
              <div class="col-12">
                <label class="form-label">Client Name</label>
                <input type="text" id="inp-client-name" class="form-control smart-input fw-bold" readonly>
              </div>

              <div class="col-md-8">
                <label class="form-label">Address</label>
                <input type="text" id="inp-client-addr" class="form-control smart-input" placeholder="Street Address">
              </div>
              <div class="col-md-4">
                <label class="form-label">City / Zone</label>
                <input type="text" id="inp-client-city" class="form-control smart-input">
              </div>

              <div class="col-md-6">
                <label class="form-label">Contact</label>
                <input type="text" id="inp-client-contact" class="form-control smart-input" placeholder="Attn:">
              </div>
              <div class="col-md-6">
                <label class="form-label">Phone</label>
                <input type="text" id="inp-client-phone" class="form-control smart-input">
              </div>
            </div>
          </div>
          
              <hr class="my-2">
          
          <div class="mb-3">
            <div class="fw-bold text-uppercase mb-2" style="font-size:0.72rem; letter-spacing:0.6px; color:var(--smart-blue);">
              <i class="fa-solid fa-truck-container me-2"></i>3. Container Manifest (TCs)
            </div>
            <div class="col-12">
               <textarea id="inp-tc-list" class="form-control smart-input font-monospace" rows="3" 
                 placeholder="Paste container numbers here (comma or line separated). Empty slots will print as lines for handwriting."></textarea>
            </div>
          </div>
          
          <hr class="my-2">

          <div>
            <div class="fw-bold text-uppercase mb-2" style="font-size:0.72rem; letter-spacing:0.6px; color:var(--smart-blue);">
              <i class="fa-solid fa-boxes-stacked me-2"></i>3. Cargo Details
            </div>

            <div class="row g-1">
              <div class="col-12">
                <label class="form-label">Description</label>
                <textarea id="inp-desc" class="form-control smart-input" rows="2" readonly></textarea>
              </div>

              <div class="col-md-6">
                <label class="form-label">Marks</label>
                <input type="text" id="inp-marks" class="form-control smart-input" readonly>
              </div>
              <div class="col-md-6">
                <label class="form-label">Weight/Pkgs</label>
                <input type="text" id="inp-weight" class="form-control smart-input fw-bold" readonly>
              </div>
            </div>
          </div>

        </div>
      </div>

      <div class="col-lg-4">
        <div class="card-custom h-100 bg-white p-0 overflow-hidden">
          <div class="p-2 bg-dark text-white">
            <h6 class="fw-bold mb-0 small text-uppercase px-2"><i class="fa-solid fa-sliders me-2"></i>Parameters</h6>
          </div>

          <div class="p-3">
            <div class="mb-2">
              <label class="form-label">DN Number</label>
              <div class="input-group input-group-sm">
                <span class="input-group-text bg-light fw-bold" style="font-size:0.7rem;">SLAS-DN-</span>
                <input type="text" id="inp-dn-num" class="form-control smart-input fw-bold" placeholder="---" readonly>
              </div>
            </div>

            <div class="mb-2">
              <label class="form-label">Date</label>
              <input type="date" id="inp-date" class="form-control smart-input">
            </div>

            <div class="mb-3">
              <label class="form-label">Digital Signature</label>
              <div class="d-flex justify-content-between align-items-center p-2 bg-light border rounded">
                <label class="small fw-bold mb-0 text-dark" for="chk-digital-sig" style="cursor:pointer;">Apply Stamp</label>
                <div class="form-check form-switch m-0" style="min-height: auto;">
                  <input class="form-check-input m-0" type="checkbox" id="chk-digital-sig" role="switch" checked>
                </div>
              </div>
            </div>

            <button class="btn btn-dark w-100 btn-sm py-2 fw-bold shadow-sm" onclick="generateDN()">
              <i class="fa-solid fa-print me-2"></i> Generate & Print
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

```html
  <div id="print-area">
    
    <div class="dn-header">
      <div class="dn-logo">
        <img src="https://i.ibb.co/35MQnHJn/LOGO-SMART.png" alt="Smart LS">
      </div>
      <div class="dn-address">
        <strong>SMART LOGISTICS & SERVICES LTD</strong><br>
        1030, Avenue Douala Manga Bell, Bali<br>
        Po Box 5120, Douala, Cameroon<br>
        Tel: (+237) 699 00 00 00
      </div>
    </div>

    <div class="dn-title-row">
      <div>
        <div class="dn-title-main">Delivery Note</div>
        <div class="dn-subtitle">Bordereau de Livraison</div>
      </div>
      <div class="dn-meta-box">
        <div><span class="dn-meta-label">DN Number</span></div>
        <div class="dn-meta-val" id="p-dn-num">SLAS-DN-PENDING</div>
        <div style="margin-top:2px;">
          <span class="dn-meta-label">Date:</span> <span style="font-weight:700; font-size:11px;" id="p-date">--/--/----</span>
        </div>
      </div>
    </div>

    <div class="dn-info-grid">
      <div class="dn-panel">
        <div class="dn-panel-title">Source Data</div>
        <table style="width:100%; font-size:10px;">
          <tr>
            <td style="color:#666;">File Ref:</td>
            <td style="font-weight:700;" id="p-ref">---</td>
          </tr>
          <tr>
            <td style="color:#666;">BL / Track:</td>
            <td style="font-weight:700;" id="p-bl">---</td>
          </tr>
          <tr>
            <td style="color:#666;">Service:</td>
            <td style="font-weight:700;" id="p-service">---</td>
          </tr>
        </table>
      </div>

      <div class="dn-panel" style="background:#f9f9f9;">
        <div class="dn-panel-title">Consignee / Delivery Address</div>
        <div class="client-stack">
          <div class="client-name" id="p-client-name">CLIENT NAME</div>
          <div id="p-addr">Address Line 1</div>
          <div id="p-city">City, Country</div>
          <div id="p-contact">Attn: Contact Person</div>
          <div id="p-phone">Tel: ---</div>
        </div>
      </div>
    </div>

    <table class="dn-table">
      <thead>
        <tr>
          <th width="60%">Description of Goods</th>
          <th width="20%">Marks & Numbers</th>
          <th width="20%">Gross Weight</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td id="p-desc" style="height:60px;"></td>
          <td id="p-marks"></td>
          <td id="p-weight"></td>
        </tr>
      </tbody>
    </table>

    <div class="manifest-container">
      <div class="manifest-header">Container Manifest / Liste des Conteneurs (TCs)</div>
      <div class="manifest-grid" id="p-manifest-grid">
        </div>
    </div>

    <div class="reservations-box">
      <div class="res-label">Comments / Reservations (Client):</div>
    </div>

    <div class="sig-grid">
      <div class="sig-box">
        <div class="sig-header">Issued By (Smart LS)</div>
        <img src="../../../assets/img/signature-dg.svg" class="sig-img" id="p-sig-img" style="display:none;">
        <div class="handwritten-date" id="p-sig-date"></div>
      </div>
      <div class="sig-box">
        <div class="sig-header">Received By (Client)</div>
        <div style="font-size:9px; text-align:center; color:#999; margin-top:40px;">
          Name, Signature & Stamp
        </div>
      </div>
    </div>

    <div class="footer-spacer"></div>
    <div class="dn-footer">
      <div class="footer-text">
        <strong>SMART LOGISTICS & SERVICES LTD</strong> • RC/DLA/2021/8/2060 • NIU: M0421160335800<br>
        Bank: AFRILAND FIRST BANK S.A. • Account: 10005 00061 07018411001-93
      </div>
      <img id="p-qr-code" class="qr-code" src="">
    </div>

  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

  <script>
    // --- CLOCK & UTILS ---
    if (typeof toggleClock !== 'function') { function toggleClock(){ /* noop */ } }
    function tickClock(){
      const el = document.getElementById('realtime-clock');
      if (el) el.textContent = new Date().toLocaleTimeString('en-GB');
    }
    setInterval(tickClock, 1000); tickClock();

    function $(id){ return document.getElementById(id); }

    // --- API CONFIG ---
    const API = {
      LIST_URL:   '../../api/operation/transit_order/search_files.php',
      GET_URL:    '../../api/operation/delivery_note/get_file.php',
      CREATE_URL: '../../api/operation/delivery_note/create.php' 
    };

    let CURRENT_REF = '';
    const LIST_CACHE = new Map();

    // --- SEARCH LOGIC ---
    function debounce(fn, delay=250){
      let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
    }

    async function fetchFileOptions(q){
      const dl = $('fileOptions');
      if (!dl) return;
      dl.innerHTML = ''; LIST_CACHE.clear();

      try {
        const res = await fetch(`${API.LIST_URL}?q=${encodeURIComponent(q||'')}&limit=20`);
        const json = await res.json();
        if(json.data){
          json.data.forEach(r => {
            const ref = String(r.operations_file_reference || '').trim();
            if (!ref) return;
            LIST_CACHE.set(ref, r);
            const opt = document.createElement('option');
            opt.value = ref; 
            opt.label = [ref, r.client_name, r.doc_no].filter(Boolean).join(' • ');
            dl.appendChild(opt);
          });
        }
      } catch (e) { console.error(e); }
    }

    const debouncedFetchOptions = debounce((q) => fetchFileOptions(q), 250);

    async function loadFileFromSelection(){
  const ref = $('fileSearch').value.trim();
  if(!ref) { CURRENT_REF = ''; return; }
  
  try {
    const res = await fetch(`${API.GET_URL}?ref=${encodeURIComponent(ref)}`);
    const json = await res.json();
    if(!json.ok) throw new Error(json.error);
    applyDetailsToUI(json.data);
  } catch (e) { alert("Error: " + e.message); }
}

   function applyDetailsToUI(d){
  CURRENT_REF = d.ref || '';

  // 1. Basic Fields
  $('inp-service').value = d.service_type || '';
  $('inp-bl').value      = d.doc_no || '';
  $('inp-client-name').value = d.client || '';
  $('inp-desc').value    = d.desc || '';
  $('inp-marks').value   = d.marks || '';
  $('inp-weight').value  = d.weight || ''; 

  // 2. Client Address (FIXED: Handling all new fields)
  $('inp-client-addr').value    = d.delivery || '';
  $('inp-client-city').value    = d.city || '';     // <--- New
  $('inp-client-contact').value = d.contact || '';
  $('inp-client-phone').value   = d.phone || '';    // <--- New

  // 3. Existing DN Logic
  if (d.existing_dn_number) {
      $('inp-dn-num').value = d.existing_dn_number;
      $('p-dn-num').innerText = "SLAS-DN-" + d.existing_dn_number;
      if(d.existing_dn_date) $('inp-date').value = d.existing_dn_date;
      
      // REPOPULATE THE TC LIST
      if(d.container_manifest) $('inp-tc-list').value = d.container_manifest;
      
      $('inp-dn-num').style.backgroundColor = "#e8f0fe";
  } else {
      // Reset for new
      $('inp-dn-num').value = "";
      $('p-dn-num').innerText = "SLAS-DN-PENDING";
      $('inp-dn-num').style.backgroundColor = "";
      $('inp-date').valueAsDate = new Date();
      $('inp-tc-list').value = ""; 
  }
}

    // --- PRINT GENERATION LOGIC ---
    function updatePrintView() {
      // 1. Header & Meta
      const num = $('inp-dn-num').value;
      $('p-dn-num').innerText = num ? "SLAS-DN-" + num : "SLAS-DN-PENDING";
      
      const d = $('inp-date').value ? new Date($('inp-date').value) : new Date();
      const dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      $('p-date').innerText = dateStr;

      // 2. Info Grid
      $('p-ref').innerText = CURRENT_REF || '---';
      $('p-bl').innerText = $('inp-bl').value || '---';
      $('p-service').innerText = $('inp-service').value || '---';

      // 3. Client Stack
      $('p-client-name').innerText = $('inp-client-name').value || 'CLIENT NAME';
      $('p-addr').innerText = $('inp-client-addr').value || '';
      $('p-city').innerText = $('inp-client-city').value || '';
      $('p-contact').innerText = $('inp-client-contact').value ? "Attn: " + $('inp-client-contact').value : '';
      $('p-phone').innerText = $('inp-client-phone').value ? "Tel: " + $('inp-client-phone').value : '';

      // 4. Cargo
      $('p-desc').innerText   = $('inp-desc').value;
      $('p-marks').innerText  = $('inp-marks').value;
      $('p-weight').innerText = $('inp-weight').value;

      // 5. THE CONTAINER GRID (WFP STYLE)
      renderManifestGrid();

      // 6. Signatures
      const useSig = $('chk-digital-sig').checked;
      $('p-sig-img').style.display = useSig ? "block" : "none";
      $('p-sig-date').innerText = useSig ? dateStr : "";

      // 7. QR Code
      const qrData = `DN:${num}|${dateStr}|${CURRENT_REF}`;
      $('p-qr-code').src = `https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(qrData)}`;
    }

    function renderManifestGrid() {
        const raw = $('inp-tc-list').value || '';
        // Split by commas, newlines, or tabs to get clean numbers
        const tcs = raw.split(/[\n,;]+/).map(s => s.trim()).filter(s => s !== '');
        
        const grid = $('p-manifest-grid');
        grid.innerHTML = '';

        // Fixed 18 slots (3 cols x 6 rows)
        for (let i = 0; i < 18; i++) {
            const num = i + 1;
            const val = tcs[i] || ''; // Get TC or empty
            
            const div = document.createElement('div');
            
            if (val) {
                div.className = 'manifest-cell fw-bold';
                div.innerText = `${num}. ${val}`;
            } else {
                div.className = 'manifest-cell empty';
                div.innerHTML = `<span style="color:#999; margin-right:4px;">${num}.</span> __________________`;
            }
            grid.appendChild(div);
        }
    }

    async function generateDN() {
  if (!CURRENT_REF) { alert("Select a file first."); return; }
  
  // 1. Get the current DN number (if it exists)
  const existingDnNumber = $('inp-dn-num').value;

  const btn = document.querySelector('button[onclick="generateDN()"]');
  const oldHtml = btn.innerHTML;
  
  // Change button text based on mode
  btn.innerHTML = existingDnNumber 
    ? '<i class="fa-solid fa-sync fa-spin"></i> Updating...' 
    : '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
  btn.disabled = true;

  try {
    const res = await fetch(API.CREATE_URL, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            file_ref:       CURRENT_REF,
            dn_number:      existingDnNumber, // <--- SEND EXISTING NUMBER
            client_name:    $('inp-client-name').value,
            client_address: $('inp-client-addr').value,
            client_city:    $('inp-client-city').value,
            client_contact: $('inp-client-contact').value,
            client_phone:   $('inp-client-phone').value,
            delivery_date:  $('inp-date').value,
            tc_list:        $('inp-tc-list').value 
        })
    });
    const json = await res.json();
    
    if (!json.ok) throw new Error(json.error);

    // If it was a new creation, update the field
    if(json.dn_number) {
        $('inp-dn-num').value = json.dn_number;
    }

    updatePrintView();
    window.print();

  } catch (e) { 
    alert(e.message); 
  } finally { 
    btn.innerHTML = oldHtml; 
    btn.disabled = false; 
  }
}

    // --- INIT ---
    (function(){
      $('inp-date').valueAsDate = new Date();
      
      const search = $('fileSearch');
      search.addEventListener('input', (e) => debouncedFetchOptions(e.target.value));
      search.addEventListener('change', loadFileFromSelection);
      fetchFileOptions(''); // preload
      
      // Expose globally
      window.generateDN = generateDN;
    })();
  </script>

</body>
</html>