<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_once __DIR__ . '/_util.php';

require_role(['ADMIN','MANAGEMENT','FINANCE','OPERATIONS','SALES']);
require_method('POST');
header('Content-Type: application/json; charset=utf-8');

$conn = db();
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

$body = read_json_body();

/**
 * Accept BOTH:
 * - simulation_id (int)  OR
 * - simulation_ref (string)
 */
$simId  = (int)($body['simulation_id'] ?? $body['id'] ?? 0);
$simRef = trim((string)($body['simulation_ref'] ?? $body['simulationRef'] ?? ''));

/**
 * Frontend sends costing_id (UUID/CHAR(36))
 */
$costingId = trim((string)($body['costing_id'] ?? ''));

// --- Tables (define BEFORE any use) ---
$T_SIM   = 'marginpricing_simulations';
$T_LINE  = 'marginpricing_simulation_lines';
$T_EVENT = 'marginpricing_simulation_events';

$userId = (int)get_session_user_id();
$role   = (string)get_session_role();

// treat placeholder refs as "no real ref"
$simRefUpper = strtoupper($simRef);
$isPlaceholderRef = ($simRefUpper === 'NEW-SIM' || $simRefUpper === 'NEW' || $simRefUpper === '');

$conn->begin_transaction();

try {
  /**
   * 1) Resolve simulation
   */
  if ($simId <= 0) {
    $st = $conn->prepare("
      SELECT id, simulation_ref, status
      FROM {$T_SIM}
      WHERE simulation_ref = ?
      LIMIT 1
    ");
    $st->bind_param('s', $simRef);
  } else {
    $st = $conn->prepare("
      SELECT id, simulation_ref, status
      FROM {$T_SIM}
      WHERE id = ?
      LIMIT 1
    ");
    $st->bind_param('i', $simId);
  }

  $st->execute();
  $sim = $st->get_result()->fetch_assoc();
  $st->close();

  if (!$sim) throw new RuntimeException('Simulation not found');

  $simId     = (int)$sim['id'];
  $simRefDb  = (string)$sim['simulation_ref']; // variable for bind_param
  $curStatus = strtoupper((string)$sim['status']);

  $allowed = ['DRAFT','REVISION','REJECTED'];
  if (!in_array($curStatus, $allowed, true)) {
    throw new RuntimeException("Cannot link costing when simulation status is {$curStatus}");
  }

  /**
   * 2) Load costing header (must be APPROVED_LOCKED)
   */
  $qc = $conn->prepare("
    SELECT
      costing_id,
      costing_ref,
      operations_file_reference,
      client_id,
      client_name_cached,
      client_bill_to,
      service_type,
      service_territory,
      total_ht,
      total_vat,
      total_ttc,
      currency,
      exchange_rate_to_xaf,
      status
    FROM costing_master
    WHERE costing_id = ?
    LIMIT 1
  ");
  $qc->bind_param('s', $costingId);
  $qc->execute();
  $cm = $qc->get_result()->fetch_assoc();
  $qc->close();

  if (!$cm) throw new RuntimeException('Invalid costing_id');

  $costStatus = strtoupper((string)$cm['status']);
  if ($costStatus !== 'APPROVED_LOCKED') {
    throw new RuntimeException("Costing must be APPROVED_LOCKED (now {$costStatus})");
  }

  /**
   * 3) Load costing lines
   * IMPORTANT: include total_ttc because pricing is TTC-first in your system.
   */
  $ql = $conn->prepare("
    SELECT
      line_no,
      item_code,
      item_description,
      qty,
      unit_cost,
      vat_applicable,
      vat_rate,
      total_ht,
      total_vat,
      total_ttc
    FROM costing_line
    WHERE costing_id = ?
    ORDER BY line_no ASC
  ");
  $ql->bind_param('s', $costingId);
  $ql->execute();
  $rs = $ql->get_result();

  $lines = [];
  while ($r = $rs->fetch_assoc()) $lines[] = $r;
  $ql->close();

  if (!$lines) throw new RuntimeException('Selected costing has no line items');

  /**
   * Exchange rate and currency normalization
   * If costing currency is not XAF, we convert imported amounts into XAF using exchange_rate_to_xaf.
   */
  $currency = (string)($cm['currency'] ?? 'XAF');
  $fx       = (float)($cm['exchange_rate_to_xaf'] ?? 1.0);
  if ($fx <= 0) $fx = 1.0;

  $isXaf = (strtoupper($currency) === 'XAF');
  $toXaf = function(float $amount) use ($isXaf, $fx): float {
    return $isXaf ? $amount : ($amount * $fx);
  };

  /**
   * 4) Update simulation header snapshot fields
   */
  $upd = $conn->prepare("
    UPDATE {$T_SIM}
    SET
      costing_id = ?,
      costing_ref = ?,
      operations_file_reference = ?,
      client_id = ?,
      client_name_cached = ?,
      client_bill_to = ?,
      service_type = ?,
      service_territory = ?,
      costing_total_ht = ?,
      costing_total_vat = ?,
      costing_total_ttc = ?,
      currency = ?,
      exchange_rate_to_xaf = ?,
      updated_at = NOW()
    WHERE id = ?
    LIMIT 1
  ");

  $costingRef  = (string)$cm['costing_ref'];
  $opsRef      = (string)($cm['operations_file_reference'] ?? '');
  $clientId    = (string)($cm['client_id'] ?? '');
  $clientName  = (string)($cm['client_name_cached'] ?? '');
  $billTo      = (string)($cm['client_bill_to'] ?? '');
  $serviceType = (string)($cm['service_type'] ?? '');
  $territory   = (string)($cm['service_territory'] ?? '');

  // Store header totals as-is (your schema may already expect totals in costing currency);
  // if you want them in XAF always, change to $toXaf(...) as needed.
  $tHt  = (float)($cm['total_ht'] ?? 0);
  $tVat = (float)($cm['total_vat'] ?? 0);
  $tTtc = (float)($cm['total_ttc'] ?? 0);

  $upd->bind_param(
    'ssssssssdddsdi',
    $costingId,
    $costingRef,
    $opsRef,
    $clientId,
    $clientName,
    $billTo,
    $serviceType,
    $territory,
    $tHt,
    $tVat,
    $tTtc,
    $currency,
    $fx,
    $simId
  );
  $upd->execute();
  $upd->close();

  /**
   * 5) Replace simulation lines with costing lines
   */
  $del = $conn->prepare("DELETE FROM {$T_LINE} WHERE marginpricing_simulation_id = ?");
  $del->bind_param('i', $simId);
  $del->execute();
  $del->close();

  /**
   * NOTE:
   * This INSERT assumes your marginpricing_simulation_lines table has these columns:
   * qty, cost_unit_xaf, cost_total_xaf, selling_total_xaf, vat_applicable, vat_rate,
   * quote_remarks, print_on_quote, is_ad_hoc, created_at
   */
  $ins = $conn->prepare("
    INSERT INTO {$T_LINE}
      (
        marginpricing_simulation_id,
        line_no,
        item_code,
        item_description,
        qty,
        cost_unit_xaf,
        cost_total_xaf,
        selling_total_xaf,
        vat_applicable,
        vat_rate,
        quote_remarks,
        print_on_quote,
        is_ad_hoc,
        created_at
      )
    VALUES
      (?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())
  ");

  $markup = 1.0;

  foreach ($lines as $ln) {
    $lineNo = (int)($ln['line_no'] ?? 0);
    $code   = (string)($ln['item_code'] ?? '');
    $desc   = (string)($ln['item_description'] ?? '');

    $qty      = (float)($ln['qty'] ?? 0);
    $unitCost = (float)($ln['unit_cost'] ?? 0);

    /**
     * PATCH: HT-first import (Value Added Basis)
     * - Always use total_ht for the Cost Column
     */
    $rawTotal = (float)($ln['total_ht'] ?? 0);
    // Fallback only if HT is missing/zero (e.g. old data)
    if ($rawTotal <= 0) $rawTotal = (float)($ln['total_ttc'] ?? 0);
    if ($rawTotal <= 0) $rawTotal = ($qty > 0 ? ($qty * $unitCost) : 0.0);

    // Convert to XAF if needed
    $costTotalXaf = $toXaf($rawTotal);

    // Unit cost in XAF (derived from total)
    $costUnitXaf = ($qty > 0) ? (float)($costTotalXaf / $qty) : $toXaf($unitCost);

    // Selling total in XAF
    $sellTotalXaf = (float)ceil($costTotalXaf * $markup);

    $vatApplicable = (int)($ln['vat_applicable'] ?? 1);
    $vatRate       = (float)($ln['vat_rate'] ?? 0.1925);

    $remarks      = '';
    $printOnQuote = 1;
    $isAdHoc      = 0;

    $ins->bind_param(
      'iissddddidsii',
      $simId,
      $lineNo,
      $code,
      $desc,
      $qty,
      $costUnitXaf,
      $costTotalXaf,
      $sellTotalXaf,
      $vatApplicable,
      $vatRate,
      $remarks,
      $printOnQuote,
      $isAdHoc
    );
    $ins->execute();
  }
  $ins->close();

  /**
   * 6) Event log
   */
  $evt = $conn->prepare("
    INSERT INTO {$T_EVENT}
      (marginpricing_simulation_id, simulation_ref, event,
       actor_user_id, actor_role, from_status, to_status, message, created_at)
    VALUES
      (?,?,?,?,?,?,?,?,NOW())
  ");

  $event = 'LINKED_COSTING';
  $msg   = "Linked costing {$costingRef} ({$costingId})";
  $fromStatus = $curStatus;
  $toStatus   = $curStatus;

  $evt->bind_param(
    'ississss',
    $simId,
    $simRefDb,
    $event,
    $userId,
    $role,
    $fromStatus,
    $toStatus,
    $msg
  );
  $evt->execute();
  $evt->close();

  $conn->commit();
  
  json_out([ 
    'ok' => true,
    'simulation_id' => $simId,
    'simulation_ref' => $simRefDb,
    'costing' => [
      'costing_id' => $costingId,
      'costing_ref' => $costingRef,
      'operations_file_reference' => $opsRef,
      'client_name' => $clientName,
      'service_type' => $serviceType
    ],
    'lines_imported' => count($lines)
  ]);

} catch (Throwable $e) {
  $conn->rollback();
  json_out(['ok' => false, 'error' => $e->getMessage()], 400);
}
