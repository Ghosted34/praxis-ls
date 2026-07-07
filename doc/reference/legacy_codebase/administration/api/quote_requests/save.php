<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN','SALES']); 

header('Content-Type: application/json; charset=utf-8');

$conn = db();
$conn->set_charset('utf8mb4');

function jexit(array $p, int $code=200): void {
  http_response_code($code);
  echo json_encode($p, JSON_UNESCAPED_SLASHES);
  exit;
}

// Helper to get POST data safely
function post(string $k, $default = '') {
  return $_POST[$k] ?? $default;
}

$employeeId = (string)($_SESSION['auth']['employee_id'] ?? '');
if ($employeeId === '') jexit(['ok'=>false,'error'=>'Session missing employee_id'], 401);

// --- 1. CAPTURE INPUTS ---
$quote_request_id = trim((string)post('quote_request_id', ''));
$public_quote_ref = trim((string)post('public_quote_ref', ''));
$status           = trim((string)post('status', 'RECEIVED'));

// Detect if this is a "New Entry" placeholder from the frontend
if ($public_quote_ref === '(Auto-Generated)') {
    $public_quote_ref = '';
}

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

$estimated_weight_raw = $_POST['estimated_weight'] ?? null;
if (is_array($estimated_weight_raw)) {
    jexit(['ok'=>false,'error'=>'estimated_weight invalid'], 422);
}

$estimated_weight = null;
if ($estimated_weight_raw !== null && $estimated_weight_raw !== '') {
  $estimated_weight = (float)$estimated_weight_raw;
}

$project_cargo_flag = (int)(post('project_cargo_flag', '0') === '1');
$cargo_description  = trim((string)post('cargo_description', ''));
$additional_notes   = trim((string)post('additional_notes', ''));

$intake_channel = trim((string)post('intake_channel', 'MANUAL_ENTRY'));
if ($intake_channel === '') $intake_channel = 'MANUAL_ENTRY';

// --- 2. VALIDATION ---
// Note: We DO NOT check public_quote_ref here anymore, because we generate it later.
if ($requester_name === '')    jexit(['ok'=>false,'error'=>'requester_name is required'], 422);
if ($requester_email === '')   jexit(['ok'=>false,'error'=>'requester_email is required'], 422);
if ($requester_phone === '')   jexit(['ok'=>false,'error'=>'requester_phone is required'], 422);
if ($service_category === '')  jexit(['ok'=>false,'error'=>'service_category is required'], 422);
if ($service_type === '')      jexit(['ok'=>false,'error'=>'service_type is required'], 422);

if ($project_cargo_flag === 1 && trim($cargo_description) === '') {
  jexit(['ok'=>false,'error'=>'cargo_description is required when project_cargo_flag=1'], 422);
}

// Normalize empty strings to NULL
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

