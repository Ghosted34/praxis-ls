<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN','FINANCE','MANAGEMENT','OPERATIONS']);
require_once __DIR__ . '/../../includes/dept_context.php';

$conn = db();

/**
 * Use unique helper names to avoid collisions with dept_context.php
 */
function h(?string $v): string {
  return htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8');
}

function json_exit(array $p, int $code = 200): void {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($p);
  exit;
}

function now_dt(): string {
  return (new DateTime('now'))->format('Y-m-d H:i:s');
}

$employeeId = (string)($_SESSION['auth']['employee_id'] ?? '');
$userId     = (int)($_SESSION['auth']['user_id'] ?? 0);
if ($employeeId === '' || $userId <= 0) {
  header('Location: ../../api/auth/logout.php');
  exit;
}

/**
 * Fetch current user profile (authoritative)
 */
$sqlMe = "
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
$stmtMe = $conn->prepare($sqlMe);
$stmtMe->bind_param('is', $userId, $employeeId);
$stmtMe->execute();
$me = $stmtMe->get_result()->fetch_assoc();
if (!$me) {
  header('Location: ../../api/auth/logout.php');
  exit;
}

$fullName  = (string)($me['full_name'] ?? 'User');
$firstName = trim(explode(' ', $fullName)[0] ?? 'User');

$role       = strtoupper((string)($me['role'] ?? 'OPERATIONS'));
$department = strtoupper(trim((string)($me['department'] ?? '')));

$roleLabelMap = [
  'ADMIN'      => 'SYSTEM ADMIN',
  'FINANCE'    => 'FINANCE',
  'SALES'      => 'SALES',
  'OPERATIONS' => 'OPERATIONS',
  'MANAGEMENT' => 'MANAGEMENT',
];
$roleLabel = $roleLabelMap[$role] ?? $role;

$avatarName = urlencode($fullName);
$avatarUrl  = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";

$hour = (int)date('H');
$greeting = ($hour < 12) ? 'Good morning' : (($hour < 18) ? 'Good afternoon' : 'Good evening');

/**
 * Department-based permissions (you can adjust rules here)
 */
$isDeptFinance = in_array($department, ['FINANCE'], true);
$isDeptOpsLike = in_array($department, ['OPERATIONS','SALES','ADMIN','MANAGEMENT'], true);

/**
 * Optional: allow ADMIN/MANAGEMENT to do finance actions as well
 */
$allowAdminMgmtFinanceOverride = true;
$isFinanceActor = $isDeptFinance || ($allowAdminMgmtFinanceOverride && in_array($role, ['ADMIN','MANAGEMENT'], true));
$isOpsActor     = $isDeptOpsLike || in_array($role, ['ADMIN','MANAGEMENT'], true);

/* =========================================================================
   AJAX API
   ========================================================================= */
