<?php
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN', 'FINANCE', 'MANAGEMENT']);

$conn = db();
$filename = "employees_export_" . date('Y-m-d') . ".csv";

header('Content-Type: text/csv');
header('Content-Disposition: attachment; filename="' . $filename . '"');

$output = fopen('php://output', 'w');

// Header Row
fputcsv($output, [
    'Employee ID', 'Full Name', 'Department', 'Job Title', 'Type', 'Status', 
    'Join Date', 'Email', 'Reports To', 'Salary', 'Bank', 'CNPS'
]);

// Data
$sql = "SELECT * FROM employee_master ORDER BY department, full_name";
$res = $conn->query($sql);

while ($row = $res->fetch_assoc()) {
    fputcsv($output, [
        $row['employee_id'],
        $row['full_name'],
        $row['department'],
        $row['job_title'],
        $row['employment_type'],
        $row['status'],
        $row['join_date'],
        $row['email'],
        $row['reports_to_employee_id'],
        $row['base_salary'],
        $row['bank_details'],
        $row['cnps_number']
    ]);
}
fclose($output);
exit;