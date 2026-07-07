<?php
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['MANAGEMENT']);

/**
 * Management dashboard should display the authenticated user's real name/role.
 * We fetch the logged-in user (same pattern as index.php) to avoid hardcoded names.
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
$fullName  = trim((string)($me['full_name'] ?? 'Manager'));
$firstName = trim(explode(' ', $fullName)[0] ?? 'Manager');

$role = strtoupper((string)($me['role'] ?? 'MANAGEMENT'));
$roleLabelMap = [
  'ADMIN'      => 'SYSTEM ADMIN',
  'FINANCE'    => 'FINANCE',
  'SALES'      => 'SALES',
  'OPERATIONS' => 'OPERATIONS',
  'MANAGEMENT' => 'MANAGEMENT',
];
$roleLabel = $roleLabelMap[$role] ?? $role;

// For MANAGEMENT, show job title if present (e.g., "MANAGING DIRECTOR"), else fallback.
$jobTitle = trim((string)($me['job_title'] ?? ''));
$topRoleLabel = ($jobTitle !== '') ? strtoupper($jobTitle) : $roleLabel;

// Avatar
$avatarName = urlencode($fullName);
$avatarUrl  = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";

// Greeting
$hour = (int)date('H');
$greeting = ($hour < 12) ? 'Good morning' : (($hour < 18) ? 'Good afternoon' : 'Good evening');

// Friendly honorific for banner (optional). If job title contains "DIRECTOR" or "MD" -> use "Mr./Ms." is risky.
// Keep neutral and professional.
$bannerName = $firstName;
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Management Dashboard | Smart LS</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>

  <style>
    :root{
      --smart-blue:#1F99D8;
      --smart-dark:#055B83;
      --smart-orange:#EE7D04;
      --smart-charcoal:#231F20;
      --smart-bg:#F0F4F8;
      --sidebar-width:280px;
    }

    body{
      font-family:'Manrope',sans-serif;
      background-color:var(--smart-bg);
      color:var(--smart-charcoal);
      overflow-x:hidden;
    }
    h1,h2,h3,h4,h5,h6{ font-family:'Montserrat',sans-serif; }

    /* --- SIDEBAR --- */
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

    /* --- MAIN LAYOUT --- */
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

    /* --- MANAGEMENT WIDGETS --- */
    .mgmt-banner{
      background:linear-gradient(135deg, #1a1a1a 0%, #333333 100%);
      color:white;
      border-radius:12px;
      padding:1.5rem 2rem;
      position:relative;
      overflow:hidden;
      box-shadow:0 10px 30px rgba(0,0,0,0.15);
      width:100%;
    }

    .card-custom{
      background:white;
      border-radius:12px;
      border:1px solid rgba(0,0,0,0.05);
      box-shadow:0 2px 12px rgba(0,0,0,0.02);
      height:100%;
      transition:transform 0.2s;
    }
    .card-custom:hover{ transform:translateY(-2px); box-shadow:0 5px 20px rgba(0,0,0,0.05); }

    .kpi-title{
      font-size:0.7rem;
      font-weight:700;
      text-transform:uppercase;
      color:#888;
      letter-spacing:0.5px;
      white-space:nowrap;
    }
    .kpi-value{
      font-size:1.6rem;
      font-weight:800;
      color:var(--smart-charcoal);
      line-height:1.2;
      font-variant-numeric:tabular-nums;
    }

    .trend-badge{
      font-size:0.7rem;
      font-weight:700;
      padding:2px 6px;
      border-radius:4px;
      display:inline-flex;
      align-items:center;
      gap:4px;
    }
    .trend-up{ color:#10B981; background:#ecfdf5; }
    .trend-down{ color:#EF4444; background:#fef2f2; }

    .table-custom th{
      font-size:0.75rem;
      text-transform:uppercase;
      color:#888;
      font-weight:700;
      border-bottom:2px solid #f0f0f0;
    }
    .table-custom td{ font-size:0.85rem; vertical-align:middle; padding:12px 8px; }

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
  </style>
</head>

<body>

  <nav class="sidebar">
    <div class="sidebar-header">
      <a href="#" class="brand-logo"><i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span></a>
    </div>

    <div class="sidebar-menu accordion" id="mgmtMenu">
      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu1" aria-expanded="true">
          <span><i class="fa-solid fa-chart-line category-icon"></i> Executive Overview</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu1" class="accordion-collapse collapse show" data-bs-parent="#mgmtMenu">
          <div class="sub-menu">
            <a href="#" class="sub-link fw-bold text-primary">Dashboards & KPI Reporting</a>
          </div>
        </div>
      </div>

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu2">
          <span><i class="fa-solid fa-gavel category-icon"></i> Governance & Control</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu2" class="accordion-collapse collapse show" data-bs-parent="#mgmtMenu">
          <div class="sub-menu">
            <a href="index.php" class="sub-link ative">Dashboard</a>
            <a href="#" class="sub-link">Security & Session Audit</a>
            <a href="payroll-management.php" class="sub-link">Payroll Management</a>
          </div>
        </div>
      </div>

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu3">
          <span><i class="fa-solid fa-database category-icon"></i> Master Data Oversight</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu3" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
          <div class="sub-menu">
            <a href="attendance-logs.php" class="sub-link">Attendance Logs</a>
            <a href="#" class="sub-link">Client Master</a>
            <a href="#" class="sub-link">Supplier Master</a>
            <a href="employee-master.php" class="sub-link">Employee Master</a>
            <a href="#" class="sub-link">Smart Financial Dictionary</a>
          </div>
        </div>
      </div>

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu4">
          <span><i class="fa-solid fa-briefcase category-icon"></i> Commercial Performance</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu4" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
          <div class="sub-menu">
            <a href="sales-pipelining.php" class="sub-link">Sales Pipeline / Opportunity Tracking</a>
            <a href="#" class="sub-link">Marketing Campaign Register</a>
            <a href="smart-quote-intake.php" class="sub-link">Smart Quote Portal Intake</a>
            <a href="contact-us-intake.php" class="sub-link">Contact Us Intake</a>
            <a href="market-campaign-registration.php" class="sub-link">Pricing Margin Simulator</a>
            <a href="partnership-portal-intake.php" class="sub-link ">Partnership Intake</a>
            <a href="#" class="sub-link">Extra Charges Sim.</a>
          </div>
        </div>
      </div>

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu5">
          <span><i class="fa-solid fa-ship category-icon"></i> Operations Visibility</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu5" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
          <div class="sub-menu">
            <a href="#" class="sub-link">Operations File Registry</a>
            <a href="#" class="sub-link">Operational Milestone Tracking</a>
            <a href="#" class="sub-link">Transit Order Module</a>
            <a href="#" class="sub-link">Delivery Note / Proof of Delivery (POD)</a>
          </div>
        </div>
      </div>

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu6">
          <span><i class="fa-solid fa-coins category-icon"></i> Financial Performance</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu6" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
          <div class="sub-menu">
            <a href="#" class="sub-link">Costing Module</a>
            <a href="#" class="sub-link">Actual Margin Tracker</a>
            <a href="#" class="sub-link">Client Engagement & Exposure Register</a>
            <a href="#" class="sub-link">Ops Cost Exposure & Service Coverage</a>
            <a href="#" class="sub-link">Final Invoice Module</a>
            <a href="#" class="sub-link">Collections & Reminder Automation</a>
          </div>
        </div>
      </div>

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu7">
          <span><i class="fa-solid fa-folder-open category-icon"></i> Documents & Int.</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu7" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
          <div class="sub-menu">
            <a href="#" class="sub-link">Attachments & Document Vault</a>
            <a href="#" class="sub-link">Exports & Accounting Integration</a>
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

  <!-- TOP BAR: now uses real session user + clock pill (like admin baseline) -->
  <div class="top-navbar">
    <div>
      <h5 class="mb-0 fw-bold text-dark">Executive Office</h5>
      <small class="text-muted" style="font-size: 0.7rem;">STRATEGIC OVERSIGHT & CONTROL</small>
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
          <small class="text-dark fw-bold" style="font-size: 0.65rem; letter-spacing: 0.5px;">
            <?php echo e($topRoleLabel); ?>
          </small>
        </div>
        <img src="<?php echo e($avatarUrl); ?>" class="rounded-circle shadow-sm" width="38" height="38" alt="<?php echo e($firstName); ?>">
      </div>
    </div>
  </div>

  <div class="main-content px-4 pb-5">

    <div class="row pt-4 mb-4">
      <div class="col-12">
        <div class="mgmt-banner d-flex justify-content-between align-items-center">
          <div>
            <h2 class="fw-bold mb-1"><?php echo e($greeting); ?>, <?php echo e($bannerName); ?>!</h2>
            <p class="mb-0 opacity-75">Executive Summary: Performance metrics are trending positive.</p>
          </div>

          <div class="text-end" style="min-width: 150px;">
            <div class="mb-1 text-uppercase text-white-50" style="font-size: 0.7rem; font-weight: 800;">Target Status</div>
            <div class="d-flex align-items-center justify-content-end gap-2">
              <i class="fa-solid fa-bullseye text-success fs-5"></i>
              <span class="fw-bold fs-5">ON TRACK</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="row g-3 mb-4">
      <div class="col-3">
        <div class="card-custom p-3 d-flex align-items-center">
          <div class="me-3 rounded-3 bg-success bg-opacity-10 text-success d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
            <i class="fa-solid fa-chart-line"></i>
          </div>
          <div>
            <div class="kpi-title">Total Revenue (YTD)</div>
            <div class="kpi-value">145.2M</div>
            <div class="trend-badge trend-up"><i class="fa-solid fa-arrow-up"></i> 12% vs Target</div>
          </div>
        </div>
      </div>

      <div class="col-3">
        <div class="card-custom p-3 d-flex align-items-center">
          <div class="me-3 rounded-3 bg-primary bg-opacity-10 text-primary d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
            <i class="fa-solid fa-percent"></i>
          </div>
          <div>
            <div class="kpi-title">Net Margin</div>
            <div class="kpi-value">18.5%</div>
            <div class="trend-badge trend-up"><i class="fa-solid fa-arrow-up"></i> 1.5% vs Last Mo</div>
          </div>
        </div>
      </div>

      <div class="col-3">
        <div class="card-custom p-3 d-flex align-items-center">
          <div class="me-3 rounded-3 bg-info bg-opacity-10 text-info d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
            <i class="fa-solid fa-boxes-stacked"></i>
          </div>
          <div>
            <div class="kpi-title">Active Files</div>
            <div class="kpi-value">24</div>
            <span class="text-muted" style="font-size: 0.7rem; font-weight: 600;">8 Sea, 12 Air, 4 Road</span>
          </div>
        </div>
      </div>

      <div class="col-3">
        <div class="card-custom p-3 d-flex align-items-center">
          <div class="me-3 rounded-3 bg-danger bg-opacity-10 text-danger d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
            <i class="fa-solid fa-triangle-exclamation"></i>
          </div>
          <div>
            <div class="kpi-title">Critical Risks</div>
            <div class="kpi-value text-danger">3</div>
            <span class="text-danger" style="font-size: 0.7rem; font-weight: 600;">Action Required</span>
          </div>
        </div>
      </div>
    </div>

    <div class="row mb-4">
      <div class="col-12">
        <div class="card-custom p-4">
          <div class="d-flex justify-content-between align-items-center mb-3">
            <h5 class="fw-bold mb-0 text-dark"><i class="fa-solid fa-signature text-primary me-2"></i>Executive Approvals Required</h5>
            <span class="badge bg-danger rounded-pill">3 Critical</span>
          </div>

          <div class="table-responsive">
            <table class="table table-hover table-custom mb-0">
              <thead class="bg-light">
                <tr>
                  <th style="width: 10%;">Date</th>
                  <th style="width: 25%;">Request Type</th>
                  <th style="width: 40%;">Description & Justification</th>
                  <th style="width: 15%;" class="text-end">Value (XAF)</th>
                  <th style="width: 10%;" class="text-end">Decision</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td class="text-muted">09:00 AM</td>
                  <td><span class="badge bg-dark text-white">Purchase Order</span></td>
                  <td>
                    <strong>PO #9923 (Maersk)</strong>
                    <br><span class="text-muted" style="font-size: 0.75rem;">Exceeds Finance Limit (> 5M). Freight charges for Project X.</span>
                  </td>
                  <td class="text-end fw-bold">8,500,000</td>
                  <td class="text-end">
                    <button class="btn btn-sm btn-success py-0 px-2"><i class="fa-solid fa-check"></i></button>
                    <button class="btn btn-sm btn-outline-danger py-0 px-2"><i class="fa-solid fa-xmark"></i></button>
                  </td>
                </tr>

                <tr>
                  <td class="text-muted">Yesterday</td>
                  <td><span class="badge bg-warning text-dark">Credit Limit</span></td>
                  <td>
                    <strong>Override: Client "ABC Constr."</strong>
                    <br><span class="text-muted" style="font-size: 0.75rem;">Request to book shipment despite credit hold. exposure at 110%.</span>
                  </td>
                  <td class="text-end fw-bold text-danger">N/A</td>
                  <td class="text-end">
                    <button class="btn btn-sm btn-success py-0 px-2"><i class="fa-solid fa-check"></i></button>
                    <button class="btn btn-sm btn-outline-danger py-0 px-2"><i class="fa-solid fa-xmark"></i></button>
                  </td>
                </tr>

                <tr>
                  <td class="text-muted">Oct 22</td>
                  <td><span class="badge bg-primary">Quote Margin</span></td>
                  <td>
                    <strong>Quote #QT-1004 (TotalEnergies)</strong>
                    <br><span class="text-muted" style="font-size: 0.75rem;">Margin below threshold (8%). Strategic deal.</span>
                  </td>
                  <td class="text-end fw-bold">45,000,000</td>
                  <td class="text-end">
                    <button class="btn btn-sm btn-success py-0 px-2"><i class="fa-solid fa-check"></i></button>
                    <button class="btn btn-sm btn-outline-danger py-0 px-2"><i class="fa-solid fa-xmark"></i></button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

        </div>
      </div>
    </div>

    <div class="row g-4">
      <div class="col-lg-8">
        <div class="card-custom p-4 h-100">
          <div class="d-flex justify-content-between align-items-center mb-4">
            <h5 class="fw-bold mb-0 text-dark"><i class="fa-solid fa-chart-column text-primary me-2"></i>Revenue vs Cost (YTD)</h5>
            <select class="form-select form-select-sm" style="width: 100px;">
              <option>2023</option>
              <option>2022</option>
            </select>
          </div>
          <div style="height: 300px;">
            <canvas id="revenueChart"></canvas>
          </div>
        </div>
      </div>

      <div class="col-lg-4">
        <div class="card-custom p-4 h-100">
          <h5 class="fw-bold mb-4 text-dark"><i class="fa-solid fa-chart-pie text-info me-2"></i>Volume by Mode</h5>
          <div style="height: 300px; display: flex; justify-content: center;">
            <canvas id="modeChart"></canvas>
          </div>
        </div>
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

    // --- Charts (sample) ---
    const revenueCtx = document.getElementById('revenueChart');
    if (revenueCtx) {
      new Chart(revenueCtx, {
        type: 'bar',
        data: {
          labels: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
          datasets: [
            { label: 'Revenue', data: [12,14,11,18,21,25,23,26,22,28,30,32] },
            { label: 'Cost',    data: [8, 9, 7, 12,14,16,15,17,14,18,19,20] }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: { y: { beginAtZero: true } }
        }
      });
    }

    const modeCtx = document.getElementById('modeChart');
    if (modeCtx) {
      new Chart(modeCtx, {
        type: 'doughnut',
        data: {
          labels: ['Sea', 'Air', 'Road'],
          datasets: [{ data: [8, 12, 4] }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false
        }
      });
    }
  </script>
</body>
</html>
