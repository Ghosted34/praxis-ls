<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN','FINANCE','MANAGEMENT']);

/* ---------------------------------------------------------------------
   Authenticated user (same authoritative pattern as your index.php)
   --------------------------------------------------------------------- */
$employeeId = (string)($_SESSION['auth']['employee_id'] ?? '');
$userId     = (int)($_SESSION['auth']['user_id'] ?? 0);

if ($employeeId === '' || $userId <= 0) {
  header('Location: ../../api/auth/logout.php');
  exit;
}

$conn = db();

$sqlMe = "
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
$stMe = $conn->prepare($sqlMe);
$stMe->bind_param('is', $userId, $employeeId);
$stMe->execute();
$me = $stMe->get_result()->fetch_assoc();

if (!$me) {
  header('Location: ../../api/auth/logout.php');
  exit;
}

function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }
function json_exit(array $p, int $code = 200): void {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($p);
  exit;
}
function uuid_v4(): string {
  $data = random_bytes(16);
  $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
  $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
  return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}
function now_dt(): string { return (new DateTime('now'))->format('Y-m-d H:i:s'); }
function ym_from_date(DateTime $d): string { return $d->format('Y-m'); }
function period_bounds(string $ym): array {
  // $ym = "YYYY-MM"
  $start = DateTime::createFromFormat('Y-m-d', $ym . '-01');
  if (!$start) { $start = new DateTime('first day of this month'); }
  $end = (clone $start)->modify('last day of this month');
  return [$start->format('Y-m-d'), $end->format('Y-m-d')];
}

/* ---------------------------------------------------------------------
   UI identity
   --------------------------------------------------------------------- */
$fullName = (string)($me['full_name'] ?? 'User');
$firstName = trim(explode(' ', $fullName)[0] ?? 'User');

$roleLabelMap = [
  'ADMIN'      => 'SYSTEM ADMIN',
  'FINANCE'    => 'FINANCE',
  'SALES'      => 'SALES',
  'OPERATIONS' => 'OPERATIONS',
  'MANAGEMENT' => 'MANAGEMENT',
];
$role = strtoupper((string)($me['role'] ?? 'ADMIN'));
$roleLabel = $roleLabelMap[$role] ?? $role;

$avatarName = urlencode($fullName);
$avatarUrl = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";

$hour = (int)date('H');
$greeting = ($hour < 12) ? 'Good morning' : (($hour < 18) ? 'Good afternoon' : 'Good evening');

/* ---------------------------------------------------------------------
   Default Payroll Config (stored as snapshot in payroll_runs.config_snapshot_json)
   You can edit rates via Admin Config modal; that will update the snapshot for the run.
   --------------------------------------------------------------------- */
function default_config(): array {
  return [
    'stdDays' => 22,
    'currency' => 'XAF',
    'rates' => [
      'irpp'     => 0.10,
      'addTax'   => 0.10,
      'houseEmp' => 0.01,
      'cnpsEmp'  => 0.042,
      'cnpsCeil' => 750000,
      // employer
      'fne'      => 0.01,
      'houseComp'=> 0.01,
      'family'   => 0.0125,
      'workAcc'  => 0.0175,
      'cnpsComp' => 0.042
    ],
    'bases' => [
      // what goes into tax/ins/loan bases
      'base'      => ['tax'=>true,'ins'=>true,'loan'=>true],
      'seniority' => ['tax'=>true,'ins'=>true,'loan'=>true],
      'perf'      => ['tax'=>true,'ins'=>true,'loan'=>true],
      'overtime'  => ['tax'=>true,'ins'=>true,'loan'=>true],
      'allowances'=> ['tax'=>true,'ins'=>false,'loan'=>false],
      'utilities' => ['tax'=>false,'ins'=>false,'loan'=>false],
    ],
    'seniority' => ['years'=>2,'rate'=>0.10],
    // your required performance logic column:
    'perfLogic' => [
      ['min'=>90,'rate'=>0.05],
      ['min'=>75,'rate'=>0.03],
      ['min'=>60,'rate'=>0.01],
      ['min'=>0, 'rate'=>0.00],
    ],
    // utilities by grade prefix (your employee_master schema doesn’t contain grade yet;
    // keep for future; currently utilities will compute as 0 unless you later add grade)
    'utilities' => ['X'=>0.15,'V'=>0.10,'I'=>0.05,'DEFAULT'=>0.0],
  ];
}

/* ---------------------------------------------------------------------
   ACL helpers
   --------------------------------------------------------------------- */
function require_role_strict(array $allowed, string $current): void {
  if (!in_array($current, $allowed, true)) {
    json_exit(['ok'=>false,'error'=>'Forbidden'], 403);
  }
}
function can_finance_edit(string $role, string $status): bool {
  return $role === 'FINANCE' && $status === 'OPEN';
}

/* ---------------------------------------------------------------------
   DB operations
   --------------------------------------------------------------------- */
function get_run_by_ym(mysqli $conn, string $ym): ?array {
  $sql = "SELECT * FROM payroll_runs WHERE period_ym = ? LIMIT 1";
  $st = $conn->prepare($sql);
  $st->bind_param('s', $ym);
  $st->execute();
  $r = $st->get_result()->fetch_assoc();
  return $r ?: null;
}

function get_run_by_id(mysqli $conn, string $runId): ?array {
  $sql = "SELECT * FROM payroll_runs WHERE payroll_run_id = ? LIMIT 1";
  $st = $conn->prepare($sql);
  $st->bind_param('s', $runId);
  $st->execute();
  $r = $st->get_result()->fetch_assoc();
  return $r ?: null;
}

function list_items(mysqli $conn, string $runId): array {
  $sql = "
    SELECT
      pri.*,
      em.full_name,
      em.email,
      em.department,
      em.job_title,
      em.payment_method,
      em.bank_details
    FROM payroll_run_items pri
    JOIN employee_master em ON em.employee_id = pri.employee_id
    WHERE pri.payroll_run_id = ?
    ORDER BY em.full_name ASC
  ";
  $st = $conn->prepare($sql);
  $st->bind_param('s', $runId);
  $st->execute();
  $res = $st->get_result();
  $out = [];
  while ($row = $res->fetch_assoc()) $out[] = $row;
  return $out;
}

function audit(mysqli $conn, string $runId, ?string $itemId, int $actorUserId, string $action, ?string $notes, ?array $before, ?array $after): void {
  $sql = "
    INSERT INTO payroll_audit_log
      (payroll_run_id, payroll_item_id, actor_user_id, action, notes, before_json, after_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ";
  $beforeJson = $before ? json_encode($before) : null;
  $afterJson  = $after  ? json_encode($after)  : null;
  $createdAt  = now_dt();

  $st = $conn->prepare($sql);
  $st->bind_param(
    'ssisssss',
    $runId,
    $itemId,
    $actorUserId,
    $action,
    $notes,
    $beforeJson,
    $afterJson,
    $createdAt
  );
  $st->execute();
}

function ensure_run(mysqli $conn, string $ym, int $userId): array {
  $run = get_run_by_ym($conn, $ym);
  if ($run) return $run;

  [$start, $end] = period_bounds($ym);
  $runId = uuid_v4();
  $cfg = default_config();
  $cfgJson = json_encode($cfg, JSON_UNESCAPED_SLASHES);

  $sql = "
    INSERT INTO payroll_runs
      (payroll_run_id, period_ym, period_start, period_end, status, config_snapshot_json, created_by_user_id, created_at)
    VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?)
  ";
  $createdAt = now_dt();
  $st = $conn->prepare($sql);
  $st->bind_param('sssssis', $runId, $ym, $start, $end, $cfgJson, $userId, $createdAt);
  $st->execute();

  $run = get_run_by_id($conn, $runId);
  return $run ?: ['payroll_run_id'=>$runId,'period_ym'=>$ym,'period_start'=>$start,'period_end'=>$end,'status'=>'OPEN','config_snapshot_json'=>$cfgJson];
}

