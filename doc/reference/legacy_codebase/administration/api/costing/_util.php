<?php
declare(strict_types=1);

function json_out(array $payload, int $code = 200): void {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($payload);
  exit;
}

function require_method(string $m): void {
  if (strtoupper($_SERVER['REQUEST_METHOD'] ?? '') !== strtoupper($m)) {
    json_out(['ok' => false, 'error' => 'Method not allowed'], 405);
  }
}

function norm_str($v): ?string {
  $s = trim((string)($v ?? ''));
  return $s === '' ? null : $s;
}

function must_str($v, string $field): string {
  $s = trim((string)($v ?? ''));
  if ($s === '') json_out(['ok' => false, 'error' => "Missing required field: {$field}"], 422);
  return $s;
}

function uuid36(): string {
  // RFC4122 v4-ish
  $data = random_bytes(16);
  $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
  $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
  $hex = bin2hex($data);
  return sprintf('%s-%s-%s-%s-%s',
    substr($hex, 0, 8),
    substr($hex, 8, 4),
    substr($hex, 12, 4),
    substr($hex, 16, 4),
    substr($hex, 20, 12)
  );
}

function read_json_body(): array {
  $raw = file_get_contents('php://input');
  if ($raw === false || trim($raw) === '') return [];
  $j = json_decode($raw, true);
  if (!is_array($j)) json_out(['ok' => false, 'error' => 'Invalid JSON body'], 400);
  return $j;
}

function get_session_user_id(): int {
  return (int)($_SESSION['auth']['user_id'] ?? 0);
}

function get_session_role(): string {
  return strtoupper((string)($_SESSION['auth']['role'] ?? ($_SESSION['auth']['user_role'] ?? '')));
}

/**
 * Increments and returns next sequence number using atomic UPSERT + LAST_INSERT_ID trick.
 */
function next_sequence(mysqli $conn, string $seqName): int {
  $sql = "INSERT INTO doc_sequence (seq_name, next_val)
          VALUES (?, 1)
          ON DUPLICATE KEY UPDATE next_val = LAST_INSERT_ID(next_val + 1)";
  $stmt = $conn->prepare($sql);
  $stmt->bind_param('s', $seqName);
  $stmt->execute();

  $res = $conn->query("SELECT LAST_INSERT_ID() AS v");
  $row = $res ? $res->fetch_assoc() : null;
  return (int)($row['v'] ?? 1);
}

function format_costing_ref(int $seq): string {
  // Matches your UI: SLAS-COST-0001401 style (7 digits)
  return 'SLAS-COST-' . str_pad((string)$seq, 7, '0', STR_PAD_LEFT);
}

function service_label(string $raw): string {
  return trim(str_replace('_', ' ', $raw)) !== '' ? str_replace('_', ' ', $raw) : '-';
}
