<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';

// --- NEW: Remove from Active Sessions Table ---
if (session_id()) {
    try {
        $conn = db(); // Ensure you have DB connection
        $sid = session_id();
        $stmt = $conn->prepare("DELETE FROM active_sessions WHERE session_id = ?");
        $stmt->bind_param('s', $sid);
        $stmt->execute();
        $stmt->close();
    } catch (Exception $e) {
        // Ignore DB errors during logout, just proceed
    }
}

// Standard Session Destruction
$_SESSION = [];
if (ini_get("session.use_cookies")) {
    $params = session_get_cookie_params();
    setcookie(session_name(), '', time() - 42000,
        $params["path"], $params["domain"], $params["secure"], $params["httponly"]
    );
}
session_destroy();

header('Location: ../../login.php');
exit;