<?php
declare(strict_types=1);

require_once __DIR__ . '/../../../includes/init.php';
require_once __DIR__ . '/../../../includes/role_guard.php';
require_role(['ADMIN', 'FINANCE', 'MANAGEMENT', 'OPERATIONS', 'SALES']);

header('Content-Type: application/json; charset=utf-8');
$conn = db();

function jexit(array $p, int $code=200): void {
  http_response_code($code);
  echo json_encode($p);
  exit;
}

$q = trim((string)($_GET['q'] ?? ''));
$lang = strtoupper(trim((string)($_GET['lang'] ?? 'EN')));

if ($q === '' || mb_strlen($q) < 2) {
  jexit(['ok'=>true,'items'=>[]]);
}

try {
  $like = '%' . $q . '%';
  $prefix = $q . '%';

  $sql = "
    SELECT id, code, name_en, name_fr
    FROM financial_dictionary
    WHERE status = 'ACTIVE'
      AND (name_en LIKE ? OR name_fr LIKE ?)
    ORDER BY
      CASE
        WHEN name_en LIKE ? THEN 0
        WHEN name_fr LIKE ? THEN 1
        ELSE 2
      END,
      name_en ASC
    LIMIT 20
  ";

  $stmt = $conn->prepare($sql);
  if (!$stmt) jexit(['ok'=>false,'error'=>'Prepare failed'], 500);
  $stmt->bind_param('ssss', $like, $like, $prefix, $prefix);
  $stmt->execute();

  $res = $stmt->get_result();
  $items = [];
  while ($row = $res->fetch_assoc()) {
    $items[] = [
      'id' => (int)$row['id'],
      'code' => $row['code'],
      'name_en' => $row['name_en'],
      'name_fr' => $row['name_fr'],
    ];
  }

  jexit(['ok'=>true,'items'=>$items]);
} catch (Throwable $e) {
  jexit(['ok'=>false,'error'=>$e->getMessage()], 500);
}
