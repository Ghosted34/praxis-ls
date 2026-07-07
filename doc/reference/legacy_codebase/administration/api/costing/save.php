<?php
declare(strict_types=1);

/**
 * save.php - corrected, self-contained version
 * - Persists validator_employee_id + validator_assigned_at correctly
 * - Fixes UPDATE bind_param parameter order/count/types
 * - Transaction-safe; returns JSON
 */

ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
error_reporting(E_ALL);
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_once __DIR__ . '/_util.php';

require_role(['ADMIN','MANAGEMENT','OPERATIONS','FINANCE','SALES']);
require_method('POST');

$conn = db();
$body = read_json_body();

$costingId   = norm_str($body['costing_id'] ?? null); // if present => update
$opsRef      = must_str($body['operations_file_reference'] ?? null, 'operations_file_reference');
$costingDate = must_str($body['costing_date'] ?? null, 'costing_date'); // YYYY-MM-DD
$remarks     = norm_str($body['remarks'] ?? null) ?? '';
$currency    = strtoupper(must_str($body['currency'] ?? null, 'currency'));
$exRate      = (float)($body['exchange_rate_to_xaf'] ?? 1);

$validatorEmployeeId = norm_str($body['validator_employee_id'] ?? null);
if ($validatorEmployeeId === '') $validatorEmployeeId = null;

// optional (only used for CREATE; UPDATE uses NOW()/COALESCE logic)
$assignedAt = ($validatorEmployeeId !== null) ? date('Y-m-d H:i:s') : null;

$lines = $body['lines'] ?? [];
if (!is_array($lines)) json_out(['ok' => false, 'error' => 'lines must be an array'], 422);

$userId = get_session_user_id();

$conn->begin_transaction();

