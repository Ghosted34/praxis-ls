<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN','OPERATIONS','MANAGEMENT','FINANCE']);

$conn = db();

function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }

function jexit(array $p, int $code=200): void {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($p);
  exit;
}

/**
 * IMPORTANT:
 * - We will NOT read anything from details_json (JSON is ignored completely).
 * - We assign a backend-only default container spec for calculations.
 * - The UI will NOT display containers; it will only use it internally for computation.
 */
const DEFAULT_CONTAINER_SPEC = "1*40'DRY"; // backend-only default
const DEFAULT_WEIGHT_UNIT   = "KG";

/* =========================================================
   AJAX ENDPOINTS (for datalist search + file detail load)
   ========================================================= */
if (isset($_GET['ajax'])) {
  $ajax = (string)$_GET['ajax'];

  // Only SEA / INLAND-ish service types + not NOT_AWARDED
  $serviceFilter = "(
      INSTR(service_type, 'SEA') > 0
      OR INSTR(service_type, 'INLAND') > 0
      OR INSTR(service_type, 'INTER_LAND') > 0
      OR INSTR(service_type, 'INTERLAND') > 0
    )";

  if ($ajax === 'search_files') {
    $q = trim((string)($_GET['q'] ?? ''));
    if ($q === '' || mb_strlen($q) < 2) {
      jexit(['ok'=>true,'items'=>[]]);
    }

    $like = '%' . $q . '%';

    $sql = "
      SELECT
        operations_file_reference,
        COALESCE(NULLIF(client_bill_to,''), client_id) AS consignee_display,
        service_type,
        ata,
        sea_bl
      FROM operations_file_master
      WHERE operations_status <> 'NOT_AWARDED'
        AND {$serviceFilter}
        AND (
          operations_file_reference LIKE ?
          OR client_bill_to LIKE ?
          OR client_id LIKE ?
          OR sea_bl LIKE ?
        )
      ORDER BY updated_at DESC
      LIMIT 25
    ";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('ssss', $like, $like, $like, $like);
    $stmt->execute();
    $res = $stmt->get_result();

    $items = [];
    while ($row = $res->fetch_assoc()) {
      $ref = (string)$row['operations_file_reference'];
      $cons = (string)($row['consignee_display'] ?? '');
      $svc = (string)($row['service_type'] ?? '');
      $bl  = (string)($row['sea_bl'] ?? '');
      $ata = $row['ata'] ? date('Y-m-d', strtotime((string)$row['ata'])) : '';

      $labelBits = array_filter([
        $ref,
        $cons !== '' ? $cons : null,
        $bl !== '' ? "BL: {$bl}" : null,
        $svc !== '' ? $svc : null,
        $ata !== '' ? "ATA: {$ata}" : null,
      ]);
      $items[] = [
        'ref'   => $ref,
        'label' => implode(' — ', $labelBits),
      ];
    }

    jexit(['ok'=>true,'items'=>$items]);
  }

  if ($ajax === 'file_details') {
    $ref = trim((string)($_GET['ref'] ?? ''));
    if ($ref === '') {
      jexit(['ok'=>false,'error'=>'Missing ref'], 400);
    }

    // NOTE: details_json is NOT selected and NOT used.
    // We take gross_weight + weight_unit from DB and we set containers internally to DEFAULT_CONTAINER_SPEC.
    $sql = "
      SELECT
        operations_file_reference,
        service_type,
        operations_status,
        COALESCE(NULLIF(client_bill_to,''), client_id) AS consignee_display,
        ata,
        eta,
        sea_bl,
        gross_weight,
        weight_unit
      FROM operations_file_master
      WHERE operations_file_reference = ?
        AND operations_status <> 'NOT_AWARDED'
        AND {$serviceFilter}
      LIMIT 1
    ";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('s', $ref);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();

    if (!$row) {
      jexit(['ok'=>false,'error'=>'File not found / not eligible'], 404);
    }

    $ataDate = $row['ata'] ? date('Y-m-d', strtotime((string)$row['ata'])) : '';
    $bl      = (string)($row['sea_bl'] ?? '');
    $cons    = (string)($row['consignee_display'] ?? '');

    $gwRaw = $row['gross_weight'];
    $gw = ($gwRaw === null || $gwRaw === '') ? '' : number_format((float)$gwRaw, 2, '.', '');
    $wu = strtoupper(trim((string)($row['weight_unit'] ?? DEFAULT_WEIGHT_UNIT)));
    if (!in_array($wu, ['KG','TON','LB'], true)) $wu = DEFAULT_WEIGHT_UNIT;

    jexit([
      'ok'=>true,
      'data'=>[
        'ref'         => (string)$row['operations_file_reference'],
        'service'     => (string)($row['service_type'] ?? ''),
        'status'      => (string)($row['operations_status'] ?? ''),
        'ata_date'    => $ataDate,
        'sea_bl'      => $bl,
        'consignee'   => $cons,

        // From DB:
        'gross_weight'=> $gw,
        'weight_unit' => $wu,

        // Backend-only default for calculations (NOT from JSON):
        'containers'  => DEFAULT_CONTAINER_SPEC,
      ]
    ]);
  }

  jexit(['ok'=>false,'error'=>'Unknown ajax'], 400);
}

