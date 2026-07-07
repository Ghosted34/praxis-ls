<?php
declare(strict_types=1);

/**
 * ==============================================================================
 * SMART LS ENTERPRISE - PAYSLIP PRINT ENGINE
 * ==============================================================================
 * Optimized for A4 printing with Earnings/Deductions split layout.
 */

// 1. SYSTEM INIT
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN','FINANCE','MANAGEMENT']);

// 2. INPUT VALIDATION
$runId  = (string)($_GET['run_id'] ?? '');
$itemId = (string)($_GET['item_id'] ?? '');

if ($runId === '' || $itemId === '') {
    die('<div style="font-family:sans-serif; padding:50px; text-align:center; color:red;">Error: Missing Payroll ID or Item ID.</div>');
}

$conn = db();

// 3. FETCH DATA (Single Optimized Query)
$sql = "
    SELECT 
        pri.*,
        em.full_name, 
        em.job_title, 
        em.department, 
        em.join_date,
        em.bank_details, 
        em.cnps_number, 
        em.id_card_number,
        pr.period_ym, 
        pr.period_start, 
        pr.period_end,
        pr.status as run_status
    FROM payroll_run_items pri
    JOIN employee_master em ON em.employee_id = pri.employee_id
    JOIN payroll_runs pr ON pr.payroll_run_id = pri.payroll_run_id
    WHERE pri.payroll_run_id = ? AND pri.payroll_item_id = ?
    LIMIT 1
";

$stmt = $conn->prepare($sql);
if (!$stmt) die("SQL Error: " . $conn->error);
$stmt->bind_param('ss', $runId, $itemId);
$stmt->execute();
$data = $stmt->get_result()->fetch_assoc();

if (!$data) {
    die('<div style="font-family:sans-serif; padding:50px; text-align:center;">Payslip not found.</div>');
}

// 4. FORMATTERS & HELPERS
function money($v) { 
    return number_format((float)$v, 0, '.', ','); 
}

function safe($s) { 
    return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); 
}

// Dates
$periodObj = DateTime::createFromFormat('Y-m', $data['period_ym']);
$periodStr = $periodObj ? $periodObj->format('F Y') : $data['period_ym'];
$genDate   = date('d/m/Y H:i');

// Calculated fields for display
$daysWorked = (int)($data['days_worked'] ?? 0);
$stdDays    = 22; // Or fetch from config snapshot if needed
$isManual   = ($data['source_type'] ?? 'DIGITAL') === 'MANUAL';
$isLocked   = ($data['is_locked'] == 1);

// Signature Logic: Only show signature image if Run is Approved/Locked
$showSig = $isLocked; 

