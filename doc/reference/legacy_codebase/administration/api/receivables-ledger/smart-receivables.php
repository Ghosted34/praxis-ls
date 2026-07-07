<?php
/**
 * ============================================================================
 * SMART RECEIVABLES & AGEING LEDGER API v5.0 (OFM Integration)
 * ============================================================================

 * NEW RULES:
 * 1. Reads ISSUED_LOCKED PRIs from proforma_invoice table
 * 2. Reads FIs from OFM (not invoice_master directly)
 * 3. Displays: FI Amount - PRI Amount = Balance Due
 * 4. Full payment only for PRIs
 * 5. Partial payments allowed for FIs
 * 6. Updates OFM when FI fully paid → operations_status = CLOSED
 * ============================================================================ 
 */

declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

header('Content-Type: application/json');

// ============================================================================
// AUTHENTICATION & ROLE CHECK
// ============================================================================

if (!isset($_SESSION['auth']['user_id'])) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Unauthorized']);
    exit;
}

$userId = (int)$_SESSION['auth']['user_id'];
$userRole = strtoupper($_SESSION['auth']['role'] ?? 'GUEST');

// READ access: FINANCE, ADMIN, MANAGEMENT
if (!in_array($userRole, ['FINANCE', 'ADMIN', 'MANAGEMENT'], true)) {

    http_response_code(403);
    echo json_encode(['success' => false, 'error' => 'Access restricted to Finance role only']);
    exit;
}

$action = strtolower(trim((string)($_GET['action'] ?? $_POST['action'] ?? '')));

// --------------------
// AUTHORITATIVE WRITE GATE (prevent Management from performing write actions)
// Must run BEFORE routing/switch so management cannot execute write operations.
// --------------------
$writeActions = [
    'record_payment',
    'void_payment',
    'sync_client_balances'
];

if (in_array($action, $writeActions, true) && $userRole === 'MANAGEMENT') {
    http_response_code(403);
    echo json_encode([
        'success' => false,
        'error' => 'Read-only access for Management role'
    ]);
    exit;
}

$conn = db();

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

$conn->set_charset('utf8mb4');
$conn->query("SET NAMES utf8mb4 COLLATE utf8mb4_general_ci");
$conn->query("SET collation_connection = 'utf8mb4_general_ci'");


// ============================================================================
// ROUTING
// ============================================================================

try {
    switch ($action) {
        // Get all invoices for ledger (PRIs + FIs)
        case 'get_all_invoices':
            getAllInvoices($conn);
            break;
            
        // Get single invoice details
        case 'get_invoice_detail':
            $invoiceId = (int)($_GET['invoice_id'] ?? 0);
            $invoiceType = $_GET['invoice_type'] ?? null;
            
            // If invoice_type not provided, auto-detect from database
            if (empty($invoiceType)) {
                $invoiceType = detectInvoiceType($conn, $invoiceId);
                if (!$invoiceType) {
                    http_response_code(404);
                    echo json_encode([
                        'success' => false, 
                        'error' => 'Invoice not found'
                    ]);
                    break;
                }
            }
            
            getInvoiceDetail($conn, $invoiceId, $invoiceType);
            break;
            
        // Record a payment
        case 'record_payment':
            $input = json_decode(file_get_contents('php://input'), true);
            recordPayment($conn, $input, $userId);
            break;
            
        // Get payment history for an invoice
        case 'get_payment_history':
            $invoiceId = (int)($_GET['invoice_id'] ?? 0);
            $invoiceType = $_GET['invoice_type'] ?? 'FI';
            getPaymentHistory($conn, $invoiceId, $invoiceType);
            break;
            
        // Void/delete a payment
        case 'void_payment':
            $input = json_decode(file_get_contents('php://input'), true);
            voidPayment($conn, $input['payment_id'], $input['invoice_type'], $userId);
            break;
            
        // Get KPIs
        case 'get_kpis':
            getKPIs($conn);
            break;
            
        // [NEW] SYNC CLIENT BALANCES
        case 'sync_client_balances':
            syncClientBalances($conn);
            break;
            
        default:
            http_response_code(400);
            echo json_encode([
                'success' => false, 
                'error' => 'Invalid action'
            ]);
            break;
    } // <-- This closing brace was missing!
    
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false, 
        'error' => 'Server error: ' . $e->getMessage()
    ]);
}

// ============================================================================
// HELPER: AUTO-DETECT INVOICE TYPE FROM DATABASE
// ============================================================================

function detectInvoiceType($conn, $invoiceId) {
    /**
     * Auto-detects if an invoice_id belongs to PROFORMA or INVOICE table
     * Returns 'PROFORMA' or 'INVOICE' or null if not found
     */
    
    // Check if it's a proforma
    $sql = "SELECT invoice_id FROM proforma_invoice WHERE invoice_id = ? AND invoice_type = 'PROFORMA' LIMIT 1";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('i', $invoiceId);
    $stmt->execute();
    if ($stmt->get_result()->num_rows > 0) {
        return 'PROFORMA';
    }
    
    // Check if it's a final invoice
    $sql = "SELECT invoice_id FROM invoice_master WHERE invoice_id = ? AND invoice_type = 'INVOICE' LIMIT 1";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('i', $invoiceId);
    $stmt->execute();
    if ($stmt->get_result()->num_rows > 0) {
        return 'INVOICE';
    }
    
    return null; // Not found
}

// ============================================================================
// MODIFIED: GET ALL INVOICES (PRIs + FIs FROM OFM)
// ============================================================================

