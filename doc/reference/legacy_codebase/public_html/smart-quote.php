<?php
  $pageTitle = "Get a Smart Quote | Smart Logistics & Services Ltd";
  $pageDescription = "Configure your logistics requirements in 4 steps and request a Smart Quote from Smart Logistics & Services Ltd. Get fast, compliant air, sea, land freight and warehousing quotes across Cameroon and the CEMAC region.";
  $pageKeywords = "Smart Quote, Logistics Quote, Freight Quote, Air Freight Quote, Sea Freight Quote, Land Freight Quote, Warehousing Quote, Customs Cameroon, Douala Logistics, CEMAC Transport, Smart Logistics";
  $canonicalUrl = "https://smartls.cm/smart-quote"; // keep aligned with actual filename
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
  <link rel="icon" type="image/png" sizes="32x32" href="assets/img-webp/logo-smart.webp">
  <link rel="icon" type="image/png" sizes="16x16" href="assets/img-webp/logo-smart.webp">
  <link rel="icon" href="assets/img-webp/logo-smart.webp">
  <link rel="apple-touch-icon" sizes="180x180" href="assets/img-webp/logo-smart.webp">
  <link rel="canonical" href="<?php echo htmlspecialchars($canonicalUrl); ?>">

  <meta name="theme-color" content="#055B83">

  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Smart Logistics & Services Ltd">
  <meta property="og:title" content="<?php echo htmlspecialchars($pageTitle); ?>">
  <meta property="og:description" content="<?php echo htmlspecialchars($pageDescription); ?>">
  <meta property="og:url" content="<?php echo htmlspecialchars($canonicalUrl); ?>">
  <meta property="og:image" content="https://smartls.cm/images/og/quote-og.jpg">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="<?php echo htmlspecialchars($pageTitle); ?>">
  <meta name="twitter:description" content="<?php echo htmlspecialchars($pageDescription); ?>">
  <meta name="twitter:image" content="https://smartls.cm/images/og/quote-og.jpg">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">

  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" rel="stylesheet">

  <link rel="stylesheet" href="css/style.css">

  <link rel="preconnect" href="https://photon.komoot.io" crossorigin>

  <style>
    /* 1. Shake Animation */
    .shake-btn {
      animation: shake 0.5s;
    }
    @keyframes shake {
      0% { transform: translate(1px, 1px) rotate(0deg); }
      10% { transform: translate(-1px, -2px) rotate(-1deg); }
      20% { transform: translate(-3px, 0px) rotate(1deg); }
      30% { transform: translate(3px, 2px) rotate(0deg); }
      40% { transform: translate(1px, -1px) rotate(1deg); }
      50% { transform: translate(-1px, 2px) rotate(-1deg); }
      60% { transform: translate(-3px, 1px) rotate(0deg); }
      70% { transform: translate(3px, 1px) rotate(-1deg); }
      80% { transform: translate(-1px, -1px) rotate(1deg); }
      90% { transform: translate(1px, 2px) rotate(0deg); }
      100% { transform: translate(1px, -2px) rotate(-1deg); }
    }

    /* 2. Success Message Centering */
    /* This ensures the success message sits perfectly in the middle of the card */
    #success-msg {
      min-height: 400px; /* Give it height to center within */
      display: flex;
      flex-direction: column;
      justify-content: center; /* Vertical Center */
      align-items: center;     /* Horizontal Center */
    }
    
    /* Make the Quote ID Box pop */
    .quote-portal__success-box {
      background: #f8f9fa;
      border: 2px dashed #198754;
      padding: 20px;
      border-radius: 12px;
      margin-top: 20px;
      margin-bottom: 20px;
    }
  </style>
</head>

<body>
<?php
  // Prevent header warning + correct active nav highlighting
  $activePage = 'smart-quote';
  require __DIR__ . "/partials/header.php";
?>

