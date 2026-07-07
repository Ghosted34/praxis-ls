<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

function json_exit(array $p, int $code = 200): void {
  http_response_code($code);
  echo json_encode($p);
  exit;
}

require_once __DIR__ . '/../config/db.php'; // FIXED PATH

if (!function_exists('uuid_v4')) {
  function uuid_v4(): string {
    $data = random_bytes(16);
    $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
    $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
  }
}

function post_str(string $k, int $max = 500, bool $required = false): ?string {
  $v = isset($_POST[$k]) ? trim((string)$_POST[$k]) : '';
  if ($required && $v === '') return null;
  if ($v === '') return null;
  if (mb_strlen($v) > $max) $v = mb_substr($v, 0, $max);
  return $v;
}

function post_num(string $k): ?float {
  if (!isset($_POST[$k])) return null;
  $raw = trim((string)$_POST[$k]);
  if ($raw === '') return null;
  if (!is_numeric($raw)) return null;
  return (float)$raw;
}

function generate_public_ref(mysqli $conn): string {
  // Example: SLAS-RFQ-20260106-000001
  $today = (new DateTime('now'))->format('Y-m-d');
  $ymd = (new DateTime('now'))->format('Ymd');

  $conn->begin_transaction();
  try {
    // Lock today's row so seq increments safely
    $sql = "INSERT INTO quote_public_ref_counter (ref_date, last_seq)
            VALUES (?, 0)
            ON DUPLICATE KEY UPDATE last_seq = last_seq";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param("s", $today);
    $stmt->execute();
    $stmt->close();

    $sql2 = "SELECT last_seq FROM quote_public_ref_counter WHERE ref_date = ? FOR UPDATE";
    $stmt2 = $conn->prepare($sql2);
    $stmt2->bind_param("s", $today);
    $stmt2->execute();
    $stmt2->bind_result($lastSeq);
    $stmt2->fetch();
    $stmt2->close();

    $next = (int)$lastSeq + 1;

    $sql3 = "UPDATE quote_public_ref_counter SET last_seq = ? WHERE ref_date = ?";
    $stmt3 = $conn->prepare($sql3);
    $stmt3->bind_param("is", $next, $today);
    $stmt3->execute();
    $stmt3->close();

    $conn->commit();

    return sprintf("SLAS-RFQ-%s-%06d", $ymd, $next);
  } catch (Throwable $e) {
    $conn->rollback();
    throw $e;
  }
}

function normalize_service(string $service): array {
  // Map frontend service radio to table fields
  // service_category (Index) + service_type (varchar80)
  // You can refine these mappings later.
  $service = strtolower(trim($service));
  switch ($service) {
    case 'air':       return ['FREIGHT', 'AIR'];
    case 'sea':       return ['FREIGHT', 'SEA'];
    case 'land':      return ['FREIGHT', 'LAND'];
    case 'warehouse': return ['WAREHOUSING', 'STORAGE'];
    default:          return ['FREIGHT', 'AIR'];
  }
}

function move_uploaded_quote_file(array $file): array {
  if (!isset($file['error']) || is_array($file['error'])) {
    throw new RuntimeException('Invalid file upload.');
  }

  if ($file['error'] !== UPLOAD_ERR_OK) {
    throw new RuntimeException('Upload failed with code: ' . $file['error']);
  }

  $maxBytes = 10 * 1024 * 1024; // 10MB
  if ((int)$file['size'] > $maxBytes) {
    throw new RuntimeException('File too large (max 10MB).');
  }

  $finfo = new finfo(FILEINFO_MIME_TYPE);
  $mime = (string)$finfo->file($file['tmp_name']);

  $allowed = [
    'application/pdf' => 'pdf',
    'image/jpeg'      => 'jpg',
    'image/png'       => 'png',
  ];

  if (!isset($allowed[$mime])) {
    throw new RuntimeException('Unsupported file type.');
  }

  $origName = trim((string)$file['name']);
  $ext = $allowed[$mime];

  $dt = new DateTime('now');
  $relDir = '/administration/uploads/quote_requests/';
  $absDir = rtrim($_SERVER['DOCUMENT_ROOT'], '/') . $relDir;

  if (!is_dir($absDir) && !mkdir($absDir, 0775, true)) {
    throw new RuntimeException('Could not create upload directory.');
  }

  $storedName = 'qr_' . bin2hex(random_bytes(16)) . '.' . $ext;
  $absPath = $absDir . $storedName;

  if (!move_uploaded_file($file['tmp_name'], $absPath)) {
    throw new RuntimeException('Failed to move uploaded file.');
  }

  return [
    'original_name' => $origName,
    'stored_name'   => $storedName,
    'stored_path'   => $relDir . $storedName, // store relative path in DB
    'mime_type'     => $mime,
    'file_size'     => (int)$file['size'],
    'uploaded_at'   => (new DateTime('now'))->format('Y-m-d H:i:s'),
  ];
}

// Only POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  json_exit(['success' => false, 'error' => 'Method not allowed'], 405);
}

