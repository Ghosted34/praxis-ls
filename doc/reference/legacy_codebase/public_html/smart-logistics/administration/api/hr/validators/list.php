<?php
declare(strict_types=1);

require_once __DIR__ . '/../../../includes/init.php';
require_once __DIR__ . '/../../../includes/role_guard.php';
require_role(['ADMIN','FINANCE','MANAGEMENT','OPERATIONS']);

header('Content-Type: application/json; charset=utf-8');
$conn = db();

function jexit(array $p, int $code=200): void {
  http_response_code($code);
  echo json_encode($p);
  exit;
}

/*
Assumptions (adjust names if needed):
- employee_master.employee_id
- employee_master.full_name
- employee_master.job_title
- employee_master.system_authority SET(...)
- employee_master.status = 'ACTIVE'
*/

$sql = "
  SELECT
    employee_id,
    full_name,
    job_title
  FROM employee_master
  WHERE status = 'ACTIVE'
    AND FIND_IN_SET('VALIDATOR', system_authority)
  ORDER BY full_name ASC
";

$stmt = $conn->prepare($sql);
if (!$stmt) {
  jexit(['ok'=>false,'error'=>'Prepare failed'], 500);
}

$stmt->execute();
$res = $stmt->get_result();

$data = [];
while ($row = $res->fetch_assoc()) {
  $data[] = [
    'employee_id' => $row['employee_id'],
    'full_name'   => $row['full_name'],
    'job_title'   => $row['job_title'],
  ];
}

jexit([
  'ok'   => true,
  'data' => $data
]);
