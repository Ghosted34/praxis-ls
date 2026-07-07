<?php
/**
 * ============================================================================
 * PROFORMA PRINT DATA API (LEGACY-EXACT PAYLOAD)
 * ============================================================================
 * Purpose:
 * - Return a render-ready payload that matches the locked frontend's
 *   generateLegacyHTML(data) expectations exactly.
 * - Enriches PI data with client_master + operations_file_master.
 *
 * Contract (top-level keys):
 *  success, bill_to[], header{}, shipment{}, labels{}, words{}, remarks,
 *  totals{}, lines[]
 * ============================================================================
 */

declare(strict_types=1);

require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';

header('Content-Type: application/json; charset=utf-8');

// ============================================================================
// AUTHENTICATION
// ============================================================================
if (!isset($_SESSION['auth']['user_id'])) {
  http_response_code(401);
  echo json_encode(['success' => false, 'error' => 'Unauthorized']);
  exit;
}

$invoiceId = (int)($_GET['invoice_id'] ?? 0);
$langRaw   = (string)($_GET['lang'] ?? 'en');
$lang      = (strtolower($langRaw) === 'fr') ? 'fr' : 'en';

if ($invoiceId <= 0) {
  http_response_code(400);
  echo json_encode(['success' => false, 'error' => 'Invalid invoice ID']);
  exit;
}

$conn = db();

try {
  $printData = getProformaPrintDataLegacyContract($conn, $invoiceId, $lang);
  $printData['success'] = true; // must be top-level; frontend expects success flag too
  echo json_encode($printData);
} catch (Throwable $e) {
  http_response_code(500);
  echo json_encode([
    'success' => false,
    'error' => 'Server error: ' . $e->getMessage(),
  ]);
  exit;
}

// ============================================================================
// MAIN FUNCTION: RETURN RENDER-READY LEGACY PAYLOAD
// ============================================================================

