<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
// Allow all operational roles to access this
require_role(['ADMIN', 'SALES', 'MANAGEMENT', 'OPERATIONS', 'FINANCE']);

header('Content-Type: application/json; charset=utf-8');

$conn = db();
$oppId = trim((string)($_GET['opp_id'] ?? ''));

if ($oppId === '') {
    echo json_encode(['ok' => false, 'error' => 'Missing Opportunity ID']);
    exit;
}

try {
    // 1. Fetch raw details from the Quote Request based on Opportunity ID
    $sql = "SELECT 
                quote_request_id,
                public_quote_ref,
                requester_company,
                requester_name,
                service_category,
                origin_location,
                destination_location,
                estimated_weight,
                cargo_description,
                project_cargo_flag
            FROM quote_requests 
            WHERE converted_opportunity_id = ? 
            LIMIT 1";

    $stmt = $conn->prepare($sql);
    if (!$stmt) throw new Exception("Prepare failed: " . $conn->error);
    
    $stmt->bind_param('s', $oppId);
    $stmt->execute();
    $res = $stmt->get_result();
    
    if ($row = $res->fetch_assoc()) {
        
        // 2. Service Type Mapping (Option A - Backend Normalization)
        // Maps Quote Intake categories to Operations File Enums
        $serviceMap = [
            'SEA_FREIGHT'           => 'SEA_FREIGHT_IMPORT',
            'SEA_FREIGHT_IMPORT'    => 'SEA_FREIGHT_IMPORT',
            'SEA_FREIGHT_EXPORT'    => 'SEA_FREIGHT_EXPORT',
            'AIR_FREIGHT'           => 'AIR_FREIGHT_IMPORT',
            'AIR_FREIGHT_IMPORT'    => 'AIR_FREIGHT_IMPORT',
            'AIR_FREIGHT_EXPORT'    => 'AIR_FREIGHT_EXPORT',
            'HINTERLAND_TRANSIT'    => 'HINTERLAND_TRANSIT',
            'INLAND_TRANSPORTATION' => 'INLAND_TRANSPORTATION',
            'WAREHOUSING'           => 'WAREHOUSING',
            'END_TO_END_AIR'        => 'END_TO_END_AIR_FREIGHT',
            'END_TO_END_SEA'        => 'END_TO_END_SEA_FREIGHT',
            'BUSINESS_REPRESENTATION' => 'BUSINESS_REPRESENTATION'
        ];

        // Fallback: if exact match fails, try the raw value, or empty
        $mappedService = $serviceMap[$row['service_category']] ?? ($row['service_category'] ?? '');

        // 3. Client Name Logic
        // Prefer Company Name, fallback to Requester Name
        $clientName = !empty($row['requester_company']) ? $row['requester_company'] : $row['requester_name'];

        echo json_encode([
            'ok' => true,
            'data' => [
                'client_name'   => $clientName,
                'service_type'  => $mappedService,
                'origin'        => $row['origin_location'],      // Maps to Place of Receipt
                'destination'   => $row['destination_location'], // Maps to Place of Delivery
                'weight'        => (float)$row['estimated_weight'],
                'unit'          => 'KG',                         // Option A: Force KG
                'cargo_desc'    => $row['cargo_description'],    // For Smart Wizard
                'is_project'    => (int)$row['project_cargo_flag'] === 1
            ]
        ]);
    } else {
        echo json_encode(['ok' => false, 'error' => 'Opportunity not found']);
    }

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}
?>