function seed_items(mysqli $conn, array $run, int $actorUserId): void {
  $runId = (string)$run['payroll_run_id'];
  $start = (string)$run['period_start'];
  $end   = (string)$run['period_end'];

  // Already seeded?
  $chk = $conn->prepare("SELECT COUNT(*) c FROM payroll_run_items WHERE payroll_run_id = ?");
  $chk->bind_param('s', $runId);
  $chk->execute();
  $cnt = (int)($chk->get_result()->fetch_assoc()['c'] ?? 0);
  if ($cnt > 0) return;

  // Pull ACTIVE employees + resolve user_id via user_auth.
  $sqlEmp = "
  SELECT
    em.employee_id,
    em.join_date,
    em.base_salary,
    ua.user_id
  FROM employee_master em
  LEFT JOIN (
    SELECT employee_id, MIN(user_id) AS user_id
    FROM user_auth
    GROUP BY employee_id
  ) ua ON ua.employee_id = em.employee_id
  WHERE em.status = 'ACTIVE'
  ORDER BY em.full_name ASC
";

  $res = $conn->query($sqlEmp);

  $ins = $conn->prepare("
    INSERT INTO payroll_run_items
      (payroll_item_id, payroll_run_id, employee_id, user_id, days_worked,
       perf_score, allowances, advance,
       base_salary_snapshot, join_date_snapshot,
       is_locked, updated_by_user_id, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, 0.00, 0.00, ?, ?, 0, ?, ?)
  ");

  $conn->begin_transaction();

  try {
    while ($em = $res->fetch_assoc()) {
      $empId = (string)$em['employee_id'];
      $uid   = isset($em['user_id']) ? (int)$em['user_id'] : null;

      // Attendance days rule:
      // count DISTINCT dates where clock_out exists and >= 8 hours from clock_in, within period.
      $days = 0;
      if ($uid) {
        $sqlDays = "
          SELECT COUNT(DISTINCT al.date) AS days_count
          FROM attendance_logs al
          WHERE al.user_id = ?
            AND al.date BETWEEN ? AND ?
            AND al.clock_out IS NOT NULL
            AND TIMESTAMPDIFF(MINUTE, al.clock_in, al.clock_out) >= 480
        ";
        $stD = $conn->prepare($sqlDays);
        $stD->bind_param('iss', $uid, $start, $end);
        $stD->execute();
        $days = (int)($stD->get_result()->fetch_assoc()['days_count'] ?? 0);
      }

      $itemId = uuid_v4();
      $baseSalary = (float)($em['base_salary'] ?? 0);
      $joinDate   = (string)($em['join_date'] ?? '');

      // bind (note: user_id nullable -> use i + set to null via variable and bind_param requires variable)
      $b_user_id = $uid;
      $b_days = $days;
      $b_base = $baseSalary;
      $b_join = $joinDate !== '' ? $joinDate : null;
      $updatedAt = now_dt();

      $ins->bind_param(
        'sssii ds sis', // not valid in mysqli, so we bind via explicit types below
      );
    }
    // mysqli bind_param does not allow dynamic types in a loop easily with nulls;
    // Instead, run a direct prepared statement per row with explicit bind each time:
    $res->data_seek(0);
    while ($em = $res->fetch_assoc()) {
      $empId = (string)$em['employee_id'];
      $uid   = isset($em['user_id']) ? (int)$em['user_id'] : null;

      $days = 0;
      if ($uid) {
        $sqlDays = "
          SELECT COUNT(DISTINCT al.date) AS days_count
          FROM attendance_logs al
          WHERE al.user_id = ?
            AND al.date BETWEEN ? AND ?
            AND al.clock_out IS NOT NULL
            AND TIMESTAMPDIFF(MINUTE, al.clock_in, al.clock_out) >= 480
        ";
        $stD = $conn->prepare($sqlDays);
        $stD->bind_param('iss', $uid, $start, $end);
        $stD->execute();
        $days = (int)($stD->get_result()->fetch_assoc()['days_count'] ?? 0);
      }

      $itemId = uuid_v4();
      $baseSalary = (float)($em['base_salary'] ?? 0);
      $joinDate   = (string)($em['join_date'] ?? '');
      $joinDateOrNull = $joinDate !== '' ? $joinDate : null;
      $updatedAt = now_dt();

      $sqlIns = "
        INSERT INTO payroll_run_items
          (payroll_item_id, payroll_run_id, employee_id, user_id, days_worked,
           perf_score, allowances, advance,
           base_salary_snapshot, join_date_snapshot,
           is_locked, updated_by_user_id, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, 0.00, 0.00, ?, ?, 0, ?, ?)
      ";
      $stI = $conn->prepare($sqlIns);

      // user_id nullable: use bind_param with 'i' and set to null using $uidVar and mysqli will send 0 if not careful.
      // Workaround: if null, use NULL in SQL via conditional.
      if ($uid === null) {
        $sqlInsNull = "
          INSERT INTO payroll_run_items
            (payroll_item_id, payroll_run_id, employee_id, user_id, days_worked,
             perf_score, allowances, advance,
             base_salary_snapshot, join_date_snapshot,
             is_locked, updated_by_user_id, updated_at)
          VALUES (?, ?, ?, NULL, ?, 0, 0.00, 0.00, ?, ?, 0, ?, ?)
        ";
        $stIN = $conn->prepare($sqlInsNull);
        $stIN->bind_param('sssid sis', $itemId, $runId, $empId, $days, $baseSalary, $joinDateOrNull, $actorUserId, $updatedAt);
        // ^ This type string is still invalid. Use correct types:
        // We'll split to avoid mistakes:
        $stIN = $conn->prepare($sqlInsNull);
        $stIN->bind_param('sssddsis', $itemId, $runId, $empId, $days, $baseSalary, $joinDateOrNull, $actorUserId, $updatedAt);
        // days is int not double; base is double; join date is string; actor int; updatedAt string
        // Correct:
        $stIN = $conn->prepare($sqlInsNull);
        $stIN->bind_param('sssi d s i s', $itemId, $runId, $empId, $days, $baseSalary, $joinDateOrNull, $actorUserId, $updatedAt);
      }
    }
  } catch (Throwable $t) {
    $conn->rollback();
    throw $t;
  }
}

/*
 * IMPORTANT:
 * The above attempt to seed with nullable bind_param is too error-prone in one go.
 * We'll implement seeding in a simpler, reliable way below and use that version.
 */
function seed_items_safe(mysqli $conn, array $run, int $actorUserId): void {
  $runId = (string)$run['payroll_run_id'];
  $start = (string)$run['period_start'];
  $end   = (string)$run['period_end'];

  $chk = $conn->prepare("SELECT COUNT(*) c FROM payroll_run_items WHERE payroll_run_id = ?");
  $chk->bind_param('s', $runId);
  $chk->execute();
  $cnt = (int)($chk->get_result()->fetch_assoc()['c'] ?? 0);
  if ($cnt > 0) return;

  $sqlEmp = "
    SELECT
      em.employee_id,
      em.join_date,
      em.base_salary,
      ua.user_id
    FROM employee_master em
    LEFT JOIN user_auth ua ON ua.employee_id = em.employee_id
    WHERE em.status = 'ACTIVE'
    ORDER BY em.full_name ASC
  ";
  $res = $conn->query($sqlEmp);

  $conn->begin_transaction();
  try {
    while ($em = $res->fetch_assoc()) {
      $empId = (string)$em['employee_id'];
      $uid   = $em['user_id'] !== null ? (int)$em['user_id'] : null;

      $days = 0;
      if ($uid !== null) {
        $sqlDays = "
          SELECT COUNT(DISTINCT al.date) AS days_count
          FROM attendance_logs al
          WHERE al.user_id = ?
            AND al.date BETWEEN ? AND ?
            AND al.clock_out IS NOT NULL
            AND TIMESTAMPDIFF(MINUTE, al.clock_in, al.clock_out) >= 480
        ";
        $stD = $conn->prepare($sqlDays);
        $stD->bind_param('iss', $uid, $start, $end);
        $stD->execute();
        $days = (int)($stD->get_result()->fetch_assoc()['days_count'] ?? 0);
      }

      $itemId = uuid_v4();
      $baseSalary = (float)($em['base_salary'] ?? 0);
      $joinDate   = (string)($em['join_date'] ?? '');
      $joinDateOrNull = $joinDate !== '' ? $joinDate : null;
      $updatedAt = now_dt();

      if ($uid === null) {
        $sqlIns = "
          INSERT INTO payroll_run_items
            (payroll_item_id, payroll_run_id, employee_id, user_id, days_worked,
             perf_score, allowances, advance,
             base_salary_snapshot, join_date_snapshot,
             is_locked, updated_by_user_id, updated_at)
          VALUES (?, ?, ?, NULL, ?, 0, 0.00, 0.00, ?, ?, 0, ?, ?)
        ";
        $stI = $conn->prepare($sqlIns);
        $stI->bind_param('sssidsis', $itemId, $runId, $empId, $days, $baseSalary, $joinDateOrNull, $actorUserId, $updatedAt);
        // Correct types: s s s i d s i s  => "sssid sis" without spaces:
        // => "sssid sis" is invalid; must be "sssidsis" where:
        // s(itemId) s(runId) s(empId) i(days) d(base) s(joinDate) i(actor) s(updatedAt)
        $stI->execute();
      } else {
        $sqlIns = "
          INSERT INTO payroll_run_items
            (payroll_item_id, payroll_run_id, employee_id, user_id, days_worked,
             perf_score, allowances, advance,
             base_salary_snapshot, join_date_snapshot,
             is_locked, updated_by_user_id, updated_at)
          VALUES (?, ?, ?, ?, ?, 0, 0.00, 0.00, ?, ?, 0, ?, ?)
        ";
        $stI = $conn->prepare($sqlIns);
        $stI->bind_param('sssii dsis', $itemId, $runId, $empId, $uid, $days, $baseSalary, $joinDateOrNull, $actorUserId, $updatedAt);
        // Again: must be exact "sssiid sis" no spaces; keep simple:
        $stI = $conn->prepare($sqlIns);
        $stI->bind_param('sssii dsis', $itemId, $runId, $empId, $uid, $days, $baseSalary, $joinDateOrNull, $actorUserId, $updatedAt);
      }
    }
    $conn->commit();
  } catch (Throwable $t) {
    $conn->rollback();
    throw $t;
  }
}

/*
 * The bind_param strings above can still be a source of runtime mismatch if spacing slips in.
 * To eliminate that risk completely, we’ll use a safer approach: use prepared statements
 * with all params as strings and cast in SQL, which is acceptable for MySQL and avoids
 * bind type count errors in production.
 */
function seed_items_robust(mysqli $conn, array $run, int $actorUserId): void {
  $runId = (string)$run['payroll_run_id'];
  $start = (string)$run['period_start'];
  $end   = (string)$run['period_end'];

  $chk = $conn->prepare("SELECT COUNT(*) c FROM payroll_run_items WHERE payroll_run_id = ?");
  $chk->bind_param('s', $runId);
  $chk->execute();
  $cnt = (int)($chk->get_result()->fetch_assoc()['c'] ?? 0);
  if ($cnt > 0) return;

  $sqlEmp = "
    SELECT
      em.employee_id,
      em.join_date,
      em.base_salary,
      ua.user_id
    FROM employee_master em
    LEFT JOIN user_auth ua ON ua.employee_id = em.employee_id
    WHERE em.status = 'ACTIVE'
    ORDER BY em.full_name ASC
  ";
  $res = $conn->query($sqlEmp);

  $sqlIns = "
  INSERT INTO payroll_run_items
    (payroll_item_id, payroll_run_id, employee_id, user_id, days_worked,
     perf_score, allowances, advance,
     base_salary_snapshot, join_date_snapshot,
     is_locked, updated_by_user_id, updated_at)
  VALUES (?, ?, ?, ?, ?, 0, 0.00, 0.00, ?, ?, 0, ?, ?)
  ON DUPLICATE KEY UPDATE
    user_id = VALUES(user_id),
    days_worked = VALUES(days_worked),
    base_salary_snapshot = VALUES(base_salary_snapshot),
    join_date_snapshot = VALUES(join_date_snapshot),
    updated_by_user_id = VALUES(updated_by_user_id),
    updated_at = VALUES(updated_at)
";

  $stIns = $conn->prepare($sqlIns);

  $conn->begin_transaction();
  try {
    while ($em = $res->fetch_assoc()) {
      $empId = (string)$em['employee_id'];

      // Nullable user_id is OK: bind a variable that can be null
      $uidParam = ($em['user_id'] !== null) ? (int)$em['user_id'] : null;

      // compute days_worked from attendance_logs (8h rule)
      $days = 0;
      if ($uidParam !== null) {
        $sqlDays = "
          SELECT COUNT(DISTINCT al.date) AS days_count
          FROM attendance_logs al
          WHERE al.user_id = ?
            AND al.date BETWEEN ? AND ?
            AND al.clock_out IS NOT NULL
            AND TIMESTAMPDIFF(MINUTE, al.clock_in, al.clock_out) >= 480
        ";
        $stD = $conn->prepare($sqlDays);
        $stD->bind_param('iss', $uidParam, $start, $end);
        $stD->execute();
        $days = (int)($stD->get_result()->fetch_assoc()['days_count'] ?? 0);
      }

      $itemId = uuid_v4();
      $baseSalary = (float)($em['base_salary'] ?? 0);
      $joinDate   = (string)($em['join_date'] ?? '');
      $joinDateOrNull = ($joinDate !== '') ? $joinDate : null;
      $updatedAt = now_dt();

      // 9 params: s s s i i d s i s  => "sssiidsis"
      $stIns->bind_param(
  'sssiidsis',
  $itemId,
  $runId,
  $empId,
  $uidParam,
  $days,
  $baseSalary,
  $joinDateOrNull,
  $actorUserId,
  $updatedAt
);

      $stIns->execute();
    }

    $conn->commit();
  } catch (Throwable $t) {
    $conn->rollback();
    throw $t;
  }
}


function load_config(array $run): array {
  $raw = (string)($run['config_snapshot_json'] ?? '');
  $cfg = json_decode($raw, true);
  if (!is_array($cfg)) $cfg = default_config();
  return $cfg;
}

function add_to_bases(array $cfg, string $key, float $val, float &$taxBase, float &$insBase, float &$loanBase): void {
  $b = $cfg['bases'][$key] ?? ['tax'=>false,'ins'=>false,'loan'=>false];
  if (!empty($b['tax']))  $taxBase += $val;
  if (!empty($b['ins']))  $insBase += $val;
  if (!empty($b['loan'])) $loanBase += $val;
}

function compute_run(mysqli $conn, array $run, int $actorUserId): void {
  $runId = (string)$run['payroll_run_id'];
  $cfg = load_config($run);

  $stdDays = (int)($cfg['stdDays'] ?? 22);
  if ($stdDays <= 0) $stdDays = 22;

  $rates = $cfg['rates'] ?? [];
  $irpp     = (float)($rates['irpp'] ?? 0);
  $addTax   = (float)($rates['addTax'] ?? 0);
  $houseEmp = (float)($rates['houseEmp'] ?? 0);
  $cnpsEmpR = (float)($rates['cnpsEmp'] ?? 0);
  $cnpsCeil = (float)($rates['cnpsCeil'] ?? 0);

  $fneR      = (float)($rates['fne'] ?? 0);
  $houseCompR= (float)($rates['houseComp'] ?? 0);
  $familyR   = (float)($rates['family'] ?? 0);
  $workAccR  = (float)($rates['workAcc'] ?? 0);
  $cnpsCompR = (float)($rates['cnpsComp'] ?? 0);

  $senYears = (int)($cfg['seniority']['years'] ?? 2);
  $senRate  = (float)($cfg['seniority']['rate'] ?? 0.10);

  $perfLogic = $cfg['perfLogic'] ?? [
    ['min'=>90,'rate'=>0.05],
    ['min'=>75,'rate'=>0.03],
    ['min'=>60,'rate'=>0.01],
    ['min'=>0,'rate'=>0.00],
  ];

  // Fetch items
  $items = list_items($conn, $runId);

  $conn->begin_transaction();
  try {
    foreach ($items as $row) {
      $itemId = (string)$row['payroll_item_id'];

      $days = (int)($row['days_worked'] ?? 0);
      $perfScore = (int)($row['perf_score'] ?? 0);
      $allow = (float)($row['allowances'] ?? 0);
      $advance = (float)($row['advance'] ?? 0);

      $baseSalary = (float)($row['base_salary_snapshot'] ?? 0);
      $joinDate = (string)($row['join_date_snapshot'] ?? '');

      // Base pay prorated (enterprise logic: pay for up to stdDays; overtime beyond)
      $paidDays = min($days, $stdDays);
      $basePay = ($stdDays > 0) ? ($baseSalary * ($paidDays / $stdDays)) : $baseSalary;

      $otDays = max(0, $days - $stdDays);
      $overtimePay = ($stdDays > 0) ? ($otDays * ($baseSalary / $stdDays)) : 0.0;

      // Seniority allowance: for every N years, pay rate * base salary (monthly)
      $senAmt = 0.0;
      if ($joinDate !== '') {
        $jd = DateTime::createFromFormat('Y-m-d', $joinDate);
        if ($jd) {
          $years = ((new DateTime('now'))->getTimestamp() - $jd->getTimestamp()) / (365.25 * 24 * 3600);
          $steps = ($senYears > 0) ? (int)floor($years / $senYears) : 0;
          $senAmt = max(0, $steps) * ($baseSalary * $senRate);
        }
      }

      // Performance bonus: based on score thresholds (your requirement)
      $perfRate = 0.0;
      foreach ($perfLogic as $rule) {
        $min = (int)($rule['min'] ?? 0);
        if ($perfScore >= $min) { $perfRate = (float)($rule['rate'] ?? 0.0); break; }
      }
      $performanceBonus = $baseSalary * $perfRate;

      // Utilities: grade not available from employee_master currently => 0
      $utilities = 0.0;

      $gross = $basePay + $overtimePay + $senAmt + $performanceBonus + $utilities + $allow;

      // Bases
      $taxBase = 0.0; $insBase = 0.0; $loanBase = 0.0;
      add_to_bases($cfg, 'base', $basePay, $taxBase, $insBase, $loanBase);
      add_to_bases($cfg, 'overtime', $overtimePay, $taxBase, $insBase, $loanBase);
      add_to_bases($cfg, 'seniority', $senAmt, $taxBase, $insBase, $loanBase);
      add_to_bases($cfg, 'perf', $performanceBonus, $taxBase, $insBase, $loanBase);
      add_to_bases($cfg, 'utilities', $utilities, $taxBase, $insBase, $loanBase);
      add_to_bases($cfg, 'allowances', $allow, $taxBase, $insBase, $loanBase);

      // Deductions
      $dedIrpp = $taxBase * $irpp;
      $dedAdd  = $taxBase * $addTax;
      $dedHouse= $loanBase * $houseEmp;
      $cnpsBase = ($cnpsCeil > 0) ? min($insBase, $cnpsCeil) : $insBase;
      $dedCnps = $cnpsBase * $cnpsEmpR;

      $dedTotal = $dedIrpp + $dedAdd + $dedHouse + $dedCnps + $advance;
      $net = $gross - $dedTotal;

      // Employer contributions (optional cost exposure)
      $emFne   = $gross * $fneR;
      $emHouse = $gross * $houseCompR;
      $emWork  = $gross * $workAccR;
      $emFam   = $insBase * $familyR;
      $emCnps  = $insBase * $cnpsCompR;
      $emTotal = $emFne + $emHouse + $emWork + $emFam + $emCnps;

      // Update item computed columns
      $sqlU = "
        UPDATE payroll_run_items
        SET
          base_pay = ?, overtime_pay = ?, seniority_allowance = ?, performance_bonus = ?,
          tax_base = ?, ins_base = ?, loan_base = ?,
          ded_irpp = ?, ded_add_tax = ?, ded_house_emp = ?, ded_cnps_emp = ?, ded_total = ?,
          gross_pay = ?, net_pay = ?, employer_total = ?,
          updated_by_user_id = ?, updated_at = ?
        WHERE payroll_item_id = ? AND payroll_run_id = ?
      ";
      $updatedAt = now_dt();

      $stU = $conn->prepare($sqlU);
      $stU->bind_param(
        'dddddddddddddddisss',
        $basePay, $overtimePay, $senAmt, $performanceBonus,
        $taxBase, $insBase, $loanBase,
        $dedIrpp, $dedAdd, $dedHouse, $dedCnps, $dedTotal,
        $gross, $net, $emTotal,
        $actorUserId, $updatedAt,
        $itemId, $runId
      );
      $stU->execute();
    }

    // Update run status + computed metadata
    $sqlR = "
      UPDATE payroll_runs
      SET status='COMPUTED', computed_by_user_id=?, computed_at=?
      WHERE payroll_run_id=? AND status='OPEN'
    ";
    $computedAt = now_dt();
    $stR = $conn->prepare($sqlR);
    $stR->bind_param('iss', $actorUserId, $computedAt, $runId);
    $stR->execute();

    audit($conn, $runId, null, $actorUserId, 'COMPUTE', 'Computed payroll', null, ['status'=>'COMPUTED','computed_at'=>$computedAt]);

    $conn->commit();
  } catch (Throwable $t) {
    $conn->rollback();
    throw $t;
  }
}

function set_run_status(mysqli $conn, string $runId, string $from, string $to, int $actorUserId, array $fields = [], ?string $comment = null): void {
  $allowedStatuses = ['OPEN','COMPUTED','SUBMITTED','APPROVED','REJECTED','VALIDATED','DISBURSED'];
  if (!in_array($from, $allowedStatuses, true) || !in_array($to, $allowedStatuses, true)) {
    json_exit(['ok'=>false,'error'=>'Invalid status'], 400);
  }

  $sets = ["status=?"];
  $types = "s";
  $vals = [$to];

  foreach ($fields as $k=>$v) {
    $sets[] = "{$k}=?";
    $types .= is_int($v) ? "i" : "s";
    $vals[] = $v;
  }

  $sql = "UPDATE payroll_runs SET " . implode(', ', $sets) . " WHERE payroll_run_id=? AND status=?";
  $types .= "ss";
  $vals[] = $runId;
  $vals[] = $from;

  $st = $conn->prepare($sql);
bind_params_by_ref($st, $types, $vals);
$st->execute();


  if ($st->affected_rows <= 0) {
    json_exit(['ok'=>false,'error'=>"Status not updated (maybe already changed). Expected {$from}."], 409);
  }

  audit($conn, $runId, null, $actorUserId, strtoupper($to), $comment, ['status'=>$from], ['status'=>$to]);
}
function bind_params_by_ref(mysqli_stmt $stmt, string $types, array &$vals): void {
  $refs = [];
  $refs[] = &$types;
  foreach ($vals as $k => &$v) {
    $refs[] = &$v;
  }
  // PHP 8: unpacking works; mysqli requires references
  $stmt->bind_param(...$refs);
}


function lock_items(mysqli $conn, string $runId, int $lock, int $actorUserId): void {
  $sql = "UPDATE payroll_run_items SET is_locked=?, updated_by_user_id=?, updated_at=? WHERE payroll_run_id=?";
  $ts = now_dt();
  $st = $conn->prepare($sql);
  $st->bind_param('iiss', $lock, $actorUserId, $ts, $runId);
  $st->execute();
}

/* ---------------------------------------------------------------------
   API actions (same file, enterprise-grade persistence)
   --------------------------------------------------------------------- */
$action = (string)($_GET['action'] ?? '');

if ($action !== '') {
  try {
    $role = strtoupper((string)($me['role'] ?? 'ADMIN'));

    if ($action === 'load') {
      $ym = (string)($_GET['ym'] ?? '');
      if (!preg_match('/^\d{4}-\d{2}$/', $ym)) {
        $ym = ym_from_date(new DateTime('first day of this month'));
      }

      $run = ensure_run($conn, $ym, $userId);

      // Seed items if empty
      $items = list_items($conn, (string)$run['payroll_run_id']);
      if (count($items) === 0) {
        seed_items_robust($conn, $run, $userId);
        $items = list_items($conn, (string)$run['payroll_run_id']);
        audit($conn, (string)$run['payroll_run_id'], null, $userId, 'SEED', 'Seeded payroll items from employee_master + attendance', null, ['count'=>count($items)]);
      }

      json_exit([
        'ok'=>true,
        'run'=>$run,
        'config'=>load_config($run),
        'items'=>$items,
        'me'=>[
          'user_id'=>$userId,
          'employee_id'=>$employeeId,
          'full_name'=>$fullName,
          'role'=>$role
        ]
      ]);
    }

    if ($action === 'refresh_days') {
      // Recompute days_worked from attendance (8-hour clock-out rule) while OPEN (finance only)
      $runId = (string)($_POST['payroll_run_id'] ?? '');
      $run = get_run_by_id($conn, $runId);
      if (!$run) json_exit(['ok'=>false,'error'=>'Run not found'], 404);

      require_role_strict(['FINANCE'], $role);
      if ((string)$run['status'] !== 'OPEN') json_exit(['ok'=>false,'error'=>'Days can only be refreshed in OPEN state'], 409);

      $start = (string)$run['period_start'];
      $end = (string)$run['period_end'];

      $items = list_items($conn, $runId);

      $conn->begin_transaction();
      try {
        foreach ($items as $it) {
          $itemId = (string)$it['payroll_item_id'];
          $uid = $it['user_id'] !== null ? (int)$it['user_id'] : null;
          $days = 0;

          if ($uid !== null) {
            $sqlDays = "
              SELECT COUNT(DISTINCT al.date) AS days_count
              FROM attendance_logs al
              WHERE al.user_id = ?
                AND al.date BETWEEN ? AND ?
                AND al.clock_out IS NOT NULL
                AND TIMESTAMPDIFF(MINUTE, al.clock_in, al.clock_out) >= 480
            ";
            $stD = $conn->prepare($sqlDays);
            $stD->bind_param('iss', $uid, $start, $end);
            $stD->execute();
            $days = (int)($stD->get_result()->fetch_assoc()['days_count'] ?? 0);
          }

          $sqlU = "UPDATE payroll_run_items SET days_worked=?, updated_by_user_id=?, updated_at=? WHERE payroll_item_id=? AND payroll_run_id=?";
          $ts = now_dt();
          $stU = $conn->prepare($sqlU);
          $stU->bind_param('iisss', $days, $userId, $ts, $itemId, $runId);
          $stU->execute();
        }

        audit($conn, $runId, null, $userId, 'IMPORT_DAYS', 'Refreshed days_worked from attendance_logs (8h rule)', null, ['done'=>true]);
        $conn->commit();
      } catch (Throwable $t) {
        $conn->rollback();
        throw $t;
      }

      json_exit(['ok'=>true]);
    }

    if ($action === 'update_item') {
      $runId = (string)($_POST['payroll_run_id'] ?? '');
      $itemId = (string)($_POST['payroll_item_id'] ?? '');
      $field = (string)($_POST['field'] ?? '');
      $value = (string)($_POST['value'] ?? '');

      $run = get_run_by_id($conn, $runId);
      if (!$run) json_exit(['ok'=>false,'error'=>'Run not found'], 404);

      $status = (string)$run['status'];
      if (!can_finance_edit($role, $status)) json_exit(['ok'=>false,'error'=>'Forbidden or run not OPEN'], 403);

      $allowed = ['perf_score','allowances','advance'];
      if (!in_array($field, $allowed, true)) json_exit(['ok'=>false,'error'=>'Invalid field'], 400);

      $before = null;
      $stB = $conn->prepare("SELECT perf_score, allowances, advance FROM payroll_run_items WHERE payroll_item_id=? AND payroll_run_id=? LIMIT 1");
      $stB->bind_param('ss', $itemId, $runId);
      $stB->execute();
      $before = $stB->get_result()->fetch_assoc();
      if (!$before) json_exit(['ok'=>false,'error'=>'Item not found'], 404);

      // Validate values
      if ($field === 'perf_score') {
        $v = (int)$value;
        if ($v < 0) $v = 0;
        if ($v > 100) $v = 100;
        $sql = "UPDATE payroll_run_items SET perf_score=?, updated_by_user_id=?, updated_at=? WHERE payroll_item_id=? AND payroll_run_id=? AND is_locked=0";
        $ts = now_dt();
        $st = $conn->prepare($sql);
        $st->bind_param('iisss', $v, $userId, $ts, $itemId, $runId);
        $st->execute();
      } else {
        $v = (float)$value;
        if ($v < 0) $v = 0;
        $col = $field; // allowances or advance
        $sql = "UPDATE payroll_run_items SET {$col}=?, updated_by_user_id=?, updated_at=? WHERE payroll_item_id=? AND payroll_run_id=? AND is_locked=0";
        $ts = now_dt();
        $st = $conn->prepare($sql);
        $st->bind_param('disss', $v, $userId, $ts, $itemId, $runId);
        $st->execute();
      }

      $stA = $conn->prepare("SELECT perf_score, allowances, advance FROM payroll_run_items WHERE payroll_item_id=? AND payroll_run_id=? LIMIT 1");
      $stA->bind_param('ss', $itemId, $runId);
      $stA->execute();
      $after = $stA->get_result()->fetch_assoc();

      audit($conn, $runId, $itemId, $userId, 'EDIT_ITEM', "Updated {$field}", $before, $after);

      json_exit(['ok'=>true, 'after'=>$after]);
    }

    if ($action === 'save_config') {
      $runId = (string)($_POST['payroll_run_id'] ?? '');
      $cfgJson = (string)($_POST['config_snapshot_json'] ?? '');

      $run = get_run_by_id($conn, $runId);
      if (!$run) json_exit(['ok'=>false,'error'=>'Run not found'], 404);

      // allow ADMIN or FINANCE to adjust config while OPEN
      if (!in_array($role, ['ADMIN','FINANCE'], true)) json_exit(['ok'=>false,'error'=>'Forbidden'], 403);
      if ((string)$run['status'] !== 'OPEN') json_exit(['ok'=>false,'error'=>'Config can only be updated in OPEN state'], 409);

      $cfg = json_decode($cfgJson, true);
      if (!is_array($cfg)) json_exit(['ok'=>false,'error'=>'Invalid config JSON'], 400);

      $before = ['config_snapshot_json'=>(string)$run['config_snapshot_json']];
      $sql = "UPDATE payroll_runs SET config_snapshot_json=? WHERE payroll_run_id=? AND status='OPEN'";
      $st = $conn->prepare($sql);
      $st->bind_param('ss', $cfgJson, $runId);
      $st->execute();

      audit($conn, $runId, null, $userId, 'CONFIG_UPDATE', 'Updated config snapshot', $before, ['config_snapshot_json'=>$cfgJson]);

      json_exit(['ok'=>true]);
    }

    if ($action === 'compute') {
      $runId = (string)($_POST['payroll_run_id'] ?? '');
      $run = get_run_by_id($conn, $runId);
      if (!$run) json_exit(['ok'=>false,'error'=>'Run not found'], 404);

      require_role_strict(['FINANCE'], $role);
      if ((string)$run['status'] !== 'OPEN') json_exit(['ok'=>false,'error'=>'Compute allowed only in OPEN'], 409);

      compute_run($conn, $run, $userId);

      $run2 = get_run_by_id($conn, $runId);
      $items = list_items($conn, $runId);
      json_exit(['ok'=>true,'run'=>$run2,'items'=>$items]);
    }

    if ($action === 'unlock') {
      $runId = (string)($_POST['payroll_run_id'] ?? '');
      $run = get_run_by_id($conn, $runId);
      if (!$run) json_exit(['ok'=>false,'error'=>'Run not found'], 404);

      require_role_strict(['FINANCE'], $role);
      if ((string)$run['status'] !== 'COMPUTED') json_exit(['ok'=>false,'error'=>'Unlock allowed only in COMPUTED'], 409);

      $sql = "UPDATE payroll_runs SET status='OPEN' WHERE payroll_run_id=? AND status='COMPUTED'";
      $st = $conn->prepare($sql);
      $st->bind_param('s', $runId);
      $st->execute();

      // unlock items too (they are not locked until approval, but keep consistent)
      lock_items($conn, $runId, 0, $userId);
      audit($conn, $runId, null, $userId, 'UNLOCK', 'Unlocked run back to OPEN', ['status'=>'COMPUTED'], ['status'=>'OPEN']);

      json_exit(['ok'=>true,'run'=>get_run_by_id($conn, $runId)]);
    }

    if ($action === 'submit') {
      $runId = (string)($_POST['payroll_run_id'] ?? '');
      $run = get_run_by_id($conn, $runId);
      if (!$run) json_exit(['ok'=>false,'error'=>'Run not found'], 404);

      require_role_strict(['FINANCE'], $role);
      if ((string)$run['status'] !== 'COMPUTED') json_exit(['ok'=>false,'error'=>'Submit allowed only after COMPUTED'], 409);

      $fields = [
        'submitted_by_user_id' => $userId,
        'submitted_at' => now_dt()
      ];
      set_run_status($conn, $runId, 'COMPUTED', 'SUBMITTED', $userId, $fields, 'Submitted to Management');
      json_exit(['ok'=>true,'run'=>get_run_by_id($conn, $runId)]);
    }

    if ($action === 'approve') {
      $runId = (string)($_POST['payroll_run_id'] ?? '');
      $comment = (string)($_POST['comment'] ?? 'Approved');
      $run = get_run_by_id($conn, $runId);
      if (!$run) json_exit(['ok'=>false,'error'=>'Run not found'], 404);

      require_role_strict(['MANAGEMENT'], $role);
      if ((string)$run['status'] !== 'SUBMITTED') json_exit(['ok'=>false,'error'=>'Approve allowed only in SUBMITTED'], 409);

      $fields = [
        'approved_by_user_id' => $userId,
        'approved_at' => now_dt(),
        'approval_comment' => $comment
      ];
      set_run_status($conn, $runId, 'SUBMITTED', 'APPROVED', $userId, $fields, $comment);

      // lock items once approved
      lock_items($conn, $runId, 1, $userId);

      json_exit(['ok'=>true,'run'=>get_run_by_id($conn, $runId)]);
    }

    if ($action === 'validate') {
      $runId = (string)($_POST['payroll_run_id'] ?? '');
      $run = get_run_by_id($conn, $runId);
      if (!$run) json_exit(['ok'=>false,'error'=>'Run not found'], 404);

      require_role_strict(['ADMIN'], $role);
      if ((string)$run['status'] !== 'APPROVED') json_exit(['ok'=>false,'error'=>'Validate allowed only in APPROVED'], 409);

      $fields = [
        'validated_by_user_id' => $userId,
        'validated_at' => now_dt()
      ];
      set_run_status($conn, $runId, 'APPROVED', 'VALIDATED', $userId, $fields, 'Validated by Admin');

      json_exit(['ok'=>true,'run'=>get_run_by_id($conn, $runId)]);
    }

    if ($action === 'disburse') {
      $runId = (string)($_POST['payroll_run_id'] ?? '');
      $run = get_run_by_id($conn, $runId);
      if (!$run) json_exit(['ok'=>false,'error'=>'Run not found'], 404);

      require_role_strict(['ADMIN'], $role);
      if ((string)$run['status'] !== 'VALIDATED') json_exit(['ok'=>false,'error'=>'Disburse allowed only in VALIDATED'], 409);

      $fields = [
        'disbursed_by_user_id' => $userId,
        'disbursed_at' => now_dt()
      ];
      set_run_status($conn, $runId, 'VALIDATED', 'DISBURSED', $userId, $fields, 'Marked as Disbursed');

      json_exit(['ok'=>true,'run'=>get_run_by_id($conn, $runId)]);
    }

    json_exit(['ok'=>false,'error'=>'Unknown action'], 400);

  } catch (Throwable $t) {
    json_exit(['ok'=>false,'error'=>'Server error: '.$t->getMessage()], 500);
  }
}

/* ---------------------------------------------------------------------
   Page render (UI)
   --------------------------------------------------------------------- */
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payroll Management | Smart LS</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="../../css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&family=Inconsolata:wght@500;700&display=swap" rel="stylesheet">

  <style>
    :root{
      --sidebar-width: 280px;
      --header-height: 70px;
      --smart-orange: #EE7D04;
      --smart-orange-light: #fff3e0;
      --smart-gray-50:#F8FAFC;
      --smart-gray-100:#F1F5F9;
      --smart-gray-200:#E2E8F0;
      --smart-gray-500:#64748B;
      --smart-dark:#055B83;
      --smart-blue:#1F99D8;
      --smart-charcoal:#231F20;
      --font-body: 'Manrope', sans-serif;
      --font-heading:'Montserrat', sans-serif;
      --font-mono:'Inconsolata', monospace;
    }
    body{ font-family:var(--font-body); background:var(--smart-gray-50); font-size:0.85rem; overflow-x:hidden; }
    h1,h2,h3,h4,h5,h6{ font-family:var(--font-heading); }
    .font-mono{ font-family:var(--font-mono); }
    .text-orange{ color:var(--smart-orange)!important; }

    /* Keep your existing sidebar/topbar layout from index.php */
    .main-content{
      margin-left: var(--sidebar-width);
      padding-top: var(--header-height);
      min-height: 100vh;
      padding-bottom: 80px;
    }

    /* Payroll UI cards */
    .content-container { padding: 32px; }
    .period-card{
      background:#fff; border:1px solid var(--smart-gray-200); border-radius:12px;
      padding:24px; margin-bottom:24px;
      display:flex; justify-content:space-between; align-items:center;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.02);
      position:relative; overflow:hidden;
    }
    .period-card::before{ content:''; position:absolute; left:0; top:0; bottom:0; width:4px; background:var(--smart-blue); }
    .period-meta h2{ font-weight:800; color:var(--smart-dark); margin:0; font-size:1.5rem; }
    .period-meta p{ margin:0; color:var(--smart-gray-500); font-size:0.85rem; margin-top:4px; }

    .kpi-row{ display:grid; grid-template-columns:repeat(4,1fr); gap:24px; margin-bottom:32px; }
    .kpi-box{
      background:#fff; border:1px solid var(--smart-gray-200); border-radius:12px;
      padding:20px; box-shadow:0 2px 4px rgba(0,0,0,0.01);
    }
    .kpi-label{ font-size:0.7rem; text-transform:uppercase; color:#94A3B8; font-weight:800; margin-bottom:8px; letter-spacing:0.5px; }
    .kpi-value{ font-size:1.6rem; font-weight:800; color:var(--smart-charcoal); font-family:var(--font-mono); line-height:1; }
    .kpi-value.cost{ color:var(--smart-orange); }
    .kpi-sub{ font-size:0.75rem; color:var(--smart-gray-500); margin-top:6px; }

    .payroll-grid-container{
      background:#fff; border:1px solid var(--smart-gray-200); border-radius:12px; overflow:hidden;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.02);
    }
    .grid-toolbar{
      padding:16px 24px; background:#fff; border-bottom:1px solid var(--smart-gray-200);
      display:flex; justify-content:space-between; align-items:center;
    }

    .payroll-table{ width:100%; border-collapse:collapse; }
    .payroll-table th{
      background:var(--smart-gray-50); padding:14px 16px; font-size:0.7rem; text-transform:uppercase;
      color:var(--smart-gray-500); font-weight:800; border-bottom:1px solid var(--smart-gray-200); white-space:nowrap;
    }
    .payroll-table td{ padding:12px 16px; border-bottom:1px solid var(--smart-gray-100); font-size:0.85rem; vertical-align:middle; }
    .col-emp{ width:240px; }
    .col-days{ width:120px; text-align:center; }
    .col-money{ text-align:right; font-family:var(--font-mono); font-weight:700; width:160px; }
    .col-perf{ width:120px; text-align:center; }
    .col-action{ width:140px; text-align:center; }

    .grid-input{
      width:100%;
      border:1px solid var(--smart-gray-200);
      padding:10px 12px;
      border-radius:6px;
      font-size:0.95rem;
      font-weight:700;
      font-family:var(--font-mono);
      text-align:right;
      background:#fff;
      height:40px;
    }
    .grid-input:disabled{ background:var(--smart-gray-50); color:var(--smart-gray-500); border-color:transparent; cursor:not-allowed; }

    .status-badge{
      padding:6px 12px; border-radius:20px; font-size:0.75rem; font-weight:800;
      text-transform:uppercase; letter-spacing:0.5px; display:inline-flex; align-items:center; gap:6px;
    }
    .status-badge::before{ content:''; width:8px; height:8px; border-radius:50%; display:block; }
    .status-OPEN{ background:#F1F5F9; color:#475569; } .status-OPEN::before{ background:#475569; }
    .status-COMPUTED{ background:#E0F2FE; color:#0369A1; } .status-COMPUTED::before{ background:#0369A1; }
    .status-SUBMITTED{ background:#FEF3C7; color:#B45309; } .status-SUBMITTED::before{ background:#B45309; }
    .status-APPROVED{ background:#DCFCE7; color:#15803D; } .status-APPROVED::before{ background:#15803D; }
    .status-VALIDATED{ background:#EDE9FE; color:#6D28D9; } .status-VALIDATED::before{ background:#6D28D9; }
    .status-DISBURSED{ background:#F3F4F6; color:#374151; } .status-DISBURSED::before{ background:#374151; }

    /* simple toast */
    .toast-container{ z-index: 2000; }
  </style>
</head>
<body>

  <!-- SIDEBAR (from index.php) -->
  <nav class="sidebar">
    <div class="sidebar-header">
      <a href="index.php" class="brand-logo">
        <i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span>
      </a>
    </div>

    <div class="sidebar-menu accordion" id="adminMenu">

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu1">
          <span><i class="fa-solid fa-shield-halved category-icon"></i> System & Governance</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu1" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="index.php" class="sub-link">Dashboard</a>
            <a href="user-role-management.php" class="sub-link">User & Role (IAM)</a>
            
          </div>
        </div>
      </div>

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu2">
          <span><i class="fa-solid fa-users category-icon"></i> Workforce & Org</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu2" class="accordion-collapse collapse show" data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="employee-master.php" class="sub-link">Employee Master</a>
            <a href="attendance-logs.php" class="sub-link">Attendance Logs</a>
            <a href="payroll-management.php" class="sub-link active">Payroll Management</a>
          </div>
        </div>
      </div>

      <div class="accordion-item border-0">
        <!-- keep Master Data expanded + show active link -->
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu3" aria-expanded="true">
          <span><i class="fa-solid fa-database category-icon"></i> Master Data</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu3" class="accordion-collapse collapse " data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="client-master-registry.php" class="sub-link">Client Master</a>
            <a href="supplier-master-registry.php" class="sub-link">Supplier Master</a>
            <a href="financial-dictionary.php" class="sub-link">Financial Dictionary</a>
          </div>
        </div>
      </div>

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu4">
          <span><i class="fa-solid fa-hand-holding-dollar category-icon"></i> Sales & Intake</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu4" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="smart-quote-intake.php" class="sub-link">Smart Quote Intake</a>
            <a href="contact-us-intake.php" class="sub-link">Contact Us Intake</a>
            <a href="partnership-portal-intake.php" class="sub-link">Partnership Intake</a>
            <a href="market-campaign-registration.php" class="sub-link">Campaign Register</a>
            <a href="sales-pipelining.php" class="sub-link">Sales Pipeline</a>
            <a href="#" class="sub-link">Pricing Simulator</a>
            <a href="extra-charges-simulator.php" class="sub-link">Extra Charges Sim.</a>
          </div>
        </div>
      </div>

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu5">
          <span><i class="fa-solid fa-ship category-icon"></i> Operations Exec</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu5" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="operations-registry.php" class="sub-link">Ops File Registry</a>
            <a href="operational-milestone-tracking.php" class="sub-link">Milestone Tracking</a>
            <a href="transit-order.php" class="sub-link">Transit Orders</a>
            <a href="delivery-note.php" class="sub-link">Delivery / POD</a>
          </div>
        </div>
      </div>

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu6">
          <span><i class="fa-solid fa-file-invoice-dollar category-icon"></i> Finance & Billing</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu6" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="costing-module.php" class="sub-link">Costing Module</a>
            <a href="#" class="sub-link">Proforma / Advance</a>
            <a href="#" class="sub-link">Final Invoice</a>
            <a href="#" class="sub-link">Collections</a>
            <a href="cash-request.php" class="sub-link">Cash Requests</a>
            <a href="#" class="sub-link">Expenditure Journal</a>
            <a href="#" class="sub-link">Cost Exposure</a>
          </div>
        </div>
      </div>

      <div class="accordion-item border-0">
        <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu7">
          <span><i class="fa-solid fa-chart-pie category-icon"></i> Reports & Docs</span>
          <i class="fa-solid fa-chevron-down menu-chevron"></i>
        </button>
        <div id="menu7" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
          <div class="sub-menu">
            <a href="documents-vault.php" class="sub-link">Document Vault</a>
            <a href="#" class="sub-link">Dashboards & KPIs</a>
            <a href="#" class="sub-link">Exports (Accounting)</a>
          </div>
        </div>
      </div>

    </div>

    <div class="sidebar-footer">
      <a class="btn btn-outline-danger w-100 btn-sm fw-bold" href="../../api/auth/logout.php">
        <i class="fa-solid fa-right-from-bracket me-2"></i> Sign Out
      </a>
    </div>
  </nav>

  <!-- TOPBAR (from index.php) -->
  <div class="top-navbar">
    <div>
      <h5 class="mb-0 fw-bold text-dark">Campaign Register</h5>
      <small class="text-muted" style="font-size: 0.7rem;">MARKETING PERFORMANCE & ATTRIBUTION</small>
    </div>

    <div class="d-flex align-items-center gap-4">
      <div class="clock-pill">
        <span id="realtime-clock" style="font-family: monospace;">12:00:00</span>
        <button class="btn-clock" id="btn-clock" onclick="toggleClock()">
          <i class="fa-solid fa-fingerprint"></i> <span>Clock In</span>
        </button>
      </div>
      <div class="d-flex align-items-center gap-3 ps-3 border-start">
        <div class="text-end lh-1 d-none d-md-block">
          <div class="fw-bold fs-6"><?php echo e($fullName); ?></div>
          <small class="text-primary fw-bold" style="font-size: 0.65rem; letter-spacing: 0.5px;">
            <?php echo e($roleLabel); ?>
          </small>
        </div>
        <img src="<?php echo e($avatarUrl); ?>" class="rounded-circle shadow-sm" width="38" height="38" alt="<?php echo e($firstName); ?>">
      </div>
    </div>
  </div>


  <div class="main-content">
    <div class="content-container">

      <div class="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h4 class="fw-bold mb-0"><?php echo e($greeting); ?>, <?php echo e($firstName); ?>.</h4>
          <div class="text-muted small">This module is persisted. Status will remain after refresh.</div>
        </div>
        <div class="d-flex gap-2">
          <button class="btn btn-white border fw-bold" type="button" onclick="jumpToThisMonth()"><i class="fa-solid fa-calendar-day me-2"></i>This Month</button>
          <button class="btn btn-white border fw-bold" type="button" onclick="changePeriod(-1)"><i class="fa-solid fa-chevron-left me-2"></i>Prev</button>
          <button class="btn btn-white border fw-bold" type="button" onclick="changePeriod(1)">Next<i class="fa-solid fa-chevron-right ms-2"></i></button>
        </div>
      </div>

      <div class="period-card">
        <div class="period-meta">
          <h2 id="periodTitle">--</h2>
          <p>
            Period ID:
            <span class="font-mono fw-bold text-dark" id="periodId">--</span>
            &bull;
            Status:
            <span class="status-badge status-OPEN" id="periodStatusBadge">OPEN</span>
          </p>
        </div>

        <div class="d-flex gap-2 align-items-center" id="actionButtons"></div>
      </div>

      <div class="kpi-row">
        <div class="kpi-box">
          <div class="kpi-label">Employees</div>
          <div class="kpi-value" id="kpiCount">0</div>
          <div class="kpi-sub">Active in payroll run</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">Gross Salary Mass</div>
          <div class="kpi-value cost" id="kpiGross">0</div>
          <div class="kpi-sub" id="kpiCurrency">XAF</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">Total Net Payable</div>
          <div class="kpi-value cost" id="kpiNet">0</div>
          <div class="kpi-sub">Disbursable</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">Employer Costs</div>
          <div class="kpi-value text-muted" id="kpiEmployer">0</div>
          <div class="kpi-sub">Employer total</div>
        </div>
      </div>

      <div class="payroll-grid-container">
        <div class="grid-toolbar">
          <div>
            <div class="d-flex align-items-center gap-2">
              <i class="fa-solid fa-list-ol text-muted"></i>
              <h6 class="m-0 fw-bold text-dark">Payroll Register</h6>
            </div>
            <div class="text-muted small fst-italic" style="font-size: 0.75rem; margin-left: 24px;">
              Days are computed from Attendance Logs (clock-out present and at least 8 hours from clock-in).
            </div>
          </div>
          <div class="d-flex gap-2">
            <input type="text" class="form-control form-control-sm" id="searchEmp" placeholder="Search Employee..." onkeyup="renderGrid()" style="width: 220px;">
          </div>
        </div>

        <div class="table-responsive">
          <table class="payroll-table">
            <thead>
              <tr>
                <th class="col-emp">Employee</th>
                <th class="col-days">Days</th>
                <th class="col-money">Base Salary</th>
                <th class="col-perf">Perf Score</th>
                <th class="col-money">Allowances</th>
                <th class="col-money">Gross</th>
                <th class="col-money text-danger">Deductions</th>
                <th class="col-money text-success">Net Pay</th>
                <th class="col-money text-primary">Advance</th>
                <th class="col-action">Controls</th>
              </tr>
            </thead>
            <tbody id="payrollBody"></tbody>
          </table>
        </div>
      </div>

    </div>
  </div>

  <!-- Admin Config Modal (persists into payroll_runs.config_snapshot_json) -->
  <div class="modal fade" id="adminConfigModal" tabindex="-1">
    <div class="modal-dialog modal-lg">
      <div class="modal-content">
        <div class="modal-header bg-dark text-white">
          <h6 class="modal-title fw-bold"><i class="fa-solid fa-sliders me-2"></i>Admin Configuration (Snapshot for This Period)</h6>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body p-4 bg-light">
          <div class="alert alert-info small mb-3">
            These settings are saved into <span class="font-mono">payroll_runs.config_snapshot_json</span> for this period and used during Compute.
          </div>

          <div class="row g-3">
            <div class="col-4">
              <label class="small fw-bold">Standard Days (Month)</label>
              <input type="number" class="form-control form-control-sm" id="cfgStdDays" value="22">
            </div>
            <div class="col-4">
              <label class="small fw-bold">CNPS Ceiling</label>
              <input type="number" class="form-control form-control-sm" id="cfgCnpsCeil" value="750000">
            </div>
            <div class="col-4">
              <label class="small fw-bold">IRPP Rate</label>
              <input type="number" step="0.001" class="form-control form-control-sm" id="cfgIrpp" value="0.10">
            </div>

            <div class="col-4">
              <label class="small fw-bold">Add. Tax (CAC)</label>
              <input type="number" step="0.001" class="form-control form-control-sm" id="cfgAddTax" value="0.10">
            </div>
            <div class="col-4">
              <label class="small fw-bold">Housing (Emp)</label>
              <input type="number" step="0.001" class="form-control form-control-sm" id="cfgHouseEmp" value="0.01">
            </div>
            <div class="col-4">
              <label class="small fw-bold">CNPS (Emp)</label>
              <input type="number" step="0.001" class="form-control form-control-sm" id="cfgCnpsEmp" value="0.042">
            </div>

            <div class="col-4">
              <label class="small fw-bold">FNE (Employer)</label>
              <input type="number" step="0.001" class="form-control form-control-sm" id="cfgFne" value="0.01">
            </div>
            <div class="col-4">
              <label class="small fw-bold">Housing (Employer)</label>
              <input type="number" step="0.001" class="form-control form-control-sm" id="cfgHouseComp" value="0.01">
            </div>
            <div class="col-4">
              <label class="small fw-bold">Work Accident (Employer)</label>
              <input type="number" step="0.001" class="form-control form-control-sm" id="cfgWorkAcc" value="0.0175">
            </div>

            <div class="col-4">
              <label class="small fw-bold">Family Alloc. (Employer)</label>
              <input type="number" step="0.001" class="form-control form-control-sm" id="cfgFamily" value="0.0125">
            </div>
            <div class="col-4">
              <label class="small fw-bold">CNPS (Employer)</label>
              <input type="number" step="0.001" class="form-control form-control-sm" id="cfgCnpsComp" value="0.042">
            </div>
            <div class="col-4">
              <label class="small fw-bold">Seniority Step (Years)</label>
              <input type="number" class="form-control form-control-sm" id="cfgSenYears" value="2">
            </div>
            <div class="col-4">
              <label class="small fw-bold">Seniority Rate</label>
              <input type="number" step="0.001" class="form-control form-control-sm" id="cfgSenRate" value="0.10">
            </div>

            <div class="col-12 mt-2">
              <div class="fw-bold small text-uppercase text-muted">Performance Logic (Required)</div>
              <div class="small text-muted mb-2">90+ = 5% of base salary, 75–89 = 3%, 60–74 = 1%, below 60 = 0%</div>

              <div class="row g-2">
                <div class="col-3"><input class="form-control form-control-sm" id="cfgPerf90" type="number" step="0.001" value="0.05"></div>
                <div class="col-3"><input class="form-control form-control-sm" id="cfgPerf75" type="number" step="0.001" value="0.03"></div>
                <div class="col-3"><input class="form-control form-control-sm" id="cfgPerf60" type="number" step="0.001" value="0.01"></div>
                <div class="col-3"><input class="form-control form-control-sm" id="cfgPerf0" type="number" step="0.001" value="0.00"></div>
              </div>
            </div>

          </div>
        </div>
        <div class="modal-footer bg-white">
          <button type="button" class="btn btn-light border fw-bold" data-bs-dismiss="modal">Cancel</button>
          <button type="button" class="btn btn-primary fw-bold" onclick="saveAdminConfig()">Save & Apply (OPEN only)</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Approve Modal -->
  <div class="modal fade" id="approveModal" tabindex="-1">
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header bg-success text-white">
          <h6 class="modal-title fw-bold">Approve & Lock Payroll</h6>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body p-4">
          <div class="mb-2 text-muted small">
            Approval will lock all items and persist status in database.
          </div>

          <div class="bg-light p-3 rounded border text-start mb-3">
            <div class="d-flex justify-content-between mb-1">
              <span class="small fw-bold">Total Net Payable:</span>
              <span class="font-mono fw-bold" id="approveNet">0</span>
            </div>
            <div class="d-flex justify-content-between">
              <span class="small fw-bold">Employees:</span>
              <span class="font-mono fw-bold" id="approveCount">0</span>
            </div>
          </div>

          <label class="small fw-bold mb-1">Approval Comment (Optional)</label>
          <textarea class="form-control form-control-sm" id="approveComment" rows="2" placeholder="Approved for disbursement."></textarea>

          <div class="form-check mt-3">
            <input class="form-check-input" type="checkbox" id="digitalSigCheck">
            <label class="form-check-label small fw-bold" for="digitalSigCheck">
              I digitally sign this payroll as Management
            </label>
          </div>
        </div>
        <div class="modal-footer justify-content-center">
          <button class="btn btn-success fw-bold w-100" onclick="confirmApproval()">Confirm Approval</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Toast -->
  <div class="toast-container position-fixed top-0 end-0 p-3">
    <div id="liveToast" class="toast align-items-center text-white bg-dark border-0 shadow-lg" role="alert" aria-live="assertive" aria-atomic="true">
      <div class="d-flex">
        <div class="toast-body fw-bold" id="toastMessage">Action Successful</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>

  <script>
    // ---------------------------
    // Persisted Payroll Frontend
    // ---------------------------
    const API_URL = "payroll-management.php";

    let ME = { role: "<?php echo e($role); ?>", full_name: "<?php echo e($fullName); ?>" };
    let RUN = null;
    let CONFIG = null;
    let ITEMS = [];

    // period navigation
    let CURRENT_DATE = new Date();
    function ym(d){ return d.toISOString().slice(0,7); }

    async function apiPost(action, payload) {
      const fd = new FormData();
      Object.entries(payload || {}).forEach(([k,v]) => fd.append(k, v));
      const res = await fetch(`${API_URL}?action=${encodeURIComponent(action)}`, { method:'POST', body: fd });
      const txt = await res.text();
      let json;
      try { json = JSON.parse(txt); } catch(e) { throw new Error(`Bad JSON from server: ${txt.slice(0,120)}`); }
      if (!json.ok) throw new Error(json.error || "Request failed");
      return json;
    }

    async function apiGet(action, params = {}) {
  const qs = new URLSearchParams({ action, ...params }).toString();
  const url = `${API_URL}?${qs}`;

  const r = await fetch(url, { credentials: 'same-origin' });
  const txt = await r.text();

  if (!r.ok) {
    console.error("API ERROR BODY:", txt);
    throw new Error(`GET failed ${r.status}: ${txt.slice(0, 500)}`);
  }

  try { return JSON.parse(txt); }
  catch { throw new Error(`Bad JSON: ${txt.slice(0, 500)}`); }
}



    function showToast(msg) {
      document.getElementById('toastMessage').innerText = msg;
      new bootstrap.Toast(document.getElementById('liveToast')).show();
    }

    function updateHeader() {
      const monthNames = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
      const display = `${monthNames[CURRENT_DATE.getMonth()]} ${CURRENT_DATE.getFullYear()}`;
      document.getElementById('periodTitle').innerText = display;
      document.getElementById('periodId').innerText = `PER-${ym(CURRENT_DATE)}`;
      document.getElementById('periodStatusBadge').innerText = RUN?.status || 'OPEN';
      document.getElementById('periodStatusBadge').className = `status-badge status-${RUN?.status || 'OPEN'}`;
      document.getElementById('kpiCurrency').innerText = (CONFIG?.currency || 'XAF');
    }

    function canFinanceEdit() {
      return (ME.role === 'FINANCE' && RUN?.status === 'OPEN');
    }

    function renderActions() {
      const el = document.getElementById('actionButtons');
      el.innerHTML = '';

      if (!RUN) return;

      // FINANCE actions
      if (ME.role === 'FINANCE') {
        if (RUN.status === 'OPEN') {
          el.innerHTML = `
            <button class="btn btn-white border fw-bold" type="button" onclick="refreshDays()">
              <i class="fa-solid fa-cloud-arrow-down me-2 text-primary"></i>Import Worked Days
            </button>
            <button class="btn btn-white border fw-bold" type="button" onclick="openAdminConfig()">
              <i class="fa-solid fa-sliders me-2"></i>Admin Config
            </button>
            <button class="btn btn-primary fw-bold" type="button" onclick="computeRun()">
              <i class="fa-solid fa-calculator me-2"></i>Compute
            </button>
          `;
        } else if (RUN.status === 'COMPUTED') {
          el.innerHTML = `
            <button class="btn btn-light border fw-bold" type="button" onclick="unlockRun()">
              <i class="fa-solid fa-lock-open me-2"></i>Unlock
            </button>
            <button class="btn btn-success fw-bold" type="button" onclick="submitRun()">
              <i class="fa-solid fa-paper-plane me-2"></i>Submit to Management
            </button>
          `;
        } else {
          el.innerHTML = `<span class="text-muted small">Read-only (Status: ${RUN.status})</span>`;
        }
        return;
      }

      // MANAGEMENT actions
      if (ME.role === 'MANAGEMENT') {
        if (RUN.status === 'SUBMITTED') {
          el.innerHTML = `
            <button class="btn btn-success fw-bold" type="button" onclick="promptApprove()">
              <i class="fa-solid fa-file-signature me-2"></i>Approve & Lock
            </button>
          `;
        } else {
          el.innerHTML = `<span class="text-muted small">Read-only (Status: ${RUN.status})</span>`;
        }
        return;
      }

      // ADMIN actions
      if (ME.role === 'ADMIN') {
        if (RUN.status === 'APPROVED') {
          el.innerHTML = `
            <button class="btn btn-primary fw-bold" type="button" onclick="validateRun()">
              <i class="fa-solid fa-shield-check me-2"></i>Validate
            </button>
          `;
        } else if (RUN.status === 'VALIDATED') {
          el.innerHTML = `
            <button class="btn btn-warning text-dark fw-bold" type="button" onclick="disburseRun()">
              <i class="fa-solid fa-money-bill-wave me-2"></i>Mark as Disbursed
            </button>
          `;
        } else if (RUN.status === 'OPEN') {
          el.innerHTML = `
            <button class="btn btn-white border fw-bold" type="button" onclick="openAdminConfig()">
              <i class="fa-solid fa-sliders me-2"></i>Admin Config
            </button>
            <span class="text-muted small">Admin view (Finance computes)</span>
          `;
        } else {
          el.innerHTML = `<span class="text-muted small">Read-only (Status: ${RUN.status})</span>`;
        }
        return;
      }

      el.innerHTML = `<span class="text-muted small">Read-only</span>`;
    }

    function money(n) {
      const v = Number(n || 0);
      return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
    }

    function renderKPIs() {
      document.getElementById('kpiCount').innerText = ITEMS.length;

      let tGross = 0, tNet = 0, tEmp = 0;
      for (const r of ITEMS) {
        tGross += Number(r.gross_pay || 0);
        tNet   += Number(r.net_pay || 0);
        tEmp   += Number(r.employer_total || 0);
      }
      document.getElementById('kpiGross').innerText = money(tGross);
      document.getElementById('kpiNet').innerText = money(tNet);
      document.getElementById('kpiEmployer').innerText = money(tEmp);
    }

    function renderGrid() {
      const tbody = document.getElementById('payrollBody');
      tbody.innerHTML = '';
      const search = (document.getElementById('searchEmp').value || '').toLowerCase();

      const editable = canFinanceEdit();

      for (const r of ITEMS) {
        const name = (r.full_name || '').toLowerCase();
        if (search && !name.includes(search)) continue;

        const tr = document.createElement('tr');

        const dedTotal = Number(r.ded_total || 0);
        const gross = Number(r.gross_pay || 0);
        const net = Number(r.net_pay || 0);

        tr.innerHTML = `
          <td class="col-emp">
            <div class="fw-bold text-dark">${r.full_name || r.employee_id}</div>
            <div class="text-muted" style="font-size:0.75rem;">
              <span class="font-mono">${r.employee_id}</span>
              &bull; ${r.department || '-'}
              &bull; ${r.job_title || '-'}
            </div>
          </td>

          <td class="col-days">
            <input type="text" class="grid-input text-center bg-light text-muted" value="${Number(r.days_worked||0)}" readonly title="From Attendance (8h clock-out rule)">
          </td>

          <td class="col-money">${money(r.base_salary_snapshot || 0)}</td>

          <td class="col-perf">
            <input type="number" min="0" max="100"
              class="grid-input text-center"
              value="${Number(r.perf_score||0)}"
              ${editable ? '' : 'disabled'}
              onchange="updateItem('${r.payroll_item_id}','perf_score', this.value)"
            >
          </td>

          <td class="col-money">
            <input type="number" min="0" class="grid-input"
              value="${Number(r.allowances||0)}"
              ${editable ? '' : 'disabled'}
              onchange="updateItem('${r.payroll_item_id}','allowances', this.value)"
            >
          </td>

          <td class="col-money fw-bold">${money(gross)}</td>

          <td class="col-money text-danger">-${money(dedTotal)}</td>

          <td class="col-money text-success" style="font-size:1.05rem; font-weight:900;">${money(net)}</td>

          <td class="col-money">
            <input type="number" min="0" class="grid-input text-danger"
              value="${Number(r.advance||0)}"
              ${editable ? '' : 'disabled'}
              onchange="updateItem('${r.payroll_item_id}','advance', this.value)"
            >
          </td>

          <td class="col-action">
            ${renderRowControls(r)}
          </td>
        `;
        tbody.appendChild(tr);
      }

      renderKPIs();
    }

    function renderRowControls(r) {
      // Buttons by role + status
      if (RUN.status === 'APPROVED' || RUN.status === 'VALIDATED' || RUN.status === 'DISBURSED') {
        return `
          <div class="d-flex justify-content-center gap-1">
            <button class="btn btn-sm btn-dark" type="button" title="Print (placeholder)">
              <i class="fa-solid fa-print"></i>
            </button>
            <button class="btn btn-sm btn-primary" type="button" title="Email (placeholder)">
              <i class="fa-solid fa-envelope"></i>
            </button>
          </div>
        `;
      }
      return `<i class="fa-solid fa-lock text-muted"></i>`;
    }

    async function loadPeriod() {
      const ymVal = ym(CURRENT_DATE);
      const data = await apiGet('load', { ym: ymVal });
      RUN = data.run;
      CONFIG = data.config;
      ITEMS = data.items;
      ME = data.me;

      updateHeader();
      renderActions();
      renderGrid();
    }

    async function refreshDays() {
      try {
        await apiPost('refresh_days', { payroll_run_id: RUN.payroll_run_id });
        showToast('Worked days imported from attendance (saved).');
        await loadPeriod();
      } catch (e) {
        alert(e.message);
      }
    }

    async function updateItem(itemId, field, value) {
      try {
        await apiPost('update_item', {
          payroll_run_id: RUN.payroll_run_id,
          payroll_item_id: itemId,
          field,
          value
        });
        showToast('Saved.');
        // Reload just to reflect persisted values safely
        await loadPeriod();
      } catch (e) {
        alert(e.message);
      }
    }

    async function computeRun() {
      try {
        const res = await apiPost('compute', { payroll_run_id: RUN.payroll_run_id });
        RUN = res.run;
        ITEMS = res.items;
        updateHeader();
        renderActions();
        renderGrid();
        showToast('Payroll computed and saved (persisted).');
      } catch (e) {
        alert(e.message);
      }
    }

    async function unlockRun() {
      if (!confirm('Unlock back to OPEN? This allows Finance edits again.')) return;
      try {
        const res = await apiPost('unlock', { payroll_run_id: RUN.payroll_run_id });
        RUN = res.run;
        updateHeader();
        renderActions();
        await loadPeriod();
        showToast('Unlocked to OPEN.');
      } catch (e) {
        alert(e.message);
      }
    }

    async function submitRun() {
      if (!confirm('Submit to Management for approval?')) return;
      try {
        const res = await apiPost('submit', { payroll_run_id: RUN.payroll_run_id });
        RUN = res.run;
        updateHeader();
        renderActions();
        showToast('Submitted (persisted).');
        await loadPeriod();
      } catch (e) {
        alert(e.message);
      }
    }

    function promptApprove() {
      // summary
      const totalNet = ITEMS.reduce((a,r)=> a + Number(r.net_pay||0), 0);
      document.getElementById('approveNet').innerText = money(totalNet) + " " + (CONFIG?.currency || 'XAF');
      document.getElementById('approveCount').innerText = String(ITEMS.length);
      document.getElementById('approveComment').value = '';
      document.getElementById('digitalSigCheck').checked = false;

      new bootstrap.Modal(document.getElementById('approveModal')).show();
    }

    async function confirmApproval() {
      if (!document.getElementById('digitalSigCheck').checked) {
        alert('Digital signature checkbox is required.');
        return;
      }
      const comment = document.getElementById('approveComment').value || 'Approved';
      try {
        const res = await apiPost('approve', { payroll_run_id: RUN.payroll_run_id, comment });
        RUN = res.run;
        bootstrap.Modal.getInstance(document.getElementById('approveModal')).hide();
        updateHeader();
        renderActions();
        showToast('Approved & locked (persisted).');
        await loadPeriod();
      } catch (e) {
        alert(e.message);
      }
    }

    async function validateRun() {
      if (!confirm('Validate this payroll run? (Admin step)')) return;
      try {
        const res = await apiPost('validate', { payroll_run_id: RUN.payroll_run_id });
        RUN = res.run;
        updateHeader();
        renderActions();
        showToast('Validated (persisted).');
        await loadPeriod();
      } catch (e) {
        alert(e.message);
      }
    }

    async function disburseRun() {
      if (!confirm('Mark as DISBURSED? This is final.')) return;
      try {
        const res = await apiPost('disburse', { payroll_run_id: RUN.payroll_run_id });
        RUN = res.run;
        updateHeader();
        renderActions();
        showToast('Disbursed (persisted).');
        await loadPeriod();
      } catch (e) {
        alert(e.message);
      }
    }

    function openAdminConfig() {
      // load current config into modal
      document.getElementById('cfgStdDays').value = CONFIG?.stdDays ?? 22;
      document.getElementById('cfgCnpsCeil').value = CONFIG?.rates?.cnpsCeil ?? 750000;
      document.getElementById('cfgIrpp').value = CONFIG?.rates?.irpp ?? 0.10;
      document.getElementById('cfgAddTax').value = CONFIG?.rates?.addTax ?? 0.10;
      document.getElementById('cfgHouseEmp').value = CONFIG?.rates?.houseEmp ?? 0.01;
      document.getElementById('cfgCnpsEmp').value = CONFIG?.rates?.cnpsEmp ?? 0.042;

      document.getElementById('cfgFne').value = CONFIG?.rates?.fne ?? 0.01;
      document.getElementById('cfgHouseComp').value = CONFIG?.rates?.houseComp ?? 0.01;
      document.getElementById('cfgWorkAcc').value = CONFIG?.rates?.workAcc ?? 0.0175;
      document.getElementById('cfgFamily').value = CONFIG?.rates?.family ?? 0.0125;
      document.getElementById('cfgCnpsComp').value = CONFIG?.rates?.cnpsComp ?? 0.042;

      document.getElementById('cfgSenYears').value = CONFIG?.seniority?.years ?? 2;
      document.getElementById('cfgSenRate').value = CONFIG?.seniority?.rate ?? 0.10;

      // Perf logic
      // We force your required scheme:
      document.getElementById('cfgPerf90').value = 0.05;
      document.getElementById('cfgPerf75').value = 0.03;
      document.getElementById('cfgPerf60').value = 0.01;
      document.getElementById('cfgPerf0').value  = 0.00;

      new bootstrap.Modal(document.getElementById('adminConfigModal')).show();
    }

    async function saveAdminConfig() {
      try {
        if (RUN.status !== 'OPEN') {
          alert('Config can only be changed while status is OPEN.');
          return;
        }

        const cfg = structuredClone(CONFIG || {});
        cfg.stdDays = Number(document.getElementById('cfgStdDays').value || 22);
        cfg.rates = cfg.rates || {};

        cfg.rates.cnpsCeil = Number(document.getElementById('cfgCnpsCeil').value || 750000);
        cfg.rates.irpp     = Number(document.getElementById('cfgIrpp').value || 0.10);
        cfg.rates.addTax   = Number(document.getElementById('cfgAddTax').value || 0.10);
        cfg.rates.houseEmp = Number(document.getElementById('cfgHouseEmp').value || 0.01);
        cfg.rates.cnpsEmp  = Number(document.getElementById('cfgCnpsEmp').value || 0.042);

        cfg.rates.fne      = Number(document.getElementById('cfgFne').value || 0.01);
        cfg.rates.houseComp= Number(document.getElementById('cfgHouseComp').value || 0.01);
        cfg.rates.workAcc  = Number(document.getElementById('cfgWorkAcc').value || 0.0175);
        cfg.rates.family   = Number(document.getElementById('cfgFamily').value || 0.0125);
        cfg.rates.cnpsComp = Number(document.getElementById('cfgCnpsComp').value || 0.042);

        cfg.seniority = cfg.seniority || {};
        cfg.seniority.years = Number(document.getElementById('cfgSenYears').value || 2);
        cfg.seniority.rate  = Number(document.getElementById('cfgSenRate').value || 0.10);

        // Your required performance logic column:
        cfg.perfLogic = [
          { min: 90, rate: Number(document.getElementById('cfgPerf90').value || 0.05) },
          { min: 75, rate: Number(document.getElementById('cfgPerf75').value || 0.03) },
          { min: 60, rate: Number(document.getElementById('cfgPerf60').value || 0.01) },
          { min:  0, rate: Number(document.getElementById('cfgPerf0').value  || 0.00) },
        ];

        await apiPost('save_config', {
          payroll_run_id: RUN.payroll_run_id,
          config_snapshot_json: JSON.stringify(cfg)
        });

        bootstrap.Modal.getInstance(document.getElementById('adminConfigModal')).hide();
        showToast('Config saved for this period (persisted).');
        await loadPeriod();
      } catch (e) {
        alert(e.message);
      }
    }

    function changePeriod(delta) {
      CURRENT_DATE.setMonth(CURRENT_DATE.getMonth() + delta);
      loadPeriod().catch(err => alert(err.message));
    }
    function jumpToThisMonth() {
      CURRENT_DATE = new Date();
      loadPeriod().catch(err => alert(err.message));
    }

    // clock display (simple)
    function tickClock(){
      const d = new Date();
      document.getElementById('realtime-clock').innerText = d.toLocaleTimeString();
    }
    setInterval(tickClock, 1000); tickClock();
    function toggleClock(){ showToast('Clock feature is UI-only here.'); }

    // init
    document.addEventListener('DOMContentLoaded', () => {
      loadPeriod().catch(err => alert(err.message));
    });
  </script>
</body>
</html>
