<?php
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN']);

/**
 * Use the same authenticated-user pattern as index.php (no hardcoded profile).
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

// --- Display values ---
$fullName  = trim((string)($me['full_name'] ?? 'ADMIN'));
$firstName = trim(explode(' ', $fullName)[0] ?? 'Manager');

$role = strtoupper((string)($me['role'] ?? 'ADMIN'));
$roleLabelMap = [
  'ADMIN'      => 'SYSTEM ADMIN',
  'FINANCE'    => 'FINANCE',
  'SALES'      => 'SALES',
  'OPERATIONS' => 'OPERATIONS',
  'MANAGEMENT' => 'MANAGEMENT',
];
$roleLabel = $roleLabelMap[$role] ?? $role;

// For MANAGEMENT, show job title if present, else fallback.
$jobTitle = trim((string)($me['job_title'] ?? ''));
$topRoleLabel = ($jobTitle !== '') ? strtoupper($jobTitle) : $roleLabel;

// Avatar
$avatarName = urlencode($fullName);
$avatarUrl  = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";

// Greeting
$hour = (int)date('H');
$greeting = ($hour < 12) ? 'Good morning' : (($hour < 18) ? 'Good afternoon' : 'Good evening');
$bannerName = $firstName;
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
    /* =========================================================================================
       0) INDEX.PHP (MANAGEMENT) LAYOUT BASELINE: SIDEBAR + TOP NAVBAR (REUSED)
       ========================================================================================= */
    :root{
      --smart-blue:#1F99D8;
      --smart-dark:#055B83;
      --smart-orange:#EE7D04;
      --smart-charcoal:#231F20;
      --smart-bg:#F0F4F8;

      --sidebar-width:280px;
      --header-h:70px; /* keep OCR variables aligned */
      --sidebar-w:280px; /* keep OCR variables aligned */

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

      --font-main: 'Manrope', sans-serif;
      --font-head: 'Montserrat', sans-serif;
      --font-code: 'Inconsolata', monospace;
    }

    body{
      font-family:var(--font-main);
      background:var(--bg-body);
      color:var(--brand-charcoal);
      font-size:0.85rem;
      overflow-x:hidden;
    }
    h1,h2,h3,h4,h5,h6{ font-family:var(--font-head); }

    /* --- SIDEBAR (FROM INDEX.PHP) --- */
    .sidebar{
      width:var(--sidebar-width);
      height:100vh;
      position:fixed;
      top:0;
      left:0;
      background-color:#ffffff;
      border-right:1px solid #e0e0e0;
      z-index:1000;
      display:flex;
      flex-direction:column;
      box-shadow:2px 0 10px rgba(0,0,0,0.02);
    }
    .sidebar-header{
      height:70px;
      display:flex;
      align-items:center;
      padding:0 20px;
      border-bottom:1px solid #f0f0f0;
    }
    .brand-logo{
      font-weight:800;
      font-size:1.1rem;
      color:var(--smart-charcoal);
      text-decoration:none;
      letter-spacing:-0.5px;
    }
    .sidebar-menu{ overflow-y:auto; flex-grow:1; padding:10px 0; }

    .menu-btn{
      width:100%;
      text-align:left;
      background:none;
      border:none;
      padding:12px 20px;
      font-size:0.8rem;
      font-weight:700;
      color:#555;
      display:flex;
      justify-content:space-between;
      align-items:center;
      transition:all 0.2s;
      border-left:3px solid transparent;
    }
    .menu-btn:hover, .menu-btn[aria-expanded="true"]{
      color:var(--smart-charcoal);
      background-color:#f0f7fa;
      border-left-color:var(--smart-charcoal);
    }
    .menu-btn i.category-icon{ width:20px; margin-right:8px; color:#888; transition:color 0.2s; }
    .menu-btn:hover i.category-icon{ color:var(--smart-charcoal); }
    .menu-chevron{ font-size:0.7rem; transition:transform 0.3s; }
    .menu-btn[aria-expanded="true"] .menu-chevron{ transform:rotate(180deg); }

    .sub-link{
      display:block;
      padding:8px 20px 8px 48px;
      font-size:0.75rem;
      color:#666;
      text-decoration:none;
      font-weight:500;
      transition:all 0.2s;
      line-height:1.3;
    }
    .sub-link:hover{ color:var(--smart-orange); background-color:#fff9f2; }

    .sidebar-footer{ border-top:1px solid #f0f0f0; padding:16px; }

    /* --- MAIN LAYOUT (FROM INDEX.PHP) --- */
    .main-content{
      margin-left:var(--sidebar-width);
      padding-top:70px;
      min-height:100vh;
      width:calc(100% - var(--sidebar-width));
    }

    .top-navbar{
      height:70px;
      position:fixed;
      top:0;
      right:0;
      left:var(--sidebar-width);
      background:rgba(255,255,255,0.95);
      backdrop-filter:blur(12px);
      border-bottom:1px solid #e0e0e0;
      z-index:900;
      padding:0 30px;
      display:flex;
      align-items:center;
      justify-content:space-between;
    }

    .clock-pill{
      background:#f1f5f9;
      padding:6px 12px;
      border-radius:30px;
      display:flex;
      align-items:center;
      gap:10px;
      font-size:0.85rem;
      font-weight:600;
      color:var(--smart-dark);
    }
    .btn-clock{
      background:#e2e8f0;
      border:none;
      border-radius:20px;
      padding:4px 12px;
      font-size:0.75rem;
      font-weight:700;
      color:#64748b;
      transition:0.3s;
    }
    .btn-clock.active{
      background:var(--smart-orange);
      color:white;
      box-shadow:0 2px 10px rgba(238,125,4,0.3);
    }

    /* =========================================================================================
       1) OCR PAGE STYLES (KEEP ORIGINAL OCR LOGIC/STYLES; ONLY LAYOUT HOST CHANGED)
       ========================================================================================= */

    /* Reset & Base */
    * { box-sizing: border-box; outline: none; }

    /* Typography Utilities */
    .font-mono { font-family: var(--font-code); letter-spacing: -0.5px; }
    .fw-black { font-weight: 800; }
    .fw-bold { font-weight: 700; }

    /* Functional Utils */
    .cursor-pointer { cursor: pointer; }
    .text-orange { color: var(--brand-orange) !important; }
    .bg-orange { background-color: var(--brand-orange) !important; }
    .transition { transition: all 0.2s ease-in-out; }

    /* Button Overrides */
    .btn { font-weight: 700; border-radius: 6px; padding: 0.5rem 1rem; font-size: 0.85rem; }
    .btn-primary { background: var(--brand-blue); border-color: var(--brand-blue); }
    .btn-primary:hover { background: var(--brand-blue-dark); border-color: var(--brand-blue-dark); }
    .btn-orange { background: var(--brand-orange); border-color: var(--brand-orange); color: white; }
    .btn-orange:hover { background: var(--brand-orange-hover); border-color: var(--brand-orange-hover); color: white; }

    /* MAIN DASHBOARD AREA */
    .container-fluid { padding: 32px; }

    /* KPI Cards */
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

    /* Data Grid */
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

    /* Status Pills */
    .status-pill { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 4px; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; }
    .st-draft { background: var(--state-draft-bg); color: var(--state-draft-text); }
    .st-submitted { background: var(--state-submitted-bg); color: var(--state-submitted-text); }
    .st-validated { background: var(--state-validated-bg); color: var(--state-validated-text); }
    .st-rejected { background: var(--state-rejected-bg); color: var(--state-rejected-text); }

    /* OCR MODAL (FULLSCREEN WORKSPACE) */
    .modal-ocr-fs { width: 98vw; max-width: 1800px; margin: 1vh auto; height: 98vh; }
    .modal-content { height: 100%; border-radius: 8px; border: none; background: #F1F5F9; display: flex; flex-direction: column; overflow: hidden; }

    .modal-header { background: white; padding: 16px 30px; border-bottom: 1px solid var(--border-color); flex-shrink: 0; }
    .modal-footer { background: white; padding: 16px 30px; border-top: 1px solid var(--border-color); flex-shrink: 0; }

    .modal-body { padding: 0; flex: 1; overflow: hidden; display: flex; }

    /* Sidebar in Modal */
    .ocr-sidebar { width: 350px; background: white; border-right: 1px solid var(--border-color); display: flex; flex-direction: column; overflow-y: auto; }
    .ocr-sidebar-section { padding: 24px; border-bottom: 1px solid var(--border-color); }
    .ocr-section-head { font-size: 0.7rem; font-weight: 800; text-transform: uppercase; color: var(--brand-blue); margin-bottom: 16px; letter-spacing: 0.5px; }

    .info-pair { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 0.85rem; }
    .info-key { color: #64748B; font-weight: 600; }
    .info-val { color: var(--brand-charcoal); font-weight: 700; text-align: right; }

    /* Chart Visualization */
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

    /* Main Form Area */
    .ocr-main { flex: 1; padding: 30px; overflow-y: auto; }
    .lines-card { background: white; border: 1px solid var(--border-color); border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.01); }

    .lines-table { width: 100%; border-collapse: separate; border-spacing: 0; }
    .lines-table th {
      position: sticky; top: 0; background: #F8FAFC; z-index: 10;
      padding: 12px 16px; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; color: #64748B;
      border-bottom: 2px solid var(--border-color);
    }
    .lines-table td { padding: 10px 16px; border-bottom: 1px solid #F1F5F9; vertical-align: top; background: white; }

    /* Inputs */
    .inp-money{
      width: 100%; padding: 8px 12px; border: 1px solid #CBD5E1; border-radius: 4px;
      font-family: var(--font-code); font-weight: 700; text-align: right; color: var(--brand-charcoal);
      transition: all 0.2s;
    }
    .inp-money:focus { border-color: var(--brand-blue); box-shadow: 0 0 0 3px rgba(31, 153, 216, 0.15); }
    .inp-money:read-only { background: #F1F5F9; color: #64748B; border-color: transparent; }

    .inp-text{
      width: 100%; padding: 8px 12px; border: 1px solid #CBD5E1; border-radius: 4px;
      font-size: 0.85rem; transition: all 0.2s;
    }
    .inp-text:focus { border-color: var(--brand-blue); }
    .inp-text:read-only { background: #F1F5F9; color: #64748B; border-color: transparent; }

    /* Validation States */
    .row-overrun td { background: #FEF2F2 !important; }
    .row-overrun .inp-money { border-color: #EF4444; color: #B91C1C; background: #FFF; }
    .req-doc-highlight { border-color: #F59E0B !important; background: #FFFBEB !important; }
    .req-doc-highlight::placeholder { color: #D97706; font-weight: 700; }

    /* Tiny avatar helper (for OCR JS IDs; kept minimal) */
    .avatar-mini{
      width: 28px; height: 28px;
      border-radius: 999px;
      display: inline-flex;
      align-items:center;
      justify-content:center;
      font-weight:800;
      font-size:0.75rem;
      background:#111827;
      color:#fff;
    }

    /* PRINT ENGINE (HIDDEN BY DEFAULT) */
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

  <!-- PAGE CONTENT (OCR CONTENT KEPT; NOW HOSTED INSIDE INDEX.PHP MAIN LAYOUT) -->
  <div class="main-content">
    <div class="container-fluid">

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

    </div>
  </div>

  <!-- OCR MODAL (UNCHANGED) -->
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

  <!-- PRINT ENGINE (UNCHANGED) -->
  <div id="print-container">
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

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

  <script>
/**
 * SMART LS - OCR ENGINE (DB MODE)
 * --------------------------------
 * Replaces mock OPS_FILES/OCR_DB with DB-backed APIs.
 * Assumes APIs exist under: ../../api/ocr/
 *
 * REQUIRED HTML:
 * - #fileSelect onchange="loadFileContext(this.value)"
 * - #btnNewOCR onclick="openOCRModal()"
 * - #ocrTableBody, #linesBody, #actionButtons
 * - #ctxClient, #ctxService, #ctxCostRef
 * - #modalTitle, #ocrIdDisplay, #modalStatusBadge, #btnPrint
 * - KPI ids: #kpiActive, #kpiTotalBudget, #kpiTotalActual, #kpiVariance
 * - Charts ids: #barBudget,#barActual,#valBudget,#valActual,#gradeText,#gradeDesc,#totalVariance
 */

const API_BASE = "../../api/ocr"; // adjust if needed

async function apiGet(path){
  const url = `${API_BASE}/${path}`;
  const res = await fetch(url, { credentials: 'same-origin' });

  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const raw = await res.text(); // read once

  // Try parse JSON if it looks like JSON
  let data = null;
  if (ct.includes('application/json') || raw.trim().startsWith('{') || raw.trim().startsWith('[')) {
    try { data = JSON.parse(raw); } catch(_) { data = null; }
  }

  if (!res.ok || !data || !data.ok){
    console.error('apiGet failed', { url, status: res.status, statusText: res.statusText, contentType: ct, rawPreview: raw.slice(0, 500), data });
    throw new Error(
      (data && (data.message || data.error)) ||
      `Request failed: ${res.status} ${res.statusText} (${ct || 'no content-type'})`
    );
  }

  return data;
}

async function apiPost(path, payload){
  const res = await fetch(`${API_BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(payload || {})
  });
  const data = await res.json().catch(()=>null);
  if (!res.ok || !data || !data.ok) throw new Error((data && (data.message || data.error)) || 'Request failed');
  return data;
}

// --- ROLE (UI gating only; backend enforces real RBAC) ---
let CURRENT_ROLE = 'ADMIN'; // OPS | FIN | MGMT

// --- STATE (DB mode) ---
let currentOCR = null; // { id, status, operations_file_reference, costing_id, costing_ref, client_id, client_name_cached, service_type, service_territory, lines[], totalBud,totalAct }

// --- INIT ---
document.addEventListener('DOMContentLoaded', async () => {
  try{
    // If you want to derive role from session, set CURRENT_ROLE here using a server-rendered var.
    // Example: window.SESSION_ROLE = 'FINANCE' etc; then map to OPS/FIN/MGMT.
    await loadEligibleFiles();
    await loadRegister();
    switchRole(CURRENT_ROLE);
  } catch(e){
    console.error(e);
    alert(e.message || String(e));
  }
});

function switchRole(role){
  CURRENT_ROLE = role;

  const badge = document.getElementById('activeRoleBadge');
  const avatar = document.getElementById('userAvatar');
  const hint = document.getElementById('roleHint');
  const btnNew = document.getElementById('btnNewOCR');

  if (badge && avatar && hint && btnNew){
    if(role === 'OPERATIONS'){
      badge.className = 'role-badge ops'; badge.innerText = 'OPERATIONS';
      avatar.innerText = 'OP'; hint.innerText = 'Logged as Operations';
      btnNew.style.display = 'block';
    } else if(role === 'FINANCE'){
      badge.className = 'role-badge fin'; badge.innerText = 'FINANCE';
      avatar.innerText = 'FN'; hint.innerText = 'Logged as Finance';
      btnNew.style.display = 'none';
    } else {
      badge.className = 'role-badge admin'; badge.innerText = 'MANAGEMENT';
      avatar.innerText = 'MD'; hint.innerText = 'View Only';
      btnNew.style.display = 'none';
    }
  }

  // Refresh register actions for current role
  loadRegister().catch(console.error);
}

// --- REGISTER (dashboard) ---
async function loadRegister(){
  const data = await apiGet('list.php');
  renderRegisterFromDb(data.items || []);
}

function renderRegisterFromDb(items){
  const tbody = document.getElementById('ocrTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  let activeCount = 0;
  let totalBud = 0;
  let totalAct = 0;

  if(items.length === 0){
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-muted">No reconciliations found.</td></tr>`;
    setKpis(0,0,0);
    return;
  }

  items.forEach(row => {
    const status = String(row.status || '').toUpperCase();
    const statusClass = `st-${status.toLowerCase()}`;

    if(status !== 'VALIDATED') activeCount++;
    totalBud += Number(row.total_budget_ttc || 0);
    totalAct += Number(row.total_actual_ttc || 0);

    let actionBtn = `<button class="btn btn-sm btn-light border" onclick="loadOCR('${escapeAttr(row.ocr_id)}')"><i class="fa-solid fa-eye"></i> View</button>`;
    if (CURRENT_ROLE === 'OPERATINS' && (status === 'DRAFT' || status === 'REJECTED')) {
      actionBtn = `<button class="btn btn-sm btn-outline-primary" onclick="loadOCR('${escapeAttr(row.ocr_id)}')"><i class="fa-solid fa-pen"></i> Edit</button>`;
    }
    if (CURRENT_ROLE === 'FINANCE' && status === 'SUBMITTED') {
      actionBtn = `<button class="btn btn-sm btn-success text-white" onclick="loadOCR('${escapeAttr(row.ocr_id)}')"><i class="fa-solid fa-check-double"></i> Validate</button>`;
    }

    tbody.innerHTML += `
      <tr>
        <td class="font-mono fw-bold text-primary">${escapeHtml(row.ocr_id)}</td>
        <td class="text-muted">${escapeHtml(String(row.updated_at || '').slice(0,10))}</td>
        <td class="fw-bold">${escapeHtml(row.operations_file_reference)}</td>
        <td>
          <div>${escapeHtml(row.client_name_cached || '')}</div>
          <small class="text-muted">${escapeHtml(row.service_type || '')}</small>
        </td>
        <td class="font-mono">${Number(row.total_budget_ttc || 0).toLocaleString()}</td>
        <td class="font-mono">${Number(row.total_actual_ttc || 0).toLocaleString()}</td>
        <td><span class="status-pill ${statusClass}">${escapeHtml(status)}</span></td>
        <td class="text-end">${actionBtn}</td>
      </tr>
    `;
  });

  setKpis(activeCount, totalBud, totalAct);
}

function setKpis(activeCount, totalBud, totalAct){
  const elActive = document.getElementById('kpiActive');
  const elBud = document.getElementById('kpiTotalBudget');
  const elAct = document.getElementById('kpiTotalActual');
  const elVar = document.getElementById('kpiVariance');

  if(elActive) elActive.innerText = String(activeCount);
  if(elBud) elBud.innerText = Number(totalBud || 0).toLocaleString();
  if(elAct) elAct.innerText = Number(totalAct || 0).toLocaleString();

  const varPct = (totalBud > 0) ? (((totalBud - totalAct) / totalBud) * 100) : 0;
  if(elVar){
    elVar.innerText = `${varPct >= 0 ? '+' : ''}${varPct.toFixed(1)}%`;
    elVar.className = varPct >= 0 ? "kpi-value text-success" : "kpi-value text-danger";
  }
}

// --- FILE DROPDOWN (eligible ops files) ---
async function loadEligibleFiles(){
  const sel = document.getElementById('fileSelect');
  if (!sel) return;

  sel.innerHTML = `<option value="">-- Select Approved File --</option>`;
  const data = await apiGet('files.php');

  (data.items || []).forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.operations_file_reference;
    opt.textContent = `${f.operations_file_reference} - ${f.client_name} (${f.service_type})`;
    // optional: keep extra info
    opt.dataset.costingId = f.costing_id || '';
    opt.dataset.costingRef = f.costing_ref || '';
    sel.appendChild(opt);
  });
}

// --- NEW OCR MODAL ---
function openOCRModal(){
  currentOCR = {
    id: null, // created by server OR assigned by save_draft.php
    status: "DRAFT",
    operations_file_reference: "",
    costing_id: "",
    costing_ref: "",
    client_id: "",
    client_name_cached: "",
    service_type: "",
    service_territory: "",
    lines: [],
    totalBud: 0,
    totalAct: 0
  };

  // UI reset
  document.getElementById('modalTitle').innerText = "New Reconciliation";
  document.getElementById('ocrIdDisplay').innerText = "NEW";
  document.getElementById('modalStatusBadge').innerText = "DRAFT";
  document.getElementById('modalStatusBadge').className = "badge status-pill st-draft me-3";

  const sel = document.getElementById('fileSelect');
  if(sel){
    sel.disabled = false;
    sel.value = "";
  }

  document.getElementById('linesBody').innerHTML =
    '<tr><td colspan="6" class="text-center py-5 text-muted">Please select a file to load cost lines.</td></tr>';

  resetSidebar();
  renderButtons();

  new bootstrap.Modal(document.getElementById('ocrModal')).show();
}

// --- FILE CONTEXT + COST LINES FROM DB ---
async function loadFileContext(opsRef){
  if(!opsRef || !currentOCR) return;

  const data = await apiGet(`file_context.php?operations_file_reference=${encodeURIComponent(opsRef)}`);
  const h = data.header || {};

  currentOCR.operations_file_reference = h.operations_file_reference || opsRef;
  currentOCR.costing_id = h.costing_id || '';
  currentOCR.costing_ref = h.costing_ref || '';
  currentOCR.client_id = h.client_id || '';
  currentOCR.client_name_cached = h.client_name || h.client_name_cached || '';
  currentOCR.service_type = h.service_type || '';
  currentOCR.service_territory = h.service_territory || '';

  // Sidebar
  document.getElementById('ctxClient').innerText = currentOCR.client_name_cached || '---';
  document.getElementById('ctxService').innerText = currentOCR.service_type || '---';
  document.getElementById('ctxCostRef').innerText = currentOCR.costing_ref || '---';

  currentOCR.lines = (data.lines || []).map(l => ({
    costing_line_id: l.costing_line_id,
    line_no: Number(l.line_no || 0),
    item_code: l.item_code || l.code || '',
    item_description: l.item_description || l.desc || '',
    doc_required: Number(l.doc_required || 0),
    bud: Number(l.budget_ttc || 0),
    act: 0,
    docRef: ""
  }));

  renderLines();
  calculateTotals();
  renderButtons();
}

// --- LOAD EXISTING OCR BY ID ---
async function loadOCR(ocrId){
  const data = await apiGet(`get.php?ocr_id=${encodeURIComponent(ocrId)}`);
  const h = data.header || {};

  currentOCR = {
    id: h.ocr_id,
    status: String(h.status || 'DRAFT').toUpperCase(),
    operations_file_reference: h.operations_file_reference || '',
    costing_id: h.costing_id || '',
    costing_ref: h.costing_ref || '',
    client_id: h.client_id || '',
    client_name_cached: h.client_name_cached || '',
    service_type: h.service_type || '',
    service_territory: h.service_territory || '',
    lines: (data.lines || []).map(l => ({
      costing_line_id: l.costing_line_id,
      line_no: Number(l.line_no || 0),
      item_code: l.item_code || '',
      item_description: l.item_description || '',
      doc_required: Number(l.doc_required || 0),
      bud: Number(l.budget_ttc || 0),
      act: Number(l.actual_ttc || 0),
      docRef: l.doc_ref || ''
    })),
    totalBud: 0,
    totalAct: 0
  };

  // UI
  document.getElementById('modalTitle').innerText = "Reconciliation Details";
  document.getElementById('ocrIdDisplay').innerText = currentOCR.id;
  document.getElementById('modalStatusBadge').innerText = currentOCR.status;
  document.getElementById('modalStatusBadge').className = `badge status-pill st-${String(currentOCR.status).toLowerCase()} me-3`;

  const sel = document.getElementById('fileSelect');
  if(sel){
    sel.innerHTML = `<option value="${escapeAttr(currentOCR.operations_file_reference)}">${escapeHtml(currentOCR.operations_file_reference)}</option>`;
    sel.value = currentOCR.operations_file_reference;
    sel.disabled = true;
  }

  document.getElementById('ctxClient').innerText = currentOCR.client_name_cached || '---';
  document.getElementById('ctxService').innerText = currentOCR.service_type || '---';
  document.getElementById('ctxCostRef').innerText = currentOCR.costing_ref || '---';

  renderLines();
  calculateTotals();
  renderButtons();

  new bootstrap.Modal(document.getElementById('ocrModal')).show();
}

// --- SIDEBAR RESET ---
function resetSidebar(){
  document.getElementById('ctxClient').innerText = "---";
  document.getElementById('ctxService').innerText = "---";
  document.getElementById('ctxCostRef').innerText = "---";
  document.getElementById('barBudget').style.height = "0%";
  document.getElementById('barActual').style.height = "0%";
  document.getElementById('valBudget').innerText = "0";
  document.getElementById('valActual').innerText = "0";
  document.getElementById('gradeText').innerText = "---";
  document.getElementById('gradeDesc').innerText = "Select file to begin";
  const varEl = document.getElementById('totalVariance');
  if(varEl){ varEl.innerText = "0 XAF"; varEl.className = "font-mono text-muted"; }
}

// --- LINES RENDER ---
function renderLines(){
  const tbody = document.getElementById('linesBody');
  if(!tbody) return;
  tbody.innerHTML = '';

  if(!currentOCR || !Array.isArray(currentOCR.lines) || currentOCR.lines.length === 0){
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-5 text-muted">Please select a file to load cost lines.</td></tr>`;
    return;
  }

  const isEditable = (CURRENT_ROLE === 'OPERATIONS' && (currentOCR.status === 'DRAFT' || currentOCR.status === 'REJECTED'));

  currentOCR.lines.forEach((line, index) => {
    const variance = Number(line.bud || 0) - Number(line.act || 0);
    const isOverrun = variance < 0;

    const rowClass = isOverrun ? 'row-overrun' : '';
    const docPlaceholder = (line.doc_required ? "REQ: Invoice/Receipt Ref..." : "Observation...");

    tbody.innerHTML += `
      <tr class="${rowClass}">
        <td class="font-mono text-muted">${escapeHtml(line.item_code || '')}</td>
        <td>
          <div class="fw-bold text-dark">${escapeHtml(line.item_description || '')}</div>
          ${line.doc_required ? '<span class="badge bg-warning text-dark" style="font-size:0.6rem">DOC REQ</span>' : ''}
        </td>
        <td><input type="text" class="inp-money" value="${Number(line.bud || 0).toLocaleString()}" readonly></td>
        <td>
          <input type="number" class="inp-money" id="act_${index}"
            value="${Number(line.act || 0) === 0 ? '' : Number(line.act)}" placeholder="0"
            oninput="updateLine(${index})" ${isEditable ? '' : 'readonly'}>
        </td>
        <td>
          <input type="text" class="inp-money ${isOverrun ? 'text-danger' : 'text-success'}"
            value="${Number(variance).toLocaleString()}" readonly id="var_${index}">
        </td>
        <td>
          <input type="text" class="inp-text ${(line.doc_required && Number(line.act||0) > 0 && !line.docRef) ? 'req-doc-highlight' : ''}"
            id="doc_${index}" value="${escapeAttr(line.docRef || '')}"
            placeholder="${escapeAttr(docPlaceholder)}"
            oninput="updateLine(${index})" ${isEditable ? '' : 'readonly'}>
        </td>
      </tr>
    `;
  });
}

function updateLine(index){
  if(!currentOCR || !currentOCR.lines || !currentOCR.lines[index]) return;

  const actEl = document.getElementById(`act_${index}`);
  const docEl = document.getElementById(`doc_${index}`);
  const actVal = Number(actEl && actEl.value ? actEl.value : 0) || 0;
  const docVal = (docEl && docEl.value) ? docEl.value : '';

  currentOCR.lines[index].act = actVal;
  currentOCR.lines[index].docRef = docVal;

  const variance = Number(currentOCR.lines[index].bud || 0) - actVal;
  const varInput = document.getElementById(`var_${index}`);
  if(varInput){
    varInput.value = Number(variance).toLocaleString();
    if(variance < 0){
      varInput.classList.remove('text-success'); varInput.classList.add('text-danger');
      varInput.closest('tr')?.classList.add('row-overrun');
    } else {
      varInput.classList.add('text-success'); varInput.classList.remove('text-danger');
      varInput.closest('tr')?.classList.remove('row-overrun');
    }
  }

  if(docEl){
    if(currentOCR.lines[index].doc_required && actVal > 0 && !docVal){
      docEl.classList.add('req-doc-highlight');
    } else {
      docEl.classList.remove('req-doc-highlight');
    }
  }

  calculateTotals();
}

function calculateTotals(){
  if(!currentOCR) return;

  let totBud = 0, totAct = 0;
  (currentOCR.lines || []).forEach(l => {
    totBud += Number(l.bud || 0);
    totAct += Number(l.act || 0);
  });

  currentOCR.totalBud = totBud;
  currentOCR.totalAct = totAct;
  const netVar = totBud - totAct;

  const varEl = document.getElementById('totalVariance');
  if(varEl){
    varEl.innerText = `${Number(netVar).toLocaleString()} XAF`;
    varEl.className = netVar >= 0 ? "font-mono text-success" : "font-mono text-danger";
  }

  const max = Math.max(totBud, totAct) || 1;
  const barBudget = document.getElementById('barBudget');
  const barActual = document.getElementById('barActual');
  if(barBudget) barBudget.style.height = (totBud / max * 100) + "%";
  if(barActual) barActual.style.height = (totAct / max * 100) + "%";

  const valBudget = document.getElementById('valBudget');
  const valActual = document.getElementById('valActual');
  if(valBudget) valBudget.innerText = (totBud/1000).toFixed(0) + "k";
  if(valActual) valActual.innerText = (totAct/1000).toFixed(0) + "k";

  const gradeEl = document.getElementById('gradeText');
  const gradeDesc = document.getElementById('gradeDesc');

  if(!gradeEl || !gradeDesc) return;

  if(totAct === 0){
    gradeEl.innerText = "PENDING"; gradeEl.className = "fs-2 fw-black text-muted";
    gradeDesc.innerText = "Awaiting Inputs";
  } else if(netVar >= 0){
    gradeEl.innerText = "EFFICIENT"; gradeEl.className = "fs-2 fw-black text-success";
    gradeDesc.innerText = `Under Budget by ${((netVar/totBud)*100).toFixed(1)}%`;
  } else {
    gradeEl.innerText = "OVERRUN"; gradeEl.className = "fs-2 fw-black text-danger";
    gradeDesc.innerText = `Budget Exceeded by ${Math.abs(((netVar/totBud)*100)).toFixed(1)}%`;
  }
}

// --- WORKFLOW BUTTONS ---
function renderButtons(){
  const container = document.getElementById('actionButtons');
  const footerMsg = document.getElementById('footerMsg');
  const printBtn = document.getElementById('btnPrint');

  if(!container || !footerMsg || !printBtn) return;

  container.innerHTML = '';
  printBtn.disabled = true;

  const status = currentOCR ? String(currentOCR.status || 'DRAFT').toUpperCase() : 'DRAFT';

  if (CURRENT_ROLE === 'OPERATIONS') {
    if (!currentOCR){
      footerMsg.innerText = "Select an OCR record.";
      return;
    }
    if (status === 'DRAFT' || status === 'REJECTED') {
      footerMsg.innerText = "Draft Mode: Enter actuals. Ensure mandatory docs are referenced.";
      container.innerHTML = `
        <button class="btn btn-light border" onclick="saveDraft()">Save Draft</button>
        <button class="btn btn-primary" onclick="submitOCR()">Submit for Validation</button>
      `;
    } else {
      footerMsg.innerText = "Read Only: Submitted to Finance.";
      printBtn.disabled = false;
    }
  }
  else if (CURRENT_ROLE === 'FIN') {
    if (!currentOCR){
      footerMsg.innerText = "Select an OCR record.";
      return;
    }
    if (status === 'SUBMITTED') {
      footerMsg.innerText = "Review Mode: Validate expenses against physical documents.";
      container.innerHTML = `
        <button class="btn btn-danger text-white me-2" onclick="rejectOCR()">Reject</button>
        <button class="btn btn-success text-white" onclick="validateOCR()">Validate & Lock</button>
      `;
    } else if (status === 'VALIDATED') {
      footerMsg.innerText = "File Closed. Locked.";
      printBtn.disabled = false;
    } else {
      footerMsg.innerText = "Waiting for Operations.";
    }
  }
  else {
    footerMsg.innerText = "Management View Only.";
    if(currentOCR && status !== 'DRAFT') printBtn.disabled = false;
  }
}

// --- SAVE / SUBMIT / REJECT / VALIDATE (DB-backed) ---
async function saveDraft(){
  if(!currentOCR) return;

  if(!currentOCR.operations_file_reference){
    alert("Select an Operations File first.");
    return;
  }

  const payload = {
    ocr_id: currentOCR.id, // may be null for NEW; backend can create and return id
    operations_file_reference: currentOCR.operations_file_reference,
    costing_id: currentOCR.costing_id,
    costing_ref: currentOCR.costing_ref,
    client_id: currentOCR.client_id,
    client_name_cached: currentOCR.client_name_cached,
    service_type: currentOCR.service_type,
    service_territory: currentOCR.service_territory || '',
    lines: (currentOCR.lines || []).map(l => ({
      costing_line_id: l.costing_line_id,
      line_no: l.line_no,
      item_code: l.item_code,
      item_description: l.item_description,
      budget_ttc: Number(l.bud || 0),
      actual_ttc: Number(l.act || 0),
      doc_ref: l.docRef || '',
      doc_required: l.doc_required ? 1 : 0
    }))
  };

  const res = await apiPost('save_draft.php', payload);

  // if backend generated id, adopt it
  if(res.ocr_id && !currentOCR.id){
    currentOCR.id = res.ocr_id;
    document.getElementById('ocrIdDisplay').innerText = currentOCR.id;
  }

  await loadRegister();
  alert("Draft Saved Successfully.");
}

async function submitOCR(){
  if(!currentOCR) return;

  // Mandatory docs enforcement
  const missing = [];
  (currentOCR.lines || []).forEach(l => {
    if(l.doc_required && Number(l.act || 0) > 0 && (!l.docRef || String(l.docRef).trim() === "")){
      missing.push(l.item_description || l.item_code || 'Line');
    }
  });
  if(missing.length){
    alert(
      `Validation Failed!\n\nThe following expenses require a Document Reference (Invoice/Receipt):\n- ${missing.join("\n- ")}\n\nPlease fill the 'Doc Ref' field.`
    );
    renderLines();
    return;
  }

  await saveDraft(); // ensure latest edits persisted
  await apiPost('submit.php', { ocr_id: currentOCR.id });
  currentOCR.status = 'SUBMITTED';

  await loadRegister();
  bootstrap.Modal.getInstance(document.getElementById('ocrModal')).hide();
}

async function rejectOCR(){
  if(!currentOCR) return;
  if(!confirm("Reject this reconciliation? Operations will need to correct it.")) return;

  await apiPost('reject.php', { ocr_id: currentOCR.id });
  currentOCR.status = 'REJECTED';

  await loadRegister();
  bootstrap.Modal.getInstance(document.getElementById('ocrModal')).hide();
}

async function validateOCR(){
  if(!currentOCR) return;
  if(!confirm("Confirm Validation?\n\nThis will LOCK the Operations File and update the Master Actuals. This action cannot be undone.")) return;

  await apiPost('validate.php', { ocr_id: currentOCR.id });
  currentOCR.status = 'VALIDATED';

  await loadRegister();
  bootstrap.Modal.getInstance(document.getElementById('ocrModal')).hide();
  alert("File Validated & Closed Successfully.");
}

// --- PRINT ENGINE (fixed to DB fields) ---
function triggerPrint(){
  if(!currentOCR) return;

  document.getElementById('pDocId').innerText = currentOCR.id || '---';
  document.getElementById('pPrintDate').innerText = new Date().toLocaleString();

  document.getElementById('pRef').innerText = currentOCR.operations_file_reference || '---';
  document.getElementById('pClient').innerText = currentOCR.client_name_cached || '---';
  document.getElementById('pService').innerText = currentOCR.service_type || '---';
  document.getElementById('pStatus').innerText = currentOCR.status || '---';

  const tbody = document.getElementById('pTableBody');
  tbody.innerHTML = '';

  (currentOCR.lines || []).forEach(l => {
    const variance = Number(l.bud || 0) - Number(l.act || 0);
    tbody.innerHTML += `
      <tr>
        <td>${escapeHtml(l.item_code || '')}</td>
        <td>${escapeHtml(l.item_description || '')}</td>
        <td class="p-num">${Number(l.bud || 0).toLocaleString()}</td>
        <td class="p-num">${Number(l.act || 0).toLocaleString()}</td>
        <td class="p-num" style="color:${variance < 0 ? 'red' : 'black'}">${Number(variance).toLocaleString()}</td>
        <td>${escapeHtml(l.docRef || '-') }</td>
      </tr>
    `;
  });

  document.getElementById('pTotBud').innerText = Number(currentOCR.totalBud || 0).toLocaleString();
  document.getElementById('pTotAct').innerText = Number(currentOCR.totalAct || 0).toLocaleString();
  const netVar = Number(currentOCR.totalBud || 0) - Number(currentOCR.totalAct || 0);
  document.getElementById('pTotVar').innerText = Number(netVar).toLocaleString();

  const grade = netVar >= 0 ? "Efficient Execution (Under Budget)" : "Cost Overrun (Over Budget)";
  document.getElementById('pPerfNote').innerText = grade;

  window.print();
}

// --- helpers ---
function escapeHtml(v){
  return String(v ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#039;");
}
function escapeAttr(v){
  // sufficient for attribute context inside template strings
  return escapeHtml(v).replaceAll('`','&#096;');
}
</script>


</body>
</html>
