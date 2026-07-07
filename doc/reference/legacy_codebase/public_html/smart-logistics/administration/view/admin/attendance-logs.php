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

function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }

$fullName  = $me['full_name'] ?: 'Admin';
$firstName = trim(explode(' ', $fullName)[0] ?? 'Admin');

$roleLabelMap = [
  'ADMIN'      => 'SYSTEM ADMIN',
  'FINANCE'    => 'FINANCE',
  'SALES'      => 'SALES',
  'OPERATIONS' => 'OPERATIONS',
  'MANAGEMENT' => 'MANAGEMENT',
];
$role = strtoupper((string)($me['role'] ?? 'ADMIN'));
$roleLabel = $roleLabelMap[$role] ?? 'ADMIN';

$avatarName = urlencode($fullName);
$avatarUrl  = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Attendance Logs | Smart LS</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">

  
</head>

<body>

  <!-- SIDEBAR (same structure as index.php) -->
  <nav class="sidebar">
    <div class="sidebar-header">
      <a href="index.php" class="brand-logo"><i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span></a>
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
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu2" aria-expanded="true">
          <span><i class="fa-solid fa-users category-icon"></i> Workforce & Org</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu2" class="accordion-collapse collapse show" data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="employee-master.php" class="sub-link">Employee Master</a>
            <a href="attendance-logs.php" class="sub-link active">Attendance Logs</a>
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
            <a href="contact-us-intake.php" class="sub-link">Contact Us Intake</a>
            <a href="partnership-portal-intake.php" class="sub-link">Partnership Intake</a>
            <a href="market-campaign-registration.php" class="sub-link">Campaign Register</a>
            <a href="sales-pipelining.php" class="sub-link">Sales Pipeline</a>
            
            <a href="extra-charges-simulator.php" class="sub-link">Extra Charges Sim.</a>
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
            <a href="operational-milestone-tracking.php" class="sub-link">Milestone Tracking</a>
            <a href="transit-order.php" class="sub-link">Transit Orders</a>
            <a href="delivery-note.php" class="sub-link">Delivery / POD</a>
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
            <a href="costing-module.php" class="sub-link">Costing Module</a>
            <a href="#" class="sub-link">Proforma / Advance</a>
            <a href="#" class="sub-link">Final Invoice</a>
            <a href="#" class="sub-link">Collections</a>
            <a href="cash-request.php" class="sub-link">Cash Requests</a>
            <a href="#" class="sub-link">Expenditure Journal</a>
            <a href="#" class="sub-link">Cost Exposure</a>
          </div>
        </div>
      </div>

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu7">
          <span><i class="fa-solid fa-chart-pie category-icon"></i> Reports & Docs</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu7" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="documents-vault.php" class="sub-link">Document Vault</a>
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

  <!-- TOP NAVBAR (same pattern as index.php) -->
  <div class="top-navbar">
    <div>
      <h5 class="mb-0 fw-bold text-dark">Attendance Register</h5>
      <small class="text-muted" style="font-size: 0.7rem;">WORKFORCE TIME & PRESENCE OVERSIGHT</small>
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
          <small class="text-primary fw-bold" style="font-size: 0.65rem; letter-spacing: 0.5px;">
            <?php echo e($roleLabel); ?>
          </small>
        </div>
        <img src="<?php echo e($avatarUrl); ?>" class="rounded-circle shadow-sm" width="38" height="38" alt="<?php echo e($firstName); ?>">
      </div>
    </div>
  </div>

  <div id="print-area" class="main-content px-4 pb-5">

    <!-- KPI ROW -->
    <div class="row pt-4 mb-4 g-3">
      <div class="col-xl-3 col-md-6">
        <div class="card-custom p-4 d-flex align-items-center">
          <div class="me-3 rounded-circle d-flex align-items-center justify-content-center bg-success bg-opacity-10" style="width: 48px; height: 48px;">
            <i class="fa-solid fa-user-check text-success fs-5"></i>
          </div>
          <div>
            <div class="kpi-title">Present Today</div>
            <!-- REQUIRED MARKUP -->
            <div class="kpi-value kpi-present">
              <span id="kpi-present">0</span> <span class="text-muted fs-6 fw-normal">/ <span id="kpi-total">0</span></span>
            </div>
          </div>
        </div>
      </div>

      <div class="col-xl-3 col-md-6">
        <div class="card-custom p-4 d-flex align-items-center">
          <div class="me-3 rounded-circle d-flex align-items-center justify-content-center bg-danger bg-opacity-10" style="width: 48px; height: 48px;">
            <i class="fa-solid fa-user-xmark text-danger fs-5"></i>
          </div>
          <div>
            <div class="kpi-title">Absent</div>
            <!-- REQUIRED MARKUP -->
            <div class="kpi-value kpi-absent" id="kpi-absent">0</div>
          </div>
        </div>
      </div>

      <div class="col-xl-3 col-md-6">
        <div class="card-custom p-4 d-flex align-items-center">
          <div class="me-3 rounded-circle d-flex align-items-center justify-content-center bg-warning bg-opacity-10" style="width: 48px; height: 48px;">
            <i class="fa-solid fa-clock text-warning fs-5"></i>
          </div>
          <div>
            <div class="kpi-title">Late (&gt; 09:00)</div>
            <!-- REQUIRED MARKUP -->
            <div class="kpi-value kpi-late" id="kpi-late">0</div>
          </div>
        </div>
      </div>

      <div class="col-xl-3 col-md-6">
        <div class="card-custom p-4 d-flex align-items-center">
          <div class="me-3 rounded-circle d-flex align-items-center justify-content-center bg-info bg-opacity-10" style="width: 48px; height: 48px;">
            <i class="fa-solid fa-laptop-house text-info fs-5"></i>
          </div>
          <div>
            <div class="kpi-title">Remote Workers</div>
            <!-- REQUIRED MARKUP -->
            <div class="kpi-value kpi-remote" id="kpi-remote">0</div>
          </div>
        </div>
      </div>
    </div>

    <!-- TABLE CARD -->
    <div class="card-custom p-4">

      <div class="d-flex flex-wrap justify-content-between align-items-end mb-4 gap-3">
        <div class="d-flex gap-3 flex-wrap">

          <div>
            <label class="form-label small fw-bold text-muted mb-1">Search Employee</label>
            <div class="input-group input-group-sm">
              <span class="input-group-text bg-white"><i class="fa-solid fa-magnifying-glass text-muted"></i></span>
              <input type="text" id="search-input" class="form-control" placeholder="Name, ID, or IP..." style="width: 220px;">
            </div>
          </div>

          <div>
            <label class="form-label small fw-bold text-muted mb-1">Department</label>
            <select id="filter-dept" class="form-select form-select-sm" style="width: 170px;">
              <option value="">All Departments</option>
                <option value="ADMIN">ADMIN</option>
                <option value="FINANCE">FINANCE</option>
                <option value="SALES">SALES</option>
                <option value="OPERATIONS">OPERATIONS</option>
                <option value="MANAGEMENT">MANAGEMENT</option>

            </select>
          </div>

          <div>
            <label class="form-label small fw-bold text-muted mb-1">Location / IP</label>
            <select id="filter-loc" class="form-select form-select-sm" style="width: 190px;">
              <option value="">All Locations</option>
              <option value="Office">Office IP (Secure)</option>
              <option value="Remote">Remote / Unknown</option>
            </select>
          </div>

        </div>

        <button id="btn-export-pdf" class="btn btn-outline-dark btn-sm fw-bold" type="button">
  <i class="fa-solid fa-file-export me-2"></i> Export Report
