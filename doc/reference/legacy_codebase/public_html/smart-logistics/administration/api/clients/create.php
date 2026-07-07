<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN']); // widen later if needed (e.g., FINANCE, SALES)

header('Content-Type: application/json; charset=utf-8');

function respond(int $code, array $payload): void {
  http_response_code($code);
  echo json_encode($payload, JSON_UNESCAPED_SLASHES);
  exit;
}

function norm_str(?string $s): string {
  return trim((string)$s);
}

function is_auto_id(string $clientId): bool {
  $u = strtoupper(trim($clientId));
  return ($u === '' || $u === 'SLAS-CL-AUTO' || $u === 'SLAS-CL-NEW' || str_ends_with($u, '-NEW'));
}

function validate_email(string $email): bool {
  return (bool)filter_var($email, FILTER_VALIDATE_EMAIL);
}

/**
 * Generates next client_id in form SLAS-CL-XXXXXX (6 digits)
 * Uses a transaction + FOR UPDATE to reduce race conditions.
 */
function generate_next_client_id(mysqli $conn): string {
  $prefix = 'SLAS-CL-';

  // Lock the max row (best-effort with InnoDB + transaction)
  $sql = "SELECT client_id
          FROM client_master
          WHERE client_id LIKE CONCAT(?, '%')
          ORDER BY client_id DESC
          LIMIT 1
          FOR UPDATE";
  $stmt = $conn->prepare($sql);
  if (!$stmt) throw new RuntimeException("Prepare failed: ".$conn->error);
  $stmt->bind_param('s', $prefix);
  $stmt->execute();
  $row = $stmt->get_result()->fetch_assoc();
  $stmt->close();

  $nextNum = 1;
  if ($row && isset($row['client_id'])) {
    $last = (string)$row['client_id'];
    // Expected: SLAS-CL-001301
    $numPart = substr($last, strlen($prefix));
    $numPart = preg_replace('/\D+/', '', $numPart);
    if ($numPart !== '' && ctype_digit($numPart)) {
      $nextNum = ((int)$numPart) + 1;
    }
  }

  return $prefix . str_pad((string)$nextNum, 6, '0', STR_PAD_LEFT);
}

/** basic extension+mime validation for uploads */
function validate_upload(array $file): array {
  if (!isset($file['error']) || is_array($file['error'])) {
    return [false, 'Invalid upload payload.'];
  }
  if ($file['error'] !== UPLOAD_ERR_OK) {
    return [false, 'File upload error code: '.$file['error']];
  }

  // size: adjust as needed
  $maxBytes = 10 * 1024 * 1024; // 10MB
  if (($file['size'] ?? 0) > $maxBytes) {
    return [false, 'File too large. Max 10MB.'];
  }

  $tmp = (string)$file['tmp_name'];
  $finfo = new finfo(FILEINFO_MIME_TYPE);
  $mime  = $finfo->file($tmp) ?: '';

  $allowed = [
    'application/pdf' => 'pdf',
    'image/jpeg'      => 'jpg',
    'image/png'       => 'png',
  ];

  if (!isset($allowed[$mime])) {
    return [false, 'Unsupported file type. Allowed: PDF, JPG, PNG.'];
  }

  return [true, $allowed[$mime]];
}

$conn = db();
$conn->set_charset('utf8mb4');

