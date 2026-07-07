<?php
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['MANAGEMENT']);

// --- Fetch current admin details from DB (authoritative profile) ---
$employeeId = (string)($_SESSION['auth']['employee_id'] ?? '');
$userId     = (int)($_SESSION['auth']['user_id'] ?? 0);

if ($employeeId === '' || $userId <= 0) {
  // session is incomplete; force logout for safety
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
$fullName = $me['full_name'] ?: 'MANAGEMENT';
$firstName = trim(explode(' ', $fullName)[0] ?? 'Admin');

$roleLabelMap = [
  'ADMIN'      => 'SYSTEM ADMIN',
  'FINANCE'    => 'FINANCE',
  'SALES'      => 'SALES',
  'OPERATIONS' => 'OPERATIONS',
  'MANAGEMENT' => 'MANAGEMENT',
];
$role = strtoupper((string)($me['role'] ?? 'MANAGEMENT'));
$roleLabel = $roleLabelMap[$role] ?? 'MANAGEMENT';

// --- Avatar: UI Avatars based on name (no local image storage needed yet) ---
$avatarName = urlencode($fullName);
$avatarUrl = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";

// --- Greeting based on server time (simple) ---
$hour = (int)date('H');
$greeting = ($hour < 12) ? 'Good morning' : (($hour < 18) ? 'Good afternoon' : 'Good evening');

function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }

// ----------------------------------------------------------------------------------
// MVP placeholders (no backend yet): force dashboard metrics to zero
// ----------------------------------------------------------------------------------
$kpi_active_sessions = 0;
$kpi_failed_logins   = 0;
$kpi_suspended_users = 0;
$kpi_api_uptime      = '0%';
$pending_tasks_count = 0;
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Dashboard | Smart LS</title>
    
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="../../css/admin.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
</head>
<body>

