<?php
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['MANAGEMENT']);

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

function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }

$fullName  = $me['full_name'] ?: 'MANAGEMENT';
$firstName = trim(explode(' ', $fullName)[0] ?? 'MANAGEMENT');

$roleLabelMap = [
  'ADMIN'      => 'SYSTEM ADMIN',
  'FINANCE'    => 'FINANCE',
  'SALES'      => 'SALES',
  'OPERATIONS' => 'OPERATIONS',
  'MANAGEMENT' => 'MANAGEMENT',
];
$role = strtoupper((string)($me['role'] ?? 'MANAGEMENT'));
$roleLabel = $roleLabelMap[$role] ?? 'MANAGEMENT';

$avatarName = urlencode($fullName);
$avatarUrl  = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Employee Master | Smart LS</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">

  <!-- Small additions: safe to migrate into admin.css -->
 
</head>

<body class="page employee-master">


  <!-- SIDEBAR (same as index.php) -->
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
        <div id="menu1" class="accordion-collapse collapse " data-bs-parent="#mgmtMenu">
          <div class="sub-menu">
            <a href="index.php" class="sub-link fw-bold ">Dashboards & KPI Reporting</a>
          </div>
        </div>
      </div>

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu2">
          <span><i class="fa-solid fa-gavel category-icon"></i> Governance & Control</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu2" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
          <div class="sub-menu">
            <a href="index.php" class="sub-link">Dashboard</a>
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
        <div id="menu3" class="accordion-collapse collapse show" data-bs-parent="#mgmtMenu">
          <div class="sub-menu">
            <a href="attendance-logs.php" class="sub-link">Attendance Logs</a>
            <a href="#" class="sub-link">Client Master</a>
            <a href="#" class="sub-link">Supplier Master</a>
            <a href="employee-master.php" class="sub-link active">Employee Master</a>
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

  <!-- TOP NAVBAR (same as index.php) -->
  <div class="top-navbar">
    <div>
      <h5 class="mb-0 fw-bold text-dark">Employee Master</h5>
      <small class="text-muted" style="font-size: 0.7rem;">HR DIRECTORY & PERSONNEL CONTROLS</small>
    </div>

    <div class="d-flex align-items-center gap-4">
      <div class="clock-pill">
        <span id="realtime-clock" style="font-family: monospace;">12:00:00</span>
        <button class="btn-clock" id="btn-clock" type="button">
          <i class="fa-solid fa-fingerprint"></i> <span>Clock In</span>
        </button>
      </div>

      <div class="d-flex align-items-center gap-3 ps-3 border-start">
        <div class="text-end lh-1 d-none d-md-block">
          <div class="fw-bold fs-6"><?php echo e($fullName); ?></div>
          <small class="text-primary fw-bold" style="font-size: 0.65rem; letter-spacing: 0.5px;" id="user-role-label">
            <?php echo e($roleLabel); ?>
          </small>
        </div>
        <img src="<?php echo e($avatarUrl); ?>" class="rounded-circle shadow-sm" width="38" height="38" alt="<?php echo e($firstName); ?>">
      </div>
    </div>
  </div>

  <div class="main-content px-4 pb-5 position-relative">

    <!-- Access blocker -->
    <div id="access-blocker" class="smart-access-blocker hidden">
      <div class="bg-white p-5 rounded-4 shadow-lg border text-center" style="max-width: 450px;">
        <div class="mb-3 bg-danger bg-opacity-10 rounded-circle d-inline-flex align-items-center justify-content-center" style="width: 64px; height: 64px;">
          <i class="fa-solid fa-user-lock text-danger fs-3"></i>
        </div>
        <h4 class="fw-bold text-dark">Confidential Data</h4>
        <p class="text-muted small mb-0">Employee records are restricted to HR, Admin, and Finance personnel only.</p>
      </div>
    </div>

    <!-- KPI row -->
    <div class="row pt-4 mb-4 g-3">
      <div class="col-xl-3 col-md-6">
        <div class="card-custom p-4 d-flex align-items-center">
          <div class="me-3 rounded-circle d-flex align-items-center justify-content-center bg-info bg-opacity-10" style="width: 48px; height: 48px;">
            <i class="fa-solid fa-users text-info fs-5"></i>
          </div>
          <div>
            <div class="kpi-title">Headcount</div>
            <div class="kpi-value" id="stat-total">0</div>
          </div>
        </div>
      </div>

      <div class="col-xl-3 col-md-6">
        <div class="card-custom p-4 d-flex align-items-center">
          <div class="me-3 rounded-circle d-flex align-items-center justify-content-center bg-primary bg-opacity-10" style="width: 48px; height: 48px;">
            <i class="fa-solid fa-briefcase text-primary fs-5"></i>
          </div>
          <div>
            <div class="kpi-title">Permanent</div>
            <div class="kpi-value" id="stat-permanent">0</div>
          </div>
        </div>
      </div>

      <div class="col-xl-3 col-md-6">
        <div class="card-custom p-4 d-flex align-items-center">
          <div class="me-3 rounded-circle d-flex align-items-center justify-content-center bg-warning bg-opacity-10" style="width: 48px; height: 48px;">
            <i class="fa-solid fa-stopwatch text-warning fs-5"></i>
          </div>
          <div>
            <div class="kpi-title">Contract / Temp</div>
            <div class="kpi-value" id="stat-contract">0</div>
          </div>
        </div>
      </div>

      <div class="col-xl-3 col-md-6">
        <div class="card-custom p-4 d-flex align-items-center">
          <div class="me-3 rounded-circle d-flex align-items-center justify-content-center bg-danger bg-opacity-10" style="width: 48px; height: 48px;">
            <i class="fa-solid fa-user-xmark text-danger fs-5"></i>
          </div>
          <div>
            <div class="kpi-title">Exited (YTD)</div>
            <div class="kpi-value" id="stat-exited">0</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Search + Add -->
    <div class="card-custom p-4 mb-4">
      <div class="d-flex flex-wrap justify-content-between align-items-center gap-3">
        <div class="input-group input-group-sm w-auto">
          <span class="input-group-text bg-white"><i class="fa-solid fa-magnifying-glass text-muted"></i></span>
          <input type="text" id="search-input" class="form-control" placeholder="Search staff..." style="width: 260px;">
        </div>

        <button id="btn-create" class="btn btn-dark btn-sm fw-bold shadow-sm d-flex align-items-center gap-2" type="button">
          <i class="fa-solid fa-user-plus"></i> Add Employee
        </button>
      </div>
    </div>

    <!-- Table -->
    <div class="card-custom">
      <div class="table-responsive">
        <table class="table table-hover table-custom align-middle mb-0">
          <thead class="bg-light">
            <tr>
              <th class="ps-4">Employee</th>
              <th>Role & Dept</th>
              <th>Contract Type</th>
              <th>Join Date</th>
              <th>Status</th>
              <th class="text-end pe-4">Action</th>
            </tr>
          </thead>
          <tbody id="emp-table-body"></tbody>
        </table>
      </div>
    </div>

  </div>

  <!-- Offcanvas -->
  <div class="offcanvas offcanvas-end offcanvas-custom smart-offcanvas--medium smart-offcanvas--wide" tabindex="-1" id="empDrawer">
    <div class="offcanvas-header border-bottom bg-light">
      <div>
        <h5 class="offcanvas-title fw-bold" id="drawer-title">Employee Profile</h5>
        <small class="text-muted">Personnel Management</small>
      </div>
      <button type="button" class="btn-close" data-bs-dismiss="offcanvas"></button>
    </div>

    <div class="px-4 py-3 bg-white border-bottom d-flex align-items-center justify-content-between">
      <div class="d-flex align-items-center gap-3">
        <div class="bg-light rounded-circle border d-flex align-items-center justify-content-center text-muted fw-bold"
             style="width: 48px; height: 48px;" id="drawer-initials">SL</div>
        <div>
          <div class="small fw-bold text-muted text-uppercase">Employee ID</div>
          <div class="font-monospace fw-bold fs-5" id="drawer-id">SL-000</div>
        </div>
      </div>
      <div id="status-toggle-container" class="hidden">
        <select id="inp-status" class="form-select form-select-sm fw-bold border-success text-success bg-success bg-opacity-10">
          <option value="ACTIVE">ACTIVE</option>
          <option value="EXITED">EXITED</option>
        </select>
      </div>
    </div>

    <div class="bg-white border-bottom px-3">
      <ul class="nav nav-tabs smart-tabs" id="empTabs" role="tablist">

        <li class="nav-item">
          <button class="nav-link active" id="personal-tab" data-bs-toggle="tab" data-bs-target="#personal" type="button">Personal Info</button>
        </li>
        <li class="nav-item">
          <button class="nav-link" id="employment-tab" data-bs-toggle="tab" data-bs-target="#employment" type="button">Employment</button>
        </li>
        <li class="nav-item">
          <button class="nav-link" id="finance-tab" data-bs-toggle="tab" data-bs-target="#finance" type="button">Finance & Access</button>
        </li>
      </ul>
    </div>

    <div class="offcanvas-body p-4 tab-content bg-light bg-opacity-25">
      <form id="emp-form">

        <div class="tab-pane fade show active" id="personal" role="tabpanel">
          <div class="row g-3">
            <div class="col-12">
              <label class="smart-form-label">Full Legal Name <span class="text-danger">*</span></label>
              <input type="text" id="inp-name" class="form-control smart-input" required>
            </div>
            <div class="col-12">
              <label class="smart-form-label">Signatory Name (For Docs)</label>
              <input type="text" id="inp-signatory" class="form-control smart-input">
            </div>
            <div class="col-6">
              <label class="smart-form-label">Date of Birth</label>
              <input type="date" id="inp-dob" class="form-control smart-input">
            </div>
            <div class="col-6">
              <label class="smart-form-label">Marital Status</label>
              <select id="inp-marital" class="form-select smart-input">
                <option value="SINGLE">Single</option>
                <option value="MARRIED">Married</option>
              </select>
            </div>
            <div class="col-12">
              <label class="smart-form-label">System Email <span class="text-danger">*</span></label>
              <input type="email" id="inp-email" class="form-control smart-input" required>
            </div>
          </div>
        </div>

        <div class="tab-pane fade" id="employment" role="tabpanel">
          <div class="row g-3">
            <div class="col-6">
              <label class="smart-form-label">Department <span class="text-danger">*</span></label>
              <select id="inp-dept" class="form-select smart-input">
                <option value="OPERATIONS">OPERATIONS</option>
                <option value="SALES">SALES</option>
                <option value="FINANCE">FINANCE</option>
                <option value="ADMIN">ADMIN</option>
                <option value="MANAGEMENT">MANAGEMENT</option>
              </select>
            </div>
            <div class="col-6">
              <label class="smart-form-label">Job Title <span class="text-danger">*</span></label>
              <input type="text" id="inp-title" class="form-control smart-input" required>
            </div>
            <div class="col-6">
              <label class="smart-form-label">Contract Type</label>
              <select id="inp-type" class="form-select smart-input">
                <option value="PERMANENT">PERMANENT</option>
                <option value="CONTRACT">CONTRACT</option>
              </select>
            </div>
            <div class="col-6">
              <label class="smart-form-label">Join Date <span class="text-danger">*</span></label>
              <input type="date" id="inp-date" class="form-control smart-input" required>
            </div>
          </div>
        </div>

        <div class="tab-pane fade" id="finance" role="tabpanel">
          <div class="p-3 bg-white border rounded mb-4">
            <h6 class="text-primary small fw-bold text-uppercase border-bottom pb-2 mb-3">Payroll Data</h6>
            <div class="row g-3">
              <div class="col-6">
                <label class="smart-form-label">Base Salary (XAF)</label>
                <input type="number" id="inp-salary" class="form-control smart-input">
              </div>
              <div class="col-6">
                <label class="smart-form-label">Method</label>
                <select id="inp-pay-method" class="form-select smart-input">
                  <option value="BANK_TRANSFER">Bank Transfer</option>
                  <option value="CASH">Cash</option>
                </select>
              </div>
              <div class="col-12">
                <label class="smart-form-label">Bank Details</label>
                <input type="text" id="inp-bank" class="form-control smart-input" placeholder="Bank Name & Account No.">
              </div>
            </div>
          </div>

          <div class="p-3 bg-danger bg-opacity-10 border border-danger border-opacity-25 rounded position-relative">
            <div id="finance-authority-blocker"
                 class="position-absolute top-0 start-0 w-100 h-100 bg-white bg-opacity-75 d-flex align-items-center justify-content-center fw-bold text-muted hidden"
                 style="z-index: 5;">ADMIN ONLY</div>

            <h6 class="text-danger small fw-bold text-uppercase mb-3">System Authority</h6>
            <div class="vstack gap-2">
              <div class="form-check">
                <input class="form-check-input" type="checkbox" id="auth-issuer" checked>
                <label class="form-check-label small fw-bold" for="auth-issuer">Level 1: ISSUER (Draft)</label>
              </div>
              <div class="form-check">
                <input class="form-check-input" type="checkbox" id="auth-validator">
                <label class="form-check-label small fw-bold" for="auth-validator">Level 2: VALIDATOR (Check)</label>
              </div>
              <div class="form-check">
                <input class="form-check-input" type="checkbox" id="auth-approver">
                <label class="form-check-label small fw-bold" for="auth-approver">Level 3: APPROVER (Lock)</label>
              </div>
            </div>
            <div class="form-check mt-3 pt-3 border-top border-danger border-opacity-25">
              <input class="form-check-input" type="checkbox" id="inp-linked-user" checked>
              <label class="form-check-label small text-muted" for="inp-linked-user">Create Login Account</label>
            </div>
          </div>
        </div>

      </form>
    </div>

    <div class="p-4 border-top bg-white d-flex justify-content-end gap-2">
      <button type="button" class="btn btn-light text-muted fw-bold" data-bs-dismiss="offcanvas">Cancel</button>
      <button type="button" id="btn-save" class="btn btn-dark fw-bold px-4">Save Employee</button>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

  <script>
