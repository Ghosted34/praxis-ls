<?php
/**
 * ============================================================================
 * SMART LS - FINAL INVOICE API v5.0 (OFM Integration with PRI Deduction)
 * ============================================================================
 * NEW RULES:
 * 1. FI creation reads OFM.proforma_invoice_amount (total PAID PRIs)
 * 2. Balance = FI Amount - OFM PRI Amount
 * 3. When FI ISSUED_LOCKED → update OFM with FI details
 * 4. Partial payments allowed on FI
 * 5. Smart Receivables reads from OFM (not invoice_master)
 * ============================================================================
 */

declare(strict_types=1);

header('Content-Type: application/json');
require_once __DIR__ . '/../../includes/init.php';

// ============================================================================
// AUTHENTICATION & ROLE CHECK
// ============================================================================

if (!isset($_SESSION['auth']['user_id'])) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Unauthorized']);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$userRole = $_SESSION['auth']['role'] ?? '';

// Role-based restrictions
$financeActions = ['save_invoice', 'submit_invoice'];
$managementActions = ['approve_invoice', 'reject_invoice'];

if (in_array($action, $financeActions) && !in_array($userRole, ['FINANCE', 'ADMIN'])) {
    http_response_code(403);
    echo json_encode(['success' => false, 'error' => 'Only FINANCE role can perform this action']);
    exit;
}

if (in_array($action, $managementActions) && !in_array($userRole, ['MANAGEMENT', 'ADMIN'])) {
    http_response_code(403);
    echo json_encode(['success' => false, 'error' => 'Only MANAGEMENT role can perform this action']);
    exit;
}

try {
    $conn = db();
    
    switch ($action) {
        case 'get_operations_files':
            getOperationsFiles($conn);
            break;
        
        case 'get_importable_lines':
            getImportableLines($conn);
            break;
            
        case 'get_file_details':
            getFileDetails($conn);
            break;
            
        case 'get_financial_dictionary':
            getFinancialDictionary($conn);
            break;
            
        case 'get_all_invoices':
            getAllInvoices($conn);
            break;
            
        case 'get_invoice':
            getInvoice($conn);
            break;
            
        case 'save_invoice':
            saveInvoice($conn);
            break;
            
        case 'submit_invoice':
            submitInvoice($conn);
            break;
            
        case 'approve_invoice':
            approveInvoice($conn);
            break;
            
        case 'reject_invoice':
            rejectInvoice($conn);
            break;
            
        case 'unlock_invoice':
            unlockInvoice($conn);
            break;
            
        case 'get_kpis':
            getKPIs($conn);
            break;
            
        default:
            throw new Exception('Invalid action');
    }
    
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}

function getOperationsFiles($conn) {
    // OLD QUERY: WHERE operations_status IN ('OPERATIONALLY_COMPLETED', 'FINANCIALLY_PENDING')
    
    // NEW QUERY:
    // 1. Must be Operationally Completed
    // 2. Must NOT be 'FINANCIALLY_PENDING' (which means locked/invoiced)
    // 3. We double-check against invoice_master to be safe (exclude if an Active invoice exists)
    $sql = "SELECT 
                ofm.operations_file_reference,
                ofm.client_bill_to,
                ofm.service_type,
                ofm.commodity,
                ofm.margin,
                ofm.client_id,
                ofm.client_name
            FROM operations_file_master ofm
            LEFT JOIN invoice_master im 
                ON im.operations_file_reference = ofm.operations_file_reference 
                AND im.approval_status != 'REJECTED'
            WHERE ofm.operations_status = 'OPERATIONALLY_COMPLETED'
            AND im.invoice_id IS NULL  -- Only show files with NO active invoice
            ORDER BY ofm.created_at DESC";
    
    $result = $conn->query($sql);
    $files = [];
    
    while ($row = $result->fetch_assoc()) {
        $files[] = $row;
    }
    
    echo json_encode([
        'success' => true,
        'data' => $files
    ]);
}

// ============================================================================
// MODIFIED: GET FILE DETAILS WITH PRI DEDUCTION
// ============================================================================

// ============================================================================
// FIXED: GET FILE DETAILS (Reads Actual OCR Cost)
// ============================================================================

