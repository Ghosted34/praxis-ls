<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');
$conn = db();

$limit = 50;
$q = trim((string)($_GET['q'] ?? ''));
$action = trim((string)($_GET['action_type'] ?? ''));

// Base Query
$sql = "
    SELECT 
        a.log_id, a.action_type, a.details, a.ip_address, a.severity, a.created_at,
        u.username, em.full_name
    FROM audit_log a
    LEFT JOIN user_auth u ON u.user_id = a.user_id
    LEFT JOIN employee_master em ON em.employee_id = u.employee_id
    WHERE 1=1
";

$types = "";
$params = [];

// Search Filter
if ($q !== '') {
    $sql .= " AND (u.username LIKE ? OR em.full_name LIKE ? OR a.details LIKE ?)";
    $types .= "sss";
    $likeParam = "%{$q}%";
    $params[] = $likeParam;
    $params[] = $likeParam;
    $params[] = $likeParam;
}

// Action Type Filter
if ($action !== '' && $action !== 'All Actions') {
    $sql .= " AND a.action_type = ?";
    $types .= "s";
    $params[] = $action;
}

// Order & Limit
$sql .= " ORDER BY a.created_at DESC LIMIT ?";
$types .= "i";
$params[] = $limit;

// Execution
$stmt = $conn->prepare($sql);
if ($types) {
    $stmt->bind_param($types, ...$params);
}
$stmt->execute();
$res = $stmt->get_result();

$rows = [];
while ($r = $res->fetch_assoc()) {
    // Robust IP check (same logic as session_list)
    $isRemote = !preg_match('/^(127\.0\.0\.1|::1|192\.168\.|10\.)/', $r['ip_address']);
    
    $rows[] = [
        'id'        => $r['log_id'],
        'action'    => $r['action_type'],
        'user'      => $r['full_name'] ?? $r['username'] ?? 'System',
        'details'   => $r['details'],
        'ip'        => $r['ip_address'],
        'severity'  => $r['severity'],
        'date'      => $r['created_at'],
        'is_remote' => $isRemote
    ];
}

echo json_encode(['ok' => true, 'rows' => $rows]);