<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'SALES', 'MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');

$conn = db();

function json_out(array $payload, int $code = 200): void {
  http_response_code($code);
  echo json_encode($payload);
  exit;
}

$userId = (int)($_SESSION['auth']['user_id'] ?? 0);
if ($userId <= 0) json_out(['ok' => false, 'error' => 'Unauthenticated'], 401);

$raw = file_get_contents('php://input');
$data = json_decode($raw ?: '', true);
if (!is_array($data)) json_out(['ok' => false, 'error' => 'Invalid JSON body'], 400);

// Required
$id        = trim((string)($data['id'] ?? ''));
$name      = trim((string)($data['name'] ?? ''));
$platform  = strtoupper(trim((string)($data['platform'] ?? '')));
$startDate = trim((string)($data['start_date'] ?? ''));

// Optional
$endDate   = trim((string)($data['end_date'] ?? ''));
$budget    = (float)($data['budget_amount'] ?? 0);
$currency  = strtoupper(trim((string)($data['currency'] ?? 'XAF')));
$target    = trim((string)($data['target_service'] ?? 'ALL'));
$leads     = (int)($data['leads'] ?? 0);
$ops       = (int)($data['opportunities'] ?? 0);
$won       = (int)($data['won'] ?? 0);
$status    = strtoupper(trim((string)($data['status'] ?? 'PLANNED')));
$ownerName = trim((string)($data['owner_name'] ?? 'Current User'));

if ($id === '' || $name === '' || $platform === '' || $startDate === '') {
  json_out(['ok' => false, 'error' => 'Missing required fields (id, name, platform, start_date)'], 422);
}

$allowedPlatforms = ['META','GOOGLE','LINKEDIN','EMAIL','OFFLINE','OTHER'];
$allowedStatus    = ['PLANNED','ACTIVE','PAUSED','COMPLETED'];

if (!in_array($platform, $allowedPlatforms, true)) json_out(['ok'=>false,'error'=>'Invalid platform'], 422);
if (!in_array($status, $allowedStatus, true)) json_out(['ok'=>false,'error'=>'Invalid status'], 422);

$endDateDb = ($endDate === '') ? null : $endDate;
if ($currency === '') $currency = 'XAF';

// Upsert (insert if new; update if exists)
$sql = "
  INSERT INTO marketing_campaigns (
    id, name, platform, start_date, end_date, budget_amount, currency, target_service,
    leads, opportunities, won, status, owner_name, created_by_user_id
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?
  )
  ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    platform = VALUES(platform),
    start_date = VALUES(start_date),
    end_date = VALUES(end_date),
    budget_amount = VALUES(budget_amount),
    currency = VALUES(currency),
    target_service = VALUES(target_service),
    leads = VALUES(leads),
    opportunities = VALUES(opportunities),
    won = VALUES(won),
    status = VALUES(status),
    owner_name = VALUES(owner_name),
    updated_at = CURRENT_TIMESTAMP
";

$stmt = $conn->prepare($sql);
if (!$stmt) json_out(['ok'=>false,'error'=>'Prepare failed'], 500);

// types: id(s) name(s) platform(s) start(s) end(s/null) budget(d) currency(s) target(s) leads(i) ops(i) won(i) status(s) owner(s) userId(i)
$stmt->bind_param(
  'sssssdssiiissi',
  $id, $name, $platform, $startDate, $endDateDb, $budget, $currency, $target,
  $leads, $ops, $won, $status, $ownerName, $userId
);

$ok = $stmt->execute();
if (!$ok) {
  json_out(['ok'=>false,'error'=>'DB write failed'], 500);
}

json_out(['ok' => true, 'id' => $id]);