try {
  if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(405, ['success' => false, 'error' => 'Method not allowed']);
  }

  // -----------------------------
  // Collect + validate inputs
  // -----------------------------
  $client_id          = norm_str($_POST['client_id'] ?? '');
  $client_name        = norm_str($_POST['client_name'] ?? '');
  $client_type        = norm_str($_POST['client_type'] ?? 'BOTH');
  $contact_person     = norm_str($_POST['contact_person'] ?? '');
  $contact_email      = norm_str($_POST['contact_email'] ?? '');
  $contact_phone      = norm_str($_POST['contact_phone'] ?? '');
  $niu                = norm_str($_POST['niu'] ?? '');
  $rccm               = norm_str($_POST['rccm'] ?? '');
  $address            = norm_str($_POST['address'] ?? '');
  $country            = norm_str($_POST['country'] ?? 'Cameroon');
  $status             = norm_str($_POST['status'] ?? 'ACTIVE');

  $payment_terms_days = norm_str($_POST['payment_terms_days'] ?? '30');
  $credit_limit       = norm_str($_POST['credit_limit'] ?? '');

  // Docs
  $doc_name           = norm_str($_POST['doc_category'] ?? ''); // stored as document_type
  $doc_storage_mode   = strtoupper(norm_str($_POST['doc_storage_mode'] ?? 'DIGITAL')); // DIGITAL|PHYSICAL
  $doc_physical_ref   = norm_str($_POST['doc_physical_ref'] ?? '');

  // required fields
  if ($client_name === '' || $contact_person === '' || $contact_phone === '' || $contact_email === '' || $niu === '' || $address === '') {
    respond(422, ['success' => false, 'error' => 'Missing required fields (name/contact/email/phone/niu/address).']);
  }
  if (!validate_email($contact_email)) {
    respond(422, ['success' => false, 'error' => 'Invalid email format.']);
  }

  // normalize enums
  $validTypes = ['SHIPPER','CONSIGNEE','BOTH','BUSINESS_PARTNER'];
  $client_type = strtoupper($client_type);
  if (!in_array($client_type, $validTypes, true)) $client_type = 'BOTH';

  $validStatus = ['ACTIVE','DEACTIVATED'];
  $status = strtoupper($status);
  if (!in_array($status, $validStatus, true)) $status = 'ACTIVE';

  $payment_terms_int = ($payment_terms_days === '') ? 30 : (int)$payment_terms_days;
  if ($payment_terms_int < 0 || $payment_terms_int > 3650) {
    respond(422, ['success' => false, 'error' => 'payment_terms_days out of range.']);
  }

  $credit_limit_val = null;
  if ($credit_limit !== '') {
    if (!is_numeric($credit_limit)) {
      respond(422, ['success' => false, 'error' => 'credit_limit must be numeric.']);
    }
    $credit_limit_val = (float)$credit_limit;
    if ($credit_limit_val < 0) {
      respond(422, ['success' => false, 'error' => 'credit_limit cannot be negative.']);
    }
  }

  $hasDocIntent = ($doc_name !== '' || isset($_FILES['doc_file']) || ($doc_storage_mode === 'PHYSICAL' && $doc_physical_ref !== ''));

  if ($hasDocIntent) {
    if ($doc_storage_mode !== 'DIGITAL' && $doc_storage_mode !== 'PHYSICAL') {
      respond(422, ['success' => false, 'error' => 'doc_storage_mode must be DIGITAL or PHYSICAL.']);
    }
    if ($doc_storage_mode === 'PHYSICAL' && $doc_physical_ref === '') {
      // only enforce if user is actually trying to add a PHYSICAL doc
      if ($doc_name !== '' || isset($_FILES['doc_file'])) {
        respond(422, ['success' => false, 'error' => 'Physical archive reference is required for PHYSICAL documents.']);
      }
    }
  }

  // -----------------------------
  // Transaction
  // -----------------------------
  $conn->begin_transaction();

  $isNew = is_auto_id($client_id);
  if ($isNew) {
    $client_id = generate_next_client_id($conn);
  } else {
    // basic sanity check: immutable format
    if (!preg_match('/^SLAS-CL-\d{6}$/', $client_id)) {
      respond(422, ['success' => false, 'error' => 'Invalid client_id format.']);
    }
  }

  // Upsert client_master (INSERT or UPDATE)
  // Upsert client_master (INSERT or UPDATE)
$sql = "
  INSERT INTO client_master (
    client_id, client_name, client_type,
    contact_person, contact_email, contact_phone,
    niu, rccm, address, country,
    payment_terms_days, credit_limit,
    status,
    created_at, updated_at
  ) VALUES (
    ?, ?, ?,
    ?, ?, ?,
    ?, NULLIF(?, ''), ?,
    ?, ?, NULLIF(?, ''),
    ?,
    CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()
  )
  ON DUPLICATE KEY UPDATE
    client_name        = VALUES(client_name),
    client_type        = VALUES(client_type),
    contact_person     = VALUES(contact_person),
    contact_email      = VALUES(contact_email),
    contact_phone      = VALUES(contact_phone),
    niu                = VALUES(niu),
    rccm               = VALUES(rccm),
    address            = VALUES(address),
    country            = VALUES(country),
    payment_terms_days = VALUES(payment_terms_days),
    credit_limit       = VALUES(credit_limit),
    status             = VALUES(status),
    updated_at         = CURRENT_TIMESTAMP()