function getProformaPrintDataLegacyContract(mysqli $conn, int $invoiceId, string $lang): array
{
  // Step 1: Get Proforma Invoice Header
  // NOTE: Keeping your collation safeguard on JOIN (linked_quote_ref vs simulation_ref)
  $headerSql = "
    SELECT
      pi.invoice_id,
      pi.invoice_no,
      pi.operations_file_reference,
      pi.linked_quote_ref,
      pi.client_id,
      pi.issue_date,
      pi.due_date,
      pi.currency,
      pi.subtotal_xaf,
      pi.vat_xaf,
      pi.total_xaf,
      pi.advance_percentage,
      pi.payable_amount_xaf,
      pi.bank_details,
      pi.remarks,
      pi.status,
      pi.approval_status,
      pi.signature_mode,
      pi.created_at,

      mps.client_name_cached,
      mps.q_bank_details AS quote_bank_details,
      mps.q_terms        AS quote_payment_terms

    FROM proforma_invoice pi
    LEFT JOIN marginpricing_simulations mps
      ON (pi.linked_quote_ref COLLATE utf8mb4_general_ci)
       = (mps.simulation_ref  COLLATE utf8mb4_general_ci)
    WHERE pi.invoice_id = ?
      AND pi.invoice_type = 'PROFORMA'
    LIMIT 1
  ";

  $stmt = $conn->prepare($headerSql);
  if (!$stmt) {
    throw new Exception('Failed to prepare proforma header query');
  }
  $stmt->bind_param('i', $invoiceId);
  $stmt->execute();
  $header = $stmt->get_result()->fetch_assoc();
  $stmt->close();

  if (!$header) {
    throw new Exception('Proforma invoice not found');
  }

  // Step 2: Operations File Details (optional)
  $opsData = null;
  $fileRef = trim((string)($header['operations_file_reference'] ?? ''));
  if ($fileRef !== '') {
    $opsData = getOperationsFileData($conn, $fileRef);
  }

  // Step 3: Client Master Details (authoritative)
  $clientId = trim((string)($header['client_id'] ?? ''));
  $clientData = getClientData($conn, $clientId);

  // Step 4: Proforma Lines
  $linesSql = "
    SELECT
      line_id,
      line_no,
      dict_code,
      description,
      qty,
      unit_price_xaf,
      line_total_xaf,
      vat_applicable,
      vat_rate,
      vat_amount_xaf,
      line_total_ttc_xaf,
      remarks,
      is_ad_hoc,
      source_quote_line_id
    FROM proforma_invoice_lines
    WHERE invoice_id = ?
    ORDER BY line_no
  ";

  $stmt = $conn->prepare($linesSql);
  if (!$stmt) {
    throw new Exception('Failed to prepare proforma lines query');
  }
  $stmt->bind_param('i', $invoiceId);
  $stmt->execute();
  $linesResult = $stmt->get_result();

  $lines = [];
  while ($row = $linesResult->fetch_assoc()) {
    $qty  = (float)($row['qty'] ?? 0);
    $unit = (float)($row['unit_price_xaf'] ?? 0);
    $ht   = (float)($row['line_total_xaf'] ?? ($qty * $unit));

    $vatApplicable = ((int)($row['vat_applicable'] ?? 0)) === 1;
    $vatRate       = (float)($row['vat_rate'] ?? 0.1925);
    $vatAmount     = (float)($row['vat_amount_xaf'] ?? ($vatApplicable ? ($ht * $vatRate) : 0));

    $ttc = (float)($row['line_total_ttc_xaf'] ?? ($ht + $vatAmount));

    // Frontend expects: {code, desc, qty, unit, ht, vat, ttc}
    $lines[] = [
      'code' => (string)($row['dict_code'] ?? ''),
      'desc' => (string)($row['description'] ?? ''),
      'qty'  => $qty,
      'unit' => $unit,
      'ht'   => $ht,
      'vat'  => $vatAmount,
      'ttc'  => $ttc,
    ];
  }
  $stmt->close();

  // Step 5: Header mapping (legacy contract)
  $invoiceNo = (string)($header['invoice_no'] ?? '');
  $currency  = (string)($header['currency'] ?? 'XAF');

  $issueDateRaw = (string)($header['issue_date'] ?? '');
  $issueDateFmt = formatDateForPrint($issueDateRaw, $lang);

  // IMPORTANT (per your rule): Terms MUST ALWAYS be "Upon reception" (due immediately)
  // Also send terms_days=0 for downstream ledger logic (frontend may ignore; SRL can use it).
  $terms = defaultTerms($lang);
  $termsDays = 0;

  // File reference shown in "File Ref:"
  $fileRefForHeader = ($fileRef !== '') ? $fileRef : '-';

  // Step 6: Bill To block in the exact line order you specified
  // 1) CLIENT NAME [CLIENT_ID]
  // 2) Address
  // 3) ATTN: ...
  // 4) Email: ...
  // 5) NIU: ...
  $billTo = buildBillToFiveLines($clientData, $lang);

  // Step 7: Shipment mapping
  $shipment = buildShipmentForLegacy($opsData);

  // Step 8: Totals mapping
  $totalHT  = (float)($header['subtotal_xaf'] ?? 0);
  $totalVAT = (float)($header['vat_xaf'] ?? 0);
  $totalTTC = (float)($header['total_xaf'] ?? ($totalHT + $totalVAT));

  $pct = (int)($header['advance_percentage'] ?? 100);
  if ($pct <= 0 || $pct > 100) $pct = 100;

  $advance = (float)($header['payable_amount_xaf'] ?? round($totalTTC * ($pct / 100)));

  // Step 9: Labels
  // IMPORTANT (per your rule): signature label should be "INVOICING" (not MANAGEMENT)
  $labels = [
    'vat'        => ($lang === 'fr') ? 'TVA' : 'VAT',
    'management' => ($lang === 'fr') ? 'FACTURATION' : 'INVOICING',
  ];

  // Step 10: Amount in words
  $wordsLabel  = ($lang === 'fr') ? 'MONTANT EN LETTRES:' : 'AMOUNT IN WORDS:';
  $amountWords = amountToWords((int)round($advance), $currency, $lang);

  // Keep remarks as-is (but DO NOT use it for "terms")
  $remarks = (string)($header['remarks'] ?? '');

  return [
    'bill_to' => $billTo,

    'header' => [
      'invoice_no'  => $invoiceNo,
      'date'        => $issueDateFmt,
      'file_ref'    => $fileRefForHeader,
      'terms'       => $terms,
      'terms_days'  => $termsDays,
      'currency'    => $currency,
      'signature_mode' => $header['signature_mode'] ?? 'DIGITAL',
    ],

    'shipment' => $shipment,

    'labels' => $labels,

    'words' => [
      'label'  => $wordsLabel,
      'amount' => $amountWords,
    ],

    'remarks' => $remarks,

    'totals' => [
      'ht'      => $totalHT,
      'vat'     => $totalVAT,
      'ttc'     => $totalTTC,
      'pct'     => $pct,
      'advance' => $advance,
    ],

    'lines' => $lines,
  ];
}