function getAllInvoices($conn) {
    $invoices = [];
    
    // ========================================================================
    // PART 1: GET PROFORMAS (Include both ISSUED_LOCKED and PAID)
    // ========================================================================
    
    $priSql = "
        SELECT 
            pi.invoice_id,
            pi.invoice_no,
            pi.operations_file_reference,
            pi.linked_quote_ref,
            pi.client_id,
            pi.issue_date,
            pi.due_date,
            pi.currency,
            pi.payable_amount_xaf as invoice_amount,
            pi.total_amount_paid_xaf as amount_paid,
            pi.payable_amount_xaf - COALESCE(pi.total_amount_paid_xaf, 0) as balance,
            pi.advance_percentage,
            pi.total_xaf as full_invoice_amount,
            pi.status,
            pi.created_at,
            
            mps.client_name_cached as client_name,
            ofm.commodity,
            
            'PROFORMA' as invoice_type,
            DATEDIFF(CURDATE(), pi.due_date) as days_overdue
            
        FROM proforma_invoice pi
        LEFT JOIN marginpricing_simulations mps 
    ON pi.linked_quote_ref COLLATE utf8mb4_general_ci
     = mps.simulation_ref COLLATE utf8mb4_general_ci
LEFT JOIN operations_file_master ofm
    ON ofm.operations_file_reference COLLATE utf8mb4_general_ci
     = pi.operations_file_reference COLLATE utf8mb4_general_ci

        WHERE pi.invoice_type = 'PROFORMA'
        AND pi.status IN ('ISSUED_LOCKED', 'PAID')
        ORDER BY pi.due_date ASC
    ";
    
    $result = $conn->query($priSql);
    
    while ($row = $result->fetch_assoc()) {
        $daysOverdue = (int)$row['days_overdue'];
        $balance = (float)$row['balance'];
        
        // Determine ageing status
        if ($row['status'] === 'PAID' || $balance <= 0) {
            $ageingStatus = 'CLOSED';
        } elseif ($daysOverdue >= 60) {
            $ageingStatus = 'CRITICAL';
        } elseif ($daysOverdue >= 30) {
            $ageingStatus = 'WATCH';
        } elseif ($daysOverdue > 0) {
            $ageingStatus = 'OVERDUE';
        } else {
            $ageingStatus = 'CURRENT';
        }
        
        $invoices[] = [
            'invoice_id' => (int)$row['invoice_id'],
            'invoice_no' => $row['invoice_no'],
            'invoice_type' => 'PROFORMA',
            'file_reference' => $row['operations_file_reference'],
            'client_name' => $row['client_name'] ?? 'N/A',
            'commodity' => $row['commodity'] ?? 'N/A',
            'issue_date' => $row['issue_date'],
            'due_date' => $row['due_date'],
            'currency' => $row['currency'],
            'advance_percentage' => (int)$row['advance_percentage'],
            'full_invoice_amount' => (float)$row['full_invoice_amount'],
            'invoice_amount' => (float)$row['invoice_amount'],
            'amount_paid' => (float)$row['amount_paid'],
            'balance' => max(0, $balance),
            'days_overdue' => $daysOverdue,
            'ageing_status' => $ageingStatus,
            'status' => $row['status'],
            'payment_type' => 'FULL_ONLY',
            'created_at' => $row['created_at']
        ];
    }
    
    // ========================================================================
    // PART 2: GET FINAL INVOICES (Include PAID invoices too)
    // ========================================================================
    
    $fiSql = "
        SELECT 
            ofm.operations_file_reference,
            ofm.final_invoice_id,
            ofm.final_invoice_amount,
            ofm.final_invoice_due_date,
            ofm.proforma_invoice_amount,
            ofm.client_name as client_name,
            ofm.commodity,
            ofm.service_type,
            ofm.operations_status,
            
            im.invoice_no,
            im.issue_date,
            im.currency,
            im.status,
            im.created_at,
            
            DATEDIFF(CURDATE(), ofm.final_invoice_due_date) as days_overdue,
            
            COALESCE((
                SELECT SUM(amount_paid_xaf) 
                FROM invoice_payment_history 
                WHERE invoice_id = ofm.final_invoice_id
            ), 0) as total_paid
            
        FROM operations_file_master ofm
        LEFT JOIN invoice_master im ON im.invoice_id = ofm.final_invoice_id
        WHERE ofm.final_invoice_id IS NOT NULL
        AND ofm.final_invoice_id != ''
        ORDER BY ofm.final_invoice_due_date ASC
    ";
    
    $result = $conn->query($fiSql);
    
    while ($row = $result->fetch_assoc()) {
        $invoiceAmount = (float)$row['final_invoice_amount'];
        $priAmount = (float)$row['proforma_invoice_amount'];
        $totalPaid = (float)$row['total_paid'];
        
        $balance = $invoiceAmount - $priAmount - $totalPaid;
        
        $daysOverdue = (int)$row['days_overdue'];
        
        // Determine ageing status
        if ($balance <= 0 || $row['status'] === 'PAID') {
            $ageingStatus = 'CLOSED';
        } elseif ($daysOverdue >= 60) {
            $ageingStatus = 'CRITICAL';
        } elseif ($daysOverdue >= 30) {
            $ageingStatus = 'WATCH';
        } elseif ($daysOverdue > 0) {
            $ageingStatus = 'OVERDUE';
        } else {
            $ageingStatus = 'CURRENT';
        }
        
        $invoices[] = [
            'invoice_id' => (int)$row['final_invoice_id'],
            'invoice_no' => $row['invoice_no'],
            'invoice_type' => 'INVOICE',
            'file_reference' => $row['operations_file_reference'],
            'client_name' => $row['client_name'] ?? 'N/A',
            'commodity' => $row['commodity'] ?? 'N/A',
            'service_type' => $row['service_type'],
            'issue_date' => $row['issue_date'],
            'due_date' => $row['final_invoice_due_date'],
            'currency' => $row['currency'],
            'invoice_amount' => $invoiceAmount,
            'pri_amount' => $priAmount,
            'amount_paid' => $priAmount + $totalPaid,
            'direct_payments' => $totalPaid,
            'balance' => max(0, $balance),
            'days_overdue' => $daysOverdue,
            'ageing_status' => $ageingStatus,
            'status' => $row['status'],
            'payment_type' => 'PARTIAL_ALLOWED',
            'created_at' => $row['created_at']
        ];
    }
    
    // Sort by due date
    usort($invoices, function($a, $b) {
        return strtotime($a['due_date']) - strtotime($b['due_date']);
    });
    
    echo json_encode([
        'success' => true,
        'invoices' => $invoices
    ]);
}

