<?php
/*
 * ======================================================================================
 * SMART LS ENTERPRISE - PRE-SALES & LEADS MANAGEMENT (SMART QUOTE)
 * ======================================================================================
 * MODULE: CRM & Acquisition / Pre-Sales Leads
 * DESCRIPTION: Manages leads, generates token-based commercial proposals, and 
 * converts them into qualified clients / quote requests.
 * ======================================================================================
 */

declare(strict_types=1);

// --- System Initialization ---
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

// --- RBAC Enforcement ---
// Accessible only to Admin and Sales (and Management for oversight)
require_role(['ADMIN', 'SALES', 'MANAGEMENT']);

// --- Authenticated User Profile Fetching ---
$employeeId = (string)($_SESSION['auth']['employee_id'] ?? '');
$userId     = (int)($_SESSION['auth']['user_id'] ?? 0);

if ($employeeId === '' || $userId <= 0) {
    header('Location: ../../api/auth/logout.php');
    exit;
}

$conn = db();
$sql = "
  SELECT 
    em.employee_id, em.full_name, em.email, em.department, em.job_title,
    ua.username, ua.role, ua.authority_capabilities, ua.last_login
  FROM user_auth ua
  JOIN employee_master em ON em.employee_id = ua.employee_id
  WHERE ua.user_id = ? AND em.employee_id = ?
  LIMIT 1
";

