<?php
declare(strict_types=1);

require_once __DIR__ . 'config/db.php';

header('Content-Type: application/json; charset=utf-8');

$conn = db();

function json_out(array $payload, int $code = 200): void {
  http_response_code($code);
  echo json_encode($payload);
  exit;
}

function clean_str(?string $s, int $max): string {
  $s = trim((string)$s);
  if ($s === '') return '';
  if (mb_strlen($s) > $max) $s = mb_substr($s, 0, $max);
  return $s;
}

function valid_email(string $email): bool {
  return (bool)filter_var($email, FILTER_VALIDATE_EMAIL);
}

// ---- Read inputs
$company = clean_str($_POST['company_name'] ?? null, 150);
$country = clean_str($_POST['country_of_origin'] ?? null, 80);
$person  = clean_str($_POST['contact_person'] ?? null, 120);
$title   = clean_str($_POST['contact_title'] ?? null, 120);
$email   = clean_str($_POST['contact_email'] ?? null, 120);
$type    = strtoupper(clean_str($_POST['proposal_type'] ?? null, 40));
$netsRaw = (string)($_POST['network_memberships'] ?? '');

// ---- Validate required
if ($company === '' || $country === '' || $person === '' || $title === '' || $email === '' || $type === '') {
  json_out(['ok' => false, 'error' => 'Missing required fields.'], 422);
}

if (!valid_email($email)) {
  json_out(['ok' => false, 'error' => 'Invalid email address.'], 422);
}

// Proposal type validate
$allowedTypes = ['AGENCY_PARTNERSHIP','VENDOR_REGISTRATION'];
if (!in_array($type, $allowedTypes, true)) {
  json_out(['ok' => false, 'error' => 'Invalid proposal type.'], 422);
}

// Normalize memberships stored as JSON string (max 20 items)
$nets = [];
if ($netsRaw !== '') {
  $decoded = json_decode($netsRaw, true);
  if (is_array($decoded)) {
    foreach ($decoded as $n) {
      $n = clean_str((string)$n, 40);
      if ($n !== '') $nets[] = $n;
      if (count($nets) >= 20) break;
    }
  } else {
    // fallback for comma-separated raw
    $parts = array_map('trim', preg_split('/[;,]/', $netsRaw) ?: []);
    foreach ($parts as $p) {
      $p = clean_str($p, 40);
      if ($p !== '') $nets[] = $p;
      if (count($nets) >= 20) break;
    }
  }
}
$netsJson = $nets ? json_encode($nets, JSON_UNESCAPED_UNICODE) : null;

// ---- Optional file upload (PDF)
$docRef = null;

// Storage path (server filesystem)
$subDir = realpath(__DIR__ . '/../../assets/uploads') ?: (__DIR__ . '/../../uploads');

if (!is_dir($subDir)) {
  @mkdir($subDir, 0755, true);
}

if (!empty($_FILES['corporate_profile_pdf']) && is_array($_FILES['corporate_profile_pdf'])) {
  $f = $_FILES['corporate_profile_pdf'];

  if (($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE) {
    if (($f['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK) {
      json_out(['ok' => false, 'error' => 'File upload failed.'], 400);
    }

    $maxBytes = 8 * 1024 * 1024; // 8MB
    if (($f['size'] ?? 0) > $maxBytes) {
      json_out(['ok' => false, 'error' => 'PDF too large (max 8MB).'], 422);
    }

    $tmp = (string)$f['tmp_name'];
    $origName = (string)($f['name'] ?? 'document.pdf');

    // Validate mime (best-effort)
    $mime = '';
    if (function_exists('finfo_open')) {
      $fi = finfo_open(FILEINFO_MIME_TYPE);
      if ($fi) {
        $mime = (string)finfo_file($fi, $tmp);
        finfo_close($fi);
      }
    }
    if ($mime !== '' && $mime !== 'application/pdf') {
      json_out(['ok' => false, 'error' => 'Only PDF files are allowed.'], 422);
    }

    // Sanitize filename + create unique name
    $base = preg_replace('/[^a-zA-Z0-9._-]/', '_', $origName);
    if (!str_ends_with(strtolower($base), '.pdf')) $base .= '.pdf';

    $uuid = bin2hex(random_bytes(16)); // simple unique token
    $finalName = 'PR_' . $uuid . '_' . $base;
    $dest = $subDir . '/' . $finalName;

    if (!move_uploaded_file($tmp, $dest)) {
      json_out(['ok' => false, 'error' => 'Failed to store PDF file.'], 500);
    }

    // Store a DB reference (relative path or file name)
    // Choose ONE convention and keep it consistent:
    // Option A: store just the file name
    $docRef = $finalName;

    // Option B (if your file manager expects subpath):
    // $docRef = 'partnership_profiles/' . $finalName;
  }
}

// ---- Status defaults (align with your enum values)
$statusDefault = 'NEW';

// If your DB uses IN_REVIEW not UNDER_REVIEW, it's fine here; we only insert NEW.
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
    submission_datetime,
    status
  ) VALUES (
    ?,?,?,?,?,?,?,?,?, NOW(), ?
  )
";

$reqId = uuidv4_fallback();

$stmt = $conn->prepare($sql);
if (!$stmt) {
  json_out(['ok' => false, 'error' => 'DB prepare failed.'], 500);
}

$stmt->bind_param(
  'ssssssssss',
  $reqId,
  $company,
  $country,
  $netsJson,
  $person,
  $title,
  $email,
  $type,
  $docRef,
  $statusDefault
);

if (!$stmt->execute()) {
  json_out(['ok' => false, 'error' => 'DB insert failed.'], 500);
}

json_out(['ok' => true, 'id' => $reqId]);

// --- UUID fallback generator (no ext needed)
function uuidv4_fallback(): string {
  $data = random_bytes(16);
  $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
  $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
  return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}
