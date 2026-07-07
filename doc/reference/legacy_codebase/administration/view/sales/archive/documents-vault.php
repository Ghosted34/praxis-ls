<?php
/**
 * ==============================================================================
 * SMART LS ENTERPRISE - DOCUMENT VAULT MODULE (v4.4 - Stable)
 * ==============================================================================
 */

declare(strict_types=1);

// ------------------------------------------------------------------------------
// 1. ENVIRONMENT & SECURITY SETUP
// ------------------------------------------------------------------------------
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

// Strict Role Enforcement
require_role(['ADMIN','FINANCE','MANAGEMENT','OPERATIONS','SALES']);

// ------------------------------------------------------------------------------
// 2. USER CONTEXT & SESSION DATA
// ------------------------------------------------------------------------------
$employeeId = (string)($_SESSION['auth']['employee_id'] ?? '');
$userId     = (int)($_SESSION['auth']['user_id'] ?? 0);

if ($employeeId === '' || $userId <= 0) {
    header('Location: ../../api/auth/logout.php');
    exit;
}

// Database Connection
$conn = db();

// Fetch Authoritative User Profile (Original Logic Restored)
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

// ------------------------------------------------------------------------------
// 3. PRESENTATION LOGIC HELPERS
// ------------------------------------------------------------------------------
function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }

$fullName  = trim((string)($me['full_name'] ?? 'User'));
$firstName = trim(explode(' ', $fullName)[0] ?? 'User');
$role      = strtoupper((string)($me['role'] ?? ''));

// Role Display Mapping
$roleLabelMap = [
    'ADMIN'      => 'SYSTEM ADMIN',
    'FINANCE'    => 'FINANCE CONTROLLER',
    'SALES'      => 'SALES EXECUTIVE',
    'OPERATIONS' => 'OPS COORDINATOR',
    'MANAGEMENT' => 'DIRECTOR',
    'LEAD'       => 'TEAM LEAD',
];
$roleLabel = $roleLabelMap[$role] ?? ($role !== '' ? $role : 'USER');
$avatarName = urlencode($fullName);
$avatarUrl  = "https://ui-avatars.com/api/?name={$avatarName}&background=1F99D8&color=fff&size=128";

// Security Flags for UI Rendering
$canDownload = in_array($role, ['ADMIN','FINANCE','MANAGEMENT']);
$canValidate = in_array($role, ['ADMIN','FINANCE','MANAGEMENT']);
$isOpsUser   = ($role === 'OPERATIONS' || $role === 'REQ');

