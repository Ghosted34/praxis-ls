<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_once __DIR__ . '/_util.php';

require_role(['ADMIN','MANAGEMENT','SALES']);
require_method('POST');
header('Content-Type: application/json; charset=utf-8');

$conn = db();
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

$body = read_json_body();

$userId = (int)($_SESSION['auth']['user_id'] ?? 0);
$role   = strtoupper((string)($_SESSION['auth']['role'] ?? ''));

// Accept either id or simulation_ref (frontend sends simulation_ref)
$simId  = (int)($body['id'] ?? 0);
$simRef = trim((string)($body['simulation_ref'] ?? ''));

if ($simId <= 0 && $simRef === '') {
  json_out(['ok'=>false,'error'=>'id or simulation_ref required'], 400);
}

// Payload from frontend (generatePDF -> quotePayload)
$qValidity   = trim((string)($body['validity'] ?? $body['q_validity'] ?? ''));
$qTerms      = trim((string)($body['terms'] ?? $body['q_terms'] ?? ''));
$qCurrency   = strtoupper(trim((string)($body['currency'] ?? $body['q_currency'] ?? 'XAF')));
$qFxRate     = (float)($body['fx_rate'] ?? $body['q_fx_rate'] ?? 1.0);
$qBank       = (string)($body['bank_details'] ?? $body['q_bank_details'] ?? '');
$qHeaderNote = (string)($body['header_note'] ?? $body['q_header_note'] ?? '');

$totalHT  = (float)($body['total_ht'] ?? 0);
$totalVAT = (float)($body['total_vat'] ?? 0);
$totalTTC = (float)($body['total_ttc'] ?? 0);

if ($qCurrency === '') $qCurrency = 'XAF';
if ($qFxRate <= 0) $qFxRate = 1.0;

$conn->begin_transaction();

