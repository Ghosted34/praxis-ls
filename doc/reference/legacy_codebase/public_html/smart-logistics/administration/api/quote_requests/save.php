<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN','SALES']); // adjust as needed

header('Content-Type: application/json; charset=utf-8');

$conn = db();

function jexit(array $p, int $code=200): void {
  http_response_code($code);
  echo json_encode($p, JSON_UNESCAPED_SLASHES);
  exit;
}

function post(string $k, $default = '') {
  return $_POST[$k] ?? $default;
}

$employeeId = (string)($_SESSION['auth']['employee_id'] ?? '');
if ($employeeId === '') jexit(['ok'=>false,'error'=>'Session missing employee_id'], 401);

$quote_request_id = trim((string)post('quote_request_id', ''));
$public_quote_ref = trim((string)post('public_quote_ref', ''));
$status           = trim((string)post('status', 'RECEIVED'));

$requester_name    = trim((string)post('requester_name', ''));
$requester_company = trim((string)post('requester_company', ''));
$requester_email   = trim((string)post('requester_email', ''));
$requester_phone   = trim((string)post('requester_phone', ''));

$service_category = trim((string)post('service_category', ''));
$service_type     = trim((string)post('service_type', ''));

$origin_location      = trim((string)post('origin_location', ''));
$destination_location = trim((string)post('destination_location', ''));
$warehouse_location   = trim((string)post('warehouse_location', ''));
$warehouse_duration   = trim((string)post('warehouse_duration', 'UNKNOWN'));

/**
 * Hardening: reject array injection for scalar fields that matter
 */
$estimated_weight_raw = $_POST['estimated_weight'] ?? null;
if (is_array($estimated_weight_raw)) jexit(['ok'=>false,'error'=>'estimated_weight invalid'], 422);

$estimated_weight = null;
if ($estimated_weight_raw !== null && $estimated_weight_raw !== '') {
  $estimated_weight = (float)$estimated_weight_raw;
}

$project_cargo_flag = (int)(post('project_cargo_flag', '0') === '1');
$cargo_description  = trim((string)post('cargo_description', ''));
$additional_notes   = trim((string)post('additional_notes', ''));

// intake_channel: for manual entry we set MANUAL_ENTRY; otherwise accept provided
$intake_channel = trim((string)post('intake_channel', 'MANUAL_ENTRY'));
if ($intake_channel === '') $intake_channel = 'MANUAL_ENTRY';

// basic validation
if ($public_quote_ref === '')  jexit(['ok'=>false,'error'=>'public_quote_ref is required'], 422);
if ($requester_name === '')    jexit(['ok'=>false,'error'=>'requester_name is required'], 422);
if ($requester_email === '')   jexit(['ok'=>false,'error'=>'requester_email is required'], 422);
if ($requester_phone === '')   jexit(['ok'=>false,'error'=>'requester_phone is required'], 422);
if ($service_category === '')  jexit(['ok'=>false,'error'=>'service_category is required'], 422);
if ($service_type === '')      jexit(['ok'=>false,'error'=>'service_type is required'], 422);

if ($project_cargo_flag === 1 && trim($cargo_description) === '') {
  jexit(['ok'=>false,'error'=>'cargo_description is required when project_cargo_flag=1'], 422);
}

// normalize empty strings to NULL for nullable columns
$toNull = function($v) {
  $v = (string)$v;
  $v = trim($v);
  return $v === '' ? null : $v;
};

$requester_company    = $toNull($requester_company);
$origin_location      = $toNull($origin_location);
$destination_location = $toNull($destination_location);
$warehouse_location   = $toNull($warehouse_location);
$cargo_description    = $toNull($cargo_description);
$additional_notes     = $toNull($additional_notes);

