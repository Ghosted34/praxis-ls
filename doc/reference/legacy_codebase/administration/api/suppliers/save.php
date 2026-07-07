<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'FINANCE', 'MANAGEMENT', 'OPERATIONS']);

// Turn off default HTML error printing so JSON doesn't break
ini_set('display_errors', '0');
error_reporting(E_ALL);

header('Content-Type: application/json; charset=utf-8');

$conn = db();

function out(bool $ok, array $extra = [], int $code = 200): void {
    http_response_code($code);
    echo json_encode(array_merge(['ok' => $ok], $extra));
    exit;
}

function s($v): string { return trim((string)($v ?? '')); }
function norm_str($v): ?string {
    $s = trim((string)($v ?? ''));
    return $s === '' ? null : $s;
}

// --- 1. SESSION CHECK ---
$userId = (int)($_SESSION['auth']['user_id'] ?? 0);
if ($userId <= 0) out(false, ['error' => 'Session invalid'], 401);

// --- 2. PARSE INPUT (Multipart/FormData) ---
$payloadRaw = $_POST['payload'] ?? '';
$data = json_decode($payloadRaw, true);

if (!is_array($data)) {
    out(false, ['error' => 'Invalid or missing JSON payload'], 400);
}

// --- 3. EXTRACT DATA ---
$supplierIdRaw = s($data['supplier_id'] ?? '');
$isNew = ($supplierIdRaw === '' || $supplierIdRaw === 'SLAS-SS-AUTO' || $supplierIdRaw === 'SLAS-SS-NEW');

$name      = s($data['supplier_name'] ?? '');
$type      = s($data['supplier_type'] ?? ''); // Accepts "Other - Detail" combined string
$contact   = s($data['contact_person'] ?? '');
$email     = s($data['contact_email'] ?? '');
$phone     = s($data['contact_phone'] ?? '');
$address   = s($data['address'] ?? '');

// Optional
$niu       = norm_str($data['niu'] ?? null);
$rccm      = norm_str($data['rccm'] ?? null);
$country   = s($data['country'] ?? 'Cameroon');

// Payment
$payMethod = s($data['payment_method'] ?? 'CASH');
$terms     = (int)($data['payment_terms_days'] ?? 30);
$bankName  = norm_str($data['bank_name'] ?? null);
$accNum    = norm_str($data['account_number'] ?? null);
$accName   = norm_str($data['account_name'] ?? null);
$momoNet   = norm_str($data['momo_network'] ?? null);
$momoNum   = norm_str($data['momo_number'] ?? null);

// Evaluation
$rating    = (int)($data['rating'] ?? 0);
$notes     = norm_str($data['evaluation_notes'] ?? null);
$status    = s($data['status'] ?? 'ACTIVE');
$deactReason = norm_str($data['deactivation_reason'] ?? null);

// Documents Metadata
$docsMeta  = $data['documents'] ?? [];
if (!is_array($docsMeta)) $docsMeta = [];

// --- 4. VALIDATION ---
if ($name === '' || $type === '' || $contact === '') {
    out(false, ['error' => 'Missing required fields: Name, Type, or Contact Person'], 422);
}

// --- 5. SETUP PATHS ---
// Path: administration/uploads/supplier/documents/
$baseDir = __DIR__ . '/../../administration/uploads/supplier/documents/';
if (!is_dir($baseDir)) @mkdir($baseDir, 0755, true);

