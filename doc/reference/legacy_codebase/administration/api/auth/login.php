<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';

// Helper for JSON response
function json_response_login(array $payload, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    json_response_login(['ok' => false, 'message' => 'Method not allowed.'], 405);
}

$identifier = trim((string)($_POST['identifier'] ?? ''));
$password   = (string)($_POST['password'] ?? '');

if ($identifier === '' || $password === '') {
    json_response_login(['ok' => false, 'message' => 'Username/email and password are required.'], 422);
}

try {
    $conn = db();

    $sql = "
      SELECT
        ua.user_id, ua.employee_id, ua.username, ua.password_hash,
        ua.role, ua.authority_capabilities, ua.is_active,
        em.full_name, em.email, em.department, em.status AS employee_status
      FROM user_auth ua
      JOIN employee_master em ON em.employee_id = ua.employee_id
      WHERE ua.username = ? OR em.email = ?
      LIMIT 1
    ";

    $stmt = $conn->prepare($sql);
    $stmt->bind_param('ss', $identifier, $identifier);
    $stmt->execute();
    $user = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    // 1. Verify Credentials (PATCHED WITH LOGGING)
    if (!$user || !password_verify($password, (string)$user['password_hash'])) {
        // --- AUDIT LOG: FAILED LOGIN ---
        // We log the 'identifier' tried so we know who they were targeting
        $action = 'LOGIN_FAILED';
        $details = "Failed login attempt for: " . substr($identifier, 0, 50); 
        $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
        
        // Note: user_id might be null if username doesn't exist, 
        // so we use the $user['user_id'] if found, or NULL.
        $targetUserId = isset($user['user_id']) ? (int)$user['user_id'] : null;

        $stmtFail = $conn->prepare("INSERT INTO audit_log (user_id, action_type, details, ip_address, severity) VALUES (?, ?, ?, ?, 'WARNING')");
        if ($stmtFail) {
            $stmtFail->bind_param('isss', $targetUserId, $action, $details, $ip);
            $stmtFail->execute();
            $stmtFail->close();
        }
        // -------------------------------

        json_response_login(['ok' => false, 'message' => 'Invalid credentials.'], 401);
    }

    // 2. Check Active Status
    if ((int)$user['is_active'] !== 1) {
        json_response_login(['ok' => false, 'message' => 'Account disabled. Contact system administrator.'], 403);
    }
    if (strtoupper((string)($user['employee_status'] ?? '')) !== 'ACTIVE') {
        json_response_login(['ok' => false, 'message' => 'Employee status is not ACTIVE.'], 403);
    }

    // 3. Password Rehash (Security Best Practice)
    if (password_needs_rehash((string)$user['password_hash'], PASSWORD_DEFAULT)) {
        $newHash = password_hash($password, PASSWORD_DEFAULT);
        if ($newHash) {
            $u = $conn->prepare("UPDATE user_auth SET password_hash = ? WHERE user_id = ?");
            $uid = (int)$user['user_id'];
            $u->bind_param('si', $newHash, $uid);
            $u->execute();
            $u->close();
        }
    }

    // 4. Start Session
    session_regenerate_id(true);

    $_SESSION['auth'] = [
        'user_id' => (int)$user['user_id'],
        'employee_id' => (string)$user['employee_id'],
        'username' => (string)$user['username'],
        'role' => (string)$user['role'],
        'authority_capabilities' => (string)($user['authority_capabilities'] ?? ''),
        'full_name' => (string)$user['full_name'],
        'email' => (string)$user['email'],
    ];

    // 5. Update Last Login Time
    $uid = (int)$user['user_id'];
    $conn->query("UPDATE user_auth SET last_login = NOW() WHERE user_id = $uid");

    // --- NEW: RECORD ACTIVE SESSION (Fixes Session Monitor) ---
    $sessId = session_id();
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    $ua = substr($_SERVER['HTTP_USER_AGENT'] ?? 'Unknown', 0, 255);
    
    // Using REPLACE to handle potential session ID collisions/updates
    $stmtSess = $conn->prepare("
        REPLACE INTO active_sessions (session_id, user_id, ip_address, user_agent, login_time, last_activity)
        VALUES (?, ?, ?, ?, NOW(), NOW())
    ");
    $stmtSess->bind_param('siss', $sessId, $uid, $ip, $ua);
    $stmtSess->execute();
    $stmtSess->close();

    // --- NEW: RECORD AUDIT LOG (Fixes Audit Tab) ---
    $action = 'LOGIN_SUCCESS';
    $details = "User logged in via Web Interface";
    
    $stmtAudit = $conn->prepare("
        INSERT INTO audit_log (user_id, action_type, details, ip_address, severity)
        VALUES (?, ?, ?, ?, 'SUCCESS')
    ");
    $stmtAudit->bind_param('isss', $uid, $action, $details, $ip);
    $stmtAudit->execute();
    $stmtAudit->close();

    // 6. Redirect Logic
    $role = strtoupper((string)$user['role']);
    $roleLanding = [
        'ADMIN'      => 'view/admin/index.php',
        'FINANCE'    => 'view/finance/index.php',
        'SALES'      => 'view/sales/index.php',
        'OPERATIONS' => 'view/operations/index.php',
        'MANAGEMENT' => 'view/management/index.php',
    ];
    $redirect = $roleLanding[$role] ?? 'view/admin/index.php';

    json_response_login([
        'ok' => true,
        'message' => 'Login successful.',
        'redirect' => $redirect
    ], 200);

}  catch (Throwable $e) {
    error_log("LOGIN_API_ERROR: " . $e->getMessage());
    json_response_login([
        'ok' => false,
        'message' => 'Server error.',
        'debug' => $e->getMessage()
    ], 500);
}