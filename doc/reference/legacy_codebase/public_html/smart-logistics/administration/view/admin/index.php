<?php
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN']);

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
$fullName = $me['full_name'] ?: 'Admin';
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

// --- Avatar: UI Avatars based on name (no local image storage needed yet) ---
$avatarName = urlencode($fullName);
$avatarUrl = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";

// --- Greeting based on server time (simple) ---
$hour = (int)date('H');
$greeting = ($hour < 12) ? 'Good morning' : (($hour < 18) ? 'Good afternoon' : 'Good evening');

function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }
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
                        <a href="index.php" class="sub-link active">Dashboard</a>
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
            <button class="btn btn-outline-danger w-100 btn-sm fw-bold"><i class="fa-solid fa-right-from-bracket me-2"></i> Sign Out</button>
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
                        <div class="kpi-value">14</div>
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
                        <div class="kpi-value">3</div>
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
                        <div class="kpi-value">2</div>
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
                        <div class="kpi-value">99.9%</div>
                    </div>
                </div>
            </div>
        </div>

        <div class="row mb-4">
            <div class="col-12">
                <div class="card-custom p-4">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <h5 class="fw-bold mb-0 text-dark"><i class="fa-solid fa-clipboard-check text-primary me-2"></i>Pending Tasks</h5>
                        <span class="badge bg-primary rounded-pill">4 Pending</span>
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
                                    <td class="text-muted">09:15 AM</td>
                                    <td>
                                        <div class="d-flex align-items-center">
                                            <div class="bg-primary text-white rounded-circle d-flex align-items-center justify-content-center me-2" style="width: 24px; height: 24px; font-size: 0.7rem;">SK</div>
                                            <span class="fw-bold">Sarah K.</span>
                                        </div>
                                    </td>
                                    <td>Requested <strong>Password Reset</strong> (Finance Dept)</td>
                                    <td class="text-end"><a class="btn btn-outline-danger w-100 btn-sm fw-bold" href="../../api/auth/logout.php">
                                    <i class="fa-solid fa-right-from-bracket me-2"></i> Sign Out
                                    </a>
                                    </td>
                                </tr>
                                <tr>
                                    <td class="text-muted">08:30 AM</td>
                                    <td>
                                        <div class="d-flex align-items-center">
                                            <div class="bg-dark text-white rounded-circle d-flex align-items-center justify-content-center me-2" style="width: 24px; height: 24px; font-size: 0.7rem;">MR</div>
                                            <span class="fw-bold">Mike Ross</span>
                                        </div>
                                    </td>
                                    <td><strong>Role Elevation</strong> Request (Ops -> Mgr)</td>
                                    <td class="text-end"><button class="btn btn-sm btn-outline-dark py-0 px-3" style="font-size: 0.75rem;">Review</button></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>

        <div class="row mb-4">
            <div class="col-12">
                <div class="card-custom p-4">
                    <h5 class="fw-bold mb-4 text-dark"><i class="fa-solid fa-clock-rotate-left text-primary me-2"></i>Recent System Activity</h5>
                    
                    <div class="d-flex gap-3 mb-3 border-bottom pb-3">
                        <div class="rounded-circle bg-success bg-opacity-10 text-success d-flex align-items-center justify-content-center flex-shrink-0" style="width: 36px; height: 36px;">
                            <i class="fa-solid fa-user-check"></i>
                        </div>
                        <div class="flex-grow-1">
                            <div class="d-flex justify-content-between">
                                <p class="mb-0 fw-bold text-dark fs-6">User Provisioned</p>
                                <small class="text-muted">10:42 AM</small>
                            </div>
                            <p class="text-muted mb-0" style="font-size: 0.85rem;">Admin created account for <span class="fw-bold">Tom D.</span> (Sales).</p>
                        </div>
                    </div>

                    <div class="d-flex gap-3 mb-3 border-bottom pb-3">
                        <div class="rounded-circle bg-warning bg-opacity-10 text-warning d-flex align-items-center justify-content-center flex-shrink-0" style="width: 36px; height: 36px;">
                            <i class="fa-solid fa-lock"></i>
                        </div>
                        <div class="flex-grow-1">
                            <div class="d-flex justify-content-between">
                                <p class="mb-0 fw-bold text-dark fs-6">Failed Login Alert</p>
                                <small class="text-muted">09:55 AM</small>
                            </div>
                            <p class="text-muted mb-0" style="font-size: 0.85rem;">5 attempts from IP 192.168.1.45. Account auto-locked.</p>
                        </div>
                    </div>

                    <div class="d-flex gap-3">
                        <div class="rounded-circle bg-info bg-opacity-10 text-info d-flex align-items-center justify-content-center flex-shrink-0" style="width: 36px; height: 36px;">
                            <i class="fa-solid fa-database"></i>
                        </div>
                        <div class="flex-grow-1">
                            <div class="d-flex justify-content-between">
                                <p class="mb-0 fw-bold text-dark fs-6">Automated Backup</p>
                                <small class="text-muted">02:00 AM</small>
                            </div>
                            <p class="text-muted mb-0" style="font-size: 0.85rem;">Database dump completed successfully (245MB).</p>
                        </div>
                    </div>

                </div>
            </div>
        </div>

    </div>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    <script src="../../js/admin.js"></script>

    
</body>
</html>