</button>

      </div>

      <div id="attendance-print-table"  class="table-responsive">
        <table class="table table-hover table-custom align-middle mb-0">
          <thead class="bg-light">
            <tr>
              <th>Date</th>
              <th>Employee</th>
              <th>Department</th>
              <th>Time In</th>
              <th>IP (Source)</th>
              <th>Time Out</th>
              <th>Duration</th>
              <th>Status</th>
              <!-- <th class="text-end">Actions</th> -->
            </tr>
          </thead>
          <tbody id="attendance-table-body"></tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- OFFCANVAS -->
  <!-- <div class="offcanvas offcanvas-end" tabindex="-1" id="correctionDrawer" aria-labelledby="correctionDrawerLabel" style="width: 450px;">
    <div class="offcanvas-header border-bottom bg-light">
      <div>
        <h5 class="offcanvas-title fw-bold" id="correctionDrawerLabel">Correction Request</h5>
        <small class="text-muted">Manual adjustment of time logs</small>
      </div>
      <button type="button" class="btn-close" data-bs-dismiss="offcanvas"></button>
    </div>
    <div class="offcanvas-body p-4">
      <form id="correction-form">

        <div class="d-flex align-items-center gap-3 p-3 bg-warning bg-opacity-10 border border-warning border-opacity-25 rounded mb-4">
          <div class="bg-white rounded-circle d-flex align-items-center justify-content-center border shadow-sm fw-bold"
               style="width: 40px; height: 40px;" id="drawer-avatar">A</div>
          <div>
            <div class="fw-bold text-dark" id="drawer-name">—</div>
            <div class="small text-muted" id="drawer-date">—</div>
          </div>
        </div>

        <div class="row g-3 mb-3">
          <div class="col-6">
            <label class="form-label small fw-bold">Time In</label>
            <input type="time" id="inp-in" class="form-control">
          </div>
          <div class="col-6">
            <label class="form-label small fw-bold">Time Out</label>
            <input type="time" id="inp-out" class="form-control">
          </div>
        </div>

        <div class="mb-3">
          <label class="form-label small fw-bold">Reason for Adjustment <span class="text-danger">*</span></label>
          <textarea id="inp-reason" class="form-control" rows="3" placeholder="e.g. Forgot to clock out, Biometric failure..." required></textarea>
        </div>

        <div class="form-check mb-4">
          <input class="form-check-input" type="checkbox" required id="certify">
          <label class="form-check-label small text-muted" for="certify">
            I certify this adjustment is accurate and compliant with policy.
          </label>
        </div>

        <div class="d-grid">
          <button type="submit" class="btn btn-dark fw-bold">Update Log</button>
        </div>

      </form>
    </div>
  </div> -->

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

 <script>
