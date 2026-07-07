<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'SALES', 'MANAGEMENT', 'OPERATIONS', 'FINANCE']);

// Prevent HTML errors from breaking the CSV download
error_reporting(0); 

$conn = db();
$conn->set_charset('utf8mb4');

// --- 1. Get Filters (Same as list.php) ---
$q = trim((string)($_GET['q'] ?? ''));
$typeFilter = trim((string)($_GET['type'] ?? ''));
$statusFilter = trim((string)($_GET['status'] ?? ''));

// --- 2. Build Query ---
$whereSQL = "1=1";
$params = [];
$types = "";

if ($q !== '') {
    $whereSQL .= " AND (
      m.operations_file_reference LIKE CONCAT('%', ?, '%')
      OR m.client_id LIKE CONCAT('%', ?, '%')
      OR c.client_name LIKE CONCAT('%', ?, '%')
    )";
    $types .= "sss";
    $params[] = $q;
    $params[] = $q;
    $params[] = $q;
}

if ($typeFilter !== '') {
    $whereSQL .= " AND m.service_type = ?";
    $types .= "s";
    $params[] = $typeFilter;
}

if ($statusFilter !== '') {
    $whereSQL .= " AND m.operations_status = ?";
    $types .= "s";
    $params[] = $statusFilter;
}

$sql = "
    SELECT 
      m.operations_file_reference,
      COALESCE(c.client_name, m.client_name, m.client_id) as client,
      m.service_type,
      m.service_territory,
      m.operations_status,
      m.created_at,
      m.expected_delivery_time,
      (COALESCE(m.final_invoice_amount, 0) - COALESCE(m.ocr_amount, 0)) as calculated_margin
    FROM operations_file_master m
    LEFT JOIN client_master c ON c.client_id = m.client_id
    WHERE $whereSQL
    ORDER BY m.created_at DESC
    LIMIT 2000
";

$stmt = $conn->prepare($sql);
if ($types !== '') {
    $stmt->bind_param($types, ...$params);
}
$stmt->execute();
$res = $stmt->get_result();

// --- 3. Headers for Download ---
$filename = "ops_export_" . date('Ymd_His') . ".csv";
header('Content-Type: text/csv; charset=utf-8');
header('Content-Disposition: attachment; filename="' . $filename . '"');

// Open PHP output stream
$output = fopen('php://output', 'w');

// Add Byte Order Mark (BOM) for Excel UTF-8 compatibility
fwrite($output, "\xEF\xBB\xBF");

// CSV Column Headers
fputcsv($output, [
    'Ref', 
    'Client', 
    'Service', 
    'Territory', 
    'Status', 
    'Created Date', 
    'Expected Delivery', 
    'Realized Margin'
]);

// Loop rows and write to CSV
while ($row = $res->fetch_assoc()) {
    fputcsv($output, [
        $row['operations_file_reference'],
        $row['client'],
        $row['service_type'],
        $row['service_territory'],
        $row['operations_status'],
        $row['created_at'],
        $row['expected_delivery_time'],
        number_format((float)$row['calculated_margin'], 2)
    ]);
}

fclose($output);
exit;