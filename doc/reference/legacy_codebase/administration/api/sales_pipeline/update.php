<?php
declare(strict_types=1);
require_once __DIR__ . '/_common.php';

// Ensure the user is authenticated and get their employee ID
$employeeId = require_employee_id();

// 1. Validate Input
$id = trim((string)post('quote_request_id', ''));
if ($id === '') {
    jexit(['ok' => false, 'error' => 'Missing quote_request_id'], 400);
}

// 2. Collect and Clean Values from POST
// We bypass any "conversion locks" here so the Sales team can progress the lead
$finalStatus = strtoupper(trim((string)post('status', 'NEW')));

$estimated_value_xaf = post('estimated_value_xaf', null);
$estimated_value_xaf = ($estimated_value_xaf === null || $estimated_value_xaf === '') ? null : (float)$estimated_value_xaf;

$requester_company = trim((string)post('requester_company', ''));
$requester_name    = trim((string)post('requester_name', ''));
$additional_notes  = (string)post('additional_notes', '');

// 3. Execute Update
// We update the financial value, the pipeline stage (status), and the audit metadata
$sql = "
    UPDATE quote_requests
    SET
        estimated_value_xaf = ?,
        status = ?,
        requester_company = ?,
        requester_name = ?,
        additional_notes = ?,
        updated_by_employee_id = ?,
        updated_at = NOW()
    WHERE quote_request_id = ?
    LIMIT 1
";

$stmt = $conn->prepare($sql);
if (!$stmt) {
    jexit(['ok' => false, 'error' => 'Prepare failed: ' . $conn->error], 500);
}

// Bind Types: d (double/float), s (string) x 6
$stmt->bind_param(
    'dssssss',
    $estimated_value_xaf,
    $finalStatus,
    $requester_company,
    $requester_name,
    $additional_notes,
    $employeeId,
    $id
);

$ok = $stmt->execute();

if (!$ok) {
    jexit(['ok' => false, 'error' => 'Update failed: ' . $stmt->error], 500);
}

// Return success to the UI
jexit(['ok' => true, 'updated_id' => $id]);