<?php
/*
 * api/costing/get-suggestions.php
 * Fetch costing line suggestions based on Service Applicability
 */
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN','MANAGEMENT','OPERATIONS','FINANCE','SALES']);

// 1. Get the target applicability string (e.g., "Sea Import")
$target = trim($_GET['applicability'] ?? '');

if ($target === '') {
    echo json_encode(['ok' => true, 'items' => []]);
    exit;
}

$conn = db();

// 2. Search logic: We look for the target string inside the service_applicability column.
// We select code, names (EN/FR). Prices are NOT selected as per instruction #5 & #7.
$sql = "
  SELECT code, name_en, name_fr
  FROM financial_dictionary
  WHERE status = 'ACTIVE'
    AND REPLACE(REPLACE(LOWER(service_applicability), '_', ' '), '-', ' ')
        LIKE CONCAT('%', REPLACE(REPLACE(LOWER(?), '_', ' '), '-', ' '), '%')
  ORDER BY code ASC
";


$stmt = $conn->prepare($sql);
$stmt->bind_param('s', $target);
$stmt->execute();
$result = $stmt->get_result();

$items = [];
while ($row = $result->fetch_assoc()) {
    $items[] = [
        'code'    => $row['code'],
        'name_en' => $row['name_en'],
        'name_fr' => $row['name_fr']
    ];
}

echo json_encode(['ok' => true, 'items' => $items]);