// ============================================================================
// MODIFIED: GET INVOICE DETAIL (PRI OR FI)
// ============================================================================

function getInvoiceDetail($conn, $invoiceId, $invoiceType) {
    if ($invoiceId <= 0) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Invalid invoice ID']);
        return;
    }
    
    // Validate invoice_type (should have been detected by now)
    if (empty($invoiceType) || !in_array($invoiceType, ['PROFORMA', 'INVOICE'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Invalid invoice type']);
        return;
    }
    
    if ($invoiceType === 'PROFORMA') {
        // ====================================================================
        // PROFORMA INVOICE DETAIL
        // ====================================================================
        
        $sql = "
            SELECT 
                pi.*,
                mps.client_name_cached as client_name,
                ofm.commodity,
                DATEDIFF(CURDATE(), pi.due_date) as days_overdue
            FROM proforma_invoice pi
            LEFT JOIN marginpricing_simulations mps 
    ON pi.linked_quote_ref COLLATE utf8mb4_general_ci
     = mps.simulation_ref COLLATE utf8mb4_general_ci
LEFT JOIN operations_file_master ofm
    ON ofm.operations_file_reference COLLATE utf8mb4_general_ci
     = pi.operations_file_reference COLLATE utf8mb4_general_ci

            WHERE pi.invoice_id = ?
            AND pi.invoice_type = 'PROFORMA'
        ";
        
        $stmt = $conn->prepare($sql);
        $stmt->bind_param('i', $invoiceId);
        $stmt->execute();
        $header = $stmt->get_result()->fetch_assoc();
        
        if (!$header) {
            http_response_code(404);
            echo json_encode(['success' => false, 'error' => 'Proforma not found']);
            return;
        }
        
        // Get lines
        $linesSql = "
            SELECT 
                dict_code,
                description,
                qty,
                unit_price_xaf,
                line_total_xaf,
                vat_amount_xaf
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
                'code' => $line['dict_code'],
                'description' => $line['description'],
                'qty' => (float)$line['qty'],
                'unit_price' => (float)$line['unit_price_xaf'],
                'line_total' => (float)$line['line_total_xaf'],
                'vat_amount' => (float)$line['vat_amount_xaf']
            ];
        }
        
        $daysOverdue = (int)$header['days_overdue'];
        
        if ($daysOverdue >= 60) {
            $ageingStatus = 'CRITICAL';
        } elseif ($daysOverdue >= 30) {
            $ageingStatus = 'WATCH';
        } elseif ($daysOverdue > 0) {
            $ageingStatus = 'OVERDUE';
        } else {
            $ageingStatus = 'CURRENT';
        }
        
        echo json_encode([
            'success' => true,
            'invoice' => [
                'invoice_id' => (int)$header['invoice_id'],
                'invoice_no' => $header['invoice_no'],
                'invoice_type' => 'PROFORMA',
                'file_reference' => $header['operations_file_reference'],
                'client_name' => $header['client_name'] ?? 'N/A',
                'commodity' => $header['commodity'] ?? 'N/A',
                'issue_date' => $header['issue_date'],
                'due_date' => $header['due_date'],
                'currency' => $header['currency'],
                'subtotal' => (float)$header['subtotal_xaf'],
                'vat' => (float)$header['vat_xaf'],
                'total' => (float)$header['total_xaf'],
                'advance_percentage' => (int)$header['advance_percentage'],
                'payable_amount' => (float)$header['payable_amount_xaf'],
                'invoice_amount' => (float)$header['payable_amount_xaf'], // What we're asking for
                'balance' => (float)$header['payable_amount_xaf'], // Same as invoice_amount
                'days_overdue' => $daysOverdue,
                'ageing_status' => $ageingStatus,
                'status' => $header['status'],
                'payment_type' => 'FULL_ONLY',
                'bank_details' => $header['bank_details'],
                'remarks' => $header['remarks'],
                'lines' => $lines
            ]
        ]);
        
    } else {
        // ====================================================================
        // FINAL INVOICE DETAIL (FROM OFM)
        // ====================================================================
        
        $sql = "
            SELECT 
                ofm.operations_file_reference,
                ofm.final_invoice_id,
                ofm.final_invoice_amount,
                ofm.final_invoice_due_date,
                ofm.proforma_invoice_amount,
                ofm.client_name as client_name,
                ofm.commodity,
                ofm.service_type,
                
                im.invoice_no,
                im.issue_date,
                im.currency,
                im.subtotal_xaf,
                im.vat_xaf,
                im.bank_details,
                im.remarks,
                im.status,
                
                DATEDIFF(CURDATE(), ofm.final_invoice_due_date) as days_overdue,
                
                COALESCE((
                    SELECT SUM(amount_paid_xaf) 
                    FROM invoice_payment_history 
                    WHERE invoice_id = ?
                ), 0) as total_paid
                
            FROM operations_file_master ofm
            LEFT JOIN invoice_master im ON im.invoice_id = CAST(ofm.final_invoice_id AS UNSIGNED)

            WHERE ofm.final_invoice_id = ?
        ";
        
        $stmt = $conn->prepare($sql);
        $stmt->bind_param('ii', $invoiceId, $invoiceId);
        $stmt->execute();
        $header = $stmt->get_result()->fetch_assoc();
        
        if (!$header) {
            http_response_code(404);
            echo json_encode(['success' => false, 'error' => 'Invoice not found']);
            return;
        }
        
        // Get lines
        $linesSql = "
            SELECT 
                dict_code,
                description,
                qty,
                unit_price_xaf,
                line_total_xaf,
                vat_amount_xaf
            FROM invoice_lines
            WHERE invoice_id = ?
            ORDER BY line_id
        ";
        
        $stmt = $conn->prepare($linesSql);
        $stmt->bind_param('i', $invoiceId);
        $stmt->execute();
        $linesResult = $stmt->get_result();
        
        $lines = [];
        while ($line = $linesResult->fetch_assoc()) {
            $lines[] = [
                'code' => $line['dict_code'],
                'description' => $line['description'],
                'qty' => (float)$line['qty'],
                'unit_price' => (float)$line['unit_price_xaf'],
                'line_total' => (float)$line['line_total_xaf'],
                'vat_amount' => (float)$line['vat_amount_xaf']
            ];
        }
        
        $invoiceAmount = (float)$header['final_invoice_amount'];
        $priAmount = (float)$header['proforma_invoice_amount'];
        $totalPaid = (float)$header['total_paid'];
        $balance = $invoiceAmount - $priAmount - $totalPaid;
        
        $daysOverdue = (int)$header['days_overdue'];
        
        if ($balance <= 0) {
            $ageingStatus = 'CLOSED';
        } elseif ($daysOverdue >= 60) {
            $ageingStatus = 'CRITICAL';
        } elseif ($daysOverdue >= 30) {
            $ageingStatus = 'WATCH';
        } elseif ($daysOverdue > 0) {
            $ageingStatus = 'OVERDUE';
        } else {
            $ageingStatus = 'CURRENT';
        }
        
        echo json_encode([
            'success' => true,
            'invoice' => [
                'invoice_id' => (int)$invoiceId,
                'invoice_no' => $header['invoice_no'],
                'invoice_type' => 'INVOICE',
                'file_reference' => $header['operations_file_reference'],
                'client_name' => $header['client_name'] ?? 'N/A',
                'commodity' => $header['commodity'] ?? 'N/A',
                'service_type' => $header['service_type'],
                'issue_date' => $header['issue_date'],
                'due_date' => $header['final_invoice_due_date'],
                'currency' => $header['currency'],
                'subtotal' => (float)$header['subtotal_xaf'],
                'vat' => (float)$header['vat_xaf'],
                'total' => $invoiceAmount,
                'pri_amount' => $priAmount,
                'amount_paid' => $priAmount + $totalPaid,  // FIX: Include PRI in amount paid
                'direct_payments' => $totalPaid,  // NEW: Track direct payments separately
                'balance' => max(0, $balance),
                'days_overdue' => $daysOverdue,
                'ageing_status' => $ageingStatus,
                'status' => $header['status'],
                'payment_type' => 'PARTIAL_ALLOWED',
                'bank_details' => $header['bank_details'],
                'remarks' => $header['remarks'],
                'lines' => $lines
            ]
        ]);
    }
}

