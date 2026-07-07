<?php
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['FINANCE']);

/* ---------------------------------------------------------------------
   Fetch logged-in FINANCE user (same pattern as ADMIN)
   --------------------------------------------------------------------- */
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
    ua.role
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

function e(string $v): string {
    return htmlspecialchars($v, ENT_QUOTES, 'UTF-8');
}

$fullName  = trim($me['full_name'] ?? 'Finance User');
$firstName = explode(' ', $fullName)[0];

$jobTitle  = trim($me['job_title'] ?? '');
$role      = strtoupper($me['role'] ?? 'FINANCE');
$topTitle  = $jobTitle !== '' ? $jobTitle : $role;

$avatarUrl = 'https://ui-avatars.com/api/?name=' . urlencode($fullName) . '&background=055B83&color=fff';

$hour = (int)date('H');
$greeting = ($hour < 12) ? 'Good morning' : (($hour < 18) ? 'Good afternoon' : 'Good evening');
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Finance Dashboard | Smart LS</title>

    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="../../css/admin.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
</head>

<body>

<nav class="sidebar">
    <div class="sidebar-header">
        <a href="#" class="brand-logo">
            <i class="fa-solid fa-cube text-primary me-2"></i>
            SMART <span style="color:#EE7D04;">LS</span>
        </a>
    </div>

    <nav class="sidebar">
        <div class="sidebar-header">
            <a href="#" class="brand-logo"><i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span></a>
        </div>
        
        <div class="sidebar-menu accordion" id="financeMenu">
            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu1">
                    <span><i class="fa-solid fa-house category-icon"></i> Home</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu1" class="accordion-collapse collapse show" data-bs-parent="#financeMenu">
                    <div class="sub-menu">
                        <a href="index.php" class="sub-link btn-primary ">Dashboards & KPI</a>
                    </div>
                </div>
            </div>
            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu2">
                    <span><i class="fa-solid fa-database category-icon"></i> Master Data</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu2" class="accordion-collapse collapse " data-bs-parent="#financeMenu">
                    <div class="sub-menu">
                         <a href="attendance-logs.php" class="sub-link">Attendance Logs</a>
                        <a href="client-master-registry.php" class="sub-link">Client Master</a>
                        <a href="supplier-master-registry.php" class="sub-link">Supplier Master</a>
                        <a href="employee-master.php" class="sub-link ">Employee Master</a>
                        
                        <a href="financial-dictionary.php" class="sub-link">Financial Dictionary</a>
                    </div>
                </div>
            </div>
             <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#fmenu1">
          <span><i class="fa-solid fa-house category-icon"></i> Employee Management</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="fmenu1" class="accordion-collapse collapse " data-bs-parent="#financeMenu">
          <div class="sub-menu">
            <a href="payroll-management.php" class="sub-link ">Payroll Management</a>
          </div>
        </div>
      </div>
            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu3">
                    <span><i class="fa-solid fa-cart-shopping category-icon"></i> Procurement (AP)</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu3" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                    <div class="sub-menu">
                        <a href="purchase-order.php" class="sub-link">Purchase Orders</a>
                        <a href="#" class="sub-link">Expenditure Journal</a>
                        <a href="#" class="sub-link">Cash Request Workflow</a>
                    </div>
                </div>
            </div>
            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu4">
                    <span><i class="fa-solid fa-file-invoice-dollar category-icon"></i> Billing (AR)</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu4" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                    <div class="sub-menu">
                        <a href="#" class="sub-link">Proforma / Advance</a>
                        <a href="#" class="sub-link">Final Invoice Module</a>
                        <a href="#" class="sub-link">Receipts & Allocation</a>
                        <a href="#" class="sub-link">Collections & Reminders</a>
                    </div>
                </div>
            </div>
            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu5">
                    <span><i class="fa-solid fa-chart-line category-icon"></i> Costing & Profit</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu5" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                    <div class="sub-menu">
                        <a href="#" class="sub-link">Costing Module</a>
                        <a href="#" class="sub-link">Actual Margin Tracker</a>
                    </div>
                </div>
            </div>
            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu6">
                    <span><i class="fa-solid fa-triangle-exclamation category-icon"></i> Exposure & Risk</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu6" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                    <div class="sub-menu">
                        <a href="#" class="sub-link">Client Exposure</a>
                        <a href="#" class="sub-link">Ops Cost Coverage</a>
                    </div>
                </div>
            </div>
            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu7">
                    <span><i class="fa-solid fa-folder-tree category-icon"></i> Docs & Outputs</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu7" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                    <div class="sub-menu">
                        <a href="#" class="sub-link">Document Vault</a>
                        <a href="#" class="sub-link">Accounting Exports</a>
                    </div>
                </div>
            </div>
        </div>

        <div class="sidebar-footer">
            <button class="btn btn-outline-danger w-100 btn-sm fw-bold"><i class="fa-solid fa-right-from-bracket me-2"></i> Sign Out</button>
        </div>
    </nav>

    