// ============================================================================
// HELPER: GET OPERATIONS FILE DATA
// ============================================================================

function getOperationsFileData(mysqli $conn, string $fileRef): ?array
{
  $sql = "
    SELECT
      operations_file_reference,
      client_id,
      service_type,
      service_territory,
      voyage_no,
      port_of_loading,
      port_of_delivery,
      commodity,
      commodity_desc,
      gross_weight,
      weight_unit,
      incoterm,
      marks_numbers,
      place_receipt,
      place_delivery,
      eta,
      ata,
      sea_bl,
      sea_vessel,
      sea_voyage,
      sea_pol,
      sea_pod,
      air_mawb,
      air_airline,
      air_flightno,
      air_origin,
      air_dest,
      inland_truck,
      inland_decl,
      package_count,
      operations_status
    FROM operations_file_master
    WHERE operations_file_reference = ?
    LIMIT 1
  ";

  $stmt = $conn->prepare($sql);
  if (!$stmt) {
    throw new Exception('Failed to prepare operations file query');
  }
  $stmt->bind_param('s', $fileRef);
  $stmt->execute();
  $row = $stmt->get_result()->fetch_assoc();
  $stmt->close();

  return $row ?: null;
}

// ============================================================================
// HELPER: GET CLIENT DATA (FIXED TO YOUR ACTUAL TABLE)
// client_master columns you shared:
// client_id, client_name, contact_person, contact_email, contact_phone, niu, rccm, address, country, ...
// ============================================================================

function getClientData(mysqli $conn, string $clientId): ?array
{
  $clientId = trim($clientId);
  if ($clientId === '' || strtoupper($clientId) === 'GENERIC') {
    return null;
  }

  $sql = "
    SELECT
      client_id,
      client_name,
      contact_person,
      contact_email,
      contact_phone,
      niu,
      rccm,
      address,
      country,
      payment_terms_days
    FROM client_master
    WHERE client_id = ?
    LIMIT 1
  ";

  $stmt = $conn->prepare($sql);
  if (!$stmt) {
    throw new Exception('Failed to prepare client master query');
  }
  $stmt->bind_param('s', $clientId);
  $stmt->execute();
  $client = $stmt->get_result()->fetch_assoc();
  $stmt->close();

  return $client ?: null;
}

// ============================================================================
// BUILDERS: BILL-TO, SHIPMENT, FORMATTING
// ============================================================================

function buildBillToFiveLines(?array $clientData, string $lang): array
{
  // Required order:
  // 1) CLIENT NAME [CLIENT_ID]
  // 2) Address
  // 3) ATTN: <contact_person>
  // 4) Email: <contact_email>
  // 5) NIU: <niu>

  $clientName = '';
  $clientId   = '';
  $addr       = '';
  $attn       = '';
  $email      = '';
  $niu        = '';

  if (is_array($clientData)) {
    $clientName = trim((string)($clientData['client_name'] ?? ''));
    $clientId   = trim((string)($clientData['client_id'] ?? ''));
    $addr       = trim((string)($clientData['address'] ?? ''));
    $attn       = trim((string)($clientData['contact_person'] ?? ''));
    $email      = trim((string)($clientData['contact_email'] ?? ''));
    $niu        = trim((string)($clientData['niu'] ?? ''));
  }

  if ($clientName === '') $clientName = 'N/A';

  // Line 1 must include Client ID in brackets if present
  $line1 = $clientId !== '' ? ($clientName . ' [' . $clientId . ']') : $clientName;

  // Keep address as provided (no forced bold here; frontend controls styling)
  $line2 = $addr;

  // Exact labels (case-sensitive as you requested)
  $line3 = $attn !== '' ? ('ATTN: ' . $attn) : '';
  $line4 = $email !== '' ? ('Email: ' . $email) : '';
  $line5 = $niu !== '' ? ('NIU: ' . $niu) : '';

  // Strict 5 lines
  return [$line1, $line2, $line3, $line4, $line5];
}