// ============================================================================
// FIXED: RECORD PAYMENT (Restored JSON Response Data)
// ============================================================================

function recordPayment($conn, $input, $userId) {
    $invoiceId = (int)($input['invoice_id'] ?? 0);
    $invoiceType = $input['invoice_type'] ?? null;
    $amountPaid = (float)($input['amount_paid'] ?? 0);
    $paymentDate = $input['payment_date'] ?? date('Y-m-d');
    $paymentMethod = $input['payment_method'] ?? 'BANK';
    $bankName = $input['bank_name'] ?? '';
    $transactionRef = $input['transaction_ref'] ?? '';
    $popReference = $input['pop_reference'] ?? '';
    $remarks = $input['remarks'] ?? '';
    
    if ($invoiceId <= 0) throw new Exception('Invalid invoice ID');
    
    // Auto-detect invoice type if not provided
    if (empty($invoiceType)) {
        $invoiceType = detectInvoiceType($conn, $invoiceId);
        if (!$invoiceType) throw new Exception('Invoice not found');
    }
    
    if ($amountPaid <= 0) throw new Exception('Payment amount must be greater than zero');
    if (empty($popReference)) throw new Exception('POP Reference is mandatory');
    
    $conn->begin_transaction();
    
    try {
        if ($invoiceType === 'PROFORMA') {
            // ... [PROFORMA LOGIC] ...
            
            // 1. Lock and Get Data
            $sql = "SELECT * FROM proforma_invoice WHERE invoice_id = ? AND invoice_type = 'PROFORMA' FOR UPDATE";
            $stmt = $conn->prepare($sql);
            $stmt->bind_param('i', $invoiceId);
            $stmt->execute();
            $proforma = $stmt->get_result()->fetch_assoc();
            
            if (!$proforma) throw new Exception('Proforma not found');
            if ($proforma['status'] === 'PAID') throw new Exception('Invoice is already fully paid');
            if ($proforma['status'] !== 'ISSUED_LOCKED') throw new Exception('Can only pay ISSUED_LOCKED proformas');
            
            $payableAmount = (float)$proforma['payable_amount_xaf'];
            // Allow 1.0 difference for rounding issues
            if (abs($amountPaid - $payableAmount) > 1.0) { 
                throw new Exception('Payment must be for full amount: ' . number_format($payableAmount, 2));
            }
            
            // Insert Payment
            $sql = "INSERT INTO proforma_payment_history (invoice_id, payment_number, advance_percentage_paid, amount_paid_xaf, payment_date, payment_reference, payment_method, recorded_by_user_id, remarks) VALUES (?, 1, 100, ?, ?, ?, ?, ?, ?)";
            $stmt = $conn->prepare($sql);
            $stmt->bind_param('idsssis', $invoiceId, $amountPaid, $paymentDate, $popReference, $paymentMethod, $userId, $remarks);
            $stmt->execute();
            $paymentId = $conn->insert_id;
            
            // Update Proforma Status
            $sql = "UPDATE proforma_invoice SET total_percentage_paid = 100, total_amount_paid_xaf = ?, remaining_percentage = 0, remaining_amount_xaf = 0, payment_count = 1, status = 'PAID' WHERE invoice_id = ?";
            $stmt = $conn->prepare($sql);
            $stmt->bind_param('di', $amountPaid, $invoiceId);
            $stmt->execute();
            
            // Update OFM
            $fileRef = $proforma['operations_file_reference'];
            $stmt = $conn->prepare("SELECT proforma_invoice_amount FROM operations_file_master WHERE operations_file_reference = ?");
            $stmt->bind_param('s', $fileRef);
            $stmt->execute();
            $currentPri = (float)($stmt->get_result()->fetch_assoc()['proforma_invoice_amount'] ?? 0);
            $newPri = $currentPri + $amountPaid;
            
            $stmt = $conn->prepare("UPDATE operations_file_master SET proforma_invoice_id = ?, proforma_invoice_amount = ? WHERE operations_file_reference = ?");
            $invoiceIdStr = (string)$invoiceId;
            $stmt->bind_param('sds', $invoiceIdStr, $newPri, $fileRef);
            $stmt->execute();
            
            // Run Sync
            syncClientBalances($conn, true);
            $conn->commit();
            
            echo json_encode([
                'success' => true,
                'payment_id' => $paymentId,
                'message' => 'Full payment recorded. Proforma closed.'
            ]);

        } else {
            // ... [INVOICE LOGIC] ...
            
            $sql = "
                SELECT 
                    im.invoice_no,
                    im.status, 
                    ofm.operations_file_reference, 
                    ofm.final_invoice_amount, 
                    ofm.proforma_invoice_amount,
                    ofm.proforma_invoice_id,
                    COALESCE((SELECT SUM(amount_paid_xaf) FROM invoice_payment_history WHERE invoice_id = ?), 0) as total_paid 
                FROM invoice_master im 
                LEFT JOIN operations_file_master ofm ON ofm.final_invoice_id = im.invoice_id 
                WHERE im.invoice_id = ? 
                FOR UPDATE
            ";
            $stmt = $conn->prepare($sql);
            $stmt->bind_param('ii', $invoiceId, $invoiceId);
            $stmt->execute();
            $invoice = $stmt->get_result()->fetch_assoc();
            
            if (!$invoice) throw new Exception('Invoice not found');
            if ($invoice['status'] === 'PAID') throw new Exception('Invoice already paid');
            
            $invoiceAmount = (float)$invoice['final_invoice_amount'];
            $priAmount = (float)$invoice['proforma_invoice_amount'];
            $totalPaid = (float)$invoice['total_paid'];
            
            $currentBalance = $invoiceAmount - $priAmount - $totalPaid;
            
            if ($currentBalance <= 0) {
                 if ($priAmount > 0) {
                    throw new Exception("Balance is 0 because this amount is linked to Proforma #" . $invoice['proforma_invoice_id']);
                } else {
                    throw new Exception('Invoice is already fully covered.');
                }
            }
            
            if ($amountPaid > $currentBalance) {
                throw new Exception('Payment exceeds balance. Remaining: ' . number_format($currentBalance, 2));
            }
            
            // Insert Payment
            $sql = "INSERT INTO invoice_payment_history (invoice_id, amount_paid_xaf, payment_date, payment_method, bank_name, transaction_reference, pop_reference, remarks, recorded_by_user_id, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())";
            $stmt = $conn->prepare($sql);
            $stmt->bind_param('idssssssi', $invoiceId, $amountPaid, $paymentDate, $paymentMethod, $bankName, $transactionRef, $popReference, $remarks, $userId);
            $stmt->execute();
            $paymentId = $conn->insert_id;
            
            // Update Status
            $newBalance = $currentBalance - $amountPaid;
            $newStatus = ($newBalance <= 0.01) ? 'PAID' : 'PARTIALLY_PAID';
            
            $stmt = $conn->prepare("UPDATE invoice_master SET status = ? WHERE invoice_id = ?");
            $stmt->bind_param('si', $newStatus, $invoiceId);
            $stmt->execute();
            
            if ($newStatus === 'PAID') {
                $stmt = $conn->prepare("UPDATE operations_file_master SET operations_status = 'CLOSED' WHERE operations_file_reference = ?");
                $stmt->bind_param('s', $invoice['operations_file_reference']);
                $stmt->execute();
            }
            
            // Run Sync
            syncClientBalances($conn, true);
            $conn->commit();
            
            // === FIX IS HERE: SENDING DATA BACK TO FRONTEND ===
            echo json_encode([
                'success' => true,
                'payment_id' => $paymentId,
                'new_balance' => max(0, $newBalance), // <--- RESTORED
                'new_status' => $newStatus,           // <--- RESTORED
                'is_fully_paid' => ($newStatus === 'PAID'), // <--- RESTORED
                'message' => 'Payment recorded successfully'
            ]);
        }
        
    } catch (Exception $e) {
        $conn->rollback();
        throw $e;
    }
}

