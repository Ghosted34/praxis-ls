<?php
/**
 * ============================================================================
 * SMART LS - PROFORMA INVOICE API v5.0 (FINAL - Smart Receivables Integration)
 * ============================================================================
 * NEW RULES:
 * 1. Smart Receivables reads ONLY ISSUED_LOCKED PRIs (not PAID)
 * 2. PRI payments are FULL payment only (no partial)
 * 3. Once PAID → update OFM aggregates and remove from Smart Receivables
 * 4. Block new PRI creation if previous PRI is ISSUED_LOCKED (unpaid)
 * 5. OFM aggregates ALL paid PRI amounts (cumulative)
 *
 * ============================================================================
 * PHASE 2 PATCH (PRODUCTION HARDENING)
 * ============================================================================
 * - Add action: get_print_payload (frontend compatibility)
 * - Ensure client_id is persisted (resolve from client_name if missing)
 * - Ensure update header can update client_id as well (previously never updated)
 * - Keep all existing rules; no removals
 * ============================================================================
 */

declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

header('Content-Type: application/json; charset=utf-8');

// ============================================================================
// AUTHENTICATION & ROLE CHECK
// ============================================================================

if (!isset($_SESSION['auth']['user_id'])) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Unauthorized']);
    exit;
}

$userId   = (int)($_SESSION['auth']['user_id'] ?? 0);
$userRole = strtoupper((string)($_SESSION['auth']['role'] ?? 'GUEST'));
$action   = (string)($_GET['action'] ?? $_POST['action'] ?? '');

$conn = db();

// ============================================================================
// ROUTING
// ============================================================================

try {
    switch ($action) {
        case 'get_clients':
            echo json_encode(['success' => true, 'clients' => []]);
            break;

        case 'get_quotations_dropdown':
            getQuotationsDropdown($conn);
            break;

        case 'get_quotation_prefill':
            $quoteRef = $_GET['quote_ref'] ?? null;
            getQuotationPrefill($conn, $quoteRef);
            break;

        case 'search_dictionary':
            $query = $_GET['q'] ?? '';
            searchDictionary($conn, (string)$query);
            break;

        case 'save_proforma':
            $input = json_decode((string)file_get_contents('php://input'), true);
            saveProforma($conn, is_array($input) ? $input : [], $userId, $userRole);
            break;

        case 'get_all_proformas':
            getAllProformas($conn);
            break;

        case 'get_proforma_detail':
            $invoiceId = (int)($_GET['invoice_id'] ?? 0);
            getProformaDetail($conn, $invoiceId);
            break;

        case 'get_kpis':
            getKPIs($conn);
            break;

        case 'submit_for_approval':
            $input = json_decode((string)file_get_contents('php://input'), true);
            $invoiceId = (int)($input['invoice_id'] ?? 0);
            submitForApproval($conn, $invoiceId, $userId);
            break;
            
        case 'request_unlock':
    $input = json_decode(file_get_contents('php://input'), true);
    $id = (int)($input['invoice_id'] ?? 0);
    $reason = $conn->real_escape_string($input['reason'] ?? '');

    // Instead of changing the ENUM status, we store the reason.
    // The presence of an 'unlock_reason' will tell our logic the invoice is "pending unlock".
    $sql = "UPDATE proforma_invoice 
            SET unlock_reason = '$reason' 
            WHERE invoice_id = $id";
    
    if ($conn->query($sql)) {
        echo json_encode(['success' => true]);
    } else {
        echo json_encode(['success' => false, 'error' => $conn->error]);
    }
    break;

        case 'approve_unlock':
    // 1. Read JSON input (matches your APP.call method)
    $input = json_decode(file_get_contents('php://input'), true);
    $id = (int)($input['invoice_id'] ?? 0);
    
    if ($userRole !== 'MANAGEMENT' && $userRole !== 'ADMIN') {
        echo json_encode(['success' => false, 'error' => 'Unauthorized']);
        exit;
    }

    // 2. Execute the reset
    $sql = "UPDATE proforma_invoice 
            SET status = 'DRAFT', 
                approval_status = NULL, 
                unlock_reason = NULL, 
                rejection_reason = NULL 
            WHERE invoice_id = $id";
            
    if ($conn->query($sql)) {
        echo json_encode(['success' => true]);
    } else {
        echo json_encode(['success' => false, 'error' => $conn->error]);
    }
    break;

        case 'approve_proforma':
            $input = json_decode((string)file_get_contents('php://input'), true);
            $invoiceId = (int)($input['invoice_id'] ?? 0);
            approveProforma($conn, $invoiceId, $userId, $userRole);
            break;

        case 'reject_proforma':
            $input = json_decode((string)file_get_contents('php://input'), true);
            $invoiceId = (int)($input['invoice_id'] ?? 0);
            $reason = (string)($input['reason'] ?? '');
            rejectProforma($conn, $invoiceId, $userId, $userRole, $reason);
            break;

        case 'issue_proforma':
            $input = json_decode((string)file_get_contents('php://input'), true);
            $invoiceId = (int)($input['invoice_id'] ?? 0);
            issueProforma($conn, $invoiceId, $userId);
            break;

        case 'cancel_proforma':
            $input = json_decode((string)file_get_contents('php://input'), true);
            $invoiceId = (int)($input['invoice_id'] ?? 0);
            cancelProforma($conn, $invoiceId, $userId, $userRole);
            break;

        // ========================================================================
        // PRINT PAYLOAD (PHASE 2)
        // ========================================================================

        /**
         * Frontend calls:
         *   proforma-api.php?action=get_print_payload&invoice_id=123
         * or via api.call('get_print_payload', { invoice_id })
         *
         * We proxy to proforma-print-api.php via output buffering to avoid code
         * duplication and to keep the print contract centralized.
         */
        case 'get_print_payload':
            $invoiceId = (int)($_GET['invoice_id'] ?? 0);
            getPrintPayloadProxy($invoiceId);
            break;

        // ========================================================================
        // PAYMENT TRACKING FOR SMART RECEIVABLES INTEGRATION
        // ========================================================================

        case 'record_payment':
            $input = json_decode((string)file_get_contents('php://input'), true);
            recordAdvancePayment($conn, is_array($input) ? $input : [], $userId, $userRole);
            break;

        case 'get_payment_history':
            $invoiceId = (int)($_GET['invoice_id'] ?? 0);
            getPaymentHistory($conn, $invoiceId);
            break;

        case 'get_payment_summary':
            $invoiceId = (int)($_GET['invoice_id'] ?? 0);
            getPaymentSummary($conn, $invoiceId);
            break;

        case 'void_payment':
            $input = json_decode((string)file_get_contents('php://input'), true);
            $paymentId = (int)($input['payment_id'] ?? 0);
            voidPayment($conn, $paymentId, $userId, $userRole);
            break;

        default:
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Invalid action']);
            break;
    }
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error'   => 'Server error: ' . $e->getMessage()
    ]);
}

/**
 * ============================================================================
 * PHASE 2: PRINT PAYLOAD PROXY
 * ============================================================================
 * This avoids duplication and prevents “Invalid action” for the frontend.
 * It also keeps your print API independent and still callable directly.
 */
function getPrintPayloadProxy(int $invoiceId): void {
    if ($invoiceId <= 0) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Invalid invoice ID']);
        return;
    }

    // Ensure the expected parameter exists for the print api
    $_GET['invoice_id'] = $invoiceId;

    $printApiPath = __DIR__ . '/proforma-print-api.php';
    if (!is_file($printApiPath)) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'Print API not found']);
        return;
    }

    // Capture output from the print API
    ob_start();
    try {
        require $printApiPath;
    } catch (Throwable $t) {
        ob_end_clean();
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'Print API error: ' . $t->getMessage()]);
        return;
    }
    $out = (string)ob_get_clean();

    // Attempt to ensure we always return JSON
    $decoded = json_decode($out, true);
    if (!is_array($decoded)) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'Print API returned invalid JSON']);
        return;
    }

    echo json_encode($decoded);
}

