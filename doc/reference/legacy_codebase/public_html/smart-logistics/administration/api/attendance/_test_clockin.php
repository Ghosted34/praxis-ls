<?php
declare(strict_types=1);
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/auth_guard.php';

echo "<pre>";
echo "SESSION auth:\n";
var_dump($_SESSION['auth'] ?? null);
echo "</pre>";

echo "<form method='post' action='clock_in.php'>
  <button type='submit'>POST clock_in</button>
</form>";

echo "<form method='post' action='clock_out.php'>
  <button type='submit'>POST clock_out</button>
</form>";
