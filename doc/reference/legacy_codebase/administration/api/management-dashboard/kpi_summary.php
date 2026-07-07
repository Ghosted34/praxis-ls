<?php
declare(strict_types=1);

/**
 * FILE: api/management-dashboard/kpi_summary.php
 * Updated: Implements Month-over-Month Growth & Specific Operational Risk Logic
 */

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

require_role(['ADMIN','FINANCE','SALES','OPERATIONS','MANAGEMENT']);

header('Content-Type: application/json; charset=utf-8');

function respond(int $code, array $payload): void {
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

$conn = db();
$conn->set_charset('utf8mb4');

try {
    // =========================================================================
    // 1. ACTIVE FILES (Preserving existing logic for the widget)
    // =========================================================================
    $sqlActive = "SELECT service_type, COUNT(*) AS cnt
            FROM operations_file_master
            WHERE operations_status NOT IN ('CLOSED','COMPLETED')
            GROUP BY service_type";
    $resActive = $conn->query($sqlActive);
    if ($resActive === false) throw new RuntimeException($conn->error);
    
    $by_mode = ['SEA' => 0, 'AIR' => 0, 'ROAD' => 0];
    $total_files = 0;
    while ($r = $resActive->fetch_assoc()) {
        $st = strtoupper((string)$r['service_type']);
        $cnt = (int)$r['cnt'];
        if (strpos($st, 'SEA') !== false) $by_mode['SEA'] += $cnt;
        elseif (strpos($st, 'AIR') !== false) $by_mode['AIR'] += $cnt;
        elseif (strpos($st, 'ROAD') !== false || strpos($st, 'INLAND') !== false) $by_mode['ROAD'] += $cnt;
        else $by_mode['ROAD'] += $cnt;
        $total_files += $cnt;
    }
    $resActive->free();

    // =========================================================================
    // 2. FINANCIALS: REVENUE & MARGIN (New Month-over-Month Logic)
    // =========================================================================
    // Logic: Sum 'final_invoice_amount' and 'margin' from operations_file_master
    // joined with invoice_master on final_invoice_id to get 'approved_at'.
    
    function getFinancials($conn, $start, $end) {
        $sql = "
            SELECT 
                COALESCE(SUM(ofm.final_invoice_amount), 0) as revenue,
                COALESCE(SUM(ofm.margin), 0) as margin
            FROM operations_file_master ofm
            JOIN invoice_master im ON ofm.final_invoice_id = im.invoice_id
            WHERE im.approved_at >= ? AND im.approved_at <= ?
        ";
        $stmt = $conn->prepare($sql);
        if (!$stmt) throw new RuntimeException("Prep failed: " . $conn->error);
        $stmt->bind_param('ss', $start, $end);
        $stmt->execute();
        $res = $stmt->get_result()->fetch_assoc();
        $stmt->close();

        return [
            'revenue' => (float)$res['revenue'],
            'margin'  => (float)$res['margin']
        ];
    }

    // Ranges
    $thisMonthStart = date('Y-m-01 00:00:00');
    $thisMonthEnd   = date('Y-m-t 23:59:59');
    $lastMonthStart = date('Y-m-01 00:00:00', strtotime('last month'));
    $lastMonthEnd   = date('Y-m-t 23:59:59', strtotime('last month'));

    $curr = getFinancials($conn, $thisMonthStart, $thisMonthEnd);
    $prev = getFinancials($conn, $lastMonthStart, $lastMonthEnd);

    // Calculate Growth
    $revGrowthPct = ($prev['revenue'] > 0) ? (($curr['revenue'] - $prev['revenue']) / $prev['revenue']) * 100 : 100;
    $marginGrowthPct = ($prev['margin'] > 0) ? (($curr['margin'] - $prev['margin']) / $prev['margin']) * 100 : 100;

    // =========================================================================
    // 3. CRITICAL RISK ENGINE (New Logic: Demurrage & Unbilled)
    // =========================================================================
    $risks = [];
    $today = new DateTime();

    // Query for ALL candidates (OPEN/IN_PROGRESS or COMPLETED/PENDING/CLOSED)
    // We select needed columns to calculate risks in PHP
    $sqlRisk = "SELECT 
        operations_file_reference AS file_ref,
        service_type,
        operations_status,
        client_name,
        place_delivery,
        sea_pod,
        air_dest,
        eta,
        ata,
        m10_completed_at,
        m11_completed_at,
        m12_completed_at,
        final_invoice_amount
    FROM operations_file_master
    WHERE 
        operations_status IN ('OPEN', 'IN_PROGRESS') -- For Demurrage
        OR
        operations_status IN ('OPERATIONALLY_COMPLETE', 'FINANCIALLY_PENDING', 'CLOSED') -- For Unbilled/Integrity
    ";
    
    $resRisk = $conn->query($sqlRisk);
    if ($resRisk === false) throw new RuntimeException($conn->error);

    while ($row = $resRisk->fetch_assoc()) {
        $status = $row['operations_status'];
        $ref = $row['file_ref'];
        
        // --- RISK TYPE 1: DEMURRAGE (Open/In Progress) ---
        if ($status === 'OPEN' || $status === 'IN_PROGRESS') {
            // Priority: ATA > ETA. If both empty, ignore.
            $arrivalStr = !empty($row['ata']) ? $row['ata'] : $row['eta'];
            
            if (!empty($arrivalStr)) {
                $arrivalDate = new DateTime($arrivalStr);
                // "freetime of 11 days" -> Limit is Arrival + 11.
                // We check if TODAY > (Arrival + 11).
                
                $diff = $today->diff($arrivalDate);
                // $diff->days is absolute, check logic:
                // If today is '2026-02-20' and Arrival was '2026-02-01'. 
                // Limit = Feb 12. Today > Feb 12.
                
                // Calculate days passed since arrival
                // We need rigorous check: is $today > $arrivalDate?
                if ($today > $arrivalDate) {
                    $daysSinceArrival = $diff->days;
                    if ($daysSinceArrival > 11) {
                        // IT IS A RISK
                        $port = !empty($row['sea_pod']) ? $row['sea_pod'] : ($row['air_dest'] ?? 'Unknown Port');
                        
                        // Calculate Expiry Date for display
                        $expireDate = clone $arrivalDate;
                        $expireDate->modify('+11 days');
                        
                        $risks[] = [
                            'type' => 'DEMURRAGE',
                            'file_ref' => $ref,
                            'message' => "File <strong>{$ref}</strong> discharged at <strong>{$port}</strong> on {$arrivalDate->format('d/m/Y')}. Free time expired on {$expireDate->format('d/m/Y')}. Exposed to Extra Charges."
                        ];
                        continue; // Move to next row
                    }
                }
            }
        }

        // --- RISK TYPE 2: UNBILLED (Operationally Complete + No Invoice) ---
        // Check 1: Status is Complete AND final_invoice_amount is empty
        if ($status === 'OPERATIONALLY_COMPLETE' && empty($row['final_invoice_amount'])) {
            $service = $row['service_type'];
            $compDateStr = null;

            // Map Service to Date Column
            if ($service === 'SEA_FREIGHT_IMPORT') $compDateStr = $row['m11_completed_at'];
            elseif ($service === 'HINTERLAND_TRANSIT') $compDateStr = $row['m12_completed_at'];
            elseif ($service === 'SEA_FREIGHT_EXPORT') $compDateStr = $row['m10_completed_at'];
            elseif (in_array($service, ['AIR_FREIGHT_IMPORT', 'AIR_FREIGHT_EXPORT'])) $compDateStr = $row['m12_completed_at'];

            if (!empty($compDateStr)) {
                $compDate = new DateTime($compDateStr);
                if ($today > $compDate) {
                    $daysLate = $today->diff($compDate)->days;
                    if ($daysLate > 3) {
                        $place = $row['place_delivery'] ?? 'Unknown Place';
                        $client = $row['client_name'] ?? 'Client';
                        $risks[] = [
                            'type' => 'UNBILLED',
                            'file_ref' => $ref,
                            'message' => "File <strong>{$ref}</strong> delivered to <strong>{$client}</strong> at <strong>{$place}</strong> on {$compDate->format('d/m/Y')}. Unbilled for <strong>{$daysLate} days</strong>."
                        ];
                    }
                }
            } else {
                // Status is COMPLETE but Date is Empty -> Data Integrity Risk?
                // (User said: "If m11 is NULL and status is ... COMPLETE ... flag it")
                $risks[] = [
                    'type' => 'INTEGRITY',
                    'file_ref' => $ref,
                    'message' => "File <strong>{$ref}</strong> is marked COMPLETE but missing completion timestamp for {$service}."
                ];
            }
        }
        
        // --- RISK TYPE 3: INTEGRITY CHECK (Financially Pending / Closed) ---
        // "If ... FINANCIALLY_PENDING or CLOSED and the column is empty flag it"
        if (in_array($status, ['FINANCIALLY_PENDING', 'CLOSED'])) {
            $service = $row['service_type'];
            $compDateStr = null;
            if ($service === 'SEA_FREIGHT_IMPORT') $compDateStr = $row['m11_completed_at'];
            elseif ($service === 'HINTERLAND_TRANSIT') $compDateStr = $row['m12_completed_at'];
            elseif ($service === 'SEA_FREIGHT_EXPORT') $compDateStr = $row['m10_completed_at'];
            elseif (in_array($service, ['AIR_FREIGHT_IMPORT', 'AIR_FREIGHT_EXPORT'])) $compDateStr = $row['m12_completed_at'];

            if (empty($compDateStr)) {
                $risks[] = [
                    'type' => 'INTEGRITY',
                    'file_ref' => $ref,
                    'message' => "File <strong>{$ref}</strong> is {$status} but missing completion timestamp for {$service}."
                ];
            }
        }
    }
    $resRisk->free();

    $critical_risks_count = count($risks);

    // =========================================================================
    // 4. EXECUTIVE SUMMARY & TARGET STATUS LOGIC
    // =========================================================================

    $badgeStatus = 'ON_TRACK';
    $summaryText = '';

    // Logic Rules:
    // 1. Check Revenue & Margin Growth (must be positive/stable)
    // 2. Check Risk Count buckets (<10, 10-20, >20)

    $financesPositive = ($revGrowthPct >= 0 && $marginGrowthPct >= 0);
    
    // --- Determine Badge ---
    if ($critical_risks_count < 10) {
        // Low risk. Check Finances.
        if ($financesPositive) {
            $badgeStatus = 'ON_TRACK';
        } else {
            // "More revenue without margin is not a sign of performance" -> so if margin drops, we are at risk
            $badgeStatus = 'AT_RISK'; 
        }
    } elseif ($critical_risks_count >= 10 && $critical_risks_count <= 20) {
        $badgeStatus = 'AT_RISK';
    } else {
        $badgeStatus = 'OFF_TRACK'; // > 20 risks
    }

    // --- Determine Text ---
    if ($critical_risks_count > 20) {
        $summaryText = "Critical Operational Alert: {$critical_risks_count} risks require immediate intervention. Revenue and Margin are secondary to this operational exposure.";
    } elseif ($critical_risks_count >= 10) {
        $summaryText = "Operational Warning: {$critical_risks_count} active risks detected. Revenue is " . ($revGrowthPct >= 0 ? "holding" : "down") . ". Focus on clearing bottlenecks.";
    } elseif (!$financesPositive) {
        // Risks are low, but money is down
        if ($revGrowthPct >= 0 && $marginGrowthPct < 0) {
            $summaryText = "Revenue is up " . round($revGrowthPct,1) . "%, but Net Margin dropped. Efficiency check required.";
        } else {
            $summaryText = "Performance Cooling: Revenue and Margins are trailing last month. Momentum needed.";
        }
    } else {
        // All Good
        $summaryText = "Excellent Performance: Revenue (+".round($revGrowthPct,1)."%) and Margin (+".round($marginGrowthPct,1)."%) are growing with low operational risk.";
    }

    // Response
    respond(200, [
        'ok' => true,
        // -- Legacy keys for compatibility --
        'total_revenue_xaf' => $curr['revenue'],
        'net_margin_percent' => ($curr['revenue'] > 0) ? ($curr['margin'] / $curr['revenue']) * 100 : 0,
        'active_files' => ['total' => $total_files, 'by_mode' => $by_mode],
        'critical_risks_count' => $critical_risks_count,
        
        // -- NEW KEYS for Round 2 Frontend --
        'financials_detailed' => [
            'current' => $curr,
            'previous' => $prev,
            'rev_growth_pct' => $revGrowthPct,
            'margin_growth_pct' => $marginGrowthPct
        ],
        'status_engine' => [
            'badge' => $badgeStatus,
            'summary' => $summaryText
        ],
        'risk_details' => $risks // The array for the Modal
    ]);

} catch (Throwable $e) {
    respond(500, ['ok' => false, 'error' => $e->getMessage()]);
}