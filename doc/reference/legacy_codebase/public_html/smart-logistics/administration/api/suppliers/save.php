<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN']);

header('Content-Type: application/json; charset=utf-8');

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

function json_in(): array {
  $raw = file_get_contents('php://input');
  $data = json_decode($raw ?: '[]', true);
  return is_array($data) ? $data : [];
}
function out(bool $ok, array $extra = [], int $code = 200): void {
  http_response_code($code);
  echo json_encode(array_merge(['ok' => $ok], $extra));
  exit;
}
function norm_str($v): ?string {
  $s = trim((string)($v ?? ''));
  return $s === '' ? null : $s;
}
function require_str($v, string $field): string {
  $s = trim((string)($v ?? ''));
  if ($s === '') out(false, ['error' => "Missing required field: {$field}"], 422);
  return $s;
}

function next_supplier_id(mysqli $conn): string {
  $prefix = 'SLAS-SS-';
  $res = $conn->query("SELECT supplier_id FROM supplier_master WHERE supplier_id LIKE 'SLAS-SS-%' ORDER BY supplier_id DESC LIMIT 1");
  $last = $res ? ($res->fetch_assoc()['supplier_id'] ?? null) : null;

  if (!$last) return $prefix . '0001401';

  $num = (int)preg_replace('/\D+/', '', $last);
  $num++;
  return $prefix . str_pad((string)$num, 7, '0', STR_PAD_LEFT);
}

$conn = db();
$conn->set_charset('utf8mb4');

$userId = (int)($_SESSION['auth']['user_id'] ?? 0);
if ($userId <= 0) out(false, ['error' => 'Session invalid'], 401);

$data = json_in();

$supplierIdRaw = trim((string)($data['supplier_id'] ?? ''));
$isNew = ($supplierIdRaw === '' || strtoupper($supplierIdRaw) === 'SLAS-SS-NEW' || strtoupper($supplierIdRaw) === 'SLAS-SS-AUTO');

// Required
$supplierName  = require_str($data['supplier_name'] ?? null, 'supplier_name');
$supplierType  = require_str($data['supplier_type'] ?? null, 'supplier_type');
$contactPerson = require_str($data['contact_person'] ?? null, 'contact_person');
$contactEmail  = require_str($data['contact_email'] ?? null, 'contact_email');
$contactPhone  = require_str($data['contact_phone'] ?? null, 'contact_phone');
$address       = require_str($data['address'] ?? null, 'address');

$paymentMethod = require_str($data['payment_method'] ?? null, 'payment_method');
$termsDays     = (int)($data['payment_terms_days'] ?? 30);

// Optional
$niu           = norm_str($data['niu'] ?? null);
$rccm          = norm_str($data['rccm'] ?? null);
$country       = norm_str($data['country'] ?? 'Cameroon') ?? 'Cameroon';

$bankName      = norm_str($data['bank_name'] ?? null);
$accountNumber = norm_str($data['account_number'] ?? null);
$accountName   = norm_str($data['account_name'] ?? null);

$momoNetwork   = norm_str($data['momo_network'] ?? null);
$momoNumber    = norm_str($data['momo_number'] ?? null);

$rating        = isset($data['rating']) ? (int)$data['rating'] : 0;
if ($rating < 0) $rating = 0;
if ($rating > 5) $rating = 5;

$evalNotes     = norm_str($data['evaluation_notes'] ?? null);

$status = strtoupper(trim((string)($data['status'] ?? 'ACTIVE')));
if (!in_array($status, ['ACTIVE', 'DEACTIVATED'], true)) $status = 'ACTIVE';

$deactReason = norm_str($data['deactivation_reason'] ?? null);

// Consistency checks
if ($paymentMethod === 'MOBILE_MONEY') {
  if (!$momoNetwork || !$momoNumber) out(false, ['error' => 'Mobile Money selected: momo_network and momo_number are required'], 422);
}
if (in_array($paymentMethod, ['BANK_TRANSFER','CHEQUE'], true)) {
  if (!$bankName || !$accountNumber) out(false, ['error' => 'Bank/Cheque selected: bank_name and account_number are required'], 422);
}

$conn->begin_transaction();

try {
  if ($isNew) {
    $supplierId = next_supplier_id($conn);

    $sql = "
      INSERT INTO supplier_master (
        supplier_id, supplier_name, supplier_type,
        contact_person, contact_email, contact_phone,
        niu, rccm, address, country,
        payment_method, payment_terms_days,
        bank_name, account_number, account_name,
        momo_network, momo_number,
        rating, evaluation_notes,
        cached_payables, status, deactivation_reason,
        created_at, created_by, updated_at
      ) VALUES (
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?,
        0.00, ?, ?,
        NOW(), ?, NOW()
      )
    ";

    $stmt = $conn->prepare($sql);
    if ($stmt === false) {
      throw new RuntimeException('Prepare failed: ' . $conn->error);
    }

    // 22 placeholders. Types (in order):
    // 1-11 => s (strings) ; 12 => i (payment_terms_days)
    // 13-17 => s ; 18 => i (rating) ; 19-21 => s ; 22 => i (created_by userId)
    $types = "sssssssssssisssssisssi"; // <-- corrected, length 22

    $stmt->bind_param(
      $types,
      $supplierId, $supplierName, $supplierType,
      $contactPerson, $contactEmail, $contactPhone,
      $niu, $rccm, $address, $country,
      $paymentMethod, $termsDays,
      $bankName, $accountNumber, $accountName,
      $momoNetwork, $momoNumber,
      $rating, $evalNotes,
      $status, $deactReason,
      $userId
    );

    $stmt->execute();
    $stmt->close();

  } else {
    $supplierId = $supplierIdRaw;

    $sql = "
      UPDATE supplier_master SET
        supplier_name=?,
        supplier_type=?,
        contact_person=?,
        contact_email=?,
        contact_phone=?,
        niu=?,
        rccm=?,
        address=?,
        country=?,
        payment_method=?,
        payment_terms_days=?,
        bank_name=?,
        account_number=?,
        account_name=?,
        momo_network=?,
        momo_number=?,
        rating=?,
        evaluation_notes=?,
        status=?,
        deactivation_reason=?,
        updated_at=NOW()
      WHERE supplier_id=?
      LIMIT 1
    ";

    $stmt = $conn->prepare($sql);
    if ($stmt === false) {
      throw new RuntimeException('Prepare failed: ' . $conn->error);
    }

    // 21 placeholders. Types (in order):
    // 1-10 => s ; 11 => i (payment_terms_days)
    // 12-16 => s ; 17 => i (rating) ; 18-21 => s (evalNotes, status, deactReason, supplier_id)
    $types = "ssssssssssisssssissss"; // <-- corrected, length 21

    $stmt->bind_param(
      $types,
      $supplierName,
      $supplierType,
      $contactPerson,
      $contactEmail,
      $contactPhone,
      $niu,
      $rccm,
      $address,
      $country,
      $paymentMethod,
      $termsDays,
      $bankName,
      $accountNumber,
      $accountName,
      $momoNetwork,
      $momoNumber,
      $rating,
      $evalNotes,
      $status,
      $deactReason,
      $supplierId
    );

    $stmt->execute();
    $stmt->close();
  }

  $conn->commit();
  out(true, ['supplier_id' => $supplierId]);

} catch (Throwable $e) {
  $conn->rollback();
  out(false, ['error' => 'Save failed', 'detail' => $e->getMessage()], 500);
}