";

$stmt = $conn->prepare($sql);
if (!$stmt) {
  throw new RuntimeException("Prepare failed: " . $conn->error);
}

// IMPORTANT: credit_limit is bound as STRING and NULLIF handles empty -> NULL
$credit_limit_bind = ($credit_limit_val === null) ? '' : (string)$credit_limit_val;

// 13 placeholders => 13 types:
// 10 strings + 1 integer + 1 string + 1 string = "ssssssssssiss"
$types = "ssssssssssiss";

$stmt->bind_param(
  $types,
  $client_id,          // s
  $client_name,        // s
  $client_type,        // s
  $contact_person,     // s
  $contact_email,      // s
  $contact_phone,      // s
  $niu,                // s
  $rccm,               // s (NULLIF)
  $address,            // s
  $country,            // s
  $payment_terms_int,  // i
  $credit_limit_bind,  // s (NULLIF)
  $status              // s
);

if (!$stmt->execute()) {
  throw new RuntimeException("Client upsert failed: " . $stmt->error);
}
$stmt->close();


  // -----------------------------
  // Optional: client_document insert
  // -----------------------------
  $docInserted = false;
  $docRow = null;

  if ($hasDocIntent && $doc_name !== '') {
    $file_path = null;
    $archive_ref = null;

    if ($doc_storage_mode === 'DIGITAL') {
      if (!isset($_FILES['doc_file']) || !is_array($_FILES['doc_file'])) {
        // If they selected DIGITAL but did not attach a file, do not insert a doc row.
        // You can change this to an error if you want stricter behavior.
      } else {
        [$ok, $extOrErr] = validate_upload($_FILES['doc_file']);
        if (!$ok) respond(422, ['success' => false, 'error' => $extOrErr]);

        $ext = $extOrErr;

        $baseDir = __DIR__ . '/../../uploads/client_docs/' . $client_id;
        if (!is_dir($baseDir) && !mkdir($baseDir, 0755, true)) {
          throw new RuntimeException("Failed to create upload directory.");
        }

        $safeName = preg_replace('/[^A-Za-z0-9_\-]+/', '_', $doc_name);
        $uniq = bin2hex(random_bytes(6));
        $filename = $safeName . '_' . $uniq . '.' . $ext;

        $absPath = $baseDir . '/' . $filename;
        if (!move_uploaded_file($_FILES['doc_file']['tmp_name'], $absPath)) {
          throw new RuntimeException("Failed to move uploaded file.");
        }

        // store relative path for portability
        $file_path = '/uploads/client_docs/' . $client_id . '/' . $filename;
      }
    } else {
      // PHYSICAL
      if ($doc_physical_ref !== '') {
        $archive_ref = $doc_physical_ref;
      }
    }

    // Insert doc row only if we actually have something to store
    if ($file_path !== null || $archive_ref !== null) {
      $sql = "
        INSERT INTO client_document (
          client_id, document_type, storage_mode,
          file_path, archive_ref, uploaded_at
        ) VALUES (
          ?, ?, ?,
          ?, ?, CURRENT_TIMESTAMP()
        )
      ";
      $stmt = $conn->prepare($sql);
      if (!$stmt) throw new RuntimeException("Prepare failed: ".$conn->error);

      $stmt->bind_param(
        'sssss',
        $client_id,
        $doc_name,
        $doc_storage_mode,
        $file_path,
        $archive_ref
      );

      if (!$stmt->execute()) {
        throw new RuntimeException("Document insert failed: ".$stmt->error);
      }

      $docInserted = true;
      $docRow = [
        'document_type' => $doc_name,
        'storage_mode'  => $doc_storage_mode,
        'file_path'     => $file_path,
        'archive_ref'   => $archive_ref,
      ];

      $stmt->close();
    }
  }

  $conn->commit();

  respond(200, [
    'success' => true,
    'client_id' => $client_id,
    'created' => $isNew,
    'doc_inserted' => $docInserted,
    'doc' => $docRow
  ]);

} catch (Throwable $e) {
  if ($conn && $conn->errno === 0) {
    // ignore
  }
  if ($conn) {
    try { $conn->rollback(); } catch (Throwable $_) {}
  }
  respond(500, ['success' => false, 'error' => $e->getMessage()]);
}
