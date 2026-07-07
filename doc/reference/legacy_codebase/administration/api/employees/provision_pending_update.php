<?php
declare(strict_types=1);


require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

// 1. SECURITY: Only specific high-level roles can provision
require_role(['ADMIN', 'FINANCE', 'MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');

$conn = db();

// 2. INPUT PARSING
$raw = file_get_contents('php://input');
$body = json_decode($raw ?: '[]', true);

$userId = (int)($body['user_id'] ?? 0);
$role   = strtoupper(trim((string)($body['role'] ?? '')));
$auth   = $body['authority'] ?? [];
// Capture who is performing this action for the audit log
$adminId = (int)($_SESSION['auth']['user_id'] ?? 0);

// 3. VALIDATION
$allowedRoles = ['SALES','OPERATIONS','FINANCE','ADMIN','MANAGEMENT'];

if ($userId <= 0) { 
    http_response_code(422); 
    echo json_encode(['ok'=>false, 'message'=>'User ID is required']); 
    exit; 
}

if (!in_array($role, $allowedRoles, true)) { 
    http_response_code(422); 
    echo json_encode(['ok'=>false, 'message'=>'Invalid Role selected']); 
    exit; 
}

// Clean and validate the Authority/Capabilities array
if (!is_array($auth)) $auth = [];
$auth = array_values(array_unique(array_filter(array_map(function($x){
    $x = strtoupper(trim((string)$x));
    return in_array($x, ['ISSUER','VALIDATOR','APPROVER'], true) ? $x : null;
}, $auth))));

// Default fallback if empty
if (!$auth) $auth = ['ISSUER']; 
$authSet = implode(',', $auth);


// --- HELPER FUNCTIONS ---

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
    if (!$stmt) {
        throw new RuntimeException('Failed to prepare token insert: ' . $conn->error);
    }
    
    $stmt->bind_param('issss', $user_id, $token_hash, $expires_at, $ip, $ua);
    $stmt->execute();
    $stmt->close();

    return $token;
}

function send_activation_email(string $to_email, string $full_name, string $token, int $hours = 24): bool {
    $link = "https://smartls.cm/administration/activate.php?token=" . urlencode($token);
    
    $subject = "Action Required: Smart LS Account Activation";
    
    $message = "Hello {$full_name},\n\n"
             . "Your user access level has been updated or provisioned.\n"
             . "Please click the link below to verify your identity and set your secure password:\n\n"
             . "{$link}\n\n"
             . "This link expires in {$hours} hours.\n"
             . "If you did not request this change, please contact the Security Administrator immediately.\n";

    // Headers optimized for deliverability
    $domainEmail = "info@smartls.cm"; 
    $headers = "From: Smart LS Security <{$domainEmail}>\r\n" .
               "Reply-To: {$domainEmail}\r\n" .
               "X-Mailer: PHP/" . phpversion() . "\r\n" .
               "MIME-Version: 1.0\r\n" .
               "Content-Type: text/plain; charset=UTF-8\r\n";

    return mail($to_email, $subject, $message, $headers);
}


// --- MAIN TRANSACTION LOGIC ---

try {
    $conn->begin_transaction();

    // STEP 1: AUDIT PREP
    // We check the user's *current* state before changing it.
    // If they were already active (must_set_password = 0), this is an UPDATE.
    // If they were pending (must_set_password = 1), this is a PROVISION/RE-SEND.
    $checkSql = "SELECT username, role, must_set_password FROM user_auth WHERE user_id = ? LIMIT 1";
    $checkStmt = $conn->prepare($checkSql);
    $checkStmt->bind_param('i', $userId);
    $checkStmt->execute();
    $userData = $checkStmt->get_result()->fetch_assoc();
    $checkStmt->close();

    $isEdit = ($userData && (int)$userData['must_set_password'] === 0);
    $targetUsername = $userData['username'] ?? "User #$userId";

    // STEP 2: UPDATE USER AUTH
    // Reset password status, disable login (until they activate), and set new role
    $sql = "
      UPDATE user_auth
      SET
        role = ?,
        authority_capabilities = ?,
        must_set_password = 1,  -- Force them to set password
        password_set_at = NULL, -- Clear old password timestamp
        is_active = 0           -- Disable until they click email link
      WHERE user_id = ?
      LIMIT 1
    ";
    
    $stmt = $conn->prepare($sql);
    if (!$stmt) { throw new RuntimeException('SQL prepare failed: '.$conn->error); }
    $stmt->bind_param('ssi', $role, $authSet, $userId);
    $stmt->execute();
    $stmt->close();

    // STEP 3: GET EMAIL & NAME
    $sql2 = "SELECT em.email, em.full_name 
             FROM employee_master em
             JOIN user_auth ua ON ua.employee_id = em.employee_id
             WHERE ua.user_id = ? LIMIT 1";
    $stmt2 = $conn->prepare($sql2);
    $stmt2->bind_param('i', $userId);
    $stmt2->execute();
    $res = $stmt2->get_result()->fetch_assoc();
    $stmt2->close();

    if (!$res || empty($res['email'])) {
        throw new RuntimeException('Employee email not found. Cannot send activation.');
    }

    // STEP 4: CREATE TOKEN
    $token = create_activation_token($conn, $userId, 24);

    // STEP 5: INSERT AUDIT LOG
    // Decide Action Name and Severity based on context
    $actionType = $isEdit ? 'UPDATE_ROLE' : 'PROVISION_USER';
    $severity   = $isEdit ? 'WARNING'     : 'SUCCESS'; // Warning implies "Change to existing system"
    
    $logDetails = "Target: $targetUsername | New Role: $role | Auth: $authSet | Triggered Email";
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';

    $sqlAudit = "INSERT INTO audit_log (user_id, action_type, details, ip_address, severity) VALUES (?, ?, ?, ?, ?)";
    $stmtAudit = $conn->prepare($sqlAudit);
    if ($stmtAudit) {
        $stmtAudit->bind_param('issss', $adminId, $actionType, $logDetails, $ip, $severity);
        $stmtAudit->execute();
        $stmtAudit->close();
    }

    // STEP 6: COMMIT
    $conn->commit();

    // STEP 7: SEND EMAIL (Outside transaction to prevent hanging)
    $sent = send_activation_email($res['email'], $res['full_name'] ?? 'User', $token, 24);

    echo json_encode([
        'ok' => true, 
        'mail_sent' => $sent,
        'message' => 'User updated. Activation email sent.'
    ]);

} catch (Exception $e) {
    if ($conn->in_transaction) $conn->rollback();
    
    // Log internal error
    error_log("PROVISION_ERROR: " . $e->getMessage());
    
    http_response_code(500);
    echo json_encode([
        'ok'=>false, 
        'message'=>'Server error processing request', 
        'detail'=>$e->getMessage()
    ]);
}
