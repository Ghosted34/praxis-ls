<?php
declare(strict_types=1);
if (function_exists('set_time_limit')) {
    set_time_limit(300); 
}

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'FINANCE', 'SALES', 'MANAGEMENT', 'OPERATIONS']);

// No HTML errors in JSON responses
ini_set('display_errors', '0');
error_reporting(E_ALL);

header('Content-Type: application/json; charset=utf-8');
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

function respond(int $code, array $payload): void {
  http_response_code($code);
  echo json_encode($payload, JSON_UNESCAPED_SLASHES);
  exit;
}

function norm_str($v): string {
  return trim((string)($v ?? ''));
}

function is_auto_id(string $clientId): bool {
  $u = strtoupper(trim($clientId));
  return ($u === '' || $u === 'SLAS-CL-AUTO' || $u === 'SLAS-CL-NEW');
}

/**
 * If frontend accidentally posts UI text like "Generating ID..." we treat as AUTO.
 * Also treat any clearly-invalid id as AUTO, so we don't upsert into a nonsense key.
 */
function is_invalid_or_ui_id(string $clientId): bool {
  $t = trim($clientId);
  if ($t === '') return true;
  $u = strtoupper($t);

  // Common UI mistake strings
  if (str_contains($u, 'GENERATING')) return true;
  if (str_contains($u, 'SPIN')) return true;

  // Expected generated ID pattern: 5 digits + '-' + suffix (S, C, SC, B, etc.)
  // e.g., "07231-S", "54321-SC"
  if (preg_match('/^\d{5}-[A-Z]{1,2}$/', $t)) return false;

  // Allow legacy/system placeholders
  if ($u === 'SLAS-CL-AUTO' || $u === 'SLAS-CL-NEW') return true;

  // If you also support other formats, add them here.
  // Otherwise, anything else is considered invalid for safety.
  return true;
}

/**
 * Generates a unique ID: 5 Random Digits + Suffix
 * Suffixes: Shipper (S), Consignee (C), Both (SC), Partner (B)
 */
function generate_custom_client_id(mysqli $conn, string $type): string {
  $suffixMap = [
    'SHIPPER'          => 'S',
    'CONSIGNEE'        => 'C',
    'BOTH'             => 'SC',
    'BUSINESS_PARTNER' => 'B'
  ];
  $suffix = $suffixMap[strtoupper($type)] ?? 'X';

  while (true) {
    $randomPart = str_pad((string)random_int(0, 99999), 5, '0', STR_PAD_LEFT);
    $newId = $randomPart . '-' . $suffix;

    $check = $conn->prepare("SELECT 1 FROM client_master WHERE client_id = ? LIMIT 1");
    $check->bind_param('s', $newId);
    $check->execute();
    $exists = (bool)$check->get_result()->fetch_row();
    $check->close();

    if (!$exists) return $newId;
  }
}

function validate_email(string $email): bool {
  return (bool)filter_var($email, FILTER_VALIDATE_EMAIL);
}

$conn = db();
$conn->set_charset('utf8mb4');