// --- 3. GENERATE ID (UUID) IF MISSING ---
if ($quote_request_id === '') {
  $data = random_bytes(16);
  $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
  $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
  $quote_request_id = vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

// Check if record exists
$chk = $conn->prepare("SELECT 1 FROM quote_requests WHERE quote_request_id = ? LIMIT 1");
if (!$chk) jexit(['ok'=>false,'error'=>'Prepare failed (exists check): '.$conn->error], 500);

$chk->bind_param("s", $quote_request_id);
$chk->execute();
$chk->store_result();
$exists = $chk->num_rows > 0;
$chk->close();

$ew = ($estimated_weight === null) ? 0.0 : (float)$estimated_weight;

// Track file path for cleanup in case of rollback
$uploadedFilePath = null;

$conn->begin_transaction();

try {

  // --- 4. AUTO-GENERATE PUBLIC REF (If New or Empty) ---
  // This is the Patch: We do this INSIDE the transaction to be safe.
  if (!$exists && $public_quote_ref === '') {
      $moduleKey = 'SMART_QUOTE';
      $year = (int)date('Y');
      
      // Atomic Increment
      $seqSql = "INSERT INTO doc_sequences (module_key, year, seq) VALUES (?, ?, 1)
                 ON DUPLICATE KEY UPDATE seq = LAST_INSERT_ID(seq + 1)";
      $seqStmt = $conn->prepare($seqSql);
      if (!$seqStmt) throw new RuntimeException('Prepare failed (sequence): '.$conn->error);
      
      $seqStmt->bind_param('si', $moduleKey, $year);
      $seqStmt->execute();
      $seqStmt->close();
      
      $res = $conn->query("SELECT LAST_INSERT_ID() AS seq");
      $row = $res->fetch_assoc();
      $seq = (int)($row['seq'] ?? 1);
      
      $public_quote_ref = sprintf('SQ-%d-%06d', $year, $seq);
  }

  // --- 5. INSERT OR UPDATE ---
  if (!$exists) {
    // INSERT
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
    if (!$stmt) throw new RuntimeException('Prepare failed (insert): '.$conn->error);

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
      throw new RuntimeException('Insert failed: '.$err);
    }
    $stmt->close();

    // Fix NULL weight manually if needed (mysqli 0.0 issue)
    if ($estimated_weight === null) {
      $u = $conn->prepare("UPDATE quote_requests SET estimated_weight = NULL WHERE quote_request_id = ?");
      if ($u) {
          $u->bind_param("s", $quote_request_id);
          $u->execute();
          $u->close();
      }
    }

  } else {
    // UPDATE
    if ($public_quote_ref === '') {
         throw new RuntimeException('Cannot update record: public_quote_ref is missing.');
    }

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
    if (!$stmt) throw new RuntimeException('Prepare failed (update): '.$conn->error);

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
      throw new RuntimeException('Update failed: '.$err);
    }
    $stmt->close();

    // Fix NULL weight manually if needed
    if ($estimated_weight === null) {
      $u = $conn->prepare("UPDATE quote_requests SET estimated_weight = NULL WHERE quote_request_id = ?");
      if ($u) {
          $u->bind_param("s", $quote_request_id);
          $u->execute();
          $u->close();
      }
    }
  }

  // --- 6. FILE UPLOAD HANDLING ---
  if (!empty($_FILES['attachment']) && ($_FILES['attachment']['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK) {
    $tmp  = (string)($_FILES['attachment']['tmp_name'] ?? '');
    $orig = basename((string)($_FILES['attachment']['name'] ?? ''));
    $ext  = strtolower(pathinfo($orig, PATHINFO_EXTENSION));
    $size = (int)($_FILES['attachment']['size'] ?? 0);

    // Checks
    $maxBytes = 10 * 1024 * 1024;
    if ($size > $maxBytes) throw new RuntimeException('File too large (max 10MB)');

    $denyExt = ['php','phtml','phar','cgi','pl','asp','aspx','jsp','htaccess'];
    if ($ext !== '' && in_array($ext, $denyExt, true)) throw new RuntimeException('File type not allowed');

    if ($orig === '') throw new RuntimeException('Empty filename');
    if ($tmp === '' || !is_uploaded_file($tmp)) throw new RuntimeException('Invalid upload temp file');

    // Naming
    $safeOrig = preg_replace('/[^a-zA-Z0-9._ -]+/', '_', $orig);
    $newName  = "qr_" . bin2hex(random_bytes(16)) . ($ext ? ".".$ext : "");

    // Folder
    $dir = realpath(__DIR__ . "/../../") . "/uploads/quote_requests";
    if ($dir === false) $dir = __DIR__ . "/../../uploads/quote_requests";
    if (!is_dir($dir) && !mkdir($dir, 0775, true)) {
      throw new RuntimeException('Failed to create uploads/quote_requests folder');
    }

    $dest = rtrim($dir, "/\\") . "/" . $newName;

    if (!move_uploaded_file($tmp, $dest)) {
      throw new RuntimeException('Failed to move uploaded file');
    }
    $uploadedFilePath = $dest; // Mark for cleanup on error

    // Mime
    $mime = (string)($_FILES['attachment']['type'] ?? '');
    if (function_exists('mime_content_type')) {
      $mime2 = (string)@mime_content_type($dest);
      if ($mime2 !== '') $mime = $mime2;
    }

    $stored_path = "uploads/quote_requests/" . $newName;

    // Update DB - This was the Critical Fix in Phase 1 (7 variables, 7 types)
    $uAtt = $conn->prepare("
      UPDATE quote_requests SET
        attachment_original_name = ?,
        attachment_stored_name = ?,
        attachment_stored_path = ?,
        attachment_mime_type = ?,
        attachment_file_size = ?,
        attachment_uploaded_at = NOW(),
        updated_by_employee_id = ?
      WHERE quote_request_id = ?
      LIMIT 1
    ");
    if (!$uAtt) throw new RuntimeException('Prepare failed (attachment update): '.$conn->error);

    $uAtt->bind_param(
      "ssssiss",
      $safeOrig,
      $newName,
      $stored_path,
      $mime,
      $size,
      $employeeId,
      $quote_request_id
    );

    if (!$uAtt->execute()) {
      $err = $uAtt->error ?: 'Unknown attachment update error';
      $uAtt->close();
      throw new RuntimeException('Attachment update failed: '.$err);
    }
    $uAtt->close();
  }

  $conn->commit();

  jexit([
    'ok' => true,
    'quote_request_id' => $quote_request_id,
    'public_quote_ref' => $public_quote_ref
  ]);

} catch (Throwable $e) {
  // ROLLBACK ON ERROR
  try { $conn->rollback(); } catch (Throwable $ignore) {}

  // ORPHAN FILE CLEANUP (Challenge 6.S2)
  if ($uploadedFilePath !== null && file_exists($uploadedFilePath)) {
      @unlink($uploadedFilePath);
  }

  jexit(['ok'=>false,'error'=>$e->getMessage()], 500);
}
?>