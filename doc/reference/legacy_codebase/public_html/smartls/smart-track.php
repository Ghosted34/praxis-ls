<?php
  $pageTitle = "Track Your Shipment | Smart Logistics & Services Ltd";
  $pageDescription = "Track your cargo with precision using Smart Track.";
  $pageKeywords = "Smart Track, Shipment Tracking, Logistics, Cameroon, CEMAC, Smart Logistics";
  $canonicalUrl = "https://smartls.cm/smart-track.php"; // update
?>
<!doctype html>
<html lang="en" id="docRoot">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">

  <title><?php echo htmlspecialchars($pageTitle); ?></title>
  <meta name="description" content="<?php echo htmlspecialchars($pageDescription); ?>">
  <meta name="keywords" content="<?php echo htmlspecialchars($pageKeywords); ?>">
  <meta name="robots" content="index, follow">
  <meta name="theme-color" content="#055B83">
  <link rel="canonical" href="<?php echo htmlspecialchars($canonicalUrl); ?>">

  <!-- Open Graph -->
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Smart Logistics & Services Ltd">
  <meta property="og:title" content="<?php echo htmlspecialchars($pageTitle); ?>">
  <meta property="og:description" content="<?php echo htmlspecialchars($pageDescription); ?>">
  <meta property="og:url" content="<?php echo htmlspecialchars($canonicalUrl); ?>">
  <meta property="og:image" content="https://smartls.cm/images/og/track-og.jpg">

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="<?php echo htmlspecialchars($pageTitle); ?>">
  <meta name="twitter:description" content="<?php echo htmlspecialchars($pageDescription); ?>">
  <meta name="twitter:image" content="https://smartls.cm/images/og/track-og.jpg">

  <!-- Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">

  <!-- Bootstrap -->
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">

  <!-- Icons -->
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" rel="stylesheet">

  <!-- CSS -->
  <link rel="stylesheet" href="css/style.css">
</head>

<body>
<?php require __DIR__ . "/partials/header.php"; ?>

<main class="track-page">

  <!-- Decorative background map -->
  <div class="track-page__bg-map" aria-hidden="true"></div>

  <section class="track-page__wrap">
    <div class="container position-relative">

      <!-- Hero -->
      <div class="track-page__hero text-center mx-auto">
        <span class="track-page__pill" data-i18n="track_pill">Live Logistics Hub</span>

        <h1 class="track-page__title">
        Smart <span class="track-page__title-accent">Track</span>
        </h1>

        <p class="track-page__lead mb-0" data-i18n="track_lead">Track your cargo with precision.</p>

      </div>

      <!-- Search card -->
      <div class="track-page__search glass-panel mx-auto">
        <form class="row g-2 align-items-center" onsubmit="event.preventDefault(); initiateTrack();">
          <div class="col-12 col-lg">
            <div class="track-page__input-wrap">
              <i class="fa-solid fa-magnifying-glass track-page__input-ico" aria-hidden="true"></i>
              <input
                type="text"
                id="track-input"
                class="track-page__input form-control"
                data-i18n-placeholder="track_placeholder"
                placeholder="Enter Reference (e.g. SL0256721SM)"
                value="SL0256721SM"
                />
            </div>
          </div>

          <div class="col-12 col-lg-auto">
            <button type="submit" id="track-btn" class="track-page__btn btn-smart btn w-100">
                <span id="btn-text" data-i18n="track_btn">TRACK</span>
                <span id="btn-loader" class="track-page__loader d-none" aria-hidden="true"></span>
            </button>
          </div>
        </form>

        <!-- Demo selector -->
        <div class="track-page__demo">
          <div class="track-page__demo-label" data-i18n="track_demo_label">Demo Views:</div>

          <button type="button" onclick="setDemo('seai')" class="track-page__demo-btn" data-i18n="track_demo_sea_imp">Sea Imp</button>
