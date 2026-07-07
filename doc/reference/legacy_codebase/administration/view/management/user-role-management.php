<?php
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['MANAGEMENT']); // keep ADMIN only for IAM console

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
        <a href="index" class="brand-logo"><i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span></a>
    </div>

    <div class="px-3 mb-2 mt-2">
        <a href="index" class="btn btn-primary w-100 text-start d-flex align-items-center" style="background-color: transparent; color: inherit; border: none; padding-left: 0;">
            <i class="fa-solid fa-house category-icon me-2"></i> 
            <span class="fw-bold">Management Dashboard</span> 
        </a>
    </div>

    <div class="sidebar-menu accordion" id="mgmtMenu">
        
        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#mgmt1">
                <span><i class="fa-solid fa-database category-icon"></i> MASTER DATA MGMT</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="mgmt1" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
                <div class="sub-menu">
                    <a href="client-master-registry.php" class="sub-link">Client Master Registry</a>
                    <a href="supplier-master-registry.php" class="sub-link">Supplier Master Registry</a>
                    <a href="employee-master.php" class="sub-link">Employee Master Registry</a>
                    <a href="financial-dictionary.php" class="sub-link">Financial Dictionary</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#mgmt2">
                <span><i class="fa-solid fa-users category-icon"></i>CRM & ACQUISITION</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="mgmt2" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
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
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#mgmt3">
                <span><i class="fa-solid fa-calculator category-icon"></i>COMMERCIAL & PRICING</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="mgmt3" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
                <div class="sub-menu">
                    <a href="margin-simulator-billing.php" class="sub-link">Margin Simulator & Pricing System</a>
                    <a href="extra-charges-simulator.php" class="sub-link">Extra Charges Simulator</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#mgmt4">
                <span><i class="fa-solid fa-truck-fast category-icon"></i>LOGISTICS OPERATIONS</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="mgmt4" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
                <div class="sub-menu">
                    <a href="operations-registry.php" class="sub-link">Operations File Registry</a>
                    <a href="transit-order.php" class="sub-link">Transit Order (OT)</a>
                    <a href="operational-milestone-tracking.php" class="sub-link">Operational Milestone Tracking</a>
                    <a href="delivery-note.php" class="sub-link">Delivery Note</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#mgmt5">
                <span><i class="fa-solid fa-chart-line category-icon"></i>JOB COST CONTROL</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="mgmt5" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
                <div class="sub-menu">
                    <a href="costing-module.php" class="sub-link">Costing Module</a>
                    <a href="cost-tracking.php" class="sub-link">Cost Tracking Master</a>
                    <a href="operational-cost-reconciliation.php" class="sub-link">Operational Cost Reconciliation</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#mgmt6">
                <span><i class="fa-solid fa-building-columns category-icon"></i>FINANCE & TREASURY</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="mgmt6" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
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
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#mgmt7">
                <span><i class="fa-solid fa-folder-open category-icon"></i>HR & ARCHIVE</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="mgmt7" class="accordion-collapse collapse show" data-bs-parent="#mgmtMenu">
                <div class="sub-menu">
                    <a href="user-role-management.php" class="sub-link active">User & Role Management (IAM)</a>
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
            <button class="btn btn-dark btn-sm fw-bold shadow-sm d-none" data-bs-toggle="offcanvas" data-bs-target="#provisionDrawer">
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
          <button type="submit" class="btn btn-dark fw-bold py-2 shadow-lg d-none">Create User Account</button>
        </div>
      </form>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

 <script>
