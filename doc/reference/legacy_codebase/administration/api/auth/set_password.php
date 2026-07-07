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

$rawToken = trim((string)($_POST['token'] ?? ''));
$newPass  = (string)($_POST['password'] ?? '');
$confirm  = (string)($_POST['confirm'] ?? '');

if ($rawToken === '') json_response(['ok' => false, 'message' => 'Token is required.'], 422);
if ($newPass === '' || strlen($newPass) < 8) json_response(['ok' => false, 'message' => 'Password must be at least 8 characters.'], 422);
if ($newPass !== $confirm) json_response(['ok' => false, 'message' => 'Passwords do not match.'], 422);

try {
  $conn = db();

  // Find candidate tokens that are not used and not expired
  $q = $conn->prepare("
    SELECT id, user_id, token_hash, purpose, expires_at
    FROM auth_password_resets
    WHERE used_at IS NULL AND expires_at >= NOW()
    ORDER BY id DESC
    LIMIT 50
  ");
  $q->execute();
  $rows = $q->get_result()->fetch_all(MYSQLI_ASSOC);

  $match = null;
  foreach ($rows as $r) {
    if (password_verify($rawToken, (string)$r['token_hash'])) {
      $match = $r;
      break;
    }
  }

  if (!$match) {
    json_response(['ok' => false, 'message' => 'Invalid or expired token.'], 400);
  }

  $conn->begin_transaction();

  $hash = password_hash($newPass, PASSWORD_DEFAULT);
  if ($hash === false) {
    $conn->rollback();
    json_response(['ok' => false, 'message' => 'Could not hash password.'], 500);
  }

  // Update password
  $u = $conn->prepare("UPDATE user_auth SET password_hash = ?, must_set_password = FALSE, password_set_at = NOW() WHERE user_id = ?");
  $u->bind_param('si', $hash, $match['user_id']);
  $u->execute();

  // Mark token used
  $m = $conn->prepare("UPDATE auth_password_resets SET used_at = NOW() WHERE id = ?");
  $m->bind_param('i', $match['id']);
  $m->execute();

  $conn->commit();

  json_response(['ok' => true, 'message' => 'Password updated successfully. You can now log in.'], 200);

} catch (mysqli_sql_exception $e) {
  if (isset($conn)) $conn->rollback();
  json_response(['ok' => false, 'message' => 'Server error.'], 500);
}
