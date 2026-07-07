<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN','FINANCE','MANAGEMENT','OPERATIONS']);

$conn = db();

function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }

function jexit(array $p, int $code = 200): void {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($p);
  exit;
}

function norm_date(?string $v): ?string {
  $v = trim((string)$v);
  if ($v === '') return null;
  $dt = DateTime::createFromFormat('Y-m-d', $v);
  if (!$dt) return null;
  $errs = DateTime::getLastErrors();
  if (!empty($errs['warning_count']) || !empty($errs['error_count'])) return null;
  return $dt->format('Y-m-d');
}

// Helper function to update supplier cache
function updateSupplierStats(mysqli $conn, string $supplierId): void {
  if (trim($supplierId) === '') return;

  // 1. Calculate Total Payables
  $sqlPay = "
    SELECT SUM( GREATEST(0, COALESCE(net_payable,0) - COALESCE(amount_paid,0)) ) AS val 
    FROM purchase_order_master 
    WHERE supplier_id = ? 
      AND status IN ('APPROVED', 'PARTIAL')
  ";
  $st = $conn->prepare($sqlPay);
  $st->bind_param('s', $supplierId);
  $st->execute();
  $resPay = $st->get_result()->fetch_assoc();
  $payables = (float)($resPay['val'] ?? 0);

  // 2. Calculate Overdue
  $sqlOver = "
    SELECT SUM( GREATEST(0, COALESCE(net_payable,0) - COALESCE(amount_paid,0)) ) AS val 
    FROM purchase_order_master 
    WHERE supplier_id = ? 
      AND status IN ('APPROVED', 'PARTIAL') 
      AND due_date IS NOT NULL 
      AND due_date < CURDATE()
  ";
  $st2 = $conn->prepare($sqlOver);
  $st2->bind_param('s', $supplierId);
  $st2->execute();
  $resOver = $st2->get_result()->fetch_assoc();
  $overdue = (float)($resOver['val'] ?? 0);

  // 3. Update Supplier Master
  $up = $conn->prepare("UPDATE supplier_master SET cached_payables = ?, cached_overdue = ? WHERE supplier_id = ? LIMIT 1");
  $up->bind_param('dds', $payables, $overdue, $supplierId);
  $up->execute();
}

$employeeId = (string)($_SESSION['auth']['employee_id'] ?? '');
$userId     = (int)($_SESSION['auth']['user_id'] ?? 0);

if ($employeeId === '' || $userId <= 0) {
  header('Location: ../../api/auth/logout.php');
  exit;
}

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

$resMe = $stmtMe->get_result();
$me = $resMe ? $resMe->fetch_assoc() : null;

if (!$me) {
  header('Location: ../../api/auth/logout.php');
  exit;
}

$fullName  = (string)($me['full_name'] ?? '');
$fullName  = $fullName !== '' ? $fullName : 'System User';
$firstName = trim(explode(' ', $fullName)[0] ?? 'System');

$roleLabelMap = [
  'ADMIN'      => 'SYSTEM ADMIN',
  'FINANCE'    => 'FINANCE',
  'SALES'      => 'SALES',
  'OPERATIONS' => 'OPERATIONS',
  'MANAGEMENT' => 'MANAGEMENT',
];
$role = strtoupper((string)($me['role'] ?? 'ADMIN'));
$roleLabel = $roleLabelMap[$role] ?? $role;

$avatarName = urlencode($fullName);
$avatarUrl  = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";

