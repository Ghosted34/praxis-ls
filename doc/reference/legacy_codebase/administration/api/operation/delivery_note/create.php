<?php
// File: administration/api/operation/delivery_note/create.php
declare(strict_types=1);

// --- 1. Debugging (Disable in production) ---
ini_set('display_errors', '1');
ini_set('display_startup_errors', '1');
error_reporting(E_ALL);

// --- 2. Path correction ---
require_once __DIR__ . '/../../../includes/init.php';

// --- 3. Headers ---
header('Content-Type: application/json');

if (!function_exists('json_response')) {
    function json_response($data, $code = 200) {
        http_response_code($code);
        echo json_encode($data);
        exit;
    }
}

if (empty($_SESSION['auth']['user_id'])) {
    json_response(['ok' => false, 'error' => 'Not logged in'], 401);
}

$input = json_decode(file_get_contents('php://input'), true);

try {
    $conn = db();
    
    // --- 4. Validate & Sanitize Input ---
    $fileRef  = trim((string)($input['file_ref'] ?? ''));
    $client   = trim((string)($input['client_name'] ?? ''));
    $tcList   = trim((string)($input['tc_list'] ?? ''));
    $date     = trim((string)($input['delivery_date'] ?? date('Y-m-d')));
    $userId   = (int)$_SESSION['auth']['user_id'];

    // NEW: Capture additional address details
    $address  = trim((string)($input['client_address'] ?? ''));
    $city     = trim((string)($input['client_city'] ?? ''));
    $contact  = trim((string)($input['client_contact'] ?? ''));
    $phone    = trim((string)($input['client_phone'] ?? ''));

    if ($fileRef === '') {
        throw new Exception("File Reference is required.");
    }

    $conn->begin_transaction();

    // --- 5. Generate Sequence ---
    // Lock the table to prevent duplicate DN numbers under high load
    $conn->query("SELECT MAX(dn_sequence) FROM delivery_notes FOR UPDATE");
    
    $sqlSeq = "SELECT MAX(dn_sequence) as max_seq FROM delivery_notes";
    $resSeq = $conn->query($sqlSeq);
    
    if (!$resSeq) throw new Exception("DB Error: Table 'delivery_notes' not found.");
    
    $rowSeq = $resSeq->fetch_assoc();
    $lastSeq = ($rowSeq['max_seq'] > 0) ? (int)$rowSeq['max_seq'] : 2400; 
    $nextSeq = $lastSeq + 1;
    $nextDnNumber = str_pad((string)$nextSeq, 6, '0', STR_PAD_LEFT);

    // --- 6. Insert Record ---
    $sqlInsert = "INSERT INTO delivery_notes 
        (
            file_ref, 
            dn_sequence, 
            dn_number_full, 
            client_name, 
            client_address, 
            client_city, 
            client_contact, 
            client_phone, 
            container_manifest, 
            delivery_date, 
            created_by_user_id
        ) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
        
    $stmt = $conn->prepare($sqlInsert);
    if (!$stmt) throw new Exception("Prepare failed: " . $conn->error);
    
    // bind_param types: s (string), i (integer)
    // 'sissssssssi' = 11 total parameters
    $stmt->bind_param('sissssssssi', 
        $fileRef, 
        $nextSeq, 
        $nextDnNumber, 
        $client,
        $address,
        $city,
        $contact,
        $phone,
        $tcList,
        $date,
        $userId
    );

    if (!$stmt->execute()) throw new Exception("Execute failed: " . $stmt->error);

    $conn->commit();

    json_response([
        'ok' => true,
        'dn_number' => $nextDnNumber,
        'message' => 'Delivery Note generated successfully'
    ]);

} catch (Exception $e) {
    if (isset($conn) && $conn instanceof mysqli) {
        try { $conn->rollback(); } catch (Throwable $t) {}
    }
    json_response(['ok' => false, 'error' => $e->getMessage()], 500);
}