function buildShipmentForLegacy(?array $opsData): array
{
  // Frontend expects:
  // service, route, vessel, bl_awb, marks, incoterm, commodity, weight, dest
  if (!is_array($opsData)) {
    return [
      'service'   => '-',
      'route'     => '-',
      'vessel'    => '-',
      'bl_awb'    => '-',
      'marks'     => '-',
      'incoterm'  => '-',
      'commodity' => '-',
      'weight'    => '-',
      'dest'      => '-',
    ];
  }

  $service = formatServiceType((string)($opsData['service_type'] ?? ''));

  $route = buildRoute($opsData);

  // "Vessel:" line: SEA vessel/voyage or AIR airline/flight
  $vessel = buildVesselVoyage($opsData);

  // "BL/MAWB:" line
  $blAwb = buildBLAWB($opsData);

  $marks = trim((string)($opsData['marks_numbers'] ?? ''));
  if ($marks === '') $marks = '-';

  $incoterm = trim((string)($opsData['incoterm'] ?? ''));
  if ($incoterm === '') $incoterm = '-';

  $commodity = trim((string)($opsData['commodity'] ?? ''));
  if ($commodity === '') $commodity = '-';

  $weight = formatWeight($opsData['gross_weight'] ?? null, $opsData['weight_unit'] ?? null);

  // "Dest:" should prefer place_delivery, else port_of_delivery, else SEA POD / AIR DEST
  $dest = trim((string)($opsData['place_delivery'] ?? ''));
  if ($dest === '') $dest = trim((string)($opsData['port_of_delivery'] ?? ''));
  if ($dest === '') $dest = trim((string)($opsData['sea_pod'] ?? ''));
  if ($dest === '') $dest = trim((string)($opsData['air_dest'] ?? ''));
  if ($dest === '') $dest = '-';

  return [
    'service'   => $service,
    'route'     => $route,
    'vessel'    => $vessel,
    'bl_awb'    => $blAwb,
    'marks'     => $marks,
    'incoterm'  => $incoterm,
    'commodity' => $commodity,
    'weight'    => $weight,
    'dest'      => $dest,
  ];
}

function formatDateForPrint(string $ymd, string $lang): string
{
  $ymd = trim($ymd);
  if ($ymd === '') return '-';
  $ts = strtotime($ymd);
  if (!$ts) return $ymd;

  // You indicated dd/mm/yyyy requirement; keep consistent for both languages.
  return date('d/m/Y', $ts);
}

function extractTermsFromRemarks(string $remarks, string $lang): string
{
  $remarks = trim($remarks);
  if ($remarks === '') return '';

  $lines = preg_split('/\R/', $remarks) ?: [];
  foreach ($lines as $l) {
    $t = trim((string)$l);
    if ($t === '') continue;

    // Ignore status markers like [REJECTED...], [APPROVED...], etc.
    if (preg_match('/^\[.*\]$/', $t)) continue;

    // Only accept explicit terms lines
    // e.g. "Terms: Upon reception" / "Payment terms: 30 days"
    if (preg_match('/^(terms|payment\s*terms)\s*:/i', $t)) {
      $t = preg_replace('/^(terms|payment\s*terms)\s*:\s*/i', '', $t);
      return trim((string)$t);
    }
  }
  return '';
}


function defaultTerms(string $lang): string
{
  // Business rule: due immediately
  return ($lang === 'fr') ? 'À réception' : 'Upon reception';
}


// ============================================================================
// FORMATTING UTILITIES (kept + extended)
// ============================================================================