/* =========================================================
   AUTH PROFILE (same as index.php)
   ========================================================= */
$employeeId = (string)($_SESSION['auth']['employee_id'] ?? '');
$userId     = (int)($_SESSION['auth']['user_id'] ?? 0);

if ($employeeId === '' || $userId <= 0) {
  header('Location: ../../api/auth/logout.php');
  exit;
}

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

$fullName  = $me['full_name'] ?: 'User';
$firstName = trim(explode(' ', $fullName)[0] ?? 'User');

$roleLabelMap = [
  'ADMIN'      => 'SYSTEM ADMIN',
  'FINANCE'    => 'FINANCE',
  'SALES'      => 'SALES',
  'OPERATIONS' => 'OPERATIONS',
  'MANAGEMENT' => 'MANAGEMENT',
];
$role      = strtoupper((string)($me['role'] ?? 'OPERATIONS'));
$roleLabel = $roleLabelMap[$role] ?? $role;

$avatarName = urlencode($fullName);
$avatarUrl  = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Extra Charges Simulator | Smart LS</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">

  <style>
    @media print {
      .sidebar, .top-navbar, .btn, .filter-pill, .form-text,
      .badge.bg-warning, .clock-pill, .modal { display:none !important; }

      body, .main-content {
        background-color: #fff !important;
        margin: 0 !important;
        padding: 0 !important;
        width: 100% !important;
        overflow: visible !important;
      }

      .container, .row, .col-lg-4, .col-lg-8 {
        width: 100% !important;
        max-width: 100% !important;
        display: block !important;
        padding: 0 !important;
      }

      .col-lg-4 { margin-bottom: 20px; border-bottom: 2px solid #eee; padding-bottom: 20px !important; }

      .card-custom { border: none !important; box-shadow: none !important; padding: 0 !important; }

      .smart-input, .form-control, .form-select {
        border: none !important;
        background: transparent !important;
        padding: 0 !important;
        font-weight: 700;
        color: #000 !important;
        -webkit-appearance: none;
      }
      select { appearance: none; -moz-appearance: none; text-indent: 1px; text-overflow: ''; }

      .table-responsive { overflow: visible !important; }
      table { width: 100% !important; }
      thead th { color:#000 !important; border-bottom:2px solid #000 !important; }
      tr { break-inside: avoid; page-break-inside: avoid; }

      #print-only-header {
        display:block !important;
        margin-bottom: 30px;
        border-bottom: 2px solid var(--smart-orange);
        padding-bottom: 20px;
      }
    }
    #print-only-header { display:none; }

    :root{
      --smart-blue: #1F99D8;
      --smart-dark: #055B83;
      --smart-orange: #EE7D04;
      --smart-charcoal: #231F20;
      --smart-bg: #F0F4F8;
      --smart-success: #16a34a;
      --smart-danger: #dc2626;
    }

    h1,h2,h3,h4,h5,h6,.font-heading{ font-family:'Montserrat',sans-serif; }

    .card-custom{
      background:#fff;
      border-radius:12px;
      border:1px solid rgba(0,0,0,0.05);
      box-shadow:0 2px 12px rgba(0,0,0,0.02);
      height:100%;
      transition:transform .2s, box-shadow .2s;
    }
    .card-custom:hover{ transform: translateY(-2px); box-shadow:0 5px 20px rgba(0,0,0,0.05); }

    .form-section-title{
      font-size:.75rem;
      font-weight:800;
      color: var(--smart-charcoal);
      border-bottom:2px solid #f1f5f9;
      padding-bottom:8px;
      margin-bottom:16px;
      text-transform:uppercase;
      letter-spacing:.5px;
    }

    .smart-input{
      border-radius:8px;
      font-size:.9rem;
      padding:.6rem .8rem;
      border:1px solid #dee2e6;
      background:#fff;
      transition: all .2s;
    }
    .smart-input:focus{
      border-color: var(--smart-orange);
      box-shadow:0 0 0 3px rgba(238,125,4,0.12);
      outline:none;
    }
    .smart-input[readonly]{
      background:#f8f9fa;
      color:#6c757d;
      border-color:#e9ecef;
      cursor:not-allowed;
    }

    .kpi-title{
      font-size:.7rem;
      font-weight:700;
      text-transform:uppercase;
      color:#888;
      letter-spacing:.5px;
      white-space:nowrap;
    }
    .kpi-value{
      font-size:1.6rem;
      font-weight:800;
      color: var(--smart-charcoal);
      line-height:1.2;
      font-variant-numeric: tabular-nums;
    }
    .kpi-sub{ font-size:.7rem; font-weight:600; }

    .filter-pill{
      font-size:.75rem;
      padding:6px 16px;
      border-radius:999px;
      border:1px solid #e0e0e0;
      cursor:pointer;
      background:#fff;
      transition: all .2s;
      font-weight:600;
      color:#64748b;
    }
    .filter-pill:hover{ background:#f8fafc; }
    .filter-pill.active{
      background: var(--smart-orange);
      color:#fff;
      border-color: var(--smart-orange);
      box-shadow:0 2px 6px rgba(238,125,4,0.2);
    }

    .table-custom th{
      font-size:.7rem;
      text-transform:uppercase;
      color:#64748b;
      font-weight:700;
      border-bottom:2px solid #f1f5f9;
      background:#f8fafc;
      padding:12px 16px;
    }
    .table-custom td{
      font-size:.85rem;
      vertical-align:middle;
      padding:12px 16px;
      border-bottom:1px solid #f1f5f9;
    }
    .table-custom tr:last-child td{ border-bottom:none; }

    .totals-container{
      background:#f8fafc;
      border-radius:12px;
      padding:1.5rem;
      margin-top:1rem;
    }
    .total-row{
      display:flex;
      justify-content:space-between;
      margin-bottom:.5rem;
      font-size:.9rem;
      color:#64748b;
    }
    .grand-total{
      border-top:2px solid #cbd5e1;
      padding-top:1rem;
      margin-top:.5rem;
      font-size:1.25rem;
      font-weight:800;
      color: var(--smart-charcoal);
    }

    .hint-muted{ font-size:.75rem; color:#6b7280; }
  </style>
</head>

<body>

  <!-- SIDEBAR (copied from index.php) -->
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
            <a href="index.php" class="sub-link">Dashboard</a>
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
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu4" aria-expanded="true">
          <span><i class="fa-solid fa-hand-holding-dollar category-icon"></i> Sales & Intake</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu4" class="accordion-collapse collapse show" data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="smart-quote-intake.php" class="sub-link">Smart Quote Intake</a>
            <a href="#" class="sub-link">Contact Us Intake</a>
            <a href="#" class="sub-link">Partnership Intake</a>
            <a href="#" class="sub-link">Campaign Register</a>
            <a href="#" class="sub-link">Sales Pipeline</a>
           
            <a href="extra-charges-simulator.php" class="sub-link active">Extra Charges Sim.</a>
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
            <a href="#" class="sub-link">Milestone Tracking</a>
            <a href="#" class="sub-link">Transit Orders</a>
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
            <a href="#" class="sub-link">Costing Module</a>
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

  <!-- TOPBAR (copied from index.php; title adjusted only) -->
  <div class="top-navbar">
    <div>
      <h5 class="mb-0 fw-bold text-dark">Extra Charges Simulator</h5>
      <small class="text-muted" style="font-size: 0.7rem;">SEA FREIGHT DEMURRAGE, STORAGE & DETENTION</small>
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

    <div id="print-only-header">
      <div class="d-flex justify-content-between align-items-center">
        <div class="d-flex align-items-center gap-3">
          <h1 class="mb-0 fw-black font-heading" style="color: var(--smart-dark);">SMART <span style="color: var(--smart-orange);">LS</span></h1>
        </div>
        <div class="text-end">
          <h5 class="fw-bold mb-0">Extra Charges Statement</h5>
          <small class="text-muted">Generated: <span id="print-date"></span></small>
        </div>
      </div>
    </div>

    <div class="row py-4 align-items-center">
      <div class="col-md-6">
        <h2 class="fw-bold font-heading mb-0">Cost Calculation</h2>
        <p class="text-muted mb-0 small">Select an active Ops File (SEA / INLAND) to auto-fill shipment parameters. Only “Free Days” is manual.</p>
      </div>
      <div class="col-md-6 text-end">
        <div class="d-flex justify-content-end gap-2 flex-wrap">
          <select id="currency" class="form-select smart-input fw-bold" style="width: 120px;" onchange="updateCalc()">
            <option value="XAF">XAF</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
          <button class="btn btn-light fw-bold border shadow-sm" onclick="openAdminModal()">
            <i class="fa-solid fa-gear me-2"></i>Admin Rates
          </button>
          <button class="btn btn-dark fw-bold shadow-sm" onclick="window.print()">
            <i class="fa-solid fa-print me-2"></i>Export PDF
          </button>
        </div>
      </div>
    </div>

    <div class="row g-4">
      <div class="col-lg-4">
        <div class="card-custom p-4">
          <h6 class="form-section-title"><i class="fa-solid fa-ship me-2 text-primary"></i>Shipment Parameters</h6>

          <div class="mb-3">
            <label class="form-label small fw-bold text-muted">Select Active File (SEA / INLAND)</label>
            <div class="input-group">
              <span class="input-group-text bg-white border-end-0 text-muted">
                <i class="fa-solid fa-magnifying-glass"></i>
              </span>
              <input
                class="form-control smart-input border-start-0"
                list="fileOptions"
                id="fileRefInput"
                placeholder="Type Ops File Ref / Client / BL (min 2 chars)..."
                autocomplete="off"
              >
              <datalist id="fileOptions"></datalist>
            </div>
            <div class="form-text" style="font-size: 0.75rem;">
              Search is filtered to <strong>operations_status != NOT_AWARDED</strong> and service_type containing <strong>SEA</strong> or <strong>INLAND</strong>.
            </div>
            <div id="filePickMeta" class="hint-muted mt-2"></div>
          </div>

          <div class="mb-3">
            <label class="form-label small fw-bold text-muted">BL Number (SEA)</label>
            <input type="text" id="bl" class="form-control smart-input" placeholder="Auto from DB" readonly>
          </div>

          <div class="mb-3">
            <label class="form-label small fw-bold text-muted">Consignee</label>
            <input type="text" id="consignee" class="form-control smart-input" placeholder="Auto from DB" readonly>
          </div>

          <!-- WEIGHT (from DB) -->
          <div class="row g-2 mb-3">
            <div class="col-7">
              <label class="form-label small fw-bold text-muted">Gross Weight</label>
              <input type="text" id="grossWeight" class="form-control smart-input" placeholder="Auto from DB" readonly>
            </div>
            <div class="col-5">
              <label class="form-label small fw-bold text-muted">Unit</label>
              <input type="text" id="weightUnit" class="form-control smart-input" placeholder="KG" readonly>
            </div>
          </div>

          <!-- CONTAINERS (backend default; NOT displayed) -->
          <input type="hidden" id="containers" value="">

          <hr class="my-4" style="opacity: 0.08;">

          <h6 class="form-section-title"><i class="fa-solid fa-calendar-days me-2 text-primary"></i>Timeline & Terms</h6>

          <div class="row g-2 mb-3">
            <div class="col-6">
              <label class="form-label small fw-bold text-muted">ATA (Arrival)</label>
              <input type="date" id="ata" class="form-control smart-input" readonly>
            </div>
            <div class="col-6">
              <label class="form-label small fw-bold text-muted">Free Days (Manual)</label>
              <input type="number" id="freeTime" class="form-control smart-input" value="11" min="0">
            </div>
          </div>

          <div class="row g-2 mb-3">
            <div class="col-6">
              <label class="form-label small fw-bold text-muted">Gate Out</label>
              <input type="date" id="gateOut" class="form-control smart-input">
              <div class="form-text" style="font-size: 0.7rem;">Manual (depends on actual gate-out date).</div>
            </div>
            <div class="col-6">
              <label class="form-label small fw-bold text-muted">Empty Return</label>
              <input type="date" id="emptyReturn" class="form-control smart-input">
              <div class="form-text" style="font-size: 0.7rem;">Optional (assumes Gate Out if blank).</div>
            </div>
          </div>

        </div>
      </div>

      <div class="col-lg-8">

        <div class="row g-3 mb-4">
          <div class="col-4">
            <div class="card-custom p-3 d-flex align-items-center">
              <div class="me-3 rounded-3 bg-secondary bg-opacity-10 text-secondary d-flex align-items-center justify-content-center" style="width: 48px; height: 48px; font-size: 1.2rem;">
                <i class="fa-solid fa-hourglass-start"></i>
              </div>
              <div>
                <div class="kpi-title">Free Time</div>
                <div class="kpi-value" id="mFree">0</div>
                <div class="kpi-sub text-muted">Days Allowed</div>
              </div>
            </div>
          </div>

          <div class="col-4">
            <div class="card-custom p-3 d-flex align-items-center">
              <div class="me-3 rounded-3 bg-primary bg-opacity-10 text-primary d-flex align-items-center justify-content-center" style="width: 48px; height: 48px; font-size: 1.2rem;">
                <i class="fa-solid fa-calendar-check"></i>
              </div>
              <div>
                <div class="kpi-title">Chargeable</div>
                <div class="kpi-value text-primary" id="mCharge">0</div>
                <div class="kpi-sub text-muted">Total Billable Days</div>
              </div>
            </div>
          </div>

          <div class="col-4">
            <div class="card-custom p-3 d-flex align-items-center">
              <div class="me-3 rounded-3 bg-success bg-opacity-10 text-success d-flex align-items-center justify-content-center" id="status-icon-bg" style="width: 48px; height: 48px; font-size: 1.2rem;">
                <i class="fa-solid fa-check" id="status-icon"></i>
              </div>
              <div>
                <div class="kpi-title">Timeline Status</div>
                <div class="kpi-value text-success" id="mDue">OK</div>
                <div class="kpi-sub text-muted">Within Limits</div>
              </div>
            </div>
          </div>
        </div>

        <div class="d-flex gap-2 mb-3 flex-wrap">
          <div class="filter-pill active" data-f="ALL" onclick="toggleFilter(this)">All Charges</div>
          <div class="filter-pill" data-f="Storage" onclick="toggleFilter(this)">Storage</div>
          <div class="filter-pill" data-f="Demurrage" onclick="toggleFilter(this)">Demurrage</div>
          <div class="filter-pill" data-f="Yard Occupancy" onclick="toggleFilter(this)">Yard Occupancy</div>
          <div class="filter-pill" data-f="Plugging" onclick="toggleFilter(this)">Plugging</div>
          <div class="filter-pill" data-f="Detention" onclick="toggleFilter(this)">Detention</div>
        </div>

        <div class="card-custom overflow-hidden">
          <div class="table-responsive">
            <table class="table table-custom mb-0">
              <thead>
                <tr>
                  <th style="width: 35%;">Charge Description</th>
                  <th style="width: 15%;">Basis (Days/Qty)</th>
                  <th class="text-end" style="width: 15%;">Amount HT</th>
                  <th class="text-end" style="width: 15%;">VAT (19.25%)</th>
                  <th class="text-end" style="width: 20%;">Total TTC</th>
                </tr>
              </thead>
              <tbody id="chargesTableBody"></tbody>
            </table>
          </div>

          <div class="totals-container border-top rounded-0 rounded-bottom">
            <div class="row">
              <div class="col-md-6">
                <label class="form-label small fw-bold text-muted text-uppercase mb-2">Audit / Approval Notes</label>
                <textarea class="form-control smart-input" rows="3" placeholder="Enter notes regarding waivers, discounts, or specific invoice numbers..."></textarea>
              </div>
              <div class="col-md-6">
                <div class="ps-md-5">
                  <div class="total-row">
                    <span>Total HT</span>
                    <span class="fw-bold font-monospace" id="tHT">0</span>
                  </div>
                  <div class="total-row">
                    <span>VAT (19.25%)</span>
                    <span class="fw-bold font-monospace" id="tVAT">0</span>
                  </div>
                  <div class="d-flex justify-content-between grand-total">
                    <span>NET PAYABLE</span>
                    <span class="text-primary font-monospace" id="tTTC">0</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>

      </div>
    </div>
  </div>

  <!-- ADMIN MODAL (unchanged) -->
  <div class="modal fade" id="adminModal" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
      <div class="modal-content border-0 shadow-lg">
        <div class="modal-header bg-light border-bottom">
          <div>
            <h5 class="modal-title fw-bold font-heading">Rate Configuration</h5>
            <small class="text-muted">Modify standard rates and exchange values.</small>
          </div>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>
        <div class="modal-body p-4">

          <h6 class="form-section-title text-primary">Exchange Rates (vs XAF)</h6>
          <div class="row g-3 mb-4">
            <div class="col-6">
              <label class="form-label small fw-bold">USD Rate</label>
              <input type="number" id="fxUSD" class="form-control smart-input">
            </div>
            <div class="col-6">
              <label class="form-label small fw-bold">EUR Rate</label>
              <input type="number" id="fxEUR" class="form-control smart-input">
            </div>
          </div>

          <h6 class="form-section-title text-primary">Demurrage (Per Day / XAF)</h6>
          <div class="table-responsive mb-4 border rounded">
            <table class="table table-sm table-borderless mb-0">
              <thead class="bg-light">
                <tr><th class="ps-3">Window</th><th>20ft</th><th>40ft</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td class="ps-3 fw-bold small text-muted align-middle">Days 12–21</td>
                  <td><input id="dem20_1" type="number" class="form-control form-control-sm smart-input"></td>
                  <td><input id="dem40_1" type="number" class="form-control form-control-sm smart-input"></td>
                </tr>
                <tr>
                  <td class="ps-3 fw-bold small text-muted align-middle">Days 22+</td>
                  <td><input id="dem20_2" type="number" class="form-control form-control-sm smart-input"></td>
                  <td><input id="dem40_2" type="number" class="form-control form-control-sm smart-input"></td>
                </tr>
              </tbody>
            </table>
          </div>

          <h6 class="form-section-title text-primary">Storage (Per Day / XAF)</h6>
          <div class="table-responsive mb-4 border rounded">
            <table class="table table-sm table-borderless mb-0">
              <thead class="bg-light">
                <tr><th class="ps-3">Tier</th><th>20ft</th><th>40ft</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td class="ps-3 fw-bold small text-muted align-middle">12–20 Days</td>
                  <td><input id="st20_12" type="number" class="form-control form-control-sm smart-input"></td>
                  <td><input id="st40_12" type="number" class="form-control form-control-sm smart-input"></td>
                </tr>
                <tr>
                  <td class="ps-3 fw-bold small text-muted align-middle">21–40 Days</td>
                  <td><input id="st20_21" type="number" class="form-control form-control-sm smart-input"></td>
                  <td><input id="st40_21" type="number" class="form-control form-control-sm smart-input"></td>
                </tr>
                <tr>
                  <td class="ps-3 fw-bold small text-muted align-middle">41–70 Days</td>
                  <td><input id="st20_41" type="number" class="form-control form-control-sm smart-input"></td>
                  <td><input id="st40_41" type="number" class="form-control form-control-sm smart-input"></td>
                </tr>
                <tr>
                  <td class="ps-3 fw-bold small text-muted align-middle">71+ Days</td>
                  <td><input id="st20_71" type="number" class="form-control form-control-sm smart-input"></td>
                  <td><input id="st40_71" type="number" class="form-control form-control-sm smart-input"></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="row g-3">
            <div class="col-md-6">
              <h6 class="form-section-title text-primary">Yard Occupancy (One-time)</h6>
              <div class="input-group input-group-sm mb-2">
                <span class="input-group-text bg-light fw-bold">20ft</span>
                <input id="yard20" type="number" class="form-control smart-input">
              </div>
              <div class="input-group input-group-sm">
                <span class="input-group-text bg-light fw-bold">40ft</span>
                <input id="yard40" type="number" class="form-control smart-input">
              </div>
            </div>
            <div class="col-md-6">
              <h6 class="form-section-title text-primary">Detention (Per Day)</h6>
              <div class="row g-1">
                <div class="col-6"><small class="d-block text-muted fw-bold mb-1">Dry 20'</small><input id="detDC20" type="number" class="form-control form-control-sm smart-input"></div>
                <div class="col-6"><small class="d-block text-muted fw-bold mb-1">Dry 40'</small><input id="detDC40" type="number" class="form-control form-control-sm smart-input"></div>
                <div class="col-6"><small class="d-block text-muted fw-bold mb-1">RF 20'</small><input id="detRF20" type="number" class="form-control form-control-sm smart-input"></div>
                <div class="col-6"><small class="d-block text-muted fw-bold mb-1">RF 40'</small><input id="detRF40" type="number" class="form-control form-control-sm smart-input"></div>
              </div>
            </div>
          </div>

        </div>
        <div class="modal-footer bg-light">
          <button type="button" class="btn btn-link text-muted text-decoration-none fw-bold" data-bs-dismiss="modal">Cancel</button>
          <button type="button" class="btn btn-dark fw-bold" onclick="saveAdminSettings()">
            <i class="fa-solid fa-floppy-disk me-2"></i>Save Configuration
          </button>
        </div>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

  <script>
    // Guard: if admin.js doesn't define toggleClock, prevent crash.
    if (typeof toggleClock !== 'function') {
      function toggleClock(){ /* noop */ }
    }

    // Keep topbar clock alive regardless of admin.js clock implementation.
    function tickClock(){
      const el = document.getElementById('realtime-clock');
      if (!el) return;
      const now = new Date();
      const hh = String(now.getHours()).padStart(2,'0');
      const mm = String(now.getMinutes()).padStart(2,'0');
      const ss = String(now.getSeconds()).padStart(2,'0');
      el.textContent = `${hh}:${mm}:${ss}`;
    }
    setInterval(tickClock, 1000);
    tickClock();

    // Print-only date
    document.addEventListener('DOMContentLoaded', () => {
      const pd = document.getElementById('print-date');
      if (pd) pd.textContent = new Date().toLocaleString();
    });

    /* =========================================
       1) CONFIG / STATE
       ========================================= */
    let STATE = {
      fx: { XAF: 1, USD: 615, EUR: 655.957 },
      demurrage: { 20: [7092, 12962.4], 40: [13465.2, 25444.8] },
      storage: { 20: [300, 1200, 3600, 6000], 40: [600, 2400, 7200, 12000] },
      yard: { 20: 100000, 40: 200000 },
      detention: {
        dry: { 20: 7400, 40: 15000 },
        rf:  { 20: 37500, 40: 75000 }
      },
      plug: 13000
    };

    const $ = id => document.getElementById(id);
    const fmt = (n, cur) => {
      return new Intl.NumberFormat("en-US", {
        style: 'decimal', minimumFractionDigits: 2, maximumFractionDigits: 2
      }).format(n) + " <span style='font-size:0.7em; color:#999'>" + cur + "</span>";
    };

    /* =========================================
       2) ACTIVE FILE SEARCH (DB-backed)
       - No JSON usage at all
       - Containers are backend default (hidden field only)
       ========================================= */
    let searchTimer = null;
    let lastSearchQ = '';

    function setReadonlyShipmentFields(isReadonly){
      const ids = ["bl","consignee","ata","grossWeight","weightUnit"];
      ids.forEach(id => {
        const el = $(id);
        if (!el) return;
        if (isReadonly) el.setAttribute('readonly', true);
        else el.removeAttribute('readonly');
      });
    }

    function clearShipmentFields(){
      $("filePickMeta").textContent = '';
      $("bl").value = '';
      $("consignee").value = '';
      $("ata").value = '';
      $("grossWeight").value = '';
      $("weightUnit").value = '';
      $("containers").value = ''; // hidden (backend default will populate after selection)
      setReadonlyShipmentFields(true);
    }

    async function apiGet(url){
      const res = await fetch(url, { credentials: 'same-origin' });
      const text = await res.text();
      try { return JSON.parse(text); }
      catch (e) { throw new Error("Non-JSON response: " + text.slice(0, 200)); }
    }

    async function searchActiveFiles(q){
      const data = await apiGet(`extra-charges-simulator.php?ajax=search_files&q=${encodeURIComponent(q)}`);
      if (!data.ok) return [];

      const dl = $("fileOptions");
      dl.innerHTML = '';

      data.items.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.ref;
        opt.label = item.label;
        dl.appendChild(opt);
      });

      return data.items;
    }

    async function loadActiveFile(ref){
      const meta = $("filePickMeta");
      meta.textContent = 'Loading file details...';
      const out = await apiGet(`extra-charges-simulator.php?ajax=file_details&ref=${encodeURIComponent(ref)}`);

      if (!out.ok) {
        meta.textContent = out.error || 'Unable to load file.';
        clearShipmentFields();
        return;
      }

      const d = out.data || {};
      $("bl").value = d.sea_bl || '';
      $("consignee").value = d.consignee || '';
      $("ata").value = d.ata_date || '';

      // weights from DB
      $("grossWeight").value = d.gross_weight || '';
      $("weightUnit").value = d.weight_unit || '';

      // containers are backend default; hidden field used for computation only
      $("containers").value = d.containers || '';

      setReadonlyShipmentFields(true);

      meta.textContent = `${d.ref} — ${d.service || ''} — ${d.status || ''}`;
      updateCalc();
    }

    function wireFileSearch(){
      const input = $("fileRefInput");

      input.addEventListener('input', () => {
        const q = input.value.trim();
        if (q.length < 2) return;

        clearTimeout(searchTimer);
        searchTimer = setTimeout(async () => {
          if (q === lastSearchQ) return;
          lastSearchQ = q;
          try { await searchActiveFiles(q); }
          catch (e) { console.error(e); }
        }, 250);
      });

      input.addEventListener('change', async () => {
        const ref = input.value.trim();
        if (!ref) {
          clearShipmentFields();
          updateCalc();
          return;
        }
        await loadActiveFile(ref);
      });
    }

    /* =========================================
       3) CALCULATION ENGINE
       ========================================= */
    function parseContainers(s) {
      if (!s) return [];
      return s.split("&").map(x => {
        const m = x.match(/(\d+)\s*\*\s*(\d+)['"’]?\s*([a-zA-Z]{2,3})/i);
        return m ? { q: +m[1], s: +m[2], t: m[3].toUpperCase() } : null;
      }).filter(Boolean);
    }

    function updateCalc() {
      // Need ATA, GateOut, and backend container spec to compute
      if (!$("ata").value || !$("gateOut").value || !$("containers").value) {
        $("chargesTableBody").innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">Select a file and enter Gate Out to calculate charges.</td></tr>`;
        $("mFree").innerText = String(+$("freeTime").value || 0);
        $("mCharge").innerText = "0";
        $("tHT").innerText = "0";
        $("tVAT").innerText = "0";
        $("tTTC").innerText = "0";
        return;
      }

      const ata = new Date($("ata").value);
      const gate = new Date($("gateOut").value);
      const retInput = $("emptyReturn").value;
      const ret = retInput ? new Date(retInput) : gate;

      const free = +$("freeTime").value || 0;
      $("mFree").innerText = free;

      const portStay = Math.max(0, Math.round((gate - ata) / 86400000));
      const dueDate = new Date(ata.getTime() + ((free - 1) * 86400000));
      const isLate = gate > dueDate;

      $("mCharge").innerText = portStay;

      const dueEl = $("mDue");
      const iconBg = $("status-icon-bg");
      const icon = $("status-icon");

      if (isLate) {
        dueEl.innerText = "EXCEEDED";
        dueEl.className = "kpi-value text-danger";
        iconBg.className = "me-3 rounded-3 bg-danger bg-opacity-10 text-danger d-flex align-items-center justify-content-center";
        icon.className = "fa-solid fa-triangle-exclamation";
      } else {
        dueEl.innerText = "OK";
        dueEl.className = "kpi-value text-success";
        iconBg.className = "me-3 rounded-3 bg-success bg-opacity-10 text-success d-flex align-items-center justify-content-center";
        icon.className = "fa-solid fa-check";
      }

      let rows = [];
      const containerList = parseContainers($("containers").value);

      containerList.forEach(c => {
        const sizeKey = (c.s === 40 || c.s === 45) ? 40 : 20;
        const typeKey = (c.t === 'RF' || c.t === 'REE') ? 'rf' : 'dry';

        // DEMURRAGE
        const d1_start = Math.max(12, free + 1);
        const d1_end = Math.min(portStay, 21);
        const d1 = Math.max(0, d1_end - d1_start + 1);
        if (d1 > 0) {
          rows.push({
            cat: "Demurrage",
            desc: `Demurrage (${c.s}' Tier 1)`,
            qty: d1,
            unit: STATE.demurrage[sizeKey][0],
            total: d1 * STATE.demurrage[sizeKey][0] * c.q
          });
        }

        const d2_start = Math.max(22, free + 1);
        const d2_end = portStay;
        const d2 = Math.max(0, d2_end - d2_start + 1);
        if (d2 > 0) {
          rows.push({
            cat: "Demurrage",
            desc: `Demurrage (${c.s}' Tier 2)`,
            qty: d2,
            unit: STATE.demurrage[sizeKey][1],
            total: d2 * STATE.demurrage[sizeKey][1] * c.q
          });
        }

        // STORAGE
        const tiers = [[12,20,0],[21,40,1],[41,70,2],[71,9999,3]];
        tiers.forEach(tier => {
          const start = tier[0], end = tier[1], rateIdx = tier[2];
          const daysInTier = Math.max(0, Math.min(portStay, end) - Math.max(free + 1, start) + 1);
          if (daysInTier > 0) {
            rows.push({
              cat: "Storage",
              desc: `Storage (${start}-${end}d)`,
              qty: daysInTier,
              unit: STATE.storage[sizeKey][rateIdx],
              total: daysInTier * STATE.storage[sizeKey][rateIdx] * c.q
            });
          }
        });

        // YARD OCCUPANCY
        if (portStay >= 14) {
          const rate = STATE.yard[sizeKey] || 0;
          rows.push({
            cat: "Yard Occupancy",
            desc: `Yard Occupancy (${c.s}')`,
            qty: 1,
            unit: rate,
            total: rate * c.q
          });
        }

        // PLUGGING (Reefer)
        if (typeKey === 'rf') {
          const plugDays = Math.max(0, portStay);
          if (plugDays > 0) {
            rows.push({
              cat: "Plugging",
              desc: `Plugging & Monitoring`,
              qty: plugDays,
              unit: STATE.plug,
              total: plugDays * STATE.plug * c.q
            });
          }
        }

        // DETENTION
        const transitDays = Math.max(0, Math.round((ret - gate) / 86400000));
        const detDays = Math.max(0, transitDays - 2);
        if (detDays > 0) {
          rows.push({
            cat: "Detention",
            desc: `Detention (${c.s}')`,
            qty: detDays,
            unit: STATE.detention[typeKey][sizeKey],
            total: detDays * STATE.detention[typeKey][sizeKey] * c.q
          });
        }
      });

      renderTable(rows);
    }

    function renderTable(rows) {
      const tbody = $("chargesTableBody");
      const filterEl = document.querySelector('.filter-pill.active');
      const activeFilter = filterEl ? filterEl.dataset.f : 'ALL';
      const cur = $("currency").value;
      const rateToCur = 1 / STATE.fx[cur]; // XAF -> Currency

      let html = "";
      let htSum = 0;

      rows.forEach(r => {
        if (activeFilter !== 'ALL' && r.cat !== activeFilter) return;

        htSum += r.total;
        const convertedTotal = r.total * rateToCur;
        const vat = convertedTotal * 0.1925;
        const ttc = convertedTotal * 1.1925;

        html += `
          <tr>
            <td class="fw-bold text-dark"><span class="badge bg-light text-dark border me-2">${r.cat}</span> ${r.desc}</td>
            <td>${r.qty}</td>
            <td class="text-end font-monospace">${fmt(convertedTotal, cur)}</td>
            <td class="text-end font-monospace text-muted">${fmt(vat, cur)}</td>
            <td class="text-end fw-bold font-monospace text-dark">${fmt(ttc, cur)}</td>
          </tr>
        `;
      });

      if (!html) {
        html = `<tr><td colspan="5" class="text-center text-muted py-4">No charges found for this category or timeline.</td></tr>`;
      }

      tbody.innerHTML = html;

      const totalHT = htSum * rateToCur;
      $("tHT").innerHTML = fmt(totalHT, cur);
      $("tVAT").innerHTML = fmt(totalHT * 0.1925, cur);
      $("tTTC").innerHTML = fmt(totalHT * 1.1925, cur);
    }

    function toggleFilter(el) {
      document.querySelectorAll('.filter-pill').forEach(e => e.classList.remove('active'));
      el.classList.add('active');
      updateCalc();
    }

    /* =========================================
       4) ADMIN MODAL LOGIC (unchanged)
       ========================================= */
    let adminModalInstance;

    function openAdminModal() {
      $("fxUSD").value = STATE.fx.USD;
      $("fxEUR").value = STATE.fx.EUR;

      $("dem20_1").value = STATE.demurrage[20][0];
      $("dem20_2").value = STATE.demurrage[20][1];
      $("dem40_1").value = STATE.demurrage[40][0];
      $("dem40_2").value = STATE.demurrage[40][1];

      $("st20_12").value = STATE.storage[20][0];
      $("st20_21").value = STATE.storage[20][1];
      $("st20_41").value = STATE.storage[20][2];
      $("st20_71").value = STATE.storage[20][3];
      $("st40_12").value = STATE.storage[40][0];
      $("st40_21").value = STATE.storage[40][1];
      $("st40_41").value = STATE.storage[40][2];
      $("st40_71").value = STATE.storage[40][3];

      $("yard20").value = STATE.yard[20];
      $("yard40").value = STATE.yard[40];

      $("detDC20").value = STATE.detention.dry[20];
      $("detDC40").value = STATE.detention.dry[40];
      $("detRF20").value = STATE.detention.rf[20];
      $("detRF40").value = STATE.detention.rf[40];

      adminModalInstance = new bootstrap.Modal($('adminModal'));
      adminModalInstance.show();
    }

    function saveAdminSettings() {
      STATE.fx.USD = +$("fxUSD").value;
      STATE.fx.EUR = +$("fxEUR").value;

      STATE.demurrage[20] = [+$("dem20_1").value, +$("dem20_2").value];
      STATE.demurrage[40] = [+$("dem40_1").value, +$("dem40_2").value];

      STATE.storage[20] = [+$("st20_12").value, +$("st20_21").value, +$("st20_41").value, +$("st20_71").value];
      STATE.storage[40] = [+$("st40_12").value, +$("st40_21").value, +$("st40_41").value, +$("st40_71").value];

      STATE.yard[20] = +$("yard20").value;
      STATE.yard[40] = +$("yard40").value;

      STATE.detention.dry[20] = +$("detDC20").value;
      STATE.detention.dry[40] = +$("detDC40").value;
      STATE.detention.rf[20]  = +$("detRF20").value;
      STATE.detention.rf[40]  = +$("detRF40").value;

      alert("Rates Updated Successfully!");
      adminModalInstance.hide();
      updateCalc();
    }

    /* =========================================
       5) INIT
       ========================================= */
    document.addEventListener('DOMContentLoaded', () => {
      wireFileSearch();

      // Calculation triggers
      ["ata","gateOut","emptyReturn","containers","freeTime"].forEach(id => {
        const el = $(id);
        if (!el) return;
        el.addEventListener("input", updateCalc);
        el.addEventListener("change", updateCalc);
      });

      clearShipmentFields();
      $("chargesTableBody").innerHTML =
        `<tr><td colspan="5" class="text-center text-muted py-4">Search and select an Ops File to begin.</td></tr>`;
    });
  </script>

</body>
</html>