try {
  // Load Operations file + client data
  $sqlOps = "
    SELECT
      ofm.operations_file_reference,
      ofm.client_id,
      cm.client_name AS client_name,
      ofm.client_bill_to,
      ofm.service_type,
      ofm.service_territory
    FROM operations_file_master ofm
    JOIN client_master cm ON cm.client_id = ofm.client_id
    WHERE ofm.operations_file_reference = ?
    LIMIT 1
  ";
  $stOps = $conn->prepare($sqlOps);
  $stOps->bind_param('s', $opsRef);
  $stOps->execute();
  $ops = $stOps->get_result()->fetch_assoc();
  if (!$ops) {
    $conn->rollback();
    json_out(['ok' => false, 'error' => 'Operations file not found'], 404);
  }

  // Compute totals server-side
  $vatDefault = 0.1925;
  $totalHT = 0.0;
  $totalVAT = 0.0;
  $totalTTC = 0.0;

  $cleanLines = [];
  $lineNo = 1;

  foreach ($lines as $ln) {
    $code = norm_str($ln['item_code'] ?? null) ?? '';
    $desc = norm_str($ln['item_description'] ?? null) ?? '';
    $qty  = (float)($ln['qty'] ?? 0);
    $unit = (float)($ln['unit_cost'] ?? 0);
    $vatApplicable = (int)($ln['vat_applicable'] ?? 1) ? 1 : 0;
    $vatRate = isset($ln['vat_rate']) ? (float)$ln['vat_rate'] : $vatDefault;

    if ($qty <= 0) $qty = 1;

    $ht  = $qty * $unit;
    $vat = $vatApplicable ? ($ht * $vatRate) : 0.0;
    $ttc = $ht + $vat;

    $totalHT  += $ht;
    $totalVAT += $vat;
    $totalTTC += $ttc;

    $cleanLines[] = [
      'line_no' => $lineNo++,
      'item_code' => $code,
      'item_description' => $desc,
      'qty' => $qty,
      'unit_cost' => $unit,
      'vat_applicable' => $vatApplicable,
      'vat_rate' => $vatRate,
      'total_ht' => round($ht, 2),
      'total_vat' => round($vat, 2),
      'total_ttc' => round($ttc, 2),
    ];
  }

  if (!$costingId) {
    // CREATE
    $seq = next_sequence($conn, 'COSTING_REF');
    $costingRef = format_costing_ref($seq);
    $costingId = uuid36();

    $ins = "
      INSERT INTO costing_master (
        costing_id, costing_ref, operations_file_reference,
        client_id, client_name_cached, client_bill_to,
        service_type, service_territory,
        costing_date, remarks,
        currency, exchange_rate_to_xaf,
        total_ht, total_vat, total_ttc,
        status, created_by_user_id, validator_employee_id, validator_assigned_at
      ) VALUES (
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?,
        ?, ?,
        ?, ?, ?,
        'DRAFT', ?, ?, ?
      )
    ";

    $stmt = $conn->prepare($ins);
    // 11 strings, 4 doubles, 1 int, 2 strings
    $types = 'sssssssssssddddiss';
    $stmt->bind_param(
      $types,
      $costingId,
      $costingRef,
      $ops['operations_file_reference'],
      $ops['client_id'],
      $ops['client_name'],
      $ops['client_bill_to'],
      $ops['service_type'],
      $ops['service_territory'],
      $costingDate,
      $remarks,
      $currency,
      $exRate,
      $totalHT,
      $totalVAT,
      $totalTTC,
      $userId,
      $validatorEmployeeId,
      $assignedAt
    );
    $stmt->execute();

  } else {
    // UPDATE (only allow editable statuses)
    $st = $conn->prepare("SELECT status FROM costing_master WHERE costing_id = ? LIMIT 1");
    $st->bind_param('s', $costingId);
    $st->execute();
    $row = $st->get_result()->fetch_assoc();
    if (!$row) {
      $conn->rollback();
      json_out(['ok' => false, 'error' => 'Costing not found'], 404);
    }

    $status = (string)$row['status'];
    if (!in_array($status, ['DRAFT','REJECTED'], true)) {
      $conn->rollback();
      json_out(['ok' => false, 'error' => "Costing is not editable in status {$status}"], 409);
    }

    $upd = "
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
        validator_employee_id = ?,
        validator_assigned_at = CASE
          WHEN ? IS NULL OR ? = '' THEN NULL
          ELSE COALESCE(validator_assigned_at, NOW())
        END
      WHERE costing_id = ?
      LIMIT 1
    ";

    $stmt = $conn->prepare($upd);

    $validator2 = $validatorEmployeeId;
    $validator3 = $validatorEmployeeId;

    // 9 strings, 4 doubles, 4 strings = 17 params
    $types = 'sssssssssddddssss';
    $stmt->bind_param(
      $types,
      $ops['operations_file_reference'],
      $ops['client_id'],
      $ops['client_name'],
      $ops['client_bill_to'],
      $ops['service_type'],
      $ops['service_territory'],
      $costingDate,
      $remarks,
      $currency,
      $exRate,
      $totalHT,
      $totalVAT,
      $totalTTC,
      $validatorEmployeeId,
      $validator2,
      $validator3,
      $costingId
    );
    $stmt->execute();

    // delete existing lines (we'll re-insert)
    $del = $conn->prepare("DELETE FROM costing_line WHERE costing_id = ?");
    $del->bind_param('s', $costingId);
    $del->execute();
  }

  // Insert lines
  if (count($cleanLines) > 0) {
    $insL = "
      INSERT INTO costing_line (
        costing_line_id, costing_id, line_no,
        item_code, item_description,
        qty, unit_cost, vat_applicable, vat_rate,
        total_ht, total_vat, total_ttc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ";
    $stL = $conn->prepare($insL);

    foreach ($cleanLines as $ln) {
      $lineId = uuid36();
      $types = 'ssissddidddd';
      $stL->bind_param(
        $types,
        $lineId,
        $costingId,
        $ln['line_no'],
        $ln['item_code'],
        $ln['item_description'],
        $ln['qty'],
        $ln['unit_cost'],
        $ln['vat_applicable'],
        $ln['vat_rate'],
        $ln['total_ht'],
        $ln['total_vat'],
        $ln['total_ttc']
      );
      $stL->execute();
    }
  }

  $conn->commit();

  json_out([
    'ok' => true,
    'costing_id' => $costingId,
    'message' => 'Saved',
  ]);

} catch (Throwable $e) {
  if ($conn->in_transaction) $conn->rollback();
  error_log('[costing/save] ' . $e->getMessage());
  json_out(['ok' => false, 'error' => 'Save failed', 'detail' => $e->getMessage()], 500);
}














