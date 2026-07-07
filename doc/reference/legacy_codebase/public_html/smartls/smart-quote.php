<?php
  $pageTitle = "Get a Smart Quote | Smart Logistics & Services Ltd";
  $pageDescription = "Configure your logistics requirements in 4 steps and request a Smart Quote from Smart Logistics & Services Ltd. Get fast, compliant air, sea, land freight and warehousing quotes across Cameroon and the CEMAC region.";
  $pageKeywords = "Smart Quote, Logistics Quote, Freight Quote, Air Freight Quote, Sea Freight Quote, Land Freight Quote, Warehousing Quote, Customs Cameroon, Douala Logistics, CEMAC Transport, Smart Logistics";
  $canonicalUrl = "https://smartls.cm/smart-quote.php"; // keep aligned with actual filename
  $lang = $_COOKIE['slas_lang'] ?? 'en';
  if ($lang !== 'fr' && $lang !== 'en') $lang = 'en';
?>
<!doctype html>
<html lang="<?php echo htmlspecialchars($lang); ?>" id="docRoot">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">

  <title><?php echo htmlspecialchars($pageTitle); ?></title>
  <meta name="description" content="<?php echo htmlspecialchars($pageDescription); ?>">
  <meta name="keywords" content="<?php echo htmlspecialchars($pageKeywords); ?>">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="<?php echo htmlspecialchars($canonicalUrl); ?>">

  <!-- Favicons / App Icons (MANDATORY GLOBAL) -->
  <link rel="icon" type="image/png" sizes="32x32" href="assets/img-webp/logo-smart.webp">
  <link rel="icon" type="image/png" sizes="16x16" href="assets/img-webp/logo-smart.webp">
  <link rel="icon" href="assets/img-webp/logo-smart.webp">
  <link rel="apple-touch-icon" sizes="180x180" href="assets/img-webp/logo-smart.webp">
  <meta name="theme-color" content="#055B83">

  <!-- Open Graph -->
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Smart Logistics & Services Ltd">
  <meta property="og:title" content="<?php echo htmlspecialchars($pageTitle); ?>">
  <meta property="og:description" content="<?php echo htmlspecialchars($pageDescription); ?>">
  <meta property="og:url" content="<?php echo htmlspecialchars($canonicalUrl); ?>">
  <meta property="og:image" content="https://smartls.cm/images/og/quote-og.jpg">

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="<?php echo htmlspecialchars($pageTitle); ?>">
  <meta name="twitter:description" content="<?php echo htmlspecialchars($pageDescription); ?>">
  <meta name="twitter:image" content="https://smartls.cm/images/og/quote-og.jpg">

  <!-- Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">

  <!-- Bootstrap -->
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">

  <!-- Font Awesome -->
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" rel="stylesheet">

  <!-- CSS -->
  <link rel="stylesheet" href="css/style.css">

  <!-- Optional: preconnect for Photon (perf) -->
  <link rel="preconnect" href="https://photon.komoot.io" crossorigin>
</head>

<body>
<?php
  // Prevent header warning + correct active nav highlighting
  $activePage = 'smart-quote.php';
  require __DIR__ . "/partials/header.php";
?>

