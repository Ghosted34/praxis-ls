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

function default_config(): array {
  return [
    'stdDays' => 22,
    'currency' => 'XAF',
    'rates' => [
      // 'irpp' removed here, moved to tax_brackets below
      'addTax'    => 0.10, // CAC
      'houseEmp'  => 0.01, // Housing Emp
      'cnpsEmp'   => 0.042,
      'cnpsCeil'  => 750000,
      // employer
      'fne'       => 0.01,
      'houseComp' => 0.01,
      'family'    => 0.0125,
      'workAcc'   => 0.0175,
      'cnpsComp'  => 0.042
    ],
    // Progressive Tax Brackets (Cameroon Defaults - Editable by Admin)
    'tax_brackets' => [
      ['min' => 0,       'max' => 2000000,   'rate' => 0.10],
      ['min' => 2000001, 'max' => 3000000,   'rate' => 0.15],
      ['min' => 3000001, 'max' => 5000000,   'rate' => 0.25],
      ['min' => 5000001, 'max' => 999999999, 'rate' => 0.35],
      ['min' => 0, 'max' => 0, 'rate' => 0.0], // 5th slot empty by default
    ],
    'bases' => [
      'base'      => ['tax'=>true,'ins'=>true,'loan'=>true],
      'seniority' => ['tax'=>true,'ins'=>true,'loan'=>true],
      'perf'      => ['tax'=>true,'ins'=>true,'loan'=>true],
      'overtime'  => ['tax'=>true,'ins'=>true,'loan'=>true],
      'allowances'=> ['tax'=>true,'ins'=>false,'loan'=>false],
      'utilities' => ['tax'=>false,'ins'=>false,'loan'=>false],
    ],
    'seniority' => ['years'=>2,'rate'=>0.10],
    'perfLogic' => [
      ['min'=>90,'rate'=>0.05],
      ['min'=>75,'rate'=>0.03],
      ['min'=>60,'rate'=>0.01],
      ['min'=>0, 'rate'=>0.00],
    ],
    'utilities' => ['X'=>0.15,'V'=>0.10,'I'=>0.05,'DEFAULT'=>0.0],
  ];
}

/* ---------------------------------------------------------------------
   ACL helpers (Updated for Admin Superpower)
   --------------------------------------------------------------------- */