?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="ie=edge">
    <title>Secure Document Vault | Smart LS Enterprise</title>

    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&family=Inconsolata:wght@500;700&display=swap" rel="stylesheet">

    <style>
        /* ==========================================================================
           1. CORE DESIGN SYSTEM & VARIABLES
           ========================================================================== */
        :root {
            /* Brand Palette */
            --smart-blue: #1F99D8;
            --smart-dark: #055B83;
            --smart-orange: #EE7D04;
            --smart-charcoal: #231F20;
            
            /* UI Shades */
            --smart-bg: #F0F4F8;
            --smart-gray-50: #F8FAFC;
            --smart-gray-100: #F1F5F9;
            --smart-gray-200: #E2E8F0;
            --smart-gray-300: #CBD5E1;
            --smart-gray-400: #94A3B8;
            --smart-gray-800: #1E293B;
            
            /* Status Colors (Semantic) */
            --status-verified-bg: #DCFCE7; 
            --status-verified-text: #15803D;
            --status-pending-bg: #FFF7ED; 
            --status-pending-text: #C2410C;
            --status-missing-bg: #FEF2F2; 
            --status-missing-text: #B91C1C;
            --status-archived-bg: #F1F5F9; 
            --status-archived-text: #475569;

            /* Layout Dimensions */
            --sidebar-width: 280px;
            --header-height: 70px;
            
            /* Font Stacks */
            --font-body: 'Manrope', sans-serif;
            --font-heading: 'Montserrat', sans-serif;
            --font-mono: 'Inconsolata', monospace;
        }

        /* Base Resets */
        * { box-sizing: border-box; }
        body {
            font-family: var(--font-body);
            background-color: var(--smart-bg);
            color: var(--smart-charcoal);
            font-size: 0.9rem;
            line-height: 1.5;
            overflow: hidden; /* Prevent body scroll, use container scroll */
            height: 100vh;
        }

        /* Typography Helpers */
        h1, h2, h3, h4, h5, h6, .font-heading { font-family: var(--font-heading); }
        .font-mono { font-family: var(--font-mono); }
        .fw-black { font-weight: 800; }
        .text-xs { font-size: 0.75rem; }
        .text-orange { color: var(--smart-orange) !important; }
        .letter-spacing-1 { letter-spacing: 1px; }
        
        /* Transitions */
        a, button, .card, .nav-item, .folder-card { transition: all 0.2s ease-in-out; }

        /* ==========================================================================
           2. SIDEBAR NAVIGATION
           ========================================================================== */
        .sidebar {
            width: var(--sidebar-width);
            height: 100vh;
            position: fixed;
            top: 0;
            left: 0;
            background: #FFFFFF;
            border-right: 1px solid var(--smart-gray-200);
            z-index: 1050;
            display: flex;
            flex-direction: column;
            box-shadow: 2px 0 10px rgba(0,0,0,0.02);
        }

        .sidebar-header {
            height: var(--header-height);
            display: flex;
            align-items: center;
            padding: 0 24px;
            border-bottom: 1px solid var(--smart-gray-100);
        }

        .brand-logo {
            font-size: 1.1rem;
            font-weight: 800;
            color: var(--smart-charcoal);
            letter-spacing: -0.5px;
            text-decoration: none;
            display: flex;
            align-items: center;
        }

        .sidebar-menu { 
            overflow-y: auto; 
            flex-grow: 1; 
            padding: 10px 0; 
        }

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
            border-left: 3px solid transparent;
        }

        .menu-btn:hover, .menu-btn[aria-expanded="true"] {
            color: var(--smart-charcoal);
            background-color: #f0f7fa;
            border-left-color: var(--smart-charcoal);
        }

        .menu-btn i.category-icon { width: 20px; margin-right: 8px; color: #888; }
        .menu-btn:hover i.category-icon { color: var(--smart-charcoal); }

        .sub-link {
            display: block;
            padding: 8px 20px 8px 48px;
            font-size: 0.75rem;
            color: #666;
            text-decoration: none;
            font-weight: 500;
            line-height: 1.3;
        }

        .sub-link:hover { color: var(--smart-orange); background-color: #fff9f2; }
        .sub-link.active { color: var(--smart-orange); font-weight: 800; background-color: #fff9f2; }

        .sidebar-footer {
            border-top: 1px solid #f0f0f0;
            padding: 16px;
            background: #FAFAFA;
        }

        /* ==========================================================================
           3. TOP NAVBAR
           ========================================================================== */
        .top-navbar {
            height: var(--header-height);
            position: fixed;
            top: 0;
            right: 0;
            left: var(--sidebar-width);
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(12px);
            border-bottom: 1px solid var(--smart-gray-200);
            z-index: 1040;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 32px;
        }

        .clock-pill {
            background: #f1f5f9;
            padding: 6px 12px;
            border-radius: 30px;
            font-size: 0.85rem;
            font-weight: 600;
            color: var(--smart-dark);
            font-family: var(--font-mono);
            letter-spacing: 1px;
        }

        /* ==========================================================================
           4. MAIN CONTENT AREA & VAULT UI
           ========================================================================== */
        .main-content {
            margin-left: var(--sidebar-width);
            padding-top: var(--header-height);
            height: 100vh;
            width: calc(100% - var(--sidebar-width));
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .vault-container {
            padding: 24px;
            height: 100%;
            overflow-y: auto;
            background: var(--smart-bg);
        }

        /* KPI Cards */
        .kpi-row {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 20px;
            margin-bottom: 30px;
        }

        .kpi-card {
            background: #fff;
            border-radius: 12px;
            padding: 20px;
            border: 1px solid #e2e8f0;
            display: flex;
            align-items: center;
            gap: 15px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.02);
            position: relative;
            overflow: hidden;
        }

        .kpi-card:hover { transform: translateY(-2px); box-shadow: 0 8px 15px rgba(0,0,0,0.05); }

        .kpi-icon {
            width: 50px;
            height: 50px;
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.3rem;
        }

        .kpi-val { font-size: 1.6rem; font-weight: 800; line-height: 1.1; color: var(--smart-charcoal); }
        .kpi-lbl { font-size: 0.7rem; text-transform: uppercase; color: #64748b; font-weight: 700; letter-spacing: 0.5px; }

        /* Custom Tabs */
        .nav-tabs-custom { border-bottom: 2px solid #ddd; margin-bottom: 24px; }
        .nav-link-custom {
            border: none;
            background: transparent;
            padding: 12px 24px;
            font-weight: 700;
            color: #777;
            font-size: 0.95rem;
            position: relative;
        }
        .nav-link-custom:hover { color: var(--smart-blue); }
        .nav-link-custom.active { color: var(--smart-blue); }
        .nav-link-custom.active::after {
            content: '';
            position: absolute;
            bottom: -2px;
            left: 0;
            width: 100%;
            height: 3px;
            background: var(--smart-blue);
        }
        
        /* Specific Override for Missing Evidence & Action Tab */
        #tab-btn-missing.active { color: #DC2626; }
        #tab-btn-missing.active::after { background: #DC2626; }
        #tab-btn-action.active { color: var(--smart-orange); }
        #tab-btn-action.active::after { background: var(--smart-orange); }

        /* Folder Grid System */
        .folder-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
            gap: 24px;
        }

        .folder-card {
            background: #fff;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 24px;
            cursor: pointer;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            display: flex;
            flex-direction: column;
            align-items: flex-start;
        }

        .folder-card:hover {
            transform: translateY(-4px);
            border-color: var(--smart-blue);
            box-shadow: 0 12px 24px rgba(31, 153, 216, 0.12);
        }

        .folder-card .f-icon {
            font-size: 2.2rem;
            color: var(--smart-blue);
            margin-bottom: 16px;
            transition: transform 0.2s;
        }

        .folder-card:hover .f-icon { transform: scale(1.1); }
        .folder-card .f-title { font-weight: 800; font-size: 1rem; color: var(--smart-dark); margin-bottom: 4px; line-height: 1.3; }
        .folder-card .f-meta { font-size: 0.75rem; color: #94a3b8; font-weight: 600; }

        /* File List Table */
        .file-list-card {
            background: white;
            border-radius: 12px;
            border: 1px solid #e2e8f0;
            overflow: hidden;
            box-shadow: 0 4px 12px rgba(0,0,0,0.03);
        }

        .table-custom th {
            font-size: 0.75rem;
            text-transform: uppercase;
            color: #64748b;
            background: #F8FAFC;
            padding: 16px;
            font-weight: 700;
            border-bottom: 1px solid #e2e8f0;
        }

        .table-custom td {
            padding: 16px;
            vertical-align: middle;
            font-size: 0.9rem;
            color: #334155;
            border-bottom: 1px solid #f1f5f9;
        }

        .table-custom tr:last-child td { border-bottom: none; }
        .table-custom tr:hover { background-color: #FAFAFA; }

        /* Missing Evidence Badges */
        .debt-badge {
            padding: 4px 10px;
            border-radius: 6px;
            font-weight: 800;
            font-family: var(--font-mono);
            font-size: 0.8rem;
        }
        .debt-ok { background: #DCFCE7; color: #15803D; }
        .debt-bad { background: #FEE2E2; color: #B91C1C; }

        /* ==========================================================================
           5. UPLOAD WIZARD STYLES
           ========================================================================== */
        .wizard-steps {
            display: flex;
            margin-bottom: 24px;
            border-bottom: 1px solid #eee;
        }

        .step-indicator {
            flex: 1;
            padding: 12px;
            text-align: center;
            font-weight: 700;
            font-size: 0.85rem;
            color: #94A3B8;
            border-bottom: 3px solid transparent;
            cursor: default;
            transition: 0.2s;
        }

        .step-indicator.active { color: var(--smart-blue); border-color: var(--smart-blue); }
        .step-indicator.completed { color: var(--smart-dark); border-color: #cbd5e1; }

        .drag-zone {
            border: 2px dashed #CBD5E1;
            border-radius: 12px;
            padding: 40px;
            text-align: center;
            cursor: pointer;
            background: #F8FAFC;
            transition: 0.2s;
        }

        .drag-zone:hover { border-color: var(--smart-blue); background: #F0F9FF; }
        
        .file-queue-item {
            display: flex;
            gap: 12px;
            align-items: center;
            background: white;
            border: 1px solid #e2e8f0;
            padding: 10px 14px;
            margin-bottom: 8px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.02);
        }

        /* Line Selection Items */
        .line-select-item { 
            border: 1px solid #e2e8f0; padding: 10px; border-radius: 6px; margin-bottom: 6px; cursor: pointer;
            transition: 0.2s;
        }
        .line-select-item:hover { background: #f8fafc; border-color: var(--smart-blue); }
        .line-select-item input:checked + div { color: var(--smart-blue); font-weight: 700; }
        
        .btn-x-sm { padding: 2px 8px; font-size: 0.7rem; border-radius: 4px; }

        /* Toast Position */
        .toast-container { position: fixed; top: 20px; right: 20px; z-index: 9999; }
        
        /* Audit History */
        .history-item { padding-left: 15px; border-left: 2px solid #ddd; margin-bottom: 15px; position: relative; }
        .history-item::before { content: ''; position: absolute; left: -5px; top: 0; width: 8px; height: 8px; border-radius: 50%; background: #999; }
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
            <span class="fw-bold">Sales Dashboard GM</span> 
        </a>
    </div>

    <div class="sidebar-menu accordion" id="salesMenu">
        
        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#sales1">
                <span><i class="fa-solid fa-database category-icon"></i>MASTER DATA MGMT</span>
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
                <span><i class="fa-solid fa-users category-icon"></i>CRM & ACQUISITION</span>
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
                <span><i class="fa-solid fa-filter category-icon"></i>SALES FUNNEL</span>
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
                <span><i class="fa-solid fa-calculator category-icon"></i>COMMERCIAL & PRICING</span>
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
                <span><i class="fa-solid fa-truck-fast category-icon"></i>LOGISTICS OPERATIONS</span>
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
                <span><i class="fa-solid fa-building-columns category-icon"></i>FINANCE & TREASURY</span>
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
                <span><i class="fa-solid fa-box-archive category-icon"></i>COMPANY ARCHIVES</span>
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

  <div class="top-navbar">
    <div>
      <h5 class="mb-0 fw-bold text-dark">Cash Requests</h5>
      <small class="text-muted" style="font-size: 0.7rem;">FINANCE DISBURSEMENT WORKFLOW</small>
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
          <div class="fw-bold fs-6"><?php echo h($fullName); ?></div>
          <small class="text-primary fw-bold" style="font-size: 0.65rem; letter-spacing: 0.5px;">
            <?php echo h($roleLabel); ?>
          </small>
        </div>
        <img src="<?php echo h($avatarUrl); ?>" class="rounded-circle shadow-sm" width="38" height="38" alt="<?php echo h($firstName); ?>">
      </div>
    </div>
  </div>

  <div class="main-content">
    <div class="vault-container">

      <div class="kpi-row">
        <div class="kpi-card">
            <div class="kpi-icon bg-success bg-opacity-10 text-success">
                <i class="fa-solid fa-shield-check"></i>
            </div>
            <div>
                <div class="kpi-lbl">Compliance Rate</div>
                <div class="kpi-val text-success" id="kpi-comp">--%</div>
            </div>
        </div>

        <div class="kpi-card">
            <div class="kpi-icon bg-warning bg-opacity-10 text-warning">
                <i class="fa-solid fa-hourglass-half"></i>
            </div>
            <div>
                <div class="kpi-lbl">Pending Verify</div>
                <div class="kpi-val text-warning" id="kpi-pend">--</div>
            </div>
        </div>

        <div class="kpi-card cursor-pointer" onclick="switchMainTab('MISSING')">
            <div class="kpi-icon bg-danger bg-opacity-10 text-danger">
                <i class="fa-solid fa-triangle-exclamation"></i>
            </div>
            <div>
                <div class="kpi-lbl">Missing Evidence</div>
                <div class="kpi-val text-danger" id="kpi-miss">--</div>
            </div>
        </div>

        <div class="kpi-card">
            <div class="kpi-icon bg-primary bg-opacity-10 text-primary">
                <i class="fa-solid fa-file-contract"></i>
            </div>
            <div>
                <div class="kpi-lbl">Total Documents</div>
                <div class="kpi-val" id="kpi-total">--</div>
            </div>
        </div>
      </div>

      <div class="nav nav-tabs nav-tabs-custom">
        <button class="nav-link-custom active" id="tab-btn-repo" onclick="switchMainTab('REPO')">
            <i class="fa-solid fa-folder-tree me-2"></i>File Repository
        </button>
        <button class="nav-link-custom text-danger" id="tab-btn-missing" onclick="switchMainTab('MISSING')">
            <i class="fa-solid fa-clipboard-check me-2"></i>Missing Evidence
            <span class="badge bg-danger ms-2 rounded-pill" id="badgeMissingCount">0</span>
        </button>
        <button class="nav-link-custom text-warning" id="tab-btn-action" onclick="switchMainTab('ACTION')">
            <i class="fa-solid fa-inbox me-2"></i>Action Center
            <span class="badge bg-warning text-dark ms-2 rounded-pill" id="badgeActionCount">0</span>
        </button>
      </div>

      <div id="view-repo">
        
        <div class="d-flex justify-content-between align-items-center mb-4">
            <div class="btn-group shadow-sm" role="group">
                <input type="radio" class="btn-check" name="viewMode" id="vmOps" checked onclick="loadFolders('OPS')">
                <label class="btn btn-outline-primary px-4 py-2 fw-bold" for="vmOps">
                    <i class="fa-solid fa-ship me-2"></i>Operations
                </label>
                
                <input type="radio" class="btn-check" name="viewMode" id="vmOvh" onclick="loadFolders('OVH')">
                <label class="btn btn-outline-primary px-4 py-2 fw-bold" for="vmOvh">
                    <i class="fa-solid fa-briefcase me-2"></i>Overhead
                </label>
            </div>
            
            <div class="d-flex gap-2 align-items-center">
                <div class="input-group input-group-sm shadow-sm" style="width: 260px;">
                    <span class="input-group-text bg-white border-end-0"><i class="fa-solid fa-search text-muted"></i></span>
                    <input type="text" class="form-control border-start-0" id="repoSearch" placeholder="Client Search..." onkeyup="handleClientSearch(this.value)">
                </div>

                <button class="btn btn-primary fw-bold shadow-sm px-4" onclick="openWizard()">
                    <i class="fa-solid fa-cloud-arrow-up me-2"></i>Upload
                </button>
            </div>
        </div>

        <h6 class="fw-bold text-muted mb-3 small text-uppercase letter-spacing-1" id="gridTitle">Select a Folder</h6>
        
        <div class="folder-grid" id="mainGrid"></div>

        <div id="fileArea" class="mt-4 d-none">
            <div class="d-flex align-items-center gap-3 mb-3 border-bottom pb-3">
                <button class="btn btn-white btn-sm rounded-circle shadow-sm border" onclick="closeFolder()">
                    <i class="fa-solid fa-arrow-left text-dark"></i>
                </button>
                <div>
                    <h5 class="fw-bold m-0" id="openedFolderName">Folder</h5>
                    <small class="text-muted" id="openedFolderId">ID</small>
                </div>
            </div>

            <div class="file-list-card">
                <table class="table table-custom mb-0 align-middle">
                    <thead>
                        <tr>
                            <th class="ps-4" style="width: 120px;">Date</th>
                            <th>Filename / Info</th>
                            <th style="width: 150px;">Type</th>
                            <th style="width: 140px;">Status</th>
                            <th class="text-end pe-4" style="width: 100px;">Action</th>
                        </tr>
                    </thead>
                    <tbody id="fileTableBody"></tbody>
                </table>
                <div class="pagination-area">
                    <button class="btn btn-sm btn-light border" onclick="prevPage('REPO')" id="btnPrevRepo" disabled>Previous</button>
                    <small class="text-muted fw-bold" id="pageInfoRepo">Page 1</small>
                    <button class="btn btn-sm btn-light border" onclick="nextPage('REPO')" id="btnNextRepo" disabled>Next</button>
                </div>
            </div>
        </div>
      </div>

      <div id="view-missing" class="d-none">
        
        <div class="alert alert-primary d-flex align-items-center shadow-sm border-primary mb-4" role="alert">
            <div class="fs-2 me-3 text-primary"><i class="fa-solid fa-circle-info"></i></div>
            <div>
                <div class="fw-bold fs-6">Audit Documentation Required</div>
                <div class="small">
                    To complete the financial audit process, please provide supporting documentation for the items listed below. 
                    Uploading evidence helps ensure timely reconciliation and compliance with company policy.
                </div>
            </div>
        </div>

        <div class="card border-0 shadow-sm">
            <div class="card-body p-0">
                <table class="table table-custom mb-0 align-middle">
                    <thead>
                        <tr>
                            <th class="ps-4">Ref ID</th>
                            <th>Line Description</th>
                            <th>Beneficiary</th>
                            <th>Age</th>
                            <th class="text-end pe-4">Resolution</th>
                        </tr>
                    </thead>
                    <tbody id="missingTableBody"></tbody>
                </table>
            </div>
        </div>
      </div>

      <div id="view-action" class="d-none">
        <h6 class="fw-bold text-muted mb-3 small text-uppercase" id="actionTitle">Pending Items</h6>
        <div class="card border-0 shadow-sm">
            <div class="card-body p-0">
                <table class="table table-custom mb-0 align-middle">
                    <thead>
                        <tr>
                            <th class="ps-4">Date</th>
                            <th>File / Description</th>
                            <th>Folder</th>
                            <th>Status</th>
                            <th class="text-end pe-4">Action</th>
                        </tr>
                    </thead>
                    <tbody id="actionTableBody"></tbody>
                </table>
            </div>
        </div>
      </div>

    </div>
  </div>

  <div class="modal fade" id="wizardModal" data-bs-backdrop="static" tabindex="-1">
      <div class="modal-dialog modal-lg modal-dialog-centered">
          <div class="modal-content">
              <div class="modal-header border-0 pb-0 pt-4 px-4">
                  <h5 class="fw-bold modal-title">
                      <i class="fa-solid fa-cloud-arrow-up text-primary me-2"></i>Upload Wizard
                  </h5>
                  <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
              </div>
              <div class="modal-body p-4">
                  
                  <form id="wizForm">
                      <div class="step-pane d-block" id="step1">
                          <div class="mb-4">
                              <label class="form-label fw-bold small text-muted text-uppercase">File Context</label>
                              <select class="form-select form-select-lg" id="wizContext" onchange="wizLoadFolders()">
                                  <option value="OPS">Operations Project File</option>
                                  <option value="OVH">Overhead / Administrative</option>
                              </select>
                          </div>
                          <div class="mb-4">
                              <label class="form-label fw-bold small text-muted text-uppercase">Target Folder</label>
                              <select class="form-select form-select-lg" id="wizFolder" onchange="onWizFolderChange()">
                                  <option value="">-- Select Folder --</option>
                              </select>
                          </div>
                          <div class="text-end pt-2">
                              <button type="button" class="btn btn-primary fw-bold px-4" onclick="gotoStep(2)">
                                  Next Step <i class="fa-solid fa-arrow-right ms-2"></i>
                              </button>
                          </div>
                      </div>

                      <div class="step-pane d-none" id="step2">
                          <div class="row g-3">
                              <div class="col-md-6">
                                  <label class="form-label fw-bold small text-muted">Document Type</label>
                                  <select class="form-select" id="wizType" onchange="toggleOtherInput(this)">
                                      <option value="INVOICE">Supplier Invoice</option>
                                      <option value="RECEIPT">Payment Receipt</option>
                                      <option value="BL">Bill of Lading</option>
                                      <option value="POD">Proof of Delivery</option>
                                      <option value="CUSTOMS">Customs Doc</option>
                                      <option value="OTHER">Other...</option>
                                  </select>
                                  <input type="text" class="form-control mt-2 d-none" id="wizTypeOther" placeholder="Specify document type...">
                              </div>
                              <div class="col-md-6">
                                  <label class="form-label fw-bold small text-muted">Physical Location</label>
                                  <input type="text" class="form-control" id="wizLoc" placeholder="e.g. Shelf A, Binder 2">
                              </div>
                              <div class="col-12 mt-3">
                                  <label class="form-label fw-bold small text-muted">Link to specific Cash Request Lines (Strict Audit)</label>
                                  
                                  <div id="wizLineList" class="border rounded p-3 bg-light" style="max-height: 150px; overflow-y: auto;">
                                      <div class="text-muted small text-center">Select a Folder in Step 1 to load lines.</div>
                                  </div>
                              </div>
                          </div>
                          <div class="d-flex justify-content-between pt-5">
                              <button type="button" class="btn btn-light border fw-bold" onclick="gotoStep(1)">Back</button>
                              <button type="button" class="btn btn-primary fw-bold px-4" onclick="gotoStep(3)">
                                  Next Step <i class="fa-solid fa-arrow-right ms-2"></i>
                              </button>
                          </div>
                      </div>

                      <div class="step-pane d-none" id="step3">
                          <div class="drag-zone mb-3" onclick="document.getElementById('wizFiles').click()">
                              <i class="fa-solid fa-cloud-arrow-up fs-1 mb-3 text-primary"></i>
                              <div class="fw-bold text-dark">Click to Select Files</div>
                              <div class="small text-muted mt-1">Supports PDF, JPG, PNG, Excel, Word</div>
                              <input type="file" id="wizFiles" multiple hidden onchange="handleFileSelect(this)">
                          </div>
                          
                          <div id="fileQueue" class="mb-3"></div>
                          
                          <div class="d-flex justify-content-between pt-4 border-top">
                              <button type="button" class="btn btn-light border fw-bold" onclick="gotoStep(2)">Back</button>
                              <button type="button" class="btn btn-success fw-bold px-4 py-2 shadow-sm" onclick="submitWizard()">
                                  <i class="fa-solid fa-check me-2"></i> Confirm Upload
                              </button>
                          </div>
                      </div>
                  </form>
              </div>
          </div>
      </div>
  </div>

  <div class="offcanvas offcanvas-end" id="prevDrawer" style="width: 650px;" tabindex="-1">
      <div class="offcanvas-header bg-dark text-white border-bottom border-secondary">
          <h6 class="offcanvas-title font-mono"><i class="fa-solid fa-eye me-2"></i>SECURE VIEWER</h6>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="offcanvas"></button>
      </div>
      <div class="offcanvas-body p-0 d-flex flex-column bg-light">
          <iframe id="prevFrame" style="flex:1; border:none; background:#e0e0e0;"></iframe>
          
          <div id="noPreviewMsg" class="d-none flex-column align-items-center justify-content-center h-100 bg-white">
              <i class="fa-solid fa-file-excel fs-1 text-success mb-3"></i>
              <h5 class="fw-bold">Preview Not Available</h5>
              <p class="text-muted small">This file type cannot be previewed in the browser.</p>
              <a id="btnDownloadAlt" class="btn btn-primary fw-bold">
                  <i class="fa-solid fa-download me-2"></i>Download File
              </a>
          </div>

          <div class="p-4 border-top bg-white shadow-lg">
              <div class="d-flex gap-2 mb-3">
                  <a id="btnNewTab" class="btn btn-outline-dark w-100 fw-bold btn-sm">
                      <i class="fa-solid fa-expand me-2"></i>Full Screen
                  </a>
                  <?php if($canDownload): ?>
                  <a id="btnDownload" class="btn btn-outline-primary w-100 fw-bold btn-sm">
                      <i class="fa-solid fa-download me-2"></i>Download
                  </a>
                  <?php endif; ?>
              </div>
              
              <div class="accordion mb-3" id="auditAcc">
                <div class="accordion-item">
                    <button class="accordion-button collapsed py-2 small fw-bold" type="button" data-bs-toggle="collapse" data-bs-target="#auditCollapse">
                        View Audit History
                    </button>
                    <div id="auditCollapse" class="accordion-collapse collapse" data-bs-parent="#auditAcc">
                        <div class="accordion-body bg-light small" id="auditHistoryContent" style="max-height: 150px; overflow-y: auto;">
                            </div>
                    </div>
                </div>
              </div>

              <?php if($canValidate): ?>
              <div class="border-top pt-3 mt-2">
                  <div class="small fw-bold text-muted mb-2 text-uppercase">Finance Control</div>
                  <input type="text" class="form-control mb-2" id="rejectReason" placeholder="Rejection reason (required for reject)...">
                  <div class="d-flex gap-2">
                      <button class="btn btn-success flex-fill fw-bold" onclick="validateDoc('VERIFY')">
                          <i class="fa-solid fa-check-circle me-2"></i>Verify
                      </button>
                      <button class="btn btn-danger flex-fill fw-bold" onclick="validateDoc('REJECT')">
                          <i class="fa-solid fa-ban me-2"></i>Reject
                      </button>
                  </div>
              </div>
              <?php endif; ?>
          </div>
      </div>
  </div>

  <div class="toast-container">
    <div id="liveToast" class="toast align-items-center text-white bg-dark border-0 shadow-lg" role="alert" aria-live="assertive" aria-atomic="true">
      <div class="d-flex">
        <div class="toast-body fw-bold" id="toastMessage">Action Successful</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script>
    /**
     * ========================================================================
     * SMART LS VAULT CLIENT ENGINE v4.4
     * ========================================================================
     */
    
    // Config
    const API_ENDPOINT = '../../api/vault_handler.php';
    let currentUploadQueue = [];
    let currentDescriptions = {};
    let activeDocUUID = null;
    let currentTabMode = 'REPO';
    
    // Pagination State
    let repoData = [];
    let currentPageRepo = 1;
    let pageSize = 50;

    // --- INITIALIZATION ---
    document.addEventListener('DOMContentLoaded', () => {
        initClock();
        loadKPIs();
        loadFolders('OPS', selectedOpsRef);
 // Default view
        // Pre-fetch missing evidence silently
        fetch(`${API_ENDPOINT}?action=fetch_missing`).then(r=>r.json()).then(renderMissingTable).catch(console.error);
        // Pre-fetch Action Center Count
        fetch(`${API_ENDPOINT}?action=fetch_action_items`).then(r=>r.json()).then(d => {
            document.getElementById('badgeActionCount').innerText = d.data.length;
        });
    });

    function initClock() {
        setInterval(() => {
            const now = new Date();
            document.getElementById('realtime-clock').innerText = now.toLocaleTimeString('en-GB', { hour12: false });
        }, 1000);
    }

    // --- NAVIGATION TABS ---
    function switchMainTab(tabName) {
        currentTabMode = tabName;
        
        // UI Toggles
        document.getElementById('tab-btn-repo').classList.toggle('active', tabName === 'REPO');
        document.getElementById('tab-btn-missing').classList.toggle('active', tabName === 'MISSING');
        document.getElementById('tab-btn-action').classList.toggle('active', tabName === 'ACTION');
        
        document.getElementById('view-repo').classList.toggle('d-none', tabName !== 'REPO');
        document.getElementById('view-missing').classList.toggle('d-none', tabName !== 'MISSING');
        document.getElementById('view-action').classList.toggle('d-none', tabName !== 'ACTION');

        // Refresh Data Logic
        if (tabName === 'MISSING') loadMissingEvidence();
        if (tabName === 'ACTION') loadActionItems();
    }

    // --- REPOSITORY LOGIC ---
    async function loadFolders(mode) {
        const grid = document.getElementById('mainGrid');
        grid.innerHTML = '<div class="text-center w-100 py-5"><div class="spinner-border text-primary"></div></div>';
        
        try {
            const res = await fetch(`${API_ENDPOINT}?action=fetch_tree&mode=${mode}`);
            const json = await res.json();
            
            grid.innerHTML = '';
            if (!json.data || json.data.length === 0) {
                grid.innerHTML = '<div class="col-12 text-center text-muted py-5">No active folders found.</div>';
                return;
            }

            json.data.forEach(f => {
                grid.innerHTML += `
                    <div class="folder-card" onclick="openFolder('${f.id}', '${f.name}', '${mode}')">
                        <div class="f-icon"><i class="fa-solid fa-folder"></i></div>
                        <div class="f-title">${f.name}</div>
                    </div>
                `;
            });

        } catch (err) { console.error(err); }
    }

    async function openFolder(folderId, folderName, context) {
        // UI Transition
        document.getElementById('mainGrid').classList.add('d-none');
        document.getElementById('gridTitle').classList.add('d-none');
        document.getElementById('fileArea').classList.remove('d-none');
        document.getElementById('openedFolderName').innerText = folderName;
        document.getElementById('openedFolderId').innerText = folderId;
        
        const tbody = document.getElementById('fileTableBody');
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4"><div class="spinner-border text-muted"></div></td></tr>';

        // Fetch Data
        const fd = new FormData();
        fd.append('action', 'fetch_content');
        fd.append('folder', folderId);
        fd.append('context', context);

        const res = await fetch(API_ENDPOINT, { method: 'POST', body: fd });
        const json = await res.json();
        
        repoData = json.data; // Store for pagination
        currentPageRepo = 1;
        renderRepoTable();
    }

    function renderRepoTable() {
        const tbody = document.getElementById('fileTableBody');
        tbody.innerHTML = '';

        const start = (currentPageRepo - 1) * pageSize;
        const end = start + pageSize;
        const pageItems = repoData.slice(start, end);

        if (pageItems.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">This folder is empty.</td></tr>';
            return;
        }

        pageItems.forEach(f => {
            const statusBadge = f.status === 'VERIFIED' 
                ? '<span class="badge bg-success bg-opacity-10 text-success border border-success">VERIFIED</span>'
                : (f.status === 'REJECTED' 
                    ? '<span class="badge bg-danger bg-opacity-10 text-danger border border-danger">REJECTED</span>' 
                    : '<span class="badge bg-warning bg-opacity-10 text-warning border border-warning text-dark">PENDING</span>');

            const noteHtml = f.rejection_note ? `<div class="text-danger small"><i class="fa-solid fa-circle-exclamation me-1"></i>${f.rejection_note}</div>` : '';

            tbody.innerHTML += `
                <tr>
                    <td class="small font-mono text-muted">${f.date}</td>
                    <td>
                        <div class="fw-bold text-dark">${f.filename}</div>
                        <small class="text-muted">Uploaded by ${f.uploader}</small>
                        ${noteHtml}
                    </td>
                    <td><span class="badge bg-light text-dark border">${f.type}</span></td>
                    <td>${statusBadge}</td>
                    <td class="text-end pe-4">
                        <button class="btn btn-sm btn-light border shadow-sm" onclick="previewDoc('${f.uuid}', '${f.uploader}', '${f.mime}')">
                            <i class="fa-solid fa-eye text-dark"></i>
                        </button>
                    </td>
                </tr>
            `;
        });
        
        // Update Pagination Info
        document.getElementById('pageInfoRepo').innerText = `Page ${currentPageRepo} of ${Math.ceil(repoData.length / pageSize)}`;
        document.getElementById('btnPrevRepo').disabled = currentPageRepo === 1;
        document.getElementById('btnNextRepo').disabled = end >= repoData.length;
    }

    function prevPage(ctx) { if (currentPageRepo > 1) { currentPageRepo--; renderRepoTable(); } }
    function nextPage(ctx) { if ((currentPageRepo * pageSize) < repoData.length) { currentPageRepo++; renderRepoTable(); } }

    function closeFolder() {
        document.getElementById('fileArea').classList.add('d-none');
        document.getElementById('mainGrid').classList.remove('d-none');
        document.getElementById('gridTitle').classList.remove('d-none');
    }

    // --- MISSING EVIDENCE LOGIC ---
    async function loadMissingEvidence() {
        const res = await fetch(`${API_ENDPOINT}?action=fetch_missing`);
        const json = await res.json();
        renderMissingTable(json);
    }

    function renderMissingTable(json) {
        const tbody = document.getElementById('missingTableBody');
        tbody.innerHTML = '';
        
        if (!json.data || json.data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-5 text-success fw-bold"><i class="fa-solid fa-check-circle fs-1 mb-2"></i><br>Compliance 100%. No Missing Evidence.</td></tr>';
            return;
        }

        document.getElementById('badgeMissingCount').innerText = json.data.length;

        json.data.forEach(m => {
            const debtClass = m.is_overdue ? 'debt-bad' : 'debt-ok';
            tbody.innerHTML += `
                <tr>
                    <td class="font-mono fw-bold text-primary">${m.pr_id}</td>
                    <td>${m.line_desc}</td>
                    <td>${m.beneficiary}</td>
                    <td><span class="debt-badge ${debtClass}">${m.debt_age}</span></td>
                    <td class="text-end pe-4">
                        <button class="btn btn-sm btn-outline-primary fw-bold shadow-sm" onclick="initResolveWizard('${m.file_ref}')">
                            <i class="fa-solid fa-upload me-1"></i> Resolve
                        </button>
                    </td>
                </tr>
            `;
        });
    }

    // --- ACTION CENTER ---
    async function loadActionItems() {
        const tbody = document.getElementById('actionTableBody');
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4"><div class="spinner-border text-muted"></div></td></tr>';
        
        const res = await fetch(`${API_ENDPOINT}?action=fetch_action_items`);
        const json = await res.json();
        
        tbody.innerHTML = '';
        document.getElementById('actionTitle').innerText = (json.role_view === 'VALIDATOR') 
            ? 'Documents Awaiting Validation' 
            : 'My Rejected Uploads (Action Required)';
        
        document.getElementById('badgeActionCount').innerText = json.data.length;

        if (json.data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">No items requiring attention.</td></tr>';
            return;
        }

        json.data.forEach(item => {
            let statusBadge = item.status === 'PENDING' 
                ? '<span class="badge bg-warning text-dark">PENDING</span>'
                : '<span class="badge bg-danger">REJECTED</span>';
            
            let actionBtn = '';
            if (json.role_view === 'VALIDATOR') {
                actionBtn = `<button class="btn btn-sm btn-primary" onclick="previewDoc('${item.uuid}', '${item.uploader}', '${item.mime}')">Review</button>`;
            } else {
                actionBtn = `<button class="btn btn-sm btn-outline-danger" onclick="deleteFile('${item.uuid}')"><i class="fa-solid fa-trash me-1"></i> Delete & Replace</button>`;
            }

            let noteHtml = item.note ? `<div class="text-danger small mt-1"><i class="fa-solid fa-circle-exclamation me-1"></i>${item.note}</div>` : '';

            tbody.innerHTML += `
                <tr>
                    <td class="small text-muted">${item.date}</td>
                    <td>
                        <div class="fw-bold">${item.filename}</div>
                        <small class="text-muted">By ${item.uploader}</small>
                        ${noteHtml}
                    </td>
                    <td>${item.folder}</td>
                    <td>${statusBadge}</td>
                    <td class="text-end pe-4">${actionBtn}</td>
                </tr>
            `;
        });
    }

    // --- WIZARD LOGIC ---
    function openWizard() {
        document.getElementById('wizForm').reset();
        currentUploadQueue = [];
        document.getElementById('fileQueue').innerHTML = '';
        new bootstrap.Modal(document.getElementById('wizardModal')).show();
        gotoStep(1);
    }

    function initResolveWizard(folderRef) {
        openWizard();
        document.getElementById('wizContext').value = (folderRef === 'Overhead' || !folderRef) ? 'OVH' : 'OPS';
        wizLoadFolders().then(() => {
            document.getElementById('wizFolder').value = folderRef;
            onWizFolderChange();
        });
    }

    async function wizLoadFolders() {
        const ctx = document.getElementById('wizContext').value;
        const res = await fetch(`${API_ENDPOINT}?action=fetch_tree&mode=${ctx}`);
        const json = await res.json();
        
        const sel = document.getElementById('wizFolder');
        sel.innerHTML = '<option value="">-- Select Folder --</option>';
        json.data.forEach(f => {
            sel.innerHTML += `<option value="${f.id}">${f.name}</option>`;
        });
    }

    function toggleOtherInput(select) {
        const inp = document.getElementById('wizTypeOther');
        if (select.value === 'OTHER') {
            inp.classList.remove('d-none');
            inp.focus();
        } else {
            inp.classList.add('d-none');
        }
    }

    function onWizFolderChange() {
        const ref = document.getElementById('wizFolder').value;
        const ctx = document.getElementById('wizContext').value;
        const list = document.getElementById('wizLineList');
        
        if (!ref) {
            list.innerHTML = '<div class="text-center small text-muted">Select folder first.</div>';
            return;
        }

        list.innerHTML = '<div class="text-center"><div class="spinner-border spinner-border-sm"></div></div>';
        
        // Pass context to handle Overhead vs Ops PRs
        fetch(`${API_ENDPOINT}?action=fetch_pr_lines&file_ref=${ref}&context=${ctx}`)
            .then(r => r.json())
            .then(j => {
                list.innerHTML = '';
                if (j.data.length === 0) {
                    list.innerHTML = '<div class="text-success small text-center"><i class="fa-solid fa-check me-1"></i> All lines verified for this folder.</div>';
                    return;
                }
                j.data.forEach(l => {
                    list.innerHTML += `
                        <label class="line-select-item d-flex align-items-center">
                            <input type="checkbox" class="form-check-input me-3 line-checkbox" value="${l.line_id}">
                            <div>
                                <div class="small fw-bold">${l.line_desc}</div>
                                <div class="text-xs text-muted">PR: ${l.pr_id} | ${l.beneficiary} | ${l.amount}</div>
                            </div>
                        </label>
                    `;
                });
            });
    }

    function handleFileSelect(input) {
        const def = document.getElementById('wizType').value;
        Array.from(input.files).forEach(f => {
            currentUploadQueue.push(f);
            
            // Default description is filename, allowing edit
            currentDescriptions[f.name] = f.name;

            document.getElementById('fileQueue').innerHTML += `
                <div class="file-queue-item">
                    <i class="fa-solid fa-file text-muted"></i>
                    <div class="flex-grow-1">
                        <input type="text" class="form-control form-control-sm" 
                               value="${f.name}" 
                               onchange="updateQueueDesc('${f.name}', this.value)">
                    </div>
                    <button type="button" class="btn btn-x-sm btn-danger ms-2" onclick="removeFromQueue('${f.name}', this)">X</button>
                </div>
            `;
        });
    }

    function updateQueueDesc(originalName, newValue) {
        currentDescriptions[originalName] = newValue;
    }

    function removeFromQueue(name, btn) {
        currentUploadQueue = currentUploadQueue.filter(f => f.name !== name);
        delete currentDescriptions[name];
        btn.parentElement.remove();
    }

    async function submitWizard() {
        if (currentUploadQueue.length === 0) { alert("Select at least one file."); return; }
        
        const fd = new FormData();
        fd.append('action', 'upload_wizard');
        fd.append('folder_ref', document.getElementById('wizFolder').value);
        fd.append('context', document.getElementById('wizContext').value);
        
        let dType = document.getElementById('wizType').value;
        if (dType === 'OTHER') {
            const spec = document.getElementById('wizTypeOther').value;
            dType = `Other (${spec})`;
        }
        fd.append('doc_type', dType);
        fd.append('phys_loc', document.getElementById('wizLoc').value);
        fd.append('file_count', currentUploadQueue.length);
        
        const lines = Array.from(document.querySelectorAll('.line-checkbox:checked')).map(c => c.value).join(',');
        fd.append('linked_lines', lines);

        currentUploadQueue.forEach((f, i) => {
            fd.append(`file_${i}`, f);
            fd.append(`desc_${i}`, currentDescriptions[f.name]);
        });
        
        try {
            const res = await fetch(API_ENDPOINT, { method: 'POST', body: fd });
            const json = await res.json();
            if(json.status === 'success') {
                showToast("Upload Successful");
                bootstrap.Modal.getInstance(document.getElementById('wizardModal')).hide();
                loadKPIs(); 
                loadMissingEvidence();
                if (!document.getElementById('fileArea').classList.contains('d-none')) {
                    // Refresh open folder
                    const fid = document.getElementById('openedFolderId').innerText;
                    const fname = document.getElementById('openedFolderName').innerText;
                    const ctx = document.getElementById('wizContext').value;
                    openFolder(fid, fname, ctx);
                }
            } else {
                alert("Upload failed: " + json.message);
            }
        } catch(e) { console.error(e); alert("System error."); }
    }

    function gotoStep(n) {
        [1,2,3].forEach(i => document.getElementById(`step${i}`).className = (i === n) ? 'step-pane d-block' : 'step-pane d-none');
    }

    // --- VIEWER ---
    function previewDoc(uuid, uploader, mime) {
        activeDocUUID = uuid;
        const url = `${API_ENDPOINT}?action=view_file&uuid=${uuid}`;
        const dlUrl = `${API_ENDPOINT}?action=download_file&uuid=${uuid}`;
        
        // Smart Preview Logic
        const isPreviewable = mime.includes('pdf') || mime.includes('image');
        
        if (isPreviewable) {
            document.getElementById('prevFrame').classList.remove('d-none');
            document.getElementById('noPreviewMsg').classList.add('d-none');
            document.getElementById('prevFrame').src = url;
        } else {
            document.getElementById('prevFrame').classList.add('d-none');
            document.getElementById('noPreviewMsg').classList.remove('d-none');
            document.getElementById('noPreviewMsg').classList.add('d-flex');
            document.getElementById('btnDownloadAlt').href = dlUrl;
        }

        document.getElementById('btnNewTab').href = url;
        document.getElementById('btnNewTab').target = "_blank";
        if (document.getElementById('btnDownload')) document.getElementById('btnDownload').href = dlUrl;

        // Load Audit History
        loadAuditHistory(uuid);

        new bootstrap.Offcanvas(document.getElementById('prevDrawer')).show();
    }

    async function loadAuditHistory(uuid) {
        const div = document.getElementById('auditHistoryContent');
        div.innerHTML = '<div class="spinner-border spinner-border-sm"></div>';
        
        const res = await fetch(`${API_ENDPOINT}?action=fetch_history&uuid=${uuid}`);
        const json = await res.json();
        
        div.innerHTML = '';
        if (json.data.length === 0) {
            div.innerHTML = 'No history available.';
            return;
        }

        json.data.forEach(h => {
            const color = h.action === 'VERIFIED' ? 'text-success' : (h.action === 'REJECTED' ? 'text-danger' : 'text-primary');
            div.innerHTML += `
                <div class="history-item">
                    <div class="fw-bold ${color}">${h.action}</div>
                    <div class="text-xs text-muted">${h.time} by ${h.by}</div>
                    ${h.note ? `<div class="small fst-italic mt-1">"${h.note}"</div>` : ''}
                </div>
            `;
        });
    }

    async function validateDoc(action) {
        const note = document.getElementById('rejectReason').value;
        if (action === 'REJECT' && !note.trim()) {
            alert("Please provide a rejection reason.");
            return;
        }
        
        const fd = new FormData();
        fd.append('action', 'validate_doc');
        fd.append('uuid', activeDocUUID);
        fd.append('valid_action', action);
        fd.append('note', note);
        
        await fetch(API_ENDPOINT, { method: 'POST', body: fd });
        bootstrap.Offcanvas.getInstance(document.getElementById('prevDrawer')).hide();
        showToast("Document " + action);
        loadKPIs();
        loadActionItems();
        if (!document.getElementById('fileArea').classList.contains('d-none')) renderRepoTable();
    }

    async function deleteFile(uuid) {
        if (!confirm("Are you sure? This will permanently delete the file.")) return;
        const fd = new FormData();
        fd.append('action', 'delete_doc');
        fd.append('uuid', uuid);
        
        await fetch(API_ENDPOINT, { method: 'POST', body: fd });
        showToast("File Deleted");
        loadActionItems();
        loadKPIs();
    }

    async function loadKPIs() {
        try {
            const res = await fetch(`${API_ENDPOINT}?action=fetch_kpis`);
            const j = await res.json();
            document.getElementById('kpi-comp').innerText = j.kpis.compliance + '%';
            document.getElementById('kpi-pend').innerText = j.kpis.pending;
            document.getElementById('kpi-miss').innerText = j.kpis.missing;
            document.getElementById('kpi-total').innerText = j.kpis.total;
        } catch (e) { console.error(e); }
    }
    
    function handleClientSearch(val) {
        const rows = document.querySelectorAll('#fileTableBody tr');
        rows.forEach(r => {
            r.style.display = r.innerText.toLowerCase().includes(val.toLowerCase()) ? '' : 'none';
        });
    }
    
    function showToast(msg) {
        document.getElementById('toastMessage').innerText = msg;
        new bootstrap.Toast(document.getElementById('liveToast')).show();
    }
  </script>
</body>
</html>