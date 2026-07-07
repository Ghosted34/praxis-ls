<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_once __DIR__ . '/_util.php';

require_role(['ADMIN','MANAGEMENT','SALES','OPERATIONS','FINANCE']);
require_method('POST');

header('Content-Type: application/json; charset=utf-8');

$conn = db();
$conn->set_charset('utf8mb4');
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

$body = read_json_body();

// --- Auth Context ---
$userId = (int)($_SESSION['auth']['user_id'] ?? 0);
$role   = strtoupper((string)($_SESSION['auth']['role'] ?? ''));

if ($userId <= 0) {
    json_out(['ok' => false, 'error' => 'Unauthorized: session missing user_id'], 401);
}

// --- Input Extraction ---
$simId         = (int)($body['id'] ?? 0);
$simulationRef = trim((string)($body['simulation_ref'] ?? ''));

if ($simulationRef === '') {
    json_out(['ok' => false, 'error' => 'Missing simulation_ref'], 422);
}

// If ID is 0 but we have a Ref, try to find the ID to update instead of insert (Idempotency)
if ($simId <= 0) {
    $stFind = $conn->prepare("SELECT id FROM marginpricing_simulations WHERE simulation_ref = ? LIMIT 1");
    $stFind->bind_param('s', $simulationRef);
    $stFind->execute();
    $found = $stFind->get_result()->fetch_assoc();
    $stFind->close();
    if ($found && isset($found['id'])) {
        $simId = (int)$found['id'];
    }
}

$costingId = trim((string)($body['costing_id'] ?? ''));
$opsRef    = trim((string)($body['operations_file_reference'] ?? ''));

// Optional Client overrides
$clientId   = trim((string)($body['client_id'] ?? ''));
$clientName = trim((string)($body['client_name_cached'] ?? ''));

$currency = strtoupper(trim((string)($body['currency'] ?? 'XAF')));
if ($currency === '') $currency = 'XAF';

$fx = (float)($body['exchange_rate_to_xaf'] ?? 1.0);
if ($fx <= 0) $fx = 1.0;

// Risk & Status
$riskJust = (string)($body['risk_justification'] ?? '');
$status   = strtoupper(trim((string)($body['status'] ?? 'DRAFT')));

// Validation: Only allow specific statuses via save.php (as per your rule)
$allowedStatuses = ['DRAFT', 'REVISION'];
if (!in_array($status, $allowedStatuses, true)) {
    $status = 'DRAFT';
}

$linesIn = $body['lines'] ?? [];
if (!is_array($linesIn)) {
    json_out(['ok'=>false, 'error'=>'Lines must be an array'], 400);
}

// --- Calculation Logic (Server Side Authoritative) ---
$normalizedLines = [];
$lineNo = 0;

// Header Accumulators (Simulation Currency)
$h_cost_ht  = 0.0;
$h_sell_ht  = 0.0;
$h_sell_vat = 0.0;
$h_sell_ttc = 0.0;

$riskDetected = 0;