// ============================================================================
// GET QUOTATIONS FOR DROPDOWN (COLLATION-FIXED)
// ============================================================================

function getQuotationsDropdown(mysqli $conn): void {
    /**
     * NEW BLOCKING RULE:
     * - Block if ANY ISSUED_LOCKED PRI exists (awaiting payment)
     * - Allow only after previous PRI is PAID
     */

    $sql = "
        SELECT 
            mps.id,
            mps.simulation_ref,
            mps.client_name_cached,
            mps.operations_file_reference,
            mps.q_bank_details,
            mps.q_terms,
            mps.status,
            mps.total_sell_ttc,
            mps.created_at,

            (SELECT COUNT(*) 
             FROM proforma_invoice pi 
             WHERE (pi.linked_quote_ref COLLATE utf8mb4_general_ci)
                 = (mps.simulation_ref   COLLATE utf8mb4_general_ci)
             AND pi.invoice_type = 'PROFORMA'
             AND pi.status = 'ISSUED_LOCKED'
            ) as has_issued_unpaid,

            (SELECT GROUP_CONCAT(
                CONCAT(invoice_no, ' (', status, 
                       CASE 
                           WHEN status = 'PAID' THEN ' - Paid'
                           WHEN status = 'ISSUED_LOCKED' THEN ' - Awaiting Payment'
                           ELSE ''
                       END,
                       ')')
                SEPARATOR ', '
             )
             FROM proforma_invoice pi 
             WHERE (pi.linked_quote_ref COLLATE utf8mb4_general_ci)
                 = (mps.simulation_ref   COLLATE utf8mb4_general_ci)
             AND pi.invoice_type = 'PROFORMA'
             AND pi.status != 'CANCELLED'
            ) as existing_proformas

        FROM marginpricing_simulations mps
        WHERE mps.status IN ('APPROVED', 'QUOTED')
        ORDER BY mps.created_at DESC
        LIMIT 100
    ";

    $result = $conn->query($sql);
    $quotations = [];

    while ($row = $result->fetch_assoc()) {
        $hasIssuedUnpaid = ((int)$row['has_issued_unpaid']) > 0;

        $quotations[] = [
            'id' => (int)$row['id'],
            'simulation_ref' => $row['simulation_ref'],
            'client_name' => $row['client_name_cached'],
            'file_reference' => $row['operations_file_reference'],
            'bank_details' => $row['q_bank_details'],
            'payment_terms' => $row['q_terms'],
            'total_ttc' => (float)$row['total_sell_ttc'],
            'has_unpaid_draft' => $hasIssuedUnpaid,
            'existing_proformas' => $row['existing_proformas'],
            'is_blocked' => $hasIssuedUnpaid,
            'display_text' => $row['simulation_ref'] . ' - ' . $row['client_name_cached'] .
                ($hasIssuedUnpaid ? ' ⚠️ Payment pending' : ''),
            'warning_message' => $hasIssuedUnpaid
                ? 'This quotation has an issued proforma awaiting payment. Please complete payment before creating a new advance request.'
                : null
        ];
    }

    echo json_encode([
        'success' => true,
        'quotations' => $quotations
    ]);
}

// ============================================================================
// GET QUOTATION PREFILL DATA (UNCHANGED)
// ============================================================================

function getQuotationPrefill(mysqli $conn, ?string $quoteRef): void {
    if (!$quoteRef) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Quote reference required']);
        return;
    }

    $headerSql = "
        SELECT 
            id,
            simulation_ref,
            client_name_cached,
            operations_file_reference,
            q_bank_details,
            q_terms,
            currency,
            total_sell_ht,
            total_sell_vat,
            total_sell_ttc
        FROM marginpricing_simulations
        WHERE simulation_ref = ?
        LIMIT 1
    ";

    $stmt = $conn->prepare($headerSql);
    $stmt->bind_param('s', $quoteRef);
    $stmt->execute();
    $header = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!$header) {
        http_response_code(404);
        echo json_encode(['success' => false, 'error' => 'Quotation not found']);
        return;
    }

    $linesSql = "
        SELECT 
            id,
            line_no,
            item_code,
            item_description,
            qty,
            sell_unit,
            sell_total_ht,
            vat_applicable,
            vat_rate,
            sell_total_vat,
            sell_total_ttc,
            quote_remarks,
            print_on_quote
        FROM marginpricing_simulation_lines
        WHERE simulation_ref = ?
        AND print_on_quote = 1
        ORDER BY line_no
    ";

    $stmt = $conn->prepare($linesSql);
    $stmt->bind_param('s', $quoteRef);
    $stmt->execute();
    $linesResult = $stmt->get_result();

    $lines = [];
    while ($line = $linesResult->fetch_assoc()) {
        $lines[] = [
            'line_id' => (int)$line['id'],
            'line_no' => (int)$line['line_no'],
            'code' => $line['item_code'],
            'description' => $line['item_description'],
            'qty' => (float)$line['qty'],
            'unit_price' => (float)$line['sell_unit'],
            'unit' => (float)$line['sell_unit'],
            'total_ht' => (float)$line['sell_total_ht'],
            'vat_applicable' => ((int)$line['vat_applicable']) === 1,
            'vat' => ((int)$line['vat_applicable']) === 1,
            'vat_rate' => (float)$line['vat_rate'],
            'vat_amount' => (float)$line['sell_total_vat'],
            'total_ttc' => (float)$line['sell_total_ttc'],
            'remarks' => $line['quote_remarks'],
            'is_ad_hoc' => false,
            'source_quote_line_id' => (int)$line['id']
        ];
    }
    $stmt->close();

    echo json_encode([
        'success' => true,
        'prefill' => [
            'simulation_id' => (int)$header['id'],
            'simulation_ref' => $header['simulation_ref'],
            'client_name' => $header['client_name_cached'],
            'file_reference' => $header['operations_file_reference'],
            'bank_details' => $header['q_bank_details'],
            'payment_terms' => $header['q_terms'],
            'currency' => $header['currency'],
            'total_ht' => (float)$header['total_sell_ht'],
            'total_vat' => (float)$header['total_sell_vat'],
            'total_ttc' => (float)$header['total_sell_ttc'],
            'lines' => $lines
        ]
    ]);
}

// ============================================================================
// SEARCH FINANCIAL DICTIONARY (UNCHANGED)
// ============================================================================

function searchDictionary(mysqli $conn, string $query): void {
    if (strlen($query) < 1) {
        echo json_encode(['success' => true, 'items' => []]);
        return;
    }

    $sql = "
        SELECT 
            code,
            name_en,
            name_fr,
            category,
            vat_treatment,
            is_billable
        FROM financial_dictionary
        WHERE status = 'ACTIVE'
        AND is_billable = 1
        AND (
            code LIKE ? 
            OR name_en LIKE ?
            OR name_fr LIKE ?
        )
        ORDER BY 
            CASE 
                WHEN code LIKE ? THEN 1
                WHEN name_en LIKE ? THEN 2
                ELSE 3
            END,
            code
        LIMIT 20
    ";

    $stmt = $conn->prepare($sql);
    $searchTerm = '%' . $query . '%';
    $priorityTerm = $query . '%';

    $stmt->bind_param(
        'sssss',
        $searchTerm,
        $searchTerm,
        $searchTerm,
        $priorityTerm,
        $priorityTerm
    );

    $stmt->execute();
    $result = $stmt->get_result();

    $items = [];
    while ($row = $result->fetch_assoc()) {
        $items[] = [
            'code' => $row['code'],
            'description' => $row['name_en'],
            'description_fr' => $row['name_fr'],
            'category' => $row['category'],
            'vat_applicable' => ($row['vat_treatment'] === 'VAT_APPLICABLE_STANDARD')
        ];
    }
    $stmt->close();

    echo json_encode(['success' => true, 'items' => $items]);
}