<nav class="sidebar">
    <div class="sidebar-header">
        <a href="index" class="brand-logo"><i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span></a>
    </div>

    <div class="px-3 mb-2 mt-2">
        <a href="#" class="btn btn-primary w-100 text-start d-flex align-items-center" style="background-color: transparent; color: inherit; border: none; padding-left: 0;">
            <i class="fa-solid fa-house category-icon me-2"></i> 
            <span class="fw-bold">Management Dashboard</span> 
        </a>
    </div>

    <div class="sidebar-menu accordion" id="mgmtMenu">
        
        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#mgmt1">
                <span><i class="fa-solid fa-database category-icon"></i> 1. MASTER DATA MGMT</span>
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
                <span><i class="fa-solid fa-users category-icon"></i> 2. CRM & ACQUISITION</span>
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
                <span><i class="fa-solid fa-calculator category-icon"></i> 3. COMMERCIAL & PRICING</span>
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
                <span><i class="fa-solid fa-truck-fast category-icon"></i> 4. LOGISTICS OPERATIONS</span>
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
                <span><i class="fa-solid fa-chart-line category-icon"></i> 5. JOB COST CONTROL</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="mgmt5" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
                <div class="sub-menu">
                    <a href="costing-module.php" class="sub-link">Costing Module</a>
                    <a href="cost-tracking.php" class="sub-link">Cost Tracking Master</a>
                    <a href="opportunity-cost-reconciliation.php" class="sub-link">Operational Cost Reconciliation</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#mgmt6">
                <span><i class="fa-solid fa-building-columns category-icon"></i> 6. FINANCE & TREASURY</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="mgmt6" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
                <div class="sub-menu">
                    <a href="cash-request.php" class="sub-link">Cash Request</a>
                    <a href="purchase-order.php" class="sub-link">Purchase Order</a>
                    <a href="performa-invoice-portal.php" class="sub-link">Proforma Invoice Portal</a>
                    <a href="final-invoice.php" class="sub-link">Final Invoice System</a>
                    <a href="smart-receivables-ledger.php" class="sub-link">Smart Receivables Ledger (SRL)</a>
                    <a href="debt-management.php" class="sub-link">Debt Management</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#mgmt7">
                <span><i class="fa-solid fa-folder-open category-icon"></i> 7. HR & ARCHIVE</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="mgmt7" class="accordion-collapse collapse" data-bs-parent="#mgmtMenu">
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
      <h5 class="mb-0 fw-bold text-dark">Admin Governance</h5>
      <small class="text-muted" style="font-size: 0.7rem;">SYSTEM HEALTH & SECURITY OVERSIGHT</small>
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

  <div class="row pt-4 mb-4">
      <div class="col-12">
          <div class="welcome-card d-flex justify-content-between align-items-center">
              <div>
                  <h2 class="fw-bold mb-1"><?php echo e($greeting); ?>, <?php echo e($firstName); ?>!</h2>
                  <p class="mb-0 opacity-75">System Integrity check complete. Here is the governance status for today.</p>
              </div>
              <div class="text-end" style="min-width: 150px;">
                  <div class="mb-1 text-uppercase text-white-50" style="font-size: 0.7rem; font-weight: 800;">System Heartbeat</div>
                  <div class="d-flex align-items-center justify-content-end gap-2">
                      <i class="fa-solid fa-circle-check text-success fs-5"></i>
                      <span class="fw-bold fs-5">ONLINE</span>
                  </div>
              </div>
          </div>
      </div>
  </div>

  <div class="row g-3 mb-4">
      <div class="col-3">
          <div class="card-custom p-3 d-flex align-items-center">
              <div class="me-3 rounded-3 bg-primary bg-opacity-10 text-primary d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
                  <i class="fa-solid fa-network-wired"></i>
              </div>
              <div>
                  <div class="kpi-title">Active Sessions</div>
                  <div class="kpi-value"><?php echo (int)$kpi_active_sessions; ?></div>
              </div>
          </div>
      </div>
      <div class="col-3">
          <div class="card-custom p-3 d-flex align-items-center">
              <div class="me-3 rounded-3 bg-danger bg-opacity-10 text-danger d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
                  <i class="fa-solid fa-user-shield"></i>
              </div>
              <div>
                  <div class="kpi-title">Failed Logins</div>
                  <div class="kpi-value"><?php echo (int)$kpi_failed_logins; ?></div>
              </div>
          </div>
      </div>
      <div class="col-3">
          <div class="card-custom p-3 d-flex align-items-center">
              <div class="me-3 rounded-3 bg-warning bg-opacity-10 text-warning d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
                  <i class="fa-solid fa-ban"></i>
              </div>
              <div>
                  <div class="kpi-title">Suspended Users</div>
                  <div class="kpi-value"><?php echo (int)$kpi_suspended_users; ?></div>
              </div>
          </div>
      </div>
      <div class="col-3">
          <div class="card-custom p-3 d-flex align-items-center">
              <div class="me-3 rounded-3 bg-success bg-opacity-10 text-success d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
                  <i class="fa-solid fa-server"></i>
              </div>
              <div>
                  <div class="kpi-title">API Uptime</div>
                  <div class="kpi-value"><?php echo e($kpi_api_uptime); ?></div>
              </div>
          </div>
      </div>
  </div>

  <div class="row mb-4">
      <div class="col-12">
          <div class="card-custom p-4">
              <div class="d-flex justify-content-between align-items-center mb-3">
                  <h5 class="fw-bold mb-0 text-dark"><i class="fa-solid fa-clipboard-check text-primary me-2"></i>Pending Tasks</h5>
                  <span class="badge bg-primary rounded-pill"><?php echo (int)$pending_tasks_count; ?> Pending</span>
              </div>
              <div class="table-responsive">
                  <table class="table table-hover table-custom mb-0">
                      <thead class="bg-light">
                          <tr>
                              <th style="width: 15%;">Time</th>
                              <th style="width: 25%;">Requestor</th>
                              <th style="width: 45%;">Task Description</th>
                              <th style="width: 15%;" class="text-end">Action</th>
                          </tr>
                      </thead>
                      <tbody>
                          <tr>
                              <td colspan="4" class="text-center text-muted py-4">
                                  Your upcoming tasks will appear here.
                              </td>
                          </tr>
                      </tbody>
                  </table>
              </div>
          </div>
      </div>
  </div>

  <!-- Leave Recent System Activity section unchanged per your instruction -->
  <!--<div class="row mb-4">-->
  <!--    <div class="col-12">-->
  <!--        <div class="card-custom p-4">-->
  <!--            <h5 class="fw-bold mb-4 text-dark"><i class="fa-solid fa-clock-rotate-left text-primary me-2"></i>Recent System Activity</h5>-->

  <!--            <div class="d-flex gap-3 mb-3 border-bottom pb-3">-->
  <!--                <div class="rounded-circle bg-success bg-opacity-10 text-success d-flex align-items-center justify-content-center flex-shrink-0" style="width: 36px; height: 36px;">-->
  <!--                    <i class="fa-solid fa-user-check"></i>-->
  <!--                </div>-->
  <!--                <div class="flex-grow-1">-->
  <!--                    <div class="d-flex justify-content-between">-->
  <!--                        <p class="mb-0 fw-bold text-dark fs-6">User Provisioned</p>-->
  <!--                        <small class="text-muted">10:42 AM</small>-->
  <!--                    </div>-->
  <!--                    <p class="text-muted mb-0" style="font-size: 0.85rem;">Admin created account for <span class="fw-bold">Tom D.</span> (Sales).</p>-->
  <!--                </div>-->
  <!--            </div>-->

  <!--            <div class="d-flex gap-3 mb-3 border-bottom pb-3">-->
  <!--                <div class="rounded-circle bg-warning bg-opacity-10 text-warning d-flex align-items-center justify-content-center flex-shrink-0" style="width: 36px; height: 36px;">-->
  <!--                    <i class="fa-solid fa-lock"></i>-->
  <!--                </div>-->
  <!--                <div class="flex-grow-1">-->
  <!--                    <div class="d-flex justify-content-between">-->
  <!--                        <p class="mb-0 fw-bold text-dark fs-6">Failed Login Alert</p>-->
  <!--                        <small class="text-muted">09:55 AM</small>-->
  <!--                    </div>-->
  <!--                    <p class="text-muted mb-0" style="font-size: 0.85rem;">5 attempts from IP 192.168.1.45. Account auto-locked.</p>-->
  <!--                </div>-->
  <!--            </div>-->

  <!--            <div class="d-flex gap-3">-->
  <!--                <div class="rounded-circle bg-info bg-opacity-10 text-info d-flex align-items-center justify-content-center flex-shrink-0" style="width: 36px; height: 36px;">-->
  <!--                    <i class="fa-solid fa-database"></i>-->
  <!--                </div>-->
  <!--                <div class="flex-grow-1">-->
  <!--                    <div class="d-flex justify-content-between">-->
  <!--                        <p class="mb-0 fw-bold text-dark fs-6">Automated Backup</p>-->
  <!--                        <small class="text-muted">02:00 AM</small>-->
  <!--                    </div>-->
  <!--                    <p class="text-muted mb-0" style="font-size: 0.85rem;">Database dump completed successfully (245MB).</p>-->
  <!--                </div>-->
  <!--            </div>-->

  <!--        </div>-->
  <!--    </div>-->
  <!--</div>-->

</div>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
<script src="../../js/admin.js"></script>

</body>
</html>