foreach ($linesIn as $ln) {
    $lineNo++;

    $qty = (float)($ln['qty'] ?? 1.0);
    if ($qty <= 0) $qty = 1.0;

    // Unit inputs in Simulation Currency
    $costUnit = (float)($ln['cost_unit'] ?? $ln['cost'] ?? $ln['cost_xaf'] ?? $ln['cost_total_xaf'] ?? 0.0);
$sellUnit = (float)($ln['sell_unit'] ?? $ln['sell'] ?? $ln['selling_xaf'] ?? $ln['selling_total_xaf'] ?? 0.0);

    // Line Totals (Sim Currency)
    $lineCostTotal = $qty * $costUnit;
    $lineSellHT    = $qty * $sellUnit;

    // VAT Logic
    $vatApp  = (bool)($ln['vat_applicable'] ?? $ln['apply_vat'] ?? $ln['applyVat'] ?? false);
    $vatRate = (float)($ln['vat_rate'] ?? 0.1925);
    if ($vatRate < 0) $vatRate = 0.0;

    $lineVat = $vatApp ? ($lineSellHT * $vatRate) : 0.0;
    $lineTTC = $lineSellHT + $lineVat;

    // Margin (Sim Currency)
    $lineMargin = $lineSellHT - $lineCostTotal;
    $lineMarginPct = ($lineSellHT > 0) ? ($lineMargin / $lineSellHT * 100.0) : 0.0;

    if ($lineMargin < 0) $riskDetected = 1;

    // --- XAF CONVERSION ---
    $conv = ($currency === 'XAF') ? 1.0 : $fx;
    $lineCostXAF = $lineCostTotal * $conv;
    $lineSellXAF = $lineSellHT * $conv;

    // Accumulate Headers
    $h_cost_ht  += $lineCostTotal;
    $h_sell_ht  += $lineSellHT;
    $h_sell_vat += $lineVat;
    $h_sell_ttc += $lineTTC;

    $src = $ln['source_costing_line_id'] ?? null;
    $srcStr = null;
    if ($src !== null && $src !== '') {
        $srcStr = (string)$src; // bind as string to safely allow NULL
    }

    $normalizedLines[] = [
        'line_no' => $lineNo,
        'item_code' => trim((string)($ln['item_code'] ?? $ln['code'] ?? '')),
        'item_description' => trim((string)($ln['item_description'] ?? $ln['desc'] ?? '')),
        'qty' => $qty,
        'cost_unit' => $costUnit,
        'cost_total_ht' => $lineCostTotal,
        'sell_unit' => $sellUnit,
        'sell_total_ht' => $lineSellHT,
        'vat_applicable' => $vatApp ? 1 : 0,
        'vat_rate' => $vatRate,
        'sell_total_vat' => $lineVat,
        'sell_total_ttc' => $lineTTC,
        'margin_amount' => $lineMargin,
        'margin_percent' => $lineMarginPct,
        'cost_total_xaf' => $lineCostXAF,
        'selling_total_xaf' => $lineSellXAF,
        'quote_remarks' => trim((string)($ln['quote_remarks'] ?? $ln['remarks'] ?? '')),
        'print_on_quote' => (isset($ln['printOnQuote']) && $ln['printOnQuote'] === false) ? 0 : 1,
        'is_ad_hoc' => (isset($ln['isAdHoc']) && $ln['isAdHoc'] === true) ? 1 : 0,
        'source_costing_line_id' => $srcStr
    ];
}

// Header Calculations
$h_margin_amt = $h_sell_ht - $h_cost_ht;
$h_margin_pct = ($h_sell_ht > 0) ? ($h_margin_amt / $h_sell_ht * 100.0) : 0.0;

// Security Hash
$rawString = $simulationRef . number_format($h_sell_ttc, 2, '.', '') . $currency . time();
$verificationHash = hash('sha256', $rawString);

$conn->begin_transaction();