function getFileDetails($conn) {
    $fileRef = $_GET['file_ref'] ?? '';
    
    if (empty($fileRef)) {
        throw new Exception('File reference required');
    }
    
    // 1. Get operations file details INCLUDING the OCR Amount we saved earlier
    $sql = "SELECT 
                ofm.*,
                cm.client_name,
                cm.address,
                cm.niu,
                -- We explicitly select these to be sure
                ofm.ocr_amount,
                ofm.proforma_invoice_amount
            FROM operations_file_master ofm
            LEFT JOIN client_master cm ON cm.client_id = ofm.client_id
            WHERE ofm.operations_file_reference = ?
            LIMIT 1";
    
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('s', $fileRef);
    $stmt->execute();
    $fileData = $stmt->get_result()->fetch_assoc();
    
    if (!$fileData) {
        throw new Exception('File not found');
    }
    
    // 2. Get lines (Priority: Paid Proforma -> Margin Sim -> Quote)
    $lines = [];
    $quoteRef = null; // We will try to find a quote ref if possible

    // Try to fetch lines from latest PAID proforma
    $sql = "SELECT pil.*, pi.linked_quote_ref 
            FROM proforma_invoice_lines pil
            INNER JOIN proforma_invoice pi ON pi.invoice_id = pil.invoice_id
            WHERE pi.operations_file_reference = ?
            AND pi.invoice_type = 'PROFORMA'
            AND pi.status = 'PAID'
            ORDER BY pi.created_at DESC LIMIT 1";
            
    // (Note: To get ALL lines, we first find the invoice ID, then fetch lines. 
    //  Keeping your original logic structure for simplicity:)
    
    // A. Check for Proforma Lines first
    $stmt = $conn->prepare("SELECT invoice_id, linked_quote_ref FROM proforma_invoice WHERE operations_file_reference = ? AND status='PAID' ORDER BY created_at DESC LIMIT 1");
    $stmt->bind_param('s', $fileRef);
    $stmt->execute();
    $res = $stmt->get_result();
    
    if ($res->num_rows > 0) {
        $pf = $res->fetch_assoc();
        $quoteRef = $pf['linked_quote_ref'];
        
        $lStmt = $conn->prepare("SELECT * FROM proforma_invoice_lines WHERE invoice_id = ? ORDER BY line_no ASC");
        $lStmt->bind_param('i', $pf['invoice_id']);
        $lStmt->execute();
        $lRes = $lStmt->get_result();
        
        while ($row = $lRes->fetch_assoc()) {
            $lines[] = [
                'dict_code' => $row['dict_code'],
                'description' => $row['description'],
                'qty' => $row['qty'],
                'unit_price_xaf' => $row['unit_price_xaf'],
                'line_total_xaf' => $row['line_total_xaf'],
                'vat_applicable' => $row['vat_applicable'],
                'vat_amount_xaf' => $row['vat_amount_xaf']
            ];
        }
    } else {
        // B. Fallback to Margin Simulation (Approved)
        $sql = "SELECT msl.*, ms.simulation_ref 
                FROM marginpricing_simulation_lines msl
                INNER JOIN marginpricing_simulations ms ON ms.id = msl.marginpricing_simulation_id
                WHERE ms.operations_file_reference = ? AND ms.status = 'APPROVED'
                ORDER BY msl.line_no ASC";
        
        $stmt = $conn->prepare($sql);
        $stmt->bind_param('s', $fileRef);
        $stmt->execute();
        $linesResult = $stmt->get_result();
        
        while ($row = $linesResult->fetch_assoc()) {
            $quoteRef = $row['simulation_ref']; // Capture the ref
            $lines[] = [
                'dict_code' => $row['item_code'],
                'description' => $row['item_description'],
                'qty' => $row['qty'],
                'unit_price_xaf' => $row['sell_unit'],
                'line_total_xaf' => $row['sell_total_ht'],
                'vat_applicable' => $row['vat_applicable'],
                'vat_amount_xaf' => $row['sell_total_vat']
            ];
        }
    }
    
    echo json_encode([
        'success' => true,
        'data' => [
            'file' => $fileData,
            'lines' => $lines,
            'total_pri_amount_xaf' => (float)($fileData['proforma_invoice_amount'] ?? 0),
            
            // <--- THE FIX: Read directly from File Master, not Simulation
            'ocr_amount' => (float)($fileData['ocr_amount'] ?? 0), 
            
            'quote_ref' => $quoteRef
        ]
    ]);
}

