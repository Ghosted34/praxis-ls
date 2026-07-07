<?php
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN','FINANCE','MANAGEMENT','OPERATIONS']);

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
$role      = strtoupper((string)($me['role'] ?? 'OPERATIONS'));
$roleLabel = $roleLabelMap[$role] ?? $role;

// --- Avatar (UI Avatars) ---
$avatarName = urlencode($fullName);
$avatarUrl  = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";

// --- Greeting ---
$hour = (int)date('H');
$greeting = ($hour < 12) ? 'Good morning' : (($hour < 18) ? 'Good afternoon' : 'Good evening');

function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Document Vault & Compliance | Smart LS</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&family=Inconsolata:wght@500;700&display=swap" rel="stylesheet">

  <style>
    /* ==========================================================================
       Document Vault page-only styling (keep UI consistent with admin.css shell)
       ========================================================================== */
    :root{
      --smart-blue: #1F99D8;
      --smart-dark: #055B83;
      --smart-orange: #EE7D04;
      --smart-charcoal: #231F20;
      --smart-gray-50: #F8FAFC;
      --smart-gray-100: #F1F5F9;
      --smart-gray-200: #E2E8F0;
      --smart-gray-300: #CBD5E1;
      --smart-gray-400: #94A3B8;
      --smart-gray-800: #1E293B;

      --status-verified-bg: #DCFCE7; --status-verified-text: #15803D;
      --status-pending-bg: #FFF7ED;  --status-pending-text: #C2410C;
      --status-missing-bg: #FEF2F2;  --status-missing-text: #B91C1C;
      --status-archived-bg: #F1F5F9; --status-archived-text: #475569;

      --font-body: 'Manrope', sans-serif;
      --font-heading: 'Montserrat', sans-serif;
      --font-mono: 'Inconsolata', monospace;
    }

    *{ box-sizing:border-box; }
    body{
      font-family: var(--font-body);
      background-color: var(--smart-gray-50);
      color: var(--smart-charcoal);
      font-size: 0.9rem;
      line-height: 1.5;
      overflow-x: hidden;
    }

    h1,h2,h3,h4,h5,h6,.font-heading{ font-family: var(--font-heading); }
    .font-mono{ font-family: var(--font-mono); }
    .text-orange{ color: var(--smart-orange) !important; }
    .bg-orange{ background-color: var(--smart-orange) !important; }
    .fw-black{ font-weight: 800; }
    .text-xs{ font-size: 0.75rem; }

    a,button,.card-custom,.nav-item,.folder-item{ transition: all 0.2s ease-in-out; }

    /* --- Page content wrappers --- */
    .vault-wrap{
      padding: 28px 0 80px;
    }

    /* --- DASHBOARD WIDGETS --- */
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; margin-bottom: 32px; }
    .kpi-card {
      background: white; border-radius: 12px; padding: 20px;
      border: 1px solid var(--smart-gray-200); box-shadow: 0 2px 4px rgba(0,0,0,0.01);
      display: flex; align-items: center; gap: 16px; position: relative; overflow: hidden;
    }
    .kpi-card:hover { transform: translateY(-2px); box-shadow: 0 10px 15px rgba(0,0,0,0.03); }
    .kpi-icon {
      width: 48px; height: 48px; border-radius: 12px;
      display: flex; align-items: center; justify-content: center; font-size: 1.25rem; flex-shrink: 0;
    }
    .kpi-content { flex: 1; }
    .kpi-label { font-size: 0.7rem; font-weight: 700; color: #94A3B8; text-transform: uppercase; margin-bottom: 4px; }
    .kpi-number { font-size: 1.5rem; font-weight: 800; color: var(--smart-charcoal); line-height: 1.1; }

    /* --- ACTION CARD (MISSING EVIDENCE) --- */
    .kpi-action-card {
      background: linear-gradient(145deg, #FEF2F2, #FFF);
      border: 2px solid #FECACA;
      cursor: pointer;
      transition: 0.3s;
      position: relative;
    }
    .kpi-action-card:hover {
      border-color: #EF4444;
      box-shadow: 0 0 15px rgba(239, 68, 68, 0.2);
      transform: translateY(-3px);
    }
    .kpi-action-card .kpi-icon { background: #FEE2E2; color: #DC2626; }
    .kpi-action-card .kpi-label { color: #B91C1C; }
    .kpi-action-card .kpi-number { color: #DC2626; }
    .kpi-action-arrow {
      position: absolute; right: 15px; top: 50%; transform: translateY(-50%);
      color: #DC2626; opacity: 0.5; font-size: 1.2rem; transition: 0.2s;
    }
    .kpi-action-card:hover .kpi-action-arrow { opacity: 1; right: 10px; }

    /* --- FILE EXPLORER LAYOUT --- */
    .explorer-layout {
      display: grid; grid-template-columns: 300px 1fr; gap: 24px; height: calc(100vh - 330px);
    }

    /* Tree Sidebar */
    .tree-panel {
      background: white; border-radius: 12px; border: 1px solid var(--smart-gray-200);
      display: flex; flex-direction: column; overflow: hidden;
    }
    .tree-header {
      padding: 16px; border-bottom: 1px solid var(--smart-gray-200);
      background: #F8FAFC; display: flex; align-items: center; justify-content: space-between;
    }
    .tree-content { flex: 1; overflow-y: auto; padding: 10px; }

    .folder-item {
      display: flex; align-items: center; padding: 10px 12px;
      border-radius: 6px; cursor: pointer; color: #64748B; font-size: 0.85rem; font-weight: 600;
      margin-bottom: 4px;
    }
    .folder-item:hover { background: #F1F5F9; color: var(--smart-dark); }
    .folder-item.active { background: #E0F2FE; color: var(--smart-blue); }
    .folder-item i { margin-right: 10px; color: #CBD5E1; }
    .folder-item.active i { color: var(--smart-blue); }

    /* Grid View */
    .grid-panel {
      background: white; border-radius: 12px; border: 1px solid var(--smart-gray-200);
      display: flex; flex-direction: column; overflow: hidden;
    }
    .grid-header {
      padding: 16px 24px; border-bottom: 1px solid var(--smart-gray-200);
      display: flex; justify-content: space-between; align-items: center;
    }
    .grid-content { flex: 1; overflow-y: auto; padding: 24px; background: #F8FAFC; }

    .doc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 20px; }
    .doc-card {
      background: white; border: 1px solid var(--smart-gray-200); border-radius: 8px;
      padding: 16px; position: relative; cursor: pointer; display: flex; flex-direction: column;
    }
    .doc-card:hover { border-color: var(--smart-blue); box-shadow: 0 4px 12px rgba(31, 153, 216, 0.1); }
    .doc-icon { font-size: 2rem; margin-bottom: 12px; color: var(--smart-charcoal); }
    .doc-title { font-weight: 700; font-size: 0.85rem; margin-bottom: 4px; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .doc-meta { font-size: 0.7rem; color: #94A3B8; margin-bottom: 8px; }
    .doc-id-badge { font-family: var(--font-mono); font-size: 0.7rem; background: #334155; color: white; padding: 2px 6px; border-radius: 4px; display: inline-block; margin-bottom: 8px; }
    .doc-badges { display: flex; gap: 4px; margin-top: auto; }
    .ver-badge { font-size: 0.65rem; background: #F1F5F9; padding: 2px 6px; border-radius: 4px; font-weight: 700; color: #64748B; }

    /* Security Overlay */
    .security-overlay {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      height: 100%; text-align: center; color: #64748B; opacity: 0.7;
    }

    /* =======================================================================
       TABLES & STATUS
       ======================================================================= */
    .smart-table { width: 100%; border-collapse: collapse; }
    .smart-table th {
      text-align: left; padding: 12px 16px; background: #F8FAFC;
      font-size: 0.75rem; font-weight: 700; text-transform: uppercase;
      color: #64748B; border-bottom: 1px solid var(--smart-gray-200);
    }
    .smart-table td {
      padding: 12px 16px; vertical-align: middle; border-bottom: 1px solid var(--smart-gray-100);
      font-size: 0.85rem; color: #334155;
    }
    .smart-table tr:hover { background: #FAFAFA; }

    .status-pill {
      display: inline-flex; align-items: center; padding: 2px 8px;
      border-radius: 99px; font-size: 0.65rem; font-weight: 700; text-transform: uppercase;
    }
    .status-verified { background: var(--status-verified-bg); color: var(--status-verified-text); }
    .status-pending  { background: var(--status-pending-bg);  color: var(--status-pending-text); }
    .status-missing  { background: var(--status-missing-bg);  color: var(--status-missing-text); }

    /* =======================================================================
       UPLOAD MODAL / PREVIEW
       ======================================================================= */
    .modal-custom { width: 600px; max-width: 95vw; }
    .form-label { font-size: 0.75rem; font-weight: 700; color: var(--smart-dark); margin-bottom: 6px; }
    .smart-input {
      width: 100%; padding: 8px 12px; font-size: 0.9rem; border: 1px solid #CBD5E1;
      border-radius: 6px; background: #fff; color: var(--smart-charcoal);
    }
    .smart-input:focus { outline: none; border-color: var(--smart-blue); box-shadow: 0 0 0 3px rgba(31, 153, 216, 0.1); }

    .upload-zone {
      border: 2px dashed #CBD5E1; border-radius: 8px; padding: 30px;
      text-align: center; color: #94A3B8; cursor: pointer; transition: 0.2s;
      background: #F8FAFC;
    }
    .upload-zone:hover { border-color: var(--smart-blue); background: #F0F9FF; color: var(--smart-blue); }

    .offcanvas-end { width: 500px; }
    .preview-meta-row { display: flex; justify-content: space-between; border-bottom: 1px solid #f0f0f0; padding: 8px 0; font-size: 0.85rem; }
    .meta-label { color: #64748B; font-weight: 600; }
    .meta-val { font-weight: 700; color: var(--smart-charcoal); text-align: right; }

    .toast-container { position: fixed; top: 20px; right: 20px; z-index: 3000; }
  </style>
</head>
<body>

  <!-- =========================
       SIDEBAR (FROM index.php)
       ========================= -->
  <nav class="sidebar">
    <div class="sidebar-header">
      <a href="#" class="brand-logo"><i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span></a>
    </div>

    <div class="sidebar-menu accordion" id="adminMenu">
      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu1">
          <span><i class="fa-solid fa-shield-halved category-icon"></i> System & Governance</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu1" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="index.php" class="sub-link">Dashboard</a>
            <a href="user-role-management.php" class="sub-link">User & Role (IAM)</a>
           
          </div>
        </div>
      </div>

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu2">
          <span><i class="fa-solid fa-users category-icon"></i> Workforce & Org</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu2" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="employee-master.php" class="sub-link">Employee Master</a>
            <a href="attendance-logs.php" class="sub-link">Attendance Logs</a>
            <a href="payroll-management.php" class="sub-link">Payroll Management</a>
          </div>
        </div>
      </div>

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu3">
          <span><i class="fa-solid fa-database category-icon"></i> Master Data</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu3" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="client-master-registry.php" class="sub-link">Client Master</a>
            <a href="supplier-master-registry.php" class="sub-link">Supplier Master</a>
            <a href="financial-dictionary.php" class="sub-link">Financial Dictionary</a>
          </div>
        </div>
      </div>

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu4">
          <span><i class="fa-solid fa-hand-holding-dollar category-icon"></i> Sales & Intake</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu4" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="smart-quote-intake.php" class="sub-link">Smart Quote Intake</a>
            <a href="#" class="sub-link">Contact Us Intake</a>
            <a href="#" class="sub-link">Partnership Intake</a>
            <a href="#" class="sub-link">Campaign Register</a>
            <a href="#" class="sub-link">Sales Pipeline</a>
            
            <a href="#" class="sub-link">Extra Charges Sim.</a>
          </div>
        </div>
      </div>

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu5">
          <span><i class="fa-solid fa-ship category-icon"></i> Operations Exec</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu5" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="operations-registry.php" class="sub-link">Ops File Registry</a>
            <a href="#" class="sub-link">Milestone Tracking</a>
            <a href="#" class="sub-link">Transit Orders</a>
            <a href="#" class="sub-link">Delivery / POD</a>
          </div>
        </div>
      </div>

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu6">
          <span><i class="fa-solid fa-file-invoice-dollar category-icon"></i> Finance & Billing</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu6" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="#" class="sub-link">Costing Module</a>
            <a href="#" class="sub-link">Proforma / Advance</a>
            <a href="#" class="sub-link">Final Invoice</a>
            <a href="#" class="sub-link">Collections</a>
            <a href="#" class="sub-link">Cash Requests</a>
            <a href="#" class="sub-link">Expenditure Journal</a>
            <a href="#" class="sub-link">Cost Exposure</a>
          </div>
        </div>
      </div>

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu7" aria-expanded="true">
          <span><i class="fa-solid fa-chart-pie category-icon"></i> Reports & Docs</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu7" class="accordion-collapse collapse show" data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="documents-vault.php" class="sub-link active">Document Vault</a>
            <a href="#" class="sub-link">Dashboards & KPIs</a>
            <a href="#" class="sub-link">Exports (Accounting)</a>
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

  <!-- =========================
       TOP NAVBAR (FROM index.php)
       ========================= -->
       
  <div class="top-navbar">
    <?php $canSim = in_array($role, ['ADMIN','MANAGEMENT'], true); ?>
        <?php if ($canSim): ?>
        <div class="d-flex align-items-center gap-2">
            <small class="text-muted fw-bold">View as:</small>
            <select id="roleSwitcher" class="form-select form-select-sm" style="width: 160px;">
            <option value="MD">Management (View All)</option>
            <option value="FIN">Finance (Verify/View)</option>
            <option value="REQ">Ops Staff (Upload Only)</option>
            </select>
        </div>
        <?php endif; ?>

    <div>
      <h5 class="mb-0 fw-bold text-dark">Document Vault</h5>
      <small class="text-muted" style="font-size: 0.7rem;">IMMUTABLE STORAGE & COMPLIANCE</small>
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

  <!-- =========================
       MAIN CONTENT
       ========================= -->
  <div class="main-content px-4 pb-5">
    <div class="vault-wrap">

      <div class="row pt-4 mb-3">
        <div class="col-12">
          <div class="welcome-card d-flex justify-content-between align-items-center">
            <div>
              <h2 class="fw-bold mb-1"><?php echo e($greeting); ?>, <?php echo e($firstName); ?>!</h2>
              <p class="mb-0 opacity-75">Secure storage and evidence controls are available below.</p>
            </div>
            <div class="text-end" style="min-width: 220px;">
              <div class="mb-1 text-uppercase text-white-50" style="font-size: 0.7rem; font-weight: 800;">Compliance Monitor</div>
              <div class="d-flex align-items-center justify-content-end gap-2">
                <i class="fa-solid fa-vault text-white fs-5"></i>
                <span class="fw-bold fs-5">VAULT</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ===== Existing Document Vault UI (unchanged content) ===== -->
      <div id="view-dashboard">
        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-icon bg-success bg-opacity-10 text-success"><i class="fa-solid fa-shield-check"></i></div>
            <div class="kpi-content">
              <div class="kpi-label">Compliance Rate</div>
              <div class="kpi-number text-success" id="kpi-compliance">--%</div>
            </div>
          </div>
          <div class="kpi-card">
            <div class="kpi-icon bg-warning bg-opacity-10 text-warning"><i class="fa-solid fa-glasses"></i></div>
            <div class="kpi-content">
              <div class="kpi-label">Pending Verification</div>
              <div class="kpi-number text-warning" id="kpi-verify">--</div>
            </div>
          </div>
          <div class="kpi-card">
            <div class="kpi-icon bg-primary bg-opacity-10 text-primary"><i class="fa-solid fa-file-contract"></i></div>
            <div class="kpi-content">
              <div class="kpi-label">Total Documents</div>
              <div class="kpi-number" id="kpi-total">--</div>
            </div>
          </div>
          <div class="kpi-card kpi-action-card" onclick="switchView('COMPLIANCE')">
            <div class="kpi-icon"><i class="fa-solid fa-file-circle-exclamation"></i></div>
            <div class="kpi-content">
              <div class="kpi-label fw-bold">Action Required</div>
              <div class="kpi-number" id="kpi-missing">--</div>
              <div class="small text-danger fw-bold">Missing Evidence</div>
            </div>
            <i class="fa-solid fa-chevron-right kpi-action-arrow"></i>
          </div>
        </div>

        <div class="explorer-layout">
          <div class="tree-panel">
            <div class="tree-header">
              <div class="btn-group w-100">
                <input type="radio" class="btn-check" name="treeMode" id="tree-ops" checked onclick="renderTree('OPS')">
                <label class="btn btn-sm btn-outline-secondary fw-bold" for="tree-ops">Operations</label>
                <input type="radio" class="btn-check" name="treeMode" id="tree-ovh" onclick="renderTree('OVH')">
                <label class="btn btn-sm btn-outline-secondary fw-bold" for="tree-ovh">Overhead</label>
              </div>
            </div>
            <div class="tree-content" id="treeContainer"></div>
          </div>

          <div class="grid-panel">
            <div class="grid-header">
              <div class="d-flex align-items-center gap-2">
                <h6 class="m-0 fw-bold text-dark" id="currentFolderTitle">Select a Folder...</h6>
                <span class="badge bg-light text-dark border" id="fileCountBadge">0 files</span>
              </div>
              <div class="d-flex gap-2">
                <button class="btn btn-white border btn-sm fw-bold" onclick="refreshGrid()"><i class="fa-solid fa-rotate-right"></i></button>
                <button class="btn btn-primary btn-sm fw-bold px-3 shadow-sm" onclick="openUploadModal()">
                  <i class="fa-solid fa-cloud-arrow-up me-2"></i> Upload
                </button>
              </div>
            </div>
            <div class="grid-content" id="gridContainer"></div>
          </div>
        </div>
      </div>

      <div id="view-compliance" class="d-none">
        <div class="d-flex justify-content-between align-items-center mb-4">
          <div>
            <h4 class="fw-bold font-heading text-danger mb-1"><i class="fa-solid fa-triangle-exclamation me-2"></i>Missing Evidence Registry</h4>
            <p class="text-muted mb-0">Approved/Disbursed requests contain lines requiring proof (Receipts/Invoices). Files cannot be closed until resolved.</p>
          </div>
          <button class="btn btn-light border fw-bold" onclick="switchView('DASHBOARD')"><i class="fa-solid fa-arrow-left me-2"></i>Back to Vault</button>
        </div>

        <div class="card-custom p-0 overflow-hidden border bg-white rounded-3 shadow-sm">
          <table class="smart-table">
            <thead>
              <tr>
                <th>Related Request</th>
                <th>Context (File)</th>
                <th>Line Code</th>
                <th>Description</th>
                <th>Debt Age</th>
                <th class="text-end">Action</th>
              </tr>
            </thead>
            <tbody id="complianceBody"></tbody>
          </table>
        </div>
      </div>

    </div>
  </div>

  <!-- Upload Modal -->
  <div class="modal fade" id="uploadModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered modal-custom">
      <div class="modal-content">
        <div class="modal-header">
          <h6 class="fw-bold m-0"><i class="fa-solid fa-cloud-arrow-up me-2 text-primary"></i>Secure Upload</h6>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body p-4">
          <form id="uploadForm">
            <div id="uploadResolveBanner" class="alert alert-warning border-warning d-flex align-items-center d-none mb-3">
              <i class="fa-solid fa-link me-2"></i>
              <div class="small fw-bold">Resolving Missing Evidence: <span id="resolveTargetText"></span></div>
            </div>

            <div class="mb-3">
              <label class="form-label">1. Context & Linkage</label>
              <div class="row g-2 mb-2">
                <div class="col-4">
                  <select class="smart-input fw-bold" id="upContext" onchange="toggleUploadContext()">
                    <option value="OPS">Operations File</option>
                    <option value="OVH">Overhead</option>
                  </select>
                </div>
                <div class="col-8">
                  <select class="smart-input" id="upFileRef">
                    <option value="">Select Target File...</option>
                  </select>
                </div>
              </div>
            </div>

            <div class="row g-2 mb-3">
              <div class="col-6">
                <label class="form-label">2. Document Type</label>
                <select class="smart-input" id="upDocType">
                  <option value="INVOICE">Supplier Invoice</option>
                  <option value="RECEIPT">Payment Receipt</option>
                  <option value="BL">Bill of Lading</option>
                  <option value="POD">Proof of Delivery</option>
                  <option value="CUSTOMS">Customs Declaration</option>
                  <option value="OTHER">Other Support</option>
                </select>
              </div>
              <div class="col-6">
                <label class="form-label">3. Doc Reference #</label>
                <input type="text" class="smart-input" id="upDocRef" placeholder="e.g. INV-2024-001">
              </div>
            </div>

            <div class="mb-3 p-2 bg-light border rounded">
              <label class="form-label mb-1">Link to Request (Optional)</label>
              <input type="text" class="smart-input" id="upLinkPR" placeholder="SLAS-PR-XXXX (If supporting a request)">
            </div>

            <div class="mb-3">
              <label class="form-label">4. Physical Archive Location (Audit)</label>
              <input type="text" class="smart-input" id="upPhysLoc" placeholder="e.g. Binder A-12, Shelf 3">
            </div>

            <div class="upload-zone" id="dropZone" onclick="document.getElementById('fileInput').click()">
              <i class="fa-solid fa-file-pdf fs-1 mb-2"></i>
              <div>Click to Select or Drag File Here</div>
              <div class="small text-muted mt-1">PDF, JPG, PNG (Max 10MB)</div>
              <input type="file" id="fileInput" hidden>
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary fw-bold w-100" onclick="processUpload()">Secure Upload & Version</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Preview Drawer -->
  <div class="offcanvas offcanvas-end" tabindex="-1" id="previewDrawer">
    <div class="offcanvas-header bg-light border-bottom">
      <h6 class="offcanvas-title fw-bold font-mono" id="prevTitle">DOC-VIEWER</h6>
      <button type="button" class="btn-close" data-bs-dismiss="offcanvas"></button>
    </div>
    <div class="offcanvas-body p-0 d-flex flex-column">
      <div class="bg-dark d-flex align-items-center justify-content-center text-white" style="height: 300px;">
        <div class="text-center">
          <i class="fa-solid fa-file-pdf fs-1 mb-3"></i>
          <div class="small opacity-50">SECURE PREVIEW MODE</div>
          <div class="fw-bold" id="prevFilename">filename.pdf</div>
        </div>
      </div>

      <div class="p-4 flex-grow-1 overflow-y-auto">
        <div class="d-flex justify-content-between align-items-center mb-3">
          <span class="badge bg-dark text-white font-mono" id="prevDocID">SLAS-DOC-0000</span>
          <span class="badge" id="prevStatusBadge">PENDING</span>
        </div>

        <div class="preview-meta-row">
          <span class="meta-label">Uploaded By</span>
          <span class="meta-val" id="prevUploader">User</span>
        </div>
        <div class="preview-meta-row">
          <span class="meta-label">Upload Date</span>
          <span class="meta-val" id="prevDate">---</span>
        </div>
        <div class="preview-meta-row">
          <span class="meta-label">Doc Reference</span>
          <span class="meta-val font-mono" id="prevDocRef">---</span>
        </div>
        <div class="preview-meta-row">
          <span class="meta-label">Physical Loc</span>
          <span class="meta-val text-primary" id="prevPhysLoc">---</span>
        </div>
        <div class="preview-meta-row">
          <span class="meta-label">Linked PR</span>
          <span class="meta-val" id="prevLinkedPR">None</span>
        </div>

        <div class="mt-4">
          <h6 class="fw-bold small text-muted text-uppercase mb-2">Version History</h6>
          <ul class="list-group list-group-flush small" id="prevHistory"></ul>
        </div>
      </div>

      <div class="p-3 border-top bg-light" id="previewActions"></div>
    </div>
  </div>

  <!-- Manual Milestone Modal -->
  <div class="modal fade" id="manualMilestoneModal" tabindex="-1">
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header bg-success text-white">
          <h5 class="fw-bold m-0"><i class="fa-solid fa-check-circle me-2"></i>Upload Successful</h5>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body p-4 text-center">
          <p class="mb-3">The document has been securely stored in the Vault.</p>
          <div class="bg-light border rounded p-3 mb-3">
            <div class="text-muted small text-uppercase fw-bold">System ID</div>
            <div class="fs-4 fw-black font-mono text-dark" id="generatedDocID">SLAS-DOC-XXXX</div>
          </div>
          <div class="alert alert-warning text-start small">
            <i class="fa-solid fa-triangle-exclamation me-2"></i>
            <strong>Action Required:</strong> Automation is disabled. Please copy the System ID above and manually update the Milestone or Costing Log in the Operations Dashboard.
          </div>
        </div>
        <div class="modal-footer justify-content-center">
          <button class="btn btn-outline-dark fw-bold" onclick="navigator.clipboard.writeText(document.getElementById('generatedDocID').innerText)">Copy ID</button>
          <button class="btn btn-success fw-bold" data-bs-dismiss="modal">Acknowledge</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Toast -->
  <div class="toast-container">
    <div id="liveToast" class="toast align-items-center text-white bg-dark border-0 shadow-lg" role="alert" aria-live="assertive" aria-atomic="true">
      <div class="d-flex">
        <div class="toast-body fw-bold" id="toastMessage">Action Successful</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

  <script>
  // Guard: if admin.js doesn't define toggleClock, prevent crash.
  if (typeof toggleClock !== 'function') {
    function toggleClock(){ /* noop */ }
  }

  // Keep topbar clock alive regardless of admin.js clock implementation.
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

  /**
   * SMART LS VAULT ENGINE v2.1
   * Adds: Role Toggle + Correct RBAC (REQ upload-only, FIN verify/view, MD view all)
   */

  // --- 1. MOCK DATABASES ---
  const CURRENT_USER = { role: 'REQ', name: 'Ops Staff', id: 'SL-005' }; // default effective role
  const ROLE_LABELS = { 'REQ': 'OPS STAFF', 'FIN': 'FINANCE', 'MD': 'MANAGEMENT' };

  // Financial Dictionary (mock)
  const FIN_DICT = [
    { code: "53001", desc: "Caution", requiresProof: true },
    { code: "53002", desc: "Handling", requiresProof: true },
    { code: "53003", desc: "Transport", requiresProof: false },
    { code: "53004", desc: "Customs Eval", requiresProof: true }
  ];

  // Ops Files (mock)
  const OPS_FILES = [
    { id: "SLAS-FR-004", client: "TOTALENERGIES", status: "ACTIVE" },
    { id: "SLAS-FR-005", client: "MAERSK CAMEROON", status: "ACTIVE" },
    { id: "SLAS-FR-006", client: "CIMENCAM", status: "CLOSED" }
  ];

  // Documents (mock)
  let DOCUMENTS = [
    {
      id: "SLAS-DOC-1001", fileRef: "SLAS-FR-004", type: "BL", docRef: "ILCUBO123",
      version: 1, uploader: "System", date: "2025-10-23", linkedPR: "",
      physLoc: "Binder A-1", status: "VERIFIED", history: ["Initial Upload"]
    },
    {
      id: "SLAS-DOC-1002", fileRef: "SLAS-FR-004", type: "INVOICE", docRef: "INV-992",
      version: 2, uploader: "Joel EFALA", date: "2026-01-02", linkedPR: "SLAS-PR-0040",
      physLoc: "Binder A-1", status: "PENDING", history: ["v1 Uploaded", "v2 Correction"]
    }
  ];

  // Approved/Disbursed requests (mock)
  const APPROVED_REQUESTS = [
    {
      id: "SLAS-PR-0040", file: "SLAS-FR-004", beneficiary: "Customs", date: "2026-01-01",
      lines: [
        { code: "53001", desc: "Caution" },
        { code: "53003", desc: "Transport" }
      ]
    },
    {
      id: "SLAS-PR-0042", file: "SLAS-FR-005", beneficiary: "Maersk", date: "2026-01-03",
      lines: [
        { code: "53002", desc: "Handling" }
      ]
    }
  ];

  let MISSING_EVIDENCE = [];

  // --- 2. STATE ---
  let currentFolder = "SLAS-FR-004";
  let treeMode = "OPS"; // OPS | OVH
  let currentOvhFolder = "Legal"; // default for overhead
  let currentView = "DASHBOARD"; // DASHBOARD | COMPLIANCE

  // --- 3. INIT ---
  function bootVault(){
  initRoleToggle();
  calculateMissingEvidence();
  renderTree('OPS');
  renderGrid();
  updateKPIs();
  initUploadSelects();
  updateRoleBadge();
}

// Robust boot: runs whether DOMContentLoaded already fired or not
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootVault);
} else {
  bootVault();
}


  // --- ROLE TOGGLE (View As) ---
  function initRoleToggle() {
    const roleSwitcher = document.getElementById('roleSwitcher');
    if (!roleSwitcher) return;

    // default role based on existing CURRENT_USER.role
    roleSwitcher.value = CURRENT_USER.role;

    // hook change
    roleSwitcher.addEventListener('change', (e) => {
      switchRole(e.target.value);
    });
  }

  function switchRole(role) {
    role = String(role || '').toUpperCase();
    if (!['REQ','FIN','MD'].includes(role)) role = 'REQ';

    CURRENT_USER.role = role;
    CURRENT_USER.name = role === 'REQ' ? 'Ops Staff' : (role === 'FIN' ? 'Finance User' : 'Management User');

    updateRoleBadge();

    // Re-render view consistently with new RBAC
    if (currentView === 'COMPLIANCE') {
      // If you want Ops Staff to still see Missing Evidence list, keep it.
      // If you want Ops Staff restricted from compliance too, uncomment below:
      // if (CURRENT_USER.role === 'REQ') currentView = 'DASHBOARD';
      renderComplianceTable();
    }

    renderGrid();
    updateKPIs();
    showToast(`Role Switched: ${ROLE_LABELS[CURRENT_USER.role]}. Access Policy Applied.`);
  }

  function updateRoleBadge() {
    const badge = document.getElementById('currentRoleBadge');
    if (badge) badge.innerText = `LOGGED AS: ${ROLE_LABELS[CURRENT_USER.role] || 'OPS STAFF'}`;
  }

  // --- 4. COMPLIANCE CHECK ---
  function calculateMissingEvidence() {
    MISSING_EVIDENCE = [];

    APPROVED_REQUESTS.forEach(pr => {
      pr.lines.forEach(line => {
        const dictEntry = FIN_DICT.find(d => d.code === line.code);

        if (dictEntry && dictEntry.requiresProof) {
          const exists = DOCUMENTS.find(d =>
            (d.linkedPR === pr.id) ||
            (d.fileRef === pr.file && d.type === 'RECEIPT' && d.status === 'VERIFIED')
          );

          if (!exists) {
            MISSING_EVIDENCE.push({
              prId: pr.id,
              beneficiary: pr.beneficiary,
              file: pr.file,
              code: line.code,
              desc: line.desc,
              age: Math.floor((new Date() - new Date(pr.date)) / (1000*60*60*24)) + " Days"
            });
          }
        }
      });
    });
  }

  // --- 5. NAVIGATION & VIEWS ---
  function switchView(viewName) {
    currentView = viewName;

    document.getElementById('view-dashboard').classList.add('d-none');
    document.getElementById('view-compliance').classList.add('d-none');

    if (viewName === 'DASHBOARD') document.getElementById('view-dashboard').classList.remove('d-none');
    if (viewName === 'COMPLIANCE') {
      document.getElementById('view-compliance').classList.remove('d-none');
      renderComplianceTable();
    }
  }

  // --- 6. TREE RENDERER ---
  function renderTree(mode) {
    treeMode = mode;
    const container = document.getElementById('treeContainer');
    container.innerHTML = '';

    if (mode === 'OPS') {
      OPS_FILES.forEach(f => {
        const el = document.createElement('div');
        el.className = `folder-item ${currentFolder === f.id ? 'active' : ''}`;
        el.onclick = (ev) => selectFolder(ev, f.id, `${f.id} - ${f.client}`);
        el.innerHTML = `<i class="fa-solid fa-folder"></i> ${f.id} <span class="text-xs ms-auto text-muted">${f.client}</span>`;
        container.appendChild(el);
      });
    } else {
      ['Legal', 'HR', 'Finance', 'General'].forEach(c => {
        const el = document.createElement('div');
        el.className = `folder-item ${currentOvhFolder === c ? 'active' : ''}`;
        el.onclick = (ev) => selectOverheadFolder(ev, c, `${c} Documents`);
        el.innerHTML = `<i class="fa-solid fa-folder-open"></i> ${c}`;
        container.appendChild(el);
      });
    }
  }

  function selectFolder(ev, id, title) {
    currentFolder = id;
    document.getElementById('currentFolderTitle').innerText = title;
    document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('active'));
    if (ev && ev.currentTarget) ev.currentTarget.classList.add('active');
    renderGrid();
  }

  function selectOverheadFolder(ev, folder, title) {
    currentOvhFolder = folder;
    document.getElementById('currentFolderTitle').innerText = title;
    document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('active'));
    if (ev && ev.currentTarget) ev.currentTarget.classList.add('active');
    renderGrid();
  }

  // --- 7. GRID RENDERER (RBAC enforced) ---
  function renderGrid() {
    const container = document.getElementById('gridContainer');
    container.innerHTML = '';

    // RULE: OPS STAFF = UPLOAD ONLY (no viewing)
    if (CURRENT_USER.role === 'REQ') {
      container.innerHTML = `
        <div class="security-overlay">
          <i class="fa-solid fa-lock fs-1 mb-3"></i>
          <h4>Access Restricted</h4>
          <p>Operations Staff are authorized to <strong>UPLOAD ONLY</strong>.<br>You cannot view vault contents.</p>
          <button class="btn btn-primary fw-bold mt-3" onclick="openUploadModal()">
            <i class="fa-solid fa-cloud-arrow-up me-2"></i> Upload New Document
          </button>
        </div>
      `;
      document.getElementById('fileCountBadge').innerText = "Hidden";
      return;
    }

    // Management/Finance can view
    let docs = [];

    // OPS tree uses fileRef, OVH uses folder name
    if (treeMode === 'OPS') {
      docs = DOCUMENTS.filter(d => d.fileRef === currentFolder);
    } else {
      // If you later add overhead docs into DOCUMENTS, tag them with fileRef=folder or add a separate context field.
      // For now: no docs
      docs = DOCUMENTS.filter(d => d.fileRef === currentOvhFolder);
    }

    document.getElementById('fileCountBadge').innerText = `${docs.length} files`;

    if (docs.length === 0) {
      container.innerHTML = `<div class="text-center text-muted mt-5"><i class="fa-regular fa-folder-open fs-1 mb-2"></i><p>No documents found in this folder.</p></div>`;
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'doc-grid';

    docs.forEach(d => {
      const card = document.createElement('div');
      card.className = 'doc-card';
      card.onclick = () => openPreview(d);

      const iconClass = d.type === 'BL' ? 'fa-ship text-dark' : 'fa-file-invoice-dollar text-success';
      const statusClass = d.status === 'VERIFIED' ? 'status-verified' : 'status-pending';

      card.innerHTML = `
        <div class="doc-icon"><i class="fa-solid ${iconClass}"></i></div>
        <div class="doc-title" title="${d.type} - ${d.docRef}">${d.type} - ${d.docRef}</div>
        <div class="doc-id-badge">${d.id}</div>
        <div class="doc-meta">v${d.version}.0 • ${d.date}</div>
        <div class="doc-badges">
          <span class="ver-badge">${d.uploader}</span>
          <span class="status-pill ${statusClass} ms-auto">${d.status}</span>
        </div>
      `;
      grid.appendChild(card);
    });

    container.appendChild(grid);
  }

  // --- 8. UPLOAD LOGIC ---
  function initUploadSelects() {
    const sel = document.getElementById('upFileRef');
    if (!sel) return;

    sel.innerHTML = '';
    OPS_FILES.forEach(f => {
      sel.innerHTML += `<option value="${f.id}">${f.id} - ${f.client}</option>`;
    });
  }

  function toggleUploadContext() {
    const ctx = document.getElementById('upContext').value;
    const sel = document.getElementById('upFileRef');
    sel.innerHTML = '';

    if (ctx === 'OPS') {
      OPS_FILES.forEach(f => sel.innerHTML += `<option value="${f.id}">${f.id} - ${f.client}</option>`);
    } else {
      ['Legal', 'HR', 'Finance', 'General'].forEach(c => sel.innerHTML += `<option value="${c}">${c}</option>`);
    }
  }

  function openUploadModal(prefillPR = null, prefillFile = null) {
    const modal = new bootstrap.Modal(document.getElementById('uploadModal'));
    document.getElementById('uploadForm').reset();

    // prefill current folder if available
    const ctxSel = document.getElementById('upContext');
    if (ctxSel) {
      ctxSel.value = (treeMode === 'OPS') ? 'OPS' : 'OVH';
      toggleUploadContext();
      if (treeMode === 'OPS') {
        document.getElementById('upFileRef').value = currentFolder;
      } else {
        document.getElementById('upFileRef').value = currentOvhFolder;
      }
    }

    if (prefillPR) {
      document.getElementById('uploadResolveBanner').classList.remove('d-none');
      document.getElementById('resolveTargetText').innerText = prefillPR;
      document.getElementById('upLinkPR').value = prefillPR;
      if (prefillFile) document.getElementById('upFileRef').value = prefillFile;
      document.getElementById('upDocType').value = 'RECEIPT';
    } else {
      document.getElementById('uploadResolveBanner').classList.add('d-none');
    }

    modal.show();
  }

  function processUpload() {
    const docType  = document.getElementById('upDocType').value;
    const fileRef  = document.getElementById('upFileRef').value;
    const linkedPR = document.getElementById('upLinkPR').value;
    const docRef   = document.getElementById('upDocRef').value || "No-Ref";

    // versioning
    const existing = DOCUMENTS.find(d => d.fileRef === fileRef && d.type === docType && d.docRef === docRef && d.status !== 'ARCHIVED');
    let version = 1;
    if (existing) {
      version = existing.version + 1;
      existing.status = "ARCHIVED";
      existing.history.push(`Archived due to new version v${version}`);
    }

    const newID = `SLAS-DOC-${Math.floor(2000 + Math.random() * 1000)}`;

    const newDoc = {
      id: newID,
      fileRef: fileRef,
      type: docType,
      docRef: docRef,
      version: version,
      uploader: CURRENT_USER.name,
      date: new Date().toISOString().split('T')[0],
      physLoc: document.getElementById('upPhysLoc').value,
      linkedPR: linkedPR,
      status: "PENDING",
      history: [`Uploaded ${new Date().toLocaleString()}`]
    };

    DOCUMENTS.push(newDoc);

    // re-evaluate compliance immediately
    calculateMissingEvidence();
    updateKPIs();

    // If user can view, refresh grid; if REQ, keep restricted screen
    renderGrid();

    // Hide Upload Modal
    bootstrap.Modal.getInstance(document.getElementById('uploadModal')).hide();

    // Show Manual Milestone modal
    document.getElementById('generatedDocID').innerText = newID;
    new bootstrap.Modal(document.getElementById('manualMilestoneModal')).show();
  }

  // --- 9. PREVIEW & VERIFY (FIN only) ---
  function openPreview(doc) {
    // RBAC: REQ cannot view (but grid already blocks). Keep safe anyway.
    if (CURRENT_USER.role === 'REQ') {
      showToast('Upload-only role cannot view documents.');
      return;
    }

    const drawer = new bootstrap.Offcanvas(document.getElementById('previewDrawer'));

    document.getElementById('prevDocID').innerText = doc.id;
    document.getElementById('prevFilename').innerText = `${doc.type}_${doc.docRef}.pdf`;
    document.getElementById('prevUploader').innerText = doc.uploader;
    document.getElementById('prevDate').innerText = doc.date;
    document.getElementById('prevDocRef').innerText = doc.docRef;
    document.getElementById('prevPhysLoc').innerText = doc.physLoc;
    document.getElementById('prevLinkedPR').innerText = doc.linkedPR || "None";

    const badge = document.getElementById('prevStatusBadge');
    badge.innerText = doc.status;
    badge.className = `badge ${doc.status === 'VERIFIED' ? 'bg-success' : 'bg-warning text-dark'}`;

    const actions = document.getElementById('previewActions');
    actions.innerHTML = '';

    // FIN can verify pending docs; MD can view only
    if (CURRENT_USER.role === 'FIN' && doc.status === 'PENDING') {
      actions.innerHTML = `
        <button class="btn btn-success fw-bold w-100" onclick="verifyDoc('${doc.id}')">
          <i class="fa-solid fa-check-circle me-2"></i> Verify Authenticity
        </button>
      `;
    } else if (CURRENT_USER.role === 'MD') {
      actions.innerHTML = `<div class="text-center text-muted fw-bold small">Management: View Only (No Verification)</div>`;
    } else if (doc.status === 'VERIFIED') {
      actions.innerHTML = `<div class="text-center text-success fw-bold small"><i class="fa-solid fa-lock me-1"></i> Document Verified & Locked</div>`;
    }

    drawer.show();
  }

  function verifyDoc(id) {
    // hard RBAC
    if (CURRENT_USER.role !== 'FIN') {
      showToast('Only Finance can verify documents.');
      return;
    }

    const doc = DOCUMENTS.find(d => d.id === id);
    if (doc) {
      doc.status = "VERIFIED";
      doc.history.push(`Verified by ${CURRENT_USER.name} on ${new Date().toLocaleString()}`);

      calculateMissingEvidence(); // verification can clear compliance items
      bootstrap.Offcanvas.getInstance(document.getElementById('previewDrawer')).hide();
      renderGrid();
      updateKPIs();
      showToast("Document Verified.");
    }
  }

  // --- 10. COMPLIANCE TABLE + KPIs ---
  function renderComplianceTable() {
    const tbody = document.getElementById('complianceBody');
    tbody.innerHTML = '';

    if (MISSING_EVIDENCE.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center py-5 text-success fw-bold">
            <i class="fa-solid fa-check-circle fs-1 mb-3"></i><br>
            100% Compliant. No missing evidence.
          </td>
        </tr>`;
      return;
    }

    MISSING_EVIDENCE.forEach(m => {
      tbody.innerHTML += `
        <tr>
          <td class="font-mono fw-bold text-primary">${m.prId}</td>
          <td>${m.file}</td>
          <td class="font-mono">${m.code}</td>
          <td>${m.desc}</td>
          <td class="fw-bold text-danger">${m.age}</td>
          <td class="text-end">
            <button class="btn btn-sm btn-outline-danger fw-bold shadow-sm"
              onclick="openUploadModal('${m.prId}', '${m.file}')">
              <i class="fa-solid fa-upload me-1"></i> Resolve
            </button>
          </td>
        </tr>
      `;
    });
  }

  function updateKPIs() {
    const missingEl = document.getElementById('kpi-missing');
    const verifyEl  = document.getElementById('kpi-verify');
    const totalEl   = document.getElementById('kpi-total');
    const compEl    = document.getElementById('kpi-compliance');

    if (missingEl) missingEl.innerText = MISSING_EVIDENCE.length;

    // nav badge safe update
    const navMissing = document.getElementById('navMissingCount');
    if (navMissing) navMissing.innerText = MISSING_EVIDENCE.length;

    if (verifyEl) verifyEl.innerText = DOCUMENTS.filter(d => d.status === 'PENDING').length;
    if (totalEl) totalEl.innerText = DOCUMENTS.filter(d => d.status !== 'ARCHIVED').length;

    // compliance: base it on required proofs vs missing
    // For demo: assume required = missing + satisfied
    const requiredCount = requiredProofCount();
    const compliant = requiredCount === 0 ? 100 : Math.round(((requiredCount - MISSING_EVIDENCE.length) / requiredCount) * 100);
    if (compEl) compEl.innerText = `${Math.max(0, Math.min(100, compliant))}%`;
  }

  function requiredProofCount() {
    // count required proof items from APPROVED_REQUESTS based on FIN_DICT.requiresProof
    let c = 0;
    APPROVED_REQUESTS.forEach(pr => {
      pr.lines.forEach(line => {
        const dictEntry = FIN_DICT.find(d => d.code === line.code);
        if (dictEntry && dictEntry.requiresProof) c++;
      });
    });
    return c;
  }

  function refreshGrid() {
    renderGrid();
    showToast("Vault Refreshed.");
  }

  function showToast(msg) {
    const msgEl = document.getElementById('toastMessage');
    if (msgEl) msgEl.innerText = msg;
    const toastEl = document.getElementById('liveToast');
    if (toastEl) new bootstrap.Toast(toastEl).show();
  }
</script>

</body>
</html>
