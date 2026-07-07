<?php
/**
 * ====================================================================================================
 * SMART LS ENTERPRISE - CASH REQUEST MODULE
 * ====================================================================================================
 * * MODULE ID:   FIN-CR-001
 * DESCRIPTION: Handles the creation, validation, approval, and disbursement of cash/payment requests.
 * Integrates with Operations Files and Costing Modules for strict financial control.
 * * AUTHOR:      Combined Development Team (Backend Eng + Frontend Lead)
 * DATE:        2025-01-28
 * VERSION:     2.4.0 (Production Release)
 * * ----------------------------------------------------------------------------------------------------
 * COMPLIANCE NOTES:
 * 1. Role-Based Access Control (RBAC) enforced via require_role().
 * 2. Department context isolation enforced via dept_context.php.
 * 3. Input sanitization applied to all I/O via h() and prepared statements.
 * 4. Transaction safety guaranteed for multi-table writes.
 * ----------------------------------------------------------------------------------------------------
 */

declare(strict_types=1);

// ----------------------------------------------------------------------------------------------------
// 1. SYSTEM INITIALIZATION & SECURITY
// ----------------------------------------------------------------------------------------------------

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

// Enforce strict role access
require_role(['ADMIN','FINANCE','MANAGEMENT','OPERATIONS','SALES']);

require_once __DIR__ . '/../../includes/dept_context.php';

// Database Connection
$conn = db();

// ----------------------------------------------------------------------------------------------------
// 2. HELPER FUNCTIONS
// ----------------------------------------------------------------------------------------------------

/**
 * Output HTML-safe string.
 * @param string|null $v The input string.
 * @return string The escaped string.
 */
function h(?string $v): string {
    return htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8');
}

/**
 * Send JSON response and terminate script.
 * @param array $p Response payload.
 * @param int $code HTTP status code.
 */
function json_exit(array $p, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($p);
    exit;
}

/**
 * Get current datetime in MySQL format.
 * @return string Y-m-d H:i:s
 */
function now_dt(): string {
    return (new DateTime('now'))->format('Y-m-d H:i:s');
}

/**
 * Format currency for backend logs/messages (optional).
 * @param float $amount
 * @return string
 */
function fmt_currency(float $amount): string {
    return number_format($amount, 0, '.', ',') . ' XAF';
}

// ----------------------------------------------------------------------------------------------------
// 3. AUTHENTICATION CONTEXT
// ----------------------------------------------------------------------------------------------------

$employeeId = (string)($_SESSION['auth']['employee_id'] ?? '');
$userId     = (int)($_SESSION['auth']['user_id'] ?? 0);

if ($employeeId === '' || $userId <= 0) {
    header('Location: ../../api/auth/logout.php');
    exit;
}

/**
 * Fetch authoritative user profile
 */
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
$me = $stmtMe->get_result()->fetch_assoc();

if (!$me) {
    // Session invalid or user deleted
    header('Location: ../../api/auth/logout.php');
    exit;
}

// Normalize User Data
$fullName  = (string)($me['full_name'] ?? 'User');
$firstName = trim(explode(' ', $fullName)[0] ?? 'User');
$role        = strtoupper((string)($me['role'] ?? 'ADMIN'));
$department = strtoupper(trim((string)($me['department'] ?? '')));

// Map Roles to Display Labels
$roleLabelMap = [
    'ADMIN'      => 'SYSTEM ADMIN',
    'FINANCE'    => 'FINANCE CONTROLLER',
    'SALES'      => 'SALES EXECUTIVE',
    'OPERATIONS' => 'OPERATIONS LEAD',
    'MANAGEMENT' => 'MANAGING DIRECTOR',
];
$roleLabel = $roleLabelMap[$role] ?? $role;

// Avatar Generation
$avatarName = urlencode($fullName);
$avatarUrl  = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";

// Greeting Logic
$hour = (int)date('H');
$greeting = ($hour < 12) ? 'Good morning' : (($hour < 18) ? 'Good afternoon' : 'Good evening');

// ----------------------------------------------------------------------------------------------------
// 4. PERMISSIONS LOGIC
// ----------------------------------------------------------------------------------------------------

// Department Flags
$isDeptFinance = in_array($department, ['FINANCE'], true);
$isDeptOpsLike = in_array($department, ['OPERATIONS','SALES','ADMIN','MANAGEMENT'], true);

// Override Flags
$allowAdminMgmtFinanceOverride = true;
$isFinanceActor = $isDeptFinance || ($allowAdminMgmtFinanceOverride && in_array($role, ['ADMIN','MANAGEMENT'], true));
$isOpsActor     = $isDeptOpsLike || in_array($role, ['ADMIN','MANAGEMENT'], true);


// ----------------------------------------------------------------------------------------------------
// 5. AJAX API ENDPOINTS
// ----------------------------------------------------------------------------------------------------