// ============================================================================
// SAVE PROFORMA (PHASE 2: client_id resolution hardened)
// ============================================================================

function saveProforma(mysqli $conn, array $input, int $userId, string $userRole): void {
    if (!isset($input['invoice_id']) && $userRole !== 'FINANCE' && $userRole !== 'ADMIN') {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'Only Finance can create proformas']);
        return;
    }

    if (isset($input['invoice_id']) && (int)$input['invoice_id'] > 0) {
        $checkSql = "SELECT status, approval_status FROM proforma_invoice WHERE invoice_id = ?";
        $stmt = $conn->prepare($checkSql);
        $invoiceId = (int)$input['invoice_id'];
        $stmt->bind_param('i', $invoiceId);
        $stmt->execute();
        $result = $stmt->get_result();

        if ($result->num_rows > 0) {
            $current = $result->fetch_assoc();
            if ($current['status'] === 'ISSUED_LOCKED' || $current['status'] === 'PAID' || $current['approval_status'] === 'APPROVED') {
                $stmt->close();
                http_response_code(403);
                echo json_encode(['success' => false, 'error' => 'Cannot edit locked/approved/paid proforma']);
                return;
            }
        }
        $stmt->close();
    }

    // Phase 2: resolve client_id defensively if missing (frontend may only send client_name)
    $resolvedClientId = resolveClientIdForProforma($conn, $input);
    if ($resolvedClientId !== null && $resolvedClientId !== '') {
        $input['client_id'] = $resolvedClientId;
    }

    $lines  = isset($input['lines']) && is_array($input['lines']) ? $input['lines'] : [];
    $totals = calculateTotals($lines, $input['advance_percentage'] ?? 100);

    $conn->begin_transaction();

    try {
        if (isset($input['invoice_id']) && (int)$input['invoice_id'] > 0) {
            $invoiceId = updateProformaHeader($conn, $input, $totals, $userId);
        } else {
            $invoiceId = createProformaHeader($conn, $input, $totals, $userId);
        }

        saveProformaLines($conn, $invoiceId, $lines);

        $conn->commit();

        echo json_encode([
            'success' => true,
            'invoice_id' => $invoiceId,
            'message' => 'Proforma saved successfully'
        ]);
    } catch (Exception $e) {
        $conn->rollback();
        throw $e;
    }
}

/**
 * Phase 2 helper: Resolve the client_id we store on proforma_invoice.
 * Priority:
 * 1) input.client_id if valid and exists in client_master
 * 2) resolve by input.client_name exact match (trimmed)
 * 3) return null (caller may fallback to GENERIC)
 */
function resolveClientIdForProforma(mysqli $conn, array $input): ?string {
    $clientId = trim((string)($input['client_id'] ?? ''));
    if ($clientId !== '' && strtoupper($clientId) !== 'GENERIC') {
        if (clientIdExists($conn, $clientId)) {
            return $clientId;
        }
    }

    $clientName = trim((string)($input['client_name'] ?? ''));
    if ($clientName !== '') {
        $id = resolveClientIdByName($conn, $clientName);
        if ($id !== null && $id !== '') {
            return $id;
        }
    }

    return null;
}

function clientIdExists(mysqli $conn, string $clientId): bool {
    $sql = "SELECT client_id FROM client_master WHERE client_id = ? LIMIT 1";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('s', $clientId);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    return is_array($row) && !empty($row['client_id']);
}

/**
 * Resolve by EXACT name match first; if none, try a loose normalized match.
 * This protects production without changing any business logic.
 */
function resolveClientIdByName(mysqli $conn, string $clientName): ?string {
    // 1) Exact match (fast + deterministic)
    $sql = "SELECT client_id FROM client_master WHERE client_name = ? LIMIT 1";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('s', $clientName);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    if (is_array($row) && !empty($row['client_id'])) {
        return (string)$row['client_id'];
    }

    // 2) Loose match (trim/case-insensitive) - still safe but less strict
    $sql2 = "SELECT client_id FROM client_master WHERE TRIM(LOWER(client_name)) = TRIM(LOWER(?)) LIMIT 1";
    $stmt = $conn->prepare($sql2);
    $stmt->bind_param('s', $clientName);
    $stmt->execute();
    $row2 = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (is_array($row2) && !empty($row2['client_id'])) {
        return (string)$row2['client_id'];
    }

    return null;
}

// ============================================================================
// HELPER: CALCULATE TOTALS (UNCHANGED)
// ============================================================================

function calculateTotals(array $lines, $advancePercentage): array {
    $subtotal = 0.0;
    $totalVat = 0.0;

    foreach ($lines as $line) {
        $qty = (float)($line['qty'] ?? 0);
        $unitPrice = (float)($line['unit_price'] ?? 0);
        $lineHT = $qty * $unitPrice;

        $subtotal += $lineHT;

        if (!empty($line['vat_applicable'])) {
            $vatRate = isset($line['vat_rate']) ? (float)$line['vat_rate'] : 0.1925;
            $totalVat += ($lineHT * $vatRate);
        }
    }

    $grandTotal = $subtotal + $totalVat;
    $advancePct = max(1, min(100, (int)$advancePercentage));
    $payableAdvance = ($grandTotal * $advancePct) / 100;

    return [
        'subtotal_xaf' => round($subtotal, 2),
        'vat_xaf' => round($totalVat, 2),
        'total_xaf' => round($grandTotal, 2),
        'advance_percentage' => $advancePct,
        'payable_amount_xaf' => round($payableAdvance, 2)
    ];
}

// ============================================================================
// HELPER: CREATE PROFORMA HEADER (UNCHANGED except client_id resolved)
// ============================================================================

function createProformaHeader(mysqli $conn, array $input, array $totals, int $userId): int {
    $invoiceNo = generateProformaNumber($conn);

    $sql = "
        INSERT INTO proforma_invoice (
            invoice_no,
            invoice_type,
            operations_file_reference,
            linked_quote_ref,
            client_id,
            issue_date,
            due_date,
            currency,
            subtotal_xaf,
            vat_xaf,
            total_xaf,
            advance_percentage,
            payable_amount_xaf,
            total_percentage_paid,
            total_amount_paid_xaf,
            remaining_percentage,
            remaining_amount_xaf,
            payment_count,
            bank_details,
            remarks,
            status,
            approval_status,
            created_by_user_id,
            created_at
        ) VALUES (
            ?, 'PROFORMA', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 
            0, 0, 100, ?, 0,
            ?, ?, 'DRAFT', NULL, ?, NOW()
        )
    ";

    $stmt = $conn->prepare($sql);

    $issueDate = (string)($input['issue_date'] ?? date('Y-m-d'));
    $dueDate = date('Y-m-d', strtotime($issueDate . ' +30 days'));

    // PHASE 2: client_id is already resolved in saveProforma()
    $clientId = (string)($input['client_id'] ?? 'GENERIC');

    $fileRef = (string)($input['file_reference'] ?? '');
    $linkedQuoteRef = (string)($input['linked_quote_ref'] ?? '');
    $currency = (string)($input['currency'] ?? 'XAF');
    $remainingAmount = (float)$totals['total_xaf'];

    $bankDetails = !empty($input['bank_details'])
        ? (string)$input['bank_details']
        : "Bank: AFRILAND FIRST BANK\nAccount Name: SMART LOGISTICS AND SERVICES LTD\nAccount Number: 10005-0006-107018411001-93\nSwift Code: CCEICRBA\nIBAN: CM21-1000-5000-6107-0184-1100-1-93";

    $remarks = (string)($input['remarks'] ?? '');

    $stmt->bind_param(
        'sssssssdddiddssi',
        $invoiceNo,
        $fileRef,
        $linkedQuoteRef,
        $clientId,
        $issueDate,
        $dueDate,
        $currency,
        $totals['subtotal_xaf'],
        $totals['vat_xaf'],
        $totals['total_xaf'],
        $totals['advance_percentage'],
        $totals['payable_amount_xaf'],
        $remainingAmount,
        $bankDetails,
        $remarks,
        $userId
    );

    $stmt->execute();
    $newId = (int)$conn->insert_id;
    $stmt->close();

    return $newId;
}

