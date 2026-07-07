<?php
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
$role      = strtoupper((string)($me['role'] ?? 'ADMIN'));
$roleLabel = $roleLabelMap[$role] ?? 'ADMIN';

// --- Avatar: UI Avatars based on name ---
$avatarName = urlencode($fullName);
$avatarUrl  = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";

// --- Greeting ---
$hour     = (int)date('H');
$greeting = ($hour < 12) ? 'Good morning' : (($hour < 18) ? 'Good afternoon' : 'Good evening');

function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OCR | Operational Cost Reconciliation System</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&family=Montserrat:wght@400;500;600;700;800;900&family=Inconsolata:wght@400;500;700;900&display=swap" rel="stylesheet">

  <style>
    /* Keep your OCR styles intact */
    :root {
      --brand-blue: #1F99D8;
      --brand-blue-dark: #125b80;
      --brand-dark: #055B83;
      --brand-orange: #EE7D04;
      --brand-orange-hover: #d16d02;
      --brand-charcoal: #231F20;

      --state-draft-bg: #F3F4F6; --state-draft-text: #4B5563;
      --state-submitted-bg: #FFF7ED; --state-submitted-text: #C2410C;
      --state-validated-bg: #ECFDF5; --state-validated-text: #047857;
      --state-rejected-bg: #FEF2F2; --state-rejected-text: #B91C1C;

      --bg-body: #F8FAFC;
      --bg-card: #FFFFFF;
      --border-color: #E2E8F0;
      --border-focus: #1F99D8;

      --sidebar-w: 280px;
      --header-h: 70px;

      --font-main: 'Manrope', sans-serif;
      --font-head: 'Montserrat', sans-serif;
      --font-code: 'Inconsolata', monospace;
    }

    * { box-sizing: border-box; outline: none; }
    body {
      font-family: var(--font-main);
      background: var(--bg-body);
      color: var(--brand-charcoal);
      font-size: 0.85rem;
      overflow-x: hidden;
    }

    h1, h2, h3, h4, h5, .font-heading { font-family: var(--font-head); }
    .font-mono { font-family: var(--font-code); letter-spacing: -0.5px; }
    .fw-black { font-weight: 800; }
    .fw-bold { font-weight: 700; }

    .text-orange { color: var(--brand-orange) !important; }
    .bg-orange { background-color: var(--brand-orange) !important; }

    .btn { font-weight: 700; border-radius: 6px; padding: 0.5rem 1rem; font-size: 0.85rem; }
    .btn-primary { background: var(--brand-blue); border-color: var(--brand-blue); }
    .btn-primary:hover { background: var(--brand-blue-dark); border-color: var(--brand-blue-dark); }
    .btn-orange { background: var(--brand-orange); border-color: var(--brand-orange); color: white; }
    .btn-orange:hover { background: var(--brand-orange-hover); border-color: var(--brand-orange-hover); color: white; }


    /* Keep your KPI + grid styles */
    .kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; margin-bottom: 32px; }
    .kpi-card {
      background: white; border: 1px solid var(--border-color); border-radius: 12px; padding: 24px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.01); display: flex; flex-direction: column;
      position: relative; overflow: hidden;
    }
    .kpi-card::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--brand-blue); }
    .kpi-card.warning::before { background: var(--brand-orange); }
    .kpi-card.success::before { background: #10B981; }

    .kpi-title { font-size: 0.7rem; font-weight: 800; text-transform: uppercase; color: #64748B; margin-bottom: 8px; }
    .kpi-value { font-size: 1.8rem; font-weight: 800; color: var(--brand-charcoal); font-family: var(--font-code); letter-spacing: -1px; }
    .kpi-sub { font-size: 0.75rem; color: #94A3B8; margin-top: 4px; }

    .grid-container { background: white; border: 1px solid var(--border-color); border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.02); overflow: hidden; }
    .grid-toolbar { padding: 20px 24px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; }

    .master-table { width: 100%; border-collapse: collapse; }
    .master-table th {
      background: #F8FAFC; padding: 14px 20px; text-align: left;
      font-size: 0.7rem; font-weight: 800; text-transform: uppercase; color: #64748B;
      border-bottom: 1px solid var(--border-color);
    }
    .master-table td { padding: 16px 20px; border-bottom: 1px solid #F1F5F9; font-size: 0.9rem; vertical-align: middle; color: #334155; }
    .master-table tr:hover { background: #FAFAFA; }

    .status-pill { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 4px; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; }
    .st-draft { background: var(--state-draft-bg); color: var(--state-draft-text); }
    .st-submitted { background: var(--state-submitted-bg); color: var(--state-submitted-text); }
    .st-validated { background: var(--state-validated-bg); color: var(--state-validated-text); }
    .st-rejected { background: var(--state-rejected-bg); color: var(--state-rejected-text); }

    /* Modal styles remain unchanged (your original) */
    .modal-ocr-fs { width: 98vw; max-width: 1800px; margin: 1vh auto; height: 98vh; }
    .modal-content { height: 100%; border-radius: 8px; border: none; background: #F1F5F9; display: flex; flex-direction: column; overflow: hidden; }
    .modal-header { background: white; padding: 16px 30px; border-bottom: 1px solid var(--border-color); flex-shrink: 0; }
    .modal-footer { background: white; padding: 16px 30px; border-top: 1px solid var(--border-color); flex-shrink: 0; }
    .modal-body { padding: 0; flex: 1; overflow: hidden; display: flex; }

    .ocr-sidebar { width: 350px; background: white; border-right: 1px solid var(--border-color); display: flex; flex-direction: column; overflow-y: auto; }
    .ocr-sidebar-section { padding: 24px; border-bottom: 1px solid var(--border-color); }
    .ocr-section-head { font-size: 0.7rem; font-weight: 800; text-transform: uppercase; color: var(--brand-blue); margin-bottom: 16px; letter-spacing: 0.5px; }

    .info-pair { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 0.85rem; }
    .info-key { color: #64748B; font-weight: 600; }
    .info-val { color: var(--brand-charcoal); font-weight: 700; text-align: right; }

    .viz-box {
      background: #F8FAFC; border: 1px solid var(--border-color); border-radius: 8px;
      padding: 20px; height: 220px; position: relative; display: flex; flex-direction: column; justify-content: flex-end;
    }
    .bar-container { display: flex; justify-content: center; gap: 30px; align-items: flex-end; height: 100%; padding-bottom: 20px; border-bottom: 2px solid #CBD5E1; }
    .viz-bar { width: 60px; border-radius: 4px 4px 0 0; position: relative; transition: height 0.6s cubic-bezier(0.34, 1.56, 0.64, 1); }
    .viz-bar-val { position: absolute; top: -25px; width: 100%; text-align: center; font-family: var(--font-code); font-weight: 800; font-size: 0.8rem; }
    .viz-label { text-align: center; margin-top: 10px; font-size: 0.7rem; font-weight: 800; color: #64748B; }

    .bar-budget { background: var(--brand-blue); }
    .bar-actual { background: var(--brand-orange); }

    .ocr-main { flex: 1; padding: 30px; overflow-y: auto; }
    .lines-card { background: white; border: 1px solid var(--border-color); border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.01); }

    .lines-table { width: 100%; border-collapse: separate; border-spacing: 0; }
    .lines-table th {
      position: sticky; top: 0; background: #F8FAFC; z-index: 10;
      padding: 12px 16px; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; color: #64748B;
      border-bottom: 2px solid var(--border-color);
    }
    .lines-table td { padding: 10px 16px; border-bottom: 1px solid #F1F5F9; vertical-align: top; background: white; }

    .inp-money {
      width: 100%; padding: 8px 12px; border: 1px solid #CBD5E1; border-radius: 4px;
      font-family: var(--font-code); font-weight: 700; text-align: right; color: var(--brand-charcoal);
      transition: all 0.2s;
    }
    .inp-money:focus { border-color: var(--brand-blue); box-shadow: 0 0 0 3px rgba(31, 153, 216, 0.15); }
    .inp-money:read-only { background: #F1F5F9; color: #64748B; border-color: transparent; }

    .inp-text {
      width: 100%; padding: 8px 12px; border: 1px solid #CBD5E1; border-radius: 4px;
      font-size: 0.85rem; transition: all 0.2s;
    }
    .inp-text:focus { border-color: var(--brand-blue); }
    .inp-text:read-only { background: #F1F5F9; color: #64748B; border-color: transparent; }

    .row-overrun td { background: #FEF2F2 !important; }
    .row-overrun .inp-money { border-color: #EF4444; color: #B91C1C; background: #FFF; }
    .req-doc-highlight { border-color: #F59E0B !important; background: #FFFBEB !important; }
    .req-doc-highlight::placeholder { color: #D97706; font-weight: 700; }

    #print-container { display: none; }
    @media print {
      @page { size: A4 landscape; margin: 10mm; }
      body * { visibility: hidden; }
      #print-container, #print-container * { visibility: visible; }
      #print-container {
        position: absolute; top: 0; left: 0; width: 100%;
        font-family: 'Arial', sans-serif; color: #000;
        background: white;
      }
      .p-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #000; padding-bottom: 15px; margin-bottom: 20px; }
      .p-logo { font-size: 24px; font-weight: 900; text-transform: uppercase; margin-bottom: 5px; }
      .p-sub { font-size: 11px; color: #444; }
      .p-doc-title { font-size: 20px; font-weight: 900; border: 2px solid #000; padding: 5px 15px; text-transform: uppercase; }

      .p-meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; border: 1px solid #000; padding: 10px; margin-bottom: 20px; background: #eee; }
      .p-meta div strong { display: block; font-size: 10px; text-transform: uppercase; }
      .p-meta div span { font-size: 12px; font-weight: bold; }

      .p-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 20px; }
      .p-table th { background: #333; color: white !important; -webkit-print-color-adjust: exact; padding: 6px; text-transform: uppercase; font-weight: bold; text-align: left; }
      .p-table td { border-bottom: 1px solid #ccc; padding: 6px; }
      .p-num { text-align: right; font-family: 'Courier New', monospace; font-weight: bold; }
      .p-total-row td { border-top: 2px solid #000; font-weight: 900; background: #eee; -webkit-print-color-adjust: exact; }

      .p-footer { display: flex; justify-content: space-between; margin-top: 40px; border-top: 1px solid #000; padding-top: 10px; }
      .p-sig-col { width: 30%; text-align: center; }
      .p-sig-title { font-size: 10px; font-weight: bold; text-transform: uppercase; background: #eee; border: 1px solid #ccc; padding: 3px; margin-bottom: 40px; -webkit-print-color-adjust: exact; }
      .p-sig-line { border-bottom: 1px dashed #000; margin: 0 20px; }
    }
  </style>
</head>
<body>

  <!-- ===== SIDEBAR (from index.php) ===== -->
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


  <!-- ===== TOP NAVBAR (from index.php) ===== -->
  <div class="top-navbar">
    <div>
      <h5 class="mb-0 fw-bold text-dark">Operational Cost Reconciliation (OCR)</h5>
      <small class="text-muted" style="font-size: 0.7rem;">EXPENSE VALIDATION & CLOSING</small>
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

  <!-- ===== PAGE CONTENT (use index.php wrapper class) ===== -->
  <div class="main-content px-4 pb-5 " style>

    <!-- OPTIONAL: keep a small welcome strip consistent with admin style -->
    <div class="row pt-4 mb-4">
      <div class="col-12">
        <div class="welcome-card d-flex justify-content-between align-items-center">
          <div>
            <h2 class="fw-bold mb-1"><?php echo e($greeting); ?>, <?php echo e($firstName); ?>!</h2>
            <p class="mb-0 opacity-75">OCR console ready. Manage reconciliations, validate cost lines, and close variances.</p>
          </div>
          <div class="text-end" style="min-width: 150px;">
            <div class="mb-1 text-uppercase text-white-50" style="font-size: 0.7rem; font-weight: 800;">Module Status</div>
            <div class="d-flex align-items-center justify-content-end gap-2">
              <i class="fa-solid fa-circle-check text-success fs-5"></i>
              <span class="fw-bold fs-5">ONLINE</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== YOUR ORIGINAL OCR BODY STARTS HERE (unchanged structure) ===== -->

    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-title">Active Reconciliations</div>
        <div class="kpi-value" id="kpiActive">0</div>
        <div class="kpi-sub">In Draft / Submitted</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Total Budget Managed</div>
        <div class="kpi-value" id="kpiTotalBudget">0</div>
        <div class="kpi-sub">XAF (Open Files)</div>
      </div>
      <div class="kpi-card warning">
        <div class="kpi-title">Actual Spend</div>
        <div class="kpi-value text-orange" id="kpiTotalActual">0</div>
        <div class="kpi-sub">XAF (Pending Valid)</div>
      </div>
      <div class="kpi-card success">
        <div class="kpi-title">Closed Variance</div>
        <div class="kpi-value text-success" id="kpiVariance">+0%</div>
        <div class="kpi-sub">Efficiency Rate</div>
      </div>
    </div>

    <div class="grid-container">
      <div class="grid-toolbar">
        <div class="d-flex align-items-center gap-3">
          <h6 class="m-0 fw-black text-dark"><i class="fa-solid fa-list-check me-2 text-muted"></i>OCR Register</h6>
          <span class="badge bg-light text-dark border" id="roleHint">Logged as Operations</span>
        </div>
        <div class="d-flex gap-2">
          <input type="text" class="form-control form-control-sm" placeholder="Search File Ref..." style="width: 200px;">
          <button class="btn btn-orange btn-sm" id="btnNewOCR" onclick="openOCRModal()">
            <i class="fa-solid fa-plus me-2"></i>New Reconciliation
          </button>
        </div>
      </div>
      <table class="master-table">
        <thead>
          <tr>
            <th>OCR ID</th>
            <th>Date</th>
            <th>File Reference</th>
            <th>Client / Service</th>
            <th>Budget</th>
            <th>Actual</th>
            <th>Status</th>
            <th class="text-end">Actions</th>
          </tr>
        </thead>
        <tbody id="ocrTableBody"></tbody>
      </table>
    </div>

    <!-- ===== Modal + Print Container (unchanged) ===== -->
    <div class="modal fade" id="ocrModal" tabindex="-1" data-bs-backdrop="static" data-bs-keyboard="false">
      <div class="modal-dialog modal-ocr-fs">
        <div class="modal-content">

          <div class="modal-header">
            <div class="d-flex align-items-center gap-3">
              <div class="bg-primary text-white rounded p-2"><i class="fa-solid fa-scale-unbalanced fs-4"></i></div>
              <div>
                <h5 class="fw-black font-head m-0" id="modalTitle">Create Reconciliation</h5>
                <small class="text-muted font-mono" id="modalSub">ID: <span id="ocrIdDisplay">NEW</span></small>
              </div>
            </div>
            <div class="d-flex gap-2 align-items-center">
              <span class="badge status-pill st-draft me-3" id="modalStatusBadge">DRAFT</span>
              <button class="btn btn-outline-dark" id="btnPrint" onclick="triggerPrint()" disabled><i class="fa-solid fa-print me-2"></i>Print</button>
              <button type="button" class="btn-close ms-2" data-bs-dismiss="modal"></button>
            </div>
          </div>

          <div class="modal-body">

            <div class="ocr-sidebar">
              <div class="ocr-sidebar-section">
                <div class="ocr-section-head">1. File Context</div>
                <div class="mb-3">
                  <label class="small fw-bold text-muted mb-1">Select Operations File</label>
                  <select class="form-select border-primary fw-bold" id="fileSelect" onchange="loadFileContext(this.value)">
                    <option value="">-- Select Approved File --</option>
                  </select>
                </div>
                <div class="info-pair"><span class="info-key">Client:</span><span class="info-val" id="ctxClient">---</span></div>
                <div class="info-pair"><span class="info-key">Service:</span><span class="info-val" id="ctxService">---</span></div>
                <div class="info-pair"><span class="info-key">Cost Ref:</span><span class="info-val text-primary" id="ctxCostRef">---</span></div>
              </div>

              <div class="ocr-sidebar-section flex-grow-1 d-flex flex-column">
                <div class="ocr-section-head">2. Performance Viz</div>
                <div class="viz-box">
                  <div class="bar-container">
                    <div class="viz-bar bar-budget" id="barBudget" style="height: 0%">
                      <div class="viz-bar-val text-primary" id="valBudget">0</div>
                    </div>
                    <div class="viz-bar bar-actual" id="barActual" style="height: 0%">
                      <div class="viz-bar-val text-orange" id="valActual">0</div>
                    </div>
                  </div>
                  <div class="viz-label">BUDGET vs ACTUAL</div>
                </div>
                <div class="mt-4 text-center">
                  <div class="small text-muted fw-bold text-uppercase">Variance Grade</div>
                  <div class="fs-2 fw-black" id="gradeText">---</div>
                  <div class="small" id="gradeDesc">Select file to begin</div>
                </div>
              </div>
            </div>

            <div class="ocr-main">
              <div class="d-flex justify-content-between align-items-center mb-3">
                <div class="ocr-section-head mb-0">3. Cost Lines (Mandatory Validation)</div>
                <div class="fs-5 fw-black text-end">
                  Net Variance: <span id="totalVariance" class="font-mono">0 XAF</span>
                </div>
              </div>

              <div class="lines-card">
                <form id="ocrForm">
                  <table class="lines-table">
                    <thead>
                      <tr>
                        <th style="width:10%">Code</th>
                        <th style="width:25%">Description</th>
                        <th style="width:15%; text-align:right">Budget</th>
                        <th style="width:15%; text-align:right">Actual Spent</th>
                        <th style="width:15%; text-align:right">Variance</th>
                        <th style="width:20%">Doc Ref / Notes</th>
                      </tr>
                    </thead>
                    <tbody id="linesBody">
                      <tr><td colspan="6" class="text-center py-5 text-muted">Please select a file to load cost lines.</td></tr>
                    </tbody>
                  </table>
                </form>
              </div>
            </div>

          </div>

          <div class="modal-footer">
            <div class="d-flex justify-content-between w-100 align-items-center">
              <div class="text-muted small">
                <i class="fa-solid fa-circle-info me-1"></i>
                <span id="footerMsg">Operations Mode: Enter actuals and supporting docs.</span>
              </div>
              <div class="d-flex gap-2" id="actionButtons"></div>
            </div>
          </div>

        </div>
      </div>
    </div>

    <div id="print-container">
      <!-- (unchanged print container content) -->
      <div class="p-header">
        <div>
          <div class="p-logo">SMART LOGISTICS & SERVICES</div>
          <div class="p-sub">Operational Cost Reconciliation Sheet</div>
          <div class="p-sub">Printed: <span id="pPrintDate"></span></div>
        </div>
        <div class="p-doc-title" id="pDocId">SLAS-OCR-XXXX</div>
      </div>

      <div class="p-meta">
        <div><strong>File Ref</strong><span id="pRef">---</span></div>
        <div><strong>Client</strong><span id="pClient">---</span></div>
        <div><strong>Service</strong><span id="pService">---</span></div>
        <div><strong>Status</strong><span id="pStatus">---</span></div>
      </div>

      <table class="p-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Description</th>
            <th class="p-num">Budget</th>
            <th class="p-num">Actual</th>
            <th class="p-num">Variance</th>
            <th>Ref / Notes</th>
          </tr>
        </thead>
        <tbody id="pTableBody"></tbody>
        <tfoot>
          <tr class="p-total-row">
            <td colspan="2">TOTALS</td>
            <td class="p-num" id="pTotBud">0</td>
            <td class="p-num" id="pTotAct">0</td>
            <td class="p-num" id="pTotVar">0</td>
            <td></td>
          </tr>
        </tfoot>
      </table>

      <div style="margin-bottom: 20px; border: 1px solid #000; padding: 10px;">
        <div style="font-size: 10px; font-weight: bold; text-transform: uppercase;">Performance Note:</div>
        <div style="font-size: 12px;" id="pPerfNote">---</div>
      </div>

      <div class="p-footer">
        <div class="p-sig-col">
          <div class="p-sig-title">PREPARED BY (OPERATIONS)</div>
          <div style="height: 40px;"></div>
          <div class="p-sig-line"></div>
          <div style="font-size: 10px; margin-top: 5px;">Signature & Date</div>
        </div>
        <div class="p-sig-col">
          <div class="p-sig-title">VALIDATED BY (FINANCE)</div>
          <div style="height: 40px;"></div>
          <div class="p-sig-line"></div>
          <div style="font-size: 10px; margin-top: 5px;">Signature & Date</div>
        </div>
        <div class="p-sig-col">
          <div class="p-sig-title">APPROVED BY (MANAGEMENT)</div>
          <div style="height: 40px; font-family: 'Courier New'; font-weight: bold; font-size: 14px; padding-top: 10px;">
            Timothée MASSOMBA
          </div>
          <div class="p-sig-line"></div>
          <div style="font-size: 10px; margin-top: 5px;">Managing Director</div>
        </div>
      </div>
    </div>

  </div><!-- /.main-content -->

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

  <script>
    // --- Minimal clock support (topbar expects these IDs + toggleClock) ---
    (function initClock() {
      const el = document.getElementById('realtime-clock');
      if (!el) return;

      function tick() {
        const d = new Date();
        const hh = String(d.getHours()).padStart(2,'0');
        const mm = String(d.getMinutes()).padStart(2,'0');
        const ss = String(d.getSeconds()).padStart(2,'0');
        el.textContent = `${hh}:${mm}:${ss}`;
      }
      tick();
      setInterval(tick, 1000);
    })();

    function toggleClock() {
      // If admin.js already defines this, this will be ignored by load order.
      const btn = document.getElementById('btn-clock');
      if (!btn) return;
      const span = btn.querySelector('span');
      const isIn = btn.dataset.state === 'IN';
      btn.dataset.state = isIn ? 'OUT' : 'IN';
      if (span) span.textContent = isIn ? 'Clock In' : 'Clock Out';
    }
  </script>

  <!-- ===== YOUR OCR ENGINE SCRIPT (unchanged, paste exactly as-is) ===== -->
  <script>
    /**
     * SMART LS - OCR ENGINE V2.0 (FULL WORKFLOW)
     * (Your original JS is unchanged below)
     */

    let CURRENT_ROLE = 'OPS';

    const EXPENSE_DICT = {
      "60001": { desc: "Trucking / Transport", reqDoc: false },
      "60005": { desc: "Border Crossing Fees", reqDoc: false },
      "60100": { desc: "Mission Per Diem", reqDoc: true },
      "60205": { desc: "Fuel / Lubricants", reqDoc: true },
      "60400": { desc: "Third Party Services", reqDoc: true },
      "53001": { desc: "Customs Validation", reqDoc: true },
      "53003": { desc: "Demurrage Charges", reqDoc: true }
    };

    const OPS_FILES = [
      {
        id: "SLAS-FR-24-004",
        client: "TOTAL ENERGIES",
        service: "Hinterland Logistics",
        costRef: "BUD-004",
        status: "OPEN",
        lines: [
          { code: "60001", bud: 2500000 },
          { code: "60205", bud: 150000 },
          { code: "60005", bud: 50000 },
          { code: "60100", bud: 120000 }
        ]
      },
      {
        id: "SLAS-FR-24-008",
        client: "MAERSK CAMEROON",
        service: "Import Clearance",
        costRef: "BUD-009",
        status: "OPEN",
        lines: [
          { code: "53001", bud: 25000 },
          { code: "53003", bud: 40000 },
          { code: "60400", bud: 150000 }
        ]
      }
    ];

    let OCR_DB = [];
    let currentOCR = null;
    let currentFile = null;

    document.addEventListener('DOMContentLoaded', () => {
      renderDashboard();
      switchRole('OPS');
    });

    function switchRole(role) {
      CURRENT_ROLE = role;

      const badge = document.getElementById('activeRoleBadge');
      const avatar = document.getElementById('userAvatar');
      const hint = document.getElementById('roleHint');
      const btnNew = document.getElementById('btnNewOCR');

      // These elements exist only in your old top header; keep logic safe
      if (badge && avatar) {
        if (role === 'OPS') {
          badge.className = 'role-badge ops'; badge.innerText = 'OPERATIONS';
          avatar.innerText = 'OP';
        } else if (role === 'FIN') {
          badge.className = 'role-badge fin'; badge.innerText = 'FINANCE';
          avatar.innerText = 'FN';
        } else {
          badge.className = 'role-badge admin'; badge.innerText = 'MANAGEMENT';
          avatar.innerText = 'MD';
        }
      }

      if (hint) {
        hint.innerText = role === 'OPS' ? 'Logged as Operations' : (role === 'FIN' ? 'Logged as Finance' : 'View Only');
      }
      if (btnNew) {
        btnNew.style.display = (role === 'OPS') ? 'block' : 'none';
      }

      renderDashboard();
    }

    function renderDashboard() {
      const tbody = document.getElementById('ocrTableBody');
      tbody.innerHTML = '';

      let activeCount = 0;
      let totalBud = 0;
      let totalAct = 0;

      if (OCR_DB.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-muted">No reconciliations found. Operations initiate via "New Reconciliation".</td></tr>`;
      }

      OCR_DB.forEach((ocr, idx) => {
        if (ocr.status !== 'VALIDATED') activeCount++;
        totalBud += ocr.totalBud;
        totalAct += ocr.totalAct;

        let actionBtn = '';

        if (CURRENT_ROLE === 'OPS') {
          if (ocr.status === 'DRAFT' || ocr.status === 'REJECTED') {
            actionBtn = `<button class="btn btn-sm btn-outline-primary" onclick="loadOCR(${idx})"><i class="fa-solid fa-pen"></i> Edit</button>`;
          } else {
            actionBtn = `<button class="btn btn-sm btn-light border" onclick="loadOCR(${idx})"><i class="fa-solid fa-eye"></i> View</button>`;
          }
        } else if (CURRENT_ROLE === 'FIN') {
          if (ocr.status === 'SUBMITTED') {
            actionBtn = `<button class="btn btn-sm btn-success text-white" onclick="loadOCR(${idx})"><i class="fa-solid fa-check-double"></i> Validate</button>`;
          } else {
            actionBtn = `<button class="btn btn-sm btn-light border" onclick="loadOCR(${idx})"><i class="fa-solid fa-eye"></i> View</button>`;
          }
        } else {
          actionBtn = `<button class="btn btn-sm btn-light border" onclick="loadOCR(${idx})"><i class="fa-solid fa-eye"></i> View</button>`;
        }

        const statusClass = `st-${ocr.status.toLowerCase()}`;

        tbody.innerHTML += `
          <tr>
            <td class="font-mono fw-bold text-primary">${ocr.id}</td>
            <td>${ocr.date}</td>
            <td class="fw-bold">${ocr.fileId}</td>
            <td>
              <div>${ocr.client}</div>
              <small class="text-muted">${ocr.service}</small>
            </td>
            <td class="font-mono">${ocr.totalBud.toLocaleString()}</td>
            <td class="font-mono">${ocr.totalAct.toLocaleString()}</td>
            <td><span class="status-pill ${statusClass}">${ocr.status}</span></td>
            <td class="text-end">${actionBtn}</td>
          </tr>
        `;
      });

      document.getElementById('kpiActive').innerText = activeCount;
      document.getElementById('kpiTotalBudget').innerText = totalBud.toLocaleString();
      document.getElementById('kpiTotalActual').innerText = totalAct.toLocaleString();

      const varPct = totalBud > 0 ? ((totalBud - totalAct) / totalBud * 100).toFixed(1) : 0;
      const kpiVar = document.getElementById('kpiVariance');
      kpiVar.innerText = (varPct > 0 ? "+" : "") + varPct + "%";
      kpiVar.className = varPct >= 0 ? "kpi-value text-success" : "kpi-value text-danger";
    }

    function openOCRModal() {
      currentOCR = {
        id: "SLAS-OCR-" + (1000 + OCR_DB.length),
        status: "DRAFT",
        lines: []
      };
      currentFile = null;

      document.getElementById('modalTitle').innerText = "New Reconciliation";
      document.getElementById('ocrIdDisplay').innerText = currentOCR.id;
      document.getElementById('modalStatusBadge').innerText = "DRAFT";
      document.getElementById('modalStatusBadge').className = "badge status-pill st-draft me-3";

      const sel = document.getElementById('fileSelect');
      sel.value = "";
      sel.disabled = false;

      document.getElementById('linesBody').innerHTML =
        '<tr><td colspan="6" class="text-center py-5 text-muted">Please select a file to load cost lines.</td></tr>';

      resetSidebar();
      renderButtons();

      new bootstrap.Modal(document.getElementById('ocrModal')).show();
    }

    function loadOCR(idx) {
      currentOCR = OCR_DB[idx];
      currentFile = OPS_FILES.find(f => f.id === currentOCR.fileId);

      document.getElementById('modalTitle').innerText = "Reconciliation Details";
      document.getElementById('ocrIdDisplay').innerText = currentOCR.id;
      document.getElementById('modalStatusBadge').innerText = currentOCR.status;
      document.getElementById('modalStatusBadge').className = `badge status-pill st-${currentOCR.status.toLowerCase()} me-3`;

      const sel = document.getElementById('fileSelect');
      sel.innerHTML = `<option value="${currentFile.id}">${currentFile.id} - ${currentFile.client}</option>`;
      sel.value = currentFile.id;
      sel.disabled = true;

      updateSidebarContext();
      renderLines();
      calculateTotals();
      renderButtons();

      new bootstrap.Modal(document.getElementById('ocrModal')).show();
    }

    // Populate File Select Options
    const fileSel = document.getElementById('fileSelect');
    OPS_FILES.forEach(f => {
      if (f.status === 'OPEN') {
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.text = `${f.id} - ${f.client} (${f.service})`;
        fileSel.appendChild(opt);
      }
    });

    function loadFileContext(fileId) {
      if (!fileId) return;
      currentFile = OPS_FILES.find(f => f.id === fileId);

      currentOCR.fileId = fileId;
      currentOCR.client = currentFile.client;
      currentOCR.service = currentFile.service;
      currentOCR.date = new Date().toISOString().split('T')[0];

      currentOCR.lines = currentFile.lines.map(l => ({
        code: l.code,
        desc: EXPENSE_DICT[l.code].desc,
        reqDoc: EXPENSE_DICT[l.code].reqDoc,
        bud: l.bud,
        act: 0,
        docRef: ""
      }));

      updateSidebarContext();
      renderLines();
      calculateTotals();
    }

    function updateSidebarContext() {
      document.getElementById('ctxClient').innerText = currentFile.client;
      document.getElementById('ctxService').innerText = currentFile.service;
      document.getElementById('ctxCostRef').innerText = currentFile.costRef;
    }

    function resetSidebar() {
      document.getElementById('ctxClient').innerText = "---";
      document.getElementById('ctxService').innerText = "---";
      document.getElementById('ctxCostRef').innerText = "---";
      document.getElementById('barBudget').style.height = "0%";
      document.getElementById('barActual').style.height = "0%";
      document.getElementById('valBudget').innerText = "0";
      document.getElementById('valActual').innerText = "0";
      document.getElementById('gradeText').innerText = "---";
      const gd = document.getElementById('gradeDesc');
      if (gd) gd.innerText = "Select file to begin";
    }

    function renderLines() {
      const tbody = document.getElementById('linesBody');
      tbody.innerHTML = '';

      const isEditable = (CURRENT_ROLE === 'OPS' && (currentOCR.status === 'DRAFT' || currentOCR.status === 'REJECTED'));

      currentOCR.lines.forEach((line, index) => {
        const variance = line.bud - line.act;
        const isOverrun = variance < 0;

        let rowClass = isOverrun ? 'row-overrun' : '';
        let docPlaceholder = line.reqDoc ? "REQ: Invoice/Receipt Ref..." : "Observation...";

        tbody.innerHTML += `
          <tr class="${rowClass}">
            <td class="font-mono text-muted">${line.code}</td>
            <td>
              <div class="fw-bold text-dark">${line.desc}</div>
              ${line.reqDoc ? '<span class="badge bg-warning text-dark" style="font-size:0.6rem">DOC REQ</span>' : ''}
            </td>
            <td><input type="text" class="inp-money" value="${line.bud.toLocaleString()}" readonly></td>
            <td>
              <input type="number" class="inp-money" id="act_${index}"
                value="${line.act === 0 ? '' : line.act}" placeholder="0"
                oninput="updateLine(${index})" ${isEditable ? '' : 'readonly'}>
            </td>
            <td><input type="text" class="inp-money ${isOverrun ? 'text-danger' : 'text-success'}" value="${variance.toLocaleString()}" readonly id="var_${index}"></td>
            <td>
              <input type="text" class="inp-text ${line.reqDoc && line.act > 0 && !line.docRef ? 'req-doc-highlight' : ''}"
                id="doc_${index}" value="${line.docRef}"
                placeholder="${docPlaceholder}"
                oninput="updateLine(${index})" ${isEditable ? '' : 'readonly'}>
            </td>
          </tr>
        `;
      });
    }

    function updateLine(index) {
      const actVal = parseFloat(document.getElementById(`act_${index}`).value) || 0;
      const docVal = document.getElementById(`doc_${index}`).value;

      currentOCR.lines[index].act = actVal;
      currentOCR.lines[index].docRef = docVal;

      const variance = currentOCR.lines[index].bud - actVal;
      const varInput = document.getElementById(`var_${index}`);
      varInput.value = variance.toLocaleString();

      if (variance < 0) {
        varInput.classList.remove('text-success'); varInput.classList.add('text-danger');
        varInput.closest('tr').classList.add('row-overrun');
      } else {
        varInput.classList.add('text-success'); varInput.classList.remove('text-danger');
        varInput.closest('tr').classList.remove('row-overrun');
      }

      const docInput = document.getElementById(`doc_${index}`);
      if (currentOCR.lines[index].reqDoc && actVal > 0 && !docVal) docInput.classList.add('req-doc-highlight');
      else docInput.classList.remove('req-doc-highlight');

      calculateTotals();
    }

    function calculateTotals() {
      let totBud = 0;
      let totAct = 0;

      currentOCR.lines.forEach(l => {
        totBud += l.bud;
        totAct += l.act;
      });

      currentOCR.totalBud = totBud;
      currentOCR.totalAct = totAct;

      const netVar = totBud - totAct;

      const varEl = document.getElementById('totalVariance');
      varEl.innerText = netVar.toLocaleString() + " XAF";
      varEl.className = netVar >= 0 ? "font-mono text-success" : "font-mono text-danger";

      const max = Math.max(totBud, totAct) || 1;
      document.getElementById('barBudget').style.height = (totBud / max * 100) + "%";
      document.getElementById('barActual').style.height = (totAct / max * 100) + "%";
      document.getElementById('valBudget').innerText = (totBud / 1000).toFixed(0) + "k";
      document.getElementById('valActual').innerText = (totAct / 1000).toFixed(0) + "k";

      const gradeEl = document.getElementById('gradeText');
      const gradeDesc = document.getElementById('gradeDesc');

      if (totAct === 0) {
        gradeEl.innerText = "PENDING"; gradeEl.className = "fs-2 fw-black text-muted";
        gradeDesc.innerText = "Awaiting Inputs";
      } else if (netVar >= 0) {
        gradeEl.innerText = "EFFICIENT"; gradeEl.className = "fs-2 fw-black text-success";
        gradeDesc.innerText = `Under Budget by ${((netVar / totBud) * 100).toFixed(1)}%`;
      } else {
        gradeEl.innerText = "OVERRUN"; gradeEl.className = "fs-2 fw-black text-danger";
        gradeDesc.innerText = `Budget Exceeded by ${Math.abs(((netVar / totBud) * 100)).toFixed(1)}%`;
      }
    }

    function renderButtons() {
      const container = document.getElementById('actionButtons');
      const footerMsg = document.getElementById('footerMsg');
      const printBtn = document.getElementById('btnPrint');

      container.innerHTML = '';
      printBtn.disabled = true;

      if (CURRENT_ROLE === 'OPS') {
        if (currentOCR.status === 'DRAFT' || currentOCR.status === 'REJECTED') {
          footerMsg.innerText = "Draft Mode: Enter actuals. Ensure mandatory docs are referenced.";
          container.innerHTML = `
            <button class="btn btn-light border" onclick="saveDraft()">Save Draft</button>
            <button class="btn btn-primary" onclick="submitOCR()">Submit for Validation</button>
          `;
        } else {
          footerMsg.innerText = "Read Only: Submitted to Finance.";
          printBtn.disabled = false;
        }
      } else if (CURRENT_ROLE === 'FIN') {
        if (currentOCR.status === 'SUBMITTED') {
          footerMsg.innerText = "Review Mode: Validate expenses against physical documents.";
          container.innerHTML = `
            <button class="btn btn-danger text-white me-2" onclick="rejectOCR()">Reject</button>
            <button class="btn btn-success text-white" onclick="validateOCR()">Validate & Lock</button>
          `;
        } else if (currentOCR.status === 'VALIDATED') {
          footerMsg.innerText = "File Closed. Locked.";
          printBtn.disabled = false;
        } else {
          footerMsg.innerText = "Waiting for Operations.";
        }
      } else {
        footerMsg.innerText = "Management View Only.";
        if (currentOCR.status !== 'DRAFT') printBtn.disabled = false;
      }
    }

    function saveDraft() {
      const idx = OCR_DB.findIndex(o => o.id === currentOCR.id);
      if (idx >= 0) OCR_DB[idx] = currentOCR;
      else OCR_DB.push(currentOCR);

      renderDashboard();
      alert("Draft Saved Successfully.");
    }

    function submitOCR() {
      let missingDocs = [];
      currentOCR.lines.forEach(l => {
        if (l.reqDoc && l.act > 0 && (!l.docRef || l.docRef.trim() === "")) missingDocs.push(l.desc);
      });

      if (missingDocs.length > 0) {
        alert(`Validation Failed!\n\nThe following expenses require a Document Reference (Invoice/Receipt):\n- ${missingDocs.join("\n- ")}\n\nPlease fill the 'Doc Ref' field.`);
        renderLines();
        return;
      }

      let missingNotes = [];
      currentOCR.lines.forEach(l => {
        if ((l.bud - l.act) < 0 && (!l.docRef || l.docRef.trim() === "")) missingNotes.push(l.desc);
      });

      if (missingNotes.length > 0) {
        alert(`Justification Required!\n\nThe following lines are Over Budget. You must provide a note in 'Doc Ref / Notes':\n- ${missingNotes.join("\n- ")}`);
        renderLines();
        return;
      }

      currentOCR.status = "SUBMITTED";
      saveDraft();
      bootstrap.Modal.getInstance(document.getElementById('ocrModal')).hide();
    }

    function rejectOCR() {
      if (confirm("Reject this reconciliation? Operations will need to correct it.")) {
        currentOCR.status = "REJECTED";
        const idx = OCR_DB.findIndex(o => o.id === currentOCR.id);
        OCR_DB[idx] = currentOCR;
        renderDashboard();
        bootstrap.Modal.getInstance(document.getElementById('ocrModal')).hide();
      }
    }

    function validateOCR() {
      if (confirm("Confirm Validation?\n\nThis will LOCK the Operations File and update the Master Actuals. This action cannot be undone.")) {
        currentOCR.status = "VALIDATED";

        const fileIdx = OPS_FILES.findIndex(f => f.id === currentOCR.fileId);
        if (fileIdx >= 0) OPS_FILES[fileIdx].status = "CLOSED";

        const idx = OCR_DB.findIndex(o => o.id === currentOCR.id);
        OCR_DB[idx] = currentOCR;

        renderDashboard();
        bootstrap.Modal.getInstance(document.getElementById('ocrModal')).hide();
        alert("File Validated & Closed Successfully.");
      }
    }

    function triggerPrint() {
      document.getElementById('pDocId').innerText = currentOCR.id;
      document.getElementById('pPrintDate').innerText = new Date().toLocaleString();

      document.getElementById('pRef').innerText = currentOCR.fileId;
      document.getElementById('pClient').innerText = currentOCR.client;
      document.getElementById('pService').innerText = currentOCR.service;
      document.getElementById('pStatus').innerText = currentOCR.status;

      const tbody = document.getElementById('pTableBody');
      tbody.innerHTML = '';

      currentOCR.lines.forEach(l => {
        const variance = l.bud - l.act;
        tbody.innerHTML += `
          <tr>
            <td>${l.code}</td>
            <td>${l.desc}</td>
            <td class="p-num">${l.bud.toLocaleString()}</td>
            <td class="p-num">${l.act.toLocaleString()}</td>
            <td class="p-num" style="color:${variance < 0 ? 'red' : 'black'}">${variance.toLocaleString()}</td>
            <td>${l.docRef || '-'}</td>
          </tr>
        `;
      });

      document.getElementById('pTotBud').innerText = currentOCR.totalBud.toLocaleString();
      document.getElementById('pTotAct').innerText = currentOCR.totalAct.toLocaleString();
      document.getElementById('pTotVar').innerText = (currentOCR.totalBud - currentOCR.totalAct).toLocaleString();

      document.getElementById('pPerfNote').innerText =
        (currentOCR.totalBud - currentOCR.totalAct) >= 0
          ? "Efficient Execution (Under Budget)"
          : "Cost Overrun (Over Budget)";

      window.print();
    }
  </script>
</body>
</html>