// ============================================================================
// GET PAYMENT HISTORY (PRI OR FI)
// ============================================================================

function getPaymentHistory($conn, $invoiceId, $invoiceType) {
    if ($invoiceId <= 0) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Invalid invoice ID']);
        return;
    }
    
    if ($invoiceType === 'PROFORMA') {
        $sql = "
            SELECT 
                pph.payment_id,
                pph.amount_paid_xaf,
                pph.payment_date,
                pph.payment_method,
                pph.payment_reference,
                pph.remarks,
                pph.recorded_at,
                em.full_name as recorded_by_name
            FROM proforma_payment_history pph
            LEFT JOIN employee_master em ON pph.recorded_by_user_id = em.employee_id
            WHERE pph.invoice_id = ?
            ORDER BY pph.recorded_at DESC
        ";
    } else {
        $sql = "
            SELECT 
                iph.payment_id,
                iph.amount_paid_xaf,
                iph.payment_date,
                iph.payment_method,
                iph.bank_name,
                iph.transaction_reference,
                iph.pop_reference,
                iph.remarks,
                iph.recorded_at,
                em.full_name as recorded_by_name
            FROM invoice_payment_history iph
            LEFT JOIN employee_master em ON iph.recorded_by_user_id = em.employee_id
            WHERE iph.invoice_id = ?
            ORDER BY iph.recorded_at DESC
        ";
    }
    
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('i', $invoiceId);
    $stmt->execute();
    $result = $stmt->get_result();
    
    $payments = [];
    while ($row = $result->fetch_assoc()) {
        $payments[] = [
            'payment_id' => (int)$row['payment_id'],
            'amount_paid' => (float)$row['amount_paid_xaf'],
            'payment_date' => $row['payment_date'],
            'payment_method' => $row['payment_method'],
            'bank_name' => $row['bank_name'] ?? '',
            'transaction_reference' => $row['transaction_reference'] ?? $row['payment_reference'] ?? '',
            'pop_reference' => $row['pop_reference'] ?? $row['payment_reference'] ?? '',
            'remarks' => $row['remarks'],
            'recorded_at' => $row['recorded_at'],
            'recorded_by' => $row['recorded_by_name']
        ];
    }
    
    echo json_encode([
        'success' => true,
        'payments' => $payments
    ]);
}

