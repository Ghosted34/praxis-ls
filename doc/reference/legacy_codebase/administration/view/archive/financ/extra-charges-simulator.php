<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN','OPERATIONS','MANAGEMENT','FINANCE', 'SALES']);

$conn = db();

function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }

function jexit(array $p, int $code=200): void {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($p);
  exit;
}

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

    // We select marks_numbers to get the container string
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
        weight_unit,
        marks_numbers
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

    // Use marks_numbers
    $containerStr = (string)($row['marks_numbers'] ?? '');

    jexit([
      'ok'=>true,
      'data'=>[
        'ref'           => (string)$row['operations_file_reference'],
        'service'       => (string)($row['service_type'] ?? ''),
        'status'        => (string)($row['operations_status'] ?? ''),
        'ata_date'      => $ataDate,
        'sea_bl'        => $bl,
        'consignee'     => $cons,
        'gross_weight'  => $gw,
        'weight_unit'   => $wu,
        'containers'    => $containerStr,
      ]
    ]);
  }

  jexit(['ok'=>false,'error'=>'Unknown ajax'], 400);
}

/* =========================================================
   AUTH PROFILE
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
    /* =========================================
       PRINT STYLES (Strictly Corporate)
       ========================================= */
    @media print {
      @page { margin: 1cm; size: A4 portrait; }
      
      /* Hide everything by default */
      body > * { display: none !important; }
      
      /* Show only the print container */
      #print-container { 
         display: block !important; 
         width: 100% !important;
         font-family: 'Times New Roman', serif !important;
         color: #000 !important;
         background: #fff !important;
      }

      /* Clean styles for print elements */
      .print-header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #000; padding-bottom: 10px; }
      .print-header h2 { margin: 0; font-weight: bold; text-transform: uppercase; font-size: 1.5rem; }
      .print-header p { margin: 2px 0; font-size: 0.85rem; }
      
      .print-section { margin-bottom: 25px; }
      .print-section h5 { font-size: 1rem; font-weight: bold; text-transform: uppercase; border-bottom: 1px solid #ccc; padding-bottom: 5px; margin-bottom: 10px; }
      
      .print-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; font-size: 0.9rem; }
      .print-row { display: flex; justify-content: space-between; margin-bottom: 5px; }
      .print-label { font-weight: bold; color: #444; }
      
      table.print-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; margin-top: 10px; }
      table.print-table th { border-bottom: 2px solid #000; text-align: left; padding: 6px; font-weight: bold; }
      table.print-table td { border-bottom: 1px solid #eee; padding: 6px; }
      table.print-table tr.total-row td { border-top: 2px solid #000; font-weight: bold; font-size: 1.1rem; border-bottom: none; }
      
      .print-assumptions { font-size: 0.8rem; color: #666; margin-top: 40px; border: 1px solid #eee; padding: 10px; }
    }
    
    #print-container { display: none; } /* Hidden on screen */

    /* =========================================
       SCREEN STYLES
       ========================================= */
    :root{
      --smart-blue: #1F99D8; --smart-dark: #055B83; --smart-orange: #EE7D04;
      --smart-charcoal: #231F20; --smart-bg: #F0F4F8;
      --smart-success: #16a34a; --smart-danger: #dc2626;
    }
    h1,h2,h3,h4,h5,h6,.font-heading{ font-family:'Montserrat',sans-serif; }

    .card-custom{
      background:#fff; border-radius:12px; border:1px solid rgba(0,0,0,0.05);
      box-shadow:0 2px 12px rgba(0,0,0,0.02); height:100%; transition:transform .2s, box-shadow .2s;
    }
    .card-custom:hover{ transform: translateY(-2px); box-shadow:0 5px 20px rgba(0,0,0,0.05); }

    .form-section-title{
      font-size:.75rem; font-weight:800; color: var(--smart-charcoal);
      border-bottom:2px solid #f1f5f9; padding-bottom:8px; margin-bottom:16px;
      text-transform:uppercase; letter-spacing:.5px;
    }

    .smart-input{
      border-radius:8px; font-size:.9rem; padding:.6rem .8rem;
      border:1px solid #dee2e6; background:#fff; transition: all .2s;
    }
    .smart-input:focus{
      border-color: var(--smart-orange); box-shadow:0 0 0 3px rgba(238,125,4,0.12); outline:none;
    }
    .smart-input[readonly]{
      background:#f8f9fa; color:#6c757d; border-color:#e9ecef; cursor:not-allowed;
    }

    .kpi-title{
      font-size:.7rem; font-weight:700; text-transform:uppercase; color:#888;
      letter-spacing:.5px; white-space:nowrap;
    }
    .kpi-value{
      font-size:1.6rem; font-weight:800; color: var(--smart-charcoal); line-height:1.2;
      font-variant-numeric: tabular-nums;
    }
    .kpi-sub{ font-size:.7rem; font-weight:600; }

    .filter-pill{
      font-size:.75rem; padding:6px 16px; border-radius:999px;
      border:1px solid #e0e0e0; cursor:pointer; background:#fff; transition: all .2s;
      font-weight:600; color:#64748b;
    }
    .filter-pill:hover{ background:#f8fafc; }
    .filter-pill.active{
      background: var(--smart-orange); color:#fff; border-color: var(--smart-orange);
      box-shadow:0 2px 6px rgba(238,125,4,0.2);
    }

    .table-custom th{
      font-size:.7rem; text-transform:uppercase; color:#64748b; font-weight:700;
      border-bottom:2px solid #f1f5f9; background:#f8fafc; padding:12px 16px;
    }
    .table-custom td{
      font-size:.85rem; vertical-align:middle; padding:12px 16px; border-bottom:1px solid #f1f5f9;
    }
    .table-custom tr:last-child td{ border-bottom:none; }

    .totals-container{
      background:#f8fafc; border-radius:12px; padding:1.5rem; margin-top:1rem;
    }
    .total-row{
      display:flex; justify-content:space-between; margin-bottom:.5rem; font-size:.9rem; color:#64748b;
    }
    .grand-total{
      border-top:2px solid #cbd5e1; padding-top:1rem; margin-top:.5rem;
      font-size:1.25rem; font-weight:800; color: var(--smart-charcoal);
    }
    .hint-muted{ font-size:.75rem; color:#6b7280; }
    .validation-alert { color: var(--smart-danger); font-weight: 700; }
  </style>
</head>

<body>

  <div id="print-container">
     <div class="print-header">
        <h2>SMART LOGISTICS AND SERVICES LTD</h2>
        <p>1030 Avenue Douala Manga Bell, Bali. PO BOX 5120, Douala, Cameroon.</p>
        <p>+237 233 420 281 | invoicing@smartls.cm</p>
        <p style="margin-top:15px; font-weight:bold; border-top:1px solid #000; display:inline-block; padding:5px 20px;">EXTRA CHARGE ESTIMATE</p>
     </div>
     
     <div class="print-section">
        <h5>Shipment Details</h5>
        <div class="print-grid">
           <div class="print-row"><span class="print-label">Reference / Client:</span> <span id="pr_ref">-</span></div>
           <div class="print-row"><span class="print-label">BL Number:</span> <span id="pr_bl">-</span></div>
           <div class="print-row"><span class="print-label">Consignee:</span> <span id="pr_cons">-</span></div>
           <div class="print-row"><span class="print-label">Weight:</span> <span id="pr_wgt">-</span></div>
        </div>
     </div>

     <div class="print-section">
        <h5>Timeline</h5>
        <div class="print-grid">
           <div class="print-row"><span class="print-label">Arrival (ATA):</span> <span id="pr_ata">-</span></div>
           <div class="print-row"><span class="print-label">Gate Out:</span> <span id="pr_gate">-</span></div>
           <div class="print-row"><span class="print-label">Free Days:</span> <span id="pr_free">-</span></div>
           <div class="print-row"><span class="print-label">Port Stay:</span> <span id="pr_stay">-</span> Days</div>
        </div>
     </div>

     <div class="print-section">
        <h5>Charges</h5>
        <table class="print-table">
           <thead>
              <tr>
                 <th width="50%">Description</th>
                 <th width="15%" align="center">Qty/Days</th>
                 <th width="20%" align="right">Amount HT</th>
                 <th width="15%" align="right">Total</th>
              </tr>
           </thead>
           <tbody id="print_table_body">
              </tbody>
           <tfoot>
              <tr class="total-row">
                 <td colspan="3" align="right">NET PAYABLE (<span id="pr_cur">XAF</span>)</td>
                 <td align="right" id="pr_total">0</td>
              </tr>
           </tfoot>
        </table>
     </div>

     <div class="print-assumptions">
        <strong>Calculation Assumptions:</strong><br>
        Currency: <span id="pr_asm_cur">XAF</span> | Exchange Rate: <span id="pr_asm_rate">1.0</span> | 
        Yard Trigger: <span id="pr_asm_yard">14</span> Days<br>
        <span id="pr_asm_rates"></span>
     </div>
  </div>

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
                <span><i class="fa-solid fa-database category-icon"></i> 1. MASTER DATA MGMT</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="fin1" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                <div class="sub-menu">
                    <a href="client-master-registry.php" class="sub-link">Client Master Registry</a>
                    <a href="supplier-master-registry.php" class="sub-link">Supplier Master Registry</a>
                    <a href="employee-master.php" class="sub-link">Employee Master Registry</a>
                    <a href="financial-dictionary copy.php" class="sub-link">Financial Dictionary</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#fin2">
                <span><i class="fa-solid fa-users category-icon"></i> 2. CRM & ACQUISITION</span>
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
                <span><i class="fa-solid fa-calculator category-icon"></i> 3. COMMERCIAL & PRICING</span>
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
                <span><i class="fa-solid fa-truck-fast category-icon"></i> 4. LOGISTICS OPERATIONS</span>
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
                <span><i class="fa-solid fa-chart-line category-icon"></i> 5. JOB COST CONTROL</span>
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
                <span><i class="fa-solid fa-building-columns category-icon"></i> 6. FINANCE & TREASURY</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="fin6" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                <div class="sub-menu">
                    <a href="cash-request.php" class="sub-link">Cash Request</a>
                    <a href="purchase-order.php" class="sub-link">Purchase Order</a>
                    <a href="performa-invoice-portal.php" class="sub-link">Proforma Invoice Portal</a>
                    <a href="final-invoice-portal.php" class="sub-link">Final Invoice System</a>
                    <a href="smart-receivable.php" class="sub-link">Smart Receivables Ledger (SRL)</a>
                    <a href="debt-management.php" class="sub-link">Debt Management</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#fin7">
                <span><i class="fa-solid fa-folder-open category-icon"></i> 7. HR & ARCHIVE</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="fin7" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                <div class="sub-menu">
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
    
    <div class="row py-4 align-items-center">
      <div class="col-md-6">
        <h2 class="fw-bold font-heading mb-0">Cost Calculation</h2>
        <p class="text-muted mb-0 small">Select an active Ops File or use Manual Mode for leads.</p>
      </div>
      <div class="col-md-6 text-end">
        <div class="d-flex justify-content-end gap-2 flex-wrap">
          <select id="currency" class="form-select smart-input fw-bold" style="width: 120px;" onchange="updateCalc()">
            <option value="XAF">XAF</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
          <button class="btn btn-warning text-white fw-bold shadow-sm" onclick="openSummaryModal()">
             <i class="fa-solid fa-list-check me-2"></i>View Summary
          </button>
          <button class="btn btn-light fw-bold border shadow-sm" onclick="openAdminModal()">
            <i class="fa-solid fa-gear me-2"></i>Admin Rates
          </button>
          <button class="btn btn-dark fw-bold shadow-sm" onclick="preparePrint()">
            <i class="fa-solid fa-print me-2"></i>Print Estimate
          </button>
        </div>
      </div>
    </div>

    <div class="row g-4">
      <div class="col-lg-4">
        <div class="card-custom p-4">
          <h6 class="form-section-title"><i class="fa-solid fa-ship me-2 text-primary"></i>Shipment Parameters</h6>

          <div class="mb-3">
            <label class="form-label small fw-bold text-muted">Select File / Client</label>
            <div class="input-group">
              <span class="input-group-text bg-white border-end-0 text-muted"><i class="fa-solid fa-magnifying-glass"></i></span>
              <input class="form-control smart-input border-start-0" list="fileOptions" id="fileRefInput" placeholder="Search Active File..." autocomplete="off">
              <button class="btn btn-outline-primary border-start-0" onclick="enableManualMode()" title="Enable Manual Entry" type="button">
                 <i class="fa-solid fa-pen-to-square"></i> Manual
              </button>
              <datalist id="fileOptions"></datalist>
            </div>
            <div id="filePickMeta" class="hint-muted mt-2"></div>
          </div>
          
          <div class="mb-3">
             <label class="form-label small fw-bold text-muted">Marks & Numbers</label>
             <div class="input-group">
                <input type="text" id="containers" class="form-control smart-input" placeholder="e.g. 02*40'RF, 1*20'DC">
                <button class="btn btn-light border no-print" onclick="unlockContainers()" title="Edit Manually">
                  <i class="fa-solid fa-pen-to-square text-muted"></i>
                </button>
             </div>
             <div id="container-help" class="form-text text-muted" style="font-size: 0.7rem;">
                Format: <strong>QTY*SIZE'TYPE</strong> (e.g. 02*40'RF)
             </div>
          </div>

          <div class="mb-3">
            <label class="form-label small fw-bold text-muted">BL Number</label>
            <input type="text" id="bl" class="form-control smart-input" placeholder="Auto from DB" readonly>
          </div>

          <div class="mb-3">
            <label class="form-label small fw-bold text-muted">Consignee</label>
            <input type="text" id="consignee" class="form-control smart-input" placeholder="Auto from DB" readonly>
          </div>

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

          <hr class="my-4" style="opacity: 0.08;">

          <h6 class="form-section-title"><i class="fa-solid fa-calendar-days me-2 text-primary"></i>Timeline & Assumptions</h6>

          <div class="row g-2 mb-3">
            <div class="col-6">
              <label class="form-label small fw-bold text-muted">ATA (Arrival)</label>
              <input type="date" id="ata" class="form-control smart-input" readonly>
            </div>
            <div class="col-6">
              <label class="form-label small fw-bold text-muted">Free Days</label>
              <input type="number" id="freeTime" class="form-control smart-input" value="11" min="0">
            </div>
          </div>

          <div class="row g-2 mb-3">
            <div class="col-6">
              <label class="form-label small fw-bold text-muted">Gate Out</label>
              <input type="date" id="gateOut" class="form-control smart-input">
            </div>
            <div class="col-6">
              <label class="form-label small fw-bold text-muted">Empty Return</label>
              <input type="date" id="emptyReturn" class="form-control smart-input">
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
                <textarea class="form-control smart-input" rows="3" placeholder="Enter notes..."></textarea>
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

  <div class="modal fade" id="adminModal" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
      <div class="modal-content border-0 shadow-lg">
        <div class="modal-header bg-light border-bottom">
          <div><h5 class="modal-title fw-bold">Rate Configuration</h5></div>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body p-4">
          <h6 class="form-section-title text-primary">Exchange Rates & Triggers</h6>
          <div class="row g-3 mb-4">
            <div class="col-4"><label class="small fw-bold">USD Rate</label><input type="number" id="fxUSD" class="form-control smart-input"></div>
            <div class="col-4"><label class="small fw-bold">EUR Rate</label><input type="number" id="fxEUR" class="form-control smart-input"></div>
            <div class="col-4"><label class="small fw-bold">Yard Occ. Min Days</label><input type="number" id="yardTrigger" class="form-control smart-input" value="14"></div>
          </div>

          <h6 class="form-section-title text-primary">Demurrage (Per Day / XAF)</h6>
          <div class="table-responsive mb-4 border rounded">
            <table class="table table-sm table-borderless mb-0">
              <thead class="bg-light">
                 <tr><th class="ps-3">Window</th><th>20' DC</th><th>40' DC</th><th>20' RF</th><th>40' RF</th><th>20' HC</th><th>40' HC</th><th>20' FR</th><th>40' FR</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td class="ps-3 fw-bold small text-muted align-middle">Days 12–21</td>
                  <td><input id="dem20_1" type="number" class="form-control form-control-sm smart-input"></td>
                  <td><input id="dem40_1" type="number" class="form-control form-control-sm smart-input"></td>
                  <td><input id="dem20RF_1" type="number" class="form-control form-control-sm smart-input"></td>
                  <td><input id="dem40RF_1" type="number" class="form-control form-control-sm smart-input"></td>
                  <td><input id="dem20HC_1" type="number" class="form-control form-control-sm smart-input"></td>
                  <td><input id="dem40HC_1" type="number" class="form-control form-control-sm smart-input"></td>
                  <td><input id="dem20FR_1" type="number" class="form-control form-control-sm smart-input"></td>
                  <td><input id="dem40FR_1" type="number" class="form-control form-control-sm smart-input"></td>
                </tr>
                <tr>
                  <td class="ps-3 fw-bold small text-muted align-middle">Days 22+</td>
                  <td><input id="dem20_2" type="number" class="form-control form-control-sm smart-input"></td>
                  <td><input id="dem40_2" type="number" class="form-control form-control-sm smart-input"></td>
                  <td><input id="dem20RF_2" type="number" class="form-control form-control-sm smart-input"></td>
                  <td><input id="dem40RF_2" type="number" class="form-control form-control-sm smart-input"></td>
                  <td><input id="dem20HC_2" type="number" class="form-control form-control-sm smart-input"></td>
                  <td><input id="dem40HC_2" type="number" class="form-control form-control-sm smart-input"></td>
                  <td><input id="dem20FR_2" type="number" class="form-control form-control-sm smart-input"></td>
                  <td><input id="dem40FR_2" type="number" class="form-control form-control-sm smart-input"></td>
                </tr>
              </tbody>
            </table>
          </div>

          <h6 class="form-section-title text-primary">Storage (Per Day / XAF)</h6>
          <div class="table-responsive mb-4 border rounded">
            <table class="table table-sm table-borderless mb-0">
              <thead class="bg-light"><tr><th class="ps-3">Tier</th><th>20'</th><th>40'</th></tr></thead>
              <tbody>
                <tr><td class="ps-3 fw-bold small text-muted align-middle">12–20 Days</td><td><input id="st20_12" type="number" class="form-control form-control-sm smart-input"></td><td><input id="st40_12" type="number" class="form-control form-control-sm smart-input"></td></tr>
                <tr><td class="ps-3 fw-bold small text-muted align-middle">21–40 Days</td><td><input id="st20_21" type="number" class="form-control form-control-sm smart-input"></td><td><input id="st40_21" type="number" class="form-control form-control-sm smart-input"></td></tr>
                <tr><td class="ps-3 fw-bold small text-muted align-middle">41–70 Days</td><td><input id="st20_41" type="number" class="form-control form-control-sm smart-input"></td><td><input id="st40_41" type="number" class="form-control form-control-sm smart-input"></td></tr>
                <tr><td class="ps-3 fw-bold small text-muted align-middle">71+ Days</td><td><input id="st20_71" type="number" class="form-control form-control-sm smart-input"></td><td><input id="st40_71" type="number" class="form-control form-control-sm smart-input"></td></tr>
              </tbody>
            </table>
          </div>

          <div class="row g-3">
            <div class="col-md-6">
              <h6 class="form-section-title text-primary">Yard & Plugging</h6>
              <div class="row g-2">
                 <div class="col-12"><label class="small fw-bold text-muted">Yard Occupancy</label></div>
                 <div class="col-6 input-group input-group-sm"><span class="input-group-text bg-light">20'</span><input id="yard20" type="number" class="form-control smart-input"></div>
                 <div class="col-6 input-group input-group-sm"><span class="input-group-text bg-light">40'</span><input id="yard40" type="number" class="form-control smart-input"></div>
                 <div class="col-12 mt-2"><label class="small fw-bold text-muted">Plugging (Reefer/Day)</label></div>
                 <div class="col-6 input-group input-group-sm"><span class="input-group-text bg-light">20'</span><input id="plug20" type="number" class="form-control smart-input"></div>
                 <div class="col-6 input-group input-group-sm"><span class="input-group-text bg-light">40'</span><input id="plug40" type="number" class="form-control smart-input"></div>
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
          <button type="button" class="btn btn-link text-muted fw-bold text-decoration-none" data-bs-dismiss="modal">Cancel</button>
          <button type="button" class="btn btn-dark fw-bold" onclick="saveAdminSettings()">Save Configuration</button>
        </div>
      </div>
    </div>
  </div>

  <div class="modal fade" id="summaryModal" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content border-0 shadow">
        <div class="modal-header bg-warning text-white border-bottom-0">
          <h5 class="modal-title fw-bold font-heading"><i class="fa-solid fa-calculator me-2"></i>Charges Summary</h5>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body p-4">
          <div class="alert alert-light border mb-4">
             <h6 class="fw-bold small text-uppercase text-muted mb-2">Calculation Assumptions</h6>
             <div class="row g-2" style="font-size: 0.8rem;">
                <div class="col-6"><strong>ATA:</strong> <span id="sumATA">-</span></div>
                <div class="col-6"><strong>Gate Out:</strong> <span id="sumGate">-</span></div>
                <div class="col-6"><strong>Currency:</strong> <span id="sumCur">-</span></div>
                <div class="col-6"><strong>Exch. Rate:</strong> <span id="sumRate">-</span></div>
                <div class="col-12 border-top pt-2 mt-2">
                   <strong>Applied Rates:</strong><br>
                   <span id="sumAppliedRates" class="text-muted fst-italic">-</span>
                </div>
             </div>
          </div>
          <p class="small text-muted mb-2">Global totals (Tax Exclusive) for copy/paste:</p>
          <ul class="list-group list-group-flush mb-4" id="summaryList"></ul>
          <div class="text-end">
            <h4 class="fw-bold text-dark" id="summaryTotal">0</h4>
            <small class="text-muted">Total (HT)</small>
          </div>
        </div>
        <div class="modal-footer bg-light">
          <button type="button" class="btn btn-dark w-100 fw-bold" onclick="copySummaryToClipboard()">
            <i class="fa-regular fa-copy me-2"></i>Copy for Excel
          </button>
        </div>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

  <script>
    if (typeof toggleClock !== 'function') { function toggleClock(){} }
    function tickClock(){
      const el = document.getElementById('realtime-clock');
      if (el) el.textContent = new Date().toLocaleTimeString('en-GB');
    }
    setInterval(tickClock, 1000);
    tickClock();

    document.addEventListener('DOMContentLoaded', () => {
      const pd = document.getElementById('print-date');
      if (pd) pd.textContent = new Date().toLocaleString();
    });

    let IS_MANUAL_MODE = false;

    let STATE = {
      fx: { XAF: 1, USD: 615, EUR: 655.957 },
      yardTrigger: 14,
      demurrage: { 
         20: [7092, 12962.4], 40: [13465.2, 25444.8],
         // Inherit default initially
         '20RF': [7092, 12962.4], '40RF': [13465.2, 25444.8],
         '20HC': [7092, 12962.4], '40HC': [13465.2, 25444.8],
         '20FR': [7092, 12962.4], '40FR': [13465.2, 25444.8]
      },
      storage: { 20: [300, 1200, 3600, 6000], 40: [600, 2400, 7200, 12000] },
      yard: { 20: 100000, 40: 200000 },
      detention: { dry: { 20: 7400, 40: 15000 }, rf: { 20: 37500, 40: 75000 } },
      plug: { 20: 13000, 40: 13000 }
    };

    let GLOBAL_SUMS = {};
    const $ = id => document.getElementById(id);
    const fmt = (n, cur) => {
      return new Intl.NumberFormat("en-US", {
        style: 'decimal', minimumFractionDigits: 2, maximumFractionDigits: 2
      }).format(n) + " <span style='font-size:0.7em; color:#999'>" + cur + "</span>";
    };

    // --- MANUAL ENTRY LOGIC ---
    function enableManualMode() {
       IS_MANUAL_MODE = true;
       clearShipmentFields();
       
       ['bl', 'consignee', 'grossWeight', 'weightUnit', 'ata', 'containers', 'gateOut', 'emptyReturn'].forEach(id => {
          $(id).removeAttribute('readonly');
          $(id).value = '';
       });
       
       const sbox = $("fileRefInput");
       sbox.value = ''; sbox.placeholder = "Enter Client / Lead Name"; sbox.removeAttribute('list'); 
       $("pr_ref").innerText = "Manual Quote";
       alert("Manual Mode Enabled. All fields are editable.");
       $("containers").focus();
    }

    function unlockContainers() {
       const el = $("containers");
       const help = $("container-help");
       if (el.hasAttribute('readonly')) {
          el.removeAttribute('readonly'); el.focus();
          help.innerHTML = '<i class="fa-solid fa-triangle-exclamation me-1"></i> Manual Entry Mode';
          help.className = "form-text text-danger fw-bold";
       } else { el.focus(); }
    }

    async function apiGet(url){
      const res = await fetch(url);
      return res.json();
    }

    // --- DB SEARCH ---
    let searchTimer = null;
    let lastSearchQ = '';

    async function searchActiveFiles(q){
      if(IS_MANUAL_MODE) return; 
      const data = await apiGet(`extra-charges-simulator.php?ajax=search_files&q=${encodeURIComponent(q)}`);
      const dl = $("fileOptions"); dl.innerHTML = '';
      if(data.ok) {
         data.items.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.ref; opt.label = item.label; dl.appendChild(opt);
         });
      }
    }

    async function loadActiveFile(ref){
      if(IS_MANUAL_MODE) return; 
      const meta = $("filePickMeta"); meta.textContent = 'Loading...';
      const out = await apiGet(`extra-charges-simulator.php?ajax=file_details&ref=${encodeURIComponent(ref)}`);

      if (!out.ok) { meta.textContent = out.error || 'Error.'; return; }
      const d = out.data || {};
      $("bl").value = d.sea_bl || ''; $("consignee").value = d.consignee || '';
      $("ata").value = d.ata_date || ''; $("grossWeight").value = d.gross_weight || '';
      $("weightUnit").value = d.weight_unit || ''; $("containers").value = d.containers || '';
      
      $("pr_ref").innerText = d.ref + " (" + (d.consignee || '') + ")";

      if (d.containers) {
         $("containers").setAttribute('readonly', true);
         $("container-help").innerHTML = 'Format: <strong>QTY*SIZE\'TYPE</strong> (Loaded from DB)';
         $("container-help").className = "form-text text-muted";
      } else { $("containers").removeAttribute('readonly'); }

      setReadonlyShipmentFields(true);
      meta.textContent = `${d.ref} — ${d.service}`;
      updateCalc();
    }

    function setReadonlyShipmentFields(isReadonly){
      ["bl","consignee","ata","grossWeight","weightUnit"].forEach(id => {
        if (isReadonly) $(id).setAttribute('readonly', true);
        else $(id).removeAttribute('readonly');
      });
    }

    function clearShipmentFields(){
      $("filePickMeta").textContent = ''; $("bl").value = ''; $("consignee").value = '';
      $("ata").value = ''; $("grossWeight").value = ''; $("weightUnit").value = '';
      $("containers").value = ''; $("containers").removeAttribute('readonly');
      $("pr_ref").innerText = "-";
      if(!IS_MANUAL_MODE) setReadonlyShipmentFields(true);
    }

    function wireFileSearch(){
      const input = $("fileRefInput");
      input.addEventListener('input', () => {
        if(IS_MANUAL_MODE) { $("pr_ref").innerText = input.value || "Manual Quote"; return; }
        const q = input.value.trim();
        if (q.length < 2) return;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => searchActiveFiles(q), 300);
      });
      input.addEventListener('change', () => {
         if(!IS_MANUAL_MODE) { const val = input.value; if(val.length > 3) loadActiveFile(val); }
      });
    }

    // --- PARSER ---
    function parseContainers(s) {
      if (!s) return [];
      const parts = s.split(",");
      const result = [];
      const regex = /(\d+)[\s*xX]+(\d+)(?:['"’]|ft|FT)?\s*([a-zA-Z0-9]+)/i;
      parts.forEach(p => {
        p = p.trim(); if(!p) return;
        const m = p.match(regex);
        if (m) { result.push({ q: +m[1], s: +m[2], t: m[3].toUpperCase() }); }
      });
      return result;
    }

    function updateCalc() {
      // Print sync
      $("pr_bl").innerText = $("bl").value; $("pr_cons").innerText = $("consignee").value;
      $("pr_wgt").innerText = $("grossWeight").value + " " + $("weightUnit").value;
      $("pr_ata").innerText = $("ata").value; $("pr_gate").innerText = $("gateOut").value;
      $("pr_free").innerText = $("freeTime").value;

      if (!$("ata").value || !$("gateOut").value || !$("containers").value) {
        $("chargesTableBody").innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">Enter ATA, Gate Out and Container info.</td></tr>`;
        return;
      }

      // NORMALIZE DATES TO MIDNIGHT (Avoid Timezone/DB string bugs)
      const dATA = new Date($("ata").value); dATA.setHours(12,0,0,0);
      const dGate = new Date($("gateOut").value); dGate.setHours(12,0,0,0);
      const dRetInput = $("emptyReturn").value;
      const dRet = dRetInput ? new Date(dRetInput) : dGate; 
      if(dRetInput) dRet.setHours(12,0,0,0);
      
      const free = +$("freeTime").value || 0;
      
      // Stay = difference in days
      const portStay = Math.max(0, Math.round((dGate - dATA) / 86400000));
      $("mCharge").innerText = portStay; $("pr_stay").innerText = portStay;
      $("mFree").innerText = free;

      const dueDate = new Date(dATA.getTime() + ((free - 1) * 86400000));
      if (dGate > dueDate) {
         $("mDue").innerText = "EXCEEDED"; $("mDue").className = "kpi-value text-danger";
         $("status-icon").className = "fa-solid fa-triangle-exclamation";
      } else {
         $("mDue").innerText = "OK"; $("mDue").className = "kpi-value text-success";
         $("status-icon").className = "fa-solid fa-check";
      }

      const containerList = parseContainers($("containers").value);
      GLOBAL_SUMS = { 'Demurrage':0, 'Storage':0, 'Yard Occupancy':0, 'Plugging':0, 'Detention':0 };
      let rows = [];

      containerList.forEach(c => {
        let typeCode = 'DC';
        if(c.t.includes('RF') || c.t.includes('RE')) typeCode = 'RF';
        else if(c.t.includes('HC')) typeCode = 'HC';
        else if(c.t.includes('FR')) typeCode = 'FR';

        const sizeKey = (c.s === 40 || c.s === 45) ? 40 : 20;
        
        let demKey = sizeKey; // default
        if(typeCode === 'HC') demKey = sizeKey + 'HC';
        if(typeCode === 'FR') demKey = sizeKey + 'FR';
        if(typeCode === 'RF') demKey = sizeKey + 'RF'; // New RF Demurrage Key

        // DEMURRAGE
        const d1 = Math.max(0, Math.min(portStay, 21) - Math.max(12, free+1) + 1);
        if (d1 > 0) {
           const rate = STATE.demurrage[demKey] ? STATE.demurrage[demKey][0] : STATE.demurrage[sizeKey][0];
           const amt = d1 * rate * c.q;
           GLOBAL_SUMS['Demurrage'] += amt;
           rows.push({cat:'Demurrage', desc:`${c.s}' ${typeCode} Tier 1`, qty:d1, unit:rate, total:amt});
        }
        const d2 = Math.max(0, portStay - Math.max(22, free+1) + 1);
        if (d2 > 0) {
           const rate = STATE.demurrage[demKey] ? STATE.demurrage[demKey][1] : STATE.demurrage[sizeKey][1];
           const amt = d2 * rate * c.q;
           GLOBAL_SUMS['Demurrage'] += amt;
           rows.push({cat:'Demurrage', desc:`${c.s}' ${typeCode} Tier 2`, qty:d2, unit:rate, total:amt});
        }

        // STORAGE
        [[12,20,0],[21,40,1],[41,70,2],[71,9999,3]].forEach(t => {
           const days = Math.max(0, Math.min(portStay, t[1]) - Math.max(free+1, t[0]) + 1);
           if (days > 0) {
              const amt = days * STATE.storage[sizeKey][t[2]] * c.q;
              GLOBAL_SUMS['Storage'] += amt;
              rows.push({cat:'Storage', desc:`${t[0]}-${t[1]}d`, qty:days, unit:STATE.storage[sizeKey][t[2]], total:amt});
           }
        });

        // YARD
        if (portStay >= STATE.yardTrigger) {
           const rate = STATE.yard[sizeKey] || 0;
           const amt = rate * c.q;
           GLOBAL_SUMS['Yard Occupancy'] += amt;
           rows.push({cat:'Yard Occupancy', desc:`${c.s}' One-off`, qty:1, unit:rate, total:amt});
        }

        // PLUGGING (RF) - ATA to GateOut (Normalized Dates)
        if (typeCode === 'RF') {
           // Both are normalized to Noon.
           // Diff in millis / 86400000 = exact days difference
           // Start Day 1 (ATA) to Gate Out. Inclusive?
           // Usually billing is per day. ATA=20, Gate=21. That's 2 days (20th & 21st)? Or 24h blocks?
           // Standard practice: Count calendar days inclusive or blocks.
           // User said: "starts counting on 21/10 (ATA=20) till Gate out".
           // So Start = ATA + 1.
           
           const startPlug = new Date(dATA.getTime() + 86400000); // ATA + 1 day (Noon)
           let pDays = 0;
           
           if(dGate >= startPlug) {
              // Difference in days + 1 (inclusive of end date)
              pDays = Math.round((dGate - startPlug) / 86400000) + 1;
           }
           
           if (pDays > 0) {
              const pRate = STATE.plug[sizeKey] || 13000;
              const amt = pDays * pRate * c.q;
              GLOBAL_SUMS['Plugging'] += amt;
              rows.push({cat:'Plugging', desc:`${c.s}' RF (${pDays}d)`, qty:pDays, unit:pRate, total:amt});
           }
        }

        // DETENTION
        const trans = Math.max(0, Math.round((dRet - dGate) / 86400000));
        const detD = Math.max(0, trans - 2);
        if (detD > 0) {
           let detKey = (typeCode === 'RF') ? 'rf' : 'dry'; 
           const amt = detD * STATE.detention[detKey][sizeKey] * c.q;
           GLOBAL_SUMS['Detention'] += amt;
           rows.push({cat:'Detention', desc:`${c.s}' Return`, qty:detD, unit:STATE.detention[detKey][sizeKey], total:amt});
        }
      });

      renderTable(rows);
    }

    function renderTable(rows) {
      const tbody = $("chargesTableBody");
      const pBody = $("print_table_body");
      const filter = document.querySelector('.filter-pill.active').dataset.f;
      const cur = $("currency").value;
      const rate = 1 / STATE.fx[cur];
      
      let html = "", pHtml = "", sumHT = 0;
      rows.forEach(r => {
         sumHT += r.total;
         const val = r.total * rate;
         
         // Screen Row
         if (filter === 'ALL' || r.cat === filter) {
           html += `<tr>
             <td class="fw-bold"><span class="badge bg-light text-dark border me-2 d-print-none">${r.cat}</span>${r.desc}</td>
             <td>${r.qty}</td>
             <td class="text-end font-monospace">${fmt(val, cur)}</td>
             <td class="text-end font-monospace text-muted">${fmt(val*0.1925, cur)}</td>
             <td class="text-end fw-bold">${fmt(val*1.1925, cur)}</td>
           </tr>`;
         }
         
         // Print Row
         pHtml += `<tr>
             <td>${r.cat} - ${r.desc}</td>
             <td align="center">${r.qty}</td>
             <td align="right">${fmt(val, "")}</td>
             <td align="right">${fmt(val, "")}</td>
         </tr>`;
      });
      
      if(!html) html = `<tr><td colspan="5" class="text-center text-muted py-4">No charges.</td></tr>`;
      tbody.innerHTML = html;
      pBody.innerHTML = pHtml;
      
      const totalHT = sumHT * rate;
      $("tHT").innerHTML = fmt(totalHT, cur);
      $("tVAT").innerHTML = fmt(totalHT * 0.1925, cur);
      $("tTTC").innerHTML = fmt(totalHT * 1.1925, cur);
      
      // Print Totals
      $("pr_cur").innerText = cur;
      $("pr_total").innerText = fmt(totalHT * 1.1925, cur); // Net Payable
      
      // Print Assumptions
      $("pr_asm_cur").innerText = cur;
      $("pr_asm_rate").innerText = STATE.fx[cur].toFixed(2);
      $("pr_asm_yard").innerText = STATE.yardTrigger;
    }

    function toggleFilter(el) {
       document.querySelectorAll('.filter-pill').forEach(e=>e.classList.remove('active'));
       el.classList.add('active');
       updateCalc();
    }
    
    function preparePrint() {
       updateCalc(); // Refresh print table
       window.print();
    }

    let adminModal, summaryModal;
    
    function openAdminModal() {
       $("fxUSD").value = STATE.fx.USD; $("fxEUR").value = STATE.fx.EUR; $("yardTrigger").value = STATE.yardTrigger;
       
       $("dem20_1").value = STATE.demurrage[20][0]; $("dem20_2").value = STATE.demurrage[20][1];
       $("dem40_1").value = STATE.demurrage[40][0]; $("dem40_2").value = STATE.demurrage[40][1];
       
       $("dem20HC_1").value = STATE.demurrage['20HC'][0]; $("dem20HC_2").value = STATE.demurrage['20HC'][1];
       $("dem40HC_1").value = STATE.demurrage['40HC'][0]; $("dem40HC_2").value = STATE.demurrage['40HC'][1];
       
       $("dem20RF_1").value = STATE.demurrage['20RF'][0]; $("dem20RF_2").value = STATE.demurrage['20RF'][1];
       $("dem40RF_1").value = STATE.demurrage['40RF'][0]; $("dem40RF_2").value = STATE.demurrage['40RF'][1];
       
       $("dem20FR_1").value = STATE.demurrage['20FR'][0]; $("dem20FR_2").value = STATE.demurrage['20FR'][1];
       $("dem40FR_1").value = STATE.demurrage['40FR'][0]; $("dem40FR_2").value = STATE.demurrage['40FR'][1];

       $("st20_12").value = STATE.storage[20][0]; $("st20_21").value = STATE.storage[20][1];
       $("st20_41").value = STATE.storage[20][2]; $("st20_71").value = STATE.storage[20][3];
       $("st40_12").value = STATE.storage[40][0]; $("st40_21").value = STATE.storage[40][1];
       $("st40_41").value = STATE.storage[40][2]; $("st40_71").value = STATE.storage[40][3];
       $("yard20").value = STATE.yard[20]; $("yard40").value = STATE.yard[40];
       $("plug20").value = STATE.plug[20]; $("plug40").value = STATE.plug[40];
       $("detDC20").value = STATE.detention.dry[20]; $("detDC40").value = STATE.detention.dry[40];
       $("detRF20").value = STATE.detention.rf[20]; $("detRF40").value = STATE.detention.rf[40];

       adminModal = new bootstrap.Modal($('adminModal'));
       adminModal.show();
    }

    function saveAdminSettings() {
       STATE.fx.USD = +$("fxUSD").value; STATE.fx.EUR = +$("fxEUR").value; STATE.yardTrigger = +$("yardTrigger").value;
       STATE.demurrage[20] = [+$("dem20_1").value, +$("dem20_2").value];
       STATE.demurrage[40] = [+$("dem40_1").value, +$("dem40_2").value];
       
       STATE.demurrage['20HC'] = [+$("dem20HC_1").value, +$("dem20HC_2").value];
       STATE.demurrage['40HC'] = [+$("dem40HC_1").value, +$("dem40HC_2").value];
       
       STATE.demurrage['20RF'] = [+$("dem20RF_1").value, +$("dem20RF_2").value];
       STATE.demurrage['40RF'] = [+$("dem40RF_1").value, +$("dem40RF_2").value];
       
       STATE.demurrage['20FR'] = [+$("dem20FR_1").value, +$("dem20FR_2").value];
       STATE.demurrage['40FR'] = [+$("dem40FR_1").value, +$("dem40FR_2").value];
       
       STATE.storage[20] = [+$("st20_12").value, +$("st20_21").value, +$("st20_41").value, +$("st20_71").value];
       STATE.storage[40] = [+$("st40_12").value, +$("st40_21").value, +$("st40_41").value, +$("st40_71").value];
       STATE.yard[20] = +$("yard20").value; STATE.yard[40] = +$("yard40").value;
       STATE.plug[20] = +$("plug20").value; STATE.plug[40] = +$("plug40").value;
       STATE.detention.dry[20] = +$("detDC20").value; STATE.detention.dry[40] = +$("detDC40").value;
       STATE.detention.rf[20] = +$("detRF20").value; STATE.detention.rf[40] = +$("detRF40").value;

       alert("Saved!");
       adminModal.hide();
       updateCalc();
    }

    function openSummaryModal() {
       const ul = $("summaryList");
       const cur = $("currency").value;
       const rate = 1 / STATE.fx[cur];
       ul.innerHTML = "";
       
       $("sumATA").textContent = $("ata").value || "-";
       $("sumGate").textContent = $("gateOut").value || "-";
       $("sumCur").textContent = cur;
       $("sumRate").textContent = (STATE.fx[cur]).toFixed(2);
       
       // Dynamic Applied Rates (User Request)
       let appliedTxt = [];
       const list = parseContainers($("containers").value);
       list.forEach(c => {
          let typeCode = 'DC';
          if(c.t.includes('RF')) typeCode = 'RF';
          else if(c.t.includes('HC')) typeCode = 'HC';
          else if(c.t.includes('FR')) typeCode = 'FR';
          appliedTxt.push(`${c.s}' ${typeCode}`);
       });
       $("sumAppliedRates").textContent = [...new Set(appliedTxt)].join(", ");
       
       let gTot = 0;
       ['Demurrage','Storage','Yard Occupancy','Plugging','Detention'].forEach(c => {
          const val = (GLOBAL_SUMS[c]||0) * rate;
          gTot += val;
          const li = document.createElement("li");
          li.className = "list-group-item d-flex justify-content-between px-0";
          li.innerHTML = `<span>${c}</span><span class="fw-bold font-monospace">${fmt(val, cur)}</span>`;
          ul.appendChild(li);
       });
       $("summaryTotal").innerHTML = fmt(gTot, cur);
       summaryModal = new bootstrap.Modal($('summaryModal'));
       summaryModal.show();
    }

    function copySummaryToClipboard() {
       const cur = $("currency").value;
       const rate = 1 / STATE.fx[cur];
       let txt = "";
       ['Demurrage','Storage','Yard Occupancy','Plugging','Detention'].forEach(c => {
          txt += `${c}\t${((GLOBAL_SUMS[c]||0) * rate).toFixed(2)}\n`;
       });
       navigator.clipboard.writeText(txt);
       alert("Copied raw values!");
    }

    document.addEventListener('DOMContentLoaded', () => {
       wireFileSearch();
       ["ata","gateOut","emptyReturn","containers","freeTime"].forEach(id => {
          if($(id)) {
             $(id).addEventListener("input", updateCalc);
             $(id).addEventListener("change", updateCalc);
          }
       });
    });
  </script>
</body>
</html>