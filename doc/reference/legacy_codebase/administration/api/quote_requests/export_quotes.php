<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN','SALES','MANAGEMENT']);

$conn = db();
$conn->set_charset('utf8mb4');

// Reuse filters
$q        = trim((string)($_GET['q'] ?? ''));
$status   = trim((string)($_GET['status'] ?? ''));
$category = trim((string)($_GET['category'] ?? ''));
$month    = trim((string)($_GET['month'] ?? ''));
$year     = trim((string)($_GET['year'] ?? ''));

$where  = "1=1";
$types  = "";
$params = [];

if ($q !== '') {
  $where .= " AND (qr.public_quote_ref LIKE CONCAT('%', ?, '%') OR qr.requester_name LIKE CONCAT('%', ?, '%') OR qr.requester_company LIKE CONCAT('%', ?, '%'))";
  $types .= "sss";
  array_push($params, $q, $q, $q);
}
if ($status !== '') {
  $where .= " AND qr.status = ?";
  $types .= "s";
  $params[] = $status;
}
if ($category !== '') {
  $where .= " AND qr.service_category = ?";
  $types .= "s";
  $params[] = $category;
}
if ($year !== '') {
    $where .= " AND YEAR(qr.submission_datetime) = ?";
    $types .= "s";
    $params[] = $year;
}
if ($month !== '') {
    $where .= " AND MONTH(qr.submission_datetime) = ?";
    $types .= "s";
    $params[] = $month;
}

// Headers
header('Content-Type: text/csv; charset=utf-8');
header('Content-Disposition: attachment; filename=Smart_Quotes_Export_' . date('Y-m-d') . '.csv');

$out = fopen('php://output', 'w');
fputcsv($out, ['Ref', 'Requester', 'Company', 'Email', 'Phone', 'Category', 'Type', 'Origin', 'Destination', 'Status', 'Submitted Date']);

// Stream rows (No Limit)
$sql = "SELECT qr.public_quote_ref, qr.requester_name, qr.requester_company, qr.requester_email, qr.requester_phone, qr.service_category, qr.service_type, qr.origin_location, qr.destination_location, qr.status, qr.submission_datetime 
        FROM quote_requests qr WHERE $where ORDER BY qr.submission_datetime DESC";

$stmt = $conn->prepare($sql);
if ($types) $stmt->bind_param($types, ...$params);
$stmt->execute();
$res = $stmt->get_result();

while ($row = $res->fetch_assoc()) {
    fputcsv($out, [
        $row['public_quote_ref'],
        $row['requester_name'],
        $row['requester_company'],
        $row['requester_email'],
        $row['requester_phone'],
        $row['service_category'],
        $row['service_type'],
        $row['origin_location'],
        $row['destination_location'],
        $row['status'],
        $row['submission_datetime']
    ]);
}
fclose($out);
exit;
?>