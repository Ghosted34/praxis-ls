<?php
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['SALES']);

// --- Fetch current admin details from DB (authoritative profile) ---
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
$fullName  = $me['full_name'] ?: 'SALES';
$firstName = trim(explode(' ', $fullName)[0] ?? 'SALES');

$roleLabelMap = [
  'ADMIN'      => 'SYSTEM ADMIN',
  'FINANCE'    => 'FINANCE',
  'SALES'      => 'SALES',
  'OPERATIONS' => 'OPERATIONS',
  'MANAGEMENT' => 'MANAGEMENT',
];
$role      = strtoupper((string)($me['role'] ?? 'SALES'));
$roleLabel = $roleLabelMap[$role] ?? 'SALES';

// --- Avatar: UI Avatars based on name (no local image storage needed yet) ---
$avatarName = urlencode($fullName);
$avatarUrl  = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";

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

    /* --- MODULE UI (kept) --- */
    .card-custom {
      background: white;
      border-radius: 8px;
      border: 1px solid rgba(0,0,0,0.05);
      box-shadow: 0 2px 6px rgba(0,0,0,0.02);
      padding: 0.8rem;
    }

    .smart-input {
      border-radius: 4px;
      font-size: 0.8rem;
      padding: 0.3rem 0.5rem;
      border: 1px solid #dee2e6;
    }
    .smart-input:focus {
      border-color: var(--smart-orange);
      box-shadow: none;
      outline: 2px solid rgba(238,125,4,0.1);
    }
    .smart-input[readonly] { background: #f8f9fa; color: #666; }

    .form-label {
      font-size: 0.65rem;
      font-weight: 700;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 0;
    }

    .card-header-compact {
      font-size: 0.75rem;
      font-weight: 800;
      text-transform: uppercase;
      color: var(--smart-blue);
      border-bottom: 1px solid #f1f5f9;
      padding-bottom: 4px;
      margin-bottom: 8px;
    }

    /* --- PRINT STYLES --- */
    #print-area { display: none; }

    @media print {
      @page { size: A4; margin: 0; }
      body { background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body * { visibility: hidden; }

      /* Hide UI */
      .sidebar, .top-navbar, .main-content { display: none !important; }

      /* Show Print Area */
      #print-area, #print-area * { visibility: visible; }

      #print-area {
        display: block;
        position: absolute;
        left: 0;
        top: 0;
        width: 210mm;
        min-height: 297mm;
        background: white;
        padding: 10mm 15mm;
        font-family: Arial, sans-serif;
        color: #000;
      }

      .dn-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 15px;
        border-bottom: 2px solid var(--smart-orange);
        padding-bottom: 10px;
      }
      .dn-brand { display: flex; align-items: center; gap: 10px; }
      .dn-brand img { height: 45px; width: auto; object-fit: contain; }
      .dn-brand-text { font-size: 9px; color: #333; line-height: 1.3; }

      .dn-title-block { text-align: right; }
      .dn-title { font-size: 20px; font-weight: 900; color: var(--smart-dark); text-transform: uppercase; }
      .dn-subtitle { font-size: 10px; color: var(--smart-orange); font-weight: bold; text-transform: uppercase; letter-spacing: 2px; }

      .dn-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px; }
      .dn-box { border: 1px solid #ccc; padding: 8px; background: #fff; }

      .dn-label { font-size: 8px; color: #666; text-transform: uppercase; font-weight: 700; display: block; }
      .dn-value { font-size: 11px; color: #000; font-weight: 700; }
      .dn-value-lg { font-size: 14px; color: var(--smart-dark); font-weight: 800; font-family: monospace; }

      .client-block { border: 1px solid #ccc; border-left: 4px solid var(--smart-blue); padding: 10px; background: #f4f8ff; }

      .dn-table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
      .dn-table th { background: #333; color: white; padding: 6px; font-size: 9px; text-transform: uppercase; text-align: left; }
      .dn-table td { border-bottom: 1px solid #ccc; padding: 8px 6px; font-size: 11px; vertical-align: top; }

      .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 10px; }
      .sig-box {
        border: 1px solid #ccc; height: 130px; position: relative;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
      }
      .sig-title {
        font-size: 9px; font-weight: bold; text-decoration: underline;
        position: absolute; top: 6px; left: 6px;
      }

      .sig-img {
        width: 120px; height: auto;
        mix-blend-mode: multiply; z-index: 2;
        display: block !important;
      }

      .handwritten-date {
        font-family: var(--font-hand);
        font-size: 18px;
        color: #0044cc;
        font-weight: 700;
        position: absolute;
        bottom: 10px;
        right: 20px;
        transform: rotate(-2deg);
        z-index: 3;
      }

      .tc-lines { font-size: 10px; color: #ccc; line-height: 1.8; margin-top: 5px; }

      .dn-footer {
        border-top: 1px solid #ccc;
        padding-top: 8px;
        font-size: 8px;
        color: #555;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .qr-box { width: 60px; height: 60px; }
    }
  </style>
</head>

<body>

  <!-- SIDEBAR -->
  <nav class="sidebar">
    <div class="sidebar-header">
        <a href="index" class="brand-logo"><i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span></a>
    </div>

    <div class="px-3 mb-2 mt-2">
        <a href="index" class="btn btn-primary w-100 text-start d-flex align-items-center" style="background-color: transparent; color: inherit; border: none; padding-left: 0;">
            <i class="fa-solid fa-house category-icon me-2"></i> 
            <span class="fw-bold">Sales Dashboard GM</span> 
        </a>
    </div>

    <div class="sidebar-menu accordion" id="salesMenu">
        
        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#sales1">
                <span><i class="fa-solid fa-database category-icon"></i> 1. MASTER DATA MGMT</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="sales1" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                <div class="sub-menu">
                    <a href="client-master-registry.php" class="sub-link">Client Master Registry</a>
                    <a href="financial-dictionary.php" class="sub-link">Financial Dictionary</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#sales2">
                <span><i class="fa-solid fa-users category-icon"></i> 2. CRM & ACQUISITION</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="sales2" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                <div class="sub-menu">
                    <a href="contact-us-intake.php" class="sub-link">Contact Us Intake</a>
                    <a href="partnership-portal-intake.php" class="sub-link">Partnership Portal Intake</a>
                    <a href="market-campaign-registration.php" class="sub-link">Marketing Campaign Register</a>
                    <a href="smart-quote-intake.php" class="sub-link">Smart Quote Intake</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#sales3">
                <span><i class="fa-solid fa-filter category-icon"></i> 3. SALES FUNNEL</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="sales3" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                <div class="sub-menu">
                    <a href="sales-pipelining.php" class="sub-link">Sales Pipeline</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#sales4">
                <span><i class="fa-solid fa-calculator category-icon"></i> 4. COMMERCIAL & PRICING</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="sales4" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                <div class="sub-menu">
                    <a href="margin-simulator-billing.php" class="sub-link">Margin Simulator & Pricing System</a>
                    <a href="extra-charges-simulator.php" class="sub-link">Extra Charges Simulator</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#sales5">
                <span><i class="fa-solid fa-truck-fast category-icon"></i> 5. LOGISTICS OPERATIONS</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="sales5" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                <div class="sub-menu">
                    <a href="operations-registry.php" class="sub-link">Operations File Registry</a>
                    <a href="operational-milestone-tracking.php" class="sub-link">Operational Milestone Tracking</a>
                    <a href="delivery-note.php" class="sub-link">Delivery Note</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#sales6">
                <span><i class="fa-solid fa-building-columns category-icon"></i> 6. FINANCE & TREASURY</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="sales6" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                <div class="sub-menu">
                    <a href="cash-request.php" class="sub-link">Cash Request</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#sales7">
                <span><i class="fa-solid fa-box-archive category-icon"></i> 7. COMPANY ARCHIVES</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="sales7" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                <div class="sub-menu">
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

  <!-- TOP NAVBAR -->
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

  <!-- MAIN CONTENT -->
  <div class="main-content px-4 pb-5">
    <div class="row py-3 align-items-center">
      <div class="col-md-8">
        <h4 class="fw-bold font-heading mb-0">Create Delivery Note</h4>
        <small class="text-muted">All sections (Source Data, Delivery To, Cargo Details) are on a single page.</small>
      </div>
    </div>

    <div class="row g-2">
      <div class="col-lg-8">
        <div class="card-custom">

          <div class="d-flex justify-content-between align-items-center border-bottom pb-2 mb-2">
            <h6 class="card-header-compact mb-0 border-0">
              <i class="fa-solid fa-file-lines me-2"></i>Delivery Note Details (One Page)
            </h6>
            <span class="badge bg-light text-dark border py-1" style="font-size:0.6rem;">Single Page</span>
          </div>

          <!-- SECTION 1: SOURCE DATA -->
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
                         placeholder="Ref, Client..." autocomplete="off" readonly>
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

          <!-- SECTION 2: DELIVERY TO -->
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

          <!-- SECTION 3: CARGO DETAILS -->
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

      <!-- RIGHT COLUMN: PARAMETERS -->
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
                <input type="text" id="inp-dn-num" class="form-control smart-input fw-bold" value="002401" readonly>
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
              <i class="fa-solid fa-print me-2"></i> Generate PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- PRINT AREA -->
  <div id="print-area">
    <div class="dn-header">
      <div class="dn-brand">
        <img src="https://i.ibb.co/35MQnHJn/LOGO-SMART.png" alt="" />
        <div class="dn-brand-text">
          <strong>SMART LOGISTICS & SERVICES LTD</strong><br>
          1030, Avenue Douala Manga Bell, Bali<br>
          Po Box 5120, Douala, Cameroon
        </div>
      </div>
      <div class="dn-title-block">
        <div class="dn-title">Delivery Note</div>
        <div class="dn-subtitle">Bordereau de Livraison</div>
      </div>
    </div>

    <div class="dn-grid">
      <div class="dn-box">
        <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
          <div><span class="dn-label">DN No.</span><span class="dn-value-lg" id="p-dn-num">SLAS-DN-0000</span></div>
          <div style="text-align:right;"><span class="dn-label">Date</span><span class="dn-value" id="p-date">--/--/----</span></div>
        </div>
        <div style="display:flex; justify-content:space-between;">
          <div><span class="dn-label">File Ref</span><span class="dn-value" id="p-ref">---</span></div>
          <div style="text-align:right;"><span class="dn-label">BL/Track</span><span class="dn-value" id="p-bl">---</span></div>
        </div>
      </div>

      <div class="client-block">
        <span class="dn-label" style="color:var(--smart-blue); margin-bottom:4px;">DELIVERY TO:</span>
        <div style="font-size:12px; font-weight:800;" id="p-client-name">CLIENT</div>
        <div style="font-size:10px; line-height:1.2; margin-top:2px;" id="p-client-details">Address...</div>
      </div>
    </div>

    <table class="dn-table">
      <thead>
        <tr>
          <th width="50%">Description</th>
          <th width="25%">Marks</th>
          <th width="25%">Weight/Qty</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td id="p-desc"></td>
          <td id="p-marks"></td>
          <td id="p-weight"></td>
        </tr>
      </tbody>
    </table>

    <div style="border:1px dashed #ccc; padding:8px; margin-bottom:15px;">
      <div class="dn-label" style="margin-bottom: 5px;">TC Numbers / Container References (Manual Entry):</div>
      <div class="tc-lines" style="font-size: 10px; line-height: 1.6; color: #ccc;">
        __________________________________________________________________________________________________________________________________________________________________<br>
        __________________________________________________________________________________________________________________________________________________________________<br>
        __________________________________________________________________________________________________________________________________________________________________<br>
        __________________________________________________________________________________________________________________________________________________________________<br>
        __________________________________________________________________________________________________________________________________________________________________<br>
        __________________________________________________________________________________________________________________________________________________________________<br>
        __________________________________________________________________________________________________________________________________________________________________<br>
        __________________________________________________________________________________________________________________________________________________________________<br>
        __________________________________________________________________________________________________________________________________________________________________<br>
        __________________________________________________________________________________________________________________________________________________________________<br>
        __________________________________________________________________________________________________________________________________________________________________<br>
        __________________________________________________________________________________________________________________________________________________________________<br>
        __________________________________________________________________________________________________________________________________________________________________<br>
        __________________________________________________________________________________________________________________________________________________________________<br>
      </div>
    </div>

    <div class="sig-grid">
      <div class="sig-box">
        <div class="sig-title">DELIVERY MADE BY (SMART LS):</div>
        <img src="https://i.ibb.co/m58kKZdd/signature-dg-smart.png" class="sig-img" id="p-sig-img" alt="Signed" />
        <div class="handwritten-date" id="p-sig-date"></div>
      </div>

      <div class="sig-box">
        <div class="sig-title">RECEIVED BY (CLIENT):</div>
        <div style="margin-top:40px; font-size:10px; text-align:center;">
          Name, Date, Signature & Stamp
        </div>
      </div>
    </div>

    <div class="dn-footer">
      <div>
        <strong>RC/DLA/2021/8/2060 | NIU: M0421160335800</strong><br>
        Bank: AFRILAND FIRST BANK S.A. | Acct: 10005 00061 07018411001-93
      </div>
      <img id="p-qr-code" class="qr-box" src="" />
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

  <script>
    // Keep topbar clock alive regardless of admin.js clock implementation.
    if (typeof toggleClock !== 'function') { function toggleClock(){ /* noop */ } }

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

    /* =========================================================
       API ENDPOINTS (DB-driven)
       - search_files.php joins client_master for client_name
       - get_file.php returns mapped payload from operations_file_master + client_name
       ========================================================= */
    const API = {
      LIST_URL: '../../api/operation/transit_order/search_files.php',
      GET_URL:  '../../api/operation/transit_order/get_file.php',
    };

    function $(id){ return document.getElementById(id); }

    async function apiGet(url){
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        credentials: 'same-origin'
      });

      const text = await res.text();

      let json;
      try { json = JSON.parse(text); }
      catch (e) {
        throw new Error(`Non-JSON response (${res.status}). First 200 chars: ${text.slice(0,200)}`);
      }

      if (!res.ok || !json || json.ok !== true) {
        const msg = (json && (json.error || json.message)) ? (json.error || json.message) : `HTTP ${res.status}`;
        throw new Error(msg);
      }

      return json.data;
    }

    function debounce(fn, delay=250){
      let t;
      return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), delay);
      };
    }

    const LIST_CACHE = new Map();
    let CURRENT_REF = '';

    function setLoading(isLoading){
      const input = $('fileSearch');
      if (!input) return;
      input.dataset.loading = isLoading ? '1' : '0';
      input.style.opacity = isLoading ? '0.7' : '1';
    }

    function clearMappedFields(){
      $('inp-service').value = '';
      $('inp-bl').value = '';
      $('inp-desc').value = '';
      $('inp-weight').value = '';
      $('inp-marks').value = '';
      $('inp-client-name').value = '';

      $('p-ref').innerText = '---';
      $('p-bl').innerText  = '---';
    }

    function applyDetailsToUI(d){
      CURRENT_REF = d.ref || '';

      $('inp-service').value = d.service_type || '';
      $('inp-bl').value      = d.doc_no || '';

      $('p-ref').innerText = d.ref || '---';
      $('p-bl').innerText  = d.doc_no || '---';

      $('inp-desc').value  = d.desc || '';
      $('inp-marks').value = d.marks || '';

      let weightStr = String(d.weight || '').trim();
      const pkgsStr = String(d.pkgs || '').trim();
      if (pkgsStr) {
        const hasPkgsAlready = /pkg|pkgs|plt|plts|ctn|ctns|carton|cartons|pallet/i.test(weightStr);
        if (!hasPkgsAlready) {
          weightStr = weightStr ? `${weightStr} / ${pkgsStr} PKGS` : `${pkgsStr} PKGS`;
        }
      }
      $('inp-weight').value = weightStr;

      // client_name from client_master join
      $('inp-client-name').value = d.client || '';

      // Optional default for city/zone
      if ($('inp-client-city') && !String($('inp-client-city').value || '').trim()) {
        $('inp-client-city').value = String(d.delivery || d.pod || '').trim();
      }
    }

    async function fetchFileOptions(q){
      const dl = $('fileOptions');
      if (!dl) return;

      dl.innerHTML = '';
      LIST_CACHE.clear();

      setLoading(true);
      try {
        const url = `${API.LIST_URL}?q=${encodeURIComponent(q || '')}&limit=20`;
        const rows = await apiGet(url);

        rows.forEach(r => {
          const ref = String(r.operations_file_reference || '').trim();
          if (!ref) return;

          LIST_CACHE.set(ref, r);

          const client = String(r.client_name || '').trim();
          const docNo  = String(r.doc_no || '').trim();

          const opt = document.createElement('option');
          opt.value = ref; // important: deterministic selection
          opt.label = [ref, client, docNo].filter(Boolean).join('  •  ');
          dl.appendChild(opt);
        });
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    const debouncedFetchOptions = debounce((q) => fetchFileOptions(q), 250);

    async function loadFileFromSelection(){
      const input = $('fileSearch');
      if (!input) return;

      const ref = String(input.value || '').trim();

      if (!ref) {
        CURRENT_REF = '';
        clearMappedFields();
        return;
      }

      setLoading(true);
      try {
        const url = `${API.GET_URL}?ref=${encodeURIComponent(ref)}`;
        const data = await apiGet(url);
        applyDetailsToUI(data);
      } catch (err) {
        console.error(err);
        clearMappedFields();
        alert(`Could not load file (${ref}): ${err.message}`);
      } finally {
        setLoading(false);
      }
    }

    function wireSearchBox(){
      const input = $('fileSearch');
      if (!input) return;

      input.addEventListener('input', (e) => {
        const q = String(e.target.value || '').trim();
        debouncedFetchOptions(q);
      });

      input.addEventListener('change', async () => {
        await loadFileFromSelection();
      });

      fetchFileOptions('');
    }

    function generateDN() {
      $('p-dn-num').innerText = "SLAS-DN-" + String($('inp-dn-num').value || '').trim();

      const rawDate = $('inp-date').value;
      const d = rawDate ? new Date(rawDate) : new Date();
      const dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      $('p-date').innerText = dateStr;

      $('p-bl').innerText = $('inp-bl').value || '---';
      if (String($('p-ref').innerText || '').trim() === '---' && CURRENT_REF) $('p-ref').innerText = CURRENT_REF;

      $('p-client-name').innerText = $('inp-client-name').value || 'CLIENT';

      const addr    = $('inp-client-addr').value || '';
      const city    = $('inp-client-city').value || '';
      const contact = $('inp-client-contact').value || '';
      const phone   = $('inp-client-phone').value || '';

      const parts = [];
      if (addr || city) parts.push([addr, city].filter(Boolean).join(', '));
      if (contact) parts.push(`<strong>Attn:</strong> ${contact}`);
      if (phone) parts.push(`<strong>Tel:</strong> ${phone}`);

      $('p-client-details').innerHTML = parts.join(' | ') || 'Address...';

      $('p-desc').innerText   = $('inp-desc').value || '';
      $('p-marks').innerText  = $('inp-marks').value || '';
      $('p-weight').innerText = $('inp-weight').value || '';

      const useSig = $('chk-digital-sig').checked;
      const sigImg = $('p-sig-img');
      const sigDate = $('p-sig-date');

      if (useSig) {
        sigImg.style.display = "block";
        sigDate.innerText = dateStr;
      } else {
        sigImg.style.display = "none";
        sigDate.innerText = "";
      }

      const qrImg = $('p-qr-code');
      const dn = String($('inp-dn-num').value || '').trim();
      const qrData = `DN:${dn}|${dateStr}|REF:${CURRENT_REF || ''}`;
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(qrData)}`;

      qrImg.onload = function() { window.print(); };
      qrImg.src = qrUrl;
    }

    (function init(){
      const d = $('inp-date');
      if (d) d.valueAsDate = new Date();

      wireSearchBox();
      window.generateDN = generateDN;
    })();
  </script>

</body>
</html>
