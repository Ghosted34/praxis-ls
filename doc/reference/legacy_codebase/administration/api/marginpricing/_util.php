<?php
declare(strict_types=1);

/**
 * --------------------------------------------------------------------
 * API Utility Helpers
 * --------------------------------------------------------------------
 * Shared by ALL backend API endpoints (costing, pricing, billing, etc.)
 * No HTML. No echo outside json_out().
 */

/* ================================
   HTTP / JSON HELPERS
   ================================ */

/**
 * Enforce HTTP method.
 */
function require_method(string $method): void {
    if ($_SERVER['REQUEST_METHOD'] !== strtoupper($method)) {
        json_out([
            'ok'    => false,
            'error' => 'Invalid HTTP method'
        ], 405);
    }
}

/**
 * Read JSON request body safely.
 */
function read_json_body(): array {
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        return [];
    }

    $data = json_decode($raw, true);
    if (!is_array($data)) {
        json_out([
            'ok'    => false,
            'error' => 'Invalid JSON payload'
        ], 400);
    }

    return $data;
}

/**
 * Standard JSON response + exit.
 */
function json_out(array $payload, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

/* ================================
   VALIDATION HELPERS
   ================================ */

/**
 * Required string.
 */
function must_str($value, string $field): string {
    if (!is_string($value) || trim($value) === '') {
        json_out([
            'ok'    => false,
            'error' => "Missing or invalid field: {$field}"
        ], 400);
    }
    return trim($value);
}

/**
 * Optional normalized string.
 */
function norm_str($value): ?string {
    if (!is_string($value)) return null;
    $v = trim($value);
    return $v === '' ? null : $v;
}

/**
 * Required integer.
 */
function must_int($value, string $field): int {
    if (!is_numeric($value)) {
        json_out([
            'ok'    => false,
            'error' => "Invalid integer field: {$field}"
        ], 400);
    }
    return (int)$value;
}

/**
 * Required enum value.
 */
function must_enum($value, array $allowed, string $field): string {
    $value = strtoupper((string)$value);
    if (!in_array($value, $allowed, true)) {
        json_out([
            'ok'    => false,
            'error' => "Invalid value for {$field}"
        ], 400);
    }
    return $value;
}

/* ================================
   SESSION HELPERS
   ================================ */

/**
 * Get authenticated user_id.
 */
function get_session_user_id(): int {
    $id = $_SESSION['auth']['user_id'] ?? 0;
    if ($id <= 0) {
        json_out([
            'ok'    => false,
            'error' => 'Unauthenticated session'
        ], 401);
    }
    return (int)$id;
}

/**
 * Get authenticated role.
 */
function get_session_role(): string {
    $role = $_SESSION['auth']['role'] ?? '';
    if ($role === '') {
        json_out([
            'ok'    => false,
            'error' => 'Session role missing'
        ], 401);
    }
    return strtoupper($role);
}

/**
 * Get authenticated employee_id.
 */
function get_session_employee_id(): string {
    $eid = $_SESSION['auth']['employee_id'] ?? '';
    if ($eid === '') {
        json_out([
            'ok'    => false,
            'error' => 'Session employee missing'
        ], 401);
    }
    return (string)$eid;
}
