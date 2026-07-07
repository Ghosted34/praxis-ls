<?php
/**
 * FINANCE DASHBOARD - dynamic version (with Smart Comm integrated)
 * - Uses invoice_payment_history for payment-based KPIs
 * - Smart Comm Hub injected (from Admin dashboard)
 */

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['FINANCE']);

$conn = db();

// helper escape
function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }
function fmtAmt($v, $decimals = 0) {
    if ($v === null) return '--';
    return number_format((float)$v, $decimals, '.', ',');
}

// --- current user (safe) ---
$employeeId = (string)($_SESSION['auth']['employee_id'] ?? '');
$userId     = (int)($_SESSION['auth']['user_id'] ?? 0);
if ($employeeId === '' || $userId <= 0) {
    header('Location: ../../api/auth/logout.php');
    exit;
}

$sql = "SELECT em.employee_id, em.full_name, em.email, ua.role, ua.authority_capabilities, ua.last_login
        FROM user_auth ua
        JOIN employee_master em ON em.employee_id = ua.employee_id
        WHERE ua.user_id = ? AND em.employee_id = ?
        LIMIT 1";
$me = null;
if ($stmt = $conn->prepare($sql)) {
    $stmt->bind_param('is', $userId, $employeeId);
    $stmt->execute();
    $me = $stmt->get_result()->fetch_assoc();
    $stmt->close();
}
$fullName = $me['full_name'] ?? 'Finance User';
$firstName = trim(explode(' ', $fullName)[0] ?? 'User');
$role = strtoupper((string)($me['role'] ?? 'FINANCE'));
$avatarUrl = "https://ui-avatars.com/api/?name=" . urlencode($fullName) . "&background=055B83&color=fff";

// ------------------ KPI QUERIES (UPDATED to use invoice_payment_history) ------------------

// 1) Receivables total (sum outstanding balances across invoices not DRAFT)
$receivablesTotal = 0.0;
try {
    $qr = "
      SELECT COALESCE(SUM(GREATEST(0, im.total_xaf - COALESCE(p.paid, im.total_amount_paid_xaf, 0))), 0) AS total_receivable
      FROM invoice_master im
      LEFT JOIN (
        SELECT invoice_id, SUM(amount_paid_xaf) AS paid
        FROM invoice_payment_history
        GROUP BY invoice_id
      ) p ON p.invoice_id = im.invoice_id
      WHERE COALESCE(im.status, '') != 'DRAFT'
    ";
    $res = $conn->query($qr);
    $receivablesTotal = ($res && ($r = $res->fetch_assoc())) ? (float)$r['total_receivable'] : 0.0;
} catch (\Throwable $e) {
    error_log("KPI receivables error: " . $e->getMessage());
    $receivablesTotal = 0.0;
}

// 2) Overdue (> 60 days)
$overdue60 = 0.0;
try {
    $q = "
      SELECT COALESCE(SUM(GREATEST(0, im.total_xaf - COALESCE(p.paid, im.total_amount_paid_xaf, 0))), 0) AS overdue
      FROM invoice_master im
      LEFT JOIN (
        SELECT invoice_id, SUM(amount_paid_xaf) AS paid
        FROM invoice_payment_history
        GROUP BY invoice_id
      ) p ON p.invoice_id = im.invoice_id
      WHERE im.due_date IS NOT NULL
        AND im.due_date < DATE_SUB(CURDATE(), INTERVAL 60 DAY)
        AND (GREATEST(0, im.total_xaf - COALESCE(p.paid, im.total_amount_paid_xaf, 0)) > 0)
    ";
    $res = $conn->query($q);
    $overdue60 = ($res && ($r = $res->fetch_assoc())) ? (float)$r['overdue'] : 0.0;
} catch (\Throwable $e) {
    error_log("KPI overdue error: " . $e->getMessage());
    $overdue60 = 0.0;
}

// 3) Cash In (Month-to-date) - sum of payments recorded in invoice_payment_history with payment_date in current month
$cashInMTD = 0.0;
try {
    $q = "
      SELECT COALESCE(SUM(amount_paid_xaf), 0) AS cash_in_mtd
      FROM invoice_payment_history
      WHERE payment_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
        AND payment_date < DATE_ADD(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 1 MONTH)
    ";
    $res = $conn->query($q);
    $cashInMTD = ($res && ($r = $res->fetch_assoc())) ? (float)$r['cash_in_mtd'] : 0.0;
} catch (\Throwable $e) {
    error_log("KPI cashInMTD error: " . $e->getMessage());
    $cashInMTD = 0.0;
}

// 4) Invoices to Pay (count & total outstanding) - invoices with outstanding > 0 (exclude DRAFT)
$invoicesToPayCount = 0;
$invoicesToPayAmt = 0.0;
try {
    $q = "
      SELECT COUNT(*) AS cnt, COALESCE(SUM(GREATEST(0, im.total_xaf - COALESCE(p.paid, im.total_amount_paid_xaf, 0))),0) AS total_out
      FROM invoice_master im
      LEFT JOIN (
        SELECT invoice_id, SUM(amount_paid_xaf) AS paid
        FROM invoice_payment_history
        GROUP BY invoice_id
      ) p ON p.invoice_id = im.invoice_id
      WHERE COALESCE(im.status, '') NOT IN ('DRAFT')
        AND (GREATEST(0, im.total_xaf - COALESCE(p.paid, im.total_amount_paid_xaf, 0)) > 0)
    ";
    $res = $conn->query($q);
    if ($res && ($r = $res->fetch_assoc())) {
        $invoicesToPayCount = (int)$r['cnt'];
        $invoicesToPayAmt = (float)$r['total_out'];
    }
} catch (\Throwable $e) {
    error_log("KPI invoicesToPay error: " . $e->getMessage());
}