try {
    $conn->begin_transaction();

    // --- 6. GENERATE ID (If New) ---
    if ($isNew) {
        // Find last ID like SLAS-SS-%
        $res = $conn->query("SELECT supplier_id FROM supplier_master WHERE supplier_id LIKE 'SLAS-SS-%' ORDER BY LENGTH(supplier_id) DESC, supplier_id DESC LIMIT 1 FOR UPDATE");
        $row = $res->fetch_assoc();
        
        $nextNum = 1401; // Default start
        if ($row) {
            $numStr = preg_replace('/\D/', '', $row['supplier_id']); 
            if ($numStr !== '') $nextNum = (int)$numStr + 1;
        }
        $supplierId = 'SLAS-SS-' . str_pad((string)$nextNum, 7, '0', STR_PAD_LEFT);

        // INSERT
        // Note: cached_payables and cached_overdue default to 0.00 in DB
        $sql = "INSERT INTO supplier_master 
        (supplier_id, supplier_name, supplier_type, contact_person, contact_email, contact_phone, 
         niu, rccm, address, country, 
         payment_method, payment_terms_days, bank_name, account_number, account_name, 
         momo_network, momo_number, rating, evaluation_notes, status, deactivation_reason, 
         created_by, created_at)
        VALUES 
        (?, ?, ?, ?, ?, ?, 
         ?, ?, ?, ?, 
         ?, ?, ?, ?, ?, 
         ?, ?, ?, ?, ?, ?, 
         ?, NOW())";

        $stmt = $conn->prepare($sql);
        // Types: ssssss ssss si sssss i sss i
        // Count: 22 params
        $stmt->bind_param('sssssssssssisssssisssi', 
            $supplierId, $name, $type, $contact, $email, $phone,
            $niu, $rccm, $address, $country,
            $payMethod, $terms, $bankName, $accNum, $accName,
            $momoNet, $momoNum, $rating, $notes, $status, $deactReason,
            $userId
        );
        if (!$stmt->execute()) throw new Exception("Insert Failed: " . $stmt->error);

    } else {
        $supplierId = $supplierIdRaw;
        // UPDATE
        // Critical: We do NOT update cached_payables or cached_overdue here.
        $sql = "UPDATE supplier_master SET 
            supplier_name=?, supplier_type=?, contact_person=?, contact_email=?, contact_phone=?, 
            niu=?, rccm=?, address=?, country=?, 
            payment_method=?, payment_terms_days=?, bank_name=?, account_number=?, account_name=?, 
            momo_network=?, momo_number=?, rating=?, evaluation_notes=?, status=?, deactivation_reason=?, 
            updated_at=NOW()
            WHERE supplier_id=?";
        
        $stmt = $conn->prepare($sql);
        // Count: 21 params
        $stmt->bind_param('ssssssssssisssssissss', 
            $name, $type, $contact, $email, $phone,
            $niu, $rccm, $address, $country,
            $payMethod, $terms, $bankName, $accNum, $accName,
            $momoNet, $momoNum, $rating, $notes, $status, $deactReason,
            $supplierId
        );
        if (!$stmt->execute()) throw new Exception("Update Failed: " . $stmt->error);
    }

    // --- 7. HANDLE DOCUMENTS ---
    $docStmt = $conn->prepare("INSERT INTO supplier_documents 
        (supplier_id, document_type, storage_mode, file_path, physical_ref, original_name, uploaded_by, uploaded_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW())");

    foreach ($docsMeta as $idx => $d) {
        $docType = s($d['document_type'] ?? 'OTHER');
        $mode    = s($d['storage_mode'] ?? 'DIGITAL');
        $physRef = norm_str($d['physical_ref'] ?? null);
        
        $dbPath   = null;
        $origName = null;

        if ($mode === 'PHYSICAL') {
            if (!$physRef) continue;
            $origName = "Physical Record";
        } else {
            $fileKey = "doc_file_{$idx}";
            if (!isset($_FILES[$fileKey]) || $_FILES[$fileKey]['error'] !== UPLOAD_ERR_OK) {
                continue; 
            }

            $f = $_FILES[$fileKey];
            $origName = $f['name'];
            $ext = pathinfo($origName, PATHINFO_EXTENSION);
            
            // Clean filename
            $safeName = $supplierId . '_' . preg_replace('/[^a-zA-Z0-9]/', '', $docType) . '_' . time() . '_' . $idx . '.' . $ext;
            
            if (move_uploaded_file($f['tmp_name'], $baseDir . $safeName)) {
                $dbPath = 'administration/uploads/supplier/documents/' . $safeName;
            } else {
                throw new Exception("Failed to save file: " . $safeName);
            }
        }

        // Bind & Execute
        $docStmt->bind_param('ssssssi', 
            $supplierId, $docType, $mode, $dbPath, $physRef, $origName, $userId
        );
        if (!$docStmt->execute()) throw new Exception("Doc Save Failed: " . $docStmt->error);
    }

    $conn->commit();
    out(true, ['supplier_id' => $supplierId]);

} catch (Exception $e) {
    if ($conn->in_transaction) $conn->rollback();
    out(false, ['error' => 'Save Error', 'detail' => $e->getMessage()], 500);
}