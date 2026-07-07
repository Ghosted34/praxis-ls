<?php
declare(strict_types=1);
session_start();

require_once __DIR__ . '/includes/init.php'; // adjust path if needed

// DB Connection
$conn = db();

/**
 * Retrieve token row safely
 */
function get_token_row(mysqli $conn, string $token): ?array {
    $token_hash = hash('sha256', $token);
    $sql = "SELECT * FROM password_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW() LIMIT 1";
    
    $stmt = $conn->prepare($sql);
    if (!$stmt) {
        // Log error in production
        return null;
    }
    
    $stmt->bind_param('s', $token_hash);
    $stmt->execute();
    $result = $stmt->get_result();
    $row = $result->fetch_assoc();
    $stmt->close();
    
    return $row ?: null;
}

/**
 * Mark token as used
 */
function mark_token_used(mysqli $conn, int $id): bool {
    $sql = "UPDATE password_tokens SET used_at = NOW() WHERE id = ?";
    $stmt = $conn->prepare($sql);
    if (!$stmt) return false;
    
    $stmt->bind_param('i', $id);
    $res = $stmt->execute();
    $stmt->close();
    return $res;
}

// ==========================================
// GET REQUEST: DISPLAY FORM
// ==========================================
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $token = $_GET['token'] ?? '';
    if (!$token) {
        echo "Invalid link.";
        exit;
    }

    $row = get_token_row($conn, $token);
    if (!$row) {
        echo "This link is invalid or expired.";
        exit;
    }

    // Generate CSRF Token
    $_SESSION['csrf_token'] = bin2hex(random_bytes(16));
    
    ?>
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Set your password</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body{font-family:system-ui,Segoe UI,Roboto,Arial;max-width:640px;margin:40px auto;padding:16px}
    label{display:block;margin-top:12px}
    input[type=password]{width:100%;padding:8px;margin-top:6px}
    button{margin-top:12px;padding:8px 12px; cursor:pointer;}
    .note{color:#555;font-size:0.9rem}
    .error{color:red; margin-bottom: 1rem;}
  </style>
</head>
<body>
  <h1>Set your password</h1>
  <p class="note">Create a strong password (min 10 characters). The link expires <?php echo htmlspecialchars($row['expires_at']); ?>.</p>
  
  <form method="post" action="activate.php">
    <input type="hidden" name="token" value="<?php echo htmlspecialchars($token, ENT_QUOTES); ?>">
    <input type="hidden" name="csrf" value="<?php echo htmlspecialchars($_SESSION['csrf_token']); ?>">
    <label>
      New password
      <input type="password" name="password" required minlength="10" autocomplete="new-password">
    </label>
    <label>
      Confirm password
      <input type="password" name="password_confirm" required minlength="10" autocomplete="new-password">
    </label>
    <button type="submit">Set password</button>
  </form>
</body>
</html>
    <?php
    exit;
}

// ==========================================
// POST REQUEST: PROCESS ACTIVATION
// ==========================================
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $token = $_POST['token'] ?? '';
    $csrf  = $_POST['csrf'] ?? '';
    $password = (string)($_POST['password'] ?? '');
    $password_confirm = (string)($_POST['password_confirm'] ?? '');

    // 1. Validation
    if (empty($token) || empty($csrf) || !hash_equals($_SESSION['csrf_token'] ?? '', $csrf)) {
        die("Invalid request (CSRF).");
    }
    if ($password !== $password_confirm) {
        die("Passwords do not match.");
    }
    if (strlen($password) < 10) {
        die("Password too short (minimum 10 chars).");
    }

    // 2. Check Token Validity
    $row = get_token_row($conn, $token);
    if (!$row) {
        die("This link is invalid or expired.");
    }

    $user_id = (int)$row['user_id'];
    $token_id = (int)$row['id'];

    // 3. Hash Password
    if (defined('PASSWORD_ARGON2ID')) {
        $hash = password_hash($password, PASSWORD_ARGON2ID);
    } else {
        $hash = password_hash($password, PASSWORD_BCRYPT);
    }

    // 4. BEGIN TRANSACTION (Ensures all updates happen, or none do)
    $conn->begin_transaction();

    try {
        // Step A: Update user_auth (Set password, activate login)
        $sql = "UPDATE user_auth 
                SET password_hash = ?, must_set_password = 0, password_set_at = NOW(), is_active = 1 
                WHERE user_id = ? LIMIT 1";
        $stmt = $conn->prepare($sql);
        if (!$stmt) throw new Exception("Prepare failed: user_auth");
        $stmt->bind_param('si', $hash, $user_id);
        if (!$stmt->execute()) throw new Exception("Execute failed: user_auth");
        $stmt->close();

        // Step B: Update employee_master (Set Status = ACTIVE)
        // FIX: Removed LIMIT 1 because JOIN + UPDATE + LIMIT is not allowed in MySQL
        $sqlEmp = "
            UPDATE employee_master em
            JOIN user_auth ua ON ua.employee_id = em.employee_id
            SET em.status = 'ACTIVE'
            WHERE ua.user_id = ?
        ";
        $stmtEmp = $conn->prepare($sqlEmp);
        if (!$stmtEmp) throw new Exception("Prepare failed: employee_master update");
        $stmtEmp->bind_param('i', $user_id);
        if (!$stmtEmp->execute()) throw new Exception("Execute failed: employee_master");
        $stmtEmp->close();

        // Step C: Mark token as used
        if (!mark_token_used($conn, $token_id)) {
            throw new Exception("Failed to mark token as used");
        }

        // Commit changes
        $conn->commit();

        // Redirect to login
        header('Location: login.php?activated=1');
        exit;

    } catch (Exception $e) {
        // Rollback on any error
        $conn->rollback();
        
        // Log the actual error internally (error_log($e->getMessage()));
        // Show generic message to user
        http_response_code(500);
        die("System Error: Unable to activate account at this time. Please try again or notify Admin");
    }
}