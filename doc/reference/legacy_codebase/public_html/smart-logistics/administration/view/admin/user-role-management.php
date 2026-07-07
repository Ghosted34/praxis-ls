<?php
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN']); // keep ADMIN only for IAM console

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
  <title>IAM & Security | Smart LS</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
</head>

<body class="page iam-security">

  <!-- SIDEBAR (EXACT SAME AS employee-master.php) -->
  <nav class="sidebar">
    <div class="sidebar-header">
      <a href="index.php" class="brand-logo"><i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span></a>
    </div>

    <div class="sidebar-menu accordion" id="adminMenu">

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu1" aria-expanded="true">
          <span><i class="fa-solid fa-shield-halved category-icon"></i> System & Governance</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu1" class="accordion-collapse collapse show" data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="index.php" class="sub-link">Dashboard</a>
            <a href="user-role-management.php" class="sub-link active">User & Role (IAM)</a>
            
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
            <a href="#" class="sub-link">Smart Quote Intake</a>
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
            <a href="operational-milestone-tracking..php" class="sub-link">Milestone Tracking</a>
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

  <!-- TOP NAVBAR (same pattern as employee-master.php, but IAM title) -->
  <div class="top-navbar">
    <div>
      <h5 class="mb-0 fw-bold text-dark">IAM Security Console</h5>
      <small class="text-muted" style="font-size: 0.7rem;">ACCESS CONTROL, AUDIT & SESSION TRACEABILITY</small>
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

  <!-- MAIN -->
  <div class="main-content px-4 pb-5 position-relative">

    <!-- Tabs header -->
    <div class="bg-white border-bottom px-2 px-md-4 mt-4 rounded-3">
      <ul class="nav nav-tabs smart-tabs" id="securityTabs" role="tablist">
        <li class="nav-item">
          <button class="nav-link active" id="users-tab" data-bs-toggle="tab" data-bs-target="#users" type="button">
            User Management (IAM)
          </button>
        </li>
        <li class="nav-item">
          <button class="nav-link" id="audit-tab" data-bs-toggle="tab" data-bs-target="#audit" type="button">
            Audit Log (Traceability)
          </button>
        </li>
        <li class="nav-item">
          <button class="nav-link" id="sessions-tab" data-bs-toggle="tab" data-bs-target="#sessions" type="button">
            Session Monitor
          </button>
        </li>
      </ul>
    </div>

    <div class="pt-4 tab-content" id="securityTabsContent">

      <!-- USERS -->
      <div class="tab-pane fade show active" id="users" role="tabpanel">
        <div class="card-custom p-4">
          <div class="d-flex justify-content-between align-items-end mb-4">
            <div>
              <h5 class="fw-bold mb-1">User Accounts</h5>
              <p class="text-muted small mb-0">Manage system access, roles, and status.</p>
            </div>
            <button class="btn btn-dark btn-sm fw-bold shadow-sm" data-bs-toggle="offcanvas" data-bs-target="#provisionDrawer">
              <i class="fa-solid fa-user-plus me-2"></i> Provision User
            </button>
          </div>

          <div class="table-responsive">
            <table class="table table-hover table-custom align-middle mb-0">
              <thead class="bg-light">
                <tr>
                  <th>User Identity</th>
                  <th>Assigned Role</th>
                  <th>Authority Level</th>
                  <th>Status</th>
                  <th class="text-end">Actions</th>
                </tr>
              </thead>
              <tbody id="user-table-body"></tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- AUDIT -->
      <div class="tab-pane fade" id="audit" role="tabpanel">
        <div class="alert alert-warning border-0 shadow-sm d-flex align-items-center py-2 mb-4" role="alert">
          <i class="fa-solid fa-triangle-exclamation me-2"></i>
          <small class="fw-bold">Audit Logs are immutable. Records cannot be deleted or modified.</small>
        </div>

        <div class="card-custom p-4">
          <div class="d-flex gap-3 mb-4 flex-wrap">
            <input type="text" class="form-control form-control-sm" style="max-width: 320px;" placeholder="Filter by User ID or Entity...">
            <select class="form-select form-select-sm" style="max-width: 180px;">
              <option>All Actions</option>
              <option>CREATE</option>
              <option>UPDATE</option>
              <option>DELETE</option>
            </select>
          </div>

          <div class="vstack gap-3" id="audit-feed">
            <!-- keep your mock card(s) for now; later you’ll load from DB -->
          </div>
        </div>
      </div>

      <!-- SESSIONS -->
      <div class="tab-pane fade" id="sessions" role="tabpanel">
        <div class="card-custom p-4">
          <div class="table-responsive">
            <table class="table table-hover table-custom align-middle mb-0">
              <thead class="bg-light">
                <tr>
                  <th>User</th>
                  <th>Login Time</th>
                  <th>Device / IP</th>
                  <th>Last Activity</th>
                  <th class="text-end">Status</th>
                </tr>
              </thead>
              <tbody id="session-table-body">
                <!-- keep mock row(s) for now -->
              </tbody>
            </table>
          </div>
        </div>
      </div>

    </div>
  </div>

  <!-- PROVISION OFFCANVAS -->
  <div class="offcanvas offcanvas-end offcanvas-custom smart-offcanvas--medium" tabindex="-1" id="provisionDrawer">
    <div class="offcanvas-header border-bottom bg-light">
      <div>
        <h5 class="offcanvas-title fw-bold">Provision User</h5>
        <small class="text-muted">Link Employee to System Access</small>
      </div>
      <button type="button" class="btn-close" data-bs-dismiss="offcanvas"></button>
    </div>
    <div class="offcanvas-body p-4">
      <form id="provision-form" onsubmit="event.preventDefault(); saveUser();">
        <!-- keep your mock fields for now -->
        <div class="p-3 bg-primary bg-opacity-10 rounded border border-primary border-opacity-25 mb-4">
          <label class="smart-form-label text-primary">1. Select Employee (Source)</label>
          <select id="inp-employee" class="form-select smart-input mb-2">
            <option value="">-- Choose Pending Employee --</option>
            </select>

          <div class="form-text text-muted" style="font-size: 0.75rem;">Only employees without active accounts shown.</div>
        </div>

        <h6 class="smart-form-label border-bottom pb-2 mb-3">2. Access Configuration</h6>

        <div class="mb-3">
          <label class="smart-form-label">System Login (Email)</label>
          <input type="email" id="inp-email" disabled class="form-control smart-input bg-light">
        </div>

        <div class="row g-3 mb-3">
          <div class="col-6">
            <label class="smart-form-label">Primary Role <span class="text-danger">*</span></label>
            <select id="inp-role" class="form-select smart-input">
              <option value="SALES">SALES</option>
              <option value="OPERATIONS">OPERATIONS</option>
              <option value="FINANCE">FINANCE</option>
              <option value="ADMIN">ADMIN</option>
              <option value="MANAGEMENT">MANAGEMENT</option>
            </select>
          </div>
          <div class="col-6">
            <label class="smart-form-label">Initial Status</label>
            <select id="inp-status" class="form-select smart-input">
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
            </select>
          </div>
        </div>

        <div class="mb-4">
          <label class="smart-form-label mb-2">Approval Capabilities</label>
          <div class="border rounded p-3 bg-light">
            <div class="form-check mb-2">
              <input class="form-check-input" type="checkbox" id="authIssuer">
              <label class="form-check-label small" for="authIssuer">ISSUER (Can Draft)</label>
            </div>
            <div class="form-check mb-2">
              <input class="form-check-input" type="checkbox" id="authValidator">
              <label class="form-check-label small" for="authValidator">VALIDATOR (Can Check)</label>
            </div>
            <div class="form-check">
              <input class="form-check-input" type="checkbox" id="authApprover">
              <label class="form-check-label small" for="authApprover">APPROVER (Can Lock)</label>
            </div>
          </div>
        </div>

        <div class="alert alert-warning d-flex align-items-start py-2" style="font-size: 0.8rem;">
          <i class="fa-solid fa-key mt-1 me-2"></i>
          <div>
            <strong>Default Policy:</strong> System generates a temporary password required to change on login.
          </div>
        </div>

        <div class="d-grid mt-4">
          <button type="submit" class="btn btn-dark fw-bold py-2 shadow-lg">Create User Account</button>
        </div>
      </form>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

 <script>
