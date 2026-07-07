<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

// OPS creates/edits drafts. Admin can be allowed as superuser if you want.
require_role(['OPERATIONS','ADMIN']);
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
  http_response_code(405);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode(['ok' => false, 'message' => 'Method not allowed']);
  exit;
}

header('Content-Type: application/json; charset=utf-8');
$conn = db();
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

function read_json_body(): array {
  $raw = file_get_contents('php://input');
  $data = json_decode($raw ?: '[]', true);
  return is_array($data) ? $data : [];
}

function norm_str($v): string {
  $s = trim((string)($v ?? ''));
  return $s;
}

function must_str($v, string $name): string {
  $s = norm_str($v);
  if ($s === '') {
    http_response_code(400);
    echo json_encode(['ok' => false, 'message' => "{$name} is required"]);
    exit;
  }
  return $s;
}

function must_arr($v, string $name): array {
  if (!is_array($v)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'message' => "{$name} must be an array"]);
    exit;
  }
  return $v;
}

function to_dec($v): float {
  if ($v === null || $v === '') return 0.0;
  return (float)$v;
}

function now_dt(): string { return date('Y-m-d H:i:s'); }

// Build OCR ID like SLAS-OCR-1001
function generate_ocr_id(mysqli $conn): string {
  $rs = $conn->query("SELECT COUNT(*) AS c FROM ocr_master");
  $row = $rs->fetch_assoc();
  $n = (int)($row['c'] ?? 0);
  return 'SLAS-OCR-' . (1000 + $n + 1);
}

$body = read_json_body();

$ocrId   = norm_str($body['ocr_id'] ?? null); // nullable for NEW
$opsRef  = must_str($body['operations_file_reference'] ?? null, 'operations_file_reference');
$costingId = must_str($body['costing_id'] ?? null, 'costing_id');
$costingRef = must_str($body['costing_ref'] ?? null, 'costing_ref');
$clientId = must_str($body['client_id'] ?? null, 'client_id');
$clientName = must_str($body['client_name_cached'] ?? null, 'client_name_cached');
$serviceType = must_str($body['service_type'] ?? null, 'service_type');
$serviceTerritory = norm_str($body['service_territory'] ?? null);

$lines = must_arr($body['lines'] ?? null, 'lines');

$userId = (int)($_SESSION['auth']['user_id'] ?? 0);
if ($userId <= 0) {
  http_response_code(401);
  echo json_encode(['ok' => false, 'message' => 'Not authenticated']);
  exit;
}

