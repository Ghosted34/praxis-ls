<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'FINANCE', 'MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');

$conn = db();

$raw = file_get_contents('php://input');
$body = json_decode($raw ?: '[]', true);

$userId = (int)($body['user_id'] ?? 0);
$role   = strtoupper(trim((string)($body['role'] ?? '')));
$auth   = $body['authority'] ?? [];

$allowedRoles = ['SALES','OPERATIONS','FINANCE','ADMIN','MANAGEMENT'];
if ($userId <= 0) { http_response_code(422); echo json_encode(['ok'=>false,'message'=>'user_id required']); exit; }
if (!in_array($role, $allowedRoles, true)) { http_response_code(422); echo json_encode(['ok'=>false,'message'=>'Invalid role']); exit; }

if (!is_array($auth)) $auth = [];
$auth = array_values(array_unique(array_filter(array_map(function($x){
  $x = strtoupper(trim((string)$x));
  return in_array($x, ['ISSUER','VALIDATOR','APPROVER'], true) ? $x : null;
}, $auth))));

if (!$auth) $auth = ['ISSUER']; // default
$authSet = implode(',', $auth);

// helper functions (same as save.php)
function generate_token(): string {
    return bin2hex(random_bytes(32));
}
function create_activation_token(mysqli $conn, int $user_id, int $hours = 24): string {
    $token = generate_token();
    $token_hash = hash('sha256', $token);
    $expires_at = date('Y-m-d H:i:s', time() + ($hours * 3600));
    $ip = $_SERVER['REMOTE_ADDR'] ?? null;
    $ua = substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255);

    $sql = "INSERT INTO password_tokens (user_id, token_hash, purpose, expires_at, ip_address, user_agent)
            VALUES (?, ?, 'activation', ?, ?, ?)";
    $stmt = $conn->prepare($sql);
    if (!$stmt) throw new RuntimeException('Prepare failed token insert: ' . $conn->error);
    $stmt->bind_param('issss', $user_id, $token_hash, $expires_at, $ip, $ua);
    $stmt->execute();
    $stmt->close();

    return $token;
}
function send_activation_email(string $to_email, string $full_name, string $token, int $hours = 24): bool {
    $link = "https://yourdomain.com/activate.php?token=" . urlencode($token);
    $subject = "Activate your account";
    $message = "Hello {$full_name},\n\n"
             . "Click the link below to set your password (link expires in {$hours} hours):\n\n"
             . "{$link}\n\n"
             . "If you did not expect this, ignore this message.\n";
    $headers = "From: no-reply@yourdomain.com\r\nReply-To: no-reply@yourdomain.com\r\n";
    return mail($to_email, $subject, $message, $headers);
}

// update user_auth
try {
    $conn->begin_transaction();

    $sql = "
      UPDATE user_auth
      SET
        role = ?,
        authority_capabilities = ?,
        must_set_password = 1,
        password_set_at = NULL,
        is_active = 0
      WHERE user_id = ?
      LIMIT 1
    ";
    $stmt = $conn->prepare($sql);
    if (!$stmt) { throw new RuntimeException('SQL prepare failed: '.$conn->error); }
    $stmt->bind_param('ssi', $role, $authSet, $userId);
    $stmt->execute();
    $stmt->close();

    // get employee email and full_name from employee_master (for sending mail)
    $sql2 = "SELECT em.email, em.full_name FROM employee_master em
             JOIN user_auth ua ON ua.employee_id = em.employee_id
             WHERE ua.user_id = ? LIMIT 1";
    $stmt2 = $conn->prepare($sql2);
    $stmt2->bind_param('i', $userId);
    $stmt2->execute();
    $res = $stmt2->get_result()->fetch_assoc();
    $stmt2->close();

    if (!$res) throw new RuntimeException('User employee data not found');

    // create activation token
    $token = create_activation_token($conn, $userId, 24);

    $conn->commit();

    // send activation mail
    send_activation_email($res['email'], $res['full_name'] ?? $res['email'], $token, 24);

    echo json_encode(['ok'=>true]);

} catch (Exception $e) {
    if ($conn->in_transaction) $conn->rollback();
    http_response_code(500);
    echo json_encode(['ok'=>false,'message'=>'Server error','detail'=>$e->getMessage()]);
}