(function IAMPage(){
  const $ = (id) => document.getElementById(id);

  // ---- helpers ----
  function escapeHtml(s){
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    }[c]));
  }

  function badgeStatus(status){
    const s = String(status || '').toUpperCase();
    if (s === 'ACTIVE') return '<span class="badge rounded-pill bg-success bg-opacity-10 text-success">ACTIVE</span>';
    if (s === 'SUSPENDED') return '<span class="badge rounded-pill bg-danger bg-opacity-10 text-danger">SUSPENDED</span>';
    if (s === 'EXITED') return '<span class="badge rounded-pill bg-secondary bg-opacity-10 text-secondary">EXITED</span>';
    if (s === 'PENDING') return '<span class="badge rounded-pill bg-warning bg-opacity-10 text-warning">PENDING</span>';
    if (s === 'NOT_PROVISIONED') return '<span class="badge rounded-pill bg-warning bg-opacity-10 text-warning">NOT PROVISIONED</span>';
    return `<span class="badge rounded-pill bg-light text-dark border">${escapeHtml(s || 'UNKNOWN')}</span>`;
  }

  function parseAuthSet(authStr){
    return String(authStr || '')
      .split(',')
      .map(x => x.trim().toUpperCase())
      .filter(Boolean);
  }

  // ---- endpoints (your saved paths) ----
  const ENDPOINT_PENDING_LIST   = '../../api/employees/pending_users.php';
  const ENDPOINT_PENDING_UPDATE = '../../api/employees/provision_pending_update.php';

  // ---- pending dropdown cache ----
  // user_id -> record {user_id, employee_id, name, email, role, authority, status}
  const pendingIndex = new Map();

  // ---- Load User Accounts table (as you already have) ----
  async function loadUserAccounts(){
    const tbody = $('user-table-body');
    if (!tbody) return;

    try {
      // Your existing endpoint that returns rows with r.user = {user_id, role, authority}
      const res = await fetch(`../../api/employees/list.php`, {
        headers: { 'Accept': 'application/json' },
        credentials: 'same-origin'
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.ok) throw new Error((data && data.message) || 'Failed to load employees');

      const rows = data.rows || [];

      tbody.innerHTML = rows.map(r => {
        const user = r.user || {};
        const provisioned = !!user.user_id;

        const status = provisioned ? (r.status || 'ACTIVE') : 'NOT_PROVISIONED';
        const role = provisioned ? (user.role || '--') : '--';
        const auth = (user.authority && user.authority.trim() !== '') ? user.authority : 'NONE';

        const identity = `
          <div class="fw-bold text-dark">${escapeHtml(r.name)}</div>
          <small class="text-muted">${escapeHtml(r.email)}</small>
          <div class="small text-muted font-monospace mt-1">${escapeHtml(r.id)}</div>
        `;

        const roleBadge = provisioned
          ? `<span class="badge bg-primary bg-opacity-10 text-primary border border-primary border-opacity-25">${escapeHtml(role)}</span>`
          : `<span class="badge bg-light text-dark border">--</span>`;

        const authBadge = `<span class="badge bg-light text-secondary border fw-normal">${escapeHtml(auth)}</span>`;

        const actions = provisioned
          ? `
            <button class="btn btn-sm btn-light text-muted me-1" type="button" data-edit-user="${user.user_id}">
              <i class="fa-solid fa-pen"></i>
            </button>
            <button class="btn btn-sm btn-light text-danger" type="button" data-disable-user="${user.user_id}">
              <i class="fa-solid fa-ban"></i>
            </button>
          `
          : `
            <button class="btn btn-sm btn-light text-muted" type="button" data-open-provision>
              <i class="fa-solid fa-user-plus"></i>
            </button>
          `;

        return `
          <tr>
            <td>${identity}</td>
            <td>${roleBadge}</td>
            <td>${authBadge}</td>
            <td>${badgeStatus(status)}</td>
            <td class="text-end">${actions}</td>
          </tr>
        `;
      }).join('');

    } catch (e) {
      console.error('loadUserAccounts:', e);
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">${escapeHtml(e.message || 'Failed to load')}</td></tr>`;
    }
  }

  // ---- Load Session Monitor table (as you already have) ----
  async function loadSessions(){
    const tbody = $('session-table-body');
    if (!tbody) return;

    try {
      const res = await fetch(`../../api/attendance/admin_register.php`, {
        headers: { 'Accept': 'application/json' },
        credentials: 'same-origin'
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.ok) throw new Error((data && data.message) || 'Failed to load sessions');

      const rows = (data.rows || []).filter(r => r.has_user && r.status);

      tbody.innerHTML = rows.map(r => {
        const isCurrent =
          String(r.status || '').toUpperCase() === 'OPEN' ||
          String(r.attendance_status || '').toUpperCase() === 'ACTIVE';

        const statusBadge = isCurrent
          ? '<span class="badge bg-light text-dark border">Current</span>'
          : `<span class="badge bg-secondary bg-opacity-10 text-secondary">${escapeHtml(r.attendance_status || r.status || 'CLOSED')}</span>`;

        const deviceIp = `${r.device_in || 'Unknown'} / ${r.ip_in || '--'}`;
        const lastActivity = isCurrent ? r.time_in : (r.time_out !== '--' ? r.time_out : r.time_in);

        return `
          <tr>
            <td>
              <div class="d-flex align-items-center">
                <span class="p-1 ${isCurrent ? 'bg-success' : 'bg-secondary'} rounded-circle me-2"></span>
                <div>
                  <div class="fw-bold text-dark">${escapeHtml(r.name || '')}</div>
                  <small class="text-muted">${escapeHtml(r.employee_id || '')}${r.dept ? ' • ' + escapeHtml(r.dept) : ''}</small>
                </div>
              </div>
            </td>
            <td class="text-secondary">${escapeHtml(r.time_in || '--')}</td>
            <td class="small text-muted">${escapeHtml(deviceIp)}</td>
            <td class="text-secondary">${escapeHtml(lastActivity || '--')}</td>
            <td class="text-end">${statusBadge}</td>
          </tr>
        `;
      }).join('');

      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">No sessions found for today.</td></tr>`;
      }

    } catch (e) {
      console.error('loadSessions:', e);
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">${escapeHtml(e.message || 'Failed to load')}</td></tr>`;
    }
  }

  // ---- Provision: load pending users into dropdown ----
  async function loadPendingUsers(){
    const sel = $('inp-employee');
    if (!sel) return;

    sel.innerHTML = `<option value="">-- Choose Pending Employee --</option>`;
    pendingIndex.clear();

    const res = await fetch(ENDPOINT_PENDING_LIST, {
      headers: { 'Accept': 'application/json' },
      credentials: 'same-origin'
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.ok) throw new Error((data && data.message) || 'Failed to load pending users');

    (data.rows || []).forEach(r => {
      const userId = String(r.user_id);
      pendingIndex.set(userId, r);

      // show "Name (ROLE)"
      const label = `${r.name} (${r.role || 'ROLE'})`;

      const opt = document.createElement('option');
      opt.value = userId;
      opt.textContent = label;
      sel.appendChild(opt);
    });
  }

  // ---- Provision: when selecting pending employee, echo DB role + email + authority ----
  function onPendingSelect(){
    const userId = String($('inp-employee')?.value || '');
    const rec = pendingIndex.get(userId);

    const emailEl = $('inp-email');
    const roleEl  = $('inp-role');

    if (!rec) {
      if (emailEl) emailEl.value = '';
      if (roleEl) roleEl.value = 'SALES';
      if ($('authIssuer')) $('authIssuer').checked = true;
      if ($('authValidator')) $('authValidator').checked = false;
      if ($('authApprover')) $('authApprover').checked = false;
      return;
    }

    // email disabled already, just set value
    if (emailEl) emailEl.value = rec.email || '';

    // initial role should echo what is in DB (pending row's role)
    if (roleEl && rec.role) roleEl.value = rec.role;

    // initial status: keep UI dropdown if you still show it, but you said "pending then"
    // If you want status field to always show PENDING, you can force it:
    const statusEl = $('inp-status');
    if (statusEl) statusEl.value = 'ACTIVE'; // user_auth doesn't store status; leave as-is or hide status select

    // authority from DB still editable
    const caps = parseAuthSet(rec.authority);
    if ($('authIssuer')) $('authIssuer').checked = caps.includes('ISSUER') || caps.length === 0;
    if ($('authValidator')) $('authValidator').checked = caps.includes('VALIDATOR');
    if ($('authApprover')) $('authApprover').checked = caps.includes('APPROVER');
  }

  // ---- Provision: submit -> update existing pending user_auth row + reset temp password to "pending" ----
  async function submitProvision(){
    const userId = String($('inp-employee')?.value || '');
    if (!userId) { alert('Please select a pending employee.'); return; }

    const role = $('inp-role')?.value || '';
    if (!role) { alert('Please select a Primary Role.'); return; }

    const authority = [
      $('authIssuer')?.checked ? 'ISSUER' : null,
      $('authValidator')?.checked ? 'VALIDATOR' : null,
      $('authApprover')?.checked ? 'APPROVER' : null,
    ].filter(Boolean);

    try {
      const res = await fetch(ENDPOINT_PENDING_UPDATE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          user_id: Number(userId),
          role,
          authority
        })
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.ok) throw new Error((data && data.message) || 'Provision update failed');

      // close offcanvas
      const drawerEl = document.getElementById('provisionDrawer');
      const drawer = bootstrap.Offcanvas.getInstance(drawerEl);
      if (drawer) drawer.hide();

      // refresh IAM tables
      await loadUserAccounts();
      await loadSessions();

      // reload pending list so the dropdown is current
      await loadPendingUsers();
      onPendingSelect();

      alert('Pending user updated. Temporary password is: pending (user must change on first login).');
    } catch (e) {
      console.error('submitProvision:', e);
      alert(e.message || 'Failed to update pending user.');
    }
  }

  // ---- optional: open provision drawer from action button ----
  function bindProvisionOpen(){
    document.addEventListener('click', function(ev){
      const btn = ev.target.closest('[data-open-provision]');
      if (!btn) return;

      const drawerEl = document.getElementById('provisionDrawer');
      if (!drawerEl) return;

      const drawer = bootstrap.Offcanvas.getOrCreateInstance(drawerEl);
      drawer.show();
    });
  }

  // ---- init ----
  document.addEventListener('DOMContentLoaded', async function(){
    // initial page data
    loadUserAccounts();
    loadSessions();
    bindProvisionOpen();

    // provision drawer bindings
    const sel = $('inp-employee');
    if (sel) sel.addEventListener('change', onPendingSelect);

    // IMPORTANT: your form uses onsubmit="event.preventDefault(); saveUser();"
    // Provide window.saveUser so it works without changing HTML.
    window.saveUser = submitProvision;

    // also provide window.autoFillEmail (your HTML uses it in onchange sometimes)
    window.autoFillEmail = onPendingSelect;

    // load pending users now, and also whenever drawer opens
    try { await loadPendingUsers(); } catch (e) { console.error(e); }

    const drawerEl = document.getElementById('provisionDrawer');
    if (drawerEl) {
      drawerEl.addEventListener('shown.bs.offcanvas', async () => {
        try {
          await loadPendingUsers();
          onPendingSelect();
        } catch (e) {
          console.error(e);
        }
      });
    }
  });

})();
</script>



</body>
</html>
