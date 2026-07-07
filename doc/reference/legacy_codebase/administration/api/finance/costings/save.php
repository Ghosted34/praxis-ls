<?php
declare(strict_types=1);

require_once __DIR__ . '/../../../includes/init.php';
require_once __DIR__ . '/../../../includes/role_guard.php';
require_role(['ADMIN', 'FINANCE', 'MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');
$conn = db();

function jexit(array $p, int $code=200): void {
  http_response_code($code);
  echo json_encode($p);
  exit;
}

function uuidv4(): string {
  $data = random_bytes(16);
  $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
  $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
  return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

function normalizeDate(?string $raw): ?string {
  if ($raw === null) return null;
  $s = trim($raw);
  if ($s === '') return null;
  // expecting YYYY-MM-DD
  return $s;
}

function computeLineTotals(float $qty, float $unitCost, int $vatApplicable, float $vatRate): array {
  $ht = $qty * $unitCost;
  $vat = $vatApplicable ? ($ht * $vatRate) : 0.0;
  $ttc = $ht + $vat;
  return ['ht'=>$ht,'vat'=>$vat,'ttc'=>$ttc];
}

/**
 * Generate costing_ref safely.
 * Pattern: SLAS-COST-0000001
 */
function generateCostingRef(mysqli $conn): string {
  $prefix = 'SLAS-COST-';

  // Table lock is the simplest way to avoid race conditions
  $conn->query("LOCK TABLES costing_master WRITE");

  try {
    $sql = "
      SELECT MAX(CAST(SUBSTRING(costing_ref, ? ) AS UNSIGNED)) AS max_no
      FROM costing_master
      WHERE costing_ref LIKE CONCAT(?, '%')
    ";
    // SUBSTRING start is 1-indexed
    $start = strlen($prefix) + 1;

    $stmt = $conn->prepare($sql);
    if (!$stmt) throw new RuntimeException('Prepare failed for ref generation');
    $stmt->bind_param('is', $start, $prefix);
    $stmt->execute();
    $res = $stmt->get_result();
    $row = $res->fetch_assoc();

    $max = (int)($row['max_no'] ?? 0);
    $next = $max + 1;

    return $prefix . str_pad((string)$next, 7, '0', STR_PAD_LEFT);
  } finally {
    $conn->query("UNLOCK TABLES");
  }
}

$payload = json_decode((string)file_get_contents('php://input'), true);
if (!is_array($payload)) jexit(['ok'=>false,'error'=>'Invalid JSON'], 400);

$employeeId = (string)($_SESSION['auth']['employee_id'] ?? '');
$userId     = (int)($_SESSION['auth']['user_id'] ?? 0);
if ($employeeId === '' || $userId <= 0) jexit(['ok'=>false,'error'=>'Unauthenticated'], 401);

$costing_id = trim((string)($payload['costing_id'] ?? ''));
$opsRef     = trim((string)($payload['operations_file_reference'] ?? ''));
$costingDateRaw = (string)($payload['costing_date'] ?? '');
$remarks    = $payload['remarks'] ?? null;

$currency   = strtoupper(trim((string)($payload['currency'] ?? 'XAF')));
$rateToXaf  = (float)($payload['exchange_rate_to_xaf'] ?? 1.0);

$lines      = $payload['lines'] ?? [];
if ($opsRef === '') jexit(['ok'=>false,'error'=>'operations_file_reference is required'], 400);
if (!is_array($lines) || count($lines) === 0) jexit(['ok'=>false,'error'=>'At least one costing line is required'], 400);

try {
  // Load authoritative SSDC snapshot from operations + client
  $sqlOps = "
    SELECT
      ofm.operations_file_reference,
      ofm.client_id,
      cm.client_name,
      ofm.client_bill_to,
      ofm.service_type,
      ofm.service_territory
    FROM operations_file_master ofm
    JOIN client_master cm ON cm.client_id = ofm.client_id
    WHERE ofm.operations_file_reference = ?
    LIMIT 1
  ";
  $stOps = $conn->prepare($sqlOps);
  if (!$stOps) jexit(['ok'=>false,'error'=>'Prepare failed (ops)'], 500);
  $stOps->bind_param('s', $opsRef);
  $stOps->execute();
  $ops = $stOps->get_result()->fetch_assoc();
  if (!$ops) jexit(['ok'=>false,'error'=>'Operations file not found'], 404);

  $costing_date = normalizeDate($costingDateRaw) ?? date('Y-m-d');

  // If new costing -> create id + ref
  $isNew = ($costing_id === '');
  if ($isNew) {
    $costing_id = uuidv4();
    $costing_ref = generateCostingRef($conn);
  } else {
    // For update, load existing ref + status
    $sql = "SELECT costing_ref, status FROM costing_master WHERE costing_id = ? LIMIT 1";
    $st = $conn->prepare($sql);
    if (!$st) jexit(['ok'=>false,'error'=>'Prepare failed'], 500);
    $st->bind_param('s', $costing_id);
    $st->execute();
    $existing = $st->get_result()->fetch_assoc();
    if (!$existing) jexit(['ok'=>false,'error'=>'Costing not found'], 404);

    if ($existing['status'] === 'APPROVED_LOCKED') {
      jexit(['ok'=>false,'error'=>'This costing is locked and cannot be modified'], 409);
    }
    $costing_ref = (string)$existing['costing_ref'];
  }

  // Compute totals server-side
  $totalHT = 0.0; $totalVAT = 0.0; $totalTTC = 0.0;

  foreach ($lines as $ln) {
    $qty = (float)($ln['qty'] ?? 0);
    $unitCost = (float)($ln['unit_cost'] ?? 0);
    $vatApp = (int)($ln['vat_applicable'] ?? 1);
    $vatRate = (float)($ln['vat_rate'] ?? 0.1925);

    $t = computeLineTotals($qty, $unitCost, $vatApp, $vatRate);
    $totalHT += $t['ht'];
    $totalVAT += $t['vat'];
    $totalTTC += $t['ttc'];
  }

  $conn->begin_transaction();

  if ($isNew) {
    $sqlIns = "
      INSERT INTO costing_master
      (costing_id, costing_ref, operations_file_reference, client_id, client_name_cached, client_bill_to,
       service_type, service_territory, costing_date, remarks,
       currency, exchange_rate_to_xaf, total_ht, total_vat, total_ttc,
       status, created_by_user_id, created_at, updated_at)
      VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, NOW(), NOW())
    ";
    $stIns = $conn->prepare($sqlIns);
    if (!$stIns) throw new RuntimeException('Prepare failed (insert master)');

    $remarksStr = is_string($remarks) ? $remarks : null;

    $stIns->bind_param(
      'sssssssssssddddi',
      $costing_id,
      $costing_ref,
      $opsRef,
      $ops['client_id'],
      $ops['client_name'],
      $ops['client_bill_to'],
      $ops['service_type'],
      $ops['service_territory'],
      $costing_date,
      $remarksStr,
      $currency,
      $rateToXaf,
      $totalHT, $totalVAT, $totalTTC,
      $userId
    );
    $stIns->execute();
  } else {
    $sqlUpd = "
      UPDATE costing_master
      SET
        operations_file_reference = ?,
        client_id = ?,
        client_name_cached = ?,
        client_bill_to = ?,
        service_type = ?,
        service_territory = ?,
        costing_date = ?,
        remarks = ?,
        currency = ?,
        exchange_rate_to_xaf = ?,
        total_ht = ?,
        total_vat = ?,
        total_ttc = ?,
        updated_at = NOW()
      WHERE costing_id = ?
      LIMIT 1
    ";
    $stUpd = $conn->prepare($sqlUpd);
    if (!$stUpd) throw new RuntimeException('Prepare failed (update master)');

    $remarksStr = is_string($remarks) ? $remarks : null;

    $stUpd->bind_param(
      'ssssssssdddds',
      $opsRef,
      $ops['client_id'],
      $ops['client_name'],
      $ops['client_bill_to'],
      $ops['service_type'],
      $ops['service_territory'],
      $costing_date,
      $remarksStr,
      $currency,
      $rateToXaf,
      $totalHT, $totalVAT, $totalTTC,
      $costing_id
    );
    $stUpd->execute();
  }

  // Replace lines
  $stDel = $conn->prepare("DELETE FROM costing_lines WHERE costing_id = ?");
  if (!$stDel) throw new RuntimeException('Prepare failed (delete lines)');
  $stDel->bind_param('s', $costing_id);
  $stDel->execute();

  $sqlLine = "
    INSERT INTO costing_lines
    (costing_id, line_no, financial_dictionary_id, code,
     description_en, description_fr, description_used,
     qty, unit_cost, vat_applicable, vat_rate,
     total_ht, total_vat, total_ttc, created_at)
    VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
  ";
  $stLine = $conn->prepare($sqlLine);
  if (!$stLine) throw new RuntimeException('Prepare failed (insert line)');

  $lineNo = 0;
  foreach ($lines as $ln) {
    $lineNo++;

    $dictId = $ln['financial_dictionary_id'];
    $dictId = ($dictId === null || $dictId === '') ? null : (int)$dictId;

    $code = trim((string)($ln['code'] ?? ''));
    $descUsed = trim((string)($ln['description_used'] ?? ''));

    if ($code === '' || $descUsed === '') {
      $conn->rollback();
      jexit(['ok'=>false,'error'=>"Line {$lineNo}: code and description are required"], 400);
    }

    $qty = (float)($ln['qty'] ?? 0);
    $unitCost = (float)($ln['unit_cost'] ?? 0);
    $vatApp = (int)($ln['vat_applicable'] ?? 1);
    $vatRate = (float)($ln['vat_rate'] ?? 0.1925);

    $t = computeLineTotals($qty, $unitCost, $vatApp, $vatRate);

    // Optional: if dict selected, pull EN/FR to store snapshot
    $descEn = null; $descFr = null;
    if ($dictId !== null) {
      $stD = $conn->prepare("SELECT name_en, name_fr FROM financial_dictionary WHERE id = ? LIMIT 1");
      if ($stD) {
        $stD->bind_param('i', $dictId);
        $stD->execute();
        $d = $stD->get_result()->fetch_assoc();
        if ($d) { $descEn = $d['name_en']; $descFr = $d['name_fr']; }
      }
    }

    // bind_param needs references; handle nullable dictId carefully
    $dictIdBind = $dictId; // may be null
    $stLine->bind_param(
      'siissssddidddd',
      $costing_id,
      $lineNo,
      $dictIdBind,
      $code,
      $descEn,
      $descFr,
      $descUsed,
      $qty,
      $unitCost,
      $vatApp,
      $vatRate,
      $t['ht'], $t['vat'], $t['ttc']
    );
    $stLine->execute();
  }

  $conn->commit();

  jexit([
    'ok'=>true,
    'costing_id'=>$costing_id,
    'costing_ref'=>$costing_ref,
    'status'=>'DRAFT'
  ]);
} catch (Throwable $e) {
  if ($conn->errno === 0) { /* noop */ }
  try { $conn->rollback(); } catch (Throwable $x) {}
  jexit(['ok'=>false,'error'=>$e->getMessage()], 500);
}
