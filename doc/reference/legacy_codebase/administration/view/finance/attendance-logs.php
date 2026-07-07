<?php
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['FINANCE']);

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
  header('Location: ../../api/auth/logout');
  exit;
}

function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }

$fullName  = $me['full_name'] ?: 'FINANCE';
$firstName = trim(explode(' ', $fullName)[0] ?? 'FINANCE');

$roleLabelMap = [
  'ADMIN'      => 'SYSTEM ADMIN',
  'FINANCE'    => 'FINANCE',
  'SALES'      => 'SALES',
  'OPERATIONS' => 'OPERATIONS',
  'MANAGEMENT' => 'MANAGEMENT',
];
$role = strtoupper((string)($me['role'] ?? 'FINANCE'));
$roleLabel = $roleLabelMap[$role] ?? 'FINANCE';

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

  <!-- SIDEBAR (same structure as index) -->
 <nav class="sidebar">
    <div class="sidebar-header">
        <a href="index.php" class="brand-logo"><i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span></a>
    </div>

    <div class="px-3 mb-2 mt-2">
        <a href="index.php" class="btn btn-primary w-100 text-start d-flex align-items-center" style="background-color: transparent; color: inherit; border: none; padding-left: 0;">
            <i class="fa-solid fa-house category-icon me-2"></i> 
            <span class="fw-bold">Finance Dashboard</span> 
        </a>
    </div>

    <div class="sidebar-menu accordion" id="financeMenu">
        
        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#fin1">
                <span><i class="fa-solid fa-database category-icon"></i>MASTER DATA MGMT</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="fin1" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                <div class="sub-menu">
                    <a href="client-master-registry.php" class="sub-link">Client Master Registry</a>
                    <a href="supplier-master-registry.php" class="sub-link">Supplier Master Registry</a>
                    <a href="employee-master.php" class="sub-link">Employee Master Registry</a>
                    <a href="financial-dictionary" class="sub-link">Financial Dictionary</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#fin2">
                <span><i class="fa-solid fa-users category-icon"></i>CRM & ACQUISITION</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="fin2" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                <div class="sub-menu">
                    <a href="partnership-portal-intake.php" class="sub-link">Partnership Portal Intake</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#fin3">
                <span><i class="fa-solid fa-calculator category-icon"></i>COMMERCIAL & PRICING</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="fin3" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                <div class="sub-menu">
                    <a href="margin-simulator-billing.php" class="sub-link">Margin Simulator & Pricing System</a>
                    <a href="extra-charges-simulator.php" class="sub-link">Extra Charges Simulator</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#fin4">
                <span><i class="fa-solid fa-truck-fast category-icon"></i>LOGISTICS OPERATIONS</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="fin4" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                <div class="sub-menu">
                    <a href="operations-registry.php" class="sub-link">Operations File Registry</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#fin5">
                <span><i class="fa-solid fa-chart-line category-icon"></i>JOB COST CONTROL</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="fin5" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                <div class="sub-menu">
                    <a href="costing-module.php" class="sub-link">Costing Module</a>
                    <a href="cost-tracking.php" class="sub-link">Cost Tracking Master</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#fin6">
                <span><i class="fa-solid fa-building-columns category-icon"></i>FINANCE & TREASURY</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="fin6" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                <div class="sub-menu">
                    <a href="cash-request.php" class="sub-link">Cash Request</a>
                    <a href="purchase-order.php" class="sub-link">Purchase Order</a>
                    <a href="proforma-invoice-portal.php" class="sub-link">Proforma Invoice Portal</a>
                    <a href="final-invoice-portal.php" class="sub-link">Final Invoice System</a>
                    <a href="smart-receivable.php" class="sub-link">Smart Receivables Ledger (SRL)</a>
                    <a href="debt-management.php" class="sub-link">Debt Management</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#fin7">
                <span><i class="fa-solid fa-folder-open category-icon"></i>HR & ARCHIVE</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="fin7" class="accordion-collapse collapse show" data-bs-parent="#financeMenu">
                <div class="sub-menu">
                    <a href="payroll-management.php" class="sub-link">Payroll Management</a>
                    <a href="attendance-logs.php" class="sub-link active">Attendance & Time Logging</a>
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

        <button id="btn-export-csv" class="btn btn-success btn-sm fw-bold text-white" type="button">
  <i class="fa-solid fa-file-csv me-2"></i> Export CSV
</button>
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
  // Add this variable to store data for export
let currentRows = [];

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
    // ... inside loadAttendance() ...
    
    // Location filter client-side (existing code)
    let rows = data.rows || [];
    if (loc === 'Office') rows = rows.filter(r => isOfficeIp(r.ip_in));
    if (loc === 'Remote') rows = rows.filter(r => !isOfficeIp(r.ip_in));

    // --- ADD THIS LINE ---
    currentRows = rows; // Save filtered data for CSV export
    // ---------------------

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
// --- NEW EXPORT LOGIC ---
  function exportToCsv() {
    if (!currentRows || currentRows.length === 0) {
      alert("No data to export.");
      return;
    }

    // 1. Define Headers
    const headers = ["Date", "Employee Name", "ID", "Department", "Time In", "Time Out", "Duration", "Status", "IP Address"];
    
    // 2. Build Rows
    const csvRows = currentRows.map(r => {
      // Format data to match your requirements
      const date = r.date || '--';
      const name = `"${(r.name || '').replace(/"/g, '""')}"`; // Escape quotes
      const id = r.employee_id || '--';
      const dept = r.dept || '--';
      const tIn = toTime(r.time_in || r.clock_in);   // Use existing formatter
      const tOut = toTime(r.time_out || r.clock_out); // Use existing formatter
      const dur = (r.duration && r.duration !== '--') ? r.duration : '--';
      const status = r.attendance_status || 'ABSENT';
      const ip = r.ip_in || '--';

      return [date, name, id, dept, tIn, tOut, dur, status, ip].join(",");
    });

    // 3. Combine Header + Rows
    const csvString = [headers.join(",")].concat(csvRows).join("\n");

    // 4. Trigger Download
    const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Attendance_Report_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Bind the new button
  document.getElementById('btn-export-csv')?.addEventListener('click', exportToCsv);

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