<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'FINANCE', 'MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');

$conn = db();
$q = trim((string)($_GET['q'] ?? ''));

/**
 * IMPORTANT:
 * Replace em.status with your real "pending" column in employee_master
 * e.g. em.employment_status / em.onboarding_status / em.account_status
 */
$sql = "
  SELECT
    em.employee_id,
    em.full_name,
    em.email,
    em.department,
    em.job_title,

    ua.user_id,
    ua.username,
    ua.role,
    ua.authority_capabilities,
    ua.must_set_password,
    ua.password_set_at,
    ua.is_active
  FROM employee_master em
  LEFT JOIN user_auth ua ON ua.employee_id = em.employee_id
  WHERE em.status = 'PENDING'
";

$types = "";
$params = [];

if ($q !== '') {
  $sql .= " AND (em.full_name LIKE ? OR em.employee_id LIKE ? OR em.email LIKE ?)";
  $like = "%{$q}%";
  $types = "sss";
  $params = [$like, $like, $like];
}

$sql .= " ORDER BY em.full_name ASC LIMIT 300";

$stmt = $conn->prepare($sql);
if (!$stmt) {
  http_response_code(500);
  echo json_encode(['ok' => false, 'message' => 'SQL prepare failed', 'error' => $conn->error]);
  exit;
}
if ($types !== '') $stmt->bind_param($types, ...$params);

$stmt->execute();
$rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

$out = array_map(function($r){
  // normalize user_id: return int when present, otherwise null (not 0)
  $userId = (array_key_exists('user_id', $r) && $r['user_id'] !== null) ? (int)$r['user_id'] : null;

  // derive status more helpfully
  if ($userId === null) {
      $status = 'NOT_PROVISIONED';
  } else {
      $status = (!empty($r['is_active']) && (int)$r['is_active'] === 1) ? 'ACTIVE' : 'SUSPENDED';
  }

  return [
    'user_id'     => $userId,                       // null if not provisioned
    'employee_id' => (string)$r['employee_id'],
    'name'        => (string)$r['full_name'],
    'email'       => (string)$r['email'],
    'dept'        => (string)$r['department'],
    'title'       => (string)$r['job_title'],

    // if user_auth not created yet, present useful defaults
    'role'        => (string)($r['role'] ?? 'PENDING'),
    'authority'   => (string)($r['authority_capabilities'] ?? 'ISSUER'),
    'status'      => $status
  ];
}, $rows);


echo json_encode(['ok' => true, 'rows' => $out], JSON_UNESCAPED_SLASHES);
