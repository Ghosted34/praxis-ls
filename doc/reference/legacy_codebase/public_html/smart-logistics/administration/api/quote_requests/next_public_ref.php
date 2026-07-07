<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN','SALES', 'MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');

$conn = db();

$moduleKey = 'SMART_QUOTE';
$year = (int)date('Y');

/**
 * Atomic increment using LAST_INSERT_ID trick.
 * Requires doc_sequences(module_key, year) PK.
 */
$sql = "
  INSERT INTO doc_sequences (module_key, year, seq)
  VALUES (?, ?, 1)
  ON DUPLICATE KEY UPDATE seq = LAST_INSERT_ID(seq + 1)
";
$stmt = $conn->prepare($sql);
$stmt->bind_param('si', $moduleKey, $year);
$stmt->execute();

$res = $conn->query("SELECT LAST_INSERT_ID() AS seq");
$row = $res->fetch_assoc();
$seq = (int)($row['seq'] ?? 1);

$public = sprintf('SQ-%d-%06d', $year, $seq);

echo json_encode(['ok' => true, 'public_quote_ref' => $public, 'seq' => $seq], JSON_UNESCAPED_SLASHES);
