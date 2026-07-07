<?php
/*
 * ======================================================================================
 * SMART LS ENTERPRISE - PROFORMA INVOICE PORTAL v4.1 (Production)
 * ======================================================================================
 * * MODULE: Finance & Billing / Proforma Invoices
 * AUTHOR: Smart LS IT Department
 * DATE:   2026-01-10
 * * DESCRIPTION:
 * This module manages the lifecycle of Proforma Invoices (PIs) from creation (draft)
 * to issuance and payment tracking. It integrates with the Client Master for CRM data
 * and the Operations Registry for file references.
 * * KEY FEATURES:
 * 1. Role-Based Access Control (RBAC):
 * - FINANCE: Create, Edit, Submit PIs.
 * - MANAGEMENT: Approve/Reject PIs.
 * - ADMIN: Full access.
 * - OPERATIONS/SALES: View only (if permitted).
 * * 2. Workflow States:
 * - DRAFT: Initial creation, editable.
 * - SUBMITTED: Pending management approval.
 * - APPROVED: Locked, ready for issuance.
 * - ISSUED: Sent to client (Immutable).
 * - PAID: Payment confirmed.
 * - REJECTED: Returned to draft with reason.
 * * 3. Integration Points:
 * - Quotation Intake (Import line items).
 * - Financial Dictionary (Autocomplete for line codes).
 * - CRM (Client details).
 * * ======================================================================================
 */

declare(strict_types=1);

// --- System Initialization ---
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

// --- RBAC Enforcement ---
// Only Admin, Finance, and Management can actively manage PIs.
// Operations may have read-only access depending on specific sub-policies.
require_role(['ADMIN', 'FINANCE', 'MANAGEMENT', 'OPERATIONS', 'SALES']);

// --- Authenticated User Profile Fetching ---
// Using the authoritative session data to retrieve full employee details.
$employeeId = (string)($_SESSION['auth']['employee_id'] ?? '');
$userId     = (int)($_SESSION['auth']['user_id'] ?? 0);

// Security Guard: Ensure valid session
if ($employeeId === '' || $userId <= 0) {
    header('Location: ../../api/auth/logout.php');
    exit;
}

// --- Database Connection & User Profile ---
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
if (!$stmt) {
    die("Database Error: Failed to prepare user profile query.");
}
$stmt->bind_param('is', $userId, $employeeId);
$stmt->execute();
$me = $stmt->get_result()->fetch_assoc();

if (!$me) {
    // If user exists in session but not DB, force logout
    header('Location: ../../api/auth/logout.php');
    exit;
}

// --- View Helpers ---
function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }

// --- User Display Data ---
$fullName  = trim((string)($me['full_name'] ?? 'User'));
$firstName = trim(explode(' ', $fullName)[0] ?? 'User');

// Map system roles to display labels
$role = strtoupper((string)($me['role'] ?? 'GUEST'));
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

// Avatar generation
$avatarName = urlencode($fullName);
$avatarUrl  = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";

// Time-based greeting
$hour = (int)date('H');
$greeting = ($hour < 12) ? 'Good morning' : (($hour < 18) ? 'Good afternoon' : 'Good evening');