// --- Pending Tasks: cash_request_master (SUBMITTED awaiting finance validation) ---
$pendingTasks = [];
try {
    $qr = "
      SELECT pr_id, created_at, created_by, beneficiary, ops_file_ref, amount_total, status
      FROM cash_request_master
      WHERE status IN ('SUBMITTED','DRAFT') -- consider SUBMITTED as awaiting validation
      ORDER BY created_at DESC
      LIMIT 12
    ";
    $res = $conn->query($qr);
    if ($res) {
        while ($row = $res->fetch_assoc()) {
            $pendingTasks[] = $row;
        }
    }
} catch (\Throwable $e) {
    error_log("pending tasks error: " . $e->getMessage());
}

// --- Receivables aging buckets (by due_date) using dynamic outstanding computation ---
$agingBuckets = [
    '0-30' => 0.0,
    '31-60' => 0.0,
    '61-90' => 0.0,
    '90+' => 0.0,
];
try {
    $qr = "
      SELECT
        SUM(CASE WHEN DATEDIFF(CURDATE(), im.due_date) BETWEEN 0 AND 30 THEN GREATEST(0, im.total_xaf - COALESCE(p.paid, im.total_amount_paid_xaf, 0)) ELSE 0 END) AS b0_30,
        SUM(CASE WHEN DATEDIFF(CURDATE(), im.due_date) BETWEEN 31 AND 60 THEN GREATEST(0, im.total_xaf - COALESCE(p.paid, im.total_amount_paid_xaf, 0)) ELSE 0 END) AS b31_60,
        SUM(CASE WHEN DATEDIFF(CURDATE(), im.due_date) BETWEEN 61 AND 90 THEN GREATEST(0, im.total_xaf - COALESCE(p.paid, im.total_amount_paid_xaf, 0)) ELSE 0 END) AS b61_90,
        SUM(CASE WHEN DATEDIFF(CURDATE(), im.due_date) > 90 THEN GREATEST(0, im.total_xaf - COALESCE(p.paid, im.total_amount_paid_xaf, 0)) ELSE 0 END) AS b90
      FROM invoice_master im
      LEFT JOIN (
        SELECT invoice_id, SUM(amount_paid_xaf) AS paid
        FROM invoice_payment_history
        GROUP BY invoice_id
      ) p ON p.invoice_id = im.invoice_id
      WHERE im.due_date IS NOT NULL
    ";
    $res = $conn->query($qr);
    if ($res && ($r = $res->fetch_assoc())) {
        $agingBuckets['0-30'] = (float)$r['b0_30'];
        $agingBuckets['31-60'] = (float)$r['b31_60'];
        $agingBuckets['61-90'] = (float)$r['b61_90'];
        $agingBuckets['90+'] = (float)$r['b90'];
    }
} catch (\Throwable $e) {
    error_log("aging buckets error: " . $e->getMessage());
}

// --- Recent activity (union invoice / cash_request events) ---
$activity = [];
try {
    // invoice events: created_at, approved_at, approved_by_user_id
    $qInvoice = "
      SELECT 
        'invoice' AS type,
        invoice_no AS reference,
        client_name_cached AS party,
        COALESCE(approved_at, created_at) AS ts,
        CASE 
          WHEN approved_at IS NOT NULL THEN CONCAT('Invoice ', invoice_no, ' approved')
          ELSE CONCAT('Invoice ', invoice_no, ' created')
        END AS message
      FROM invoice_master
      ORDER BY COALESCE(approved_at, created_at) DESC
      LIMIT 8
    ";
    $res = $conn->query($qInvoice);
    if ($res) {
        while ($r = $res->fetch_assoc()) {
            $activity[] = [
                'ts' => $r['ts'],
                'title' => $r['message'],
                'meta' => $r['party']
            ];
        }
    }

    // cash request events: created_at, validated_at, rejected_at, approved_at
    $qCR = "
      SELECT 
        pr_id, beneficiary, created_at, validated_at, rejected_at, approved_at
      FROM cash_request_master
      ORDER BY GREATEST(
        COALESCE(validated_at,'0000-00-00 00:00:00'),
        COALESCE(rejected_at,'0000-00-00 00:00:00'),
        COALESCE(approved_at,'0000-00-00 00:00:00'),
        COALESCE(created_at,'0000-00-00 00:00:00')
      ) DESC
      LIMIT 8
    ";
    $res = $conn->query($qCR);
    if ($res) {
        while ($r = $res->fetch_assoc()) {
            if (!empty($r['approved_at'])) {
                $ts = $r['approved_at'];
                $msg = "Cash Request {$r['pr_id']} approved for {$r['beneficiary']}";
            } elseif (!empty($r['validated_at'])) {
                $ts = $r['validated_at'];
                $msg = "Cash Request {$r['pr_id']} validated";
            } elseif (!empty($r['rejected_at'])) {
                $ts = $r['rejected_at'];
                $msg = "Cash Request {$r['pr_id']} rejected";
            } else {
                $ts = $r['created_at'];
                $msg = "Cash Request {$r['pr_id']} created";
            }
            $activity[] = [
                'ts' => $ts,
                'title' => $msg,
                'meta' => $r['beneficiary']
            ];
        }
    }

    // sort activity by ts desc and limit 10
    usort($activity, function($a,$b){
        $ta = strtotime($a['ts'] ?? 0);
        $tb = strtotime($b['ts'] ?? 0);
        return $tb <=> $ta;
    });
    $activity = array_slice($activity, 0, 10);
} catch (\Throwable $e) {
    error_log("activity fetch error: " . $e->getMessage());
}

