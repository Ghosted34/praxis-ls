<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  json_response(['ok' => false, 'message' => 'Method not allowed.'], 405);
}

$token = $_POST['csrf_token'] ?? null;
if (!csrf_verify(is_string($token) ? $token : null)) {
  json_response(['ok' => false, 'message' => 'Invalid CSRF token. Refresh the page and try again.'], 419);
}

function s(?string $v): ?string {
  if ($v === null) return null;
  $v = trim($v);
  return $v === '' ? null : $v;
}

/**
 * Inputs for employee_master (your schema order)
 */
$employee_id      = s($_POST['employee_id'] ?? null);
$full_name        = s($_POST['full_name'] ?? null);
$signatory_name   = s($_POST['signatory_name'] ?? null);
$email            = s($_POST['email'] ?? null);
$department       = s($_POST['department'] ?? null);
$job_title        = s($_POST['job_title'] ?? null);
$employment_type  = s($_POST['employment_type'] ?? null);
$join_date        = s($_POST['join_date'] ?? null);
$status           = s($_POST['status'] ?? 'ACTIVE');

$dob              = s($_POST['dob'] ?? null);
$marital_status   = s($_POST['marital_status'] ?? 'SINGLE');
$phone            = s($_POST['phone'] ?? null);
$address          = s($_POST['address'] ?? null);

$base_salary_raw  = s($_POST['base_salary'] ?? '0.00');
$payment_method   = s($_POST['payment_method'] ?? 'BANK_TRANSFER');
$bank_details     = s($_POST['bank_details'] ?? null);

/**
 * Inputs for user_auth
 */
$username = s($_POST['username'] ?? null);
$password = s($_POST['password'] ?? null);

// authority_capabilities as SET
$caps = $_POST['authority_capabilities'] ?? [];
if (!is_array($caps)) $caps = [];

/**
 * Validation
 */
$errors = [];

if (!$employee_id) $errors[] = 'Employee ID is required.';
if ($employee_id && !preg_match('/^SL-\d{3,}$/', $employee_id)) $errors[] = 'Employee ID must match SL-XXX (e.g., SL-001).';
if (!$full_name) $errors[] = 'Full name is required.';
if (!$signatory_name) $errors[] = 'Signatory name is required.';
if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) $errors[] = 'A valid email is required.';
if (!$department) $errors[] = 'Department is required.';
if (!$job_title) $errors[] = 'Job title is required.';
if (!$employment_type) $errors[] = 'Employment type is required.';
if (!$join_date) $errors[] = 'Join date is required.';

if (!$username) $errors[] = 'Username is required.';
if ($username && !preg_match('/^[a-zA-Z0-9._-]{3,50}$/', $username)) $errors[] = 'Username may contain letters, numbers, dot, underscore, hyphen (3–50 chars).';

if (!$password) $errors[] = 'Password is required.';
if ($password && strlen($password) < 8) $errors[] = 'Password must be at least 8 characters.';

$allowed_department = ['SALES','OPERATIONS','FINANCE','ADMIN','MANAGEMENT'];
$allowed_employment = ['PERMANENT','CONTRACT','PROBATION','CONSULTANT'];
$allowed_status     = ['ACTIVE','EXITED','SUSPENDED'];
$allowed_marital    = ['SINGLE','MARRIED'];
$allowed_payment    = ['BANK_TRANSFER','CASH','CHEQUE'];
$allowed_caps       = ['ISSUER','VALIDATOR','APPROVER'];

if ($department && !in_array($department, $allowed_department, true)) $errors[] = 'Invalid department.';
if ($employment_type && !in_array($employment_type, $allowed_employment, true)) $errors[] = 'Invalid employment type.';
if ($status && !in_array($status, $allowed_status, true)) $errors[] = 'Invalid status.';
if ($marital_status && !in_array($marital_status, $allowed_marital, true)) $errors[] = 'Invalid marital status.';
if ($payment_method && !in_array($payment_method, $allowed_payment, true)) $errors[] = 'Invalid payment method.';

// Filter capabilities to allowed values, ensure at least one
$caps = array_values(array_unique(array_filter($caps, fn($c) => in_array($c, $allowed_caps, true))));
if (count($caps) === 0) {
  $caps = ['ISSUER']; // default as schema says
}
$caps_set = implode(',', $caps);

$base_salary = 0.00;
if ($base_salary_raw !== null) {
  if (!is_numeric($base_salary_raw) || (float)$base_salary_raw < 0) {
    $errors[] = 'Base salary must be a non-negative number.';
  } else {
    $base_salary = (float)$base_salary_raw;
  }
}

if ($errors) {
  json_response(['ok' => false, 'message' => implode(' ', $errors)], 422);
}

/**
 * Hash password BEFORE insert (never store plaintext)
 */
$password_hash = password_hash($password, PASSWORD_DEFAULT);
if ($password_hash === false) {
  json_response(['ok' => false, 'message' => 'Could not hash password.'], 500);
}

try {
  $conn = db();
  $conn->begin_transaction();

  // 1) Insert employee_master
  $sqlEmp = "INSERT INTO employee_master (
              employee_id,
              full_name,
              signatory_name,
              email,
              department,
              job_title,
              employment_type,
              join_date,
              status,
              dob,
              marital_status,
              phone,
              address,
              base_salary,
              payment_method,
              bank_details
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

  $stmtEmp = $conn->prepare($sqlEmp);
  $stmtEmp->bind_param(
    'sssssssssssssdss',
    $employee_id,
    $full_name,
    $signatory_name,
    $email,
    $department,
    $job_title,
    $employment_type,
    $join_date,
    $status,
    $dob,
    $marital_status,
    $phone,
    $address,
    $base_salary,
    $payment_method,
    $bank_details
  );
  $stmtEmp->execute();

  // 2) Insert user_auth (role mirrors department here; adjust if you want separate fields)
  $role = $department;

  $sqlAuth = "INSERT INTO user_auth (
                employee_id,
                username,
                password_hash,
                role,
                authority_capabilities,
                is_active
              ) VALUES (?, ?, ?, ?, ?, TRUE)";

  $stmtAuth = $conn->prepare($sqlAuth);
  $stmtAuth->bind_param(
    'sssss',
    $employee_id,
    $username,
    $password_hash,
    $role,
    $caps_set
  );
  $stmtAuth->execute();

  $conn->commit();

  json_response([
    'ok' => true,
    'message' => 'Admin created in employee_master and user_auth (password stored as hash).'
  ], 201);

} catch (mysqli_sql_exception $e) {
  // rollback on any failure
  if (isset($conn) && $conn instanceof mysqli) {
    $conn->rollback();
  }

  $msg = 'Database error.';
  $raw = $e->getMessage();

  if (str_contains($raw, 'Duplicate entry')) {
    // Could be employee_id/email on employee_master, or username on user_auth
    $msg = 'Duplicate entry: employee_id/email/username already exists.';
    json_response(['ok' => false, 'message' => $msg], 409);
  }

  json_response(['ok' => false, 'message' => $msg], 500);
}
