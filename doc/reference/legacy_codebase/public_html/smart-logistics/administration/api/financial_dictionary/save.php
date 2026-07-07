<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN']); // adjust if FINANCE should also save

header('Content-Type: application/json; charset=utf-8');
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

function json_in(): array {
  $raw = file_get_contents('php://input');
  if (!$raw) return [];
  $data = json_decode($raw, true);
  if (json_last_error() !== JSON_ERROR_NONE) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Invalid JSON payload']);
    exit;
  }
  return is_array($data) ? $data : [];
}

function out(bool $ok, array $extra = [], int $code = 200): void {
  http_response_code($code);
  echo json_encode(array_merge(['ok' => $ok], $extra));
  exit;
}

function require_str($v, string $field): string {
  $s = trim((string)($v ?? ''));
  if ($s === '') out(false, ['error' => "Missing required field: {$field}"], 422);
  return $s;
}

function opt_str($v): ?string {
  $s = trim((string)($v ?? ''));
  return $s === '' ? null : $s;
}

function as_enum(string $v, array $allowed, string $field): string {
  $x = strtoupper(trim($v));
  if (!in_array($x, $allowed, true)) out(false, ['error' => "Invalid {$field}"], 422);
  return $x;
}

function next_code(mysqli $conn): string {
  // expects code format "#-1234"
  $res = $conn->query("SELECT code FROM financial_dictionary WHERE code LIKE '#-%' ORDER BY id DESC LIMIT 1");
  $last = $res ? ($res->fetch_assoc()['code'] ?? null) : null;
  if (!$last) return '#-1000';

  $num = (int)preg_replace('/\D+/', '', $last); // 1234
  $num++;
  return '#-' . str_pad((string)$num, 4, '0', STR_PAD_LEFT);
}

$conn = db();
$conn->set_charset('utf8mb4');

$userId = (int)($_SESSION['auth']['user_id'] ?? 0);
if ($userId <= 0) out(false, ['error' => 'Session invalid'], 401);

$data = json_in();

$id = isset($data['id']) ? (int)$data['id'] : 0;

// required fields
$nameEn = require_str($data['name_en'] ?? null, 'name_en');
$nameFr = require_str($data['name_fr'] ?? null, 'name_fr');

$category = as_enum((string)($data['category'] ?? ''), [
  'CARRIER_CHARGES','PORT_TERMINAL_CHARGES','CUSTOMS_REGULATORY','LOGISTICS_HANDLING','INLAND_TRANSPORT','ADMIN_OVERHEADS'
], 'category');

$subcategory = require_str($data['subcategory'] ?? null, 'subcategory');

$territory = as_enum((string)($data['territory'] ?? ''), [
  'DOMESTIC_INLAND','PORT_AIRPORT_ZONE','INTERNATIONAL_IMPORT','TRANSIT_HINTERLAND'
], 'territory');

$costNature = as_enum((string)($data['cost_nature'] ?? ''), [
  'CHARGEABLE_SERVICE','DISBURSEMENT','STATUTORY_PAYMENT','INTERNAL_COST'
], 'cost_nature');

$receiptRequired = as_enum((string)($data['receipt_required'] ?? ''), [
  'ALWAYS_REQUIRED','CONDITIONALLY_REQUIRED','NOT_APPLICABLE'
], 'receipt_required');

$receiptSource = opt_str($data['receipt_source'] ?? null);
if ($receiptSource !== null) {
  $receiptSource = as_enum($receiptSource, [
    'GOVERNMENT_AUTHORITY','CARRIER_AIRLINE','PORT_TERMINAL','THIRD_PARTY_VENDOR'
  ], 'receipt_source');
}

$vatTreatment = as_enum((string)($data['vat_treatment'] ?? ''), [
  // keep in sync with DB
  'VAT_EXEMPT_STATUTORY','VAT_ZERO_RATED_EXPORT','VAT_OUT_OF_SCOPE_TRANSIT','VAT_APPLICABLE_STANDARD'
], 'vat_treatment');

$status = as_enum((string)($data['status'] ?? 'ACTIVE'), ['ACTIVE','DEPRECATED'], 'status');

// booleans
$isNegotiable = !empty($data['is_negotiable']) ? 1 : 0;
$isBillable   = !empty($data['is_billable']) ? 1 : 0;

// applicability (array -> json text)
$app = $data['service_applicability'] ?? [];
if (!is_array($app)) $app = [];
// normalize to upper snake
$appNorm = [];
foreach ($app as $v) {
  $t = strtoupper(trim((string)$v));
  if ($t !== '') $appNorm[] = $t;
}
$appNorm = array_values(array_unique($appNorm));
$appJson = json_encode($appNorm, JSON_UNESCAPED_UNICODE);

$conn->begin_transaction();

try {
  if ($id <= 0) {
    $code = next_code($conn);

    $sql = "
      INSERT INTO financial_dictionary (
        code, name_en, name_fr,
        category, subcategory, service_applicability,
        territory, cost_nature,
        is_negotiable, is_billable,
        receipt_required, receipt_source,
        vat_treatment, status,
        created_by, created_at
      ) VALUES (
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?,
        ?, ?,
        ?, ?,
        ?, NOW()
      )
    ";
    $stmt = $conn->prepare($sql);

    // param types (15 params): 12 strings and 3 integers (is_negotiable, is_billable, created_by)
    $types = "ssssssssiissssi"; // CORRECTED: 8 s, 2 i, 4 s, 1 i => total 15 chars
    $stmt->bind_param(
      $types,
      $code, $nameEn, $nameFr,
      $category, $subcategory, $appJson,
      $territory, $costNature,
      $isNegotiable, $isBillable,
      $receiptRequired, $receiptSource,
      $vatTreatment, $status,
      $userId
    );

    $stmt->execute();
    $newId = $conn->insert_id;

    $conn->commit();
    out(true, ['id' => $newId, 'code' => $code, 'mode' => 'created']);

  } else {
    // update (do NOT touch code, created_by, created_at)
    $sql = "
      UPDATE financial_dictionary SET
        name_en=?,
        name_fr=?,
        category=?,
        subcategory=?,
        service_applicability=?,
        territory=?,
        cost_nature=?,
        is_negotiable=?,
        is_billable=?,
        receipt_required=?,
        receipt_source=?,
        vat_treatment=?,
        status=?
      WHERE id=?
      LIMIT 1
    ";
    $stmt = $conn->prepare($sql);

    // param types (14 params): 11 strings + 2 ints (is_negotiable,is_billable) + final int id
    $types = "sssssssiissssi"; // CORRECTED: 7 s, 2 i, 4 s, 1 i => total 14 chars
    $stmt->bind_param(
      $types,
      $nameEn,
      $nameFr,
      $category,
      $subcategory,
      $appJson,
      $territory,
      $costNature,
      $isNegotiable,
      $isBillable,
      $receiptRequired,
      $receiptSource,
      $vatTreatment,
      $status,
      $id
    );

    $stmt->execute();

    $conn->commit();
    out(true, ['id' => $id, 'mode' => 'updated']);
  }

} catch (Throwable $e) {
  $conn->rollback();
  out(false, ['error' => 'Save failed', 'detail' => $e->getMessage()], 500);
}