(function IAMPage(){
  // --- 1. SETUP & HELPERS ---
  const $ = (id) => document.getElementById(id);
  
  // CACHE: We store user data here so "Edit" doesn't need to fetch from DB again
  const activeUserIndex = new Map();
  const pendingIndex = new Map();

  const ENDPOINT_PENDING_LIST   = '../../api/employees/pending_users.php';
  const ENDPOINT_PENDING_UPDATE = '../../api/employees/provision_pending_update.php';

  function escapeHtml(s){
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    }[c]));
  }

  function badgeStatus(status){
    const s = String(status || '').toUpperCase();
    if (s === 'ACTIVE') return '<span class="badge rounded-pill bg-success bg-opacity-10 text-success">ACTIVE</span>';
    if (s === 'SUSPENDED') return '<span class="badge rounded-pill bg-danger bg-opacity-10 text-danger">SUSPENDED</span>';
    if (s === 'PENDING') return '<span class="badge rounded-pill bg-warning bg-opacity-10 text-warning">PENDING</span>';
    if (s === 'NOT_PROVISIONED') return '<span class="badge rounded-pill bg-warning bg-opacity-10 text-warning">NOT PROVISIONED</span>';
    return `<span class="badge rounded-pill bg-light text-dark border">${escapeHtml(s || 'EXITED')}</span>`;
  }

  function parseAuthSet(authStr){
    return String(authStr || '').split(',').map(x => x.trim().toUpperCase()).filter(Boolean);
  }

  // --- 2. LOAD TABLES ---
  async function loadUserAccounts(){
    const tbody = $('user-table-body');
    if (!tbody) return;

    try {
      const res = await fetch(`../../api/employees/list.php`, { headers: { 'Accept': 'application/json' }, credentials: 'same-origin' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.ok) throw new Error((data && data.message) || 'Failed to load employees');

      activeUserIndex.clear(); // Clear cache before refilling

      tbody.innerHTML = (data.rows || []).map(r => {
        const user = r.user || {};
        const provisioned = !!user.user_id;

        // SAVE TO CACHE if provisioned
        if(provisioned) activeUserIndex.set(String(user.user_id), r);

        const status = provisioned ? (r.status || 'ACTIVE') : 'NOT_PROVISIONED';
        const role = provisioned ? (user.role || '--') : '--';
        const auth = (user.authority && user.authority.trim()) ? user.authority : 'NONE';

        const actions = provisioned
          ? `
            <button class="btn btn-sm btn-light text-muted me-1" type="button" data-edit-user="${user.user_id}" title="Edit Role">
              <i class="fa-solid fa-pen"></i>
            </button>
            <button class="btn btn-sm btn-light text-danger" type="button" data-disable-user="${user.user_id}" title="Suspend Access">
              <i class="fa-solid fa-ban"></i>
            </button>
          `
          : `
            <button class="btn btn-sm btn-light text-muted" type="button" data-open-provision title="Provision User">
              <i class="fa-solid fa-user-plus"></i>
            </button>
          `;

        return `
          <tr>
            <td>
                <div class="fw-bold text-dark">${escapeHtml(r.name)}</div>
                <small class="text-muted">${escapeHtml(r.email)}</small>
            </td>
            <td><span class="badge bg-primary bg-opacity-10 text-primary border border-primary border-opacity-25">${escapeHtml(role)}</span></td>
            <td><span class="badge bg-light text-secondary border fw-normal">${escapeHtml(auth)}</span></td>
            <td>${badgeStatus(status)}</td>
            <td class="text-end">${actions}</td>
          </tr>
        `;
      }).join('');
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">${escapeHtml(e.message)}</td></tr>`;
    }
  }

  // --- 3. DRAWER & FORM LOGIC ---
  async function loadPendingUsers(){
    const sel = $('inp-employee');
    if (!sel) return;
    sel.innerHTML = `<option value="">-- Choose Pending Employee --</option>`;
    pendingIndex.clear();

    const res = await fetch(ENDPOINT_PENDING_LIST);
    const data = await res.json().catch(() => ({}));
    (data.rows || []).forEach(r => {
      const uid = String(r.user_id);
      pendingIndex.set(uid, r);
      const opt = document.createElement('option');
      opt.value = uid;
      opt.textContent = `${r.name} (${r.role})`;
      sel.appendChild(opt);
    });
  }

  function onPendingSelect(){
    const userId = String($('inp-employee')?.value || '');
    const rec = pendingIndex.get(userId);
    const emailEl = $('inp-email');
    const roleEl  = $('inp-role');

    if (!rec) { if (emailEl) emailEl.value = ''; return; }
    if (emailEl) emailEl.value = rec.email || '';
    if (roleEl && rec.role) roleEl.value = rec.role;

    const caps = parseAuthSet(rec.authority);
    if($('authIssuer')) $('authIssuer').checked = caps.includes('ISSUER') || !caps.length;
    if($('authValidator')) $('authValidator').checked = caps.includes('VALIDATOR');
    if($('authApprover')) $('authApprover').checked = caps.includes('APPROVER');
  }

  // --- 4. ACTION HANDLERS ---
  
  // Handler for EDIT button
  function openEditUser(userId) {
    const record = activeUserIndex.get(String(userId));
    if(!record) { alert("User data missing. Refreshing..."); loadUserAccounts(); return; }

    const sel = $('inp-employee');
    // Inject existing user into dropdown so we can select them
    sel.innerHTML = `<option value="${userId}" selected>${escapeHtml(record.name)} (EDITING)</option>`;
    
    // Add to pending index so onPendingSelect() can find the data
    pendingIndex.set(String(userId), {
        email: record.email,
        role: record.user.role,
        authority: record.user.authority,
        name: record.name
    });

    onPendingSelect(); // Fill form
    const drawer = bootstrap.Offcanvas.getOrCreateInstance($('provisionDrawer'));
    drawer.show();
  }

  // Handler for SAVE/SUBMIT
  async function submitProvision(){
    const userId = String($('inp-employee')?.value || '');
    if (!userId) { alert('Please select a user.'); return; }

    const authority = [
      $('authIssuer')?.checked ? 'ISSUER' : null,
      $('authValidator')?.checked ? 'VALIDATOR' : null,
      $('authApprover')?.checked ? 'APPROVER' : null,
    ].filter(Boolean);

    if(!confirm("Update this user's access and reset their activation status?")) return;

    try {
      const res = await fetch(ENDPOINT_PENDING_UPDATE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: Number(userId),
          role: $('inp-role').value,
          authority
        })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.message || 'Update failed');

      bootstrap.Offcanvas.getInstance($('provisionDrawer')).hide();
      await loadUserAccounts();
      alert('Success: User updated. Activation email sent.');
    } catch (e) {
      alert(e.message);
    }
  }

  // --- 5. GLOBAL LISTENER (The Fix for Dead Buttons) ---
  document.addEventListener('click', function(ev){
    // A. Open Provision (New)
    if (ev.target.closest('[data-open-provision]')) {
         loadPendingUsers().then(() => {
             bootstrap.Offcanvas.getOrCreateInstance($('provisionDrawer')).show();
         });
    }
    
    // B. Edit User
    const editBtn = ev.target.closest('[data-edit-user]');
    if (editBtn) {
        openEditUser(editBtn.dataset.editUser);
    }

    // C. Disable/Suspend User (PATCHED)
    const stopBtn = ev.target.closest('[data-disable-user]');
    if (stopBtn) {
        const uid = stopBtn.dataset.disableUser;
        const reason = prompt("CONFIRM SUSPENSION:\n\nEnter the reason for suspending this user (e.g., 'Policy violation', 'Resigned'):");
        
        if (reason) {
            fetch('../../api/employees/suspend.php', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ user_id: uid, reason: reason })
            })
            .then(res => res.json())
            .then(data => {
                if(!data.ok) throw new Error(data.message || 'Error');
                alert("User suspended successfully.");
                loadUserAccounts(); // Refresh table
            })
            .catch(e => alert(e.message));
        }
    }
  });

  // --- 6. INIT ---
  document.addEventListener('DOMContentLoaded', () => {
    loadUserAccounts();
    const sel = $('inp-employee');
    if (sel) sel.addEventListener('change', onPendingSelect);
    
    // Expose for HTML onsubmit
    window.saveUser = submitProvision;
  });

})();
</script>



</body>
</html>
