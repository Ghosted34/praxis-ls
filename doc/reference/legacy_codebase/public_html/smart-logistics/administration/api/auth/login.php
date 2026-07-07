<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  json_response(['ok' => false, 'message' => 'Method not allowed.'], 405);
}

$token = $_POST['csrf_token'] ?? null;
if (!csrf_verify(is_string($token) ? $token : null)) {
  json_response(['ok' => false, 'message' => 'Invalid CSRF token. Refresh and try again.'], 419);
}

$identifier = trim((string)($_POST['identifier'] ?? ''));
$password   = (string)($_POST['password'] ?? '');
$remember   = (int)($_POST['remember'] ?? 0);

if ($identifier === '' || $password === '') {
  json_response(['ok' => false, 'message' => 'Username/email and password are required.'], 422);
}

try {
  $conn = db();

  // Allow login by username or by email (via join on employee_master)
  $sql = "
    SELECT
      ua.user_id,
      ua.employee_id,
      ua.username,
      ua.password_hash,
      ua.role,
      ua.authority_capabilities,
      ua.is_active,
      em.full_name,
      em.email,
      em.department,
      em.status AS employee_status
    FROM user_auth ua
    JOIN employee_master em ON em.employee_id = ua.employee_id
    WHERE ua.username = ? OR em.email = ?
    LIMIT 1
  ";

  $stmt = $conn->prepare($sql);
  $stmt->bind_param('ss', $identifier, $identifier);
  $stmt->execute();

  $result = $stmt->get_result();
  $user = $result->fetch_assoc();

  // Generic error to avoid user enumeration
  if (!$user) {
    json_response(['ok' => false, 'message' => 'Invalid credentials.'], 401);
  }

  // Account status checks
  if ((int)$user['is_active'] !== 1) {
    json_response(['ok' => false, 'message' => 'Account disabled. Contact system administrator.'], 403);
  }
  if (($user['employee_status'] ?? 'ACTIVE') !== 'ACTIVE') {
    json_response(['ok' => false, 'message' => 'Employee status is not ACTIVE.'], 403);
  }

  // Verify hashed password
  if (!password_verify($password, (string)$user['password_hash'])) {
    json_response(['ok' => false, 'message' => 'Invalid credentials.'], 401);
  }

  // Optional: if PHP decides hash needs upgrade, rehash
  if (password_needs_rehash((string)$user['password_hash'], PASSWORD_DEFAULT)) {
    $newHash = password_hash($password, PASSWORD_DEFAULT);
    if ($newHash) {
      $u = $conn->prepare("UPDATE user_auth SET password_hash = ? WHERE user_id = ?");
      $u->bind_param('si', $newHash, $user['user_id']);
      $u->execute();
    }
  }

  // Session hardening: prevent session fixation
  session_regenerate_id(true);

  // Store minimal session claims (avoid storing password hash)
  $_SESSION['auth'] = [
    'user_id' => (int)$user['user_id'],
    'employee_id' => (string)$user['employee_id'],
    'username' => (string)$user['username'],
    'role' => (string)$user['role'],
    'authority_capabilities' => (string)$user['authority_capabilities'],
    'full_name' => (string)$user['full_name'],
    'email' => (string)$user['email'],
  ];

  // Role-based landing pages
$role = strtoupper((string)$user['role']);

$roleLanding = [
  'ADMIN'      => 'view/admin/index.php',
  'FINANCE'    => 'view/finance/index.php',
  'SALES'      => 'view/sales/index.php',
  'OPERATIONS' => 'view/operation/index.php',
  'MANAGEMENT' => 'view/management/index.php',
];

$redirect = $roleLanding[$role] ?? 'view/admin/index.php';


  // Update last_login
  $upd = $conn->prepare("UPDATE user_auth SET last_login = NOW() WHERE user_id = ?");
  $upd->bind_param('i', $user['user_id']);
  $upd->execute();

  // "Remember me" (simple approach): extend session cookie lifetime
  // For production, prefer a persistent token table (remember_tokens) instead.
  if ($remember === 1) {
    // 14 days
    ini_set('session.cookie_lifetime', (string)(14 * 24 * 60 * 60));
    // Note: cookie_lifetime should ideally be set before session_start in init.php for full effect.
  }

  json_response([
  'ok' => true,
  'message' => 'Login successful.',
  'redirect' => $redirect
], 200);


} catch (mysqli_sql_exception $e) {
  json_response(['ok' => false, 'message' => 'Server error.'], 500);
}
