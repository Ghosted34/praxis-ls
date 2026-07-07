<?php
// print-po.php
declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['ADMIN','FINANCE','MANAGEMENT','OPERATIONS']);

$conn = db();
$poId = trim((string)($_GET['id'] ?? ''));

if ($poId === '') {
  http_response_code(400);
  die("Invalid PO ID");
}

/**
 * Helper: safe HTML escape
 */
function h(?string $v): string {
  return htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8');
}

/**
 * Helper: currency formatting
 */
function fmt($n, string $cur): string {
  return number_format((float)$n, 0, '.', ',') . ($cur !== '' ? (' ' . $cur) : '');
}

/**
 * Helper: Number to Words
 */
function numberToWords($num): string {
  $ones = array(
    0 => "ZERO", 1 => "ONE", 2 => "TWO", 3 => "THREE", 4 => "FOUR", 5 => "FIVE", 6 => "SIX",
    7 => "SEVEN", 8 => "EIGHT", 9 => "NINE", 10 => "TEN", 11 => "ELEVEN", 12 => "TWELVE",
    13 => "THIRTEEN", 14 => "FOURTEEN", 15 => "FIFTEEN", 16 => "SIXTEEN", 17 => "SEVENTEEN",
    18 => "EIGHTEEN", 19 => "NINETEEN"
  );
  $tens = array(
    0 => "ZERO", 1 => "TEN", 2 => "TWENTY", 3 => "THIRTY", 4 => "FORTY", 5 => "FIFTY",
    6 => "SIXTY", 7 => "SEVENTY", 8 => "EIGHTY", 9 => "NINETY"
  );
  $num = number_format((float)$num, 2, ".", ",");
  $num_arr = explode(".", $num);
  $wholes = $num_arr[0];
  $dec = $num_arr[1] ?? '00';
  $whole_arr = array_reverse(explode(",", $wholes));
  krsort($whole_arr, 1);
  $rettxt = "";
  foreach ($whole_arr as $key => $i) {
    while (substr($i, 0, 1) === "0") $i = substr($i, 1, 5);
    $iNum = (int)$i;
    if ($iNum < 20) {
      $rettxt .= $ones[$iNum];
    } elseif ($iNum < 100) {
      if (substr($i, 0, 1) !== "0") $rettxt .= $tens[(int)substr($i, 0, 1)];
      if (substr($i, 1, 1) !== "0") $rettxt .= " " . $ones[(int)substr($i, 1, 1)];
    } else {
      if (substr($i, 0, 1) !== "0") $rettxt .= $ones[(int)substr($i, 0, 1)] . " HUNDRED";
      if (substr($i, 1, 1) !== "0") $rettxt .= " " . $tens[(int)substr($i, 1, 1)];
      if (substr($i, 2, 1) !== "0") $rettxt .= " " . $ones[(int)substr($i, 2, 1)];
    }
    if ($key > 0) {
      $rettxt .= " ";
      if ($key === 1) $rettxt .= "THOUSAND";
      if ($key === 2) $rettxt .= "MILLION";
    }
    $rettxt .= " ";
  }
  $rettxt = trim($rettxt) . " AND " . $dec . " CENTS";
  return $rettxt;
}

/**
 * 1) Fetch PO data
 */
$sql = "
  SELECT 
    pom.*,
    DATE_FORMAT(pom.created_at, '%d %b %Y') as date_fmt,
    DATE_FORMAT(pom.created_at, '%H:%i') as time_fmt,
    DATE_FORMAT(pom.approved_at, '%d %b %Y') as app_date_fmt,
    DATE_FORMAT(pom.approved_at, '%H:%i') as app_time_fmt,
    DATE_FORMAT(pom.delivery_date, '%d %b %Y') as del_date_fmt,
    iss.full_name as issuer_name,
    app.full_name as approver_name,
    sup.niu as sup_niu,
    sup.rccm as sup_rccm,
    sup.address as sup_address,
    sup.contact_email as sup_email,
    sup.contact_phone as sup_phone,
    sup.bank_name as sup_bank,
    sup.account_number as sup_iban
  FROM purchase_order_master pom
  LEFT JOIN employee_master iss ON iss.employee_id = (SELECT employee_id FROM user_auth WHERE user_id = pom.created_by LIMIT 1)
  LEFT JOIN employee_master app ON app.employee_id = pom.approved_by
  LEFT JOIN supplier_master sup ON sup.supplier_id = pom.supplier_id
  WHERE pom.po_id = ?
  LIMIT 1
