<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  json_response(['ok' => false, 'message' => 'Method not allowed'], 405);
}

if (!csrf_verify($_POST['csrf_token'] ?? null)) {
  json_response(['ok' => false, 'message' => 'Invalid session'], 419);
}

$identifier = trim((string)($_POST['identifier'] ?? ''));
$password   = (string)($_POST['password'] ?? '');

if ($identifier === '' || $password === '') {
  json_response(['ok' => false, 'message' => 'Credentials required'], 422);
}

$conn = db();

$sql = "
  SELECT 
    ua.user_id, ua.employee_id, ua.username, ua.password_hash,
    ua.role, ua.is_active,
    em.full_name, em.status AS emp_status
  FROM user_auth ua
  JOIN employee_master em ON em.employee_id = ua.employee_id
  WHERE ua.username = ? OR em.email = ?
  LIMIT 1
";

$stmt = $conn->prepare($sql);
$stmt->bind_param('ss', $identifier, $identifier);
$stmt->execute();
$user = $stmt->get_result()->fetch_assoc();

if (!$user || !password_verify($password, $user['password_hash'])) {
  json_response(['ok' => false, 'message' => 'Invalid credentials'], 401);
}

if ((int)$user['is_active'] !== 1 || $user['emp_status'] !== 'ACTIVE') {
  json_response(['ok' => false, 'message' => 'Account disabled'], 403);
}

session_regenerate_id(true);

$_SESSION['auth'] = [
  'user_id'     => (int)$user['user_id'],
  'employee_id' => (string)$user['employee_id'],
  'username'    => (string)$user['username'],
  'role'        => (string)$user['role'],
  'full_name'   => (string)$user['full_name'],
];

$redirectMap = [
  'ADMIN'      => '../../view/admin/index',
  'FINANCE'    => '../../view/finance/index',
  'SALES'      => '../../view/sales/index',
  'OPERATIONS' => '../../view/operation/index',
  'MANAGEMENT' => '../../view/management/index',
];

$role = strtoupper($user['role']);
$redirect = $redirectMap[$role] ?? 'view/admin/index.php';

json_response([
  'ok' => true,
  'redirect' => $redirect
]);
