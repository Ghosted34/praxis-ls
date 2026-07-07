<?php


require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN','MANAGEMENT','OPERATIONS','FINANCE']);


/**
 * Use the same "authoritative profile" pattern from management index.php
 */
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

$fullName  = trim((string)($me['full_name'] ?? 'User'));
$firstName = trim(explode(' ', $fullName)[0] ?? 'User');

$role = strtoupper((string)($me['role'] ?? ''));
$roleLabelMap = [
  'ADMIN'      => 'SYSTEM ADMIN',
  'FINANCE'    => 'FINANCE',
  'SALES'      => 'SALES',
  'OPERATIONS' => 'OPERATIONS',
  'MANAGEMENT' => 'MANAGEMENT',
  'LEAD'       => 'LEAD',
];
$roleLabel = $roleLabelMap[$role] ?? ($role !== '' ? $role : 'USER');

$jobTitle = trim((string)($me['job_title'] ?? ''));
$topRoleLabel = ($jobTitle !== '') ? strtoupper($jobTitle) : $roleLabel;

$avatarName = urlencode($fullName);
$avatarUrl  = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";

$hour = (int)date('H');
$greeting = ($hour < 12) ? 'Good morning' : (($hour < 18) ? 'Good afternoon' : 'Good evening');
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Costing Module | Smart LS</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  
  <style>
    :root{ --smart-blue:#1F99D8; --smart-dark:#055B83; --smart-orange:#EE7D04; --smart-charcoal:#231F20; --smart-bg:#F0F4F8; --sidebar-width:280px; }
    body{ font-family:'Manrope',sans-serif; background:var(--smart-bg); color:var(--smart-charcoal); overflow-x:hidden; }
    h1,h2,h3,h4,h5,h6{ font-family:'Montserrat',sans-serif; }

    /* --- STANDARD LAYOUT STYLES --- */
    .sidebar{ width:var(--sidebar-width); height:100vh; position:fixed; top:0; left:0; background:#fff; border-right:1px solid #e0e0e0; z-index:1000; display:flex; flex-direction:column; box-shadow:2px 0 10px rgba(0,0,0,0.02); }
    .sidebar-header{ height:70px; display:flex; align-items:center; padding:0 20px; border-bottom:1px solid #f0f0f0; }
    .brand-logo{ font-weight:800; font-size:1.1rem; color:var(--smart-charcoal); text-decoration:none; letter-spacing:-0.5px; }
    .sidebar-menu{ overflow-y:auto; flex-grow:1; padding:10px 0; }
    .menu-btn{ width:100%; text-align:left; background:none; border:none; padding:12px 20px; font-size:0.8rem; font-weight:700; color:#555; display:flex; justify-content:space-between; align-items:center; transition:all 0.2s; border-left:3px solid transparent; }
    .menu-btn:hover, .menu-btn[aria-expanded="true"]{ color:var(--smart-charcoal); background-color:#f0f7fa; border-left-color:var(--smart-charcoal); }
    .menu-btn i.category-icon{ width:20px; margin-right:8px; color:#888; transition:color 0.2s; }
    .menu-btn:hover i.category-icon{ color:var(--smart-charcoal); }
    .menu-chevron{ font-size:0.7rem; transition:transform 0.3s; }
    .menu-btn[aria-expanded="true"] .menu-chevron{ transform:rotate(180deg); }
    .sub-link{ display:block; padding:8px 20px 8px 48px; font-size:0.75rem; color:#666; text-decoration:none; font-weight:500; transition:all 0.2s; line-height:1.3; }
    .sub-link:hover{ color:var(--smart-orange); background-color:#fff9f2; }
    .sub-link.active{ color:var(--smart-orange); font-weight:800; background-color:#fff9f2; }
    .sidebar-footer{ border-top:1px solid #f0f0f0; padding:16px; }
    .main-content{ margin-left:var(--sidebar-width); padding-top:70px; min-height:100vh; width:calc(100% - var(--sidebar-width)); }
    .top-navbar{ height:70px; position:fixed; top:0; right:0; left:var(--sidebar-width); background:rgba(255,255,255,0.95); backdrop-filter:blur(12px); border-bottom:1px solid #e0e0e0; z-index:900; padding:0 30px; display:flex; align-items:center; justify-content:space-between; }
    .card-custom{ background:white; border-radius:12px; border:1px solid rgba(0,0,0,0.05); box-shadow:0 2px 12px rgba(0,0,0,0.02); height:100%; }
    .kpi-title{ font-size:0.7rem; font-weight:700; text-transform:uppercase; color:#888; letter-spacing:0.5px; white-space:nowrap; }
    .kpi-value{ font-size:1.6rem; font-weight:800; color:var(--smart-charcoal); line-height:1.2; font-variant-numeric:tabular-nums; }
    .table-custom th{ font-size:0.75rem; text-transform:uppercase; color:#888; font-weight:700; border-bottom:2px solid #f0f0f0; padding:12px; white-space:nowrap; }
    .table-custom td{ font-size:0.85rem; vertical-align:middle; padding:12px; }
    .status-pill{ font-size:0.65rem; font-weight:800; text-transform:uppercase; letter-spacing:0.5px; padding:5px 10px; border-radius:6px; white-space:nowrap; }
    .status-draft{ background:#e2e8f0; color:#475569; }
    .status-submitted-val{ background:#e0f2fe; color:#0369a1; }
    .status-submitted-app{ background:#ffedd5; color:#c2410c; }
    .status-approved{ background:#231F20; color:#fff; border:1px solid #000; }
    .status-rejected{ background:#fee2e2; color:#991b1b; }
    .smart-input{ border-radius:8px; font-size:0.9rem; padding:0.6rem 0.8rem; border-color:#dee2e6; }
    .smart-input:focus{ border-color:var(--smart-blue); box-shadow:0 0 0 3px rgba(31,153,216,0.1); }
    .clock-pill{ background:#f1f5f9; padding:6px 12px; border-radius:30px; display:flex; align-items:center; gap:10px; font-size:0.85rem; font-weight:600; color:var(--smart-dark); }
    .autocomplete-list { position: absolute; z-index: 1000; background: white; border: 1px solid #dee2e6; border-radius: 0 0 8px 8px; max-height: 200px; overflow-y: auto; width: 100%; box-shadow: 0 4px 6px rgba(0,0,0,0.1); list-style: none; padding: 0; margin: 0; }
    .autocomplete-item { padding: 8px 12px; cursor: pointer; font-size: 0.85rem; border-bottom: 1px solid #f0f0f0; }
    .autocomplete-item:hover { background-color: #f0f7fa; color: #1F99D8; }
    .autocomplete-item small { display: block; color: #888; font-size: 0.75rem; }

    /* --- REPORT STYLES (SCREEN) --- */
    #print-container { background-color: #525659; display: flex; flex-direction: column; align-items: center; gap: 20px; padding: 20px; min-height: 100vh; }
    
    .a4-page {
        background: white;
        width: 210mm;
        /* FIX: Use min-height so content is never cut off if it expands */
        min-height: 296mm; 
        padding: 10mm 15mm;
        position: relative;
        box-shadow: 0 0 15px rgba(0,0,0,0.5);
        display: flex;
        flex-direction: column;
        /* FIX: Allow overflow so we can see if content spills */
        overflow: visible; 
        font-family: 'Manrope', sans-serif;
        color: #231F20;
    }

    /* REPORT ELEMENTS */
    .print-header-grid { display: grid; grid-template-columns: 1.4fr 0.6fr 1fr; align-items: center; border-bottom: 3px solid #EE7D04; padding-bottom: 8px; margin-bottom: 10px; }
    .company-name { font-family: 'Montserrat', sans-serif; font-weight: 800; font-size: 0.9rem; line-height: 1.1; text-transform: uppercase; }
    .company-details { font-size: 0.6rem; color: #444; margin-top: 4px; line-height: 1.3; }
    .doc-title-box { text-align: center; }
    .doc-title { font-size: 1.8rem; font-weight: 800; letter-spacing: -1px; line-height: 1; margin-bottom: 2px; }
    .status-badge-print { font-size: 0.5rem; border: 1px solid #ddd; color: #555; background: #f9f9f9; padding: 1px 5px; text-transform: uppercase; font-weight: bold; display: inline-block; letter-spacing: 0.5px; }
    .print-logo { height: 50px; width: auto; display: block; margin-left: auto; }
    .meta-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; background: #f8f9fa; padding: 6px 8px; border-left: 4px solid #1F99D8; margin-bottom: 10px; }
    .meta-box label { display: block; font-size: 0.5rem; text-transform: uppercase; color: #666; font-weight: 700; margin-bottom: 0; }
    .meta-box div { font-size: 0.7rem; font-weight: 800; color: #000; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .shipment-container { border: 1px solid #e0e0e0; padding: 8px; margin-bottom: 15px; border-radius: 4px; }
    .ship-title { font-size: 0.6rem; font-weight: 800; text-transform: uppercase; color: #EE7D04; border-bottom: 1px solid #eee; margin-bottom: 5px; padding-bottom: 2px; }
    .shipment-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 15px; }
    .ship-item { font-size: 0.65rem; display: flex; flex-direction: column; }
    .ship-label { font-weight: 700; color: #666; font-size: 0.55rem; text-transform: uppercase; }
    .ship-val { font-weight: 800; color: #000; }
    .print-table { width: 100%; border-collapse: collapse; font-size: 0.7rem; margin-bottom: 0; }
    .print-table th { background: #EE7D04; color: white; text-transform: uppercase; font-weight: 800; padding: 6px 4px; text-align: left; font-size: 0.6rem; }
    .print-table td { border-bottom: 1px solid #eee; padding: 6px 4px; vertical-align: top; }
    .print-table tr:nth-child(even) { background-color: #fcfcfc; }
    .totals-section { display: flex; gap: 20px; margin-top: 15px; border-top: 2px solid #000; padding-top: 10px; page-break-inside: avoid; }
    .words-box { flex: 2; background: #f4f4f4; padding: 8px; font-size: 0.7rem; font-style: italic; border-radius: 4px; }
    .sums-box { flex: 1; font-size: 0.8rem; }
    .sum-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
    .sum-total { font-weight: 900; color: #EE7D04; font-size: 0.9rem; border-top: 1px dashed #ccc; padding-top: 4px; margin-top: 4px; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; margin-top: 20px; page-break-inside: avoid; }
    .sig-box { border: 1px solid #ccc; height: 150px; padding: 5px; position: relative; }
    /* REPLACE THE ENTIRE .sig-title BLOCK WITH THIS */
    .sig-title {
        font-size: 0.6rem;
        text-transform: uppercase;
        font-weight: 800;
        color: #888;

        /* 1. Center the titles */
        text-align: center;

        /* 2. KILL THE LINE */
        border-bottom: none !important; /* Added !important just to be absolutely sure nothing overrides it */

        /* 3. Set exact 4px spacing */
        margin-bottom: 4px;
        padding-bottom: 0;
    }
    .page-footer { margin-top: auto; border-top: 1px solid #EE7D04; padding-top: 5px; font-size: 0.6rem; color: #777; display: flex; justify-content: space-between; }

    /* --- THE FIX: NATIVE PRINT CSS --- */
    @media print {
  @page { size: A4; margin: 0; }

  /* 1) Hide everything except #print-root */
  body > *:not(#print-root) {
    display: none !important;
    visibility: hidden !important;
  }

  /* 2) Reset html/body so printing isn't clipped */
  html, body {
    height: auto !important;
    min-height: 0 !important;
    overflow: visible !important;
    background: #fff !important;
    margin: 0 !important;
    padding: 0 !important;
  }

  /* 3) Force #print-root visible no matter what admin.css/bootstrap does */
  #print-root {
    display: block !important;
    visibility: visible !important;
    opacity: 1 !important;

    position: absolute !important;
    top: 0 !important;
    left: 0 !important;

    width: 100% !important;
    height: auto !important;
    overflow: visible !important;

    z-index: 2147483647 !important;
  }

  #print-root, #print-root * {
    visibility: visible !important;
    opacity: 1 !important;
  }

  /* 4) Ensure wrapper exists and behaves normally (no flex centering issues) */
  #print-container {
    width: 100% !important;
    padding: 0 !important;
    margin: 0 !important;
    display: block !important;
    background: #fff !important;
  }

  /* 5) Page sizing */
  .a4-page {
    width: 210mm !important;
    min-height: 296mm !important;
    height: auto !important;

    margin: 0 !important;
    box-shadow: none !important;
    border: none !important;

    page-break-after: always !important;
    break-after: page !important;

    overflow: visible !important;
  }

  .a4-page:last-child {
    page-break-after: auto !important;
    break-after: auto !important;
  }

  /* 6) Force colors */
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
}

</style>
</head>

<body>

 <nav class="sidebar">
    <div class="sidebar-header">
        <a href="index" class="brand-logo"><i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span></a>
    </div>

    <div class="px-3 mb-2 mt-2">
        <a href="index" class="btn btn-primary w-100 text-start d-flex align-items-center" style="background-color: transparent; color: inherit; border: none; padding-left: 0;">
            <i class="fa-solid fa-house category-icon me-2"></i> 
            <span class="fw-bold">Management Dashboard</span> 
        </a>
    </div>

    <div class="sidebar-menu accordion" id="mgmtMenu">
        
        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#mgmt1">
                <span><i class="fa-solid fa-database category-icon"></i> MASTER DATA MGMT</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="mgmt1" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
                <div class="sub-menu">
                    <a href="client-master-registry.php" class="sub-link">Client Master Registry</a>
                    <a href="supplier-master-registry.php" class="sub-link">Supplier Master Registry</a>
                    <a href="employee-master.php" class="sub-link">Employee Master Registry</a>
                    <a href="financial-dictionary.php" class="sub-link">Financial Dictionary</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#mgmt2">
                <span><i class="fa-solid fa-users category-icon"></i>CRM & ACQUISITION</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="mgmt2" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
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
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#mgmt3">
                <span><i class="fa-solid fa-calculator category-icon"></i>COMMERCIAL & PRICING</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="mgmt3" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
                <div class="sub-menu">
                    <a href="margin-simulator-billing.php" class="sub-link">Margin Simulator & Pricing System</a>
                    <a href="extra-charges-simulator.php" class="sub-link">Extra Charges Simulator</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#mgmt4">
                <span><i class="fa-solid fa-truck-fast category-icon"></i>LOGISTICS OPERATIONS</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="mgmt4" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
                <div class="sub-menu">
                    <a href="operations-registry.php" class="sub-link">Operations File Registry</a>
                    <a href="transit-order.php" class="sub-link">Transit Order (OT)</a>
                    <a href="operational-milestone-tracking.php" class="sub-link">Operational Milestone Tracking</a>
                    <a href="delivery-note.php" class="sub-link">Delivery Note</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#mgmt5">
                <span><i class="fa-solid fa-chart-line category-icon"></i>JOB COST CONTROL</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="mgmt5" class="accordion-collapse collapse show" data-bs-parent="#mgmtMenu">
                <div class="sub-menu">
                    <a href="costing-module.php" class="sub-link active">Costing Module</a>
                    <a href="cost-tracking.php" class="sub-link">Cost Tracking Master</a>
                    <a href="operational-cost-reconciliation.php" class="sub-link">Operational Cost Reconciliation</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#mgmt6">
                <span><i class="fa-solid fa-building-columns category-icon"></i>FINANCE & TREASURY</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="mgmt6" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
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
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#mgmt7">
                <span><i class="fa-solid fa-folder-open category-icon"></i>HR & ARCHIVE</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="mgmt7" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
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
      <h5 class="mb-0 fw-bold text-dark">Costing Management</h5>
      <small class="text-muted" style="font-size: 0.7rem;">Pre-Quotation Analysis</small>
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
        <h2 class="fw-bold mb-0">Costing Registry</h2>
        <p class="text-muted mb-0 small">Create, validate and approve internal cost estimates.</p>
      </div>
      <div class="col-md-6 text-end">
        <button class="btn btn-dark fw-bold px-4 py-2 shadow-sm d-none" onclick="openCostingOffcanvas('new')">
          <i class="fa-solid fa-plus me-2"></i>New Costing
        </button>
      </div>
    </div>

    <div class="row g-3 mb-4">
      <div class="col-md-3">
        <div class="card-custom p-3">
          <div class="kpi-title">Costings (MTD)</div>
          <div class="kpi-value" id="kpi-mtd">-</div>
          <small class="text-muted" style="font-size:0.75rem;">From DB</small>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card-custom p-3">
          <div class="kpi-title">Pending Validation</div>
          <div class="kpi-value text-primary" id="kpi-val">-</div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card-custom p-3">
          <div class="kpi-title">Pending Approval</div>
          <div class="kpi-value text-warning" id="kpi-app">-</div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card-custom p-3">
          <div class="kpi-title">Total TTC (MTD)</div>
          <div class="kpi-value" id="kpi-ttc">-</div>
        </div>
      </div>
    </div>

    <div class="card-custom p-0 overflow-hidden">
      <div class="p-3 border-bottom bg-light d-flex justify-content-between align-items-center flex-wrap gap-2">
        <div class="btn-group" role="group">
          <button type="button" class="btn btn-sm btn-outline-secondary fw-bold active" data-status="ALL">All</button>
          <button type="button" class="btn btn-sm btn-outline-secondary fw-bold" data-status="DRAFT">Draft</button>
          <button type="button" class="btn btn-sm btn-outline-primary fw-bold" data-status="SUBMITTED_FOR_VALIDATION">To Validate</button>
          <button type="button" class="btn btn-sm btn-outline-warning text-dark fw-bold" data-status="SUBMITTED_FOR_APPROVAL">To Approve</button>
          <button type="button" class="btn btn-sm btn-outline-dark fw-bold" data-status="APPROVED_LOCKED">Locked</button>
          <button type="button" class="btn btn-sm btn-outline-danger fw-bold" data-status="REJECTED">Rejected</button>
        </div>
        
        <div class="input-group input-group-sm me-2" style="width: 140px;">
    <span class="input-group-text bg-white border-end-0 text-muted"><i class="fa-regular fa-calendar"></i></span>
    <select class="form-select border-start-0 ps-0 fw-bold text-dark" id="periodFilter" style="font-size: 0.85rem;">
        <option value="this_month" selected>This Month</option>
        <option value="last_month">Last Month</option>
        <option value="this_quarter">This Quarter</option>
        <option value="this_year">This Year</option>
        <option value="all_time">All Time</option>
    </select>
</div>
        <div class="input-group input-group-sm" style="width: 280px;">
          <span class="input-group-text bg-white border-end-0"><i class="fa-solid fa-search text-muted"></i></span>
          <input type="text" class="form-control border-start-0 ps-0 smart-input" placeholder="Search Costing #, Client..." id="searchInput">
        </div>
      </div>

      <div class="table-responsive">
        <table class="table table-hover table-custom mb-0 align-middle">
          <thead class="bg-light">
            <tr>
              <th class="ps-4">Costing #</th>
              <th>Date</th>
              <th>File Ref</th>
              <th>Client</th>
              <th class="text-end">Total TTC</th>
              <th>Status</th>
              <th class="text-end pe-4">Action</th>
            </tr>
          </thead>
          <tbody id="table-body"></tbody>
        </table>
      </div>

      <div class="p-2 border-top bg-light d-flex justify-content-end">
        <nav>
          <ul class="pagination pagination-sm mb-0" id="pager"></ul>
        </nav>
      </div>
    </div>

  </div>

  <div class="offcanvas offcanvas-end" tabindex="-1" id="costingOffcanvas" style="width: 95vw; max-width: 1400px;">
    <div class="offcanvas-header border-bottom bg-light py-2">
      <div class="d-flex align-items-center gap-3">
        <div>
          <h5 class="offcanvas-title fw-bold" id="offcanvasTitle">New Costing Worksheet</h5>
          <div class="d-flex align-items-center gap-2">
            <span id="costing-status-badge" class="badge bg-secondary">DRAFT</span>
            <small class="text-muted" id="costing-ref-display">SLAS-COST-####</small>
          </div>
        </div>

        <div class="d-flex align-items-center gap-2 ms-4 border-start ps-4">
            <div class="btn-group btn-group-sm">
                <input type="radio" class="btn-check" name="lang" id="lang-en" checked>
                <label class="btn btn-outline-secondary fw-bold" for="lang-en">EN</label>
                <input type="radio" class="btn-check" name="lang" id="lang-fr">
                <label class="btn btn-outline-secondary fw-bold" for="lang-fr">FR</label>
            </div>

          <div class="input-group input-group-sm ms-2" style="width: 190px;">
            <span class="input-group-text fw-bold">Curr</span>
            <select class="form-select fw-bold text-primary" id="currency-selector">
              <option value="XAF" selected>XAF</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </div>

          <div class="input-group input-group-sm ms-2" style="width: 220px;">
            <span class="input-group-text fw-bold">Rate</span>
            <input class="form-control fw-bold bg-light" id="exchange-rate" value="1.00" inputmode="decimal" readonly>
            <button class="btn btn-dark fw-bold" type="button" id="btn-convert" onclick="applyConversion()" title="Apply Conversion">
                <i class="fa-solid fa-calculator me-1"></i>Conv.
            </button>
          </div>

          <button class="btn btn-sm btn-outline-dark fw-bold ms-2" onclick="generatePreview()">
            <i class="fa-solid fa-print me-2"></i>Print / Preview
          </button>
        </div>
      </div>
      <button type="button" class="btn-close" data-bs-dismiss="offcanvas"></button>
    </div>

    <div class="offcanvas-body p-0 bg-white d-flex flex-column overflow-hidden">
      <div id="redirect-alert-box"></div>

      <form id="costingForm" class="h-100 d-flex flex-column" onsubmit="event.preventDefault();">

        <div class="border-bottom bg-light px-3 py-2 flex-shrink-0">
          <div class="row align-items-center g-2">
             <div class="col-md-4 position-relative">
                <div class="input-group input-group-sm">
                    <span class="input-group-text bg-white"><i class="fa-solid fa-link text-primary"></i></span>
                    <input type="text" id="ops-search-input" class="form-control fw-bold" placeholder="Search Client or File Ref..." autocomplete="off">
                    <input type="hidden" id="link-file-ref"> </div>
                <ul class="autocomplete-list d-none" id="ops-search-list" style="top: 100%;"></ul>
             </div>

             <div class="col-md-2">
                <input type="date" id="costing-date" class="form-control form-control-sm fw-bold">
             </div>

             <div class="col-md-6">
                <div class="d-flex align-items-center justify-content-between bg-white border rounded px-2 py-1 shadow-sm" style="height: 31px;">
                    <div class="d-flex gap-3 small text-truncate">
                        <span class="fw-bold text-dark" id="ssdc-client">-</span>
                        <span class="text-muted border-start ps-2" id="ssdc-service">-</span>
                        <span class="text-muted border-start ps-2" id="ssdc-transport">-</span>
                    </div>
                    <a href="#ssdc-hidden" data-bs-toggle="collapse" class="text-decoration-none" style="font-size: 0.7rem;">
                        <i class="fa-solid fa-circle-info"></i>
                    </a>
                </div>
             </div>
          </div>

          <div class="collapse mt-2" id="ssdc-hidden">
             <div class="card card-body bg-white border shadow-sm p-2 small">
                <div class="row g-2">
                    <div class="col-md-2"><span class="text-muted d-block" style="font-size:0.65rem">Route</span><strong id="ssdc-route">-</strong></div>
                    <div class="col-md-2"><span class="text-muted d-block" style="font-size:0.65rem">ETA</span><strong id="ssdc-eta">-</strong></div>
                    <div class="col-md-2"><span class="text-muted d-block" style="font-size:0.65rem">Conveyance</span><strong id="ssdc-conveyance">-</strong></div>
                    <div class="col-md-2"><span class="text-muted d-block" style="font-size:0.65rem">Weight</span><strong id="ssdc-weight">-</strong></div>
                    <div class="col-md-2"><span class="text-muted d-block" style="font-size:0.65rem">Packages</span><strong id="ssdc-packages">-</strong></div>
                    <div class="col-md-2"><span class="text-muted d-block" style="font-size:0.65rem">Commodity</span><strong id="ssdc-commodity">-</strong></div>
                    <div class="col-md-2"><span class="text-muted d-block" style="font-size:0.65rem">Del. Place</span><strong id="ssdc-delivery">-</strong></div>
                    <div class="col-md-4"><span class="text-muted d-block" style="font-size:0.65rem">Marks</span><strong id="ssdc-marks">-</strong></div>
                </div>
             </div>
          </div>
        </div>

        <div class="flex-grow-1 overflow-auto p-0 bg-white">
          
          <div class="w-100" style="overflow: visible;">
            
            <table class="table table-sm table-hover mb-0 align-middle border-bottom" id="costing-table" style="margin-bottom: 150px;">
              <thead class="bg-light text-secondary small text-uppercase sticky-top" style="z-index: 5;">
                <tr>
                  <th style="width: 40px;" class="text-center">#</th>
                  <th style="width: 100px;">Code</th>
                  <th>Description</th>
                  <th style="width: 90px;">Qty</th>
                  <th style="width: 130px;" class="text-end">Unit Cost</th>
                  <th style="width: 140px;" class="text-end">Total HT</th>
                  <th style="width: 60px;" class="text-center">VAT</th>
                  <th style="width: 140px;" class="text-end fw-bold">Total TTC</th>
                  <th style="width: 40px;"></th>
                </tr>
              </thead>
              <tbody id="lines-body"></tbody>
            </table>
          </div>
          
          <div class="py-1 border-bottom bg-light bg-opacity-25 text-center">
             <button type="button" class="btn btn-sm btn-outline-dark fw-bold rounded-pill px-4" onclick="addLine()">
                <i class="fa-solid fa-plus me-1"></i> Add Item Line
             </button>
             <button type="button" class="btn btn-sm btn-outline-primary fw-bold rounded-pill px-4 ms-2" onclick="suggestLines()">
                <i class="fa-solid fa-wand-magic-sparkles me-1"></i> Suggest
             </button>
          </div>

          <div class="p-3 bg-light bg-opacity-10">
            <div class="row">
                <div class="col-md-6">
                    <label class="form-label fw-bold small text-uppercase text-muted">Remarks / Notes</label>
                    <textarea id="costing-remarks" class="form-control smart-input" rows="2" placeholder="Internal or external notes..."></textarea>
                </div>
                <div class="col-md-6">
                    <table class="table table-sm table-borderless small mb-0">
                        <tr><td class="text-end text-muted">Subtotal (HT):</td><td class="text-end font-monospace fw-bold" id="grand-ht">0.00</td></tr>
                        <tr><td class="text-end text-muted">VAT:</td><td class="text-end font-monospace fw-bold" id="grand-vat">0.00</td></tr>
                        <tr class="border-top"><td class="text-end text-dark fw-black fs-6">TOTAL ESTIMATE:</td><td class="text-end font-monospace fw-black fs-6 text-primary" id="grand-ttc">0.00</td></tr>
                    </table>
                </div>
            </div>
          </div>
        </div>

        <div class="px-3 py-2 border-top bg-white d-flex justify-content-between align-items-center shadow-lg flex-shrink-0" style="z-index: 10;">
          <div class="d-flex align-items-center gap-2" style="max-width: 40%;">
            <span class="small fw-bold text-muted text-uppercase">Validator:</span>
            <select id="validator-employee-id" class="form-select form-select-sm fw-bold border-secondary" required></select>
          </div>

          <div class="d-flex align-items-center gap-3">
             <small class="text-muted fst-italic" id="save-status">Not saved</small>
             <div class="vr"></div>
             <div class="d-flex gap-2" id="action-buttons">
                </div>
          </div>
        </div>

      </form>
    </div>
  </div>

  <div class="modal fade" id="printModal" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog modal-xl">
      <div class="modal-content bg-light">
        <div class="modal-header border-0 pb-0">
          <h5 class="modal-title fw-bold text-secondary">
            <i class="fa-solid fa-eye me-2"></i>Print Preview
          </h5>
          <div class="d-flex gap-2">
            <button type="button" class="btn btn-outline-secondary btn-sm fw-bold" data-bs-dismiss="modal">Close</button>
            <button type="button" class="btn btn-dark btn-sm fw-bold" onclick="printCostingNow()">
  <i class="fa-solid fa-print me-2"></i>Print Costing
</button>
          </div>
        </div>
        <div class="modal-body p-0">
          <div id="print-container" class="p-3"></div>
        </div>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

  <script>
    // Clock
    function tickClock(){
      const el = document.getElementById('realtime-clock');
      if (!el) return;
      const now = new Date();
      const hh = String(now.getHours()).padStart(2,'0');
      const mm = String(now.getMinutes()).padStart(2,'0');
      const ss = String(now.getSeconds()).padStart(2,'0');
      el.textContent = `${hh}:${mm}:${ss}`;
    }
    setInterval(tickClock, 1000); tickClock();

    // ---- State ----
    const state = {
      page: 1,
      pageSize: 10,
      status: 'ALL',
      period: 'this_month', // <--- ADD THIS
      q: '',
      currentCostingId: null,
      currentCostingRef: null,
      currentStatus: 'DRAFT',
      vatRate: 0.1925
    };
    window.AUTH_ROLE = <?php echo json_encode($role); ?>;

    const statusConfig = {
      'DRAFT': { cls: 'status-draft', label: 'Draft' },
      'SUBMITTED_FOR_VALIDATION': { cls: 'status-submitted-val', label: 'To Validate' },
      'SUBMITTED_FOR_APPROVAL': { cls: 'status-submitted-app', label: 'To Approve' },
      'APPROVED_LOCKED': { cls: 'status-approved', label: 'Locked' },
      'REJECTED': { cls: 'status-rejected', label: 'Rejected' }
    };

    const bsOffcanvas = new bootstrap.Offcanvas(document.getElementById('costingOffcanvas'));

    function valOrDash(v){
      const s = (v ?? '').toString().trim();
      return s === '' ? '-' : s;
    }

    function serviceLabel(raw){
      const s = (raw ?? '').toString().trim();
      return s ? s.replaceAll('_',' ') : '-';
    }

    function detectServiceGroup(serviceTypeRaw=''){
      const s = String(serviceTypeRaw).toUpperCase();
      if (s.includes('SEA')) return 'SEA';
      if (s.includes('AIR')) return 'AIR';
      if (s.includes('INLAND') || s.includes('HINTERLAND') || s.includes('TRANSPORT') || s.includes('TRANSIT')) return 'TRANSPORT';
      if (s.includes('WAREHOUS')) return 'WAREHOUSE';
      if (s.includes('BUSINESS_REP') || s.includes('REPRESENTATION')) return 'BUSINESS_REP';
      return 'ALL';
    }

    function smartRoute(d, group){
      if (group === 'SEA') {
        const pol = valOrDash(d.sea_pol);
        const pod = valOrDash(d.sea_pod);
        return (pol === '-' && pod === '-') ? '-' : `${pol} → ${pod}`;
      }
      if (group === 'AIR') {
        const o = valOrDash(d.air_origin);
        const dest = valOrDash(d.air_dest);
        return (o === '-' && dest === '-') ? '-' : `${o} → ${dest}`;
      }
      if (group === 'TRANSPORT') return valOrDash(d.inland_border);
      return '-';
    }

    function smartTransportRef(d, group){
      if (group === 'SEA') return valOrDash(d.sea_bl);
      if (group === 'AIR') return valOrDash(d.air_mawb);
      if (group === 'TRANSPORT') return valOrDash(d.inland_truck);
      return '-';
    }

    function smartConveyance(d, group){
      if (group === 'SEA') {
        const vessel = valOrDash(d.sea_vessel);
        const voyage = valOrDash(d.sea_voyage);
        if (vessel === '-' && voyage === '-') return '-';
        if (voyage === '-') return vessel;
        if (vessel === '-') return `Voyage ${voyage}`;
        return `${vessel} / ${voyage}`;
      }
      if (group === 'AIR') {
        const airline = valOrDash(d.air_airline);
        const flight = valOrDash(d.air_flightno);
        if (airline === '-' && flight === '-') return '-';
        if (flight === '-') return airline;
        if (airline === '-') return `Flight ${flight}`;
        return `${airline} / ${flight}`;
      }
      if (group === 'TRANSPORT') return 'Road Transit';
      return '-';
    }

    function smartEtaArrival(d){
      // prefer ATA if present, fallback ETA
      return valOrDash(d.ata) !== '-' ? valOrDash(d.ata) : valOrDash(d.eta);
    }

    function setCompactSSDC(d){
      const group = detectServiceGroup(d.service_type);

      document.getElementById('ssdc-client').innerText = valOrDash(d.client_name);
      document.getElementById('ssdc-service').innerText = serviceLabel(d.service_type);

      // warehouse/business_rep keep minimal
      if (group === 'WAREHOUSE' || group === 'BUSINESS_REP') return;

      document.getElementById('ssdc-transport').innerText = smartTransportRef(d, group);
      document.getElementById('ssdc-route').innerText = smartRoute(d, group);
      document.getElementById('ssdc-eta').innerText = smartEtaArrival(d);
      document.getElementById('ssdc-conveyance').innerText = smartConveyance(d, group);

      const w = `${valOrDash(d.gross_weight)} ${valOrDash(d.weight_unit)}`.trim();
      document.getElementById('ssdc-weight').innerText = (w === '-' ? '-' : w);

      document.getElementById('ssdc-packages').innerText = valOrDash(d.package_count);
      document.getElementById('ssdc-delivery').innerText = valOrDash(d.place_delivery);
      document.getElementById('ssdc-commodity').innerText = valOrDash(d.commodity);
      document.getElementById('ssdc-marks').innerText = valOrDash(d.marks_numbers);
    }

    function clearSSDC(){
      ['ssdc-client','ssdc-service','ssdc-transport','ssdc-route','ssdc-eta','ssdc-conveyance','ssdc-weight','ssdc-packages','ssdc-delivery','ssdc-commodity','ssdc-marks']
        .forEach(id => { const el = document.getElementById(id); if (el) el.innerText='-'; });
    }

    async function apiGet(url){
      const res = await fetch(url, { credentials: 'same-origin' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.ok) throw new Error((data && (data.error || data.message)) || 'Request failed');
      return data;
    }

    async function apiPost(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    credentials: 'same-origin'
  });

  // Always read raw response first
  const raw = await res.text();
  let data = null;

  try {
    data = JSON.parse(raw);
  } catch (e) {
    // Not JSON (likely PHP error or redirect)
  }

  if (!res.ok || !data || data.ok !== true) {
    console.error('API POST FAILED', {
      url,
      status: res.status,
      statusText: res.statusText,
      rawResponse: raw,
      parsed: data
    });

    const msg =
      (data && (data.error || data.message)) ||
      `HTTP ${res.status} ${res.statusText}`;

    throw new Error(msg);
  }

  return data;
}


    // ---- Registry ----
        async function loadRegistry(){
      // 1. Pass the period to the API
      const url = `../../api/costing/list.php?page=${state.page}&pageSize=${state.pageSize}&status=${encodeURIComponent(state.status)}&q=${encodeURIComponent(state.q)}&period=${encodeURIComponent(state.period)}`;
      
      const data = await apiGet(url);
    
      // 2. Render Table (Same as before)
      const tbody = document.getElementById('table-body');
      tbody.innerHTML = (data.items || []).map(r => {
        const meta = statusConfig[r.status] || { cls:'status-draft', label:r.status };
        const ttc = Number(r.total_ttc || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        
        return `
          <tr onclick="openCostingOffcanvasById('${r.costing_id}')">
            <td class="ps-4"><span class="font-monospace fw-bold text-dark small bg-light border px-2 py-1 rounded">${r.costing_ref}</span></td>
            <td class="small text-muted">${r.costing_date}</td>
            <td class="font-monospace small text-primary">${r.operations_file_reference}</td>
            <td class="fw-bold text-dark" style="font-size:0.85rem">${r.client_name_cached}</td>
            <td class="text-end fw-bold font-monospace">${ttc} ${r.currency}</td>
            <td><span class="status-pill ${meta.cls}">${meta.label}</span></td>
            <td class="text-end pe-4">
               <button class="btn btn-sm btn-outline-dark fw-bold" onclick="event.stopPropagation(); openCostingOffcanvasById('${r.costing_id}')">
                 <i class="fa-solid fa-eye me-1"></i> View
               </button>
            </td>
          </tr>
        `;
      }).join('');
    
      renderPager(data.meta.page, data.meta.totalPages); // Note: data.meta.page now
    
      // 3. KEY UPDATE: Render KPIs from Backend Data
      // We no longer calculate in JS. We trust the Shadow Query.
      if (data.meta && data.meta.kpi) {
          const kpi = data.meta.kpi;
          
          // Count
          document.getElementById('kpi-mtd').innerText = kpi.count_mtd;
          
          // Status Counts
          document.getElementById('kpi-val').innerText = kpi.count_val;
          document.getElementById('kpi-app').innerText = kpi.count_app;
          
          // Total Money (Already Normalized to XAF by SQL)
          const totalXAF = Number(kpi.total_ttc_xaf || 0);
          
          // Dynamic Label based on period
          let label = "Total (MTD)";
          if(state.period === 'this_quarter') label = "Total (QTD)";
          if(state.period === 'this_year') label = "Total (YTD)";
          if(state.period === 'all_time') label = "Total (All)";
          
          // Update Label (You might need to add an ID to the KPI title HTML to target it, e.g. id="kpi-ttc-label")
          // document.getElementById('kpi-ttc-label').innerText = label; 
    
          document.getElementById('kpi-ttc').innerText = totalXAF.toLocaleString('en-US', { 
              minimumFractionDigits: 0, // XAF usually doesn't need decimals, but kept optional
              maximumFractionDigits: 0 
          }) + " XAF";
      }
    }

    function renderPager(page, totalPages){
      const ul = document.getElementById('pager');
      if (!ul) return;

      const safeTotal = Math.max(1, totalPages || 1);

      const prevDisabled = page <= 1 ? 'disabled' : '';
      const nextDisabled = page >= safeTotal ? 'disabled' : '';

      ul.innerHTML = `
        <li class="page-item ${prevDisabled}">
          <a class="page-link" href="#" onclick="event.preventDefault(); if(${page}>1){ state.page=${page}-1; loadRegistry(); }">Prev</a>
        </li>
        ${Array.from({length: safeTotal}).slice(0, 7).map((_,i)=>{
          const p = i+1;
          const active = p===page ? 'active' : '';
          return `<li class="page-item ${active}">
            <a class="page-link ${active ? 'bg-dark border-dark' : 'text-dark'}" href="#" onclick="event.preventDefault(); state.page=${p}; loadRegistry();">${p}</a>
          </li>`;
        }).join('')}
        <li class="page-item ${nextDisabled}">
          <a class="page-link" href="#" onclick="event.preventDefault(); if(${page}<${safeTotal}){ state.page=${page}+1; loadRegistry(); }">Next</a>
        </li>
      `;
    }

    // ---- Ops dropdown + SSDC ----
    async function loadOpsDropdown(){
      const sel = document.getElementById('link-file-ref');
      sel.innerHTML = `<option value="">Select File Ref...</option>`;
      const data = await apiGet(`../../api/costing/ops-files.php?limit=25`);
      (data.items || []).forEach(it => {
        const opt = document.createElement('option');
        opt.value = it.operations_file_reference;
        opt.textContent = `${it.operations_file_reference} (${it.client_name})`;
        sel.appendChild(opt);
      });

      sel.addEventListener('change', async () => {
        const ref = sel.value;
        clearSSDC();
        if (!ref) return;
        const d = await apiGet(`../../api/costing/ops-file-details.php?ref=${encodeURIComponent(ref)}`);
        setCompactSSDC(d.item);
      });
    }
    
    // --- PATCH: Operations File Search Logic ---
    // --- PATCH: Operations File Search with "Redirect" Logic ---
    let opsSearchTimeout = null;

    document.getElementById('ops-search-input').addEventListener('keyup', function(e) {
        const query = this.value.trim();
        const list = document.getElementById('ops-search-list');
        const hiddenId = document.getElementById('link-file-ref');

        if(e.key !== 'Enter') hiddenId.value = ''; // Reset if typing
        
        // Hide alert if user starts typing again
        document.getElementById('redirect-alert-box').innerHTML = '';

        clearTimeout(opsSearchTimeout);

        if (query.length < 2) {
            list.classList.add('d-none');
            return;
        }

        opsSearchTimeout = setTimeout(async () => {
            try {
                // 1. Fetch Ops Files from API
                const data = await apiGet(`../../api/costing/ops-files.php?limit=100`);
                const items = data.items || [];
                
                const matches = items.filter(i => 
                    i.client_name.toLowerCase().includes(query.toLowerCase()) || 
                    i.operations_file_reference.toLowerCase().includes(query.toLowerCase())
                ).slice(0, 10);

                list.innerHTML = '';
                
                if (matches.length === 0) {
                    list.innerHTML = '<li class="autocomplete-item text-muted fst-italic">No matches found</li>';
                } else {
                    matches.forEach(item => {
                        const li = document.createElement('li');
                        li.className = 'autocomplete-item';
                        li.innerHTML = `
                            <div class="d-flex justify-content-between">
                                <span class="fw-bold text-primary">${item.operations_file_reference}</span>
                                <small class="text-muted">${item.file_date || ''}</small>
                            </div>
                            <div class="small fw-bold text-dark">${item.client_name}</div>
                            <div class="text-muted" style="font-size:0.7rem">${serviceLabel(item.service_type)}</div>
                        `;
                        
                        // --- THE SMART REDIRECT CLICK HANDLER ---
                        li.onclick = async () => {
                            list.classList.add('d-none'); // Hide list immediately

                            // A. Check if this file ALREADY has a costing
                            // We query the registry for this exact reference
                            const check = await apiGet(`../../api/costing/list.php?q=${encodeURIComponent(item.operations_file_reference)}`);
                            
                            // Look for exact match in results
                            const existing = (check.items || []).find(x => x.operations_file_reference === item.operations_file_reference);

                            if (existing) {
                                // B. FOUND! Redirect Workflow
                                await openCostingOffcanvasById(existing.costing_id);
                                
                                // Show the Alert
                                const alertBox = document.getElementById('redirect-alert-box');
                                alertBox.innerHTML = `
                                    <div class="alert alert-warning border-0 rounded-0 mb-0 d-flex align-items-center" role="alert">
                                        <i class="fa-solid fa-triangle-exclamation me-3 fs-4"></i>
                                        <div>
                                            <div class="fw-bold">Existing Costing Loaded</div>
                                            <div class="small">
                                                A costing for <strong>${item.operations_file_reference}</strong> already exists. We have loaded it for you.<br>
                                                Current Status: <span class="badge bg-dark">${existing.status}</span>. 
                                                ${existing.status === 'APPROVED_LOCKED' ? "If you need to make changes, please use the <strong>'Request Edit'</strong> button below." : ""}
                                            </div>
                                        </div>
                                        <button type="button" class="btn-close ms-auto" data-bs-dismiss="alert"></button>
                                    </div>
                                `;

                                // PATCH: Fix Layout & Auto-Scroll
                                // 1. Allow the container to scroll vertically
                                const offcanvasBody = document.querySelector('.offcanvas-body');
                                offcanvasBody.classList.remove('overflow-hidden');
                                offcanvasBody.classList.add('overflow-auto');

                                // 2. Remove fixed height from form so it doesn't clip
                                document.getElementById('costingForm').classList.remove('h-100');

                                // 3. Smooth scroll down to the buttons
                                setTimeout(() => {
                                    const btnRow = document.getElementById('action-buttons');
                                    if(btnRow) btnRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                }, 400);

                                return; // STOP HERE.
                            }

                            // C. NOT FOUND (New Workflow)
                            // 1. Fill Input
                            document.getElementById('ops-search-input').value = `${item.operations_file_reference} - ${item.client_name}`;
                            // 2. ops file dropdown
                          document.getElementById('link-file-ref').value = item.operations_file_reference;
                          
                          // PATCH: Display ONLY the reference in the search box
                          document.getElementById('ops-search-input').value = item.operations_file_reference;
                            // 3. Load Details
                            clearSSDC();
                            const d = await apiGet(`../../api/costing/ops-file-details.php?ref=${encodeURIComponent(item.operations_file_reference)}`);
                            setCompactSSDC(d.item);
                        };
                        list.appendChild(li);
                    });
                }
                list.classList.remove('d-none');

            } catch (err) {
                console.error("Ops Search Error", err);
            }
        }, 300);
    });

    // Close list on click outside
    document.addEventListener('click', function(e) {
        if (e.target !== document.getElementById('ops-search-input')) {
            document.getElementById('ops-search-list').classList.add('d-none');
        }
    });

    // ---- Lines ----
    function addLine(line = null) {
      const tbody = document.getElementById('lines-body');
      const rowId = 'row-' + Math.floor(Math.random() * 1000000);

      const code = line ? (line.item_code || '') : '';
      const desc = line ? (line.item_description || '') : '';
      const nameEn = line ? (line.name_en || desc) : '';
      const nameFr = line ? (line.name_fr || desc) : '';
      
      // PATCH: Parse Float to strip DB decimals (10.000 -> 10)
      const qty = line ? (parseFloat(line.qty) || '') : '';
      const unit = line ? (parseFloat(line.unit_cost) || '') : '';
      
      const vat = line ? (Number(line.vat_applicable) ? 1 : 0) : 1;
      const codeReadOnly = code ? 'readonly' : '';
      const codeBg = code ? 'bg-light' : '';

      const tr = document.createElement('tr');
      tr.id = rowId;
      tr.dataset.nameEn = nameEn;
      tr.dataset.nameFr = nameFr;

      tr.innerHTML = `
        <td class="text-center">
          <button type="button" class="btn btn-sm text-danger border-0 p-0" onclick="removeLine('${rowId}')"><i class="fa-solid fa-times"></i></button>
        </td>
        <td>
          <input class="form-control form-control-sm smart-input font-monospace code ${codeBg}" value="${code}" ${codeReadOnly} placeholder="Code" tabindex="-1">
        </td>
        <td style="position:relative;">
          <input class="form-control form-control-sm smart-input desc" value="${desc}" placeholder="Description" autocomplete="off">
          <ul class="autocomplete-list d-none" id="list-${rowId}"></ul>
        </td>
        <td><input type="number" class="form-control form-control-sm smart-input text-center qty" value="${qty}" placeholder="Qty"></td>
        <td><input type="number" class="form-control form-control-sm smart-input text-end unit" value="${unit}" placeholder="Cost"></td>
        <td class="text-end font-monospace ht" data-raw="0">0.00</td>
        <td class="text-center"><input type="checkbox" class="vat" ${vat ? 'checked' : ''}></td>
        <td class="text-end fw-bold font-monospace ttc" data-raw="0">0.00</td>
        <td></td>
      `;
      tbody.appendChild(tr);

      // --- PATCH: Key Navigation Logic ---
      const qtyInput = tr.querySelector('.qty');
      const unitInput = tr.querySelector('.unit');
      const descInput = tr.querySelector('.desc');

      // 1. QTY -> Enter -> UNIT
      qtyInput.addEventListener('keydown', (e) => {
        if(e.key === 'Enter') { e.preventDefault(); unitInput.focus(); }
      });

      // 2. UNIT -> Enter -> NEW LINE
      unitInput.addEventListener('keydown', (e) => {
        if(e.key === 'Enter') { 
            e.preventDefault(); 
            addLine(); // Add new line
            // Wait for DOM update then focus the new description
            setTimeout(() => {
                const rows = tbody.querySelectorAll('tr');
                const lastRow = rows[rows.length - 1];
                if(lastRow) lastRow.querySelector('.desc').focus();
            }, 50);
        }
      });

      // Math Listeners
      ['input', 'change'].forEach(ev => {
        qtyInput.addEventListener(ev, () => calcRow(tr));
        unitInput.addEventListener(ev, () => calcRow(tr));
        tr.querySelector('.vat').addEventListener(ev, () => calcRow(tr));
      });
      
      // Autocomplete Listener
      descInput.addEventListener('keyup', (e) => handleAutocomplete(e, rowId));
      document.addEventListener('click', (e) => {
        if (e.target !== descInput) document.getElementById(`list-${rowId}`).classList.add('d-none');
      });

      calcRow(tr);
    }
    // --- PATCH: Autocomplete Logic ---
    let searchTimeout = null;

    async function handleAutocomplete(e, rowId) {
      const input = e.target;
      const list = document.getElementById(`list-${rowId}`);
      const query = input.value.trim();
      
      // Clear previous timeout
      clearTimeout(searchTimeout);

      if (query.length < 2) {
        list.classList.add('d-none');
        return;
      }

      // 300ms delay to prevent API spam
      searchTimeout = setTimeout(async () => {
        const isFr = document.getElementById('lang-fr').checked;
        const langParam = isFr ? 'FR' : 'EN';
        
        try {
          // Call your existing Search API
          const data = await apiGet(`../../api/finance/financial_dictionary/search.php?q=${encodeURIComponent(query)}&lang=${langParam}`);
          
          list.innerHTML = '';
          if (!data.items || data.items.length === 0) {
            list.classList.add('d-none');
            return;
          }

          data.items.forEach(item => {
            const li = document.createElement('li');
            li.className = 'autocomplete-item';
            
            // Format display based on selected language
            const mainName = isFr ? (item.name_fr || item.name_en) : item.name_en;
            const subName = isFr ? item.name_en : (item.name_fr || '');
            
            li.innerHTML = `<strong>${mainName}</strong><small>${item.code} - ${subName}</small>`;
            
            li.onclick = () => {
              // 1. Fill Description
              input.value = mainName;
              
              // 2. Fill Code & Lock it
              const row = document.getElementById(rowId);
              const codeInput = row.querySelector('.code');
              codeInput.value = item.code;
              codeInput.readOnly = true;
              codeInput.classList.add('bg-light');

              // 3. Store Dual Language Data (Hidden)
              row.dataset.nameEn = item.name_en;
              row.dataset.nameFr = item.name_fr;
              
              // 4. Hide list
              list.classList.add('d-none');
            };
            
            list.appendChild(li);
          });
          
          list.classList.remove('d-none');
        } catch (err) {
          console.error("Autocomplete Error", err);
        }
      }, 300);
    }

    // --- PATCH: Language Toggle Logic ---
    function toggleLanguage(lang) {
      const isFr = (lang === 'FR');
      document.querySelectorAll('#lines-body tr').forEach(tr => {
        const descInput = tr.querySelector('.desc');
        const en = tr.dataset.nameEn;
        const fr = tr.dataset.nameFr;

        // Only swap if we actually have dictionary data
        if (en && fr) {
          if (isFr && fr) descInput.value = fr;
          else if (!isFr && en) descInput.value = en;
        }
      });
    }

    // Event Listeners for Radio Buttons
    document.getElementById('lang-en').addEventListener('change', () => toggleLanguage('EN'));
    document.getElementById('lang-fr').addEventListener('change', () => toggleLanguage('FR'));


    // --- PATCH: Manual Conversion Logic ---

    // 1. Track Previous Currency (to know which way to convert)
    const currSelector = document.getElementById('currency-selector');
    // Initialize default previous value
    currSelector.dataset.last = 'XAF'; 

    // Update 'last' tracking whenever user opens the menu
    currSelector.addEventListener('focus', function(){
        // Only update if we aren't currently switching
        if(this.value) this.dataset.last = this.value;
    });

    // 2. Handle Dropdown Change (UI Setup ONLY - No Math)
    currSelector.addEventListener('change', function() {
        const newCurrency = this.value;
        const rateInput = document.getElementById('exchange-rate');
        const btn = document.getElementById('btn-convert');

        // Logic: If switching to Foreign, Unlock. 
        // If switching back to XAF, KEEP the foreign rate visible for the calculation.
        if (newCurrency !== 'XAF') {
            rateInput.readOnly = false;
            rateInput.classList.remove('bg-light');
            setTimeout(() => { rateInput.focus(); rateInput.select(); }, 50); // Auto-focus
        } else {
            // switching back to XAF: Don't reset to 1.00 yet! 
            // Keep the rate there so we can use it for the inverse conversion.
            rateInput.readOnly = false; // Allow edits just in case
            rateInput.classList.remove('bg-light');
        }
        
        // Visual cue that conversion is pending
        btn.classList.add('btn-warning'); 
        btn.classList.remove('btn-dark');
    });

    // 3. The Execution Function (Triggered by Button or Enter Key)
    function applyConversion() {
        const newCurrency = currSelector.value;
        const lastCurrency = currSelector.dataset.last || 'XAF';
        const rateInput = document.getElementById('exchange-rate');
        const rate = parseFloat(rateInput.value || 0);
        const btn = document.getElementById('btn-convert');

        if (rate <= 0) { alert("Please enter a valid exchange rate."); return; }
        if (newCurrency === lastCurrency) { return; } // Nothing to do

        // Perform Math
        const rows = document.querySelectorAll('#lines-body tr');
        rows.forEach(tr => {
            const unitInput = tr.querySelector('.unit');
            let val = parseFloat(unitInput.value || 0);

            if (val === 0) return; // Skip empty rows

            if (lastCurrency === 'XAF' && newCurrency !== 'XAF') {
                // XAF -> Foreign (DIVIDE)
                val = val / rate;
            } else if (lastCurrency !== 'XAF' && newCurrency === 'XAF') {
                // Foreign -> XAF (MULTIPLY)
                val = val * rate;
            } 
            // Note: Foreign -> Foreign conversion is blocked by UI flow (must go via XAF)
            
            // Update Row (strip trailing decimals)
            unitInput.value = parseFloat(val.toFixed(4)); 
            calcRow(tr);
        });

        // Post-Conversion Cleanup
        if (newCurrency === 'XAF') {
            // Now that math is done, reset to 1.00 and Lock
            rateInput.value = '1.00';
            rateInput.readOnly = true;
            rateInput.classList.add('bg-light');
        }

        // Reset Button Style
        btn.classList.remove('btn-warning');
        btn.classList.add('btn-dark');

        // Update the "Last" state so next conversion works
        currSelector.dataset.last = newCurrency;
        calcTotals();
    }

    // 4. Enter Key Listener for Rate Box
    document.getElementById('exchange-rate').addEventListener('keydown', function(e){
        if(e.key === 'Enter') {
            e.preventDefault();
            applyConversion();
        }
    });

    function removeLine(rowId){
      const tr = document.getElementById(rowId);
      if (tr) tr.remove();
      calcTotals();
    }

    function calcRow(tr){
      const qty = Number(tr.querySelector('.qty').value || 0);
      const unit = Number(tr.querySelector('.unit').value || 0);
      const vatOn = tr.querySelector('.vat').checked;
      const ht = qty * unit;
      const vat = vatOn ? ht * state.vatRate : 0;
      const ttc = ht + vat;

      tr.querySelector('.ht').dataset.raw = ht.toString();
      tr.querySelector('.ttc').dataset.raw = ttc.toString();

      tr.querySelector('.ht').innerText = ht.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
      tr.querySelector('.ttc').innerText = ttc.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});

      calcTotals();
    }
    async function loadValidatorsDropdown(selectedId = ''){
  const sel = document.getElementById('validator-employee-id');
  sel.innerHTML = `<option value="">Select Validator...</option>`;
  const data = await apiGet(`../../api/costing/validators.php?limit=50`);
  (data.items || []).forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.employee_id;
    opt.textContent = `${v.full_name} (${v.department}${v.job_title ? ' - ' + v.job_title : ''})`;
    if (selectedId && selectedId === v.employee_id) opt.selected = true;
    sel.appendChild(opt);
  });
}


    function calcTotals(){
      let ht = 0, vat = 0, ttc = 0;
      document.querySelectorAll('#lines-body tr').forEach(tr => {
        const qty = Number(tr.querySelector('.qty').value || 0);
        const unit = Number(tr.querySelector('.unit').value || 0);
        const vatOn = tr.querySelector('.vat').checked;
        const rowHT = qty * unit;
        const rowVAT = vatOn ? rowHT * state.vatRate : 0;
        const rowTTC = rowHT + rowVAT;
        ht += rowHT; vat += rowVAT; ttc += rowTTC;
      });

      document.getElementById('grand-ht').innerText = ht.toLocaleString('en-US',{minimumFractionDigits:2, maximumFractionDigits:2});
      document.getElementById('grand-vat').innerText = vat.toLocaleString('en-US',{minimumFractionDigits:2, maximumFractionDigits:2});
      const curr = document.getElementById('currency-selector').value;
      document.getElementById('grand-ttc').innerText = ttc.toLocaleString('en-US',{minimumFractionDigits:2, maximumFractionDigits:2}) + ` ${curr}`;

      window.__totals = { ht, vat, ttc };
    }

    function gatherLines(){
      const out = [];
      document.querySelectorAll('#lines-body tr').forEach((tr, idx) => {
        out.push({
          line_no: idx + 1,
          item_code: tr.querySelector('.code').value,
          item_description: tr.querySelector('.desc').value,
          qty: Number(tr.querySelector('.qty').value || 0),
          unit_cost: Number(tr.querySelector('.unit').value || 0),
          vat_applicable: tr.querySelector('.vat').checked ? 1 : 0,
          vat_rate: state.vatRate
        });
      });
      return out;
    }

    // ---- Offcanvas open/load ----
    function resetFormForNew(){
      state.currentCostingId = null;
      state.currentCostingRef = null;
      state.currentStatus = 'DRAFT';
      
      // 1. Clear Print Metadata
      state.approvalAuthCode = '';
      state.issuerName = '<?php echo e($fullName); ?>'; 
      state.validatorName = '';
      
      // 2. Clear Alert Box & Inputs
      document.getElementById('redirect-alert-box').innerHTML = ''; // <--- CLEARS THE YELLOW BOX
      document.getElementById('validator-employee-id').value = '';
      document.getElementById('costing-remarks').value = '';
      document.getElementById('link-file-ref').value = '';
      document.getElementById('ops-search-input').value = ''; // <--- CLEARS SEARCH VISIBLY

      // 3. Reset Layout (Undo the changes made by the Redirect Logic)
      const offcanvasBody = document.querySelector('.offcanvas-body');
      offcanvasBody.classList.add('overflow-hidden');   // Lock main scroll
      offcanvasBody.classList.remove('overflow-auto');
      document.getElementById('costingForm').classList.add('h-100'); // Restore full height

      // 4. Reset Header & Details
      document.getElementById('offcanvasTitle').innerText = 'New Costing Worksheet';
      document.getElementById('costing-ref-display').innerText = 'SLAS-COST-####';
      document.getElementById('costing-status-badge').className = 'badge bg-secondary';
      document.getElementById('costing-status-badge').innerText = 'DRAFT';
      clearSSDC();

      // 5. Reset Currency & Date
      document.getElementById('currency-selector').value = 'XAF';
      document.getElementById('currency-selector').dataset.last = 'XAF';
      const rateInput = document.getElementById('exchange-rate');
      rateInput.value = '1.00';
      rateInput.readOnly = true;
      rateInput.classList.add('bg-light');

      const now = new Date();
      const localDate = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
      document.getElementById('costing-date').value = localDate;

      // 6. Reset Lines
      document.getElementById('lines-body').innerHTML = '';
      calcTotals();
      document.getElementById('save-status').innerText = 'Not saved yet';

      // Start with one clean line & Editable State
      addLine();
      renderDrawerActions();
      toggleEditMode(true);
    }

    async function openCostingOffcanvas(mode){
      if (mode === 'new'){
        resetFormForNew();
        bsOffcanvas.show();
        return;
      }
    }
    
    function toggleEditMode(isEditable) {
        const form = document.getElementById('costingForm');
        
        // 1. Disable/Enable all Inputs, Selects, and Textareas
        const inputs = form.querySelectorAll('input, select, textarea');
        inputs.forEach(el => {
            // Never enable the "Rate" box if it's XAF (handled by currency logic, but safety first)
            if (el.id === 'exchange-rate' && document.getElementById('currency-selector').value === 'XAF') return;
            // Never enable hidden fields (keep them as is)
            if (el.type === 'hidden') return;

            el.disabled = !isEditable;
        });

        // 2. Hide/Show "Add Line" and "Suggest" Buttons
        // We target the div containing these specific buttons
        const btnRow = form.querySelector('button[onclick="addLine()"]').parentElement;
        if (btnRow) btnRow.style.display = isEditable ? 'block' : 'none';

        // 3. Hide/Show "Remove Line" (X) buttons in the table
        const deleteBtns = form.querySelectorAll('button[onclick^="removeLine"]');
        deleteBtns.forEach(btn => {
            btn.style.visibility = isEditable ? 'visible' : 'hidden';
        });

        // 4. Update Save Status Text
        const statusLabel = document.getElementById('save-status');
        if (!isEditable) {
             statusLabel.innerHTML = '<i class="fa-solid fa-lock me-1"></i> Read-Only View';
             statusLabel.className = "text-danger fw-bold fst-italic";
        } else {
             statusLabel.className = "text-muted fst-italic";
        }
    }

    async function openCostingOffcanvasById(id){
      try {
          const data = await apiGet(`../../api/costing/get.php?id=${encodeURIComponent(id)}`);
          const item = data.item;
          const lines = data.lines || [];

          state.currentCostingId = item.costing_id;
          state.currentCostingRef = item.costing_ref;
          state.currentStatus = item.status;
          
          // --- Store Signature Data ---
          state.approvalAuthCode = item.approval_auth_code || ''; 
          state.issuerName = item.created_by_name || 'System'; 
          state.validatorName = item.validated_by_name || '';
          state.validatedAt = item.validated_at || null; 
          state.approvedAt = item.approved_at || null;
          renderDrawerActions();

          document.getElementById('offcanvasTitle').innerText = 'Manage Costing';
          document.getElementById('costing-ref-display').innerText = item.costing_ref;

          // Badge
          const meta = statusConfig[item.status] || { cls:'status-draft', label:item.status };
          document.getElementById('costing-status-badge').className = `badge ${meta.cls}`;
          document.getElementById('costing-status-badge').innerText = item.status;

          // Header fields
          document.getElementById('costing-date').value = item.costing_date;
          document.getElementById('currency-selector').value = item.currency;
          
          // Rate Logic
          const rateInput = document.getElementById('exchange-rate');
          rateInput.value = parseFloat(item.exchange_rate_to_xaf).toFixed(2); // Fix decimal display
          // Lock rate if XAF
          if(item.currency === 'XAF') {
             rateInput.readOnly = true;
             rateInput.classList.add('bg-light');
          } else {
             rateInput.readOnly = false;
             rateInput.classList.remove('bg-light');
          }

          document.getElementById('costing-remarks').value = item.remarks || '';

          // --- FIXED: POPULATE SEARCH BOX WITH REFERENCE ---
          // This overrides the "Search..." placeholder
          document.getElementById('link-file-ref').value = item.operations_file_reference;
          document.getElementById('ops-search-input').value = item.operations_file_reference;

          // Load SSDC details
          clearSSDC();
          // We assume the API returns cached client info in 'item' or we fetch details
          // For safety, let's fetch fresh details to ensure the strip populates correctly
          const ss = await apiGet(`../../api/costing/ops-file-details.php?ref=${encodeURIComponent(item.operations_file_reference)}`);
          setCompactSSDC(ss.item);

          // Lines
          document.getElementById('lines-body').innerHTML = '';
          if (lines.length === 0) addLine();
          else lines.forEach(l => addLine(l));

          calcTotals();
          document.getElementById('save-status').innerText = `Loaded from DB: ${item.updated_at || item.created_at || ''}`;

          bsOffcanvas.show();
          await loadValidatorsDropdown(item.validator_employee_id || '');
          document.getElementById('validator-employee-id').value = item.validator_employee_id || '';

          // Lock if not Draft/Rejected
          const isEditable = (item.status === 'DRAFT' || item.status === 'REJECTED');
toggleEditMode(isEditable);

      } catch(err) {
          console.error(err);
          alert("Error loading costing: " + err.message);
      }
    }
    
function can(role, action) {
  role = String(role || '').toUpperCase();

  const policy = {
    SUBMIT:   ['ADMIN','SALES','OPERATIONS','MANAGEMENT'],
    VALIDATE: ['ADMIN','MANAGEMENT','LEAD'],
    APPROVE:  ['ADMIN','FINANCE','MANAGEMENT'],
    REJECT:   ['ADMIN','FINANCE','MANAGEMENT','LEAD'],
    UNLOCK:   ['ADMIN','MANAGEMENT'] // <--- ADD THIS LINE
  };

  return (policy[action] || []).includes(role);
}

function isEditableStatus(status) {
  return ['DRAFT','REJECTED'].includes(String(status || '').toUpperCase());
}

// --- PATCH: Updated Drawer Actions with Unlock Workflow ---
    function renderDrawerActions() {
      const role = String(window.AUTH_ROLE || '').toUpperCase();
      const status = String(state.currentStatus || 'DRAFT').toUpperCase();
      const box = document.getElementById('action-buttons');
      if (!box) return;

      // Common Buttons
      const btnClose = `<button type="button" class="btn btn-light fw-bold text-muted" data-bs-dismiss="offcanvas">Close</button>`;
      
      // Define button HTML strings
      let btnSave = '', btnSubmit = '', btnValidate = '', btnApprove = '', btnReject = '', btnUnlockRequest = '', btnManagementUnlock = '';

      // 1. SAVE: Only in Draft or Rejected
if (status === 'DRAFT' || status === 'REJECTED') {
    const label = (status === 'DRAFT') ? 'Save' : 'Save Changes';
    btnSave = `<button type="button" class="btn btn-dark fw-bold" onclick="saveDraft()"><i class="fa-regular fa-floppy-disk me-2"></i>${label}</button>`;
}

// 2. SUBMIT: Only from Draft or Rejected
if ((status === 'DRAFT' || status === 'REJECTED') && can(role, 'SUBMIT')) {
    btnSubmit = `<button type="button" class="btn btn-success fw-bold text-white" onclick="submitForValidation()"><i class="fa-solid fa-paper-plane me-2"></i>Submit</button>`;
}

      // 3. VALIDATE: Only from Submitted for Validation
      if (status === 'SUBMITTED_FOR_VALIDATION' && can(role, 'VALIDATE')) {
        btnValidate = `<button type="button" class="btn btn-primary fw-bold text-white" onclick="validateCosting()"><i class="fa-solid fa-check me-2"></i>Validate</button>`;
      }

      // 4. APPROVE: Only from Submitted for Approval
      if (status === 'SUBMITTED_FOR_APPROVAL' && can(role, 'APPROVE')) {
        btnApprove = `<button type="button" class="btn btn-dark fw-bold" onclick="approveCosting()"><i class="fa-solid fa-stamp me-2"></i>Approve</button>`;
      }

      // 5. REJECT: From any Submitted state
      if (['SUBMITTED_FOR_VALIDATION', 'SUBMITTED_FOR_APPROVAL'].includes(status) && can(role, 'REJECT')) {
        btnReject = `<button type="button" class="btn btn-outline-danger fw-bold" onclick="rejectCosting()"><i class="fa-solid fa-ban me-2"></i>Reject</button>`;
      }

      // --- NEW: UNLOCK WORKFLOW BUTTONS ---

      // 6. REQUEST UNLOCK: Visible when Locked (for anyone who can normally Submit)
      if (status === 'APPROVED_LOCKED' && can(role, 'SUBMIT')) {
        btnUnlockRequest = `<button type="button" class="btn btn-warning fw-bold text-dark" onclick="requestUnlock()"><i class="fa-solid fa-lock-open me-2"></i>Request Edit</button>`;
      }

      // 7. MANAGEMENT UNLOCK/DENY: Visible when Unlock Requested (only for Management)
      if (status === 'UNLOCK_REQUESTED') {
        if (can(role, 'UNLOCK')) {
            btnManagementUnlock = `
                <button type="button" class="btn btn-danger fw-bold" onclick="denyUnlock()">Deny</button>
                <button type="button" class="btn btn-success fw-bold" onclick="grantUnlock()">Unlock</button>
            `;
        } else {
            // User view (waiting)
            btnManagementUnlock = `<span class="badge bg-warning text-dark p-2">Unlock Pending...</span>`;
        }
      }

      box.innerHTML = [
        btnClose,
        btnReject,
        btnSave,
        btnSubmit,
        btnValidate,
        btnApprove,
        btnUnlockRequest,
        btnManagementUnlock
      ].filter(Boolean).join('');
    }

    // --- NEW: Unlock Action Functions ---
    async function requestUnlock() {
        if (!state.currentCostingId) return;
        if (!confirm("This document is locked. Do you want to request Management to unlock it for editing?")) return;
        
        await apiPost(`../../api/costing/transition.php`, { costing_id: state.currentCostingId, action: 'REQUEST_UNLOCK' });
        await openCostingOffcanvasById(state.currentCostingId);
        await loadRegistry();
    }

    async function grantUnlock() {
        if (!state.currentCostingId) return;
        if (!confirm("Are you sure? This will revert the status to DRAFT and allow editing.")) return;

        await apiPost(`../../api/costing/transition.php`, { costing_id: state.currentCostingId, action: 'UNLOCK' });
        await openCostingOffcanvasById(state.currentCostingId);
        await loadRegistry();
    }

    async function denyUnlock() {
        if (!state.currentCostingId) return;
        await apiPost(`../../api/costing/transition.php`, { costing_id: state.currentCostingId, action: 'DENY_UNLOCK' });
        await openCostingOffcanvasById(state.currentCostingId);
        await loadRegistry();
    }

    // ---- Save + Workflow ----
  async function saveDraft() {
  const opsRef = document.getElementById('link-file-ref').value;
  if (!opsRef) { alert('Select an Operations File first.'); return; }

  const validatorId = (document.getElementById('validator-employee-id').value || '').trim();

  const payload = {
    costing_id: state.currentCostingId || null,
    operations_file_reference: opsRef,
    costing_date: document.getElementById('costing-date').value,
    remarks: document.getElementById('costing-remarks').value,
    currency: document.getElementById('currency-selector').value,
    exchange_rate_to_xaf: Number(document.getElementById('exchange-rate').value || 1),
    validator_employee_id: validatorId || null,   // ✅ ADD THIS
    lines: gatherLines()
  };

  const res = await apiPost(`../../api/costing/save.php`, payload);

  if (!res || !res.costing_id) throw new Error('Save succeeded but costing_id was not returned');

  state.currentCostingId = res.costing_id;
  document.getElementById('save-status').innerText = 'Saved: Just now';

  if (!payload.costing_id) {
    await openCostingOffcanvasById(res.costing_id);
  } else {
    await loadRegistry();
  }
}



  async function submitForValidation() {
  const v = (document.getElementById('validator-employee-id').value || '').trim();
  if (!v) { alert('Select a validator before submitting.'); return; }

  // Ensure validator gets saved
  await saveDraft();

  await apiPost(`../../api/costing/transition.php`, {
    costing_id: state.currentCostingId,
    action: 'SUBMIT'
  });

  await openCostingOffcanvasById(state.currentCostingId);
  await loadRegistry();
}



    async function validateCosting(){
      if (!state.currentCostingId) return;
      await apiPost(`../../api/costing/transition.php`, { costing_id: state.currentCostingId, action: 'VALIDATE' });
      await openCostingOffcanvasById(state.currentCostingId);
      await loadRegistry();
    }

    // 1. Trigger: Opens the modal
    function approveCosting(){
      if (!state.currentCostingId) return;
      const modal = new bootstrap.Modal(document.getElementById('approvalModal'));
      modal.show();
    }

    // 2. Confirm: Sends the API request
    async function confirmApproval(){
      // Hide modal first
      const modalEl = document.getElementById('approvalModal');
      const modal = bootstrap.Modal.getInstance(modalEl);
      modal.hide();

      // Proceed with API call
      try {
          await apiPost(`../../api/costing/transition.php`, { costing_id: state.currentCostingId, action: 'APPROVE' });
          
          // Refresh to show the new status and signature
          await openCostingOffcanvasById(state.currentCostingId);
          await loadRegistry();
          
      } catch (e) {
          alert("Approval failed: " + e.message);
      }
    }

    async function rejectCosting(){
      if (!state.currentCostingId) return;
      const reason = prompt('Enter rejection reason (optional):') || '';
      await apiPost(`../../api/costing/transition.php`, { costing_id: state.currentCostingId, action: 'REJECT', reason });
      await openCostingOffcanvasById(state.currentCostingId);
      await loadRegistry();
    }

    // Filters
    // Add this with your other event listeners
        document.getElementById('periodFilter').addEventListener('change', function() {
          state.period = this.value;
          state.page = 1; // Always reset to page 1 when filter changes
          loadRegistry();
        });
    document.querySelectorAll('[data-status]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('[data-status]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.status = btn.getAttribute('data-status');
        state.page = 1;
        loadRegistry();
      });
    });

    document.getElementById('searchInput').addEventListener('input', () => {
      state.q = document.getElementById('searchInput').value.trim();
      state.page = 1;
      loadRegistry();
    });

    // --- Suggest Lines Logic ---
    function mapServiceToDictionaryKey(serviceTypeRaw) {
        // Maps Ops File ServiceType (e.g. SEA_FREIGHT_IMPORT) to Financial Dictionary Applicability String
        const s = String(serviceTypeRaw || '').toUpperCase();
        if (s.includes('SEA') && s.includes('IMPORT')) return 'Sea Import';
        if (s.includes('SEA') && s.includes('EXPORT')) return 'Sea Export';
        if (s.includes('AIR') && s.includes('IMPORT')) return 'Air Import';
        if (s.includes('AIR') && s.includes('EXPORT')) return 'Air Export';
        if (s.includes('TRANSIT') || s.includes('INLAND')) return 'Transit';
        // Fallback or empty if no specific match
        return '';
    }

    async function suggestLines() {
        const serviceText = document.getElementById('ssdc-service').innerText;
        const appKey = mapServiceToDictionaryKey(serviceText);

        if (!appKey) {
            alert('Could not determine service category for suggestion (Requires Sea Import, Sea Export, etc.)');
            return;
        }

        // --- PATCH 1: SAFETY PROMPT ---
        // Check if we already have lines with codes in the table
        let hasData = false;
        document.querySelectorAll('#lines-body tr .code').forEach(input => {
            if (input.value.trim() !== '') hasData = true;
        });

        if (hasData) {
            if (!confirm("You already have lines in the table. Do you want to load suggestions again?")) {
                return; // User cancelled
            }
        }

        try {
            const data = await apiGet(`../../api/costing/get-suggestions.php?applicability=${encodeURIComponent(appKey)}`);
            const suggestions = data.items || [];

            if (suggestions.length === 0) {
                alert('No standard lines found for: ' + appKey);
                return;
            }

            // --- GHOST FIX ---
            // Remove empty initial row if it exists
            const tbody = document.getElementById('lines-body');
            const rows = tbody.querySelectorAll('tr');
            if (rows.length === 1) {
                const tr = rows[0];
                const code = tr.querySelector('.code').value;
                const cost = Number(tr.querySelector('.unit').value || 0);
                if (!code && cost === 0) tbody.innerHTML = '';
            }

            const existingCodes = [];
            document.querySelectorAll('#lines-body tr .code').forEach(input => {
                const val = input.value.trim();
                if (val) existingCodes.push(val);
            });

            const isFr = document.getElementById('lang-fr').checked;
            let addedCount = 0;
            
            suggestions.forEach(item => {
                if (existingCodes.includes(item.code)) return;

                addLine({
                    item_code: item.code,
                    name_en: item.name_en,
                    name_fr: item.name_fr,
                    item_description: isFr ? (item.name_fr || item.name_en) : item.name_en,
                    
                    // --- PATCH 2: EMPTY QUANTITY ---
                    // We send an empty string so the placeholder shows, 
                    // forcing the user to type the quantity.
                    qty: '', 
                    
                    unit_cost: 0,
                    vat_applicable: 1 
                });
                addedCount++;
            });

            if (addedCount === 0 && suggestions.length > 0) {
                 alert("All standard lines for this service are already in your table.");
            }

        } catch (e) {
            console.error(e);
            alert('Failed to fetch suggestions: ' + e.message);
        }
    }

    // Boot
    (async function init(){
      await loadOpsDropdown();
      await loadValidatorsDropdown('');
      await loadRegistry();
    })();

    // expose
    window.openCostingOffcanvas = openCostingOffcanvas;
    window.openCostingOffcanvasById = openCostingOffcanvasById;
    window.addLine = addLine;
    window.saveDraft = saveDraft;
    window.submitForValidation = submitForValidation;
    window.validateCosting = validateCosting;
    window.approveCosting = approveCosting;
    window.rejectCosting = rejectCosting;
    window.generatePreview = generatePreview;
    window.suggestLines = suggestLines; // Expose suggestion function
    // --- PATCH: Number to Words Engine & Print Logic ---

    /**
     * Converts number to text (Bilingual Support)
     */
    // --- PATCH: Number to Words Engine & Print Logic ---

    /**
     * Converts number to text (Bilingual Support)
     */
    function amountToWords(amount, currency, lang = 'EN') {
        const num = parseFloat(amount);
        if (isNaN(num)) return "ZERO";

        const unitsEn = ["", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN"];
        const tensEn = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];
        
        const unitsFr = ["", "UN", "DEUX", "TROIS", "QUATRE", "CINQ", "SIX", "SEPT", "HUIT", "NEUF", "DIX", "ONZE", "DOUZE", "TREIZE", "QUATORZE", "QUINZE", "SEIZE", "DIX-SEPT", "DIX-HUIT", "DIX-NEUF"];
        const tensFr = ["", "", "VINGT", "TRENTE", "QUARANTE", "CINQUANTE", "SOIXANTE", "SOIXANTE-DIX", "QUATRE-VINGT", "QUATRE-VINGT-DIX"];

        function convertGroup(n, l) {
            if (n === 0) return "";
            let str = "";
            const h = Math.floor(n / 100);
            const r = n % 100;
            
            if (l === 'EN') {
                if (h > 0) str += unitsEn[h] + " HUNDRED ";
                if (r > 0) {
                    if (r < 20) str += unitsEn[r];
                    else str += tensEn[Math.floor(r / 10)] + (r % 10 > 0 ? "-" + unitsEn[r % 10] : "");
                }
            } else { // FR
                if (h > 0) str += (h > 1 ? unitsFr[h] + " " : "") + "CENT ";
                if (r > 0) {
                    if (r < 20) str += unitsFr[r];
                    else {
                        str += tensFr[Math.floor(r / 10)] + (r % 10 > 0 ? "-" + unitsFr[r % 10] : "");
                    }
                }
            }
            return str.trim();
        }

        const intPart = Math.floor(num);
        const decPart = Math.round((num - intPart) * 100);
        let words = "";
        
        const millions = Math.floor(intPart / 1000000);
        const thousands = Math.floor((intPart % 1000000) / 1000);
        const remainder = intPart % 1000;

        if (millions > 0) words += convertGroup(millions, lang) + (lang==='EN'?" MILLION ":" MILLIONS ");
        if (thousands > 0) words += convertGroup(thousands, lang) + (lang==='EN'?" THOUSAND ":" MILLE ");
        if (remainder > 0) words += convertGroup(remainder, lang);

        if (words === "") words = (lang==='EN'?"ZERO":"ZERO");

        words += " " + currency;

        if (decPart > 0) {
            words += (lang==='EN' ? " AND " : " ET ") + convertGroup(decPart, lang) + (lang==='EN'?" CENTS":" CENTIMES");
        }

        return words.toUpperCase();
    }


    /**
 * --- FINAL PREVIEW ENGINE: BILINGUAL & PAGINATED ---
 */
/**
 * --- FINAL PREVIEW ENGINE: BILINGUAL & PAGINATED (ABSOLUTE FOOTER FIX) ---
 */
/**
 * --- FINAL PREVIEW ENGINE: HIGH DENSITY (20 Lines/Page) ---
 */
function generatePreview() {
  try {
    const isFr = document.getElementById('lang-fr').checked;
    const currentLang = isFr ? 'FR' : 'EN';

    const txt = isFr ? {
      amtWords: "Montant en lettres :",
      heldAt: "Arrêté le présent devis à la somme de",
      subtotal: "Sous-total HT :",
      vat: "Total TVA :",
      ttc: "TOTAL TTC :",
      remarks: "Remarques :",
      issued: "Émis par",
      validated: "Validé par",
      approved: "Approuvé par", // Removed Director Title from variable
      page: "Page",
      continuation: "Suite :",
      issuedStamp: "ÉMIS",
      validatedStamp: "VALIDÉ",
      pending: "EN ATTENTE"
    } : {
      amtWords: "Amount in words:",
      heldAt: "Costing held at the sum of",
      subtotal: "Subtotal HT:",
      vat: "Total VAT:",
      ttc: "TOTAL TTC:",
      remarks: "Remarks:",
      issued: "Issued By",
      validated: "Validated By",
      approved: "Approved By", // Removed Director Title from variable
      page: "Page",
      continuation: "Continuation:",
      issuedStamp: "ISSUED",
      validatedStamp: "VALIDATED",
      pending: "PENDING VALIDATION"
    };

    // Helper: Dates
    const formatStamp = (isoDate, fallbackDate) => {
      if (!isoDate && !fallbackDate) return { date: 'Pending', time: '--:--', raw: null };
      if (isoDate) {
        const d = new Date(isoDate);
        return {
          date: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
          time: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
          raw: isoDate
        };
      }
      const d = new Date(fallbackDate);
      return {
        date: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        time: '',
        raw: fallbackDate
      };
    };

    const costId = state.currentCostingId || 'DRAFT-000000000000';
    const issuerAuthID = 'ISS-' + costId.substring(0, 8).toUpperCase();
    const valAuthID = 'VAL-' + costId.substring(costId.length - 8).toUpperCase();
    const appAuthID = state.approvalAuthCode ? 'APP-' + state.approvalAuthCode : 'APP-PENDING';

    const meta = {
      status: document.getElementById('costing-status-badge').innerText.trim(),
      ref: document.getElementById('costing-ref-display').innerText,
      date: document.getElementById('costing-date').value,
      client: document.getElementById('ssdc-client').innerText,
      service: document.getElementById('ssdc-service').innerText,
      remarks: document.getElementById('costing-remarks').value || "",
      curr: document.getElementById('currency-selector').value,
      issuer: state.issuerName || 'System',
      validator: state.validatorName || ''
    };

    const issData = formatStamp(null, meta.date);
    const valData = formatStamp(state.validatedAt, null);
    const appData = formatStamp(state.approvedAt, null);

    const ship = {
      trans: document.getElementById('ssdc-transport').innerText,
      route: document.getElementById('ssdc-route').innerText,
      eta: document.getElementById('ssdc-eta').innerText,
      convey: document.getElementById('ssdc-conveyance').innerText,
      weight: document.getElementById('ssdc-weight').innerText,
      pkgs: document.getElementById('ssdc-packages').innerText,
      delivery: document.getElementById('ssdc-delivery').innerText,
      comm: document.getElementById('ssdc-commodity').innerText,
      marks: document.getElementById('ssdc-marks').innerText
    };

    const rawRows = [];
    let grandHT = 0, grandVAT = 0, grandTTC = 0;

    document.querySelectorAll('#lines-body tr').forEach(tr => {
      const qty = parseFloat(tr.querySelector('.qty').value || 0);
      const unitRaw = parseFloat(tr.querySelector('.unit').value || 0);
      const isVat = tr.querySelector('.vat').checked;
      const ht = qty * unitRaw;
      const vatAmt = isVat ? (ht * state.vatRate) : 0;
      const ttc = ht + vatAmt;

      grandHT += ht; grandVAT += vatAmt; grandTTC += ttc;

      rawRows.push({
        code: tr.querySelector('.code').value || '',
        desc: tr.querySelector('.desc').value || '',
        qty: qty,
        unit: unitRaw.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        ht: ht.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        vat: vatAmt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        ttc: ttc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      });
    });

    if (rawRows.length === 0) { alert('No lines found.'); return; }
    const words = amountToWords(grandTTC, meta.curr, currentLang);

    // --- CONFIG: HIGH DENSITY LIMITS ---
    const ROWS_PER_PAGE_1 = 20; // Matches requested capacity
    const ROWS_PER_PAGE_X = 30; // Subsequent pages
    
    const totalRows = rawRows.length;
    let totalPages = 1;
    if (totalRows > ROWS_PER_PAGE_1) {
      totalPages = 1 + Math.ceil((totalRows - ROWS_PER_PAGE_1) / ROWS_PER_PAGE_X);
    }

    const container = document.getElementById('print-container');
    container.innerHTML = '';
    let currentRowIndex = 0;

    for (let p = 1; p <= totalPages; p++) {
      const pageDiv = document.createElement('div');
      pageDiv.className = 'a4-page';
      
      let html = '';

      // HEADER
      if (p === 1) {
        html += `
          <div class="print-header-grid">
            <div>
              <div class="company-name">SMART LOGISTICS AND<br>SERVICES LTD</div>
              <div class="company-details">
                1030, Ave Douala Manga Bell, Bali<br>PO Box 5120, Douala<br>
                00237 233 420 281 | operations@smartls.cm
              </div>
            </div>
            <div class="doc-title-box">
              <div class="doc-title">COSTING</div>
              <div class="status-badge-print">${meta.status}</div>
            </div>
            <div><img src="../../../assets/img-webp/logo-smart.webp" class="print-logo" alt="Smart LS"></div>
          </div>

          <div class="meta-grid">
            <div class="meta-box"><label>Reference</label><div>${meta.ref}</div></div>
            <div class="meta-box"><label>Date</label><div>${meta.date}</div></div>
            <div class="meta-box"><label>Client</label><div>${meta.client}</div></div>
            <div class="meta-box"><label>Service</label><div>${meta.service}</div></div>
          </div>

          <div class="shipment-container">
            <div class="ship-title">Shipment Details</div>
            <div class="shipment-grid">
              <div class="ship-item"><span class="ship-label">Trans Ref</span> <span class="ship-val">${ship.trans}</span></div>
              <div class="ship-item"><span class="ship-label">Route</span> <span class="ship-val">${ship.route}</span></div>
              <div class="ship-item"><span class="ship-label">Conveyance</span> <span class="ship-val">${ship.convey}</span></div>
              <div class="ship-item"><span class="ship-label">ETA / Arrival</span> <span class="ship-val">${ship.eta}</span></div>
              <div class="ship-item"><span class="ship-label">Weight</span> <span class="ship-val">${ship.weight}</span></div>
              <div class="ship-item"><span class="ship-label">Packages</span> <span class="ship-val">${ship.pkgs}</span></div>
              <div class="ship-item"><span class="ship-label">Commodity</span> <span class="ship-val">${ship.comm}</span></div>
              <div class="ship-item"><span class="ship-label">Place of Del.</span> <span class="ship-val">${ship.delivery}</span></div>
              <div class="ship-item"><span class="ship-label">Marks</span> <span class="ship-val">${ship.marks}</span></div>
            </div>
          </div>
        `;
      } else {
        html += `
          <div style="border-bottom: 2px solid #ccc; margin-bottom: 15px; padding-bottom:5px; font-size: 0.75rem; font-weight: bold; color: #555; display:flex; justify-content:space-between;">
            <span>${txt.continuation} ${meta.ref}</span>
            <span>${txt.page} ${p} of ${totalPages}</span>
          </div>
        `;
      }

      // TABLE
      html += `
        <table class="print-table" style="font-size: 8pt;">
          <thead>
            <tr>
              <th width="10%">Code</th>
              <th width="35%">Description</th>
              <th width="7%" class="text-center">Qty</th>
              <th width="12%" class="text-end">Unit</th>
              <th width="12%" class="text-end">Total HT</th>
              <th width="11%" class="text-end">VAT Amt</th>
              <th width="13%" class="text-end">Total TTC</th>
            </tr>
          </thead>
          <tbody>
      `;

      const rowsLimit = (p === 1) ? ROWS_PER_PAGE_1 : ROWS_PER_PAGE_X;
      let count = 0;
      while (count < rowsLimit && currentRowIndex < totalRows) {
        const r = rawRows[currentRowIndex];
        html += `
          <tr>
            <td style="font-family:monospace; font-weight:700;">${r.code}</td>
            <td>${r.desc}</td>
            <td class="text-center">${r.qty}</td>
            <td class="text-end">${r.unit}</td>
            <td class="text-end">${r.ht}</td>
            <td class="text-end text-muted">${r.vat}</td>
            <td class="text-end fw-bold">${r.ttc}</td>
          </tr>
        `;
        currentRowIndex++; count++;
      }
      
      html += `</tbody></table>`;

      // TOTALS & SIGNATURES (Last Page)
      if (p === totalPages) {
        const isApproved = (meta.status === 'APPROVED_LOCKED');
        const commonStampStyle = `border: 3px double #000; color: #000; padding: 8px; border-radius: 2px; font-family: 'Courier New', monospace; text-align: center; margin-top: 10px; background: #fff;`;
        
        const issContent = `<div style="font-weight:900; font-size:1rem; border-bottom:1px solid #000; margin-bottom:4px;">${txt.issuedStamp}</div><div style="font-weight:bold; font-size:0.7rem;">${meta.issuer}</div><div style="font-size:0.65rem; margin-top:2px;">${issData.date}</div><div style="font-size:0.5rem; margin-top:4px;">${issuerAuthID}</div>`;
        const valContent = valData.raw ? `<div style="font-weight:900; font-size:1rem; border-bottom:1px solid #000; margin-bottom:4px;">${txt.validatedStamp}</div><div style="font-weight:bold; font-size:0.7rem;">${meta.validator}</div><div style="font-size:0.65rem; margin-top:2px;">${valData.date} | ${valData.time}</div><div style="font-size:0.5rem; margin-top:4px;">${valAuthID}</div>` : `<div style="font-weight:bold; font-size:0.8rem; color:#aaa; padding:10px;">${txt.pending}</div>`;

        // --- PATCH: LOGIC FOR INSIDE-THE-BOX LAYOUT ---

// --- PATCH: FINAL CLEAN APPROVER BOX ---
        const appContent = isApproved ? `
          <div style="
              height: 100%; 
              width: 100%; 
              display: flex; 
              flex-direction: column; 
              align-items: center; 
              justify-content: center; 
              overflow: hidden; 
              border: none; 
              outline: none;
          ">
            
            <img src="../../../assets/img/signature-dg.svg" style="
                height: 85px; 
                width: auto; 
                object-fit: contain; 
                margin-top: 5px; 
                margin-bottom: 2px;
                border: none; 
                display: block;
            ">
            
            <div style="
                font-family: 'Manrope', sans-serif; 
                font-weight: 800; 
                font-size: 8pt; 
                text-transform: uppercase; 
                color: #000; 
                line-height: 1.1; 
                margin-bottom: 2px;
                border: none;
            ">
                TIMOTHÉE MASSOMBA
            </div>

            <div style="
                font-family: monospace; 
                font-weight: 700; 
                font-size: 6pt; 
                color: #000; 
                text-align: center; 
                line-height: 1;
                border: none;
            ">
              APPROVED: ${appData.date} | ${appAuthID}
            </div>

          </div>
        ` : ``;

        // Ensure this is empty
        const appVerify = ``;

        html += `
          <div class="totals-section">
            <div class="words-box">
              <strong>${txt.amtWords}</strong><br>
              <span style="text-transform:uppercase; font-size:0.7rem;">${words}</span>
              <div style="margin-top:4px; font-weight:bold; font-size:0.75rem;">${txt.heldAt} ${grandTTC.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${meta.curr}</div>
            </div>
            <div class="sums-box">
              <div class="sum-row"><span>${txt.subtotal}</span> <strong>${grandHT.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong></div>
              <div class="sum-row"><span>${txt.vat}</span> <strong>${grandVAT.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong></div>
              <div class="sum-total"><div class="sum-row"><span>${txt.ttc}</span> <span>${grandTTC.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></div></div>
            </div>
          </div>
          <div style="font-size: 0.7rem; margin-top: 8px; margin-bottom: 5px;"><strong>${txt.remarks}</strong> ${meta.remarks}</div>
          <div class="signatures">
            <div class="sig-box"><div class="sig-title">${txt.issued}</div><div style="${commonStampStyle}">${issContent}</div></div>
            <div class="sig-box"><div class="sig-title">${txt.validated}</div><div style="${commonStampStyle} opacity:${valData.raw ? '1' : '0.4'};">${valContent}</div></div>
            <div class="sig-box">
  <div style="
      font-size: 0.6rem; 
      text-transform: uppercase; 
      font-weight: 800; 
      color: #888; 
      text-align: center; 
      margin-bottom: 2px; 
      border: none !important;
      text-decoration: none !important;
  ">${txt.approved}</div>
  ${appContent}
</div>
          </div>
        `;
      }

      // ABSOLUTE FOOTER
      html += `
        <div class="page-footer">
          <div>
            <span style="display:block; margin-bottom:2px; font-weight:700;">RC: RC/DLA/2021/B/2060 | NIU: M042116033580Q</span>
            <span>Bank: AFRILAND FIRST BANK | Acct: 10005000610701841100193</span>
          </div>
          <div style="align-self:flex-end;">${txt.page} ${p} of ${totalPages}</div>
        </div>
      `;

      pageDiv.innerHTML = html;
      container.appendChild(pageDiv);
    }

    requestAnimationFrame(() => {
      const el = document.getElementById('printModal');
      const modal = bootstrap.Modal.getOrCreateInstance(el);
      modal.show();
    });

  } catch (e) {
    console.error(e); alert('Preview failed: ' + e.message);
  }
}

function printCostingNow() {
  try {
    const root = document.getElementById('print-root');
    const preview = document.getElementById('print-container');

    const html = (root && root.innerHTML.trim()) ? root.innerHTML : (preview && preview.innerHTML.trim()) ? `<div id="print-container">${preview.innerHTML}</div>` : '';
    if (!html) { alert('No print content found.'); return; }

    const iframe = document.createElement('iframe');
    Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Print Costing</title>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    @page { size: A4; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; font-family: 'Manrope', sans-serif; }
    #print-container { width: 100%; margin: 0; padding: 0; display: block; background: #fff; }
    
    .a4-page {
      width: 210mm;
      min-height: 296mm;
      height: auto;
      margin: 0;
      /* Padding: Bottom 15mm ensures table doesn't render over the absolute footer */
      padding: 10mm 15mm 15mm 15mm; 
      position: relative; 
      page-break-after: always;
      break-after: page;
      overflow: hidden; 
      box-sizing: border-box;
    }
    .a4-page:last-child { page-break-after: auto; break-after: auto; }

    /* Header */
    .print-header-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; align-items: center; border-bottom: 3px solid #EE7D04; padding-bottom: 8px; margin-bottom: 10px; }
    .print-header-grid > div:nth-child(1) { text-align: left; }
    .print-header-grid > div:nth-child(2) { text-align: center; }
    .print-header-grid > div:nth-child(3) { text-align: right; }
    
    .company-name { font-family: 'Montserrat', sans-serif; font-weight: 800; font-size: 0.9rem; line-height: 1.1; text-transform: uppercase; }
    .company-details { font-size: 0.6rem; color: #444; margin-top: 4px; line-height: 1.3; }
    .doc-title { font-family: 'Montserrat', sans-serif; font-size: 1.8rem; font-weight: 800; letter-spacing: -1px; line-height: 1; margin-bottom: 2px; }
    .status-badge-print { font-size: 0.5rem; border: 1px solid #ddd; color: #555; background: #f9f9f9; padding: 1px 5px; text-transform: uppercase; font-weight: bold; display: inline-block; letter-spacing: 0.5px; }
    .print-logo { height: 50px; width: auto; display: inline-block; }

    /* Grids & Tables */
    .meta-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; background: #f8f9fa; padding: 6px 8px; border-left: 4px solid #1F99D8; margin-bottom: 10px; }
    .meta-box label { display: block; font-size: 0.5rem; text-transform: uppercase; color: #666; font-weight: 700; margin-bottom: 0; }
    .meta-box div { font-size: 0.7rem; font-weight: 800; color: #000; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    
    .shipment-container { border: 1px solid #e0e0e0; padding: 8px; margin-bottom: 15px; border-radius: 4px; }
    .ship-title { font-size: 0.6rem; font-weight: 800; text-transform: uppercase; color: #EE7D04; border-bottom: 1px solid #eee; margin-bottom: 5px; padding-bottom: 2px; }
    .shipment-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 15px; }
    .ship-item { font-size: 0.65rem; display: flex; flex-direction: column; }
    .ship-label { font-weight: 700; color: #666; font-size: 0.55rem; text-transform: uppercase; }
    .ship-val { font-weight: 800; color: #000; }

    .print-table { width: 100%; border-collapse: collapse; font-size: 0.7rem; margin-bottom: 0; }
    .print-table th { background: #EE7D04; color: #fff; text-transform: uppercase; font-weight: 800; padding: 6px 4px; text-align: left; font-size: 0.6rem; }
    /* --- FIX: 3px padding top/bottom = 6px total spacing for High Density --- */
    .print-table td { border-bottom: 1px solid #eee; padding: 3px 4px; vertical-align: top; }

    /* Totals & Signatures */
    .totals-section { display: flex; gap: 20px; margin-top: 15px; border-top: 2px solid #000; padding-top: 10px; page-break-inside: avoid; }
    .words-box { flex: 2; background: #f4f4f4; padding: 8px; font-size: 0.7rem; font-style: italic; border-radius: 4px; }
    .sums-box { flex: 1; font-size: 0.8rem; }
    .sum-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
    .sum-total { font-weight: 900; color: #EE7D04; font-size: 0.9rem; border-top: 1px dashed #ccc; padding-top: 4px; margin-top: 4px; }

    .signatures { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; margin-top: 20px; page-break-inside: avoid; }
    .sig-box { border: 1px solid #ccc; height: 140px; padding: 8px; position: relative; background: #fff; }
    /* REPLACE THE ENTIRE .sig-title BLOCK WITH THIS */
    .sig-title {
        font-size: 0.6rem;
        text-transform: uppercase;
        font-weight: 800;
        color: #888;

        /* 1. Center the titles */
        text-align: center;

        /* 2. KILL THE LINE */
        border-bottom: none !important; /* Added !important just to be absolutely sure nothing overrides it */

        /* 3. Set exact 4px spacing */
        margin-bottom: 4px;
        padding-bottom: 0;
    }

    /* --- PATCH: COMPACT APPROVER BOX STYLES --- */
.approver-content { 
    height: 100%; 
    display: flex; 
    flex-direction: column; 
    justify-content: center; /* Centers everything vertically */
    align-items: center; 
    overflow: hidden; /* Safety: chops anything that tries to escape */
}

.approver-sig-img {
    max-height: 45px; /* CRITICAL: Prevents image from exploding */
    width: auto;
    object-fit: contain;
    margin-bottom: 2px;
}

.approver-name {
    font-family: 'Manrope', sans-serif; 
    color: #000; 
    font-weight: 800; 
    font-size: 0.6rem; 
    text-transform: uppercase;
    line-height: 1.1;
    margin-bottom: 2px;
}

.verification-details {
    font-family: monospace; 
    font-size: 0.45rem; /* Small high-density font */
    color: #000; 
    font-weight: 700; 
    text-align: center; 
    line-height: 1;
}

    /* --- FIX: ABSOLUTE FOOTER --- */
    .page-footer { 
        position: absolute; 
        bottom: 8mm; 
        left: 15mm; 
        right: 15mm;
        width: auto;
        
        border-top: 1px solid #EE7D04; 
        padding-top: 5px; 
        font-size: 0.6rem; 
        color: #777; 
        display: flex; 
        justify-content: space-between; 
    }

    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  </style>
</head>
<body>${html}</body>
</html>`);
    doc.close();
    iframe.onload = () => {
      setTimeout(() => {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        setTimeout(() => { try { document.body.removeChild(iframe); } catch (_) {} }, 1000);
      }, 500);
    };
  } catch (e) { console.error(e); alert('Print failed: ' + e.message); }
}

(function hardenPrintPipeline(){
  const ensurePrintRoot = () => {
    const printRoot = document.getElementById('print-root');
    if (!printRoot) return;

    // If already populated, do nothing
    if (printRoot.innerHTML && printRoot.innerHTML.trim() !== '') return;

    // Fallback: clone from preview container (modal)
    const preview = document.getElementById('print-container');
    if (preview && preview.innerHTML.trim() !== '') {
      printRoot.innerHTML = `<div id="print-container">${preview.innerHTML}</div>`;
      return;
    }

    // Last resort: render a non-blank diagnostic page so printing is never empty
    printRoot.innerHTML = `
      <div id="print-container">
        <div class="a4-page">
          <div style="font-family:Manrope,sans-serif; padding:12mm;">
            <h3 style="margin:0 0 8px 0;">Print Preview Not Generated</h3>
            <div style="font-size:12px; color:#444;">
              Please click "Print / Preview" first to generate the printable content.
            </div>
          </div>
        </div>
      </div>
    `;
  };

  window.addEventListener('beforeprint', ensurePrintRoot);

  // Optional: If your users click the modal button too fast, this also helps
  window.ensurePrintRoot = ensurePrintRoot;
})();

      </script>
<div class="modal fade" id="approvalModal" tabindex="-1" aria-hidden="true" data-bs-backdrop="static">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content border-0 shadow-lg">
      <div class="modal-header border-0 pb-0">
        <h5 class="modal-title fw-bold text-dark">Confirm Approval</h5>
      </div>
      <div class="modal-body text-center py-4">
        <div class="mb-3">
            <i class="fa-solid fa-file-signature text-primary" style="font-size: 3rem;"></i>
        </div>
        <p class="mb-1 fw-bold">Do you wish to affix your digital signature to this document?</p>
        <p class="text-muted small">This action will lock the costing and apply the MD stamp.</p>
      </div>
      <div class="modal-footer border-0 justify-content-center pt-0 pb-4">
        <button type="button" class="btn btn-light fw-bold" data-bs-dismiss="modal">Cancel</button>
        <button type="button" class="btn btn-dark fw-bold px-4" onclick="confirmApproval()">
            <i class="fa-solid fa-pen-nib me-2"></i>Affix Signature
        </button>
      </div>
    </div>
  </div>
</div>
<!-- PRINT ROOT (always present; used for Ctrl+P and Print button) -->
<div id="print-root"></div>
</body>
</html>