(function AttendancePageDB(){
  const OFFICE_IP_PREFIX = "192.168.1.";
  const LATE_CUTOFF = "09:00:00";

  const $ = (id) => document.getElementById(id);

  function isOfficeIp(ip){ return (ip || '').startsWith(OFFICE_IP_PREFIX); }

  function toTime(v){
    // Accepts "HH:mm", "HH:mm:ss", ISO datetime, or null
    if (!v) return '--';
    if (typeof v !== 'string') return '--';

    if (v.includes('T')) {
      const d = new Date(v);
      if (isNaN(d.getTime())) return '--';
      const hh = String(d.getHours()).padStart(2,'0');
      const mm = String(d.getMinutes()).padStart(2,'0');
      const ss = String(d.getSeconds()).padStart(2,'0');
      return `${hh}:${mm}:${ss}`;
    }

    // normalize HH:mm -> HH:mm:ss
    if (v.length === 5) return `${v}:00`;
    return v;
  }

  function fmtDurationMinutes(mins){
    mins = Number(mins || 0);
    if (!mins || mins <= 0) return '--';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${String(m).padStart(2,'0')}m`;
  }

  function computeActiveDuration(clockInIsoOrTime){
    // Minimal: only works reliably when ISO datetime is provided
    if (!clockInIsoOrTime || typeof clockInIsoOrTime !== 'string') return 'Active';
    if (!clockInIsoOrTime.includes('T')) return 'Active';
    const a = new Date(clockInIsoOrTime).getTime();
    if (isNaN(a)) return 'Active';
    const mins = Math.max(0, Math.round((Date.now() - a) / 60000));
    return `${fmtDurationMinutes(mins)} (Active)`;
  }

  function deriveUiBadge(dbStatus, timeIn, timeOut){
    const s = String(dbStatus || 'OPEN').toUpperCase();

    // 1) AUTO_CLOSED
    if (s === 'AUTO_CLOSED') {
      return { label: 'AUTO-CLOSED', cls: 'status-absent', icon: '<i class="fa-solid fa-triangle-exclamation"></i>' };
    }

    // 2) OPEN or no time_out
    if (s === 'OPEN' || timeOut === '--') {
      return { label: 'ACTIVE', cls: 'status-late', icon: '<i class="fa-solid fa-clock"></i>' };
    }

    // 3) CLOSED => PRESENT/LATE by cutoff
    if (timeIn !== '--' && timeIn > LATE_CUTOFF) {
      return { label: 'LATE', cls: 'status-late', icon: '<i class="fa-solid fa-clock"></i>' };
    }

    return { label: 'PRESENT', cls: 'status-present', icon: '<i class="fa-solid fa-check"></i>' };
  }

  function deriveDuration(dbStatus, clockInIso, clockOutIso, durationMinutes){
    const s = String(dbStatus || 'OPEN').toUpperCase();

    // OPEN => Active duration (simple, no complication)
    if (s === 'OPEN' || !clockOutIso) {
      // If you want plain "Active" only, replace the next line with: return "Active";
      return computeActiveDuration(clockInIso);
    }

    // CLOSED/AUTO_CLOSED => use duration_minutes first
    const fromDb = fmtDurationMinutes(durationMinutes);
    if (fromDb !== '--') return fromDb;

    // fallback compute if ISO datetimes exist
    if (clockInIso && clockOutIso && String(clockInIso).includes('T') && String(clockOutIso).includes('T')) {
      const a = new Date(clockInIso).getTime();
      const b = new Date(clockOutIso).getTime();
      if (!isNaN(a) && !isNaN(b) && b >= a) {
        const mins = Math.round((b - a) / 60000);
        return fmtDurationMinutes(mins);
      }
    }

    return '--';
  }

  async function loadAttendance(){
    const q    = ($('search-input')?.value || '').trim();
    const dept = ($('filter-dept')?.value || '').trim(); // expects ENUM values
    const loc  = ($('filter-loc')?.value || '').trim();

    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (dept) params.set('dept', dept);

    const url = `../../api/attendance/admin_register.php?${params.toString()}`;
    const res = await fetch(url, { headers: { 'Accept':'application/json' }});
    const data = await res.json().catch(()=> ({}));

    if (!res.ok || !data.ok) throw new Error(data.message || 'Failed to load attendance.');

    // KPI
    $('kpi-present').innerText = String(data.kpis.present ?? 0);
    $('kpi-total').innerText   = String(data.kpis.total ?? 0);
    $('kpi-absent').innerText  = String(data.kpis.absent ?? 0);
    $('kpi-late').innerText    = String(data.kpis.late ?? 0);
    $('kpi-remote').innerText  = String(data.kpis.remote ?? 0);

    // Location filter client-side (kept simple)
    let rows = data.rows || [];
    if (loc === 'Office') rows = rows.filter(r => isOfficeIp(r.ip_in));
    if (loc === 'Remote') rows = rows.filter(r => !isOfficeIp(r.ip_in));

    renderTable(rows);
  }

  function renderTable(rows){
  const tbody = document.getElementById('attendance-table-body');
  if (!tbody) return;

  tbody.innerHTML = rows.map(r => {
    const timeIn  = toTime(r.time_in || r.clock_in);
    const timeOut = toTime(r.time_out || r.clock_out);

    // UI status now comes directly from API (PRESENT/LATE/ACTIVE/ABSENT/AUTO-CLOSED)
    const uiStatus = String(r.attendance_status || 'ABSENT').toUpperCase();

    // Duration now comes directly from API (or fallback to '--')
    const duration = (r.duration && r.duration !== '--') ? r.duration : '--';

    // Badge mapping for UI status
    let statusClass = 'status-present';
    let icon = '<i class="fa-solid fa-check"></i>';

    if (uiStatus === 'ABSENT') { statusClass = 'status-absent'; icon = '<i class="fa-solid fa-xmark"></i>'; }
    if (uiStatus === 'LATE')   { statusClass = 'status-late';   icon = '<i class="fa-solid fa-clock"></i>'; }
    if (uiStatus === 'ACTIVE') { statusClass = 'status-late';   icon = '<i class="fa-solid fa-clock"></i>'; }
    if (uiStatus === 'AUTO-CLOSED' || uiStatus === 'AUTO_CLOSED') {
      statusClass = 'status-absent';
      icon = '<i class="fa-solid fa-triangle-exclamation"></i>';
    }
    if (uiStatus === 'PRESENT') { statusClass = 'status-present'; icon = '<i class="fa-solid fa-check"></i>'; }

    const ipIn  = r.ip_in  || '--';
    const ipOut = r.ip_out || '--';

    const devIn  = r.device_in  || '';
    const devOut = r.device_out || '';

    const uaInFull  = r.user_agent_in  || '';
    const uaOutFull = r.user_agent_out || '';
    const uaIn  = uaInFull.slice(0, 60);
    const uaOut = uaOutFull.slice(0, 60);

    return `
      <tr>
        <td class="text-muted small font-monospace">${r.date || '--'}</td>

        <td>
          <div class="d-flex align-items-center gap-3">
            <div class="bg-light rounded-circle d-flex align-items-center justify-content-center text-secondary fw-bold border"
                 style="width:32px; height:32px; font-size:0.75rem;">
              ${(r.name || '?').charAt(0)}
            </div>
            <div class="d-flex flex-column">
              <span class="fw-bold text-dark">${r.name || '--'}</span>
              <small class="text-muted font-monospace">${r.employee_id || '--'}</small>
            </div>
          </div>
        </td>

        <td><span class="badge bg-light text-dark border fw-normal">${r.dept || '--'}</span></td>

        <td class="font-monospace small fw-bold text-dark">${timeIn}</td>

        <td>
          <div class="small fw-bold">${ipIn}</div>
          ${devIn ? `<div class="small text-muted">${devIn}</div>` : ``}
          ${uaIn ? `<div class="small text-muted" title="${uaInFull}">${uaIn}${uaInFull.length>60?'...':''}</div>` : ``}

          <hr class="my-2">

          <div class="small fw-bold">${ipOut}</div>
          ${devOut ? `<div class="small text-muted">${devOut}</div>` : ``}
          ${uaOut ? `<div class="small text-muted" title="${uaOutFull}">${uaOut}${uaOutFull.length>60?'...':''}</div>` : ``}
        </td>

        <td class="font-monospace small text-muted">${timeOut}</td>

        <td><span class="small fw-bold text-secondary">${duration}</span></td>

        <td><span class="status-badge ${statusClass}">${icon} ${uiStatus}</span></td>

        
      </tr>
    `;
  }).join('');
}


  function rerun(){
    loadAttendance().catch(e => alert(e.message));
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('search-input')?.addEventListener('keyup', rerun);
    $('filter-dept')?.addEventListener('change', rerun);
    $('filter-loc')?.addEventListener('change', rerun);

     // Export PDF (prints only #print-area using @media print rules)
  document.getElementById('btn-export-pdf')?.addEventListener('click', () => {
    window.print();
  });

    document.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-emp][data-date]');
      if (!btn) return;

      const emp = btn.getAttribute('data-emp');
      const dt  = btn.getAttribute('data-date');

      document.getElementById('drawer-name').innerText = emp;
      document.getElementById('drawer-date').innerText = dt;
      document.getElementById('drawer-avatar').innerText = (emp || 'A').charAt(0);

      const drawer = bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('correctionDrawer'));
      drawer.show();
    });

    rerun();
  });

})();
</script>


</body>
</html>



<!-- edit ttendance -->

<!-- <td class="text-end">
          <button type="button" class="btn btn-sm btn-link text-muted p-0" data-emp="${r.employee_id || ''}" data-date="${r.date || ''}">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
        </td> -->















        financial_dictionary
1	id Primary	int(11)			No	None		AUTO_INCREMENT	Change Change	Drop Drop	
	2	code Index	varchar(10)	utf8mb4_general_ci		No	None	Format #-####		Change Change	Drop Drop	
	3	name_en	varchar(150)	utf8mb4_general_ci		No	None			Change Change	Drop Drop	
	4	name_fr	varchar(150)	utf8mb4_general_ci		No	None			Change Change	Drop Drop	
	5	category	enum('CARRIER_CHARGES', 'PORT_TERMINAL_CHARGES', '...	utf8mb4_general_ci		No	None			Change Change	Drop Drop	
	6	subcategory	varchar(100)	utf8mb4_general_ci		No	None			Change Change	Drop Drop	
	7	service_applicability	longtext	utf8mb4_bin		No	None	Array of Service Types		Change Change	Drop Drop	
	8	territory	enum('DOMESTIC_INLAND', 'PORT_AIRPORT_ZONE', 'INTE...	utf8mb4_general_ci		No	None			Change Change	Drop Drop	
	9	cost_nature	enum('CHARGEABLE_SERVICE', 'DISBURSEMENT', 'STATUT...	utf8mb4_general_ci		No	None			Change Change	Drop Drop	
	10	is_negotiable	tinyint(1)			No	1			Change Change	Drop Drop	
	11	is_billable	tinyint(1)			No	1			Change Change	Drop Drop	
	12	receipt_required	enum('ALWAYS_REQUIRED', 'CONDITIONALLY_REQUIRED', ...	utf8mb4_general_ci		No	None			Change Change	Drop Drop	
	13	receipt_source	enum('GOVERNMENT_AUTHORITY', 'CARRIER_AIRLINE', 'P...	utf8mb4_general_ci		Yes	NULL			Change Change	Drop Drop	
	14	justification_required	tinyint(1)			Yes	NULL		STORED GENERATED	Change Change	Drop Drop	
	15	vat_treatment	enum('VAT_EXEMPT_STATUTORY', 'VAT_ZERO_RATED_EXPOR...	utf8mb4_general_ci		No	None			Change Change	Drop Drop	
	16	status	enum('ACTIVE', 'DEPRECATED')	utf8mb4_general_ci		No	ACTIVE			Change Change	Drop Drop	
	17	created_by	int(11)			No	None			Change Change	Drop Drop	
	18	created_at	datetime


operations_file_master
1	operations_file_reference Primary	varchar(11)	utf8mb4_general_ci		No	None			Change Change	Drop Drop	
	2	details_json	longtext	utf8mb4_general_ci		No	None			Change Change	Drop Drop	
	3	legacy_reference	varchar(50)	utf8mb4_general_ci		Yes	NULL			Change Change	Drop Drop	
	4	opportunity_id Index	char(36)	utf8mb4_general_ci		No	None			Change Change	Drop Drop	
	5	link_opportunity	tinyint(1)			No	1			Change Change	Drop Drop	
	6	client_id Index	varchar(20)	utf8mb4_general_ci		No	None			Change Change	Drop Drop	
	7	client_bill_to	varchar(150)	utf8mb4_general_ci		Yes	NULL			Change Change	Drop Drop	
	8	service_type Index	enum('SEA_FREIGHT_IMPORT', 'SEA_FREIGHT_EXPORT', '...	utf8mb4_general_ci		No	None			Change Change	Drop Drop	
	9	service_territory	enum('DOMESTIC_INLAND', 'PORT_AIRPORT_ZONE', 'INTE...	utf8mb4_general_ci		No	None			Change Change	Drop Drop	
	10	voyage_no	varchar(80)	utf8mb4_general_ci		Yes	NULL			Change Change	Drop Drop	
	11	port_of_loading	varchar(120)	utf8mb4_general_ci		Yes	NULL			Change Change	Drop Drop	
	12	port_of_delivery	varchar(120)	utf8mb4_general_ci		Yes	NULL			Change Change	Drop Drop	
	13	commodity	varchar(150)	utf8mb4_general_ci		Yes	NULL			Change Change	Drop Drop	
	14	commodity_desc	varchar(255)	utf8mb4_general_ci		Yes	NULL			Change Change	Drop Drop	
	15	gross_weight	decimal(12,2)			Yes	NULL			Change Change	Drop Drop	
	16	weight_unit	enum('KG', 'TON', 'LB')	utf8mb4_general_ci		Yes	KG			Change Change	Drop Drop	
	17	incoterm	varchar(10)	utf8mb4_general_ci		Yes	NULL			Change Change	Drop Drop	
	18	marks_numbers	text	utf8mb4_general_ci		Yes	NULL			Change Change	Drop Drop	
	19	place_receipt	varchar(150)	utf8mb4_general_ci		Yes	NULL			Change Change	Drop Drop	
	20	place_delivery	varchar(150)	utf8mb4_general_ci		Yes	NULL			Change Change	Drop Drop	
	21	eta	datetime			Yes	NULL			Change Change	Drop Drop	
	22	ata	datetime			Yes	NULL			Change Change	Drop Drop	
	23	sea_bl	varchar(60)	utf8mb4_general_ci		Yes	NULL			Change Change	Drop Drop	
	24	sea_vessel	varchar(120)	utf8mb4_general_ci		Yes	NULL			Change Change	Drop Drop	
	25	sea_voyage	varchar(60)	utf8mb4_general_ci		Yes	NULL			Change Change	Drop Drop	
	26	sea_pol	varchar(80)	utf8mb4_general_ci		Yes	NULL			Change Change	Drop Drop	
	27	sea_pod	varchar(80)	utf8mb4_general_ci		Yes	NULL			Change Change	Drop Drop	
	28	air_mawb	varchar(60)	utf8mb4_general_ci		Yes	NULL			Change Change	Drop Drop	
	29	air_airline	varchar(80)	utf8mb4_general_ci		Yes	NULL			Change Change	Drop Drop	
	30	air_flightno	varchar(40)	utf8mb4_general_ci		Yes	NULL			Change Change	Drop Drop	
	31	air_origin	varchar(20)	utf8mb4_general_ci		Yes	NULL			Change Change	Drop Drop	
	32	air_dest	varchar(20)	utf8mb4_general_ci		Yes	NULL			Change Change	Drop Drop	
	33	inland_truck	varchar(60)	utf8mb4_general_ci		Yes	NULL			Change Change	Drop Drop	
	34	inland_decl	varchar(80)	utf8mb4_general_ci		Yes	NULL			Change Change	Drop Drop	
	35	inland_border	varchar(255)	utf8mb4_general_ci		Yes	NULL			Change Change	Drop Drop	
	36	warehouse_loc	varchar(150)	utf8mb4_general_ci		Yes	NULL			Change Change	Drop Drop	
	37	warehouse_bonded	enum('BONDED', 'NON_BONDED')	utf8mb4_general_ci		Yes	NULL			Change Change	Drop Drop	
	38	warehouse_stockin	date			Yes	NULL			Change Change	Drop Drop	
	39	rep_scope	text	utf8mb4_general_ci		Yes	NULL			Change Change	Drop Drop	
	40	rep_contact	varchar(150)	utf8mb4_general_ci		Yes	NULL			Change Change	Drop Drop	
	41	package_count	int(11)			Yes	NULL			Change Change	Drop Drop	
	42	operations_status Index	enum('NOT_AWARDED', 'OPEN', 'IN_PROGRESS', 'OPERAT...	utf8mb4_general_ci		No	OPEN			Change Change	Drop Drop	
	43	margin	decimal(18,2)			No	0.00			Change Change	Drop Drop	
	44	created_by_user_id	int(11)			No	None			Change Change	Drop Drop	
	45	created_at	datetime			No	current_timestamp()			Change Change	Drop Drop	
	46	updated_at	datetime			No	current_timestamp()		ON UPDATE CURRENT_TIMESTAMP()	Change Change	Drop Drop	
	47	expected_delivery_time	datetime			Yes	NULL			Change Change	Drop Drop	
	48	current_stage_index	tinyint(3)		UNSIGNED	No	0			Change Change	Drop Drop	
	49	current_stage_updated_at	datetime			Yes	NULL			Change Change	Drop Drop	
	50	current_stage_updated_by_user_id	int(11)Okay, this is the secure document vault, and here it contains under the operations tab, all the files from operations master. And when all the files appear here, you can click on each file and you see the different invoices that have been uploaded for the file. How does it work? It takes each file and verifies the costing that was released for that file or approved for that file. And once the costing is approved and a cash request is being done for that same file reference, then now, depending on what the financial dictionary says about mandatory supporting documents, it's going to produce a supporting document. If the financial dictionary doesn't take mandatory supporting documents, then it doesn't oblige the user. So, any document under the file reference from the costing lines, from the cash request lines, that don't carry the mandatory supporting documents or that carry mandatory supporting documents, you need to flag it here so that they can upload the invoices or the supporting documents for it. So, each of the files, like now you have SLASFR004 for total energies. The costing was produced and the files that were, the costing was approved and the cash request was done, and these are the amounts that were used for the operation. So, that is it. Now, the next thing is, if it's an overhead, you go to overhead, you would have the legal, HR, finance, or general. Legal contains any documents of the company, so it's just an open place where they can upload any legal documents of the company. HR, they can upload maybe employee documents, their certificates and their ID cards and all of that. Finance, you can upload any finance documents, like maybe purchase orders and all of that. And then, still under operations, I omitted operations.So whenever there is a document lacking, the user will always be notified that he needs to upload this document. Now back to the overheads. Overheads under General now, if we have any purchase order of operations of overheads, we can upload the documents here, maybe any receipts or anything from vendors or maybe anything from vendors, quotations from vendors, all of that. It comes here under General. So that's the way it works. Now there's a button of missing evidence. When someone opens here and he clicks on the missing evidence, it shows the file reference and it shows the evidence that is missing. Here it has the line code, which is from the description, it shows that this amount was disbursed and approved. And the description of that line under the financial dictionary requires for a mandatory supporting document. Now where is the supporting document you need to upload it? If you don't upload the supporting document, at most one day after it is resolved, or after funds are disbursed, you would see it here saying that you need to upload the supporting documents. You need to describe this. You have the compliance rate. Compliance rate shows the compliance of the user if he has uploaded all his documents. Like this user has uploaded all and has just one missing evidence. You have pending verification. The supporting documents have been uploaded and pending review by the finance. And you have the total number of documents uploaded. So that is the way it works. Okay, thank you very much.