// If quote_request_id not provided, create one (UUID v4)
if ($quote_request_id === '') {
  $data = random_bytes(16);
  $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
  $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
  $quote_request_id = vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

// Does record exist?
$chk = $conn->prepare("SELECT 1 FROM quote_requests WHERE quote_request_id = ? LIMIT 1");
if (!$chk) jexit(['ok'=>false,'error'=>'Prepare failed (exists check): '.$conn->error], 500);

$chk->bind_param("s", $quote_request_id);
$chk->execute();
$chk->store_result();
$exists = $chk->num_rows > 0;
$chk->close();

/**
 * NOTE: mysqli does not reliably bind NULL for "d".
 * We use 0.0 when null and then set NULL with a follow-up UPDATE.
 */
$ew = ($estimated_weight === null) ? 0.0 : (float)$estimated_weight;

if (!$exists) {
  $sql = "
    INSERT INTO quote_requests (
      quote_request_id,
      public_quote_ref,
      intake_channel,
      requester_name,
      requester_company,
      requester_email,
      requester_phone,
      service_category,
      service_type,
      origin_location,
      destination_location,
      warehouse_location,
      warehouse_duration,
      estimated_weight,
      project_cargo_flag,
      cargo_description,
      additional_notes,
      status,
      created_by_employee_id,
      updated_by_employee_id
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ";
  $stmt = $conn->prepare($sql);
  if (!$stmt) jexit(['ok'=>false,'error'=>'Prepare failed (insert): '.$conn->error], 500);

  // 20 bind vars => 20 type chars
  $stmt->bind_param(
    "sssssssssssssdisssss",
    $quote_request_id,
    $public_quote_ref,
    $intake_channel,
    $requester_name,
    $requester_company,
    $requester_email,
    $requester_phone,
    $service_category,
    $service_type,
    $origin_location,
    $destination_location,
    $warehouse_location,
    $warehouse_duration,
    $ew,
    $project_cargo_flag,
    $cargo_description,
    $additional_notes,
    $status,
    $employeeId,
    $employeeId
  );

  if (!$stmt->execute()) {
    $err = $stmt->error ?: 'Unknown insert error';
    $stmt->close();
    jexit(['ok'=>false,'error'=>'Insert failed: '.$err], 500);
  }
  $stmt->close();

  // If weight was actually null, set it to NULL
  if ($estimated_weight === null) {
    $u = $conn->prepare("UPDATE quote_requests SET estimated_weight = NULL WHERE quote_request_id = ?");
    if (!$u) jexit(['ok'=>false,'error'=>'Prepare failed (null weight post-insert): '.$conn->error], 500);
    $u->bind_param("s", $quote_request_id);
    if (!$u->execute()) {
      $u->close();
      jexit(['ok'=>false,'error'=>'Post-insert NULL weight update failed: '.$u->error], 500);
    }
    $u->close();
  }

} else {
  $sql = "
    UPDATE quote_requests SET
      public_quote_ref = ?,
      intake_channel = ?,
      requester_name = ?,
      requester_company = ?,
      requester_email = ?,
      requester_phone = ?,
      service_category = ?,
      service_type = ?,
      origin_location = ?,
      destination_location = ?,
      warehouse_location = ?,
      warehouse_duration = ?,
      estimated_weight = ?,
      project_cargo_flag = ?,
      cargo_description = ?,
      additional_notes = ?,
      status = ?,
      updated_by_employee_id = ?
    WHERE quote_request_id = ?
    LIMIT 1
  ";
  $stmt = $conn->prepare($sql);
  if (!$stmt) jexit(['ok'=>false,'error'=>'Prepare failed (update): '.$conn->error], 500);

  // 19 bind vars => 19 type chars
  $stmt->bind_param(
    "ssssssssssssdisssss",
    $public_quote_ref,
    $intake_channel,
    $requester_name,
    $requester_company,
    $requester_email,
    $requester_phone,
    $service_category,
    $service_type,
    $origin_location,
    $destination_location,
    $warehouse_location,
    $warehouse_duration,
    $ew,
    $project_cargo_flag,
    $cargo_description,
    $additional_notes,
    $status,
    $employeeId,
    $quote_request_id
  );

  if (!$stmt->execute()) {
    $err = $stmt->error ?: 'Unknown update error';
    $stmt->close();
    jexit(['ok'=>false,'error'=>'Update failed: '.$err], 500);
  }
  $stmt->close();

  if ($estimated_weight === null) {
    $u = $conn->prepare("UPDATE quote_requests SET estimated_weight = NULL WHERE quote_request_id = ?");
    if (!$u) jexit(['ok'=>false,'error'=>'Prepare failed (null weight post-update): '.$conn->error], 500);
    $u->bind_param("s", $quote_request_id);
    if (!$u->execute()) {
      $u->close();
      jexit(['ok'=>false,'error'=>'Post-update NULL weight update failed: '.$u->error], 500);
    }
    $u->close();
  }
}

/**
 * FILE UPLOAD (optional)
 * Stores file on disk and writes attachment metadata into quote_requests (same table).
 * Supports ONE attachment per quote request (latest overwrites previous metadata).
 *
 * Requires columns on quote_requests:
 * - attachment_original_name
 * - attachment_stored_name
 * - attachment_stored_path
 * - attachment_mime_type
 * - attachment_file_size
 * - attachment_uploaded_at
 */
if (!empty($_FILES['attachment']) && ($_FILES['attachment']['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK) {
  $tmp  = (string)($_FILES['attachment']['tmp_name'] ?? '');
  $orig = basename((string)($_FILES['attachment']['name'] ?? ''));
  $ext  = strtolower(pathinfo($orig, PATHINFO_EXTENSION));
  $size = (int)($_FILES['attachment']['size'] ?? 0);

  $maxBytes = 10 * 1024 * 1024; // 10MB
  if ($size > $maxBytes) jexit(['ok'=>false,'error'=>'File too large (max 10MB)'], 422);

  $denyExt = ['php','phtml','phar','cgi','pl','asp','aspx','jsp','htaccess'];
  if ($ext !== '' && in_array($ext, $denyExt, true)) jexit(['ok'=>false,'error'=>'File type not allowed'], 422);

  if ($orig === '') jexit(['ok'=>false,'error'=>'Empty filename'], 422);

  $safeOrig = preg_replace('/[^a-zA-Z0-9._-]+/', '_', $orig);
  $newName  = $quote_request_id . "_" . date('Ymd_His') . "_" . bin2hex(random_bytes(4)) . ($ext ? ".".$ext : "");

  $dir = __DIR__ . "/../../upload/quote_request";
  if (!is_dir($dir) && !mkdir($dir, 0775, true)) {
    jexit(['ok'=>false,'error'=>'Failed to create upload folder'], 500);
  }
  if (!is_writable($dir)) jexit(['ok'=>false,'error'=>'Upload folder not writable'], 500);

  if ($tmp === '' || !is_uploaded_file($tmp)) jexit(['ok'=>false,'error'=>'Invalid upload temp file'], 400);

  $dest = $dir . "/" . $newName;

  // Optional: fetch old path now (for cleanup after we successfully move new file)
  $oldRel = '';
  $old = $conn->prepare("SELECT attachment_stored_path FROM quote_requests WHERE quote_request_id = ? LIMIT 1");
  if ($old) {
    $old->bind_param("s", $quote_request_id);
    $old->execute();
    $oldRow = $old->get_result()->fetch_assoc();
    $old->close();
    $oldRel = (string)($oldRow['attachment_stored_path'] ?? '');
  }

  // Move to disk first
  if (!move_uploaded_file($tmp, $dest)) {
    jexit(['ok'=>false,'error'=>'Failed to move uploaded file'], 500);
  }

  // Determine mime (best-effort)
  $mime = (string)($_FILES['attachment']['type'] ?? '');
  if ($mime === '' && function_exists('mime_content_type')) {
    $mime = (string)@mime_content_type($dest);
  }

  // Store relative path in DB
  $path = "upload/quote_request/" . $newName;

  // Write metadata into SAME quote_requests row
  $up = $conn->prepare("
    UPDATE quote_requests SET
      attachment_original_name = ?,
      attachment_stored_name   = ?,
      attachment_stored_path   = ?,
      attachment_mime_type     = ?,
      attachment_file_size     = ?,
      attachment_uploaded_at   = NOW(),
      updated_by_employee_id   = ?
    WHERE quote_request_id = ?
    LIMIT 1
  ");
  if (!$up) jexit(['ok'=>false,'error'=>'Prepare failed (attachment update): '.$conn->error], 500);

  $up->bind_param(
    "ssssiss",
    $safeOrig,
    $newName,
    $path,
    $mime,
    $size,
    $employeeId,
    $quote_request_id
  );

  if (!$up->execute()) {
    $err = $up->error ?: 'Unknown attachment update error';
    $up->close();
    jexit(['ok'=>false,'error'=>'Attachment DB update failed: '.$err], 500);
  }
  $up->close();

  // Optional cleanup of old file (best-effort)
  if ($oldRel !== '' && $oldRel !== $path) {
    $base = realpath(__DIR__ . "/../../");
    if (is_string($base) && $base !== '') {
      $oldAbs = $base . "/" . ltrim($oldRel, "/");
      $uploadBase = realpath($dir);
      if (is_string($uploadBase) && $uploadBase !== '' && is_string($oldAbs)) {
        // Only delete within upload/quote_request to avoid path traversal damage
        if (strpos($oldAbs, $uploadBase) === 0 && is_file($oldAbs)) {
          @unlink($oldAbs);
        }
      }
    }
  }
}

jexit(['ok'=>true,'quote_request_id'=>$quote_request_id]);