// ============================================================================
// GET FINANCIAL DICTIONARY (With French Names)
// ============================================================================

function getFinancialDictionary($conn) {
    // We fetch ALL active items because the list is small (~400).
    // The frontend handles the searching.
    
    $sql = "SELECT code, name_en, name_fr 
            FROM financial_dictionary 
            WHERE status = 'ACTIVE' 
            ORDER BY name_en ASC";
    
    $result = $conn->query($sql);
    
    $items = [];
    while ($row = $result->fetch_assoc()) {
        $items[] = [
            'code'           => $row['code'],
            'description'    => $row['name_en'],
            'description_fr' => $row['name_fr'] // <--- This sends the French name
        ];
    }
    
    echo json_encode([
        'success' => true,
        'data' => $items
    ]);
}

// ============================================================================
// FIXED: GET ALL INVOICES (Gross Margin: Total TTC - OCR Cost)
// ============================================================================

function getAllInvoices(mysqli $conn): void {
    $coll = "utf8mb4_general_ci";

    $sql = "
        SELECT 
            im.*,
            cm.client_name,
            
            -- Get Commodity and ACTUAL OCR Cost directly from Ops File Master
            ofm.commodity,
            ofm.ocr_amount AS real_ocr_cost

        FROM invoice_master im

        LEFT JOIN client_master cm
            ON cm.client_id COLLATE {$coll}
             = im.client_id COLLATE {$coll}

        LEFT JOIN operations_file_master ofm
            ON ofm.operations_file_reference COLLATE {$coll}
             = im.operations_file_reference COLLATE {$coll}

        ORDER BY im.created_at DESC
    ";

    $result = $conn->query($sql);

    $invoices = [];
    while ($row = $result->fetch_assoc()) {
        // <--- THE FIX: Using total_xaf (TTC) instead of subtotal_xaf (HT)
        // Formula: Final Invoice TTC - OCR Actual Cost (TTC)
        $row['margin_amount'] = (float)$row['total_xaf'] - (float)($row['real_ocr_cost'] ?? 0);
        
        $invoices[] = $row;
    }

    echo json_encode([
        'success' => true,
        'data' => $invoices
    ]);
}


// ============================================================================
// FIXED: GET SINGLE INVOICE (Reads OCR from OFM, matching Import logic)
// ============================================================================

function getInvoice($conn) {
    $invoiceId = intval($_GET['invoice_id'] ?? 0);
    
    if ($invoiceId <= 0) {
        throw new Exception('Invalid invoice ID');
    }
    
    // 1. Get invoice master AND join OFM to get the stored OCR Amount directly
    $sql = "SELECT 
                im.*,
                cm.client_name,
                cm.address,
                cm.niu,
                ofm.proforma_invoice_amount,
                ofm.ocr_amount  -- <--- ADDED: Fetch directly from Ops File Master
            FROM invoice_master im
            LEFT JOIN client_master cm ON cm.client_id = im.client_id
            LEFT JOIN operations_file_master ofm ON ofm.operations_file_reference = im.operations_file_reference
            WHERE im.invoice_id = ?
            LIMIT 1";
    
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('i', $invoiceId);
    $stmt->execute();
    $invoice = $stmt->get_result()->fetch_assoc();
    
    if (!$invoice) {
        throw new Exception('Invoice not found');
    }
    
    // 2. Get invoice lines
    $sql = "SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY line_id ASC";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('i', $invoiceId);
    $stmt->execute();
    $linesResult = $stmt->get_result();
    
    $lines = [];
    while ($row = $linesResult->fetch_assoc()) {
        $lines[] = $row;
    }
    
    // 3. (REMOVED) The separate 'marginpricing_simulations' query was causing the bug.
    // We now use the value from step 1.
    
    echo json_encode([
        'success' => true,
        'data' => [
            'invoice' => $invoice,
            'lines' => $lines,
            'ocr_amount' => (float)($invoice['ocr_amount'] ?? 0), // <--- Use the value from Step 1
            'total_pri_amount_xaf' => (float)($invoice['proforma_invoice_amount'] ?? 0)
        ]
    ]);
}