// ============================================================================
// VOID PAYMENT (PRI OR FI)
// ============================================================================

function voidPayment($conn, $paymentId, $invoiceType, $userId) {
    if (!$paymentId || $paymentId <= 0) {
        throw new Exception('Invalid payment ID');
    }
    
    $conn->begin_transaction();
    
    try {
        if ($invoiceType === 'PROFORMA') {
            // Get payment details
            $sql = "
                SELECT 
                    pph.invoice_id,
                    pph.amount_paid_xaf,
                    pi.operations_file_reference
                FROM proforma_payment_history pph
                INNER JOIN proforma_invoice pi ON pi.invoice_id = pph.invoice_id
                WHERE pph.payment_id = ?
            ";
            
            $stmt = $conn->prepare($sql);
            $stmt->bind_param('i', $paymentId);
            $stmt->execute();
            $result = $stmt->get_result();
            
            if ($result->num_rows === 0) {
                throw new Exception('Payment not found');
            }
            
            $payment = $result->fetch_assoc();
            $invoiceId = $payment['invoice_id'];
            $amountToReverse = (float)$payment['amount_paid_xaf'];
            $fileRef = $payment['operations_file_reference'];
            
            // Delete payment
            $sql = "DELETE FROM proforma_payment_history WHERE payment_id = ?";
            $stmt = $conn->prepare($sql);
            $stmt->bind_param('i', $paymentId);
            $stmt->execute();
            
            // Reset proforma to ISSUED_LOCKED
            $sql = "
                UPDATE proforma_invoice SET
                    total_percentage_paid = 0,
                    total_amount_paid_xaf = 0,
                    remaining_percentage = 100,
                    remaining_amount_xaf = total_xaf,
                    payment_count = 0,
                    status = 'ISSUED_LOCKED'
                WHERE invoice_id = ?
            ";
            
            $stmt = $conn->prepare($sql);
            $stmt->bind_param('i', $invoiceId);
            $stmt->execute();
            
            // Reverse OFM
            $sql = "
                SELECT proforma_invoice_amount 
                FROM operations_file_master
                WHERE operations_file_reference = ?
            ";
            
            $stmt = $conn->prepare($sql);
            $stmt->bind_param('s', $fileRef);
            $stmt->execute();
            $ofmData = $stmt->get_result()->fetch_assoc();
            
            $currentPriAmount = (float)($ofmData['proforma_invoice_amount'] ?? 0);
            $newPriAmount = max(0, $currentPriAmount - $amountToReverse);
            
            $sql = "
                UPDATE operations_file_master
                SET proforma_invoice_amount = ?
                WHERE operations_file_reference = ?
            ";
            
            $stmt = $conn->prepare($sql);
            $stmt->bind_param('ds', $newPriAmount, $fileRef);
            $stmt->execute();
            
        } else {
            // INVOICE payment void
            $sql = "
                SELECT 
                    invoice_id,
                    amount_paid_xaf
                FROM invoice_payment_history
                WHERE payment_id = ?
            ";
            
            $stmt = $conn->prepare($sql);
            $stmt->bind_param('i', $paymentId);
            $stmt->execute();
            $result = $stmt->get_result();
            
            if ($result->num_rows === 0) {
                throw new Exception('Payment not found');
            }
            
            $payment = $result->fetch_assoc();
            $invoiceId = $payment['invoice_id'];
            
            // Delete payment
            $sql = "DELETE FROM invoice_payment_history WHERE payment_id = ?";
            $stmt = $conn->prepare($sql);
            $stmt->bind_param('i', $paymentId);
            $stmt->execute();
            
            // Recalculate and update status
            $sql = "
                SELECT 
                    COALESCE(SUM(amount_paid_xaf), 0) as total_paid
                FROM invoice_payment_history
                WHERE invoice_id = ?
            ";
            
            $stmt = $conn->prepare($sql);
            $stmt->bind_param('i', $invoiceId);
            $stmt->execute();
            $totals = $stmt->get_result()->fetch_assoc();
            
            $newTotalPaid = (float)$totals['total_paid'];
            
            // Get invoice and OFM data
            $sql = "
                SELECT 
                    im.status,
                    ofm.final_invoice_amount,
                    ofm.proforma_invoice_amount,
                    ofm.operations_file_reference
                FROM invoice_master im
                LEFT JOIN operations_file_master ofm ON ofm.final_invoice_id = im.invoice_id
                WHERE im.invoice_id = ?
            ";
            
            $stmt = $conn->prepare($sql);
            $stmt->bind_param('i', $invoiceId);
            $stmt->execute();
            $invoice = $stmt->get_result()->fetch_assoc();
            
            $invoiceAmount = (float)$invoice['final_invoice_amount'];
            $priAmount = (float)$invoice['proforma_invoice_amount'];
            $newBalance = $invoiceAmount - $priAmount - $newTotalPaid;
            
            if ($newBalance >= ($invoiceAmount - $priAmount)) {
                $newStatus = 'ISSUED_LOCKED';
            } elseif ($newBalance > 0) {
                $newStatus = 'PARTIALLY_PAID';
            } else {
                $newStatus = 'PAID';
            }
            
            $sql = "
                UPDATE invoice_master 
                SET status = ?
                WHERE invoice_id = ?
            ";
            
            $stmt = $conn->prepare($sql);
            $stmt->bind_param('si', $newStatus, $invoiceId);
            $stmt->execute();
            
            // If was PAID but now not, revert OFM
            if ($invoice['status'] === 'PAID' && $newStatus !== 'PAID') {
                $sql = "
                    UPDATE operations_file_master 
                    SET operations_status = 'FINANCIALLY_PENDING'
                    WHERE operations_file_reference = ?
                ";
                
                $stmt = $conn->prepare($sql);
                $fileRef = $invoice['operations_file_reference'];
                $stmt->bind_param('s', $fileRef);
                $stmt->execute();
            }
        }
        
        $conn->commit();
        
        echo json_encode([
            'success' => true,
            'message' => 'Payment voided successfully'
        ]);
        
    } catch (Exception $e) {
        $conn->rollback();
        throw $e;
    }
}

