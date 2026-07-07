<?php
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'FINANCE', 'MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');

$conn = db();

$q    = trim((string)($_GET['q'] ?? ''));
$dept = trim((string)($_GET['dept'] ?? ''));
$today = date('Y-m-d');

$OFFICE_IP_PREFIX = '192.168.1.';
$LATE_CUTOFF = '09:00:00';

// WHERE for employees (not attendance)
$where = "1=1";
$types = "";
$args  = [];

if ($dept !== '') {
  $where .= " AND em.department = ?";
  $types .= "s";
  $args[] = $dept;
}

if ($q !== '') {
  $where .= " AND (
      em.employee_id LIKE CONCAT('%', ?, '%')
      OR em.full_name LIKE CONCAT('%', ?, '%')
      OR ua.username LIKE CONCAT('%', ?, '%')
      OR al.ip_in LIKE CONCAT('%', ?, '%')
      OR al.ip_out LIKE CONCAT('%', ?, '%')
    )";
  $types .= "sssss";
  array_push($args, $q, $q, $q, $q, $q);
}

// One row per employee, plus today's attendance if exists.
// If you can have multiple attendance rows per user per day, enforce latest by id using a subquery.
// Assumption here: max 1 row per user per day (recommended).
$sql = "
  SELECT
    em.employee_id,
    em.full_name,
    em.department,
    ua.user_id,

    al.id AS attendance_id,
    al.date,
    al.clock_in,
    al.clock_out,
    al.duration_minutes,
    al.location_in,
    al.ip_in,
    al.user_agent_in,
    al.device_in,
    al.location_out,
    al.ip_out,
    al.user_agent_out,
    al.device_out,
    al.status AS db_status

  FROM employee_master em
  LEFT JOIN user_auth ua
    ON ua.employee_id = em.employee_id

  LEFT JOIN attendance_logs al
    ON al.user_id = ua.user_id
   AND al.date = ?

  WHERE {$where}
  ORDER BY em.full_name ASC
";

$stmt = $conn->prepare($sql);
if (!$stmt) {
  echo json_encode(['ok' => false, 'message' => 'SQL prepare failed.']);
  exit;
}

// bind: date first + employee filters
$bindTypes = "s" . $types;
$bindArgs  = array_merge([$today], $args);
$stmt->bind_param($bindTypes, ...$bindArgs);

$stmt->execute();
$res = $stmt->get_result();

function fmt_time(?string $dt): string {
  if (!$dt) return '--';
  $ts = strtotime($dt);
  if (!$ts) return '--';
  return date('H:i:s', $ts);
}

function fmt_duration_minutes(int $mins): string {
  if ($mins <= 0) return '--';
  $h = intdiv($mins, 60);
  $m = $mins % 60;
  return sprintf('%dh %02dm', $h, $m);
}

$rows = [];
$total = 0;
$present = 0;
$late = 0;
$remote = 0;

while ($r = $res->fetch_assoc()) {
  $total++;

  $hasUser = !empty($r['user_id']);
  $hasAttendance = !empty($r['attendance_id']); // means log exists today

  $timeIn  = $hasAttendance ? fmt_time($r['clock_in']) : '--';
  $timeOut = $hasAttendance ? fmt_time($r['clock_out']) : '--';

  // duration
  $durMin = (int)($r['duration_minutes'] ?? 0);
  $dbStatus = strtoupper((string)($r['db_status'] ?? ''));

  $duration = '--';
  if (!$hasAttendance) {
    $duration = '--';
  } else if ($dbStatus === 'OPEN' || $r['clock_out'] === null) {
    $duration = 'Active';
  } else {
    $duration = fmt_duration_minutes($durMin);
    if ($duration === '--' && $r['clock_in'] && $r['clock_out']) {
      $a = strtotime($r['clock_in']);
      $b = strtotime($r['clock_out']);
      if ($a && $b && $b >= $a) {
        $mins = (int)round(($b - $a) / 60);
        $duration = fmt_duration_minutes($mins);
      }
    }
  }

  // attendance_status (UI)
  $attendanceStatus = 'ABSENT';
  if (!$hasUser) {
    // Employee exists but no user_auth; still show them, but label is absent/no login
    $attendanceStatus = 'ABSENT';
  } else if (!$hasAttendance) {
    $attendanceStatus = 'ABSENT';
  } else {
    $present++;

    if ($dbStatus === 'AUTO_CLOSED') {
      $attendanceStatus = 'AUTO-CLOSED';
    } else if ($dbStatus === 'OPEN' || $timeOut === '--') {
      $attendanceStatus = 'ACTIVE';
    } else {
      // CLOSED -> late vs present by time_in
      if ($timeIn !== '--' && $timeIn > $LATE_CUTOFF) {
        $attendanceStatus = 'LATE';
        $late++;
      } else {
        $attendanceStatus = 'PRESENT';
      }
    }

    // remote KPI (only for those present)
    $ipIn = (string)($r['ip_in'] ?? '');
    if ($ipIn === '' || strpos($ipIn, $OFFICE_IP_PREFIX) !== 0) $remote++;
  }

  $rows[] = [
    'employee_id' => $r['employee_id'] ?? '',
    'name' => $r['full_name'] ?? '',
    'dept' => $r['department'] ?? '',

    'user_id' => $hasUser ? (int)$r['user_id'] : null,
    'has_user' => $hasUser,

    'date' => $today,

    // keep DB fields (for advanced needs)
    'status' => $dbStatus ?: null, // OPEN/CLOSED/AUTO_CLOSED or null
    'attendance_status' => $attendanceStatus, // PRESENT/LATE/ACTIVE/ABSENT/AUTO-CLOSED

    'time_in' => $timeIn,
    'time_out' => $timeOut,
    'duration_minutes' => $durMin,
    'duration' => $duration,

    'ip_in' => $r['ip_in'] ?? null,
    'device_in' => $r['device_in'] ?? null,
    'user_agent_in' => $r['user_agent_in'] ?? null,
    'location_in' => $r['location_in'] ?? null,

    'ip_out' => $r['ip_out'] ?? null,
    'device_out' => $r['device_out'] ?? null,
    'user_agent_out' => $r['user_agent_out'] ?? null,
    'location_out' => $r['location_out'] ?? null,

    'note' => $hasUser ? null : 'NO_USER_ACCOUNT'
  ];
}

$absent = max(0, $total - $present);

echo json_encode([
  'ok' => true,
  'kpis' => [
    'total' => $total,
    'present' => $present,
    'absent' => $absent,
    'late' => $late,
    'remote' => $remote
  ],
  'rows' => $rows
]);
