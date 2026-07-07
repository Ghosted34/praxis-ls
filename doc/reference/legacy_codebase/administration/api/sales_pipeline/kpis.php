<?php
declare(strict_types=1);
require_once __DIR__ . '/_common.php';

$sqlTotal = "SELECT COUNT(*) AS c FROM quote_requests WHERE converted_opportunity_id IS NOT NULL";
$sqlWon   = "SELECT COUNT(*) AS c FROM quote_requests WHERE converted_opportunity_id IS NOT NULL AND UPPER(status)='WON'";
$sqlSum   = "SELECT COALESCE(SUM(COALESCE(estimated_value_xaf,0)),0) AS s
            FROM quote_requests WHERE converted_opportunity_id IS NOT NULL";

$r1 = $conn->query($sqlTotal)->fetch_assoc();
$r2 = $conn->query($sqlWon)->fetch_assoc();
$r3 = $conn->query($sqlSum)->fetch_assoc();

$total = (int)($r1['c'] ?? 0);
$won   = (int)($r2['c'] ?? 0);
$sum   = (float)($r3['s'] ?? 0);

$winRate = $total > 0 ? round(($won / $total) * 100) : 0;

jexit(['ok'=>true,'data'=>[
  'pipeline_value_xaf' => $sum,
  'win_rate_percent'   => $winRate,
  'total'              => $total,
  'won'                => $won
]]);