if (isset($_GET['ajax'])) {
  $ajax = (string)$_GET['ajax'];

  if ($ajax === 'suppliers_list') {
    $q    = trim((string)($_GET['q'] ?? ''));
    $like = '%' . $q . '%';

    $sql = "
      SELECT
        supplier_id, supplier_name, supplier_type, contact_person, contact_email,
        contact_phone, niu, rccm, address, country, payment_method,
        payment_terms_days, bank_name, account_number, account_name,
        momo_network, momo_number, status
      FROM supplier_master
      WHERE status = 'ACTIVE'
        AND (? = '' OR supplier_name LIKE ? OR supplier_id LIKE ? OR contact_person LIKE ? OR contact_email LIKE ? OR contact_phone LIKE ?)
      ORDER BY supplier_name ASC
      LIMIT 500
    ";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('ssssss', $q, $like, $like, $like, $like, $like);
    $stmt->execute();
    $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    jexit(['ok' => true, 'data' => $rows]);
  }

  if ($ajax === 'fd_search') {
    $q = trim((string)($_GET['q'] ?? ''));
    if (mb_strlen($q) < 2) {
      jexit(['ok' => true, 'data' => []]);
    }
    $like = '%' . $q . '%';
    $sql = "
      SELECT id, code, name_en, name_fr, category, subcategory, vat_treatment
      FROM financial_dictionary
      WHERE status = 'ACTIVE'
        AND (code LIKE ? OR name_en LIKE ? OR name_fr LIKE ? OR subcategory LIKE ?)
      ORDER BY
        CASE WHEN code LIKE ? THEN 0 WHEN name_en LIKE ? THEN 1 WHEN name_fr LIKE ? THEN 2 ELSE 3 END,
        name_en ASC
      LIMIT 30
    ";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('sssssss', $like, $like, $like, $like, $like, $like, $like);
    $stmt->execute();
    $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    jexit(['ok' => true, 'data' => $rows]);
  }

  if ($ajax === 'ops_files_list') {
    $q    = trim((string)($_GET['q'] ?? ''));
    $like = '%' . $q . '%';
    $sql = "
      SELECT ofm.operations_file_reference, ofm.client_id, cm.client_name
      FROM operations_file_master ofm
      LEFT JOIN client_master cm ON cm.client_id = ofm.client_id
      WHERE ofm.operations_file_reference IS NOT NULL
        AND ofm.operations_file_reference <> ''
        AND (? = '' OR ofm.operations_file_reference LIKE ? OR ofm.client_id LIKE ? OR cm.client_name LIKE ?)
      ORDER BY ofm.operations_file_reference DESC
      LIMIT 200
    ";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('ssss', $q, $like, $like, $like);
    $stmt->execute();
    $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    jexit(['ok' => true, 'data' => $rows]);
  }

  if ($ajax === 'ops_file_get') {
    $ref = trim((string)($_GET['ref'] ?? ''));
    if ($ref === '') jexit(['ok' => false, 'error' => 'Missing ref'], 400);
    $sql = "
      SELECT ofm.operations_file_reference, ofm.client_id, cm.client_name
      FROM operations_file_master ofm
      LEFT JOIN client_master cm ON TRIM(cm.client_id) = TRIM(ofm.client_id)
      WHERE ofm.operations_file_reference = ?
      LIMIT 1
    ";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('s', $ref);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    if (!$row) jexit(['ok' => false, 'error' => 'Ops file not found'], 404);
    jexit(['ok' => true, 'data' => $row]);
  }

  // --- KPIS ---
  if ($ajax === 'po_kpis') {
    $sqlP = "SELECT COUNT(*) as c FROM purchase_order_master WHERE status='PENDING'";
    $rowP = $conn->query($sqlP)->fetch_assoc();
    
    $sqlA = "SELECT COUNT(*) as c FROM purchase_order_master WHERE status='APPROVED'";
    $rowA = $conn->query($sqlA)->fetch_assoc();

    $sqlO = "SELECT COUNT(*) as c FROM purchase_order_master WHERE status IN ('PENDING','APPROVED') AND due_date IS NOT NULL AND due_date < CURDATE()";
    $rowO = $conn->query($sqlO)->fetch_assoc();

    $sqlT = "SELECT SUM( GREATEST(0, COALESCE(net_payable,0) - COALESCE(amount_paid,0)) ) as val 
             FROM purchase_order_master 
             WHERE status IN ('PENDING','APPROVED','PARTIAL')";
    $rowT = $conn->query($sqlT)->fetch_assoc();

    jexit([
      'ok' => true,
      'pending' => $rowP['c'],
      'approved' => $rowA['c'],
      'overdue' => $rowO['c'],
      'total' => $rowT['val'] ?? 0
    ]);
  }

  if ($ajax === 'po_list') {
    $status = strtoupper(trim((string)($_GET['status'] ?? 'ALL')));
    $q      = trim((string)($_GET['q'] ?? ''));
    $limit  = (int)($_GET['limit'] ?? 50);
    if ($limit < 1) $limit = 50;
    if ($limit > 200) $limit = 200;

    $like = '%' . $q . '%';
    $where = "1=1";
    $types = "";
    $bind  = [];

    if ($status !== 'ALL' && $status !== '') {
      if ($status === 'OVERDUE') {
        $where .= " AND pom.status IN ('PENDING','APPROVED') AND pom.due_date IS NOT NULL AND pom.due_date < CURDATE()";
      } else {
        $where .= " AND pom.status = ?";
        $types .= "s";
        $bind[] = $status;
      }
    }

    if ($q !== '') {
      $where .= " AND (pom.po_id LIKE ? OR pom.supplier_name LIKE ? OR pom.file_reference LIKE ?)";
      $types .= "sss";
      $bind[] = $like; $bind[] = $like; $bind[] = $like;
    }

    $sql = "
      SELECT 
        pom.po_id, 
        DATE_FORMAT(pom.created_at, '%Y-%m-%d') AS created_date,
        pom.supplier_name, 
        pom.currency, 
        pom.total_ttc, 
        pom.net_payable,   /* Added this */
        pom.amount_paid,   /* Added this */
        pom.due_date, 
        pom.status
      FROM purchase_order_master pom
      WHERE {$where}
      ORDER BY pom.created_at DESC
      LIMIT {$limit}
    ";

    $stmt = $conn->prepare($sql);
    if ($types !== '') { $stmt->bind_param($types, ...$bind); }
    $stmt->execute();
    $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    jexit(['ok' => true, 'data' => $rows]);
  }

  /* START PASTING HERE */
  if ($ajax === 'po_approve') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') jexit(['ok'=>false,'error'=>'POST required'], 405);

    $roleNow = strtoupper((string)($_SESSION['auth']['role'] ?? ''));
    if (!in_array($roleNow, ['ADMIN','FINANCE', 'MANAGEMENT'], true)) {
      jexit(['ok'=>false,'error'=>'Not authorized'], 403);
    }

    $raw  = file_get_contents('php://input');
    $data = json_decode($raw ?: 'null', true);
    $poId = trim((string)($data['po_id'] ?? ''));
    if ($poId === '') jexit(['ok'=>false,'error'=>'Missing po_id'], 400);

    $conn->begin_transaction();
    try {
      $sql = "SELECT status, supplier_id, total_ttc, created_at, created_by FROM purchase_order_master WHERE po_id=? LIMIT 1 FOR UPDATE";
      $st  = $conn->prepare($sql);
      $st->bind_param('s', $poId);
      $st->execute();
      $row = $st->get_result()->fetch_assoc();
      if (!$row) throw new RuntimeException('Not found');

      $cur = strtoupper((string)$row['status']);
      if ($cur !== 'PENDING') {
        throw new RuntimeException("Invalid transition: {$cur} -> APPROVED");
      }

      // 1. Generate Issuer Auth ID (Permanent)
      $issuerAuth = 'ISS-' . strtoupper(substr(hash('sha256', $row['created_by'] . $row['created_at'] . 'ISS'), 0, 10));

      // 2. Generate Approver Auth ID (Permanent)
      $appTime = date('Y-m-d H:i:s');
      $approverAuth = 'APP-' . strtoupper(substr(hash('sha256', $employeeId . $appTime . 'APP'), 0, 10));

      // 3. Generate Document Security Hash (The "Long Number")
      // Combines IDs, Amounts, Dates, and a Secret Salt to create a unique fingerprint
      $hashData = $poId . number_format((float)($row['total_ttc']??0), 0, '.', '') . $row['created_at'] . $appTime . 'SMART_SECURE_SALT';
      $docHash = hash('sha256', $hashData);

      // 4. Save Everything
      $up = $conn->prepare("
        UPDATE purchase_order_master 
        SET status='APPROVED', 
            approved_by=?, 
            approved_at=?, 
            issuer_auth_id=?,
            approver_auth_id=?,
            security_hash=?, 
            updated_at=NOW() 
        WHERE po_id=? LIMIT 1
      ");
      $up->bind_param('isssss', $employeeId, $appTime, $issuerAuth, $approverAuth, $docHash, $poId);
      $up->execute();

      if (isset($row['supplier_id'])) {
        updateSupplierStats($conn, (string)$row['supplier_id']);
      }

      $conn->commit();
      jexit(['ok'=>true,'po_id'=>$poId,'status'=>'APPROVED']);
    } catch (Throwable $ex) {
      $conn->rollback();
      jexit(['ok'=>false,'error'=>$ex->getMessage()], 400);
    }
  }
/* STOP PASTING HERE */

  if ($ajax === 'po_mark_paid') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') jexit(['ok'=>false,'error'=>'POST required'], 405);
    $roleNow = strtoupper((string)($_SESSION['auth']['role'] ?? ''));
    if (!in_array($roleNow, ['ADMIN','FINANCE', 'MANAGEMENT'], true)) {
      jexit(['ok'=>false,'error'=>'Not authorized'], 403);
    }
    $raw  = file_get_contents('php://input');
    $data = json_decode($raw ?: 'null', true);
    $poId   = trim((string)($data['po_id'] ?? ''));
    $amount = (float)($data['amount'] ?? 0);

    if ($poId === '') jexit(['ok'=>false,'error'=>'Missing po_id'], 400);
    if ($amount <= 0) jexit(['ok'=>false,'error'=>'Invalid amount'], 400);

    $conn->begin_transaction();
    try {
      $sql = "SELECT status, net_payable, amount_paid, supplier_id FROM purchase_order_master WHERE po_id=? LIMIT 1 FOR UPDATE";
      $st  = $conn->prepare($sql);
      $st->bind_param('s', $poId);
      $st->execute();
      $row = $st->get_result()->fetch_assoc();
      if (!$row) throw new RuntimeException('Not found');

      $curStatus = strtoupper((string)$row['status']);
      if (!in_array($curStatus, ['APPROVED','PARTIAL','PENDING'], true)) {
        throw new RuntimeException("Cannot pay PO in status: {$curStatus}");
      }

      $netPayable = (float)($row['net_payable'] ?? 0);
      $paidSoFar  = (float)($row['amount_paid'] ?? 0);
      $supplierId = (string)($row['supplier_id'] ?? '');

      $newPaidTotal = $paidSoFar + $amount;
      $remaining = $netPayable - $newPaidTotal;
      $newStatus = ($remaining <= 0.01) ? 'PAID' : 'PARTIAL';

      $up = $conn->prepare("UPDATE purchase_order_master SET status=?, amount_paid=?, updated_at=NOW() WHERE po_id=? LIMIT 1");
      $up->bind_param('sds', $newStatus, $newPaidTotal, $poId);
      $up->execute();

      updateSupplierStats($conn, $supplierId);
      $conn->commit();
      jexit(['ok'=>true,'po_id'=>$poId,'status'=>$newStatus, 'new_paid'=>$newPaidTotal]);
    } catch (Throwable $ex) {
      $conn->rollback();
      jexit(['ok'=>false,'error'=>$ex->getMessage()], 400);
    }
  }

  if ($ajax === 'po_get') {
    $id = trim((string)($_GET['id'] ?? ''));
    if ($id === '') jexit(['ok' => false, 'error' => 'Missing id'], 400);
    $sql = "SELECT * FROM purchase_order_master WHERE po_id = ? LIMIT 1";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('s', $id);
    $stmt->execute();
    $po = $stmt->get_result()->fetch_assoc();
    if (!$po) jexit(['ok' => false, 'error' => 'Not found'], 404);

    $sql2 = "SELECT line_no, description, qty, unit_price, vat_rate FROM purchase_order_items WHERE po_id = ? ORDER BY line_no ASC";
    $stmt2 = $conn->prepare($sql2);
    $stmt2->bind_param('s', $id);
    $stmt2->execute();
    $items = $stmt2->get_result()->fetch_all(MYSQLI_ASSOC);
    jexit(['ok' => true, 'po' => $po, 'items' => $items]);
  }

  // --- UNLOCK LOGIC ---
  if ($ajax === 'po_unlock') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') jexit(['ok'=>false,'error'=>'POST required'], 405);
    $roleNow = strtoupper((string)($_SESSION['auth']['role'] ?? ''));
    if (!in_array($roleNow, ['ADMIN','MANAGEMENT'], true)) {
      jexit(['ok'=>false,'error'=>'Access Denied. Only Admin or Management can unlock POs.'], 403);
    }
    $raw = file_get_contents('php://input');
    $data = json_decode($raw ?: 'null', true);
    $poId = trim((string)($data['po_id'] ?? ''));
    if (!$poId) jexit(['ok'=>false,'error'=>'Missing PO ID'], 400);

    $conn->begin_transaction();
    try {
        $stmt = $conn->prepare("UPDATE purchase_order_master SET status='DRAFT', unlock_request_status=0, unlock_request_reason=NULL, updated_at=NOW() WHERE po_id=? LIMIT 1");
        $stmt->bind_param('s', $poId);
        $stmt->execute();
        $conn->commit();
        jexit(['ok'=>true]);
    } catch (Exception $e) {
        $conn->rollback();
        jexit(['ok'=>false,'error'=>$e->getMessage()], 500);
    }
  }

  if ($ajax === 'po_request_unlock') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') jexit(['ok'=>false,'error'=>'POST required'], 405);
    $raw = file_get_contents('php://input');
    $data = json_decode($raw ?: 'null', true);
    $poId = trim((string)($data['po_id'] ?? ''));
    $reason = trim((string)($data['reason'] ?? ''));
    if (!$poId) jexit(['ok'=>false,'error'=>'Missing PO ID'], 400);
    if (!$reason) jexit(['ok'=>false,'error'=>'Reason is required'], 400);

    $conn->begin_transaction();
    try {
        $stmt = $conn->prepare("UPDATE purchase_order_master SET unlock_request_status=1, unlock_request_reason=?, updated_at=NOW() WHERE po_id=? LIMIT 1");
        $stmt->bind_param('ss', $reason, $poId);
        $stmt->execute();
        $conn->commit();
        jexit(['ok'=>true]);
    } catch (Exception $e) {
        $conn->rollback();
        jexit(['ok'=>false,'error'=>$e->getMessage()], 500);
    }
  }

  if ($ajax === 'po_save') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') jexit(['ok' => false, 'error' => 'POST required'], 405);
    $raw  = file_get_contents('php://input');
    $data = json_decode($raw ?: 'null', true);
    if (!is_array($data)) jexit(['ok' => false, 'error' => 'Invalid JSON'], 400);

    $poId         = trim((string)($data['po_id'] ?? ''));
    $supplierId   = trim((string)($data['supplier_id'] ?? ''));
    $supplierName = trim((string)($data['supplier_name'] ?? ''));
    $status       = strtoupper(trim((string)($data['status'] ?? 'DRAFT')));

    if ($supplierId === '' || $supplierName === '') { jexit(['ok' => false, 'error' => 'Supplier is required'], 400); }
    if (!in_array($status, ['DRAFT', 'PENDING'], true)) { $status = 'DRAFT'; }

    $expenseCategory = (($data['expense_category'] ?? 'OPERATIONS') === 'OVERHEAD') ? 'OVERHEAD' : 'OPERATIONS';
    $fileRef = trim((string)($data['file_reference'] ?? '')); $fileRef = $fileRef !== '' ? $fileRef : null;
    $deliveryLoc = trim((string)($data['delivery_location'] ?? '')); $deliveryLoc = $deliveryLoc !== '' ? $deliveryLoc : null;
    $currency = trim((string)($data['currency'] ?? 'XAF')); $currency = $currency !== '' ? $currency : 'XAF';
    $deliveryDate = norm_date((string)($data['delivery_date'] ?? ''));
    $paymentMeans = strtoupper(trim((string)($data['payment_means'] ?? 'CASH')));
    if (!in_array($paymentMeans, ['CASH','BANK_TRANSFER','CHEQUE','MOBILE_MONEY'], true)) $paymentMeans = 'CASH';

    $payDays = (int)($data['pay_days'] ?? 0); if ($payDays < 0) $payDays = 0;
    $bankName = trim((string)($data['bank_name'] ?? '')); $bankName = $bankName !== '' ? $bankName : null;
    $acctNum  = trim((string)($data['account_number'] ?? '')); $acctNum = $acctNum !== '' ? $acctNum : null;
    $acctName = trim((string)($data['account_name'] ?? '')); $acctName = $acctName !== '' ? $acctName : null;
    $momoNet  = strtoupper(trim((string)($data['momo_network'] ?? ''))); $momoNet = $momoNet !== '' ? $momoNet : null;
    $momoNum  = trim((string)($data['momo_number'] ?? '')); $momoNum = $momoNum !== '' ? $momoNum : null;

    $airRate = (float)($data['air_rate'] ?? 0);
    $advPaid = (float)($data['adv_paid'] ?? 0);
    $terms   = (string)($data['terms'] ?? '');

    $totalHt    = array_key_exists('total_ht', $data)    ? (float)$data['total_ht']    : null;
    $totalVat   = array_key_exists('total_vat', $data)   ? (float)$data['total_vat']   : null;
    $totalTtc   = array_key_exists('total_ttc', $data)   ? (float)$data['total_ttc']   : null;
    $netPayable = array_key_exists('net_payable', $data) ? (float)$data['net_payable'] : null;

    $hasAmount = ($totalTtc !== null && abs($totalTtc) > 0.000001);
    if (!$hasAmount) { $totalHt = $totalVat = $totalTtc = $netPayable = null; }

    $dueDate = null;
    if ($payDays > 0) {
      $base = $deliveryDate ?: date('Y-m-d');
      $dueDate = date('Y-m-d', strtotime($base . ' +' . $payDays . ' days'));
    }

    $items = $data['items'] ?? [];
    if (!is_array($items)) $items = [];

    if ($poId === '') {
      $poId = 'SLAS-PO-' . date('YmdHis') . '-' . substr(bin2hex(random_bytes(3)), 0, 6);
    }

    $conn->begin_transaction();
    try {
      $sqlExists = "SELECT po_id FROM purchase_order_master WHERE po_id = ? LIMIT 1";
      $stmt = $conn->prepare($sqlExists);
      $stmt->bind_param('s', $poId);
      $stmt->execute();
      $exists = (bool)$stmt->get_result()->fetch_assoc();

      $totalHtS  = ($totalHt === null) ? null : (string)$totalHt;
      $totalVatS = ($totalVat === null) ? null : (string)$totalVat;
      $totalTtcS = ($totalTtc === null) ? null : (string)$totalTtc;
      $netPayS   = ($netPayable === null) ? null : (string)$netPayable;
      $airRateS  = (string)$airRate; $advPaidS = (string)$advPaid;

      if ($exists) {
        $sqlUp = "UPDATE purchase_order_master SET supplier_id=?, supplier_name=?, expense_category=?, file_reference=?, delivery_location=?, currency=?, delivery_date=?, payment_means=?, pay_days=?, bank_name=?, account_number=?, account_name=?, momo_network=?, momo_number=?, air_rate=?, adv_paid=?, total_ht=?, total_vat=?, total_ttc=?, net_payable=?, terms=?, due_date=?, status=?, updated_at=NOW() WHERE po_id=? LIMIT 1";
        $stmtUp = $conn->prepare($sqlUp);
        // Corrected type string (25 variables including delivery_location)
        $stmtUp->bind_param(
  'ssssssssisssssssssssssss',
  $supplierId, $supplierName, $expenseCategory, $fileRef,
  $deliveryLoc, $currency, $deliveryDate, $paymentMeans,
  $payDays, $bankName, $acctNum, $acctName, $momoNet, $momoNum,
  $airRateS, $advPaidS, $totalHtS, $totalVatS, $totalTtcS, $netPayS,
  $terms, $dueDate, $status, $poId
);
        $stmtUp->execute();
      } else {
        $sqlIn = "INSERT INTO purchase_order_master (po_id, supplier_id, supplier_name, expense_category, file_reference, delivery_location, currency, delivery_date, payment_means, pay_days, bank_name, account_number, account_name, momo_network, momo_number, air_rate, adv_paid, total_ht, total_vat, total_ttc, net_payable, terms, due_date, status, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";
        $stmtIn = $conn->prepare($sqlIn);
        // Corrected type string (25 variables)
        // 25 params => 25 types (created_by is int at the end)
$stmtIn->bind_param(
  'sssssssssissssssssssssssi',
  $poId, $supplierId, $supplierName, $expenseCategory, $fileRef,
  $deliveryLoc, $currency, $deliveryDate, $paymentMeans,
  $payDays, $bankName, $acctNum, $acctName, $momoNet, $momoNum,
  $airRateS, $advPaidS, $totalHtS, $totalVatS, $totalTtcS, $netPayS,
  $terms, $dueDate, $status, $userId
);

        $stmtIn->execute();
      }

      $stmtDel = $conn->prepare("DELETE FROM purchase_order_items WHERE po_id = ?");
      $stmtDel->bind_param('s', $poId);
      $stmtDel->execute();

      $lineNo = 0;
      $sqlItem = "INSERT INTO purchase_order_items (po_id, line_no, description, qty, unit_price, vat_rate, line_ht, line_vat, line_ttc) VALUES (?,?,?,?,?,?,?,?,?)";
      $stmtItem = $conn->prepare($sqlItem);

      foreach ($items as $it) {
        if (!is_array($it)) continue;
        $desc = trim((string)($it['description'] ?? ''));
        $qty  = (float)($it['qty'] ?? 0);
        $prc  = (float)($it['unit_price'] ?? 0);
        $vat  = (float)($it['vat_rate'] ?? 0);
        if ($desc === '' && abs($qty) < 0.000001 && abs($prc) < 0.000001) continue;
        $lineNo++;
        $lineHt = $qty * $prc; $lineVat = $lineHt * ($vat / 100); $lineTtc = $lineHt + $lineVat;
        $stmtItem->bind_param('sisdddddd', $poId, $lineNo, $desc, $qty, $prc, $vat, $lineHt, $lineVat, $lineTtc);
        $stmtItem->execute();
      }

      updateSupplierStats($conn, $supplierId);
      $conn->commit();
      jexit(['ok' => true, 'po_id' => $poId, 'status' => $status]);
    } catch (Throwable $ex) {
      $conn->rollback();
      jexit(['ok' => false, 'error' => 'DB error: ' . $ex->getMessage()], 500);
    }
  }

  jexit(['ok' => false, 'error' => 'Unknown ajax'], 404);
}
?>