function saveInvoice($conn) {
    $userRole = $_SESSION['auth']['role'] ?? '';
    if (!in_array($userRole, ['FINANCE', 'ADMIN'])) {
        throw new Exception('Only FINANCE role can create/edit invoices');
    }
    
    $input = json_decode(file_get_contents('php://input'), true);
    
    $invoiceId = intval($input['invoice_id'] ?? 0);
    $fileRef = $input['operations_file_reference'] ?? '';
    $clientId = $input['client_id'] ?? '';
    $issueDate = $input['issue_date'] ?? date('Y-m-d H:i:s');
    $dueDate = $input['due_date'] ?? null;
    $currency = $input['currency'] ?? 'XAF';
    
    // --- PATCH: CAPTURE EXCHANGE RATE ---
    // Default to 1.0 if not provided or invalid
    $exchangeRate = floatval($input['exchange_rate'] ?? 1.0);
    if ($exchangeRate <= 0) $exchangeRate = 1.0;
    
    $subtotal = floatval($input['subtotal_xaf'] ?? 0);
    $vat = floatval($input['vat_xaf'] ?? 0);
    $total = floatval($input['total_xaf'] ?? 0);
    
    $totalPriAmount = floatval($input['total_pri_amount_xaf'] ?? 0);
    $payableAmount = $total - $totalPriAmount;
    $advancePercentage = ($total > 0) ? ($totalPriAmount / $total) * 100 : 0;
    
    $bankDetails = $input['bank_details'] ?? '';
    $remarks = $input['remarks'] ?? '';
    $lines = $input['lines'] ?? [];
    $linkedQuoteRef = $input['linked_quote_ref'] ?? '';
    
    if (empty($fileRef) || empty($clientId)) {
        throw new Exception('File reference and client are required');
    }

    // --- GATEKEEPER: PREVENT DUPLICATES ---
    $checkSql = "SELECT invoice_no FROM invoice_master 
                 WHERE operations_file_reference = ? 
                 AND approval_status != 'REJECTED' 
                 AND invoice_id != ? 
                 LIMIT 1";
                 
    $stmtCk = $conn->prepare($checkSql);
    $stmtCk->bind_param('si', $fileRef, $invoiceId);
    $stmtCk->execute();
    $resCk = $stmtCk->get_result();
    
    if ($rowCk = $resCk->fetch_assoc()) {
        throw new Exception("BLOCK: File '$fileRef' already has an active invoice (" . $rowCk['invoice_no'] . "). Please edit the existing invoice instead.");
    }

    $conn->begin_transaction();
    
    try {
        $userId = intval($_SESSION['auth']['user_id']);
        
        if ($invoiceId > 0) {
            // Update existing invoice
            // Added exchange_rate = ? after currency
            $sql = "UPDATE invoice_master SET
                        operations_file_reference = ?,
                        linked_quote_ref = ?,
                        client_id = ?,
                        issue_date = ?,
                        due_date = ?,
                        currency = ?,
                        exchange_rate = ?,  
                        subtotal_xaf = ?,
                        vat_xaf = ?,
                        total_xaf = ?,
                        advance_percentage = ?,
                        payable_amount_xaf = ?,
                        bank_details = ?,
                        remarks = ?
                    WHERE invoice_id = ? AND status = 'DRAFT'";
            
            $stmt = $conn->prepare($sql);
            // Updated types string: added 'd' for exchange_rate
            $stmt->bind_param('ssssssddddddssi',
                $fileRef, $linkedQuoteRef, $clientId, $issueDate, $dueDate, $currency,
                $exchangeRate, 
                $subtotal, $vat, $total, $advancePercentage, $payableAmount,
                $bankDetails, $remarks, $invoiceId
            );
            $stmt->execute();
            
            // Delete lines to replace
            $stmt = $conn->prepare("DELETE FROM invoice_lines WHERE invoice_id = ?");
            $stmt->bind_param('i', $invoiceId);
            $stmt->execute();
            
        } else {
            // New Invoice
            $sql = "SELECT MAX(CAST(SUBSTRING(invoice_no, 9) AS UNSIGNED)) as max_num 
                    FROM invoice_master 
                    WHERE invoice_no LIKE 'SLAS-FI-%'";
            $result = $conn->query($sql);
            $row = $result->fetch_assoc();
            $nextNum = (intval($row['max_num'] ?? 0)) + 1;
            $invoiceNo = 'SLAS-FI-' . str_pad((string)$nextNum, 4, '0', STR_PAD_LEFT);
            
            // Added exchange_rate to INSERT
            $sql = "INSERT INTO invoice_master (
                        invoice_no, invoice_type, operations_file_reference, linked_quote_ref,
                        client_id, issue_date, due_date, currency, exchange_rate,
                        subtotal_xaf, vat_xaf, total_xaf, advance_percentage,
                        payable_amount_xaf, bank_details, remarks, status,
                        approval_status, created_by_user_id, created_at
                    ) VALUES (?, 'INVOICE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', 'DRAFT', ?, NOW())";
            
            $stmt = $conn->prepare($sql);
            // Updated types string: added 'd' for exchange_rate
            $stmt->bind_param('sssssssddddddssi',
                $invoiceNo, $fileRef, $linkedQuoteRef, $clientId, $issueDate, $dueDate, $currency, 
                $exchangeRate, 
                $subtotal, $vat, $total, $advancePercentage, $payableAmount,
                $bankDetails, $remarks, $userId
            );
            $stmt->execute();
            $invoiceId = $conn->insert_id;
        }
        
        // Insert lines (Standard - no changes here as lines are always XAF in DB)
        if (!empty($lines)) {
            $sql = "INSERT INTO invoice_lines (
                        invoice_id, dict_code, description, qty,
                        unit_price_xaf, line_total_xaf, vat_amount_xaf, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())";
            $stmt = $conn->prepare($sql);
            
            foreach ($lines as $line) {
                $dictCode = $line['dict_code'] ?? '';
                $description = $line['description'] ?? '';
                $qty = floatval($line['qty'] ?? 0);
                $unitPrice = floatval($line['unit_price_xaf'] ?? 0);
                $lineTotal = floatval($line['line_total_xaf'] ?? 0);
                $vatAmount = floatval($line['vat_amount_xaf'] ?? 0);
                
                $stmt->bind_param('issdddd',
                    $invoiceId, $dictCode, $description, $qty,
                    $unitPrice, $lineTotal, $vatAmount
                );
                $stmt->execute();
            }
        }
        
        $conn->commit();
        
        echo json_encode([
            'success' => true,
            'message' => 'Invoice saved as draft',
            'invoice_id' => $invoiceId
        ]);
        
    } catch (Exception $e) {
        $conn->rollback();
        http_response_code(500); 
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}

