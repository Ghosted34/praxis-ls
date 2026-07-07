<?php
declare(strict_types=1);
require_once __DIR__ . '/../../includes/init.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  json_response(['ok' => false, 'message' => 'Method not allowed.'], 405);
}

$token = $_POST['csrf_token'] ?? null;
if (!csrf_verify(is_string($token) ? $token : null)) {
  json_response(['ok' => false, 'message' => 'Invalid CSRF token.'], 419);
}

$identifier = trim((string)($_POST['identifier'] ?? ''));
$purpose = strtoupper(trim((string)($_POST['purpose'] ?? 'RESET'))); // RESET or SET_PASSWORD
if ($identifier === '') {
  json_response(['ok' => false, 'message' => 'Please enter username or email.'], 422);
}
if (!in_array($purpose, ['RESET','SET_PASSWORD'], true)) {
  $purpose = 'RESET';
}

try {
  $conn = db();

  // Find user by username or email (join employee_master)
  $sql = "
    SELECT ua.user_id, ua.is_active, ua.must_set_password
    FROM user_auth ua
    JOIN employee_master em ON em.employee_id = ua.employee_id
    WHERE ua.username = ? OR em.email = ?
    LIMIT 1
  ";
  $stmt = $conn->prepare($sql);
  $stmt->bind_param('ss', $identifier, $identifier);
  $stmt->execute();
  $user = $stmt->get_result()->fetch_assoc();

  // Always return same message to prevent account enumeration
  $genericMsg = 'If the account exists, a secure link will be provided.';

  if (!$user) {
    json_response(['ok' => true, 'message' => $genericMsg], 200);
  }

  if ((int)$user['is_active'] !== 1) {
    json_response(['ok' => true, 'message' => $genericMsg], 200);
  }

  // If purpose is SET_PASSWORD, ensure account requires it (optional rule)
  if ($purpose === 'SET_PASSWORD' && (int)$user['must_set_password'] !== 1) {
    // Still generic response
    json_response(['ok' => true, 'message' => $genericMsg], 200);
  }

  // Generate token
  $rawToken = bin2hex(random_bytes(32)); // 64 chars
  $tokenHash = password_hash($rawToken, PASSWORD_DEFAULT);

  $expiresAt = (new DateTimeImmutable('+30 minutes'))->format('Y-m-d H:i:s');

  $ip = $_SERVER['REMOTE_ADDR'] ?? null;
  $ua = substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255);

  $ins = $conn->prepare("
    INSERT INTO auth_password_resets (user_id, token_hash, purpose, expires_at, requested_ip, requested_ua)
    VALUES (?, ?, ?, ?, ?, ?)
  ");
  $ins->bind_param('isssss', $user['user_id'], $tokenHash, $purpose, $expiresAt, $ip, $ua);
  $ins->execute();

  // Build link (local dev)
  // You can choose a dedicated page e.g. /administration/set-password.php
  $link = sprintf('http://localhost/administration/set-password.php?token=%s', $rawToken);

  // Production: EMAIL $link instead of returning it.
  json_response([
    'ok' => true,
    'message' => $genericMsg,
    'dev_link' => $link // remove in production
  ], 200);

} catch (mysqli_sql_exception $e) {
  json_response(['ok' => false, 'message' => 'Server error.'], 500);
}
