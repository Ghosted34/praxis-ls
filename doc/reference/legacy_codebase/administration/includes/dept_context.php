<?php
declare(strict_types=1);

/**
 * Department context + permission rules (authoritative from employee_master)
 *
 * Requirements:
 *  - init.php already included (session started, db() available)
 *  - $_SESSION['auth']['employee_id'] and $_SESSION['auth']['user_id'] exist
 */

if (!function_exists('db')) {
  throw new RuntimeException('db() not available. Include init.php first.');
}

// Safe helper (define once if not already defined elsewhere)
if (!function_exists('e')) {
  function e(string $v): string {
    return htmlspecialchars($v, ENT_QUOTES, 'UTF-8');
  }
}

// Fetch current user (authoritative)
$employeeId = (string)($_SESSION['auth']['employee_id'] ?? '');
$userId     = (int)($_SESSION['auth']['user_id'] ?? 0);

if ($employeeId === '' || $userId <= 0) {
  header('Location: ../../api/auth/logout.php');
  exit;
}

$conn = db();
$sql = "
  SELECT
    em.employee_id,
    em.full_name,
    em.email,
    em.department,
    em.job_title,
    ua.username,
    ua.role,
    ua.authority_capabilities,
    ua.last_login
  FROM user_auth ua
  JOIN employee_master em ON em.employee_id = ua.employee_id
  WHERE ua.user_id = ? AND em.employee_id = ?
  LIMIT 1
";

$stmt = $conn->prepare($sql);
if (!$stmt) {
  throw new RuntimeException('Prepare failed: ' . $conn->error);
}

$stmt->bind_param('is', $userId, $employeeId);
$stmt->execute();
$res = $stmt->get_result();
$me  = $res ? $res->fetch_assoc() : null;

if (!$me) {
  header('Location: ../../api/auth/logout.php');
  exit;
}

// Safe values
$fullName  = $me['full_name'] ?: 'User';
$firstName = trim(explode(' ', $fullName)[0] ?? 'User');

// Department normalization
$departmentRaw = (string)($me['department'] ?? '');
$department = strtoupper(trim($departmentRaw));
$deptKey = preg_replace('/\s+/', ' ', $department);

$deptMap = [
  'FINANCE' => 'FINANCE',
  'ACCOUNT' => 'FINANCE',
  'ACCOUNTS' => 'FINANCE',
  'FIN' => 'FINANCE',

  'OPERATIONS' => 'OPERATIONS',
  'OPS' => 'OPERATIONS',

  'SALES' => 'SALES',

  'ADMIN' => 'ADMIN',
  'ADMINISTRATION' => 'ADMIN',
  'SYSTEM ADMIN' => 'ADMIN',
];

$DEPT = $deptMap[$deptKey] ?? $department;

// Department booleans
$isFinanceDept = ($DEPT === 'FINANCE');
$isOpsDept     = ($DEPT === 'OPERATIONS');
$isSalesDept   = ($DEPT === 'SALES');
$isAdminDept   = ($DEPT === 'ADMIN');

// Permissions (department-driven)
$PERMS = [
  'dept'             => $DEPT,
  'isFinance'         => $isFinanceDept,
  'isOps'             => $isOpsDept,
  'isSales'           => $isSalesDept,
  'isAdmin'           => $isAdminDept,

  // Workflow permissions
  'canCreateRequest'  => ($isAdminDept || $isOpsDept || $isSalesDept),
  'canEditDraft'      => ($isAdminDept || $isOpsDept || $isSalesDept),
  'canSubmit'         => ($isAdminDept || $isOpsDept || $isSalesDept),
  'canValidateReject' => ($isAdminDept || $isFinanceDept),
  'canDisburse'       => ($isAdminDept || $isFinanceDept),
];

// Avatar + greeting (optional but used by topbar in your index UI)
$avatarName = urlencode($fullName);
$avatarUrl  = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";

$hour = (int)date('H');
$greeting = ($hour < 12) ? 'Good morning' : (($hour < 18) ? 'Good afternoon' : 'Good evening');