// ============================================================================
// HELPER: UPDATE PROFORMA HEADER (PHASE 2: now updates client_id)
// ============================================================================

function updateProformaHeader(mysqli $conn, array $input, array $totals, int $userId): int {
    $sql = "
        UPDATE proforma_invoice SET
            operations_file_reference = ?,
            linked_quote_ref = ?,
            client_id = ?,
            issue_date = ?,
            currency = ?,
            subtotal_xaf = ?,
            vat_xaf = ?,
            total_xaf = ?,
            advance_percentage = ?,
            payable_amount_xaf = ?,
            bank_details = ?,
            remarks = ?
        WHERE invoice_id = ?
        AND status = 'DRAFT'
    ";

    $stmt = $conn->prepare($sql);

    $fileRef = (string)($input['file_reference'] ?? '');
    $linkedQuoteRef = (string)($input['linked_quote_ref'] ?? '');
    $clientId = (string)($input['client_id'] ?? 'GENERIC');
    $issueDate = (string)($input['issue_date'] ?? date('Y-m-d'));
    $currency = (string)($input['currency'] ?? 'XAF');

    $bankDetails = !empty($input['bank_details'])
        ? (string)$input['bank_details']
        : "Bank: AFRILAND FIRST BANK\nAccount Name: SMART LOGISTICS AND SERVICES LTD\nAccount Number: 10005-0006-107018411001-93\nSwift Code: CCEICRBA\nIBAN: CM21-1000-5000-6107-0184-1100-1-93";

    $remarks = (string)($input['remarks'] ?? '');
    $invoiceId = (int)($input['invoice_id'] ?? 0);

    $stmt->bind_param(
        'sssssdddidssi',
        $fileRef,
        $linkedQuoteRef,
        $clientId,
        $issueDate,
        $currency,
        $totals['subtotal_xaf'],
        $totals['vat_xaf'],
        $totals['total_xaf'],
        $totals['advance_percentage'],
        $totals['payable_amount_xaf'],
        $bankDetails,
        $remarks,
        $invoiceId
    );

    $stmt->execute();
    $stmt->close();

    return $invoiceId;
}

// ============================================================================
// HELPER: SAVE PROFORMA LINES (UNCHANGED)
// ============================================================================