<main class="quote-portal">

  <div class="quote-portal__bg-map" aria-hidden="true"></div>

  <section class="quote-portal__wrap py-5">
    <div class="container">

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

      <div class="quote-portal__card">

        <div class="quote-portal__card-head">
          <div class="d-flex flex-column flex-md-row justify-content-between align-items-center gap-3">

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

        <div class="quote-portal__progress">
          <div id="progress-bar" class="quote-portal__progress-bar" style="width:25%"></div>
        </div>

        <form id="smart-quote-form" class="quote-portal__form" autocomplete="off" onsubmit="return false;">

          <div id="step-1" class="quote-portal__step is-visible">
            <div class="text-center mb-4">
              <h2 class="quote-portal__h2 mb-1" data-i18n="quote_s1_title">Your Need</h2>
              <p class="quote-portal__sub mb-0" data-i18n="quote_s1_sub">Select the logistics service that fits your requirement.</p>
            </div>

            <div class="row g-3">
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

              <div class="col-12 col-md-6 col-lg-3">
                <label class="quote-portal__svc-wrap w-100">
                  <input type="radio" name="service" value="sea" class="quote-portal__svc-input" onchange="updateStep2Logic('sea')" required>
                  <div class="quote-portal__svc-card">
                    <div class="quote-portal__svc-icon"><i class="fa-solid fa-ship"></i></div>
                    <h3 class="quote-portal__svc-title" data-i18n="quote_service_sea_title">Sea Freight</h3>
                    <p class="quote-portal__svc-text" data-i18n="quote_service_sea_sub">Cost-effective FCL &amp; LCL.</p>
                  </div>
                </label>
              </div>

              <div class="col-12 col-md-6 col-lg-3">
                <label class="quote-portal__svc-wrap w-100">
                  <input type="radio" name="service" value="land" class="quote-portal__svc-input" onchange="updateStep2Logic('land')" required>
                  <div class="quote-portal__svc-card">
                    <div class="quote-portal__svc-icon"><i class="fa-solid fa-truck-front"></i></div>
                    <h3 class="quote-portal__svc-title" data-i18n="quote_service_land_title">Land Freight</h3>
                    <p class="quote-portal__svc-text" data-i18n="quote_service_land_sub">Cross-border CEMAC trucking.</p>
                  </div>
                </label>
              </div>

              <div class="col-12 col-md-6 col-lg-3">
                <label class="quote-portal__svc-wrap w-100">
                  <input type="radio" name="service" value="warehouse" class="quote-portal__svc-input" onchange="updateStep2Logic('warehouse')" >
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

          <div id="step-2" class="quote-portal__step">
            <div class="text-center mb-4">
              <h2 class="quote-portal__h2 mb-1" data-i18n="quote_s2_title">Your Route</h2>
              <p class="quote-portal__sub mb-0" id="step-2-subtitle" data-i18n="quote_s2_sub">Where is your cargo traveling?</p>
            </div>

            <div id="route-shipping" class="row g-3 justify-content-center">
              <div class="col-12 col-lg-5">
                <label id="label-origin" class="form-label quote-portal__label" data-i18n="quote_origin_label">Origin City/Port</label>
                <div class="position-relative quote-portal__icon-input">
                  <i class="fa-solid fa-location-dot"></i>
                  <input type="text" id="origin-input" name="origin_location" class="form-control form-control-lg quote-portal__input"
                  placeholder="e.g. Dubai, UAE" data-i18n-placeholder="quote_origin_ph" autocomplete="off" required>

                  <div id="origin-suggestions" class="list-group position-absolute w-100 shadow"></div>
                  <div class="quote-portal__loc-status text-muted small mt-1" id="origin-status"></div>
                </div>
              </div>

              <div class="col-12 col-lg-5">
                <label id="label-dest" class="form-label quote-portal__label" data-i18n="quote_dest_label">Destination</label>
                <div class="position-relative quote-portal__icon-input is-orange">
                  <i class="fa-solid fa-location-crosshairs"></i>
                  <input type="text" id="dest-input" name="destination_location" class="form-control form-control-lg quote-portal__input"
                  placeholder="e.g. Bangui, CAR" data-i18n-placeholder="quote_dest_ph" autocomplete="off" required>

                  <div id="dest-suggestions" class="list-group position-absolute w-100 shadow"></div>
                  <div class="quote-portal__loc-status text-muted small mt-1" id="dest-status"></div>
                </div>
              </div>
            </div>

            <div id="route-warehouse" class="row g-3 justify-content-center d-none">
              <div class="col-12 col-lg-5">
                <label class="form-label quote-portal__label" data-i18n="quote_wh_loc_label">Preferred Location</label>
                <div class="position-relative quote-portal__icon-input">
                  <i class="fa-solid fa-map-pin"></i>
                  <input type="text" id="warehouse-loc-input" name="warehouse_location" class="form-control form-control-lg quote-portal__input"
                    placeholder="e.g. Douala Port Zone" data-i18n-placeholder="quote_wh_loc_ph" autocomplete="off" required>
                  
                  <div id="warehouse-suggestions" class="list-group position-absolute w-100 shadow"></div>
                  <div class="quote-portal__loc-status text-muted small mt-1" id="warehouse-status"></div>
                </div>
              </div>

              <div class="col-12 col-lg-5">
                <label class="form-label quote-portal__label" data-i18n="quote_wh_duration_label">Duration Needed</label>
                <div class="position-relative quote-portal__icon-select">
                  <i class="fa-regular fa-calendar"></i>
                  <select id="warehouse-duration" name="warehouse_duration" class="form-select form-select-lg quote-portal__input">

                    <option data-i18n="quote_wh_duration_opt_1" value="SHORT_TERM">Short Term (&lt; 1 Month)</option>
                    <option data-i18n="quote_wh_duration_opt_2" value="MEDIUM_TERM">Medium Term (1-6 Months)</option>
                    <option data-i18n="quote_wh_duration_opt_3" value="LONG_TERM">Long Term (&gt; 6 Months)</option>
                    <option data-i18n="quote_wh_duration_opt_4" value="INDEFINITE">Indefinite / Recurring</option>
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

          <div id="step-3" class="quote-portal__step">
            <div class="text-center mb-4">
              <h2 class="quote-portal__h2 mb-1" data-i18n="quote_s3_title">Cargo Details</h2>
              <p class="quote-portal__sub mb-0" data-i18n="quote_s3_sub">Tell us about your shipment.</p>
            </div>

            <div class="row justify-content-center">
              <div class="col-12 col-lg-10">

                <div class="quote-portal__toggle-card mb-3">
                  <div class="d-flex align-items-start gap-3">
                    <div class="quote-portal__toggle-ico"><i class="fa-solid fa-cubes-stacked"></i></div>
                    <div class="flex-grow-1">
                      <div class="quote-portal__toggle-title" data-i18n="quote_bulk_title">Project Cargo / High Volume?</div>
                      <div class="quote-portal__toggle-sub" data-i18n="quote_bulk_sub">Select this for Cargo Out of Range or OOG.</div>
                    </div>

                    <label class="quote-portal__switch">
                      <input type="checkbox" id="toggle-bulk" onchange="toggleBulkMode()" >
                      <span class="quote-portal__slider"></span>
                    </label>
                  </div>
                </div>

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
                          name="estimated_weight"
                          inputmode="numeric"
                        required>
                        <span>Kg</span>
                      </div>
                    </div>

                    <input type="range" min="1" max="30000" value="500"
                           class="form-range quote-portal__range" id="weight-range"
                           oninput="updateWeight(this.value)" required>

                    <div class="d-flex justify-content-between quote-portal__range-ends">
                      <span data-i18n="quote_weight_min">1 Kg</span>
                      <span data-i18n="quote_weight_max">30,000 Kg+</span>
                    </div>
                  </div>
                </div>

                <div id="mode-bulk" class="d-none">
                  <label class="form-label quote-portal__label" data-i18n="quote_bulk_desc_label">Project Cargo Description</label>
                  <textarea class="form-control quote-portal__textarea" id="cargo-description" name="cargo_description"
                            placeholder="Please describe your shipment: Number of containers, dimensions for Out-of-Gauge (OOG) cargo, special handling requirements, etc."
                            data-i18n-placeholder="quote_bulk_desc_ph"
                            rows="6"></textarea>
                </div>

                <div class="mt-3">
                  <label class="form-label quote-portal__label" data-i18n="quote_upload_label">Upload Documents</label>

                  <input
                    type="file"
                    id="quote-attachment"
                    name="attachment"
                    class="d-none"
                    accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  required/>

                  <div id="upload-box" class="quote-portal__upload" role="button" tabindex="0">
                    <div class="quote-portal__upload-ico"><i class="fa-solid fa-cloud-arrow-up"></i></div>
                    <div class="quote-portal__upload-title" data-i18n="quote_upload_title">Click to upload Commercial Invoice / Packing List</div>
                    <div class="quote-portal__upload-sub" data-i18n="quote_upload_sub">PDF, JPG, PNG (Max 10MB)</div>
                  </div>

                  <div id="upload-file-name" class="small text-muted mt-2"></div>
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

          <div id="step-4" class="quote-portal__step">
            <div class="text-center mb-4">
              <h2 class="quote-portal__h2 mb-1" data-i18n="quote_s4_title">Final Step</h2>
              <p class="quote-portal__sub mb-0" data-i18n="quote_s4_sub">Where should we send the quote?</p>
            </div>

            <div class="row g-3 justify-content-center">
              <div class="col-12 col-lg-5">
                <label class="form-label quote-portal__label-sm" data-i18n="quote_contact_name_label">Full Name</label>
                <input type="text" id="requester-name" name="requester_name"  class="form-control form-control-lg quote-portal__input"
                       placeholder="John Doe" data-i18n-placeholder="quote_contact_name_ph" autocomplete="name" required>
              </div>

              <div class="col-12 col-lg-5">
                <label class="form-label quote-portal__label-sm" data-i18n="quote_contact_email_label">Email Address</label>
                <input type="email"  id="requester-email" name="requester_email" class="form-control form-control-lg quote-portal__input"
                       placeholder="john@company.com" data-i18n-placeholder="quote_contact_email_ph" autocomplete="email">
              </div>

              <div class="col-12 col-lg-5">
                <label class="form-label quote-portal__label-sm" data-i18n="quote_contact_phone_label">Phone Number</label>
                <input type="tel" id="requester-phone" name="requester_phone"  class="form-control form-control-lg quote-portal__input"
                       placeholder="+237 ..." data-i18n-placeholder="quote_contact_phone_ph" autocomplete="tel" required>
              </div>

              <div class="col-12 col-lg-5">
                <label class="form-label quote-portal__label-sm"  data-i18n="quote_contact_org_label">Organization</label>
                <input type="text" id="requester-company" name="requester_company" class="form-control form-control-lg quote-portal__input"
                       placeholder="Company Name" data-i18n-placeholder="quote_contact_org_ph" autocomplete="organization" required>
              </div>

              <div class="col-12 col-lg-10">
                <label class="form-label quote-portal__label-sm" data-i18n="quote_contact_notes_label">Notes (Optional)</label>
                <textarea class="form-control quote-portal__textarea"  id="additional-notes" name="additional_notes" rows="4"
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

      <div class="quote-portal__trust mt-4">
        <div class="quote-portal__trust-item">
          <i class="fa-solid fa-certificate"></i><span>ISO 9001:2015</span>
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