<main class="quote-portal">

  <!-- Decorative background map -->
  <div class="quote-portal__bg-map" aria-hidden="true"></div>

  <section class="quote-portal__wrap py-5">
    <div class="container">

      <!-- Hero -->
      <div class="text-center mb-5 quote-portal__hero">
        <span class="quote-portal__badge-pill" data-i18n="quote_badge">Interactive Portal</span>

        <h1 class="quote-portal__h1 mt-3 mb-2">
          <span data-i18n="quote_title_main">Smart Quote</span>
          <span class="quote-portal__h1-accent" data-i18n="quote_title_accent">Wizard</span>
        </h1>

        <p class="quote-portal__lead mx-auto mb-0">
          <span data-i18n="quote_lead_line1">Configure your logistics requirements in 4 simple steps.</span>
          <span class="d-none d-md-inline"><br></span>
          <span data-i18n="quote_lead_line2">We handle the complexity; you get the precision.</span>
        </p>
      </div>

      <!-- Glass Card -->
      <div class="quote-portal__card">

        <!-- Progress Header -->
        <div class="quote-portal__card-head">
          <div class="d-flex flex-column flex-md-row justify-content-between align-items-center gap-3">

            <!-- Steps -->
            <div class="d-flex align-items-center justify-content-center gap-3 flex-wrap">

              <div class="quote-portal__step-dot is-active" role="button" tabindex="0" onclick="if(completedSteps >= 1) changeStep(1)">
                <div class="quote-portal__step-circle">1</div>
                <div class="quote-portal__step-label" data-i18n="quote_step1_label">Need</div>
              </div>

              <div class="quote-portal__step-line"></div>

              <div id="dot-2" class="quote-portal__step-dot is-locked" role="button" tabindex="0" onclick="if(completedSteps >= 2) changeStep(2)">
                <div class="quote-portal__step-circle">2</div>
                <div class="quote-portal__step-label" data-i18n="quote_step2_label">Route</div>
              </div>

              <div class="quote-portal__step-line"></div>

              <div id="dot-3" class="quote-portal__step-dot is-locked" role="button" tabindex="0" onclick="if(completedSteps >= 3) changeStep(3)">
                <div class="quote-portal__step-circle">3</div>
                <div class="quote-portal__step-label" data-i18n="quote_step3_label">Details</div>
              </div>

              <div class="quote-portal__step-line"></div>

              <div id="dot-4" class="quote-portal__step-dot is-locked" role="button" tabindex="0" onclick="if(completedSteps >= 4) changeStep(4)">
                <div class="quote-portal__step-circle">4</div>
                <div class="quote-portal__step-label" data-i18n="quote_step4_label">Contact</div>
              </div>

            </div>

            <!-- Counter -->
            <div class="quote-portal__step-counter d-none d-md-flex align-items-center gap-2">
              <i class="fa-solid fa-bolt quote-portal__bolt"></i>
              <span>
                <span data-i18n="quote_step_counter_prefix">Step</span>
                <span id="current-step-num">1</span>
                <span data-i18n="quote_step_counter_of">of</span>
                <span>4</span>
              </span>
            </div>

          </div>
        </div>

        <!-- Progress Line -->
        <div class="quote-portal__progress">
          <div id="progress-bar" class="quote-portal__progress-bar" style="width:25%"></div>
        </div>

        <!-- Form -->
        <form id="smart-quote-form" class="quote-portal__form" autocomplete="off" onsubmit="return false;">

          <!-- STEP 1 -->
          <div id="step-1" class="quote-portal__step is-visible">
            <div class="text-center mb-4">
              <h2 class="quote-portal__h2 mb-1" data-i18n="quote_s1_title">Your Need</h2>
              <p class="quote-portal__sub mb-0" data-i18n="quote_s1_sub">Select the logistics service that fits your requirement.</p>
            </div>

            <div class="row g-3">
              <!-- Air -->
              <div class="col-12 col-md-6 col-lg-3">
                <label class="quote-portal__svc-wrap w-100">
                  <input type="radio" name="service" value="air" class="quote-portal__svc-input" checked onchange="updateStep2Logic('air')">
                  <div class="quote-portal__svc-card">
                    <div class="quote-portal__svc-icon"><i class="fa-solid fa-plane-departure"></i></div>
                    <h3 class="quote-portal__svc-title" data-i18n="quote_service_air_title">Air Freight</h3>
                    <p class="quote-portal__svc-text" data-i18n="quote_service_air_sub">Time-critical global transport.</p>
                    <span class="quote-portal__svc-popular" data-i18n="quote_service_popular">POPULAR</span>
                  </div>
                </label>
              </div>

              <!-- Sea -->
              <div class="col-12 col-md-6 col-lg-3">
                <label class="quote-portal__svc-wrap w-100">
                  <input type="radio" name="service" value="sea" class="quote-portal__svc-input" onchange="updateStep2Logic('sea')">
                  <div class="quote-portal__svc-card">
                    <div class="quote-portal__svc-icon"><i class="fa-solid fa-ship"></i></div>
                    <h3 class="quote-portal__svc-title" data-i18n="quote_service_sea_title">Sea Freight</h3>
                    <p class="quote-portal__svc-text" data-i18n="quote_service_sea_sub">Cost-effective FCL &amp; LCL.</p>
                  </div>
                </label>
              </div>

              <!-- Land -->
              <div class="col-12 col-md-6 col-lg-3">
                <label class="quote-portal__svc-wrap w-100">
                  <input type="radio" name="service" value="land" class="quote-portal__svc-input" onchange="updateStep2Logic('land')">
                  <div class="quote-portal__svc-card">
                    <div class="quote-portal__svc-icon"><i class="fa-solid fa-truck-front"></i></div>
                    <h3 class="quote-portal__svc-title" data-i18n="quote_service_land_title">Land Freight</h3>
                    <p class="quote-portal__svc-text" data-i18n="quote_service_land_sub">Cross-border CEMAC trucking.</p>
                  </div>
                </label>
              </div>

              <!-- Warehousing -->
              <div class="col-12 col-md-6 col-lg-3">
                <label class="quote-portal__svc-wrap w-100">
                  <input type="radio" name="service" value="warehouse" class="quote-portal__svc-input" onchange="updateStep2Logic('warehouse')">
                  <div class="quote-portal__svc-card">
                    <div class="quote-portal__svc-icon"><i class="fa-solid fa-warehouse"></i></div>
                    <h3 class="quote-portal__svc-title" data-i18n="quote_service_wh_title">Warehousing</h3>
                    <p class="quote-portal__svc-text" data-i18n="quote_service_wh_sub">Secure storage &amp; handling.</p>
                  </div>
                </label>
              </div>
            </div>

            <div class="d-flex justify-content-end mt-4">
              <button type="button" class="btn btn-smart px-4 py-3 quote-portal__btn-lg" onclick="changeStep(2)">
                <span data-i18n="quote_btn_continue">Continue</span> <i class="fa-solid fa-arrow-right ms-2"></i>
              </button>
            </div>
          </div>

          <!-- STEP 2 -->
          <div id="step-2" class="quote-portal__step">
            <div class="text-center mb-4">
              <h2 class="quote-portal__h2 mb-1" data-i18n="quote_s2_title">Your Route</h2>
              <p class="quote-portal__sub mb-0" id="step-2-subtitle" data-i18n="quote_s2_sub">Where is your cargo traveling?</p>
            </div>

            <!-- Shipping route -->
            <div id="route-shipping" class="row g-3 justify-content-center">
              <div class="col-12 col-lg-5">
                <label id="label-origin" class="form-label quote-portal__label" data-i18n="quote_origin_label">Origin City/Port</label>
                <div class="position-relative quote-portal__icon-input">
                  <i class="fa-solid fa-location-dot"></i>
                  <input type="text" id="origin-input" class="form-control form-control-lg quote-portal__input"
                         placeholder="e.g. Dubai, UAE" data-i18n-placeholder="quote_origin_ph" autocomplete="off">
                  <div id="origin-suggestions" class="list-group position-absolute w-100 shadow"></div>
                  <div class="quote-portal__loc-status text-muted small mt-1" id="origin-status"></div>
                </div>
              </div>

              <div class="col-12 col-lg-5">
                <label id="label-dest" class="form-label quote-portal__label" data-i18n="quote_dest_label">Destination</label>
                <div class="position-relative quote-portal__icon-input is-orange">
                  <i class="fa-solid fa-location-crosshairs"></i>
                  <input type="text" id="dest-input" class="form-control form-control-lg quote-portal__input"
                         placeholder="e.g. Bangui, CAR" data-i18n-placeholder="quote_dest_ph" autocomplete="off">
                  <div id="dest-suggestions" class="list-group position-absolute w-100 shadow"></div>
                  <div class="quote-portal__loc-status text-muted small mt-1" id="dest-status"></div>
                </div>
              </div>
            </div>

            <!-- Warehouse route -->
            <div id="route-warehouse" class="row g-3 justify-content-center d-none">
              <div class="col-12 col-lg-5">
                <label class="form-label quote-portal__label" data-i18n="quote_wh_loc_label">Preferred Location</label>
                <div class="position-relative quote-portal__icon-input">
                  <i class="fa-solid fa-map-pin"></i>
                  <input type="text" id="warehouse-loc-input" class="form-control form-control-lg quote-portal__input"
                         placeholder="e.g. Douala Port Zone" data-i18n-placeholder="quote_wh_loc_ph" autocomplete="off">
                  <!-- These were referenced in JS but missing in DOM -->
                  <div id="warehouse-suggestions" class="list-group position-absolute w-100 shadow"></div>
                  <div class="quote-portal__loc-status text-muted small mt-1" id="warehouse-status"></div>
                </div>
              </div>

              <div class="col-12 col-lg-5">
                <label class="form-label quote-portal__label" data-i18n="quote_wh_duration_label">Duration Needed</label>
                <div class="position-relative quote-portal__icon-select">
                  <i class="fa-regular fa-calendar"></i>
                  <select class="form-select form-select-lg quote-portal__input">
                    <option data-i18n="quote_wh_duration_opt_1">Short Term (&lt; 1 Month)</option>
                    <option data-i18n="quote_wh_duration_opt_2">Medium Term (1-6 Months)</option>
                    <option data-i18n="quote_wh_duration_opt_3">Long Term (&gt; 6 Months)</option>
                    <option data-i18n="quote_wh_duration_opt_4">Indefinite / Recurring</option>
                  </select>
                  <span class="quote-portal__chev"><i class="fa-solid fa-chevron-down"></i></span>
                </div>
              </div>
            </div>

            <div class="d-flex justify-content-between align-items-center mt-4">
              <button type="button" class="btn btn-link quote-portal__link" onclick="changeStep(1)">
                <i class="fa-solid fa-arrow-left me-2"></i> <span data-i18n="quote_btn_back">Back</span>
              </button>
              <button type="button" class="btn btn-smart px-4 py-3 quote-portal__btn-lg" onclick="changeStep(3)">
                <span data-i18n="quote_btn_next_step">Next Step</span> <i class="fa-solid fa-arrow-right ms-2"></i>
              </button>
            </div>
          </div>

          <!-- STEP 3 -->
          <div id="step-3" class="quote-portal__step">
            <div class="text-center mb-4">
              <h2 class="quote-portal__h2 mb-1" data-i18n="quote_s3_title">Cargo Details</h2>
              <p class="quote-portal__sub mb-0" data-i18n="quote_s3_sub">Tell us about your shipment.</p>
            </div>

            <div class="row justify-content-center">
              <div class="col-12 col-lg-10">

                <!-- Toggle -->
                <div class="quote-portal__toggle-card mb-3">
                  <div class="d-flex align-items-start gap-3">
                    <div class="quote-portal__toggle-ico"><i class="fa-solid fa-cubes-stacked"></i></div>
                    <div class="flex-grow-1">
                      <div class="quote-portal__toggle-title" data-i18n="quote_bulk_title">Project Cargo / High Volume?</div>
                      <div class="quote-portal__toggle-sub" data-i18n="quote_bulk_sub">Select this for Cargo Out of Range or OOG.</div>
                    </div>

                    <label class="quote-portal__switch">
                      <input type="checkbox" id="toggle-bulk" onchange="toggleBulkMode()">
                      <span class="quote-portal__slider"></span>
                    </label>
                  </div>
                </div>

                <!-- Standard -->
                <div id="mode-standard">
                  <div class="quote-portal__panel mb-3">
                    <div class="d-flex justify-content-between align-items-end mb-3">
                      <label class="quote-portal__caps" data-i18n="quote_weight_label">Total Estimated Weight</label>
                      <div class="quote-portal__weight">
                        <input
                          type="number"
                          id="weight-input"
                          class="quote-portal__weight-input"
                          min="1"
                          max="30000"
                          value="500"
                          inputmode="numeric"
                        >
                        <span>Kg</span>
                      </div>
                    </div>

                    <input type="range" min="1" max="30000" value="500"
                           class="form-range quote-portal__range" id="weight-range"
                           oninput="updateWeight(this.value)">

                    <div class="d-flex justify-content-between quote-portal__range-ends">
                      <span data-i18n="quote_weight_min">1 Kg</span>
                      <span data-i18n="quote_weight_max">30,000 Kg+</span>
                    </div>
                  </div>
                </div>

                <!-- Bulk -->
                <div id="mode-bulk" class="d-none">
                  <label class="form-label quote-portal__label" data-i18n="quote_bulk_desc_label">Project Cargo Description</label>
                  <textarea class="form-control quote-portal__textarea"
                            placeholder="Please describe your shipment: Number of containers, dimensions for Out-of-Gauge (OOG) cargo, special handling requirements, etc."
                            data-i18n-placeholder="quote_bulk_desc_ph"
                            rows="6"></textarea>
                </div>

                <!-- Upload -->
                <div class="mt-3">
                  <label class="form-label quote-portal__label" data-i18n="quote_upload_label">Upload Documents</label>
                  <div class="quote-portal__upload" role="button" tabindex="0">
                    <div class="quote-portal__upload-ico"><i class="fa-solid fa-cloud-arrow-up"></i></div>
                    <div class="quote-portal__upload-title" data-i18n="quote_upload_title">Click to upload Invoice / Packing List</div>
                    <div class="quote-portal__upload-sub" data-i18n="quote_upload_sub">PDF, JPG, PNG (Max 10MB)</div>
                  </div>
                </div>

              </div>
            </div>

            <div class="d-flex justify-content-between align-items-center mt-4">
              <button type="button" class="btn btn-link quote-portal__link" onclick="changeStep(2)">
                <i class="fa-solid fa-arrow-left me-2"></i> <span data-i18n="quote_btn_back">Back</span>
              </button>
              <button type="button" class="btn btn-smart px-4 py-3 quote-portal__btn-lg" onclick="changeStep(4)">
                <span data-i18n="quote_btn_next_step">Next Step</span> <i class="fa-solid fa-arrow-right ms-2"></i>
              </button>
            </div>
          </div>

          <!-- STEP 4 -->
          <div id="step-4" class="quote-portal__step">
            <div class="text-center mb-4">
              <h2 class="quote-portal__h2 mb-1" data-i18n="quote_s4_title">Final Step</h2>
              <p class="quote-portal__sub mb-0" data-i18n="quote_s4_sub">Where should we send the quote?</p>
            </div>

            <div class="row g-3 justify-content-center">
              <div class="col-12 col-lg-5">
                <label class="form-label quote-portal__label-sm" data-i18n="quote_contact_name_label">Full Name</label>
                <input type="text" class="form-control form-control-lg quote-portal__input"
                       placeholder="John Doe" data-i18n-placeholder="quote_contact_name_ph" autocomplete="name">
              </div>

              <div class="col-12 col-lg-5">
                <label class="form-label quote-portal__label-sm" data-i18n="quote_contact_email_label">Email Address</label>
                <input type="email" class="form-control form-control-lg quote-portal__input"
                       placeholder="john@company.com" data-i18n-placeholder="quote_contact_email_ph" autocomplete="email">
              </div>

              <div class="col-12 col-lg-5">
                <label class="form-label quote-portal__label-sm" data-i18n="quote_contact_phone_label">Phone Number</label>
                <input type="tel" class="form-control form-control-lg quote-portal__input"
                       placeholder="+237 ..." data-i18n-placeholder="quote_contact_phone_ph" autocomplete="tel">
              </div>

              <div class="col-12 col-lg-5">
                <label class="form-label quote-portal__label-sm" data-i18n="quote_contact_org_label">Organization</label>
                <input type="text" class="form-control form-control-lg quote-portal__input"
                       placeholder="Company Name" data-i18n-placeholder="quote_contact_org_ph" autocomplete="organization">
              </div>

              <div class="col-12 col-lg-10">
                <label class="form-label quote-portal__label-sm" data-i18n="quote_contact_notes_label">Notes (Optional)</label>
                <textarea class="form-control quote-portal__textarea" rows="4"
                          placeholder="Any specific instructions?" data-i18n-placeholder="quote_contact_notes_ph"></textarea>
              </div>
            </div>

            <div class="d-flex justify-content-between align-items-center mt-4">
              <button type="button" class="btn btn-link quote-portal__link" onclick="changeStep(3)">
                <i class="fa-solid fa-arrow-left me-2"></i> <span data-i18n="quote_btn_back">Back</span>
              </button>
              <button type="button" class="btn quote-portal__submit" onclick="submitQuote()">
                <span data-i18n="quote_submit_btn">SUBMIT REQUEST</span> <i class="fa-solid fa-paper-plane ms-2"></i>
              </button>
            </div>
          </div>

          <!-- SUCCESS -->
          <div id="success-msg" class="quote-portal__success d-none text-center py-5">
            <div class="quote-portal__success-ico mb-4">
              <i class="fa-solid fa-check"></i>
            </div>
            <h2 class="quote-portal__h2-lg mb-2" data-i18n="quote_success_title">Request Received!</h2>

            <div class="quote-portal__success-box mx-auto">
              <p class="mb-1">
                <span data-i18n="quote_success_id_label">Your Quote ID:</span>
                <span class="quote-portal__mono">#SLAS-RFQ-XXXX</span>
              </p>
              <p class="mb-0 quote-portal__success-sub" data-i18n-html="quote_success_body_html">
                We have sent a confirmation to your email.<br>
                Your request has been routed to <strong>customerservice@smartls.cm</strong><br>
                (CC: info@smartls.cm)
              </p>
            </div>

            <button type="button" class="btn btn-link quote-portal__link mt-3" onclick="location.reload()">
              <span data-i18n="quote_start_new">Start New Quote</span>
            </button>
          </div>

        </form>
      </div>

      <!-- Trust Badges -->
      <div class="quote-portal__trust mt-4">
        <div class="quote-portal__trust-item">
          <i class="fa-solid fa-certificate"></i><span>ISO 9001:2015</span>
        </div>
        <div class="quote-portal__trust-item">
          <i class="fa-solid fa-globe"></i><span>WCA MEMBER</span>
        </div>
        <div class="quote-portal__trust-item">
          <i class="fa-solid fa-shield-halved"></i><span>SSL SECURE</span>
        </div>
      </div>

    </div>
  </section>