// ============================================================================
// SUBMIT INVOICE (UNCHANGED)
// ============================================================================

function submitInvoice($conn) {
    $userRole = $_SESSION['auth']['role'] ?? '';
    if (!in_array($userRole, ['FINANCE', 'ADMIN'])) {
        throw new Exception('Only FINANCE role can submit invoices');
    }
    
    $input = json_decode(file_get_contents('php://input'), true);
    $invoiceId = intval($input['invoice_id'] ?? 0);
    
    if ($invoiceId <= 0) {
        throw new Exception('Invalid invoice ID');
    }
    
    $sql = "UPDATE invoice_master 
            SET approval_status = 'PENDING'
            WHERE invoice_id = ? AND status = 'DRAFT'";
    
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('i', $invoiceId);
    $stmt->execute();
    
    if ($stmt->affected_rows === 0) {
        throw new Exception('Invoice not found or already submitted');
    }
    
    echo json_encode([
        'success' => true,
        'message' => 'Invoice submitted for approval'
    ]);
}

// ============================================================================
// FIXED: APPROVE INVOICE (Uses consistent OCR Cost from OFM)
// ============================================================================

function approveInvoice($conn) {
    $userRole = $_SESSION['auth']['role'] ?? '';
    if (!in_array($userRole, ['MANAGEMENT', 'ADMIN'])) {
        throw new Exception('Only MANAGEMENT role can approve invoices');
    }
    
    $input = json_decode(file_get_contents('php://input'), true);
    $invoiceId = intval($input['invoice_id'] ?? 0);
    $sigMode = $input['signature_mode'] ?? 'DIGITAL';
    
    if ($invoiceId <= 0) {
        throw new Exception('Invalid invoice ID');
    }
    
    $conn->begin_transaction();
    
    try {
        $userId = intval($_SESSION['auth']['user_id']);
        
        // 1. Get Invoice Details AND the OCR Cost directly from OFM
        $sql = "SELECT 
                    im.operations_file_reference, 
                    im.invoice_no, 
                    im.total_xaf, 
                    im.subtotal_xaf, 
                    im.due_date,
                    im.payable_amount_xaf,
                    ofm.ocr_amount  -- <--- FETCH STORED COST HERE
                FROM invoice_master im
                LEFT JOIN operations_file_master ofm ON ofm.operations_file_reference = im.operations_file_reference
                WHERE im.invoice_id = ?";
                
        $stmt = $conn->prepare($sql);
        $stmt->bind_param('i', $invoiceId);
        $stmt->execute();
        $invoice = $stmt->get_result()->fetch_assoc();
        
        if (!$invoice) {
            throw new Exception('Invoice not found');
        }
        
        // 2. Approve invoice
        $sql = "UPDATE invoice_master 
                SET approval_status = 'APPROVED',
                    status = 'ISSUED_LOCKED',signature_mode = ?,
                    approved_by_user_id = ?,
                    approved_at = NOW()
                WHERE invoice_id = ? AND approval_status = 'PENDING'";
        
        $stmt = $conn->prepare($sql);
        $stmt->bind_param('sii', $sigMode, $userId, $invoiceId);
        $stmt->execute();
        
        if ($stmt->affected_rows === 0) {
            throw new Exception('Invoice not found or not pending approval');
        }
        
        // 3. Calculate Final Margin
        // Formula: Subtotal (Revenue) - OCR Cost (Expenses)
        $actualMargin = floatval($invoice['subtotal_xaf']) - floatval($invoice['ocr_amount'] ?? 0);
        
        // 4. Update OFM with Financials
        $sql = "UPDATE operations_file_master 
                SET margin = ?,
                    final_invoice_id = ?,
                    final_invoice_amount = ?,
                    final_invoice_due_date = ?,
                    operations_status = 'FINANCIALLY_PENDING'
                WHERE operations_file_reference = ?";
        
        $stmt = $conn->prepare($sql);
        $invoiceIdStr = (string)$invoiceId;
        $fileRef = $invoice['operations_file_reference'];
        
        $stmt->bind_param('dsdss', 
            $actualMargin, 
            $invoiceIdStr, 
            $invoice['total_xaf'], 
            $invoice['due_date'], 
            $fileRef
        );
        $stmt->execute();
        
        $conn->commit();
        
        echo json_encode([
            'success' => true,
            'message' => 'Invoice approved and OFM updated successfully'
        ]);
        
    } catch (Exception $e) {
        $conn->rollback();
        throw $e;
    }
}

