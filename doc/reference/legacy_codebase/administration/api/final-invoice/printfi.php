<?php
/**
 * ==============================================================================
 * SMART LS ENTERPRISE - FINAL INVOICE PRINT ENGINE (FLEX LAYOUT UPDATE)
 * ==============================================================================
 * UPDATES:
 * 1. Removed fixed row count (filler lines).
 * 2. Added Line VAT and Line TTC columns.
 * 3. Adjusted column widths to preserve Description readability.
 * 4. Flexbox layout pushes Audit Footer to the absolute bottom.
 */

// Prevent "Headers already sent" errors
ob_start();

// Error Reporting (Disable in production)
ini_set('display_errors', 1);
error_reporting(E_ALL);

// --- 1. SYSTEM INIT ---
require_once __DIR__ . '/../../includes/init.php';
$conn = db();

// --- 2. INPUT VALIDATION ---
$invoiceId = isset($_GET['id']) ? (int)$_GET['id'] : 0;
$lang      = (isset($_GET['lang']) && $_GET['lang'] === 'fr') ? 'fr' : 'en';

if ($invoiceId <= 0) {
    die('<div style="font-family:sans-serif; text-align:center; padding:50px;"><h1>Error</h1><p>Invalid Invoice ID provided.</p></div>');
}

// --- 3. DATA FETCHING ---
$sql = "
    SELECT 
        im.*,
        cm.client_name, 
        cm.address AS client_address, 
        cm.niu AS client_niu, 
        cm.contact_email, 
        cm.contact_person,
        
        ofm.operations_file_reference, 
        ofm.commodity,
        ofm.marks_numbers,
        ofm.weight_unit,
        ofm.service_type, 
        ofm.gross_weight, 
        ofm.incoterm,
        
        COALESCE(ofm.sea_bl, ofm.air_mawb, '') AS bl_awb_display,
        COALESCE(ofm.sea_vessel, ofm.air_airline, '') AS transport_name,
        COALESCE(ofm.sea_voyage, ofm.air_flightno, '') AS voyage_ref,
        COALESCE(ofm.sea_pol, ofm.air_origin, '') AS pol_display,
        COALESCE(ofm.sea_pod, ofm.air_dest, '') AS pod_display

    FROM invoice_master im
    LEFT JOIN client_master cm ON cm.client_id = im.client_id
    LEFT JOIN operations_file_master ofm ON ofm.operations_file_reference = im.operations_file_reference
    WHERE im.invoice_id = ?
    LIMIT 1
";

$stmt = $conn->prepare($sql);
if (!$stmt) die("SQL Error: " . $conn->error);
$stmt->bind_param('i', $invoiceId);
$stmt->execute();
$inv = $stmt->get_result()->fetch_assoc();

if (!$inv) {
    die('<div style="font-family:sans-serif; text-align:center; padding:50px;"><h1>Not Found</h1><p>Invoice #'.$invoiceId.' does not exist.</p></div>');
}

// Fetch Invoice Lines
$stmtLine = $conn->prepare("SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY line_id ASC");
if (!$stmtLine) die("SQL Error: " . $conn->error);
$stmtLine->bind_param('i', $invoiceId);
$stmtLine->execute();
$resLines = $stmtLine->get_result();
$lines = [];
while ($row = $resLines->fetch_assoc()) {
    $lines[] = $row;
}

// --- 4. CALCULATIONS & CURRENCY LOGIC ---

// A. Determine Rate & Decimals
$currencyCode = $inv['currency'] ?? 'XAF';
$rate         = (float)($inv['exchange_rate'] ?? 1.0);
if ($rate <= 0) $rate = 1.0;

// B. Smart Decimals: XAF uses 0, USD/EUR uses 2
$decimals = ($currencyCode === 'XAF') ? 0 : 2;

// C. Conversion Helper
// We divide XAF by Rate to get the Target Currency
function convert($amountXaf, $rate) {
    if ($rate == 1) return (float)$amountXaf;
    return (float)$amountXaf / $rate;
}