function formatServiceType(string $serviceType): string
{
  $map = [
    'SEA_FREIGHT_IMPORT' => 'Sea Freight Import',
    'SEA_FREIGHT_EXPORT' => 'Sea Freight Export',
    'AIR_FREIGHT_IMPORT' => 'Air Freight Import',
    'AIR_FREIGHT_EXPORT' => 'Air Freight Export',
    'INLAND_TRANSPORT'   => 'Inland Transport',
    'WAREHOUSE'          => 'Warehousing',
    'CUSTOMS_CLEARANCE'  => 'Customs Clearance',
  ];

  return $map[$serviceType] ?? ($serviceType !== '' ? $serviceType : '-');
}

function buildRoute(array $ops): string
{
  $serviceType = (string)($ops['service_type'] ?? '');

  if ($serviceType === 'SEA_FREIGHT_IMPORT' || $serviceType === 'SEA_FREIGHT_EXPORT') {
    $pol = $ops['sea_pol'] ?? $ops['port_of_loading'] ?? '';
    $pod = $ops['sea_pod'] ?? $ops['port_of_delivery'] ?? '';
    $pol = trim((string)$pol);
    $pod = trim((string)$pod);
    if ($pol === '' && $pod === '') return '-';
    return trim($pol . ' → ' . $pod);
  }

  if ($serviceType === 'AIR_FREIGHT_IMPORT' || $serviceType === 'AIR_FREIGHT_EXPORT') {
    $origin = trim((string)($ops['air_origin'] ?? ''));
    $dest   = trim((string)($ops['air_dest'] ?? ''));
    if ($origin === '' && $dest === '') return '-';
    return trim($origin . ' → ' . $dest);
  }

  return '-';
}

function formatWeight($weight, $unit): string
{
  if ($weight === null || $weight === '' || (float)$weight <= 0) {
    return '-';
  }

  $formattedWeight = number_format((float)$weight, 2);
  $u = strtoupper((string)($unit ?? 'KG'));
  if ($u === '') $u = 'KG';

  return $formattedWeight . ' ' . $u;
}

function buildVesselVoyage(array $ops): string
{
  $vessel = trim((string)($ops['sea_vessel'] ?? ''));
  $voyage = trim((string)($ops['sea_voyage'] ?? ''));
  if ($vessel !== '' || $voyage !== '') {
    $x = trim($vessel . ' / ' . $voyage, " /");
    return $x !== '' ? $x : '-';
  }

  $airline = trim((string)($ops['air_airline'] ?? ''));
  $flight  = trim((string)($ops['air_flightno'] ?? ''));
  if ($airline !== '' || $flight !== '') {
    $x = trim($airline . ' ' . $flight);
    return $x !== '' ? $x : '-';
  }

  return '-';
}

function buildBLAWB(array $ops): string
{
  $bl = trim((string)($ops['sea_bl'] ?? ''));
  if ($bl !== '') {
    return 'B/L: ' . $bl;
  }

  $mawb = trim((string)($ops['air_mawb'] ?? ''));
  if ($mawb !== '') {
    return 'MAWB: ' . $mawb;
  }

  return '-';
}

// ============================================================================
// AMOUNT IN WORDS (basic deterministic integer conversion)
// ============================================================================
function amountToWords(int $amount, string $currency, string $lang): string
{
  if ($amount < 0) $amount = abs($amount);

  $suffix = currencySuffix($currency, $lang);
  if ($amount === 0) {
    return ($lang === 'fr')
      ? ('ZERO ' . $suffix)
      : ('ZERO ' . $suffix);
  }

  $words = ($lang === 'fr') ? numberToWordsFr($amount) : numberToWordsEn($amount);
  $words = strtoupper(trim($words));

  return trim($words . ' ' . strtoupper($suffix));
}

function currencySuffix(string $currency, string $lang): string
{
  $c = strtoupper(trim($currency));
  if ($c === 'XAF' || $c === 'FCFA') return 'FCFA';
  if ($c === 'USD') return ($lang === 'fr') ? 'DOLLARS' : 'DOLLARS';
  if ($c === 'EUR') return ($lang === 'fr') ? 'EUROS' : 'EUROS';
  return $c !== '' ? $c : 'FCFA';
}