try {
    // 1. Resolve Dependencies (Costing / Client) if not provided
    $costingRef = null;

    if ($costingId !== '') {
        $stC = $conn->prepare("
            SELECT costing_ref, operations_file_reference, client_id, client_name_cached
            FROM costing_master
            WHERE costing_id = ?
            LIMIT 1
        ");
        $stC->bind_param('s', $costingId);
        $stC->execute();
        $c = $stC->get_result()->fetch_assoc();
        $stC->close();

        if ($c) {
            $costingRef = (string)($c['costing_ref'] ?? '');
            if ($opsRef === '') $opsRef = (string)($c['operations_file_reference'] ?? '');
            if ($clientId === '') $clientId = (string)($c['client_id'] ?? '');
            if ($clientName === '') $clientName = (string)($c['client_name_cached'] ?? '');
        }
    }

    // 2. Insert or Update Header
    if ($simId <= 0) {
        $sqlI = "
            INSERT INTO marginpricing_simulations (
                simulation_ref, operations_file_reference,
                costing_id, costing_ref,
                client_id, client_name_cached,
                currency, exchange_rate_to_xaf,
                total_cost_ht, total_sell_ht, total_sell_vat, total_sell_ttc,
                margin_amount, margin_percent,
                risk_flag, risk_justification,
                status, issued_by_user_id, verification_hash
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ";
        $stmt = $conn->prepare($sqlI);

        // 19 params types: 7s + 7d + i + s + s + i + s
        $stmt->bind_param(
            'sssssssdddddddissis',
            $simulationRef, $opsRef,
            $costingId, $costingRef,
            $clientId, $clientName,
            $currency, $fx,
            $h_cost_ht, $h_sell_ht, $h_sell_vat, $h_sell_ttc,
            $h_margin_amt, $h_margin_pct,
            $riskDetected, $riskJust,
            $status, $userId, $verificationHash
        );
        $stmt->execute();
        $simId = (int)$stmt->insert_id;
        $stmt->close();

        log_sim_event($conn, $simId, $simulationRef, 'CREATED', $userId, $role, $status, 'Created simulation');
    } else {
        // Verify lock status
        $chk = $conn->prepare("SELECT status FROM marginpricing_simulations WHERE id = ? LIMIT 1");
        $chk->bind_param('i', $simId);
        $chk->execute();
        $curRow = $chk->get_result()->fetch_assoc();
        $chk->close();

        $curStatus = strtoupper((string)($curRow['status'] ?? 'DRAFT'));
        if (in_array($curStatus, ['APPROVED','QUOTED'], true)) {
            throw new Exception("Simulation is locked ($curStatus). Unlock first.");
        }

        $sqlU = "
            UPDATE marginpricing_simulations SET
                operations_file_reference=?,
                costing_id=?, costing_ref=?,
                client_id=?, client_name_cached=?,
                currency=?, exchange_rate_to_xaf=?,
                total_cost_ht=?, total_sell_ht=?, total_sell_vat=?, total_sell_ttc=?,
                margin_amount=?, margin_percent=?,
                risk_flag=?, risk_justification=?,
                status=?, verification_hash=?
            WHERE id=?
        ";
        $stmt = $conn->prepare($sqlU);

        // 18 params types: 6s + 7d + i + 3s + i
        $stmt->bind_param(
            'ssssssdddddddisssi',
            $opsRef,
            $costingId, $costingRef,
            $clientId, $clientName,
            $currency, $fx,
            $h_cost_ht, $h_sell_ht, $h_sell_vat, $h_sell_ttc,
            $h_margin_amt, $h_margin_pct,
            $riskDetected, $riskJust,
            $status, $verificationHash,
            $simId
        );
        $stmt->execute();
        $stmt->close();

        // Wipe old lines to replace
        $del = $conn->prepare("DELETE FROM marginpricing_simulation_lines WHERE marginpricing_simulation_id = ?");
        $del->bind_param('i', $simId);
        $del->execute();
        $del->close();

        log_sim_event($conn, $simId, $simulationRef, 'UPDATED', $userId, $role, $status, 'Updated simulation');
    }

    // 3. Insert Lines
    $sqlL = "
        INSERT INTO marginpricing_simulation_lines (
            marginpricing_simulation_id, simulation_ref, line_no,
            item_code, item_description, qty,
            cost_unit, cost_total_ht,
            sell_unit, sell_total_ht,
            vat_applicable, vat_rate, sell_total_vat, sell_total_ttc,
            margin_amount, margin_percent,
            cost_total_xaf, selling_total_xaf,
            quote_remarks, print_on_quote, is_ad_hoc, source_costing_line_id
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ";
    $insL = $conn->prepare($sqlL);

    foreach ($normalizedLines as $nl) {
        // 22 params types:
        // i s i s s d d d d d i d d d d d d d s i i s
        $insL->bind_param(
            'isissdddddidddddddsiis',
            $simId, $simulationRef, $nl['line_no'],
            $nl['item_code'], $nl['item_description'], $nl['qty'],
            $nl['cost_unit'], $nl['cost_total_ht'],
            $nl['sell_unit'], $nl['sell_total_ht'],
            $nl['vat_applicable'], $nl['vat_rate'], $nl['sell_total_vat'], $nl['sell_total_ttc'],
            $nl['margin_amount'], $nl['margin_percent'],
            $nl['cost_total_xaf'], $nl['selling_total_xaf'],
            $nl['quote_remarks'], $nl['print_on_quote'], $nl['is_ad_hoc'], $nl['source_costing_line_id']
        );
        $insL->execute();
    }
    $insL->close();

    $conn->commit();

    json_out([
        'ok' => true,
        'id' => $simId,
        'simulation_ref' => $simulationRef,
        'verification_hash' => $verificationHash,
        'totals' => [
            'sell_ttc'   => $h_sell_ttc,
            'margin'     => $h_margin_amt,
            'margin_xaf' => ($h_margin_amt * (($currency === 'XAF') ? 1.0 : $fx))
        ]
    ], 200);

} catch (Throwable $e) {
    $conn->rollback();
    json_out([
        'ok' => false,
        'error' => $e->getMessage()
    ], 500);
}

function log_sim_event(mysqli $conn, int $simId, string $ref, string $event, int $uid, string $role, string $status, string $msg): void {
    $st = $conn->prepare("
        INSERT INTO marginpricing_simulation_events
            (marginpricing_simulation_id, simulation_ref, event, actor_user_id, actor_role, to_status, message)
        VALUES (?,?,?,?,?,?,?)
    ");
    $st->bind_param('ississs', $simId, $ref, $event, $uid, $role, $status, $msg);
    $st->execute();
    $st->close();
}
