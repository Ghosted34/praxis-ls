<?php
// administration/config/db.php

declare(strict_types=1);

$DB_HOST = '127.0.0.1';
$DB_NAME = 'smartqaq_smartls';
$DB_USER = 'smartqaq_smartls';
$DB_PASS = 'Pattim11@2011. ';

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

function db(): mysqli {
  static $conn = null;

  if ($conn instanceof mysqli) {
    return $conn;
  }

  global $DB_HOST, $DB_NAME, $DB_USER, $DB_PASS;

  $conn = new mysqli($DB_HOST, $DB_USER, $DB_PASS, $DB_NAME);
  $conn->set_charset('utf8mb4');

  return $conn;
}