try {
  $conn = db();

  // ----- Extract / validate -----
  $serviceRaw = post_str('service', 50, true);
  if ($serviceRaw === null) json_exit(['success' => false, 'error' => 'Service is required'], 422);

  [$serviceCategory, $serviceType] = normalize_service($serviceRaw);

  $origin = post_str('origin_location', 150);
  $dest   = post_str('destination_location', 150);

  $whLoc  = post_str('warehouse_location', 150);
  $whDur  = post_str('warehouse_duration', 50) ?? 'UNKNOWN';

  $projectFlag = (int)(isset($_POST['project_cargo_flag']) ? (int)$_POST['project_cargo_flag'] : 0);
  $estimatedWeight = post_num('estimated_weight'); // nullable
  $cargoDesc = post_str('cargo_description', 10000);
  $notes = post_str('additional_notes', 10000);

  $requesterName    = post_str('requester_name', 150, true);
  $requesterEmail   = post_str('requester_email', 150, true);
  $requesterPhone   = post_str('requester_phone', 80, true);
  $requesterCompany = post_str('requester_company', 150); // nullable OK

  if ($requesterName === null || $requesterEmail === null || $requesterPhone === null) {
    json_exit(['success' => false, 'error' => 'Name, email and phone are required'], 422);
  }

  if (!filter_var($requesterEmail, FILTER_VALIDATE_EMAIL)) {
    json_exit(['success' => false, 'error' => 'Invalid email address'], 422);
  }

  // Basic route validation
  if ($serviceRaw === 'warehouse') {
    if ($whLoc === null) json_exit(['success' => false, 'error' => 'Warehouse location required'], 422);
  } else {
    if ($origin === null || $dest === null) {
      json_exit(['success' => false, 'error' => 'Origin and destination required'], 422);
    }
  }

  // Attachment required (your frontend requires it). Keep consistent.
  if (!isset($_FILES['attachment'])) {
    json_exit(['success' => false, 'error' => 'Attachment is required'], 422);
  }

  // ----- Generate IDs -----
  $quoteRequestId = uuid_v4();
  $publicRef = generate_public_ref($conn);

  // ----- Move upload -----
  $fileMeta = move_uploaded_quote_file($_FILES['attachment']);

  // ----- Insert -----
    // ----- Insert -----
  $intakeChannel = 'SMART_QUOTE';
  $status = 'RECEIVED';

  // Your form doesn't send this currently
  $estimatedValueXaf = null;

  $convertedOppId = null;
  $createdByEmp = null;
  $updatedByEmp = null;

  // timestamps (bind explicitly to avoid miscounts)
  $now = (new DateTime('now'))->format('Y-m-d H:i:s');

  // IMPORTANT: bind decimals as strings to avoid NULL numeric bind issues
  $estimatedWeightStr = isset($_POST['estimated_weight']) && trim((string)$_POST['estimated_weight']) !== ''
    ? trim((string)$_POST['estimated_weight'])
    : null;

  $estimatedValueXafStr = null; // keep null until you start sending it

  $projectFlagStr = (string)$projectFlag;
  $fileSizeStr    = (string)$fileMeta['file_size'];

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
      estimated_value_xaf,
      project_cargo_flag,
      cargo_description,
      additional_notes,
      status,
      converted_opportunity_id,
      submission_datetime,
      updated_at,
      created_by_employee_id,
      updated_by_employee_id,
      attachment_original_name,
      attachment_stored_name,
      attachment_stored_path,
      attachment_mime_type,
      attachment_file_size,
      attachment_uploaded_at
    ) VALUES (
      ?,?,?,?,?,?,?,?,?,?,
      ?,?,?,?,?,?,?,?,?,?,
      ?,?,?,?,?,?,?,?,?,?
    )
  ";

  $stmt = $conn->prepare($sql);
  if (!$stmt) {
    throw new RuntimeException('Prepare failed: ' . $conn->error);
  }

  // Bind ALL 30 as strings for maximum reliability (MySQL will cast as needed)
  $types = str_repeat('s', 30);

  $stmt->bind_param(
    $types,
    $quoteRequestId,            // 1
    $publicRef,                 // 2
    $intakeChannel,             // 3
    $requesterName,             // 4
    $requesterCompany,          // 5
    $requesterEmail,            // 6
    $requesterPhone,            // 7
    $serviceCategory,           // 8
    $serviceType,               // 9
    $origin,                    // 10

    $dest,                      // 11
    $whLoc,                     // 12
    $whDur,                     // 13
    $estimatedWeightStr,        // 14 (string or null)
    $estimatedValueXafStr,      // 15 (string or null)
    $projectFlagStr,            // 16 ("0" or "1")
    $cargoDesc,                 // 17
    $notes,                     // 18
    $status,                    // 19
    $convertedOppId,            // 20

    $now,                       // 21 submission_datetime
    $now,                       // 22 updated_at
    $createdByEmp,              // 23
    $updatedByEmp,              // 24
    $fileMeta['original_name'], // 25
    $fileMeta['stored_name'],   // 26
    $fileMeta['stored_path'],   // 27
    $fileMeta['mime_type'],     // 28
    $fileSizeStr,               // 29
    $fileMeta['uploaded_at']    // 30
  );

  $ok = $stmt->execute();
  if (!$ok) {
    throw new RuntimeException('Insert failed: ' . $stmt->error);
  }

  $stmt->close();


  json_exit([
    'success' => true,
    'public_quote_ref' => $publicRef
  ], 201);

} catch (Throwable $e) {
  // You may also log $e->getMessage() server-side
  json_exit([
    'success' => false,
    'error' => $e->getMessage()
  ], 500);
}