</nav>

<div class="top-navbar">
    <div>
        <h5 class="mb-0 fw-bold text-dark">Finance Control</h5>
        <small class="text-muted" style="font-size:0.7rem;">FINANCIAL CONTROL & REPORTING</small>
    </div>

    <div class="d-flex align-items-center gap-4">
        <div class="clock-pill">
            <span id="realtime-clock" style="font-family:monospace;">12:00:00</span>
            <button class="btn-clock" onclick="toggleClock()">
                <i class="fa-solid fa-fingerprint"></i> <span>Clock In</span>
            </button>
        </div>

        <div class="d-flex align-items-center gap-3 ps-3 border-start">
            <div class="text-end lh-1 d-none d-md-block">
                <div class="fw-bold fs-6"><?php echo e($fullName); ?></div>
                <small class="text-secondary fw-bold" style="font-size:0.65rem;letter-spacing:0.5px;">
                    <?php echo e($topTitle); ?>
                </small>
            </div>
            <img src="<?php echo e($avatarUrl); ?>"
                 class="rounded-circle shadow-sm"
                 width="38" height="38"
                 alt="<?php echo e($firstName); ?>">
        </div>
    </div>
</div>

<div class="main-content px-4 pb-5">

    <div class="row pt-4 mb-4">
        <div class="col-12">
            <div class="welcome-card d-flex justify-content-between align-items-center">
                <div>
                    <h2 class="fw-bold mb-1">
                        <?php echo e($greeting); ?>, <?php echo e($firstName); ?>!
                    </h2>
                    <p class="mb-0 opacity-75">Here is what is happening in Finance today.</p>
                </div>
                <div class="text-end">
                    <div class="text-uppercase text-white-50 fw-bold" style="font-size:0.7rem;">Period Status</div>
                    <div class="fw-bold fs-5">
                        <i class="fa-solid fa-lock-open text-info me-1"></i> OCT OPEN
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div class="row g-3 mb-4">
            <div class="col-3">
                <div class="card-custom p-3 d-flex align-items-center">
                    <div class="me-3 rounded-3 bg-warning bg-opacity-10 text-warning d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
                        <i class="fa-solid fa-hourglass-half"></i>
                    </div>
                    <div>
                        <div class="kpi-title">Receivables</div>
                        <div class="kpi-value">45.2M <span class="currency">XAF</span></div>
                    </div>
                </div>
            </div>
            <div class="col-3">
                <div class="card-custom p-3 d-flex align-items-center">
                    <div class="me-3 rounded-3 bg-danger bg-opacity-10 text-danger d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
                        <i class="fa-solid fa-circle-exclamation"></i>
                    </div>
                    <div>
                        <div class="kpi-title">Overdue (>60d)</div>
                        <div class="kpi-value text-danger">8.5M <span class="currency">XAF</span></div>
                    </div>
                </div>
            </div>
            <div class="col-3">
                <div class="card-custom p-3 d-flex align-items-center">
                    <div class="me-3 rounded-3 bg-success bg-opacity-10 text-success d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
                        <i class="fa-solid fa-sack-dollar"></i>
                    </div>
                    <div>
                        <div class="kpi-title">Cash In (MTD)</div>
                        <div class="kpi-value text-success">12.1M <span class="currency">XAF</span></div>
                    </div>
                </div>
            </div>
            <div class="col-3">
                <div class="card-custom p-3 d-flex align-items-center">
                    <div class="me-3 rounded-3 bg-primary bg-opacity-10 text-primary d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
                        <i class="fa-solid fa-file-invoice"></i>
                    </div>
                    <div>
                        <div class="kpi-title">Invoices to Pay</div>
                        <div class="kpi-value">6 <span class="currency" style="font-weight: 400; font-size: 0.7rem;">(3.2M)</span></div>
                    </div>
                </div>
            </div>
        </div>

        <div class="row mb-4">
            <div class="col-12">
                <div class="card-custom p-4">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <h5 class="fw-bold mb-0 text-dark"><i class="fa-solid fa-list-check text-primary me-2"></i>Pending Finance Tasks</h5>
                        <button class="btn btn-sm btn-light border text-muted fw-bold">View All</button>
                    </div>
                    <div class="table-responsive">
                        <table class="table table-hover table-custom mb-0">
                            <thead class="bg-light">
                                <tr>
                                    <th style="width: 15%;">Date</th>
                                    <th style="width: 25%;">Related Entity</th>
                                    <th style="width: 40%;">Task Description</th>
                                    <th style="width: 10%;" class="text-end">Amount</th>
                                    <th style="width: 10%;" class="text-end">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td class="text-muted">Today</td>
                                    <td><span class="fw-bold">Mike R. (Ops)</span> <small class="text-muted d-block">SL24010045</small></td>
                                    <td><span class="badge bg-warning text-dark me-2">Approval</span> Approve Cash Request for Port Handling</td>
                                    <td class="text-end fw-bold">150,000</td>
                                    <td class="text-end"><button class="btn btn-sm btn-primary py-0 px-3" style="font-size: 0.75rem;">Validate</button></td>
                                </tr>
                                <tr>
                                    <td class="text-muted">Yesterday</td>
                                    <td><span class="fw-bold">TotalEnergies</span> <small class="text-muted d-block">Client Master</small></td>
                                    <td><span class="badge bg-danger bg-opacity-10 text-danger me-2">Upload</span> Upload Proof of Receipt (Payment #889)</td>
                                    <td class="text-end fw-bold text-success">2.4M</td>
                                    <td class="text-end"><button class="btn btn-sm btn-outline-dark py-0 px-3" style="font-size: 0.75rem;">Upload</button></td>
                                </tr>
                                <tr>
                                    <td class="text-muted">Oct 24</td>
                                    <td><span class="fw-bold">Logistics Co.</span> <small class="text-muted d-block">Purchase Order</small></td>
                                    <td><span class="badge bg-secondary me-2">Check</span> Verify & Approve Supplier Invoice</td>
                                    <td class="text-end fw-bold">850,000</td>
                                    <td class="text-end"><button class="btn btn-sm btn-outline-dark py-0 px-3" style="font-size: 0.75rem;">Process</button></td>
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
                    <h5 class="fw-bold mb-4 text-dark"><i class="fa-solid fa-clock-rotate-left text-primary me-2"></i>Finance Activity Log</h5>
                    
                    <div class="log-container">
                        
                        <div class="d-flex gap-3 mb-3 border-bottom pb-3">
                            <div class="rounded-circle bg-success bg-opacity-10 text-success d-flex align-items-center justify-content-center flex-shrink-0" style="width: 36px; height: 36px;">
                                <i class="fa-solid fa-check"></i>
                            </div>
                            <div class="flex-grow-1">
                                <div class="d-flex justify-content-between">
                                    <p class="mb-0 fw-bold text-dark fs-6">Invoice Validated</p>
                                    <small class="text-muted">10:42 AM</small>
                                </div>
                                <p class="text-muted mb-0" style="font-size: 0.85rem;">Sarah C. validated Final Invoice #INV-2023-009 for <span class="fw-bold">Maersk</span>.</p>
                            </div>
                        </div>

                        <div class="d-flex gap-3 mb-3 border-bottom pb-3">
                            <div class="rounded-circle bg-info bg-opacity-10 text-info d-flex align-items-center justify-content-center flex-shrink-0" style="width: 36px; height: 36px;">
                                <i class="fa-solid fa-file-import"></i>
                            </div>
                            <div class="flex-grow-1">
                                <div class="d-flex justify-content-between">
                                    <p class="mb-0 fw-bold text-dark fs-6">Receipt Allocation</p>
                                    <small class="text-muted">09:15 AM</small>
                                </div>
                                <p class="text-muted mb-0" style="font-size: 0.85rem;">System auto-allocated payment of 500,000 XAF to SL24010022.</p>
                            </div>
                        </div>

                        <div class="d-flex gap-3">
                            <div class="rounded-circle bg-danger bg-opacity-10 text-danger d-flex align-items-center justify-content-center flex-shrink-0" style="width: 36px; height: 36px;">
                                <i class="fa-solid fa-ban"></i>
                            </div>
                            <div class="flex-grow-1">
                                <div class="d-flex justify-content-between">
                                    <p class="mb-0 fw-bold text-dark fs-6">Cash Request Rejected</p>
                                    <small class="text-muted">Yesterday</small>
                                </div>
                                <p class="text-muted mb-0" style="font-size: 0.85rem;">Returned request #CR-99 to Ops (Missing Receipt).</p>
                            </div>
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
