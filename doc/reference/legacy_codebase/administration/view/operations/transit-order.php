<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN','OPERATIONS','MANAGEMENT','FINANCE']);

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
$fullName  = $me['full_name'] ?: 'User';
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

// --- Avatar (UI Avatars) ---
$avatarName = urlencode($fullName);
$avatarUrl  = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";

function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }

// --- LOGIC TO FETCH NEXT SEQUENCE NUMBER ---
$conn = db();
$sqlSeq = "SELECT MAX(ot_number_sequence) as max_seq FROM transit_orders";
$resSeq = $conn->query($sqlSeq);
$rowSeq = $resSeq->fetch_assoc();

// If table is empty, start at 100. Otherwise, take max + 1.
$nextSeqInt = ($rowSeq['max_seq'] ?? 99) + 1;
$nextOtNumber = str_pad((string)$nextSeqInt, 5, '0', STR_PAD_LEFT);

?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Transit Order Module | Smart LS Enterprise</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">

  <style>
    :root {
      --smart-blue: #1F99D8;
      --smart-dark: #055B83;
      --smart-orange: #EE7D04;
      --smart-charcoal: #231F20;
      --smart-bg: #F0F4F8;
      --sidebar-width: 280px;
    }

    body {
      font-family: 'Manrope', sans-serif;
      background-color: var(--smart-bg);
      color: var(--smart-charcoal);
      overflow-x: hidden;
    }

    h1, h2, h3, h4, h5, h6, .font-heading {
      font-family: 'Montserrat', sans-serif;
    }

    .card-custom {
      background: white;
      border-radius: 12px;
      border: 1px solid rgba(0,0,0,0.05);
      box-shadow: 0 2px 12px rgba(0,0,0,0.02);
      padding: 1rem;
    }

    .compact-form .form-label {
      margin-bottom: 0.1rem;
      font-size: 0.7rem;
    }
    .compact-form .smart-input {
      padding: 0.4rem 0.6rem;
      font-size: 0.85rem;
    }

    .smart-input {
      border-radius: 6px;
      font-size: 0.9rem;
      padding: 0.6rem;
      border: 1px solid #dee2e6;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .smart-input:focus {
      border-color: var(--smart-orange);
      box-shadow: 0 0 0 3px rgba(238, 125, 4, 0.12);
      outline: none;
    }
    .smart-input[readonly] {
      background-color: #f8f9fa;
      color: #6c757d;
      cursor: not-allowed;
    }

    .form-label {
      font-size: 0.75rem;
      font-weight: 700;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 0.3rem;
    }

    #print-area { display: none; }

    @media print {
      /* 1. Set the global page margin to 6mm */
      @page { size: A4; margin: 6mm; }

      body { background: white; }
      body * { visibility: hidden; }

      .sidebar, .top-navbar, .main-content, .btn {
        display: none !important;
        margin: 0 !important;
        padding: 0 !important;
        height: 0 !important;
        width: 0 !important;
      }

      #print-area, #print-area * { visibility: visible; }

      #print-area {
    display: flex;              /* CHANGED: Flexbox layout */
    flex-direction: column;     /* CHANGED: Column direction */
    min-height: 99vh;           /* CHANGED: Forces container to fill the page height */
    
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    background: white;
    padding: 0;
    font-family: 'Arial', sans-serif;
    color: #000;
    box-sizing: border-box;
    z-index: 9999;
}

      /* ... (Rest of your CSS for tables/boxes remains the same) ... */

      .doc-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border: 2px solid #000;
        padding: 8px 12px;
        margin-bottom: 10px;
      }
      .doc-title { font-size: 16px; font-weight: 900; text-transform: uppercase; line-height: 1.2; }
      .doc-subtitle { font-size: 12px; font-style: italic; font-weight: normal; }

      .box-row { display: flex; gap: -1px; margin-bottom: -1px; }
      .box {
        border: 1px solid #000;
        padding: 4px 6px;
        font-size: 11px;
        position: relative;
      }
      .box-label {
        font-size: 9px;
        font-weight: bold;
        color: #333;
        margin-bottom: 2px;
        display: block;
      }
      .box-value { font-size: 12px; font-weight: bold; color: #000; }

      .w-50 { width: 50%; }
      .w-100 { width: 100%; }
      .w-25 { width: 25%; }
      .w-33 { width: 33.33%; }

      .check-box {
        display: inline-block;
        width: 12px;
        height: 12px;
        border: 1px solid #000;
        margin-right: 5px;
        vertical-align: middle;
        position: relative;
        background: #fff;
      }
      .check-box.checked::after {
        content: 'X';
        position: absolute;
        left: 1px;
        top: -2px;
        font-size: 10px;
        font-weight: bold;
        color: #000;
      }

      table.cargo-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 15px;
        margin-bottom: 15px;
      }
      table.cargo-table th {
        border: 1px solid #000;
        font-size: 10px;
        background: #eee;
        padding: 4px;
        text-align: center;
        font-weight: bold;
      }
      table.cargo-table td {
        border: 1px solid #000;
        font-size: 11px;
        padding: 6px;
        vertical-align: top;
        height: 120px;
      }

      .sec-title {
        font-size: 12px;
        font-weight: bold;
        text-decoration: underline;
        margin: 8px 0 4px 0;
      }

      .footer-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 15px;
    border-top: 2px solid #000;
    padding-top: 10px;
    
    margin-top: auto;           /* CHANGED: Pushes this section to the very bottom */
}