try {
  // Resolve to both id + simulation_ref
  if ($simId <= 0) {
    $st = $conn->prepare("SELECT id FROM marginpricing_simulations WHERE simulation_ref=? LIMIT 1");
    $st->bind_param('s', $simRef);
    $st->execute();
    $row = $st->get_result()->fetch_assoc();
    $st->close();
    if (!$row) throw new RuntimeException('Simulation not found');
    $simId = (int)$row['id'];
  } else {
    $st = $conn->prepare("SELECT simulation_ref FROM marginpricing_simulations WHERE id=? LIMIT 1");
    $st->bind_param('i', $simId);
    $st->execute();
    $row = $st->get_result()->fetch_assoc();
    $st->close();
    if (!$row) throw new RuntimeException('Simulation not found');
    $simRef = (string)$row['simulation_ref'];
  }

  // Lock the row and fetch required fields
  $st = $conn->prepare("
    SELECT
      id,
      simulation_ref,
      status,
      quote_ref,
      operations_file_reference,
      margin_amount,
      total_sell_ht,
      total_sell_vat,
      total_sell_ttc
    FROM marginpricing_simulations
    WHERE id = ?
    LIMIT 1
    FOR UPDATE
  ");
  // MySQL requires LIMIT before FOR UPDATE
  // If your MySQL complains, swap to:  ... WHERE id=? LIMIT 1 FOR UPDATE
  // But most MySQL builds accept LIMIT 1 FOR UPDATE only.
  $st->close(); // close this invalid prepared statement if any older MySQL breaks it

  $st = $conn->prepare("
    SELECT
      id,
      simulation_ref,
      status,
      quote_ref,
      operations_file_reference,
      margin_amount,
      total_sell_ht,
      total_sell_vat,
      total_sell_ttc
    FROM marginpricing_simulations
    WHERE id = ?
    LIMIT 1 FOR UPDATE
  ");
  $st->bind_param('i', $simId);
  $st->execute();
  $sim = $st->get_result()->fetch_assoc();
  $st->close();

  if (!$sim) throw new RuntimeException('Simulation not found');

  $curStatus = strtoupper((string)$sim['status']);

  // Only APPROVED can be quoted (optionally allow re-quote from QUOTED)
  if (!in_array($curStatus, ['APPROVED','QUOTED'], true)) {
    throw new RuntimeException("Cannot generate quotation. Current status is {$curStatus}. Must be APPROVED.");
  }

  // Ensure at least 1 printable line exists
  // IMPORTANT: your schema has sell_total_ht, NOT selling_xaf
  $stCnt = $conn->prepare("
    SELECT COUNT(*) AS c
    FROM marginpricing_simulation_lines
    WHERE simulation_ref = ?
      AND print_on_quote = 1
      AND sell_total_ht > 0
  ");
  $stCnt->bind_param('s', $simRef);
  $stCnt->execute();
  $cntRow = $stCnt->get_result()->fetch_assoc();
  $stCnt->close();

  if ((int)($cntRow['c'] ?? 0) <= 0) {
    throw new RuntimeException('No printable quotation lines found (print_on_quote=1 and sell_total_ht>0).');
  }

  // If frontend totals are missing/zero, fallback to stored totals
  if ($totalHT <= 0)  $totalHT  = (float)($sim['total_sell_ht'] ?? 0);
  if ($totalVAT < 0)  $totalVAT = (float)($sim['total_sell_vat'] ?? 0);
  if ($totalTTC <= 0) $totalTTC = (float)($sim['total_sell_ttc'] ?? 0);

  if ($totalTTC <= 0) {
    throw new RuntimeException('Quotation totals are zero. Save the simulation first so totals are computed.');
  }

  // Generate or reuse quote_ref (no extra tables)
  $quoteRef = trim((string)($sim['quote_ref'] ?? ''));
  if ($quoteRef === '') {
    $quoteRef = 'SLAS-QU-' . date('Ymd') . '-' . str_pad((string)$simId, 6, '0', STR_PAD_LEFT);

    // defensive uniqueness check
    $stChk = $conn->prepare("SELECT 1 FROM marginpricing_simulations WHERE quote_ref = ? LIMIT 1");
    $stChk->bind_param('s', $quoteRef);
    $stChk->execute();
    $exists = $stChk->get_result()->fetch_assoc();
    $stChk->close();
    if ($exists) $quoteRef .= '-' . substr(bin2hex(random_bytes(2)), 0, 4);
  }

  // Update simulation to QUOTED + store quote setup snapshot
  $stU = $conn->prepare("
    UPDATE marginpricing_simulations
    SET
      status = 'QUOTED',
      quote_ref = ?,
      quoted_by_user_id = ?,
      quoted_at = NOW(),
      q_validity = ?,
      q_terms = ?,
      q_currency = ?,
      q_fx_rate = ?,
      q_bank_details = ?,
      q_header_note = ?
    WHERE id = ?
    LIMIT 1
  ");

  // types: s i s s s d s s i  => "sisssdssi"
  $stU->bind_param(
    'sisssdssi',
    $quoteRef,
    $userId,
    $qValidity,
    $qTerms,
    $qCurrency,
    $qFxRate,
    $qBank,
    $qHeaderNote,
    $simId
  );
  $stU->execute();
  $stU->close();

  // Also update operations_file_master linkage fields you listed
  $opsRef = trim((string)($sim['operations_file_reference'] ?? ''));
  if ($opsRef !== '') {
    $marginAmt = (float)($sim['margin_amount'] ?? 0);
    $finalTTC  = (float)$totalTTC;

    $ops = $conn->prepare("
      UPDATE operations_file_master
      SET
        margin_simulator_id = ?,
        margin_simulator_amount = ?,
        quote_id = ?,
        quote_amount = ?
      WHERE operations_file_reference = ?
      LIMIT 1
    ");
    // simRef(string), marginAmt(double), quoteRef(string), finalTTC(double), opsRef(string)
    $ops->bind_param('sdsds', $simRef, $marginAmt, $quoteRef, $finalTTC, $opsRef);
    $ops->execute();
    $ops->close();
  }

  // Audit event
  $evt = $conn->prepare("
    INSERT INTO marginpricing_simulation_events
      (marginpricing_simulation_id, simulation_ref, event, actor_user_id, actor_role, from_status, to_status, message, payload_json)
    VALUES
      (?,?,?,?,?,?,?,?,?)
  ");
  $event = 'QUOTED';
  $msg   = 'Quotation generated';
  $from  = $curStatus;
  $to    = 'QUOTED';
  $payload = json_encode([
    'quote_ref'  => $quoteRef,
    'q_currency' => $qCurrency,
    'q_fx_rate'  => $qFxRate,
    'total_ht'   => $totalHT,
    'total_vat'  => $totalVAT,
    'total_ttc'  => $totalTTC,
  ], JSON_UNESCAPED_UNICODE);

  $evt->bind_param('ississsss', $simId, $simRef, $event, $userId, $role, $from, $to, $msg, $payload);
  $evt->execute();
  $evt->close();

  // Return updated simulation header
  $stR = $conn->prepare("SELECT * FROM marginpricing_simulations WHERE id=? LIMIT 1");
  $stR->bind_param('i', $simId);
  $stR->execute();
  $sim2 = $stR->get_result()->fetch_assoc();
  $stR->close();

  $conn->commit();

  json_out([
    'ok' => true,
    'quotation' => [
      'quotation_ref' => $quoteRef,
      'amount_ttc'    => $totalTTC,
      'generated_at'  => $sim2['quoted_at'] ?? date('Y-m-d H:i:s'),
    ],
    'simulation' => $sim2,
  ]);
} catch (Throwable $e) {
  $conn->rollback();
  json_out(['ok'=>false,'error'=>$e->getMessage()], 400);
}
