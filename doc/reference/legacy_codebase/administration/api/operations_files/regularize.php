<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

// Only SALES, ADMIN, MANAGEMENT can regularize
require_role(['SALES', 'ADMIN', 'MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

function out(bool $ok, array $extra = [], int $code = 200): void {
    http_response_code($code);
    echo json_encode(array_merge(['ok' => $ok], $extra));
    exit;
}

function uuid_v4(): string {
    $data = random_bytes(16);
    $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
    $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
    $hex = bin2hex($data);
    return sprintf('%s-%s-%s-%s-%s',
        substr($hex, 0, 8), substr($hex, 8, 4), substr($hex, 12, 4), substr($hex, 16, 4), substr($hex, 20, 12)
    );
}

function norm_str($v): ?string {
    $s = trim((string)($v ?? ''));
    return $s === '' ? null : $s;
}

function require_str($v, string $field): string {
    $s = trim((string)($v ?? ''));
    if ($s === '') out(false, ['error' => "Missing required field: {$field}"], 422);
    return $s;
}

try {
    $userId = (int)($_SESSION['auth']['user_id'] ?? 0);
    if ($userId <= 0) out(false, ['error' => 'Unauthenticated'], 401);

    $raw = file_get_contents('php://input');
    $data = json_decode($raw ?: '', true);
    if (!is_array($data)) out(false, ['error' => 'Invalid JSON'], 400);

    $conn = db();
    $conn->set_charset('utf8mb4');

    // 1. Validate Target Ops File
    $opsRef = require_str($data['ops_ref'] ?? null, 'ops_ref');
    
    $chk = $conn->prepare("SELECT operations_file_reference FROM operations_file_master WHERE operations_file_reference = ? AND (link_opportunity = 0 OR link_opportunity IS NULL) LIMIT 1");
    $chk->bind_param('s', $opsRef);
    $chk->execute();
    if ($chk->get_result()->num_rows === 0) {
        out(false, ['error' => "File '{$opsRef}' not found or already linked."], 404);
    }
    $chk->close();

    // 2. Extract Data
    $requesterName    = require_str($data['requester_name'] ?? null, 'Requester Name');
    $requesterCompany = norm_str($data['requester_company']);
    $requesterEmail   = norm_str($data['requester_email']) ?? 'regularized@smartls.cm'; 
    $requesterPhone   = norm_str($data['requester_phone']) ?? '0000000000';

    $serviceCategory  = require_str($data['service_category'] ?? null, 'Service Category');
    $serviceType      = require_str($data['service_type'] ?? null, 'Service Type'); 
    
    $origin           = norm_str($data['origin_location']);
    $destination      = norm_str($data['destination_location']);
    
    $estWeight        = (float)($data['estimated_weight'] ?? 0);
    $estValue         = (float)($data['estimated_value_xaf'] ?? 0);
    if ($estValue <= 0) out(false, ['error' => 'Estimated Value must be greater than 0'], 422);

    $desc             = norm_str($data['cargo_description']);
    $notes            = norm_str($data['additional_notes']);

    // 3. Generate IDs
    $newOppUuid = uuid_v4(); // Primary Key for DB engine
    
    // PUBLIC REFERENCE: "OPP-2026-REG-XXXX"
    // This will be used as the visible link in operations_file_master
    $publicRef  = 'OPP-' . date('Y') . '-REG-' . strtoupper(substr(bin2hex(random_bytes(2)), 0, 4));
    
    $status = 'QUALIFIED'; 
    
    // For regularization, the "Converted ID" is the Public Ref itself (or UUID, but Public Ref is safer for your preference)
    $convertedId = $publicRef; 

    $conn->begin_transaction();

    // 4. Create Opportunity
    $sqlIns = "
        INSERT INTO quote_requests (
            quote_request_id, public_quote_ref, intake_channel,
            requester_name, requester_company, requester_email, requester_phone,
            service_category, service_type,
            origin_location, destination_location,
            estimated_weight, estimated_value_xaf,
            cargo_description, additional_notes,
            status, converted_opportunity_id,
            submission_datetime, created_by_employee_id
        ) VALUES (
            ?, ?, 'OPS_REGULARIZATION',
            ?, ?, ?, ?,
            ?, ?,
            ?, ?,
            ?, ?,
            ?, ?,
            ?, ?,
            NOW(), ?
        )
    ";

    $stmtIns = $conn->prepare($sqlIns);
    $empId = $_SESSION['auth']['employee_id'] ?? null;
    
    // Bind: Note that we use $newOppUuid for the ID column, but $publicRef for the ref column
    $stmtIns->bind_param(
        'ssssssssssddsssss',
        $newOppUuid, $publicRef,
        $requesterName, $requesterCompany, $requesterEmail, $requesterPhone,
        $serviceCategory, $serviceType,
        $origin, $destination,
        $estWeight, $estValue,
        $desc, $notes,
        $status, $convertedId,
        $empId
    );

    if (!$stmtIns->execute()) {
        throw new Exception("Insert Opportunity failed: " . $stmtIns->error);
    }
    $stmtIns->close();

    // 5. Update Operations File (Link using PUBLIC REF)
    $sqlUpd = "
        UPDATE operations_file_master 
        SET opportunity_id = ?, 
            link_opportunity = 1, 
            quote_amount = ?,
            updated_at = NOW() 
        WHERE operations_file_reference = ?
    ";
    
    $stmtUpd = $conn->prepare($sqlUpd);
    
    // HERE IS THE CHANGE: We bind $publicRef (OPP-2026...) instead of $newOppUuid
    $stmtUpd->bind_param('sds', $publicRef, $estValue, $opsRef);
    
    if (!$stmtUpd->execute()) {
        throw new Exception("Link Operations failed: " . $stmtUpd->error);
    }
    $stmtUpd->close();

    $conn->commit();

    out(true, [
        'message' => 'Regularization complete.',
        'ops_ref' => $opsRef,
        'new_opp_ref' => $publicRef
    ]);

} catch (Throwable $e) {
    if (isset($conn)) @$conn->rollback();
    out(false, ['error' => $e->getMessage()], 500);
}