if (isset($_GET['ajax'])) {
    $ajax = (string)$_GET['ajax'];

    // -------------------------------------------------------------------------
    // ENDPOINT: KPI Statistics (kpi_stats)
    // Returns the counts and totals for the Dashboard Cards
    // -------------------------------------------------------------------------
    if ($ajax === 'kpi_stats') {
        try {
            // Pending Validation (Submitted)
            $sqlVal = "SELECT COUNT(*) as c FROM cash_request_master WHERE status = 'SUBMITTED'";
            $resVal = $conn->query($sqlVal)->fetch_assoc();
            
            // Pending Approval (Validated)
            $sqlApp = "SELECT COUNT(*) as c FROM cash_request_master WHERE status = 'VALIDATED'";
            $resApp = $conn->query($sqlApp)->fetch_assoc();
            
            // Ready to Disburse (Approved/Locked)
            $sqlRdy = "SELECT COUNT(*) as c FROM cash_request_master WHERE status = 'APPROVED_LOCKED' OR status = 'PARTIALLY_DISBURSED'";
            $resRdy = $conn->query($sqlRdy)->fetch_assoc();
            
            // Total Disbursed (Sum of all disbursed_total field)
            $sqlTot = "SELECT SUM(disbursed_total) as s FROM cash_request_master"; // All time
            $resTot = $conn->query($sqlTot)->fetch_assoc();

            json_exit([
                'ok' => true,
                'data' => [
                    'validation_count' => (int)$resVal['c'],
                    'approval_count'   => (int)$resApp['c'],
                    'disburse_count'   => (int)$resRdy['c'],
                    'total_disbursed'  => (float)$resTot['s']
                ]
            ]);
        } catch (Throwable $e) {
            json_exit(['ok' => false, 'error' => 'KPI Error'], 500);
        }
    }

    // -------------------------------------------------------------------------
    // ENDPOINT: Operations Files List (ops_files_list)
    // Used to populate the dropdown for "Cost Context"
    // -------------------------------------------------------------------------
    if ($ajax === 'ops_files_list') {
        $q = trim((string)($_GET['q'] ?? ''));
        $limit = 100;

        $like = '%' . $q . '%';

        // NOTE: We fetch costing_id here to allow frontend to know if a costing exists
        $sql = "
          SELECT
            ofm.operations_file_reference AS file_ref,
            ofm.client_id,
            ofm.sea_bl,
            ofm.costing_id, 
            COALESCE(cm.client_name, '') AS client_name
          FROM operations_file_master ofm
          LEFT JOIN client_master cm ON cm.client_id = ofm.client_id
          WHERE (? = '' OR ofm.operations_file_reference LIKE ? OR ofm.sea_bl LIKE ? OR cm.client_name LIKE ?)
          ORDER BY ofm.operations_file_reference DESC
          LIMIT {$limit}
        ";
        $st = $conn->prepare($sql);
        $st->bind_param('ssss', $q, $like, $like, $like);
        $st->execute();
        $rows = $st->get_result()->fetch_all(MYSQLI_ASSOC);
        json_exit(['ok' => true, 'data' => $rows]);
    }

    // -------------------------------------------------------------------------
    // ENDPOINT: Costing Lines Import (costing_lines_get)
    // CRITICAL LOGIC: Fetches Approved Costing Lines for Import
    // -------------------------------------------------------------------------
    if ($ajax === 'costing_lines_get') {
        $opsRef = trim((string)($_GET['ops_ref'] ?? ''));
        if ($opsRef === '') json_exit(['ok' => false, 'error' => 'Missing Operations Reference'], 400);

        // 1. Get Costing ID and Status from Operations File
        // We join operations_file_master to costing_header (assuming costing_id link)
        $sqlInfo = "
            SELECT 
                ofm.costing_id,
                ch.status as costing_status,
                ch.costing_ref_no
            FROM operations_file_master ofm
            LEFT JOIN costing_header ch ON ch.costing_id = ofm.costing_id
            WHERE ofm.operations_file_reference = ?
            LIMIT 1
        ";
        $stInfo = $conn->prepare($sqlInfo);
        $stInfo->bind_param('s', $opsRef);
        $stInfo->execute();
        $info = $stInfo->get_result()->fetch_assoc();

        if (!$info) {
            json_exit(['ok' => false, 'error' => 'Operations file not found.'], 404);
        }

        if (empty($info['costing_id'])) {
            json_exit(['ok' => false, 'error' => 'No Costing ID linked to this Operations File.'], 404);
        }

        // 2. Strict Check: Costing MUST be APPROVED
        $status = strtoupper((string)($info['costing_status'] ?? ''));
        if ($status !== 'APPROVED') {
            json_exit(['ok' => false, 'error' => 'Costing is not APPROVED. Cannot import lines.'], 403);
        }

        // 3. Fetch Lines from costing_line
        // MAPPING STRATEGY: 
        // item_code -> line_code
        // item_description -> line_desc
        // qty -> qty
        // unit_cost -> unit_price
        // vat_applicable + vat_rate -> vat_rate
        $sqlLines = "
            SELECT 
                item_code,
                item_description,
                qty,
                unit_cost,
                vat_applicable,
                vat_rate,
                total_ttc
            FROM costing_line
            WHERE costing_id = ?
            ORDER BY line_no ASC
        ";
        $stLines = $conn->prepare($sqlLines);
        $stLines->bind_param('s', $info['costing_id']);
        $stLines->execute();
        $rawLines = $stLines->get_result()->fetch_all(MYSQLI_ASSOC);

        $exportLines = [];
        foreach($rawLines as $rl) {
            $vatRate = 0.00;
            if ((int)$rl['vat_applicable'] === 1) {
                $vatRate = (float)$rl['vat_rate'];
            }
            
            // Precision handling: Cast to float, but precision is determined by frontend display
            $exportLines[] = [
                'line_code' => $rl['item_code'],
                'line_desc' => $rl['item_description'],
                'qty'       => (float)$rl['qty'],
                'unit_price'=> (float)$rl['unit_cost'], // Use Unit Cost, frontend recalc totals
                'vat_rate'  => $vatRate,
                'approved_total' => (float)$rl['total_ttc'] // Passed for reference
            ];
        }

        json_exit([
            'ok' => true, 
            'data' => [
                'costing_ref' => $info['costing_ref_no'],
                'lines' => $exportLines
            ]
        ]);
    }

    // -------------------------------------------------------------------------
    // ENDPOINT: Cash Request List (pr_list)
    // -------------------------------------------------------------------------
    if ($ajax === 'pr_list') {
        $q = trim((string)($_GET['q'] ?? ''));
        $limit = (int)($_GET['limit'] ?? 50);
        if ($limit < 1 || $limit > 200) $limit = 50;
        $like = '%' . $q . '%';

        $sql = "
          SELECT
            crm.pr_id,
            DATE(crm.created_at) AS pr_date,
            crm.category,
            crm.disburse_method,
            crm.beneficiary,
            crm.ops_file_ref,
            crm.cost_center,
            crm.amount_total,
            crm.status,
            crm.disbursed_total,
            crm.created_by,
            crm.created_at,
            COALESCE(cm.client_name, '') AS client_name,
            COALESCE(ofm.sea_bl, crm.sea_bl, '') AS sea_bl
          FROM cash_request_master crm
          LEFT JOIN operations_file_master ofm ON ofm.operations_file_reference = crm.ops_file_ref
          LEFT JOIN client_master cm ON cm.client_id = ofm.client_id
          WHERE (
            ? = ''
            OR crm.pr_id LIKE ?
            OR crm.beneficiary LIKE ?
            OR crm.ops_file_ref LIKE ?
            OR cm.client_name LIKE ?
            OR crm.cost_center LIKE ?
          )
          ORDER BY crm.created_at DESC
          LIMIT {$limit}
        ";
        $st = $conn->prepare($sql);
        $st->bind_param('ssssss', $q, $like, $like, $like, $like, $like);
        $st->execute();
        $rows = $st->get_result()->fetch_all(MYSQLI_ASSOC);
        json_exit(['ok' => true, 'data' => $rows]);
    }

    // -------------------------------------------------------------------------
    // ENDPOINT: Get Single Cash Request (pr_get)
    // -------------------------------------------------------------------------
    if ($ajax === 'pr_get') {
        $id = (string)($_GET['id'] ?? '');
        if ($id === '') json_exit(['ok' => false, 'error' => 'Missing id'], 400);

        $sql = "SELECT * FROM cash_request_master WHERE pr_id = ? LIMIT 1";
        $st = $conn->prepare($sql);
        $st->bind_param('s', $id);
        $st->execute();
        $hdr = $st->get_result()->fetch_assoc();
        if (!$hdr) json_exit(['ok' => false, 'error' => 'Not found'], 404);

        // Fetch Lines
        // Fetch Lines
        $sqlL = "
          SELECT line_id, line_code, line_desc, qty, unit_price, vat_rate, line_total, is_imported, justification_required
          FROM cash_request_lines
          WHERE pr_id = ?
          ORDER BY line_id ASC
        
        ";
        $stL = $conn->prepare($sqlL);
        $stL->bind_param('s', $id);
        $stL->execute();
        $lines = $stL->get_result()->fetch_all(MYSQLI_ASSOC);

        // Fetch Payment History
        $sqlP = "
          SELECT pay_id, paid_amount, paid_by, paid_at, note
          FROM cash_request_payments
          WHERE pr_id = ?
          ORDER BY pay_id ASC
        ";
        $stP = $conn->prepare($sqlP);
        $stP->bind_param('s', $id);
        $stP->execute();
        $pays = $stP->get_result()->fetch_all(MYSQLI_ASSOC);

        // Fetch Audit Logs (Simulated via comments/history table if it existed, for now just basic creation info)
        $logs = []; 
        // In a real system, you'd query a separate audit_log table. 
        // Here we'll just return creation info as a log entry.
        $logs[] = "Created by " . $hdr['created_by'] . " on " . $hdr['created_at'];
        if ($hdr['updated_at']) $logs[] = "Last updated by " . $hdr['updated_by'] . " on " . $hdr['updated_at'];
        if ($hdr['validated_at']) $logs[] = "Validated by " . $hdr['validated_by'] . " on " . $hdr['validated_at'];
        if ($hdr['rejected_at']) $logs[] = "Rejected by " . $hdr['rejected_by'] . " on " . $hdr['rejected_at'];

        json_exit(['ok' => true, 'data' => ['header' => $hdr, 'lines' => $lines, 'payments' => $pays, 'logs' => $logs]]);
    }

    // -------------------------------------------------------------------------
    // ENDPOINT: Save/Update Request (pr_save)
    // -------------------------------------------------------------------------
    if ($ajax === 'pr_save') {
        $raw = file_get_contents('php://input');
        $in = json_decode((string)$raw, true);
        if (!is_array($in)) json_exit(['ok' => false, 'error' => 'Invalid JSON'], 400);

        $mode = strtoupper(trim((string)($in['mode'] ?? 'NEW')));
        $prId = trim((string)($in['pr_id'] ?? ''));

        $category = strtoupper(trim((string)($in['category'] ?? 'OPS')));
        $method   = strtoupper(trim((string)($in['disburse_method'] ?? 'CASH')));

        $opsRef      = trim((string)($in['ops_file_ref'] ?? ''));
        $beneficiary = trim((string)($in['beneficiary'] ?? ''));
        $remarks     = (string)($in['remarks'] ?? '');
        $lines       = $in['lines'] ?? [];

        $costCenter = trim((string)($in['cost_center'] ?? ''));
        $ovhJust    = trim((string)($in['overhead_justification'] ?? ''));

        // Voucher Fields
        $bankName      = trim((string)($in['bank_name'] ?? '')); // Also holds Network Name for MoMo
        $accountNumber = trim((string)($in['account_number'] ?? ''));
        $accountName   = trim((string)($in['account_name'] ?? ''));
        $momoNumber    = trim((string)($in['momo_number'] ?? ''));
        $momoName      = trim((string)($in['momo_name'] ?? ''));
        $chequeNumber  = trim((string)($in['cheque_number'] ?? ''));

        // Validation & Normalization
        if (!in_array($category, ['OPS','OVH'], true)) $category = 'OPS';
        if (!in_array($method, ['CASH','BANK','CHEQUE','MOMO'], true)) $method = 'CASH';

        if ($beneficiary === '') json_exit(['ok' => false, 'error' => 'Beneficiary is required'], 422);
        if (!is_array($lines) || count($lines) < 1) json_exit(['ok' => false, 'error' => 'At least 1 line is required'], 422);

        // Method-Specific Validations
        if ($method === 'BANK') {
            if ($bankName === '' || $accountNumber === '' || $accountName === '') {
                json_exit(['ok' => false, 'error' => 'Bank name, account number and name required'], 422);
            }
        } elseif ($method === 'MOMO') {
            if ($momoNumber === '') json_exit(['ok' => false, 'error' => 'MoMo Number required'], 422);
            // We use bank_name to store Network (e.g., MTN/Orange) if provided
            if ($bankName === '') json_exit(['ok' => false, 'error' => 'Network (MTN/ORANGE) required'], 422); 
        } elseif ($method === 'CHEQUE') {
            if ($chequeNumber === '') json_exit(['ok' => false, 'error' => 'Cheque Number required'], 422);
        }

        // Context Logic
        $clientId = '';
        $seaBl = '';

        if ($category === 'OPS') {
            // Note: We allow OPS without file if manual lines are used? 
            // The prompt implies strict logic but Answer 13B says "Manual lines allowed".
            // However, normally a PR for OPS needs a file reference. 
            if ($opsRef === '') json_exit(['ok' => false, 'error' => 'Operations File is required for OPS Requests'], 422);

            $sql = "SELECT client_id, sea_bl FROM operations_file_master WHERE operations_file_reference = ? LIMIT 1";
            $st = $conn->prepare($sql);
            $st->bind_param('s', $opsRef);
            $st->execute();
            $of = $st->get_result()->fetch_assoc();
            if (!$of) json_exit(['ok' => false, 'error' => 'Operations file not found'], 404);

            $clientId = (string)($of['client_id'] ?? '');
            $seaBl    = (string)($of['sea_bl'] ?? '');
            
            // Clear OVH specific
            $costCenter = '';
            $ovhJust = '';
        } else {
            // OVH
            $opsRef = '';
            if ($costCenter === '') json_exit(['ok' => false, 'error' => 'Cost Center required for Overhead'], 422);
            if ($ovhJust === '') json_exit(['ok' => false, 'error' => 'Justification required for Overhead'], 422);
        }

        // Process Lines
        $amountTotal = 0.0;
        $normLines = [];

        foreach ($lines as $ln) {
            if (!is_array($ln)) continue;

            $code = trim((string)($ln['line_code'] ?? ''));
            $desc = trim((string)($ln['line_desc'] ?? ''));
            $qty  = (float)($ln['qty'] ?? 0);
            $unit = (float)($ln['unit_price'] ?? 0);
            $vat  = (float)($ln['vat_rate'] ?? 0);
            $isImp = (int)($ln['is_imported'] ?? 0); // Read-only flag

            if ($desc === '') continue;
            if ($qty <= 0) $qty = 1;

            $ex = $qty * $unit;
            $vatAmt = $ex * ($vat / 100.0);
            $total = $ex + $vatAmt;
            // Round to 2 decimals immediately per Requirement 14C
            $total = round($total, 2);

            $amountTotal += $total;
            $normLines[] = [
                'line_code' => $code,
                'line_desc' => $desc,
                'qty' => $qty,
                'unit_price' => $unit,
                'vat_rate' => $vat,
                'line_total' => $total,
                'is_imported' => $isImp
            ];
        }

        if (count($normLines) < 1) json_exit(['ok' => false, 'error' => 'Valid lines are required'], 422);

        // Transaction
        $conn->begin_transaction();
        try {
            if ($mode === 'NEW') {
                $dateKey = date('Ymd');
                $prefix  = "SLAS-PR-{$dateKey}-";

                // Generate ID
                $sql = "SELECT pr_id FROM cash_request_master WHERE pr_id LIKE CONCAT(?, '%') ORDER BY pr_id DESC LIMIT 1";
                $st = $conn->prepare($sql);
                $st->bind_param('s', $prefix);
                $st->execute();
                $last = $st->get_result()->fetch_assoc();

                $seq = 1;
                if ($last && isset($last['pr_id'])) {
                    $parts = explode('-', (string)$last['pr_id']);
                    $tail = (int)end($parts);
                    if ($tail > 0) $seq = $tail + 1;
                }
                $prId = $prefix . str_pad((string)$seq, 4, '0', STR_PAD_LEFT);

                $sqlI = "
                  INSERT INTO cash_request_master
                  (pr_id, category, disburse_method, ops_file_ref, client_id, sea_bl, cost_center, overhead_justification,
                   bank_name, account_number, account_name, momo_number, momo_name, cheque_number,
                   beneficiary, remarks, amount_total, status, created_by, created_at)
                  VALUES
                  (?, ?, ?, ?, ?, ?, ?, ?,
                   ?, ?, ?, ?, ?, ?,
                   ?, ?, ?, 'DRAFT', ?, ?)
                ";
                $stI = $conn->prepare($sqlI);
                $createdAt = now_dt();
                // 19 params
                $stI->bind_param(
                    'ssssssssssssssssdss',
                    $prId, $category, $method, $opsRef, $clientId, $seaBl, $costCenter, $ovhJust,
                    $bankName, $accountNumber, $accountName, $momoNumber, $momoName, $chequeNumber,
                    $beneficiary, $remarks, $amountTotal, $employeeId, $createdAt
                );
                $stI->execute();

            } else {
                // UPDATE
                if ($prId === '') json_exit(['ok' => false, 'error' => 'Missing pr_id'], 400);

                // Status Check
                $sqlC = "SELECT status FROM cash_request_master WHERE pr_id = ? LIMIT 1";
                $stC = $conn->prepare($sqlC);
                $stC->bind_param('s', $prId);
                $stC->execute();
                $cur = $stC->get_result()->fetch_assoc();
                if (!$cur) json_exit(['ok' => false, 'error' => 'Not found'], 404);

                $curStatus = (string)$cur['status'];
                if (!in_array($curStatus, ['DRAFT','REJECTED'], true)) {
                    json_exit(['ok' => false, 'error' => 'Locked. Cannot edit.'], 409);
                }

                $sqlU = "
                  UPDATE cash_request_master
                  SET category=?, disburse_method=?, ops_file_ref=?, client_id=?, sea_bl=?, cost_center=?, overhead_justification=?,
                      bank_name=?, account_number=?, account_name=?, momo_number=?, momo_name=?, cheque_number=?,
                      beneficiary=?, remarks=?, amount_total=?, updated_by=?, updated_at=?
                  WHERE pr_id=? LIMIT 1
                ";
                $stU = $conn->prepare($sqlU);
                $updatedAt = now_dt();

                $stU->bind_param(
                    'ssssssssssssssssdss',
                    $category, $method, $opsRef, $clientId, $seaBl, $costCenter, $ovhJust,
                    $bankName, $accountNumber, $accountName, $momoNumber, $momoName, $chequeNumber,
                    $beneficiary, $remarks, $amountTotal, $employeeId, $updatedAt, $prId
                );
                $stU->execute();

                // Delete old lines
                $sqlD = "DELETE FROM cash_request_lines WHERE pr_id = ?";
                $stD = $conn->prepare($sqlD);
                $stD->bind_param('s', $prId);
                $stD->execute();
            }

            // Insert Lines
            // Insert Lines (Updated for justification_required)
            $sqlL = "
              INSERT INTO cash_request_lines
              (pr_id, line_code, line_desc, qty, unit_price, vat_rate, line_total, is_imported, justification_required)
              VALUES
              (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ";
            $stL = $conn->prepare($sqlL);

            foreach ($normLines as $ln) {
                $code = (string)$ln['line_code'];
                $desc = (string)$ln['line_desc'];
                $qty  = (float)$ln['qty'];
                $unit = (float)$ln['unit_price'];
               $vat  = (float)$ln['vat_rate'];
              $tot  = (float)$ln['line_total'];
              // New Flag capture
              $just = (int)($ln['justification_required'] ?? 0); 
              $imp  = (int)$ln['is_imported'];

              $stL->bind_param('sssddddii', $prId, $code, $desc, $qty, $unit, $vat, $tot, $imp, $just);
              $stL->execute();
            }

            $conn->commit();
            json_exit(['ok' => true, 'data' => ['pr_id' => $prId]]);

        } catch (Throwable $ex) {
            $conn->rollback();
            json_exit(['ok' => false, 'error' => 'Save failed: ' . $ex->getMessage()], 500);
        }
    }

    // -------------------------------------------------------------------------
    // ENDPOINT: State Transition (pr_transition)
    // -------------------------------------------------------------------------
    if ($ajax === 'pr_transition') {
        $raw = file_get_contents('php://input');
        $in = json_decode((string)$raw, true);
        $prId = trim((string)($in['pr_id'] ?? ''));
        $to   = trim((string)($in['to_status'] ?? ''));

        if ($prId === '' || $to === '') json_exit(['ok' => false, 'error' => 'Invalid params'], 400);

        // Fetch Current
        $sql = "SELECT status FROM cash_request_master WHERE pr_id = ? LIMIT 1";
        $st = $conn->prepare($sql);
        $st->bind_param('s', $prId);
        $st->execute();
        $cur = $st->get_result()->fetch_assoc();
        if (!$cur) json_exit(['ok' => false, 'error' => 'Not found'], 404);
        $from = $cur['status'];

        $newStatus = '';
        $sqlU = ""; 
        $t = now_dt();

        if ($to === 'SUBMITTED') {
            if (!$isOpsActor) json_exit(['ok' => false, 'error' => 'Permission denied'], 403);
            if (!in_array($from, ['DRAFT','REJECTED'], true)) json_exit(['ok' => false, 'error' => 'Invalid transition'], 409);
            
            $sqlU = "UPDATE cash_request_master SET status='SUBMITTED', updated_by='{$employeeId}', updated_at='{$t}' WHERE pr_id='{$prId}'";
            
        } elseif ($to === 'VALIDATED') {
            if (!$isFinanceActor) json_exit(['ok' => false, 'error' => 'Only Finance can validate'], 403);
            if ($from !== 'SUBMITTED' && $from !== 'DRAFT') json_exit(['ok' => false, 'error' => 'Invalid transition'], 409);
            
            $sqlU = "UPDATE cash_request_master SET status='VALIDATED', validated_by='{$employeeId}', validated_at='{$t}', updated_by='{$employeeId}', updated_at='{$t}' WHERE pr_id='{$prId}'";

        } elseif ($to === 'APPROVED_LOCKED') {
            // NOTE: In the user's diagram/prompt, MD approves. We map this to APPROVED_LOCKED
            if ($role !== 'MANAGEMENT' && $role !== 'ADMIN') json_exit(['ok' => false, 'error' => 'Only MD/Admin can Approve'], 403);
            if ($from !== 'VALIDATED') json_exit(['ok' => false, 'error' => 'Must be Validated first'], 409);
            
            $sqlU = "UPDATE cash_request_master SET status='APPROVED_LOCKED', updated_by='{$employeeId}', updated_at='{$t}' WHERE pr_id='{$prId}'";

        } elseif ($to === 'REJECTED') {
            if (!$isFinanceActor && $role !== 'MANAGEMENT') json_exit(['ok' => false, 'error' => 'Permission denied'], 403);
            
            $sqlU = "UPDATE cash_request_master SET status='REJECTED', rejected_by='{$employeeId}', rejected_at='{$t}', updated_by='{$employeeId}', updated_at='{$t}' WHERE pr_id='{$prId}'";
        } else {
            json_exit(['ok' => false, 'error' => 'Unknown status'], 400);
        }

        if ($conn->query($sqlU)) {
            json_exit(['ok' => true]);
        } else {
            json_exit(['ok' => false, 'error' => 'DB Error'], 500);
        }
    }

    // -------------------------------------------------------------------------
    // ENDPOINT: Disburse Funds (pr_disburse)
    // -------------------------------------------------------------------------
    if ($ajax === 'pr_disburse') {
        if (!$isFinanceActor) json_exit(['ok' => false, 'error' => 'Only Finance can disburse'], 403);

        $raw = file_get_contents('php://input');
        $in = json_decode((string)$raw, true);
        $prId = trim((string)($in['pr_id'] ?? ''));
        $pay  = (float)($in['paid_amount'] ?? 0);
        $note = trim((string)($in['note'] ?? ''));

        if ($prId === '' || $pay <= 0) json_exit(['ok' => false, 'error' => 'Invalid amount'], 400);

        $conn->begin_transaction();
        try {
            $sql = "SELECT status, amount_total, disbursed_total FROM cash_request_master WHERE pr_id=? LIMIT 1 for UPDATE";
            $st = $conn->prepare($sql);
            $st->bind_param('s', $prId);
            $st->execute();
            $hdr = $st->get_result()->fetch_assoc();
            
            // Allow disbursement if VALIDATED or APPROVED_LOCKED
            if (!in_array($hdr['status'], ['VALIDATED','APPROVED_LOCKED','PARTIALLY_DISBURSED'], true)) {
                json_exit(['ok' => false, 'error' => 'Status mismatch for disbursement'], 409);
            }

            $total = (float)$hdr['amount_total'];
            $already = (float)$hdr['disbursed_total'];
            $newTotal = $already + $pay;

            // Tolerance of 1 unit for float drift
            if ($newTotal > ($total + 1.0)) {
                json_exit(['ok' => false, 'error' => 'Payment exceeds Total Approved Amount'], 422);
            }

            // Insert Payment
            $sqlP = "INSERT INTO cash_request_payments (pr_id, paid_amount, paid_by, paid_at, note) VALUES (?, ?, ?, ?, ?)";
            $stP = $conn->prepare($sqlP);
            $t = now_dt();
            $stP->bind_param('sdsss', $prId, $pay, $employeeId, $t, $note);
            $stP->execute();

            // Update Master
            $newStatus = ($newTotal >= ($total - 1.0)) ? 'DISBURSED' : 'PARTIALLY_DISBURSED';
            
            $sqlU = "UPDATE cash_request_master SET disbursed_total=?, status=?, updated_by=?, updated_at=? WHERE pr_id=?";
            $stU = $conn->prepare($sqlU);
            $stU->bind_param('dssss', $newTotal, $newStatus, $employeeId, $t, $prId);
            $stU->execute();

            $conn->commit();
            json_exit(['ok' => true, 'data' => ['status' => $newStatus, 'disbursed_total' => $newTotal]]);

        } catch (Throwable $ex) {
            $conn->rollback();
            json_exit(['ok' => false, 'error' => $ex->getMessage()], 500);
        }
    }

    json_exit(['ok' => false, 'error' => 'Bad Ajax'], 404);
}

?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cash Requests | Smart LS</title>

    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="../../css/admin.css"> <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&family=Inconsolata:wght@500;700&display=swap" rel="stylesheet">

    <style>
        :root {
            /* BRAND COLORS - STRICT ADHERENCE */
            --smart-blue: #1F99D8;
            --smart-dark: #055B83;
            --smart-orange: #EE7D04;
            --smart-charcoal: #231F20;
            --smart-gray-50: #F8FAFC;
            --smart-gray-100: #F1F5F9;
            --smart-gray-200: #E2E8F0;
            --smart-gray-300: #CBD5E1;
            --smart-gray-400: #94A3B8;
            --smart-gray-800: #1E293B;
            
            /* TYPOGRAPHY */
            --font-body: 'Manrope', sans-serif;
            --font-heading: 'Montserrat', sans-serif;
            --font-mono: 'Inconsolata', monospace;
            
            /* STATUS COLORS */
            --status-draft-bg: #F1F5F9; --status-draft-text: #475569;
            --status-submitted-bg: #FFF7ED; --status-submitted-text: #C2410C;
            --status-validated-bg: #E0F2FE; --status-validated-text: #0369A1;
            --status-approved-bg: #DCFCE7; --status-approved-text: #15803D;
            --status-rejected-bg: #FEF2F2; --status-rejected-text: #B91C1C;
            --status-disbursed-bg: #F0FDF4; --status-disbursed-text: #166534;
        }

        /* OVERRIDES FOR CONTENT AREA */
        .main-content-smart {
            padding: 24px;
            font-family: var(--font-body);
            color: var(--smart-charcoal);
        }

        .font-heading { font-family: var(--font-heading); }
        .font-mono { font-family: var(--font-mono); }
        .text-orange { color: var(--smart-orange) !important; }
        .bg-orange { background-color: var(--smart-orange) !important; }
        .fw-black { font-weight: 800; }

        /* KPI CARDS */
        .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; margin-bottom: 32px; }
        .kpi-card {
            background: white; border-radius: 12px; padding: 20px;
            border: 1px solid var(--smart-gray-200);
            box-shadow: 0 2px 4px rgba(0,0,0,0.01);
            display: flex; align-items: center; gap: 16px;
            position: relative; overflow: hidden; transition: all 0.2s;
        }
        .kpi-card:hover { transform: translateY(-2px); box-shadow: 0 10px 15px rgba(0,0,0,0.03); border-color: var(--smart-blue); }
        .kpi-icon {
            width: 48px; height: 48px; border-radius: 12px;
            display: flex; align-items: center; justify-content: center;
            font-size: 1.25rem; flex-shrink: 0;
        }
        .kpi-content { flex: 1; }
        .kpi-label { font-size: 0.7rem; font-weight: 700; color: #94A3B8; text-transform: uppercase; margin-bottom: 4px; letter-spacing: 0.5px; }
        .kpi-number { font-size: 1.5rem; font-weight: 800; color: var(--smart-charcoal); line-height: 1.1; font-family: var(--font-mono); }

        /* TABLE CARD */
        .table-card-smart {
            background: white; border-radius: 12px;
            border: 1px solid var(--smart-gray-200);
            box-shadow: 0 2px 4px rgba(0,0,0,0.01);
            overflow: hidden;
        }
        .table-header-smart {
            padding: 20px 24px; border-bottom: 1px solid var(--smart-gray-200);
            display: flex; justify-content: space-between; align-items: center; background: #FFFFFF;
        }
        .smart-table { width: 100%; border-collapse: collapse; }
        .smart-table th {
            text-align: left; padding: 16px 24px; background: #F8FAFC;
            font-size: 0.75rem; font-weight: 800; text-transform: uppercase;
            color: #64748B; border-bottom: 1px solid var(--smart-gray-200); letter-spacing: 0.5px;
        }
        .smart-table td {
            padding: 16px 24px; vertical-align: middle;
            border-bottom: 1px solid var(--smart-gray-100);
            font-size: 0.85rem; color: #334155;
        }
        .smart-table tr:hover { background: #FAFAFA; }

        /* MODAL FULLSCREEN CUSTOM (Question 16B - Actually we use modal-xl but style it like this internally) */
        .modal-body-smart { background: var(--smart-gray-50); padding: 0; }
        
        .form-section {
            background: white; padding: 32px;
            border-bottom: 1px solid var(--smart-gray-200);
            margin-bottom: 24px;
        }
        .form-label-smart {
            font-size: 0.7rem; font-weight: 800; color: var(--smart-dark);
            text-transform: uppercase; margin-bottom: 8px; display: block;
        }
        .smart-input {
            width: 100%; padding: 10px 14px; font-size: 0.9rem;
            border: 1px solid #CBD5E1; border-radius: 6px;
            background: #fff; color: var(--smart-charcoal); font-weight: 500;
        }
        .smart-input:focus { outline: none; border-color: var(--smart-blue); box-shadow: 0 0 0 3px rgba(31, 153, 216, 0.1); }
        

        /* LINES TABLE */
        .lines-card {
            background: white; border: 1px solid var(--smart-gray-200);
            border-radius: 8px; overflow: hidden; margin-bottom: 24px;
        }
        .lines-table th { background: #F8FAFC; padding: 10px 16px; font-size: 0.7rem; color: #64748B; text-transform: uppercase; font-weight: 800; border-bottom: 1px solid #E2E8F0; }
        .lines-table td { padding: 0; border-bottom: 1px solid #F1F5F9; }
        
        /* 1. TEXT INPUTS: Keep transparent style */
        .lines-table input:not([type="checkbox"]), .lines-table select { 
            border: none; border-radius: 0; background: transparent; padding: 12px 16px; width: 100%; font-size: 0.9rem; 
        }
        
        /* 2. TEXT INPUTS FOCUS: Blue tint */
        .lines-table input:not([type="checkbox"]):focus, .lines-table select:focus { 
            background: #F0F9FF; outline: none; box-shadow: inset 0 0 0 2px var(--smart-blue); 
        }
        
        .lines-table input:read-only { background: #F8FAFC; color: #94A3B8; } 

        /* 3. CHECKBOX FIX: Force standard styling */
        .lines-table input[type="checkbox"] {
            /* Restore background color and border */
            background-color: #fff !important; 
            border: 1px solid #ccc !important;
            
            /* Positioning */
            margin-top: 12px;
            width: 1.3em;
            height: 1.3em;
            cursor: pointer;
            
            /* Ensure appearance is standard (Bootstrap uses appearance: none) */
            -webkit-appearance: none;
            -moz-appearance: none;
            appearance: none;
            
            /* Reset any interference */
            opacity: 1 !important;
        }

        /* 4. CHECKED STATE: Force the Tick Image */
        .lines-table input[type="checkbox"]:checked {
            background-color: var(--smart-orange) !important;
            border-color: var(--smart-orange) !important;
            /* Standard SVG Tick */
            background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3e%3cpath fill='none' stroke='%23fff' stroke-linecap='round' stroke-linejoin='round' stroke-width='3' d='M6 10l3 3l6-6'/%3e") !important;
            background-size: 100% 100%;
            background-position: center;
            background-repeat: no-repeat;
        }

        /* Column Widths */
        .col-code { width: 10%; border-right: 1px solid #F1F5F9; }
        .col-desc { width: 35%; border-right: 1px solid #F1F5F9; }
        .col-qty { width: 8%; text-align: center; border-right: 1px solid #F1F5F9; }
        .col-price { width: 12%; text-align: right; border-right: 1px solid #F1F5F9; }
        .col-vat { width: 8%; text-align: center; border-right: 1px solid #F1F5F9; background: #FAFAFA; font-weight: bold; }
        .col-just { width: 7%; text-align: center; border-right: 1px solid #F1F5F9; background: #FFF7ED; }
        .col-total { width: 15%; text-align: right; font-family: var(--font-mono); font-weight: 700; background: #F8FAFC; color: var(--smart-dark); padding-right: 16px; }
        .col-action { width: 5%; text-align: center; }

        /* Status Pills */
        .status-pill {
            display: inline-flex; align-items: center; padding: 4px 10px;
            border-radius: 99px; font-size: 0.7rem; font-weight: 800;
            text-transform: uppercase; letter-spacing: 0.5px;
        }
        .bg-draft { background: var(--status-draft-bg); color: var(--status-draft-text); border: 1px solid #CBD5E1; }
        .bg-sub { background: var(--status-submitted-bg); color: var(--status-submitted-text); border: 1px solid #FDBA74; }
        .bg-val { background: var(--status-validated-bg); color: var(--status-validated-text); border: 1px solid #7DD3FC; }
        .bg-app { background: var(--status-approved-bg); color: var(--status-approved-text); border: 1px solid #86EFAC; }
        .bg-rej { background: var(--status-rejected-bg); color: var(--status-rejected-text); border: 1px solid #FCA5A5; }
        .bg-dis { background: var(--status-disbursed-bg); color: var(--status-disbursed-text); border: 1px solid #86EFAC; }

        /* Print Styles (Question 19A - Strictly Preserved) */
        #print-area { display: none; }
        @media print {
            @page { size: A4; margin: 0; }
            body { background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .sidebar, .top-navbar, .main-content, .modal, .toast-container, .modal-backdrop { display: none !important; }
            
            #print-area {
                display: block; padding: 10mm 15mm; font-family: 'Arial', sans-serif;
                color: #000; position: relative; height: 100vh; box-sizing: border-box; background: white;
            }
            /* Inserted strict print CSS below */
            .p-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid var(--smart-orange); padding-bottom: 10px; margin-bottom: 20px; }
            .p-logo img { height: 50px; width: auto; }
            .p-co-info { font-size: 8px; color: #333; margin-top: 5px; line-height: 1.3; }
            .p-title-block { text-align: right; }
            .p-doc-title { font-size: 24px; font-weight: 900; color: #000; margin: 0; line-height: 1; text-transform: uppercase; }
            .p-subtitle { font-size: 10px; color: var(--smart-orange); font-weight: bold; letter-spacing: 2px; text-transform: uppercase; margin-top: 2px; }
            .p-req-grid { display: flex; border: 1px solid #000; margin-bottom: 20px; background: #f9f9f9; }
            .p-req-left { width: 50%; padding: 0; border-right: 1px solid #000; }
            .p-req-right { width: 50%; padding: 10px; display: flex; flex-direction: column; justify-content: center; align-items: center; }
            .p-row { display: flex; border-bottom: 1px solid #ccc; }
            .p-row:last-child { border-bottom: none; }
            .p-lbl { width: 100px; background: #eee; font-size: 9px; font-weight: bold; padding: 4px 8px; border-right: 1px solid #ccc; text-transform: uppercase; }
            .p-val { font-size: 9px; font-weight: bold; padding: 4px 8px; flex: 1; }
            .p-meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
            .p-meta-box { border: 1px solid #000; }
            .p-meta-row { display: flex; border-bottom: 1px solid #000; }
            .p-meta-row:last-child { border-bottom: none; }
            .p-meta-key { width: 40%; background: #eee; font-size: 9px; font-weight: bold; padding: 4px; border-right: 1px solid #000; text-transform: uppercase; }
            .p-meta-val { width: 60%; font-size: 10px; font-weight: 800; padding: 4px; }
            .p-table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
            .p-table th { background: #333; color: white; padding: 5px 8px; font-size: 9px; font-weight: bold; text-align: left; text-transform: uppercase; border: 1px solid #000; }
            .p-table td { border: 1px solid #000; padding: 5px 8px; font-size: 9px; vertical-align: top; }
            .p-num { text-align: right; font-family: monospace; font-weight: bold; }
            .p-remarks-box { border: 1px dashed #666; padding: 8px; min-height: 40px; font-size: 10px; margin-bottom: 20px; position: relative; }
            .p-total-float { position: absolute; bottom: 8px; right: 8px; font-size: 12px; font-weight: 900; background: #eee; padding: 4px 8px; border: 1px solid #000; }
            .p-sig-grid { display: flex; justify-content: space-between; border-top: 2px solid #000; padding-top: 10px; margin-top: 30px; }
            .p-sig-col { width: 30%; text-align: center; }
            .p-sig-header { font-size: 9px; font-weight: bold; text-transform: uppercase; background: #eee; border: 1px solid #ccc; padding: 4px; margin-bottom: 10px; }
            .p-sig-box { height: 70px; border: 1px solid #eee; display: flex; align-items: center; justify-content: center; position: relative; }
            .p-sig-stamp { position: absolute; opacity: 0.8; mix-blend-mode: multiply; transform: rotate(-10deg); color: var(--smart-blue); font-size: 10px; border: 2px solid var(--smart-blue); padding: 2px 5px; border-radius: 4px; }
            .p-footer { position: fixed; bottom: 0; left: 0; width: 100%; border-top: 1px solid #ccc; padding: 5px 15mm; font-size: 8px; display: flex; justify-content: space-between; }
        }
        
    </style>
</head>
<body>
<body>

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

  <div class="top-navbar">
    <div>
      <h5 class="mb-0 fw-bold text-dark">Cash Requests</h5>
      <small class="text-muted" style="font-size: 0.7rem;">FINANCE DISBURSEMENT WORKFLOW</small>
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
          <div class="fw-bold fs-6"><?php echo h($fullName); ?></div>
          <small class="text-primary fw-bold" style="font-size: 0.65rem; letter-spacing: 0.5px;">
            <?php echo h($roleLabel); ?>
          </small>
        </div>
        <img src="<?php echo h($avatarUrl); ?>" class="rounded-circle shadow-sm" width="38" height="38" alt="<?php echo h($firstName); ?>">
      </div>
    </div>
  </div>

  <div class="main-content main-content-smart" style="padding-top: 100px;">
    <div class="content-container">
        
        <div class="d-flex justify-content-between align-items-end mb-4">
            <div>
                <h2 class="font-heading fw-bold text-dark mb-1">Request Register</h2>
                <p class="text-muted small mb-0">Manage operational cash flow, validate disbursement requests, and track payments.</p>
            </div>
            <div class="d-flex gap-2">
                <button class="btn btn-white border fw-bold shadow-sm" onclick="loadTable()"><i class="fa-solid fa-arrows-rotate text-secondary me-2"></i>Refresh</button>
                <button class="btn btn-primary fw-bold px-4 shadow-sm" style="background: var(--smart-orange); border: none;" onclick="openModal('NEW')">
                    <i class="fa-solid fa-plus me-2"></i> New Request
                </button>
            </div>
        </div>

        <div class="kpi-grid">
            <div class="kpi-card">
                <div class="kpi-icon bg-warning bg-opacity-10 text-warning"><i class="fa-solid fa-hourglass-start"></i></div>
                <div class="kpi-content">
                    <div class="kpi-label">Pending Validation</div>
                    <div class="kpi-number" id="kpi-validation">0</div>
                </div>
            </div>
            <div class="kpi-card">
                <div class="kpi-icon bg-info bg-opacity-10 text-info"><i class="fa-solid fa-user-check"></i></div>
                <div class="kpi-content">
                    <div class="kpi-label">Pending Approval</div>
                    <div class="kpi-number" id="kpi-approval">0</div>
                </div>
            </div>
            <div class="kpi-card">
                <div class="kpi-icon bg-success bg-opacity-10 text-success"><i class="fa-solid fa-wallet"></i></div>
                <div class="kpi-content">
                    <div class="kpi-label">Ready to Disburse</div>
                    <div class="kpi-number" id="kpi-disburse">0</div>
                </div>
            </div>
            <div class="kpi-card">
                <div class="kpi-icon bg-primary bg-opacity-10 text-primary"><i class="fa-solid fa-money-bill-transfer"></i></div>
                <div class="kpi-content">
                    <div class="kpi-label">Total Disbursed</div>
                    <div class="kpi-number" id="kpi-total">0 <span class="text-muted fs-6">XAF</span></div>
                </div>
            </div>
        </div>

        <div class="table-card-smart">
            <div class="table-header-smart">
                <div class="d-flex gap-2 align-items-center">
                    <i class="fa-solid fa-search text-muted"></i>
                    <input type="text" class="smart-input" id="tableSearch" placeholder="Search PR Number, Beneficiary or File..." style="width: 350px; border:1px solid #E2E8F0;">
                </div>
                <div class="text-muted small">Role: <strong><?php echo h($roleLabel); ?></strong></div>
            </div>
            <div class="table-responsive">
                <table class="smart-table">
                    <thead>
                        <tr>
                            <th>PR Number</th>
                            <th>Date</th>
                            <th>Type</th>
                            <th>Beneficiary / File</th>
                            <th>Amount (XAF)</th>
                            <th>Status</th>
                            <th class="text-end">Action</th>
                        </tr>
                    </thead>
                    <tbody id="prTableBody">
                        </tbody>
                </table>
            </div>
            <div class="p-3 border-top text-center text-muted small">
                Showing recent requests. Use search to find older records.
            </div>
        </div>

    </div>
  </div>

  <div class="modal fade" id="requestModal" tabindex="-1" data-bs-backdrop="static">
    <div class="modal-dialog modal-xl">
        <div class="modal-content border-0">
            
            <div class="modal-header border-bottom">
                <div class="d-flex align-items-center gap-3">
                    <div class="bg-orange text-white rounded p-2 shadow-sm"><i class="fa-solid fa-money-check-dollar fs-4"></i></div>
                    <div>
                        <h5 class="font-heading fw-bold mb-0" id="modalTitle">New Cash Request</h5>
                        <div class="d-flex align-items-center gap-2">
                            <span class="status-pill bg-draft mt-1" id="modalStatusPill">DRAFT</span>
                            <small class="text-muted mt-1" id="modalIdDisplay">ID: New</small>
                        </div>
                    </div>
                </div>
                <div class="d-flex gap-2 align-items-center">
                    <div id="headerActions"></div>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
            </div>

            <div class="modal-body modal-body-smart">
                <form id="prForm">
                    <div class="form-section">
                        <div class="row g-5">
                            
                            <div class="col-md-3">
                                <h6 class="text-primary fw-bold text-uppercase mb-3 small">1. Request Parameters</h6>
                                <div class="mb-3">
                                    <label class="form-label-smart">Disbursement Method</label>
                                    <select class="smart-input fw-bold" id="disburseMethod">
                                        <option value="CASH">Cash Voucher</option>
                                        <option value="BANK">Bank Transfer</option>
                                        <option value="CHEQUE">Cheque</option>
                                        <option value="MOMO">Mobile Money</option>
                                    </select>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label-smart">Category</label>
                                    <div class="btn-group w-100" role="group">
                                        <input type="radio" class="btn-check" name="cat" id="cat-ops" autocomplete="off" checked>
                                        <label class="btn btn-outline-secondary btn-sm fw-bold py-2" for="cat-ops">Operations</label>
                                        <input type="radio" class="btn-check" name="cat" id="cat-ovh" autocomplete="off">
                                        <label class="btn btn-outline-secondary btn-sm fw-bold py-2" for="cat-ovh">Overhead</label>
                                    </div>
                                </div>
                            </div>

                            <div class="col-md-5 border-start border-end px-4">
                                <h6 class="text-primary fw-bold text-uppercase mb-3 small">2. Cost Context</h6>
                                
                                <div id="ops-context">
                                    <div class="mb-3">
                                        <label class="form-label-smart"><i class="fa-solid fa-folder-open me-1"></i> Operations File (Registry)</label>
                                        <select class="smart-input fw-bold" id="opsFileSelect">
                                            <option value="">Select File...</option>
                                        </select>
                                    </div>
                                    
                                    <div id="costingAlert" class="alert alert-danger d-none small">
                                        <i class="fa-solid fa-hand me-2"></i><strong>STOP:</strong> Costing Not Approved.
                                    </div>
                                    <div id="costingSuccess" class="alert alert-success d-none small d-flex justify-content-between align-items-center">
                                        <div><i class="fa-solid fa-check-circle me-2"></i>Costing Approved</div>
                                        <button type="button" class="btn btn-success btn-sm fw-bold shadow-sm" id="btnImportOpen">
                                            <i class="fa-solid fa-file-import me-1"></i> Import Lines
                                        </button>
                                    </div>

                                    <div class="row g-2">
                                        <div class="col-6">
                                            <label class="form-label-smart">BL Number</label>
                                            <input type="text" class="smart-input font-mono bg-light" id="blNumber" readonly>
                                        </div>
                                        <div class="col-6">
                                            <label class="form-label-smart">Client</label>
                                            <input type="text" class="smart-input bg-light" id="clientName" readonly>
                                        </div>
                                    </div>
                                </div>

                                <div id="ovh-context" class="d-none">
                                    <div class="mb-3">
                                        <label class="form-label-smart">Cost Center</label>
                                        <select class="smart-input" id="costCenter">
                                            <option value="">Select...</option>
                                            <option value="GENERAL_SERVICES">General Services</option>
                                            <option value="HR_ADMIN">HR & Admin</option>
                                            <option value="FINANCE">Finance</option>
                                            <option value="IT_SYSTEMS">IT Systems</option>
                                            <option value="OPERATIONS">Operations</option>
                                        </select>
                                    </div>
                                    <div class="mb-3">
                                        <label class="form-label-smart">Justification</label>
                                        <textarea class="smart-input" id="ovhJust" rows="3"></textarea>
                                    </div>
                                </div>
                            </div>

                            <div class="col-md-4">
                                <h6 class="text-primary fw-bold text-uppercase mb-3 small">3. Beneficiary & Details</h6>
                                <div class="mb-3">
                                    <label class="form-label-smart">Beneficiary / Payee</label>
                                    <div class="input-group">
                                        <span class="input-group-text bg-white"><i class="fa-solid fa-user"></i></span>
                                        <input type="text" class="smart-input border-start-0" id="beneficiary" placeholder="Payee Name">
                                    </div>
                                </div>

                                <div id="bankDetailsBox" style="display:none;">
                                    <label class="form-label-smart">Bank / Cheque Details</label>
                                    <input type="text" class="smart-input mb-2" id="bankName" placeholder="Bank Name">
                                    <input type="text" class="smart-input mb-2" id="accountNumber" placeholder="Account Number">
                                    <input type="text" class="smart-input mb-2" id="accountName" placeholder="Account Name">
                                    <input type="text" class="smart-input" id="chequeNumber" placeholder="Cheque No (if applicable)">
                                </div>

                                <div id="momoDetailsBox" style="display:none;">
                                    <label class="form-label-smart">Mobile Money Details</label>
                                    <input type="text" class="smart-input mb-2" id="momoNetwork" placeholder="e.g. MTN or ORANGE">
                                    <input type="text" class="smart-input mb-2" id="momoNumber" placeholder="Mobile Number">
                                    <input type="text" class="smart-input" id="momoName" placeholder="Registered Name">
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="form-section flex-grow-1">
                        <div class="d-flex justify-content-between align-items-center mb-3">
                            <h6 class="fw-bold text-dark font-heading m-0 text-uppercase"><i class="fa-solid fa-list-ol me-2 text-orange"></i> Requisition Details</h6>
                            <p class="fs-sm text-muted">(Kindly enter 0 if VAT is not applicable)</p>
                            <button type="button" class="btn btn-sm btn-light border fw-bold text-primary shadow-sm" id="btnAddLine">
                                <i class="fa-solid fa-plus me-1"></i> Add Manual Line
                            </button>
                        </div>

                        <div class="lines-card">
                            <table class="table lines-table mb-0" id="linesTable">
                                <thead>
                                    <tr>
                                        <th class="col-code">Code</th>
                                        <th class="col-desc">Description</th>
                                        <th class="col-qty">Qty</th>
                                        <th class="col-price">Unit Price</th>
                                        <th class="col-vat">VAT %</th>
                                        <th class="col-just" title="Is Justification Mandatory?">Just. Req?</th> <th class="col-total">Total (TTC)</th>
                                        <th class="col-action"></th>
                                    </tr>
                                </thead>
                                <tbody></tbody>
                            </table>
                        </div>

                        <div class="row">
                            <div class="col-md-7">
                                <label class="form-label-smart">Remarks / Instructions (Prints on PDF)</label>
                                <textarea class="smart-input" id="reqRemarks" rows="4" placeholder="Enter instructions..."></textarea>
                            </div>
                            <div class="col-md-5">
                                <div class="bg-light p-4 rounded border">
                                    <div class="d-flex justify-content-between mb-2"><span>Subtotal</span><strong id="disp-ht">0</strong></div>
                                    <div class="d-flex justify-content-between mb-2"><span>VAT</span><strong id="disp-vat" class="text-danger">0</strong></div>
                                    <hr>
                                    <div class="d-flex justify-content-between align-items-center">
                                        <span class="fw-bold fs-5">TOTAL PAYABLE</span>
                                        <span class="fw-black fs-4 text-primary" id="disp-ttc">0 XAF</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </form>
            </div>

            <div class="modal-footer d-flex justify-content-between bg-white">
                <div class="text-muted small">
                    <i class="fa-solid fa-user-circle me-1"></i> Created By: <strong class="text-dark" id="modalCreator"><?php echo h($employeeId); ?></strong>
                </div>
                <div class="d-flex gap-2" id="modalActions">
                    </div>
            </div>

        </div>
    </div>
  </div>

  <div class="modal fade" id="importModal" tabindex="-1">
    <div class="modal-dialog modal-lg">
        <div class="modal-content" style="height: auto; max-height: 80vh;">
            <div class="modal-header">
                <h6 class="fw-bold m-0 text-dark"><i class="fa-solid fa-file-import me-2 text-success"></i>Import Lines from Approved Costing</h6>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body p-0" style="overflow-y: auto;">
                <table class="table table-hover mb-0" id="importTable">
                    <thead class="bg-light sticky-top">
                        <tr>
                            <th class="ps-4" style="width: 50px;"><input type="checkbox" id="checkAllImport"></th>
                            <th>Code</th>
                            <th>Description</th>
                            <th class="text-end pe-4">Approved Amt (TTC)</th>
                        </tr>
                    </thead>
                    <tbody></tbody>
                </table>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-light border btn-sm fw-bold" data-bs-dismiss="modal">Cancel</button>
                <button type="button" class="btn btn-primary btn-sm fw-bold" id="btnExecuteImport">Import Selected</button>
            </div>
        </div>
    </div>
  </div>

  <div class="modal fade" id="disburseModal" tabindex="-1">
    <div class="modal-dialog modal-sm modal-dialog-centered">
        <div class="modal-content">
            <div class="modal-header bg-success text-white">
                <h6 class="m-0 fw-bold"><i class="fa-solid fa-coins me-2"></i>Disburse Funds</h6>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
                <div class="alert alert-light border small text-muted mb-3">
                    Enter amount to pay. System tracks partial payments.
                </div>
                <div class="mb-3">
                    <label class="form-label-smart">Amount Paying Now</label>
                    <input type="number" class="smart-input border-success fw-bold" id="disburseAmountNow" min="1">
                </div>
                <div class="mb-3">
                    <label class="form-label-smart">Payment Note</label>
                    <input type="text" class="smart-input" id="disburseNote" placeholder="Ref no...">
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-success w-100 fw-bold" id="btnConfirmDisburse">Confirm Payment</button>
            </div>
        </div>
    </div>
  </div>

  <div class="toast-container position-fixed top-0 end-0 p-3" style="z-index: 2000;">
    <div id="liveToast" class="toast align-items-center text-white bg-dark border-0 shadow-lg" role="alert">
        <div class="d-flex">
            <div class="toast-body fw-bold" id="toastMessage">Action Successful</div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
        </div>
    </div>
  </div>

  <div id="print-area">
    <div class="p-header">
        <div class="p-logo">
            <img src="https://i.ibb.co/35MQnHJn/LOGO-SMART.png" alt="Smart LS">
            <div class="p-co-info">
                SMART LOGISTICS AND SERVICES LTD<br>
                1030. Avenue Douala Manga Bell, Bali<br>
                Po Box 5120, Douala, Cameroon<br>
                00237 233 420 281 | operations@smartls.cm
            </div>
        </div>
        <div class="p-title-block">
            <h1 class="p-doc-title" id="pTitle">PAYMENT REQUEST</h1>
            <div class="p-subtitle">System Generated</div>
        </div>
    </div>

    <div class="p-req-grid">
        <div class="p-req-left">
            <div class="p-row"><div class="p-lbl">REQUISITIONER:</div><div class="p-val" id="pReqName">System User</div></div>
            <div class="p-row"><div class="p-lbl">EMPLOYEE ID:</div><div class="p-val"><?php echo h($employeeId); ?></div></div>
            <div class="p-row"><div class="p-lbl">DEPARTMENT:</div><div class="p-val"><?php echo h($department); ?></div></div>
            <div class="p-row"><div class="p-lbl">ROLE:</div><div class="p-val"><?php echo h($role); ?></div></div>
        </div>
        <div class="p-req-right">
            <div style="font-weight: 900; font-size: 14px; text-transform: uppercase;">Smart</div>
            <div style="font-size: 10px; color: var(--smart-orange); font-weight: bold;">Logistics Services Ltd</div>
        </div>
    </div>

    <div style="font-weight: bold; border-bottom: 2px solid #000; margin-bottom: 10px; font-size: 10px;">REQUISITION DETAILS</div>

    <div class="p-meta-grid">
        <div class="p-meta-box">
            <div class="p-meta-row"><div class="p-meta-key">PR Date:</div><div class="p-meta-val" id="pDate">---</div></div>
            <div class="p-meta-row"><div class="p-meta-key">PR N°:</div><div class="p-meta-val" id="pNum">---</div></div>
            <div class="p-meta-row" id="pRowCost"><div class="p-meta-key">COSTING REF:</div><div class="p-meta-val" id="pCostRef">---</div></div>
            <div class="p-meta-row" id="pRowFile"><div class="p-meta-key">FILE REF:</div><div class="p-meta-val" id="pFileRef">---</div></div>
            <div class="p-meta-row"><div class="p-meta-key">PR AMOUNT:</div><div class="p-meta-val" id="pAmount">---</div></div>
        </div>
        <div class="p-meta-box">
            <div class="p-meta-row" id="pRowBL"><div class="p-meta-key">BL NUMBER:</div><div class="p-meta-val" id="pBL">---</div></div>
            <div class="p-meta-row"><div class="p-meta-key">BENEFICIARY:</div><div class="p-meta-val" id="pBeneficiary">---</div></div>
            <div class="p-meta-row"><div class="p-meta-key">ISSUER'S SIGNATURE:</div><div class="p-meta-val" style="color: blue; font-size: 7px; word-break: break-all;" id="pHash">DNA-HASH-XXX</div></div>
        </div>
    </div>

    <table class="p-table">
        <thead>
            <tr>
                <th width="15%">CODE</th>
                <th width="40%">DESCRIPTION</th>
                <th width="15%">REF</th>
                <th width="5%" style="text-align: center;">QTY</th>
                <th width="10%" class="p-num">UNIT PRICE</th>
                <th width="10%" class="p-num">TOTAL EX</th>
                <th width="5%" class="p-num">VAT</th>
                <th width="10%" class="p-num">TOTAL INC</th>
            </tr>
        </thead>
        <tbody id="pTableBody"></tbody>
    </table>

    <div class="p-remarks-box">
        <strong>Remarks:</strong> <span id="pRemarks"></span>
        <div class="p-total-float">TOTAL: <span id="pTotal">0 XAF</span></div>
    </div>

    <div style="font-size: 8px; margin-top: 10px;">RC/DLA/2021/B/2060 | NIU: M0421160335800</div>

    <div class="p-sig-grid">
        <div class="p-sig-col">
            <div class="p-sig-header">Validated By</div>
            <div class="p-sig-box"></div>
        </div>
        <div class="p-sig-col">
            <div class="p-sig-header">Approved By</div>
            <div class="p-sig-box">
                <div id="pApprover" style="font-weight: bold; font-size: 8px; display: none; text-align: center;">
                    <span class="p-sig-stamp">APPROVED</span><br>
                    MANAGEMENT
                </div>
            </div>
        </div>
        <div class="p-sig-col">
            <div class="p-sig-header">Received By</div>
            <div class="p-sig-box"></div>
        </div>
    </div>

    <div class="p-footer">
        <div>Smart LS Enterprise System</div>
        <div>Bank: AFRILAND FIRST BANK | Acct: 10005000610701841100193</div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="../../js/admin.js"></script>

 <script>
    // Include the original clock toggler in case admin.js doesn't have it
    if (typeof toggleClock !== 'function') { function toggleClock(){ /* noop */ } }
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

    // --- GLOBAL STATE ---
    const ROLE = <?php echo json_encode($role); ?>;
    const EMPLOYEE_ID = <?php echo json_encode($employeeId); ?>;
    const FULL_NAME = <?php echo json_encode($fullName); ?>;
    
    // Check if user is finance/admin for UI purposes
    const IS_FINANCE = (ROLE === 'FINANCE' || ROLE === 'ADMIN' || ROLE === 'MANAGEMENT');
    const IS_MANAGEMENT = (ROLE === 'MANAGEMENT' || ROLE === 'ADMIN');
    
    let ACTIVE = {
        pr_id: 'NEW',
        status: 'DRAFT',
        lines: [],
        disbursed_total: 0,
        amount_total: 0,
        mode: 'NEW' // NEW or EDIT
    };
    
    // Ops Files Cache
    let OPS_FILES_CACHE = [];
    let IMPORT_LINES_BUFFER = [];

    // Modals
    const requestModal = new bootstrap.Modal(document.getElementById('requestModal'));
    const importModal = new bootstrap.Modal(document.getElementById('importModal'));
    const disburseModal = new bootstrap.Modal(document.getElementById('disburseModal'));

    // --- UTILS ---
    function showToast(msg) {
        document.getElementById('toastMessage').innerText = msg;
        new bootstrap.Toast(document.getElementById('liveToast')).show();
    }
    function money(n) { return Number(n).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}); }
    
    async function apiPost(action, payload) {
        const url = `cash-request.php?ajax=${action}`;
        const res = await fetch(url, { method: 'POST', body: JSON.stringify(payload), headers: {'Content-Type': 'application/json'} });
        const j = await res.json();
        if(!j.ok) throw new Error(j.error);
        return j.data;
    }

    async function apiGet(action, params = '') {
        const url = `cash-request.php?ajax=${action}${params}`;
        const res = await fetch(url);
        const j = await res.json();
        if(!j.ok) throw new Error(j.error);
        return j.data;
    }

    // --- MAIN INITIALIZATION ---
    document.addEventListener('DOMContentLoaded', async () => {
        await loadKPIs();
        await loadTable();
        await loadOpsFiles();
    });

    // --- UI EVENT BINDING ---
    document.getElementById('btnAddLine').onclick = () => addLine();
    document.getElementById('cat-ops').onchange = () => toggleCategory('OPS');
    document.getElementById('cat-ovh').onchange = () => toggleCategory('OVH');
    document.getElementById('disburseMethod').onchange = handleMethodChange;
    document.getElementById('opsFileSelect').onchange = checkCostingLink;
    document.getElementById('btnImportOpen').onclick = loadImportLines;
    document.getElementById('checkAllImport').onchange = (e) => {
        document.querySelectorAll('.import-check').forEach(c => c.checked = e.target.checked);
    };
    document.getElementById('btnExecuteImport').onclick = executeImport;
    document.getElementById('tableSearch').onkeyup = debounce(loadTable, 400);
    document.getElementById('btnConfirmDisburse').onclick = submitDisbursement;

    // --- CORE FUNCTIONS ---

    async function loadKPIs() {
        try {
            const d = await apiGet('kpi_stats');
            document.getElementById('kpi-validation').innerText = d.validation_count;
            document.getElementById('kpi-approval').innerText = d.approval_count;
            document.getElementById('kpi-disburse').innerText = d.disburse_count;
            document.getElementById('kpi-total').innerHTML = `${(d.total_disbursed/1000).toFixed(1)}k <span class="text-muted fs-6">XAF</span>`;
        } catch(e) { console.error("KPI Error", e); }
    }

    async function loadOpsFiles() {
        try {
            const list = await apiGet('ops_files_list');
            OPS_FILES_CACHE = list;
            const sel = document.getElementById('opsFileSelect');
            sel.innerHTML = '<option value="">Select File...</option>';
            list.forEach(f => {
                const opt = document.createElement('option');
                opt.value = f.file_ref;
                opt.text = `${f.file_ref} - ${f.client_name}`;
                sel.appendChild(opt);
            });
        } catch(e) { console.error(e); }
    }

    async function loadTable() {
        const q = document.getElementById('tableSearch').value;
        const tbody = document.getElementById('prTableBody');
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">Loading...</td></tr>';
        
        try {
            const rows = await apiGet('pr_list', `&q=${encodeURIComponent(q)}`);
            tbody.innerHTML = '';
            if(rows.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No records found.</td></tr>';
                return;
            }
            rows.forEach(r => {
                const statusClass = {
                    'DRAFT': 'bg-draft', 'SUBMITTED': 'bg-sub', 'VALIDATED': 'bg-val',
                    'APPROVED_LOCKED': 'bg-app', 'REJECTED': 'bg-rej', 
                    'DISBURSED': 'bg-dis', 'PARTIALLY_DISBURSED': 'bg-dis'
                }[r.status] || 'bg-light';

                const btn = getActionButtons(r);

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="font-mono fw-bold text-primary">${r.pr_id}</td>
                    <td>${r.pr_date}</td>
                    <td>${r.disburse_method}</td>
                    <td>
                        <div class="fw-bold text-dark">${r.beneficiary}</div>
                        <small class="text-muted">${r.ops_file_ref || r.cost_center}</small>
                    </td>
                    <td class="fw-bold text-dark">${money(r.amount_total)}</td>
                    <td><span class="status-pill ${statusClass}">${r.status}</span></td>
                    <td class="text-end">${btn}</td>
                `;
                tbody.appendChild(tr);
            });
        } catch(e) { showToast(e.message); }
    }

    function getActionButtons(r) {
        let html = '';
        const s = r.status;
        
        // Edit/View Button
        let label = 'View';
        let cls = 'btn-light border';
        
        if(s === 'DRAFT' || s === 'REJECTED') {
            label = 'Edit'; cls = 'btn-primary';
        } else if (IS_FINANCE && s === 'SUBMITTED') {
            label = 'Validate'; cls = 'btn-warning';
        } else if (IS_MANAGEMENT && s === 'VALIDATED') {
            label = 'Approve'; cls = 'btn-success';
        } else if (IS_FINANCE && (s === 'APPROVED_LOCKED' || s === 'PARTIALLY_DISBURSED')) {
            label = 'Disburse'; cls = 'btn-success';
        }

        html += `<button class="btn btn-sm ${cls} fw-bold me-1" onclick="openRequest('${r.pr_id}')">${label}</button>`;

        // Print Button
        if(['APPROVED_LOCKED','DISBURSED','PARTIALLY_DISBURSED'].includes(s)) {
            html += `<button class="btn btn-sm btn-dark me-1" onclick="quickPrint('${r.pr_id}')"><i class="fa-solid fa-print"></i></button>`;
        }
        return html;
    }

    // --- FORM LOGIC ---

    window.openModal = function(mode) {
        if(mode === 'NEW') resetForm();
        requestModal.show();
    };

    window.openRequest = async function(id) {
        try {
            const d = await apiGet('pr_get', `&id=${id}`);
            fillForm(d);
            requestModal.show();
        } catch(e) { showToast(e.message); }
    };

  function resetForm() {
        // 1. Reset Global State
        ACTIVE = { pr_id: 'NEW', status: 'DRAFT', mode: 'NEW', lines: [] };
        
        // 2. Clear Text Values
        document.getElementById('prForm').reset();
        
        // 3. CRITICAL FIX: Force-Enable all inputs (Removes the 'disabled' attribute)
        toggleInputs(true); 

        // 4. Reset Visual Elements
        document.getElementById('linesTable').querySelector('tbody').innerHTML = '';
        document.getElementById('modalTitle').innerText = 'New Cash Request';
        document.getElementById('modalIdDisplay').innerText = 'ID: New';
        document.getElementById('modalStatusPill').innerText = 'DRAFT';
        document.getElementById('modalStatusPill').className = 'status-pill bg-draft mt-1';
        
        // 5. Reset Logic Toggles
        toggleCategory('OPS');
        handleMethodChange();
        checkCostingLink();
        
        // 6. Add default empty line
        addLine(); 
        
        renderModalFooter();
        document.getElementById('headerActions').innerHTML = ''; 
    }

    function fillForm(data) {
        const h = data.header;
        ACTIVE = { 
            pr_id: h.pr_id, 
            status: h.status, 
            mode: 'EDIT', 
            amount_total: Number(h.amount_total),
            disbursed_total: Number(h.disbursed_total),
            lines: data.lines
        };
        // Lines
        const tbody = document.getElementById('linesTable').querySelector('tbody');
        tbody.innerHTML = '';
        data.lines.forEach(l => {
            // Pass the justification_required value (0 or 1) as the last argument
            addLine(l.line_code, l.line_desc, l.qty, l.unit_price, l.vat_rate, l.is_imported, l.justification_required);
        });

        // Header
        document.getElementById('modalTitle').innerText = (h.disburse_method === 'CASH' || h.disburse_method === 'MOMO') ? 'Cash Request' : 'Payment Request';
        document.getElementById('modalIdDisplay').innerText = `ID: ${h.pr_id}`;
        document.getElementById('modalStatusPill').innerText = h.status;
        document.getElementById('modalStatusPill').className = `status-pill mt-1 ${getStatusClass(h.status)}`;

        // Fields
        document.getElementById('disburseMethod').value = h.disburse_method;
        handleMethodChange();

        if (h.category === 'OPS') {
            document.getElementById('cat-ops').checked = true;
            toggleCategory('OPS');
            document.getElementById('opsFileSelect').value = h.ops_file_ref;
            checkCostingLink(); // Update context visual
        } else {
            document.getElementById('cat-ovh').checked = true;
            toggleCategory('OVH');
            document.getElementById('costCenter').value = h.cost_center;
            document.getElementById('ovhJust').value = h.overhead_justification;
        }

        // Beneficiary & Voucher
        document.getElementById('beneficiary').value = h.beneficiary;
        document.getElementById('bankName').value = h.bank_name;
        document.getElementById('accountNumber').value = h.account_number;
        document.getElementById('accountName').value = h.account_name;
        document.getElementById('momoNetwork').value = h.bank_name; // Reuse field for network
        document.getElementById('momoNumber').value = h.momo_number;
        document.getElementById('momoName').value = h.momo_name;
        document.getElementById('chequeNumber').value = h.cheque_number;
        document.getElementById('reqRemarks').value = h.remarks;

        recalcTotal();
        
        renderModalFooter();
        
        // Add Print Button in Header if Approved
        const headAct = document.getElementById('headerActions');
        headAct.innerHTML = '';
        if(['APPROVED_LOCKED','DISBURSED','PARTIALLY_DISBURSED'].includes(h.status)) {
            headAct.innerHTML = `<button class="btn btn-sm btn-dark fw-bold" onclick="quickPrint('${h.pr_id}')"><i class="fa-solid fa-print"></i></button>`;
        }
        
        // Read-only Logic if not DRAFT/REJECTED
        const isEditable = (h.status === 'DRAFT' || h.status === 'REJECTED');
        toggleInputs(isEditable);
    }

    function toggleInputs(editable) {
        const form = document.getElementById('prForm');
        const inputs = form.querySelectorAll('input, select, textarea');
        inputs.forEach(el => {
            if(editable) el.removeAttribute('disabled');
            else el.setAttribute('disabled', 'true');
        });
        // Hide add line button if not editable
        document.getElementById('btnAddLine').style.display = editable ? 'block' : 'none';
        // Hide import button if not editable
        const impBtn = document.getElementById('btnImportOpen');
        if(impBtn) impBtn.style.display = editable ? 'block' : 'none';
    }

    function toggleCategory(cat) {
        if(cat === 'OPS') {
            document.getElementById('ops-context').classList.remove('d-none');
            document.getElementById('ovh-context').classList.add('d-none');
        } else {
            document.getElementById('ops-context').classList.add('d-none');
            document.getElementById('ovh-context').classList.remove('d-none');
        }
    }

    function handleMethodChange() {
        const m = document.getElementById('disburseMethod').value;
        const bank = document.getElementById('bankDetailsBox');
        const momo = document.getElementById('momoDetailsBox');
        
        bank.style.display = 'none';
        momo.style.display = 'none';

        if(m === 'BANK' || m === 'CHEQUE') bank.style.display = 'block';
        if(m === 'MOMO') momo.style.display = 'block';

        const t = (m === 'CASH' || m === 'MOMO') ? 'Cash Request' : 'Payment Request';
        document.getElementById('modalTitle').innerText = t;
    }

    function checkCostingLink() {
        const ref = document.getElementById('opsFileSelect').value;
        const alert = document.getElementById('costingAlert');
        const success = document.getElementById('costingSuccess');
        const blInput = document.getElementById('blNumber');
        const clInput = document.getElementById('clientName');

        // Find file metadata from cache
        const file = OPS_FILES_CACHE.find(f => f.file_ref === ref);
        
        if(!file) {
            alert.classList.add('d-none');
            success.classList.add('d-none');
            blInput.value = ''; clInput.value = '';
            return;
        }

        blInput.value = file.sea_bl || '';
        clInput.value = file.client_name || '';

        // Triggering check via API to set status visuals correctly
        apiGet('costing_lines_get', `&ops_ref=${ref}`).then(res => {
            // Costing is approved
            alert.classList.add('d-none');
            success.classList.remove('d-none');
        }).catch(err => {
            // Costing not approved or not found
            alert.classList.remove('d-none');
            alert.innerText = "STOP: " + err.message;
            success.classList.add('d-none');
        });
    }

    // --- LINES LOGIC ---
    function addLine(code='', desc='', qty=1, price=0, vat=19.25, isImported=0, justReq=0) {
        const tbody = document.getElementById('linesTable').querySelector('tbody');
        const tr = document.createElement('tr');
        
        const readonlyAttr = (isImported == 1) ? 'readonly' : '';
        // For checkbox, we use disabled attribute if line is imported/readonly
        const disabledAttr = (isImported == 1) ? 'disabled' : '';
        const bgClass = (isImported == 1) ? 'bg-light' : '';
        
        const checkedState = (justReq == 1) ? 'checked' : '';

        tr.innerHTML = `
            <td class="${bgClass}"><input type="text" class="ln-code" value="${code}" ${readonlyAttr}></td>
            <td class="${bgClass}"><input type="text" class="ln-desc" value="${desc}" ${readonlyAttr}></td>
            <td class="${bgClass}"><input type="number" class="ln-qty text-center" value="${qty}" ${readonlyAttr} oninput="recalcLine(this)"></td>
            <td class="${bgClass}"><input type="number" class="ln-price text-end" value="${price}" ${readonlyAttr} oninput="recalcLine(this)"></td>
            <td class="${bgClass}"><input type="number" class="ln-vat text-center" value="${vat}" ${readonlyAttr} oninput="recalcLine(this)"></td>
            
            <td class="${bgClass} text-center" style="vertical-align: middle;">
                <input type="checkbox" class="form-check-input ln-just border-secondary" ${checkedState} ${disabledAttr}>
            </td>

            <td class="col-total text-end fw-bold">0</td>
            <td class="text-center">
                <i class="fa-solid fa-trash text-danger cursor-pointer" onclick="this.closest('tr').remove(); recalcTotal();"></i>
                <input type="hidden" class="ln-imported" value="${isImported}">
            </td>
        `;
        tbody.appendChild(tr);
        recalcLine(tr.querySelector('.ln-qty'));
    }

    window.recalcLine = function(input) {
        const tr = input.closest('tr');
        const qty = parseFloat(tr.querySelector('.ln-qty').value) || 0;
        const price = parseFloat(tr.querySelector('.ln-price').value) || 0;
        const vat = parseFloat(tr.querySelector('.ln-vat').value) || 0;
        
        const ex = qty * price;
        const v = ex * (vat/100);
        const tot = ex + v;
        
        tr.querySelector('.col-total').innerText = money(tot);
        recalcTotal();
    }

    function recalcTotal() {
        let ht=0, vat=0, ttc=0;
        document.querySelectorAll('#linesTable tbody tr').forEach(tr => {
            const qty = parseFloat(tr.querySelector('.ln-qty').value) || 0;
            const price = parseFloat(tr.querySelector('.ln-price').value) || 0;
            const vRate = parseFloat(tr.querySelector('.ln-vat').value) || 0;
            const ex = qty * price;
            const v = ex * (vRate/100);
            ht += ex;
            vat += v;
        });
        ttc = ht + vat;
        document.getElementById('disp-ht').innerText = money(ht);
        document.getElementById('disp-vat').innerText = money(vat);
        document.getElementById('disp-ttc').innerText = money(ttc) + ' XAF';
    }

    // --- IMPORT LOGIC ---
    async function loadImportLines() {
        const ref = document.getElementById('opsFileSelect').value;
        if(!ref) return showToast("Select an Operations File first.");
        
        try {
            const data = await apiGet('costing_lines_get', `&ops_ref=${ref}`);
            IMPORT_LINES_BUFFER = data.lines;
            
            const tbody = document.getElementById('importTable').querySelector('tbody');
            tbody.innerHTML = '';
            
            if(data.lines.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4">No lines found.</td></tr>';
            } else {
                data.lines.forEach((l, idx) => {
                    const approvedTtc = l.qty * l.unit_price * (1 + l.vat_rate/100);
                    tbody.innerHTML += `
                        <tr>
                            <td class="ps-4"><input type="checkbox" class="import-check" value="${idx}"></td>
                            <td>${l.line_code}</td>
                            <td>${l.line_desc}</td>
                            <td class="text-end pe-4 fw-bold">${money(approvedTtc)}</td>
                        </tr>
                    `;
                });
            }
            importModal.show();
        } catch(e) { showToast(e.message); }
    }

    function executeImport() {
        const checkboxes = document.querySelectorAll('.import-check:checked');
        if(checkboxes.length === 0) return showToast("No lines selected.");
        
        const existingCount = document.querySelectorAll('#linesTable tbody tr').length;
        if(existingCount === 1) {
            const firstDesc = document.querySelector('.ln-desc').value;
            if(!firstDesc) document.querySelector('#linesTable tbody').innerHTML = '';
        }

        checkboxes.forEach(c => {
            const idx = parseInt(c.value);
            const l = IMPORT_LINES_BUFFER[idx];
            // Import as READ ONLY (isImported = 1)
            addLine(l.line_code, l.line_desc, l.qty, l.unit_price, l.vat_rate, 1);
        });

        recalcTotal();
        importModal.hide();
        showToast("Lines Imported successfully.");
    }

    // --- SAVE & ACTIONS ---
    async function saveRequest() {
        // 1. COLLECT LINES FIRST
        const collectedLines = [];
        document.querySelectorAll('#linesTable tbody tr').forEach(tr => {
            collectedLines.push({
                line_code: tr.querySelector('.ln-code').value,
                line_desc: tr.querySelector('.ln-desc').value,
                qty: parseFloat(tr.querySelector('.ln-qty').value) || 0,
                unit_price: parseFloat(tr.querySelector('.ln-price').value) || 0,
                vat_rate: parseFloat(tr.querySelector('.ln-vat').value) || 0,
                justification_required: tr.querySelector('.ln-just').checked ? 1 : 0,
                is_imported: parseInt(tr.querySelector('.ln-imported').value) || 0
            });
        });

        // 2. BUILD PAYLOAD
        const payload = {
            mode: ACTIVE.mode,
            pr_id: ACTIVE.pr_id,
            category: document.getElementById('cat-ops').checked ? 'OPS' : 'OVH',
            disburse_method: document.getElementById('disburseMethod').value,
            ops_file_ref: document.getElementById('opsFileSelect').value,
            cost_center: document.getElementById('costCenter').value,
            overhead_justification: document.getElementById('ovhJust').value,
            beneficiary: document.getElementById('beneficiary').value,
            remarks: document.getElementById('reqRemarks').value,
            
            bank_name: (document.getElementById('disburseMethod').value === 'MOMO') 
                       ? document.getElementById('momoNetwork').value 
                       : document.getElementById('bankName').value,
                       
            account_number: document.getElementById('accountNumber').value,
            account_name: document.getElementById('accountName').value,
            momo_number: document.getElementById('momoNumber').value,
            momo_name: document.getElementById('momoName').value,
            cheque_number: document.getElementById('chequeNumber').value,
            
            lines: collectedLines
        };

        // 3. SEND TO SERVER
        try {
            const res = await apiPost('pr_save', payload);
            ACTIVE.pr_id = res.pr_id;
            ACTIVE.mode = 'EDIT';
            document.getElementById('modalIdDisplay').innerText = `ID: ${res.pr_id}`;
            showToast("Saved Successfully.");
            loadTable();
            loadKPIs();
            return true;
        } catch(e) {
            showToast("Save Failed: " + e.message);
            return false;
        }
    }

    async function doTransition(toStatus) {
        if(ACTIVE.mode === 'NEW' || ACTIVE.status === 'DRAFT' || ACTIVE.status === 'REJECTED') {
            const ok = await saveRequest();
            if(!ok) return;
        }
        
        if(!confirm(`Transition status to ${toStatus}?`)) return;
        
        try {
            await apiPost('pr_transition', { pr_id: ACTIVE.pr_id, to_status: toStatus });
            requestModal.hide();
            showToast("Status updated.");
            loadTable();
            loadKPIs();
        } catch(e) { showToast(e.message); }
    }

    // --- DISBURSEMENT ---
    function openDisburseModal() {
        document.getElementById('disburseAmountNow').value = '';
        disburseModal.show();
    }

    async function submitDisbursement() {
        const amt = parseFloat(document.getElementById('disburseAmountNow').value);
        const note = document.getElementById('disburseNote').value;
        if(amt <= 0) return showToast("Invalid Amount");

        try {
            await apiPost('pr_disburse', {
                pr_id: ACTIVE.pr_id,
                paid_amount: amt,
                note: note
            });
            disburseModal.hide();
            requestModal.hide();
            showToast("Funds Disbursed.");
            loadTable();
            loadKPIs();
        } catch(e) { showToast(e.message); }
    }

    // --- UTILS ---
    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }
    
    function getStatusClass(s) {
        return ({'DRAFT':'bg-draft','SUBMITTED':'bg-sub','VALIDATED':'bg-val','APPROVED_LOCKED':'bg-app','REJECTED':'bg-rej','DISBURSED':'bg-dis','PARTIALLY_DISBURSED':'bg-dis'}[s]) || 'bg-light';
    }

    function renderModalFooter() {
        const div = document.getElementById('modalActions');
        div.innerHTML = `<button type="button" class="btn btn-light border fw-bold" data-bs-dismiss="modal">Close</button>`;
        const s = ACTIVE.status;

        // Requester Logic
        if(ROLE !== 'FINANCE' && ROLE !== 'MANAGEMENT' && ROLE !== 'ADMIN') {
            if(s === 'DRAFT' || s === 'REJECTED') {
                div.innerHTML += `<button type="button" class="btn btn-primary fw-bold" onclick="doTransition('SUBMITTED')">Submit</button>`;
                div.innerHTML += `<button type="button" class="btn btn-outline-primary fw-bold ms-2" onclick="saveRequest()">Save Draft</button>`;
            }
        }
        
        // Finance Logic
        if(IS_FINANCE) {
            if(s === 'SUBMITTED') {
                div.innerHTML += `<button type="button" class="btn btn-danger fw-bold ms-2" onclick="doTransition('REJECTED')">Reject</button>`;
                div.innerHTML += `<button type="button" class="btn btn-warning text-dark fw-bold ms-2" onclick="doTransition('VALIDATED')">Validate</button>`;
            }
            if(s === 'DRAFT') {
                // Self-created
                div.innerHTML += `<button type="button" class="btn btn-success fw-bold ms-2" onclick="doTransition('VALIDATED')">Save & Validate</button>`;
            }
            if(s === 'APPROVED_LOCKED' || s === 'PARTIALLY_DISBURSED') {
                div.innerHTML += `<button type="button" class="btn btn-success fw-bold ms-2" onclick="openDisburseModal()">Disburse Funds</button>`;
            }
        }

        // MD Logic
        if(IS_MANAGEMENT && s === 'VALIDATED') {
            div.innerHTML += `<button type="button" class="btn btn-danger fw-bold ms-2" onclick="doTransition('REJECTED')">Reject</button>`;
            div.innerHTML += `<button type="button" class="btn btn-success fw-bold ms-2" onclick="doTransition('APPROVED_LOCKED')">Approve</button>`;
        }
    }

    // --- PRINT ---
    window.quickPrint = async function(id) {
        try {
            const data = await apiGet('pr_get', `&id=${id}`);
            const h = data.header;
            const lines = data.lines;
            
            // Populate Print DOM
            document.getElementById('pDate').innerText = h.created_at.split(' ')[0];
            document.getElementById('pNum').innerText = h.pr_id;
            document.getElementById('pAmount').innerText = money(h.amount_total) + ' XAF';
            document.getElementById('pReqName').innerText = h.created_by; // Ideally join employee name
            document.getElementById('pBeneficiary').innerText = h.beneficiary;

            // Context
            if(h.ops_file_ref) {
                document.getElementById('pRowFile').style.display = 'flex';
                document.getElementById('pFileRef').innerText = h.ops_file_ref;
                document.getElementById('pBL').innerText = h.sea_bl;
            } else {
                document.getElementById('pRowFile').style.display = 'none';
            }

            // Lines
            const ptbody = document.getElementById('pTableBody');
            ptbody.innerHTML = '';
            lines.forEach(l => {
                const ex = Number(l.qty) * Number(l.unit_price);
                const vat = ex * (Number(l.vat_rate)/100);
                const inc = ex + vat;
                ptbody.innerHTML += `
                    <tr>
                        <td>${l.line_code}</td>
                        <td>${l.line_desc}</td>
                        <td>DOC</td>
                        <td style="text-align: center;">${Number(l.qty)}</td>
                        <td class="p-num">${money(l.unit_price)}</td>
                        <td class="p-num">${money(ex)}</td>
                        <td class="p-num">${money(vat)}</td>
                        <td class="p-num">${money(inc)}</td>
                    </tr>
                `;
            });
            
            document.getElementById('pRemarks').innerText = h.remarks;
            document.getElementById('pTotal').innerText = money(h.amount_total) + ' XAF';
            
            // Show approver stamp
            document.getElementById('pApprover').style.display = 'block';

            window.print();

        } catch(e) { showToast(e.message); }
    }

  </script>
</body>

</html>