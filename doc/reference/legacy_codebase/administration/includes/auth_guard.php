<?php
declare(strict_types=1);

if (session_status() !== PHP_SESSION_ACTIVE) {
  session_start();
}

if (empty($_SESSION['auth']['user_id'])) {
  header('Location: ../../login.php');
  exit;
}
