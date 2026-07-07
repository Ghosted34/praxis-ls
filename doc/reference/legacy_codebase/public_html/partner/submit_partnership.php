<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/../config/db.php'; // adjust if needed

function json_exit(bool $ok, string $msg = '', int $code = 200): void {
  http_response_code($code);
  echo json_encode(['ok' => $ok, 'error' => $msg]);
  exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  json_exit(false, 'Invalid request method', 405);
}

/* -------------------------------------------------
   Basic validation
-------------------------------------------------- */
$companyName       = trim($_POST['company_name'] ?? '');
$countryOfOrigin   = trim($_POST['country_of_origin'] ?? '');
$networkRaw = trim($_POST['network_memberships'] ?? '');

// If empty, store NULL (best for optional field)
$networkMembership = null;

if ($networkRaw !== '') {
  // Accept either "WCA, FIATA" or "WCA | FIATA" etc.
  $parts = preg_split('/[,|;]/', $networkRaw);
  $parts = array_values(array_filter(array_map('trim', $parts)));

  // Store JSON array: ["WCA","FIATA"]
  $networkMembership = json_encode($parts, JSON_UNESCAPED_UNICODE);
}

$contactPerson     = trim($_POST['contact_person'] ?? '');
$contactTitle      = trim($_POST['contact_title'] ?? '');
$contactEmail      = trim($_POST['contact_email'] ?? '');
$proposalType      = $_POST['proposal_type'] ?? '';

if (
  $companyName === '' ||
  $countryOfOrigin === '' ||
  $contactPerson === '' ||
  $contactTitle === '' ||
  !filter_var($contactEmail, FILTER_VALIDATE_EMAIL) ||
  !in_array($proposalType, ['AGENCY_PARTNERSHIP','VENDOR_REGISTRATION'], true)
) {
  json_exit(false, 'Invalid or missing required fields', 400);
}

/* -------------------------------------------------
   Optional file upload
-------------------------------------------------- */
$profileRef = null;

if (!empty($_FILES['corporate_profile']['name'])) {
  if ($_FILES['corporate_profile']['error'] !== UPLOAD_ERR_OK) {
    json_exit(false, 'File upload error', 400);
  }

  if ($_FILES['corporate_profile']['type'] !== 'application/pdf') {
    json_exit(false, 'Only PDF files are allowed', 400);
  }

  $uploadDir = __DIR__ . '/../../assets/uploads/partners';
  if (!is_dir($uploadDir)) {
    mkdir($uploadDir, 0755, true);
  }

  $safeName  = uniqid('partner_', true) . '.pdf';
  $destPath = $uploadDir . '/' . $safeName;

  if (!move_uploaded_file($_FILES['corporate_profile']['tmp_name'], $destPath)) {
    json_exit(false, 'Failed to save uploaded file', 500);
  }

  $profileRef = 'uploads/partners/' . $safeName;
}

/* -------------------------------------------------
   Insert into database
-------------------------------------------------- */
$conn = db();

$sql = "
  INSERT INTO partnership_requests (
    partnership_request_id,
    company_name,
    country_of_origin,
    network_memberships,
    contact_person,
    contact_title,
    contact_email,
    proposal_type,
    corporate_profile_ref,
    status
  ) VALUES (
    UUID(),
    ?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED'
  )
";

$stmt = $conn->prepare($sql);
if (!$stmt) {
  json_exit(false, 'Database prepare failed', 500);
}

$stmt->bind_param(
  'ssssssss',
  $companyName,
  $countryOfOrigin,
  $networkMembership,  // now JSON or NULL
  $contactPerson,
  $contactTitle,
  $contactEmail,
  $proposalType,
  $profileRef
);


if (!$stmt->execute()) {
  json_exit(false, 'Database insert failed', 500);
}

json_exit(true);