if (isset($_GET['ajax'])) {
  $ajax = (string)$_GET['ajax'];

  if ($ajax === 'ops_files_list') {
    $q = trim((string)($_GET['q'] ?? ''));
    $limit = (int)($_GET['limit'] ?? 50);
    if ($limit < 1 || $limit > 200) $limit = 50;

    $like = '%' . $q . '%';

    $sql = "
      SELECT
        ofm.operations_file_reference AS file_ref,
        ofm.client_id,
        ofm.sea_bl,
        COALESCE(cm.client_name, '') AS client_name
      FROM operations_file_master ofm
      LEFT JOIN client_master cm ON cm.client_id = ofm.client_id
      WHERE (? = '' OR ofm.operations_file_reference LIKE ? OR ofm.sea_bl LIKE ? OR cm.client_name LIKE ?)
      ORDER BY ofm.operations_file_reference DESC
      LIMIT {$limit}
    ";
    $st = $conn->prepare($sql);
    $st->bind_param('ssss', $q, $like, $like, $like);
    $st->execute();
    $rows = $st->get_result()->fetch_all(MYSQLI_ASSOC);
    json_exit(['ok' => true, 'data' => $rows]);
  }

  if ($ajax === 'pr_list') {
    $q = trim((string)($_GET['q'] ?? ''));
    $limit = (int)($_GET['limit'] ?? 50);
    if ($limit < 1 || $limit > 200) $limit = 50;
    $like = '%' . $q . '%';

    $sql = "
      SELECT
        crm.pr_id,
        DATE(crm.created_at) AS pr_date,
        crm.category,
        crm.disburse_method,
        crm.beneficiary,
        crm.ops_file_ref,
        crm.cost_center,
        crm.amount_total,
        crm.status,
        crm.disbursed_total,
        crm.created_by,
        crm.created_at,
        COALESCE(cm.client_name, '') AS client_name,
        COALESCE(ofm.sea_bl, crm.sea_bl, '') AS sea_bl
      FROM cash_request_master crm
      LEFT JOIN operations_file_master ofm ON ofm.operations_file_reference = crm.ops_file_ref
      LEFT JOIN client_master cm ON cm.client_id = ofm.client_id
      WHERE (
        ? = ''
        OR crm.pr_id LIKE ?
        OR crm.beneficiary LIKE ?
        OR crm.ops_file_ref LIKE ?
        OR cm.client_name LIKE ?
        OR crm.cost_center LIKE ?
      )
      ORDER BY crm.created_at DESC
      LIMIT {$limit}
    ";
    $st = $conn->prepare($sql);
    $st->bind_param('ssssss', $q, $like, $like, $like, $like, $like);
    $st->execute();
    $rows = $st->get_result()->fetch_all(MYSQLI_ASSOC);
    json_exit(['ok' => true, 'data' => $rows]);
  }

  if ($ajax === 'pr_get') {
    $id = (string)($_GET['id'] ?? '');
    if ($id === '') json_exit(['ok' => false, 'error' => 'Missing id'], 400);

    $sql = "SELECT * FROM cash_request_master WHERE pr_id = ? LIMIT 1";
    $st = $conn->prepare($sql);
    $st->bind_param('s', $id);
    $st->execute();
    $hdr = $st->get_result()->fetch_assoc();
    if (!$hdr) json_exit(['ok' => false, 'error' => 'Not found'], 404);

    $sqlL = "
      SELECT line_id, line_code, line_desc, qty, unit_price, vat_rate, line_total
      FROM cash_request_lines
      WHERE pr_id = ?
      ORDER BY line_id ASC
    ";
    $stL = $conn->prepare($sqlL);
    $stL->bind_param('s', $id);
    $stL->execute();
    $lines = $stL->get_result()->fetch_all(MYSQLI_ASSOC);

    $sqlP = "
      SELECT pay_id, paid_amount, paid_by, paid_at, note
      FROM cash_request_payments
      WHERE pr_id = ?
      ORDER BY pay_id ASC
    ";
    $stP = $conn->prepare($sqlP);
    $stP->bind_param('s', $id);
    $stP->execute();
    $pays = $stP->get_result()->fetch_all(MYSQLI_ASSOC);

    json_exit(['ok' => true, 'data' => ['header' => $hdr, 'lines' => $lines, 'payments' => $pays]]);
  }

  if ($ajax === 'pr_save') {
    $raw = file_get_contents('php://input');
    $in = json_decode((string)$raw, true);
    if (!is_array($in)) json_exit(['ok' => false, 'error' => 'Invalid JSON'], 400);

    $mode = strtoupper(trim((string)($in['mode'] ?? 'NEW')));
    $prId = trim((string)($in['pr_id'] ?? ''));

    $category = strtoupper(trim((string)($in['category'] ?? 'OPS')));
    $method   = strtoupper(trim((string)($in['disburse_method'] ?? 'CASH')));

    $opsRef      = trim((string)($in['ops_file_ref'] ?? ''));
    $beneficiary = trim((string)($in['beneficiary'] ?? ''));
    $remarks     = (string)($in['remarks'] ?? '');
    $lines       = $in['lines'] ?? [];

    $costCenter = trim((string)($in['cost_center'] ?? ''));
    $ovhJust    = trim((string)($in['overhead_justification'] ?? ''));

    $bankName      = trim((string)($in['bank_name'] ?? ''));
    $accountNumber = trim((string)($in['account_number'] ?? ''));
    $accountName   = trim((string)($in['account_name'] ?? ''));
    $momoNumber    = trim((string)($in['momo_number'] ?? ''));
    $momoName      = trim((string)($in['momo_name'] ?? ''));
    $chequeNumber  = trim((string)($in['cheque_number'] ?? ''));

    if (!in_array($category, ['OPS','OVH'], true)) $category = 'OPS';
    if (!in_array($method, ['CASH','BANK','CHEQUE','MOMO'], true)) $method = 'CASH';

    if ($beneficiary === '') json_exit(['ok' => false, 'error' => 'Beneficiary is required'], 422);
    if (!is_array($lines) || count($lines) < 1) json_exit(['ok' => false, 'error' => 'At least 1 line is required'], 422);

    // Voucher method validations + normalize irrelevant fields
    if ($method === 'BANK') {
      if ($bankName === '' || $accountNumber === '' || $accountName === '') {
        json_exit(['ok' => false, 'error' => 'Bank name, account number and account name are required for Bank Transfer'], 422);
      }
      $momoNumber = '';
      $momoName   = '';
      $chequeNumber = '';
    } elseif ($method === 'MOMO') {
      if ($momoNumber === '') json_exit(['ok' => false, 'error' => 'Mobile Money number is required for MoMo'], 422);
      if ($momoName === '')   json_exit(['ok' => false, 'error' => 'Mobile Money name is required for MoMo'], 422);

      $bankName = '';
      $accountNumber = '';
      $accountName = '';
      $chequeNumber = '';
    } elseif ($method === 'CHEQUE') {
      if ($chequeNumber === '') json_exit(['ok' => false, 'error' => 'Cheque number is required for Cheque'], 422);

      $bankName = '';
      $accountNumber = '';
      $accountName = '';
      $momoNumber = '';
      $momoName   = '';
    } else { // CASH
      $bankName = '';
      $accountNumber = '';
      $accountName = '';
      $momoNumber = '';
      $momoName   = '';
      $chequeNumber = '';
    }

    // Load OPS context or enforce OVH requirements
    $clientId = '';
    $seaBl = '';

    if ($category === 'OPS') {
      if ($opsRef === '') json_exit(['ok' => false, 'error' => 'Operations file is required for OPS'], 422);

      $sql = "SELECT client_id, sea_bl FROM operations_file_master WHERE operations_file_reference = ? LIMIT 1";
      $st = $conn->prepare($sql);
      $st->bind_param('s', $opsRef);
      $st->execute();
      $of = $st->get_result()->fetch_assoc();
      if (!$of) json_exit(['ok' => false, 'error' => 'Operations file not found'], 404);

      $clientId = (string)($of['client_id'] ?? '');
      $seaBl    = (string)($of['sea_bl'] ?? '');

      // OVH-only fields cleared
      $costCenter = '';
      $ovhJust = '';
    } else { // OVH
      $opsRef = '';
      $clientId = '';
      $seaBl = '';
      if ($costCenter === '') json_exit(['ok' => false, 'error' => 'Cost Center is required for Overhead'], 422);
      if ($ovhJust === '') json_exit(['ok' => false, 'error' => 'Overhead Justification is required for Overhead'], 422);
    }

    // Normalize lines + totals
    $amountTotal = 0.0;
    $normLines = [];

    foreach ($lines as $ln) {
      if (!is_array($ln)) continue;

      $code = trim((string)($ln['line_code'] ?? ''));
      $desc = trim((string)($ln['line_desc'] ?? ''));
      $qty  = (float)($ln['qty'] ?? 0);
      $unit = (float)($ln['unit_price'] ?? 0);
      $vat  = (float)($ln['vat_rate'] ?? 0);

      if ($desc === '') continue;
      if ($qty <= 0) $qty = 1;

      $ex = $qty * $unit;
      $vatAmt = $ex * ($vat / 100.0);
      $total = $ex + $vatAmt;

      $amountTotal += $total;
      $normLines[] = [
        'line_code' => $code,
        'line_desc' => $desc,
        'qty' => $qty,
        'unit_price' => $unit,
        'vat_rate' => $vat,
        'line_total' => $total,
      ];
    }

    if (count($normLines) < 1) json_exit(['ok' => false, 'error' => 'Valid lines are required'], 422);

    $conn->begin_transaction();
    try {
      if ($mode === 'NEW') {
        $dateKey = date('Ymd');
        $prefix  = "SLAS-PR-{$dateKey}-";

        $sql = "
          SELECT pr_id
          FROM cash_request_master
          WHERE pr_id LIKE CONCAT(?, '%')
          ORDER BY pr_id DESC
          LIMIT 1
        ";
        $st = $conn->prepare($sql);
        $st->bind_param('s', $prefix);
        $st->execute();
        $last = $st->get_result()->fetch_assoc();

        $seq = 1;
        if ($last && isset($last['pr_id'])) {
          $parts = explode('-', (string)$last['pr_id']);
          $tail = (int)end($parts);
          if ($tail > 0) $seq = $tail + 1;
        }
        $prId = $prefix . str_pad((string)$seq, 4, '0', STR_PAD_LEFT);

        $sqlI = "
          INSERT INTO cash_request_master
          (pr_id, category, disburse_method, ops_file_ref, client_id, sea_bl, cost_center, overhead_justification,
           bank_name, account_number, account_name, momo_number, momo_name, cheque_number,
           beneficiary, remarks, amount_total, status, created_by, created_at)
          VALUES
          (?, ?, ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?, ?,
           ?, ?, ?, 'DRAFT', ?, ?)
        ";
        $stI = $conn->prepare($sqlI);
        $createdAt = now_dt();

        // 16 strings + 1 double + 2 strings = 19 vars total
        $stI->bind_param(
          'ssssssssssssssssdss',
          $prId, $category, $method, $opsRef, $clientId, $seaBl, $costCenter, $ovhJust,
          $bankName, $accountNumber, $accountName, $momoNumber, $momoName, $chequeNumber,
          $beneficiary, $remarks, $amountTotal, $employeeId, $createdAt
        );
        $stI->execute();
        // remove spaces in type string (mysqli does not accept spaces)
        // so re-bind correctly:
        $stI->bind_param(
          'ssssssssssssssssdss',
          $prId, $category, $method, $opsRef, $clientId, $seaBl, $costCenter, $ovhJust,
          $bankName, $accountNumber, $accountName, $momoNumber, $momoName, $chequeNumber,
          $beneficiary, $remarks, $amountTotal, $employeeId, $createdAt
        );

      } else {
        if ($prId === '') json_exit(['ok' => false, 'error' => 'Missing pr_id for update'], 400);

        $sqlC = "SELECT status FROM cash_request_master WHERE pr_id = ? LIMIT 1";
        $stC = $conn->prepare($sqlC);
        $stC->bind_param('s', $prId);
        $stC->execute();
        $cur = $stC->get_result()->fetch_assoc();
        if (!$cur) json_exit(['ok' => false, 'error' => 'Not found'], 404);

        $curStatus = (string)$cur['status'];
        if (!in_array($curStatus, ['DRAFT','REJECTED'], true)) {
          json_exit(['ok' => false, 'error' => 'Request is locked and cannot be edited in this status'], 409);
        }

        $sqlU = "
          UPDATE cash_request_master
          SET category=?, disburse_method=?, ops_file_ref=?, client_id=?, sea_bl=?, cost_center=?, overhead_justification=?,
              bank_name=?, account_number=?, account_name=?, momo_number=?, momo_name=?, cheque_number=?,
              beneficiary=?, remarks=?, amount_total=?, updated_by=?, updated_at=?
          WHERE pr_id=?
          LIMIT 1
        ";
        $stU = $conn->prepare($sqlU);
        $updatedAt = now_dt();

        // 17 strings + 1 double + 3 strings? Actually:
        // category(s) method(s) ops(s) client(s) sea(s) cost(s) ovh(s)
        // bank(s) accNo(s) accName(s) momoNo(s) momoName(s) cheque(s)
        // beneficiary(s) remarks(s) amount(d) updated_by(s) updated_at(s) pr_id(s)
        $stU->bind_param(
  'ssssssssssssssssdss',
  $category, $method, $opsRef, $clientId, $seaBl, $costCenter, $ovhJust,
  $bankName, $accountNumber, $accountName, $momoNumber, $momoName, $chequeNumber,
  $beneficiary, $remarks, $amountTotal, $employeeId, $updatedAt, $prId
);

        $stU->execute();

        $sqlD = "DELETE FROM cash_request_lines WHERE pr_id = ?";
        $stD = $conn->prepare($sqlD);
        $stD->bind_param('s', $prId);
        $stD->execute();
      }

      $sqlL = "
        INSERT INTO cash_request_lines
        (pr_id, line_code, line_desc, qty, unit_price, vat_rate, line_total)
        VALUES
        (?, ?, ?, ?, ?, ?, ?)
      ";
      $stL = $conn->prepare($sqlL);

      foreach ($normLines as $ln) {
        $code = (string)$ln['line_code'];
        $desc = (string)$ln['line_desc'];
        $qty  = (float)$ln['qty'];
        $unit = (float)$ln['unit_price'];
        $vat  = (float)$ln['vat_rate'];
        $tot  = (float)$ln['line_total'];

        $stL->bind_param('sssdddd', $prId, $code, $desc, $qty, $unit, $vat, $tot);
        $stL->execute();
      }

      $conn->commit();
      json_exit(['ok' => true, 'data' => ['pr_id' => $prId]]);
    } catch (Throwable $ex) {
      $conn->rollback();
      json_exit(['ok' => false, 'error' => 'Save failed: ' . $ex->getMessage()], 500);
    }
  }

  if ($ajax === 'pr_transition') {
    $raw = file_get_contents('php://input');
    $in = json_decode((string)$raw, true);
    if (!is_array($in)) json_exit(['ok' => false, 'error' => 'Invalid JSON'], 400);

    $prId = trim((string)($in['pr_id'] ?? ''));
    $to   = trim((string)($in['to_status'] ?? ''));
    if ($prId === '' || $to === '') json_exit(['ok' => false, 'error' => 'Missing pr_id or to_status'], 400);

    $sql = "SELECT status FROM cash_request_master WHERE pr_id = ? LIMIT 1";
    $st = $conn->prepare($sql);
    $st->bind_param('s', $prId);
    $st->execute();
    $cur = $st->get_result()->fetch_assoc();
    if (!$cur) json_exit(['ok' => false, 'error' => 'Not found'], 404);

    $from = (string)$cur['status'];

    if ($to === 'SUBMITTED') {
      if (!$isOpsActor) json_exit(['ok' => false, 'error' => 'Only Operations/Sales/Admin/Management can submit'], 403);
      if (!in_array($from, ['DRAFT','REJECTED'], true)) json_exit(['ok' => false, 'error' => 'Invalid transition'], 409);

      $sqlU = "UPDATE cash_request_master SET status='SUBMITTED', updated_by=?, updated_at=? WHERE pr_id=? LIMIT 1";
      $stU = $conn->prepare($sqlU);
      $t = now_dt();
      $stU->bind_param('sss', $employeeId, $t, $prId);
      $stU->execute();
      json_exit(['ok' => true]);
    }

    if ($to === 'VALIDATED') {
      if (!$isFinanceActor) json_exit(['ok' => false, 'error' => 'Only Finance can validate'], 403);
      if ($from !== 'SUBMITTED') json_exit(['ok' => false, 'error' => 'Invalid transition'], 409);

      $sqlU = "
        UPDATE cash_request_master
        SET status='VALIDATED', validated_by=?, validated_at=?, updated_by=?, updated_at=?
        WHERE pr_id=? LIMIT 1
      ";
      $stU = $conn->prepare($sqlU);
      $t = now_dt();
      $stU->bind_param('sssss', $employeeId, $t, $employeeId, $t, $prId);
      $stU->execute();
      json_exit(['ok' => true]);
    }

    if ($to === 'REJECTED') {
      if (!$isFinanceActor) json_exit(['ok' => false, 'error' => 'Only Finance can reject'], 403);
      if (!in_array($from, ['SUBMITTED','VALIDATED'], true)) json_exit(['ok' => false, 'error' => 'Invalid transition'], 409);

      $sqlU = "
        UPDATE cash_request_master
        SET status='REJECTED', rejected_by=?, rejected_at=?, updated_by=?, updated_at=?
        WHERE pr_id=? LIMIT 1
      ";
      $stU = $conn->prepare($sqlU);
      $t = now_dt();
      $stU->bind_param('sssss', $employeeId, $t, $employeeId, $t, $prId);
      $stU->execute();
      json_exit(['ok' => true]);
    }

    json_exit(['ok' => false, 'error' => 'Unsupported transition'], 400);
  }

  if ($ajax === 'pr_disburse') {
    if (!$isFinanceActor) json_exit(['ok' => false, 'error' => 'Only Finance can disburse'], 403);

    $raw = file_get_contents('php://input');
    $in = json_decode((string)$raw, true);
    if (!is_array($in)) json_exit(['ok' => false, 'error' => 'Invalid JSON'], 400);

    $prId = trim((string)($in['pr_id'] ?? ''));
    $pay  = (float)($in['paid_amount'] ?? 0);
    $note = trim((string)($in['note'] ?? ''));

    if ($prId === '' || $pay <= 0) json_exit(['ok' => false, 'error' => 'Missing pr_id or paid_amount'], 400);

    $conn->begin_transaction();
    try {
      $sql = "SELECT status, amount_total, disbursed_total FROM cash_request_master WHERE pr_id=? LIMIT 1";
      $st = $conn->prepare($sql);
      $st->bind_param('s', $prId);
      $st->execute();
      $hdr = $st->get_result()->fetch_assoc();
      if (!$hdr) json_exit(['ok' => false, 'error' => 'Not found'], 404);

      $status  = (string)$hdr['status'];
      $total   = (float)$hdr['amount_total'];
      $already = (float)$hdr['disbursed_total'];

      if (!in_array($status, ['VALIDATED','PARTIALLY_DISBURSED'], true)) {
        json_exit(['ok' => false, 'error' => 'Only VALIDATED/PARTIALLY_DISBURSED can be disbursed'], 409);
      }

      $newTotal = $already + $pay;
      if ($newTotal > $total + 0.00001) json_exit(['ok' => false, 'error' => 'Payment exceeds total amount'], 422);

      $sqlP = "INSERT INTO cash_request_payments (pr_id, paid_amount, paid_by, note) VALUES (?,?,?,?)";
      $stP = $conn->prepare($sqlP);
      $stP->bind_param('sdss', $prId, $pay, $employeeId, $note);
      $stP->execute();

      $newStatus = ($newTotal >= $total - 0.00001) ? 'DISBURSED' : 'PARTIALLY_DISBURSED';

      $sqlU = "
        UPDATE cash_request_master
        SET disbursed_total=?, status=?, updated_by=?, updated_at=?
        WHERE pr_id=? LIMIT 1
      ";
      $stU = $conn->prepare($sqlU);
      $t = now_dt();
      $stU->bind_param('dssss', $newTotal, $newStatus, $employeeId, $t, $prId);
      $stU->execute();

      $conn->commit();
      json_exit(['ok' => true, 'data' => ['status' => $newStatus, 'disbursed_total' => $newTotal]]);
    } catch (Throwable $ex) {
      $conn->rollback();
      json_exit(['ok' => false, 'error' => 'Disburse failed: ' . $ex->getMessage()], 500);
    }
  }

  json_exit(['ok' => false, 'error' => 'Unknown ajax endpoint'], 404);
}
?>