function saveProformaLines(mysqli $conn, int $invoiceId, array $lines): void {
    $deleteSql = "DELETE FROM proforma_invoice_lines WHERE invoice_id = ?";
    $stmt = $conn->prepare($deleteSql);
    $stmt->bind_param('i', $invoiceId);
    $stmt->execute();
    $stmt->close();

    $insertSql = "
        INSERT INTO proforma_invoice_lines (
            invoice_id,
            line_no,
            dict_code,
            description,
            qty,
            unit_price_xaf,
            line_total_xaf,
            vat_applicable,
            vat_rate,
            vat_amount_xaf,
            line_total_ttc_xaf,
            remarks,
            is_ad_hoc,
            source_quote_line_id,
            created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    ";

    $stmt = $conn->prepare($insertSql);

    foreach ($lines as $idx => $line) {
        $lineNo = $idx + 1;

        $qty = (float)($line['qty'] ?? 0);
        $unitPrice = (float)($line['unit_price'] ?? 0);
        $lineHT = $qty * $unitPrice;

        $vatApplicable = (int)((!empty($line['vat_applicable'])) ? 1 : 0);
        $vatRate = $vatApplicable ? (float)($line['vat_rate'] ?? 0.1925) : 0.0;
        $vatAmount = $lineHT * $vatRate;
        $lineTTC = $lineHT + $vatAmount;

        $isAdHoc = (int)((!empty($line['is_ad_hoc'])) ? 1 : 0);

        $code = (string)($line['code'] ?? '');
        $description = (string)($line['description'] ?? '');
        $remarks = (string)($line['remarks'] ?? '');

        $sourceLineId = isset($line['source_quote_line_id']) && $line['source_quote_line_id'] !== null
            ? (int)$line['source_quote_line_id']
            : 0;

        $stmt->bind_param(
            'iissdddidddsii',
            $invoiceId,
            $lineNo,
            $code,
            $description,
            $qty,
            $unitPrice,
            $lineHT,
            $vatApplicable,
            $vatRate,
            $vatAmount,
            $lineTTC,
            $remarks,
            $isAdHoc,
            $sourceLineId
        );

        $stmt->execute();
    }

    $stmt->close();
}

function getAllProformas(mysqli $conn): void {
    $sql = "
    SELECT 
        pi.invoice_id,
        pi.invoice_no,
        pi.operations_file_reference,

        /* DISPLAY OVERRIDE: show quote_id in the list column */
        COALESCE(NULLIF(ofm.quote_id, ''), pi.linked_quote_ref) AS linked_quote_ref,

        /* keep original linked_quote_ref available if you need it later */
        pi.linked_quote_ref AS linked_quote_ref_internal,

        pi.client_id,
        pi.issue_date,
        pi.currency,
        pi.subtotal_xaf,
        pi.vat_xaf,
        pi.total_xaf,
        pi.advance_percentage,
        pi.payable_amount_xaf,
        pi.total_percentage_paid,
        pi.total_amount_paid_xaf,
        pi.remaining_percentage,
        pi.remaining_amount_xaf,
        pi.payment_count,
        pi.status,
        pi.approval_status,
        pi.unlock_reason,  /* <--- THIS WAS MISSING. ADD THIS LINE. */
        pi.created_at,

        mps.client_name_cached,
        mps.total_sell_ttc as quote_total

    FROM proforma_invoice pi

    /* NEW JOIN: operations_file_master to fetch quote_id */
    LEFT JOIN operations_file_master ofm
        ON (ofm.operations_file_reference COLLATE utf8mb4_general_ci)
         = (pi.operations_file_reference COLLATE utf8mb4_general_ci)

    LEFT JOIN marginpricing_simulations mps 
        ON (pi.linked_quote_ref COLLATE utf8mb4_general_ci)
         = (mps.simulation_ref   COLLATE utf8mb4_general_ci)

    WHERE pi.invoice_type = 'PROFORMA'
    ORDER BY pi.created_at DESC
    LIMIT 200
    ";

    $result = $conn->query($sql);
    $proformas = [];

    while ($row = $result->fetch_assoc()) {
        // Now this function has access to $row['unlock_reason'] and will return 'UNLOCK_REQUESTED'
        $workflowStatus = determineWorkflowStatus($row['status'], $row['approval_status'], $row);
        $paymentStatus = determinePaymentStatus((float)$row['total_percentage_paid'], (int)$row['payment_count']);

        $proformas[] = [
            'invoice_id' => (int)$row['invoice_id'],
            'invoice_no' => $row['invoice_no'],
            'file_reference' => $row['operations_file_reference'],
            'linked_quote_ref' => $row['linked_quote_ref'],
            'client_name' => $row['client_name_cached'] ?? 'N/A',
            'issue_date' => date('Y-m-d', strtotime((string)$row['issue_date'])),
            'currency' => $row['currency'],
            'subtotal' => (float)$row['subtotal_xaf'],
            'vat' => (float)$row['vat_xaf'],
            'total' => (float)$row['total_xaf'],
            'advance_percentage' => (int)$row['advance_percentage'],
            'payable_advance' => (float)$row['payable_amount_xaf'],
            'total_paid_percentage' => (float)$row['total_percentage_paid'],
            'total_paid_amount' => (float)$row['total_amount_paid_xaf'],
            'remaining_percentage' => (float)$row['remaining_percentage'],
            'remaining_amount' => (float)$row['remaining_amount_xaf'],
            'payment_count' => (int)$row['payment_count'],
            'quote_total' => (float)($row['quote_total'] ?? 0),
            'status' => $row['status'],
            'approval_status' => $row['approval_status'],
            'unlock_reason' => $row['unlock_reason'], // Pass it to frontend too
            'workflow_status' => $workflowStatus,
            'payment_status' => $paymentStatus,
            'created_at' => $row['created_at']
        ];
    }

    echo json_encode(['success' => true, 'proformas' => $proformas]);
}

// ============================================================================
// GET PROFORMA DETAIL (UNCHANGED)
// ============================================================================

function getProformaDetail(mysqli $conn, int $invoiceId): void {
    if ($invoiceId <= 0) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Invalid invoice ID']);
        return;
    }

    $headerSql = "
        SELECT 
            pi.*,
            mps.client_name_cached,
            mps.operations_file_reference as quote_file_ref
        FROM proforma_invoice pi
        LEFT JOIN marginpricing_simulations mps 
            ON (pi.linked_quote_ref COLLATE utf8mb4_general_ci)
             = (mps.simulation_ref   COLLATE utf8mb4_general_ci)
        WHERE pi.invoice_id = ?
        AND pi.invoice_type = 'PROFORMA'
    ";

    $stmt = $conn->prepare($headerSql);
    $stmt->bind_param('i', $invoiceId);
    $stmt->execute();
    $header = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!$header) {
        http_response_code(404);
        echo json_encode(['success' => false, 'error' => 'Proforma not found']);
        return;
    }

    $linesSql = "
        SELECT 
            line_id,
            line_no,
            dict_code,
            description,
            qty,
            unit_price_xaf,
            line_total_xaf,
            vat_applicable,
            vat_rate,
            vat_amount_xaf,
            line_total_ttc_xaf,
            remarks,
            is_ad_hoc,
            source_quote_line_id
        FROM proforma_invoice_lines
        WHERE invoice_id = ?
        ORDER BY line_no
    ";

    $stmt = $conn->prepare($linesSql);
    $stmt->bind_param('i', $invoiceId);
    $stmt->execute();
    $linesResult = $stmt->get_result();

    $lines = [];
    while ($line = $linesResult->fetch_assoc()) {
        $lines[] = [
            'line_id' => (int)$line['line_id'],
            'line_no' => (int)$line['line_no'],
            'code' => $line['dict_code'],
            'description' => $line['description'],
            'qty' => (float)$line['qty'],
            'unit_price' => (float)$line['unit_price_xaf'],
            'total_ht' => (float)$line['line_total_xaf'],
            'vat_applicable' => (bool)$line['vat_applicable'],
            'vat_rate' => (float)$line['vat_rate'],
            'vat_amount' => (float)$line['vat_amount_xaf'],
            'total_ttc' => (float)$line['line_total_ttc_xaf'],
            'remarks' => $line['remarks'],
            'is_ad_hoc' => (bool)$line['is_ad_hoc'],
            'source_quote_line_id' => $line['source_quote_line_id']
        ];
    }
    $stmt->close();

    $workflowStatus = determineWorkflowStatus((string)$header['status'], $header['approval_status'], $header);
    $paymentStatus = determinePaymentStatus((float)$header['total_percentage_paid'], (int)$header['payment_count']);

    echo json_encode([
        'success' => true,
        'proforma' => [
            'invoice_id' => (int)$header['invoice_id'],
            'invoice_no' => $header['invoice_no'],
            'file_reference' => $header['operations_file_reference'],
            'linked_quote_ref' => $header['linked_quote_ref'],
            'client_name' => $header['client_name_cached'] ?? 'N/A',
            'issue_date' => date('Y-m-d', strtotime((string)$header['issue_date'])),
            'due_date' => $header['due_date'],
            'currency' => $header['currency'],
            'subtotal' => (float)$header['subtotal_xaf'],
            'vat' => (float)$header['vat_xaf'],
            'total' => (float)$header['total_xaf'],
            'advance_percentage' => (int)$header['advance_percentage'],
            'payable_advance' => (float)$header['payable_amount_xaf'],
            'total_paid_percentage' => (float)$header['total_percentage_paid'],
            'total_paid_amount' => (float)$header['total_amount_paid_xaf'],
            'remaining_percentage' => (float)$header['remaining_percentage'],
            'remaining_amount' => (float)$header['remaining_amount_xaf'],
            'payment_count' => (int)$header['payment_count'],
            'bank_details' => $header['bank_details'],
            'remarks' => $header['remarks'],
            'status' => $header['status'],
            'approval_status' => $header['approval_status'],
            'unlock_reason' => $header['unlock_reason'],
            'rejection_reason' => $header['rejection_reason'],
            'signature_mode'   => $header['signature_mode'],
            'workflow_status' => $workflowStatus,
            'payment_status' => $paymentStatus,
            'lines' => $lines
        ]
    ]);
}

// ============================================================================
// GET KPIs (UNCHANGED)
// ============================================================================
// (rest of your file remains unchanged: workflow + payments + utilities + generator)
// ============================================================================

/**
 * NOTE:
 * The remainder of your file (getKPIs, workflow functions, payment tracking,
 * utilities, determineWorkflowStatus, determinePaymentStatus, generateProformaNumber)
 * is unchanged from your current version and should remain exactly as-is below.
 *
 * For brevity, I am not repeating it here would be unsafe in production.
 * You must append your existing remaining functions exactly as they were.
 */
// ============================================================================
// GET KPIs (UNCHANGED)
// ============================================================================

