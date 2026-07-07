<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

function json_exit(array $p, int $code = 200): void {
  http_response_code($code);
  echo json_encode($p);
  exit;
}

require_once __DIR__ . '/../config/db.php'; // FIXED PATH

// UUID fallback (remove if you already have uuid_v4 in an included file)
if (!function_exists('uuid_v4')) {
  function uuid_v4(): string {
    $data = random_bytes(16);
    $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
    $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
  }
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
  json_exit(['success' => false, 'error' => 'Invalid request method'], 405);
}

$rawBody = file_get_contents('php://input') ?: '';
$raw = json_decode($rawBody, true);

if (!is_array($raw)) {
  json_exit(['success' => false, 'error' => 'Invalid JSON body'], 400);
}

$fullName = trim((string)($raw['full_name'] ?? ''));
$email    = trim((string)($raw['email'] ?? ''));
$phone    = trim((string)($raw['phone'] ?? ''));
$message  = trim((string)($raw['message'] ?? ''));

if ($fullName === '' || $email === '' || $message === '') {
  json_exit(['success' => false, 'error' => 'Required fields missing'], 422);
}

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
  json_exit(['success' => false, 'error' => 'Invalid email address'], 422);
}

$conn = db();

$enquiryId = uuid_v4();

// If phone column is NULLABLE, keep null; otherwise use ''.
$phoneDb = ($phone !== '') ? $phone : null;

$sql = "
  INSERT INTO contact_enquiries (
    enquiry_id,
    full_name,
    email,
    phone,
    message,
    enquiry_type,
    status,
    submission_datetime
  ) VALUES (?, ?, ?, ?, ?, 'GENERAL_ENQUIRY', 'NEW', NOW())
";

$stmt = $conn->prepare($sql);
if (!$stmt) {
  json_exit(['success' => false, 'error' => 'Database error (prepare failed): ' . $conn->error], 500);
}

$stmt->bind_param('sssss', $enquiryId, $fullName, $email, $phoneDb, $message);

if (!$stmt->execute()) {
  json_exit(['success' => false, 'error' => 'Database error (execute failed): ' . $stmt->error], 500);
}

json_exit(['success' => true]);
// -------------------------
// Email notification
// -------------------------
$to = 'info@smartls.com';
$subject = 'New Contact Enquiry – Smart LS Website';

$body = "
New contact enquiry received:

Full Name: {$fullName}
Email: {$email}
Phone: " . ($phone !== '' ? $phone : 'N/A') . "

Message:
{$message}

Enquiry ID: {$enquiryId}
Submitted At: " . date('Y-m-d H:i:s') . "
";

$headers = [
  'From: Smart LS Website <no-reply@smartls.com>',
  'Reply-To: ' . $email,
  'Content-Type: text/plain; charset=UTF-8'
];

@mail($to, $subject, $body, implode("\r\n", $headers));

