<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_once __DIR__ . '/_util.php';

require_role(['ADMIN','MANAGEMENT','OPERATIONS','FINANCE','SALES']);

header('Content-Type: application/json; charset=utf-8');

$conn = db();
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

$q = trim((string)($_GET['q'] ?? ''));
$limit = min(50, max(5, (int)($_GET['limit'] ?? 25)));

// If you ONLY want ACTIVE validators, change IN (...) back to = 'ACTIVE'
$where = "em.status IN ('ACTIVE','PENDING') AND FIND_IN_SET('VALIDATOR', em.system_authority) > 0";

$types = "";
$params = [];

if ($q !== '') {
  $where .= " AND (em.employee_id LIKE CONCAT('%', ?, '%') OR em.full_name LIKE CONCAT('%', ?, '%'))";
  $types .= "ss";
  $params[] = $q;
  $params[] = $q;
}

$sql = "
  SELECT
    em.employee_id,
    em.full_name,
    em.department,
    em.job_title,
    em.status,
    em.system_authority
  FROM employee_master em
  WHERE {$where}
  ORDER BY em.department ASC, em.full_name ASC
  LIMIT ?
";

$types .= "i";
$params[] = $limit;

try {
  $stmt = $conn->prepare($sql);

  // bind_param safely (dynamic)
  $bind = [];
  $bind[] = $types;
  for ($i = 0; $i < count($params); $i++) $bind[] = &$params[$i];
  call_user_func_array([$stmt, 'bind_param'], $bind);

  $stmt->execute();
  $stmt->store_result();

  $employee_id = $full_name = $department = $job_title = $status = $system_authority = null;
  $stmt->bind_result($employee_id, $full_name, $department, $job_title, $status, $system_authority);

  $items = [];
  while ($stmt->fetch()) {
    $items[] = [
      'employee_id' => $employee_id,
      'full_name' => $full_name,
      'department' => $department,
      'job_title' => $job_title,
      'status' => $status,
      'system_authority' => $system_authority,
    ];
  }

  json_out(['ok' => true, 'items' => $items]);

} catch (Throwable $e) {
  json_out(['ok' => false, 'message' => 'Query failed', 'detail' => $e->getMessage()], 500);
}