";
$stmt = $conn->prepare($sql);
$stmt->bind_param('s', $poId);
$stmt->execute();
$po = $stmt->get_result()->fetch_assoc();

if (!$po) {
  http_response_code(404);
  die("PO Not Found");
}

/**
 * 2) Fetch items
 */
$sqlItems = "SELECT * FROM purchase_order_items WHERE po_id = ? ORDER BY line_no ASC";
$stmtI = $conn->prepare($sqlItems);
$stmtI->bind_param('s', $poId);
$stmtI->execute();
$items = $stmtI->get_result()->fetch_all(MYSQLI_ASSOC);

/**
 * 3) Payment terms logic
 */
$payTerms = strtoupper((string)($po['payment_means'] ?? 'CASH'));
if ($payTerms === 'BANK_TRANSFER') $payTerms = 'BANK';
if ($payTerms === 'MOBILE_MONEY') $payTerms = 'MOMO';
$termsFull = (((int)($po['pay_days'] ?? 0)) > 0 ? ((int)$po['pay_days'] . ' DAYS') : 'IMMEDIATE') . " (" . $payTerms . ")";

/**
 * 4) Totals calculation
 */
$totalHT  = (float)($po['total_ht'] ?? 0);
$totalVAT = (float)($po['total_vat'] ?? 0);
$totalTTC = (float)($po['total_ttc'] ?? 0);
$advPaid  = (float)($po['adv_paid'] ?? 0);
$airRate  = (float)($po['air_rate'] ?? 0);
$airAmt   = $totalHT * ($airRate / 100);
$netPayable = $totalTTC - $airAmt - $advPaid;
$remarks = (string)($po['remarks'] ?? ''); // Get remarks

/**
 * 5) QR Code
 * Switched to QuickChart for better reliability, standard params
 */
$hash = (string)($po['security_hash'] ?? 'PENDING_APPROVAL');
$issuerID = (string)($po['issuer_auth_id'] ?? 'ISS-PENDING');
$approverID = (string)($po['approver_auth_id'] ?? 'APP-PENDING');

$qrData = "VERIFY:SMARTLS|ID:$poId|AMT:$totalTTC|DATE:" . (string)($po['date_fmt'] ?? '') . "|HASH:" . substr($hash, 0, 10);
$qrUrl = "https://quickchart.io/qr?size=300&margin=1&text=" . urlencode($qrData);

/**
 * 6) Pagination
 */
$ROWS_PER_PAGE = 10;
$totalItems = count($items);
$totalPages = (int)max(1, (int)ceil($totalItems / $ROWS_PER_PAGE));
$itemPages = array_chunk($items, $ROWS_PER_PAGE);

$deliveryDateDisplay = ($po['del_date_fmt'] ?? '') !== '' ? $po['del_date_fmt'] : (($po['delivery_date'] ?? '') !== '' ? $po['delivery_date'] : '—');

$companyBillingLines = [
  "SMART LOGISTICS AND SERVICES LTD",
  "1030, Avenue Douala Manga Bell, Bali",
  "Po Box 5120, Douala, Cameroon",
  "00237 233 420 281 | procurement@smartls.cm",
];
$companyLegalInfo = "RC/DLA/2021/B/2060 | NIU: M042116033580Q";

