<?php
declare(strict_types=1);

require_once __DIR__ . '/auth_guard.php';

/**
 * Enforce that the logged-in user has one of the allowed roles.
 * Usage: require_role(['ADMIN']); or require_role(['FINANCE','MANAGEMENT']);
 */
function require_role(array $allowed): void {
  $role = $_SESSION['auth']['role'] ?? null;
  if (!$role || !in_array($role, $allowed, true)) {
    http_response_code(403);
    echo "403 Forbidden";
    exit;
  }
}