<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Procurement & Payables | Smart LS</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&family=Inconsolata:wght@500;700&display=swap" rel="stylesheet">

  <style>
    /* Keep your PO UI styles */
    :root{
      --smart-blue:#1F99D8;
      --smart-dark:#055B83;
      --smart-orange:#EE7D04;
      --smart-charcoal:#231F20;
      --smart-bg:#F0F4F8;
      --sidebar-width:260px;
      --header-height:60px; /* Reduced from 70px to tighten top gap */

      --status-pending-bg:#fef3c7; --status-pending-text:#b45309;
      --status-active-bg:#dbeafe;   --status-active-text:#1e40af;
      --status-late-bg:#fee2e2;     --status-late-text:#991b1b;
      --status-success-bg:#dcfce7;  --status-success-text:#16a34a;
      --status-draft-bg:#f3f4f6;    --status-draft-text:#4b5563;

      --font-body:'Manrope',sans-serif;
      --font-heading:'Montserrat',sans-serif;
      --font-mono:'Inconsolata',monospace;
    }

    body{ font-family:var(--font-body); background:var(--smart-bg); color:var(--smart-charcoal); overflow-x:hidden; }
    h1,h2,h3,h4,h5,h6,.font-heading{ font-family:var(--font-heading); }
    .font-mono{ font-family:var(--font-mono); }
    .text-orange{ color:var(--smart-orange)!important; }

    /* LAYOUT FIXES */
    .main-content {
      margin-left: var(--sidebar-width);
      padding-top: var(--header-height);
      min-height: 100vh;
      width: calc(100% - var(--sidebar-width));
      background: var(--smart-bg);
      padding-left: 1.5rem;  /* Standardize horizontal padding */
      padding-right: 1.5rem; 
    }

    .top-navbar {
      left: var(--sidebar-width);
      width: calc(100% - var(--sidebar-width));
      height: var(--header-height);
      padding: 0 1.5rem; /* Match content padding */
      position: fixed;
      top: 0;
      z-index: 1000;
      background: #fff;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #e2e8f0;
    }

    /* NEW KPI CARD STYLE */
    .kpi-card {
      background: #fff;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
      padding: 1rem 1.2rem; /* Reduced padding to give content room */
      height: 100%;
      display: flex;
      align-items: center;
      box-shadow: 0 2px 4px rgba(0,0,0,0.02);
    }
    
    .kpi-icon-box {
      width: 48px; height: 48px; 
      min-width: 48px; 
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      font-size: 1.2rem;
      margin-right: 1rem;
    }
    
    .kpi-content {
      min-width: 0; 
      flex: 1;
    }

    .kpi-label {
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      color: #64748b;
      margin-bottom: 2px;
      white-space: nowrap;
    }

    .kpi-number {
      font-size: 1.4rem; 
      font-weight: 800;
      color: #1e293b;
      line-height: 1.2;
      white-space: nowrap;       
      overflow: hidden;          
      text-overflow: ellipsis;   
    }
    @media (max-width: 1400px) {
      .kpi-number { font-size: 1.2rem; }
    }

    .table-custom th{ font-size:.75rem; text-transform:uppercase; color:#888; font-weight:700; border-bottom:2px solid #f0f0f0; background:#fafafa; padding:12px 16px; }
    .table-custom td{ font-size:.85rem; vertical-align:middle; padding:12px 16px; border-bottom:1px solid #f0f0f0; }
    .table-custom tbody tr:hover{ background:#f8fafc; }

    .smart-input{ border-radius:8px; font-size:.9rem; padding:.6rem .8rem; border-color:#dee2e6; background:#fcfcfc; }
    .smart-input:focus{ border-color:var(--smart-blue); background:#fff; box-shadow:0 0 0 3px rgba(31,153,216,.15); outline:none; }

    .compact-form .smart-input{ padding:.4rem .6rem; font-size:.85rem; }
    .compact-form .form-label{ font-size:.7rem; font-weight:700; color:#64748b; text-transform:uppercase; margin-bottom:2px; }

    .status-pill{ padding:4px 8px; border-radius:6px; font-size:.7rem; font-weight:700; text-transform:uppercase; }
    .status-pending{ background:var(--status-pending-bg); color:var(--status-pending-text); }
    .status-active{ background:var(--status-active-bg); color:var(--status-active-text); }
    .status-late{ background:var(--status-late-bg); color:var(--status-late-text); }
    .status-success{ background:var(--status-success-bg); color:var(--status-success-text); }
    .status-draft{ background:var(--status-draft-bg); color:var(--status-draft-text); }

    .filter-tab{
      padding:6px 14px; border-radius:30px; font-size:.75rem;
      font-weight:700; color:#64748b; cursor:pointer; border:1px solid transparent;
      background:transparent; transition:.2s;
    }
    .filter-tab:hover{ background:#f1f5f9; color:var(--smart-dark); }
    .filter-tab.active{ background:var(--smart-dark); color:#fff; box-shadow:0 2px 5px rgba(5,91,131,.2); }

    .modal-fullscreen-custom{ width:96vw; max-width:1600px; margin:1rem auto; height:94vh; }
    .modal-content{ height:100%; border-radius:12px; overflow:hidden; border:none; box-shadow:0 20px 50px rgba(0,0,0,.1); }
    .modal-header{ background:#fff; border-bottom:1px solid #f0f0f0; padding:16px 24px; }
    .modal-body{ overflow-y:auto; background:#f8fafc; padding:0; }

    .create-footer{
      background:#fff; border-top:1px solid #e2e8f0; padding:16px 24px;
      position:sticky; bottom:0; z-index:10; box-shadow:0 -4px 20px rgba(0,0,0,.02);
    }
  </style>
</head>
<body>

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
            <div id="mgmt6" class="accordion-collapse collapse show" data-bs-parent="#mgmtMenu">
                <div class="sub-menu">
                    <a href="cash-request.php" class="sub-link">Cash Request</a>
                    <a href="purchase-order.php" class="sub-link active">Purchase Order</a>
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
      <h5 class="mb-0 fw-bold text-dark">Procurement & Payables</h5>
      <small class="text-muted" style="font-size: 0.7rem;">CREATE/TRACK PURCHASE ORDERS AND MANAGE PAYABLES</small>
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

  <div class="main-content pb-5"> 

    <div class="row g-3 pt-3 mb-4"> 
      
      <div class="col-12 col-md-6 col-xl-3">
        <div class="kpi-card">
          <div class="kpi-icon-box bg-warning bg-opacity-10 text-warning">
            <i class="fa-solid fa-clock"></i>
          </div>
          <div class="kpi-content">
            <div class="kpi-label">Pending Approval</div>
            <div class="kpi-number" id="kpi-pending">0</div>
          </div>
        </div>
      </div>

      <div class="col-12 col-md-6 col-xl-3">
        <div class="kpi-card">
          <div class="kpi-icon-box bg-primary bg-opacity-10 text-primary">
            <i class="fa-solid fa-truck"></i>
          </div>
          <div class="kpi-content">
            <div class="kpi-label">Approved</div>
            <div class="kpi-number text-primary" id="kpi-approved">0</div>
          </div>
        </div>
      </div>

      <div class="col-12 col-md-6 col-xl-3">
        <div class="kpi-card">
          <div class="kpi-icon-box bg-danger bg-opacity-10 text-danger">
            <i class="fa-solid fa-bell"></i>
          </div>
          <div class="kpi-content">
            <div class="kpi-label">Overdue</div>
            <div class="kpi-number text-danger" id="kpi-overdue">0</div>
          </div>
        </div>
      </div>

      <div class="col-12 col-md-6 col-xl-3">
        <div class="kpi-card">
          <div class="kpi-icon-box bg-success bg-opacity-10 text-success">
            <i class="fa-solid fa-wallet"></i>
          </div>
          <div class="kpi-content">
            <div class="kpi-label">Total Payable</div>
            <div class="kpi-number text-success" id="kpi-total" title="Total Amount">0</div>
          </div>
        </div>
      </div>
    </div>

    <div class="card-custom p-4">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h5 class="fw-bold mb-0 text-dark"><i class="fa-solid fa-list-ul text-primary me-2"></i>Payables Register</h5>
        <div class="d-flex gap-2" id="filter-container">
          <button class="filter-tab active" onclick="setFilter('ALL', this)">All</button>
          <button class="filter-tab" onclick="setFilter('PENDING', this)">Pending</button>
          <button class="filter-tab" onclick="setFilter('APPROVED', this)">Approved</button>
          <button class="filter-tab" onclick="setFilter('OVERDUE', this)">Overdue</button>
          <button class="filter-tab" onclick="setFilter('PAID', this)">Paid</button>
          <button class="filter-tab" onclick="setFilter('DRAFT', this)">Drafts</button>
        </div>
      </div>

      <div class="row g-2 mb-3 align-items-center bg-light p-2 rounded border">
        <div class="col-md-4">
          <div class="input-group">
            <span class="input-group-text bg-white border-end-0"><i class="fa-solid fa-search text-muted"></i></span>
            <input type="text" class="form-control smart-input border-start-0 ps-0" id="globalSearch"
                   placeholder="Search PO, Supplier, File Ref..."
                   onkeyup="debouncedReloadList()">
          </div>
        </div>
        <div class="col-md-8 text-end d-flex gap-2 justify-content-end">
          <button class="btn btn-sm btn-primary fw-bold shadow-sm px-3 d-none" 
                  style="background-color: var(--smart-orange); border-color: var(--smart-orange);"
                  onclick="openCreateModal()">
            <i class="fa-solid fa-plus me-2"></i>New Purchase Order
          </button>
          
          <button class="btn btn-sm btn-white border fw-bold text-dark shadow-sm" onclick="exportData()">
            <i class="fa-solid fa-file-excel text-success me-2"></i>Export
          </button>
        </div>
      </div>

      <div class="table-responsive">
        <table class="table table-hover table-custom mb-0">
          <thead>
            <tr>
              <th>PO Number</th>
              <th>Date</th>
              <th>Supplier</th>
              <th>Amount (TTC)</th>
              <th>Due Date</th>
              <th>Status</th>
              <th class="text-end">Action</th>
            </tr>
          </thead>
          <tbody id="payables-body"></tbody>
        </table>
      </div>
      <div class="p-3 border-top text-center text-muted small" id="table-loader">
        Loading...
      </div>
    </div>
  </div>

  <div class="modal fade" id="createPoModal" tabindex="-1" aria-hidden="true" data-bs-backdrop="static">
    <div class="modal-dialog modal-fullscreen-custom">
      <div class="modal-content">
        <div class="modal-header">
          <div class="d-flex align-items-center gap-3">
            <h5 class="modal-title fw-bold font-heading m-0"><i class="fa-solid fa-file-invoice text-orange me-2"></i>Purchase Order</h5>
            <span class="badge bg-light text-dark border" id="modal-mode-badge">DRAFT MODE</span>
          </div>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>

        <div class="modal-body compact-form">
          <div class="container-fluid p-4">
            <form id="poForm" autocomplete="off">
              <input type="hidden" id="po_id" value="">
              <input type="hidden" id="supplier_id" value="">

              <div class="row g-4">
                <div class="col-lg-3 border-end">
                  <h6 class="text-primary fw-bold small text-uppercase mb-3">1. Supplier & Terms</h6>

                  <div class="mb-2">
                    <label class="form-label">Supplier Name</label>
                    <div class="input-group">
                      <span class="input-group-text bg-white"><i class="fa-solid fa-search text-muted"></i></span>
                      <input class="form-control smart-input"
                             list="supplierOptions"
                             id="supplierSearch"
                             placeholder="Start typing supplier..."
                             onchange="onSupplierPicked()"
                             oninput="onSupplierTyping()">
                      <datalist id="supplierOptions"></datalist>
                    </div>
                    <div class="small text-muted mt-1" id="supplier-hint"></div>
                  </div>

                  <div id="supplier-readonly" class="p-3 bg-white border rounded shadow-sm mb-3 d-none">
                    <div class="fw-bold text-dark text-truncate" id="sup-name">--</div>
                    <div class="text-muted text-truncate small" id="sup-contact">--</div>
                    <div class="text-muted small" id="sup-niu">--</div>
                  </div>

                  <hr class="my-3 opacity-25">

                  <div class="mb-3">
                    <label class="form-label">Expense Category</label>
                    <div class="btn-group w-100" role="group">
                      <input type="radio" class="btn-check" name="cat" id="cat-ops" autocomplete="off" checked onclick="toggleFileLink(true)">
                      <label class="btn btn-outline-secondary btn-sm" for="cat-ops">Operations</label>
                      <input type="radio" class="btn-check" name="cat" id="cat-gen" autocomplete="off" onclick="toggleFileLink(false)">
                      <label class="btn btn-outline-secondary btn-sm" for="cat-gen">Overhead</label>
                    </div>
                  </div>

                  <div class="mb-3" id="file-link-box">
                    <label class="form-label text-primary">File Reference (Operations File)</label>
                    <div class="input-group">
                      <span class="input-group-text bg-white"><i class="fa-solid fa-folder-open text-muted"></i></span>
                      <input type="text" class="form-control smart-input" id="fileSearch" list="opsFileOptions" placeholder="Type Operations File Ref (e.g., SL--...)" oninput="debouncedLoadOpsFiles()" onchange="onOpsFilePicked()">
                      <datalist id="opsFileOptions"></datalist>
                    </div>
                    <input type="hidden" id="linked_client_id" value="">
                    <div class="small text-muted mt-1" id="opsfile-hint">Start typing to search Operations Files.</div>
                    <div class="mt-2 p-2 bg-white border rounded d-none" id="linked-client-panel">
                      <div class="small text-uppercase text-muted fw-bold">Client</div>
                      <div class="fw-bold text-dark" id="linked-client-label">—</div>
                    </div>
                  </div>
                  <datalist id="fdDescOptions"></datalist>

                  <div class="mb-3">
                    <label class="form-label">Place of Delivery / Service</label>
                    <input type="text" class="form-control smart-input" id="deliveryLoc" placeholder="e.g. Douala Warehouse or Remote Service">
                  </div>

                  <div class="row g-2 mb-3">
                    <div class="col-6">
                      <label class="form-label">Currency</label>
                      <select class="form-select smart-input fw-bold" id="currency" onchange="recalcTotal()">
                        <option value="XAF">XAF</option>
                        <option value="EUR">EUR</option>
                        <option value="USD">USD</option>
                      </select>
                    </div>
                    <div class="col-6">
                      <label class="form-label">Delivery Date</label>
                      <input type="date" class="form-control smart-input" id="deliveryDate">
                    </div>
                  </div>

                  <div class="mb-2">
                    <label class="form-label">Payment Means</label>
                    <select class="form-select smart-input" id="payMeans" onchange="togglePayFields()">
                      <option value="CASH">Cash</option>
                      <option value="BANK_TRANSFER">Bank Transfer</option>
                      <option value="CHEQUE">Cheque</option>
                      <option value="MOBILE_MONEY">Mobile Money</option>
                    </select>
                  </div>

                  <div id="pay-bank-fields" class="d-none p-2 bg-light border rounded mb-3">
                    <input type="text" class="form-control smart-input mb-2" id="bankName" placeholder="Bank Name">
                    <input type="text" class="form-control smart-input mb-2" id="bankAcct" placeholder="Account Number / IBAN">
                    <input type="text" class="form-control smart-input" id="bankAcctName" placeholder="Account Name">
                  </div>

                  <div id="pay-momo-fields" class="d-none p-2 bg-light border rounded mb-3">
                    <input type="text" class="form-control smart-input mb-2" id="momoNetwork" placeholder="Network (MTN/ORANGE)">
                    <input type="text" class="form-control smart-input" id="momoNum" placeholder="Mobile Number">
                  </div>

                  <div class="mb-3">
                    <label class="form-label">Payment Terms (Days)</label>
                    <input type="number" class="form-control smart-input" id="payDays" placeholder="0 = Immediate">
                  </div>
                </div>

                <div class="col-lg-9">
                  <div class="d-flex justify-content-between align-items-center mb-3">
                    <h6 class="text-primary fw-bold small text-uppercase m-0">2. Order Details</h6>
                    <button type="button" class="btn btn-sm btn-light border fw-bold text-dark shadow-sm" onclick="addLineItem()">
                      <i class="fa-solid fa-plus me-1"></i>Add Line
                    </button>
                  </div>

                  <div class="card-custom p-0 overflow-hidden mb-4" style="height:auto;min-height:200px;">
                    <table class="table table-sm mb-0" id="itemsTable">
                      <thead class="bg-light">
                        <tr>
                          <th style="width: 40%">Description</th>
                          <th style="width: 12%">Qty</th>
                          <th style="width: 15%">Unit Price</th>
                          <th style="width: 10%">VAT %</th>
                          <th style="width: 18%" class="text-end">Total (TTC)</th>
                          <th style="width: 5%"></th>
                        </tr>
                      </thead>
                      <tbody></tbody>
                    </table>
                  </div>

                  <div class="row">
                    <div class="col-md-7">
                      <label class="form-label">Terms & Conditions / Internal Notes</label>
                      <textarea class="form-control smart-input" id="poTerms" rows="5"
                                placeholder="Enter delivery terms, warranty info, or approval notes..."></textarea>
                    </div>

                    <div class="col-md-5">
                      <div class="bg-white p-4 rounded border shadow-sm">
                        <div class="d-flex justify-content-between mb-2 small">
                          <span class="text-muted fw-bold">Total Excl. VAT</span>
                          <span class="font-mono fw-bold" id="disp-total-ht">—</span>
                        </div>
                        <div class="d-flex justify-content-between mb-3 small">
                          <span class="text-muted fw-bold">Total VAT</span>
                          <span class="font-mono fw-bold text-danger" id="disp-total-vat">—</span>
                        </div>

                        <div class="d-flex justify-content-between mb-3 border-top border-bottom py-2">
                          <span class="fw-black text-dark">GRAND TOTAL</span>
                          <span class="font-mono fw-black text-dark fs-6" id="disp-total-ttc">—</span>
                        </div>

                        <div class="d-flex justify-content-between align-items-center mb-2">
                          <span class="text-muted fw-bold small">AIR (Withholding)</span>
                          <select class="form-select form-select-sm smart-input py-0 px-1 w-auto text-end"
                                  id="airRate" style="height:24px;font-size:.75rem;" onchange="recalcTotal()">
                            <option value="0">0%</option>
                            <option value="2.2">2.2%</option>
                            <option value="5.5">5.5%</option>
                          </select>
                        </div>

                        <div class="d-flex justify-content-between align-items-center mb-3">
                          <span class="text-muted fw-bold small">Advance Paid</span>
                          <input type="number" class="form-control form-control-sm smart-input py-0 px-1 w-50 text-end"
                                 id="advPaid" placeholder="0" style="height:24px;" oninput="recalcTotal()">
                        </div>

                        <div class="d-flex justify-content-between pt-3 border-top mt-2">
                          <span class="fw-black text-primary fs-6">NET PAYABLE</span>
                          <span class="font-mono fw-black text-primary fs-5" id="disp-net-pay">—</span>
                        </div>

                        <div class="small text-muted mt-2">
                          Note: If totals are zero, amounts will not be stored (NULL).
                        </div>
                      </div>
                    </div>
                  </div>

                </div>
              </div>
            </form>
          </div>
        </div>

        <div class="create-footer d-flex justify-content-between align-items-center">
          <div class="small text-muted">
            <i class="fa-solid fa-circle-info me-1"></i>
            <span id="footer-status-text">Draft Status</span>
          </div>
          <div class="d-flex gap-2">
            <button type="button" class="btn btn-light border fw-bold" data-bs-dismiss="modal">Close</button>
            <button id="btn-save-draft" type="button" class="btn btn-light border fw-bold text-dark" onclick="savePO('DRAFT')">
              Save Draft
            </button>
            <button id="btn-submit" type="button" class="btn btn-primary fw-bold" style="background-color: var(--smart-blue); border:none;" onclick="savePO('PENDING')">
              Submit for Approval
            </button>
            <button id="btn-print-official" type="button" class="btn btn-dark fw-bold d-none" 
                    style="background: #231F20; border: 1px solid #000; display: flex; align-items: center; gap: 8px;" 
                    onclick="openPrintTab()">
              <i class="fa-solid fa-print text-warning"></i> 
              <span>Print Official PO</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

  <script>
    const USER_ROLE = "<?php echo e($role); ?>";
    
    if (typeof toggleClock !== 'function') {
      let _clocked = false;
      function toggleClock(){
        const btn = document.getElementById('btn-clock');
        if(!btn) return;
        _clocked = !_clocked;
        btn.classList.toggle('active', _clocked);
        btn.innerHTML = _clocked
          ? '<i class="fa-solid fa-check"></i> <span>Clocked In</span>'
          : '<i class="fa-solid fa-fingerprint"></i> <span>Clock In</span>';
      }
    }
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

    async function apiGet(url){
      const r = await fetch(url, { credentials: 'same-origin' });
      const t = await r.text();
      let j;
      try { j = JSON.parse(t); } catch(e){ throw new Error('Non-JSON response: ' + t.slice(0,200)); }
      if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
      return j;
    }

    let FD_CACHE = [];
    let _fdTimer = null;

    function debouncedLoadFD(q){
      clearTimeout(_fdTimer);
      _fdTimer = setTimeout(() => loadFD(q), 180);
    }

    async function loadFD(q){
      q = (q || '').trim();
      const dl = document.getElementById('fdDescOptions');
      if (!dl) return;
      if (q.length < 2) { FD_CACHE = []; dl.innerHTML = ''; return; }
      const res = await apiGet(`purchase-order.php?ajax=fd_search&q=${encodeURIComponent(q)}`);
      FD_CACHE = res.data || [];
      dl.innerHTML = '';
      FD_CACHE.forEach(r => {
        const label = [(r.code || '').trim(), ((r.name_en || '').trim() || (r.name_fr || '').trim())].filter(Boolean).join(' — ');
        if (!label) return;
        const opt = document.createElement('option');
        opt.value = label;
        dl.appendChild(opt);
      });
    }

    function bindDescDictionary(input){
      if (!input) return;
      input.setAttribute('list', 'fdDescOptions');
      input.addEventListener('input', (e) => { debouncedLoadFD(e.target.value); });
      input.addEventListener('change', (e) => {
        const val = (e.target.value || '').trim();
        if (!val || !FD_CACHE.length) return;
        const hit = FD_CACHE.find(x => {
          const label = [(x.code || '').trim(), (x.name_en || '').trim() || (x.name_fr || '').trim()].filter(Boolean).join(' — ');
          return label === val;
        });
        if (!hit) return;
        const row = input.closest('tr');
        if (!row) return;
        const vatField = row.querySelector('.vat-field');
        if (vatField && hit.vat_rate !== null && hit.vat_rate !== undefined && vatField.value === '') {
          vatField.value = Number(hit.vat_rate) || 0;
        }
        const priceField = row.querySelector('.price-field');
        if (priceField && hit.unit_price !== null && hit.unit_price !== undefined && priceField.value === '') {
          priceField.value = Number(hit.unit_price) || 0;
        }
        recalcTotal();
      });
    }

    function effectiveStatus(row){
      const st = String(row.status || '').toUpperCase();
      if (st === 'PAID') return 'PAID';
      const due = row.due_date ? new Date(row.due_date + 'T00:00:00') : null;
      const today = new Date(); today.setHours(0,0,0,0);
      if (due && (st === 'PENDING' || st === 'APPROVED') && due < today) return 'OVERDUE';
      return st || 'DRAFT';
    }

    async function approvePO(poId){
      if (!confirm('Approve this Purchase Order?')) return;
      try{
        const res = await apiPost('purchase-order.php?ajax=po_approve', { po_id: poId });
        await reloadList();
        alert(`Approved: ${res.po_id}`);
      } catch(e){ alert('Approve failed: ' + e.message); }
    }

    async function markPaid(poId){
      const input = prompt("Enter payment amount for this transaction (Partial or Full):");
      if (input === null) return;
      const amount = parseFloat(input);
      if (isNaN(amount) || amount <= 0) { alert("Invalid amount entered."); return; }
      if (!confirm(`Confirm payment of ${amount}?`)) return;
      try{
        const res = await apiPost('purchase-order.php?ajax=po_mark_paid', { po_id: poId, amount: amount });
        await reloadList();
        if (res.status === 'PARTIAL') { alert(`Payment recorded. PO is now PARTIAL. (Total Paid: ${res.new_paid})`); } 
        else { alert(`Payment recorded. PO is fully PAID.`); }
      } catch(e){ alert('Payment failed: ' + e.message); }
    }

    let OPS_FILES = [];
    let _opsTimer = null;

    function debouncedLoadOpsFiles(){
      clearTimeout(_opsTimer);
      _opsTimer = setTimeout(() => loadOpsFiles(document.getElementById('fileSearch').value.trim()), 250);
    }

    async function loadOpsFiles(q){
      if (!q || q.length < 2){
        OPS_FILES = [];
        document.getElementById('opsFileOptions').innerHTML = '';
        document.getElementById('opsfile-hint').textContent = 'Type at least 2 characters to search Operations Files.';
        return;
      }
      const res = await apiGet(`purchase-order.php?ajax=ops_files_list&q=${encodeURIComponent(q)}`);
      OPS_FILES = res.data || [];
      const dl = document.getElementById('opsFileOptions');
      dl.innerHTML = '';
      OPS_FILES.forEach(r => {
        const opt = document.createElement('option');
        const client = r.client_name ? r.client_name.trim() : 'No Client';
        opt.value = `${r.operations_file_reference} | ${client}`;
        dl.appendChild(opt);
      });
      document.getElementById('opsfile-hint').textContent = OPS_FILES.length ? `Found ${OPS_FILES.length} matching operations files.` : 'No operations files found.';
    }

    async function onOpsFilePicked(){
      const inputEl = document.getElementById('fileSearch');
      let val = inputEl.value;
      if (val && val.includes(' | ')) {
        val = val.split(' | ')[0].trim();
        inputEl.value = val;
      }
      const ref = document.getElementById('fileSearch').value.trim();
      if (!ref) { clearLinkedClient(); return; }
      try{
        const res = await fetch(`purchase-order.php?ajax=ops_file_get&ref=${encodeURIComponent(ref)}`);
        if (!res.ok) { clearLinkedClient(); return; }
        const json = await res.json();
        if (!json.ok) { clearLinkedClient(); return; }
        const d = json.data || {};
        const clientId = (d.client_id || '').trim();
        const clientName = (d.client_name || '').trim();
        document.getElementById('linked_client_id').value = clientId;
        document.getElementById('linked-client-label').textContent = `${clientName || '—'} (${clientId || '—'})`;
        document.getElementById('linked-client-panel').classList.remove('d-none');
      } catch(e){ console.error('onOpsFilePicked exception:', e); clearLinkedClient(); }
    }

    function clearLinkedClient(){
      document.getElementById('linked_client_id').value = '';
      document.getElementById('linked-client-label').textContent = '—';
      document.getElementById('linked-client-panel').classList.add('d-none');
    }

    async function apiPost(url, payload){
      const r = await fetch(url, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      const t = await r.text();
      let j;
      try { j = JSON.parse(t); } catch(e){ throw new Error('Non-JSON response: ' + t.slice(0,200)); }
      if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
      return j;
    }

    let CURRENT_FILTER = 'ALL';
    let SUPPLIERS = [];
    let CURRENT_PO = null;
    let _reloadTimer = null;

    document.addEventListener('DOMContentLoaded', async () => {
      try {
        await loadSuppliers('');
        await reloadList();
        addLineItem();
        togglePayFields();
        recalcTotal();
      } catch (e) { console.error(e); document.getElementById('table-loader').innerText = 'Error loading: ' + e.message; }
    });

    function debouncedReloadList(){
      clearTimeout(_reloadTimer);
      _reloadTimer = setTimeout(() => reloadList(), 250);
    }

    async function loadSuppliers(q){
      const res = await apiGet(`purchase-order.php?ajax=suppliers_list&q=${encodeURIComponent(q || '')}`);
      SUPPLIERS = res.data || [];
      const dl = document.getElementById('supplierOptions');
      dl.innerHTML = '';
      SUPPLIERS.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.supplier_name;
        dl.appendChild(opt);
      });
      document.getElementById('supplier-hint').textContent = SUPPLIERS.length ? `Loaded ${SUPPLIERS.length} suppliers.` : 'No suppliers found.';
    }

    function onSupplierTyping(){ }

    function onSupplierPicked(){
      const name = document.getElementById('supplierSearch').value.trim();
      const s = SUPPLIERS.find(x => x.supplier_name === name);
      const panel = document.getElementById('supplier-readonly');
      if (!s) {
        document.getElementById('supplier_id').value = '';
        panel.classList.add('d-none');
        return;
      }
      document.getElementById('supplier_id').value = s.supplier_id;
      document.getElementById('sup-name').innerText = s.supplier_name;
      const contactBits = [];
      if (s.contact_person) contactBits.push(s.contact_person);
      if (s.contact_email)  contactBits.push(s.contact_email);
      if (s.contact_phone)  contactBits.push(s.contact_phone);
      document.getElementById('sup-contact').innerText = contactBits.join(' • ') || '--';
      document.getElementById('sup-niu').innerText = s.niu ? ('NIU: ' + s.niu) : 'NIU: --';
      panel.classList.remove('d-none');
      if (s.payment_method) document.getElementById('payMeans').value = String(s.payment_method).toUpperCase();
      if (s.payment_terms_days !== null && s.payment_terms_days !== undefined) document.getElementById('payDays').value = s.payment_terms_days;
      document.getElementById('bankName').value = s.bank_name || '';
      document.getElementById('bankAcct').value = s.account_number || '';
      document.getElementById('bankAcctName').value = s.account_name || '';
      document.getElementById('momoNetwork').value = s.momo_network || '';
      document.getElementById('momoNum').value = s.momo_number || '';
      togglePayFields();
    }

    function toggleFileLink(isOps){
      const box = document.getElementById('file-link-box');
      box.classList.toggle('d-none', !isOps);
    }

    function togglePayFields(){
      const means = document.getElementById('payMeans').value;
      document.getElementById('pay-bank-fields').classList.toggle('d-none', !['BANK_TRANSFER','CHEQUE'].includes(means));
      document.getElementById('pay-momo-fields').classList.toggle('d-none', means !== 'MOBILE_MONEY');
    }

    async function reloadList(){
      document.getElementById('table-loader').innerText = 'Loading...';
      const q = document.getElementById('globalSearch').value.trim();
      const res = await apiGet(`purchase-order.php?ajax=po_list&status=${encodeURIComponent(CURRENT_FILTER)}&q=${encodeURIComponent(q)}&limit=50`);
      const rows = res.data || [];
      const tbody = document.getElementById('payables-body');
      tbody.innerHTML = '';
      const canFinanceApprove = ['ADMIN','FINANCE','MANAGEMENT'].includes(String(USER_ROLE || '').toUpperCase());
      

      /* START COPYING HERE */
    rows.forEach(p => {
      const stEff = effectiveStatus(p);
      const stRaw = String(p.status || 'DRAFT').toUpperCase();

      // Calculation for balance
      const totalToPay = parseFloat(p.net_payable || 0);
      const alreadyPaid = parseFloat(p.amount_paid || 0);
      const balance = totalToPay - alreadyPaid;

      let actions = `<button class="btn btn-sm btn-white border text-primary" onclick="reviewPO('${escapeJs(p.po_id || '')}')"><i class="fa-solid fa-eye"></i></button>`;
      
      if (canFinanceApprove && stRaw === 'PENDING') {
        actions += `<button class="btn btn-sm btn-success ms-1" onclick="approvePO('${escapeJs(p.po_id || '')}')"><i class="fa-solid fa-check"></i></button>`;
      }
      
      // Keep the button visible for partial payments
      if (canFinanceApprove && (stRaw === 'APPROVED' || stRaw === 'PENDING' || stRaw === 'PARTIAL')) {
        actions += `<button class="btn btn-sm btn-dark ms-1" onclick="markPaid('${escapeJs(p.po_id || '')}')"><i class="fa-solid fa-money-bill"></i></button>`;
      }

      const amtTTC = (p.total_ttc === null) ? '—' : Number(p.total_ttc).toLocaleString();
      const balDisp = balance.toLocaleString();

      tbody.insertAdjacentHTML('beforeend', `
        <tr>
          <td class="font-monospace fw-bold text-primary">${escapeHtml(p.po_id || '')}</td>
          <td class="small text-muted">${escapeHtml(p.created_date || '')}</td>
          <td class="fw-bold" style="font-size:0.8rem">${escapeHtml(p.supplier_name || '')}</td>
          <td class="font-mono fw-bold text-dark">
            <div>${amtTTC} <span class="text-muted small">${escapeHtml(p.currency || '')}</span></div>
            <div style="font-size: 0.65rem; color: #dc3545; font-weight: 700;">
              Bal: ${balDisp} ${escapeHtml(p.currency || '')}
            </div>
          </td>
          <td class="small">${escapeHtml(p.due_date || '')}</td>
          <td>${getStatusBadge(stEff)}</td>
          <td class="text-end">${actions}</td>
        </tr>
      `);
    });
/* STOP COPYING HERE */
      updateKPIs();
      document.getElementById('table-loader').innerText = rows.length ? 'Showing top 50 records.' : 'No records found.';
    }

    function setFilter(status, btn){
      CURRENT_FILTER = status;
      document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      reloadList().catch(console.error);
    }

    function getStatusBadge(status){
      const s = String(status).toUpperCase();
      const map = {
        'DRAFT': 'status-draft', 'PENDING': 'status-pending', 'APPROVED':'status-active',
        'PARTIAL': 'status-active text-orange', 'OVERDUE': 'status-late', 'PAID': 'status-success'
      };
      const cls = map[s] || map['DRAFT'];
      return `<span class="status-pill ${cls}">${escapeHtml(s)}</span>`;
    }

    async function updateKPIs(){
      try {
        const res = await apiGet('purchase-order.php?ajax=po_kpis');
        if (res.ok) {
           document.getElementById('kpi-pending').innerText = res.pending;
           document.getElementById('kpi-approved').innerText = res.approved;
           document.getElementById('kpi-overdue').innerText = res.overdue;
           const total = parseFloat(res.total || 0);
           document.getElementById('kpi-total').innerText = total.toLocaleString(undefined, {minimumFractionDigits: 0}) + ' XAF';
        }
      } catch(e) { console.error("KPI Load failed", e); }
    }

    function openCreateModal(){
      CURRENT_PO = null;
      document.getElementById('poForm').reset();
      document.getElementById('po_id').value = '';
      document.getElementById('supplier_id').value = '';
      document.getElementById('supplier-readonly').classList.add('d-none');
      document.querySelector('#itemsTable tbody').innerHTML = '';
      addLineItem();
      document.getElementById('modal-mode-badge').innerText = 'NEW DRAFT';
      document.getElementById('modal-mode-badge').className = 'badge bg-light text-dark border';
      document.getElementById('footer-status-text').innerText = 'Draft Status';
      const modal = new bootstrap.Modal(document.getElementById('createPoModal'));
      modal.show();
      updateFooterButtons('DRAFT');
    }

    async function reviewPO(id){
      try{
        const res = await apiGet(`purchase-order.php?ajax=po_get&id=${encodeURIComponent(id)}`);
        CURRENT_PO = res.po || null;
        const items = res.items || [];
        document.getElementById('po_id').value = CURRENT_PO.po_id || '';
        document.getElementById('supplierSearch').value = CURRENT_PO.supplier_name || '';
        document.getElementById('supplier_id').value = CURRENT_PO.supplier_id || '';
        document.getElementById('deliveryLoc').value = CURRENT_PO.delivery_location || '';
        if (!SUPPLIERS.length) await loadSuppliers('');
        onSupplierPicked();
        document.getElementById('currency').value = CURRENT_PO.currency || 'XAF';
        document.getElementById('deliveryDate').value = CURRENT_PO.delivery_date || '';
        document.getElementById('payMeans').value = (CURRENT_PO.payment_means || 'CASH');
        document.getElementById('payDays').value = CURRENT_PO.pay_days || 0;
        document.getElementById('bankName').value = CURRENT_PO.bank_name || '';
        document.getElementById('bankAcct').value = CURRENT_PO.account_number || '';
        document.getElementById('bankAcctName').value = CURRENT_PO.account_name || '';
        document.getElementById('momoNetwork').value = CURRENT_PO.momo_network || '';
        document.getElementById('momoNum').value = CURRENT_PO.momo_number || '';
        document.getElementById('airRate').value = (CURRENT_PO.air_rate || 0);
        document.getElementById('advPaid').value = (CURRENT_PO.adv_paid || 0);
        document.getElementById('poTerms').value = CURRENT_PO.terms || '';
        document.getElementById('fileSearch').value = CURRENT_PO.file_reference || '';
        await onOpsFilePicked();
        if ((CURRENT_PO.expense_category || 'OPERATIONS') === 'OVERHEAD'){
          document.getElementById('cat-gen').checked = true; toggleFileLink(false);
        } else {
          document.getElementById('cat-ops').checked = true; toggleFileLink(true);
        }
        const tbody = document.querySelector('#itemsTable tbody');
        tbody.innerHTML = '';
        if (!items.length) addLineItem();
        items.forEach(it => {
          const tr = document.createElement('tr');
          tr.innerHTML = `<td><input type="text" class="form-control form-control-sm smart-input desc-field" value="${escapeAttr(it.description || '')}" onkeydown="handleEnter(event, this)"></td><td><input type="number" class="form-control form-control-sm smart-input qty-field text-center" value="${escapeAttr(it.qty ?? 1)}" oninput="recalcTotal()" onkeydown="handleEnter(event, this)"></td><td><input type="number" class="form-control form-control-sm smart-input price-field text-end" value="${escapeAttr(it.unit_price ?? 0)}" oninput="recalcTotal()" onkeydown="handleEnter(event, this)"></td><td><input type="number" class="form-control form-control-sm smart-input vat-field text-center" value="${escapeAttr(it.vat_rate ?? 0)}" oninput="recalcTotal()" onkeydown="handleEnter(event, this)"></td><td class="text-end font-mono fw-bold total-field">0.00</td><td class="text-center"><i class="fa-solid fa-trash text-danger cursor-pointer" onclick="removeLine(this)"></i></td>`;
          const descInput = tr.querySelector('.desc-field');
          bindDescDictionary(descInput);
          tbody.appendChild(tr);
        });
        togglePayFields();
        recalcTotal();
        const st = String(CURRENT_PO.status || 'DRAFT').toUpperCase();
        const isLocked = (st !== 'DRAFT');
        const unlockPending = (parseInt(CURRENT_PO.unlock_request_status || 0) === 1);
        const unlockReason = CURRENT_PO.unlock_request_reason || '';
        const form = document.getElementById('poForm');
        const elements = form.querySelectorAll('input, select, textarea, button');
        elements.forEach(el => { el.disabled = isLocked; });
        document.querySelector('button[onclick="addLineItem()"]').style.display = isLocked ? 'none' : 'inline-block';
        document.querySelectorAll('.fa-trash').forEach(el => el.style.display = isLocked ? 'none' : 'inline-block');
        const footer = document.querySelector('.create-footer .d-flex.gap-2');
        const oldUnlock = document.getElementById('btn-unlock');
        const oldReq = document.getElementById('btn-request-unlock');
        const oldAlert = document.getElementById('unlock-alert');
        if(oldUnlock) oldUnlock.remove();
        if(oldReq) oldReq.remove();
        if(oldAlert) oldAlert.remove();
        if (isLocked) {
           const isAdmin = ['ADMIN','MANAGEMENT'].includes(USER_ROLE);
           if (unlockPending) {
              const alertDiv = document.createElement('div');
              alertDiv.id = 'unlock-alert';
              alertDiv.className = 'text-warning fw-bold small me-3 d-flex align-items-center';
              alertDiv.innerHTML = `<i class="fa-solid fa-triangle-exclamation me-1"></i> Request Pending: "${escapeHtml(unlockReason)}"`;
              footer.insertBefore(alertDiv, footer.firstChild);
              if (isAdmin) {
                  const btnUnlock = document.createElement('button');
                  btnUnlock.id = 'btn-unlock';
                  btnUnlock.className = 'btn btn-warning fw-bold';
                  btnUnlock.innerHTML = '<i class="fa-solid fa-check me-2"></i>Approve Unlock';
                  btnUnlock.onclick = () => unlockPO(id);
                  footer.insertBefore(btnUnlock, footer.children[1]);
              }
           } else {
              if (isAdmin) {
                  const btnUnlock = document.createElement('button');
                  btnUnlock.id = 'btn-unlock';
                  btnUnlock.className = 'btn btn-warning fw-bold';
                  btnUnlock.innerHTML = '<i class="fa-solid fa-lock-open me-2"></i>Unlock';
                  btnUnlock.onclick = () => unlockPO(id);
                  footer.insertBefore(btnUnlock, footer.firstChild);
              } else {
                  const btnReq = document.createElement('button');
                  btnReq.id = 'btn-request-unlock';
                  btnReq.className = 'btn btn-outline-warning fw-bold text-dark';
                  btnReq.innerHTML = '<i class="fa-solid fa-hand-point-up me-2"></i>Request Unlock';
                  btnReq.onclick = () => requestUnlockPO(id);
                  footer.insertBefore(btnReq, footer.firstChild);
              }
           }
        }
        document.getElementById('modal-mode-badge').innerText = st;
        document.getElementById('footer-status-text').innerText = `Current Status: ${st}`;
        updateFooterButtons(st);
        const modal = new bootstrap.Modal(document.getElementById('createPoModal'));
        modal.show();
      } catch(e){ alert('Failed to open PO: ' + e.message); }
    }

    async function requestUnlockPO(id){
       const reason = prompt("Please state the reason for unlocking this Purchase Order (e.g., Wrong Bank Details):");
       if (!reason) return;
       try {
         await apiPost('purchase-order.php?ajax=po_request_unlock', { po_id: id, reason: reason });
         alert("Unlock request sent to Management.");
         reviewPO(id);
       } catch (e) { alert("Request failed: " + e.message); }
    }

    async function unlockPO(id){
       if(!confirm("⚠️ SECURITY WARNING ⚠️\n\nUnlocking this Purchase Order will revert it to DRAFT status.\nThis allows editing but removes its approval.\n\nProceed?")) return;
       try {
         const res = await apiPost('purchase-order.php?ajax=po_unlock', { po_id: id });
         alert("PO Unlocked. It is now in DRAFT mode.");
         const el = document.getElementById('createPoModal');
         const modal = bootstrap.Modal.getInstance(el);
         modal.hide();
         reloadList();
         setTimeout(() => reviewPO(id), 500);
       } catch (e) { alert("Unlock failed: " + e.message); }
    }

    function addLineItem(){
      const tbody = document.querySelector('#itemsTable tbody');
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><input type="text" class="form-control form-control-sm smart-input desc-field" list="fdDescOptions" placeholder="Item description" onkeydown="handleEnter(event, this)"></td><td><input type="number" class="form-control form-control-sm smart-input qty-field text-center" value="1" oninput="recalcTotal()" onkeydown="handleEnter(event, this)"></td><td><input type="number" class="form-control form-control-sm smart-input price-field text-end" placeholder="0" oninput="recalcTotal()" onkeydown="handleEnter(event, this)"></td><td><input type="number" class="form-control form-control-sm smart-input vat-field text-center" value="19.25" oninput="recalcTotal()" onkeydown="handleEnter(event, this)"></td><td class="text-end font-mono fw-bold total-field">0.00</td><td class="text-center"><i class="fa-solid fa-trash text-danger cursor-pointer" onclick="removeLine(this)"></i></td>`;
      tbody.appendChild(tr);
      const descInput = tr.querySelector('.desc-field');
      bindDescDictionary(descInput);
      descInput.focus();
    }

    function removeLine(el){
      const rows = document.querySelectorAll('#itemsTable tbody tr');
      if (rows.length <= 1) return;
      el.closest('tr').remove();
      recalcTotal();
    }

    function handleEnter(e, input){
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const row = input.closest('tr');
      const inputs = Array.from(row.querySelectorAll('input'));
      const idx = inputs.indexOf(input);
      if (idx < inputs.length - 1){ inputs[idx + 1].focus(); inputs[idx + 1].select(); } else { addLineItem(); }
    }

    function recalcTotal(){
      const cur = document.getElementById('currency').value || 'XAF';
      let grandHt = 0; let grandVat = 0;
      document.querySelectorAll('#itemsTable tbody tr').forEach(tr => {
        const qty = parseFloat(tr.querySelector('.qty-field').value) || 0;
        const price = parseFloat(tr.querySelector('.price-field').value) || 0;
        const vatRate = parseFloat(tr.querySelector('.vat-field').value) || 0;
        const lineHt = qty * price;
        const lineVat = lineHt * (vatRate / 100);
        const lineTtc = lineHt + lineVat;
        tr.querySelector('.total-field').innerText = lineTtc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        grandHt += lineHt; grandVat += lineVat;
      });
      const grandTtc = grandHt + grandVat;
      const airRate = parseFloat(document.getElementById('airRate').value) || 0;
      const airAmt = grandHt * (airRate / 100);
      const adv = parseFloat(document.getElementById('advPaid').value) || 0;
      const netPay = grandTtc - airAmt - adv;
      const hasAmount = Math.abs(grandTtc) > 0.000001;
      document.getElementById('disp-total-ht').innerText  = hasAmount ? (grandHt.toLocaleString()  + ' ' + cur) : '—';
      document.getElementById('disp-total-vat').innerText = hasAmount ? (grandVat.toLocaleString() + ' ' + cur) : '—';
      document.getElementById('disp-total-ttc').innerText = hasAmount ? (grandTtc.toLocaleString() + ' ' + cur) : '—';
      document.getElementById('disp-net-pay').innerText   = hasAmount ? (netPay.toLocaleString()  + ' ' + cur) : '—';
    }

    async function savePO(status){
      try{
        const supplierName = document.getElementById('supplierSearch').value.trim();
        const supplierId = document.getElementById('supplier_id').value.trim();
        if (!supplierId || !supplierName){ alert('Please select a supplier (from supplier_master).'); return; }
        const isOps = document.getElementById('cat-ops').checked;
        const expenseCategory = isOps ? 'OPERATIONS' : 'OVERHEAD';
        const currency = document.getElementById('currency').value || 'XAF';
        const items = [];
        document.querySelectorAll('#itemsTable tbody tr').forEach(tr => {
          const desc = (tr.querySelector('.desc-field').value || '').trim();
          const qty  = parseFloat(tr.querySelector('.qty-field').value) || 0;
          const price= parseFloat(tr.querySelector('.price-field').value) || 0;
          const vat  = parseFloat(tr.querySelector('.vat-field').value) || 0;
          if (!desc && Math.abs(qty) < 0.000001 && Math.abs(price) < 0.000001) return;
          items.push({ description: desc, qty, unit_price: price, vat_rate: vat });
        });
        let totalHt=0, totalVat=0;
        items.forEach(it => {
          const lineHt = (it.qty || 0) * (it.unit_price || 0);
          const lineVat = lineHt * ((it.vat_rate || 0) / 100);
          totalHt += lineHt; totalVat += lineVat;
        });
        const totalTtc = totalHt + totalVat;
        const airRate = parseFloat(document.getElementById('airRate').value) || 0;
        const advPaid = parseFloat(document.getElementById('advPaid').value) || 0;
        const airAmt = totalHt * (airRate / 100);
        const netPayable = totalTtc - airAmt - advPaid;
        const hasAmount = Math.abs(totalTtc) > 0.000001;
        const payload = {
          po_id: document.getElementById('po_id').value.trim(),
          supplier_id: supplierId,
          supplier_name: supplierName,
          expense_category: expenseCategory,
          file_reference: (document.getElementById('fileSearch').value || '').trim(),
          delivery_location: document.getElementById('deliveryLoc').value || null,
          currency,
          delivery_date: document.getElementById('deliveryDate').value || null,
          payment_means: document.getElementById('payMeans').value || 'CASH',
          pay_days: parseInt(document.getElementById('payDays').value || '0', 10) || 0,
          bank_name: document.getElementById('bankName').value || null,
          account_number: document.getElementById('bankAcct').value || null,
          account_name: document.getElementById('bankAcctName').value || null,
          momo_network: document.getElementById('momoNetwork').value || null,
          momo_number: document.getElementById('momoNum').value || null,
          air_rate: airRate,
          adv_paid: advPaid,
          total_ht: hasAmount ? totalHt : null,
          total_vat: hasAmount ? totalVat : null,
          total_ttc: hasAmount ? totalTtc : null,
          net_payable: hasAmount ? netPayable : null,
          terms: document.getElementById('poTerms').value || '',
          status: status === 'PENDING' ? 'PENDING' : 'DRAFT',
          items
        };
        const res = await apiPost('purchase-order.php?ajax=po_save', payload);
        document.getElementById('po_id').value = res.po_id || payload.po_id || '';
        document.getElementById('modal-mode-badge').innerText = res.status || payload.status;
        document.getElementById('footer-status-text').innerText = `Saved: ${res.status || payload.status}`;
        updateFooterButtons(res.status || payload.status);
        await reloadList();
        alert(`Saved successfully. Status: ${res.status || payload.status}`);
      } catch(e){ alert('Save failed: ' + e.message); }
    }

    function exportData(){ alert('Export feature: implement server-side export (CSV/XLSX) when ready.'); }
    function escapeHtml(s){ return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    function escapeAttr(s){ return escapeHtml(s).replace(/"/g,'&quot;'); }
    function escapeJs(s){ return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,'\\n').replace(/\r/g,'\\r'); }
    
    function updateFooterButtons(status){
      status = String(status || 'DRAFT').toUpperCase();
      const btnDraft  = document.getElementById('btn-save-draft');
      const btnSubmit = document.getElementById('btn-submit');
      const btnPrint  = document.getElementById('btn-print-official');
      if (btnDraft)  btnDraft.classList.add('d-none');
      if (btnSubmit) btnSubmit.classList.add('d-none');
      if (btnPrint)  btnPrint.classList.add('d-none');
      if (status === 'DRAFT') {
        if (btnDraft)  btnDraft.classList.remove('d-none');
        if (btnSubmit) btnSubmit.classList.remove('d-none');
      }
      else if (['APPROVED', 'PARTIAL', 'PAID'].includes(status)) {
        if (btnPrint) btnPrint.classList.remove('d-none');
      }
    }

    function openPrintTab(){
      const poId = document.getElementById('po_id').value;
      if(!poId) { alert('No PO ID found'); return; }
      window.open(`print-po.php?id=${encodeURIComponent(poId)}`, '_blank');
    }
  </script>
</body>
</html>