<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Cash Requests | Smart LS</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet" />
  <link rel="stylesheet" href="../../css/admin.css" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

  <style>
    .table-card{background:#fff;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden}
    .table-header{padding:16px 20px;border-bottom:1px solid #E2E8F0;display:flex;justify-content:space-between;align-items:center}
    .smart-input{width:100%;padding:10px 14px;border:1px solid #CBD5E1;border-radius:8px}
    .status-pill{display:inline-flex;align-items:center;padding:4px 10px;border-radius:999px;font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.4px;border:1px solid transparent}
    .lines-table th{font-size:.75rem;text-transform:uppercase}
    .mono{font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace}
    .btn-xs{padding:.25rem .45rem;font-size:.8rem}
    .hint{font-size:.75rem;color:#64748B}
  </style>
</head>
<body>

  <!-- SIDEBAR (FROM index.php) -->
  <nav class="sidebar">
    <div class="sidebar-header">
      <a href="#" class="brand-logo"><i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span></a>
    </div>

    <div class="sidebar-menu accordion" id="adminMenu">
      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu1">
          <span><i class="fa-solid fa-shield-halved category-icon"></i> System &amp; Governance</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu1" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="index.php" class="sub-link">Dashboard</a>
            <a href="user-role-management.php" class="sub-link">User &amp; Role (IAM)</a>
            
          </div>
        </div>
      </div>

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu2">
          <span><i class="fa-solid fa-users category-icon"></i> Workforce &amp; Org</span>
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
          <span><i class="fa-solid fa-hand-holding-dollar category-icon"></i> Sales &amp; Intake</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu4" class="accordion-collapse collapse show" data-bs-parent="#adminMenu">
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
          <span><i class="fa-solid fa-file-invoice-dollar category-icon"></i> Finance &amp; Billing</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu6" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="costing-module.php" class="sub-link">Costing Module</a>
            <a href="#" class="sub-link">Proforma / Advance</a>
            <a href="#" class="sub-link">Final Invoice</a>
            <a href="#" class="sub-link">Collections</a>
            <a href="cash-request.php" class="sub-link active">Cash Requests</a>
            <a href="#" class="sub-link">Expenditure Journal</a>
            <a href="#" class="sub-link">Cost Exposure</a>
          </div>
        </div>
      </div>

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu7">
          <span><i class="fa-solid fa-chart-pie category-icon"></i> Reports &amp; Docs</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu7" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="documents-vault.php" class="sub-link">Document Vault</a>
            <a href="#" class="sub-link">Dashboards &amp; KPIs</a>
            <a href="#" class="sub-link">Exports (Accounting)</a>
          </div>
        </div>
      </div>
    </div>

    <div class="sidebar-footer">
      <button class="btn btn-outline-danger w-100 btn-sm fw-bold">
        <i class="fa-solid fa-right-from-bracket me-2"></i> Sign Out
      </button>
    </div>
  </nav>

  <!-- TOP NAVBAR -->
  <div class="top-navbar">
    <div>
      <h5 class="mb-0 fw-bold text-dark">Cash Requests</h5>
      <small class="text-muted" style="font-size: 0.7rem;">FINANCE DISBURSEMENT WORKFLOW</small>
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
          <div class="fw-bold fs-6"><?php echo h($fullName); ?></div>
          <small class="text-primary fw-bold" style="font-size: 0.65rem; letter-spacing: 0.5px;">
            <?php echo h($roleLabel); ?>
          </small>
        </div>
        <img src="<?php echo h($avatarUrl); ?>" class="rounded-circle shadow-sm" width="38" height="38" alt="<?php echo h($firstName); ?>">
      </div>
    </div>
  </div>

  <div class="main-content px-4 pb-5">
    <div class="row pt-4 mb-3">
      <div class="col-12">
        <div class="d-flex justify-content-between align-items-end">
          <div>
            <h2 class="fw-bold mb-1"><?php echo h($greeting); ?>, <?php echo h($firstName); ?>!</h2>
            <p class="mb-0 text-muted">Create, validate, and disburse operational cash requests with auditability.</p>
            <div class="hint mt-1">Dept: <strong><?php echo h($department ?: 'N/A'); ?></strong></div>
          </div>
          <div class="d-flex gap-2">
            <button class="btn btn-outline-dark fw-bold" id="btnRefresh"><i class="fa-solid fa-arrows-rotate me-2"></i>Refresh</button>
            <button class="btn btn-primary fw-bold" style="background: var(--smart-orange); border: none;" id="btnNew">
              <i class="fa-solid fa-plus me-2"></i>New Request
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- TABLE -->
    <div class="table-card">
      <div class="table-header">
        <div class="d-flex align-items-center gap-2">
          <i class="fa-solid fa-magnifying-glass text-muted"></i>
          <input type="text" class="smart-input" id="tableSearch" placeholder="Search PR, beneficiary, file, client, cost center..." style="width: 380px;">
        </div>
        <div class="text-muted small">Role: <strong><?php echo h($roleLabel); ?></strong></div>
      </div>

      <div class="table-responsive">
        <table class="table table-hover mb-0">
          <thead class="bg-light">
            <tr>
              <th>PR Number</th>
              <th>Date</th>
              <th>Category</th>
              <th>Voucher</th>
              <th>Context</th>
              <th class="text-end">Amount</th>
              <th>Status</th>
              <th class="text-end">Action</th>
            </tr>
          </thead>
          <tbody id="prTableBody"></tbody>
        </table>
      </div>

      <div class="p-3 border-top text-center text-muted small">
        Showing latest records. Use search to filter.
      </div>
    </div>
  </div>

  <!-- MODAL -->
  <div class="modal fade" id="requestModal" tabindex="-1" data-bs-backdrop="static">
    <div class="modal-dialog modal-xl">
      <div class="modal-content">
        <div class="modal-header">
          <div>
            <h5 class="fw-bold mb-0" id="modalTitle">New Cash Request</h5>
            <div class="text-muted small" id="modalSub">ID: New</div>
          </div>
          <div class="d-flex gap-2 align-items-center">
            <span class="status-pill bg-light text-dark border" id="modalStatus">DRAFT</span>
            <button class="btn-close" data-bs-dismiss="modal"></button>
          </div>
        </div>

        <div class="modal-body">
          <form id="prForm">
            <div class="row g-4">
              <div class="col-md-4">
                <label class="form-label fw-bold small text-uppercase">Voucher / Disbursement Method</label>
                <select class="smart-input fw-bold" id="disburseMethod">
                  <option value="CASH">Cash Voucher</option>
                  <option value="BANK">Bank Transfer</option>
                  <option value="CHEQUE">Cheque</option>
                  <option value="MOMO">Mobile Money</option>
                </select>

                <!-- Method details -->
                <div class="mt-3" id="bankBox" style="display:none;">
                  <label class="form-label fw-bold small text-uppercase">Bank Details</label>
                  <input type="text" class="smart-input mb-2" id="bankName" placeholder="Bank Name">
                  <input type="text" class="smart-input mb-2" id="accountNumber" placeholder="Account Number">
                  <input type="text" class="smart-input" id="accountName" placeholder="Account Name">
                </div>

                <div class="mt-3" id="momoBox" style="display:none;">
                  <label class="form-label fw-bold small text-uppercase">Mobile Money Details</label>
                  <input type="text" class="smart-input mb-2" id="momoName" placeholder="MoMo Name (Registered Name)">
                  <input type="text" class="smart-input" id="momoNumber" placeholder="MoMo Number">
                </div>


                <div class="mt-3" id="chequeBox" style="display:none;">
                  <label class="form-label fw-bold small text-uppercase">Cheque Number</label>
                  <input type="text" class="smart-input" id="chequeNumber" placeholder="Cheque Ref/Number">
                </div>

                <div class="mt-3">
                  <label class="form-label fw-bold small text-uppercase">Category</label>
                  <div class="btn-group w-100" role="group">
                    <input type="radio" class="btn-check" name="cat" id="catOps" autocomplete="off" checked>
                    <label class="btn btn-outline-secondary fw-bold" for="catOps">Operations</label>
                    <input type="radio" class="btn-check" name="cat" id="catOvh" autocomplete="off">
                    <label class="btn btn-outline-secondary fw-bold" for="catOvh">Overhead</label>
                  </div>
                </div>

                <div class="mt-3">
                  <label class="form-label fw-bold small text-uppercase">Beneficiary / Payee</label>
                  <input type="text" class="smart-input" id="beneficiary" placeholder="e.g. Customs, Maersk, Employee Name">
                </div>

                <div class="mt-3">
                  <label class="form-label fw-bold small text-uppercase">Created By</label>
                  <div class="p-2 bg-light border rounded small">
                    <div><strong><?php echo h($employeeId); ?></strong> — <?php echo h($fullName); ?></div>
                    <div class="text-muted" id="createdAtLine">Created by <?php echo h($employeeId); ?> at --:--:--</div>
                  </div>
                </div>
              </div>

              <div class="col-md-8">
                <!-- OPS CONTEXT -->
                <div id="opsContext">
                  <div class="d-flex justify-content-between align-items-center">
                    <label class="form-label fw-bold small text-uppercase mb-0">Cost Context (Operations File)</label>
                    <button type="button" class="btn btn-sm btn-outline-dark fw-bold" id="btnReloadFiles">
                      <i class="fa-solid fa-rotate me-1"></i> Reload Files
                    </button>
                  </div>

                  <div class="mt-2">
                    <select class="smart-input fw-bold" id="opsFileSelect">
                      <option value="">Select File...</option>
                    </select>
                    <div class="text-muted small mt-1">Source: operations_file_master + client_master</div>
                  </div>

                  <div class="row g-2 mt-2">
                    <div class="col-md-6">
                      <label class="form-label fw-bold small text-uppercase">BL Number</label>
                      <input type="text" class="smart-input mono bg-light" id="blNumber" readonly>
                    </div>
                    <div class="col-md-6">
                      <label class="form-label fw-bold small text-uppercase">Client</label>
                      <input type="text" class="smart-input bg-light" id="clientName" readonly>
                    </div>
                  </div>
                </div>

                <!-- OVH CONTEXT -->
                <div id="ovhContext" class="d-none">
                  <div class="row g-2">
                    <div class="col-md-6">
                      <label class="form-label fw-bold small text-uppercase">Cost Center</label>
                      <select class="smart-input fw-bold" id="costCenter">
                        <option value="">Select Cost Center...</option>
                        <option value="GENERAL_SERVICES">General Services</option>
                        <option value="HR_ADMIN">HR &amp; Admin</option>
                        <option value="FINANCE">Finance</option>
                        <option value="IT_SYSTEMS">IT Systems</option>
                        <option value="SALES">Sales</option>
                        <option value="OPERATIONS">Operations</option>
                      </select>
                      <div class="hint mt-1">Required for Overhead.</div>
                    </div>
                    <div class="col-md-6">
                      <label class="form-label fw-bold small text-uppercase">Overhead Justification</label>
                      <textarea class="smart-input" id="ovhJust" rows="3" placeholder="Explain the business need..."></textarea>
                    </div>
                  </div>
                </div>

                <!-- LINES -->
                <div class="mt-4">
                  <div class="d-flex justify-content-between align-items-center">
                    <h6 class="fw-bold mb-0 text-uppercase">Requisition Lines</h6>
                    <button type="button" class="btn btn-sm btn-outline-primary fw-bold" id="btnAddLine">
                      <i class="fa-solid fa-plus me-1"></i>Add Line
                    </button>
                  </div>

                  <div class="table-responsive mt-2">
                    <table class="table table-sm align-middle lines-table" id="linesTable">
                      <thead class="bg-light">
                        <tr>
                          <th style="width:15%">Code</th>
                          <th>Description</th>
                          <th style="width:10%" class="text-end">Qty</th>
                          <th style="width:15%" class="text-end">Unit</th>
                          <th style="width:10%" class="text-end">VAT %</th>
                          <th style="width:15%" class="text-end">Total</th>
                          <th style="width:5%"></th>
                        </tr>
                      </thead>
                      <tbody></tbody>
                    </table>
                  </div>

                  <div class="row mt-2">
                    <div class="col-md-7">
                      <label class="form-label fw-bold small text-uppercase">Remarks</label>
                      <textarea class="smart-input" id="remarks" rows="3" placeholder="Instructions, references, context..."></textarea>
                    </div>
                    <div class="col-md-5">
                      <div class="p-3 border rounded bg-light">
                        <div class="d-flex justify-content-between"><span>Subtotal</span><strong id="sumHt">0</strong></div>
                        <div class="d-flex justify-content-between"><span>VAT</span><strong id="sumVat">0</strong></div>
                        <hr class="my-2">
                        <div class="d-flex justify-content-between"><span>Total</span><strong id="sumTtc">0</strong></div>
                      </div>
                    </div>
                  </div>

                  <div class="mt-3" id="financeDisburseBox" style="display:none;">
                    <div class="alert alert-info small mb-2">
                      Finance can disburse once VALIDATED. Partial payments supported.
                    </div>
                    <div class="input-group">
                      <span class="input-group-text fw-bold">Pay</span>
                      <input type="number" class="form-control" id="payAmount" min="1" step="1">
                      <button type="button" class="btn btn-success fw-bold" id="btnPayNow">Disburse</button>
                    </div>
                    <div class="text-muted small mt-1" id="payHint"></div>
                  </div>

                  <div class="mt-3" id="paymentsBox" style="display:none;">
                    <h6 class="fw-bold text-uppercase mb-2">Payments</h6>
                    <div class="table-responsive">
                      <table class="table table-sm">
                        <thead class="bg-light">
                          <tr>
                            <th>Date</th>
                            <th>Paid By</th>
                            <th class="text-end">Amount</th>
                            <th>Note</th>
                          </tr>
                        </thead>
                        <tbody id="paymentsBody"></tbody>
                      </table>
                    </div>
                  </div>

                </div>
              </div>
            </div>
          </form>
        </div>

        <div class="modal-footer d-flex justify-content-between">
          <div class="text-muted small">
            Created By: <strong class="text-dark"><?php echo h($employeeId); ?></strong>
          </div>
          <div class="d-flex gap-2" id="modalActions">
            <button class="btn btn-light border fw-bold" data-bs-dismiss="modal">Close</button>
          </div>
        </div>

      </div>
    </div>
  </div>

  <!-- TOAST -->
  <div class="toast-container position-fixed top-0 end-0 p-3" style="z-index: 2000;">
    <div id="liveToast" class="toast align-items-center text-white bg-dark border-0 shadow-lg" role="alert" aria-live="assertive" aria-atomic="true">
      <div class="d-flex">
        <div class="toast-body fw-bold" id="toastMessage">Action Successful</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

  <script>
    if (typeof toggleClock !== 'function') { function toggleClock(){ /* noop */ } }
    function tickClock(){
      const el = document.getElementById('realtime-clock');
      if (!el) return;
      const now = new Date();
      const hh = String(now.getHours()).padStart(2,'0');
      const mm = String(now.getMinutes()).padStart(2,'0');
      const ss = String(now.getSeconds()).padStart(2,'0');
      el.textContent = `${hh}:${mm}:${ss}`;
    }
    setInterval(tickClock, 1000); tickClock();

    const ROLE = <?php echo json_encode($role); ?>;
    const DEPARTMENT = <?php echo json_encode($department); ?>;
    const EMPLOYEE_ID = <?php echo json_encode($employeeId); ?>;

    const API = {
      opsFiles: (q='') => `cash-request.php?ajax=ops_files_list&q=${encodeURIComponent(q)}&limit=100`,
      prList:  (q='') => `cash-request.php?ajax=pr_list&q=${encodeURIComponent(q)}&limit=100`,
      prGet:   (id)   => `cash-request.php?ajax=pr_get&id=${encodeURIComponent(id)}`,
      prSave:         `cash-request.php?ajax=pr_save`,
      prTransition:   `cash-request.php?ajax=pr_transition`,
      prDisburse:     `cash-request.php?ajax=pr_disburse`,
    };

    let ACTIVE = { mode:'NEW', pr_id:'', status:'DRAFT', disbursed_total:0, amount_total:0 };

    const modalEl = document.getElementById('requestModal');
    const modal = new bootstrap.Modal(modalEl);

    function showToast(msg){
      document.getElementById('toastMessage').innerText = msg;
      new bootstrap.Toast(document.getElementById('liveToast')).show();
    }

    async function apiGet(url){
      const r = await fetch(url, { credentials:'same-origin' });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Server error');
      return j.data;
    }
    async function apiPost(url, payload){
      const r = await fetch(url, {
        method:'POST',
        headers: { 'Content-Type':'application/json' },
        credentials:'same-origin',
        body: JSON.stringify(payload)
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Server error');
      return j.data;
    }

    function statusPillClass(status){
      const map = {
        'DRAFT': 'bg-light text-dark border',
        'SUBMITTED': 'bg-warning bg-opacity-25 text-warning-emphasis border-warning',
        'VALIDATED': 'bg-info bg-opacity-25 text-info-emphasis border-info',
        'REJECTED': 'bg-danger bg-opacity-10 text-danger border-danger',
        'PARTIALLY_DISBURSED': 'bg-success bg-opacity-10 text-success border-success',
        'DISBURSED': 'bg-success bg-opacity-25 text-success border-success'
      };
      return map[status] || 'bg-light text-dark border';
    }

    function updateStatusUI(){
      const st = document.getElementById('modalStatus');
      st.innerText = ACTIVE.status;
      st.className = `status-pill ${statusPillClass(ACTIVE.status)}`;
      document.getElementById('modalSub').innerText = `ID: ${ACTIVE.pr_id || 'New'}`;
    }

    function setCreatedLine(){
      document.getElementById('createdAtLine').innerText =
        `Created by ${EMPLOYEE_ID} at ${new Date().toLocaleTimeString()}`;
    }

    function catValue(){
      return document.getElementById('catOvh').checked ? 'OVH' : 'OPS';
    }

    function setCategoryUI(){
      const cat = catValue();
      if (cat === 'OPS') {
        document.getElementById('opsContext').classList.remove('d-none');
        document.getElementById('ovhContext').classList.add('d-none');
      } else {
        document.getElementById('opsContext').classList.add('d-none');
        document.getElementById('ovhContext').classList.remove('d-none');
        // Clear ops fields for OVH
        document.getElementById('opsFileSelect').value = '';
        document.getElementById('blNumber').value = '';
        document.getElementById('clientName').value = '';
      }
    }

    function setVoucherUI(){
  const m = document.getElementById('disburseMethod').value;

  document.getElementById('bankBox').style.display   = (m === 'BANK') ? 'block' : 'none';
  document.getElementById('momoBox').style.display   = (m === 'MOMO') ? 'block' : 'none';
  document.getElementById('chequeBox').style.display = (m === 'CHEQUE') ? 'block' : 'none';

  if (m !== 'BANK') {
    document.getElementById('bankName').value = '';
    document.getElementById('accountNumber').value = '';
    document.getElementById('accountName').value = '';
  }
  if (m !== 'MOMO') {
    document.getElementById('momoName').value = '';
    document.getElementById('momoNumber').value = '';
  }
  if (m !== 'CHEQUE') {
    document.getElementById('chequeNumber').value = '';
  }
}


    function money(n){
      const x = Number(n || 0);
      return x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function escapeHtml(s){
      return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
    }

    function addLine(seed = null){
      const tb = document.querySelector('#linesTable tbody');
      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td><input class="form-control form-control-sm line-code" placeholder="Code" value="${seed?.line_code ? escapeHtml(seed.line_code) : ''}"></td>
        <td><input class="form-control form-control-sm line-desc" placeholder="Description" value="${seed?.line_desc ? escapeHtml(seed.line_desc) : ''}"></td>
        <td><input type="number" class="form-control form-control-sm text-end line-qty" min="0" step="1" value="${seed?.qty ?? 1}"></td>
        <td><input type="number" class="form-control form-control-sm text-end line-unit" min="0" step="0.01" value="${seed?.unit_price ?? 0}"></td>
        <td><input type="number" class="form-control form-control-sm text-end line-vat" min="0" step="0.01" value="${seed?.vat_rate ?? 0}"></td>
        <td class="text-end fw-bold line-total">0</td>
        <td class="text-end">
          <button type="button" class="btn btn-outline-danger btn-xs btnDel"><i class="fa-solid fa-trash"></i></button>
        </td>
      `;
      tb.appendChild(tr);

      tr.querySelectorAll('input').forEach(i => i.addEventListener('input', recalcTotals));
      tr.querySelector('.btnDel').addEventListener('click', () => {
        tr.remove();
        if (document.querySelectorAll('#linesTable tbody tr').length === 0) addLine();
        recalcTotals();
      });

      recalcTotals();
    }

    function collectLines(){
      const rows = document.querySelectorAll('#linesTable tbody tr');
      const out = [];
      rows.forEach(r => {
        const code = r.querySelector('.line-code').value.trim();
        const desc = r.querySelector('.line-desc').value.trim();
        const qty  = Number(r.querySelector('.line-qty').value || 0);
        const unit = Number(r.querySelector('.line-unit').value || 0);
        const vat  = Number(r.querySelector('.line-vat').value || 0);
        if (!desc) return;
        out.push({ line_code: code, line_desc: desc, qty, unit_price: unit, vat_rate: vat });
      });
      return out;
    }

    function recalcTotals(){
      let ht = 0, vatSum = 0, ttc = 0;
      document.querySelectorAll('#linesTable tbody tr').forEach(r => {
        const qty  = Number(r.querySelector('.line-qty').value || 0) || 0;
        const unit = Number(r.querySelector('.line-unit').value || 0) || 0;
        const vat  = Number(r.querySelector('.line-vat').value || 0) || 0;

        const ex = qty * unit;
        const vatAmt = ex * (vat / 100);
        const total = ex + vatAmt;

        ht += ex;
        vatSum += vatAmt;
        ttc += total;

        r.querySelector('.line-total').innerText = money(total);
      });

      document.getElementById('sumHt').innerText  = money(ht);
      document.getElementById('sumVat').innerText = money(vatSum);
      document.getElementById('sumTtc').innerText = money(ttc);

      ACTIVE.amount_total = ttc;

      const payHint = document.getElementById('payHint');
      if (payHint && (ACTIVE.status === 'VALIDATED' || ACTIVE.status === 'PARTIALLY_DISBURSED')) {
        const remaining = Math.max(0, ttc - (Number(ACTIVE.disbursed_total || 0)));
        payHint.innerText = `Remaining to disburse: ${money(remaining)} (Disbursed: ${money(ACTIVE.disbursed_total || 0)} / Total: ${money(ttc)})`;
      }
    }

    async function loadOpsFiles(){
      const sel = document.getElementById('opsFileSelect');
      const cur = sel.value;
      const items = await apiGet(API.opsFiles(''));
      sel.innerHTML = `<option value="">Select File...</option>`;
      items.forEach(it => {
        const label = `${it.file_ref} — ${it.client_name || 'Unknown Client'}${it.sea_bl ? ' — BL: ' + it.sea_bl : ''}`;
        const opt = document.createElement('option');
        opt.value = it.file_ref;
        opt.textContent = label;
        opt.dataset.clientName = it.client_name || '';
        opt.dataset.seaBl = it.sea_bl || '';
        sel.appendChild(opt);
      });
      if (cur) sel.value = cur;
    }

    function handleOpsSelection(){
      const sel = document.getElementById('opsFileSelect');
      const opt = sel.options[sel.selectedIndex];
      const bl = opt?.dataset?.seaBl || '';
      const cn = opt?.dataset?.clientName || '';
      document.getElementById('blNumber').value = bl;
      document.getElementById('clientName').value = cn;
    }

    function canFinanceActions(){
      // strict: finance dept OR admin/mgmt (server will enforce anyway)
      return (DEPARTMENT === 'FINANCE' || ROLE === 'ADMIN' || ROLE === 'MANAGEMENT');
    }
    function canSubmitActions(){
      // ops/sales/admin/mgmt (server will enforce anyway)
      return (['OPERATIONS','SALES','ADMIN','MANAGEMENT'].includes(DEPARTMENT) || ['ADMIN','MANAGEMENT'].includes(ROLE));
    }

    function renderModalActions(){
      const box = document.getElementById('modalActions');
      box.innerHTML = `<button class="btn btn-light border fw-bold" data-bs-dismiss="modal">Close</button>`;

      const editable = (ACTIVE.status === 'DRAFT' || ACTIVE.status === 'REJECTED');
      if (editable) {
        box.innerHTML += `<button type="button" class="btn btn-outline-primary fw-bold" id="btnSave">Save Draft</button>`;
        if (canSubmitActions()) {
          box.innerHTML += `<button type="button" class="btn btn-primary fw-bold" style="background: var(--smart-orange); border:none" id="btnSubmit">Submit for Validation</button>`;
        }
      }

      if (canFinanceActions() && ACTIVE.status === 'SUBMITTED') {
        box.innerHTML += `<button type="button" class="btn btn-danger fw-bold" id="btnReject">Reject</button>`;
        box.innerHTML += `<button type="button" class="btn btn-success fw-bold" id="btnValidate">Validate</button>`;
      }

      const canDisburse = canFinanceActions() && (ACTIVE.status === 'VALIDATED' || ACTIVE.status === 'PARTIALLY_DISBURSED');
      document.getElementById('financeDisburseBox').style.display = canDisburse ? 'block' : 'none';

      const btnSave = document.getElementById('btnSave');
      if (btnSave) btnSave.onclick = () => doSave();

      const btnSubmit = document.getElementById('btnSubmit');
     if (btnSubmit) btnSubmit.onclick = async () => {
  const prId = await doSave();
  if (!prId) return; // validation failed or save failed

  await apiPost(API.prTransition, { pr_id: prId, to_status: 'SUBMITTED' });

  ACTIVE.status = 'SUBMITTED';
  updateStatusUI();
  renderModalActions();
  showToast('Submitted. Status is now SUBMITTED (pending validation).');
  await loadTable();
};


      const btnValidate = document.getElementById('btnValidate');
      if (btnValidate) btnValidate.onclick = async () => {
        await apiPost(API.prTransition, { pr_id: ACTIVE.pr_id, to_status: 'VALIDATED' });
        ACTIVE.status = 'VALIDATED';
        updateStatusUI();
        renderModalActions();
        showToast('Validated.');
        await loadTable();
      };

      const btnReject = document.getElementById('btnReject');
      if (btnReject) btnReject.onclick = async () => {
        await apiPost(API.prTransition, { pr_id: ACTIVE.pr_id, to_status: 'REJECTED' });
        ACTIVE.status = 'REJECTED';
        updateStatusUI();
        renderModalActions();
        showToast('Rejected.');
        await loadTable();
      };

      document.getElementById('btnPayNow').onclick = async () => {
        const amt = Number(document.getElementById('payAmount').value || 0);
        if (amt <= 0) { showToast('Enter a valid payment amount.'); return; }
        const res = await apiPost(API.prDisburse, { pr_id: ACTIVE.pr_id, paid_amount: amt, note: '' });
        ACTIVE.status = res.status;
        ACTIVE.disbursed_total = res.disbursed_total;
        document.getElementById('payAmount').value = '';
        updateStatusUI();
        renderModalActions();
        recalcTotals();
        showToast('Disbursement recorded.');
        await openExisting(ACTIVE.pr_id);
        await loadTable();
      };
    }

    function validateVoucherInputs(){
      const m = document.getElementById('disburseMethod').value;
      if (m === 'BANK') {
        if (!document.getElementById('bankName').value.trim()) return 'Bank name is required.';
        if (!document.getElementById('accountNumber').value.trim()) return 'Account number is required.';
        if (!document.getElementById('accountName').value.trim()) return 'Account name is required.';
      }
      if (m === 'MOMO') {
        if (!document.getElementById('momoName').value.trim()) return 'Mobile Money name is required.';
        if (!document.getElementById('momoNumber').value.trim()) return 'Mobile Money number is required.';
      }

      if (m === 'CHEQUE') {
        if (!document.getElementById('chequeNumber').value.trim()) return 'Cheque number is required.';
      }
      return '';
    }

    async function doSave(){
  const category = catValue();

  const vErr = validateVoucherInputs();
  if (vErr) { showToast(vErr); return null; }

  if (!document.getElementById('beneficiary').value.trim()) {
    showToast('Beneficiary is required.');
    return null;
  }

  if (category === 'OPS' && !document.getElementById('opsFileSelect').value) {
    showToast('Select an operations file for OPS category.');
    return null;
  }

  if (category === 'OVH') {
    if (!document.getElementById('costCenter').value) { showToast('Cost Center is required for Overhead.'); return null; }
    if (!document.getElementById('ovhJust').value.trim()) { showToast('Overhead justification is required.'); return null; }
  }

  const lines = collectLines();
  if (lines.length < 1) { showToast('Add at least 1 line.'); return null; }

  const payload = {
    mode: ACTIVE.mode,
    pr_id: ACTIVE.pr_id,
    category,
    disburse_method: document.getElementById('disburseMethod').value,

    bank_name: document.getElementById('bankName')?.value || '',
    account_number: document.getElementById('accountNumber')?.value || '',
    account_name: document.getElementById('accountName')?.value || '',
    momo_number: document.getElementById('momoNumber')?.value || '',
    momo_name: document.getElementById('momoName')?.value || '',
    cheque_number: document.getElementById('chequeNumber')?.value || '',

    ops_file_ref: document.getElementById('opsFileSelect').value,
    cost_center: document.getElementById('costCenter')?.value || '',
    overhead_justification: document.getElementById('ovhJust')?.value || '',

    beneficiary: document.getElementById('beneficiary').value.trim(),
    remarks: document.getElementById('remarks').value,
    lines
  };

  const res = await apiPost(API.prSave, payload);

  // IMPORTANT: ensure we keep the returned ID
  ACTIVE.mode = 'EDIT';
  ACTIVE.pr_id = res.pr_id;

  // keep status as DRAFT locally after save (server sets DRAFT on NEW)
  if (!ACTIVE.status) ACTIVE.status = 'DRAFT';

  updateStatusUI();
  document.getElementById('modalTitle').innerText = 'Cash Request';
  showToast('Saved.');
  await loadTable();

  return ACTIVE.pr_id;
}


    async function loadTable(){
      const q = document.getElementById('tableSearch').value.trim();
      const rows = await apiGet(API.prList(q));
      const tb = document.getElementById('prTableBody');
      tb.innerHTML = '';

      if (!rows.length) {
        tb.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">No records found</td></tr>`;
        return;
      }

      rows.forEach(r => {
        const tr = document.createElement('tr');
        const stCls = statusPillClass(r.status);
        const methodLabel = ({
          'CASH':'Cash',
          'BANK':'Bank Transfer',
          'CHEQUE':'Cheque',
          'MOMO':'Mobile Money'
        }[r.disburse_method] || r.disburse_method);

        const cat = r.category || 'OPS';
        const context = (cat === 'OVH')
          ? `<div class="fw-semibold">Cost Center: ${escapeHtml(r.cost_center || '')}</div><div class="text-muted small">${escapeHtml(r.beneficiary || '')}</div>`
          : `<div class="fw-semibold">${escapeHtml(r.client_name || '')}</div><div class="text-muted small">${escapeHtml(r.ops_file_ref || '')}${r.sea_bl ? ' — BL: ' + escapeHtml(r.sea_bl) : ''}</div>`;

        tr.innerHTML = `
          <td class="fw-bold mono">${escapeHtml(r.pr_id)}</td>
          <td>${escapeHtml(r.pr_date || '')}</td>
          <td><span class="badge text-bg-light border">${escapeHtml(cat)}</span></td>
          <td>${escapeHtml(methodLabel)}</td>
          <td>${context}</td>
          <td class="text-end fw-bold">${money(r.amount_total)}</td>
          <td><span class="status-pill ${stCls}">${escapeHtml(r.status)}</span></td>
          <td class="text-end">
            <button type="button" class="btn btn-sm btn-outline-dark fw-bold btnOpen">Open</button>
          </td>
        `;
        tr.querySelector('.btnOpen').addEventListener('click', () => openExisting(r.pr_id));
        tb.appendChild(tr);
      });
    }

    async function openExisting(prId){
      const data = await apiGet(API.prGet(prId));

      ACTIVE.mode = 'EDIT';
      ACTIVE.pr_id = data.header.pr_id;
      ACTIVE.status = data.header.status;
      ACTIVE.disbursed_total = Number(data.header.disbursed_total || 0);
      ACTIVE.amount_total = Number(data.header.amount_total || 0);

      document.getElementById('modalTitle').innerText = 'Cash Request';
      document.getElementById('disburseMethod').value = data.header.disburse_method || 'CASH';

      // voucher details
      document.getElementById('bankName').value = data.header.bank_name || '';
      document.getElementById('accountNumber').value = data.header.account_number || '';
      document.getElementById('accountName').value = data.header.account_name || '';
      document.getElementById('momoNumber').value = data.header.momo_number || '';
      document.getElementById('momoName').value = data.header.momo_name || '';

      document.getElementById('chequeNumber').value = data.header.cheque_number || '';
      setVoucherUI();

      if ((data.header.category || 'OPS') === 'OVH') {
        document.getElementById('catOvh').checked = true;
      } else {
        document.getElementById('catOps').checked = true;
      }
      setCategoryUI();

      document.getElementById('beneficiary').value = data.header.beneficiary || '';
      document.getElementById('remarks').value = data.header.remarks || '';

      // OVH fields
      document.getElementById('costCenter').value = data.header.cost_center || '';
      document.getElementById('ovhJust').value = data.header.overhead_justification || '';

      // Load ops files then set selected value
      await loadOpsFiles();
      document.getElementById('opsFileSelect').value = data.header.ops_file_ref || '';
      handleOpsSelection();

      // Lines
      const tb = document.querySelector('#linesTable tbody');
      tb.innerHTML = '';
      (data.lines || []).forEach(l => addLine({
        line_code: l.line_code,
        line_desc: l.line_desc,
        qty: Number(l.qty || 0),
        unit_price: Number(l.unit_price || 0),
        vat_rate: Number(l.vat_rate || 0),
      }));
      if (!data.lines || data.lines.length === 0) addLine();

      // Payments
      const pays = data.payments || [];
      const pbox = document.getElementById('paymentsBox');
      const pbody = document.getElementById('paymentsBody');
      if (pays.length) {
        pbox.style.display = 'block';
        pbody.innerHTML = '';
        pays.forEach(p => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${escapeHtml(p.paid_at || '')}</td>
            <td class="mono">${escapeHtml(p.paid_by || '')}</td>
            <td class="text-end fw-bold">${money(p.paid_amount)}</td>
            <td>${escapeHtml(p.note || '')}</td>
          `;
          pbody.appendChild(tr);
        });
      } else {
        pbox.style.display = 'none';
        pbody.innerHTML = '';
      }

      updateStatusUI();
      renderModalActions();
      recalcTotals();
      modal.show();
    }

    function resetModal(){
      ACTIVE = { mode:'NEW', pr_id:'', status:'DRAFT', disbursed_total:0, amount_total:0 };

      document.getElementById('modalTitle').innerText = 'New Cash Request';
      document.getElementById('modalSub').innerText   = 'ID: New';
      document.getElementById('modalStatus').innerText= 'DRAFT';
      document.getElementById('modalStatus').className= `status-pill ${statusPillClass('DRAFT')}`;

      document.getElementById('prForm').reset();
      document.querySelector('#linesTable tbody').innerHTML = '';
      addLine();

      document.getElementById('blNumber').value = '';
      document.getElementById('clientName').value = '';
      document.getElementById('opsFileSelect').value = '';

      document.getElementById('costCenter').value = '';
      document.getElementById('ovhJust').value = '';

      document.getElementById('bankName').value = '';
      document.getElementById('accountNumber').value = '';
      document.getElementById('accountName').value = '';
      document.getElementById('momoNumber').value = '';
      document.getElementById('momoName').value = '';

      document.getElementById('chequeNumber').value = '';
      setVoucherUI();

      document.getElementById('financeDisburseBox').style.display = 'none';
      document.getElementById('payAmount').value = '';
      document.getElementById('payHint').innerText = '';

      document.getElementById('paymentsBox').style.display = 'none';
      document.getElementById('paymentsBody').innerHTML = '';

      setCreatedLine();
      setCategoryUI();
      renderModalActions();
      recalcTotals();
    }

    function debounce(fn, ms){
      let t = null;
      return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
      };
    }

    // Wire UI events
    document.getElementById('btnNew').addEventListener('click', async () => {
      resetModal();
      await loadOpsFiles();
      modal.show();
    });

    document.getElementById('btnRefresh').addEventListener('click', async () => {
      await loadTable();
      showToast('Refreshed.');
    });

    document.getElementById('tableSearch').addEventListener('input', debounce(loadTable, 250));
    document.getElementById('btnAddLine').addEventListener('click', () => addLine());

    document.getElementById('catOps').addEventListener('change', () => { setCategoryUI(); });
    document.getElementById('catOvh').addEventListener('change', () => { setCategoryUI(); });

    document.getElementById('btnReloadFiles').addEventListener('click', async () => {
      await loadOpsFiles();
      showToast('Operations files reloaded.');
    });

    document.getElementById('opsFileSelect').addEventListener('change', handleOpsSelection);

    document.getElementById('disburseMethod').addEventListener('change', setVoucherUI);

    // Init
    (async function init(){
      try {
        setCreatedLine();
        setVoucherUI();
        await loadTable();
      } catch (e) {
        console.error(e);
        showToast(e.message || 'Init failed');
      }
    })();
  </script>
</body>
</html>
