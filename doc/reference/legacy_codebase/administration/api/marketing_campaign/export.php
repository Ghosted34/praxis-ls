<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

require_role(['ADMIN']);

$conn = db();

// filters
$q = trim($_GET['q'] ?? '');
$platform = trim($_GET['platform'] ?? '');
$status = trim($_GET['status'] ?? '');

$sql = "
  SELECT
    name,
    platform,
    budget_amount,
    leads,
    opportunities,
    won,
    start_date,
    end_date,
    status
  FROM marketing_campaigns
  WHERE 1=1
";

$params = [];
$types = '';

if ($q !== '') {
  $sql .= " AND name LIKE ?";
  $params[] = "%$q%";
  $types .= 's';
}
if ($platform !== '') {
  $sql .= " AND platform = ?";
  $params[] = $platform;
  $types .= 's';
}
if ($status !== '') {
  $sql .= " AND status = ?";
  $params[] = $status;
  $types .= 's';
}

$sql .= " ORDER BY start_date DESC";

$stmt = $conn->prepare($sql);
if ($params) {
  $stmt->bind_param($types, ...$params);
}
$stmt->execute();
$res = $stmt->get_result();

// CSV headers
header('Content-Type: text/csv; charset=utf-8');
header('Content-Disposition: attachment; filename=marketing_campaigns_' . date('Ymd_His') . '.csv');

$out = fopen('php://output', 'w');

// header row
fputcsv($out, [
  'Campaign Name',
  'Platform',
  'Budget',
  'Leads',
  'Opportunities',
  'Won',
  'Start Date',
  'End Date',
  'Status'
]);

while ($row = $res->fetch_assoc()) {
  fputcsv($out, [
    $row['name'],
    $row['platform'],
    $row['budget_amount'],
    $row['leads'],
    $row['opportunities'],
    $row['won'],
    $row['start_date'],
    $row['end_date'],
    $row['status'],
  ]);
}

fclose($out);
exit;
