<?php
declare(strict_types=1);
require_once __DIR__ . '/_common.php';

// 1. Authentication & ID Generation
$employeeId = require_employee_id();
$quote_request_id = uuidv4();

// 2. Minimal Required Field Validation
$requester_name   = trim((string)post('requester_name', ''));
$requester_email  = trim((string)post('requester_email', ''));
$requester_phone  = trim((string)post('requester_phone', ''));
$service_category = trim((string)post('service_category', ''));
$service_type     = trim((string)post('service_type', ''));

if ($requester_name === '' || $requester_email === '' || $requester_phone === '' || $service_category === '' || $service_type === '') {
    jexit(['ok' => false, 'error' => 'Missing required fields (Name/Email/Phone/Service Info)'], 422);
}

// 3. Reference & Channel Mapping
$public_quote_ref = trim((string)post('public_quote_ref', ''));
if ($public_quote_ref === '' || $public_quote_ref === '(Auto-Generated)') {
    $public_quote_ref = 'OPP-' . date('Y') . '-' . strtoupper(substr(bin2hex(random_bytes(3)), 0, 6));
}

$intake_channel = trim((string)post('intake_channel', 'MANUAL_ENTRY'));
$requester_company = trim((string)post('requester_company', ''));

// 4. Logistics & Location Details
$origin_location      = trim((string)post('origin_location', ''));
$destination_location = trim((string)post('destination_location', ''));
$warehouse_location   = trim((string)post('warehouse_location', ''));
$warehouse_duration   = trim((string)post('warehouse_duration', 'UNKNOWN'));

// 5. Numeric Data Sanitization
$estimated_weight = post('estimated_weight', null);
$estimated_weight = ($estimated_weight === null || $estimated_weight === '') ? null : (float)$estimated_weight;

$estimated_value_xaf = post('estimated_value_xaf', null);
$estimated_value_xaf = ($estimated_value_xaf === null || $estimated_value_xaf === '') ? null : (float)$estimated_value_xaf;

// 6. Cargo & Status Logic
$project_cargo_flag = (int)(post('project_cargo_flag', 0) ? 1 : 0);
$cargo_description  = (string)post('cargo_description', '');
$additional_notes   = (string)post('additional_notes', '');

// FIX: Bypass the translation helper and use raw status for Kanban compatibility
$status = strtoupper(trim((string)post('status', 'NEW')));

// Ensure record is visible on the Pipeline Board (requires converted_opportunity_id != NULL)
$converted_opportunity_id = trim((string)post('converted_opportunity_id', ''));
if ($converted_opportunity_id === '') {
    $converted_opportunity_id = $quote_request_id;
}

// 7. Database Insertion
$sql = "
    INSERT INTO quote_requests (
        quote_request_id, public_quote_ref, intake_channel,
        requester_name, requester_company, requester_email, requester_phone,
        service_category, service_type,
        origin_location, destination_location,
        warehouse_location, warehouse_duration,
        estimated_weight, estimated_value_xaf,
        project_cargo_flag, cargo_description, additional_notes,
        status, converted_opportunity_id,
        created_by_employee_id, updated_by_employee_id
    ) VALUES (
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?,
        ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?
    )
";

$stmt = $conn->prepare($sql);
if (!$stmt) {
    jexit(['ok' => false, 'error' => 'Prepare failed: ' . $conn->error], 500);
}

// bind_param: 13 strings (s), 2 doubles (d), 1 integer (i), 6 strings (s) = sssssssssssssddissssss
$stmt->bind_param(
    'sssssssssssssddissssss',
    $quote_request_id, $public_quote_ref, $intake_channel,
    $requester_name, $requester_company, $requester_email, $requester_phone,
    $service_category, $service_type,
    $origin_location, $destination_location,
    $warehouse_location, $warehouse_duration,
    $estimated_weight, $estimated_value_xaf,
    $project_cargo_flag, $cargo_description, $additional_notes,
    $status, $converted_opportunity_id,
    $employeeId, $employeeId
);

$ok = $stmt->execute();

if (!$ok) {
    jexit(['ok' => false, 'error' => 'Insert failed: ' . $stmt->error], 500);
}

// 8. Return Confirmation
jexit(['ok' => true, 'data' => [
    'quote_request_id' => $quote_request_id,
    'public_quote_ref' => $public_quote_ref
]]);