(function EmployeeMasterPage(){
  let currentRole = 'MANAGEMENT';
  let employees = [];

  const $ = (id) => document.getElementById(id);
  let empDrawer;

  function updateClock(){
    const now = new Date();
    const el = $('realtime-clock');
    if (el) el.innerText = now.toLocaleTimeString();
  }

  async function loadEmployees() {
  const search = (document.getElementById('search-input')?.value || '').trim();

  try {
    const res = await fetch(`../../api/employees/list.php?q=${encodeURIComponent(search)}`, {
      headers: { 'Accept': 'application/json' },
      credentials: 'same-origin'
    });

    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error('Employees API returned non-JSON (auth redirect or PHP error)');
    }

    if (!res.ok || !data.ok) {
      throw new Error(data.message || 'Failed to load employees');
    }

    employees = data.rows || [];

    // KPIs from API
    const k = data.kpis || {};
    document.getElementById('stat-total').innerText = k.total ?? employees.length;
    document.getElementById('stat-permanent').innerText = k.permanent ?? 0;
    document.getElementById('stat-contract').innerText = k.contract ?? 0;
    document.getElementById('stat-exited').innerText = k.exited ?? 0;

    renderTable();

  } catch (e) {
    console.error('loadEmployees failed:', e);
    alert(e.message || 'Failed to load employee');
  }
}

  function switchRole(role){
    currentRole = role;

    // label
    const roleLabel = (role === 'MANAGEMENT') ? 'SYSTEM MANAGEMENT' : role;
    $('user-role-label').innerText = roleLabel;

    // access blocker
    const blocker = $('access-blocker');
    const btnCreate = $('btn-create');

    if (role === 'SALES' || role === 'OPERATIONS') {
      blocker.classList.remove('hidden');
      document.body.style.overflow = 'hidden';
    } else {
      blocker.classList.add('hidden');
      document.body.style.overflow = 'auto';
    }

    // only ADMIN can create/edit employee master (you can allow FINANCE if you want)
    const canEdit = (role === 'MANAGEMENT');
    btnCreate.classList.toggle('hidden', !canEdit);

    renderTable();
  }

  function renderTable(){
  const tbody = $('emp-table-body');
  if (!tbody) return;

  const search = ($('search-input')?.value || '').toLowerCase();
  const filtered = employees.filter(e =>
    (e.name || '').toLowerCase().includes(search) ||
    (e.id || '').toLowerCase().includes(search) ||
    (e.email || '').toLowerCase().includes(search) ||
    (e.title || '').toLowerCase().includes(search)
  );

  tbody.innerHTML = filtered.map(e => {
    const canEdit = (currentRole === 'MANAGEMENT');

    const badgeClass = e.status === 'ACTIVE'
      ? 'bg-success text-success bg-opacity-10'
      : 'bg-danger text-danger bg-opacity-10';

    const actionBtn = canEdit
      ? `<button type="button" class="btn btn-sm btn-link text-secondary p-0" data-edit="${escapeHtml(e.id || '')}">
           <i class="fa-solid fa-pen-to-square"></i>
         </button>`
      : `<button type="button" class="btn btn-sm btn-link text-muted p-0 disabled">
           <i class="fa-solid fa-lock"></i>
         </button>`;

    return `
      <tr>
        <td class="ps-4">
          <div class="d-flex align-items-center gap-3">
            <div class="bg-light rounded-circle d-flex align-items-center justify-content-center text-muted small fw-bold"
                 style="width:32px; height:32px;">${(e.name || '?').charAt(0)}</div>
            <div>
              <div class="fw-bold text-dark">${escapeHtml(e.name || '')}</div>
              <div class="small text-muted font-monospace">${escapeHtml(e.id || '')}</div>
            </div>
          </div>
        </td>
        <td>
          <div class="fw-bold text-secondary small">${escapeHtml(e.title || '')}</div>
          <span class="badge bg-light text-dark border fw-normal">${escapeHtml(e.dept || '')}</span>
        </td>
        <td class="small text-muted">${escapeHtml(e.type || '')}</td>
        <td class="small text-muted">${escapeHtml(e.joinDate || '')}</td>
        <td><span class="badge ${badgeClass}">${escapeHtml(e.status || '')}</span></td>
        <td class="text-end pe-4">${actionBtn}</td>
      </tr>
    `;
  }).join('');
}


  // minimal sanitizer for template strings
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    }[c]));
  }

  function createEmployee() {
  // UI: new record
  $('drawer-title').innerText = 'New Employee';

  // This sentinel tells save.php to auto-generate an ID
  $('drawer-id').innerText = 'SL-XXX';
  $('drawer-initials').innerText = 'SL';

  // reset all fields
  const form = $('emp-form');
  if (form) form.reset();

  // defaults
  $('inp-dept').value = 'OPERATIONS';
  $('inp-type').value = 'PERMANENT';
  $('inp-marital').value = 'SINGLE';
  $('inp-pay-method').value = 'BANK_TRANSFER';

  // status: new employees default ACTIVE; hide selector for new
  $('status-toggle-container').classList.add('hidden');
  $('inp-status').value = 'ACTIVE';

  // authority defaults
  $('auth-issuer').checked = true;
  $('auth-validator').checked = false;
  $('auth-approver').checked = false;

  // allow authority edits for ADMIN (no blocker)
  $('finance-authority-blocker').classList.add('hidden');

  // create login default (your UI has it checked)
  $('inp-linked-user').checked = true;

  // ensure first tab is shown
  const triggerEl = document.querySelector('#empTabs button[data-bs-target="#personal"]');
  if (triggerEl) bootstrap.Tab.getOrCreateInstance(triggerEl).show();

  // open drawer
  empDrawer.show();
}


  function editEmployee(employeeId){
  const emp = employees.find(x => x.id === employeeId);
  if (!emp) return;

  $('drawer-id').innerText = emp.id || '';
  $('drawer-initials').innerText = (emp.name || 'E').charAt(0);

  $('inp-name').value = emp.name || '';
  $('inp-signatory').value = emp.signatory || '';
  $('inp-email').value = emp.email || '';

  $('inp-dept').value = emp.dept || 'OPERATIONS';
  $('inp-title').value = emp.title || '';
  $('inp-type').value = emp.type || 'PERMANENT';
  $('inp-date').value = emp.joinDate || '';

  $('inp-status').value = emp.status || 'ACTIVE';

  const caps = String(emp.user?.authority || '').split(',').map(x => x.trim()).filter(Boolean);
  $('auth-issuer').checked = caps.includes('ISSUER') || caps.length === 0;
  $('auth-validator').checked = caps.includes('VALIDATOR');
  $('auth-approver').checked = caps.includes('APPROVER');

  empDrawer.show();
}