$stmt = $conn->prepare($sql);
if (!$stmt) die("Database Error: Failed to prepare user profile query.");
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
$role = strtoupper((string)($me['role'] ?? 'GUEST'));
$roleLabelMap = [
    'ADMIN'      => 'SYSTEM ADMIN',
    'FINANCE'    => 'FINANCE',
    'SALES'      => 'SALES',
    'OPERATIONS' => 'OPERATIONS',
    'MANAGEMENT' => 'MANAGEMENT',
];
$roleLabel = $roleLabelMap[$role] ?? ($role !== '' ? $role : 'USER');
$avatarName = urlencode($fullName);
$avatarUrl  = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";
$jsUserRole = json_encode($role);
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pre-Sales Leads & Proposals | Smart LS</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&family=Montserrat:wght@400;600;700;800;900&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">

  <style>
    /* ==========================================================================
       SMART LS DESIGN SYSTEM V2 (Unified Theme)
       ========================================================================== */
    :root {
      --smart-blue: #1F99D8;
      --smart-dark: #055B83;
      --smart-orange: #EE7D04;
      --smart-charcoal: #231F20;
      --smart-bg: #F0F4F8;
      --sidebar-width: 260px;
    }

    body {
       font-family: 'Manrope', sans-serif;
       background: var(--smart-bg);
       color: var(--smart-charcoal);
       font-size: 0.85rem;
       overflow-x: hidden;
    }

    /* --- LAYOUT: SIDEBAR & TOPBAR (LOCKED & MAINTAINED) --- */
    .sidebar { width: var(--sidebar-width); height: 100vh; position: fixed; top: 0; left: 0; background: #fff; border-right: 1px solid #e0e0e0; z-index: 1000; display: flex; flex-direction: column; box-shadow: 2px 0 10px rgba(0,0,0,0.02); }
    .sidebar-header { height: 70px; display: flex; align-items: center; padding: 0 20px; border-bottom: 1px solid #f0f0f0; }
    .brand-logo { font-weight: 800; font-size: 1.1rem; color: var(--smart-charcoal); text-decoration: none; letter-spacing: -0.5px; }
    .sidebar-menu { overflow-y: auto; flex-grow: 1; padding: 10px 0; }
    .menu-btn { width: 100%; text-align: left; background: none; border: none; padding: 12px 20px; font-size: 0.8rem; font-weight: 700; color: #555; display: flex; justify-content: space-between; align-items: center; transition: all 0.2s; border-left: 3px solid transparent; }
    .menu-btn:hover, .menu-btn[aria-expanded="true"] { color: var(--smart-charcoal); background-color: #f0f7fa; border-left-color: var(--smart-charcoal); }
    .menu-btn i.category-icon { width: 20px; margin-right: 8px; color: #888; transition: color 0.2s; }
    .menu-btn:hover i.category-icon { color: var(--smart-charcoal); }
    .menu-chevron { font-size: 0.7rem; transition: transform 0.3s; }
    .menu-btn[aria-expanded="true"] .menu-chevron { transform: rotate(180deg); }
    .sub-link { display: block; padding: 8px 20px 8px 48px; font-size: 0.75rem; color: #666; text-decoration: none; font-weight: 500; transition: all 0.2s; line-height: 1.3; }
    .sub-link:hover { color: var(--smart-orange); background-color: #fff9f2; }
    .sub-link.active { color: var(--smart-orange); font-weight: 800; background-color: #fff9f2; }
    .sidebar-footer { border-top: 1px solid #f0f0f0; padding: 16px; }

    .main-content { margin-left: var(--sidebar-width); padding-top: 70px; min-height: 100vh; width: calc(100% - var(--sidebar-width)); }
    .top-navbar { height: 70px; position: fixed; top: 0; right: 0; left: var(--sidebar-width); background: rgba(255,255,255,0.95); backdrop-filter: blur(12px); border-bottom: 1px solid #e0e0e0; z-index: 900; padding: 0 30px; display: flex; align-items: center; justify-content: space-between; }
    .clock-pill { background: #f1f5f9; padding: 6px 12px; border-radius: 30px; display: flex; align-items: center; gap: 10px; font-size: 0.85rem; font-weight: 600; color: var(--smart-dark); }

    /* --- COMPONENTS: CARDS & KPIS --- */
    .card-custom { background: white; border-radius: 12px; border: 1px solid rgba(0,0,0,0.05); box-shadow: 0 2px 12px rgba(0,0,0,0.02); height: 100%; }
    .kpi-title { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; color: #888; letter-spacing: 0.5px; white-space: nowrap; }
    .kpi-value { font-size: 1.6rem; font-weight: 800; color: var(--smart-charcoal); line-height: 1.2; font-variant-numeric: tabular-nums; }

    /* --- COMPONENTS: TABLES --- */
    .table-custom th { font-size: 0.75rem; text-transform: uppercase; color: #888; font-weight: 700; border-bottom: 2px solid #f0f0f0; padding: 12px; white-space: nowrap; background-color: #f8fafc; }
    .table-custom td { font-size: 0.85rem; vertical-align: middle; padding: 12px; }
    .table-hover tbody tr:hover { background-color: #f8fafc; }

    /* --- STATUS PILLS --- */
    .status-pill { font-size: 0.65rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; padding: 5px 10px; border-radius: 6px; white-space: nowrap; }
    .status-new { background: #e2e8f0; color: #475569; }
    .status-contacted { background: #fef08a; color: #9a3412; }
    .status-proposal { background: #e0f2fe; color: #0369a1; }
    .status-qualified { background: #dcfce7; color: #15803d; }
    .status-lost { background: #fee2e2; color: #991b1b; }

    /* --- FORMS & INPUTS --- */
    .smart-input { border-radius: 6px; font-size: 0.9rem; padding: 0.5rem 0.7rem; border: 1px solid #dee2e6; transition: all 0.2s ease; }
    .smart-input:focus { border-color: var(--smart-blue); box-shadow: 0 0 0 3px rgba(31,153,216,0.1); outline: none; }
    .form-label { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: #64748B; letter-spacing: 0.5px; margin-bottom: 0.4rem; }
    
    /* --- EDITOR OFFCANVAS (Proposal) --- */
    .offcanvas-header { background-color: #f8fafc; border-bottom: 1px solid #e0e0e0; }
    .offcanvas-title { font-family: 'Montserrat', sans-serif; font-weight: 700; }
    .editor-layout { display: flex; height: 100%; }
    .editor-sidebar { width: 340px; border-right: 1px solid #e0e0e0; background: #fff; padding: 20px; overflow-y: auto; }
    .editor-main { flex: 1; display: flex; flex-direction: column; background: #fff; overflow-y: auto; overflow-x: hidden; }
    .editor-content-container { padding: 25px 40px; }
    .editor-footer { background: #f8fafc; border-top: 1px solid #e0e0e0; padding: 15px 40px; display: flex; align-items: center; justify-content: flex-end; gap: 30px; position: sticky; bottom: 0; z-index: 10; }

    /* --- EDITOR TABLE STYLING --- */
    .editor-table { width: 100%; border-collapse: separate; border-spacing: 0; }
    .editor-table th { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: var(--smart-dark); border-bottom: 2px solid var(--smart-blue); padding: 10px; background: #fff; }
    .editor-table td { padding: 8px 5px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
    .editor-table input { border: 1px solid transparent; border-radius: 4px; padding: 6px; width: 100%; font-size: 0.9rem; background: transparent; transition: all 0.2s; }
    .editor-table input:focus, .editor-table input:hover { background: #fff; border-color: #ddd; }
    .editor-table input:focus { border-color: var(--smart-blue); box-shadow: 0 0 0 2px rgba(31,153,216,0.1); }
    .cell-qty input, .cell-price input, .cell-total input { font-family: 'Courier New', monospace; font-weight: 600; text-align: right;}
    .col-del { width: 40px; text-align: center; padding-top: 14px !important; cursor: pointer; color: #dc3545;}
    .col-del:hover { color: #a11; }
    /* --- RICH AUTOCOMPLETE DROPDOWN --- */
    .autocomplete-wrapper { position: relative; width: 100%; }
    .suggestion-box {
        position: absolute; top: 100%; left: 0; width: 150%; max-height: 250px; overflow-y: auto;
        background: white; border: 1px solid #dcdcdc; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        z-index: 1050; display: none;
    }
    .suggestion-header { display: grid; grid-template-columns: 80px 1fr; padding: 8px 12px; background: #f8fafc; border-bottom: 1px solid #eee; font-size: 0.7rem; font-weight: 700; color: #888; text-transform: uppercase; }
    .suggestion-item { display: grid; grid-template-columns: 80px 1fr; padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #f9f9f9; font-size: 0.85rem; }
    .suggestion-item:hover { background-color: #f0f7fa; color: var(--smart-dark); }
    .s-code { font-family: monospace; font-weight: 600; color: var(--smart-blue); }
    .s-desc { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 10px; }
    /* --- DICTATION RECORDING PULSE --- */
    @keyframes pulse-red {
        0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(220, 53, 69, 0.7); }
        70% { transform: scale(1); box-shadow: 0 0 0 10px rgba(220, 53, 69, 0); }
        100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(220, 53, 69, 0); }
    }
    .dictation-pulse {
        animation: pulse-red 1.5s infinite;
    }
    .dictation-btn { width: 35px; height: 35px; padding: 0; display: flex; align-items: center; justify-content: center; }
  </style>
</head>

<body>
<div class="toast-container position-fixed bottom-0 end-0 p-3" id="toastContainer" style="z-index: 1100;"></div>

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
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#admin2" aria-expanded="true">
                <span><i class="fa-solid fa-users category-icon"></i> CRM & ACQUISITION</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="admin2" class="accordion-collapse collapse show" data-bs-parent="#adminMenu">
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
      <h5 class="mb-0 fw-bold text-dark">Pre-Sales Leads</h5>
      <small class="text-muted" style="font-size: 0.7rem;">CRM PIPELINE & SMART QUOTE PROPOSALS</small>
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
                <div class="kpi-title">Total Active Leads</div>
                <div class="kpi-value" id="kpi-leads">Loading KPIs</div>
                <small class="text-muted" style="font-size:0.75rem;">In pipeline</small>
            </div>
        </div>
        <div class="col-md-3">
            <div class="card-custom p-3">
                <div class="kpi-title">Proposals Sent</div>
                <div class="kpi-value text-primary" id="kpi-proposals">Loading KPI</div>
                <small class="text-muted" style="font-size:0.75rem;">Awaiting client response</small>
            </div>
        </div>
        <div class="col-md-3">
            <div class="card-custom p-3">
                <div class="kpi-title">Qualified (Converted)</div>
                <div class="kpi-value text-success" id="kpi-converted">Loading KPI</div>
                <small class="text-muted" style="font-size:0.75rem;">Moved to Client Master</small>
            </div>
        </div>
        <div class="col-md-3">
            <div class="card-custom p-3">
                <div class="kpi-title">Conversion Rate</div>
                <div class="kpi-value text-warning" id="kpi-conversion">Loading KPI</div>
                <small class="text-muted" style="font-size:0.75rem;">Leads to Qualified</small>
            </div>
        </div>
    </div>

    <div class="row py-4 align-items-center">
        <div class="col-md-6">
            <p class="text-muted mb-1" style="font-size: 22px;"><strong>LEAD REGISTER</strong></p>
        </div>
        <div class="col-md-6 text-end d-flex justify-content-end gap-2">
            <button class="btn btn-outline-primary fw-bold px-4 py-2 shadow-sm border-2" onclick="APP.openMeetingWizard()">
                <i class="fa-solid fa-handshake me-2"></i>Live Meeting
            </button>
            <button class="btn btn-dark fw-bold px-4 py-2 shadow-sm" onclick="APP.openNewLeadModal()">
                <i class="fa-solid fa-plus me-2"></i>New Lead
            </button>
        </div>
    </div>

    <div class="card-custom p-0 overflow-hidden">
        <div class="p-3 border-bottom bg-light d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div class="btn-group" role="group">
                <button type="button" class="btn btn-sm btn-outline-secondary fw-bold active" onclick="APP.filterLeads('ALL', this)">All</button>
                <button type="button" class="btn btn-sm btn-outline-secondary fw-bold" onclick="APP.filterLeads('NEW', this)">New</button>
                <button type="button" class="btn btn-sm btn-outline-primary fw-bold" onclick="APP.filterLeads('PROPOSAL_SENT')">Proposal Sent</button>
                <button type="button" class="btn btn-sm btn-outline-success fw-bold" onclick="APP.filterLeads('QUALIFIED')">Qualified</button>
            </div>

            <div class="input-group input-group-sm" style="width: 280px;">
                <span class="input-group-text bg-white border-end-0"><i class="fa-solid fa-search text-muted"></i></span>
                <input type="text" id="searchLeadsInput" name="searchLeadsInput" aria-label="Search leads" class="form-control border-start-0 ps-0 smart-input" placeholder="Search company, contact..." onkeyup="APP.searchLeads(this.value)">
            </div>
        </div>

        <div class="table-responsive">
            <table class="table table-hover table-custom mb-0 align-middle">
                <thead class="bg-light">
                    <tr>
                        <th class="ps-4">Date</th>
                        <th>Company Name</th>
                        <th>Contact Details</th>
                        <th>Location</th>
                        <th class="text-center">Status</th>
                        <th class="text-end pe-4">Action</th>
                    </tr>
                </thead>
                <tbody id="leadsTableBody">
                    </tbody>
            </table>
            <div id="emptyState" class="text-center py-5 d-none">
                <i class="fa-solid fa-users-slash fa-3x text-muted mb-3 opacity-50"></i>
                <h6 class="fw-bold text-muted">No Leads Found</h6>
            </div>
        </div>
    </div>
</div>

<div class="modal fade" id="newLeadModal" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content border-0 shadow-lg">
            
            <div class="modal-header bg-light">
                <h5 class="modal-title fw-bold text-dark"><i class="fa-solid fa-building me-2 text-primary"></i> Register New Lead</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            
            <div class="modal-body p-4">
                <form id="leadForm">
                    <input type="hidden" id="editLeadId" value=""> 
                    <div class="row g-3">
                        <div class="col-md-12">
                            <label class="form-label" for="leadCompany">Company Name <span class="text-danger">*</span></label>
                            <input type="text" class="form-control smart-input" id="leadCompany" required placeholder="e.g. Dangote Cement">
                        </div>
                        <div class="col-md-6">
                            <label class="form-label" for="leadContact">Contact Person <span class="text-danger">*</span></label>
                            <input type="text" class="form-control smart-input" id="leadContact" required placeholder="Full Name">
                        </div>
                        <div class="col-md-6">
                            <label class="form-label">Phone Number <span class="text-danger">*</span></label>
                            <input type="text" class="form-control smart-input" id="leadPhone" required placeholder="+237...">
                        </div>
                        <div class="col-md-6">
                            <label class="form-label">Email Address</label>
                            <input type="email" class="form-control smart-input" id="leadEmail" placeholder="contact@company.com">
                        </div>
                        <div class="col-md-6">
                            <label class="form-label">Country</label>
                            <input type="text" class="form-control smart-input" id="leadCountry" value="Cameroon">
                        </div>
                        <div class="col-md-12">
                            <label class="form-label">Headquarters / Address</label>
                            <textarea class="form-control smart-input" id="leadAddress" rows="2" placeholder="Full physical address"></textarea>
                        </div>
                        <div class="col-md-6">
                            <label class="form-label">NIU (Tax ID)</label>
                            <input type="text" class="form-control smart-input" id="leadNiu" placeholder="Optional">
                        </div>
                        <div class="col-md-6">
                            <label class="form-label">RCCM (Trade Register)</label>
                            <input type="text" class="form-control smart-input" id="leadRccm" placeholder="Optional">
                        </div>
                    </div>
                </form>
            </div>
            
            <div class="modal-footer bg-light">
                <button type="button" class="btn btn-outline-secondary btn-sm fw-bold" data-bs-dismiss="modal">Cancel</button>
                <button type="button" class="btn btn-dark btn-sm fw-bold px-4" onclick="APP.saveLead()">Save Lead</button>
            </div>
            
        </div>
    </div>
</div>

<div class="offcanvas offcanvas-end" tabindex="-1" id="proposalEditor" data-bs-backdrop="static" style="width: 95vw; max-width: 1400px;">
    <div class="offcanvas-header bg-light py-3">
        <div>
            <h5 class="offcanvas-title fw-bold mb-0 text-dark"><i class="fa-solid fa-file-signature text-primary me-2"></i> Smart Quote & Proposal Builder</h5>
            <div class="d-flex align-items-center gap-2 mt-1">
                <span class="status-pill status-new" id="propStatusBadge">DRAFT</span>
                <small class="text-muted fw-bold" id="propLeadName">Lead Name Here</small>
            </div>
        </div>
        <button class="btn btn-outline-secondary btn-sm fw-bold" data-bs-dismiss="offcanvas"><i class="fa-solid fa-times me-1"></i> Close</button>
    </div>

    <div class="offcanvas-body p-0 editor-layout">
        
        <div class="editor-sidebar bg-light border-end">
            
            <h6 class="text-muted small fw-bold text-uppercase border-bottom pb-2 mb-3">Document Config</h6>
            <div class="mb-3">
                <label class="form-label" for="propLang">Language</label>
                <select class="form-select smart-input" id="propLang">
                    <option value="en">English</option>
                    <option value="fr">Français</option>
                </select>
            </div>
            <div class="mb-4">
                <label class="form-label">Currency</label>
                <select class="form-select smart-input" id="propCurrency">
                    <option value="XAF">XAF (FCFA)</option>
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                </select>
            </div>

            <h6 class="text-muted small fw-bold text-uppercase border-bottom pb-2 mb-3 mt-4">Service & Routing</h6>
            <div class="mb-3">
                <label class="form-label">Service Category <span class="text-danger">*</span></label>
                <select class="form-select smart-input border-primary bg-primary bg-opacity-10 fw-bold" id="propCategory">
                    <option value="">Select Service...</option>
                    <option value="SEA FREIGHT IMPORT">Sea Freight Import</option>
                    <option value="SEA FREIGHT EXPORT">Sea Freight Export</option>
                    <option value="AIR FREIGHT IMPORT">Air Freight Import</option>
                    <option value="AIR FREIGHT EXPORT">Air Freight Export</option>
                    <option value="HINTERLAND/TRANSIT">Hinterland / Transit (Chad, CAR)</option>
                    <option value="END-TO-END">End-to-End Multimodal</option>
                    <option value="WAREHOUSING">Warehousing & Storage</option>
                </select>
                <small class="text-muted" style="font-size: 0.65rem;">This dictates the technical presentation generated.</small>
            </div>
            <div class="mb-3">
                <label class="form-label">Incoterm <span class="text-danger">*</span></label>
                <select class="form-select smart-input fw-bold" id="propIncoterm">
                    <option value="EXW">EXW (Ex Works)</option>
                    <option value="FCA">FCA (Free Carrier)</option>
                    <option value="FOB">FOB (Free On Board)</option>
                    <option value="CIF">CIF (Cost, Insurance & Freight)</option>
                    <option value="DAP">DAP (Delivered at Place)</option>
                    <option value="DDP">DDP (Delivered Duty Paid)</option>
                    <option value="OTHER">Other / N/A</option>
                </select>
            </div>
            <div class="mb-3">
                <label class="form-label">Origin Location</label>
                <input type="text" class="form-control smart-input" id="propOrigin" placeholder="e.g. Shanghai Port, China">
            </div>
            <div class="mb-4">
                <label class="form-label">Destination Location</label>
                <input type="text" class="form-control smart-input" id="propDest" placeholder="e.g. N'Djamena, Chad">
            </div>

            <h6 class="text-muted small fw-bold text-uppercase border-bottom pb-2 mb-3 mt-4">Cargo Overview</h6>
            <div class="mb-3">
                <label class="form-label">Est. Weight (Tons)</label>
                <input type="text" class="form-control smart-input" id="propWeight" placeholder="e.g. 24">
            </div>
            <div class="mb-3 form-check form-switch mt-2">
                <input class="form-check-input" type="checkbox" id="propProjectFlag">
                <label class="form-check-label fw-bold small text-dark" for="propProjectFlag">Flag as Heavy/Project Cargo</label>
            </div>

        </div>

        <div class="editor-main">
            <div class="editor-content-container">
        
        <div class="mb-5">
                    <h6 class="text-primary fw-bold text-uppercase border-bottom border-primary pb-2 mb-3">
                        <i class="fa-solid fa-wand-magic-sparkles me-2"></i> Consultative AI Co-Pilot (Pages 3 & 4)
                    </h6>
                    <div class="row bg-primary bg-opacity-10 p-3 rounded border border-primary mb-3">
                        <div class="col-md-4 mb-2">
                            <label class="form-label text-dark">Client Operations</label>
                            <textarea class="form-control smart-input text-sm" id="aiInputOps" rows="3" placeholder="What do they do? Volumes? Target market?"></textarea>
                        </div>
                        <div class="col-md-4 mb-2">
                            <label class="form-label text-dark">Pain Points</label>
                            <textarea class="form-control smart-input text-sm" id="aiInputPain" rows="3" placeholder="Bottlenecks, high costs, delays..."></textarea>
                        </div>
                        <div class="col-md-4 mb-2">
                            <label class="form-label text-dark">Proposed Strategy</label>
                            <textarea class="form-control smart-input text-sm" id="aiInputStrategy" rows="3" placeholder="How do we solve it? E.g., Exonerations, dedicated fleet..."></textarea>
                        </div>
                        <div class="col-md-12 d-flex justify-content-between align-items-end mt-2">
                            <div style="width: 250px;">
                                <label class="form-label text-dark">Tone of Voice:</label>
                                <select class="form-select smart-input form-select-sm" id="aiTone">
                                    <option value="Consultative, Advisory, and Expert">Consultative / Advisory</option>
                                    <option value="Aggressive, Persuasive, and Competitive">Aggressive / Persuasive</option>
                                    <option value="Highly Technical and Operational">Highly Technical / Operational</option>
                                </select>
                            </div>
                            <button type="button" class="btn btn-primary btn-sm fw-bold shadow-sm" id="btnGenerateAI" onclick="APP.generateAIContent()">
                                <i class="fa-solid fa-robot me-1"></i> Generate Narrative
                            </button>
                        </div>
                    </div>

                    <div id="aiOutputArea" class="d-none">
                        <ul class="nav nav-tabs mb-0" id="aiTabs" role="tablist">
                            <li class="nav-item" role="presentation">
                                <button class="nav-link active fw-bold text-dark" id="en-tab" data-bs-toggle="tab" data-bs-target="#en-content" type="button" role="tab">English Preview</button>
                            </li>
                            <li class="nav-item" role="presentation">
                                <button class="nav-link fw-bold text-dark" id="fr-tab" data-bs-toggle="tab" data-bs-target="#fr-content" type="button" role="tab">Aperçu Français</button>
                            </li>
                        </ul>
                        <div class="tab-content border border-top-0 p-3 bg-white rounded-bottom shadow-sm">
                            <p class="text-muted small mb-3"><i class="fa-solid fa-circle-info"></i> Edit the text below if necessary. Do not exceed limits to maintain PDF design.</p>
                            
                            <div class="tab-pane fade show active" id="en-content" role="tabpanel">
                                <label class="form-label text-dark">Client Context (EN)</label>
                                <textarea class="form-control smart-input mb-3 font-monospace text-sm" id="aiContextEn" rows="3"></textarea>
                                
                                <div class="row mb-3 bg-light p-2 rounded border mx-0">
                                    <div class="col-12"><label class="form-label text-smart-orange fw-bold"><i class="fa-solid fa-briefcase"></i> Custom Case Study (EN)</label></div>
                                    <div class="col-md-4"><input type="text" class="form-control smart-input font-monospace text-sm" id="aiCaseTitleEn" placeholder="Case Title"></div>
                                    <div class="col-md-8"><textarea class="form-control smart-input font-monospace text-sm" id="aiCaseBodyEn" rows="2" placeholder="Case Body"></textarea></div>
                                </div>

                                <label class="form-label text-dark">Operational Strategy (EN)</label>
                                <textarea class="form-control smart-input font-monospace text-sm" id="aiStrategyEn" rows="3"></textarea>
                            </div>
                            <div class="tab-pane fade" id="fr-content" role="tabpanel">
                                <label class="form-label text-dark">Client Context (FR)</label>
                                <textarea class="form-control smart-input mb-3 font-monospace text-sm" id="aiContextFr" rows="3"></textarea>
                                
                                <div class="row mb-3 bg-light p-2 rounded border mx-0">
                                    <div class="col-12"><label class="form-label text-smart-orange fw-bold"><i class="fa-solid fa-briefcase"></i> Custom Case Study (FR)</label></div>
                                    <div class="col-md-4"><input type="text" class="form-control smart-input font-monospace text-sm" id="aiCaseTitleFr" placeholder="Titre du projet"></div>
                                    <div class="col-md-8"><textarea class="form-control smart-input font-monospace text-sm" id="aiCaseBodyFr" rows="2" placeholder="Détails du projet"></textarea></div>
                                </div>

                                <label class="form-label text-dark">Operational Strategy (FR)</label>
                                <textarea class="form-control smart-input font-monospace text-sm" id="aiStrategyFr" rows="3"></textarea>
                            </div>
                        </div>
                        
                        <input type="hidden" id="aiSlasEn" value="[]">
                        <input type="hidden" id="aiSlasFr" value="[]">
                    </div>
                </div>
        
                <div class="row mb-5">
                    <div class="col-md-6">
                        <h6 class="text-dark fw-bold text-uppercase border-bottom pb-2 mb-3"><i class="fa-solid fa-handshake me-2"></i> SLAs & Commitments</h6>
                        <div class="mb-3">
                            <label class="form-label">Customs Clearance Target</label>
                            <input type="text" class="form-control smart-input" id="slaCustoms" value="Max 72 Hours">
                        </div>
                        <div class="mb-3">
                            <label class="form-label">Est. Transit Time</label>
                            <input type="text" class="form-control smart-input" id="slaTransit" placeholder="e.g. 15 Days (Port to Door)">
                        </div>
                        <div class="mb-3">
                            <label class="form-label">Free Days / Demurrage</label>
                            <input type="text" class="form-control smart-input" id="slaFreeDays" placeholder="e.g. 21 Days Free Time">
                        </div>
                    </div>
                    
                    <div class="col-md-6">
                        <h6 class="text-dark fw-bold text-uppercase border-bottom pb-2 mb-3"><i class="fa-solid fa-file-contract me-2"></i> Commercial Terms</h6>
                        <div class="mb-3">
                            <label class="form-label">Payment Conditions</label>
                            <select class="form-select smart-input" id="termPayment">
                                <option value="100% Advance">100% Advance</option>
                                <option value="50% Advance, 50% Delivery">50% Advance, 50% on Delivery</option>
                                <option value="Net 15 Days">Net 15 Days after Invoice</option>
                                <option value="Net 30 Days">Net 30 Days after Invoice</option>
                            </select>
                        </div>
                        <div class="mb-3">
                            <label class="form-label">Offer Validity (Days)</label>
                            <input type="number" class="form-control smart-input" id="termValidity" value="30" min="1">
                        </div>
                        <div class="mb-3">
                            <label class="form-label">Cargo Description (Appears on Quote)</label>
                            <textarea class="form-control smart-input" id="propDesc" rows="2" placeholder="Brief description of goods being moved..."></textarea>
                        </div>
                    </div>
                </div>

                <div class="mb-4 d-flex justify-content-between align-items-end border-bottom pb-2">
                    <h6 class="text-dark fw-bold text-uppercase mb-0"><i class="fa-solid fa-calculator me-2 text-primary"></i> Commercial Offer (Pricing Table)</h6>
                    <button class="btn btn-outline-primary btn-sm fw-bold shadow-sm" onclick="APP.addProposalRow()">
                        <i class="fa-solid fa-plus me-1"></i> Add Line Item
                    </button>
                </div>

                <table class="editor-table mb-4">
                    <thead>
                        <tr>
                            <th style="width: 40px;">#</th>
                            <th style="width: 50%;">Description (Service/Charge)</th>
                            <th style="width: 15%; text-align: center;">Qty</th>
                            <th style="width: 20%; text-align: right;">Unit Rate</th>
                            <th style="width: 15%; text-align: right;">Total Amount</th>
                            <th style="width: 40px;"></th>
                        </tr>
                    </thead>
                    <tbody id="proposalLinesBody">
                        </tbody>
                </table>

            </div>

            <div class="editor-footer mt-auto">
                <div class="me-auto text-muted small fw-bold">
                    <i class="fa-solid fa-info-circle me-1"></i> Saving generates a secure Token for the dynamic PDF Proposal.
                </div>
                
                <div class="text-end me-4">
                    <div class="text-muted small fw-bold text-uppercase">Total Amount</div>
                    <div class="font-monospace fw-black fs-4 text-dark"><span id="dispGrandTotal">0</span> <span class="fs-6 text-muted" id="dispCurr">XAF</span></div>
                </div>

                <div class="d-flex gap-2">
                    <button class="btn btn-secondary fw-bold" id="btnSaveDraft" onclick="APP.saveProposal('DRAFT')">Save Draft</button>
                    <button class="btn btn-primary fw-bold shadow-sm" id="btnSaveGenerate" onclick="APP.saveProposal('GENERATE')">
                        Generate Proposal Token <i class="fa-solid fa-arrow-right ms-2"></i>
                    </button>
                </div>
            </div>
        </div>
    </div>
</div>

<div class="modal fade" id="shareProposalModal" tabindex="-1" aria-hidden="true" data-bs-backdrop="static">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content border-0 shadow-lg">
            <div class="modal-header bg-light">
                <h5 class="modal-title fw-bold text-dark"><i class="fa-solid fa-share-nodes text-primary me-2"></i> Share Proposal</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body p-4">
                <div class="text-center mb-4">
                    <i class="fa-solid fa-circle-check text-success fa-4x mb-2 shadow-sm rounded-circle"></i>
                    <h5 class="fw-bold text-dark mt-2">Proposal Token Generated!</h5>
                    <p class="text-muted small">Your secure proposal link is ready to be shared with the client.</p>
                </div>

                <div class="mb-4">
                    <label class="form-label" for="generatedLink">Secure Proposal Link</label>
                    <div class="input-group">
                        <input type="text" class="form-control smart-input bg-light font-monospace text-primary" id="generatedLink" readonly>
                        <button class="btn btn-outline-secondary fw-bold shadow-sm" type="button" onclick="APP.copyProposalLink()" title="Copy Link">
                            <i class="fa-solid fa-copy"></i>
                        </button>
                        <button class="btn btn-primary fw-bold shadow-sm" type="button" onclick="APP.openProposalLink()" title="Open Link in New Tab">
                            <i class="fa-solid fa-external-link-alt"></i> Open
                        </button>
                    </div>
                </div>

                <div class="position-relative mb-4 text-center">
                    <hr class="text-muted opacity-25">
                    <span class="position-absolute top-50 start-50 translate-middle bg-white px-3 text-muted fw-bold small">OR</span>
                </div>

                <h6 class="fw-bold text-dark mb-3"><i class="fa-brands fa-whatsapp text-success me-2 fs-5"></i> Send directly via WhatsApp</h6>
                
                <div class="mb-3">
                    <label class="form-label" for="waPhone">Client WhatsApp Number</label>
                    <div class="input-group">
                        <span class="input-group-text bg-light border-end-0"><i class="fa-solid fa-phone text-muted"></i></span>
                        <input type="text" class="form-control border-start-0 ps-0 smart-input" id="waPhone" placeholder="+237...">
                    </div>
                    <small class="text-muted" style="font-size: 0.7rem;">Verify the country code is included.</small>
                </div>

                <div class="mb-2">
                    <label class="form-label" for="waMessage">Introductory Message</label>
                    <textarea class="form-control smart-input" id="waMessage" rows="6" style="background-color: #f8fafc; font-size: 0.85rem; border-color: #e2e8f0;"></textarea>
                </div>
            </div>
            <div class="modal-footer bg-light d-flex justify-content-between">
                <button type="button" class="btn btn-outline-secondary btn-sm fw-bold px-3" data-bs-dismiss="modal">Close</button>
                <button type="button" class="btn btn-success btn-sm fw-bold px-4 shadow-sm" onclick="APP.sendWhatsApp()">
                    <i class="fa-brands fa-whatsapp me-2"></i>Send to WhatsApp
                </button>
            </div>
        </div>
    </div>
</div>

<div class="modal fade" id="editChoiceModal" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered modal-sm">
        <div class="modal-content border-0 shadow-lg">
            <div class="modal-header bg-light">
                <h6 class="modal-title fw-bold text-dark"><i class="fa-solid fa-pen-to-square text-primary me-2"></i> Select Action</h6>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body p-4 d-flex flex-column gap-3">
                <button class="btn btn-outline-dark fw-bold py-3 text-start shadow-sm" onclick="APP.triggerEditLead()">
                    <i class="fa-solid fa-building me-2 fs-5 align-middle text-secondary"></i> Edit Lead Info
                </button>
                <button class="btn btn-outline-primary fw-bold py-3 text-start shadow-sm" onclick="APP.triggerEditProposal()">
                    <i class="fa-solid fa-file-signature me-2 fs-5 align-middle"></i> Edit Proposal
                </button>
            </div>
        </div>
    </div>
</div>

<div class="modal fade" id="meetingWizardModal" tabindex="-1" aria-hidden="true" data-bs-backdrop="static">
    <div class="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable">
        <div class="modal-content border-0 shadow-lg" style="background-color: #f8fafc;">
            <div class="modal-header bg-white border-bottom-0 pb-0">
                <div class="w-100 d-flex justify-content-between align-items-center">
                    <div>
                        <h5 class="modal-title fw-black text-smart-dark mb-0"><i class="fa-solid fa-chart-line text-smart-orange me-2"></i> Supply Chain Diagnostic</h5>
                        <small class="text-muted fw-bold tracking-widest text-uppercase" style="font-size: 0.65rem;">Client Discovery Framework</small>
                    </div>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
            </div>
            
            <div class="modal-body p-4 pt-3">
                <div class="bg-white p-3 rounded-3 shadow-sm border border-light mb-4">
                    <div class="row g-3">
                        <div class="col-md-6">
                            <label class="form-label text-smart-dark fw-bold">Select Client / Lead</label>
                            <select class="form-select smart-input fw-bold text-primary" id="meetLeadSelect"></select>
                        </div>
                        <div class="col-md-3">
                            <label class="form-label text-smart-dark fw-bold">Meeting Date</label>
                            <input type="date" class="form-control smart-input" id="meetDate">
                        </div>
                        <div class="col-md-3">
                            <label class="form-label text-smart-dark fw-bold">Location</label>
                            <input type="text" class="form-control smart-input" id="meetLocation" placeholder="e.g. Client HQ">
                        </div>
                    </div>
                </div>

               <div class="bg-white p-4 rounded-3 shadow-sm border-start border-4 border-smart-blue mb-4">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <h6 class="fw-bold text-smart-dark mb-0"><span class="badge bg-smart-blue me-2">1</span> Business & Operations Context</h6>
                        <button class="btn btn-outline-danger rounded-circle dictation-btn" onclick="APP.toggleDictation('meetOps', this)" title="Click to dictate">
                            <i class="fa-solid fa-microphone"></i>
                        </button>
                    </div>
                    <div class="bg-light p-3 rounded mb-3 border text-sm text-secondary">
                        <div class="fw-bold text-smart-dark mb-1"><i class="fa-regular fa-lightbulb text-warning me-1"></i> Consultative Probing Questions:</div>
                        <ul class="mb-0 ps-3 mb-1" style="font-style: italic;">
                            <li>What is the core nature of your imported/exported goods (perishables, heavy equipment, standard retail)?</li>
                            <li>What are your average monthly container/tonnage volumes?</li>
                            <li>Who are your primary end-users, and how critical is delivery timing to your revenue?</li>
                        </ul>
                    </div>
                    <textarea class="form-control smart-input border-0 bg-light fs-6" id="meetOps" rows="4" placeholder="Capture client's operational reality here..."></textarea>
                </div>

                <div class="bg-white p-4 rounded-3 shadow-sm border-start border-4 border-danger mb-4">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <h6 class="fw-bold text-smart-dark mb-0"><span class="badge bg-danger me-2">2</span> Operational Bottlenecks</h6>
                        <button class="btn btn-outline-danger rounded-circle dictation-btn" onclick="APP.toggleDictation('meetPain', this)" title="Click to dictate">
                            <i class="fa-solid fa-microphone"></i>
                        </button>
                    </div>
                    <div class="bg-light p-3 rounded mb-3 border text-sm text-secondary">
                        <div class="fw-bold text-smart-dark mb-1"><i class="fa-regular fa-lightbulb text-warning me-1"></i> Consultative Probing Questions:</div>
                        <ul class="mb-0 ps-3 mb-1" style="font-style: italic;">
                            <li>Where are you experiencing the highest cost leakages (demurrage, storage, customs penalties)?</li>
                            <li>Do you currently lack real-time visibility over your shipments?</li>
                            <li>What specific regulatory or customs hurdles are delaying your supply chain?</li>
                        </ul>
                    </div>
                    <textarea class="form-control smart-input border-0 bg-light fs-6" id="meetPain" rows="4" placeholder="Capture the cost of inaction and pain points here..."></textarea>
                </div>

                <div class="bg-white p-4 rounded-3 shadow-sm border-start border-4 border-smart-orange mb-2">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <h6 class="fw-bold text-smart-dark mb-0"><span class="badge bg-smart-orange me-2">3</span> Proposed Strategic Alignment</h6>
                        <button class="btn btn-outline-danger rounded-circle dictation-btn" onclick="APP.toggleDictation('meetStrategy', this)" title="Click to dictate">
                            <i class="fa-solid fa-microphone"></i>
                        </button>
                    </div>
                    <div class="bg-light p-3 rounded mb-3 border text-sm text-secondary">
                        <div class="fw-bold text-smart-dark mb-1"><i class="fa-regular fa-lightbulb text-warning me-1"></i> Consultative Probing Questions:</div>
                        <ul class="mb-0 ps-3 mb-1" style="font-style: italic;">
                            <li>If we can guarantee 72-hour customs clearance, how does that impact your bottom line?</li>
                            <li>Would a dedicated transport fleet and an independent account manager solve your cash flow issues?</li>
                            <li>What specific KPIs must we hit for you to consider this partnership a success?</li>
                        </ul>
                    </div>
                    <textarea class="form-control smart-input border-0 bg-light fs-6" id="meetStrategy" rows="4" placeholder="Briefly note how Smart Logistics can solve these issues..."></textarea>
                </div>
            </div>

            <div class="modal-footer bg-white border-top-0 pt-0">
                <button type="button" class="btn btn-light fw-bold px-4" data-bs-dismiss="modal">Cancel</button>
                <button type="button" class="btn btn-primary fw-bold px-5 shadow-sm" onclick="APP.saveMeetingNotes()" id="btnSaveMeeting">
                    <i class="fa-solid fa-cloud-arrow-up me-2"></i> Secure Diagnostic Data
                </button>
            </div>
        </div>
    </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
<script>
    /**
     * ==================================================================================
     * SMART LS PRE-SALES & LEADS MODULE (Phase 2 - Frontend UI logic)
     * ==================================================================================
     */
    const APP = (function() {
        'use strict';

        let state = {
            leads: [],
            currentLeadId: null,
            currentProposalId: null,
            proposalLines: []
        };

        // --- UI Utilities ---
        const utils = {
            formatCurrency: (n) => new Intl.NumberFormat('en-US').format(Math.round(n)),
            parseCurrency: (s) => parseFloat(String(s).replace(/,/g, '')) || 0,
            showToast: (title, message, type = 'success') => {
                const container = document.getElementById('toastContainer');
                const bg = type === 'success' ? 'bg-success' : (type === 'error' ? 'bg-danger' : 'bg-primary');
                const html = `
                    <div class="toast align-items-center text-white ${bg} border-0 show" role="alert" aria-live="assertive" aria-atomic="true">
                      <div class="d-flex">
                        <div class="toast-body fw-bold">
                          <strong>${title}</strong>: ${message}
                        </div>
                        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
                      </div>
                    </div>`;
                const div = document.createElement('div');
                div.innerHTML = html;
                container.appendChild(div.firstElementChild);
                setTimeout(() => { if(container.firstChild) container.removeChild(container.firstElementChild); }, 4000);
            },
            getStatusBadge: (status) => {
                const map = {
                    'NEW': '<span class="status-pill status-new">NEW LEAD</span>',
                    'CONTACTED': '<span class="status-pill status-contacted">CONTACTED</span>',
                    'PROPOSAL_SENT': '<span class="status-pill status-proposal">PROPOSAL SENT</span>',
                    'QUALIFIED': '<span class="status-pill status-qualified"><i class="fa-solid fa-check me-1"></i> QUALIFIED</span>',
                    'LOST': '<span class="status-pill status-lost">LOST</span>'
                };
                return map[status] || map['NEW'];
            }
        };

        function init() {
            fetchRealLeads();
            fetchRealKPIs();
            document.getElementById('propCurrency').addEventListener('change', function() {
                document.getElementById('dispCurr').innerText = this.value;
            });
        }
        
        async function fetchRealLeads() {
            try {
                const res = await fetch('../../api/smart_quote_api.php?action=fetch_leads');
                const data = await res.json();
                if(data.success) {
                    state.leads = data.leads;
                    renderLeadsTable('ALL');
                }
            } catch (err) { console.error("Error fetching leads:", err); }
        }
        
        async function fetchRealKPIs() {
            try {
                const res = await fetch('../../api/smart_quote_api.php?action=fetch_kpis');
                const data = await res.json();
                if(data.success) {
                    document.getElementById('kpi-leads').innerText = data.kpis.total_leads;
                    document.getElementById('kpi-proposals').innerText = data.kpis.proposals_sent;
                    document.getElementById('kpi-converted').innerText = data.kpis.qualified;
                    document.getElementById('kpi-conversion').innerText = data.kpis.conversion_rate;
                }
            } catch (err) { console.error("Error fetching KPIs:", err); }
        }

        // --- Lead Table Logic ---
        function renderLeadsTable(filterStatus) {
            const tbody = document.getElementById('leadsTableBody');
            const emptyState = document.getElementById('emptyState');
            
            let filtered = state.leads;
            if(filterStatus !== 'ALL') {
                filtered = filtered.filter(l => l.status === filterStatus);
            }

            if (filtered.length === 0) {
                tbody.innerHTML = '';
                emptyState.classList.remove('d-none');
                return;
            }
            emptyState.classList.add('d-none');

            tbody.innerHTML = filtered.map(lead => {
                // Action Buttons Logic
                let actionHtml = '';
                
                if (lead.status === 'NEW' || lead.status === 'CONTACTED') {
                    actionHtml = `
                        <button class="btn btn-sm btn-light border text-secondary me-1" onclick="APP.editLead('${lead.id}')" title="Edit Lead Info"><i class="fa-solid fa-pen"></i></button>
                        <button class="btn btn-sm btn-outline-primary fw-bold shadow-sm" onclick="APP.openProposalEditor('${lead.id}')">Create Proposal</button>
                    `;
                } 
                else if (lead.status === 'PROPOSAL_SENT') {
                    actionHtml = `
                        <button class="btn btn-sm btn-light border text-secondary me-1" onclick="APP.openEditChoice('${lead.id}')" title="Edit Options"><i class="fa-solid fa-pen"></i></button>
                        <button class="btn btn-sm btn-light fw-bold text-primary border me-2" onclick="APP.openProposalLinkFromId('${lead.id}')" title="View PDF"><i class="fa-solid fa-print"></i></button>
                        <button class="btn btn-sm btn-success fw-bold shadow-sm" onclick="APP.convertToClient('${lead.id}')"><i class="fa-solid fa-bolt me-1"></i> Convert</button>
                    `;
                }
                else if (lead.status === 'QUALIFIED') {
                    actionHtml = `<span class="badge bg-light text-success border border-success p-2"><i class="fa-solid fa-link me-1"></i> In Client Master</span>`;
                }

                return `
                    <tr>
                        <td class="text-muted fw-bold small">${lead.date}</td>
                        <td class="fw-bolder text-dark">${lead.company}</td>
                        <td>
                            <div class="fw-bold">${lead.contact}</div>
                            <small class="text-muted">${lead.phone}</small>
                        </td>
                        <td class="text-muted small">${lead.country}</td>
                        <td class="text-center">${utils.getStatusBadge(lead.status)}</td>
                        <td class="text-end">${actionHtml}</td>
                    </tr>
                `;
            }).join('');
        }

        function filterLeads(status, btnElement) {
            const buttons = document.querySelectorAll('.btn-group button');
            buttons.forEach(b => b.classList.remove('active'));
            btnElement.classList.add('active'); 
            
            renderLeadsTable(status);
        }

        function searchLeads(query) {
            query = query.toLowerCase();
            const tbody = document.getElementById('leadsTableBody');
            const rows = tbody.querySelectorAll('tr');
            rows.forEach(row => {
                const text = row.innerText.toLowerCase();
                row.style.display = text.includes(query) ? '' : 'none';
            });
        }
        
        function openMeetingWizard() {
            // Populate the Dropdown with leads
            const select = document.getElementById('meetLeadSelect');
            select.innerHTML = '<option value="">-- Select a Lead --</option>';
            state.leads.forEach(lead => {
                select.innerHTML += `<option value="${lead.id}">${lead.company} (${lead.contact})</option>`;
            });

            // Set today's date
            document.getElementById('meetDate').value = new Date().toISOString().split('T')[0];
            
            // Clear text areas
            document.getElementById('meetLocation').value = '';
            document.getElementById('meetOps').value = '';
            document.getElementById('meetPain').value = '';
            document.getElementById('meetStrategy').value = '';

            // Listen for dropdown changes to auto-load existing notes
            select.onchange = function() {
                const lead = state.leads.find(l => String(l.id) === String(this.value));
                if(lead) {
                    document.getElementById('meetOps').value = lead.meeting_ops || '';
                    document.getElementById('meetPain').value = lead.meeting_pain || '';
                    document.getElementById('meetStrategy').value = lead.meeting_strategy || '';
                }
            };

            const modal = new bootstrap.Modal(document.getElementById('meetingWizardModal'));
            modal.show();
        }

        async function saveMeetingNotes() {
            const leadId = document.getElementById('meetLeadSelect').value;
            if(!leadId) {
                utils.showToast('Error', 'Please select a Lead to attach these notes to.', 'error');
                return;
            }

            const btn = document.getElementById('btnSaveMeeting');
            const originalHtml = btn.innerHTML;
            btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin me-2"></i> Saving...`;
            btn.disabled = true;

            const payload = {
                action: 'save_meeting_notes',
                lead_id: leadId,
                ops: document.getElementById('meetOps').value,
                pain: document.getElementById('meetPain').value,
                strategy: document.getElementById('meetStrategy').value
            };

            try {
                const res = await fetch('../../api/smart_quote_api.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await res.json();

                if(result.success) {
                    bootstrap.Modal.getInstance(document.getElementById('meetingWizardModal')).hide();
                    utils.showToast('Diagnostic Secured', 'Meeting notes synced with database successfully.', 'success');
                    fetchRealLeads(); // Refresh leads to pull the new notes into state
                } else {
                    utils.showToast('Error', result.error, 'error');
                }
            } catch (err) {
                utils.showToast('Error', 'Connection failed.', 'error');
            } finally {
                btn.innerHTML = originalHtml;
                btn.disabled = false;
            }
        }
        
        function openNewLeadModal() {
            document.getElementById('leadForm').reset();
            document.getElementById('editLeadId').value = ''; // Clear edit ID
            const modal = new bootstrap.Modal(document.getElementById('newLeadModal'));
            modal.show();
        }

        function editLead(leadId) {
            // Using == instead of === handles string vs number mismatch
            const lead = state.leads.find(l => l.id == leadId);
            if (!lead) return;
            
            document.getElementById('editLeadId').value = lead.id;
            document.getElementById('leadCompany').value = lead.company || '';
            document.getElementById('leadContact').value = lead.contact || '';
            document.getElementById('leadPhone').value = lead.phone || '';
            document.getElementById('leadEmail').value = lead.email || '';
            document.getElementById('leadCountry').value = lead.country || '';
            document.getElementById('leadAddress').value = lead.address || '';
            document.getElementById('leadNiu').value = lead.niu || '';
            document.getElementById('leadRccm').value = lead.rccm || '';
            
            const modal = new bootstrap.Modal(document.getElementById('newLeadModal'));
            modal.show();
        }

        async function saveLead() {
            const company = document.getElementById('leadCompany').value;
            const contact = document.getElementById('leadContact').value;
            const phone = document.getElementById('leadPhone').value;
            const editId = document.getElementById('editLeadId').value; // Check if editing

            if(!company || !contact || !phone) {
                utils.showToast('Validation Error', 'Company, Contact, and Phone are required.', 'error');
                return;
            }

            const payload = {
                action: editId ? 'update_lead' : 'save_lead',
                lead_id: editId,
                company: company,
                contact: contact,
                phone: phone,
                email: document.getElementById('leadEmail').value,
                country: document.getElementById('leadCountry').value || 'Cameroon',
                address: document.getElementById('leadAddress').value,
                niu: document.getElementById('leadNiu').value,
                rccm: document.getElementById('leadRccm').value
            };

            try {
                const res = await fetch('../../api/smart_quote_api.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await res.json();

                if (result.success) {
                    const modalEl = document.getElementById('newLeadModal');
                    bootstrap.Modal.getInstance(modalEl).hide();
                    utils.showToast('Success', editId ? 'Lead updated successfully.' : 'Lead successfully registered.');
                    
                    fetchRealLeads(); // Refresh table
                    if(!editId) fetchRealKPIs();  // Refresh KPIs if new lead
                } else {
                    utils.showToast('Error', result.error, 'error');
                }
            } catch (err) {
                utils.showToast('Error', 'Failed to connect to server.', 'error');
            }
        }

        // --- Proposal Editor Offcanvas ---
        function openProposalEditor(leadId) {
            try {
                state.currentLeadId = leadId;
                state.currentProposalId = null;
                // Safely find the lead regardless of string/number type
                const lead = state.leads.find(l => String(l.id) === String(leadId));
                
                if(!lead) {
                    utils.showToast('Error', 'Could not load lead data. Please refresh the page.', 'error');
                    return;
                }
                
                // Reset UI safely
                document.getElementById('propLeadName').innerText = lead.company;
                document.getElementById('propStatusBadge').className = "status-pill status-new";
                document.getElementById('propStatusBadge').innerText = "DRAFT";
                
                // Clear inputs safely
                const inputs = [
                    'propOrigin', 'propDest', 'propWeight', 'propDesc', 'propCategory',
                    'aiInputOps', 'aiInputPain', 'aiInputStrategy', 
                    'aiContextEn', 'aiContextFr', 'aiStrategyEn', 'aiStrategyFr', 
                    'aiCaseTitleEn', 'aiCaseBodyEn', 'aiCaseTitleFr', 'aiCaseBodyFr'
                ];
                inputs.forEach(id => {
                    const el = document.getElementById(id);
                    if(el) el.value = ''; 
                });
                
                // --- PRE-FILL AI PROMPTS WITH MEETING NOTES ---
                if (lead.meeting_ops) document.getElementById('aiInputOps').value = lead.meeting_ops;
                if (lead.meeting_pain) document.getElementById('aiInputPain').value = lead.meeting_pain;
                if (lead.meeting_strategy) document.getElementById('aiInputStrategy').value = lead.meeting_strategy;
                
                // Hide the output area until generated
                const outputArea = document.getElementById('aiOutputArea');
                if(outputArea) outputArea.classList.add('d-none');
                
                const incotermEl = document.getElementById('propIncoterm');
                if(incotermEl) incotermEl.value = 'EXW';
                
                // Reset lines
                state.proposalLines = [];
                addProposalRow(); // Add one default blank row
                
                // Safely trigger Bootstrap Offcanvas (Prevents initialization crashes)
                const offcanvasEl = document.getElementById('proposalEditor');
                const offcanvas = bootstrap.Offcanvas.getOrCreateInstance(offcanvasEl);
                offcanvas.show();

            } catch (error) {
                console.error("Proposal Editor Error:", error);
                utils.showToast('System Error', 'Failed to open proposal editor.', 'error');
            }
        }

        // --- Proposal Table Logic ---
        function addProposalRow() {
            state.proposalLines.push({ desc: '', qty: 1, rate: 0, total: 0 });
            renderProposalTable();
        }

        function removeProposalRow(index) {
            state.proposalLines.splice(index, 1);
            if(state.proposalLines.length === 0) addProposalRow(); // keep at least one
            else renderProposalTable();
        }

        function updateRowData(index, field, value) {
            if (field === 'qty' || field === 'rate') {
                value = utils.parseCurrency(value);
            }
            state.proposalLines[index][field] = value;
            
            if (field === 'qty' || field === 'rate') {
                state.proposalLines[index].total = state.proposalLines[index].qty * state.proposalLines[index].rate;
            }
            renderProposalTable();
        }

        function renderProposalTable() {
            const tbody = document.getElementById('proposalLinesBody');
            let grandTotal = 0;

            tbody.innerHTML = state.proposalLines.map((line, idx) => {
                grandTotal += line.total;
                return `
                    <tr>
                        <td class="text-center text-muted small pt-3">${idx + 1}</td>
                        <td>
                            <div class="autocomplete-wrapper">
                                <input type="text" placeholder="Search Service description..." value="${line.desc}" 
                                    onchange="APP.updateRowData(${idx}, 'desc', this.value)"
                                    oninput="APP.searchDictionaryForLine(${idx}, this.value)" autocomplete="off">
                                <div id="suggestion-box-${idx}" class="suggestion-box"></div>
                            </div>
                        </td>
                        <td class="cell-qty">
                            <input type="number" step="0.01" value="${line.qty}" 
                                id="propQty_${idx}" name="propQty_${idx}" aria-label="Quantity for row ${idx + 1}"
                                onchange="APP.updateRowData(${idx}, 'qty', this.value)">
                        </td>
                        <td class="cell-price">
                            <input type="text" value="${utils.formatCurrency(line.rate)}" 
                                id="propRate_${idx}" name="propRate_${idx}" aria-label="Unit rate for row ${idx + 1}"
                                onchange="APP.updateRowData(${idx}, 'rate', this.value)"
                                onfocus="this.value = APP.utils.parseCurrency(this.value)">
                        </td>
                        <td class="cell-total">
                            <input type="text" value="${utils.formatCurrency(line.total)}" disabled 
                                id="propTotal_${idx}" name="propTotal_${idx}" aria-label="Total for row ${idx + 1}"
                                style="background: #f8fafc; color: #055B83;">
                        </td>
                        <td class="col-del" onclick="APP.removeProposalRow(${idx})">
                            <i class="fa-solid fa-trash"></i>
                        </td>
                    </tr>
                `;
            }).join('');

            document.getElementById('dispGrandTotal').innerText = utils.formatCurrency(grandTotal);
        }

        // --- Financial Dictionary Search ---
        let searchTimeout = null;
        async function searchDictionaryForLine(lineIdx, query) {
            const box = document.getElementById(`suggestion-box-${lineIdx}`);
            if (!query || query.length < 2) {
                box.style.display = 'none';
                return;
            }

            if (searchTimeout) clearTimeout(searchTimeout);

            searchTimeout = setTimeout(async () => {
                try {
                    // Reusing the existing proforma API for the dictionary search
                    const res = await fetch(`../../api/proforma-invoice/proforma-api.php?action=search_dictionary&q=${encodeURIComponent(query)}`);
                    const result = await res.json();
                    
                    if (result.items && result.items.length > 0) {
                        box.innerHTML = `
                            <div class="suggestion-header">
                                <div>CODE</div><div>DESCRIPTION</div>
                            </div>
                        ` + result.items.map(item => {
                            const safeDesc = item.description.replace(/'/g, "\\'");
                            return `
                                <div class="suggestion-item" onmousedown="APP.selectDictionaryItem(${lineIdx}, '${safeDesc}', ${item.unit_price || 0})">
                                    <div class="s-code">${item.code}</div>
                                    <div class="s-desc">${item.description}</div>
                                </div>
                            `;
                        }).join('');
                        box.style.display = 'block';
                    } else {
                        box.style.display = 'none';
                    }
                } catch (error) { console.error('Dictionary search error:', error); }
            }, 300);
        }

        function selectDictionaryItem(lineIdx, desc, defaultPrice) {
            setTimeout(() => {
                state.proposalLines[lineIdx].desc = desc;
                // If you want default prices from dict, uncomment next line:
                // state.proposalLines[lineIdx].rate = parseFloat(defaultPrice); 
                
                const box = document.getElementById(`suggestion-box-${lineIdx}`);
                if(box) box.style.display = 'none';
                
                updateRowData(lineIdx, 'desc', desc); // Triggers re-render
            }, 100);
        }
        
        async function generateAIContent() {
            const btn = document.getElementById('btnGenerateAI');
            const originalHtml = btn.innerHTML;
            
            // Lock button & show spinner
            btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin me-1"></i> Generating...`;
            btn.disabled = true;

            const payload = {
                action: 'generate_ai_content',
                client_operations: document.getElementById('aiInputOps').value,
                pain_points: document.getElementById('aiInputPain').value,
                proposed_solution: document.getElementById('aiInputStrategy').value,
                tone: document.getElementById('aiTone').value
            };

            try {
                const res = await fetch('../../api/smart_quote_api.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await res.json();

                if(result.success && result.ai_data) {
                    const ai = result.ai_data;
                    
                    // Populate Text Areas
                    document.getElementById('aiContextEn').value = ai.client_context_en || '';
                    document.getElementById('aiContextFr').value = ai.client_context_fr || '';
                    document.getElementById('aiStrategyEn').value = ai.operational_strategy_en || '';
                    document.getElementById('aiStrategyFr').value = ai.operational_strategy_fr || '';
                    
                    // Populate Custom Case Studies
                    document.getElementById('aiCaseTitleEn').value = ai.case_study_title_en || '';
                    document.getElementById('aiCaseBodyEn').value = ai.case_study_body_en || '';
                    document.getElementById('aiCaseTitleFr').value = ai.case_study_title_fr || '';
                    document.getElementById('aiCaseBodyFr').value = ai.case_study_body_fr || '';

                    // Populate Hidden SLA Fields
                    document.getElementById('aiSlasEn').value = JSON.stringify(ai.slas_en || []);
                    document.getElementById('aiSlasFr').value = JSON.stringify(ai.slas_fr || []);

                    // Reveal Output Area
                    document.getElementById('aiOutputArea').classList.remove('d-none');
                    utils.showToast('AI Success', 'Narrative generated! Review the tabs below.', 'success');
                } else {
                    utils.showToast('AI Error', result.error || 'Failed to generate content.', 'error');
                }
            } catch (err) {
                console.error(err);
                utils.showToast('AI Error', 'Server connection failed.', 'error');
            } finally {
                // Unlock button
                btn.innerHTML = originalHtml;
                btn.disabled = false;
            }
        }
        
        // --- EDIT CHOICE LOGIC ---
        function openEditChoice(leadId) {
            state.currentLeadId = leadId;
            const modal = new bootstrap.Modal(document.getElementById('editChoiceModal'));
            modal.show();
        }

        function triggerEditLead() {
            bootstrap.Modal.getInstance(document.getElementById('editChoiceModal')).hide();
            editLead(state.currentLeadId);
        }

        async function triggerEditProposal() {
            bootstrap.Modal.getInstance(document.getElementById('editChoiceModal')).hide();
            
            const lead = state.leads.find(l => String(l.id) === String(state.currentLeadId));
            if(!lead) return;

            // Fetch existing proposal data
            try {
                const res = await fetch('../../api/smart_quote_api.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'fetch_proposal', lead_id: state.currentLeadId })
                });
                const result = await res.json();

                if (result.success && result.proposal) {
                    state.currentProposalId = result.proposal.proposal_id; // Set ID for updating!
                    
                    document.getElementById('propLeadName').innerText = lead.company;
                    document.getElementById('propStatusBadge').className = "status-pill status-proposal";
                    document.getElementById('propStatusBadge').innerText = result.proposal.status;

                    // Fill Inputs
                    document.getElementById('propLang').value = result.proposal.language || 'fr';
                    document.getElementById('propCurrency').value = result.proposal.currency || 'XAF';
                    document.getElementById('propCategory').value = result.proposal.service_category || '';
                    document.getElementById('propIncoterm').value = result.proposal.incoterm || 'EXW';
                    document.getElementById('propOrigin').value = result.proposal.origin_location || '';
                    document.getElementById('propDest').value = result.proposal.destination_location || '';
                    document.getElementById('propWeight').value = result.proposal.estimated_weight || '';
                    document.getElementById('propProjectFlag').checked = result.proposal.project_cargo_flag == 1;
                    document.getElementById('propDesc').value = result.proposal.cargo_description || '';
                    document.getElementById('slaCustoms').value = result.proposal.customs_clearance_target || '';
                    document.getElementById('slaTransit').value = result.proposal.transit_time_target || '';
                    document.getElementById('slaFreeDays').value = result.proposal.free_days_demurrage || '';
                    document.getElementById('termPayment').value = result.proposal.payment_conditions || '';
                    document.getElementById('termValidity').value = result.proposal.validity_days || '30';

                    // Fill AI Narrative
                    const n = result.narrative || {};
                    // Restore Raw Notes
                    document.getElementById('aiInputOps').value = n.raw_client_operations || '';
                    document.getElementById('aiInputPain').value = n.raw_pain_points || '';
                    document.getElementById('aiInputStrategy').value = n.raw_proposed_strategy || '';
                    if (n.raw_tone) document.getElementById('aiTone').value = n.raw_tone;
                    document.getElementById('aiContextEn').value = n.client_context_en || '';
                    document.getElementById('aiContextFr').value = n.client_context_fr || '';
                    document.getElementById('aiStrategyEn').value = n.operational_strategy_en || '';
                    document.getElementById('aiStrategyFr').value = n.operational_strategy_fr || '';
                    document.getElementById('aiCaseTitleEn').value = n.case_study_title_en || '';
                    document.getElementById('aiCaseBodyEn').value = n.case_study_body_en || '';
                    document.getElementById('aiCaseTitleFr').value = n.case_study_title_fr || '';
                    document.getElementById('aiCaseBodyFr').value = n.case_study_body_fr || '';
                    document.getElementById('aiSlasEn').value = n.custom_slas_en || '[]';
                    document.getElementById('aiSlasFr').value = n.custom_slas_fr || '[]';

                    // If narrative exists, reveal the AI area
                    if (n.client_context_en) document.getElementById('aiOutputArea').classList.remove('d-none');

                    // Fill Lines
                    state.proposalLines = result.lines || [];
                    if(state.proposalLines.length === 0) addProposalRow();
                    else renderProposalTable();

                    bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('proposalEditor')).show();
                } else {
                    utils.showToast('Error', 'Could not fetch existing proposal.', 'error');
                }
            } catch (e) {
                utils.showToast('Error', 'Network connection failed.', 'error');
            }
        }
        
        // Helper to quickly open a sent PDF
        async function openProposalLinkFromId(leadId) {
            try {
                const res = await fetch('../../api/smart_quote_api.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'fetch_proposal', lead_id: leadId })
                });
                const result = await res.json();
                if (result.success && result.proposal) {
                    window.open(`https://smartls.cm/quote.php?token=${result.proposal.token}`, '_blank');
                }
            } catch(e) {}
        }
        
        async function saveProposal(action) {
            const category = document.getElementById('propCategory').value;
            
            // Require a category only if we are generating a token, not for drafts
            if (action === 'GENERATE' && !category) {
                utils.showToast('Validation Error', 'Service Category is required.', 'error');
                return;
            }

            // UI Spinner Logic
            const btn = action === 'DRAFT' ? document.getElementById('btnSaveDraft') : document.getElementById('btnSaveGenerate');
            const originalHtml = btn.innerHTML;
            btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin me-2"></i>Processing...`;
            btn.disabled = true;

            const payload = {
                action: 'save_proposal',
                proposal_id: state.currentProposalId,
                lead_id: state.currentLeadId,
                proposal_status: action === 'DRAFT' ? 'DRAFT' : 'SENT',
                language: document.getElementById('propLang').value,
                currency: document.getElementById('propCurrency').value,
                service_category: category,
                incoterm: document.getElementById('propIncoterm').value,
                origin: document.getElementById('propOrigin').value,
                dest: document.getElementById('propDest').value,
                weight: document.getElementById('propWeight').value,
                project_flag: document.getElementById('propProjectFlag').checked ? 1 : 0,
                customs_tgt: document.getElementById('slaCustoms').value,
                transit_tgt: document.getElementById('slaTransit').value,
                free_days: document.getElementById('slaFreeDays').value,
                payment: document.getElementById('termPayment').value,
                validity: document.getElementById('termValidity').value,
                desc: document.getElementById('propDesc').value,
                lines: state.proposalLines,
                
                // --- RAW AI INPUTS ---
                ai_input_ops: document.getElementById('aiInputOps')?.value || '',
                ai_input_pain: document.getElementById('aiInputPain')?.value || '',
                ai_input_strategy: document.getElementById('aiInputStrategy')?.value || '',
                ai_tone: document.getElementById('aiTone')?.value || 'Consultative, Advisory, and Expert',
                
                // --- AI DATA ---
                ai_context_en: document.getElementById('aiContextEn')?.value || '',
                
                // --- AI DATA ---
                ai_context_en: document.getElementById('aiContextEn')?.value || '',
                ai_context_fr: document.getElementById('aiContextFr')?.value || '',
                ai_strategy_en: document.getElementById('aiStrategyEn')?.value || '',
                ai_strategy_fr: document.getElementById('aiStrategyFr')?.value || '',
                ai_case_title_en: document.getElementById('aiCaseTitleEn')?.value || '',
                ai_case_body_en: document.getElementById('aiCaseBodyEn')?.value || '',
                ai_case_title_fr: document.getElementById('aiCaseTitleFr')?.value || '',
                ai_case_body_fr: document.getElementById('aiCaseBodyFr')?.value || '',
                ai_slas_en: JSON.parse(document.getElementById('aiSlasEn')?.value || '[]'),
                ai_slas_fr: JSON.parse(document.getElementById('aiSlasFr')?.value || '[]')
            };

            try {
                const res = await fetch('../../api/smart_quote_api.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await res.json();

                if(result.success) {
                    bootstrap.Offcanvas.getInstance(document.getElementById('proposalEditor')).hide();
                    fetchRealLeads();
                    fetchRealKPIs();
                    
                    if (action === 'GENERATE') {
                        utils.showToast('Success', 'Proposal generated and saved to database.', 'success');
                        showShareModal(result.token); 
                    } else {
                        utils.showToast('Success', 'Draft saved successfully.', 'success');
                    }
                } else {
                    utils.showToast('Error', result.error, 'error');
                }
            } catch (err) {
                console.error("Save Proposal Error: ", err);
                utils.showToast('Error', 'Failed to communicate with server.', 'error');
            } finally {
                // Restore button state
                btn.innerHTML = originalHtml;
                btn.disabled = false;
            }
        }
        
        // --- Sharing Logic ---
        function showShareModal(token) {
            // Reconstruct the Lead Data to pre-fill the form
            const lead = state.leads.find(l => String(l.id) === String(state.currentLeadId)) || {};
            const companyName = lead.company || 'your company';
            const leadPhone = lead.phone || '';
            
            // Build the link
            const baseUrl = window.location.origin + window.location.pathname.replace('sales-pipelining.php', '');
            const link = `https://smartls.cm/quote.php?token=${token}`;
            
            // Build the standard WhatsApp Message
            const message = `Hello,\n\nPlease find attached the commercial proposal for ${companyName}.\n\nYou can securely view and download your proposal here:\n${link}\n\nIf you have any questions or require further clarifications, please feel free to reply to this message or reach out to us at sales@smartls.cm.\n\nBest regards,\nSmart LS Automated System`;

            // Populate the Modal
            document.getElementById('generatedLink').value = link;
            document.getElementById('waPhone').value = leadPhone;
            document.getElementById('waMessage').value = message;

            // Show Modal
            const shareModal = new bootstrap.Modal(document.getElementById('shareProposalModal'));
            shareModal.show();
        }

        function copyProposalLink() {
            const linkInput = document.getElementById('generatedLink');
            linkInput.select();
            linkInput.setSelectionRange(0, 99999); // For mobile devices
            navigator.clipboard.writeText(linkInput.value).then(() => {
                utils.showToast('Copied', 'Proposal link copied to clipboard.', 'success');
            }).catch(() => {
                utils.showToast('Error', 'Failed to copy link.', 'error');
            });
        }

        function openProposalLink() {
            const link = document.getElementById('generatedLink').value;
            if (link) window.open(link, '_blank');
        }

        function sendWhatsApp() {
            let phone = document.getElementById('waPhone').value;
            const message = document.getElementById('waMessage').value;

            if (!phone) {
                utils.showToast('Validation Error', 'Please provide a WhatsApp number.', 'error');
                return;
            }

            // Clean the phone number for the wa.me API (remove spaces, pluses, dashes)
            phone = phone.replace(/[^0-9]/g, '');
            
            const encodedMessage = encodeURIComponent(message);
            const whatsappUrl = `https://wa.me/${phone}?text=${encodedMessage}`;
            
            window.open(whatsappUrl, '_blank');
        }

        async function convertToClient(leadId) {
            if(!confirm("Convert this Lead into a Qualified Client? This will automatically push the data into the Client Master and Quote Requests tables.")) return;

            try {
                const res = await fetch('../../api/smart_quote_api.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'convert_lead', lead_id: leadId })
                });
                const result = await res.json();

                if (result.success) {
                    // Build the link to the Client Master Registry, passing the ID as a search parameter
                    const clientProfileLink = `client-master-registry.php?search=${result.client_id}`;
                    
                    const successHtml = `
                        <div class="d-flex flex-column gap-2">
                            <span>${result.message}</span>
                            <a href="${clientProfileLink}" class="btn btn-light btn-sm fw-bold text-primary align-self-start">
                                <i class="fa-solid fa-user-tie me-1"></i> View Client Profile
                            </a>
                        </div>
                    `;

                    // Show the toast with the action button inside it
                    utils.showToast('Conversion Successful!', successHtml, 'success');
                    
                    fetchRealLeads();
                    fetchRealKPIs();
                } else {
                    utils.showToast('Error', result.error, 'error');
                }
            } catch (err) {
                console.error("Conversion Error:", err);
                utils.showToast('Error', 'Failed to communicate with server.', 'error');
            }
        }
        
        // clock display (simple)
    function tickClock(){
      const d = new Date();
      document.getElementById('realtime-clock').innerText = d.toLocaleTimeString();
    }
    setInterval(tickClock, 1000); tickClock();
    function toggleClock(){ showToast('Clock feature is UI-only here.'); }
    
    // --- SPEECH-TO-TEXT LOGIC ---
        let mediaRecorder = null;
        let audioChunks = [];
        let isRecording = false;
        let currentTargetInputId = null;
        let currentMicButton = null;

        async function toggleDictation(inputId, btnElement) {
            if (isRecording) {
                // If the user clicks the same active button, stop recording
                if (currentTargetInputId === inputId) {
                    stopRecording();
                } else {
                    utils.showToast('Info', 'Please stop the current recording first.', 'info');
                }
                return;
            }

            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
                
                currentTargetInputId = inputId;
                currentMicButton = btnElement;
                audioChunks = [];

                mediaRecorder.ondataavailable = event => {
                    if (event.data.size > 0) audioChunks.push(event.data);
                };

                mediaRecorder.onstop = async () => {
                    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                    
                    // Stop all microphone tracks to release hardware
                    stream.getTracks().forEach(track => track.stop());
                    
                    // Set UI to loading state
                    currentMicButton.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
                    currentMicButton.classList.replace('btn-danger', 'btn-outline-danger');
                    currentMicButton.classList.remove('dictation-pulse');
                    
                    await processAudio(audioBlob, currentTargetInputId, currentMicButton);
                    
                    isRecording = false;
                    currentTargetInputId = null;
                    currentMicButton = null;
                };

                mediaRecorder.start();
                isRecording = true;
                
                // Update UI to recording state
                btnElement.innerHTML = '<i class="fa-solid fa-stop"></i>';
                btnElement.classList.replace('btn-outline-danger', 'btn-danger');
                btnElement.classList.add('dictation-pulse');

            } catch (err) {
                console.error('Mic error:', err);
                utils.showToast('Permissions Error', 'Microphone access denied. Please allow it in your browser settings.', 'error');
            }
        }

        function stopRecording() {
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop();
            }
        }

        async function processAudio(blob, inputId, btnElement) {
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = async function() {
                const base64Audio = reader.result;
                
                try {
                    const res = await fetch('../../api/smart_quote_api.php', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'transcribe_audio', audio_b64: base64Audio })
                    });
                    const result = await res.json();
                    
                    if (result.success && result.text) {
                        const inputEl = document.getElementById(inputId);
                        const currentText = inputEl.value.trim();
                        // Append with a space
                        inputEl.value = currentText ? currentText + ' ' + result.text : result.text;
                        utils.showToast('Success', 'Audio transcribed!', 'success');
                    } else {
                        utils.showToast('Error', result.error || 'Transcription failed.', 'error');
                    }
                } catch (err) {
                    utils.showToast('Error', 'Failed to reach backend.', 'error');
                } finally {
                    // Reset button back to normal microphone icon
                    btnElement.innerHTML = '<i class="fa-solid fa-microphone"></i>';
                }
            };
        }
        // Expose public methods
        return {
            init,
            utils,
            filterLeads,
            searchLeads,
            openNewLeadModal,
            editLead,
            saveLead,
            openEditChoice,
            triggerEditLead,
            triggerEditProposal,
            openMeetingWizard,
            saveMeetingNotes,
            toggleDictation,
            toggleDictation,
            openProposalLinkFromId,
            openProposalEditor,
            addProposalRow,
            removeProposalRow,
            updateRowData,
            generateAIContent,
            saveProposal,
            convertToClient,
            searchDictionaryForLine,
            selectDictionaryItem,
            showShareModal,
            copyProposalLink,
            openProposalLink,
            sendWhatsApp
        };

    })();

    // Initialize when DOM is ready
    document.addEventListener('DOMContentLoaded', APP.init);
</script>
</body>
</html>