// ============================================================================
// REJECT INVOICE (UNCHANGED)
// ============================================================================

function rejectInvoice($conn) {
    $userRole = $_SESSION['auth']['role'] ?? '';
    if (!in_array($userRole, ['MANAGEMENT', 'ADMIN'])) {
        throw new Exception('Only MANAGEMENT role can reject invoices');
    }
    
    $input = json_decode(file_get_contents('php://input'), true);
    $invoiceId = intval($input['invoice_id'] ?? 0);
    $reason = $input['reason'] ?? '';
    
    if ($invoiceId <= 0) {
        throw new Exception('Invalid invoice ID');
    }
    
    $sql = "UPDATE invoice_master 
            SET approval_status = 'REJECTED',
                status = 'DRAFT',
                remarks = CONCAT(COALESCE(remarks, ''), '\n\nREJECTED: ', ?)
            WHERE invoice_id = ? AND approval_status = 'PENDING'";
    
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('si', $reason, $invoiceId);
    $stmt->execute();
    
    if ($stmt->affected_rows === 0) {
        throw new Exception('Invoice not found or not pending approval');
    }
    
    echo json_encode([
        'success' => true,
        'message' => 'Invoice rejected and returned to draft'
    ]);
}

// ============================================================================
// NEW: UNLOCK INVOICE (Reverts to Draft for Corrections)
// ============================================================================