function numberToWordsEn(int $n): string
{
  $ones = [
    0=>'zero',1=>'one',2=>'two',3=>'three',4=>'four',5=>'five',6=>'six',7=>'seven',8=>'eight',9=>'nine',
    10=>'ten',11=>'eleven',12=>'twelve',13=>'thirteen',14=>'fourteen',15=>'fifteen',16=>'sixteen',17=>'seventeen',18=>'eighteen',19=>'nineteen'
  ];
  $tens = [2=>'twenty',3=>'thirty',4=>'forty',5=>'fifty',6=>'sixty',7=>'seventy',8=>'eighty',9=>'ninety'];

  if ($n < 20) return $ones[$n];
  if ($n < 100) {
    $t = intdiv($n, 10);
    $r = $n % 10;
    return $r ? ($tens[$t] . '-' . $ones[$r]) : $tens[$t];
  }
  if ($n < 1000) {
    $h = intdiv($n, 100);
    $r = $n % 100;
    return $r ? ($ones[$h] . ' hundred ' . numberToWordsEn($r)) : ($ones[$h] . ' hundred');
  }
  if ($n < 1000000) {
    $k = intdiv($n, 1000);
    $r = $n % 1000;
    return $r ? (numberToWordsEn($k) . ' thousand ' . numberToWordsEn($r)) : (numberToWordsEn($k) . ' thousand');
  }
  if ($n < 1000000000) {
    $m = intdiv($n, 1000000);
    $r = $n % 1000000;
    return $r ? (numberToWordsEn($m) . ' million ' . numberToWordsEn($r)) : (numberToWordsEn($m) . ' million');
  }
  $b = intdiv($n, 1000000000);
  $r = $n % 1000000000;
  return $r ? (numberToWordsEn($b) . ' billion ' . numberToWordsEn($r)) : (numberToWordsEn($b) . ' billion');
}

function numberToWordsFr(int $n): string
{
  // Minimal robust FR (Cameroon usage) for integers; avoids overly complex 70/90 special-casing beyond a practical level.
  $ones = [
    0=>'zéro',1=>'un',2=>'deux',3=>'trois',4=>'quatre',5=>'cinq',6=>'six',7=>'sept',8=>'huit',9=>'neuf',
    10=>'dix',11=>'onze',12=>'douze',13=>'treize',14=>'quatorze',15=>'quinze',16=>'seize',17=>'dix-sept',18=>'dix-huit',19=>'dix-neuf'
  ];
  $tens = [2=>'vingt',3=>'trente',4=>'quarante',5=>'cinquante',6=>'soixante',8=>'quatre-vingt'];

  if ($n < 20) return $ones[$n];

  if ($n < 100) {
    if ($n < 70) {
      $t = intdiv($n, 10);
      $r = $n % 10;
      $base = $tens[$t] ?? '';
      if ($r === 1) return $base . ' et un';
      return $r ? ($base . '-' . $ones[$r]) : $base;
    }
    if ($n < 80) { // 70-79 => soixante + 10-19
      return 'soixante-' . $ones[$n - 60];
    }
    // 80-99
    if ($n === 80) return 'quatre-vingt';
    return 'quatre-vingt-' . $ones[$n - 80];
  }

  if ($n < 1000) {
    $h = intdiv($n, 100);
    $r = $n % 100;
    $hund = ($h === 1) ? 'cent' : ($ones[$h] . ' cent');
    return $r ? ($hund . ' ' . numberToWordsFr($r)) : $hund;
  }

  if ($n < 1000000) {
    $k = intdiv($n, 1000);
    $r = $n % 1000;
    $th = ($k === 1) ? 'mille' : (numberToWordsFr($k) . ' mille');
    return $r ? ($th . ' ' . numberToWordsFr($r)) : $th;
  }

  if ($n < 1000000000) {
    $m = intdiv($n, 1000000);
    $r = $n % 1000000;
    $mm = ($m === 1) ? 'un million' : (numberToWordsFr($m) . ' millions');
    return $r ? ($mm . ' ' . numberToWordsFr($r)) : $mm;
  }

  $b = intdiv($n, 1000000000);
  $r = $n % 1000000000;
  $bb = ($b === 1) ? 'un milliard' : (numberToWordsFr($b) . ' milliards');
  return $r ? ($bb . ' ' . numberToWordsFr($r)) : $bb;
}
