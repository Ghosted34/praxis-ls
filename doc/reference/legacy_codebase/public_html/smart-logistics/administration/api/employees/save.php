<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'FINANCE', 'MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');

$conn = db();

$raw = file_get_contents('php://input');
$in = json_decode($raw ?: '[]', true);

if (!is_array($in)) {
  http_response_code(400);
  echo json_encode(['ok' => false, 'message' => 'Invalid JSON body']);
  exit;
}

function s($v): string { return trim((string)$v); }
function nullableDate($v): ?string {
  $v = trim((string)$v);
  return $v === '' ? null : $v;
}

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
    // Simple mail fallback - replace with PHPMailer/Smtp in production
    $headers = "From: no-reply@yourdomain.com\r\nReply-To: no-reply@yourdomain.com\r\n";
    return mail($to_email, $subject, $message, $headers);
}

// ---------------- INPUT ----------------
$id        = s($in['id'] ?? '');
$name      = s($in['name'] ?? '');
$signatory = s($in['signatory'] ?? '');
$email     = s($in['email'] ?? '');
$dept      = s($in['dept'] ?? '');
$title     = s($in['title'] ?? '');
$type      = s($in['type'] ?? '');
$joinDate  = s($in['joinDate'] ?? '');
$status    = s($in['status'] ?? 'ACTIVE');

$dob       = nullableDate($in['dob'] ?? null);
$marital   = s($in['marital'] ?? '');
$salary    = (float)($in['salary'] ?? 0);
$payMethod = s($in['payMethod'] ?? 'BANK_TRANSFER');
$bank      = s($in['bank'] ?? '');

$createLogin = (bool)($in['createLogin'] ?? false);

// System Authority
$authorityArr = $in['authority'] ?? [];
$authority = is_array($authorityArr) ? implode(',', array_map('strval', $authorityArr)) : '';

// ---------------- VALIDATION ----------------
if ($name === '' || $email === '' || $dept === '' || $title === '' || $joinDate === '') {
  http_response_code(422);
  echo json_encode(['ok' => false, 'message' => 'Missing required fields']);
  exit;
}

// Generate ID if new
if ($id === '' || $id === 'SL-XXX') {
  $id = 'SL-' . str_pad((string)random_int(1, 9999999), 7, '0', STR_PAD_LEFT);
}

try {
  $conn->begin_transaction();

  // ---------------- EMPLOYEE MASTER ----------------
  $sql = "
    INSERT INTO employee_master
      (employee_id, full_name, signatory_name, email, department, job_title,
       employment_type, join_date, status, system_authority,
       dob, marital_status, base_salary, payment_method, bank_details)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      full_name = VALUES(full_name),
      signatory_name = VALUES(signatory_name),
      email = VALUES(email),
      department = VALUES(department),
      job_title = VALUES(job_title),
      employment_type = VALUES(employment_type),
      join_date = VALUES(join_date),
      status = VALUES(status),
      system_authority = VALUES(system_authority),
      dob = VALUES(dob),
      marital_status = VALUES(marital_status),
      base_salary = VALUES(base_salary),
      payment_method = VALUES(payment_method),
      bank_details = VALUES(bank_details)
  ";

  $stmt = $conn->prepare($sql);
  if (!$stmt) throw new RuntimeException('Prepare failed: '.$conn->error);
  $stmt->bind_param(
    'ssssssssssssdss',
    $id,
    $name,
    $signatory,
    $email,
    $dept,
    $title,
    $type,
    $joinDate,
    $status,
    $authority,
    $dob,
    $marital,
    $salary,
    $payMethod,
    $bank
  );
  $stmt->execute();
  $stmt->close();

  // ---------------- USER AUTH ----------------
  $sentToken = null;
  if ($createLogin) {
    $username = strtolower(strtok($email, '@')) ?: $id;

    $validRoles = ['ADMIN','FINANCE','SALES','OPERATIONS','MANAGEMENT'];
    $role = in_array($dept, $validRoles, true) ? $dept : 'ADMIN';

    $sql2 = "
      INSERT INTO user_auth (employee_id, username, role, authority_capabilities, password_hash, must_set_password, is_active)
      VALUES (?, ?, ?, ?, ?, 1, 0)
      ON DUPLICATE KEY UPDATE
        username = VALUES(username),
        role = VALUES(role),
        authority_capabilities = VALUES(authority_capabilities),
        must_set_password = 1,
        is_active = 0
    ";

    $emptyHash = ''; // avoid using a known literal; real password set on activation
    $stmt2 = $conn->prepare($sql2);
    if (!$stmt2) throw new RuntimeException('Prepare failed user_auth: '.$conn->error);
    $stmt2->bind_param('sssss', $id, $username, $role, $authority, $emptyHash);
    $stmt2->execute();
    $stmt2->close();

    // fetch user_id for this user_auth row
    $sql3 = "SELECT user_id FROM user_auth WHERE employee_id = ? LIMIT 1";
    $stmt3 = $conn->prepare($sql3);
    $stmt3->bind_param('s', $id);
    $stmt3->execute();
    $res = $stmt3->get_result()->fetch_assoc();
    $stmt3->close();

    if (!$res || !isset($res['user_id'])) {
      throw new RuntimeException('Failed to fetch user_id after user_auth insert');
    }
    $userId = (int)$res['user_id'];

    // create token (store token hash)
    $token = create_activation_token($conn, $userId, 24);
    $sentToken = $token; // send after commit
  }

  $conn->commit();

  // send email AFTER commit (so token exists in DB)
  if (!empty($sentToken)) {
      // full name already available as $name
      send_activation_email($email, $name, $sentToken, 24);
  }

  echo json_encode(['ok' => true, 'employee_id' => $id], JSON_UNESCAPED_SLASHES);

} catch (Exception $e) {
  if ($conn->in_transaction) $conn->rollback();
  http_response_code(500);
  echo json_encode([
    'ok' => false,
    'message' => 'Server error',
    'detail' => $e->getMessage()
  ]);
}
