<?php
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'FINANCE', 'MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');

$conn = db();

// 1. INPUTS
$q            = trim((string)($_GET['q'] ?? ''));
$dept         = trim((string)($_GET['dept'] ?? ''));
$filterStatus = strtoupper(trim((string)($_GET['status'] ?? ''))); // NEW: Filter by Status

// Date Range Logic
$startDate = trim((string)($_GET['start'] ?? date('Y-m-d')));
$endDate   = trim((string)($_GET['end']   ?? date('Y-m-d')));

// Sanity check: ensure valid dates
if (!$startDate) $startDate = date('Y-m-d');
if (!$endDate)   $endDate   = date('Y-m-d');

$OFFICE_IP_PREFIX = '143.105.152.207';
$LATE_CUTOFF = '09:00:00';

// 2. WHERE CLAUSE (Employee Filters)
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
    )";
  $types .= "ssss";
  array_push($args, $q, $q, $q, $q);
}

// 3. SQL QUERY
// MODIFIED: LEFT JOIN now uses a Date Range (BETWEEN)
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
    AND al.date >= ? AND al.date <= ? 

  WHERE {$where}
  
  -- Order by Name, then Date (so you see one person's history grouped)
  ORDER BY em.full_name ASC, al.date DESC
";

$stmt = $conn->prepare($sql);
if (!$stmt) {
  echo json_encode(['ok' => false, 'message' => 'SQL prepare failed.']);
  exit;
}

// Bind: StartDate + EndDate + Employee Filters
$bindTypes = "ss" . $types;
$bindArgs  = array_merge([$startDate, $endDate], $args);
$stmt->bind_param($bindTypes, ...$bindArgs);

$stmt->execute();
$res = $stmt->get_result();

// --- HELPERS ---
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

// Only calculate "Absent" if we are looking at a Single Day.
// (Calculating absentees over a date range requires complex calendar logic)
$isSingleDay = ($startDate === $endDate);

while ($r = $res->fetch_assoc()) {
  $hasUser = !empty($r['user_id']);
  $hasAttendance = !empty($r['attendance_id']); 

  // --- LOGIC: DETERMINE STATUS ---
  $timeIn  = $hasAttendance ? fmt_time($r['clock_in']) : '--';
  $timeOut = $hasAttendance ? fmt_time($r['clock_out']) : '--';
  $durMin = (int)($r['duration_minutes'] ?? 0);
  $dbStatus = strtoupper((string)($r['db_status'] ?? ''));

  // Duration
  $duration = '--';
  if ($hasAttendance) {
      if ($dbStatus === 'OPEN' || $r['clock_out'] === null) {
          $duration = 'Active';
      } else {
          $duration = fmt_duration_minutes($durMin);
          // Fallback calc if DB didn't save minutes
          if ($duration === '--' && $r['clock_in'] && $r['clock_out']) {
              $a = strtotime($r['clock_in']);
              $b = strtotime($r['clock_out']);
              if ($a && $b && $b >= $a) {
                  $duration = fmt_duration_minutes((int)round(($b - $a) / 60));
              }
          }
      }
  }

  // Attendance Status (Calculated)
  $calcStatus = 'ABSENT';
  
  if ($hasAttendance) {
      if ($dbStatus === 'AUTO_CLOSED') {
          $calcStatus = 'AUTO-CLOSED';
      } elseif ($dbStatus === 'OPEN' || $timeOut === '--') {
    $calcStatus = ($timeIn > $LATE_CUTOFF) ? 'LATE' : 'ACTIVE';
      } else {
          // Check Lateness
          if ($timeIn !== '--' && $timeIn > $LATE_CUTOFF) {
              $calcStatus = 'LATE';
          } else {
              $calcStatus = 'PRESENT';
          }
      }
  }

  // --- NEW: FILTERING LOGIC ---
  // If user selected a status (e.g., 'LATE'), SKIP rows that don't match.
  if ($filterStatus !== '') {
      // Mapping for generic statuses
      if ($filterStatus === 'PRESENT' && !in_array($calcStatus, ['PRESENT','LATE','ACTIVE'])) continue;
      if ($filterStatus === 'LATE' && $calcStatus !== 'LATE') continue;
      if ($filterStatus === 'ABSENT' && $calcStatus !== 'ABSENT') continue;
      if ($filterStatus === 'REMOTE') {
          // Specific check for remote
          $ipIn = (string)($r['ip_in'] ?? '');
          $isOffice = ($ipIn !== '' && strpos($ipIn, $OFFICE_IP_PREFIX) === 0);
          if ($isOffice || !$hasAttendance) continue; 
      }
  }

  // --- KPIS ---
  // Only increment KPIs for rows that pass the filter
  $total++;
  
  if ($hasAttendance) {
      $present++;
      if ($calcStatus === 'LATE') $late++;
      
      $ipIn = (string)($r['ip_in'] ?? '');
      if ($ipIn !== '' && strpos($ipIn, $OFFICE_IP_PREFIX) !== 0) $remote++;
  }

  // --- BUILD ROW ---
  $rows[] = [
    'employee_id' => $r['employee_id'] ?? '',
    'name' => $r['full_name'] ?? '',
    'dept' => $r['department'] ?? '',
    'user_id' => $hasUser ? (int)$r['user_id'] : null,
    'has_user' => $hasUser,
    'date' => $r['date'] ?? $startDate, // Use row date, or query date if null

    'status' => $dbStatus ?: null,
    'attendance_status' => ($ipIn !== '' && strpos($ipIn, $OFFICE_IP_PREFIX) !== 0) ? 'REMOTE' : $calcStatus,

    'time_in' => $timeIn,
    'time_out' => $timeOut,
    'duration' => $duration,

    'ip_in' => $r['ip_in'] ?? null,
    'device_in' => $r['device_in'] ?? null,
    'user_agent_in' => $r['user_agent_in'] ?? null,

    'note' => $hasUser ? null : 'NO_USER_ACCOUNT'
  ];
}

// KPI Adjustment: Absent Count
// Only accurate for Single Day view. For Ranges, "Absent" count is usually suppressed 
// because we don't generate rows for every day missed in a range.
$absent = 0;
if ($isSingleDay && $filterStatus === '') {
    $absent = max(0, $total - $present);
}

echo json_encode([
  'ok' => true,
  'kpis' => [
    'total' => $total,
    'present' => $present,
    'absent' => $absent, // Will be 0 if Date Range is used
    'late' => $late,
    'remote' => $remote
  ],
  'rows' => $rows
]);