try {
  if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(405, ['success' => false, 'error' => 'Method not allowed']);
  }

  // --- 1) INPUTS ---
  $client_id          = norm_str($_POST['client_id'] ?? '');
  $client_name        = norm_str($_POST['client_name'] ?? '');
  $client_type        = strtoupper(norm_str($_POST['client_type'] ?? 'BOTH'));
  $contact_person     = norm_str($_POST['contact_person'] ?? '');
  $contact_email      = norm_str($_POST['contact_email'] ?? '');
  $contact_phone      = norm_str($_POST['contact_phone'] ?? '');
  $niu                = norm_str($_POST['niu'] ?? '');
  $rccm               = norm_str($_POST['rccm'] ?? '');
  $address            = norm_str($_POST['address'] ?? '');
  $country            = norm_str($_POST['country'] ?? 'Cameroon');
  $status             = strtoupper(norm_str($_POST['status'] ?? 'ACTIVE'));
  $payment_terms_days = norm_str($_POST['payment_terms_days'] ?? '30');
  $credit_limit       = norm_str($_POST['credit_limit'] ?? '');

  // Parse Document Queue
  $docsMetaRaw = (string)($_POST['docs_meta'] ?? '[]');
  $docsQueue   = json_decode($docsMetaRaw, true);
  if (!is_array($docsQueue)) $docsQueue = [];

  // --- 2) VALIDATIONS ---
  if ($client_name === '' || $contact_person === '' || $contact_phone === '' || $contact_email === '' || $niu === '' || $address === '') {
    respond(422, ['success' => false, 'error' => 'Missing required fields (Name, Contact, NIU, Address).']);
  }

  if (!validate_email($contact_email)) {
    respond(422, ['success' => false, 'error' => 'Invalid contact_email.']);
  }

  $validTypes = ['SHIPPER','CONSIGNEE','BOTH','BUSINESS_PARTNER'];
  if (!in_array($client_type, $validTypes, true)) $client_type = 'BOTH';

  $payment_terms_int = ($payment_terms_days === '') ? 30 : (int)$payment_terms_days;
  if ($payment_terms_int <= 0) $payment_terms_int = 30;

  $credit_limit_val = null;
  if ($credit_limit !== '') {
    if (!is_numeric($credit_limit)) {
      respond(422, ['success' => false, 'error' => 'credit_limit must be numeric if provided.']);
    }
    $credit_limit_val = (float)$credit_limit;
    if ($credit_limit_val < 0) $credit_limit_val = 0.0;
  }

  // Status normalization
  $status = ($status === 'DEACTIVATED') ? 'DEACTIVATED' : 'ACTIVE';

  // --- 3) FOLDER SETUP ---
  // Path: administration/uploads/client/documents/
  $baseUploadDir = __DIR__ . '/../../administration/uploads/client/documents/';
  if (!is_dir($baseUploadDir)) @mkdir($baseUploadDir, 0755, true);

  // --- 4) CREATE vs UPDATE LOGIC (single endpoint) ---
  // Rule:
  // - If client_id is AUTO/NEW or invalid/UI text => CREATE with generated id
  // - Else if exists => UPDATE
  // - Else => CREATE (manual id)
  $inputWasAuto = is_auto_id($client_id) || is_invalid_or_ui_id($client_id);

  $exists = false;
  if (!$inputWasAuto) {
    $chk = $conn->prepare("SELECT 1 FROM client_master WHERE client_id = ? LIMIT 1");
    $chk->bind_param('s', $client_id);
    $chk->execute();
    $exists = (bool)$chk->get_result()->fetch_row();
    $chk->close();
  }

  $isCreate = $inputWasAuto || !$exists;

  if ($inputWasAuto) {
    $client_id = generate_custom_client_id($conn, $client_type);
  }

  // --- 5) TRANSACTION ---
  $conn->begin_transaction();

  // --- 6) UPSERT CLIENT (same endpoint supports create/update safely) ---
  // We still use UPSERT, but because we determine $client_id correctly,
  // create won't accidentally overwrite an unrelated row.
  $sql = "INSERT INTO client_master (
            client_id, client_name, client_type,
            contact_person, contact_email, contact_phone,
            niu, rccm, address, country,
            payment_terms_days, credit_limit,
            status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), ?, ?, ?, NULLIF(?, ''), ?, NOW(), NOW())
          ON DUPLICATE KEY UPDATE
            client_name = VALUES(client_name),
            client_type = VALUES(client_type),
            contact_person = VALUES(contact_person),
            contact_email = VALUES(contact_email),
            contact_phone = VALUES(contact_phone),
            niu = VALUES(niu),
            rccm = VALUES(rccm),
            address = VALUES(address),
            country = VALUES(country),
            payment_terms_days = VALUES(payment_terms_days),
            credit_limit = VALUES(credit_limit),
            status = VALUES(status),
            updated_at = NOW()";

  $stmt = $conn->prepare($sql);

  $credit_limit_bind = ($credit_limit_val === null) ? null : (string)$credit_limit_val;

  // Bind: client_id, client_name, client_type,
  // contact_person, contact_email, contact_phone,
  // niu, rccm, address, country,
  // payment_terms_days, credit_limit, status
  $stmt->bind_param(
    "ssssssssssiss",
    $client_id, $client_name, $client_type,
    $contact_person, $contact_email, $contact_phone,
    $niu, $rccm, $address, $country,
    $payment_terms_int, $credit_limit_bind, $status
  );

  $stmt->execute();
  $stmt->close();
  $conn->commit();

  // --- 7) PROCESS DOCUMENTS (append-only; never overwrites existing docs) ---
  $uploadErrors = [];
  $successCount = 0;

  $sqlDoc = "INSERT INTO client_documents
               (client_id, document_type, storage_mode, file_path, archive_ref, uploaded_at)
             VALUES (?, ?, ?, ?, ?, NOW())";
  $stmtD = $conn->prepare($sqlDoc);

  foreach ($docsQueue as $idx => $meta) {
    $type       = norm_str($meta['type'] ?? '');
    $mode       = strtoupper(norm_str($meta['mode'] ?? 'DIGITAL'));
    $ref        = norm_str($meta['ref'] ?? '');
    $customName = norm_str($meta['custom_name'] ?? '');

    $finalDocType = ($type === 'OTHER' && $customName !== '') ? $customName : $type;
    if ($finalDocType === '') $finalDocType = 'Uncategorized';

    $file_path   = null;
    $archive_ref = null;
    $isSuccess   = false;

    if ($mode === 'DIGITAL') {
      $fileKey = "doc_file_{$idx}";
      if (isset($_FILES[$fileKey]) && (int)$_FILES[$fileKey]['error'] === UPLOAD_ERR_OK) {
        $f = $_FILES[$fileKey];

        $ext = strtolower((string)pathinfo((string)$f['name'], PATHINFO_EXTENSION));
        if ($ext === '') $ext = 'bin';

        // Strong unique filename (avoid collisions)
        $safeType = preg_replace('/[^a-zA-Z0-9]/', '', $finalDocType);
        if ($safeType === '') $safeType = 'DOC';

        $token = bin2hex(random_bytes(8)); // 16 hex chars
        $filename = $client_id . '_' . $safeType . '_' . date('Ymd_His') . '_' . $token . '_' . $idx . '.' . $ext;

        $dest = $baseUploadDir . $filename;

        if (move_uploaded_file((string)$f['tmp_name'], $dest)) {
          $file_path = 'administration/uploads/client/documents/' . $filename; // relative path
          $isSuccess = true;
        } else {
          $uploadErrors[] = "Doc #".($idx+1).": Move failed.";
        }
      } else {
        // docsQueue should represent new uploads only; if missing, warn
        $uploadErrors[] = "Doc #".($idx+1).": File upload error/missing file.";
      }
    } else {
      // PHYSICAL
      if ($ref !== '') {
        $archive_ref = $ref;
        $isSuccess = true;
      } else {
        $uploadErrors[] = "Doc #".($idx+1).": Archive ref missing.";
      }
    }

    if ($isSuccess) {
      $stmtD->bind_param("sssss", $client_id, $finalDocType, $mode, $file_path, $archive_ref);
      try {
        $stmtD->execute();
        $successCount++;
      } catch (Throwable $e) {
        $uploadErrors[] = "Doc #".($idx+1).": DB Insert failed.";
      }
    }
  }

  $stmtD->close();

  respond(200, [
    'success'      => true,
    'client_id'    => $client_id,
    'created'      => $isCreate,
    'docs_saved'   => $successCount,
    'warnings'     => $uploadErrors
  ]);

} catch (Throwable $e) {
  if (isset($conn)) {
    try { $conn->rollback(); } catch (Throwable $_) {}
  }
  respond(500, ['success' => false, 'error' => $e->getMessage()]);
}
