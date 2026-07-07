<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN','FINANCE','MANAGEMENT']);

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
        supplier_id,
        supplier_name,
        supplier_type,
        contact_person,
        contact_email,
        contact_phone,
        niu,
        rccm,
        address,
        country,
        payment_method,
        payment_terms_days,
        bank_name,
        account_number,
        account_name,
        momo_network,
        momo_number,
        status
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
      $where .= " AND pom.status = ?";
      $types .= "s";
      $bind[] = $status;
    }

    if ($q !== '') {
      $where .= " AND (pom.po_id LIKE ? OR pom.supplier_name LIKE ? OR pom.file_reference LIKE ?)";
      $types .= "sss";
      $bind[] = $like;
      $bind[] = $like;
      $bind[] = $like;
    }

    $sql = "
      SELECT
        pom.po_id,
        DATE_FORMAT(pom.created_at, '%Y-%m-%d') AS created_date,
        pom.supplier_name,
        pom.currency,
        pom.total_ttc,
        pom.due_date,
        pom.status
      FROM purchase_order_master pom
      WHERE {$where}
      ORDER BY pom.created_at DESC
      LIMIT {$limit}
    ";

    $stmt = $conn->prepare($sql);
    if ($types !== '') {
      $stmt->bind_param($types, ...$bind);
    }
    $stmt->execute();
    $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

    jexit(['ok' => true, 'data' => $rows]);
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

  if ($ajax === 'po_save') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') jexit(['ok' => false, 'error' => 'POST required'], 405);

    $raw  = file_get_contents('php://input');
    $data = json_decode($raw ?: 'null', true);
    if (!is_array($data)) jexit(['ok' => false, 'error' => 'Invalid JSON'], 400);

    $poId         = trim((string)($data['po_id'] ?? ''));
    $supplierId   = trim((string)($data['supplier_id'] ?? ''));
    $supplierName = trim((string)($data['supplier_name'] ?? ''));
    $status       = strtoupper(trim((string)($data['status'] ?? 'DRAFT')));

    if ($supplierId === '' || $supplierName === '') {
      jexit(['ok' => false, 'error' => 'Supplier is required'], 400);
    }

    if (!in_array($status, ['DRAFT', 'PENDING'], true)) {
      $status = 'DRAFT';
    }

    $expenseCategory = (($data['expense_category'] ?? 'OPERATIONS') === 'OVERHEAD') ? 'OVERHEAD' : 'OPERATIONS';

    $fileRef = trim((string)($data['file_reference'] ?? ''));
    $fileRef = $fileRef !== '' ? $fileRef : null;

    $currency = trim((string)($data['currency'] ?? 'XAF'));
    $currency = $currency !== '' ? $currency : 'XAF';

    $deliveryDate = norm_date((string)($data['delivery_date'] ?? ''));

    $paymentMeans = strtoupper(trim((string)($data['payment_means'] ?? 'CASH')));
    $allowedMeans = ['CASH','BANK_TRANSFER','CHEQUE','MOBILE_MONEY'];
    if (!in_array($paymentMeans, $allowedMeans, true)) $paymentMeans = 'CASH';

    $payDays = (int)($data['pay_days'] ?? 0);
    if ($payDays < 0) $payDays = 0;

    $bankName = trim((string)($data['bank_name'] ?? ''));       $bankName = $bankName !== '' ? $bankName : null;
    $acctNum  = trim((string)($data['account_number'] ?? ''));  $acctNum  = $acctNum  !== '' ? $acctNum  : null;
    $acctName = trim((string)($data['account_name'] ?? ''));    $acctName = $acctName !== '' ? $acctName : null;

    $momoNet  = strtoupper(trim((string)($data['momo_network'] ?? '')));
    $momoNet  = $momoNet !== '' ? $momoNet : null;

    $momoNum  = trim((string)($data['momo_number'] ?? ''));
    $momoNum  = $momoNum !== '' ? $momoNum : null;

    $airRate = (float)($data['air_rate'] ?? 0);
    $advPaid = (float)($data['adv_paid'] ?? 0);
    $terms   = (string)($data['terms'] ?? '');

    $totalHt    = array_key_exists('total_ht', $data)    ? (float)$data['total_ht']    : null;
    $totalVat   = array_key_exists('total_vat', $data)   ? (float)$data['total_vat']   : null;
    $totalTtc   = array_key_exists('total_ttc', $data)   ? (float)$data['total_ttc']   : null;
    $netPayable = array_key_exists('net_payable', $data) ? (float)$data['net_payable'] : null;

    $hasAmount = ($totalTtc !== null && abs($totalTtc) > 0.000001);
    if (!$hasAmount) {
      $totalHt = $totalVat = $totalTtc = $netPayable = null;
    }

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

      $airRateS  = (string)$airRate;
      $advPaidS  = (string)$advPaid;

      if ($exists) {
        $sqlUp = "
          UPDATE purchase_order_master
          SET
            supplier_id=?,
            supplier_name=?,
            expense_category=?,
            file_reference=?,
            currency=?,
            delivery_date=?,
            payment_means=?,
            pay_days=?,
            bank_name=?,
            account_number=?,
            account_name=?,
            momo_network=?,
            momo_number=?,
            air_rate=?,
            adv_paid=?,
            total_ht=?,
            total_vat=?,
            total_ttc=?,
            net_payable=?,
            terms=?,
            due_date=?,
            status=?,
            updated_at=NOW()
          WHERE po_id=?
          LIMIT 1
        ";
        $stmtUp = $conn->prepare($sqlUp);
        $stmtUp->bind_param(
          'sssssssisssssssssssssss',
          $supplierId,
          $supplierName,
          $expenseCategory,
          $fileRef,
          $currency,
          $deliveryDate,
          $paymentMeans,
          $payDays,
          $bankName,
          $acctNum,
          $acctName,
          $momoNet,
          $momoNum,
          $airRateS,
          $advPaidS,
          $totalHtS,
          $totalVatS,
          $totalTtcS,
          $netPayS,
          $terms,
          $dueDate,
          $status,
          $poId
        );
        $stmtUp->execute();
      } else {
        $sqlIn = "
          INSERT INTO purchase_order_master (
            po_id, supplier_id, supplier_name, expense_category, file_reference, currency,
            delivery_date, payment_means, pay_days,
            bank_name, account_number, account_name, momo_network, momo_number,
            air_rate, adv_paid, total_ht, total_vat, total_ttc, net_payable,
            terms, due_date, status,
            created_by
          ) VALUES (
            ?,?,?,?,?,?,
            ?,?,?,
            ?,?,?,?,?,?,
            ?,?,?,?,?,
            ?,?,?,
            ?
          )
        ";
        $stmtIn = $conn->prepare($sqlIn);

$stmtIn->bind_param(
  // corrected types string (24 types -> 24 variables)
  'ssssssssissssssssssssssi',
  $poId,           // 1 s
  $supplierId,     // 2 s
  $supplierName,   // 3 s
  $expenseCategory,// 4 s
  $fileRef,        // 5 s (nullable ok)
  $currency,       // 6 s
  $deliveryDate,   // 7 s (nullable ok)
  $paymentMeans,   // 8 s
  $payDays,        // 9 i
  $bankName,       //10 s (nullable ok)
  $acctNum,        //11 s (nullable ok)
  $acctName,       //12 s (nullable ok)
  $momoNet,        //13 s (nullable ok)
  $momoNum,        //14 s (nullable ok)
  $airRateS,       //15 s (string ok)
  $advPaidS,       //16 s
  $totalHtS,       //17 s (nullable ok)
  $totalVatS,      //18 s
  $totalTtcS,      //19 s
  $netPayS,        //20 s
  $terms,          //21 s
  $dueDate,        //22 s (nullable ok)
  $status,         //23 s
  $userId          //24 i
);

$stmtIn->execute();

      }

      $stmtDel = $conn->prepare("DELETE FROM purchase_order_items WHERE po_id = ?");
      $stmtDel->bind_param('s', $poId);
      $stmtDel->execute();

      $lineNo = 0;

      $sqlItem = "
        INSERT INTO purchase_order_items
          (po_id, line_no, description, qty, unit_price, vat_rate, line_ht, line_vat, line_ttc)
        VALUES
          (?,?,?,?,?,?,?,?,?)
      ";
      $stmtItem = $conn->prepare($sqlItem);

      foreach ($items as $it) {
        if (!is_array($it)) continue;

        $desc = trim((string)($it['description'] ?? ''));
        $qty  = (float)($it['qty'] ?? 0);
        $prc  = (float)($it['unit_price'] ?? 0);
        $vat  = (float)($it['vat_rate'] ?? 0);

        if ($desc === '' && abs($qty) < 0.000001 && abs($prc) < 0.000001) continue;

        $lineNo++;
        $lineHt  = $qty * $prc;
        $lineVat = $lineHt * ($vat / 100);
        $lineTtc = $lineHt + $lineVat;

        $stmtItem->bind_param(
          'sisdddddd',
          $poId,
          $lineNo,
          $desc,
          $qty,
          $prc,
          $vat,
          $lineHt,
          $lineVat,
          $lineTtc
        );
        $stmtItem->execute();
      }

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
    /* Keep your PO UI styles (only what purchase-order.php needs). */
    :root{
      --smart-blue:#1F99D8;
      --smart-dark:#055B83;
      --smart-orange:#EE7D04;
      --smart-charcoal:#231F20;
      --smart-bg:#F0F4F8;
      --sidebar-width:260px;
      --header-height:70px;

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

    /* Ensure the admin.css layout matches your locked baseline (sidebar/topbar). */
    .main-content{ margin-left:var(--sidebar-width); padding-top:var(--header-height); min-height:100vh; width:calc(100% - var(--sidebar-width)); }
    .top-navbar{ left:var(--sidebar-width); }

    .ops-banner{
      background:linear-gradient(135deg,var(--smart-dark) 0%,#023e5a 100%);
      color:#fff; border-radius:12px; padding:1.5rem 2rem; box-shadow:0 10px 30px rgba(5,91,131,.2);
      width:100%;
    }
    .card-custom{ background:#fff; border-radius:12px; border:1px solid rgba(0,0,0,.05); box-shadow:0 2px 12px rgba(0,0,0,.02); height:100%; }
    .kpi-title{ font-size:.7rem; font-weight:700; text-transform:uppercase; color:#888; letter-spacing:.5px; white-space:nowrap; }
    .kpi-value{ font-size:1.6rem; font-weight:800; color:var(--smart-charcoal); line-height:1.2; font-variant-numeric:tabular-nums; }

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

    /* PRINT (unchanged) */
    #print-area{ display:none; }
    @media print {
      @page { size:A4; margin:0; }
      body { background:#fff; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      body * { visibility:hidden; }
      .sidebar, .top-navbar, .main-content, .modal, .modal-backdrop { display:none !important; }
      #print-area, #print-area * { visibility:visible; }
      #print-area{ display:block; position:absolute; left:0; top:0; width:210mm; min-height:297mm; background:#fff; padding:12mm 15mm; font-family:Arial,sans-serif; color:#000; }
      .po-header{ display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px; border-bottom:2px solid var(--smart-orange); padding-bottom:10px; }
      .po-brand img{ height:50px; width:auto; }
      .po-brand-text{ font-size:9px; color:#333; margin-top:5px; line-height:1.3; }
      .po-title-block{ text-align:right; }
      .po-title{ font-size:22px; font-weight:900; color:var(--smart-dark); text-transform:uppercase; margin-bottom:0; }
      .po-subtitle{ font-size:10px; color:var(--smart-orange); font-weight:700; text-transform:uppercase; letter-spacing:2px; }
      .po-grid{ display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:25px; }
      .po-meta-box{ border:1px solid #000; padding:0; }
      .meta-row{ display:flex; border-bottom:1px solid #000; }
      .meta-row:last-child{ border-bottom:none; }
      .meta-label{ width:40%; background:#eee; padding:4px 8px; font-size:9px; font-weight:bold; border-right:1px solid #000; text-transform:uppercase; }
      .meta-value{ width:60%; padding:4px 8px; font-size:10px; font-weight:bold; }
      .po-supplier-box{ border:1px solid #000; padding:10px; background:#f9f9f9; }
      .sup-header{ font-size:10px; font-weight:bold; color:var(--smart-blue); text-transform:uppercase; margin-bottom:5px; border-bottom:1px solid #ccc; padding-bottom:2px; }
      .sup-name{ font-size:12px; font-weight:800; margin-bottom:4px; }
      .sup-detail{ font-size:10px; line-height:1.4; }
      .po-table{ width:100%; border-collapse:collapse; margin-bottom:20px; }
      .po-table th{ background:#333; color:#fff; padding:6px 8px; font-size:9px; text-transform:uppercase; font-weight:bold; text-align:left; }
      .po-table td{ border-bottom:1px solid #ccc; padding:8px; font-size:10px; vertical-align:top; }
      .po-totals-container{ display:flex; justify-content:flex-end; margin-bottom:30px; }
      .po-totals-table{ width:50%; border-collapse:collapse; }
      .po-totals-table td{ padding:4px 8px; font-size:10px; border-bottom:1px solid #eee; }
      .po-total-label{ text-align:right; font-weight:bold; width:60%; }
      .po-total-value{ text-align:right; font-weight:800; width:40%; }
      .grand-total{ background:#eee; border-top:2px solid #000; font-size:11px; }
      .po-terms{ border:1px dashed #999; padding:8px; font-size:9px; margin-bottom:20px; min-height:40px; }
      .sig-area{ display:grid; grid-template-columns:1fr 1fr; gap:40px; margin-top:20px; border-top:2px solid #000; padding-top:10px; }
      .sig-box{ border:1px solid #ccc; height:120px; position:relative; }
      .sig-label{ font-size:9px; font-weight:bold; background:#eee; padding:4px; border-bottom:1px solid #ccc; display:block; text-transform:uppercase; }
      .sig-content{ display:flex; flex-direction:column; align-items:center; justify-content:center; height:90px; }
      .sig-img{ width:100px; height:auto; mix-blend-mode:multiply; }
      .po-footer{ position:fixed; bottom:0; left:0; width:100%; border-top:1px solid #ccc; padding:8px 15mm; font-size:8px; color:#555; display:flex; justify-content:space-between; align-items:flex-end; }
    }
  </style>
</head>
<body>

  <!-- SIDEBAR (REPLACED WITH index.php SIDEBAR) -->
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

  <!-- TOPBAR (REPLACED WITH index.php TOPBAR) -->
  <div class="top-navbar">
    <div>
      <h5 class="mb-0 fw-bold text-dark">Employee Master</h5>
      <small class="text-muted" style="font-size: 0.7rem;">HR DIRECTORY & PERSONNEL CONTROLS</small>
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
          <small class="text-primary fw-bold" style="font-size: 0.65rem; letter-spacing: 0.5px;" id="user-role-label">
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
        <div class="ops-banner d-flex justify-content-between align-items-center">
          <div>
            <h2 class="fw-bold mb-1">Payables Register</h2>
            <p class="mb-0 opacity-75">Create and track Purchase Orders. Draft saves as <span class="fw-bold">DRAFT</span>; Submit saves as <span class="fw-bold">PENDING</span>.</p>
          </div>
          <div class="text-end" style="min-width: 150px;">
            <div class="mb-1 text-uppercase text-white-50" style="font-size: 0.7rem; font-weight: 800;">System</div>
            <div class="d-flex align-items-center justify-content-end gap-2">
              <i class="fa-solid fa-check-circle text-success fs-5"></i>
              <span class="fw-bold fs-5">ONLINE</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="d-flex justify-content-end mb-3">
      <button class="btn btn-primary fw-bold shadow-sm"
              style="background-color: var(--smart-orange); border-color: var(--smart-orange); padding: 10px 24px;"
              onclick="openCreateModal()">
        <i class="fa-solid fa-plus me-2"></i> Create New PO
      </button>
    </div>

    <div class="row g-3 mb-4">
      <div class="col-3">
        <div class="card-custom p-3 d-flex align-items-center">
          <div class="me-3 rounded-3 bg-warning bg-opacity-10 text-warning d-flex align-items-center justify-content-center" style="width:45px;height:45px;font-size:1.2rem;">
            <i class="fa-solid fa-clock"></i>
          </div>
          <div>
            <div class="kpi-title">Pending Approval</div>
            <div class="kpi-value" id="kpi-pending">0</div>
          </div>
        </div>
      </div>
      <div class="col-3">
        <div class="card-custom p-3 d-flex align-items-center">
          <div class="me-3 rounded-3 bg-primary bg-opacity-10 text-primary d-flex align-items-center justify-content-center" style="width:45px;height:45px;font-size:1.2rem;">
            <i class="fa-solid fa-truck"></i>
          </div>
          <div>
            <div class="kpi-title">Approved</div>
            <div class="kpi-value text-primary" id="kpi-approved">0</div>
          </div>
        </div>
      </div>
      <div class="col-3">
        <div class="card-custom p-3 d-flex align-items-center">
          <div class="me-3 rounded-3 bg-danger bg-opacity-10 text-danger d-flex align-items-center justify-content-center" style="width:45px;height:45px;font-size:1.2rem;">
            <i class="fa-solid fa-bell"></i>
          </div>
          <div>
            <div class="kpi-title">Overdue</div>
            <div class="kpi-value text-danger" id="kpi-overdue">0</div>
          </div>
        </div>
      </div>
      <div class="col-3">
        <div class="card-custom p-3 d-flex align-items-center">
          <div class="me-3 rounded-3 bg-success bg-opacity-10 text-success d-flex align-items-center justify-content-center" style="width:45px;height:45px;font-size:1.2rem;">
            <i class="fa-solid fa-wallet"></i>
          </div>
          <div>
            <div class="kpi-title">Total Payable</div>
            <div class="kpi-value" id="kpi-total" style="font-size:1.2rem;">0</div>
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
        <div class="col-md-8 text-end">
          <button class="btn btn-sm btn-white border fw-bold text-dark shadow-sm" onclick="exportData()">
            <i class="fa-solid fa-file-excel text-success me-2"></i>Export Report
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

  <!-- CREATE / EDIT MODAL -->
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
                    <label class="form-label text-primary">File Reference</label>
                    <input type="text" class="form-control smart-input" id="fileSearch" placeholder="SLAS-FR... (optional)">
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
            <button id="btn-submit" type="button" class="btn btn-primary fw-bold" style="background-color: var(--smart-blue); border:none;"
                    onclick="savePO('PENDING')">
              Submit for Approval
            </button>
            <button id="btn-print" type="button" class="btn btn-dark fw-bold d-none" onclick="generatePrint()">
              <i class="fa-solid fa-print me-2"></i>Print PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- PRINT AREA (kept) -->
  <div id="print-area">
    <div class="po-header">
      <div class="po-brand">
        <img src="https://i.ibb.co/35MQnHJn/LOGO-SMART.png" alt="Smart LS">
        <div class="po-brand-text">
          <strong>SMART LOGISTICS AND SERVICES LTD</strong><br>
          1030, Avenue Douala Manga Bell, Bali<br>
          Po Box 5120, Douala, Cameroon<br>
          Tel: 00237 233 420 281 | Email: info@smartls.cm
        </div>
      </div>
      <div class="po-title-block">
        <h1 class="po-title">Purchase Order</h1>
        <div class="po-subtitle">Bon de Commande</div>
        <img id="p-qr-code" style="width:60px;height:60px;margin-top:5px;border:1px solid #eee;">
      </div>
    </div>

    <div class="po-grid">
      <div class="po-meta-box">
        <div class="meta-row"><div class="meta-label">Purchase Order N°</div><div class="meta-value" id="p-po-num">---</div></div>
        <div class="meta-row"><div class="meta-label">Date</div><div class="meta-value" id="p-date">---</div></div>
        <div class="meta-row"><div class="meta-label">Payment Means</div><div class="meta-value" id="p-means">---</div></div>
        <div class="meta-row"><div class="meta-label">Conditions</div><div class="meta-value" id="p-cond">---</div></div>
        <div class="meta-row"><div class="meta-label">Exp. Delivery</div><div class="meta-value" id="p-del">---</div></div>
      </div>
      <div class="po-supplier-box">
        <div class="sup-header">To Supplier</div>
        <div class="sup-name" id="p-sup-name">---</div>
        <div class="sup-detail" id="p-sup-addr">---</div>
        <div class="sup-detail" id="p-sup-contact">---</div>
        <div class="sup-detail mt-1"><strong>ID:</strong> <span id="p-sup-id">---</span></div>
      </div>
    </div>

    <table class="po-table">
      <thead>
        <tr>
          <th style="width:40%">Description</th>
          <th style="width:10%;text-align:center;">Qty</th>
          <th style="width:15%;text-align:right;">Unit Price</th>
          <th style="width:15%;text-align:right;">Total Ex VAT</th>
          <th style="width:10%;text-align:right;">VAT</th>
          <th style="width:10%;text-align:right;">Total Inc</th>
        </tr>
      </thead>
      <tbody id="p-items-body"></tbody>
    </table>

    <div class="po-totals-container">
      <table class="po-totals-table">
        <tr><td class="po-total-label">TOTAL VAT EXCL:</td><td class="po-total-value" id="p-tot-ht">0</td></tr>
        <tr><td class="po-total-label">VAT TOTAL:</td><td class="po-total-value" id="p-tot-vat">0</td></tr>
        <tr class="grand-total"><td class="po-total-label">GRAND TOTAL (TTC):</td><td class="po-total-value" id="p-tot-ttc">0</td></tr>
        <tr><td class="po-total-label text-danger">AIR Precompte (Withholding):</td><td class="po-total-value text-danger" id="p-air">0</td></tr>
        <tr><td class="po-total-label">Advance Paid:</td><td class="po-total-value" id="p-adv">0</td></tr>
        <tr style="border-top:2px solid #000;"><td class="po-total-label" style="font-size:12px;color:var(--smart-blue);">NET PAYABLE BALANCE:</td><td class="po-total-value" style="font-size:12px;color:var(--smart-blue);" id="p-net">0</td></tr>
      </table>
    </div>

    <div style="font-size:9px;font-weight:bold;margin-bottom:2px;">Terms and Conditions:</div>
    <div class="po-terms" id="p-terms"></div>

    <div class="sig-area">
      <div class="sig-box">
        <span class="sig-label">ISSUED BY:</span>
        <div class="sig-content">
          <img src="https://i.ibb.co/m58kKZdd/signature-dg-smart.png" class="sig-img">
          <div class="sig-user"><?php echo e($fullName); ?></div>
        </div>
      </div>
      <div class="sig-box">
        <span class="sig-label">APPROVED BY (MD):</span>
        <div class="sig-content"></div>
      </div>
    </div>

    <div class="po-footer">
      <div>RC/DLA/2021/B/2060 | NIU: M0421160335800</div>
      <div>Generated by Smart LS Enterprise System</div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

  <script>
    /* ---------------------------
       CLOCK (safe)
    --------------------------- */
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

    /* ---------------------------
       API helpers
    --------------------------- */
    async function apiGet(url){
      const r = await fetch(url, { credentials: 'same-origin' });
      const t = await r.text();
      let j;
      try { j = JSON.parse(t); } catch(e){ throw new Error('Non-JSON response: ' + t.slice(0,200)); }
      if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
      return j;
    }

    async function apiPost(url, payload){
      const r = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const t = await r.text();
      let j;
      try { j = JSON.parse(t); } catch(e){ throw new Error('Non-JSON response: ' + t.slice(0,200)); }
      if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
      return j;
    }

    /* ---------------------------
       State
    --------------------------- */
    let CURRENT_FILTER = 'ALL';
    let SUPPLIERS = []; // loaded from supplier_master
    let CURRENT_PO = null; // loaded po object when editing
    let _reloadTimer = null;

    document.addEventListener('DOMContentLoaded', async () => {
      try {
        await loadSuppliers('');
        await reloadList();
        addLineItem(); // default one row
        togglePayFields();
        recalcTotal();
      } catch (e) {
        console.error(e);
        document.getElementById('table-loader').innerText = 'Error loading: ' + e.message;
      }
    });

    function debouncedReloadList(){
      clearTimeout(_reloadTimer);
      _reloadTimer = setTimeout(() => reloadList(), 250);
    }

    /* ---------------------------
       Suppliers (from supplier_master)
    --------------------------- */
    async function loadSuppliers(q){
      const res = await apiGet(`purchase-order.php?ajax=suppliers_list&q=${encodeURIComponent(q || '')}`);
      SUPPLIERS = res.data || [];
      const dl = document.getElementById('supplierOptions');
      dl.innerHTML = '';
      // Put supplier_name as the visible value; keep mapping by exact name
      SUPPLIERS.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.supplier_name;
        dl.appendChild(opt);
      });
      document.getElementById('supplier-hint').textContent =
        SUPPLIERS.length ? `Loaded ${SUPPLIERS.length} suppliers.` : 'No suppliers found.';
    }

    function onSupplierTyping(){
      // Optional: you can implement type-ahead DB filtering if you want.
      // For now, we only use the loaded list.
    }

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

      // Populate supplier panel
      document.getElementById('sup-name').innerText = s.supplier_name;
      const contactBits = [];
      if (s.contact_person) contactBits.push(s.contact_person);
      if (s.contact_email)  contactBits.push(s.contact_email);
      if (s.contact_phone)  contactBits.push(s.contact_phone);
      document.getElementById('sup-contact').innerText = contactBits.join(' • ') || '--';
      document.getElementById('sup-niu').innerText = s.niu ? ('NIU: ' + s.niu) : 'NIU: --';
      panel.classList.remove('d-none');

      // Auto-fill payment defaults from supplier_master
      if (s.payment_method) document.getElementById('payMeans').value = String(s.payment_method).toUpperCase();
      if (s.payment_terms_days !== null && s.payment_terms_days !== undefined) document.getElementById('payDays').value = s.payment_terms_days;

      // bank/momo info
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

    /* ---------------------------
       Register list (from DB)
    --------------------------- */
    async function reloadList(){
      document.getElementById('table-loader').innerText = 'Loading...';

      const q = document.getElementById('globalSearch').value.trim();
      const res = await apiGet(`purchase-order.php?ajax=po_list&status=${encodeURIComponent(CURRENT_FILTER)}&q=${encodeURIComponent(q)}&limit=50`);
      const rows = res.data || [];

      const tbody = document.getElementById('payables-body');
      tbody.innerHTML = '';

      rows.forEach(p => {
        const amt = (p.total_ttc === null || p.total_ttc === undefined) ? '' : Number(p.total_ttc).toLocaleString();
        const cur = p.currency || '';
        const due = p.due_date || '';
        tbody.insertAdjacentHTML('beforeend', `
          <tr>
            <td class="font-monospace fw-bold text-primary">${escapeHtml(p.po_id || '')}</td>
            <td class="small text-muted">${escapeHtml(p.created_date || '')}</td>
            <td class="fw-bold" style="font-size:0.8rem">${escapeHtml(p.supplier_name || '')}</td>
            <td class="font-mono fw-bold text-dark">${amt ? (amt + ' <span class="text-muted small">' + escapeHtml(cur) + '</span>') : '<span class="text-muted">—</span>'}</td>
            <td class="small">${escapeHtml(due)}</td>
            <td>${getStatusBadge(p.status || 'DRAFT')}</td>
            <td class="text-end">
              <button class="btn btn-sm btn-white border text-primary" onclick="reviewPO('${escapeJs(p.po_id || '')}')">
                <i class="fa-solid fa-eye"></i>
              </button>
            </td>
          </tr>
        `);
      });

      updateKPIs(rows);
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
        'DRAFT':   'status-draft',
        'PENDING': 'status-pending',
        'APPROVED':'status-active',
        'OVERDUE': 'status-late',
        'PAID':    'status-success'
      };
      const cls = map[s] || map['DRAFT'];
      return `<span class="status-pill ${cls}">${escapeHtml(s)}</span>`;
    }

    function updateKPIs(rows){
      // KPIs computed from the current list page (top 50). If you want global KPIs, create a dedicated API.
      let pending=0, approved=0, overdue=0, total=0, cur='XAF';

      rows.forEach(r => {
        const st = String(r.status || '').toUpperCase();
        if (st === 'PENDING') pending++;
        if (st === 'APPROVED') approved++;
        if (st === 'OVERDUE') overdue++;
        if (r.currency) cur = r.currency;
        if (['PENDING','APPROVED','OVERDUE'].includes(st) && r.total_ttc !== null && r.total_ttc !== undefined) {
          total += Number(r.total_ttc);
        }
      });

      document.getElementById('kpi-pending').innerText = pending;
      document.getElementById('kpi-approved').innerText = approved;
      document.getElementById('kpi-overdue').innerText = overdue;
      document.getElementById('kpi-total').innerText = total ? (total.toLocaleString() + ' ' + cur) : '0';
    }

    /* ---------------------------
       Modal: create / review
    --------------------------- */
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

      document.getElementById('btn-print').classList.add('d-none');

      const modal = new bootstrap.Modal(document.getElementById('createPoModal'));
      modal.show();
    }

    async function reviewPO(id){
      try{
        const res = await apiGet(`purchase-order.php?ajax=po_get&id=${encodeURIComponent(id)}`);
        CURRENT_PO = res.po || null;
        const items = res.items || [];

        // fill master
        document.getElementById('po_id').value = CURRENT_PO.po_id || '';
        document.getElementById('supplierSearch').value = CURRENT_PO.supplier_name || '';
        document.getElementById('supplier_id').value = CURRENT_PO.supplier_id || '';

        // If suppliers weren't loaded yet, load nowC
        if (!SUPPLIERS.length) await loadSuppliers('');

        // show panel + payment defaults
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

        // category
        if ((CURRENT_PO.expense_category || 'OPERATIONS') === 'OVERHEAD'){
          document.getElementById('cat-gen').checked = true;
          toggleFileLink(false);
        } else {
          document.getElementById('cat-ops').checked = true;
          toggleFileLink(true);
        }

        // fill items
        const tbody = document.querySelector('#itemsTable tbody');
        tbody.innerHTML = '';
        if (!items.length) addLineItem();
        items.forEach(it => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td><input type="text" class="form-control form-control-sm smart-input desc-field" value="${escapeAttr(it.description || '')}" onkeydown="handleEnter(event, this)"></td>
            <td><input type="number" class="form-control form-control-sm smart-input qty-field text-center" value="${escapeAttr(it.qty ?? 1)}" oninput="recalcTotal()" onkeydown="handleEnter(event, this)"></td>
            <td><input type="number" class="form-control form-control-sm smart-input price-field text-end" value="${escapeAttr(it.unit_price ?? 0)}" oninput="recalcTotal()" onkeydown="handleEnter(event, this)"></td>
            <td><input type="number" class="form-control form-control-sm smart-input vat-field text-center" value="${escapeAttr(it.vat_rate ?? 0)}" oninput="recalcTotal()" onkeydown="handleEnter(event, this)"></td>
            <td class="text-end font-mono fw-bold total-field">0.00</td>
            <td class="text-center"><i class="fa-solid fa-trash text-danger cursor-pointer" onclick="removeLine(this)"></i></td>
          `;
          tbody.appendChild(tr);
        });

        togglePayFields();
        recalcTotal();

        const st = String(CURRENT_PO.status || 'DRAFT').toUpperCase();
        document.getElementById('modal-mode-badge').innerText = st;
        document.getElementById('footer-status-text').innerText = `Current Status: ${st}`;

        // Print allowed if approved/paid
        if (['APPROVED','PAID'].includes(st)) document.getElementById('btn-print').classList.remove('d-none');
        else document.getElementById('btn-print').classList.add('d-none');

        const modal = new bootstrap.Modal(document.getElementById('createPoModal'));
        modal.show();
      } catch(e){
        alert('Failed to open PO: ' + e.message);
      }
    }

    /* ---------------------------
       Lines & totals
    --------------------------- */
    function addLineItem(){
      const tbody = document.querySelector('#itemsTable tbody');
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="text" class="form-control form-control-sm smart-input desc-field" placeholder="Item description" onkeydown="handleEnter(event, this)"></td>
        <td><input type="number" class="form-control form-control-sm smart-input qty-field text-center" value="1" oninput="recalcTotal()" onkeydown="handleEnter(event, this)"></td>
        <td><input type="number" class="form-control form-control-sm smart-input price-field text-end" placeholder="0" oninput="recalcTotal()" onkeydown="handleEnter(event, this)"></td>
        <td><input type="number" class="form-control form-control-sm smart-input vat-field text-center" value="19.25" oninput="recalcTotal()" onkeydown="handleEnter(event, this)"></td>
        <td class="text-end font-mono fw-bold total-field">0.00</td>
        <td class="text-center"><i class="fa-solid fa-trash text-danger cursor-pointer" onclick="removeLine(this)"></i></td>
      `;
      tbody.appendChild(tr);
      tr.querySelector('.desc-field').focus();
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
      if (idx < inputs.length - 1){
        inputs[idx + 1].focus();
        inputs[idx + 1].select();
      } else {
        addLineItem();
      }
    }

    function recalcTotal(){
      const cur = document.getElementById('currency').value || 'XAF';
      let grandHt = 0;
      let grandVat = 0;

      document.querySelectorAll('#itemsTable tbody tr').forEach(tr => {
        const qty = parseFloat(tr.querySelector('.qty-field').value) || 0;
        const price = parseFloat(tr.querySelector('.price-field').value) || 0;
        const vatRate = parseFloat(tr.querySelector('.vat-field').value) || 0;

        const lineHt = qty * price;
        const lineVat = lineHt * (vatRate / 100);
        const lineTtc = lineHt + lineVat;

        tr.querySelector('.total-field').innerText = lineTtc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        grandHt += lineHt;
        grandVat += lineVat;
      });

      const grandTtc = grandHt + grandVat;

      const airRate = parseFloat(document.getElementById('airRate').value) || 0;
      const airAmt = grandHt * (airRate / 100);
      const adv = parseFloat(document.getElementById('advPaid').value) || 0;
      const netPay = grandTtc - airAmt - adv;

      // Show dashes if zero (because we store NULL when no amount)
      const hasAmount = Math.abs(grandTtc) > 0.000001;

      document.getElementById('disp-total-ht').innerText  = hasAmount ? (grandHt.toLocaleString()  + ' ' + cur) : '—';
      document.getElementById('disp-total-vat').innerText = hasAmount ? (grandVat.toLocaleString() + ' ' + cur) : '—';
      document.getElementById('disp-total-ttc').innerText = hasAmount ? (grandTtc.toLocaleString() + ' ' + cur) : '—';
      document.getElementById('disp-net-pay').innerText   = hasAmount ? (netPay.toLocaleString()  + ' ' + cur) : '—';
    }

    /* ---------------------------
       Save to DB
       - Save Draft => status DRAFT
       - Submit => status PENDING
    --------------------------- */
    async function savePO(status){
      try{
        // Validate supplier
        const supplierName = document.getElementById('supplierSearch').value.trim();
        const supplierId = document.getElementById('supplier_id').value.trim();
        if (!supplierId || !supplierName){
          alert('Please select a supplier (from supplier_master).');
          return;
        }

        const isOps = document.getElementById('cat-ops').checked;
        const expenseCategory = isOps ? 'OPERATIONS' : 'OVERHEAD';

        const currency = document.getElementById('currency').value || 'XAF';

        // Build items
        const items = [];
        document.querySelectorAll('#itemsTable tbody tr').forEach(tr => {
          const desc = (tr.querySelector('.desc-field').value || '').trim();
          const qty  = parseFloat(tr.querySelector('.qty-field').value) || 0;
          const price= parseFloat(tr.querySelector('.price-field').value) || 0;
          const vat  = parseFloat(tr.querySelector('.vat-field').value) || 0;

          // skip empty lines
          if (!desc && Math.abs(qty) < 0.000001 && Math.abs(price) < 0.000001) return;
          items.push({ description: desc, qty, unit_price: price, vat_rate: vat });
        });

        // Totals (same logic as UI)
        let totalHt=0, totalVat=0;
        items.forEach(it => {
          const lineHt = (it.qty || 0) * (it.unit_price || 0);
          const lineVat = lineHt * ((it.vat_rate || 0) / 100);
          totalHt += lineHt;
          totalVat += lineVat;
        });
        const totalTtc = totalHt + totalVat;

        const airRate = parseFloat(document.getElementById('airRate').value) || 0;
        const advPaid = parseFloat(document.getElementById('advPaid').value) || 0;
        const airAmt = totalHt * (airRate / 100);
        const netPayable = totalTtc - airAmt - advPaid;

        // If no amount: store NULLs (your rule)
        const hasAmount = Math.abs(totalTtc) > 0.000001;

        const payload = {
          po_id: document.getElementById('po_id').value.trim(),
          supplier_id: supplierId,
          supplier_name: supplierName,
          expense_category: expenseCategory,
          file_reference: (document.getElementById('fileSearch').value || '').trim(),
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

        // refresh list
        await reloadList();

        alert(`Saved successfully. Status: ${res.status || payload.status}`);
      } catch(e){
        alert('Save failed: ' + e.message);
      }
    }

    /* ---------------------------
       Print
    --------------------------- */
    function generatePrint(){
      const poNum = document.getElementById('po_id').value || 'SLAS-PO-NEW';
      document.getElementById('p-po-num').innerText = poNum;
      document.getElementById('p-date').innerText = new Date().toLocaleDateString();

      const means = document.getElementById('payMeans').value || 'CASH';
      document.getElementById('p-means').innerText = means;

      const days = document.getElementById('payDays').value;
      document.getElementById('p-cond').innerText = days ? `${days} Days` : 'Immediate';
      document.getElementById('p-del').innerText = document.getElementById('deliveryDate').value || 'N/A';

      // Supplier
      const supplierName = document.getElementById('supplierSearch').value || '—';
      const supplierId = document.getElementById('supplier_id').value || '—';
      const s = SUPPLIERS.find(x => x.supplier_id === supplierId) || null;

      document.getElementById('p-sup-name').innerText = supplierName;
      document.getElementById('p-sup-id').innerText = supplierId;
      document.getElementById('p-sup-addr').innerText = s?.address || 'N/A';
      const cBits = [];
      if (s?.contact_email) cBits.push(s.contact_email);
      if (s?.contact_phone) cBits.push(s.contact_phone);
      document.getElementById('p-sup-contact').innerText = cBits.join(' • ') || 'N/A';

      // Lines
      const tbody = document.getElementById('p-items-body');
      tbody.innerHTML = '';
      let pTotHt=0, pTotVat=0;

      document.querySelectorAll('#itemsTable tbody tr').forEach(tr => {
        const desc = tr.querySelector('.desc-field').value || '';
        const qty  = parseFloat(tr.querySelector('.qty-field').value) || 0;
        const price= parseFloat(tr.querySelector('.price-field').value) || 0;
        const vatRate = parseFloat(tr.querySelector('.vat-field').value) || 0;

        const lineHt = qty * price;
        const lineVat = lineHt * (vatRate / 100);
        const lineTtc = lineHt + lineVat;

        if (!desc && Math.abs(lineHt) < 0.000001) return;

        pTotHt += lineHt; pTotVat += lineVat;
        tbody.insertAdjacentHTML('beforeend', `
          <tr>
            <td>${escapeHtml(desc)}</td>
            <td style="text-align:center;">${qty}</td>
            <td style="text-align:right;">${price.toLocaleString()}</td>
            <td style="text-align:right;">${lineHt.toLocaleString()}</td>
            <td style="text-align:right;">${lineVat.toLocaleString()}</td>
            <td style="text-align:right;">${lineTtc.toLocaleString()}</td>
          </tr>
        `);
      });

      const cur = document.getElementById('currency').value || 'XAF';
      const pTotTtc = pTotHt + pTotVat;
      const airRate = parseFloat(document.getElementById('airRate').value) || 0;
      const airAmt = pTotHt * (airRate / 100);
      const adv = parseFloat(document.getElementById('advPaid').value) || 0;
      const net = pTotTtc - airAmt - adv;

      document.getElementById('p-tot-ht').innerText = pTotHt.toLocaleString() + ' ' + cur;
      document.getElementById('p-tot-vat').innerText = pTotVat.toLocaleString() + ' ' + cur;
      document.getElementById('p-tot-ttc').innerText = pTotTtc.toLocaleString() + ' ' + cur;
      document.getElementById('p-air').innerText = `(${airRate}%) - ` + airAmt.toLocaleString() + ' ' + cur;
      document.getElementById('p-adv').innerText = '- ' + adv.toLocaleString() + ' ' + cur;
      document.getElementById('p-net').innerText = net.toLocaleString() + ' ' + cur;

      document.getElementById('p-terms').innerText = document.getElementById('poTerms').value || '';

      const qrData = `PO:${poNum}|NET:${net}|SUP:${supplierName}`;
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(qrData)}`;

      const img = document.getElementById('p-qr-code');
      img.onload = () => window.print();
      img.src = qrUrl;
    }

    function exportData(){
      alert('Export feature: implement server-side export (CSV/XLSX) when ready.');
    }

    /* ---------------------------
       escaping helpers
    --------------------------- */
    function escapeHtml(s){
      return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }
    function escapeAttr(s){ return escapeHtml(s).replace(/"/g,'&quot;'); }
    function escapeJs(s){ return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,'\\n').replace(/\r/g,'\\r'); }
  </script>
</body>
</html>