function require_role_strict(array $allowed, string $current): void {
  // Point 5: Admin can do everything Finance can do
  if ($current === 'ADMIN') return; 

  if (!in_array($current, $allowed, true)) {
    json_exit(['ok'=>false,'error'=>'Forbidden'], 403);
  }
}
function can_finance_edit(string $role, string $status): bool {
  // Allow FINANCE or ADMIN to edit while OPEN
  return in_array($role, ['FINANCE', 'ADMIN'], true) && $status === 'OPEN';
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

function get_master_config(mysqli $conn, string $targetDate): array {
  // Find the most recent config effective on or before the target date
  $sql = "SELECT config_json FROM payroll_config_history WHERE effective_date <= ? ORDER BY effective_date DESC LIMIT 1";
  $st = $conn->prepare($sql);
  $st->bind_param('s', $targetDate);
  $st->execute();
  $res = $st->get_result()->fetch_assoc();
  
  if ($res) {
    return json_decode($res['config_json'], true) ?? default_config();
  }
  return default_config(); // Fallback to code defaults if DB is empty
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
  $cfg = get_master_config($conn, $start);
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

function seed_items_robust(mysqli $conn, array $run, int $actorUserId): void {
  $runId   = (string)$run['payroll_run_id'];
  $start   = (string)$run['period_start'];
  $end     = (string)$run['period_end'];
  
  $cfg = load_config($run);
  $stdDays = (int)($cfg['stdDays'] ?? 22);

  // 1. Fetch ACTIVE employees who joined ON or BEFORE this period ends
  $sqlEmp = "
    SELECT
      em.employee_id,
      em.join_date,
      em.base_salary,
      ua.user_id
    FROM employee_master em
    LEFT JOIN user_auth ua ON ua.employee_id = em.employee_id
    WHERE em.status = 'ACTIVE'
      AND (em.join_date IS NULL OR em.join_date <= ?) 
    ORDER BY em.full_name ASC
  ";
  
  $stEmp = $conn->prepare($sqlEmp);
  $stEmp->bind_param('s', $end);
  $stEmp->execute();
  $res = $stEmp->get_result();

  // 2. INSERT OR UPDATE
  // - If New: Insert normally.
  // - If Exists: ONLY update the Salary Snapshot (fixes the "No Salary" bug).
  // - We do NOT update 'days_worked' on duplicate, to preserve your manual edits.
  $sqlIns = "
  INSERT INTO payroll_run_items
    (payroll_item_id, payroll_run_id, employee_id, user_id, source_type, days_worked,
     perf_score, allowances, advance,
     base_salary_snapshot, join_date_snapshot,
     is_locked, updated_by_user_id, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, 0, 0.00, 0.00, ?, ?, 0, ?, ?)
  ON DUPLICATE KEY UPDATE
     base_salary_snapshot = VALUES(base_salary_snapshot),
     join_date_snapshot   = VALUES(join_date_snapshot),
     user_id              = VALUES(user_id),
     updated_at           = VALUES(updated_at)
  ";

  $stIns = $conn->prepare($sqlIns);

  $conn->begin_transaction();
  try {
    while ($em = $res->fetch_assoc()) {
      $empId = (string)$em['employee_id'];
      $uidParam = ($em['user_id'] !== null) ? (int)$em['user_id'] : null;

      // Calculate Days (Only used for NEW inserts)
      if ($uidParam !== null) {
          $sourceType = 'DIGITAL';
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
      } else {
          $sourceType = 'MANUAL';
          $days = $stdDays;
      }

      $itemId = uuid_v4();
      $baseSalary = (float)($em['base_salary'] ?? 0);
      $joinDate   = (string)($em['join_date'] ?? '');
      $joinDateOrNull = ($joinDate !== '') ? $joinDate : null;
      $updatedAt = now_dt();

      $stIns->bind_param(
        'sssisidsis',
        $itemId, $runId, $empId, $uidParam, $sourceType, $days,
        $baseSalary, $joinDateOrNull, $actorUserId, $updatedAt
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

/**
 * Core Payroll Calculation Engine
 * * Performs a complete calculation of the payroll run based on the
 * Snapshot Configuration stored in the run object.
 * * LOGIC FLOW:
 * 1. Prorate Base Salary (based on days worked vs standard days).
 * 2. Add Bonuses (Seniority, Performance, Overtime, Allowances).
 * 3. Calculate Bases (Taxable Base, Insurable Base).
 * 4. Calculate Deductions (CNPS, CFC/Housing, Abated Tax Base, IRPP, CAC).
 * 5. Calculate Employer Contributions.
 * 6. Update Database Records.
 * * @param mysqli $conn Active database connection
 * @param array $run The payroll run row (must include 'config_snapshot_json')
 * @param int $actorUserId The ID of the user performing the compute
 */
function compute_run(mysqli $conn, array $run, int $actorUserId): void {
    $runId = (string)$run['payroll_run_id'];
    
    // 1. Load Configuration Snapshot
    // We use the snapshot saved in the run, NOT the live master config.
    // This ensures historical accuracy if we re-compute old months.
    $cfg = load_config($run);

    $stdDays = (int)($cfg['stdDays'] ?? 22);
    if ($stdDays <= 0) $stdDays = 22; // Safety fallback

    // 2. Load Rates & Brackets
    $rates = $cfg['rates'] ?? [];
    $brackets = $cfg['tax_brackets'] ?? [];
    
    // Employee Rates
    $addTaxRate  = (float)($rates['addTax'] ?? 0.10);   // CAC (usually 10% of IRPP)
    $houseEmpRate= (float)($rates['houseEmp'] ?? 0.01); // CFC/Housing (usually 1% of Gross)
    $cnpsEmpRate = (float)($rates['cnpsEmp'] ?? 0.042); // Pension (4.2%)
    $cnpsCeiling = (float)($rates['cnpsCeil'] ?? 750000); // Max base for pension

    // Employer Rates
    $fneRate      = (float)($rates['fne'] ?? 0.01);
    $houseCompRate= (float)($rates['houseComp'] ?? 0.01);
    $familyRate   = (float)($rates['family'] ?? 0.07);
    $workAccRate  = (float)($rates['workAcc'] ?? 0.0175);
    $cnpsCompRate = (float)($rates['cnpsComp'] ?? 0.07);

    // Bonus Logic
    $senYears = (int)($cfg['seniority']['years'] ?? 2);
    $senRate  = (float)($cfg['seniority']['rate'] ?? 0.00);
    $perfLogic = $cfg['perfLogic'] ?? [];

    // 3. Fetch Items
    // We fetch all items in this run to process them in a batch.
    $items = list_items($conn, $runId);

    // 4. Begin Transaction (Atomic Update)
    $conn->begin_transaction();
    try {
        // Pre-sort brackets by min salary to ensure correct progressive logic
        usort($brackets, function($a,$b){ return $a['min'] <=> $b['min']; });

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
        $stU = $conn->prepare($sqlU);

        foreach ($items as $row) {
            $itemId     = (string)$row['payroll_item_id'];
            $days       = (float)($row['days_worked'] ?? 0);
            $perfScore  = (int)($row['perf_score'] ?? 0);
            $allow      = (float)($row['allowances'] ?? 0);
            $advance    = (float)($row['advance'] ?? 0);
            $baseSalary = (float)($row['base_salary_snapshot'] ?? 0); // From Employee Master
            $joinDate   = (string)($row['join_date_snapshot'] ?? '');
            // STRICT ZERO CHECK: If 0 days, zero out the entire payslip.
            if ($days <= 0) {
                // 1. Zero out all money
                $basePay = 0.0; $overtimePay = 0.0; $senAmt = 0.0; $performanceBonus = 0.0;
                $taxBase = 0.0; $insBase = 0.0; $loanBase = 0.0;
                $dedIrpp = 0.0; $dedAdd = 0.0; $dedHouse = 0.0; $dedCnps = 0.0; $dedTotal = 0.0;
                $gross = 0.0; $net = 0.0; $employerTotal = 0.0;
                
                // 2. Save zeroed record immediately
                $updatedAt = now_dt();
                $stU->bind_param(
                    'dddddddddddddddisss',
                    $basePay, $overtimePay, $senAmt, $performanceBonus,
                    $taxBase, $insBase, $loanBase,
                    $dedIrpp, $dedAdd, $dedHouse, $dedCnps, $dedTotal,
                    $gross, $net, $employerTotal,
                    $actorUserId, $updatedAt,
                    $itemId, $runId
                );
                $stU->execute();
                
                // 3. Skip the rest of the loop for this person
                continue; 
            }

            // =================================================================
            // A. GROSS EARNINGS CALCULATION
            // =================================================================

            // A1. Prorated Base Pay
            // If they worked less than Std Days, they get paid less.
            // If they worked more, the extra is handled as Overtime.
            $paidDays = min($days, $stdDays);
            $basePay  = ($stdDays > 0) ? ($baseSalary * ($paidDays / $stdDays)) : $baseSalary;

            // A2. Overtime Pay
            $otDays = max(0, $days - $stdDays);
            $overtimePay = ($stdDays > 0) ? ($otDays * ($baseSalary / $stdDays)) : 0.0;

            // A3. Seniority Bonus
            $senAmt = 0.0;
            if ($joinDate !== '') {
                $jd = DateTime::createFromFormat('Y-m-d', $joinDate);
                if ($jd) {
                    // Calculate years of service
                    $years = ((new DateTime('now'))->getTimestamp() - $jd->getTimestamp()) / (365.25 * 24 * 3600);
                    // Calculate "steps" (e.g., every 2 years)
                    $steps = ($senYears > 0) ? (int)floor($years / $senYears) : 0;
                    $senAmt = max(0, $steps) * ($baseSalary * $senRate);
                }
            }

            // A4. Performance Bonus
            $perfBonusRate = 0.0;
            foreach ($perfLogic as $rule) {
                if ($perfScore >= (int)$rule['min']) { 
                    $perfBonusRate = (float)$rule['rate']; 
                    break; 
                }
            }
            $performanceBonus = $baseSalary * $perfBonusRate;

            $gross = $basePay + $overtimePay + $senAmt + $performanceBonus + $allow;

            // =================================================================
            // B. BASES AGGREGATION
            // =================================================================
            // Which parts of the salary are Taxable vs Insurable?
            // This is defined in the config (add_to_bases helper).
            $taxBase = 0.0; $insBase = 0.0; $loanBase = 0.0;
            
            add_to_bases($cfg, 'base',      $basePay,          $taxBase, $insBase, $loanBase);
            add_to_bases($cfg, 'overtime',  $overtimePay,      $taxBase, $insBase, $loanBase);
            add_to_bases($cfg, 'seniority', $senAmt,           $taxBase, $insBase, $loanBase);
            add_to_bases($cfg, 'perf',      $performanceBonus, $taxBase, $insBase, $loanBase);
            add_to_bases($cfg, 'allowances',$allow,            $taxBase, $insBase, $loanBase); // Config usually sets allowances as Taxable but NOT Insurable

            // =================================================================
            // C. DEDUCTIONS (The "Optimal Flow")
            // =================================================================

            // C1. CNPS (Pension)
            // Base is capped at the ceiling (e.g., 750,000)
            $cnpsCalcBase = ($cnpsCeiling > 0) ? min($insBase, $cnpsCeiling) : $insBase;
            $dedCnps = $cnpsCalcBase * $cnpsEmpRate;

            // C2. Housing (CFC - Crédit Foncier)
            // Standard: 1% of the Taxable Gross (Not affected by abatement)
            $dedHouse = $taxBase * $houseEmpRate;

            // C3. Calculate "Base Imposable" (Net Taxable Income) for IRPP
            // Formula: (Taxable Gross - CNPS) * (1 - 30% Abatement)
            $netTaxable = $taxBase;
            $netTaxable -= $dedCnps; // Pension is tax-deductible
            $netTaxable = $netTaxable * 0.70; // 30% Professional Abatement
            if ($netTaxable < 0) $netTaxable = 0;

            // C4. Progressive IRPP (Income Tax)
            $dedIrpp = 0.0;
            foreach ($brackets as $b) {
                $min = (float)$b['min'];
                $max = (float)$b['max']; 
                $rate = (float)$b['rate'];
                
                if ($max <= 0) $max = 999999999999; // Treat 0 as Infinity

                // If our income crosses into this bracket
                if ($netTaxable > $min) {
                    $taxableChunk = min($netTaxable, $max) - $min;
                    $dedIrpp += ($taxableChunk * $rate);
                }
            }

            // C5. CAC (Centimes Additionnels Communaux)
            // Standard: 10% of the IRPP Amount
            $dedAdd = $dedIrpp * $addTaxRate;

            // C6. Total Deductions
            $dedTotal = $dedIrpp + $dedAdd + $dedHouse + $dedCnps + $advance;
            $net = $gross - $dedTotal;

            // =================================================================
            // D. EMPLOYER CONTRIBUTIONS (Hidden Costs)
            // =================================================================
            $emFne   = $taxBase * $fneRate;
            $emHouse = $taxBase * $houseCompRate;
            $emWork  = $insBase * $workAccRate;
            $emFam   = $insBase * $familyRate;
            $emCnps  = $insBase * $cnpsCompRate;
            
            $employerTotal = $emFne + $emHouse + $emWork + $emFam + $emCnps;

            // =================================================================
            // E. SAVE RECORD
            // =================================================================
            $updatedAt = now_dt();
            $stU->bind_param(
                'dddddddddddddddisss',
                $basePay, $overtimePay, $senAmt, $performanceBonus,
                $taxBase, $insBase, $loanBase,
                $dedIrpp, $dedAdd, $dedHouse, $dedCnps, $dedTotal,
                $gross, $net, $employerTotal,
                $actorUserId, $updatedAt,
                $itemId, $runId
            );
            $stU->execute();
        }

        // 5. Update Run Status to COMPUTED
        // We only update status if it is currently OPEN.
        $sqlR = "UPDATE payroll_runs SET status='COMPUTED', computed_by_user_id=?, computed_at=? WHERE payroll_run_id=? AND status='OPEN'";
        $computedAt = now_dt();
        $stR = $conn->prepare($sqlR);
        $stR->bind_param('iss', $actorUserId, $computedAt, $runId);
        $stR->execute();

        // 6. Audit Log
        audit($conn, $runId, null, $actorUserId, 'COMPUTE', 'Computed payroll (Abated Tax Model)', null, ['status'=>'COMPUTED']);

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

      // Point 6: Race Condition Protection (Try/Catch)
      try {
          $run = ensure_run($conn, $ym, $userId);
      } catch (mysqli_sql_exception $e) {
          // If duplicate entry race condition, just fetch it
          $run = get_run_by_ym($conn, $ym);
          if (!$run) throw $e; 
      }

      // Old Code:
      // $items = list_items($conn, (string)$run['payroll_run_id']);
      // if (count($items) === 0) {
      //   seed_items_robust($conn, $run, $userId);
      //   ...
      // }

      // New Code (Runs every time):
      // 1. Always run the seeder to catch new employees or salary updates
      seed_items_robust($conn, $run, $userId);
      
      // 2. Then list the items
      $items = list_items($conn, (string)$run['payroll_run_id']);

      // Point 4: SQL-based Totals for accurate KPIs
      $sqlT = "SELECT 
                COUNT(*) as count, 
                SUM(gross_pay) as gross, 
                SUM(net_pay) as net, 
                SUM(employer_total) as employer 
               FROM payroll_run_items WHERE payroll_run_id = ?";
      $stT = $conn->prepare($sqlT);
      $stT->bind_param('s', $run['payroll_run_id']);
      $stT->execute();
      $totals = $stT->get_result()->fetch_assoc();

      json_exit([
        'ok'=>true,
        'run'=>$run,
        'config'=>load_config($run),
        'items'=>$items,
        'totals'=>$totals, // Sending strictly calculated totals
        'me'=>[
          'user_id'=>$userId,
          'employee_id'=>$employeeId,
          'full_name'=>$fullName,
          'role'=>$role
        ]
      ]);
    }

    if ($action === 'refresh_days') {
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
          // PROTECTION: Skip rows that have a manual adjustment reason
          if (!empty($it['days_adjustment_reason'])) continue;

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

          // We only update if no manual reason exists (enforced by the 'continue' above and this WHERE clause)
          $sqlU = "UPDATE payroll_run_items 
                   SET days_worked=?, updated_by_user_id=?, updated_at=? 
                   WHERE payroll_item_id=? AND payroll_run_id=? 
                   AND (days_adjustment_reason IS NULL OR days_adjustment_reason = '')";
          
          $ts = now_dt();
          $stU = $conn->prepare($sqlU);
          $stU->bind_param('iisss', $days, $userId, $ts, $itemId, $runId);
          $stU->execute();
        }

        audit($conn, $runId, null, $userId, 'IMPORT_DAYS', 'Refreshed days from logs (Protected manual overrides)', null, ['done'=>true]);
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
      $reason = trim((string)($_POST['reason'] ?? '')); // NEW: Capture reason

      $run = get_run_by_id($conn, $runId);
      if (!$run || (string)$run['status'] !== 'OPEN') json_exit(['ok'=>false,'error'=>'Run not found or not OPEN'], 403);

      $allowed = ['perf_score', 'allowances', 'advance', 'days_worked'];
      if (!in_array($field, $allowed, true)) json_exit(['ok'=>false,'error'=>'Invalid field'], 400);

      // 1. Get Before State
      $stB = $conn->prepare("SELECT days_worked, perf_score, allowances, advance FROM payroll_run_items WHERE payroll_item_id=? LIMIT 1");
      $stB->bind_param('s', $itemId); $stB->execute();
      $before = $stB->get_result()->fetch_assoc();

      // 2. Prepare Update
      $v = ($field === 'perf_score') ? (int)$value : (float)$value;
      $v = max(0, $v);
      if ($field === 'perf_score' && $v > 100) $v = 100;

      // 3. Update Database (including reason if field is days_worked)
      $ts = now_dt();
      if ($field === 'days_worked') {
          $sql = "UPDATE payroll_run_items SET days_worked=?, days_adjustment_reason=?, updated_by_user_id=?, updated_at=? WHERE payroll_item_id=? AND is_locked=0";
          $st = $conn->prepare($sql);
          $st->bind_param('dsiss', $v, $reason, $userId, $ts, $itemId);
      } else {
          $sql = "UPDATE payroll_run_items SET {$field}=?, updated_by_user_id=?, updated_at=? WHERE payroll_item_id=? AND is_locked=0";
          $st = $conn->prepare($sql);
          $st->bind_param('diss', $v, $userId, $ts, $itemId);
      }
      $st->execute();

      // 4. Audit Log
      $after = $before; $after[$field] = $v;
      $auditNote = ($field === 'days_worked') ? "Manual Adjustment: $reason" : "Updated $field";
      audit($conn, $runId, $itemId, $userId, 'EDIT_ITEM', $auditNote, $before, $after);

      json_exit(['ok'=>true]);
    }

    if ($action === 'save_config') {
      $runId = (string)($_POST['payroll_run_id'] ?? '');
      $cfgJson = (string)($_POST['config_snapshot_json'] ?? '');

      $run = get_run_by_id($conn, $runId);
      if (!$run) json_exit(['ok'=>false,'error'=>'Run not found'], 404);

      if (!in_array($role, ['ADMIN','FINANCE'], true)) json_exit(['ok'=>false,'error'=>'Forbidden'], 403);
      if ((string)$run['status'] !== 'OPEN') json_exit(['ok'=>false,'error'=>'Config can only be updated in OPEN state'], 409);

      $cfg = json_decode($cfgJson, true);
      if (!is_array($cfg)) json_exit(['ok'=>false,'error'=>'Invalid config JSON'], 400);

      $conn->begin_transaction();
      try {
          // 1. Update THIS Run
          $before = ['config_snapshot_json'=>(string)$run['config_snapshot_json']];
          $sqlSelf = "UPDATE payroll_runs SET config_snapshot_json=? WHERE payroll_run_id=?";
          $stS = $conn->prepare($sqlSelf);
          $stS->bind_param('ss', $cfgJson, $runId);
          $stS->execute();

          // 2. Save to History (Time-Traveler)
          // Effective date = This period's start date
          $effDate = $run['period_start'];
          $sqlHist = "INSERT INTO payroll_config_history (effective_date, config_json, created_by, created_at) VALUES (?, ?, ?, ?)";
          $ts = now_dt();
          $stH = $conn->prepare($sqlHist);
          $stH->bind_param('ssis', $effDate, $cfgJson, $userId, $ts);
          $stH->execute();

          // 3. Auto-Propagate to FUTURE OPEN runs (Your Request #4)
          // Logic: Update any run that starts ON or AFTER this effective date AND is OPEN
          $sqlFuture = "UPDATE payroll_runs SET config_snapshot_json=? WHERE status='OPEN' AND period_start >= ? AND payroll_run_id != ?";
          $stF = $conn->prepare($sqlFuture);
          $stF->bind_param('sss', $cfgJson, $effDate, $runId);
          $stF->execute();
          $affected = $stF->affected_rows;

          audit($conn, $runId, null, $userId, 'CONFIG_UPDATE', "Updated config + $affected future runs", $before, ['config_snapshot_json'=>$cfgJson]);
          
          $conn->commit();
          json_exit(['ok'=>true, 'propagated'=>$affected]);
      } catch (Throwable $t) {
          $conn->rollback();
          throw $t;
      }
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
    .col-days { 
    width: 100px;       /* The "suggested" width */
    min-width: 100px;   /* The FORCE field: Browser cannot squash it smaller than this */
    text-align: center; 
}
    .col-days .position-relative {
        display: inline-block;
        width: 100%;
    }
    
    .col-money{ text-align:right; font-family:var(--font-mono); font-weight:700; width:160px; }
    /* 1. Set Exact Widths (using min-width to force browser compliance) */
.col-perf { 
    width: 100px; 
    min-width: 100px; 
    text-align: center; 
}
/* Make the placeholder text small and grey */
.grid-input::placeholder {
    font-size: 0.5rem;
    font-weight: 400;
    color: #94a3b8; /* Light slate grey */
    letter-spacing: -0.3px;
}

.col-money { 
    width: 120px; 
    min-width: 120px; 
    text-align: right; 
    font-family: var(--font-mono); 
    font-weight: 700; 
}

/* 2. REMOVE THE ARROWS/SPINNERS (The "Guide") */
/* Chrome, Safari, Edge, Opera */
input[type=number]::-webkit-outer-spin-button,
input[type=number]::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

/* Firefox */
input[type=number] {
  -moz-appearance: textfield;
}

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
        <a href="index.php" class="brand-logo"><i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span></a>
    </div>

    <div class="px-3 mb-2 mt-2">
        <a href="index.php" class="btn btn-primary w-100 text-start d-flex align-items-center" style="background-color: transparent; color: inherit; border: none; padding-left: 0;">
            <i class="fa-solid fa-house category-icon me-2"></i> 
            <span class="fw-bold">Admin Dashboard GM</span> 
        </a>
    </div>

    <div class="sidebar-menu accordion" id="adminMenu">
        
        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#admin1">
                <span><i class="fa-solid fa-database category-icon"></i> MASTER DATA</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="admin1" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
                <div class="sub-menu">
                    <a href="client-master-registry.php" class="sub-link">Client Master Registry</a>
                    <a href="supplier-master-registry.php" class="sub-link">Supplier Master Registry</a>
                    <a href="employee-master.php" class="sub-link">Employee Master Registry</a>
                    <a href="financial-dictionary.php" class="sub-link">Financial Dictionary</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#admin2">
                <span><i class="fa-solid fa-users category-icon"></i> CRM & ACQUISITION</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="admin2" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
                <div class="sub-menu">
                    <a href="smart-quote-leads.php" class="sub-link">Leads & Proposal Generator</a>
                    <a href="smart-quote-intake.php" class="sub-link">Smart Quote Intake</a>
                    <a href="sales-pipelining.php" class="sub-link">Sales Pipeline</a>
                    <a href="market-campaign-registration.php" class="sub-link">Marketing Campaign Register</a>
                    <a href="contact-us-intake.php" class="sub-link">Contact Us Intake</a>
                    <a href="partnership-portal-intake.php" class="sub-link">Partnership Portal Intake</a>
                    </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#admin3">
                <span><i class="fa-solid fa-calculator category-icon"></i> COMMERCIAL & PRICING</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="admin3" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
                <div class="sub-menu">
                    <a href="margin-simulator-billing.php" class="sub-link">Margin Simulator & Pricing System</a>
                    <a href="extra-charges-simulator.php" class="sub-link">Extra Charges Simulator</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#admin4">
                <span><i class="fa-solid fa-truck-fast category-icon"></i> LOGISTICS OPERATIONS</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="admin4" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
                <div class="sub-menu">
                    <a href="operations-registry.php" class="sub-link">Operations File Registry</a>
                    <a href="transit-order.php" class="sub-link">Transit Order (OT)</a>
                    <a href="operational-milestone-tracking.php" class="sub-link">Operational Milestone Tracking</a>
                    <a href="delivery-note.php" class="sub-link">Delivery Note</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#admin5">
                <span><i class="fa-solid fa-money-bill-trend-up category-icon"></i> OPS COST CONTROL</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="admin5" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
                <div class="sub-menu">
                    <a href="costing-module.php" class="sub-link">Costing Module</a>
                    <a href="cost-tracking.php" class="sub-link">Cost Tracking Master</a>
                    <a href="operational-cost-reconciliation.php" class="sub-link">Operational Cost Reconciliation</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#admin6">
                <span><i class="fa-solid fa-building-columns category-icon"></i> FINANCE & TREASURY</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="admin6" class="accordion-collapse collapse" data-bs-parent="#adminMenu">
                <div class="sub-menu">
                    <a href="cash-request.php" class="sub-link">Cash Request</a>
                    <a href="purchase-order.php" class="sub-link">Purchase Order</a>
                    <a href="proforma-invoice-portal.php" class="sub-link">Proforma Invoice Portal</a>
                    <a href="final-invoice.php" class="sub-link">Final Invoice System</a>
                    <a href="smart-receivables-ledger.php" class="sub-link">Smart Receivables Ledger (SRL)</a>
                    <a href="debt-management.php" class="sub-link">Debt Management</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#admin7">
                <span><i class="fa-solid fa-folder-open category-icon"></i> HR & ARCHIVE</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="admin7" class="accordion-collapse collapse show" data-bs-parent="#adminMenu">
                <div class="sub-menu">
                    <a href="user-role-management.php" class="sub-link">User & Role Management (IAM)</a>
                    <a href="payroll-management.php" class="sub-link active">Payroll Management</a>
                    <a href="attendance-logs.php" class="sub-link">Attendance & Time Logging</a>
                    <a href="documents-vault.php" class="sub-link">Documents Vault</a>
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
      <h5 class="mb-0 fw-bold text-dark">Payroll Management</h5>
      <small class="text-muted" style="font-size: 0.7rem;">Financial Controls & Compensation</small>
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
          <button class="btn btn-success fw-bold text-white" type="button" onclick="exportReport()">
    <i class="fa-solid fa-file-csv me-2"></i>Export Register
</button>
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
            <i class="fa-solid fa-circle-info me-2"></i>Updates are saved to the snapshot. Click <strong>Compute</strong> to apply changes.
          </div>

          <div class="row g-3 mb-4">
            <div class="col-4">
              <label class="small fw-bold">Standard Days</label>
              <input type="number" class="form-control form-control-sm" id="cfgStdDays">
            </div>
            <div class="col-4">
              <label class="small fw-bold">CNPS Ceiling</label>
              <input type="number" class="form-control form-control-sm" id="cfgCnpsCeil">
            </div>
            <div class="col-4">
               <label class="small fw-bold">Add. Tax (CAC)</label>
               <input type="number" step="0.001" class="form-control form-control-sm" id="cfgAddTax">
            </div>
          </div>

          <div class="card mb-4 border-0 shadow-sm">
             <div class="card-header bg-dark text-white py-2 d-flex justify-content-between align-items-center">
                <small class="fw-bold text-uppercase">Progressive Tax Brackets (IRPP)</small>
                <button class="btn btn-sm btn-light py-0" style="font-size:0.7rem; font-weight:bold;" onclick="addBracketRow()">
                    <i class="fa-solid fa-plus me-1"></i> Add Slice
                </button>
             </div>
             <div class="card-body p-0">
                <table class="table table-sm table-striped mb-0" style="font-size:0.85rem;">
                   <thead class="bg-light">
                      <tr>
                         <th style="width:50px">#</th>
                         <th>Min Salary</th>
                         <th>Max Salary</th>
                         <th style="width:100px">Rate %</th> <th style="width:40px"></th>
                      </tr>
                   </thead>
                   <tbody id="bracketTableBody"></tbody>
                </table>
             </div>
             <div class="card-footer bg-white small text-muted">
                Leave "Max" as 0 or empty to indicate "Infinity". Rate 0.15 = 15%.
             </div>
          </div>

          <h6 class="fw-bold small border-bottom pb-2 mb-3">Deductions & Contributions</h6>
          <div class="row g-3">
             <div class="col-3"><label class="small fw-bold">House (Emp)</label><input type="number" step="0.001" class="form-control form-control-sm" id="cfgHouseEmp"></div>
             <div class="col-3"><label class="small fw-bold">CNPS (Emp)</label><input type="number" step="0.001" class="form-control form-control-sm" id="cfgCnpsEmp"></div>
             <div class="col-3"><label class="small fw-bold">Seniority Rate</label><input type="number" step="0.001" class="form-control form-control-sm" id="cfgSenRate"></div>
             <div class="col-3"><label class="small fw-bold">Seniority Yrs</label><input type="number" class="form-control form-control-sm" id="cfgSenYears"></div>
             
             <div class="col-3"><label class="small fw-bold">FNE (Comp)</label><input type="number" step="0.001" class="form-control form-control-sm" id="cfgFne"></div>
             <div class="col-3"><label class="small fw-bold">House (Comp)</label><input type="number" step="0.001" class="form-control form-control-sm" id="cfgHouseComp"></div>
             <div class="col-3"><label class="small fw-bold">Work Acc</label><input type="number" step="0.001" class="form-control form-control-sm" id="cfgWorkAcc"></div>
             <div class="col-3"><label class="small fw-bold">Family</label><input type="number" step="0.001" class="form-control form-control-sm" id="cfgFamily"></div>
             <div class="col-3"><label class="small fw-bold">CNPS (Comp)</label><input type="number" step="0.001" class="form-control form-control-sm" id="cfgCnpsComp"></div>
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
      // Allow if role is FINANCE or ADMIN, and status is OPEN
      return (['FINANCE', 'ADMIN'].includes(ME.role) && RUN?.status === 'OPEN');
    }

    function renderActions() {
      const el = document.getElementById('actionButtons');
      el.innerHTML = '';

      if (!RUN) return;

      // DEFINITIONS OF BUTTON GROUPS
      const btnFinanceOpen = `
        <button class="btn btn-white border fw-bold" type="button" onclick="refreshDays()">
          <i class="fa-solid fa-cloud-arrow-down me-2 text-primary"></i>Import Days
        </button>
        <button class="btn btn-white border fw-bold" type="button" onclick="openAdminConfig()">
          <i class="fa-solid fa-sliders me-2"></i>Config
        </button>
        <button class="btn btn-primary fw-bold" type="button" onclick="computeRun()">
          <i class="fa-solid fa-calculator me-2"></i>Compute
        </button>`;

      const btnFinanceComputed = `
        <button class="btn btn-light border fw-bold" type="button" onclick="unlockRun()">
          <i class="fa-solid fa-lock-open me-2"></i>Unlock
        </button>
        <button class="btn btn-success fw-bold" type="button" onclick="submitRun()">
          <i class="fa-solid fa-paper-plane me-2"></i>Submit
        </button>`;

      const btnManagement = `
        <button class="btn btn-success fw-bold" type="button" onclick="promptApprove()">
          <i class="fa-solid fa-file-signature me-2"></i>Approve & Lock
        </button>`;
      
      const btnAdminValidate = `
        <button class="btn btn-primary fw-bold" type="button" onclick="validateRun()">
          <i class="fa-solid fa-shield-check me-2"></i>Validate
        </button>`;

      const btnAdminDisburse = `
        <button class="btn btn-warning text-dark fw-bold" type="button" onclick="disburseRun()">
          <i class="fa-solid fa-money-bill-wave me-2"></i>Disburse
        </button>`;

      // LOGIC: GRANT ACCESS BASED ON ROLE
      let html = '';

      // 1. ADMIN (SUPER USER - SEES EVERYTHING)
      if (ME.role === 'ADMIN') {
          if (RUN.status === 'OPEN')           html = btnFinanceOpen;
          else if (RUN.status === 'COMPUTED')  html = btnFinanceComputed;
          else if (RUN.status === 'SUBMITTED') html = btnManagement; // Admin acting as Management
          else if (RUN.status === 'APPROVED')  html = btnAdminValidate;
          else if (RUN.status === 'VALIDATED') html = btnAdminDisburse;
          else html = `<span class="text-muted small">Run Completed (${RUN.status})</span>`;
      }
      
      // 2. FINANCE (Restricted to Open/Computed)
      else if (ME.role === 'FINANCE') {
          if (RUN.status === 'OPEN')           html = btnFinanceOpen;
          else if (RUN.status === 'COMPUTED')  html = btnFinanceComputed;
          else html = `<span class="text-muted small">Read-only (Status: ${RUN.status})</span>`;
      }
      
      // 3. MANAGEMENT (Restricted to Submitted)
      else if (ME.role === 'MANAGEMENT') {
          if (RUN.status === 'SUBMITTED') html = btnManagement;
          else html = `<span class="text-muted small">Read-only (Status: ${RUN.status})</span>`;
      }

      el.innerHTML = html;
    }

    function money(n) {
      const v = Number(n || 0);
      return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
    }

    function renderKPIs() {
      // Use the SQL-calculated totals stored in the global TOTALS variable
      // Default to 0 if null
      document.getElementById('kpiCount').innerText = TOTALS.count || ITEMS.length;
      
      document.getElementById('kpiGross').innerText = money(TOTALS.gross);
      document.getElementById('kpiNet').innerText = money(TOTALS.net);
      document.getElementById('kpiEmployer').innerText = money(TOTALS.employer);
    }

    function renderGrid() {
      const tbody = document.getElementById('payrollBody');
      tbody.innerHTML = '';
      const search = (document.getElementById('searchEmp').value || '').toLowerCase();
      const userCanEdit = canFinanceEdit();

      for (const r of ITEMS) {
        if (search && !(r.full_name||'').toLowerCase().includes(search)) continue;

        const tr = document.createElement('tr');
        
        // 1. Manual Check
        const isManual = (r.source_type === 'MANUAL');
        const badgeHtml = isManual 
            ? `<span class="badge bg-warning text-dark ms-2" style="font-size:0.65rem;">MANUAL</span>` 
            : `<span class="badge bg-light text-muted ms-2 border" style="font-size:0.65rem;">DIGITAL</span>`;

        // 2. Days Editable Logic (Only if Manual AND User has permission)
        const daysEditable = isManual && userCanEdit;
        const daysClass = daysEditable ? 'bg-white fw-bold text-dark' : 'bg-light text-muted';

        // 3. Totals
        const dedTotal = Number(r.ded_total || 0);
        const gross = Number(r.gross_pay || 0);
        const net = Number(r.net_pay || 0);

        tr.innerHTML = `
          <td class="col-emp">
            <div class="lh-1">
                <div class="fw-bold text-dark mb-1">${r.full_name}</div>
                <div class="d-flex align-items-center">
                    <span class="small text-muted font-mono">${r.employee_id}</span>
                    ${badgeHtml}
                </div>
            </div>
          </td>

          <td class="col-days">
            <div class="position-relative">
              <input type="number" step="0.5" class="grid-input text-center ${daysClass}" 
                value="${Number(r.days_worked||0)}" 
                ${userCanEdit ? '' : 'readonly'}
                onchange="updateItem('${r.payroll_item_id}','days_worked', this.value)"
              >
              ${r.days_adjustment_reason ? `
                <i class="fa-solid fa-circle-info text-primary position-absolute" 
                   style="top: -5px; right: -5px; cursor: help; font-size: 0.8rem;" 
                   title="Adjustment Reason: ${r.days_adjustment_reason}"></i>
              ` : ''}
            </div>
          </td>

          <td class="col-money">${money(r.base_salary_snapshot || 0)}</td>

          <td class="col-perf">
            <input type="number" min="0" max="100" class="grid-input text-center"
              value="${Number(r.perf_score) === 0 ? '' : Number(r.perf_score)}" 
              placeholder="Rate (%)"
              ${userCanEdit ? '' : 'disabled'}
              onchange="updateItem('${r.payroll_item_id}','perf_score', this.value)"
            >
          </td>

          <td class="col-money">
            <input type="number" min="0" class="grid-input"
              value="${Number(r.allowances) === 0 ? '' : Number(r.allowances)}" 
              placeholder="Trans, Hous, Feed Amt"
              ${userCanEdit ? '' : 'disabled'}
              onchange="updateItem('${r.payroll_item_id}','allowances', this.value)"
            >
          </td>

          <td class="col-money fw-bold">${money(gross)}</td>
          <td class="col-money text-danger">-${money(dedTotal)}</td>
          <td class="col-money text-success" style="font-size:1.05rem; font-weight:900;">${money(net)}</td>

          <td class="col-money">
            <input type="number" min="0" class="grid-input text-danger"
              value="${Number(r.advance) === 0 ? '' : Number(r.advance)}"
              placeholder="Salary Adv. & Discipline"
              ${userCanEdit ? '' : 'disabled'}
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
      // Allow printing if computed, approved, or validated
      if (['COMPUTED','SUBMITTED','APPROVED','VALIDATED','DISBURSED'].includes(RUN.status)) {
        return `
          <div class="d-flex justify-content-center gap-1">
            <button class="btn btn-sm btn-dark" type="button" onclick="printPayslip('${r.payroll_item_id}')" title="Print Payslip">
              <i class="fa-solid fa-print"></i>
            </button>
          </div>
        `;
      }
      return `<i class="fa-solid fa-lock text-muted"></i>`;
    }

    // New Function to open the print window
    function printPayslip(itemId) {
        const url = `print-payslip.php?run_id=${RUN.payroll_run_id}&item_id=${itemId}`;
        window.open(url, '_blank', 'width=900,height=1000');
    }
    
    let TOTALS = {};
    
    async function loadPeriod() {
      const ymVal = ym(CURRENT_DATE);
      const data = await apiGet('load', { ym: ymVal });
      RUN = data.run;
      CONFIG = data.config;
      ITEMS = data.items;
      TOTALS = data.totals || { gross:0, net:0, employer:0, count:0 }; // Store server totals
      ME = data.me;

      updateHeader();
      renderActions();
      renderGrid(); // Grid still renders items
      renderKPIs(); // KPIs now use TOTALS
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

    let PENDING_ADJ = null;

    async function updateItem(itemId, field, value) {
      // If editing days, trigger modal first
      if (field === 'days_worked') {
        PENDING_ADJ = { itemId, field, value };
        const modal = new bootstrap.Modal(document.getElementById('adjustmentModal'));
        document.getElementById('adjReason').value = '';
        document.getElementById('confirmAdjBtn').disabled = true;
        
        // Simple validation: enable button only if reason > 5 chars
        document.getElementById('adjReason').onkeyup = (e) => {
           document.getElementById('confirmAdjBtn').disabled = e.target.value.trim().length < 5;
        };
        modal.show();
        return;
      }

      // Normal save for other fields
      try {
        await apiPost('update_item', { payroll_run_id: RUN.payroll_run_id, payroll_item_id: itemId, field, value });
        showToast('Saved.');
        await loadPeriod();
      } catch (e) { alert(e.message); }
    }

    async function submitDaysAdjustment() {
      if (!PENDING_ADJ) return;
      const reason = document.getElementById('adjReason').value;
      try {
        await apiPost('update_item', { 
            payroll_run_id: RUN.payroll_run_id, 
            payroll_item_id: PENDING_ADJ.itemId, 
            field: PENDING_ADJ.field, 
            value: PENDING_ADJ.value,
            reason: reason 
        });
        bootstrap.Modal.getInstance(document.getElementById('adjustmentModal')).hide();
        showToast('Adjustment Logged.');
        await loadPeriod();
        await computeRun(); // Auto-recompute pay based on new days
      } catch (e) { alert(e.message); }
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
      // 1. Load Standards
      document.getElementById('cfgStdDays').value = CONFIG?.stdDays ?? 22;
      document.getElementById('cfgCnpsCeil').value = CONFIG?.rates?.cnpsCeil ?? 750000;
      document.getElementById('cfgAddTax').value = CONFIG?.rates?.addTax ?? 0.10;
      
      // Load other rates...
      document.getElementById('cfgHouseEmp').value = CONFIG?.rates?.houseEmp ?? 0.01;
      document.getElementById('cfgCnpsEmp').value = CONFIG?.rates?.cnpsEmp ?? 0.042;
      document.getElementById('cfgSenRate').value = CONFIG?.seniority?.rate ?? 0.10;
      document.getElementById('cfgSenYears').value = CONFIG?.seniority?.years ?? 2;
      
      document.getElementById('cfgFne').value = CONFIG?.rates?.fne ?? 0.01;
      document.getElementById('cfgHouseComp').value = CONFIG?.rates?.houseComp ?? 0.01;
      document.getElementById('cfgWorkAcc').value = CONFIG?.rates?.workAcc ?? 0.0175;
      document.getElementById('cfgFamily').value = CONFIG?.rates?.family ?? 0.0125;
      document.getElementById('cfgCnpsComp').value = CONFIG?.rates?.cnpsComp ?? 0.042;

      // 2. Load Brackets Dynamically
      const tbody = document.getElementById('bracketTableBody');
      tbody.innerHTML = '';
      const brackets = CONFIG?.tax_brackets || [];
      
      if(brackets.length === 0) {
          // Default start if empty
          addBracketRow(0, 2000000, 0.10);
      } else {
          brackets.forEach(b => addBracketRow(b.min, b.max, b.rate));
      }

      new bootstrap.Modal(document.getElementById('adminConfigModal')).show();
    }
    
    function addBracketRow(min='', max='', rate='') {
        const tbody = document.getElementById('bracketTableBody');
        const idx = tbody.children.length + 1;
        const tr = document.createElement('tr');
        tr.innerHTML = `
           <td class="text-center text-muted">${idx}</td>
           <td><input type="number" class="form-control form-control-sm br-min" value="${min}"></td>
           <td><input type="number" class="form-control form-control-sm br-max" value="${max}" placeholder="∞"></td>
           <td><input type="number" step="0.001" class="form-control form-control-sm br-rate" value="${rate}"></td>
           <td>
                <button class="btn btn-xs text-danger" onclick="this.closest('tr').remove()">
                    <i class="fa-solid fa-times"></i>
                </button>
           </td>
        `;
        tbody.appendChild(tr);
    }

    async function saveAdminConfig() {
       try {
        if (RUN.status !== 'OPEN') return alert('Status must be OPEN');

        // Harvest Brackets
        const rows = document.querySelectorAll('#bracketTableBody tr');
        let newBrackets = [];
        rows.forEach(row => {
            const min = Number(row.querySelector('.br-min').value || 0);
            const max = Number(row.querySelector('.br-max').value || 0);
            const rate = Number(row.querySelector('.br-rate').value || 0);
            // Allow 0 rate, but ensure rows aren't empty garbage
            newBrackets.push({ min, max, rate });
        });

        const cfg = structuredClone(CONFIG || {});
        cfg.stdDays = Number(document.getElementById('cfgStdDays').value);
        cfg.tax_brackets = newBrackets; // Save array
        
        cfg.rates = cfg.rates || {};
        cfg.rates.cnpsCeil = Number(document.getElementById('cfgCnpsCeil').value);
        cfg.rates.addTax = Number(document.getElementById('cfgAddTax').value);
        
        // Save other rates
        cfg.rates.houseEmp = Number(document.getElementById('cfgHouseEmp').value);
        cfg.rates.cnpsEmp = Number(document.getElementById('cfgCnpsEmp').value);
        
        cfg.seniority = cfg.seniority || {};
        cfg.seniority.rate = Number(document.getElementById('cfgSenRate').value);
        cfg.seniority.years = Number(document.getElementById('cfgSenYears').value);
        
        cfg.rates.fne = Number(document.getElementById('cfgFne').value);
        cfg.rates.houseComp = Number(document.getElementById('cfgHouseComp').value);
        cfg.rates.workAcc = Number(document.getElementById('cfgWorkAcc').value);
        cfg.rates.family = Number(document.getElementById('cfgFamily').value);
        cfg.rates.cnpsComp = Number(document.getElementById('cfgCnpsComp').value);

        // 1. Save Config
        await apiPost('save_config', {
          payroll_run_id: RUN.payroll_run_id,
          config_snapshot_json: JSON.stringify(cfg)
        });

        showToast('Config saved. Re-computing...');
        
        // 2. FORCE COMPUTE IMMEDIATELY
        await computeRun(); 

        bootstrap.Modal.getInstance(document.getElementById('adminConfigModal')).hide();
       } catch(e) { alert(e.message); }
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
    function exportReport() {
    if (!RUN || !RUN.payroll_run_id) {
        alert("No active payroll period loaded.");
        return;
    }
    // Triggers the browser download directly
    window.location.href = `../../api/payroll/export.php?run_id=${RUN.payroll_run_id}`;
}
  </script>
  <div class="modal fade" id="adjustmentModal" tabindex="-1">
  <div class="modal-dialog">
    <div class="modal-content">
      <div class="modal-header bg-dark text-white">
        <h6 class="modal-title fw-bold">Audit: Days Adjustment</h6>
        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
      </div>
      <div class="modal-body">
        <p class="small text-muted">Please provide a reason for changing the worked days. This will be recorded for audit purposes.</p>
        <textarea id="adjReason" class="form-control" rows="3" placeholder="e.g., Sick leave approved, Mission outside office..."></textarea>
      </div>
      <div class="modal-footer">
        <button id="confirmAdjBtn" class="btn btn-primary fw-bold w-100" disabled onclick="submitDaysAdjustment()">Save Adjustment</button>
      </div>
    </div>
  </div>
</div>
</body>
</html>
