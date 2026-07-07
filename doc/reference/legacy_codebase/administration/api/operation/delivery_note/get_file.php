<?php
// File: administration/api/operation/delivery_note/get_file.php
declare(strict_types=1);

require_once __DIR__ . '/../../../includes/init.php';

header('Content-Type: application/json');

if (empty($_SESSION['auth']['user_id'])) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'error' => 'Unauthorized']);
    exit;
}

$ref = trim((string)($_GET['ref'] ?? ''));

if ($ref === '') {
    echo json_encode(['ok' => false, 'error' => 'No reference provided']);
    exit;
}

$conn = db();

try {
    // 1. Fetch Operation Details from Master
    $sqlOps = "SELECT 
                client_name, 
                commodity_desc AS cargo_description, 
                marks_numbers AS marks_and_numbers, 
                gross_weight, 
                service_type, 
                COALESCE(sea_bl, air_mawb, inland_truck) AS bl_number,
                place_delivery AS master_address,
                rep_contact AS master_contact
               FROM operations_file_master 
               WHERE operations_file_reference = ? 
               LIMIT 1";

    $stmt = $conn->prepare($sqlOps);
    $stmt->bind_param('s', $ref);
    $stmt->execute();
    $resOps = $stmt->get_result();
    $opsData = $resOps->fetch_assoc();

    if (!$opsData) {
        throw new Exception("File Reference '$ref' not found in Operations Master.");
    }

    // 2. Check for Existing Delivery Note (Including the new columns)
    $sqlDn = "SELECT 
                dn_number_full, 
                delivery_date, 
                container_manifest,
                client_address,
                client_city,
                client_contact,
                client_phone
              FROM delivery_notes 
              WHERE file_ref = ? 
              ORDER BY id DESC LIMIT 1";
              
    $stmtDn = $conn->prepare($sqlDn);
    $stmtDn->bind_param('s', $ref);
    $stmtDn->execute();
    $dnData = $stmtDn->get_result()->fetch_assoc();

    // 3. Map Data for Frontend
    // Priority: Saved DN Data > Master Ops Data > Empty String
    $payload = [
        'ref'          => $ref,
        'client'       => $opsData['client_name'],
        'desc'         => $opsData['cargo_description'],
        'marks'        => $opsData['marks_and_numbers'],
        'weight'       => $opsData['gross_weight'],
        'service_type' => $opsData['service_type'],
        'doc_no'       => $opsData['bl_number'],
        
        // Use saved DN address details if they exist, otherwise use Master Data
        'delivery'     => $dnData['client_address'] ?? ($opsData['master_address'] ?? ''),
        'city'         => $dnData['client_city']    ?? '',
        'contact'      => $dnData['client_contact']  ?? ($opsData['master_contact'] ?? ''),
        'phone'        => $dnData['client_phone']    ?? '',

        // Existing DN Meta
        'existing_dn_number' => $dnData['dn_number_full'] ?? null,
        'existing_dn_date'   => $dnData['delivery_date']   ?? null,
        'container_manifest' => $dnData['container_manifest'] ?? null 
    ];

    echo json_encode(['ok' => true, 'data' => $payload]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}