</main>

<?php require __DIR__ . "/partials/footer.php"; ?>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
<script src="js/app.js"></script>

<!-- Inline wizard JS (keep identical behavior) -->
<script>
  let completedSteps = 1;

  const routeLabels = {
    air: { origin: "Airport of Loading", dest: "Airport of Discharge", sub: "Global Air Freight" },
    sea: { origin: "Port of Loading", dest: "Port of Discharge", sub: "International Ocean Freight" },
    land: { origin: "Place of Loading", dest: "Place of Delivery", sub: "CEMAC Regional Transport" }
  };

  function updateStep2Logic(service) {
    const shipUI = document.getElementById('route-shipping');
    const wareUI = document.getElementById('route-warehouse');
    const subtitle = document.getElementById('step-2-subtitle');

    if (service === 'warehouse') {
      shipUI.classList.add('d-none');
      wareUI.classList.remove('d-none');
      subtitle.innerText = "Define your storage requirements.";
    } else {
      wareUI.classList.add('d-none');
      shipUI.classList.remove('d-none');

      document.getElementById('label-origin').innerText = routeLabels[service].origin;
      document.getElementById('label-dest').innerText = routeLabels[service].dest;
      subtitle.innerText = routeLabels[service].sub;
    }
  }

  function autocomplete(inp, arr) {
    let currentFocus;
    inp.addEventListener("input", function() {
      let a, b, i, val = this.value;
      closeAllLists();
      if (!val) return false;
      currentFocus = -1;

      a = document.createElement("DIV");
      a.setAttribute("id", this.id + "autocomplete-list");
      a.setAttribute("class", "quote-portal__ac-items");
      this.parentNode.appendChild(a);

      let count = 0;
      for (i = 0; i < arr.length; i++) {
        if (arr[i].toUpperCase().includes(val.toUpperCase()) && count < 5) {
          b = document.createElement("DIV");
          b.className = "quote-portal__ac-item";

          const matchIndex = arr[i].toUpperCase().indexOf(val.toUpperCase());
          b.innerHTML = arr[i].substr(0, matchIndex);
          b.innerHTML += "<strong>" + arr[i].substr(matchIndex, val.length) + "</strong>";
          b.innerHTML += arr[i].substr(matchIndex + val.length);
          b.innerHTML += "<input type='hidden' value='" + arr[i] + "'>";

          b.addEventListener("click", function() {
            inp.value = this.getElementsByTagName("input")[0].value;
            closeAllLists();
          });

          a.appendChild(b);
          count++;
        }
      }
    });

    function closeAllLists(elmnt) {
      const x = document.getElementsByClassName("quote-portal__ac-items");
      for (let i = 0; i < x.length; i++) {
        if (elmnt !== x[i] && elmnt !== inp) x[i].parentNode.removeChild(x[i]);
      }
    }
    document.addEventListener("click", function (e) { closeAllLists(e.target); });
  }

  function toggleBulkMode() {
    const isBulk = document.getElementById('toggle-bulk').checked;
    const stdMode = document.getElementById('mode-standard');
    const bulkMode = document.getElementById('mode-bulk');

    if (isBulk) {
      stdMode.classList.add('d-none');
      bulkMode.classList.remove('d-none');
    } else {
      stdMode.classList.remove('d-none');
      bulkMode.classList.add('d-none');
    }
  }

  function changeStep(stepNum) {
    if(stepNum > completedSteps) completedSteps = stepNum;

    const dots = document.querySelectorAll('.quote-portal__step-dot');
    dots.forEach((dot, idx) => {
      const n = idx + 1;
      if (n <= completedSteps) dot.classList.remove('is-locked');
      dot.classList.toggle('is-active', n === stepNum);
    });

    document.querySelectorAll('.quote-portal__step').forEach(el => el.classList.remove('is-visible'));
    const target = document.getElementById(`step-${stepNum}`);
    if (target) target.classList.add('is-visible');

    document.getElementById('progress-bar').style.width = `${stepNum * 25}%`;
    document.getElementById('current-step-num').innerText = stepNum;
  }

  function updateWeight(val) {
    // keep function; if you want a visible display, add a node with id="weight-display"
    const v = parseInt(val, 10);
    if (isNaN(v)) return;
  }

  function submitQuote() {
    document.querySelectorAll('.quote-portal__step').forEach(el => el.classList.remove('is-visible'));
    document.getElementById('success-msg').classList.remove('d-none');
    document.getElementById('progress-bar').style.width = `100%`;
    document.getElementById('progress-bar').classList.add('is-success');
  }

  changeStep(1);
