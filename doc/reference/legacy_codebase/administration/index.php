<?php
declare(strict_types=1);

session_start();

/* =========================
   DATABASE CONNECTION
   ========================= */
$DB_HOST = '127.0.0.1';
$DB_NAME = 'smart';
$DB_USER = 'root';
$DB_PASS = '';

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

$conn = new mysqli($DB_HOST, $DB_USER, $DB_PASS, $DB_NAME);
$conn->set_charset('utf8mb4');

/* =========================
   LOGIN LOGIC
   ========================= */
$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {

    $identifier = trim($_POST['identifier'] ?? '');
    $password   = $_POST['password'] ?? '';

    if ($identifier === '' || $password === '') {
        $error = 'Username / Email and Password are required.';
    } else {

        $sql = "
            SELECT 
                ua.user_id,
                ua.employee_id,
                ua.username,
                ua.password_hash,
                ua.role,
                ua.is_active,
                em.full_name,
                em.email,
                em.status AS emp_status
            FROM user_auth ua
            JOIN employee_master em ON em.employee_id = ua.employee_id
            WHERE ua.username = ? OR em.email = ?
            LIMIT 1
        ";

        $stmt = $conn->prepare($sql);
        $stmt->bind_param('ss', $identifier, $identifier);
        $stmt->execute();
        $user = $stmt->get_result()->fetch_assoc();

        // Authentication checks
        if (!$user || !password_verify($password, $user['password_hash'])) {
            $error = 'Invalid login credentials.';
        } elseif ((int)$user['is_active'] !== 1 || $user['emp_status'] !== 'ACTIVE') {
            $error = 'Account is disabled.';
        } else {

            // LOGIN SUCCESS
            session_regenerate_id(true);

            $_SESSION['auth'] = [
                'user_id'     => (int)$user['user_id'],
                'employee_id' => (string)$user['employee_id'],
                'username'    => (string)$user['username'],
                'role'        => (string)$user['role'],
                'full_name'   => (string)$user['full_name'],
                'email'       => (string)$user['email'],
            ];

            // ROLE-BASED REDIRECT
            $role = strtoupper((string)$user['role']);

            switch ($role) {
                case 'ADMIN':
                    header('Location: view/admin/index.php');
                    break;

                case 'FINANCE':
                    header('Location: view/finance/index.php');
                    break;

                case 'SALES':
                    header('Location: view/sales/index.php');
                    break;

                case 'OPERATIONS':
                    header('Location: view/operations/index.php');
                    break;

                case 'MANAGEMENT':
                    header('Location: view/management/index.php');
                    break;

                default:
                    // Fallback (safe)
                    header('Location: view/admin/index.php');
            }
            exit;
        }
    }
}
?>

<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Smart LS Login</title>
<meta name="viewport" content="width=device-width, initial-scale=1">

<style>
body {
    font-family: Arial, sans-serif;
    background: #f2f4f7;
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
}
.card {
    background: #fff;
    padding: 25px;
    width: 360px;
    border-radius: 6px;
    box-shadow: 0 10px 25px rgba(0,0,0,.1);
}
input, button {
    width: 100%;
    padding: 10px;
    margin-top: 10px;
}
button {
    background: #1f99d8;
    color: #fff;
    border: none;
    cursor: pointer;
}
.error {
    color: #b00020;
    margin-bottom: 10px;
}
</style>
</head>

<body>

<div class="card">
    <h3>Login</h3>

    <?php if ($error): ?>
        <div class="error"><?= htmlspecialchars($error) ?></div>
    <?php endif; ?>

    <form method="post">
        <input type="text" name="identifier" placeholder="Username or Email">
        <input type="password" name="password" placeholder="Password">
        <button type="submit">Login</button>
    </form>
</div>

</body>
</html>
