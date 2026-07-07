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

// --- Safe display values ---
$fullName  = $me['full_name'] ?: 'Admin';
$firstName = trim(explode(' ', $fullName)[0] ?? 'Admin');

$roleLabelMap = [
  'ADMIN'      => 'SYSTEM ADMIN',
  'FINANCE'    => 'FINANCE',
  'SALES'      => 'SALES',
  'OPERATIONS' => 'OPERATIONS',
  'MANAGEMENT' => 'MANAGEMENT',
];
$role      = strtoupper((string)($me['role'] ?? 'ADMIN'));
$roleLabel = $roleLabelMap[$role] ?? 'ADMIN';

// --- Avatar: UI Avatars based on name ---
$avatarName = urlencode($fullName);
$avatarUrl  = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";

// --- Greeting based on server time ---
$hour     = (int)date('H');
$greeting = ($hour < 12) ? 'Good morning' : (($hour < 18) ? 'Good afternoon' : 'Good evening');

function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }

$currentPage = strtolower(basename($_SERVER['PHP_SELF'] ?? ''));
function is_active(string $file, string $currentPage): string {
  return strtolower($file) === $currentPage ? ' active' : '';
}
function is_finance_open(string $currentPage): bool {
  // Expand Finance menu when on finance-ish pages (adjust as you grow the module)
  $financePages = [
    'costing-module.php',
    'cash-request.php',
    'margin-simulator-billing.php',
    'margin-smart-receivables-ledger.php',
    'margin-smart-receivables-ledger.php',
    'margin-smart-receivables-ledger.php',
  ];
  return in_array($currentPage, array_map('strtolower', $financePages), true);
}
$financeOpen = is_finance_open($currentPage);
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Smart Receivables Ledger | Smart LS</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
</head>

