<?php
declare(strict_types=1);
session_start();

require_once __DIR__ . '/includes/init.php'; // adjust path if needed
// no role guard: this is public (token-based)
$conn = db();

function get_token_row(mysqli $conn, string $token) {
    $token_hash = hash('sha256', $token);
    $sql = "SELECT * FROM password_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW() LIMIT 1";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('s', $token_hash);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    return $row ?: null;
}

function mark_token_used(mysqli $conn, int $id) {
    $sql = "UPDATE password_tokens SET used_at = NOW() WHERE id = ?";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $stmt->close();
}

// GET: display form
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
    // issue CSRF
    $_SESSION['csrf_token'] = bin2hex(random_bytes(16));
    // show form
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
    button{margin-top:12px;padding:8px 12px}
    .note{color:#555;font-size:0.9rem}
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

// POST: set password
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $token = $_POST['token'] ?? '';
    $csrf  = $_POST['csrf'] ?? '';
    $password = (string)($_POST['password'] ?? '');
    $password_confirm = (string)($_POST['password_confirm'] ?? '');

    if (empty($token) || empty($csrf) || !hash_equals($_SESSION['csrf_token'] ?? '', $csrf)) {
        echo "Invalid request (CSRF).";
        exit;
    }
    if ($password !== $password_confirm) {
        echo "Passwords do not match.";
        exit;
    }
    if (strlen($password) < 10) {
        echo "Password too short (minimum 10 chars).";
        exit;
    }

    $row = get_token_row($conn, $token);
    if (!$row) {
        echo "This link is invalid or expired.";
        exit;
    }

    $user_id = (int)$row['user_id'];

    // hash password (prefer Argon2id when available)
    if (defined('PASSWORD_ARGON2ID')) {
        $hash = password_hash($password, PASSWORD_ARGON2ID);
    } else {
        $hash = password_hash($password, PASSWORD_BCRYPT);
    }

    // update user_auth
    $sql = "UPDATE user_auth
            SET password_hash = ?, must_set_password = 0, password_set_at = NOW(), is_active = 1
            WHERE user_id = ? LIMIT 1";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('si', $hash, $user_id);
    $stmt->execute();
    $stmt->close();

    // mark token used
    mark_token_used($conn, (int)$row['id']);

    // redirect to login with a success message (could be nicer)
    header('Location: /login.php?activated=1');
    exit;
}