<button type="button" onclick="setDemo('seae')" class="track-page__demo-btn" data-i18n="track_demo_sea_exp">Sea Exp</button>
<button type="button" onclick="setDemo('hint')" class="track-page__demo-btn" data-i18n="track_demo_hinterland">Hinterland</button>
<button type="button" onclick="setDemo('inld')" class="track-page__demo-btn" data-i18n="track_demo_inland">Inland</button>
<button type="button" onclick="setDemo('warh')" class="track-page__demo-btn" data-i18n="track_demo_warehousing">Warehousing</button>
<button type="button" onclick="setDemo('aire')" class="track-page__demo-btn" data-i18n="track_demo_air_exp">Air Exp</button>
<button type="button" onclick="setDemo('airi')" class="track-page__demo-btn" data-i18n="track_demo_air_imp">Air Imp</button>
<button type="button" onclick="setDemo('e2ea')" class="track-page__demo-btn" data-i18n="track_demo_e2e_air">E2E Air</button>
<button type="button" onclick="setDemo('e2es')" class="track-page__demo-btn" data-i18n="track_demo_e2e_sea">E2E Sea</button>
          
        </div>
      </div>

      <!-- Results -->
      <div id="tracking-result" class="track-page__result glass-panel">

        <!-- Result Header -->
        <div class="track-page__result-head">
          <div class="track-page__smallcap" data-i18n="track_file_reference">File Reference</div>
<h2 class="track-page__ref" id="res-ref">SL0256721SM</h2>


<div class="track-page__client">
  <i class="fa-solid fa-building" aria-hidden="true"></i>
  <span id="res-client">L&T Power Transmission & Distribution</span>
</div>

<div id="res-status-badge" class="track-page__status">
  <span class="track-page__status-dot"></span>
  <span data-i18n="track_status_in_progress">In Progress</span>
</div>

<div class="track-page__last">
  <span data-i18n="track_last_update">Last Update:</span>
  <span class="track-page__last-strong" data-i18n="track_just_now">Just now</span>
</div>

        </div>

        <!-- Content -->
        <div class="track-page__result-body">
          <div class="row g-4 g-lg-5">

            <!-- Left Column -->
            <div class="col-12 col-lg-4">
              <div class="track-page__facts">
                <div class="track-page__fact track-page__fact--blue">
                  <div class="track-page__fact-k" data-i18n="track_service_type">Service Type</div>

                  <div class="track-page__fact-v">
                    <i id="res-icon" class="fa-solid fa-truck-fast" aria-hidden="true"></i>
                    <span id="res-type">TRANSPORT</span>
                  </div>
                </div>

                <div class="track-page__fact track-page__fact--gray">
                  <div class="track-page__fact-k text-muted" data-i18n="track_key_details">Key Details</div>

                  <div class="track-page__kv">
  <span class="track-page__dot track-page__dot--orange"></span>
  <div>
    <div class="track-page__kv-k" id="label-origin" data-i18n="track_origin">Origin</div>
    <div class="track-page__kv-v" id="val-origin">Douala</div>
  </div>
</div>

<div class="track-page__kv">
  <span class="track-page__dot track-page__dot--blue"></span>
  <div>
    <div class="track-page__kv-k" id="label-dest" data-i18n="track_destination">Destination</div>
    <div class="track-page__kv-v" id="val-dest">Bertoua</div>
  </div>
</div>


                  <div class="track-page__kv">
                    <span class="track-page__dot track-page__dot--blue"></span>
                    <div>
                      <div class="track-page__kv-k" id="label-dest">Destination</div>
                      <div class="track-page__kv-v" id="val-dest">Bertoua Project Site</div>
                    </div>
                  </div>
                </div>

                <a id="email-btn" href="#" class="track-page__email">
                <i class="fa-regular fa-envelope me-2" aria-hidden="true"></i>
                <span data-i18n="track_request_more_info">REQUEST MORE INFO</span>
                </a>
              </div>
            </div>

            <!-- Right Column (Timeline) -->
            <div class="col-12 col-lg-8 position-relative">
              <div class="track-page__timeline">
                <div class="track-page__timeline-line" aria-hidden="true"></div>
                <div id="timeline-container"></div>
              </div>
            </div>

          </div>
        </div>
      </div>

      <!-- Trust badges -->
      <div class="track-page__trust text-center">
        <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
        <i class="fa-solid fa-globe" aria-hidden="true"></i>
        <i class="fa-solid fa-certificate" aria-hidden="true"></i>
      </div>

    </div>
  </section>

</main>

<?php require __DIR__ . "/partials/footer.php"; ?>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
<script src="js/app.js"></script>

<script>

    function getLang(){
  const ls = (localStorage.getItem("slas_lang") || "").toLowerCase();
  const ck = (document.cookie.match(/(?:^|;\s*)slas_lang=([^;]+)/)?.[1] || "").toLowerCase();
  const lang = (ls || ck || "en");
  return (lang === "fr" || lang === "en") ? lang : "en";
}