// Finished queries, output HTML below
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Finance Dashboard | Smart LS</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
     <link rel="stylesheet" href="../../css/admin.css">
    <style>
        :root {
            --smart-blue: #1F99D8;
            --smart-dark: #055B83;
            --smart-orange: #EE7D04;
            --smart-charcoal: #231F20;
            --smart-bg: #F0F4F8;
            --sidebar-width: 260px;
        }
        body { font-family: 'Manrope', sans-serif; background-color: var(--smart-bg); color: var(--smart-charcoal); overflow-x: hidden; }
        h1,h2,h3,h4,h5,h6 { font-family: 'Montserrat', sans-serif; }
        .sidebar { width: var(--sidebar-width); height: 100vh; position: fixed; top:0; left:0; background:#fff; border-right:1px solid #e0e0e0; z-index:1000; display:flex; flex-direction:column; }
        .sidebar-header { height:70px; display:flex; align-items:center; padding:0 20px; border-bottom:1px solid #f0f0f0; }
        .brand-logo { font-weight:800; font-size:1.1rem; color:var(--smart-charcoal); text-decoration:none; }
        .sidebar-menu { overflow-y:auto; flex-grow:1; padding:10px 0; }
        .menu-btn { width:100%; text-align:left; background:none; border:none; padding:12px 20px; font-size:.8rem; font-weight:700; color:#555; display:flex; justify-content:space-between; align-items:center; }
        .sub-link { display:block; padding:8px 20px 8px 48px; font-size:.75rem; color:#666; text-decoration:none; font-weight:500; }
        .sidebar-footer { border-top:1px solid #f0f0f0; padding:16px; }
        .main-content { margin-left: var(--sidebar-width); padding-top: 70px; min-height:100vh; width:calc(100% - var(--sidebar-width)); }
        .top-navbar { height:70px; position:fixed; top:0; right:0; left:var(--sidebar-width); background-color: rgba(255,255,255,0.95); backdrop-filter: blur(12px); border-bottom:1px solid #e0e0e0; z-index:900; padding:0 30px; display:flex; align-items:center; justify-content:space-between; }
        .welcome-card { background: linear-gradient(135deg,var(--smart-dark) 0%, #022c43 100%); color: white; border-radius:12px; padding:1.5rem 2rem; position:relative; overflow:hidden; box-shadow:0 10px 30px rgba(5,91,131,.2); width:100%; }
        .card-custom { background:white; border-radius:12px; border:1px solid rgba(0,0,0,0.05); box-shadow:0 2px 12px rgba(0,0,0,0.02); height:100%; transition: transform .2s; }
        .kpi-title { font-size:.7rem; font-weight:700; text-transform:uppercase; color:#888; letter-spacing:.5px; white-space:nowrap; }
        .kpi-value { font-size:1.6rem; font-weight:800; color:var(--smart-charcoal); line-height:1.2; font-variant-numeric: tabular-nums; }
        .currency { font-size:.9rem; color:#888; font-weight:600; margin-left:4px; }
        .table-custom th { font-size:.75rem; text-transform:uppercase; color:#888; font-weight:700; border-bottom:2px solid #f0f0f0; }
        .table-custom td { font-size:.85rem; vertical-align: middle; padding:12px 8px; }
        .clock-pill { background:#f1f5f9; padding:6px 12px; border-radius:30px; display:flex; align-items:center; gap:10px; font-size:.85rem; font-weight:600; color:var(--smart-dark); }
        .btn-clock { background:#e2e8f0; border:none; border-radius:20px; padding:4px 12px; font-size:.75rem; font-weight:700; color:#64748b; transition:.3s; }
        .btn-clock.active { background:var(--smart-orange); color:white; box-shadow:0 2px 10px rgba(238,125,4,.3); }
        .log-container { max-height:250px; overflow-y:auto; padding-right:5px; }

        /* --- Smart Comm CSS (copied from Admin) --- */
        :root{
          --comm-w: min(520px, 92vw);
          --comm-radius: 18px;
          --comm-shadow: 0 20px 60px rgba(0,0,0,.18);
          --comm-ink: #0f172a;
          --comm-muted: rgba(15, 23, 42, .65);
          --comm-accent1: #0b5ed7;
          --comm-accent2: #ff6600;
          --comm-accent3: #20c997;
        }
        .smart-comm-btn{
          background: linear-gradient(135deg, rgba(11,94,215,.22), rgba(255,102,0,.18));
          border: 1px solid rgba(255,255,255,.42);
          color: #fff;
          padding: 10px 22px;
          border-radius: 999px;
          font-weight: 800;
          letter-spacing: .4px;
          display: inline-flex;
          align-items: center;
          gap: 10px;
          box-shadow: 0 12px 26px rgba(0,0,0,.14);
          backdrop-filter: blur(10px);
          transition: transform .15s ease, box-shadow .15s ease, filter .15s ease;
          position: relative;
        }
        .smart-comm-btn:hover{
          transform: translateY(-1px);
          box-shadow: 0 16px 34px rgba(0,0,0,.18);
          filter: brightness(1.06);
        }
        .comm-badge{
          position: absolute;
          top: -6px;
          right: -6px;
          min-width: 22px;
          height: 22px;
          padding: 0 6px;
          border-radius: 999px;
          display: none;
          align-items: center;
          justify-content: center;
          font-size: .72rem;
          font-weight: 900;
          background: #ff3333;
          border: 2px solid rgba(255,255,255,.85);
          box-shadow: 0 8px 18px rgba(255,51,51,.30);
        }
        body.chat-active { overflow: hidden; }
        .comm-backdrop{
          position: fixed;
          inset: 0;
          z-index: 1029;
          background:
            radial-gradient(1200px 800px at 85% 20%, rgba(255,102,0,.22), transparent 60%),
            radial-gradient(1000px 700px at 70% 85%, rgba(11,94,215,.20), transparent 60%),
            rgba(0,0,0,.25);
          opacity: 0;
          pointer-events: none;
          transition: opacity .25s ease;
          backdrop-filter: blur(2px);
        }
        body.chat-active .comm-backdrop{
          opacity: 1;
          pointer-events: auto;
        }
        .comm-drawer{
          position: fixed;
          top: 0;
          right: 0;
          width: var(--comm-w);
          height: 100vh;
          z-index: 1030;
          transform: translateX(110%);
          transition: transform .32s cubic-bezier(.2,.9,.2,1);
          border-left: 1px solid rgba(255,255,255,.20);
          box-shadow: var(--comm-shadow);
          overflow: hidden;
          border-top-left-radius: var(--comm-radius);
          border-bottom-left-radius: var(--comm-radius);
          background:
            radial-gradient(900px 600px at 15% 10%, rgba(32,201,151,.22), transparent 60%),
            radial-gradient(900px 600px at 90% 20%, rgba(255,102,0,.18), transparent 55%),
            radial-gradient(1200px 900px at 60% 90%, rgba(11,94,215,.18), transparent 60%),
            linear-gradient(135deg, rgba(255,255,255,.82), rgba(255,255,255,.62));
          backdrop-filter: blur(14px);
        }
        body.chat-active .comm-drawer{ transform: translateX(0); }
        .comm-content{ height: 100%; display: flex; flex-direction: column; }
        .comm-header{
          position: relative;
          padding: 14px 14px;
          border-bottom: 1px solid rgba(15, 23, 42, .08);
          background:
            linear-gradient(90deg, rgba(11,94,215,.14), rgba(255,102,0,.12), rgba(32,201,151,.10)),
            rgba(255,255,255,.55);
          backdrop-filter: blur(10px);
        }
        .comm-header::after{
          content:'';
          position:absolute;
          left:14px; right:14px; bottom:-1px;
          height:2px;
          background: linear-gradient(90deg, var(--comm-accent1), var(--comm-accent2), var(--comm-accent3));
          opacity:.9;
        }
        .comm-icon-badge{
          width: 42px;
          height: 42px;
          border-radius: 14px;
          display:flex;
          align-items:center;
          justify-content:center;
          color: white;
          background: linear-gradient(135deg, var(--comm-accent1), var(--comm-accent2));
          box-shadow: 0 10px 25px rgba(11,94,215,.20);
        }
        .comm-close-btn{
          width: 38px;
          height: 38px;
          border-radius: 14px;
          border: 1px solid rgba(15, 23, 42, .10);
          background: rgba(255,255,255,.55);
          backdrop-filter: blur(10px);
          box-shadow: 0 8px 18px rgba(0,0,0,.08);
        }
        .comm-modes{
          display:flex;
          gap: 8px;
          padding: 10px 14px;
          border-bottom: 1px solid rgba(15, 23, 42, .08);
          background: rgba(255,255,255,.35);
        }
        .mode-pill{
          border: 1px solid rgba(15, 23, 42, .12);
          background: rgba(255,255,255,.60);
          backdrop-filter: blur(10px);
          border-radius: 999px;
          padding: 7px 12px;
          font-weight: 900;
          font-size: .78rem;
          color: rgba(15,23,42,.72);
          cursor:pointer;
          transition: transform .12s ease, box-shadow .12s ease;
        }
        .mode-pill.active{
          color: #0b1b33;
          border-color: rgba(255,102,0,.35);
          background: linear-gradient(135deg, rgba(11,94,215,.14), rgba(255,102,0,.10));
        }
        .chat-top-search{ padding: 12px 14px; border-bottom: 1px solid rgba(15, 23, 42, .08); background: rgba(255,255,255,.45); backdrop-filter: blur(10px); }
        .global-search-input{ border: 1px solid rgba(15, 23, 42, .12); border-radius: 999px; padding: 8px 14px; width: 100%; font-size: .9rem; background: rgba(255,255,255,.70); outline: none; }
        .channel-tabs{ display:flex; flex-wrap: wrap; gap: 10px; padding: 10px 14px; border-bottom: 1px solid rgba(15, 23, 42, .08); background: rgba(255,255,255,.35); }
        .channel-box{ border: 1px solid rgba(15, 23, 42, .12); background: rgba(255,255,255,.65); border-radius: 14px; padding: 10px 12px; font-weight: 900; letter-spacing: .2px; font-size: .82rem; color: rgba(15,23,42,.78); cursor: pointer; transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease, filter .12s ease; }
        .channel-box:hover{ transform: translateY(-1px); box-shadow: 0 12px 22px rgba(0,0,0,.10); border-color: rgba(255,102,0,.25); filter: brightness(1.02); }
        .channel-box.active{ color: #0b1b33; border-color: rgba(255,102,0,.35); background: linear-gradient(135deg, rgba(11,94,215,.16), rgba(255,102,0,.10)); }
        .channel-skeleton{ width: 46%; min-width: 160px; height: 40px; border-radius: 14px; border: 1px solid rgba(15, 23, 42, .10); background: linear-gradient(90deg, rgba(255,255,255,.45), rgba(255,255,255,.70), rgba(255,255,255,.45)); background-size: 200% 100%; animation: shimmer 1.2s infinite linear; }
        @keyframes shimmer{ 0%{background-position: 0 0;} 100%{background-position: -200% 0;} }
        .messages-scroll-area{ flex:1; overflow-y:auto; padding: 14px; display:flex; flex-direction: column; gap: 12px; }
        .msg-row{ display:flex; gap: 10px; align-items:flex-start; }
        .msg-row.mine{ flex-direction: row-reverse; }
        .msg-avatar{ width: 36px; height: 36px; border-radius: 12px; object-fit: cover; box-shadow: 0 8px 18px rgba(0,0,0,.10); }
        .msg-bubble{ background: rgba(255,255,255,.78); backdrop-filter: blur(10px); border: 1px solid rgba(15,23,42,.08); padding: 12px; border-radius: 14px; border-top-left-radius: 4px; box-shadow: 0 10px 18px rgba(0,0,0,.06); font-size: .9rem; max-width: 85%; }
        .msg-row.mine .msg-bubble{ background: linear-gradient(135deg, rgba(11,94,215,.92), rgba(0,33,71,.92)); color: #fff; border-top-left-radius: 14px; border-top-right-radius: 4px; border-color: rgba(255,255,255,.12); }
        .msg-meta{ font-size: .72rem; color: rgba(15,23,42,.55); margin-top: 4px; }
        .msg-row.mine .msg-meta{ text-align: right; color: rgba(255,255,255,.72); }
        .urgency-badge{ font-size: .62rem; padding: 2px 6px; border-radius: 6px; font-weight: 900; letter-spacing: .4px; text-transform: uppercase; margin-bottom: 4px; display: inline-block; }
        .urgency-critical{ background: #dc3545; color: #fff; }
        .urgency-urgent{ background: #ffc107; color: #1f2937; }
        .msg-row.critical .msg-bubble{ border: 2px solid #dc3545; animation: critical-pulse 1.5s infinite; }
        @keyframes critical-pulse{ 0% { box-shadow: 0 0 0 0 rgba(220,53,69,.40); } 70% { box-shadow: 0 0 0 10px rgba(0,0,0,0); } 100% { box-shadow: 0 0 0 0 rgba(0,0,0,0); } }
        .chat-input-zone{ padding: 12px 12px 14px; border-top: 1px solid rgba(15, 23, 42, .08); background: rgba(255,255,255,.55); backdrop-filter: blur(12px); }
        .input-wrapper{ border-radius: 18px; border: 1px solid rgba(15, 23, 42, .12); background: rgba(255,255,255,.65); display:flex; align-items:flex-end; gap: 8px; padding: 8px 10px; }
        .chat-textarea{ width:100%; border:none; outline:none; background: transparent; resize:none; min-height: 42px; max-height: 120px; padding: 6px 8px; font-size: .92rem; color: var(--comm-ink); }
        .msg-bubble .fw-bold{ color: rgba(15, 23, 42, .92) !important; font-weight: 900 !important; letter-spacing: .2px; }
        .msg-row.mine .msg-bubble .fw-bold{ color: rgba(255, 255, 255, .92) !important; }

        /* DM user list styling + single line horizontal scroll patch (from Admin) */
        .channel-box {
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: flex-start;
            line-height: 1.3;
            min-height: 52px;
        }
        .channel-box .small {
            font-weight: 500 !important;
            opacity: 0.8;
            letter-spacing: 0.3px;
            margin-top: 2px;
        }
        .msg-bubble button.btn-outline-danger {
            border-width: 2px;
            font-size: 0.75rem;
            box-shadow: 0 4px 6px rgba(220, 53, 69, 0.1);
            transition: all 0.2s ease;
        }
        .msg-bubble button.btn-outline-danger:hover {
            transform: translateY(-1px);
            box-shadow: 0 6px 10px rgba(220, 53, 69, 0.2);
        }
        .channel-tabs {
            display: flex;
            flex-wrap: nowrap !important;
            overflow-x: auto;
            overflow-y: hidden;
            gap: 8px;
            padding: 10px 14px;
            border-bottom: 1px solid rgba(15, 23, 42, .08);
            scrollbar-width: none;
        }
        .channel-tabs::-webkit-scrollbar { display: none; }
        .channel-box {
            flex: 0 0 auto;
            min-width: 140px;
            max-width: 140px;
            height: 48px;
            padding: 0 10px;
            display: flex;
            flex-direction: column;
            justify-content: center;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
    </style>
</head>
<body>
  <nav class="sidebar">
    <div class="sidebar-header">
        <a href="index.php" class="brand-logo"><i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span></a>
    </div>

    <div class="px-3 mb-2 mt-2">
        <a href="index.php" class="btn btn-primary w-100 text-start d-flex align-items-center" style="background-color: transparent; color: inherit; border: none; padding-left: 0;">
            <i class="fa-solid fa-house category-icon me-2"></i> 
            <span class="fw-bold">Finance Dashboard</span> 
        </a>
    </div>

    <div class="sidebar-menu accordion" id="financeMenu">
        
        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#fin1">
                <span><i class="fa-solid fa-database category-icon"></i>MASTER DATA MGMT</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="fin1" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                <div class="sub-menu">
                    <a href="client-master-registry.php" class="sub-link">Client Master Registry</a>
                    <a href="supplier-master-registry.php" class="sub-link">Supplier Master Registry</a>
                    <a href="employee-master.php" class="sub-link">Employee Master Registry</a>
                    <a href="financial-dictionary copy.php" class="sub-link">Financial Dictionary</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#fin2">
                <span><i class="fa-solid fa-users category-icon"></i>CRM & ACQUISITION</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="fin2" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                <div class="sub-menu">
                    <a href="partnership-portal-intake.php" class="sub-link">Partnership Portal Intake</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#fin3">
                <span><i class="fa-solid fa-calculator category-icon"></i>COMMERCIAL & PRICING</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="fin3" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                <div class="sub-menu">
                    <a href="margin-simulator-billing.php" class="sub-link">Margin Simulator & Pricing System</a>
                    <a href="extra-charges-simulator.php" class="sub-link">Extra Charges Simulator</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#fin4">
                <span><i class="fa-solid fa-truck-fast category-icon"></i>LOGISTICS OPERATIONS</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="fin4" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                <div class="sub-menu">
                    <a href="operations-registry.php" class="sub-link">Operations File Registry</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#fin5">
                <span><i class="fa-solid fa-chart-line category-icon"></i>JOB COST CONTROL</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="fin5" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                <div class="sub-menu">
                    <a href="costing-module.php" class="sub-link">Costing Module</a>
                    <a href="cost-tracking.php" class="sub-link">Cost Tracking Master</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#fin6">
                <span><i class="fa-solid fa-building-columns category-icon"></i>FINANCE & TREASURY</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="fin6" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                <div class="sub-menu">
                    <a href="cash-request.php" class="sub-link">Cash Request</a>
                    <a href="purchase-order.php" class="sub-link">Purchase Order</a>
                    <a href="proforma-invoice-portal.php" class="sub-link">Proforma Invoice Portal</a>
                    <a href="final-invoice-portal.php" class="sub-link">Final Invoice System</a>
                    <a href="smart-receivable.php" class="sub-link">Smart Receivables Ledger (SRL)</a>
                    <a href="debt-management.php" class="sub-link">Debt Management</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#fin7">
                <span><i class="fa-solid fa-folder-open category-icon"></i>HR & ARCHIVE</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="fin7" class="accordion-collapse collapse" data-bs-parent="#financeMenu">
                <div class="sub-menu">
                    <a href="payroll-management.php" class="sub-link">Payroll Management</a>
                    <a href="attendance-logs.php" class="sub-link">Attendance & Time Logging</a>
                    <a href="documents-vault.php" class="sub-link">Documents Vault</a>
                </div>
            </div>
        </div>

    </div>

    <div class="sidebar-footer">
        <a class="btn btn-outline-danger w-100 btn-sm fw-bold" href="../../api/auth/logout.php">
            <i class="fa-solid fa-right-from-bracket me-2"></i> Sign Out
        </a>
    </div>
</nav>


    <div class="top-navbar">
        <div>
            <h5 class="mb-0 fw-bold text-dark">Finance Control</h5>
            <small class="text-muted" style="font-size:.7rem;">FINANCIAL CONTROL & REPORTING</small>
        </div>
        <div class="d-flex align-items-center gap-4">
            <div class="clock-pill">
      <span id="realtime-clock" style="font-family: monospace;">12:00:00</span>
      <button class="btn-clock" id="btn-clock" onclick="toggleClock()">
        <i class="fa-solid fa-fingerprint"></i> <span>Clock In</span>
      </button>
    </div>
            <div class="d-flex align-items-center gap-3 ps-3 border-start">
                <div class="text-end lh-1 d-none d-md-block">
                    <div class="fw-bold fs-6"><?php echo e($fullName); ?></div>
                    <small class="text-secondary fw-bold" style="font-size:.65rem; letter-spacing:.5px;"><?php echo e($role); ?></small>
                </div>
                <img src="<?php echo e($avatarUrl); ?>" class="rounded-circle shadow-sm" width="38" height="38" alt="<?php echo e($firstName); ?>">
            </div>
        </div>
    </div>

    <div class="main-content px-4 pb-5">
        <div class="row pt-4 mb-4">
            <div class="col-12">
                <div class="welcome-card d-flex justify-content-between align-items-center">
                    <div>
                        <h2 class="fw-bold mb-1">Good morning, <?php echo e($firstName); ?>!</h2>
                        <p class="mb-0 opacity-75">Control and assure Smart Logistic's Financial & Fiscal Health.</p>
                    </div>
                    <!-- Smart Comm button (inserted) -->
                    <div class="mx-3">
                        <button type="button" onclick="toggleChat()" class="smart-comm-btn">
                            <i class="fa-solid fa-satellite-dish fs-5"></i>
                            <span>SMART COMM HUB</span>
                            <div class="comm-badge" id="commBadge">0</div>
                        </button>
                    </div>
                    <div class="text-end" style="min-width:150px;">
                        <div class="mb-1 text-uppercase text-white-50" style="font-size:.7rem; font-weight:800;">Period Status</div>
                        
                        <div class="d-flex align-items-center justify-content-end gap-2">
                            <i class="fa-solid fa-lock-open text-info fs-5"></i>
                            <span class="fw-bold fs-5">OCT OPEN</span>
                        </div>
                    </div>

                    
                </div>
            </div>
        </div>

        <!-- KPI Row -->
        <div class="row g-3 mb-4">
            <div class="col-3">
                <div class="card-custom p-3 d-flex align-items-center">
                    <div class="me-3 rounded-3 bg-warning bg-opacity-10 text-warning d-flex align-items-center justify-content-center" style="width:45px;height:45px;font-size:1.2rem;">
                        <i class="fa-solid fa-hourglass-half"></i>
                    </div>
                    <div>
                        <div class="kpi-title">Receivables</div>
                        <div class="kpi-value"><?php echo fmtAmt($receivablesTotal,0); ?> <span class="currency">XAF</span></div>
                    </div>
                </div>
            </div>

            <div class="col-3">
                <div class="card-custom p-3 d-flex align-items-center">
                    <div class="me-3 rounded-3 bg-danger bg-opacity-10 text-danger d-flex align-items-center justify-content-center" style="width:45px;height:45px;font-size:1.2rem;">
                        <i class="fa-solid fa-circle-exclamation"></i>
                    </div>
                    <div>
                        <div class="kpi-title">Overdue (&gt;60d)</div>
                        <div class="kpi-value text-danger"><?php echo fmtAmt($overdue60,0); ?> <span class="currency">XAF</span></div>
                    </div>
                </div>
            </div>

            <div class="col-3">
                <div class="card-custom p-3 d-flex align-items-center">
                    <div class="me-3 rounded-3 bg-success bg-opacity-10 text-success d-flex align-items-center justify-content-center" style="width:45px;height:45px;font-size:1.2rem;">
                        <i class="fa-solid fa-sack-dollar"></i>
                    </div>
                    <div>
                        <div class="kpi-title">Cash In (MTD)</div>
                        <div class="kpi-value text-success"><?php echo fmtAmt($cashInMTD,0); ?> <span class="currency">XAF</span></div>
                    </div>
                </div>
            </div>

            <div class="col-3">
                <div class="card-custom p-3 d-flex align-items-center">
                    <div class="me-3 rounded-3 bg-primary bg-opacity-10 text-primary d-flex align-items-center justify-content-center" style="width:45px;height:45px;font-size:1.2rem;">
                        <i class="fa-solid fa-file-invoice"></i>
                    </div>
                    <div>
                        <div class="kpi-title">Invoices to Pay</div>
                        <div class="kpi-value"><?php echo (int)$invoicesToPayCount; ?> <span class="currency" style="font-weight:400;font-size:.75rem;">(<?php echo fmtAmt($invoicesToPayAmt,0); ?>)</span></div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Pending Tasks -->
        <div class="row mb-4">
            <div class="col-12">
                <div class="card-custom p-4">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <h5 class="fw-bold mb-0 text-dark"><i class="fa-solid fa-list-check text-primary me-2"></i>Pending Finance Tasks</h5>
                        <a href="cash-requests.php" class="btn btn-sm btn-light border text-muted fw-bold">View All</a>
                    </div>
                    <div class="table-responsive">
                        <table class="table table-hover table-custom mb-0">
                            <thead class="bg-light">
                                <tr>
                                    <th style="width:15%;">Date</th>
                                    <th style="width:25%;">Requestor / File</th>
                                    <th style="width:40%;">Task Description</th>
                                    <th style="width:10%;" class="text-end">Amount</th>
                                    <th style="width:10%;" class="text-end">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                <?php if (count($pendingTasks) === 0): ?>
                                    <tr><td colspan="5" class="text-center text-muted py-4">No pending requests found.</td></tr>
                                <?php else: ?>
                                    <?php foreach ($pendingTasks as $t): ?>
                                        <tr>
                                            <td class="text-muted"><?php echo e($t['created_at'] ? date('M d, Y', strtotime($t['created_at'])) : '—'); ?></td>
                                            <td>
                                                <span class="fw-bold"><?php echo e($t['created_by'] ?: 'Ops'); ?></span>
                                                <small class="text-muted d-block"><?php echo e($t['ops_file_ref'] ?: '—'); ?></small>
                                            </td>
                                            <td>
                                                <span class="badge bg-warning text-dark me-2"><?php echo e($t['status']); ?></span>
                                                <?php echo e('Cash request for ' . ($t['beneficiary'] ?: '—')); ?>
                                            </td>
                                            <td class="text-end fw-bold"><?php echo fmtAmt($t['amount_total'],0); ?></td>
                                            <td class="text-end">
                                                <!-- redirect to cash-request.php and request modal open -->
                                                <a href="cash-request.php?id=<?php echo urlencode($t['pr_id']); ?>&openModal=1" class="btn btn-sm btn-primary py-0 px-3" style="font-size:.75rem;">Open</a>
                                            </td>
                                        </tr>
                                    <?php endforeach; ?>
                                <?php endif; ?>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>

        <!-- Receivables aging + Activity -->
        <div class="row mb-4">
            <div class="col-6">
                <div class="card-custom p-4">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <h5 class="fw-bold mb-0 text-dark"><i class="fa-solid fa-chart-pie text-primary me-2"></i>Receivables Risk Profile (Aging)</h5>
                        <h6 class="fw-bold mb-0"><?php echo fmtAmt($receivablesTotal,0); ?> XAF</h6>
                    </div>
                    <div class="mb-2">
                        <div class="d-flex justify-content-between">
                            <small>0-30 days</small><strong><?php echo fmtAmt($agingBuckets['0-30'],0); ?> XAF</strong>
                        </div>
                        <div class="d-flex justify-content-between">
                            <small>31-60 days</small><strong><?php echo fmtAmt($agingBuckets['31-60'],0); ?> XAF</strong>
                        </div>
                        <div class="d-flex justify-content-between">
                            <small>61-90 days</small><strong><?php echo fmtAmt($agingBuckets['61-90'],0); ?> XAF</strong>
                        </div>
                        <div class="d-flex justify-content-between">
                            <small>> 90 days</small><strong><?php echo fmtAmt($agingBuckets['90+'],0); ?> XAF</strong>
                        </div>
                    </div>
                    <div style="height:260px">
                        <canvas id="receivablesChart"></canvas>
                    </div>
                </div>
            </div>

            <div class="col-6">
                <div class="card-custom p-4">
                    <h5 class="fw-bold mb-3 text-dark"><i class="fa-solid fa-clock-rotate-left text-primary me-2"></i>Recent Activity</h5>
                    <div class="log-container">
                        <?php if (count($activity) === 0): ?>
                            <div class="text-muted">No recent activity.</div>
                        <?php else: ?>
                            <?php foreach ($activity as $act): ?>
                                <div class="d-flex gap-3 mb-3 border-bottom pb-3">
                                    <div class="rounded-circle bg-info bg-opacity-10 text-info d-flex align-items-center justify-content-center flex-shrink-0" style="width:36px;height:36px;">
                                        <i class="fa-solid fa-clock"></i>
                                    </div>
                                    <div class="flex-grow-1">
                                        <div class="d-flex justify-content-between">
                                            <p class="mb-0 fw-bold text-dark fs-6"><?php echo e($act['title']); ?></p>
                                            <small class="text-muted"><?php echo e($act['ts'] ? date('M d, Y H:i', strtotime($act['ts'])) : '—'); ?></small>
                                        </div>
                                        <p class="text-muted mb-0" style="font-size:.85rem;"><?php echo e($act['meta'] ?? ''); ?></p>
                                    </div>
                                </div>
                            <?php endforeach; ?>
                        <?php endif; ?>
                    </div>
                </div>
            </div>
        </div>

    </div> <!-- main-content -->

    <!-- Smart Comm Backdrop (inserted) -->
    <div class="comm-backdrop" id="commBackdrop" onclick="toggleChat(false)"></div>

    <!-- Smart Comm Drawer (inserted) -->
    <div class="comm-drawer" id="commDrawer">
      <div class="comm-content">

        <div class="comm-header d-flex justify-content-between align-items-center">
          <div class="d-flex align-items-center gap-3">
            <div class="comm-icon-badge">
              <i class="fa-solid fa-satellite-dish"></i>
            </div>
            <div>
              <div id="commDrawerTitle" class="fw-bold" style="color: var(--smart-blue); font-size: 1.02rem;">Communication Hub</div>
              <div class="d-flex align-items-center gap-2" style="font-size: 0.75rem;">
                <span class="badge bg-success rounded-pill" style="width: 8px; height: 8px; padding: 0;"></span>
                <span class="text-muted">Connected (Live)</span>
              </div>
            </div>
          </div>
          <button type="button" class="comm-close-btn" onclick="toggleChat(false)" aria-label="Close">
            <i class="fa-solid fa-times"></i>
          </button>
        </div>

        <div class="comm-modes">
          <button type="button" class="mode-pill active" id="commModeChannels">CHANNELS</button>
          <button type="button" class="mode-pill" id="commModeDm">DIRECT MESSAGES</button>
        </div>

        <div class="chat-top-search">
          <input type="text" class="global-search-input" id="commSearch" placeholder="Filter loaded messages..." />
        </div>

        <div class="channel-tabs" id="channelTabs">
          <div class="channel-skeleton"></div>
          <div class="channel-skeleton"></div>
          <div class="channel-skeleton"></div>
          <div class="channel-skeleton"></div>
          <div class="channel-skeleton"></div>
        </div>

        <div class="messages-scroll-area" id="chatFeed">
          <div class="text-center mt-4 opacity-75">
            <div class="spinner-border text-primary" role="status"></div>
            <div class="mt-2 small">Connecting to secure server...</div>
          </div>
        </div>

        <div class="chat-input-zone">
          <div class="input-wrapper">
            <textarea class="chat-textarea" id="chatInput" placeholder="Type a message..."></textarea>
            <div class="d-flex align-items-center gap-2 p-1">
              <select class="form-select form-select-sm border-0 bg-transparent fw-bold text-secondary" style="width: auto;" id="urgencySelect">
                <option value="NORMAL">Normal</option>
                <option value="URGENT">Urgent</option>
                <option value="CRITICAL" class="text-danger">CRITICAL</option>
              </select>
              <button type="button" class="btn btn-primary btn-sm rounded-circle" onclick="sendMessage()" style="width: 35px; height: 35px;">
                <i class="fa-solid fa-paper-plane"></i>
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    <script src="../../js/admin.js"></script>
    <!-- Optional: Chart.js to render receivables chart client-side -->
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <!-- Smart Comm Core -->
    <script src="../../js/smart-comm-core.js?v=4.0"></script>
    <script>
    
        

        // Render receivables pie chart
        (function(){
            try {
                const canvas = document.getElementById('receivablesChart');
                if (!canvas) return;
                const ctx = canvas.getContext('2d');
                const data = {
                    labels: ['0-30', '31-60', '61-90', '90+'],
                    datasets: [{
                        data: [
                          <?php echo (float)$agingBuckets['0-30']; ?>,
                          <?php echo (float)$agingBuckets['31-60']; ?>,
                          <?php echo (float)$agingBuckets['61-90']; ?>,
                          <?php echo (float)$agingBuckets['90+']; ?>
                        ]
                    }]
                };
                new Chart(ctx, {
                    type: 'doughnut',
                    data: data,
                    options: {
                        plugins: { legend: { position: 'bottom' } },
                        responsive: true,
                        maintainAspectRatio: false
                    }
                });
            } catch (err) {
                console.error('Chart error', err);
            }
        })();
    </script>

    

    <script>
      // toggleChat implementation (safe, same as Admin)
      function toggleChat(forceState) {
        try {
          const open = (typeof forceState === 'boolean')
            ? forceState
            : !document.body.classList.contains('chat-active');

          document.body.classList.toggle('chat-active', open);

          if (open) {
            setTimeout(() => {
              const input = document.getElementById('chatInput');
              if (input) input.focus();
            }, 120);

            // Hide badge when opened
            const badge = document.getElementById('commBadge');
            if (badge) badge.style.display = 'none';
          }
        } catch (e) {
          console.error('toggleChat error:', e);
        }
      }

      // Esc closes drawer
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && document.body.classList.contains('chat-active')) {
          toggleChat(false);
        }
      });

      // Prevent backdrop close when clicking inside drawer
      (function () {
        const drawer = document.getElementById('commDrawer');
        if (drawer) drawer.addEventListener('click', function (ev) { ev.stopPropagation(); });
      })();

      
    </script>
</body>
</html>