?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Payslip - <?php echo safe($data['full_name']); ?></title>
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&family=Inconsolata:wght@500;700&display=swap" rel="stylesheet">
    
    <style>
        /* ==========================================================================
           PRINT STYLES (A4 Optimized)
           ========================================================================== */
        @page { size: A4; margin: 6mm; }
        
        :root {
            --smart-orange: #EE7D04;
            --font-body: 'Montserrat', sans-serif;
            --font-mono: 'Inconsolata', monospace;
            --border-color: #000;
        }

        * { box-sizing: border-box; }

        body {
            font-family: var(--font-body);
            font-size: 9pt;
            color: #000;
            background: #fff;
            margin: 0;
            padding: 0;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }

        .container {
            max-width: 210mm;
            margin: 0 auto;
            min-height: 290mm; /* Force full page height feel */
            position: relative;
            display: flex;
            flex-direction: column;
        }

        /* HEADER */
        .header-row {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 3px solid var(--smart-orange);
            padding-bottom: 12px;
            margin-bottom: 20px;
        }
        .logo img { height: 65px; width: auto; }
        .company-meta { text-align: right; font-size: 8pt; line-height: 1.3; }
        .company-name { font-size: 14pt; font-weight: 800; color: var(--smart-orange); text-transform: uppercase; margin-bottom: 4px; }

        /* TITLE */
        .doc-title-row { text-align: center; margin-bottom: 25px; }
        .doc-title {
            font-size: 16pt; font-weight: 900; text-transform: uppercase; letter-spacing: 2px;
            border-bottom: 2px solid #000; display: inline-block; padding: 0 15px 4px;
        }
        .doc-sub { font-size: 10pt; font-weight: 600; margin-top: 5px; color: #444; }

        /* INFO GRID */
        .info-section {
            display: flex; gap: 20px; margin-bottom: 25px;
        }
        .info-box {
            flex: 1;
            border: 1px solid var(--border-color);
            padding: 10px 12px;
            border-radius: 4px;
        }
        .box-header {
            font-size: 8pt; font-weight: 800; text-transform: uppercase; color: #555;
            border-bottom: 1px solid #ccc; margin-bottom: 8px; padding-bottom: 2px;
        }
        .kv-row { display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 9pt; }
        .k { font-weight: 600; color: #444; }
        .v { font-weight: 700; color: #000; }

        /* FINANCIAL GRID */
        .financial-section {
            display: flex; gap: 20px; margin-bottom: 10px; flex: 1; /* Pushes footer down */
        }
        .fin-col { flex: 1; display: flex; flex-direction: column; }
        
        .fin-header {
            background: #eee; padding: 6px 10px; font-weight: 800; text-transform: uppercase;
            font-size: 9pt; border: 1px solid #000; border-bottom: none;
            display: flex; justify-content: space-between;
        }
        .fin-header.earn { background: #f0fdf4; color: #166534; border-color: #166534; }
        .fin-header.ded { background: #fef2f2; color: #991b1b; border-color: #991b1b; }

        .fin-table {
            width: 100%; border-collapse: collapse; font-size: 8.5pt;
            border: 1px solid #000;
        }
        .fin-table th { text-align: left; padding: 6px; border-bottom: 1px solid #000; font-size: 7.5pt; text-transform: uppercase; }
        .fin-table td { padding: 6px 8px; border-bottom: 1px solid #eee; }
        .fin-table .amt { text-align: right; font-family: var(--font-mono); font-weight: 700; }
        .fin-table tr:last-child td { border-bottom: none; }
        
        .subtotal-row td {
            border-top: 2px solid #000 !important;
            font-weight: 800; font-size: 10pt; background: #fafafa;
        }

        /* NET PAY BLOCK */
        .net-pay-block {
            margin: 20px 0;
            border: 2px solid #000;
            background: #f8f9fa;
            padding: 15px;
            text-align: center;
            border-radius: 6px;
        }
        .net-label { font-size: 9pt; font-weight: 800; text-transform: uppercase; color: #555; letter-spacing: 1px; }
        .net-val { font-size: 24pt; font-weight: 900; font-family: var(--font-mono); margin-top: 5px; }

        /* FOOTER / SIGNATURES */
        .footer-section {
            margin-top: auto; /* Push to bottom if flex container has height */
            padding-top: 20px;
        }
        .sig-grid { display: flex; justify-content: space-between; margin-top: 10px; }
        .sig-box {
            width: 45%;
            border-top: 1px solid #000;
            padding-top: 8px;
            text-align: center;
        }
        .sig-title { font-weight: 800; font-size: 8pt; text-transform: uppercase; margin-bottom: 10px; }
        .sig-space { height: 80px; display: flex; align-items: center; justify-content: center; }
        .sig-img { max-height: 105px; max-width: 100%; }

        .audit-line {
            margin-top: 30px; font-size: 7pt; color: #888; text-align: center;
            border-top: 1px dotted #ccc; padding-top: 5px;
        }

        @media print {
            .no-print { display: none !important; }
            body { background: #fff; }
            .container { box-shadow: none; margin: 0; border: none; min-height: 280mm; }
        }
    </style>
</head>
<body onload="window.print()">

    <div class="container">
        
        <div class="header-row">
            <div class="logo">
                <img src="../../../assets/img-webp/logo-smart.webp" alt="Smart LS Logo">
            </div>
            <div class="company-meta">
                <div class="company-name">Smart Logistics & Services Ltd</div>
                <div>1030, Avenue Douala Manga Bell, Bali</div>
                <div>B.P. 5120 - Douala, Cameroon</div>
                <div><strong>NIU/RC:</strong> M0421160335800  |  RC/DLA/2021/B/2060</div>
                <div><strong>Email:</strong> hr@smartls.cm</div>
            </div>
        </div>

        <div class="doc-title-row">
            <div class="doc-title">PAYSLIP</div>
            <div class="doc-sub"><?php echo $periodStr; ?></div>
        </div>

        <div class="info-section">
            <div class="info-box">
                <div class="box-header">Employee Details</div>
                <div class="kv-row">
                    <span class="k">Name:</span> 
                    <span class="v" style="text-transform:uppercase;"><?php echo safe($data['full_name']); ?></span>
                </div>
                <div class="kv-row">
                    <span class="k">Employee ID:</span> 
                    <span class="v"><?php echo safe($data['employee_id']); ?></span>
                </div>
                <div class="kv-row">
                    <span class="k">Job Title:</span> 
                    <span class="v"><?php echo safe($data['job_title']); ?></span>
                </div>
                <div class="kv-row">
                    <span class="k">Department:</span> 
                    <span class="v"><?php echo safe($data['department']); ?></span>
                </div>
                <div class="kv-row">
                    <span class="k">CNPS No:</span> 
                    <span class="v"><?php echo safe($data['cnps_number'] ?? 'N/A'); ?></span>
                </div>
            </div>

            <div class="info-box">
                <div class="box-header">Pay Period Details</div>
                <div class="kv-row">
                    <span class="k">Pay Period:</span> 
                    <span class="v"><?php echo $periodStr; ?></span>
                </div>
                <div class="kv-row">
                    <span class="k">Days Worked:</span> 
                    <span class="v"><?php echo $daysWorked; ?> Days</span>
                </div>
                <div class="kv-row">
                    <span class="k">Pay Date:</span> 
                    <span class="v"><?php echo $genDate; ?></span>
                </div>
                <div class="kv-row">
                    <span class="k">Status:</span> 
                    <span class="v"><?php echo safe($data['run_status']); ?></span>
                </div>
                <div class="kv-row">
                    <span class="k">CNI N°:</span> 
                    <span class="v"><?php echo safe($data['matricule'] ?? '-'); ?></span>
                </div>
            </div>
        </div>

        <div class="financial-section">
            
            <div class="fin-col">
                <div class="fin-header earn">
                    <span>Earnings</span>
                    <span>(+)</span>
                </div>
                <table class="fin-table" style="border-color: #166534;">
                    <tbody>
                        <tr>
                            <td>Base Salary</td>
                            <td class="amt"><?php echo money($data['base_pay']); ?></td>
                        </tr>
                        
                        <?php if($data['seniority_allowance'] > 0): ?>
                        <tr>
                            <td>Seniority Bonus</td>
                            <td class="amt"><?php echo money($data['seniority_allowance']); ?></td>
                        </tr>
                        <?php endif; ?>

                        <?php if($data['performance_bonus'] > 0): ?>
                        <tr>
                            <td>Performance Bonus (<?php echo (int)$data['perf_score']; ?>%)</td>
                            <td class="amt"><?php echo money($data['performance_bonus']); ?></td>
                        </tr>
                        <?php endif; ?>

                        <?php if($data['overtime_pay'] > 0): ?>
                        <tr>
                            <td>Overtime Pay</td>
                            <td class="amt"><?php echo money($data['overtime_pay']); ?></td>
                        </tr>
                        <?php endif; ?>

                        <?php if($data['allowances'] > 0): ?>
                        <tr>
                            <td>Other Allowances</td>
                            <td class="amt"><?php echo money($data['allowances']); ?></td>
                        </tr>
                        <?php endif; ?>

                        <tr><td colspan="2" style="height:20px; border:none;"></td></tr>

                        <tr class="subtotal-row">
                            <td>GROSS EARNINGS</td>
                            <td class="amt"><?php echo money($data['gross_pay']); ?></td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div class="fin-col">
                <div class="fin-header ded">
                    <span>Deductions</span>
                    <span>(-)</span>
                </div>
                <table class="fin-table" style="border-color: #991b1b;">
                    <tbody>
                        <tr>
                            <td>IRPP (Income Tax)</td>
                            <td class="amt"><?php echo money($data['ded_irpp']); ?></td>
                        </tr>
                        <tr>
                            <td>CAC (Add. Council Tax)</td>
                            <td class="amt"><?php echo money($data['ded_add_tax']); ?></td>
                        </tr>
                        <tr>
                            <td>CNPS (Pension)</td>
                            <td class="amt"><?php echo money($data['ded_cnps_emp']); ?></td>
                        </tr>
                        <tr>
                            <td>Housing / CFC</td>
                            <td class="amt"><?php echo money($data['ded_house_emp']); ?></td>
                        </tr>
                        
                        <?php if($data['advance'] > 0): ?>
                        <tr>
                            <td>Salary Advance</td>
                            <td class="amt"><?php echo money($data['advance']); ?></td>
                        </tr>
                        <?php endif; ?>

                        <tr><td colspan="2" style="height:20px; border:none;"></td></tr>

                        <tr class="subtotal-row">
                            <td>TOTAL DEDUCTIONS</td>
                            <td class="amt"><?php echo money($data['ded_total']); ?></td>
                        </tr>
                    </tbody>
                </table>
            </div>

        </div>

        <div class="net-pay-block">
            <div class="net-label">Net Payable / Net A Payer</div>
            <div class="net-val"><?php echo money($data['net_pay']); ?> <span style="font-size:14pt; color:#666;">XAF</span></div>
            <div style="font-size:8pt; margin-top:5px; font-style:italic;">
                (Transferred to: <?php echo safe($data['bank_details'] ?? 'Cash / Check'); ?>)
            </div>
        </div>

        <div class="footer-section">
            <div class="sig-grid">
                <div class="sig-box">
                    <div class="sig-title">Employee Signature</div>
                    <div class="sig-space">
                        </div>
                </div>
                
                <div class="sig-box">
                    <div class="sig-title">Management Signature</div>
                    <div class="sig-space">
                        <?php if($showSig): ?>
                            <img src="../../../assets/img/signature-dg.svg" class="sig-img" alt="Management Signed">
                        <?php else: ?>
                            <span style="color:#ccc; font-size:8pt;">(Not yet approved)</span>
                        <?php endif; ?>
                    </div>
                </div>
            </div>

            <div class="audit-line">
                System Generated via Smart LS Enterprise &bull; Run ID: <?php echo safe($runId); ?> &bull; Item ID: <?php echo safe($itemId); ?>
            </div>
        </div>

    </div>

</body>
</html>