function unlockInvoice($conn) {
    $userRole = $_SESSION['auth']['role'] ?? '';
    if (!in_array($userRole, ['MANAGEMENT', 'ADMIN'])) {
        throw new Exception('Only MANAGEMENT or ADMIN can unlock invoices.');
    }
    
    $input = json_decode(file_get_contents('php://input'), true);
    $invoiceId = intval($input['invoice_id'] ?? 0);
    $reason = $input['reason'] ?? 'Correction needed';
    
    if ($invoiceId <= 0) throw new Exception('Invalid invoice ID');
    
    $conn->begin_transaction();
    
    try {
        // 1. Revert Invoice Master to DRAFT
        // We append the unlock reason to remarks for audit trail
        $sql = "UPDATE invoice_master 
                SET approval_status = 'DRAFT',
                    status = 'DRAFT',
                    remarks = CONCAT(remarks, '\n[UNLOCKED: ', ?, ']')
                WHERE invoice_id = ? AND approval_status = 'APPROVED'";
                
        $stmt = $conn->prepare($sql);
        $stmt->bind_param('si', $reason, $invoiceId);
        $stmt->execute();
        
        if ($stmt->affected_rows === 0) {
            throw new Exception('Invoice is not in APPROVED state or could not be updated.');
        }
        
        // 2. Revert Operations File Master
        // We set it back to OPERATIONALLY_COMPLETED so it doesn't show as "Financially Pending"
        // We do NOT clear the final_invoice_id yet, because we are just editing the SAME invoice.
        $sql = "UPDATE operations_file_master ofm
                JOIN invoice_master im ON im.operations_file_reference = ofm.operations_file_reference
                SET ofm.operations_status = 'OPERATIONALLY_COMPLETED'
                WHERE im.invoice_id = ?";
                
        $stmt = $conn->prepare($sql);
        $stmt->bind_param('i', $invoiceId);
        $stmt->execute();
        
        $conn->commit();
        
        echo json_encode([
            'success' => true,
            'message' => 'Invoice unlocked. You can now edit it.'
        ]);
        
    } catch (Exception $e) {
        $conn->rollback();
        throw $e;
    }
}
// ============================================================================
// FIXED: GET KPIs (Uses REAL OCR Costs, not Predicted Costs)
// ============================================================================