<body>

  <!-- SIDEBAR (same as index.php) -->
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
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#admin2">
                <span><i class="fa-solid fa-users category-icon"></i> CRM & ACQUISITION</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="admin2" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
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
  <!-- TOP NAVBAR (same as index.php) -->
  <div class="top-navbar">
    <div>
      <h5 class="mb-0 fw-bold text-dark">Finance & Billing</h5>
      <small class="text-muted" style="font-size: 0.7rem;">SMART RECEIVABLES LEDGER</small>
    </div>

    <div class="d-flex align-items-center gap-4">
      <div class="clock-pill">
        <span id="realtime-clock" style="font-family: monospace;">12:00:00</span>
        <button class="btn-clock" id="btn-clock" type="button" onclick="toggleClock()">
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

  <!-- MAIN CONTENT -->
  <div class="main-content px-4 pb-5">

    <div class="row pt-4 mb-4">
      <div class="col-12">
        <div class="welcome-card d-flex justify-content-between align-items-center">
          <div>
            <h2 class="fw-bold mb-1"><?php echo e($greeting); ?>, <?php echo e($firstName); ?>!</h2>
            <p class="mb-0 opacity-75">Review outstanding receivables, overdue exposure, and collection status.</p>
          </div>
          <div class="text-end" style="min-width: 240px;">
            <div class="mb-1 text-uppercase text-white-50" style="font-size: 0.7rem; font-weight: 800;">Ledger Controls</div>
            <div class="d-flex align-items-center justify-content-end gap-2">
              <i class="fa-solid fa-shield-check text-success fs-5"></i>
              <span class="fw-bold fs-6">AUDITABLE</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Filters -->
    <div class="row mb-3">
      <div class="col-12">
        <div class="card-custom p-3">
          <div class="d-flex flex-wrap gap-2 align-items-end">
            <div class="me-2">
              <label class="form-label mb-1" style="font-size: .8rem;">From</label>
              <input type="date" id="f_from" class="form-control form-control-sm">
            </div>
            <div class="me-2">
              <label class="form-label mb-1" style="font-size: .8rem;">To</label>
              <input type="date" id="f_to" class="form-control form-control-sm">
            </div>
            <div class="me-2" style="min-width: 220px;">
              <label class="form-label mb-1" style="font-size: .8rem;">Client / Company</label>
              <input type="text" id="f_client" class="form-control form-control-sm" placeholder="Search client...">
            </div>
            <div class="me-2" style="min-width: 180px;">
              <label class="form-label mb-1" style="font-size: .8rem;">Status</label>
              <select id="f_status" class="form-select form-select-sm">
                <option value="">All</option>
                <option value="OUTSTANDING">Outstanding</option>
                <option value="OVERDUE">Overdue</option>
                <option value="PART_PAID">Part Paid</option>
                <option value="PAID">Paid</option>
                <option value="DISPUTED">Disputed</option>
              </select>
            </div>

            <div class="ms-auto d-flex gap-2">
              <button class="btn btn-sm btn-outline-dark fw-bold" type="button" onclick="resetReceivablesFilters()">
                <i class="fa-solid fa-rotate-left me-1"></i> Reset
              </button>
              <button class="btn btn-sm btn-primary fw-bold" type="button" onclick="loadReceivables()">
                <i class="fa-solid fa-magnifying-glass me-1"></i> Apply
              </button>
              <button class="btn btn-sm btn-outline-primary fw-bold" type="button" onclick="exportReceivablesCsv()">
                <i class="fa-solid fa-file-csv me-1"></i> Export
              </button>
            </div>
          </div>
          <small class="text-muted d-block mt-2" style="font-size:.75rem;">
            Note: Hook these filters to your API when ready (date range + client + status).
          </small>
        </div>
      </div>
    </div>

    <!-- KPIs -->
    <div class="row g-3 mb-4">
      <div class="col-3">
        <div class="card-custom p-3 d-flex align-items-center">
          <div class="me-3 rounded-3 bg-primary bg-opacity-10 text-primary d-flex align-items-center justify-content-center"
               style="width: 45px; height: 45px; font-size: 1.2rem;">
            <i class="fa-solid fa-coins"></i>
          </div>
          <div>
            <div class="kpi-title">Total Outstanding</div>
            <div class="kpi-value" id="kpi_outstanding">0.00</div>
          </div>
        </div>
      </div>

      <div class="col-3">
        <div class="card-custom p-3 d-flex align-items-center">
          <div class="me-3 rounded-3 bg-danger bg-opacity-10 text-danger d-flex align-items-center justify-content-center"
               style="width: 45px; height: 45px; font-size: 1.2rem;">
            <i class="fa-solid fa-triangle-exclamation"></i>
          </div>
          <div>
            <div class="kpi-title">Overdue Exposure</div>
            <div class="kpi-value" id="kpi_overdue">0.00</div>
          </div>
        </div>
      </div>

      <div class="col-3">
        <div class="card-custom p-3 d-flex align-items-center">
          <div class="me-3 rounded-3 bg-success bg-opacity-10 text-success d-flex align-items-center justify-content-center"
               style="width: 45px; height: 45px; font-size: 1.2rem;">
            <i class="fa-solid fa-circle-check"></i>
          </div>
          <div>
            <div class="kpi-title">Paid (Period)</div>
            <div class="kpi-value" id="kpi_paid">0.00</div>
          </div>
        </div>
      </div>

      <div class="col-3">
        <div class="card-custom p-3 d-flex align-items-center">
          <div class="me-3 rounded-3 bg-warning bg-opacity-10 text-warning d-flex align-items-center justify-content-center"
               style="width: 45px; height: 45px; font-size: 1.2rem;">
            <i class="fa-solid fa-scale-balanced"></i>
          </div>
          <div>
            <div class="kpi-title">Disputed</div>
            <div class="kpi-value" id="kpi_disputed">0.00</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Ledger Table -->
    <div class="row mb-4">
      <div class="col-12">
        <div class="card-custom p-4">
          <div class="d-flex justify-content-between align-items-center mb-3">
            <h5 class="fw-bold mb-0 text-dark">
              <i class="fa-solid fa-list-check text-primary me-2"></i>Receivables Ledger
            </h5>
            <span class="badge bg-primary rounded-pill" id="ledger_count">0 Records</span>
          </div>

          <div class="table-responsive">
            <table class="table table-hover table-custom mb-0 align-middle">
              <thead class="bg-light">
                <tr>
                  <th style="width: 12%;">Invoice #</th>
                  <th style="width: 20%;">Client</th>
                  <th style="width: 12%;">Invoice Date</th>
                  <th style="width: 12%;">Due Date</th>
                  <th style="width: 10%;">Status</th>
                  <th style="width: 12%;" class="text-end">Amount</th>
                  <th style="width: 12%;" class="text-end">Balance</th>
                  <th style="width: 10%;" class="text-end">Action</th>
                </tr>
              </thead>
              <tbody id="ledger_tbody">
                <tr>
                  <td colspan="8" class="text-center p-4 text-muted">
                    No data loaded yet. Click <strong>Apply</strong> to fetch receivables.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="d-flex justify-content-between align-items-center mt-3">
            <small class="text-muted" style="font-size:.75rem;">
              Recommended: lock invoice identifiers, log status transitions, and require evidence attachments for disputes/adjustments.
            </small>
            <div class="d-flex gap-2">
              <button class="btn btn-sm btn-outline-dark fw-bold" type="button" onclick="prevPage()" disabled>Prev</button>
              <button class="btn btn-sm btn-outline-dark fw-bold" type="button" onclick="nextPage()" disabled>Next</button>
            </div>
          </div>

        </div>
      </div>
    </div>

  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

  <script>
    // Realtime clock (safe fallback even if admin.js already does it)
    (function startClock(){
      const el = document.getElementById('realtime-clock');
      if (!el) return;
      const pad = (n) => String(n).padStart(2,'0');
      const tick = () => {
        const d = new Date();
        el.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      };
      tick();
      setInterval(tick, 1000);
    })();

    // Clock-in button placeholder (wire to your backend when ready)
    function toggleClock() {
      const btn = document.getElementById('btn-clock');
      if (!btn) return;
      const span = btn.querySelector('span');
      const isIn = (btn.dataset.state === 'IN');
      btn.dataset.state = isIn ? 'OUT' : 'IN';
      if (span) span.textContent = isIn ? 'Clock In' : 'Clock Out';
    }

    // Ledger placeholders (wire these to your API)
    function resetReceivablesFilters() {
      document.getElementById('f_from').value = '';
      document.getElementById('f_to').value = '';
      document.getElementById('f_client').value = '';
      document.getElementById('f_status').value = '';
      document.getElementById('ledger_tbody').innerHTML =
        '<tr><td colspan="8" class="text-center p-4 text-muted">Filters cleared. Click <strong>Apply</strong> to fetch receivables.</td></tr>';
      document.getElementById('ledger_count').textContent = '0 Records';
    }

    async function loadReceivables() {
      // TODO: Replace with your endpoint, e.g. ../../api/finance/receivables/list.php
      // const url = new URL('...', window.location.href);
      // url.searchParams.set('from', document.getElementById('f_from').value);
      // ...
      // const res = await fetch(url.toString());
      // const data = await res.json();
      // render rows + KPIs

      // Temporary UI-only demo row
      const tbody = document.getElementById('ledger_tbody');
      tbody.innerHTML = `
        <tr>
          <td class="fw-bold">INV-00021</td>
          <td>Example Client Ltd</td>
          <td class="text-muted">2026-01-02</td>
          <td class="text-muted">2026-01-16</td>
          <td><span class="badge bg-warning text-dark">OUTSTANDING</span></td>
          <td class="text-end">1,250.00</td>
          <td class="text-end fw-bold">1,250.00</td>
          <td class="text-end">
            <button class="btn btn-sm btn-outline-primary fw-bold" type="button">View</button>
          </td>
        </tr>
      `;
      document.getElementById('ledger_count').textContent = '1 Record';
      document.getElementById('kpi_outstanding').textContent = '1,250.00';
      document.getElementById('kpi_overdue').textContent = '0.00';
      document.getElementById('kpi_paid').textContent = '0.00';
      document.getElementById('kpi_disputed').textContent = '0.00';
    }

    function exportReceivablesCsv() {
      // TODO: call your server export or build CSV client-side from loaded rows
      alert('Export hook not wired yet.');
    }

    function prevPage(){ /* TODO */ }
    function nextPage(){ /* TODO */ }
  </script>

</body>
</html>