.sig-box {
    border: 1px solid #000;
    height: 190px;              /* CHANGED: Increased height */
    padding: 5px;
    font-size: 10px;
    position: relative;         /* CHANGED: For easier image positioning */
}
    
      </style>
</head>
<body>

  <!-- SIDEBAR -->
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
                    <a href="operations-registry" class="sub-link">Operations File Registry</a>
                    <a href="transit-order.php" class="sub-link active">Transit Order (OT)</a>
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
  <!-- TOP NAVBAR -->
  <div class="top-navbar">
    <div>
      <h5 class="mb-0 fw-bold text-dark">Transit Order Module</h5>
      <small class="text-muted" style="font-size: 0.7rem;">ORDRE DE TRANSIT GENERATION</small>
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
  <div class="main-content px-4 pb-5">
    <div class="row py-4 align-items-center">
      <div class="col-md-6">
        <h2 class="fw-bold font-heading mb-0">Create Transit Order</h2>
        <p class="text-muted mb-0 small">Official customs authorization document.</p>
      </div>
      <div class="col-md-6 text-end">
        <button class="btn btn-dark fw-bold shadow-sm px-4 btn-save-print" onclick="saveAndPrint()">
          <i class="fa-solid fa-floppy-disk me-2"></i> Save & Print
        </button>
      </div>
    </div>

    <div class="row g-4">
      <div class="col-lg-8">
        <div class="card mb-3" style="padding: 1rem;">
          <h6 class="text-primary fw-bold mb-3 text-uppercase border-bottom pb-2"><i class="fa-solid fa-database me-2"></i>1. Source Data</h6>

          <div class="row g-3">
            <div class="col-12">
              <label class="form-label">Search Active File</label>
              <div class="input-group">
                <input type="hidden" id="inp-file-ref">
                <span class="input-group-text bg-white border-end-0"><i class="fa-solid fa-magnifying-glass text-muted"></i></span>
                <input class="form-control smart-input border-start-0" list="fileOptions" id="fileSearch" placeholder="Type Reference, Client or BL..." onchange="loadFile()">
                <datalist id="fileOptions"></datalist>
              </div>
              <div class="form-text small">Select a file to auto-populate SSDC data.</div>
            </div>

            <div class="col-md-4">
              <label class="form-label">File Reference</label>
              <input type="text" id="inp-ref" class="form-control smart-input" readonly>
            </div>
            <div class="col-md-8">
              <label class="form-label">Client</label>
              <input type="text" id="inp-client" class="form-control smart-input" readonly>
            </div>

            <div class="col-md-6">
              <label class="form-label">Vessel / Voyage</label>
              <input type="text" id="inp-vessel" class="form-control smart-input" readonly>
            </div>
            <div class="col-md-6">
              <label class="form-label">BL / AWB Number</label>
              <input type="text" id="inp-bl" class="form-control smart-input" readonly>
            </div>

            <div class="col-md-6">
              <label class="form-label">Origin (POL)</label>
              <input type="text" id="inp-pol" class="form-control smart-input" readonly>
            </div>
            <div class="col-md-6">
              <label class="form-label">Destination (POD)</label>
              <input type="text" id="inp-pod" class="form-control smart-input" readonly>
            </div>
          </div>
        </div>

        <div class="card" style="padding: 1rem;">
          <h6 class="text-primary fw-bold mb-3 text-uppercase border-bottom pb-2"><i class="fa-solid fa-boxes-stacked me-2"></i>2. Cargo Details</h6>

          <div class="row g-3">
            <div class="col-md-12">
              <label class="form-label">Commodity Description (SSDC)</label>
              <textarea id="inp-desc" class="form-control smart-input" rows="2" readonly></textarea>
            </div>
            <div class="col-md-4">
              <label class="form-label">Packages</label>
              <input type="text" id="inp-pkgs" class="form-control smart-input" readonly>
            </div>
            <div class="col-md-4">
              <label class="form-label">Gross Weight</label>
              <input type="text" id="inp-weight" class="form-control smart-input" readonly>
            </div>
            <div class="col-md-4">
              <label class="form-label text-danger">Cargo Value (Manual)</label>
              <input type="text" id="inp-value" class="form-control smart-input border-danger" placeholder="Enter Invoice Value (e.g. 50.000 EUR)">
            </div>
            <div class="col-12">
              <label class="form-label">Marks & Numbers</label>
              <input type="text" id="inp-marks" class="form-control smart-input" readonly>
            </div>
          </div>
        </div>
      </div>

      <div class="col-lg-4">
        <div class="card-custom h-100">
          <h6 class="text-primary fw-bold mb-3 text-uppercase border-bottom pb-2"><i class="fa-solid fa-sliders me-2"></i>3. Parameters</h6>

          <div class="mb-4">
            <label class="form-label">Generated Number</label>
            <div class="input-group">
              <span class="input-group-text bg-dark text-white fw-bold" style="font-size: 0.8rem;">SLAS/OT/</span>
              <input type="text" id="inp-ot-num" class="form-control smart-input fw-bold" value="<?php echo $nextOtNumber; ?>" readonly>
            </div>
          </div>

          <div class="mb-4">
            <label class="form-label">Service Direction</label>
            <select id="inp-direction" class="form-select smart-input" onchange="syncToPrint()">
              <option value="IMPORT">IMPORT</option>
              <option value="EXPORT">EXPORT</option>
            </select>
          </div>

          <div class="mb-4">
            <label class="form-label">Customs Regime</label>
            <div class="d-flex flex-wrap gap-2 p-2 border rounded bg-light">
              <div class="form-check">
                <input class="form-check-input" type="radio" name="regime" value="IM4" id="r_im4" checked onchange="syncToPrint()">
                <label class="form-check-label small fw-bold" for="r_im4">IM 4</label>
              </div>
              <div class="form-check">
                <input class="form-check-input" type="radio" name="regime" value="IM7" id="r_im7" onchange="syncToPrint()">
                <label class="form-check-label small fw-bold" for="r_im7">IM 7</label>
              </div>
              <div class="form-check">
                <input class="form-check-input" type="radio" name="regime" value="IM8" id="r_im8" onchange="syncToPrint()">
                <label class="form-check-label small fw-bold" for="r_im8">IM 8</label>
              </div>
              <div class="form-check">
                <input class="form-check-input" type="radio" name="regime" value="EX1" id="r_ex1" onchange="syncToPrint()">
                <label class="form-check-label small fw-bold" for="r_ex1">Ex 1</label>
              </div>
              <div class="form-check">
                <input class="form-check-input" type="radio" name="regime" value="EX2" id="r_ex2" onchange="syncToPrint()">
                <label class="form-check-label small fw-bold text-danger" for="r_ex2">Ex 2</label>
              </div>
            </div>
          </div>

          <div class="mb-4">
            <label class="form-label">Insurance Responsibility</label>
            <select id="inp-insurance" class="form-select smart-input" onchange="syncToPrint()">
              <option value="CLIENT">Client (Not Covered by Smart LS)</option>
              <option value="SMART">Smart LS Covered</option>
            </select>
          </div>

          <div class="mb-4">
            <label class="form-label">Departure Date (Transit)</label>
            <input type="date" id="inp-dept-date" class="form-control smart-input" onchange="syncToPrint()">
          </div>

          <div class="mb-3">
            <label class="form-label">Submitted Documents</label>
            <div class="border rounded p-3 bg-light">
              <div class="form-check mb-1">
                <input class="form-check-input doc-toggle" type="checkbox" value="INVOICE" id="chk-invoice" checked onchange="syncToPrint()">
                <label class="form-check-label small" for="chk-invoice">Supplier Invoice</label>
              </div>
              <div class="form-check mb-1">
                <input class="form-check-input doc-toggle" type="checkbox" value="PACKING" id="chk-packing" checked onchange="syncToPrint()">
                <label class="form-check-label small" for="chk-packing">Packing List</label>
              </div>
              <div class="form-check mb-1">
                <input class="form-check-input doc-toggle" type="checkbox" value="BL" id="chk-bl" checked onchange="syncToPrint()">
                <label class="form-check-label small" for="chk-bl">Original BL/AWB</label>
              </div>
              <div class="form-check mb-1">
                <input class="form-check-input doc-toggle" type="checkbox" value="EXONERATION" id="chk-exoneration" onchange="syncToPrint()">
                <label class="form-check-label small" for="chk-exoneration">Exoneration Letter</label>
              </div>
              <div class="form-check mb-1">
                <input class="form-check-input doc-toggle" type="checkbox" value="OTHER" id="chk-other" onchange="syncToPrint()">
                <label class="form-check-label small" for="chk-other">Other Documents</label>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  </div>

  <!-- PRINT AREA -->
  <div id="print-area">
    <div class="doc-header">
      <div>
        <div class="doc-title">ORDRE DE TRANSIT</div>
        <div class="doc-subtitle">Transit Authorization</div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 14px; font-weight: bold;">No. <span id="p-ot-num">SLAS/OT/<?php echo $nextOtNumber; ?></span></div>
        <div style="font-size: 11px; margin-top: 4px;">
          <span class="check-box" id="cb-import"></span> Import &nbsp;&nbsp;
          <span class="check-box" id="cb-export"></span> Export
        </div>
      </div>
    </div>

    <div class="box-row">
      <div class="box w-50">
        <span class="box-label">Client</span>
        <span class="box-value" id="p-client">SELECT FILE</span>
      </div>
      <div class="box w-50">
        <span class="box-label">File Reference</span>
        <span class="box-value" id="p-ref">---</span>
      </div>
    </div>

    <div class="box-row">
      <div class="box w-50">
        <span class="box-label">Navire / Vessel</span>
        <span class="box-value" id="p-vessel">---</span>
      </div>
      <div class="box w-50">
        <span class="box-label">Connaissement / BL</span>
        <span class="box-value" id="p-bl">---</span>
      </div>
    </div>

    <div class="box-row">
      <div class="box w-50">
        <span class="box-label">Provenance / Origin</span>
        <span class="box-value" id="p-pol">---</span>
      </div>
      <div class="box w-50">
        <span class="box-label">Date d'arrivée / Arrival date</span>
        <span class="box-value" id="p-ata">---</span>
      </div>
    </div>

    <div class="box-row">
      <div class="box w-50">
        <span class="box-label">Destination / POD</span>
        <span class="box-value" id="p-pod">Douala</span>
      </div>
      <div class="box w-50">
        <span class="box-label">Date de départ / Departure date</span>
        <span class="box-value" id="p-dept">---</span>
      </div>
    </div>

    <table class="cargo-table">
      <thead>
        <tr>
          <th width="20%">Marques / Marks</th>
          <th width="10%">Colis / Pkgs</th>
          <th width="40%">Désignation de la Marchandise / Cargo Description</th>
          <th width="15%">Poids / Weight</th>
          <th width="15%">Valeur / Value</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td id="p-marks"></td>
          <td id="p-pkgs" style="text-align: center;"></td>
          <td id="p-desc"></td>
          <td id="p-weight" style="text-align: right;"></td>
          <td id="p-value" style="text-align: right;"></td>
        </tr>
      </tbody>
    </table>

    <div style="border: 1px solid #000; padding: 5px; margin-bottom: 10px;">
      <div class="sec-title" style="margin-top:0;">Régime Douanier Sollicité / Requested Customs Regime:</div>
      <div style="display: flex; gap: 20px; font-weight: bold; font-size: 11px; margin-top: 5px;">
        <span><span class="check-box" id="cb-im4"></span> IM 4</span>
        <span><span class="check-box" id="cb-im7"></span> IM 7</span>
        <span><span class="check-box" id="cb-im8"></span> IM 8</span>
        <span><span class="check-box" id="cb-ex1"></span> Ex 1</span>
        <span><span class="check-box" id="cb-ex2"></span> Ex 2</span>
      </div>
      <div style="margin-top: 5px; font-size: 10px;">Autre Régime / Other Regime: _______________________</div>
    </div>

    <div class="box-row">
      <div class="box w-100" style="background: #f9f9f9;">
        <span class="box-label">Lieu de Livraison / Place of Delivery:</span>
        <span class="box-value" id="p-delivery"></span>
      </div>
    </div>

    <div class="box-row">
      <div class="box w-100">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span class="check-box" id="cb-ins-no"></span>
          <span style="font-weight: bold;">Assurance non couverte par SMART LOGISTICS / Insurance not covered by SMART LOGISTICS</span>
        </div>
      </div>
    </div>

    <div class="box-row">
      <div class="box w-50">
        <span class="box-label">En cas d'avaries, le constat d'expert / In case of damage, the surveyor:</span>
        <div><span class="check-box" id="cb-dmg-us"></span> Sera demandé par NOUS / Is applied for by US</div>
      </div>
      <div class="box w-50" style="display: flex; align-items: center;">
        <div><span class="check-box" id="cb-dmg-smart"></span> Sera demandé par SMART LOGISTICS / By SMART</div>
      </div>
    </div>

    <div style="border: 1px solid #000; padding: 5px; margin-top: 10px; border-top: 0;">
      <div class="sec-title" style="margin-top: 0;">Pièces Jointes / Attached Documents</div>
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; font-size: 10px; gap: 5px;">
        <span><span class="check-box" id="p-doc-inv"></span> Facture / Invoice</span>
        <span><span class="check-box" id="p-doc-pkg"></span> Liste Colisage / Packing List</span>
        <span><span class="check-box" id="p-doc-bl"></span> Original BL/LTA</span>
        <span><span class="check-box" id="p-doc-exo"></span> Lettre D'exonération</span>
        <span><span class="check-box" id="p-doc-co"></span> Certificat d'Origine</span>
        <span><span class="check-box" id="p-doc-other"></span> Autres / Other</span>
      </div>
    </div>

    <div class="footer-grid">
      <div class="sig-box">
        <div style="font-weight: bold; text-decoration: underline;">Visa Client / Stamp of Client:</div>
        <br><br>
        Reçu le / Received on: ___________________
      </div>
      <div class="sig-box">
  <div style="font-weight: bold; text-decoration: underline;">Visa Smart Logistics & Services:</div>
  <div style="margin-top: 5px;">Douala, le: <span id="p-print-date"></span></div>
  
  <div style="margin-top: 15px; text-align: center;">
    <img src="../../../assets/img/signature-dg.svg" alt="Signature" style="height: 120px; width: auto; display: block; margin: 0 auto;">
  </div>