function t(key, fallback){
  const lang = getLang();
  const dict = (window.translations && window.translations[lang]) ? window.translations[lang] : null;
  return (dict && dict[key] != null) ? dict[key] : (fallback ?? key);
}

/* === DATA STORE (unchanged) === */
const demoData = {
  'SL0256721SM': {
    type: 'SEA FREIGHT IMPORT',
    client: 'L&T Power Transmission',
    icon: 'fa-ship',
    origin: 'Shanghai, China',
    dest: 'Douala, Cameroon',
    status: 'En Route',
    steps: [
      { stage: 'Pre-Alert / Work Order Receipt', date: 'Dec 01, 2025', status: 'completed' },
      { stage: 'Documentation Review & Compliance', date: 'Dec 01, 2025', status: 'completed' },
      { stage: 'Import Customs Declaration Lodged', date: 'Dec 02, 2025', status: 'completed' },
      { stage: 'Cargo Discharge at Port', date: 'Dec 02, 2025', status: 'completed' },
      { stage: 'Customs Clearance', date: 'Dec 03, 2025', status: 'completed' },
      { stage: 'Payment of Duties & Taxes', date: 'Dec 03, 2025', status: 'completed' },
      { stage: 'Shipping Line / Carrier Release', date: 'Dec 04, 2025', status: 'completed' },
      { stage: 'Port Release', date: 'Dec 04, 2025', status: 'completed' },
      { stage: 'Loading on Truck', detail: 'Truck #LT-998 Loading', date: 'Dec 05, 2025', status: 'active' },
      { stage: 'Inland Transportation', date: 'Pending', status: 'pending' },
      { stage: 'Offloading', date: 'Pending', status: 'pending' },
      { stage: 'Empty Container Return', date: 'Pending', status: 'pending' },
      { stage: 'Final Invoice Payment', date: 'Pending', status: 'pending' },
      { stage: 'File Closed', date: 'Pending', status: 'pending' }
    ]
  },
  'SL0367231SX': {
    type: 'SEA FREIGHT EXPORT',
    client: 'Local Cocoa Exporter',
    icon: 'fa-ship',
    origin: 'Yaoundé, CM',
    dest: 'Le Havre, France',
    status: 'Processing',
    steps: [
      { stage: 'Booking Request', date: 'Dec 01, 2025', status: 'completed' },
      { stage: 'Documentation', date: 'Dec 02, 2025', status: 'completed' },
      { stage: 'Export Customs Formalities', date: 'Dec 02, 2025', status: 'completed' },
      { stage: 'Booking Confirmation', date: 'Dec 03, 2025', status: 'completed' },
      { stage: 'Stuffing', detail: 'Container Loading', date: 'Dec 04, 2025', status: 'active' },
      { stage: 'Customs Inspection', date: 'Pending', status: 'pending' },
      { stage: 'Transfer to Port', date: 'Pending', status: 'pending' },
      { stage: 'Boarding Authorisation', date: 'Pending', status: 'pending' },
      { stage: 'Port & Customs Release', date: 'Pending', status: 'pending' },
      { stage: 'Loading on Vessel', date: 'Pending', status: 'pending' },
      { stage: 'Freight Payment', date: 'Pending', status: 'pending' },
      { stage: 'OBL Release', date: 'Pending', status: 'pending' },
      { stage: 'Final Invoice Payment', date: 'Pending', status: 'pending' },
      { stage: 'File Closed', date: 'Pending', status: 'pending' }
    ]
  },
  'SL3201942HT': {
    type: 'HINTERLAND',
    client: 'Regional Trade Ltd',
    icon: 'fa-route',
    origin: 'Douala, CM',
    dest: "N'Djamena, TD",
    status: 'Processing',
    steps: [
      { stage: 'Transport Order Received', date: 'Dec 01, 2025', status: 'completed' },
      { stage: 'Documentation & Transit Compliance Review', date: 'Dec 02, 2025', status: 'completed' },
      { stage: 'Transit Customs Declaration (Cameroon)', detail: 'Processing...', date: 'Dec 03, 2025', status: 'active' },
      { stage: 'Shipping Line / Terminal Release', date: 'Pending', status: 'pending' },
      { stage: 'Port Release & Loading on Truck', date: 'Pending', status: 'pending' },
      { stage: 'Post-Loading & Sealing Formalities', date: 'Pending', status: 'pending' },
      { stage: '1st Leg Inland Transportation', date: 'Pending', status: 'pending' },
      { stage: 'Border Crossing Formalities', date: 'Pending', status: 'pending' },
      { stage: '2nd Leg Inland Transportation', date: 'Pending', status: 'pending' },
      { stage: "Arrival at Final Destination (N’Djamena)", date: 'Pending', status: 'pending' },
      { stage: 'Import Customs Clearance (Chad)', date: 'Pending', status: 'pending' },
      { stage: 'Delivery to Consignee', date: 'Pending', status: 'pending' },
      { stage: 'Final Invoice Payment', date: 'Pending', status: 'pending' },
      { stage: 'File Closed', date: 'Pending', status: 'pending' }
    ]
  },
  'SL2398462IT': {
    type: 'INLAND TRANSPORTATION',
    client: 'Construction Co.',
    icon: 'fa-truck-front',
    origin: 'Douala',
    dest: 'Boumyebel',
    status: 'In Transit',
    steps: [
      { stage: 'Pre-Alert / Work Order Receipt', date: 'Dec 01, 2025', status: 'completed' },
      { stage: 'Cargo Survey', date: 'Dec 01, 2025', status: 'completed' },
      { stage: 'Documentation', date: 'Dec 01, 2025', status: 'completed' },
      { stage: 'Advance Payment', date: 'Dec 01, 2025', status: 'completed' },
      { stage: 'Truck Positioning', date: 'Dec 02, 2025', status: 'completed' },
      { stage: 'Loading', date: 'Dec 02, 2025', status: 'completed' },
      { stage: 'Post Loading Formalities (IA)', date: 'Dec 02, 2025', status: 'completed' },
      { stage: 'Transportation', detail: 'Convoy on Road', date: 'Dec 03, 2025', status: 'active' },
      { stage: 'Border Crossing Formalities (IA)', date: 'Skipped', status: 'completed' },
      { stage: 'Final Destination Clearance (IA)', date: 'Pending', status: 'pending' },
      { stage: 'Offloading', date: 'Pending', status: 'pending' },
      { stage: 'Truck Release', date: 'Pending', status: 'pending' },
      { stage: 'Final Invoice Payment', date: 'Pending', status: 'pending' },
      { stage: 'File Closed', date: 'Pending', status: 'pending' }
    ]
  },
  'SL2839473WH': {
    type: 'WAREHOUSING',
    client: 'Retail Distributor Ltd',
    icon: 'fa-warehouse',
    origin: 'Zone 4 Warehouse',
    dest: 'Dec 01, 2025',
    status: 'In Storage',
    steps: [
      { stage: 'Pre-Alert / Work Order Receipt', date: 'Dec 01, 2025', status: 'completed' },
      { stage: 'Cargo Survey / Pre-Arrival Inspection', date: 'Dec 01, 2025', status: 'completed' },
      { stage: 'Documentation Verification', date: 'Dec 01, 2025', status: 'completed' },
      { stage: 'Warehouse Preparation', date: 'Dec 01, 2025', status: 'completed' },
      { stage: 'Gate-In / Receiving', date: 'Dec 02, 2025', status: 'completed' },
      { stage: 'Stock-In (Put-Away)', detail: 'Racking in Progress', date: 'Dec 02, 2025', status: 'active' },
      { stage: 'Quality / Damage Inspection', date: 'Pending', status: 'pending' },
      { stage: 'Inventory Holding / Control', date: 'Pending', status: 'pending' },
      { stage: 'Cycle Count / Weekly Inventory', date: 'Pending', status: 'pending' },
      { stage: 'Periodic Inventory (Monthly)', date: 'Pending', status: 'pending' },
      { stage: 'Pick & Pack / Stock-Out Request', date: 'Pending', status: 'pending' },
      { stage: 'Dispatch / Gate-Out', date: 'Pending', status: 'pending' },
      { stage: 'Invoicing & Charges Settlement', date: 'Pending', status: 'pending' },
      { stage: 'File Closed', date: 'Pending', status: 'pending' }
    ]
  },
  'SL3820284AX': {
    type: 'AIR FREIGHT EXPORT',
    client: 'Fresh Agro Ltd',
    icon: 'fa-plane-departure',
    origin: 'Douala (DLA)',
    dest: 'Brussels (BRU)',
    status: 'Active',
    steps: [
      { stage: 'Booking Request', date: 'Dec 01, 2025', status: 'completed' },
      { stage: 'Booking Confirmation', date: 'Dec 01, 2025', status: 'completed' },
      { stage: 'Documentation & Regulatory Compliance', date: 'Dec 02, 2025', status: 'completed' },
      { stage: 'Export Customs Formalities', date: 'Dec 02, 2025', status: 'completed' },
      { stage: 'Cargo Acceptance at Origin Airport', detail: 'Received at DLA Cargo', date: 'Dec 03, 2025', status: 'active' },
      { stage: 'Security Screening / Customs Inspection', date: 'Pending', status: 'pending' },
      { stage: 'Freight Charges Payment & AWB Issued', date: 'Pending', status: 'pending' },
      { stage: 'Airline Load Confirmation', date: 'Pending', status: 'pending' },
      { stage: 'Flight Departure', date: 'Pending', status: 'pending' },
      { stage: 'In Transit', date: 'Pending', status: 'pending' },
      { stage: 'Arrival at Destination Airport', date: 'Pending', status: 'pending' },
      { stage: 'Cargo Available at Destination Airport', date: 'Pending', status: 'pending' },
      { stage: 'Final Invoice Payment', date: 'Pending', status: 'pending' },
      { stage: 'File Closed', date: 'Pending', status: 'pending' }
    ]
  },
  'SL1928392AM': {
    type: 'AIR FREIGHT IMPORT',
    client: 'Tech Solutions Inc',
    icon: 'fa-plane-arrival',
    origin: 'Paris (CDG)',
    dest: 'Yaoundé (NSI)',
    status: 'Arrived',
    steps: [
      { stage: 'Pre-Alert Received', date: 'Dec 01, 2025', status: 'completed' },
      { stage: 'Documentation Review & Compliance Check', date: 'Dec 01, 2025', status: 'completed' },
      { stage: 'Arrival Notice Received', date: 'Dec 02, 2025', status: 'completed' },
      { stage: 'Aircraft Arrival at Destination Airport', detail: 'Flight AF900 Landed', date: 'Dec 03, 2025', status: 'active' },
      { stage: 'Cargo Discharge & Ground Handling Processing', date: 'Pending', status: 'pending' },
      { stage: 'Import Customs Declaration Lodged', date: 'Pending', status: 'pending' },
      { stage: 'Customs Assessment & Inspection', date: 'Pending', status: 'pending' },
      { stage: 'Payment of Duties, Taxes & Regulatory Fees', date: 'Pending', status: 'pending' },
      { stage: 'Customs Release', date: 'Pending', status: 'pending' },
      { stage: 'Airline / Ground Handler Cargo Release', date: 'Pending', status: 'pending' },
      { stage: 'Delivery Planning & Dispatch', date: 'Pending', status: 'pending' },
      { stage: 'Delivery / Handover to Consignee', date: 'Pending', status: 'pending' },
      { stage: 'Final Invoice Payment', date: 'Pending', status: 'pending' },
      { stage: 'File Closed', date: 'Pending', status: 'pending' }
    ]
  },
  'SL2627392AF': {
    type: 'End-to-End Air Freight',
    client: 'Global Pharma',
    icon: 'fa-plane',
    origin: 'Mumbai (BOM)',
    dest: 'Douala Warehouse',
    status: 'Processing',
    steps: [
      { stage: 'Booking Request', date: 'Dec 01, 2025', status: 'completed' },
      { stage: 'Booking Confirmation', date: 'Dec 01, 2025', status: 'completed' },
      { stage: 'Documentation & Regulatory Compliance', date: 'Dec 02, 2025', status: 'completed' },
      { stage: 'Export Customs Clearance', date: 'Dec 02, 2025', status: 'completed' },
      { stage: 'Empty Container Release / Cargo Receipt', detail: 'Cargo at Agent Warehouse', date: 'Dec 03, 2025', status: 'active' },
      { stage: 'Stuffing & Sealing (FCL/LCL)', date: 'Pending', status: 'pending' },
      { stage: 'Gate-In at Port / Terminal Acceptance', date: 'Pending', status: 'pending' },
      { stage: 'Vessel Loading Confirmation', date: 'Pending', status: 'pending' },
      { stage: 'Vessel Departure', date: 'Pending', status: 'pending' },
      { stage: 'In Transit', date: 'Pending', status: 'pending' },
      { stage: 'Arrival at Destination Port', date: 'Pending', status: 'pending' },
      { stage: 'Import Customs Clearance & Cargo Release', date: 'Pending', status: 'pending' },
      { stage: 'Final Invoice Payment', date: 'Pending', status: 'pending' },
      { stage: 'File Closed', date: 'Pending', status: 'pending' }
    ]
  },
  'SL2452732EF': {
    type: 'End-to-End Sea Freight',
    client: 'Auto Parts Distributor',
    icon: 'fa-ship',
    origin: 'Hamburg, DE',
    dest: 'Douala, CM',
    status: 'At Port',
    steps: [
      { stage: 'Booking Request', date: 'Dec 01, 2025', status: 'completed' },
      { stage: 'Booking Confirmation', date: 'Dec 01, 2025', status: 'completed' },
      { stage: 'Documentation & Regulatory Compliance', date: 'Dec 02, 2025', status: 'completed' },
      { stage: 'Export Customs Clearance', date: 'Dec 02, 2025', status: 'completed' },
      { stage: 'Cargo Transfer at POL', detail: 'Cargo at Terminal', date: 'Dec 03, 2025', status: 'active' },
      { stage: 'Security Screening / Customs Inspection', date: 'Pending', status: 'pending' },
      { stage: 'Boarding authorization', date: 'Pending', status: 'pending' },
      { stage: 'Vessel Departure', date: 'Pending', status: 'pending' },
      { stage: 'Freight Charges Payment & MBL Release', date: 'Pending', status: 'pending' },
      { stage: 'En Route', date: 'Pending', status: 'pending' },
      { stage: 'Arrival at Destination Port', date: 'Pending', status: 'pending' },
      { stage: 'Import Customs Clearance & Cargo Release', date: 'Pending', status: 'pending' },
      { stage: 'Final Invoice Payment', date: 'Pending', status: 'pending' },
      { stage: 'File Closed', date: 'Pending', status: 'pending' }
    ]
  }
};