try {
  $conn->begin_transaction();

  // --- Ensure OCR exists or create it ---
  if ($ocrId === '') {
    $ocrId = generate_ocr_id($conn);

    $sqlIns = "
      INSERT INTO ocr_master (
        ocr_id, operations_file_reference, costing_id, costing_ref, client_id,
        client_name_cached, service_type, service_territory,
        status, total_budget_ttc, total_actual_ttc,
        created_by_user_id, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?, 'DRAFT', 0.00, 0.00, ?, ?, ?)
    ";

    $stmt = $conn->prepare($sqlIns);
    $now = now_dt(); 
    $stmt->bind_param(
      'ssssssssiss',
      $ocrId, $opsRef, $costingId, $costingRef, $clientId,
      $clientName, $serviceType, $serviceTerritory,
      $userId, $now, $now
    );
    $stmt->execute();
  } else {
    // Must exist and be editable (DRAFT/REJECTED) by OPS
    $stmt = $conn->prepare("SELECT status FROM ocr_master WHERE ocr_id = ? LIMIT 1");
    $stmt->bind_param('s', $ocrId);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    if (!$row) {
      http_response_code(404);
      echo json_encode(['ok' => false, 'message' => 'OCR not found']);
      exit;
    }

    $status = strtoupper((string)$row['status']);
    if (!in_array($status, ['DRAFT','REJECTED'], true)) {
      http_response_code(409);
      echo json_encode(['ok' => false, 'message' => "OCR is locked (status: {$status})"]);
      exit;
    }

    $sqlUpd = "
      UPDATE ocr_master
      SET
        operations_file_reference = ?,
        costing_id = ?,
        costing_ref = ?,
        client_id = ?,
        client_name_cached = ?,
        service_type = ?,
        service_territory = ?,
        updated_at = ?
      WHERE ocr_id = ?
      LIMIT 1
    ";
    $stmt = $conn->prepare($sqlUpd);
    $now = now_dt();
    $stmt->bind_param(
      'sssssssss',
      $opsRef, $costingId, $costingRef, $clientId, $clientName,
      $serviceType, $serviceTerritory, $now, $ocrId
    );
    $stmt->execute();
  }

  // --- Upsert OCR lines ---
  // Simplest approach: delete + insert all lines (OK for drafts). Keep it transactional.
  $stmt = $conn->prepare("DELETE FROM ocr_line WHERE ocr_id = ?");
  $stmt->bind_param('s', $ocrId);
  $stmt->execute();

  $totalBud = 0.0;
  $totalAct = 0.0;

  $sqlLine = "
    INSERT INTO ocr_line (
      ocr_id, costing_line_id, line_no, item_code, item_description,
      budget_ttc, actual_ttc, doc_ref, doc_required,
      created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
  ";
  $stmtLine = $conn->prepare($sqlLine);
  $now = now_dt();

  foreach ($lines as $i => $l) {
    $costingLineId = must_str($l['costing_line_id'] ?? null, "lines[$i].costing_line_id");
    $lineNo    = (int)($l['line_no'] ?? 0);
    $itemCode = norm_str($l['item_code'] ?? null);
    $itemDesc = norm_str($l['item_description'] ?? null);
    $bud      = to_dec($l['budget_ttc'] ?? 0);
    $act      = to_dec($l['actual_ttc'] ?? 0);
    $docRef   = norm_str($l['doc_ref'] ?? null);
    $docReq   = (int)($l['doc_required'] ?? 0);

    $totalBud += $bud;
    $totalAct += $act;

    // s s i s s d d s i s s  => ssissddsiss
    $stmtLine->bind_param(
      'ssissddsiss',
      $ocrId,
      $costingLineId,
      $lineNo,
      $itemCode,
      $itemDesc,
      $bud,
      $act,
      $docRef,
      $docReq,
      $now,
      $now
    );
    $stmtLine->execute();
  }

  // --- Update totals in ocr_master ---
  $stmt = $conn->prepare("
    UPDATE ocr_master
    SET total_budget_ttc = ?, total_actual_ttc = ?, updated_at = ?
    WHERE ocr_id = ?
    LIMIT 1
  ");
  $stmt->bind_param('ddss', $totalBud, $totalAct, $now, $ocrId);
  $stmt->execute();

  // ---------------------------------------------------------------------------
  // <--- CRITICAL UPDATE: SYNC TO OPERATIONS FILE MASTER --->
  // This ensures the File Master knows about the OCR, its Status, and the Draft Amount.
  // ---------------------------------------------------------------------------
  $stmtOps = $conn->prepare("
    UPDATE operations_file_master
    SET 
        ocr_id = ?, 
        ocr_amount = ?, 
        ocr_status = 'DRAFT', 
        ocr_linked_at = ?
    WHERE operations_file_reference = ?
    LIMIT 1
  ");
  // Bind: s (ocr_id), d (amount), s (date), s (file_ref)
  $stmtOps->bind_param('sdss', $ocrId, $totalAct, $now, $opsRef);
  $stmtOps->execute();
  // ---------------------------------------------------------------------------

  $conn->commit();

  echo json_encode([
    'ok' => true,
    'ocr_id' => $ocrId,
    'total_budget_ttc' => $totalBud,
    'total_actual_ttc' => $totalAct
  ]);

} catch (Throwable $e) {
  if ($conn->errno) { /* no-op */ }
  try { $conn->rollback(); } catch (Throwable $_) {}
  http_response_code(500);
  echo json_encode([
    'ok' => false,
    'message' => 'Save draft failed',
    'error' => $e->getMessage()
  ]);
}