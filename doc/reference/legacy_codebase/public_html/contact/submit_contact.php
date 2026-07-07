<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/../config/db.php'; // must define db(): mysqli

function json_exit(array $payload, int $code = 200): void {
  http_response_code($code);
  echo json_encode($payload, JSON_UNESCAPED_UNICODE);
  exit;
}

// Make mysqli throw exceptions (so we can catch and return JSON)
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

try {
  if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    json_exit(['ok' => false, 'error' => 'Invalid request method'], 405);
  }

  // Allow optional debug without leaking internals to normal users
  $debug = (($_GET['debug'] ?? '') === '1');

  // Read input from either JSON or standard form POST
  $ct = strtolower((string)($_SERVER['CONTENT_TYPE'] ?? ''));
  $in = [];

  if (strpos($ct, 'application/json') !== false) {
    $raw = file_get_contents('php://input');
    $decoded = json_decode($raw ?: '', true);
    if (!is_array($decoded)) {
      json_exit(['ok' => false, 'error' => 'Invalid JSON body'], 400);
    }
    $in = $decoded;
  } else {
    // form-urlencoded or multipart/form-data
    $in = $_POST;

    // Fallback: sometimes clients send JSON with wrong content-type
    if ((!is_array($in) || empty($in))) {
      $raw = file_get_contents('php://input');
      $decoded = json_decode($raw ?: '', true);
      if (is_array($decoded)) $in = $decoded;
    }
  }

  $fullName = trim((string)($in['full_name'] ?? ''));
  $email    = trim((string)($in['email'] ?? ''));
  $phoneRaw = trim((string)($in['phone'] ?? ''));
  $message  = trim((string)($in['message'] ?? ''));

  if ($fullName === '' || $message === '') {
    json_exit(['ok' => false, 'error' => 'Please fill in all required fields correctly.'], 400);
  }
  if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    json_exit(['ok' => false, 'error' => 'Invalid email address.'], 400);
  }

  // Optional fields / defaults per schema
  $companyName = null;               // not collected by your form
  $enquiryType = 'GENERAL_ENQUIRY';  // default matches schema
  $status      = 'NEW';              // default matches schema

  // Treat empty phone as NULL
  $phone = ($phoneRaw === '') ? null : $phoneRaw;

  $conn = db();

  // IMPORTANT: confirm your real table name. If yours is different, change it here.
  // Keeping your provided table name:
  $sql = "
    INSERT INTO contact_enquiries (
      enquiry_id,
      full_name,
      company_name,
      email,
      phone,
      enquiry_type,
      message,
      status
    ) VALUES (
      UUID(),
      ?, ?, ?, ?, ?, ?, ?
    )
  ";

  $stmt = $conn->prepare($sql);

  // bind_param requires variables (NULL is ok if variable is null)
  $stmt->bind_param(
    'sssssss',
    $fullName,
    $companyName,
    $email,
    $phone,
    $enquiryType,
    $message,
    $status
  );

  $stmt->execute();

  json_exit(['ok' => true], 200);

} catch (Throwable $e) {
  // Log full detail server-side
  error_log('Contact submit error: ' . $e->getMessage());

  // Return JSON always (prevents HTML 500 breaking frontend)
  if (!empty($_GET['debug']) && $_GET['debug'] === '1') {
    json_exit(['ok' => false, 'error' => 'Server error', 'detail' => $e->getMessage()], 500);
  }

  json_exit(['ok' => false, 'error' => 'Server error. Please try again later.'], 500);
}