// D. Convert Global Totals
$totalTTC_XAF = (float)($inv['total_xaf'] ?? 0);
$payable_XAF  = (float)($inv['payable_amount_xaf'] ?? 0);
$subtotal_XAF = (float)($inv['subtotal_xaf'] ?? 0);
$vat_XAF      = (float)($inv['vat_xaf'] ?? 0);

// Apply Conversion
$totalTTC = convert($totalTTC_XAF, $rate);
$payable  = convert($payable_XAF, $rate);
$subtotal = convert($subtotal_XAF, $rate);
$vatTotal = convert($vat_XAF, $rate);

// Advance Calculation (Converted)
$advanceAmount = 0.0;
if ($payable < $totalTTC) {
    $advanceAmount = $totalTTC - $payable;
}

// E. Number Formatter Update (SafeNum now uses dynamic decimals)
function safeNum($n, $decimals = 0) { 
    return number_format((float)$n, $decimals, '.', ','); 
}

// --- 5. LANGUAGE DICTIONARY ---
$t = [
    'en' => [
        'title' => 'INVOICE',
        'bill_to' => 'BILL TO',
        'invoice_info' => 'INVOICE INFO',
        'number' => 'Number:',
        'date' => 'Date:',
        'ref' => 'File Ref:',
        'terms' => 'Terms:',
        'due_date' => 'Due Date:',
        'shipment' => 'SHIPMENT DETAILS',
        'service' => 'Service:',
        'route' => 'Route:',
        'vessel' => 'Conveyance:',
        'bl' => 'BL/AWB:',
        'marks' => 'Commodity:',
        'weight' => 'Weight:',
        'incoterm' => 'Incoterm:',
        // Table Headers
        'code' => 'CODE',
        'desc' => 'DESCRIPTION',
        'qty' => 'QTY',
        'unit' => 'UNIT',
        'total_ht' => 'TOTAL HT',
        'line_vat' => 'VAT',      // NEW
        'line_ttc' => 'TTL TTC',  // NEW
        
        'words_label' => 'AMOUNT IN WORDS:',
        'remarks_label' => 'REMARKS / BANK DETAILS:',
        'subtotal' => 'Total H.T.',
        'vat_label' => 'VAT (19.25%)',
        'gross' => 'GROSS TOTAL',
        'less_adv' => 'Less: Advance',
        'net_pay' => 'NET PAYABLE',
        'page' => 'PAGE',
        'generated' => 'Generated by Smart LS Enterprise',
        'approved_by' => 'MANAGEMENT',
        'currency' => $inv['currency'] ?? 'XAF'
    ],
    'fr' => [
        'title' => 'FACTURE',
        'bill_to' => 'FACTURER À',
        'invoice_info' => 'INFOS FACTURE',
        'number' => 'Numéro :',
        'date' => 'Date :',
        'ref' => 'Réf Dossier :',
        'terms' => 'Conditions :',
        'due_date' => 'Échéance :',
        'shipment' => 'DÉTAILS EXPÉDITION',
        'service' => 'Service :',
        'route' => 'Trajet :',
        'vessel' => 'Transport :',
        'bl' => 'LTA/BL :',
        'marks' => 'Marchandise :',
        'weight' => 'Poids :',
        'incoterm' => 'Incoterm :',
        // Table Headers
        'code' => 'CODE',
        'desc' => 'DESCRIPTION',
        'qty' => 'QTÉ',
        'unit' => 'P.U.',
        'total_ht' => 'TOTAL HT',
        'line_vat' => 'TVA',       // NEW
        'line_ttc' => 'TTL TTC',   // NEW
        
        'words_label' => 'ARRÊTÉE LA PRÉSENTE FACTURE À LA SOMME DE :',
        'remarks_label' => 'REMARQUES / COORDONNÉES BANCAIRES :',
        'subtotal' => 'Total H.T.',
        'vat_label' => 'TVA (19.25%)',
        'gross' => 'TOTAL TTC',
        'less_adv' => 'Moins : Avance',
        'net_pay' => 'NET À PAYER',
        'page' => 'PAGE',
        'generated' => 'Généré par Smart LS System',
        'approved_by' => 'LA DIRECTION',
        'currency' => $inv['currency'] ?? 'XAF'
    ]
];
$L = $t[$lang];