function getKPIs(mysqli $conn): void {
    $month = (int)date('m');
    $year  = (int)date('Y');

    $proformaValueSql = "
        SELECT 
            COUNT(DISTINCT linked_quote_ref) as total_unique_quotes_mtd,
            COALESCE(SUM(unique_val), 0) as total_proformas_value_mtd
        FROM (
            SELECT linked_quote_ref, MAX(total_xaf) as unique_val 
            FROM proforma_invoice 
            WHERE invoice_type = 'PROFORMA'
            AND MONTH(created_at) = ? AND YEAR(created_at) = ?
            GROUP BY linked_quote_ref
        ) as sub
    ";
    $stmt = $conn->prepare($proformaValueSql);
    $stmt->bind_param('ii', $month, $year);
    $stmt->execute();
    $proformaValueData = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    $issuedSql = "
        SELECT 
            COUNT(*) as total_issued_mtd,
            COALESCE(SUM(payable_amount_xaf), 0) as total_issued_amount_mtd
        FROM proforma_invoice
        WHERE invoice_type = 'PROFORMA'
        AND status IN ('ISSUED_LOCKED', 'PAID')
        AND MONTH(issue_date) = ? AND YEAR(issue_date) = ?
    ";
    $stmt = $conn->prepare($issuedSql);
    $stmt->bind_param('ii', $month, $year);
    $stmt->execute();
    $issuedData = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    $pendingSql = "
        SELECT COUNT(*) as pending_count
        FROM proforma_invoice
        WHERE invoice_type = 'PROFORMA'
        AND status = 'ISSUED_LOCKED'
    ";
    $pendingResult = $conn->query($pendingSql);
    $pendingData = $pendingResult ? $pendingResult->fetch_assoc() : ['pending_count' => 0];

    $collectedSql = "
        SELECT 
            COALESCE(SUM(amount_paid_xaf), 0) as total_collected_mtd,
            COUNT(*) as total_payments_mtd
        FROM proforma_payment_history
        WHERE MONTH(payment_date) = ? AND YEAR(payment_date) = ?
    ";
    $stmt = $conn->prepare($collectedSql);
    $stmt->bind_param('ii', $month, $year);
    $stmt->execute();
    $collectedData = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    $totalProformasValue = (float)($proformaValueData['total_proformas_value_mtd'] ?? 0);
    $totalIssuedAmount   = (float)($issuedData['total_issued_amount_mtd'] ?? 0);
    $totalCollected      = (float)($collectedData['total_collected_mtd'] ?? 0);

    $conversionRate = $totalProformasValue > 0 ? round(($totalIssuedAmount / $totalProformasValue) * 100, 1) : 0.0;
    $collectionRate = $totalIssuedAmount > 0 ? round(($totalCollected / $totalIssuedAmount) * 100, 1) : 0.0;

    echo json_encode([
        'success' => true,
        'kpis' => [
            'total_proformas_mtd' => (int)($proformaValueData['total_unique_quotes_mtd'] ?? 0),
            'total_proformas_value' => $totalProformasValue,
            'total_issued_mtd' => (int)($issuedData['total_issued_mtd'] ?? 0),
            'total_issued_amount' => $totalIssuedAmount,
            'conversion_rate' => $conversionRate,
            'pending_payments' => (int)($pendingData['pending_count'] ?? 0),
            'total_collected_mtd' => $totalCollected,
            'total_payments_mtd' => (int)($collectedData['total_payments_mtd'] ?? 0),
            'collection_rate' => $collectionRate
        ]
    ]);
}

// ============================================================================
// WORKFLOW FUNCTIONS (UNCHANGED)
// ============================================================================

function submitForApproval(mysqli $conn, int $invoiceId, int $userId): void {
    $sql = "
        UPDATE proforma_invoice 
        SET approval_status = 'PENDING'
        WHERE invoice_id = ?
        AND status = 'DRAFT'
        AND (approval_status IS NULL OR approval_status = 'REJECTED')
    ";

    $stmt = $conn->prepare($sql);
    $stmt->bind_param('i', $invoiceId);
    $stmt->execute();

    echo json_encode([
        'success' => $stmt->affected_rows > 0,
        'message' => $stmt->affected_rows > 0 ? 'Submitted for approval' : null,
        'error'   => $stmt->affected_rows > 0 ? null : 'Failed to submit or already submitted'
    ]);

    $stmt->close();
}

function approveProforma(mysqli $conn, int $invoiceId, int $userId, string $userRole): void {
    if ($userRole !== 'MANAGEMENT' && $userRole !== 'ADMIN') {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'Only Management can approve']);
        return;
    }

    $sql = "
        UPDATE proforma_invoice 
        SET 
            approval_status = 'APPROVED',
            approved_by_user_id = ?,
            approved_at = NOW()
        WHERE invoice_id = ?
        AND approval_status = 'PENDING'
    ";

    $stmt = $conn->prepare($sql);
    $stmt->bind_param('ii', $userId, $invoiceId);
    $stmt->execute();

    echo json_encode([
        'success' => $stmt->affected_rows > 0,
        'message' => $stmt->affected_rows > 0 ? 'Proforma approved successfully' : null,
        'error'   => $stmt->affected_rows > 0 ? null : 'Failed to approve or not pending'
    ]);

    $stmt->close();
}

function rejectProforma(mysqli $conn, int $invoiceId, int $userId, string $userRole, string $reason): void {
    if ($userRole !== 'MANAGEMENT' && $userRole !== 'ADMIN') {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'Only Management can reject']);
        return;
    }

    $sql = "
        UPDATE proforma_invoice 
        SET 
            approval_status = 'REJECTED',
            rejection_reason = ?
        WHERE invoice_id = ?
        AND approval_status = 'PENDING'
    ";

    $stmt = $conn->prepare($sql);
    $stmt->bind_param('si', $reason, $invoiceId);
    $stmt->execute();

    echo json_encode([
        'success' => $stmt->affected_rows > 0,
        'message' => $stmt->affected_rows > 0 ? 'Proforma rejected' : null,
        'error'   => $stmt->affected_rows > 0 ? null : 'Failed to reject or not pending'
    ]);

    $stmt->close();
}

function issueProforma(mysqli $conn, int $invoiceId, int $userId): void {
    // 1. Get Signature Mode
    $input = json_decode(file_get_contents('php://input'), true);
    $sigMode = $input['signature_mode'] ?? 'DIGITAL';

    // 2. Attempt the Update
    $sql = "
        UPDATE proforma_invoice 
        SET 
            status = 'ISSUED_LOCKED',
            signature_mode = ?
        WHERE invoice_id = ?
        AND approval_status = 'APPROVED'
        AND status = 'DRAFT'
    ";

    $stmt = $conn->prepare($sql);
    if (!$stmt) {
        echo json_encode(['success' => false, 'error' => 'DB Prepare Error: ' . $conn->error]);
        return;
    }

    $stmt->bind_param('si', $sigMode, $invoiceId);
    $stmt->execute();

    if ($stmt->affected_rows > 0) {
        echo json_encode([
            'success' => true,
            'message' => 'Proforma issued and locked successfully'
        ]);
    } else {
        // --- DIAGNOSTIC BLOCK: Find out WHY it failed ---
        $checkSql = "SELECT status, approval_status FROM proforma_invoice WHERE invoice_id = $invoiceId";
        $checkRes = $conn->query($checkSql);
        
        if ($checkRes && $checkRes->num_rows > 0) {
            $row = $checkRes->fetch_assoc();
            $actualStatus = $row['status'];
            $actualApproval = $row['approval_status'];
            
            $errorMsg = "Cannot issue. DB Status is '$actualStatus' (Expected: DRAFT) and Approval is '$actualApproval' (Expected: APPROVED).";
        } else {
            $errorMsg = "Cannot issue. Invoice ID $invoiceId not found.";
        }
        
        echo json_encode(['success' => false, 'error' => $errorMsg]);
    }

    $stmt->close();
}

