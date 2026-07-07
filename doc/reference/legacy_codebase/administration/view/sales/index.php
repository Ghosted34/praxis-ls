<?php
declare(strict_types=1);

/**
 * sales-dashboard-merged.php
 * Merged: took sidebar, topbar, and name section + styling from the provided "first code"
 * and integrated them into the sales dashboard (second code).
 */

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

// enforce role(s) - adjust as required
require_role(['SALES','MANAGEMENT','ADMIN']);

$conn = db();
$conn->set_charset('utf8mb4');

function e($v) { return htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8'); }

// --- Pull name/role/avatar/greeting logic inspired from the first file ---
$fullName = trim($_SESSION['auth']['full_name'] ?? ($_SESSION['auth']['username'] ?? 'Sales User'));
$firstName = trim(explode(' ', $fullName)[0] ?? 'User');
$role = strtoupper((string)($_SESSION['auth']['role'] ?? 'SALES'));
$roleLabelMap = [
  'ADMIN'      => 'SYSTEM ADMIN',
  'FINANCE'    => 'FINANCE',
  'SALES'      => 'SALES',
  'OPERATIONS' => 'OPERATIONS',
  'MANAGEMENT' => 'MANAGEMENT',
];
$roleLabel = $roleLabelMap[$role] ?? $role;
$avatarName = urlencode($fullName);
$avatarUrl = "https://ui-avatars.com/api/?name={$avatarName}&background=231F20&color=fff";
$hour = (int)date('H');
$greeting = ($hour < 12) ? 'Good morning' : (($hour < 18) ? 'Good afternoon' : 'Good evening');

try {
    // 1) Pipeline Value: sum of quote_amount from operations_file_master where link_opportunity=1
    $sql = "SELECT COALESCE(SUM(COALESCE(quote_amount,0)),0) AS pipeline_value
            FROM operations_file_master
            WHERE COALESCE(link_opportunity,0) = 1";
    $pipeline_value = 0;
    $res = $conn->query($sql);
    if ($res) {
        $row = $res->fetch_assoc();
        $pipeline_value = (float)($row['pipeline_value'] ?? 0.0);
        $res->free();
    }

    // 2) Conversion Rate: won = final_invoice_id NOT NULL; total = link_opportunity=1
    $sql = "SELECT
              COUNT(*) AS total_ops,
              SUM(CASE WHEN COALESCE(final_invoice_id,'') <> '' THEN 1 ELSE 0 END) AS won_ops
            FROM operations_file_master
            WHERE COALESCE(link_opportunity,0) = 1";
    $conversion_pct = null;
    $res = $conn->query($sql);
    if ($res) {
        $r = $res->fetch_assoc();
        $total_ops = (int)($r['total_ops'] ?? 0);
        $won_ops = (int)($r['won_ops'] ?? 0);
        if ($total_ops > 0) $conversion_pct = ($won_ops / $total_ops) * 100.0;
        $res->free();
    }

    // 3) New Leads (week): operations_file_master created_at in last 7 days and link_opportunity=1
    $sql = "SELECT COUNT(*) AS new_leads_week FROM operations_file_master
            WHERE COALESCE(link_opportunity,0) = 1 AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)";
    $new_leads_week = 0;
    $res = $conn->query($sql);
    if ($res) {
        $r = $res->fetch_assoc();
        $new_leads_week = (int)($r['new_leads_week'] ?? 0);
        $res->free();
    }

    // 4) Draft Quotes: sum of marginpricing_simulations.status='DRAFT' and proforma_invoice.approval_status='DRAFT'
    $draft_count = 0;
    $sql = "SELECT COUNT(*) AS cnt FROM marginpricing_simulations WHERE status = 'DRAFT'";
    $res = $conn->query($sql);
    if ($res) {
        $r = $res->fetch_assoc();
        $draft_count += (int)($r['cnt'] ?? 0);
        $res->free();
    }
    $sql = "SELECT COUNT(*) AS cnt FROM proforma_invoice WHERE approval_status = 'DRAFT'";
    $res = $conn->query($sql);
    if ($res) {
        $r = $res->fetch_assoc();
        $draft_count += (int)($r['cnt'] ?? 0);
        $res->free();
    }

    // 5) Actionable Leads & Tasks - derive from operations_file_master (sales pipeline)
    $actionable = [];
    $sql = "SELECT operations_file_reference, opportunity_id, client_name, service_type, operations_status, link_opportunity,
               COALESCE(quote_amount,0) AS est_value, created_at, updated_at
        FROM operations_file_master
        WHERE operations_status NOT IN ('CLOSED','COMPLETED')
        ORDER BY (COALESCE(link_opportunity,0) = 0) DESC, created_at DESC
        LIMIT 20";
    $stmt = $conn->prepare($sql);
    if ($stmt) {
        $stmt->execute();
        $res = $stmt->get_result();
        while ($r = $res->fetch_assoc()) {
            $actionable[] = $r;
        }
        $stmt->close();
    }

    // 6) Recent Commercial Activity - union of multiple tables
    $activity = [];
    $sql = "
      SELECT 'QUOTE' AS type, COALESCE(simulation_ref,'') AS ref, COALESCE(client_name_cached,'') AS client, created_at AS dt,
             CONCAT('Margin Simulation: ', COALESCE(simulation_ref,'')) AS note
      FROM marginpricing_simulations
      WHERE COALESCE(created_at,'') <> ''
      UNION ALL
      SELECT 'QUOTE_SENT' AS type, COALESCE(simulation_ref,'') AS ref, COALESCE(client_name_cached,'') AS client, COALESCE(quoted_at, created_at) AS dt,
             CONCAT('Quoted: ', COALESCE(simulation_ref,'')) AS note
      FROM marginpricing_simulations
      WHERE COALESCE(quoted_at, created_at) IS NOT NULL
      UNION ALL
      SELECT 'INVOICE' AS type, COALESCE(invoice_no,'') AS ref, COALESCE(client_id,'') AS client, COALESCE(issue_date, created_at) AS dt,
             CONCAT('Invoice: ', COALESCE(invoice_no,'')) AS note
      FROM invoice_master
      WHERE COALESCE(issue_date, created_at) IS NOT NULL
      UNION ALL
      SELECT 'PROFORMA' AS type, COALESCE(invoice_no,'') AS ref, COALESCE(client_id,'') AS client, COALESCE(issue_date, created_at) AS dt,
             CONCAT('Proforma: ', COALESCE(invoice_no,'')) AS note
      FROM proforma_invoice
      WHERE COALESCE(issue_date, created_at) IS NOT NULL
      UNION ALL
      SELECT 'OPS' AS type, COALESCE(operations_file_reference,'') AS ref, COALESCE(client_name,'') AS client, COALESCE(updated_at, created_at) AS dt,
             CONCAT('Ops file updated: ', COALESCE(operations_file_reference,'')) AS note
      FROM operations_file_master
      WHERE COALESCE(updated_at, created_at) IS NOT NULL
      ORDER BY dt DESC
      LIMIT 12
    ";
    $res = $conn->query($sql);
    if ($res) {
        while ($r = $res->fetch_assoc()) {
            $activity[] = $r;
        }
        $res->free();
    }

} catch (Throwable $e) {
    error_log("Sales dashboard DB error: " . $e->getMessage());
    $pipeline_value = $pipeline_value ?? 0.0;
    $conversion_pct = $conversion_pct ?? null;
    $new_leads_week = $new_leads_week ?? 0;
    $draft_count = $draft_count ?? 0;
    $actionable = $actionable ?? [];
    $activity = $activity ?? [];
} finally {
    // connection left open intentionally
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sales Dashboard | Smart LS</title>

    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">

    <style>
    /* --- PULLED FROM FIRST: design tokens + communication drawer styles + chat UI (kept to avoid breaking elements used by sidebar/topbar) --- */
 :root {
            --smart-blue: #1F99D8;
            --smart-dark: #055B83;
            --smart-orange: #EE7D04;
            --smart-charcoal: #231F20;
            --smart-bg: #F0F4F8;
            --sidebar-width: 260px;
        }

        body {
            font-family: 'Manrope', sans-serif;
            background-color: var(--smart-bg);
            color: var(--smart-charcoal);
            overflow-x: hidden;
        }

        h1, h2, h3, h4, h5, h6 { font-family: 'Montserrat', sans-serif; }

        /* --- SIDEBAR --- */
        .sidebar {
            width: var(--sidebar-width);
            height: 100vh;
            position: fixed;
            top: 0;
            left: 0;
            background-color: #ffffff;
            border-right: 1px solid #e0e0e0;
            z-index: 1000;
            display: flex;
            flex-direction: column;
            box-shadow: 2px 0 10px rgba(0,0,0,0.02);
        }

        .sidebar-header {
            height: 70px;
            display: flex;
            align-items: center;
            padding: 0 20px;
            border-bottom: 1px solid #f0f0f0;
        }

        .brand-logo {
            font-weight: 800;
            font-size: 1.1rem;
            color: var(--smart-charcoal);
            text-decoration: none;
            letter-spacing: -0.5px;
        }

        .sidebar-menu { overflow-y: auto; flex-grow: 1; padding: 10px 0; }

        .menu-btn {
            width: 100%;
            text-align: left;
            background: none;
            border: none;
            padding: 12px 20px;
            font-size: 0.8rem;
            font-weight: 700;
            color: #555;
            display: flex;
            justify-content: space-between;
            align-items: center;
            transition: all 0.2s;
            border-left: 3px solid transparent;
        }

        .menu-btn:hover, .menu-btn[aria-expanded="true"] {
            color: var(--smart-blue);
            background-color: #f8fbff;
            border-left-color: var(--smart-blue);
        }

        .menu-btn i.category-icon { width: 20px; margin-right: 8px; color: #888; transition: color 0.2s; }
        .menu-btn:hover i.category-icon { color: var(--smart-blue); }
        .menu-chevron { font-size: 0.7rem; transition: transform 0.3s; }
        .menu-btn[aria-expanded="true"] .menu-chevron { transform: rotate(180deg); }

        .sub-link {
            display: block;
            padding: 8px 20px 8px 48px;
            font-size: 0.75rem;
            color: #666;
            text-decoration: none;
            font-weight: 500;
            transition: all 0.2s;
            line-height: 1.3;
        }
        .sub-link:hover { color: var(--smart-orange); background-color: #fff9f2; }

        .sidebar-footer { border-top: 1px solid #f0f0f0; padding: 16px; }

        /* --- MAIN LAYOUT --- */
        .main-content {
            margin-left: var(--sidebar-width);
            padding-top: 70px;
            min-height: 100vh;
            width: calc(100% - var(--sidebar-width));
        }

        .top-navbar {
            height: 70px;
            position: fixed;
            top: 0;
            right: 0;
            left: var(--sidebar-width);
            background-color: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(12px);
            border-bottom: 1px solid #e0e0e0;
            z-index: 900;
            padding: 0 30px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        /* --- SALES WIDGETS --- */
        .sales-banner {
            background: linear-gradient(135deg, var(--smart-blue) 0%, #0d47a1 100%);
            color: white;
            border-radius: 12px;
            padding: 1.5rem 2rem;
            position: relative;
            overflow: hidden;
            box-shadow: 0 10px 30px rgba(31, 153, 216, 0.2);
            width: 100%;
        }

        .card-custom {
            background: white;
            border-radius: 12px;
            border: 1px solid rgba(0,0,0,0.05);
            box-shadow: 0 2px 12px rgba(0,0,0,0.02);
            height: 100%;
            transition: transform 0.2s;
        }
        .card-custom:hover { transform: translateY(-2px); box-shadow: 0 5px 20px rgba(0,0,0,0.05); }

        .kpi-title { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; color: #888; letter-spacing: 0.5px; white-space: nowrap; }
        .kpi-value { font-size: 1.6rem; font-weight: 800; color: var(--smart-charcoal); line-height: 1.2; font-variant-numeric: tabular-nums; }
        
        /* Table Styles */
        .table-custom th { font-size: 0.75rem; text-transform: uppercase; color: #888; font-weight: 700; border-bottom: 2px solid #f0f0f0; }
        .table-custom td { font-size: 0.85rem; vertical-align: middle; padding: 12px 8px; }

        /* Clock */
        .clock-pill {
            background: #f1f5f9; padding: 6px 12px; border-radius: 30px;
            display: flex; align-items: center; gap: 10px; font-size: 0.85rem; font-weight: 600; color: var(--smart-dark);
        }
        .btn-clock {
            background: #e2e8f0; border: none; border-radius: 20px;
            padding: 4px 12px; font-size: 0.75rem; font-weight: 700; color: #64748b; transition: 0.3s;
        }
        .btn-clock.active { background: var(--smart-orange); color: white; box-shadow: 0 2px 10px rgba(238, 125, 4, 0.3); }

        /* Scrollable Activity */
        .log-container {
            max-height: 250px;
            overflow-y: auto;
            padding-right: 5px;
        }
        .log-container::-webkit-scrollbar { width: 4px; }
        .log-container::-webkit-scrollbar-track { background: #f1f1f1; }
        .log-container::-webkit-scrollbar-thumb { background: #ccc; border-radius: 4px; }

        /* Read Only Badge */
        .badge-readonly { background: #f3f4f6; color: #6b7280; border: 1px solid #d1d5db; font-size: 0.6rem; letter-spacing: 0.5px; }

        /* --- SMART COMM STYLES (copied from management/smart-comm) --- */
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
        body.chat-active .comm-backdrop{ opacity: 1; pointer-events: auto; }

        .comm-drawer{
          position: fixed;
          top: 70px;
          right: 0;
          width: var(--comm-w);
          height: calc(100vh - 70px);
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
          content:''; position:absolute; left:14px; right:14px; bottom:-1px; height:2px;
          background: linear-gradient(90deg, var(--comm-accent1), var(--comm-accent2), var(--comm-accent3));
          opacity:.9;
        }

        .comm-icon-badge{
          width: 42px; height: 42px; border-radius: 14px;
          display:flex; align-items:center; justify-content:center;
          color: white;
          background: linear-gradient(135deg, var(--comm-accent1), var(--comm-accent2));
          box-shadow: 0 10px 25px rgba(11,94,215,.20);
        }

        .comm-close-btn{
          width: 38px; height: 38px; border-radius: 14px;
          border: 1px solid rgba(15, 23, 42, .10);
          background: rgba(255,255,255,.55);
          backdrop-filter: blur(10px);
          box-shadow: 0 8px 18px rgba(0,0,0,.08);
        }

        .comm-modes{
          display:flex; gap: 8px; padding: 10px 14px;
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
        .mode-pill:hover{ transform: translateY(-1px); box-shadow: 0 10px 18px rgba(0,0,0,.08); }

        .chat-top-search{
          padding: 12px 14px;
          border-bottom: 1px solid rgba(15, 23, 42, .08);
          background: rgba(255,255,255,.45);
          backdrop-filter: blur(10px);
        }
        .global-search-input{
          border: 1px solid rgba(15, 23, 42, .12);
          border-radius: 999px;
          padding: 8px 14px;
          width: 100%;
          font-size: .9rem;
          background: rgba(255,255,255,.70);
          outline: none;
        }

        .channel-tabs {
            display: flex;
            flex-wrap: nowrap !important;
            overflow-x: auto;              
            overflow-y: hidden;
            gap: 8px;
            padding: 10px 14px;
            border-bottom: 1px solid rgba(15, 23, 42, .08);
            background: rgba(255,255,255,.35);
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
            align-items: flex-start;
            line-height: 1.3;
            
            border: 1px solid rgba(15, 23, 42, .12);
            background: rgba(255,255,255,.65);
            border-radius: 14px;
            font-weight: 900;
            letter-spacing: .2px;
            font-size: .82rem;
            color: rgba(15,23,42,.78);
            cursor: pointer;
            transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease, filter .12s ease;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .channel-box .small { font-size: 0.65rem !important; opacity: 0.8; letter-spacing: 0.3px; margin-top: 2px; font-weight: 500 !important; }
        .channel-box:hover{ transform: translateY(-1px); box-shadow: 0 12px 22px rgba(0,0,0,.10); border-color: rgba(255,102,0,.25); filter: brightness(1.02); }
        .channel-box.active{ color: #0b1b33; border-color: rgba(255,102,0,.35); background: linear-gradient(135deg, rgba(11,94,215,.16), rgba(255,102,0,.10)); }

        .channel-skeleton{ flex: 0 0 auto; min-width: 140px; height: 48px; border-radius: 14px; border: 1px solid rgba(15, 23, 42, .10); background: linear-gradient(90deg, rgba(255,255,255,.45), rgba(255,255,255,.70), rgba(255,255,255,.45)); background-size: 200% 100%; animation: shimmer 1.2s infinite linear; }
        @keyframes shimmer{ 0%{background-position: 0 0;} 100%{background-position: -200% 0;} }

        .messages-scroll-area{ flex:1; overflow-y:auto; padding: 14px; display:flex; flex-direction: column; gap: 12px; }
        .msg-row{ display:flex; gap: 10px; align-items:flex-start; }
        .msg-row.mine{ flex-direction: row-reverse; }
        .msg-avatar{ width: 36px; height: 36px; border-radius: 12px; object-fit: cover; box-shadow: 0 8px 18px rgba(0,0,0,.10); }
        .msg-bubble{ background: rgba(255,255,255,.78); backdrop-filter: blur(10px); border: 1px solid rgba(15,23,42,.08); padding: 12px; border-radius: 14px; border-top-left-radius: 4px; box-shadow: 0 10px 18px rgba(0,0,0,.06); font-size: .9rem; max-width: 85%; }
        .msg-row.mine .msg-bubble{ background: linear-gradient(135deg, rgba(11,94,215,.92), rgba(0,33,71,.92)); color: #fff; border-top-left-radius: 14px; border-top-right-radius: 4px; border-color: rgba(255,255,255,.12); }
        .msg-bubble .fw-bold{ color: rgba(15, 23, 42, .92) !important; font-weight: 900 !important; letter-spacing: .2px; }
        .msg-row.mine .msg-bubble .fw-bold{ color: rgba(255, 255, 255, .92) !important; }
        .msg-meta{ font-size: .72rem; color: rgba(15,23,42,.55); margin-top: 4px; }
        .msg-row.mine .msg-meta{ text-align: right; color: rgba(255,255,255,.72); }

        .urgency-badge{ font-size: .62rem; padding: 2px 6px; border-radius: 6px; font-weight: 900; letter-spacing: .4px; text-transform: uppercase; margin-bottom: 4px; display: inline-block; }
        .urgency-critical{ background: #dc3545; color: #fff; }
        .urgency-urgent{ background: #ffc107; color: #1f2937; }
        .msg-row.critical .msg-bubble{ border: 2px solid #dc3545; animation: critical-pulse 1.5s infinite; }
        @keyframes critical-pulse{ 0% { box-shadow: 0 0 0 0 rgba(220,53,69,.40); } 70% { box-shadow: 0 0 0 10px rgba(0,0,0,0); } 100% { box-shadow: 0 0 0 0 rgba(0,0,0,0); } }

        .msg-bubble button.btn-outline-danger { border-width: 2px; font-size: 0.75rem; box-shadow: 0 4px 6px rgba(220, 53, 69, 0.1); transition: all 0.2s ease; }
        .msg-bubble button.btn-outline-danger:hover { transform: translateY(-1px); box-shadow: 0 6px 10px rgba(220, 53, 69, 0.2); }

        .chat-input-zone{ padding: 12px 12px 14px; border-top: 1px solid rgba(15, 23, 42, .08); background: rgba(255,255,255,.55); backdrop-filter: blur(12px); }
        .input-wrapper{ border-radius: 18px; border: 1px solid rgba(15, 23, 42, .12); background: rgba(255,255,255,.65); display:flex; align-items:flex-end; gap: 8px; padding: 8px 10px; }
        .chat-textarea{ width:100%; border:none; outline:none; background: transparent; resize:none; min-height: 42px; max-height: 120px; padding: 6px 8px; font-size: .92rem; color: var(--comm-ink); }

        @media (max-height: 640px){
          .comm-drawer{ top: 0; height: 100vh; border-radius: 0; }
        }
    </style>
</head>
<body>

<!-- SIDEBAR (taken from first code) -->
<nav class="sidebar">
    <div class="sidebar-header">
        <a href="index" class="brand-logo"><i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span></a>
    </div>

    <div class="px-3 mb-2 mt-2">
        <a href="index" class="btn btn-primary w-100 text-start d-flex align-items-center" style="background-color: transparent; color: inherit; border: none; padding-left: 0;">
            <i class="fa-solid fa-house category-icon me-2"></i> 
            <span class="fw-bold">Sales Dashboard GM</span> 
        </a>
    </div>

    <div class="sidebar-menu accordion" id="salesMenu">
        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#sales1">
                <span><i class="fa-solid fa-database category-icon"></i>MASTER DATA MGMT</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="sales1" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                <div class="sub-menu">
                    <a href="client-master-registry.php" class="sub-link">Client Master Registry</a>
                    <a href="financial-dictionary.php" class="sub-link">Financial Dictionary</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#sales2">
                <span><i class="fa-solid fa-users category-icon"></i>CRM & ACQUISITION</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="sales2" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                <div class="sub-menu">
                    <a href="contact-us-intake.php" class="sub-link">Contact Us Intake</a>
                    <a href="partnership-portal-intake.php" class="sub-link">Partnership Portal Intake</a>
                    <a href="market-campaign-registration.php" class="sub-link">Marketing Campaign Register</a>
                    <a href="smart-quote-intake.php" class="sub-link">Smart Quote Intake</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#sales3">
                <span><i class="fa-solid fa-filter category-icon"></i>SALES FUNNEL</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="sales3" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                <div class="sub-menu">
                    <a href="sales-pipelining.php" class="sub-link">Sales Pipeline</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#sales4">
                <span><i class="fa-solid fa-calculator category-icon"></i>COMMERCIAL & PRICING</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="sales4" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                <div class="sub-menu">
                    <a href="margin-simulator-billing.php" class="sub-link">Margin Simulator & Pricing System</a>
                    <a href="extra-charges-simulator.php" class="sub-link">Extra Charges Simulator</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#sales5">
                <span><i class="fa-solid fa-truck-fast category-icon"></i>LOGISTICS OPERATIONS</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="sales5" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                <div class="sub-menu">
                    <a href="operations-registry.php" class="sub-link">Operations File Registry</a>
                    <a href="operational-milestone-tracking.php" class="sub-link">Operational Milestone Tracking</a>
                    <a href="delivery-note.php" class="sub-link">Delivery Note</a>
                </div>
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#sales6">
                <span><i class="fa-solid fa-building-columns category-icon"></i>FINANCE & TREASURY</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="sales6" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                <div class="sub-menu">
                    <a href="cash-request.php" class="sub-link">Cash Request</a>
                    <a href="financial-dictionary.php" class="sub-link">Financial Dictionary</a>
                </div>
                
            </div>
        </div>

        <div class="accordion-item border-0">
            <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#sales7">
                <span><i class="fa-solid fa-box-archive category-icon"></i>COMPANY ARCHIVES</span>
                <i class="fa-solid fa-chevron-down menu-chevron"></i>
            </button>
            <div id="sales7" class="accordion-collapse collapse" data-bs-parent="#salesMenu">
                <div class="sub-menu">
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

<!-- TOP NAVBAR (replaced with first code's top-navbar to include name section and avatar) -->
<div class="top-navbar">
  <div>
      <h5 class="mb-0 fw-bold text-dark">Commercial Control</h5>
      <small class="text-muted" style="font-size: 0.7rem;">SALES PIPELINE & GROWTH</small>
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
              <small class="text-primary fw-bold" style="font-size: 0.65rem; letter-spacing: 0.5px;">
              <?php echo e($roleLabel); ?>
              </small>
          </div>
          <img src="<?php echo e($avatarUrl); ?>" class="rounded-circle shadow-sm" width="38" height="38" alt="<?php echo e($firstName); ?>">
      </div>
  </div>
</div>

<!-- MAIN CONTENT (unchanged layout from second file) -->

    <div class="main-content px-4 pb-5">
        <div class="row pt-4 mb-4">
            <div class="col-12">
                <div class="sales-banner d-flex justify-content-between align-items-center">
                    <div>
                        <h2 class="fw-bold mb-1"><?php echo e($greeting); ?>, <?php echo e($firstName); ?>!</h2>
                        <p class="mb-0 opacity-75">Your pipeline is shown below. New leads and quotes feed into operations.</p>
                    </div>

                    <!-- SMART COMM LAUNCH BUTTON (added) -->
                    <div class="mx-3 d-flex align-items-center">
                      <button type="button" onclick="toggleChat()" class="smart-comm-btn">
                        <i class="fa-solid fa-satellite-dish fs-5"></i>
                        <span>SMART COMM HUB</span>
                        <div class="comm-badge" id="commBadge">0</div>
                      </button>
                    </div>

                    <div class="text-end" style="min-width: 150px;">
                        <div class="mb-1 text-uppercase text-white-50" style="font-size: 0.7rem; font-weight: 800;">
                            Pipeline Conversion
                        </div>
                        
                        <div class="d-flex align-items-center justify-content-end gap-2">
                            <span class="fw-bold fs-5">
                                <?php echo $conversion_pct === null ? '—' : number_format($conversion_pct, 1) . '%'; ?>
                            </span>
                        </div>
                        
                        <div class="progress mt-2" style="height: 6px; background: rgba(255,255,255,0.2);">
                            <div class="progress-bar bg-white"
                                 role="progressbar"
                                 style="width: <?php echo min((float)$conversion_pct, 100); ?>%">
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </div>

        <!-- KPI Row -->
        <div class="row g-3 mb-4">
            <div class="col-3">
                <div class="card-custom p-3 d-flex align-items-center">
                    <div class="me-3 rounded-3 bg-primary bg-opacity-10 text-primary d-flex align-items-center justify-content-center" style="width:45px;height:45px;">
                        <i class="fa-solid fa-funnel-dollar"></i>
                    </div>
                    <div>
                        <div class="kpi-title">Pipeline Value</div>
                        <div class="kpi-value"><?php echo number_format(round($pipeline_value)); ?> <span style="font-size:0.9rem;color:#888;">XAF</span></div>
                    </div>
                </div>
            </div>

            <div class="col-3">
                <div class="card-custom p-3 d-flex align-items-center">
                    <div class="me-3 rounded-3 bg-success bg-opacity-10 text-success d-flex align-items-center justify-content-center" style="width:45px;height:45px;">
                        <i class="fa-solid fa-arrow-trend-up"></i>
                    </div>
                    <div>
                        <div class="kpi-title">Conversion Rate</div>
                        <div class="kpi-value text-success"><?php echo $conversion_pct === null ? '—' : number_format((float)$conversion_pct,2) . '%'; ?></div>
                    </div>
                </div>
            </div>

            <div class="col-3">
                <div class="card-custom p-3 d-flex align-items-center">
                    <div class="me-3 rounded-3 bg-warning bg-opacity-10 text-warning d-flex align-items-center justify-content-center" style="width:45px;height:45px;">
                        <i class="fa-solid fa-fire"></i>
                    </div>
                    <div>
                        <div class="kpi-title">New Leads (Wk)</div>
                        <div class="kpi-value"><?php echo e($new_leads_week); ?></div>
                    </div>
                </div>
            </div>

            <div class="col-3">
                <div class="card-custom p-3 d-flex align-items-center">
                    <div class="me-3 rounded-3 bg-info bg-opacity-10 text-info d-flex align-items-center justify-content-center" style="width:45px;height:45px;">
                        <i class="fa-solid fa-file-pen"></i>
                    </div>
                    <div>
                        <div class="kpi-title">Draft Quotes</div>
                        <div class="kpi-value"><?php echo e($draft_count); ?></div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Actionable Leads -->
        <div class="row mb-4">
            <div class="col-12">
                <div class="card-custom p-4">
    <div class="d-flex justify-content-between align-items-center mb-3">
        <h5 class="fw-bold mb-0 text-dark"><i class="fa-solid fa-bolt text-warning me-2"></i>Actionable Leads & Tasks</h5>
        <a href="operations-registry.php?open=create" class="btn btn-sm btn-primary rounded-pill px-3">
            <i class="fa-solid fa-plus me-1"></i> New Opportunity
        </a>
    </div>

    <div class="table-responsive">
        <table class="table table-hover table-custom mb-0">
            <thead class="bg-light">
                <tr>
                    <th style="width:10%;">Source</th>
                    <th style="width:25%;">Client / Prospect</th>
                    <th style="width:35%;">Status / Next Step</th>
                    <th style="width:15%;" class="text-end">Est. Value</th>
                    <th style="width:15%;" class="text-end">Action</th>
                </tr>
            </thead>
            <tbody>
                <?php if (empty($actionable)): ?>
                    <tr><td colspan="5" class="text-center text-muted py-4">No active pipeline opportunities.</td></tr>
                <?php else: foreach ($actionable as $row): ?>
                    <tr>
                        <td>
                            <?php if ((int)($row['link_opportunity'] ?? 0) === 0): ?>
                                <span class="badge bg-danger text-white border border-light shadow-sm" style="animation: pulse-red 2s infinite;">
                                    <i class="fa-solid fa-triangle-exclamation me-1"></i> REGULARIZE
                                </span>
                            <?php else: ?>
                                <?php $src = $row['opportunity_id'] ? 'Web Quote' : 'Manual'; ?>
                                <span class="badge <?php echo ($src === 'Web Quote') ? 'bg-primary' : 'bg-dark'; ?>"><?php echo e($src); ?></span>
                            <?php endif; ?>
                        </td>

                        <td>
                            <div class="fw-bold"><?php echo e($row['client_name'] ?: 'Unknown'); ?></div>
                            <div class="text-muted" style="font-size:0.7rem;">
                                <?php echo e($row['operations_file_reference']); ?>
                            </div>
                        </td>

                        <td>
                            <div class="d-flex align-items-center gap-2">
                                <div style="width:8px;height:8px;background:<?php
                                    $status = strtoupper((string)$row['operations_status']);
                                    if (strpos($status,'IN_PROGRESS') !== false) echo '#1F99D8';
                                    elseif (strpos($status,'OPEN') !== false) echo '#EE7D04';
                                    else echo '#6B7280';
                                ?>;border-radius:50%;"></div>
                                <span><?php echo e($row['operations_status']); ?></span>
                            </div>
                        </td>

                        <td class="text-end fw-bold">
                            <?php echo number_format((float)$row['est_value']); ?>
                        </td>

                        <td class="text-end">
                            <?php if ((int)($row['link_opportunity'] ?? 0) === 0): ?>
                                <button onclick='openRegModal(<?php echo json_encode($row); ?>)' 
                                        class="btn btn-sm btn-danger fw-bold py-0 px-2 shadow-sm">
                                    <i class="fa-solid fa-link me-1"></i> Fix
                                </button>
                            <?php else: ?>
                                <a href="operations-registry.php?ref=<?php echo urlencode($row['operations_file_reference']); ?>" 
                                   class="btn btn-sm btn-outline-primary py-0 px-2">Open</a>
                            <?php endif; ?>
                        </td>
                    </tr>
                <?php endforeach; endif; ?>
            </tbody>
        </table>
    </div>
</div>

        <!-- Recent Activity -->
        <div class="row mb-4">
            <div class="col-12">
                <div class="card-custom p-4">
                    <h5 class="fw-bold mb-4 text-dark"><i class="fa-solid fa-clock-rotate-left text-primary me-2"></i>Recent Commercial Activity</h5>
                    <div class="log-container">
                        <?php if (empty($activity)): ?>
                            <div class="text-center text-muted py-4">No recent activity.</div>
                        <?php else: foreach ($activity as $it): 
                            $dt = strtotime($it['dt']);
                            $display_time = $dt ? (date('Y-m-d',$dt) === date('Y-m-d') ? date('H:i A',$dt) : date('M d', $dt)) : '';
                        ?>
                            <div class="d-flex gap-3 mb-3 border-bottom pb-3">
                                <div class="rounded-circle bg-info bg-opacity-10 text-info d-flex align-items-center justify-content-center flex-shrink-0" style="width:36px;height:36px;">
                                    <i class="fa-solid fa-bell"></i>
                                </div>
                                <div class="flex-grow-1">
                                    <div class="d-flex justify-content-between">
                                        <p class="mb-0 fw-bold text-dark fs-6"><?php echo e($it['note']); ?></p>
                                        <small class="text-muted"><?php echo e($display_time); ?></small>
                                    </div>
                                    <p class="text-muted mb-0" style="font-size:0.85rem;"><?php echo e($it['client'] ?: '—'); ?> · <?php echo e($it['ref'] ?: ''); ?></p>
                                </div>
                            </div>
                        <?php endforeach; endif; ?>
                    </div>
                </div>
            </div>
        </div>

    </div> <!-- main-content -->

<!-- SMART COMM BACKDROP & DRAWER (copied from previous implementation) -->
<div class="comm-backdrop" id="commBackdrop" onclick="toggleChat(false)"></div>

<div class="comm-drawer" id="commDrawer" aria-hidden="true">
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

<script src="../../js/smart-comm-core.js?v=4.0"></script>

<div class="modal fade" id="regModal" tabindex="-1" data-bs-backdrop="static">
  <div class="modal-dialog modal-lg"> <div class="modal-content border-0 shadow-lg">
      <div class="modal-header bg-danger text-white">
        <div>
            <h5 class="modal-title fw-bold"><i class="fa-solid fa-triangle-exclamation me-2"></i>Regularize Direct Entry</h5>
            <small class="opacity-75">Create a retroactive Opportunity to link with this active file.</small>
        </div>
        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
      </div>
      <div class="modal-body p-4">
        
        <form id="regForm" onsubmit="event.preventDefault(); submitRegularization();">
            
            <div class="row g-3 mb-4">
                <div class="col-12">
                    <div class="bg-light p-3 rounded border d-flex justify-content-between align-items-center">
                        <div>
                            <small class="fw-bold text-muted text-uppercase">Operations File (Locked)</small>
                            <div class="fw-black font-monospace fs-5 text-dark" id="regOpsRef">--</div>
                        </div>
                        <div class="text-end">
                            <small class="fw-bold text-muted text-uppercase">Client Account</small>
                            <div class="fw-bold text-primary" id="regClientDisplay">--</div>
                        </div>
                    </div>
                </div>
            </div>

            <h6 class="fw-bold text-secondary mb-3 border-bottom pb-2"><i class="fa-solid fa-user-tie me-2"></i>Commercial Contact</h6>
            <div class="row g-3 mb-3">
                <div class="col-md-6">
                    <label class="form-label small fw-bold text-muted">Requester Name</label>
                    <input type="text" class="form-control fw-bold" id="regReqName" required>
                </div>
                <div class="col-md-6">
                    <label class="form-label small fw-bold text-muted">Company Name</label>
                    <input type="text" class="form-control" id="regReqCompany">
                </div>
                <div class="col-md-6">
                    <label class="form-label small fw-bold text-muted">Email</label>
                    <input type="email" class="form-control" id="regReqEmail" placeholder="client@example.com">
                </div>
                <div class="col-md-6">
                    <label class="form-label small fw-bold text-muted">Phone</label>
                    <input type="text" class="form-control" id="regReqPhone" placeholder="+237...">
                </div>
            </div>

            <h6 class="fw-bold text-secondary mb-3 border-bottom pb-2 mt-4"><i class="fa-solid fa-truck-fast me-2"></i>Service Scope</h6>
            <div class="row g-3 mb-3">
                <div class="col-md-6">
                    <label class="form-label small fw-bold text-muted">Service Category <span class="text-danger">*</span></label>
                    <select class="form-select" id="regCategory" required>
                        <option value="">Select Category...</option>
                        <option value="SEA_FREIGHT_IMPORT">SEA_FREIGHT_IMPORT</option>
                        <option value="SEA_FREIGHT_EXPORT">SEA_FREIGHT_EXPORT</option>
                        <option value="AIR_FREIGHT_IMPORT">AIR_FREIGHT_IMPORT</option>
                        <option value="AIR_FREIGHT_EXPORT">AIR_FREIGHT_EXPORT</option>
                        <option value="HINTERLAND_TRANSIT">HINTERLAND_TRANSIT</option>
                        <option value="INLAND_TRANSPORTATION">INLAND_TRANSPORTATION</option>
                        <option value="WAREHOUSING">WAREHOUSING</option>
                        <option value="BUSINESS_REPRESENTATION">BUSINESS_REPRESENTATION</option>
                    </select>
                </div>
                <div class="col-md-6">
                    <label class="form-label small fw-bold text-muted">Service Type / Incoterm</label>
                    <input type="text" class="form-control" id="regServiceType" placeholder="e.g. EXW, DDP, Clearance Only">
                </div>
                <div class="col-md-6">
                    <label class="form-label small fw-bold text-muted">Origin</label>
                    <input type="text" class="form-control" id="regOrigin" placeholder="City, Country">
                </div>
                <div class="col-md-6">
                    <label class="form-label small fw-bold text-muted">Destination</label>
                    <input type="text" class="form-control" id="regDest" placeholder="City, Country">
                </div>
            </div>

            <h6 class="fw-bold text-secondary mb-3 border-bottom pb-2 mt-4"><i class="fa-solid fa-scale-balanced me-2"></i>Cargo & Value</h6>
            <div class="row g-3 mb-4">
                <div class="col-md-4">
                    <label class="form-label small fw-bold text-muted">Est. Weight (KG)</label>
                    <input type="number" class="form-control" id="regWeight" placeholder="0.00">
                </div>
                <div class="col-md-8">
                    <label class="form-label small fw-bold text-dark">Estimated Value (XAF) <span class="text-danger">*</span></label>
                    <div class="input-group">
                        <span class="input-group-text bg-light fw-bold text-dark">XAF</span>
                        <input type="number" class="form-control fw-black fs-5" id="regValue" placeholder="0" required min="1">
                    </div>
                </div>
                <div class="col-12">
                    <label class="form-label small fw-bold text-muted">Cargo Description</label>
                    <textarea class="form-control" id="regDesc" rows="2" placeholder="e.g. 2x40ft Containers of Electronics"></textarea>
                </div>
                <div class="col-12">
                    <label class="form-label small fw-bold text-muted">Additional Notes</label>
                    <textarea class="form-control" id="regNotes" rows="1"></textarea>
                </div>
            </div>

            <div class="d-flex justify-content-end gap-2 pt-3 border-top">
                <button type="button" class="btn btn-light fw-bold border" data-bs-dismiss="modal">Cancel</button>
                <button type="submit" class="btn btn-danger fw-bold px-4" id="btnRegSubmit">
                    <i class="fa-solid fa-link me-2"></i>Create Opportunity & Link
                </button>
            </div>
        </form>
      </div>
    </div>
  </div>
</div>

<script>
    // --- Clock Logic ---
    function updateClock() { 
        const el = document.getElementById('realtime-clock');
        if(el) el.innerText = new Date().toLocaleTimeString(); 
    }
    setInterval(updateClock, 1000); updateClock();

    let isClockedIn = false;
    function toggleClock() {
        const btn = document.getElementById('btn-clock');
        if (!isClockedIn) {
            btn.classList.add('active');
            btn.innerHTML = '<i class="fa-solid fa-check"></i> <span>Clocked In</span>';
            isClockedIn = true;
        } else {
            btn.classList.remove('active');
            btn.innerHTML = '<i class="fa-solid fa-fingerprint"></i> <span>Clock In</span>';
            isClockedIn = false;
        }
    }

    // --- Smart Comm Logic ---
    function toggleChat(forceState) {
      try {
        const open = (typeof forceState === 'boolean') ? forceState : !document.body.classList.contains('chat-active');
        document.body.classList.toggle('chat-active', open);
        if (open) {
          setTimeout(() => {
            const input = document.getElementById('chatInput');
            if (input) input.focus();
          }, 120);
          const badge = document.getElementById('commBadge');
          if (badge) badge.style.display = 'none';
        }
      } catch (e) { console.error('toggleChat error:', e); }
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains('chat-active')) {
        toggleChat(false);
      }
    });

    (function () {
      const drawer = document.getElementById('commDrawer');
      if (drawer) drawer.addEventListener('click', function (ev) { ev.stopPropagation(); });
    })();

    // --- REGULARIZATION LOGIC (FIXED) ---
    // Defined globally so the onclick in HTML can find it
    let currentRegRef = null;
    let regModal = null;

    // Initialize Modal safely AFTER DOM is ready
    document.addEventListener('DOMContentLoaded', function() {
        const el = document.getElementById('regModal');
        if(el) {
            regModal = new bootstrap.Modal(el);
        } else {
            console.error("Critical Error: #regModal not found in DOM");
        }
    });

    function openRegModal(row) {
        if(!regModal) {
            // Fallback attempt if DOMContentLoaded fired before this script
            const el = document.getElementById('regModal');
            if(el) regModal = new bootstrap.Modal(el);
            else return alert("System Error: Modal not loaded.");
        }
        
        currentRegRef = row.operations_file_reference;
        
        // 1. Fill Read-Only Context
        document.getElementById('regOpsRef').innerText = row.operations_file_reference;
        document.getElementById('regClientDisplay').innerText = row.client_name || 'Unknown';
        
        // 2. Auto-Fill Contact Info (Lazy fill from Client Name)
        document.getElementById('regReqName').value = row.client_name || '';
        document.getElementById('regReqCompany').value = row.client_name || '';
        document.getElementById('regReqEmail').value = ''; // Reset
        document.getElementById('regReqPhone').value = ''; // Reset

        // 3. Auto-Select Service Type
        const catSelect = document.getElementById('regCategory');
        if(catSelect && row.service_type) {
            // Try exact match
            catSelect.value = row.service_type;
            // If failed, reset
            if(!catSelect.value) catSelect.value = "";
        }
        
        // 4. Fill Service Type Text (as a hint)
        document.getElementById('regServiceType').value = row.service_type || "";

        // 5. Reset other fields
        document.getElementById('regOrigin').value = "";
        document.getElementById('regDest').value = "";
        document.getElementById('regWeight').value = "";
        document.getElementById('regValue').value = "";
        document.getElementById('regDesc').value = "";
        document.getElementById('regNotes').value = "Regularized from Direct Entry";
        
        regModal.show();
    }

    async function submitRegularization() {
        const btn = document.getElementById('btnRegSubmit');
        
        // Collect Data
        const payload = {
            ops_ref: currentRegRef,
            requester_name: document.getElementById('regReqName').value,
            requester_company: document.getElementById('regReqCompany').value,
            requester_email: document.getElementById('regReqEmail').value,
            requester_phone: document.getElementById('regReqPhone').value,
            
            service_category: document.getElementById('regCategory').value,
            service_type: document.getElementById('regServiceType').value,
            
            origin_location: document.getElementById('regOrigin').value,
            destination_location: document.getElementById('regDest').value,
            
            estimated_weight: document.getElementById('regWeight').value,
            estimated_value_xaf: document.getElementById('regValue').value,
            
            cargo_description: document.getElementById('regDesc').value,
            additional_notes: document.getElementById('regNotes').value
        };

        // Basic Validation
        if(!payload.estimated_value_xaf || !payload.service_category) {
            return alert("Please fill the required fields (Value & Category).");
        }
        
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';
        
        try {
            const res = await fetch('../../api/operations_files/regularize.php', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload),
                credentials: 'same-origin'
            });
            
            const json = await res.json();
            
            if(!json.ok) throw new Error(json.error || 'Failed to regularize');
            
            alert("Success! File linked to Opportunity: " + json.new_opp_ref);
            window.location.reload(); 
            
        } catch (e) {
            console.error(e);
            alert(e.message);
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-link me-2"></i>Create Opportunity & Link';
        }
    }

    // CSS Animation for Red Badge
    const styleSheet = document.createElement("style");
    styleSheet.innerText = `
      @keyframes pulse-red {
        0% { box-shadow: 0 0 0 0 rgba(220, 53, 69, 0.7); }
        70% { box-shadow: 0 0 0 6px rgba(220, 53, 69, 0); }
        100% { box-shadow: 0 0 0 0 rgba(220, 53, 69, 0); }
      }
      .fw-black { font-weight: 900; }
    `;
    document.head.appendChild(styleSheet);
</script>
</body>
</html>