function getKPIs(mysqli $conn): void {
    $startOfMonth = date('Y-m-01 00:00:00');
    $endOfMonth   = date('Y-m-t 23:59:59');
    $coll = "utf8mb4_general_ci";

    // 1) Revenue (Total Invoiced)
    $sql = "SELECT 
                COALESCE(SUM(total_xaf), 0)   AS total_invoiced,
                COALESCE(SUM(subtotal_xaf), 0) AS total_revenue
            FROM invoice_master
            WHERE approval_status = 'APPROVED'
              AND status IN ('ISSUED_LOCKED', 'PARTIALLY_PAID', 'PAID')
              AND issue_date BETWEEN ? AND ?";
              
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('ss', $startOfMonth, $endOfMonth);
    $stmt->execute();
    $revenueData = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    // 2) Cost (The FIX: Read 'ocr_amount' from Operations File Master)
    $sql = "SELECT 
                COALESCE(SUM(ofm.ocr_amount), 0) AS total_cost
            FROM invoice_master im
            INNER JOIN operations_file_master ofm
                ON ofm.operations_file_reference COLLATE {$coll}
                 = im.operations_file_reference COLLATE {$coll}
            WHERE im.approval_status = 'APPROVED'
              AND im.status IN ('ISSUED_LOCKED', 'PARTIALLY_PAID', 'PAID')
              AND im.issue_date BETWEEN ? AND ?";
              
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('ss', $startOfMonth, $endOfMonth);
    $stmt->execute();
    $costData = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    // 3) Outstanding
    $sql = "SELECT 
                COALESCE(SUM(payable_amount_xaf), 0) AS outstanding
            FROM invoice_master
            WHERE approval_status = 'APPROVED'
              AND status IN ('ISSUED_LOCKED', 'PARTIALLY_PAID')";
              
    $outstandingData = $conn->query($sql)->fetch_assoc();

    // Calculations
    $totalRevenue = (float)($revenueData['total_revenue'] ?? 0);
    $totalCost    = (float)($costData['total_cost'] ?? 0);
    $netMargin    = $totalRevenue - $totalCost;

    echo json_encode([
        'success' => true,
        'data' => [
            'total_invoiced' => (float)($revenueData['total_invoiced'] ?? 0),
            'total_revenue'  => $totalRevenue,
            'total_cost'     => $totalCost,
            'net_margin'     => $netMargin,
            'outstanding'    => (float)($outstandingData['outstanding'] ?? 0),
        ]
    ]);
}

function getImportableLines($conn) {
    $fileRef = $_GET['file_ref'] ?? '';
    if (empty($fileRef)) throw new Exception('File reference required');

    $data = ['proformas' => [], 'quote' => null];

    // 1. Fetch Approved Quotation (Margin Simulation)
    $sql = "SELECT id, simulation_ref FROM marginpricing_simulations 
            WHERE operations_file_reference = ? AND status = 'APPROVED' LIMIT 1";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('s', $fileRef);
    $stmt->execute();
    $quote = $stmt->get_result()->fetch_assoc();

    if ($quote) {
        $qLines = [];
        $sqlL = "SELECT item_code, item_description, qty, sell_unit, vat_applicable 
                 FROM marginpricing_simulation_lines WHERE marginpricing_simulation_id = ?";
        $stmtL = $conn->prepare($sqlL);
        $stmtL->bind_param('i', $quote['id']);
        $stmtL->execute();
        $resL = $stmtL->get_result();
        while ($row = $resL->fetch_assoc()) {
            $qLines[] = [
                'code' => $row['item_code'],
                'desc' => $row['item_description'],
                'qty' => (float)$row['qty'],
                'unit' => (float)$row['sell_unit'],
                'vat' => (bool)$row['vat_applicable']
            ];
        }
        $data['quote'] = ['ref' => $quote['simulation_ref'], 'lines' => $qLines];
    }

    // 2. Fetch All Proforma Invoices (Chronological)
    // We fetch ALL (Draft, Paid, Issued) because a Draft might contain the line they forgot!
    $sql = "SELECT invoice_id, invoice_no, issue_date, status, total_xaf 
            FROM proforma_invoice 
            WHERE operations_file_reference = ? AND invoice_type = 'PROFORMA' 
            ORDER BY created_at ASC";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('s', $fileRef);
    $stmt->execute();
    $res = $stmt->get_result();

    while ($pi = $res->fetch_assoc()) {
        $pLines = [];
        $sqlL = "SELECT dict_code, description, qty, unit_price_xaf, vat_applicable 
                 FROM proforma_invoice_lines WHERE invoice_id = ?";
        $stmtL = $conn->prepare($sqlL);
        $stmtL->bind_param('i', $pi['invoice_id']);
        $stmtL->execute();
        $resL = $stmtL->get_result();
        while ($row = $resL->fetch_assoc()) {
            $pLines[] = [
                'code' => $row['dict_code'],
                'desc' => $row['description'],
                'qty' => (float)$row['qty'],
                'unit' => (float)$row['unit_price_xaf'],
                'vat' => (bool)$row['vat_applicable']
            ];
        }
        $data['proformas'][] = [
            'ref' => $pi['invoice_no'],
            'date' => $pi['issue_date'],
            'status' => $pi['status'],
            'lines' => $pLines
        ];
    }

    echo json_encode(['success' => true, 'data' => $data]);
}