function cancelProforma(mysqli $conn, int $invoiceId, int $userId, string $userRole): void {
    if ($userRole !== 'FINANCE' && $userRole !== 'ADMIN') {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'Only Finance/Admin can cancel proformas']);
        return;
    }

    $checkSql = "
        SELECT 
            invoice_no,
            status,
            approval_status,
            total_percentage_paid,
            payment_count
        FROM proforma_invoice
        WHERE invoice_id = ?
        AND invoice_type = 'PROFORMA'
    ";

    $stmt = $conn->prepare($checkSql);
    $stmt->bind_param('i', $invoiceId);
    $stmt->execute();
    $result = $stmt->get_result();

    if ($result->num_rows === 0) {
        $stmt->close();
        http_response_code(404);
        echo json_encode(['success' => false, 'error' => 'Proforma not found']);
        return;
    }

    $proforma = $result->fetch_assoc();
    $stmt->close();

    if ($proforma['status'] !== 'DRAFT') {
        http_response_code(400);
        echo json_encode([
            'success' => false,
            'error' => 'Can only cancel DRAFT proformas. Current status: ' . $proforma['status']
        ]);
        return;
    }

    if ((float)$proforma['total_percentage_paid'] > 0 || (int)$proforma['payment_count'] > 0) {
        http_response_code(400);
        echo json_encode([
            'success' => false,
            'error' => 'Cannot cancel proforma with payments. Please void payments first.'
        ]);
        return;
    }

    $cancelSql = "
        UPDATE proforma_invoice 
        SET 
            status = 'CANCELLED',
            remarks = CONCAT(
                COALESCE(remarks, ''), 
                '\n[CANCELLED by ', ?, ' on ', NOW(), ']'
            )
        WHERE invoice_id = ?
    ";

    $stmt = $conn->prepare($cancelSql);
    $stmt->bind_param('si', $userRole, $invoiceId);
    $stmt->execute();

    echo json_encode([
        'success' => $stmt->affected_rows > 0,
        'message' => $stmt->affected_rows > 0 ? 'Proforma cancelled successfully. Quotation is now available for reuse.' : null,
        'invoice_no' => $proforma['invoice_no'],
        'error' => $stmt->affected_rows > 0 ? null : 'Failed to cancel proforma'
    ]);

    $stmt->close();
}

// ============================================================================
// PAYMENT TRACKING - FULL PAYMENT ONLY + OFM UPDATE
// ============================================================================

function recordAdvancePayment(mysqli $conn, array $input, int $userId, string $userRole): void {
    if ($userRole !== 'FINANCE' && $userRole !== 'ADMIN') {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'Only Finance can record payments']);
        return;
    }

    $invoiceId = (int)($input['invoice_id'] ?? 0);
    $amountPaid = (float)($input['amount_paid'] ?? 0);
    $paymentDate = (string)($input['payment_date'] ?? date('Y-m-d'));
    $paymentReference = (string)($input['payment_reference'] ?? '');
    $paymentMethod = (string)($input['payment_method'] ?? 'BANK_TRANSFER');
    $remarks = (string)($input['remarks'] ?? '');

    $conn->begin_transaction();

    try {
        $checkSql = "
            SELECT 
                invoice_no,
                operations_file_reference,
                total_xaf,
                payable_amount_xaf,
                total_percentage_paid,
                payment_count,
                status
            FROM proforma_invoice
            WHERE invoice_id = ?
            AND invoice_type = 'PROFORMA'
            FOR UPDATE
        ";

        $stmt = $conn->prepare($checkSql);
        $stmt->bind_param('i', $invoiceId);
        $stmt->execute();
        $result = $stmt->get_result();

        if ($result->num_rows === 0) {
            $stmt->close();
            throw new Exception('Proforma not found');
        }

        $proforma = $result->fetch_assoc();
        $stmt->close();

        if ($proforma['status'] === 'PAID') {
            throw new Exception('Invoice is already fully paid');
        }

        if ($proforma['status'] !== 'ISSUED_LOCKED') {
            throw new Exception('Can only pay ISSUED_LOCKED proformas. Current status: ' . $proforma['status']);
        }

        $payableAmount = (float)$proforma['payable_amount_xaf'];

        if (abs($amountPaid - $payableAmount) > 0.01) {
            throw new Exception(
                'Payment must be for the full amount. ' .
                'Required: ' . number_format($payableAmount, 2) . ' XAF. ' .
                'Provided: ' . number_format($amountPaid, 2) . ' XAF'
            );
        }

        // Insert payment record
        $insertPaymentSql = "
            INSERT INTO proforma_payment_history (
                invoice_id,
                payment_number,
                advance_percentage_paid,
                amount_paid_xaf,
                payment_date,
                payment_reference,
                payment_method,
                recorded_by_user_id,
                remarks
            ) VALUES (?, 1, 100, ?, ?, ?, ?, ?, ?)
        ";

        $stmt = $conn->prepare($insertPaymentSql);

        // IMPORTANT: bind types - recorded_by_user_id is INT
        $stmt->bind_param(
            'idsssis',
            $invoiceId,
            $amountPaid,
            $paymentDate,
            $paymentReference,
            $paymentMethod,
            $userId,
            $remarks
        );

        $stmt->execute();
        $paymentId = (int)$conn->insert_id;
        $stmt->close();

        // Update proforma to PAID status
        $updateInvoiceSql = "
            UPDATE proforma_invoice SET
                total_percentage_paid = 100,
                total_amount_paid_xaf = ?,
                remaining_percentage = 0,
                remaining_amount_xaf = 0,
                payment_count = 1,
                status = 'PAID'
            WHERE invoice_id = ?
        ";

        $stmt = $conn->prepare($updateInvoiceSql);
        $stmt->bind_param('di', $amountPaid, $invoiceId);
        $stmt->execute();
        $stmt->close();

        // Update OFM aggregates
        $fileRef = (string)$proforma['operations_file_reference'];

        $getOfmSql = "
            SELECT 
                proforma_invoice_id,
                proforma_invoice_amount
            FROM operations_file_master
            WHERE operations_file_reference = ?
        ";

        $stmt = $conn->prepare($getOfmSql);
        $stmt->bind_param('s', $fileRef);
        $stmt->execute();
        $ofmData = $stmt->get_result()->fetch_assoc();
        $stmt->close();

        $currentPriAmount = (float)($ofmData['proforma_invoice_amount'] ?? 0);
        $newPriAmount = $currentPriAmount + $amountPaid;

        $updateOfmSql = "
            UPDATE operations_file_master
            SET 
                proforma_invoice_id = ?,
                proforma_invoice_amount = ?
            WHERE operations_file_reference = ?
        ";

        $stmt = $conn->prepare($updateOfmSql);
        $invoiceIdStr = (string)$invoiceId; // if your OFM column is varchar; keep as string
        $stmt->bind_param('sds', $invoiceIdStr, $newPriAmount, $fileRef);
        $stmt->execute();
        $stmt->close();

        $conn->commit();

        echo json_encode([
            'success' => true,
            'payment_id' => $paymentId,
            'payment_number' => 1,
            'total_paid_percentage' => 100,
            'remaining_percentage' => 0,
            'is_fully_paid' => true,
            'ofm_updated' => true,
            'total_pri_amount' => $newPriAmount,
            'message' => 'Full payment recorded successfully. Proforma closed and OFM updated.'
        ]);
    } catch (Exception $e) {
        $conn->rollback();
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}

function getPaymentHistory(mysqli $conn, int $invoiceId): void {
    if ($invoiceId <= 0) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Invalid invoice ID']);
        return;
    }

    // FIXED: recorded_by_user_id is user_auth.user_id (INT), not employee_master.employee_id (VARCHAR)
    $sql = "
        SELECT 
            pph.payment_id,
            pph.payment_number,
            pph.advance_percentage_paid,
            pph.amount_paid_xaf,
            pph.payment_date,
            pph.payment_reference,
            pph.payment_method,
            pph.recorded_at,
            pph.remarks,
            em.full_name as recorded_by_name
        FROM proforma_payment_history pph
        LEFT JOIN user_auth ua ON ua.user_id = pph.recorded_by_user_id
        LEFT JOIN employee_master em ON em.employee_id = ua.employee_id
        WHERE pph.invoice_id = ?
        ORDER BY pph.payment_number ASC
    ";

    $stmt = $conn->prepare($sql);
    $stmt->bind_param('i', $invoiceId);
    $stmt->execute();
    $result = $stmt->get_result();

    $payments = [];
    while ($row = $result->fetch_assoc()) {
        $payments[] = [
            'payment_id' => (int)$row['payment_id'],
            'payment_number' => (int)$row['payment_number'],
            'percentage_paid' => (float)$row['advance_percentage_paid'],
            'amount_paid' => (float)$row['amount_paid_xaf'],
            'payment_date' => $row['payment_date'],
            'payment_reference' => $row['payment_reference'],
            'payment_method' => $row['payment_method'],
            'recorded_at' => $row['recorded_at'],
            'recorded_by' => $row['recorded_by_name'],
            'remarks' => $row['remarks']
        ];
    }

    $stmt->close();

    echo json_encode(['success' => true, 'payments' => $payments]);
}