<script>
  let completedSteps = 1;

  const routeLabels = {
    air: { origin: "Airport of Loading", dest: "Airport of Discharge", sub: "Global Air Freight" },
    sea: { origin: "Port of Loading", dest: "Port of Discharge", sub: "International Ocean Freight" },
    land: { origin: "Place of Loading", dest: "Place of Delivery", sub: "CEMAC Regional Transport" }
  };

  // --- 1. VALIDATION FUNCTION ---
  function validateCurrentStep(stepNum) {
    let isValid = true;
    let inputsToCheck = [];

    // Clear previous errors
    document.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
    const uploadBox = document.getElementById('upload-box');
    if(uploadBox) uploadBox.style.border = ""; 

    // STEP 2 VALIDATION (Route)
    if (stepNum === 2) {
      const service = document.querySelector('input[name="service"]:checked')?.value;
      if (service === 'warehouse') {
        inputsToCheck.push(document.getElementById('warehouse-loc-input'));
      } else {
        inputsToCheck.push(document.getElementById('origin-input'));
        inputsToCheck.push(document.getElementById('dest-input'));
      }
    }

    // STEP 3 VALIDATION (Details & File)
    if (stepNum === 3) {
      const isBulk = document.getElementById('toggle-bulk').checked;
      
      // Check Weight OR Description
      if (isBulk) {
        inputsToCheck.push(document.getElementById('cargo-description'));
      } else {
        inputsToCheck.push(document.getElementById('weight-input'));
      }

      // Check File Upload
      const fileInput = document.getElementById('quote-attachment');
      if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        isValid = false;
        if(uploadBox) {
            uploadBox.style.border = "2px dashed #dc3545"; // Red Border
            uploadBox.style.backgroundColor = "#fff8f8";
            // Optional: Scroll to upload box
            uploadBox.scrollIntoView({behavior: 'smooth', block: 'center'});
        }
      }
    }

    // STEP 4 VALIDATION (Contact)
    if (stepNum === 4) {
      inputsToCheck.push(document.getElementById('requester-name'));
      inputsToCheck.push(document.getElementById('requester-email'));
      inputsToCheck.push(document.getElementById('requester-phone'));
      inputsToCheck.push(document.getElementById('requester-company'));
      // Note: 'additional-notes' is skipped
    }

    // Apply Error Classes
    inputsToCheck.forEach(input => {
      if (input && !input.value.trim()) {
        isValid = false;
        input.classList.add('is-invalid'); // Bootstrap red border class
      }
    });

    return isValid;
  }

  // --- 2. EXISTING LOGIC ---
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

  // --- 3. UPDATED CHANGE STEP (With Shake & Scroll) ---
  function changeStep(stepNum) {
    let currentStep = 1;
    if(document.getElementById('step-2').classList.contains('is-visible')) currentStep = 2;
    if(document.getElementById('step-3').classList.contains('is-visible')) currentStep = 3;
    if(document.getElementById('step-4').classList.contains('is-visible')) currentStep = 4;

    if (stepNum > currentStep) {
        if (!validateCurrentStep(currentStep)) {
            handleStepError(currentStep); // ERROR: Shake and Scroll
            return; 
        }
    }

    // ... Standard Step Logic ...
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

  // --- HELPER: SHAKE & SCROLL ---
  function handleStepError(stepNum) {
      const stepEl = document.getElementById('step-' + stepNum);
      const btn = stepEl.querySelector('.quote-portal__btn-lg') || stepEl.querySelector('.quote-portal__submit');
      
      // 1. Shake the Button
      if (btn) {
          btn.classList.add('shake-btn');
          setTimeout(() => btn.classList.remove('shake-btn'), 500);
      }

      // 2. Scroll to Error
      const firstError = stepEl.querySelector('.is-invalid') || document.getElementById('upload-box');
      if (firstError) {
          firstError.scrollIntoView({behavior: "smooth", block: "center"});
          if(firstError.tagName === 'INPUT') firstError.focus();
      }
  }

  function updateWeight(val) {
    const v = parseInt(val, 10);
    if (isNaN(v)) return;
  }

  // --- UPDATED SUBMIT LOGIC (Loading + Success Center) ---
  async function submitQuote() {
    // 1. Validate Step 4 first
    if (!validateCurrentStep(4)) {
        handleStepError(4);
        return;
    }

    // 2. Get the Submit Button & Disable it (LOADING STATE)
    const btn = document.querySelector('.quote-portal__submit');
    const originalText = btn.innerHTML; // Save "SUBMIT REQUEST" text
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-2"></i> Processing...';

    // 3. Prepare Data
    const fd = new FormData();
    const service = document.querySelector('input[name="service"]:checked')?.value || 'air';
    fd.append('service', service);
    fd.append('origin_location', (document.getElementById('origin-input')?.value || '').trim());
    fd.append('destination_location', (document.getElementById('dest-input')?.value || '').trim());
    fd.append('warehouse_location', (document.getElementById('warehouse-loc-input')?.value || '').trim());
    fd.append('warehouse_duration', document.getElementById('warehouse-duration')?.value || 'UNKNOWN');

    const isBulk = document.getElementById('toggle-bulk')?.checked ? 1 : 0;
    fd.append('project_cargo_flag', String(isBulk));
    if (!isBulk) {
      fd.append('estimated_weight', String(document.getElementById('weight-input')?.value || ''));
    } else {
      fd.append('cargo_description', (document.getElementById('cargo-description')?.value || '').trim());
    }

    fd.append('requester_name', (document.getElementById('requester-name')?.value || '').trim());
    fd.append('requester_email', (document.getElementById('requester-email')?.value || '').trim());
    fd.append('requester_phone', (document.getElementById('requester-phone')?.value || '').trim());
    fd.append('requester_company', (document.getElementById('requester-company')?.value || '').trim());
    fd.append('additional_notes', (document.getElementById('additional-notes')?.value || '').trim());

    const fileInput = document.getElementById('quote-attachment');
    if (fileInput?.files?.[0]) {
      fd.append('attachment', fileInput.files[0]);
    } else {
      alert('Please upload your document.');
      btn.disabled = false;
      btn.innerHTML = originalText;
      return;
    }

    // 4. Send to Server
    try {
      const res = await fetch('api/public/quote-request.php', {
        method: 'POST',
        body: fd
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Submission failed');
      }

      // 5. SUCCESS STATE (Centering)
      // Hide the form steps
      document.querySelectorAll('.quote-portal__step').forEach(el => el.classList.remove('is-visible'));
      document.querySelector('.quote-portal__step-counter').style.display = 'none'; // Hide step counter
      document.querySelector('.quote-portal__card-head').style.opacity = '0.3'; // Dim the header dots
      
      // Show Success Message (Centered via CSS)
      const successDiv = document.getElementById('success-msg');
      successDiv.classList.remove('d-none');
      // Force Flex Display for centering
      successDiv.style.display = 'flex'; 

      // Inject the Quote ID
      const idSpan = successDiv.querySelector('.quote-portal__mono');
      if(idSpan) idSpan.innerText = '#' + data.public_quote_ref;

      // Scroll to top of card so they see it centered
      document.querySelector('.quote-portal__card').scrollIntoView({behavior: "smooth", block: "center"});

    } catch (err) {
      console.error(err);
      alert(err.message || 'Network error');
      
      // Reset Button on Failure
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }

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
<script>
document.addEventListener('DOMContentLoaded', () => {
  const box = document.getElementById('upload-box');
  const input = document.getElementById('quote-attachment');
  const nameEl = document.getElementById('upload-file-name');

  if (!box || !input) return;

  function showName() {
    if (!nameEl) return;
    nameEl.textContent = (input.files && input.files[0]) ? `Selected: ${input.files[0].name}` : '';
  }

  box.addEventListener('click', () => input.click());

  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });

  input.addEventListener('change', showName);
});
</script>

</body>
</html>