// ============================================================================
// GET KPIs
// ============================================================================

function getKPIs($conn) {
    // Get all open invoices with details
    $openInvoices = [];
    
    // PROFORMAS
    $priSql = "
        SELECT 
            invoice_id,
            currency,
            payable_amount_xaf - COALESCE(total_amount_paid_xaf, 0) as balance,
            DATEDIFF(CURDATE(), due_date) as days_overdue
        FROM proforma_invoice
        WHERE invoice_type = 'PROFORMA'
        AND status = 'ISSUED_LOCKED'
    ";
    
    $result = $conn->query($priSql);
    while ($row = $result->fetch_assoc()) {
        $openInvoices[] = [
            'type' => 'PROFORMA',
            'currency' => $row['currency'],
            'balance' => (float)$row['balance'],
            'days_overdue' => (int)$row['days_overdue']
        ];
    }
    
    // INVOICES
    $fiSql = "
        SELECT 
            ofm.final_invoice_id,
            im.currency,
            ofm.final_invoice_amount - ofm.proforma_invoice_amount - 
                COALESCE((
                    SELECT SUM(amount_paid_xaf) 
                    FROM invoice_payment_history 
                    WHERE invoice_id = ofm.final_invoice_id
                ), 0) as balance,
            DATEDIFF(CURDATE(), ofm.final_invoice_due_date) as days_overdue
        FROM operations_file_master ofm
        LEFT JOIN invoice_master im ON im.invoice_id = ofm.final_invoice_id
        WHERE ofm.final_invoice_id IS NOT NULL
        AND ofm.operations_status = 'FINANCIALLY_PENDING'
    ";
    
    $result = $conn->query($fiSql);
    while ($row = $result->fetch_assoc()) {
        $balance = (float)$row['balance'];
        if ($balance > 0) {
            $openInvoices[] = [
                'type' => 'INVOICE',
                'currency' => $row['currency'],
                'balance' => $balance,
                'days_overdue' => (int)$row['days_overdue']
            ];
        }
    }
    
    // Count invoices
    $proformaCount = 0;
    $invoiceCount = 0;
    foreach ($openInvoices as $inv) {
        if ($inv['type'] === 'PROFORMA') $proformaCount++;
        else $invoiceCount++;
    }
    
    // Total collections
    $sql = "
        SELECT 
            (SELECT COALESCE(SUM(amount_paid_xaf), 0) 
             FROM proforma_payment_history) as proforma_collections,
            (SELECT COALESCE(SUM(amount_paid_xaf), 0) 
             FROM invoice_payment_history) as invoice_collections
    ";
    
    $result = $conn->query($sql);
    $collections = $result->fetch_assoc();
    
    $totalCollections = (float)$collections['proforma_collections'] + (float)$collections['invoice_collections'];
    
    echo json_encode([
        'success' => true,
        'kpis' => [
            'open_invoices' => count($openInvoices),
            'proforma_count' => $proformaCount,
            'invoice_count' => $invoiceCount,
            'total_collections_xaf' => $totalCollections,
            'open_invoices_data' => $openInvoices // IMPORTANT: Frontend needs this
        ]
    ]);
}
function syncClientBalances($conn, $silent = false) {
    try {
        $clientStats = [];
        
        // Helper to update stats with VALIDATION
        $updateStats = function($clientId, $amount, $dueDate) use (&$clientStats) {
            $clientId = (string)$clientId;
            if (empty($clientId) || $amount <= 0.01) return; 
            
            if (!isset($clientStats[$clientId])) {
                $clientStats[$clientId] = [
                    'receivables' => 0.0, 
                    'overdue_amount' => 0.0,
                    'earliest_due_date' => null
                ];
            }
            
            // 1. Sum Receivables
            $clientStats[$clientId]['receivables'] += $amount;
            
            // 2. Validate Date (Must be a real date, not 0000-00-00)
            $validDate = ($dueDate && $dueDate !== '0000-00-00' && strtotime($dueDate) > 0);
            
            if ($validDate) {
                // Sum Overdue
                if (strtotime($dueDate) < strtotime(date('Y-m-d'))) {
                    $clientStats[$clientId]['overdue_amount'] += $amount;
                }
                
                // Capture Earliest Due Date
                $currentStoredDate = $clientStats[$clientId]['earliest_due_date'];
                // If we don't have a date yet, OR this date is older than the one we have
                if ($currentStoredDate === null || strtotime($dueDate) < strtotime($currentStoredDate)) {
                    $clientStats[$clientId]['earliest_due_date'] = $dueDate;
                }
            }
        };

        // --------------------------------------------------------------------
        // PART A: Calculate PROFORMA Debt
        // --------------------------------------------------------------------
        $priSql = "
            SELECT 
                client_id, 
                (payable_amount_xaf - COALESCE(total_amount_paid_xaf, 0)) as balance,
                due_date
            FROM proforma_invoice
            WHERE invoice_type = 'PROFORMA'
            AND status = 'ISSUED_LOCKED'
        ";

        $result = $conn->query($priSql);
        while ($row = $result->fetch_assoc()) {
            $updateStats($row['client_id'], (float)$row['balance'], $row['due_date']);
        }

        // --------------------------------------------------------------------
        // PART B: Calculate FINAL INVOICE Debt (With Double-Counting Protection)
        // --------------------------------------------------------------------
        $fiSql = "
            SELECT 
                pi.client_id,
                ofm.final_invoice_amount,
                ofm.proforma_invoice_amount,
                
                -- Fallback: If OFM amount is 0, check the actual Proforma Table value
                pi.payable_amount_xaf as real_pri_amount,
                
                ofm.final_invoice_due_date,
                COALESCE((
                    SELECT SUM(amount_paid_xaf) 
                    FROM invoice_payment_history 
                    WHERE invoice_id = ofm.final_invoice_id
                ), 0) as total_paid
            FROM operations_file_master ofm
            LEFT JOIN proforma_invoice pi 
                ON pi.operations_file_reference = ofm.operations_file_reference 
                AND pi.invoice_type = 'PROFORMA'
            WHERE ofm.final_invoice_id IS NOT NULL
            AND ofm.final_invoice_id != ''
            AND ofm.operations_status != 'CLOSED'
        ";

        $result = $conn->query($fiSql);
        while ($row = $result->fetch_assoc()) {
            if (empty($row['client_id'])) continue;

            $invoiceAmt = (float)$row['final_invoice_amount'];
            
            // INTELLIGENT PRI DEDUCTION:
            // Use OFM amount. If 0, use the Linked PRI amount to prevent double counting
            $priAmt = (float)$row['proforma_invoice_amount'];
            if ($priAmt <= 0 && !empty($row['real_pri_amount'])) {
                $priAmt = (float)$row['real_pri_amount'];
            }
            
            $paidAmt = (float)$row['total_paid'];
            
            // Calculate Balance
            $balance = $invoiceAmt - $priAmt - $paidAmt;

            $updateStats($row['client_id'], $balance, $row['final_invoice_due_date']);
        }

        // --------------------------------------------------------------------
        // PART C: Update Database
        // --------------------------------------------------------------------
        
        $conn->query("UPDATE client_master SET cached_receivables = 0, cached_overdue = 0, earliest_due_date = NULL");

        $stmt = $conn->prepare("
            UPDATE client_master 
            SET cached_receivables = ?, 
                cached_overdue = ?,
                earliest_due_date = ?
            WHERE client_id = ?
        ");
        
        $count = 0;
        foreach ($clientStats as $id => $stats) {
            $rec = $stats['receivables'];
            $over = $stats['overdue_amount'];
            $date = $stats['earliest_due_date'];
            $clientIdStr = (string)$id;
            
            $stmt->bind_param('ddss', $rec, $over, $date, $clientIdStr);
            $stmt->execute();
            $count++;
        }

        if (!$silent) {
            echo json_encode([
                'success' => true,
                'message' => "Sync complete. Updated balances for $count clients."
            ]);
        }

    } catch (Exception $e) {
        if (!$silent) {
            http_response_code(500);
            echo json_encode(['success' => false, 'error' => 'Sync failed: ' . $e->getMessage()]);
        }
    }
}
?>