// --- 6. FORMATTERS ---
function safeStr($s) { return htmlspecialchars((string)$s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }

// Safe Number-to-Words
$wordStr = safeNum($payable) . " " . ($inv['currency'] ?? 'XAF');
if (class_exists('NumberFormatter')) {
    try {
        $f = new NumberFormatter($lang === 'fr' ? 'fr' : 'en', NumberFormatter::SPELLOUT);
        $wordStr = strtoupper((string)$f->format($payable)) . " " . ($inv['currency'] ?? 'XAF');
    } catch (Exception $e) { /* Ignore */ }
}

$showSig = (($inv['approval_status'] ?? '') === 'APPROVED');
$remarks = nl2br(safeStr($inv['remarks'] ?? ''));

// --- 7. SECURITY & FORMATTING ---
$keywords = ['Bank', 'Banque', 'Account', 'Compte', 'No', 'N°', 'IBAN', 'SWIFT', 'BIC'];
$rawBank = (string)($inv['bank_details'] ?? '');
if ($rawBank !== '' && function_exists('mb_check_encoding') && !mb_check_encoding($rawBank, 'UTF-8')) {
    if (function_exists('mb_convert_encoding')) $rawBank = mb_convert_encoding($rawBank, 'UTF-8', 'UTF-8');
}
$bankDetails = htmlspecialchars($rawBank, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
foreach ($keywords as $kw) {
    $safeKw = preg_quote($kw, '/');
    $tmp = preg_replace("/($safeKw)(\s*[:\.\s])/i", "<strong>$1</strong>$2", $bankDetails);
    if ($tmp !== null) $bankDetails = $tmp;
}
$bankDetails = str_replace(["\r\n", "\r", "\n"], ' | ', $bankDetails);

$dataString = (string)($inv['invoice_id'] ?? '') . (string)($inv['issue_date'] ?? '') . (string)($inv['total_xaf'] ?? '') . "SMART_SECRET_KEY";
$auditHash = function_exists('hash') ? strtoupper(hash('sha256', $dataString)) : 'HASH_UNAVAILABLE';

ob_end_clean();
?>
<!DOCTYPE html>
<html lang="<?php echo $lang; ?>">
<head>
    <meta charset="UTF-8">
    <title><?php echo $L['title'] . " - " . safeStr($inv['invoice_no'] ?? ''); ?></title>
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Montserrat:wght@400;600;700;800;900&family=Inconsolata:wght@500;700&display=swap" rel="stylesheet">

    <style>
    /* ==========================================================================
       PRINT SETTINGS
       ========================================================================== */
    @page { size: A4; margin: 6mm; }

    :root {
    --smart-orange: #EE7D04;
    --font-body: 'Manrope', sans-serif;      /* Text */
    --font-head: 'Montserrat', sans-serif;   /* Headers */
    --font-mono: 'Inconsolata', monospace;   /* Numbers */
}

/* Apply HEAD font (Montserrat) */
.legacy-company h1, 
.doc-title-text, 
.legacy-box-title, 
.billto-title, 
.legacy-table th, 
.total-label,
.sig-label,
.remarks-title {
    font-family: var(--font-head);
}

/* Apply MONO font (Inconsolata) */
.col-curr, 
.col-unit, 
.col-ht, 
.col-vat, 
.col-ttc, 
.total-val,
.hash-row {
    font-family: var(--font-mono);
}

body {
    margin: 0; padding: 0;
    background: #525659;
    font-family: var(--font-body); /* Applied Manrope */
    color: #231F20; /* Exact Ink Color */
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
}

    .legacy-invoice {
        width: 210mm;
        min-height: 297mm;
        background: #fff;
        margin: 14px auto;
        padding: 0;
        color: #000;
        display: flex;
        flex-direction: column;
        box-shadow: 0 0 12px rgba(0,0,0,0.45);
    }

    .page-pad {
        padding: 6mm;
        display: flex;
        flex-direction: column;
        min-height: 297mm;
        /* Ensure flex logic applies to inner children */
    }

    .print-pad {
        display: flex;
        flex-direction: column;
        flex: 1; /* Key for pushing footer */
        min-height: 0;
    }

    /* HEADER */
    .legacy-header {
        display: flex; justify-content: space-between; align-items: flex-start;
        padding-bottom: 6px; border-bottom: 3px solid var(--smart-orange);
        margin-bottom: 8px; gap: 10px;
    }
    .legacy-logo img { max-width: 150px; height: auto; display: block; }
    .legacy-company { text-align: right; font-size: 7.6pt; color: #231F20; line-height: 1.28; }
    .legacy-company h1 { font-size: 10pt; font-weight: 800; margin: 0 0 2px 0; text-transform: uppercase; letter-spacing: -0.4px; }

    /* TITLE */
    .doc-title-row { text-align: center; margin: 4px 0 10px 0; }
    .doc-title-text {
        font-size: 14pt; font-weight: 900; letter-spacing: 2.4px;
        text-transform: uppercase; border-bottom: 1.6px solid #000;
        display: inline-block; padding-bottom: 2px; line-height: 1.05;
    }

    /* GRID */
    .invoice-content { display: flex; flex-direction: column; flex: 0 0 auto; }
    .legacy-row { display: flex; gap: 14px; margin-bottom: 8px; }
    .legacy-col-6 { flex: 1; min-width: 0; width: 0; word-break: break-word; }
    .legacy-col-4 { width: 40%; min-width: 0; word-break: break-word; }
    .legacy-box-title {
        font-size: 7.6pt; font-weight: 800; text-transform: uppercase;
        border-bottom: 1.6px solid #000; margin-bottom: 3px; padding-bottom: 1px;
    }

    .legacy-kv-row { display: flex; margin-bottom: 1px; font-size: 7.8pt; line-height: 1.18; }
    .legacy-key { font-weight: 800; width: 78px; flex: 0 0 auto; white-space: nowrap; }
    .legacy-val { flex: 1 1 auto; font-weight: 600; color: #333; }
    .legacy-val.highlight { color: #d32f2f; font-weight: 900; }

    .billto-title { font-weight: 900; font-size: 9.2pt; text-transform: uppercase; margin-bottom: 1px; line-height: 1.12; }
    .billto-sub { font-size: 7.9pt; line-height: 1.22; margin: 0; }

    .ship-grid { display: flex; font-size: 7.8pt; gap: 10px; }
    .ship-col { flex: 1; line-height: 1.18; min-width: 0; }

    /* --- TABLE (UPDATED FOR 7 COLUMNS) --- */
    .legacy-table {
        width: 100%; border-collapse: collapse; margin-top: 6px;
        font-size: 7.5pt; /* Slightly smaller to fit 7 cols */
        table-layout: fixed;
    }
    .legacy-table th {
        border: 1px solid #000; background: #eee; padding: 3px 2px;
        text-align: center; font-weight: 800; text-transform: uppercase; line-height: 1.05;
    }
    .legacy-table td {
        border: 1px solid #000; padding: 3px 3px; vertical-align: top;
        line-height: 1.12; word-break: break-word;
    }

    /* Column Widths Strategy: 
       Code(5%) + Desc(40%) + Qty(5%) + Unit(10%) + HT(12%) + VAT(12%) + TTC(16%) = 100% 
    */
    .col-code { width: 6%; text-align: left; }
    .col-desc { width: 38%; text-align: left; } /* Maximized width */
    .col-qty  { width: 6%; text-align: center; }
    .col-curr { text-align: right; white-space: nowrap; font-family: var(--font-mono); font-weight: 700; }
    /* Specific widths for money columns to align neatly */
    .col-unit { width: 10%; text-align: right; white-space: nowrap; font-family: var(--font-mono); font-weight: 700; }
    .col-ht   { width: 12%; text-align: right; white-space: nowrap; font-family: var(--font-mono); font-weight: 700; }
    .col-vat  { width: 12%; text-align: right; white-space: nowrap; font-family: var(--font-mono); font-weight: 700; }
    .col-ttc  { width: 16%; text-align: right; white-space: nowrap; font-family: var(--font-mono); font-weight: 700; }


    /* FOOTER TOTALS AREA */
    .footer-split {
        display: flex; gap: 12px; align-items: flex-start;
        margin-top: 8px; page-break-inside: avoid;
    }
    .footer-left { flex: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .footer-right { width: 290px; flex: 0 0 auto; }

    .amount-words-box {
        font-size: 7.6pt; font-weight: 800; border: 1px solid #000;
        padding: 4px 5px; text-align: center; background: #f9f9f9;
        font-style: italic; line-height: 1.12;
    }
    .remarks-box {
        font-size: 7.6pt; border: 1px solid #000; padding: 4px 5px;
        min-height: 40px; line-height: 1.14;
    }
    .remarks-title { font-weight: 900; text-transform: uppercase; margin: 0 0 2px 0; font-size: 7.4pt; }
    .remarks-content { margin: 0; padding: 0; text-align: left; white-space: pre-wrap; }

    .totals-table { width: 100%; border-collapse: collapse; font-size: 8.3pt; border: 1px solid #000; }
    .totals-table td { padding: 3px 6px; border-bottom: 1px solid #ccc; line-height: 1.15; }
    .totals-table tr:last-child td { border-bottom: none; }
    .total-label { font-weight: 800; }
    .total-val { text-align: right; font-weight: 900; font-family: var(--font-mono); letter-spacing: -0.3px; }
    .grand-total-row { background: #eee; border-top: 2px solid #000; }
    .net-pay-row { border-top: 2px solid #000; font-size: 9.6pt; }

    .sig-area { text-align: center; margin-top: 8px; height: 160px; }
    .sig-label { font-weight: 900; text-decoration: underline; margin-bottom: 4px; font-size: 7.6pt; text-transform: uppercase; }
    .sig-img { max-width: 170px; height: 140px; display: block; margin: 0 auto; object-fit: contain; }

    /* FLEX SPACER: THE MAGIC PATCH */
    .flex-spacer {
        flex: 1 1 auto; /* Grow to fill space */
        min-height: 20px; /* Minimum breathing room */
    }

    /* AUDIT FOOTER (Pinned to Bottom via Flex) */
    /* FOOTER - ALIGNED WITH PROFORMA + HASH STACK */
.page-footer {
    border-top: 2px solid var(--smart-orange);
    padding-top: 6px;
    margin-top: auto; /* Push to bottom */
    font-size: 7.5pt;
    color: #374151;
    background: #fff; /* Ensure white background */
}

.footer-row-main {
    display: flex;
    justify-content: space-between;
    align-items: flex-start; /* Aligns Page Number to the top */
    margin-bottom: 6px;
}

.footer-info {
    line-height: 1.35;
    color: #374151;
}

.footer-meta {
    text-align: right;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
}

.hash-row {
    width: 100%;
    border-top: 1px dotted #ccc;
    padding-top: 4px;
    font-family: var(--font-mono);
    font-size: 6.5pt;
    color: #666;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
    .audit-left { width: 60%; border-right: 1px solid #ccc; padding-right: 6mm; line-height: 1.25; }
    .audit-right { width: 35%; text-align: right; display: flex; flex-direction: column; justify-content: space-between; }
    .hash-block { margin-top: 6px; border-top: 1px dotted #999; padding-top: 4px; }
    .hash-title { font-size: 6pt; color: #666; font-family: monospace; text-transform: uppercase; }
    .hash-value { font-family: monospace; font-size: 6.4pt; color: #000; letter-spacing: 0.7px; word-break: break-all; }
    .hash-meta { font-size: 6pt; font-style: italic; margin-top: 2px; }

    @media print {
        body { background: #fff; }
        .legacy-invoice { margin: 0; box-shadow: none; width: 100%; min-height: auto; }
        .page-pad { padding: 0; min-height: auto; }
        .print-pad { padding: 0; min-height: calc(297mm - 12mm); /* Force height to A4 printable area */ }
    }
    
    /* --- PROFORMA ALIGNMENT OVERRIDES --- */
.legacy-invoice {
    font-size: 8.5pt; 
    line-height: 1.25;
}
.legacy-company { 
    font-size: 8pt; 
    color: #231F20; 
}
.legacy-company h1 { 
    font-size: 11pt; 
    font-weight: 800; 
    letter-spacing: -0.5px;
}
.legacy-box-title {
    font-size: 8pt; 
    font-weight: 700;
}
.legacy-table {
    font-size: 8pt; 
    margin-top: 10px;
}
.legacy-table th {
    font-size: 7.5pt; 
    padding: 4px 3px;
}
.legacy-kv-row, .grid-row {
    font-size: 8.5pt; 
}
    </style>
</head>
<body onload="window.print()">

    <div class="legacy-invoice">
        <div class="page-pad">
            <div class="print-pad">

                <div class="legacy-header">
                    <div class="legacy-logo">
                        <img src="../../../assets/img-webp/logo-smart.webp" alt="Smart LS Logo">
                    </div>
                    <div class="legacy-company">
                        <h1>Smart Logistics And Services Ltd</h1>
                        <div>1030, Avenue Douala Manga Bell, Bali</div>
                        <div>PO Box 5120, Douala, Cameroon</div>
                        <div>+237 233 420 281 | invoicing@smartls.cm</div>
                    </div>
                </div>

                <div class="doc-title-row">
                    <div class="doc-title-text"><?php echo $L['title']; ?></div>
                </div>

                <div class="invoice-content">

                    <div class="legacy-row">
                        <div class="legacy-col-6">
                            <div class="legacy-box-title"><?php echo $L['bill_to']; ?></div>
                            <div class="billto-title">
                                <?php echo safeStr($inv['client_name'] ?? ''); ?>
                                <span style="color:#666; font-size:0.9em;">[<?php echo safeStr($inv['client_id'] ?? ''); ?>]</span>
                            </div>
                            <div class="billto-sub"><?php echo safeStr($inv['client_address'] ?? ''); ?></div>
                            <?php if(!empty($inv['contact_person'])): ?>
                                <div class="billto-sub"><span style="font-weight:800;">ATTN:</span> <?php echo safeStr($inv['contact_person']); ?></div>
                            <?php endif; ?>
                            <?php if(!empty($inv['contact_email'])): ?>
                                <div class="billto-sub"><span style="font-weight:800;">Email:</span> <?php echo safeStr($inv['contact_email']); ?></div>
                            <?php endif; ?>
                            <div class="billto-sub"><span style="font-weight:800;">NIU:</span> <?php echo safeStr($inv['client_niu'] ?? ''); ?></div>
                        </div>

                        <div class="legacy-col-4">
                            <div class="legacy-box-title"><?php echo $L['invoice_info']; ?></div>
                            <div>
                                <div class="legacy-kv-row">
                                    <div class="legacy-key"><?php echo $L['number']; ?></div>
                                    <div class="legacy-val highlight"><?php echo safeStr($inv['invoice_no'] ?? ''); ?></div>
                                </div>
                                <div class="legacy-kv-row">
                                    <div class="legacy-key"><?php echo $L['date']; ?></div>
                                    <div class="legacy-val">
                                        <?php echo ($inv['issue_date'] ?? '') !== '' ? date('d/m/Y', strtotime($inv['issue_date'])) : '-'; ?>
                                    </div>
                                </div>
                                <div class="legacy-kv-row">
                                    <div class="legacy-key"><?php echo $L['ref']; ?></div>
                                    <div class="legacy-val"><?php echo safeStr($inv['operations_file_reference'] ?? ''); ?></div>
                                </div>
                                <div class="legacy-kv-row">
                                    <div class="legacy-key"><?php echo $L['due_date']; ?></div>
                                    <div class="legacy-val">
                                        <?php echo ($inv['due_date'] ?? '') !== '' ? date('d/m/Y', strtotime($inv['due_date'])) : '-'; ?>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div style="margin-bottom: 6px;">
                        <div class="legacy-box-title"><?php echo $L['shipment']; ?></div>
                        <div class="ship-grid">
                            <div class="ship-col">
                                <div class="legacy-kv-row">
                                    <div class="legacy-key"><?php echo $L['service']; ?></div>
                                    <div class="legacy-val"><?php echo safeStr($inv['service_type'] ?? ''); ?></div>
                                </div>
                                <div class="legacy-kv-row">
                                    <div class="legacy-key"><?php echo $L['route']; ?></div>
                                    <div class="legacy-val"><?php echo safeStr(($inv['pol_display'] ?? '')) . ' ➝ ' . safeStr(($inv['pod_display'] ?? '')); ?></div>
                                </div>
                                <div class="legacy-kv-row">
                                    <div class="legacy-key"><?php echo $L['vessel']; ?></div>
                                    <div class="legacy-val"><?php echo safeStr(($inv['transport_name'] ?? '') . ' / ' . ($inv['voyage_ref'] ?? '')); ?></div>
                                </div>
                            </div>
                            <div class="ship-col">
                                <div class="legacy-kv-row">
                                    <div class="legacy-key"><?php echo $L['bl']; ?></div>
                                    <div class="legacy-val"><?php echo safeStr($inv['bl_awb_display'] ?? ''); ?></div>
                                </div>
                                <div class="legacy-kv-row">
                                    <div class="legacy-key">Marks & N°:</div>
                                    <div class="legacy-val"><?php echo safeStr($inv['marks_numbers'] ?? ''); ?></div>
                                </div>
                                <div class="legacy-kv-row">
                                    <div class="legacy-key"><?php echo $L['incoterm']; ?></div>
                                    <div class="legacy-val"><?php echo safeStr($inv['incoterm'] ?? ''); ?></div>
                                </div>
                            </div>
                            <div class="ship-col">
                                <div class="legacy-kv-row">
                                    <div class="legacy-key"><?php echo $L['marks']; ?></div>
                                    <div class="legacy-val"><?php echo safeStr($inv['commodity'] ?? ''); ?></div>
                                </div>
                                <div class="legacy-kv-row">
                                    <div class="legacy-key"><?php echo $L['weight']; ?></div>
                                    <div class="legacy-val"><?php echo safeStr(($inv['gross_weight'] ?? '') . ' ' . ($inv['weight_unit'] ?? '')); ?></div>
                                </div>
                                <div class="legacy-kv-row">
                                    <div class="legacy-key">Dest.:</div>
                                    <div class="legacy-val"><?php echo safeStr($inv['pod_display'] ?? ''); ?></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <table class="legacy-table">
                        <thead>
                            <tr>
                                <th class="col-code"><?php echo $L['code']; ?></th>
                                <th class="col-desc"><?php echo $L['desc']; ?></th>
                                <th class="col-qty"><?php echo $L['qty']; ?></th>
                                <th class="col-unit"><?php echo $L['unit']; ?></th>
                                <th class="col-ht"><?php echo $L['total_ht']; ?></th>
                                <th class="col-vat"><?php echo $L['line_vat']; ?></th>
                                <th class="col-ttc"><?php echo $L['line_ttc']; ?></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tbody>
                            <?php foreach ($lines as $line): 
    // 1. Get XAF Values from DB
    $lineTotalXAF = (float)($line['line_total_xaf'] ?? 0);
    $lineVatXAF   = (float)($line['vat_amount_xaf'] ?? 0);
    $unitXAF      = (float)($line['unit_price_xaf'] ?? 0);
    
    // 2. Convert to Target Currency (USD/EUR/etc)
    $unitPrice = convert($unitXAF, $rate);
    $lineTotal = convert($lineTotalXAF, $rate);
    $lineVat   = convert($lineVatXAF, $rate);
    $lineTtc   = $lineTotal + $lineVat;
?>
<tr>
    <td class="col-code"><?php echo safeStr($line['dict_code'] ?? ''); ?></td>
    <td class="col-desc"><?php echo safeStr($line['description'] ?? ''); ?></td>
    <td class="col-qty"><?php echo (float)($line['qty'] ?? 0); ?></td>
    
    <td class="col-unit"><?php echo safeNum($unitPrice, $decimals); ?></td>
    <td class="col-ht"><?php echo safeNum($lineTotal, $decimals); ?></td>
    <td class="col-vat"><?php echo safeNum($lineVat, $decimals); ?></td>
    <td class="col-ttc"><?php echo safeNum($lineTtc, $decimals); ?></td>
</tr>
<?php endforeach; ?>
                        </tbody>
                    </table>

                </div><div class="footer-split">
                    <div class="footer-left">
                        <div class="amount-words-box">
                            <?php echo $L['words_label']; ?><br>
                            <span style="text-transform: uppercase;"><?php echo $wordStr; ?></span>
                        </div>
                        <div class="remarks-box">
                            <div class="remarks-title"><?php echo $L['remarks_label']; ?></div>
                            <div class="remarks-content"><?php echo $remarks; ?></div>
                        </div>
                    </div>
                    <div class="footer-right">
                        <table class="totals-table">
    <tr>
        <td class="total-label"><?php echo $L['subtotal']; ?></td>
        <td class="total-val"><?php echo safeNum($subtotal, $decimals); ?></td>
    </tr>
    <tr>
        <td class="total-label"><?php echo $L['vat_label']; ?></td>
        <td class="total-val"><?php echo safeNum($vatTotal, $decimals); ?></td>
    </tr>
    <tr class="grand-total-row">
        <td class="total-label"><?php echo $L['gross']; ?></td>
        <td class="total-val"><?php echo safeNum($totalTTC, $decimals); ?></td>
    </tr>
    <?php if ($advanceAmount > 0): ?>
    <tr>
        <td class="total-label" style="color:#b91c1c;"><?php echo $L['less_adv']; ?></td>
        <td class="total-val" style="color:#b91c1c;">(<?php echo safeNum($advanceAmount, $decimals); ?>)</td>
    </tr>
    <?php endif; ?>
    <tr class="net-pay-row">
        <td class="total-label"><?php echo $L['net_pay']; ?></td>
        <td class="total-val"><?php echo safeNum($payable, $decimals) . ' ' . safeStr($currencyCode); ?></td>
    </tr>
</table>
                        <div class="sig-area">
                            <div class="sig-label"><?php echo $L['approved_by']; ?></div>
                            <?php 
                            $isApproved = (($inv['approval_status'] ?? '') === 'APPROVED');
                            $sigMode = $inv['signature_mode'] ?? 'DIGITAL';

                            if ($isApproved) {
                                if ($sigMode === 'DIGITAL') {
                                    // Option A: Digital Signature Image
                                    echo '<img src="../../../assets/img/signature-dg.svg" class="sig-img" alt="Signature">';
                                } else {
                                    // Option B: Wet Ink (Empty Box)
                                    echo '<div style="height: 200px; width: 80%; margin: 10px auto; border: 1px dashed #ccc; display: flex; align-items: center; justify-content: center; color: #bbb; font-size: 0.3rem; font-family: sans-serif;">SMART LOGISTICS & SERVICES LTD</div>';
                                }
                            }
                            ?>
                        </div>
                    </div>
                </div>

                <div class="flex-spacer"></div>

                <div class="page-footer">
    <div class="footer-row-main">
        <div class="footer-info">
            <strong>NIU:</strong> <?php echo safeStr($inv['client_niu'] ?? 'M042116033580Q'); ?> | <strong>RC:</strong> RC/DLA/2021/B/2060<br>
            <?php echo $bankDetails; ?>
        </div>
        <div class="footer-meta">
            <div class="page-num">PAGE <span class="page-current">1</span> / <span class="page-total">1</span></div>
            <div>Generated by Smart LS System | <?php echo ($inv['issue_date'] ?? '') !== '' ? date('d/m/Y', strtotime($inv['issue_date'])) : ''; ?></div>
        </div>
    </div>

    <div class="hash-row">
        <strong>AUDIT HASH:</strong> <?php echo safeStr($auditHash); ?>
    </div>
</div>

            </div></div></div><script>
    (function(){
        var els = document.querySelectorAll('.page-num');
        for (var i=0; i<els.length; i++) els[i].textContent = '1';
    })();
    </script>
</body>
</html>