// Export variables to JS for RBAC in frontend logic
$jsUserRole = json_encode($role);
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Proforma Invoice Portal | Smart LS</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  
  <link rel="stylesheet" href="../../css/admin.css">
  
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">

  <style>
    /* ==========================================================================
       SMART LS DESIGN SYSTEM V2 (Unified Theme)
       ========================================================================== */
    
    :root {
      /* Core Brand Colors */
      --smart-blue: #1F99D8;
      --smart-dark: #055B83;
      --smart-orange: #EE7D04;
      --smart-charcoal: #231F20;
      
      /* Backgrounds */
      --smart-bg: #F0F4F8;
      --sidebar-width: 280px;
      
      /* Typography */
      --font-ui: 'Manrope', sans-serif;
      --font-heading: 'Montserrat', sans-serif;
    }

    body { 
        font-family: var(--font-ui); 
        background: var(--smart-bg); 
        color: var(--smart-charcoal); 
        overflow-x: hidden; 
    }
    
    h1, h2, h3, h4, h5, h6 { font-family: var(--font-heading); }

    /* --- LAYOUT: SIDEBAR & TOPBAR (Standard) --- */
    .sidebar {
      width: var(--sidebar-width);
      height: 100vh;
      position: fixed; top: 0; left: 0;
      background: #fff;
      border-right: 1px solid #e0e0e0;
      z-index: 1000;
      display: flex;
      flex-direction: column;
      box-shadow: 2px 0 10px rgba(0,0,0,0.02);
    }
    .sidebar-header {
      height: 70px;
      display: flex;
      align-items: center;
      padding: 0 20px;
      border-bottom: 1px solid #f0f0f0;
    }
    .brand-logo {
      font-weight: 800; font-size: 1.1rem; color: var(--smart-charcoal);
      text-decoration: none; letter-spacing: -0.5px;
    }
    .sidebar-menu { overflow-y: auto; flex-grow: 1; padding: 10px 0; }

    .menu-btn {
      width: 100%;
      text-align: left;
      background: none;
      border: none;
      padding: 12px 20px;
      font-size: 0.8rem;
      font-weight: 700;
      color: #555;
      display: flex;
      justify-content: space-between;
      align-items: center;
      transition: all 0.2s;
      border-left: 3px solid transparent;
    }
    .menu-btn:hover, .menu-btn[aria-expanded="true"] {
      color: var(--smart-charcoal);
      background-color: #f0f7fa;
      border-left-color: var(--smart-charcoal);
    }
    .menu-btn i.category-icon { width: 20px; margin-right: 8px; color: #888; transition: color 0.2s; }
    .menu-btn:hover i.category-icon { color: var(--smart-charcoal); }
    .menu-chevron { font-size: 0.7rem; transition: transform 0.3s; }
    .menu-btn[aria-expanded="true"] .menu-chevron { transform: rotate(180deg); }
    
    .sub-link {
      display: block;
      padding: 8px 20px 8px 48px;
      font-size: 0.75rem;
      color: #666;
      text-decoration: none;
      font-weight: 500;
      transition: all 0.2s;
      line-height: 1.3;
    }
    .sub-link:hover { color: var(--smart-orange); background-color: #fff9f2; }
    .sub-link.active { color: var(--smart-orange); font-weight: 800; background-color: #fff9f2; }

    .sidebar-footer { border-top: 1px solid #f0f0f0; padding: 16px; }

    .main-content {
      margin-left: var(--sidebar-width);
      padding-top: 70px;
      min-height: 100vh;
      width: calc(100% - var(--sidebar-width));
    }
    
    .top-navbar {
      height: 70px;
      position: fixed;
      top: 0;
      right: 0;
      left: var(--sidebar-width);
      background: rgba(255,255,255,0.95);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid #e0e0e0;
      z-index: 900;
      padding: 0 30px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .clock-pill {
      background: #f1f5f9;
      padding: 6px 12px;
      border-radius: 30px;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--smart-dark);
    }

    /* --- COMPONENTS: CARDS & KPIS --- */
    .card-custom {
      background: white;
      border-radius: 12px;
      border: 1px solid rgba(0,0,0,0.05);
      box-shadow: 0 2px 12px rgba(0,0,0,0.02);
      height: 100%;
    }

    .kpi-title {
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      color: #888;
      letter-spacing: 0.5px;
      white-space: nowrap;
    }
    .kpi-value {
      font-size: 1.6rem;
      font-weight: 800;
      color: var(--smart-charcoal);
      line-height: 1.2;
      font-variant-numeric: tabular-nums;
    }

    /* --- COMPONENTS: TABLES --- */
    .table-custom th {
      font-size: 0.75rem;
      text-transform: uppercase;
      color: #888;
      font-weight: 700;
      border-bottom: 2px solid #f0f0f0;
      padding: 12px;
      white-space: nowrap;
      background-color: #f8fafc;
    }
    .table-custom td {
      font-size: 0.85rem;
      vertical-align: middle;
      padding: 12px;
    }
    .table-hover tbody tr:hover {
        background-color: #f8fafc;
        cursor: pointer;
    }

    /* --- COMPONENTS: STATUS PILLS --- */
    .status-pill {
      font-size: 0.65rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 5px 10px;
      border-radius: 6px;
      white-space: nowrap;
    }
    .status-draft { background: #e2e8f0; color: #475569; }
    .status-submitted { background: #e0f2fe; color: #0369a1; }
    .status-approved { background: #dcfce7; color: #15803d; }
    .status-issued { background: #ffedd5; color: #c2410c; }
    .status-paid { background: #231F20; color: #fff; border: 1px solid #000; }
    .status-rejected { background: #fee2e2; color: #991b1b; }

    /* --- COMPONENTS: FORMS & INPUTS --- */
    .smart-input { 
        border-radius: 8px; 
        font-size: 0.9rem; 
        padding: 0.6rem 0.8rem; 
        border-color: #dee2e6; 
    }
    .smart-input:focus { 
        border-color: var(--smart-blue); 
        box-shadow: 0 0 0 3px rgba(31,153,216,0.1); 
    }
    .form-label {
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        color: #64748B;
        letter-spacing: 0.5px;
    }

    /* --- EDITOR OFFCANVAS --- */
    .offcanvas-header { background-color: #f8fafc; border-bottom: 1px solid #e0e0e0; }
    .offcanvas-title { font-family: 'Montserrat', sans-serif; font-weight: 700; }
    
    /* Layout for Editor */
    .editor-layout { display: flex; height: 100%; }
    .editor-sidebar {
        width: 320px;
        border-right: 1px solid #e0e0e0;
        background: #fff;
        padding: 20px;
        overflow-y: auto;
    }
    .editor-main {
        flex: 1;
        display: flex;
        flex-direction: column;
        background: #fff;
        overflow: hidden;
    }
    .editor-table-container { flex: 1; overflow-y: auto; padding: 20px; }
    .editor-footer {
        background: #f8fafc;
        border-top: 1px solid #e0e0e0;
        padding: 15px 25px;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 30px;
    }

    /* --- PRINT STYLES (Preserved PDF Look) --- */
    @media print {
        @page { size: A4; margin: 0; }
        body { background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        body > *:not(#print-container) { display: none !important; }
        .modal, .modal-backdrop, .offcanvas, .offcanvas-backdrop { display: none !important; }
        #print-container { display: block !important; position: absolute; top: 0; left: 0; width: 100%; margin: 0; padding: 0; background: white; }
    }

    /* PDF Design (Internal to print container) */
    .a4-sheet { width: 210mm; min-height: 297mm; background: white; margin: 0 auto; padding: 10mm 15mm; position: relative; font-family: 'Montserrat', sans-serif; color: #000; }
    .pdf-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px; }
    .pdf-logo img { width: 160px; height: auto; }
    .pdf-company { text-align: right; font-size: 7.5pt; line-height: 1.3; color: #231F20; }
    .pdf-company-name { font-weight: 900; font-size: 10pt; text-transform: uppercase; margin-bottom: 2px; }
    .pdf-grid { display: flex; gap: 15px; margin-bottom: 15px; }
    .pdf-col-6 { flex: 1; }
    .pdf-box-title { font-size: 7.5pt; font-weight: 800; text-transform: uppercase; border-bottom: 1px solid #000; margin-bottom: 4px; color: #231F20; }
    .pdf-kv-table { width: 100%; border-collapse: collapse; font-size: 7.5pt; }
    .pdf-kv-table td { padding: 1px 0; vertical-align: top; }
    .pdf-kv-key { font-weight: 700; width: 70px; }
    .pdf-table { width: 100%; border-collapse: collapse; font-size: 7.5pt; margin-bottom: 10px; }
    .pdf-table th { border: 1px solid #000; background: #eee; padding: 3px 4px; text-align: left; font-weight: 800; text-transform: uppercase; }
    .pdf-table td { border: 1px solid #000; padding: 3px 4px; vertical-align: middle; }
    .pdf-totals-table { width: 100%; border-collapse: collapse; font-size: 8pt; border: 1px solid #000; }
    .pdf-totals-table td { padding: 4px; border-bottom: 1px solid #ccc; }
    .pdf-grand-total { font-weight: 900; background: #f0f0f0; border-top: 2px solid #000; }
    .pdf-footer { position: absolute; bottom: 10mm; left: 15mm; right: 15mm; font-size: 7pt; color: #000; }
    .pdf-bank-row { display: flex; justify-content: space-between; border-top: 1px solid #000; padding-top: 4px; margin-top: 4px; }

    /* Toast */
    .toast-container { position: fixed; top: 20px; right: 20px; z-index: 3000; }
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
      <h5 class="mb-0 fw-bold text-dark">Admin Governance</h5>
      <small class="text-muted" style="font-size: 0.7rem;">SYSTEM HEALTH & SECURITY OVERSIGHT</small>
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

    <div class="row g-3 mb-4 mt-2">
        <div class="col-md-3">
            <div class="card-custom p-3">
                <div class="kpi-title">Total Quotes (MTD)</div>
                <div class="kpi-value" id="kpi-quotes">-</div>
                <small class="text-muted" style="font-size:0.75rem;">Based on <span id="kpi-quotes-count">0</span> quotes</small>
            </div>
        </div>
        <div class="col-md-3">
            <div class="card-custom p-3">
                <div class="kpi-title">Proforma Issued</div>
                <div class="kpi-value text-primary" id="kpi-issued">-</div>
                <small class="text-muted" style="font-size:0.75rem;">Successfully sent</small>
            </div>
        </div>
        <div class="col-md-3">
            <div class="card-custom p-3">
                <div class="kpi-title">Conversion Rate</div>
                <div class="kpi-value text-warning" id="kpi-conversion">-%</div>
                <small class="text-muted" style="font-size:0.75rem;">Quote to PI</small>
            </div>
        </div>
        <div class="col-md-3">
            <div class="card-custom p-3">
                <div class="kpi-title">Pending Payment</div>
                <div class="kpi-value text-danger" id="kpi-pending">-</div>
                <small class="text-muted" style="font-size:0.75rem;">Awaiting funds</small>
            </div>
        </div>
    </div>
    <div class="row py-4 align-items-center">
      <div class="col-md-6">
        <p class="text-muted mb-0 small">Proforma Registry</p>
      </div>
      <div class="col-md-6 text-end">
        <?php if ($role === 'FINANCE' || $role === 'ADMIN'): ?>
        <button class="btn btn-dark fw-bold px-4 py-2 shadow-sm" onclick="APP.initNewProforma()">
          <i class="fa-solid fa-plus me-2"></i>New Proforma
        </button>
        <?php endif; ?>
      </div>
    </div>

    <div class="card-custom p-0 overflow-hidden">
        
        <div class="p-3 border-bottom bg-light d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div class="btn-group" role="group">
                <button type="button" class="btn btn-sm btn-outline-secondary fw-bold active filter-btn" data-filter="ALL" onclick="APP.filterTable('ALL')">All</button>
                <button type="button" class="btn btn-sm btn-outline-secondary fw-bold filter-btn" data-filter="DRAFT" onclick="APP.filterTable('DRAFT')">Draft</button>
                <button type="button" class="btn btn-sm btn-outline-primary fw-bold filter-btn" data-filter="SUBMITTED" onclick="APP.filterTable('SUBMITTED')">Submitted</button>
                <button type="button" class="btn btn-sm btn-outline-success fw-bold filter-btn" data-filter="APPROVED" onclick="APP.filterTable('APPROVED')">Approved</button>
                <button type="button" class="btn btn-sm btn-outline-warning text-dark fw-bold filter-btn" data-filter="ISSUED" onclick="APP.filterTable('ISSUED')">Issued</button>
            </div>

            <div class="input-group input-group-sm" style="width: 280px;">
                <span class="input-group-text bg-white border-end-0"><i class="fa-solid fa-search text-muted"></i></span>
                <input type="text" class="form-control border-start-0 ps-0 smart-input" placeholder="Search Reference, Client..." onkeyup="APP.searchTable(this.value)">
            </div>
        </div>

        <div class="table-responsive">
            <table class="table table-hover table-custom mb-0 align-middle">
                <thead class="bg-light">
                    <tr>
                        <th class="ps-4">Date</th>
                        <th>PI Reference</th>
                        <th>Linked Quote</th>
                        <th>Client / Account</th>
                        <th class="text-end">Quote Amount</th>
                        <th class="text-end">Advance Payable</th>
                        <th class="text-center">Status</th>
                        <th class="text-end pe-4">Action</th>
                    </tr>
                </thead>
                <tbody id="dataTableBody">
                    </tbody>
            </table>
            
            <div id="emptyState" class="text-center py-5 d-none">
                <i class="fa-solid fa-file-invoice fa-3x text-muted mb-3 opacity-50"></i>
                <h6 class="fw-bold text-muted">No Proformas Found</h6>
                <p class="text-muted small">Create a new proforma to get started.</p>
            </div>
            
            <div id="tableLoader" class="text-center py-5 d-none">
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
            </div>
        </div>
    </div>

  </div>

  <div class="offcanvas offcanvas-end" tabindex="-1" id="proformaEditor" data-bs-backdrop="static" style="width: 95vw; max-width: 1600px;">
    <div class="offcanvas-header bg-light border-bottom py-3">
        <div class="d-flex align-items-center gap-3">
            <div>
                <h5 class="offcanvas-title fw-bold mb-0" id="editorTitle">Proforma Worksheet</h5>
                <div class="d-flex align-items-center gap-2 mt-1">
                    <span class="status-pill status-draft" id="editorStatus">DRAFT</span>
                    <small class="text-muted font-monospace" id="editorRef">SLAS-PI-NEW</small>
                </div>
            </div>
        </div>
        <div id="editorActions" class="d-flex gap-2">
            <button class="btn btn-outline-secondary fw-bold btn-sm" data-bs-dismiss="offcanvas">Close</button>
        </div>
    </div>

    <div class="offcanvas-body p-0">
        <div class="editor-layout">
            
            <div class="editor-sidebar bg-light">
                <div class="mb-4">
                    <h6 class="text-muted small fw-bold text-uppercase border-bottom pb-2 mb-3">Document Details</h6>
                    <div class="mb-3">
                        <label class="form-label">Issue Date</label>
                        <input type="date" class="form-control smart-input" id="edDate">
                    </div>
                    <div class="mb-3">
                        <label class="form-label">Currency</label>
                        <select class="form-select smart-input" id="edCurrency">
                            <option value="XAF">XAF (BEAC)</option>
                            <option value="USD">USD ($)</option>
                            <option value="EUR">EUR (€)</option>
                        </select>
                    </div>
                </div>

                <div class="mb-4">
                    <h6 class="text-muted small fw-bold text-uppercase border-bottom pb-2 mb-3">Client & Linkage</h6>
                    <div class="mb-3">
                        <label class="form-label">Import Quotation</label>
                        <select class="form-select smart-input" id="edQuoteSource">
                            <option value="">Select quotation...</option>
                        </select>
                    </div>
                    <div class="mb-3">
                        <label class="form-label">Client Name</label>
                        <input type="text" class="form-control smart-input bg-white" id="edClient" readonly>
                    </div>
                    <div class="mb-3">
                        <label class="form-label">File Reference</label>
                        <input type="text" class="form-control smart-input bg-white font-monospace" id="edFile" readonly>
                    </div>
                </div>

                <div>
                    <h6 class="text-muted small fw-bold text-uppercase border-bottom pb-2 mb-3">Terms</h6>
                    <div class="mb-3">
                        <label class="form-label">Bank Details</label>
                        <textarea class="form-control smart-input" id="edBank" rows="4"></textarea>
                    </div>
                    <div class="mb-3">
                        <label class="form-label">Remarks</label>
                        <textarea class="form-control smart-input" id="edRemarks" rows="3" placeholder="Payment terms..."></textarea>
                    </div>
                </div>
            </div>

            <div class="editor-main">
                <div class="editor-table-container">
                    <table class="table table-hover table-custom align-middle">
                        <thead class="bg-light">
                            <tr>
                                <th style="width: 50px;">#</th>
                                <th style="width: 120px;">Code</th>
                                <th>Description</th>
                                <th style="width: 100px; text-align: center;">Qty</th>
                                <th style="width: 150px; text-align: right;">Unit Price</th>
                                <th style="width: 150px; text-align: right;">Total HT</th>
                                <th style="width: 80px; text-align: center;">VAT</th>
                                <th style="width: 50px;"></th>
                            </tr>
                        </thead>
                        <tbody id="editorLines"></tbody>
                    </table>
                    
                    <div class="text-center mt-4">
                        <button class="btn btn-outline-dark btn-sm fw-bold border-dashed" id="btnAddLine">
                            <i class="fa-solid fa-plus me-2"></i> Add Line Item
                        </button>
                    </div>
                </div>

                <div class="editor-footer">
                    <div class="d-flex align-items-center gap-3 me-auto">
                        <div class="input-group input-group-sm" style="width: 180px;">
                            <span class="input-group-text fw-bold">Advance %</span>
                            <input type="number" class="form-control text-center fw-bold" id="edAdvancePct" value="100" min="1" max="100">
                        </div>
                    </div>

                    <div class="text-end me-4">
                        <div class="text-muted small fw-bold text-uppercase">Total HT</div>
                        <div class="font-monospace fw-bold" id="dispHT">0</div>
                    </div>
                    <div class="text-end me-4">
                        <div class="text-muted small fw-bold text-uppercase">VAT (19.25%)</div>
                        <div class="font-monospace fw-bold" id="dispVAT">0</div>
                    </div>
                    <div class="text-end me-4 border-start ps-4">
                        <div class="text-muted small fw-bold text-uppercase">Grand Total</div>
                        <div class="font-monospace fw-bold fs-5 text-dark" id="dispTTC">0</div>
                    </div>
                    <div class="text-end p-2 bg-warning bg-opacity-10 rounded border border-warning">
                        <div class="text-warning small fw-bold text-uppercase">Payable Advance</div>
                        <div class="font-monospace fw-bold fs-4 text-warning" id="dispPayable">0 XAF</div>
                    </div>
                </div>
            </div>

        </div>
    </div>
  </div>

  <div class="toast-container" id="toastContainer"></div>

  <div id="print-container" style="display: none;"></div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

    <script>
        /**
         * ==================================================================================
         * SMART LS PROFORMA PORTAL v4.0
         * Production-Ready Frontend with Full API Integration
         * ==================================================================================
         */

        const APP = (function() {
            'use strict';

            // Configuration
            const CONFIG = {
                API_BASE: '../../api/proforma-invoice/proforma-api.php',
                USER_ROLE: '<?php echo $role; ?>',
                VAT_RATE: 0.1925,
                DEFAULT_BANK: `Bank: AFRILAND FIRST BANK
                    Account Name: SMART LOGISTICS AND SERVICES LTD
                    Account Number: 10005-0006-107018411001-93
                    Swift Code: CCEICRBA
                    IBAN: CM21-1000-5000-6107-0184-1100-1-93`
            };

            // State Management
            let state = {
                proformas: [],
                quotes: [],
                currentFilter: 'ALL',
                currentSearch: '',
                currentProforma: null,
                previousCurrency: 'XAF',
                bsOffcanvas: null
            };

            // Utility Functions
            const utils = {
                formatNumber: (n) => new Intl.NumberFormat('en-US').format(Math.round(n)),
                parseNumber: (s) => parseFloat(String(s).replace(/,/g, '')) || 0,
                
                showToast: (title, message, type = 'success') => {
                    const container = document.getElementById('toastContainer');
                    const toast = document.createElement('div');
                    toast.className = `toast ${type}`;
                    toast.innerHTML = `
                        <div class="toast-icon">
                            <i class="fa-solid fa-${type === 'success' ? 'check' : 'exclamation'}"></i>
                        </div>
                        <div class="toast-content">
                            <div class="toast-title">${title}</div>
                            <div class="toast-message">${message}</div>
                        </div>
                    `;
                    container.appendChild(toast);
                    setTimeout(() => toast.remove(), 5000);
                },

                showLoader: (show = true) => {
                    const loader = document.getElementById('tableLoader');
                    if (loader) {
                        loader.style.display = show ? 'flex' : 'none';
                    }
                },

                getStatusClass: (status) => {
                    const map = {
                        'DRAFT': 'status-draft',
                        'SUBMITTED': 'status-submitted',
                        'APPROVED': 'status-approved',
                        'ISSUED': 'status-issued',
                        'PAID': 'status-paid',
                        'REJECTED': 'status-rejected'
                    };
                    return map[status] || 'status-draft';
                },

                getPrintData: async (invoiceId) => {
                    const url = `../../api/proforma-invoice/proforma-print-api.php?invoice_id=${invoiceId}`;
                    const response = await fetch(url);
                    const result = await response.json();
                    if (!result.success) throw new Error(result.error);
                    return result;
                },
            };

            // API Communication
            const api = {
                async call(action, data = null, method = 'GET') {
                    try {
                        const url = method === 'GET' && data 
                            ? `${CONFIG.API_BASE}?action=${action}&${new URLSearchParams(data).toString()}`
                            : `${CONFIG.API_BASE}?action=${action}`;

                        const options = {
                            method,
                            headers: { 'Content-Type': 'application/json' }
                        };

                        if (method === 'POST' && data) {
                            options.body = JSON.stringify(data);
                        }

                        const response = await fetch(url, options);
                        const result = await response.json();

                        if (!result.success) {
                            throw new Error(result.error || 'API request failed');
                        }

                        return result;
                    } catch (error) {
                        console.error('API Error:', error);
                        utils.showToast('Error', error.message, 'error');
                        throw error;
                    }
                },

                getProformas: () => api.call('get_all_proformas'),
                getQuotations: () => api.call('get_quotations_dropdown'),
                getQuoteDetails: (quoteRef) => api.call('get_quotation_prefill', { quote_ref: quoteRef }),
                searchDictionary: (query) => api.call('search_dictionary', { q: query }),
                getKPIs: () => api.call('get_kpis'),
                getProformaDetail: (invoiceId) => api.call('get_proforma_detail', { invoice_id: invoiceId }),
                saveProforma: (data) => api.call('save_proforma', data, 'POST'),
                submitForApproval: (invoiceId) => api.call('submit_for_approval', { invoice_id: invoiceId }, 'POST'),
                approveProforma: (invoiceId) => api.call('approve_proforma', { invoice_id: invoiceId }, 'POST'),
                rejectProforma: (invoiceId, reason) => api.call('reject_proforma', { invoice_id: invoiceId, reason }, 'POST'),
                issueProforma: (invoiceId) => api.call('issue_proforma', { invoice_id: invoiceId }, 'POST'),
                //getPrintData: (invoiceId) => api.call('get_print_data', { invoice_id: invoiceId }, 'GET')
            };

            // Dashboard Functions
            async function loadDashboard() {
                utils.showLoader(true);
                
                try {
                    const [proformasRes, kpisRes] = await Promise.all([
                        api.getProformas(),
                        api.getKPIs()
                    ]);

                    state.proformas = proformasRes.proformas || [];

                    renderKPIs(kpisRes.kpis);
                    renderTable();
                } catch (error) {
                    console.error('Dashboard load error:', error);
                } finally {
                    utils.showLoader(false);
                }
            }

            function renderKPIs(kpis) {
                document.getElementById('kpi-quotes').textContent = utils.formatNumber(kpis.total_proformas_value || 0);
                document.getElementById('kpi-quotes-count').textContent = kpis.total_proformas_mtd || 0;
                document.getElementById('kpi-issued').textContent = utils.formatNumber(kpis.total_issued_amount || 0);
                document.getElementById('kpi-conversion').textContent = (kpis.conversion_rate || 0) + '%';
                document.getElementById('kpi-pending').textContent = kpis.pending_payments || 0;
            }

            function renderTable() {
                const tbody = document.getElementById('dataTableBody');
                const emptyState = document.getElementById('emptyState');
                
                let filtered = state.proformas;

                // Apply filter
                if (state.currentFilter !== 'ALL') {
                    filtered = filtered.filter(p => p.workflow_status === state.currentFilter);
                }

                // Apply search
                if (state.currentSearch) {
                    const search = state.currentSearch.toLowerCase();
                    filtered = filtered.filter(p => 
                        p.invoice_no.toLowerCase().includes(search) ||
                        p.client_name.toLowerCase().includes(search) ||
                        (p.file_reference && p.file_reference.toLowerCase().includes(search))
                    );
                }

                if (filtered.length === 0) {
                    tbody.innerHTML = '';
                    emptyState.classList.remove('hidden');
                    return;
                }

                emptyState.classList.add('hidden');
                
                tbody.innerHTML = filtered.map(p => `
                    <tr onclick="APP.openEditor('${p.invoice_no}')">
                        <td class="cell-mono cell-muted">${p.issue_date}</td>
                        <td class="cell-mono cell-primary">${p.invoice_no}</td>
                        <td class="cell-muted">${p.linked_quote_ref || '—'}</td>
                        <td class="cell-bold">${p.client_name}</td>
                        <td class="text-end cell-mono">${utils.formatNumber(p.total || 0)}</td>
                        <td class="text-end cell-mono cell-bold">${utils.formatNumber(p.payable_advance)}</td>
                        <td class="text-center">
                            <span class="status-badge ${utils.getStatusClass(p.workflow_status)}">${p.workflow_status}</span>
                        </td>
                        <td class="text-end">
                            ${getActionIcon(p.workflow_status)}
                        </td>
                    </tr>
                `).join('');
            }

            function getActionIcon(status) {
                if (status === 'ISSUED') return '<i class="fa-solid fa-download" style="color: var(--smart-blue);"></i>';
                if (status === 'SUBMITTED' && CONFIG.USER_ROLE === 'MANAGEMENT') return '<i class="fa-solid fa-triangle-exclamation" style="color: var(--smart-orange);"></i>';
                if (status === 'DRAFT') return '<i class="fa-solid fa-pen" style="color: var(--text-tertiary);"></i>';
                return '<i class="fa-solid fa-eye" style="color: var(--text-tertiary);"></i>';
            }

            function filterTable(filter) {
                state.currentFilter = filter;
                
                // Update UI
                document.querySelectorAll('.filter-chip').forEach(chip => {
                    chip.classList.toggle('active', chip.textContent.includes(filter === 'ALL' ? 'All' : filter.charAt(0) + filter.slice(1).toLowerCase()));
                });
                
                renderTable();
            }

            function searchTable(query) {
                state.currentSearch = query;
                renderTable();
            }

            // Editor Functions
            async function initNewProforma() {
                if (CONFIG.USER_ROLE !== 'FINANCE' && CONFIG.USER_ROLE !== 'ADMIN') {
                    utils.showToast('Access Denied', 'Only Finance can create proformas', 'error');
                    return;
                }

                state.currentProforma = {
                    status: 'DRAFT',
                    date: new Date().toISOString().split('T')[0],
                    currency: 'XAF',
                    pct: 100,
                    lines: [],
                    bank: CONFIG.DEFAULT_BANK,
                    remarks: ''
                };
                state.previousCurrency = 'XAF';

                // Load quotations
                const quotesRes = await api.getQuotations();
                state.quotes = quotesRes.quotations || [];
                
                populateEditor();
                state.bsOffcanvas.show();
            }

            async function openEditor(invoiceNo) {
                try {
                    // Find invoice_id from the list
                    const proforma = state.proformas.find(p => p.invoice_no === invoiceNo);
                    if (!proforma) return;

                    // Fetch full details from API
                    const detailRes = await api.getProformaDetail(proforma.invoice_id);
                    state.currentProforma = detailRes.proforma;
                    state.previousCurrency = state.currentProforma.currency;

                    populateEditor();
                    state.bsOffcanvas.show();
                } catch (error) {
                    console.error('Error loading proforma:', error);
                }
            }

            function populateEditor() {
                const p = state.currentProforma;
                
                // Header
                document.getElementById('editorTitle').textContent = p.invoice_id ? 'Edit Proforma' : 'New Proforma';
                document.getElementById('editorStatus').textContent = p.workflow_status || p.status || 'DRAFT';
                document.getElementById('editorStatus').className = `status-badge ${utils.getStatusClass(p.workflow_status || p.status || 'DRAFT')}`;
                document.getElementById('editorRef').textContent = p.invoice_no || 'SLAS-PI-NEW';

                // Form fields
                document.getElementById('edDate').value = p.issue_date || p.date || new Date().toISOString().split('T')[0];
                document.getElementById('edCurrency').value = p.currency || 'XAF';
                document.getElementById('edClient').value = p.client_name || '';
                document.getElementById('edFile').value = p.file_reference || '';
                document.getElementById('edBank').value = p.bank_details || CONFIG.DEFAULT_BANK;
                document.getElementById('edRemarks').value = p.remarks || '';
                document.getElementById('edAdvancePct').value = p.advance_percentage || p.pct || 100;

                // Quote dropdown
                const quoteSelect = document.getElementById('edQuoteSource');
                if (p.invoice_id) {
                    quoteSelect.innerHTML = `<option value="${p.linked_quote_ref}">${p.linked_quote_ref}</option>`;
                    quoteSelect.disabled = true;
                } else {
                    quoteSelect.innerHTML = '<option value="">Select quotation...</option>' + 
                        state.quotes.map(q => `<option value="${q.simulation_ref}">${q.display_text}</option>`).join('');
                    quoteSelect.disabled = false;
                }

                // Lock if needed
                const isLocked = p.workflow_status === 'APPROVED' || p.workflow_status === 'ISSUED';
                document.querySelectorAll('.editor-sidebar input, .editor-sidebar textarea, .editor-sidebar select').forEach(el => {
                    if (el.id !== 'edQuoteSource') el.disabled = isLocked;
                });
                document.getElementById('btnAddLine').style.display = isLocked ? 'none' : 'inline-flex';

                renderLines();
                renderEditorActions();
            }

            async function importQuote() {
                const quoteRef = document.getElementById('edQuoteSource').value;
                if (!quoteRef) return;

                try {
                    // Get prefill data from API
                    const prefillRes = await api.getQuoteDetails(quoteRef);
                    const prefill = prefillRes.prefill;

                    // Update state
                    state.currentProforma.linked_quote_ref = prefill.simulation_ref;
                    state.currentProforma.client_name = prefill.client_name;
                    state.currentProforma.file_reference = prefill.file_reference;
                    state.currentProforma.bank_details = prefill.bank_details;
                    state.currentProforma.payment_terms = prefill.payment_terms;
                    state.currentProforma.currency = prefill.currency;
                    state.currentProforma.lines = prefill.lines.map(line => ({
                        code: line.code,
                        description: line.description,
                        qty: line.qty,
                        unit_price: line.unit_price,
                        vat_applicable: line.vat_applicable,
                        vat_rate: line.vat_rate,
                        source_quote_line_id: line.source_quote_line_id,
                        is_ad_hoc: false
                    }));

                    // Update form fields
                    document.getElementById('edClient').value = prefill.client_name;
                    document.getElementById('edFile').value = prefill.file_reference;
                    document.getElementById('edBank').value = prefill.bank_details;
                    document.getElementById('edCurrency').value = prefill.currency;

                    renderLines();
                    utils.showToast('Success', 'Quotation imported successfully', 'success');
                } catch (error) {
                    console.error('Import error:', error);
                    utils.showToast('Error', 'Failed to import quotation', 'error');
                }
            }

            function renderLines() {
                const tbody = document.getElementById('editorLines');
                const lines = state.currentProforma.lines || [];
                const isLocked = state.currentProforma.workflow_status === 'APPROVED' || state.currentProforma.workflow_status === 'ISSUED';

                tbody.innerHTML = lines.map((line, idx) => {
                    const unit = line.unit_price || line.unit || 0;
                    const ht = line.qty * unit;
                    const vatChecked = line.vat_applicable || line.vat || false;
                    return `
                        <tr>
                            <td><input type="text" value="${idx + 1}" disabled></td>
                            <td><input type="text" class="font-mono" value="${line.code}" onchange="APP.updateLine(${idx}, 'code', this.value)" ${isLocked ? 'disabled' : ''} placeholder="Code"></td>
                            <td>
                                <input type="text" 
                                       value="${line.description || line.desc || ''}" 
                                       onchange="APP.updateLine(${idx}, 'description', this.value)"
                                       oninput="APP.searchDictionaryForLine(${idx}, this.value)"
                                       ${isLocked ? 'disabled' : ''} 
                                       placeholder="Type to search financial dictionary..."
                                       list="dict-suggestions-${idx}">
                                <datalist id="dict-suggestions-${idx}"></datalist>
                            </td>
                            <td><input type="number" value="${line.qty}" onchange="APP.updateLine(${idx}, 'qty', this.value)" style="text-align: center;" ${isLocked ? 'disabled' : ''}></td>
                            <td><input type="text" value="${utils.formatNumber(unit)}" onchange="APP.updateLine(${idx}, 'unit_price', this.value)" style="text-align: right;" ${isLocked ? 'disabled' : ''}></td>
                            <td><input type="text" value="${utils.formatNumber(ht)}" disabled style="text-align: right;"></td>
                            <td style="text-align: center;"><input type="checkbox" ${vatChecked ? 'checked' : ''} onchange="APP.updateLine(${idx}, 'vat_applicable', this.checked)" ${isLocked ? 'disabled' : ''}></td>
                            <td style="text-align: center;">${!isLocked ? `<i class="fa-solid fa-trash" style="color: var(--status-rejected); cursor: pointer;" onclick="APP.deleteLine(${idx})"></i>` : ''}</td>
                        </tr>
                    `;
                }).join('');

                calculateTotals();
            }

            // New function for dictionary autocomplete
            async function searchDictionaryForLine(lineIdx, query) {
                if (!query || query.length < 2) return;

                try {
                    const result = await api.searchDictionary(query);
                    const datalist = document.getElementById(`dict-suggestions-${lineIdx}`);
                    
                    if (datalist && result.items) {
                        datalist.innerHTML = result.items.map(item => 
                            `<option value="${item.description}" data-code="${item.code}" data-vat="${item.vat_applicable}">${item.code} - ${item.description}</option>`
                        ).join('');
                        
                        // Auto-fill code when description matches
                        const matchedItem = result.items.find(item => 
                            item.description.toLowerCase() === query.toLowerCase()
                        );
                        
                        if (matchedItem) {
                            state.currentProforma.lines[lineIdx].code = matchedItem.code;
                            state.currentProforma.lines[lineIdx].vat_applicable = matchedItem.vat_applicable;
                            renderLines();
                        }
                    }
                } catch (error) {
                    console.error('Dictionary search error:', error);
                }
            }

            function updateLine(idx, field, value) {
                if (field === 'qty') value = parseFloat(value) || 0;
                if (field === 'unit') value = utils.parseNumber(value);
                state.currentProforma.lines[idx][field] = value;
                renderLines();
            }

            function addNewLine() {
                state.currentProforma.lines.push({
                    code: '',  // Empty - will be filled by financial dictionary
                    description: '',  // Empty - user types and autocomplete suggests
                    qty: 1,
                    unit_price: 0,
                    vat_applicable: true,
                    vat_rate: 0.1925,
                    is_ad_hoc: true
                });
                renderLines();
            }

            function deleteLine(idx) {
                state.currentProforma.lines.splice(idx, 1);
                renderLines();
            }

            function calculateTotals() {
                let totalHT = 0;
                let totalVAT = 0;

                state.currentProforma.lines.forEach(line => {
                    const unitPrice = line.unit_price || line.unit || 0;
                    const ht = line.qty * unitPrice;
                    const vatApplicable = line.vat_applicable || line.vat || false;
                    const vatRate = line.vat_rate || CONFIG.VAT_RATE;
                    const vat = vatApplicable ? ht * vatRate : 0;
                    totalHT += ht;
                    totalVAT += vat;
                });

                const totalTTC = totalHT + totalVAT;
                const pct = parseFloat(document.getElementById('edAdvancePct').value) || 100;
                const payable = Math.round(totalTTC * (pct / 100));

                state.currentProforma.subtotal = totalHT;
                state.currentProforma.vat = totalVAT;
                state.currentProforma.total = totalTTC;
                state.currentProforma.payable_advance = payable;
                state.currentProforma.advance_percentage = pct;

                document.getElementById('dispHT').textContent = utils.formatNumber(totalHT);
                document.getElementById('dispVAT').textContent = utils.formatNumber(totalVAT);
                document.getElementById('dispTTC').textContent = utils.formatNumber(totalTTC);
                document.getElementById('dispPayable').textContent = utils.formatNumber(payable) + ' ' + (state.currentProforma.currency || 'XAF');
            }

            function renderEditorActions() {
                const container = document.getElementById('editorActions');
                const p = state.currentProforma;
                const wfStatus = p.workflow_status || 'DRAFT';
                
                let html = '<button class="btn btn-secondary" data-bs-dismiss="offcanvas">Close</button>';

                if (wfStatus === 'DRAFT' && (CONFIG.USER_ROLE === 'FINANCE' || CONFIG.USER_ROLE === 'ADMIN')) {
                    html += `
                        <button class="btn btn-secondary" onclick="APP.saveProforma('DRAFT')">Save Draft</button>
                        <button class="btn btn-primary" onclick="APP.saveProforma('SUBMIT')">Submit for Approval</button>
                    `;
                } else if (wfStatus === 'SUBMITTED' && (CONFIG.USER_ROLE === 'MANAGEMENT' || CONFIG.USER_ROLE === 'ADMIN')) {
                    html += `
                        <button class="btn btn-danger" onclick="APP.rejectProforma()">Reject</button>
                        <button class="btn btn-success" onclick="APP.approveProforma()">Approve</button>
                    `;
                } else if (wfStatus === 'APPROVED') {
                    html += `<button class="btn btn-primary" onclick="APP.issueProforma()">Issue & Lock</button>`;
                } else if (wfStatus === 'ISSUED' || wfStatus === 'PAID') {
                    html += `<button class="btn btn-primary" onclick="APP.printProforma()">
                        <i class="fa-solid fa-print"></i> Print Proforma
                    </button>`;
                }

                container.innerHTML = html;
            }

            // Workflow Functions
            async function saveProforma(action) {
                try {
                    const p = state.currentProforma;
                    
                    const data = {
                        invoice_id: p.invoice_id,
                        issue_date: document.getElementById('edDate').value,
                        currency: document.getElementById('edCurrency').value,
                        client_name: p.client_name,
                        file_reference: document.getElementById('edFile').value,
                        linked_quote_ref: p.linked_quote_ref,
                        advance_percentage: parseInt(document.getElementById('edAdvancePct').value),
                        bank_details: document.getElementById('edBank').value,
                        remarks: document.getElementById('edRemarks').value,
                        lines: p.lines.map(line => ({
                            code: line.code,
                            description: line.description || line.desc || '',
                            qty: parseFloat(line.qty),
                            unit_price: parseFloat(line.unit_price || line.unit || 0),
                            vat_applicable: line.vat_applicable || line.vat || false,
                            vat_rate: line.vat_rate || 0.1925,
                            remarks: line.remarks || '',
                            is_ad_hoc: line.is_ad_hoc || false,
                            source_quote_line_id: line.source_quote_line_id || null
                        }))
                    };

                    const result = await api.saveProforma(data);
                    
                    if (action === 'SUBMIT') {
                        await api.submitForApproval(result.invoice_id);
                    }

                    utils.showToast('Success', 'Proforma saved successfully', 'success');
                    state.bsOffcanvas.hide();
                    loadDashboard();
                } catch (error) {
                    console.error('Save error:', error);
                }
            }

            async function approveProforma() {
                if (!confirm('Approve this proforma? This will lock it from further editing.')) return;

                try {
                    await api.approveProforma(state.currentProforma.invoice_id);
                    utils.showToast('Success', 'Proforma approved', 'success');
                    state.bsOffcanvas.hide();
                    loadDashboard();
                } catch (error) {
                    console.error('Approve error:', error);
                }
            }

            async function rejectProforma() {
                const reason = prompt('Rejection reason:');
                if (!reason) return;

                try {
                    await api.rejectProforma(state.currentProforma.invoice_id, reason);
                    utils.showToast('Success', 'Proforma rejected', 'success');
                    state.bsOffcanvas.hide();
                    loadDashboard();
                } catch (error) {
                    console.error('Reject error:', error);
                }
            }

            async function issueProforma() {
                if (!confirm('Issue this proforma? This will finalize and lock the document.')) return;

                try {
                    await api.issueProforma(state.currentProforma.invoice_id);
                    utils.showToast('Success', 'Proforma issued successfully', 'success');
                    state.bsOffcanvas.hide();
                    loadDashboard();
                } catch (error) {
                    console.error('Issue error:', error);
                }
            }

            // Initialize
            function init() {
                state.bsOffcanvas = new bootstrap.Offcanvas('#proformaEditor');
                
                // Event listeners
                document.getElementById('edQuoteSource').addEventListener('change', importQuote);
                document.getElementById('btnAddLine').addEventListener('click', addNewLine);
                document.getElementById('edAdvancePct').addEventListener('input', calculateTotals);
                document.getElementById('edCurrency').addEventListener('change', handleCurrencyChange);

                // Load initial data
                loadDashboard();
            }

            function handleCurrencyChange(e) {
                const newCurr = e.target.value;
                const prevCurr = state.previousCurrency;

                if (newCurr === prevCurr) return;

                let rate = 1;
                let isDivisor = false;

                if (prevCurr === 'XAF' && (newCurr === 'EUR' || newCurr === 'USD')) {
                    isDivisor = true;
                    rate = parseFloat(prompt(`Converting XAF to ${newCurr}. Enter exchange rate:`, newCurr === 'EUR' ? '655.957' : '600'));
                } else if ((prevCurr === 'EUR' || prevCurr === 'USD') && newCurr === 'XAF') {
                    rate = parseFloat(prompt(`Converting ${prevCurr} to XAF. Enter exchange rate:`, prevCurr === 'EUR' ? '655.957' : '600'));
                }

                if (!rate || isNaN(rate)) {
                    e.target.value = prevCurr;
                    return;
                }

                state.currentProforma.lines.forEach(line => {
                    line.unit = isDivisor ? line.unit / rate : line.unit * rate;
                });

                state.currentProforma.currency = newCurr;
                state.previousCurrency = newCurr;
                renderLines();
            }

            async function printProforma() {
                try {
                    // Fetch enriched print data from API
                    const result = await utils.getPrintData(state.currentProforma.invoice_id);
                    const data = result.data;
                    
                    // Build line items HTML
                    const linesHTML = data.lines.map(line => {
                        return `
                            <tr>
                                <td>${line.code}</td>
                                <td>${line.description}</td>
                                <td style="text-align: center;">${line.qty}</td>
                                <td style="text-align: right;">${utils.formatNumber(line.unit_price)}</td>
                                <td style="text-align: right;">${utils.formatNumber(line.total_ht)}</td>
                                <td style="text-align: right;">${utils.formatNumber(line.vat_amount)}</td>
                                <td style="text-align: right;">${utils.formatNumber(line.total_ttc)}</td>
                            </tr>
                        `;
                    }).join('');
                    
                    // Build bank details lines
                    const bankLines = (data.payment.bank_details || '').split('\n').filter(line => line.trim() !== '');
                    
                    // Generate full invoice HTML
                    const invoiceHTML = `
                        <div class="a4-sheet">
                            <div class="pdf-header">
                                <div class="pdf-logo">
                                    <img src="https://i.ibb.co/35MQnHJn/LOGO-SMART.png" alt="Smart LS">
                                </div>
                                <div class="pdf-company">
                                    <div class="pdf-company-name">SMART LOGISTICS AND SERVICES LTD</div>
                                    <div>1030, Avenue Douala Manga Bell, Bali</div>
                                    <div>PO Box 5120, Douala, Cameroon</div>
                                    <div>+237 233 420 281 | info@smartls.cm</div>
                                </div>
                            </div>

                            <div class="pdf-grid">
                                <div class="pdf-col-6">
                                    <div class="pdf-box-title">BILL TO / CLIENT</div>
                                    <div style="font-size: 8pt;">
                                        <div style="font-weight: 800; margin-bottom: 2px;">${data.client.name}</div>
                                        ${data.client.address ? `<div style="margin-bottom: 4px;">${data.client.address}</div>` : ''}
                                        <table class="pdf-kv-table">
                                            ${data.client.attn ? `<tr><td class="pdf-kv-key">Attn:</td><td>${data.client.attn}</td></tr>` : ''}
                                            ${data.client.email ? `<tr><td class="pdf-kv-key">Email:</td><td>${data.client.email}</td></tr>` : ''}
                                            ${data.client.niu ? `<tr><td class="pdf-kv-key">NIU:</td><td>${data.client.niu}</td></tr>` : ''}
                                        </table>
                                    </div>
                                </div>
                                <div class="pdf-col-6">
                                    <div class="pdf-box-title">PROFORMA INVOICE INFO</div>
                                    <table class="pdf-kv-table">
                                        <tr><td class="pdf-kv-key">Number:</td><td style="font-weight:800;">${data.invoice.invoice_no}</td></tr>
                                        <tr><td class="pdf-kv-key">Date:</td><td>${new Date(data.invoice.issue_date).toLocaleDateString('en-GB')}</td></tr>
                                        ${data.invoice.operations_file_reference ? `<tr><td class="pdf-kv-key">File Ref:</td><td>${data.invoice.operations_file_reference}</td></tr>` : ''}
                                        ${data.invoice.linked_quote_ref ? `<tr><td class="pdf-kv-key">Quote Ref:</td><td>${data.invoice.linked_quote_ref}</td></tr>` : ''}
                                        <tr><td class="pdf-kv-key">Terms:</td><td>${data.payment.terms}</td></tr>
                                        <tr><td class="pdf-kv-key">Currency:</td><td>${data.invoice.currency}</td></tr>
                                    </table>
                                </div>
                            </div>

                            ${data.shipment ? `
                            <div style="margin-bottom: 10px;">
                                <div class="pdf-box-title">SHIPMENT DETAILS</div>
                                <div class="pdf-grid" style="gap: 20px; margin-bottom: 0;">
                                    <table class="pdf-kv-table" style="flex: 1;">
                                        <tr><td class="pdf-kv-key">Service:</td><td>${data.shipment.service_type}</td></tr>
                                        <tr><td class="pdf-kv-key">Route:</td><td>${data.shipment.route}</td></tr>
                                        ${data.shipment.vessel_voyage !== '-' ? `<tr><td class="pdf-kv-key">Vessel/Flight:</td><td>${data.shipment.vessel_voyage}</td></tr>` : ''}
                                    </table>
                                    <table class="pdf-kv-table" style="flex: 1;">
                                        <tr><td class="pdf-kv-key">Weight:</td><td>${data.shipment.weight}</td></tr>
                                        <tr><td class="pdf-kv-key">Volume:</td><td>${data.shipment.volume}</td></tr>
                                        ${data.shipment.incoterm !== '-' ? `<tr><td class="pdf-kv-key">Incoterm:</td><td>${data.shipment.incoterm}</td></tr>` : ''}
                                    </table>
                                    <table class="pdf-kv-table" style="flex: 1;">
                                        <tr><td class="pdf-kv-key">Commodity:</td><td>${data.shipment.commodity}</td></tr>
                                        ${data.shipment.marks_numbers !== '-' ? `<tr><td class="pdf-kv-key">Marks:</td><td>${data.shipment.marks_numbers}</td></tr>` : ''}
                                        ${data.shipment.bl_awb !== '-' ? `<tr><td class="pdf-kv-key">BL/MAWB:</td><td>${data.shipment.bl_awb}</td></tr>` : ''}
                                    </table>
                                </div>
                            </div>
                            ` : ''}

                            <table class="pdf-table">
                                <thead>
                                    <tr>
                                        <th style="width: 10%;">CODE</th>
                                        <th style="width: 35%;">DESCRIPTION</th>
                                        <th style="width: 5%; text-align: center;">QTY</th>
                                        <th style="text-align: right;">UNIT PRICE</th>
                                        <th style="text-align: right;">TOTAL HT</th>
                                        <th style="text-align: right;">VAT</th>
                                        <th style="text-align: right;">TOTAL TTC</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${linesHTML}
                                </tbody>
                            </table>

                            <div class="pdf-split-container">
                                <div class="pdf-left-col">
                                    ${data.payment.remarks ? `
                                    <div class="pdf-border-box" style="flex: 1;">
                                        <div class="pdf-box-header">Remarks/Conditions:</div>
                                        <div style="font-style: italic; line-height: 1.2;">
                                            ${data.payment.remarks}
                                        </div>
                                    </div>
                                    ` : ''}
                                </div>
                                <div class="pdf-right-col">
                                    <table class="pdf-totals-table">
                                        <tr><td>Total H.T.</td><td style="text-align: right; font-weight: 700;">${utils.formatNumber(data.totals.subtotal)} ${data.invoice.currency}</td></tr>
                                        <tr><td>TVA (19.25%)</td><td style="text-align: right; font-weight: 700;">${utils.formatNumber(data.totals.vat)} ${data.invoice.currency}</td></tr>
                                        <tr><td>NET PAYABLE</td><td style="text-align: right; font-weight: 700;">${utils.formatNumber(data.totals.total)} ${data.invoice.currency}</td></tr>
                                        <tr class="pdf-grand-total">
                                            <td>ADVANCE (${data.totals.advance_percentage}%)</td>
                                            <td style="text-align: right; font-size: 9pt;">${utils.formatNumber(data.totals.payable_advance)} ${data.invoice.currency}</td>
                                        </tr>
                                    </table>
                                    <div class="pdf-sig-area">
                                        <div class="pdf-sig-label">MANAGEMENT</div>
                                        ${data.invoice.status === 'ISSUED_LOCKED' ? 
                                            `<img src="https://i.ibb.co/m58kKZdd/signature-dg-smart.png" class="pdf-sig-img" alt="Signed">` : ''}
                                    </div>
                                </div>
                            </div>

                            <div class="pdf-footer">
                                <div class="pdf-bank-row">
                                    <div style="font-weight: 700;">NIU: M0421160335800</div>
                                    <div style="font-weight: 700;">RC: 357-0114542</div>
                                    ${bankLines.map(line => `<div>${line}</div>`).join('')}
                                </div>
                                <div style="text-align: right; margin-top: 5px; color: #666;">
                                    Page 1 of 1 | Generated by Smart LS Enterprise System | ${new Date().toLocaleString()}
                                </div>
                            </div>
                        </div>
                    `;
                    
                    // Inject into print container
                    document.getElementById('print-container').innerHTML = invoiceHTML;
                    
                    // Trigger print after a short delay
                    setTimeout(() => {
                        window.print();
                    }, 250);
                    
                } catch (error) {
                    console.error('Print error:', error);
                    utils.showToast('Print Error', 'Failed to generate print document', 'error');
                }
            }

            // Public API
            return {
                init,
                initNewProforma,
                openEditor,
                filterTable,
                searchTable,
                updateLine,
                deleteLine,
                searchDictionaryForLine,
                saveProforma,
                approveProforma,
                rejectProforma,
                issueProforma,
                printProforma
            };
        })();

        // Initialize on DOM load
        document.addEventListener('DOMContentLoaded', APP.init);
    </script>
</body>
</html>