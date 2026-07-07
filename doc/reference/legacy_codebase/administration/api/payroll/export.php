<?php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN','FINANCE','MANAGEMENT']);

// 1. Validation
$runId = (string)($_GET['run_id'] ?? '');
if ($runId === '') die("Missing Run ID");

$conn = db();

// 2. Fetch Full Payroll Data (Joined with Employee info for clarity)
$sql = "
    SELECT 
        em.full_name,
        em.employee_id,
        em.department,
        em.job_title,
        em.bank_details,
        pri.days_worked,
        pri.base_pay,
        pri.seniority_allowance,
        pri.performance_bonus,
        pri.allowances,
        pri.overtime_pay,
        pri.gross_pay,
        -- Bases
        pri.tax_base,
        pri.ins_base AS cnps_base,
        -- Deductions
        pri.ded_irpp AS irpp,
        pri.ded_add_tax AS cac,
        pri.ded_house_emp AS housing_ded,
        pri.ded_cnps_emp AS cnps_emp,
        pri.advance,
        pri.ded_total,
        -- Net
        pri.net_pay,
        -- Employer Costs (Hidden columns)
        pri.employer_total
    FROM payroll_run_items pri
    JOIN employee_master em ON em.employee_id = pri.employee_id
    WHERE pri.payroll_run_id = ?
    ORDER BY em.full_name ASC
";

$stmt = $conn->prepare($sql);
$stmt->bind_param('s', $runId);
$stmt->execute();
$res = $stmt->get_result();

// 3. Generate CSV Headers
$filename = "Payroll_Register_" . date('Y-m-d') . ".csv";

header('Content-Type: text/csv');
header('Content-Disposition: attachment; filename="' . $filename . '"');

$out = fopen('php://output', 'w');

// Human Readable Headers
fputcsv($out, [
    'Employee Name', 'ID', 'Department', 'Job Title', 'Bank Details',
    'Days', 'Base Salary', 'Seniority', 'Performance', 'Allowances', 'Overtime',
    'GROSS PAY',
    'Tax Base', 'CNPS Base',
    'IRPP', 'CAC (Add. Tax)', 'Housing Ded', 'CNPS (Emp)', 'Advance', 'Total Ded',
    'NET PAY',
    'Employer Cost'
]);

// 4. Output Rows
while ($row = $res->fetch_assoc()) {
    fputcsv($out, $row);
}

fclose($out);
exit;