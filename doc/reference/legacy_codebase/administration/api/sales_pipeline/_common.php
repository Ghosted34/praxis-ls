<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN','SALES','MANAGEMENT']); // adjust if needed

header('Content-Type: application/json; charset=utf-8');

$conn = db();

function jexit(array $p, int $code=200): void {
  http_response_code($code);
  echo json_encode($p);
  exit;
}

function post(string $k, $default = null) {
  return $_POST[$k] ?? $default;
}

function stage_from_status(?string $status): string {
  $s = strtoupper(trim((string)$status));
  if ($s === '' || $s === 'RECEIVED') return 'NEW';

  $allowed = ['NEW','QUALIFIED','PRICING_IN_PROGRESS','QUOTATION_SENT','NEGOTIATION','WON','LOST'];
  return in_array($s, $allowed, true) ? $s : 'NEW';
}

function uuidv4(): string {
  $data = random_bytes(16);
  $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
  $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
  return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

function require_employee_id(): string {
  $employeeId = (string)($_SESSION['auth']['employee_id'] ?? '');
  if ($employeeId === '') jexit(['ok'=>false,'error'=>'Session missing employee_id'], 401);
  return $employeeId;
}