$contractTerms = [
  "Scope & Acceptance: Performance, delivery, or commencement of services constitutes acceptance of this PO and its terms.",
  "Delivery & Quality: Supplier shall deliver on or before the stated date. All goods/services are subject to inspection.",
  "Pricing & Taxes: Prices are fixed as stated. VAT and statutory taxes must be clearly shown on the compliant invoice.",
  "Invoicing: Invoices must reference the PO Number. Non-compliant documentation may result in payment delays.",
  "Payment & Law: Payment follows stated terms upon receipt of goods. Any dispute is governed by local jurisdiction.",
];
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>PO <?php echo h($poId); ?></title>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Montserrat:wght@600;700;800;900&family=JetBrains+Mono:wght@500;600;700&display=swap" rel="stylesheet">

  <style>
    :root{
      --ink:#231F20;
      --muted:#4b5563;
      --muted2:#6b7280;
      --paper:#ffffff;
      --bg:#525659;
      --brand:#EE7D04;
      --accent:#1F99D8;
      --line:#e5e7eb;
      --font-body:'Manrope', sans-serif;
      --font-head:'Montserrat', sans-serif;
      --font-mono:'JetBrains Mono', monospace;
      --page-w:210mm;
      --page-h:297mm;
      --pad-x:12mm;
      --pad-y:10mm;
      --sig-h:145px; /* Slightly adjusted height */
    }

    @page { size: A4 portrait; margin: 0; }
    html, body { height: 100%; }
    body {
      margin: 0; padding: 0;
      font-family: var(--font-body);
      background: var(--bg);
      color: var(--ink);
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .sheet{
      background: var(--paper);
      width: var(--page-w);
      min-height: var(--page-h);
      margin: 20px auto;
      padding: var(--pad-y) var(--pad-x);
      position: relative;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .page-break{ page-break-after: always; }
    .page-break:last-child{ page-break-after: auto; }

    @media print {
      body { background: var(--paper); }
      .sheet{ width: 100%; height: 100%; margin: 0; border: none; }
    }

    /* Common Components */
    .letterhead{
      display: grid; grid-template-columns: 1.1fr 1.2fr 1.2fr; gap: 10px; align-items: start;
      padding-bottom: 8px; border-bottom: 2px solid var(--brand); margin-bottom: 10px;
    }
    .lh-left{ display: flex; gap: 10px; align-items: center; min-height: 52px; }
    .brand-logo{ height: 45px; width: auto; display: block; }
    .lh-center{ text-align: center; padding-top: 2px; }
    .lh-title{ font-family: var(--font-head); font-weight: 900; font-size: 15pt; letter-spacing: 1.2px; text-transform: uppercase; margin: 0; }
    .lh-subtitle{ font-family: var(--font-head); font-weight: 700; font-size: 8pt; letter-spacing: 2.2px; text-transform: uppercase; color: var(--brand); margin-top: 3px; }
    .lh-right{ text-align: right; font-size: 7pt; line-height: 1.25; color: var(--muted); }
    .lh-right strong{ color: var(--ink); font-weight: 800; }

    /* Boxes */
    .top-grid{ display: grid; grid-template-columns: 1fr 1.1fr; gap: 12px; margin-bottom: 10px; }
    .box{ border: 1px solid var(--line); border-radius: 10px; background: #fff; overflow: hidden; }
    .box-h{ background: #f8fafc; border-bottom: 1px solid var(--line); padding: 7px 9px; font-size: 7pt; font-weight: 800; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; font-family: var(--font-head); display: flex; justify-content: space-between; align-items: center; }
    .box-b{ padding: 9px; font-size: 8.2pt; color: var(--ink); }
    .kv{ display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .kv .item{ display: flex; flex-direction: column; gap: 2px; }
    .lbl{ font-size: 6.5pt; font-weight: 800; color: var(--muted2); text-transform: uppercase; letter-spacing: 0.8px; font-family: var(--font-head); }
    .val{ font-size: 8.7pt; font-weight: 800; color: #111827; }
    .subval{ font-size: 7.5pt; font-family: var(--font-mono); font-weight: 600; color: #374151; }

    /* Table */
    table{ width: 100%; border-collapse: collapse; font-size: 8.2pt; margin-top: 6px; }
    thead th{ background: var(--ink); color: #fff; padding: 6px 6px; text-align: left; font-weight: 800; text-transform: uppercase; font-size: 7pt; letter-spacing: 0.7px; font-family: var(--font-head); }
    tbody td{ border-bottom: 1px solid #efefef; padding: 5px 6px; vertical-align: top; }
    .td-num{ width: 5%; text-align: center; font-family: var(--font-mono); font-weight: 700; }
    .td-desc{ width: 45%; }
    .td-qty{ width: 10%; text-align:center; font-family: var(--font-mono); font-weight: 600; }
    .td-price{ width: 15%; text-align:right; font-family: var(--font-mono); font-weight: 600; }
    .td-vat{ width: 10%; text-align:right; font-family: var(--font-mono); font-weight: 600; }
    .td-ttc{ width: 15%; text-align:right; font-family: var(--font-mono); font-weight: 800; }
    .desc-strong{ font-weight: 700; color: #111827; }

    /* Layout: Left Column (Words/QR + Remarks) vs Right Column (Totals) */
    .mid-layout{
      display: grid;
      grid-template-columns: 1.4fr 1fr;
      gap: 12px;
      margin-top: 10px;
      align-items: start;
    }
    .left-col {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    
    /* Word/QR Block */
    .words-wrap{
      display: flex;
      gap: 10px;
      align-items: stretch;
    }
    .qr{ width: 70px; height: 70px; border: 1px solid var(--line); border-radius: 10px; background: #fff; padding: 3px; box-sizing: border-box; }
    .words-text{ flex: 1; border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; background: #fff; box-sizing: border-box; }
    .words-title{ font-size: 7pt; font-weight: 900; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; font-family: var(--font-head); margin-bottom: 4px; }
    .words-amount{ font-size: 8.4pt; font-weight: 800; text-transform: uppercase; line-height: 1.25; color: #111827; }
    .hash{ margin-top: 6px; font-size: 6.4pt; font-family: var(--font-mono); color: #6b7280; word-break: break-all; }

    /* Remarks Box */
    .remarks-box {
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #fff;
      padding: 8px 10px;
      min-height: 40px; /* expands vertically */
    }
    .remarks-title { font-size: 7pt; font-weight: 900; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; font-family: var(--font-head); margin-bottom: 4px; }
    .remarks-content { font-size: 7pt; color: var(--ink); line-height: 1.35; white-space: pre-wrap; }

    /* Totals Block */
    .totals{ border: 1px solid var(--line); border-radius: 10px; background: #fff; overflow: hidden; }
    .totals .box-h{ background: #111827; color: #fff; border-bottom-color: #111827; }
    .totals .box-b{ padding: 10px; }
    .tot-row{ display: flex; justify-content: space-between; gap: 10px; padding: 4px 0; font-size: 8.2pt; align-items: baseline; }
    .tot-row .k{ color: var(--muted); font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; font-size: 7pt; font-family: var(--font-head); }
    .tot-row .v{ font-family: var(--font-mono); font-weight: 700; color: #111827; text-align: right; white-space: nowrap; }
    .tot-sep{ height: 1px; background: var(--line); margin: 6px 0; }
    .net{ margin-top: 6px; border: 2px solid #000; border-radius: 10px; padding: 8px 10px; background: #f3f4f6; display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
    .net .k{ font-family: var(--font-head); font-weight: 900; font-size: 9.5pt; letter-spacing: 0.7px; text-transform: uppercase; color: #111827; }
    .net .v{ font-family: var(--font-mono); font-weight: 900; font-size: 10.5pt; color: #111827; white-space: nowrap; }
    .neg{ color: #b91c1c !important; }

    /* Contract terms */
    .terms{ margin-top: 10px; border: 1px solid var(--line); border-radius: 10px; background: #fff; overflow: hidden; }
    .terms .box-b{ padding: 9px 10px; font-size: 7.3pt; color: #374151; line-height: 1.35; }
    .terms ol{ margin: 0; padding-left: 16px; }
    .terms li{ margin: 2px 0; }

    /* Signatures */
    /* REMOVED margin-top: auto so they sit directly under content */
    .sig-row{
      margin-top: 10px; 
      display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px;
      page-break-inside: avoid;
    }
    .sig{ border: 1px solid var(--line); border-radius: 10px; background: #fff; overflow: hidden; min-height: var(--sig-h); display: flex; flex-direction: column; }
    .sig .box-h{ background: #f3f4f6; border-bottom: 1px solid var(--line); }
    .sig .box-b{ flex: 1; display: flex; flex-direction: column; justify-content: space-between; gap: 8px; }

    .stamp{ border: 3px double #000; border-radius: 10px; padding: 8px; text-align: center; background: #fff; margin-top: 6px; }
    .stamp .t1{ font-family: var(--font-head); font-weight: 900; font-size: 10pt; border-bottom: 1px solid #000; display: inline-block; padding-bottom: 2px; margin-bottom: 6px; letter-spacing: 0.7px; text-transform: uppercase; }
    .stamp .t2{ font-family: var(--font-head); font-weight: 900; font-size: 8pt; text-transform: uppercase; color: #111827; }
    .stamp .m{ font-family: var(--font-mono); font-weight: 700; font-size: 7pt; color: #111827; margin-top: 3px; }

    .approver{ display: flex; flex-direction: column; align-items: center; justify-content: flex-end; text-align: center; flex: 1; }
    .sig-img{ width: 90px; mix-blend-mode: multiply; margin-bottom: 4px; }
    .role-line{ width: 100%; border-top: 1px solid #9ca3af; padding-top: 4px; font-family: var(--font-head); font-weight: 900; font-size: 7pt; text-transform: uppercase; letter-spacing: 0.8px; color: #111827; }
    .pending{ margin: auto; color: #cbd5e1; font-weight: 900; font-family: var(--font-head); letter-spacing: 2px; text-transform: uppercase; }

    /* Spacer to push footer to bottom */
    .spacer {
      flex: 1;
    }

    /* Footer */
    .page-foot{
      border-top: 1px solid var(--brand); padding-top: 5px; font-size: 6.8pt; color: #374151; display: flex; justify-content: space-between; gap: 12px; align-items: flex-start;
    }
    .pill{ display: inline-flex; gap: 6px; align-items: center; padding: 4px 8px; border: 1px solid var(--line); border-radius: 999px; font-size: 7pt; font-weight: 900; letter-spacing: 0.7px; text-transform: uppercase; font-family: var(--font-head); background: #fff; color: #111827; white-space: nowrap; }
    .pill .mono{ font-family: var(--font-mono); font-weight: 700; text-transform: none; letter-spacing: 0; color: #111827; }
    .pill.brand{ border-color: rgba(238,125,4,0.35); background: rgba(238,125,4,0.07); color: #111827; }
  </style>
</head>
<body>

<?php
for ($page = 1; $page <= $totalPages; $page++) {
  $chunk = $itemPages[$page - 1] ?? [];
  $padCount = $ROWS_PER_PAGE - count($chunk);
  if ($padCount < 0) $padCount = 0;

  $status = strtoupper((string)($po['status'] ?? 'DRAFT'));
  $isApprovedFamily = in_array($status, ['APPROVED','PARTIAL','PAID'], true);
  ?>
  <div class="sheet page-break">

    <div class="letterhead">
      <div class="lh-left">
        <img src="../../../assets/img/logo-smart.png" class="brand-logo" alt="Logo" onerror="this.style.display='none'">
      </div>
      <div class="lh-center">
        <div class="lh-title">PURCHASE ORDER</div>
        <div class="lh-subtitle">BON DE COMMANDE</div>
      </div>
      <div class="lh-right">
        <?php foreach ($companyBillingLines as $i => $line): ?>
          <?php echo ($i===0 ? '<strong>'.h($line).'</strong>' : h($line)); ?><br>
        <?php endforeach; ?>
      </div>
    </div>

    <div class="top-grid">
      <div class="box">
        <div class="box-h">
          <span>Vendor (Supplier)</span>
          <span class="pill brand"><span>ID</span><span class="mono">#<?php echo h($po['supplier_id']); ?></span></span>
        </div>
        <div class="box-b">
          <div style="font-family:var(--font-head); font-weight:900; font-size:10pt; text-transform:uppercase; color:#111827;">
            <?php echo h($po['supplier_name']); ?>
          </div>
          <div style="margin-top:6px; color:#111827; line-height:1.35;">
            <?php if ($po['sup_address']): ?>
              <div><span class="lbl" style="display:inline-block; min-width:74px;">Address</span> <span class="val" style="font-size:8.2pt; font-weight:700;"><?php echo h($po['sup_address']); ?></span></div>
            <?php endif; ?>
            <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:4px;">
              <span class="pill"><span>NIU</span><span class="mono"><?php echo h($po['sup_niu']); ?></span></span>
              <?php if ($po['sup_phone']): ?>
                <span class="pill"><span>Tel</span><span class="mono"><?php echo h($po['sup_phone']); ?></span></span>
              <?php endif; ?>
            </div>
          </div>
        </div>
      </div>
      <div class="box">
        <div class="box-h">
          <span>PO Details</span>
          <span class="pill"><span>Pay</span><span class="mono"><?php echo h($po['payment_means']); ?></span></span>
        </div>
        <div class="box-b">
          <div class="kv">
            <div class="item">
              <div class="lbl">PO Date</div>
              <div class="val"><?php echo h($po['date_fmt']); ?></div>
              <div class="subval"><?php echo h($poId); ?></div>
            </div>
            <div class="item">
              <div class="lbl">Delivery Date</div>
              <div class="val" style="color:#111827;"><?php echo h($deliveryDateDisplay); ?></div>
              <div class="subval"><?php echo h($termsFull); ?></div>
            </div>
            <div class="item" style="grid-column: span 2; border-top:1px solid var(--line); padding-top:8px; margin-top:2px;">
              <div class="lbl">Place of Delivery / Service</div>
              <div class="val"><?php echo h($po['delivery_location'] ?? 'Douala HQ'); ?></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th class="td-num">#</th>
          <th class="td-desc">Description</th>
          <th class="td-qty">Qty</th>
          <th class="td-price">Unit Price</th>
          <th class="td-vat">VAT %</th>
          <th class="td-ttc">Total (TTC)</th>
        </tr>
      </thead>
      <tbody>
        <?php
        $rowIndex = 0;
        foreach ($chunk as $it):
          $rowIndex++;
          $lineTtc = (float)($it['line_ttc'] ?? 0);
        ?>
          <tr>
            <td class="td-num"><?php echo (int)($it['line_no'] ?? $rowIndex); ?></td>
            <td class="td-desc"><div class="desc-strong"><?php echo h($it['description']); ?></div></td>
            <td class="td-qty"><?php echo h((string)($it['qty'])); ?></td>
            <td class="td-price"><?php echo h(fmt($it['unit_price'], '')); ?></td>
            <td class="td-vat"><?php echo h((string)($it['vat_rate'])); ?>%</td>
            <td class="td-ttc"><?php echo h(fmt($lineTtc, '')); ?></td>
          </tr>
        <?php endforeach; ?>
        <?php for ($i = 0; $i < $padCount; $i++): ?>
          <tr><td class="td-num">&nbsp;</td><td class="td-desc">&nbsp;</td><td class="td-qty">&nbsp;</td><td class="td-price">&nbsp;</td><td class="td-vat">&nbsp;</td><td class="td-ttc">&nbsp;</td></tr>
        <?php endfor; ?>
      </tbody>
    </table>

    <?php if ($page === 1): ?>
      <div class="mid-layout">
        
        <div class="left-col">
          <div class="words-wrap">
            <img src="<?php echo h($qrUrl); ?>" class="qr" alt="QR">
            <div class="words-text">
              <div class="words-title">Amount in Words</div>
              <div class="words-amount">
                <?php echo h(numberToWords($totalTTC) . " " . $po['currency']); ?>
              </div>
              <div class="hash">HASH: <?php echo h($hash); ?></div>
            </div>
          </div>

          <div class="remarks-box">
             <div class="remarks-title">Remarks</div>
             <div class="remarks-content"><?php echo ($remarks !== '') ? h($remarks) : 'No additional remarks.'; ?></div>
          </div>
        </div>

        <div class="totals">
          <div class="box-h"><span>Totals</span> <span class="pill"><span>Currency</span><span class="mono"><?php echo h($po['currency']); ?></span></span></div>
          <div class="box-b">
            <div class="tot-row"><div class="k">Total Excl. VAT</div><div class="v"><?php echo h(fmt($totalHT, $po['currency'])); ?></div></div>
            <div class="tot-row"><div class="k">Total VAT</div><div class="v"><?php echo h(fmt($totalVAT, $po['currency'])); ?></div></div>
            <div class="tot-sep"></div>
            <div class="tot-row"><div class="k">Grand Total</div><div class="v"><?php echo h(fmt($totalTTC, $po['currency'])); ?></div></div>
            <?php if ($airAmt > 0): ?>
              <div class="tot-row"><div class="k" style="color:#b91c1c;">Withholding (<?php echo h($airRate); ?>%)</div><div class="v neg">- <?php echo h(fmt($airAmt, $po['currency'])); ?></div></div>
            <?php endif; ?>
            <?php if ($advPaid > 0): ?>
              <div class="tot-row"><div class="k">Less Advance</div><div class="v">- <?php echo h(fmt($advPaid, $po['currency'])); ?></div></div>
            <?php endif; ?>
            <div class="net"><div class="k">Net Payable</div><div class="v"><?php echo h(fmt($netPayable, $po['currency'])); ?></div></div>
          </div>
        </div>
      </div>

      <div class="terms">
         <div class="box-b">
           <ol>
             <?php foreach ($contractTerms as $term) echo "<li>" . h($term) . "</li>"; ?>
           </ol>
         </div>
      </div>

    <?php else: ?>
      <div style="margin-top:10px; border:1px dashed var(--line); border-radius:10px; padding:8px 10px; color:#6b7280; font-size:7.2pt;">
        <span style="font-family:var(--font-head); font-weight:900;">CONTINUATION</span> — Reference PO ID: <span style="font-family:var(--font-mono); font-weight:700; color:#111827;"><?php echo h($poId); ?></span>
      </div>
    <?php endif; ?>

    <div class="sig-row">
      <div class="sig">
        <div class="box-h"><span>Issued By</span></div>
        <div class="box-b">
          <div class="stamp">
            <div class="t1">ISSUED</div>
            <div class="t2"><?php echo h($po['issuer_name']); ?></div>
            <div class="m"><?php echo h($po['date_fmt'] . ' ' . $po['time_fmt']); ?></div>
            <div class="m"><?php echo h($issuerID); ?></div>
          </div>
          <div style="font-size:7pt; color:#6b7280; font-family:var(--font-mono);">
            Hash: <?php echo h(substr($hash, 0, 18) . '...'); ?>
          </div>
        </div>
      </div>
      <div class="sig">
        <div class="box-h"><span>Approved By</span></div>
        <div class="box-b">
          <?php if ($isApprovedFamily): ?>
            <div class="approver">
              <img src="../../../assets/img/signature-dg.svg" class="sig-img" alt="Signature" onerror="this.style.display='none'">
              <div class="subval" style="margin-top:2px;"><?php echo h($po['app_date_fmt'] . ' ' . $po['app_time_fmt']); ?></div>
              <div class="subval"><?php echo h($approverID); ?></div>
              <div class="role-line">Managing Director</div>
            </div>
          <?php else: ?>
            <div class="pending">PENDING</div>
          <?php endif; ?>
        </div>
      </div>
      <div class="sig">
        <div class="box-h"><span>Supplier</span></div>
        <div class="box-b" style="justify-content:flex-end;">
          <div style="flex:1; border:1px dashed var(--line); border-radius:10px; background:#fafafa; display:flex; align-items:center; justify-content:center; color:#9ca3af; font-weight:900; font-family:var(--font-head); text-transform:uppercase; letter-spacing:2px;">
            Stamp / Sign
          </div>
          <div style="display:flex; justify-content:space-between; gap:10px; margin-top:8px;">
            <div style="flex:1; border-top:1px solid #9ca3af; padding-top:4px; font-size:7pt; font-weight:900; font-family:var(--font-head); text-transform:uppercase; color:#111827;">Name</div>
            <div style="flex:0.7; border-top:1px solid #9ca3af; padding-top:4px; font-size:7pt; font-weight:900; font-family:var(--font-head); text-transform:uppercase; color:#111827; text-align:right;">Date</div>
          </div>
        </div>
      </div>
    </div>

    <div class="spacer"></div>

    <div class="page-foot">
      <div style="font-family: var(--font-head); font-weight: 700; font-size: 7.5pt; color: var(--muted2); letter-spacing: 0.5px;">
        <?php echo h($companyLegalInfo); ?>
      </div>
      <div style="font-family: var(--font-mono); font-weight: 700; font-size: 7.5pt; color: var(--ink);">
        PAGE <?php echo (int)$page; ?> / <?php echo (int)$totalPages; ?>
      </div>
    </div>

  </div>
<?php } ?>

<script>
  window.addEventListener('load', function() {
    try { window.print(); } catch(e) {}
  });
</script>
</body>
</html>