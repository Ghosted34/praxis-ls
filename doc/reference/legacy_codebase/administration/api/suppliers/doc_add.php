<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'FINANCE', 'MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');

function out(bool $ok, array $extra = [], int $code = 200): void {
  http_response_code($code);
  echo json_encode(array_merge(['ok'=>$ok], $extra));
  exit;
}

$raw = file_get_contents('php://input');
$data = json_decode($raw ?: '[]', true);
if (!is_array($data)) out(false, ['error'=>'Bad JSON'], 400);

$userId = (int)($_SESSION['auth']['user_id'] ?? 0);
if ($userId <= 0) out(false, ['error'=>'Session invalid'], 401);

$supplierId = trim((string)($data['supplier_id'] ?? ''));
$docType    = trim((string)($data['document_type'] ?? ''));
$mode       = trim((string)($data['storage_mode'] ?? ''));
$filePath   = isset($data['file_path']) ? trim((string)$data['file_path']) : null;
$physical   = isset($data['physical_ref']) ? trim((string)$data['physical_ref']) : null;

if ($supplierId === '' || $docType === '' || $mode === '') out(false, ['error'=>'Missing required fields'], 422);
if (!in_array($mode, ['DIGITAL','PHYSICAL'], true)) out(false, ['error'=>'Invalid storage_mode'], 422);

if ($mode === 'PHYSICAL' && (!$physical || $physical === '')) out(false, ['error'=>'physical_ref required'], 422);

$conn = db();

$sql = "
  INSERT INTO supplier_document
    (supplier_id, document_type, storage_mode, file_path, physical_ref, uploaded_by, uploaded_at)
  VALUES
    (?, ?, ?, ?, ?, ?, NOW())
";
$stmt = $conn->prepare($sql);
$stmt->bind_param('sssssi', $supplierId, $docType, $mode, $filePath, $physical, $userId);
$stmt->execute();

out(true, ['id' => $conn->insert_id]);