async function saveEmployee(){
  try {
    const payload = {
      id: document.getElementById('drawer-id').innerText.trim(), // for edit
      name: document.getElementById('inp-name').value.trim(),
      signatory: document.getElementById('inp-signatory').value.trim(),
      email: document.getElementById('inp-email').value.trim(),

      dept: document.getElementById('inp-dept').value,
      title: document.getElementById('inp-title').value.trim(),
      type: document.getElementById('inp-type').value,
      joinDate: document.getElementById('inp-date').value,

      dob: document.getElementById('inp-dob').value || null,
      marital: document.getElementById('inp-marital').value || null,

      salary: document.getElementById('inp-salary').value ? Number(document.getElementById('inp-salary').value) : 0,
      payMethod: document.getElementById('inp-pay-method').value,
      bank: document.getElementById('inp-bank').value.trim(),

      status: (document.getElementById('inp-status')?.value || 'ACTIVE'),

      // authority
      authority: [
        document.getElementById('auth-issuer').checked ? 'ISSUER' : null,
        document.getElementById('auth-validator').checked ? 'VALIDATOR' : null,
        document.getElementById('auth-approver').checked ? 'APPROVER' : null,
      ].filter(Boolean),

      createLogin: !!document.getElementById('inp-linked-user').checked
    };

    // Basic validation
    if (!payload.name) throw new Error('Full Legal Name is required');
    if (!payload.email) throw new Error('System Email is required');
    if (!payload.dept) throw new Error('Department is required');
    if (!payload.title) throw new Error('Job Title is required');
    if (!payload.joinDate) throw new Error('Join Date is required');

    const res = await fetch(`../../api/employees/save.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.ok) {
      throw new Error((data && data.message) ? data.message : 'Save failed');
    }

    // refresh list
    await loadEmployees();

    // close drawer
    empDrawer.hide();

  } catch (e) {
    console.error('saveEmployee failed:', e);
    alert(e.message || 'Failed to save employee');
  }
}

  function bindEditDelegation(){
  document.addEventListener('click', function(ev){
    const btn = ev.target.closest('[data-edit]');
    if (!btn) return;

    const id = btn.getAttribute('data-edit');
    if (!id) return;

    // If you implemented editEmployee inside this same IIFE:
    if (typeof editEmployee === 'function') {
      editEmployee(id);
      return;
    }

    // If editEmployee is global (window.editEmployee):
    if (typeof window.editEmployee === 'function') {
      window.editEmployee(id);
      return;
    }

    console.warn('editEmployee() not found. Implement it (or expose it globally).');
  });
}


document.addEventListener('DOMContentLoaded', function () {
  empDrawer = bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('empDrawer'));

  const searchEl = document.getElementById('search-input');
  if (searchEl) searchEl.addEventListener('keyup', loadEmployees);

  const roleEl = document.getElementById('role-switcher');
  if (roleEl) roleEl.addEventListener('change', (e) => switchRole(e.target.value));

 const createEl = document.getElementById('btn-create');
if (createEl) {
  createEl.addEventListener('click', createEmployee);
}


 const saveEl = document.getElementById('btn-save');
if (saveEl) {
  saveEl.addEventListener('click', saveEmployee);
}


  // IMPORTANT: do NOT bind btn-clock here; admin.js handles it via onclick or you bind it there.
  // If you must bind here, check first:
  // const clockEl = document.getElementById('btn-clock');
  // if (clockEl) clockEl.addEventListener('click', toggleClock);

  bindEditDelegation();

  switchRole('MANAGEMENT');
  loadEmployees();
});


})(); // <-- CLOSE THE IIFE


</script>

</body>
</html>