</div>
    </div>

    <div style="text-align: center; font-size: 9px; margin-top: 20px; color: #555;">
      SMART LOGISTICS & SERVICES LTD - RC/DLA/2020/B/1842 - NIU: M052012789123C
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

  // --- API paths
  const API_SEARCH = '../../api/operation/transit_order/search_files.php';
  const API_GET    = '../../api/operation/transit_order/get_file.php';

  // State: map datalist option -> ref
  const optionRefMap = new Map();

  const els = {
    fileSearch: document.getElementById('fileSearch'),
    fileOptions: document.getElementById('fileOptions'),

    ref: document.getElementById('inp-ref'),
    client: document.getElementById('inp-client'),
    vessel: document.getElementById('inp-vessel'),
    bl: document.getElementById('inp-bl'),
    pol: document.getElementById('inp-pol'),
    pod: document.getElementById('inp-pod'),

    desc: document.getElementById('inp-desc'),
    pkgs: document.getElementById('inp-pkgs'),
    weight: document.getElementById('inp-weight'),
    marks: document.getElementById('inp-marks'),

    value: document.getElementById('inp-value'),
    deptDate: document.getElementById('inp-dept-date'),
    direction: document.getElementById('inp-direction'),
    insurance: document.getElementById('inp-insurance'),
    otNum: document.getElementById('inp-ot-num'),
  };

  async function apiGet(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      const t = await res.text();
      throw new Error('Non-JSON response: ' + t.slice(0, 200));
    }
    const json = await res.json();
    if (!res.ok || json.ok === false) {
      throw new Error(json.error || 'Request failed');
    }
    return json;
  }

  function clearDatalist() {
    els.fileOptions.innerHTML = '';
    optionRefMap.clear();
  }

  function makeLabel(row) {
    const ref = row.operations_file_reference || '';
    const client = row.client_name || '';
    const doc = row.doc_no || '';
    return `${ref} — ${client}${doc ? ' — ' + doc : ''}`;
  }

  function addOption(label, ref) {
    const opt = document.createElement('option');
    opt.value = label;
    els.fileOptions.appendChild(opt);
    optionRefMap.set(label, ref);
  }

  // Debounced search on typing
  let tmr = null;
  function debounceSearch() {
    clearTimeout(tmr);
    tmr = setTimeout(runSearch, 250);
  }

  async function saveAndPrint() {
    const fileRef = document.getElementById('inp-file-ref').value;
    const btn = document.querySelector('.btn-save-print');

    if (!fileRef) {
      alert("Please search and select a valid Operation File first.");
      return;
    }

    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
    btn.disabled = true;

    const docs = [];
    document.querySelectorAll('.doc-toggle:checked').forEach(el => docs.push(el.value));

    const payload = {
      file_ref: fileRef,
      declared_value: document.getElementById('inp-value').value,
      service_direction: document.getElementById('inp-direction').value,
      customs_regime: document.querySelector('input[name="regime"]:checked')?.value || 'IM4',
      insurance_type: document.getElementById('inp-insurance').value,
      transit_departure_date: document.getElementById('inp-dept-date').value,
      submitted_docs: docs
    };

    try {
      const res = await fetch('../../api/operation/transit_order/create.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Unknown error');

      // Update OT number from backend
      document.getElementById('inp-ot-num').value = json.ot_number.split('/').pop();
      document.getElementById('p-ot-num').innerText = json.ot_number;

      window.print();

    } catch (e) {
      alert("Error creating Transit Order: " + e.message);
      console.error(e);
    } finally {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  }

  // ✅ FIXED: runSearch must NOT reference finalRef (it only populates datalist)
  async function runSearch() {
    const q = (els.fileSearch.value || '').trim();
    try {
      const url = API_SEARCH + '?q=' + encodeURIComponent(q) + '&limit=25';
      const json = await apiGet(url);

      // accept either {data:[...]} OR {rows:[...]} from backend
      const list = Array.isArray(json.data) ? json.data : (Array.isArray(json.rows) ? json.rows : []);

      clearDatalist();
      list.forEach(row => {
        const label = makeLabel(row);
        addOption(label, row.operations_file_reference);
      });
    } catch (e) {
      console.error(e);
    }
  }

  // ✅ FIXED: loadFile sets the hidden ref (inp-file-ref) using finalRef
  async function loadFile() {
    const label = (els.fileSearch.value || '').trim();
    const ref = optionRefMap.get(label);

    const finalRef = ref || label.split('—')[0]?.trim() || '';
    if (!finalRef) return;

    // This is the ref used by saveAndPrint()
    document.getElementById('inp-file-ref').value = finalRef;

    try {
      const url = API_GET + '?ref=' + encodeURIComponent(finalRef);
      const json = await apiGet(url);
      const data = json.data || {};

      els.ref.value = data.ref || '';
      els.client.value = data.client || '';
      els.vessel.value = data.vessel_voyage || '';
      els.bl.value = data.doc_no || '';
      els.pol.value = data.pol || '';
      els.pod.value = data.pod || '';

      els.desc.value = data.desc || '';
      els.pkgs.value = data.pkgs || '';
      els.weight.value = data.weight || '';
      els.marks.value = data.marks || '';

      document.getElementById("p-client").innerText = data.client || '---';
      document.getElementById("p-ref").innerText    = data.ref || '---';
      document.getElementById("p-vessel").innerText = data.vessel_voyage || '---';
      document.getElementById("p-bl").innerText     = data.doc_no || '---';
      document.getElementById("p-pol").innerText    = data.pol || '---';
      document.getElementById("p-pod").innerText    = data.pod || '---';

      document.getElementById("p-ata").innerText = (data.ata || data.eta || '---');

      document.getElementById("p-marks").innerText  = data.marks || '';
      document.getElementById("p-pkgs").innerText   = data.pkgs || '';
      document.getElementById("p-desc").innerText   = data.desc || '';
      document.getElementById("p-weight").innerText = data.weight || '';
      document.getElementById("p-delivery").innerText = data.delivery || (data.pod || '');

      syncToPrint();
    } catch (e) {
      console.error(e);
    }
  }

  function toggleCheck(id, state) {
    const el = document.getElementById(id);
    if (!el) return;
    if (state) el.classList.add('checked');
    else el.classList.remove('checked');
  }

  function syncToPrint() {
    document.getElementById("p-value").innerText = (els.value.value || '');
    document.getElementById("p-ot-num").innerText = "SLAS/OT/" + (els.otNum.value || '');

    const dir = els.direction.value;
    toggleCheck("cb-import", dir === "IMPORT");
    toggleCheck("cb-export", dir === "EXPORT");

    const reg = document.querySelector('input[name="regime"]:checked')?.value || "IM4";
    toggleCheck("cb-im4", reg === "IM4");
    toggleCheck("cb-im7", reg === "IM7");
    toggleCheck("cb-im8", reg === "IM8");
    toggleCheck("cb-ex1", reg === "EX1");
    toggleCheck("cb-ex2", reg === "EX2");

    const ins = els.insurance.value;
    toggleCheck("cb-ins-no", ins === "CLIENT");
    if (ins === "CLIENT") {
      toggleCheck("cb-dmg-us", false);
      toggleCheck("cb-dmg-smart", false);
    } else {
      toggleCheck("cb-dmg-smart", true);
      toggleCheck("cb-dmg-us", false);
    }

    document.getElementById("p-dept").innerText = (els.deptDate.value || '---');

    toggleCheck("p-doc-inv", document.getElementById("chk-invoice").checked);
    toggleCheck("p-doc-pkg", document.getElementById("chk-packing").checked);
    toggleCheck("p-doc-bl",  document.getElementById("chk-bl").checked);
    toggleCheck("p-doc-exo", document.getElementById("chk-exoneration").checked);
    toggleCheck("p-doc-other", document.getElementById("chk-other").checked);
  }

  els.fileSearch.addEventListener('input', debounceSearch);
  els.fileSearch.addEventListener('change', loadFile);
  els.value.addEventListener('input', syncToPrint);

  (function init(){
    document.getElementById("p-print-date").innerText = new Date().toLocaleDateString('fr-FR');
    runSearch();
    syncToPrint();
  })();

  window.loadFile = loadFile;
  window.syncToPrint = syncToPrint;
  window.saveAndPrint = saveAndPrint;
  </script>

</body>
</html>
