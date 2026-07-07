<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'FINANCE', 'MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');

$conn = db();

$q = trim((string)($_GET['q'] ?? ''));
$dept = trim((string)($_GET['dept'] ?? ''));
$status = trim((string)($_GET['status'] ?? ''));

try {
  $sql = "
    SELECT
      em.employee_id,
      em.full_name,
      em.signatory_name,
      em.email,
      em.department,
      em.job_title,
      em.employment_type,
      em.join_date,
      em.status,
      em.dob,
      em.marital_status,
      em.phone,
      em.address,
      em.base_salary,
      em.payment_method,
      em.bank_details,
      ua.user_id,
      ua.username,
      ua.role,
      ua.authority_capabilities
    FROM employee_master em
    LEFT JOIN (
  SELECT employee_id, MAX(user_id) AS user_id
  FROM user_auth
  WHERE is_active = 1
  GROUP BY employee_id
) uax ON uax.employee_id = em.employee_id
LEFT JOIN user_auth ua ON ua.user_id = uax.user_id

    WHERE 1=1
  ";

  $types = "";
  $params = [];

  if ($dept !== '') {
    $sql .= " AND em.department = ? ";
    $types .= "s";
    $params[] = $dept;
  }

  if ($status !== '') {
    $sql .= " AND em.status = ? ";
    $types .= "s";
    $params[] = $status;
  }

  if ($q !== '') {
    $sql .= " AND (em.full_name LIKE ? OR em.employee_id LIKE ? OR em.email LIKE ?) ";
    $types .= "sss";
    $like = "%{$q}%";
    $params[] = $like;
    $params[] = $like;
    $params[] = $like;
  }

  $sql .= " ORDER BY em.status ASC, em.department ASC, em.full_name ASC ";

  $stmt = $conn->prepare($sql);
  if ($types !== "") $stmt->bind_param($types, ...$params);
  $stmt->execute();

  $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

  // KPIs
  $total = count($rows);
  $permanent = 0;
  $contractLike = 0;
  $exited = 0;

  foreach ($rows as $r) {
    if (($r['employment_type'] ?? '') === 'PERMANENT') $permanent++;
    else $contractLike++;

    if (($r['status'] ?? '') === 'EXITED') $exited++;
  }

  // Normalize for UI
  $out = array_map(function($r){
    return [
      'id' => (string)$r['employee_id'],
      'name' => (string)($r['full_name'] ?? ''),
      'signatory' => (string)($r['signatory_name'] ?? ''),
      'email' => (string)($r['email'] ?? ''),
      'dept' => (string)($r['department'] ?? ''),
      'title' => (string)($r['job_title'] ?? ''),
      'type' => (string)($r['employment_type'] ?? ''),
      'joinDate' => (string)($r['join_date'] ?? ''),
      'status' => (string)($r['status'] ?? ''),

      'dob' => $r['dob'] ? (string)$r['dob'] : '',
      'marital' => (string)($r['marital_status'] ?? 'SINGLE'),
      'phone' => (string)($r['phone'] ?? ''),
      'address' => (string)($r['address'] ?? ''),

      'salary' => (float)($r['base_salary'] ?? 0),
      'payMethod' => (string)($r['payment_method'] ?? 'BANK_TRANSFER'),
      'bank' => (string)($r['bank_details'] ?? ''),

      'user' => [
        'user_id' => $r['user_id'] ? (int)$r['user_id'] : null,
        'username' => (string)($r['username'] ?? ''),
        'role' => (string)($r['role'] ?? ''),
        'authority' => (string)($r['authority_capabilities'] ?? ''),
      ]
    ];
  }, $rows);

  echo json_encode([
    'ok' => true,
    'kpis' => [
      'total' => $total,
      'permanent' => $permanent,
      'contract' => $contractLike,
      'exited' => $exited,
    ],
    'rows' => $out
  ], JSON_UNESCAPED_SLASHES);

} catch (mysqli_sql_exception $e) {
  http_response_code(500);
  echo json_encode(['ok' => false, 'message' => 'Server error', 'detail' => $e->getMessage()]);
}