</script>

<script>
(function () {
  const range = document.getElementById("weight-range");
  const input = document.getElementById("weight-input");
  if (!range || !input) return;

  range.addEventListener("input", () => {
    input.value = range.value;
  });

  input.addEventListener("input", () => {
    let val = parseInt(input.value, 10);
    if (isNaN(val)) return;
    if (val < 1) val = 1;
    if (val > 30000) val = 30000;
    input.value = val;
    range.value = val;
  });
})();
</script>

<script>
function setupPhoton(inputId, suggestionId, statusId) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(suggestionId);
  const status = document.getElementById(statusId);

  if (!input || !list || !status) return;

  let controller;
  let debounceTimer;

  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();

    if (q.length < 2) {
      list.innerHTML = "";
      status.textContent = "";
      return;
    }

    status.textContent = "Searching locations…";
    debounceTimer = setTimeout(() => fetchLocations(q), 300);
  });

  async function fetchLocations(query) {
    if (controller) controller.abort();
    controller = new AbortController();

    try {
      const res = await fetch(
        `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=6`,
        { signal: controller.signal }
      );

      const data = await res.json();
      list.innerHTML = "";
      status.textContent = "";

      data.features.forEach(f => {
        const name = f.properties.name || "";
        const city = f.properties.city || "";
        const country = f.properties.country || "";
        const lat = f.geometry.coordinates[1];
        const lng = f.geometry.coordinates[0];

        const display = [name, city, country].filter(Boolean).join(", ");

        const item = document.createElement("button");
        item.type = "button";
        item.className = "list-group-item list-group-item-action";
        item.textContent = display;

        item.onclick = () => {
          input.value = display;
          input.dataset.lat = lat;
          input.dataset.lng = lng;
          list.innerHTML = "";
          status.textContent = "✔ Location selected";
        };

        list.appendChild(item);
      });

      if (data.features.length === 0) status.textContent = "No locations found";
    } catch (e) {
      if (e.name !== "AbortError") status.textContent = "Location search unavailable";
    }
  }

  document.addEventListener("click", e => {
    if (!e.target.closest("#" + suggestionId) && e.target !== input) list.innerHTML = "";
  });
}

setupPhoton("origin-input", "origin-suggestions", "origin-status");
setupPhoton("dest-input", "dest-suggestions", "dest-status");
setupPhoton("warehouse-loc-input", "warehouse-suggestions", "warehouse-status");
</script>

</body>
</html>