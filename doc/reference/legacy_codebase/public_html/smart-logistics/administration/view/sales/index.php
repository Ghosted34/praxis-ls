<?php
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['SALES']);

// --- Fetch current SALES user details from DB (authoritative profile) ---
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

// --- Safe display values ---
$fullName  = (string)($me['full_name'] ?? '');
$fullName  = trim($fullName) !== '' ? $fullName : 'Sales User';

$firstName = trim(explode(' ', $fullName)[0] ?? 'Sales');

$roleLabelMap = [
  'ADMIN'      => 'SYSTEM ADMIN',
  'FINANCE'    => 'FINANCE',
  'SALES'      => 'SALES',
  'OPERATIONS' => 'OPERATIONS',
  'MANAGEMENT' => 'MANAGEMENT',
];
$role = strtoupper((string)($me['role'] ?? 'SALES'));
$roleLabel = $roleLabelMap[$role] ?? $role;

$dept = trim((string)($me['department'] ?? ''));
$job  = trim((string)($me['job_title'] ?? ''));

// Prefer job title if present; else fallback to role label
$topbarTitle = $job !== '' ? $job : ($roleLabel . ($dept !== '' ? " - {$dept}" : ''));

// --- Avatar: UI Avatars based on name ---
$avatarName = urlencode($fullName);
$avatarUrl  = "https://ui-avatars.com/api/?name={$avatarName}&background=1F99D8&color=fff";