function getPaymentSummary(mysqli $conn, int $invoiceId): void {
    if ($invoiceId <= 0) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Invalid invoice ID']);
        return;
    }

    $sql = "
        SELECT 
            total_xaf,
            total_percentage_paid,
            total_amount_paid_xaf,
            remaining_percentage,
            remaining_amount_xaf,
            payment_count,
            status
        FROM proforma_invoice
        WHERE invoice_id = ?
        AND invoice_type = 'PROFORMA'
    ";

    $stmt = $conn->prepare($sql);
    $stmt->bind_param('i', $invoiceId);
    $stmt->execute();
    $result = $stmt->get_result();

    if ($result->num_rows === 0) {
        $stmt->close();
        http_response_code(404);
        echo json_encode(['success' => false, 'error' => 'Proforma not found']);
        return;
    }

    $row = $result->fetch_assoc();
    $stmt->close();

    echo json_encode([
        'success' => true,
        'summary' => [
            'invoice_total' => (float)$row['total_xaf'],
            'total_paid_percentage' => (float)$row['total_percentage_paid'],
            'total_paid_amount' => (float)$row['total_amount_paid_xaf'],
            'remaining_percentage' => (float)$row['remaining_percentage'],
            'remaining_amount' => (float)$row['remaining_amount_xaf'],
            'payment_count' => (int)$row['payment_count'],
            'is_fully_paid' => ((float)$row['total_percentage_paid'] >= 100),
            'status' => $row['status']
        ]
    ]);
}

function voidPayment(mysqli $conn, int $paymentId, int $userId, string $userRole): void {
    if ($userRole !== 'FINANCE' && $userRole !== 'ADMIN') {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'Only Finance can void payments']);
        return;
    }

    if ($paymentId <= 0) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Invalid payment ID']);
        return;
    }

    $conn->begin_transaction();

    try {
        $getPaymentSql = "
            SELECT 
                pph.invoice_id,
                pph.amount_paid_xaf,
                pi.operations_file_reference
            FROM proforma_payment_history pph
            INNER JOIN proforma_invoice pi ON pi.invoice_id = pph.invoice_id
            WHERE pph.payment_id = ?
        ";

        $stmt = $conn->prepare($getPaymentSql);
        $stmt->bind_param('i', $paymentId);
        $stmt->execute();
        $result = $stmt->get_result();

        if ($result->num_rows === 0) {
            $stmt->close();
            throw new Exception('Payment not found');
        }

        $payment = $result->fetch_assoc();
        $stmt->close();

        $invoiceId = (int)$payment['invoice_id'];
        $amountToReverse = (float)$payment['amount_paid_xaf'];
        $fileRef = (string)$payment['operations_file_reference'];

        $deletePaymentSql = "DELETE FROM proforma_payment_history WHERE payment_id = ?";
        $stmt = $conn->prepare($deletePaymentSql);
        $stmt->bind_param('i', $paymentId);
        $stmt->execute();
        $stmt->close();

        $updateInvoiceSql = "
            UPDATE proforma_invoice SET
                total_percentage_paid = 0,
                total_amount_paid_xaf = 0,
                remaining_percentage = 100,
                remaining_amount_xaf = total_xaf,
                payment_count = 0,
                status = 'ISSUED_LOCKED'
            WHERE invoice_id = ?
        ";

        $stmt = $conn->prepare($updateInvoiceSql);
        $stmt->bind_param('i', $invoiceId);
        $stmt->execute();
        $stmt->close();

        $getOfmSql = "
            SELECT proforma_invoice_amount 
            FROM operations_file_master
            WHERE operations_file_reference = ?
        ";

        $stmt = $conn->prepare($getOfmSql);
        $stmt->bind_param('s', $fileRef);
        $stmt->execute();
        $ofmData = $stmt->get_result()->fetch_assoc();
        $stmt->close();

        $currentPriAmount = (float)($ofmData['proforma_invoice_amount'] ?? 0);
        $newPriAmount = max(0, $currentPriAmount - $amountToReverse);

        $updateOfmSql = "
            UPDATE operations_file_master
            SET proforma_invoice_amount = ?
            WHERE operations_file_reference = ?
        ";

        $stmt = $conn->prepare($updateOfmSql);
        $stmt->bind_param('ds', $newPriAmount, $fileRef);
        $stmt->execute();
        $stmt->close();

        $conn->commit();

        echo json_encode([
            'success' => true,
            'message' => 'Payment voided successfully. Proforma reopened for payment.',
            'ofm_reversed' => true,
            'new_pri_total' => $newPriAmount
        ]);
    } catch (Exception $e) {
        $conn->rollback();
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}

function determineWorkflowStatus(string $status, $approvalStatus, $row = []): string {
    if (!empty($row['unlock_reason']) && $status !== 'DRAFT') {
        return 'UNLOCK_REQUESTED';
    }

    // 2. Standard Workflow
    if ($status === 'DRAFT' && is_null($approvalStatus)) return 'DRAFT';
    if ($status === 'DRAFT' && $approvalStatus === 'PENDING') return 'SUBMITTED';
    if ($status === 'DRAFT' && $approvalStatus === 'APPROVED') return 'APPROVED';
    if ($status === 'DRAFT' && $approvalStatus === 'REJECTED') return 'REJECTED';
    if ($status === 'ISSUED_LOCKED') return 'ISSUED'; // Maps DB 'ISSUED_LOCKED' to Frontend 'ISSUED'
    if ($status === 'PAID') return 'PAID';
    if ($status === 'CANCELLED') return 'CANCELLED';
    
    return 'UNKNOWN'; 
}

function determinePaymentStatus(float $totalPaidPercentage, int $paymentCount): string {
    if ($totalPaidPercentage >= 100) return 'FULLY_PAID';
    if ($totalPaidPercentage > 0) return 'PARTIALLY_PAID (' . $paymentCount . ' payments)';
    return 'UNPAID';
}

function generateProformaNumber(mysqli $conn): string {
    $prefix = 'SLAS-PI-';
    $year = date('y');

    $sql = "
        SELECT invoice_no 
        FROM proforma_invoice 
        WHERE invoice_type = 'PROFORMA'
        AND invoice_no LIKE ?
        ORDER BY invoice_id DESC 
        LIMIT 1
    ";

    $stmt = $conn->prepare($sql);
    $pattern = $prefix . $year . '%';
    $stmt->bind_param('s', $pattern);
    $stmt->execute();
    $result = $stmt->get_result();

    if ($result->num_rows > 0) {
        $last = (string)$result->fetch_assoc()['invoice_no'];
        $lastNum = (int)substr($last, -4);
        $newNum = $lastNum + 1;
    } else {
        $newNum = 1;
    }

    $stmt->close();

    return $prefix . $year . str_pad((string)$newNum, 4, '0', STR_PAD_LEFT);
}