/* === INIT from URL ref (unchanged) === */
window.onload = function() {
  const urlParams = new URLSearchParams(window.location.search);
  const ref = urlParams.get('ref');
  if (ref && demoData[ref]) {
    document.getElementById('track-input').value = ref;
    initiateTrack();
  }
};

/* === Demo switcher (unchanged) === */
function setDemo(type) {
  const codes = {
    'seai': 'SL0256721SM',
    'seae': 'SL0367231SX',
    'hint': 'SL3201942HT',
    'inld': 'SL2398462IT',
    'warh': 'SL2839473WH',
    'aire': 'SL3820284AX',
    'airi': 'SL1928392AM',
    'e2ea': 'SL2627392AF',
    'e2es': 'SL2452732EF'
  };
  document.getElementById('track-input').value = codes[type];
  initiateTrack();
}

/* === Core tracking logic (same behavior; just toggles Bootstrap d-none) === */
function $(id){ return document.getElementById(id); }

function initiateTrack() {
  const btnText   = $('btn-text');
  const loader    = $('btn-loader');
  const inputEl   = $('track-input');
  const resultCard= $('tracking-result');

  // Hard guard: show precise console diagnostics
  if (!btnText || !loader || !inputEl || !resultCard) {
    console.error("[SmartTrack] Missing DOM node(s):", {
      btnText: !!btnText,
      loader: !!loader,
      inputEl: !!inputEl,
      resultCard: !!resultCard
    });
    return; // prevent crash
  }

  const input = inputEl.value.trim();

  // Reset UI
  resultCard.classList.remove('active');
  btnText.classList.add('d-none');
  loader.classList.remove('d-none');

  setTimeout(() => {
    btnText.classList.remove('d-none');
    loader.classList.add('d-none');

    if (demoData && demoData[input]) {

      renderResult(demoData[input], input);
      resultCard.classList.add('active');
      try {
        resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch(e) {
        resultCard.scrollIntoView(true);
        }

    } else {
      alert("Reference not found. Try SL0256721SM");
    }
  }, 800);
}


/* === Renderer: timeline HTML recreated for Bootstrap DOM (same semantics) === */
document.getElementById('res-type').innerText = translateServiceType(data.type);
function translateServiceType(type){
  // keep your canonical types in data, translate on display
  const map = {
    "SEA FREIGHT IMPORT": { fr: "FRET MARITIME IMPORT", en: "SEA FREIGHT IMPORT" },
    "SEA FREIGHT EXPORT": { fr: "FRET MARITIME EXPORT", en: "SEA FREIGHT EXPORT" },
    "HINTERLAND":         { fr: "HINTERLAND", en: "HINTERLAND" },
    "INLAND TRANSPORTATION": { fr: "TRANSPORT INTÉRIEUR", en: "INLAND TRANSPORTATION" },
    "WAREHOUSING":        { fr: "ENTREPOSAGE", en: "WAREHOUSING" },
    "AIR FREIGHT EXPORT": { fr: "FRET AÉRIEN EXPORT", en: "AIR FREIGHT EXPORT" },
    "AIR FREIGHT IMPORT": { fr: "FRET AÉRIEN IMPORT", en: "AIR FREIGHT IMPORT" },
    "End-to-End Air Freight": { fr: "Fret aérien de bout en bout", en: "End-to-End Air Freight" },
    "End-to-End Sea Freight": { fr: "Fret maritime de bout en bout", en: "End-to-End Sea Freight" }
  };
  const lang = getLang();
  return map[type]?.[lang] || type;
}


function renderResult(data, ref) {
  document.getElementById('res-ref').innerText = ref;
  document.getElementById('res-client').innerText = data.client;
  


  const resIcon = document.getElementById('res-icon');
  resIcon.className = `fa-solid ${data.icon}`;

  if (data.type === 'WAREHOUSING') {
  document.getElementById('label-origin').innerText = t("track_warehouse_location", "Warehouse Location");
  document.getElementById('label-dest').innerText = t("track_inbound_date", "Inbound Date");
} else {
  document.getElementById('label-origin').innerText = t("track_origin", "Origin");
  document.getElementById('label-dest').innerText = t("track_destination", "Destination");
}


  document.getElementById('val-origin').innerText = data.origin;
  document.getElementById('val-dest').innerText = data.dest;

  const activeStep = data.steps.find(s => s.status === 'active') || data.steps[data.steps.length - 1];
  const currentStageName = activeStep ? activeStep.stage : "Processing";
  const lastUpdateDate = activeStep ? activeStep.date : "Recent";

  const subject = `Shipment Details Request | File Reference - ${ref}`;
  const body = `Hello Team,\n\nKindly provide additional details regarding the shipment referenced below.\n\nFile Reference: ${ref}\nCurrent Stage: ${currentStageName}\nLast System Update: ${lastUpdateDate}\n\nPlease let us know if any documentation or action is required.\n\nBest regards,`;
  const emailHref = `mailto:operations@smartls.cm?cc=customerservice@smartls.cm,info@smartls.cm&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  document.getElementById('email-btn').setAttribute('href', emailHref);

  const container = document.getElementById('timeline-container');
  container.innerHTML = '';

  data.steps.forEach(step => {
    let badge = '';
    let icon = '';
    let wrapClass = 'track-page__t-item';
    let contentClass = 'track-page__t-content';
    let detail = step.detail || '';

    if (step.status === 'completed') {
  badge = `<span class="track-page__t-badge track-page__t-badge--done">${t("track_badge_completed","Completed")}</span>`;
  icon = `<div class="track-page__t-ico track-page__t-ico--done"><i class="fa-solid fa-check"></i></div>`;
  detail = '';
  wrapClass += ' track-page__t-item--done';
} else if (step.status === 'active') {
  badge = `<span class="track-page__t-badge track-page__t-badge--active">${t("track_badge_in_progress","In Progress")}</span>`;
  icon = `<div class="track-page__t-ico track-page__t-ico--active"><i class="fa-solid fa-truck-moving"></i></div>`;
  contentClass += ' track-page__t-content--active';
  wrapClass += ' track-page__t-item--active';
} else {
  badge = `<span class="track-page__t-badge track-page__t-badge--pending">${t("track_badge_pending","Pending")}</span>`;
  icon = `<div class="track-page__t-ico track-page__t-ico--pending"><i class="fa-solid fa-clock"></i></div>`;
  wrapClass += ' track-page__t-item--pending';
}


    const html = `
      <div class="${wrapClass}">
        ${icon}
        <div class="${contentClass}">
          ${badge}
          <div class="track-page__t-title">${step.stage}</div>
          ${detail ? `<div class="track-page__t-detail">${detail}</div>` : ``}
          <div class="track-page__t-date">${step.date}</div>
        </div>
      </div>
    `;
    container.insertAdjacentHTML('beforeend', html);
  });
}
</script>

</body>
</html>