// --- Greeting based on server time ---
$hour = (int)date('H');
$greeting = ($hour < 12) ? 'Good morning' : (($hour < 18) ? 'Good afternoon' : 'Good evening');
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sales Dashboard | Smart LS</title>

    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="../../css/admin.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">

    <style>
        :root {
            --smart-blue: #1F99D8;
            --smart-dark: #055B83;
            --smart-orange: #EE7D04;
            --smart-charcoal: #231F20;
            --smart-bg: #F0F4F8;
            --sidebar-width: 260px;
        }

        body {
            font-family: 'Manrope', sans-serif;
            background-color: var(--smart-bg);
            color: var(--smart-charcoal);
            overflow-x: hidden;
        }

        h1, h2, h3, h4, h5, h6 { font-family: 'Montserrat', sans-serif; }

        .sidebar {
            width: var(--sidebar-width);
            height: 100vh;
            position: fixed;
            top: 0;
            left: 0;
            background-color: #ffffff;
            border-right: 1px solid #e0e0e0;
            z-index: 1000;
            display: flex;
            flex-direction: column;
            box-shadow: 2px 0 10px rgba(0,0,0,0.02);
        }

        .sidebar-header {
            height: 70px;
            display: flex;
            align-items: center;
            padding: 0 20px;
            border-bottom: 1px solid #f0f0f0;
        }

        .brand-logo {
            font-weight: 800;
            font-size: 1.1rem;
            color: var(--smart-charcoal);
            text-decoration: none;
            letter-spacing: -0.5px;
        }

        .sidebar-menu { overflow-y: auto; flex-grow: 1; padding: 10px 0; }

        .menu-btn {
            width: 100%;
            text-align: left;
            background: none;
            border: none;
            padding: 12px 20px;
            font-size: 0.8rem;
            font-weight: 700;
            color: #555;
            display: flex;
            justify-content: space-between;
            align-items: center;
            transition: all 0.2s;
            border-left: 3px solid transparent;
        }

        .menu-btn:hover, .menu-btn[aria-expanded="true"] {
            color: var(--smart-blue);
            background-color: #f8fbff;
            border-left-color: var(--smart-blue);
        }

        .menu-btn i.category-icon { width: 20px; margin-right: 8px; color: #888; transition: color 0.2s; }
        .menu-btn:hover i.category-icon { color: var(--smart-blue); }
        .menu-chevron { font-size: 0.7rem; transition: transform 0.3s; }
        .menu-btn[aria-expanded="true"] .menu-chevron { transform: rotate(180deg); }

        .sub-link {
            display: block;
            padding: 8px 20px 8px 48px;
            font-size: 0.75rem;
            color: #666;
            text-decoration: none;
            font-weight: 500;
            transition: all 0.2s;
            line-height: 1.3;
        }
        .sub-link:hover { color: var(--smart-orange); background-color: #fff9f2; }

        .sidebar-footer { border-top: 1px solid #f0f0f0; padding: 16px; }

        .main-content {
            margin-left: var(--sidebar-width);
            padding-top: 70px;
            min-height: 100vh;
            width: calc(100% - var(--sidebar-width));
        }

        .top-navbar {
            height: 70px;
            position: fixed;
            top: 0;
            right: 0;
            left: var(--sidebar-width);
            background-color: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(12px);
            border-bottom: 1px solid #e0e0e0;
            z-index: 900;
            padding: 0 30px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .sales-banner {
            background: linear-gradient(135deg, var(--smart-blue) 0%, #0d47a1 100%);
            color: white;
            border-radius: 12px;
            padding: 1.5rem 2rem;
            position: relative;
            overflow: hidden;
            box-shadow: 0 10px 30px rgba(31, 153, 216, 0.2);
            width: 100%;
        }

        .card-custom {
            background: white;
            border-radius: 12px;
            border: 1px solid rgba(0,0,0,0.05);
            box-shadow: 0 2px 12px rgba(0,0,0,0.02);
            height: 100%;
            transition: transform 0.2s;
        }
        .card-custom:hover { transform: translateY(-2px); box-shadow: 0 5px 20px rgba(0,0,0,0.05); }

        .kpi-title { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; color: #888; letter-spacing: 0.5px; white-space: nowrap; }
        .kpi-value { font-size: 1.6rem; font-weight: 800; color: var(--smart-charcoal); line-height: 1.2; font-variant-numeric: tabular-nums; }

        .table-custom th { font-size: 0.75rem; text-transform: uppercase; color: #888; font-weight: 700; border-bottom: 2px solid #f0f0f0; }
        .table-custom td { font-size: 0.85rem; vertical-align: middle; padding: 12px 8px; }

        .clock-pill {
            background: #f1f5f9; padding: 6px 12px; border-radius: 30px;
            display: flex; align-items: center; gap: 10px; font-size: 0.85rem; font-weight: 600; color: var(--smart-dark);
        }
        .btn-clock {
            background: #e2e8f0; border: none; border-radius: 20px;
            padding: 4px 12px; font-size: 0.75rem; font-weight: 700; color: #64748b; transition: 0.3s;
        }
        .btn-clock.active { background: var(--smart-orange); color: white; box-shadow: 0 2px 10px rgba(238, 125, 4, 0.3); }

        .log-container { max-height: 250px; overflow-y: auto; padding-right: 5px; }
        .log-container::-webkit-scrollbar { width: 4px; }
        .log-container::-webkit-scrollbar-track { background: #f1f1f1; }
        .log-container::-webkit-scrollbar-thumb { background: #ccc; border-radius: 4px; }

        .badge-readonly { background: #f3f4f6; color: #6b7280; border: 1px solid #d1d5db; font-size: 0.6rem; letter-spacing: 0.5px; }
    </style>
</head>
<body>

    <nav class="sidebar">
        <div class="sidebar-header">
            <a href="#" class="brand-logo"><i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span></a>
        </div>

        <div class="sidebar-menu accordion" id="salesMenu">
            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu1">
                    <span><i class="fa-solid fa-house category-icon"></i> Sales Home</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu1" class="accordion-collapse collapse show" data-bs-parent="#salesMenu">
                    <div class="sub-menu">
                        <a href="index.php" class="sub-link fw-bold text-primary">Dashboards & KPI</a>
                    </div>
                </div>
            </div>

            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu2">
                    <span><i class="fa-solid fa-globe category-icon"></i> Leads & Intake</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu2" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                    <div class="sub-menu">
                        <a href="smart-quote-intake.php" class="sub-link">Smart Quote Intake</a>
                        <a href="contact-us-intake.php" class="sub-link">Contact Us Intake</a>
                        <a href="partnership-portal-intake.php" class="sub-link">Partnership Portal</a>
                    </div>
                </div>
            </div>

            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu3">
                    <span><i class="fa-solid fa-bullhorn category-icon"></i> Pipeline</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu3" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                    <div class="sub-menu">
                        <a href="market-campaign-registration.php" class="sub-link">Marketing Campaigns</a>
                        <a href="#" class="sub-link">Opportunity Tracking</a>
                    </div>
                </div>
            </div>

            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu4">
                    <span><i class="fa-solid fa-calculator category-icon"></i> Pricing Tools</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu4" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                    <div class="sub-menu">
                        <a href="#" class="sub-link">Margin Simulator</a>
                        <a href="#" class="sub-link">Extra Charges Sim.</a>
                    </div>
                </div>
            </div>

            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu5">
                    <span><i class="fa-solid fa-briefcase category-icon"></i> Deal Context</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu5" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                    <div class="sub-menu">
                        <a href="#" class="sub-link">Client Master</a>
                        <a href="#" class="sub-link">Ops File Registry</a>
                    </div>
                </div>
            </div>

            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu6">
                    <span><i class="fa-solid fa-eye category-icon"></i> Ops Visibility <span class="badge badge-readonly ms-2">READ-ONLY</span></span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu6" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                    <div class="sub-menu">
                        <a href="#" class="sub-link">Milestone Tracking</a>
                        <a href="#" class="sub-link">Transit Orders</a>
                        <a href="#" class="sub-link">Delivery / POD</a>
                    </div>
                </div>
            </div>

            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu7">
                    <span><i class="fa-solid fa-folder-open category-icon"></i> Docs & Outputs</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu7" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                    <div class="sub-menu">
                        <a href="#" class="sub-link">Document Vault</a>
                        <a href="#" class="sub-link">Exports</a>
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
            <h5 class="mb-0 fw-bold text-dark">Commercial Control</h5>
            <small class="text-muted" style="font-size: 0.7rem;">SALES PIPELINE & GROWTH</small>
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
                        <?php echo e($topbarTitle !== '' ? $topbarTitle : $roleLabel); ?>
                    </small>
                </div>
                <img src="<?php echo e($avatarUrl); ?>" class="rounded-circle shadow-sm" width="38" height="38" alt="<?php echo e($firstName); ?>">
            </div>
        </div>
    </div>

    <div class="main-content px-4 pb-5">

        <div class="row pt-4 mb-4">
            <div class="col-12">
                <div class="sales-banner d-flex justify-content-between align-items-center">
                    <div>
                        <h2 class="fw-bold mb-1"><?php echo e($greeting); ?>, <?php echo e($firstName); ?>!</h2>
                        <p class="mb-0 opacity-75">Your pipeline is healthy. 3 new leads arrived from the Smart Quote Portal.</p>
                    </div>
                    <div class="text-end" style="min-width: 150px;">
                        <div class="mb-1 text-uppercase text-white-50" style="font-size: 0.7rem; font-weight: 800;">Monthly Quota</div>
                        <div class="d-flex align-items-center justify-content-end gap-2">
                            <span class="fw-bold fs-5">72% ACHIEVED</span>
                        </div>
                        <div class="progress mt-2" style="height: 6px; background: rgba(255,255,255,0.2);">
                            <div class="progress-bar bg-white" role="progressbar" style="width: 72%"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Your remaining page content stays the same -->
        <!-- KPI cards, tables, logs (unchanged) -->

        <div class="row g-3 mb-4">
            <div class="col-3">
                <div class="card-custom p-3 d-flex align-items-center">
                    <div class="me-3 rounded-3 bg-primary bg-opacity-10 text-primary d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
                        <i class="fa-solid fa-funnel-dollar"></i>
                    </div>
                    <div>
                        <div class="kpi-title">Pipeline Value</div>
                        <div class="kpi-value">128M <span style="font-size: 0.9rem; color: #888;">XAF</span></div>
                    </div>
                </div>
            </div>
            <div class="col-3">
                <div class="card-custom p-3 d-flex align-items-center">
                    <div class="me-3 rounded-3 bg-success bg-opacity-10 text-success d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
                        <i class="fa-solid fa-arrow-trend-up"></i>
                    </div>
                    <div>
                        <div class="kpi-title">Conversion Rate</div>
                        <div class="kpi-value text-success">22%</div>
                    </div>
                </div>
            </div>
            <div class="col-3">
                <div class="card-custom p-3 d-flex align-items-center">
                    <div class="me-3 rounded-3 bg-warning bg-opacity-10 text-warning d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
                        <i class="fa-solid fa-fire"></i>
                    </div>
                    <div>
                        <div class="kpi-title">New Leads (Wk)</div>
                        <div class="kpi-value">8</div>
                    </div>
                </div>
            </div>
            <div class="col-3">
                <div class="card-custom p-3 d-flex align-items-center">
                    <div class="me-3 rounded-3 bg-info bg-opacity-10 text-info d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
                        <i class="fa-solid fa-file-pen"></i>
                    </div>
                    <div>
                        <div class="kpi-title">Draft Quotes</div>
                        <div class="kpi-value">5</div>
                    </div>
                </div>
            </div>
        </div>

        <div class="row mb-4">
            <div class="col-12">
                <div class="card-custom p-4">
                    <h5 class="fw-bold mb-4 text-dark"><i class="fa-solid fa-clock-rotate-left text-primary me-2"></i>Recent Commercial Activity</h5>
                    
                    <div class="log-container">
                        
                        <div class="d-flex gap-3 mb-3 border-bottom pb-3">
                            <div class="rounded-circle bg-success bg-opacity-10 text-success d-flex align-items-center justify-content-center flex-shrink-0" style="width: 36px; height: 36px;">
                                <i class="fa-solid fa-check"></i>
                            </div>
                            <div class="flex-grow-1">
                                <div class="d-flex justify-content-between">
                                    <p class="mb-0 fw-bold text-dark fs-6">Deal Won</p>
                                    <small class="text-muted">10:00 AM</small>
                                </div>
                                <p class="text-muted mb-0" style="font-size: 0.85rem;">Marked opportunity <strong>#OPP-992</strong> as Closed/Won (Value: 12M).</p>
                            </div>
                        </div>

                        <div class="d-flex gap-3 mb-3 border-bottom pb-3">
                            <div class="rounded-circle bg-primary bg-opacity-10 text-primary d-flex align-items-center justify-content-center flex-shrink-0" style="width: 36px; height: 36px;">
                                <i class="fa-solid fa-paper-plane"></i>
                            </div>
                            <div class="flex-grow-1">
                                <div class="d-flex justify-content-between">
                                    <p class="mb-0 fw-bold text-dark fs-6">Quote Sent</p>
                                    <small class="text-muted">Yesterday</small>
                                </div>
                                <p class="text-muted mb-0" style="font-size: 0.85rem;">Sent formal quotation <strong>QT-2023-45</strong> to Maersk.</p>
                            </div>
                        </div>

                        <div class="d-flex gap-3">
                            <div class="rounded-circle bg-warning bg-opacity-10 text-warning d-flex align-items-center justify-content-center flex-shrink-0" style="width: 36px; height: 36px;">
                                <i class="fa-solid fa-phone"></i>
                            </div>
                            <div class="flex-grow-1">
                                <div class="d-flex justify-content-between">
                                    <p class="mb-0 fw-bold text-dark fs-6">Call Logged</p>
                                    <small class="text-muted">Oct 23</small>
                                </div>
                                <p class="text-muted mb-0" style="font-size: 0.85rem;">Follow up call with <strong>Mr. Kamga</strong> regarding rate dispute.</p>
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
