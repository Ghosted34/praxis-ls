<?php
  $pageTitle = "Get a Smart Quote | Smart Logistics & Services Ltd";
  $pageDescription = "Interactive Smart Quote Wizard — configure your logistics requirements in 4 steps.";
  $pageKeywords = "Smart Logistics, Quote, Freight, Customs, Transport, Warehousing, CEMAC, Douala";
  $canonicalUrl = "https://smartls.cm/quote-two.php"; // update to your real domain
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
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">

  <!-- Your global site css -->
  <link rel="stylesheet" href="css/style.css">

  <!-- Page styles (scoped) -->
  <style>
    :root{
      --smartBlue:#1F99D8;
      --smartDarkBlue:#055B83;
      --smartOrange:#EE7D04;
      --smartCharcoal:#231F20;
      --smartGreen:#2ECC71;
      --smartGrey:#F4F6F7;
    }

    body.quote-page{
      font-family: "Manrope", sans-serif;
      color: var(--smartCharcoal);
      background-color: #F8FAFC;
      background-image:
        radial-gradient(circle at 10% 20%, rgba(31, 153, 216, 0.05) 0%, transparent 20%),
        radial-gradient(circle at 90% 80%, rgba(238, 125, 4, 0.05) 0%, transparent 20%);
      overflow-x: hidden;
    }

    .quote-page .quote-bgmap{
      position: fixed;
      inset: 0;
      opacity: .03;
      pointer-events: none;
      background-image: url('https://upload.wikimedia.org/wikipedia/commons/8/80/World_map_-_low_resolution.svg');
      background-size: cover;
      background-position: center;
      z-index: 0;
    }

    .quote-page .safety-strip-bar{
      height: 6px;
      width: 100%;
      background: repeating-linear-gradient(45deg, var(--smartOrange), var(--smartOrange) 15px, var(--smartBlue) 15px, var(--smartBlue) 30px);
    }

    /* Glass panel */
    .quote-page .glass-panel{
      position: relative;
      z-index: 1;
      background: rgba(255,255,255,.92);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
      border: 1px solid rgba(255,255,255,.85);
      box-shadow:
        0 20px 25px -5px rgba(0,0,0,.05),
        0 10px 10px -5px rgba(0,0,0,.02),
        0 0 0 1px rgba(31,153,216,.05);
      border-radius: 1.5rem;
      overflow: hidden;
    }

    /* Hero title */
    .quote-page .hero-kicker{
      display:inline-flex;
      align-items:center;
      gap:.5rem;
      padding:.45rem .95rem;
      border-radius: 999px;
      background: linear-gradient(90deg, var(--smartOrange), #ff9a3a);
      color: #fff;
      font-weight: 800;
      letter-spacing: .20em;
      text-transform: uppercase;
      font-size: .70rem;
      box-shadow: 0 14px 30px rgba(238,125,4,.18);
    }
    .quote-page .hero-title{
      font-family: "Montserrat", sans-serif;
      font-weight: 900;
      letter-spacing: -0.02em;
      line-height: 1.05;
      margin: 1rem 0 .25rem;
      font-size: clamp(2.0rem, 1.2rem + 2.2vw, 3.1rem);
    }
    .quote-page .hero-title .grad{
      background: linear-gradient(90deg, var(--smartBlue), #55d6ff);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    .quote-page .hero-sub{
      color: rgba(35,31,32,.62);
      font-weight: 600;
      font-size: 1.05rem;
      line-height: 1.7;
      max-width: 56ch;
      margin: 0 auto;
    }

    /* Wizard steps */
    .quote-page .wizard-step{ display:none; opacity:0; transform: scale(.985); transition: opacity .35s ease, transform .35s ease; }
    .quote-page .wizard-step.active{ display:block; opacity:1; transform: scale(1); }

    /* Progress header */
    .quote-page .progress-head{
      background: linear-gradient(90deg, rgba(248,250,252,1), rgba(255,255,255,1));
      border-bottom: 1px solid rgba(17,24,39,.06);
    }

    .quote-page .step-dot{ cursor: pointer; user-select:none; }
    .quote-page .step-dot .num{
      width: 34px; height: 34px;
      border-radius: 999px;
      display:flex; align-items:center; justify-content:center;
      font-weight: 900;
      font-size: .85rem;
      transition: transform .18s ease, background .18s ease, color .18s ease;
      background: #e5e7eb; color: #6b7280;
    }
    .quote-page .step-dot.active .num{
      background: var(--smartBlue);
      color:#fff;
      box-shadow: 0 14px 24px rgba(31,153,216,.18);
    }
    .quote-page .step-dot .lbl{
      margin-top: .25rem;
      font-size: .62rem;
      font-weight: 900;
      letter-spacing: .12em;
      text-transform: uppercase;
      color: #6b7280;
    }
    .quote-page .step-dot.active .lbl{ color: var(--smartBlue); }

    .quote-page .step-line{
      height: 2px;
      width: 34px;
      background: rgba(17,24,39,.12);
      border-radius: 999px;
      margin: 0 .4rem;
    }

    .quote-page .progress-track{
      height: 7px;
      background: rgba(17,24,39,.06);
      position: relative;
      overflow: hidden;
    }
    .quote-page .progress-barx{
      position:absolute; inset:0 auto 0 0;
      height: 100%;
      width: 25%;
      background: linear-gradient(90deg, var(--smartOrange), var(--smartBlue));
      border-radius: 0 999px 999px 0;
      transition: width .55s ease;
      box-shadow: 0 0 12px rgba(31,153,216,.20);
    }

    /* Inputs */
    .quote-page .smart-input{
      background: #F8FAFC;
      border: 1px solid rgba(17,24,39,.12);
      border-radius: 14px;
      padding: 14px 14px;
      font-weight: 600;
      transition: box-shadow .2s ease, border-color .2s ease, background .2s ease;
    }
    .quote-page .smart-input:focus{
      background:#fff;
      border-color: rgba(31,153,216,.55);
      box-shadow: 0 0 0 4px rgba(31,153,216,.10);
      outline: 0;
    }
    .quote-page .input-icon{
      position:absolute; inset:0 auto 0 14px;
      display:flex; align-items:center;
      color: rgba(17,24,39,.35);
      pointer-events:none;
    }
    .quote-page .input-pad-left{ padding-left: 44px; }

    /* Autocomplete dropdown */
    .quote-page .autocomplete-items{
      position:absolute;
      z-index: 50;
      top: calc(100% + 6px);
      left: 0; right: 0;
      background: #fff;
      border: 1px solid rgba(17,24,39,.12);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 14px 30px rgba(0,0,0,.10);
      max-height: 210px;
      overflow-y: auto;
    }
    .quote-page .autocomplete-items div{
      padding: 12px 12px;
      cursor: pointer;
      font-size: .95rem;
      font-weight: 600;
      border-bottom: 1px solid rgba(17,24,39,.06);
      color: rgba(35,31,32,.78);
    }
    .quote-page .autocomplete-items div:hover{ background: rgba(31,153,216,.06); }
    .quote-page .autocomplete-active{
      background: rgba(31,153,216,.12) !important;
      color: var(--smartDarkBlue) !important;
    }

    /* Service card selection */
    .quote-page .service-radio{ position:absolute; opacity:0; pointer-events:none; }
    .quote-page .service-card{
      border: 1px solid rgba(17,24,39,.10);
      border-radius: 18px;
      background: #fff;
      padding: 22px;
      height: 100%;
      transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease, background .18s ease;
    }
    .quote-page .service-card .iconwrap{
      width: 70px; height: 70px;
      border-radius: 18px;
      background: rgba(17,24,39,.04);
      display:flex; align-items:center; justify-content:center;
      font-size: 28px;
      color: rgba(17,24,39,.35);
      transition: transform .2s ease, background .2s ease, color .2s ease;
      margin-bottom: 14px;
    }
    .quote-page .service-card h3{
      font-weight: 900;
      margin: 0 0 6px;
      font-size: 1.05rem;
    }
    .quote-page .service-card p{
      margin: 0;
      color: rgba(35,31,32,.55);
      font-weight: 600;
      font-size: .82rem;
      line-height: 1.55;
    }
    .quote-page label.service-pick:hover .service-card{
      border-color: rgba(31,153,216,.25);
      box-shadow: 0 18px 28px rgba(0,0,0,.06);
      transform: translateY(-2px);
    }
    .quote-page .service-radio:checked + .service-card{
      border-color: rgba(31,153,216,.65);
      background: linear-gradient(145deg, rgba(240,249,255,1) 0%, rgba(255,255,255,1) 100%);
      box-shadow: 0 18px 30px rgba(31,153,216,.14);
      transform: translateY(-2px);
    }
    .quote-page .service-radio:checked + .service-card .iconwrap{
      background: var(--smartBlue);
      color: #fff;
      transform: scale(1.05) rotate(-4deg);
    }
    .quote-page .service-radio:checked + .service-card h3{ color: var(--smartBlue); }

    /* Buttons */
    .quote-page .btn-smart-next{
      background: var(--smartBlue);
      color: #fff;
      border: 0;
      font-weight: 900;
      padding: 14px 22px;
      border-radius: 14px;
      box-shadow: 0 16px 26px rgba(31,153,216,.18);
      transition: transform .18s ease, box-shadow .18s ease, background .18s ease;
    }
    .quote-page .btn-smart-next:hover{
      background: var(--smartDarkBlue);
      transform: translateY(-2px);
      box-shadow: 0 18px 30px rgba(31,153,216,.22);
    }
    .quote-page .btn-smart-submit{
      background: linear-gradient(90deg, var(--smartOrange), #ff9a3a);
      color:#fff;
      border: 0;
      font-weight: 900;
      padding: 14px 24px;
      border-radius: 14px;
      box-shadow: 0 16px 30px rgba(238,125,4,.20);
      transition: transform .18s ease, box-shadow .18s ease, filter .18s ease;
    }
    .quote-page .btn-smart-submit:hover{
      transform: translateY(-2px);
      box-shadow: 0 18px 34px rgba(238,125,4,.24);
      filter: saturate(1.05);
    }
    .quote-page .btn-back{
      color: rgba(35,31,32,.62);
      font-weight: 900;
      text-decoration: none;
    }
    .quote-page .btn-back:hover{ color: rgba(35,31,32,.92); }

    /* Toggle (bulk mode) */
    .quote-page .toggle-wrap{
      border: 1px solid rgba(17,24,39,.10);
      border-radius: 16px;
      background: #fff;
      box-shadow: 0 10px 16px rgba(0,0,0,.04);
      padding: 14px 14px;
    }
    .quote-page .toggle-bg{
      width: 54px; height: 28px;
      background: rgba(17,24,39,.10);
      border-radius: 999px;
      border: 1px solid rgba(17,24,39,.10);
      position: relative;
      transition: background .18s ease, border-color .18s ease;
      flex: 0 0 auto;
    }
    .quote-page .toggle-dot{
      width: 20px; height: 20px;
      background: #fff;
      border-radius: 999px;
      position: absolute;
      top: 3px; left: 3px;
      box-shadow: 0 8px 14px rgba(0,0,0,.10);
      border: 1px solid rgba(17,24,39,.06);
      transition: transform .18s ease;
    }
    .quote-page #toggle-bulk:checked + .toggle-bg{
      background: rgba(238,125,4,1);
      border-color: rgba(238,125,4,1);
    }
    .quote-page #toggle-bulk:checked + .toggle-bg .toggle-dot{
      transform: translateX(26px);
    }

    /* Weight slider */
    .quote-page .weight-card{
      background: #fff;
      border: 1px solid rgba(17,24,39,.06);
      border-radius: 18px;
      box-shadow: 0 10px 16px rgba(0,0,0,.04);
      padding: 22px;
    }
    .quote-page input[type="range"]{
      width: 100%;
      accent-color: var(--smartBlue);
    }

    /* Upload box */
    .quote-page .upload-box{
      border: 2px dashed rgba(17,24,39,.18);
      border-radius: 18px;
      padding: 22px;
      text-align:center;
      background: rgba(248,250,252,.7);
      cursor: pointer;
      transition: background .18s ease, border-color .18s ease, transform .18s ease;
      position: relative;
    }
    .quote-page .upload-box:hover{
      background: rgba(240,249,255,.85);
      border-color: rgba(31,153,216,.35);
      transform: translateY(-1px);
    }
    .quote-page .upload-box input[type="file"]{
      position:absolute;
      inset:0;
      opacity:0;
      cursor:pointer;
    }

    /* Success */
    .quote-page .success-badge{
      width: 94px; height: 94px;
      border-radius: 999px;
      display:flex; align-items:center; justify-content:center;
      background: linear-gradient(135deg, var(--smartGreen), #57f08f);
      box-shadow: 0 18px 40px rgba(46,204,113,.18);
      margin: 0 auto 18px;
    }

    /* Trust badges row */
    .quote-page .trust-row{
      opacity: .55;
      filter: grayscale(1);
      transition: opacity .18s ease, filter .18s ease;
    }
    .quote-page .trust-row:hover{
      opacity: .85;
      filter: grayscale(0);
    }

    @media (max-width: 991px){
      .quote-page .hero-sub{ font-size: 1rem; }
    }
  </style>
</head>

<body class="quote-page">
  <div class="quote-bgmap"></div>

  <!-- Use your standard site header -->
  <?php require __DIR__ . "/partials/header.php"; ?>

  <main class="position-relative" style="z-index:1;">

    <!-- Safety strip under nav (visual parity with template) -->
    <div class="safety-strip-bar"></div>

    <section class="py-5 py-lg-6">
      <div class="container">

        <!-- Title block -->
        <div class="text-center mb-5">
          <span class="hero-kicker">Interactive Portal</span>
          <h1 class="hero-title">
            Smart Quote <span class="grad">Wizard</span>
          </h1>
          <p class="hero-sub">
            Configure your logistics requirements in 4 simple steps.<br class="d-none d-md-block">
            We handle the complexity; you get the precision.
          </p>
        </div>

        <div class="glass-panel">

          <!-- Progress header -->
          <div class="progress-head px-3 px-md-4 py-3 py-md-4">
            <div class="d-flex flex-column flex-md-row align-items-center justify-content-between gap-3">
              <div class="d-flex align-items-start align-items-md-center justify-content-center flex-wrap">

                <div class="step-dot active text-center me-2" data-step="1" role="button" aria-label="Step 1">
                  <div class="num">1</div>
                  <div class="lbl">Need</div>
                </div>
                <div class="step-line"></div>

                <div class="step-dot text-center me-2 opacity-50" data-step="2" role="button" aria-label="Step 2">
                  <div class="num">2</div>
                  <div class="lbl">Route</div>
                </div>
                <div class="step-line"></div>

                <div class="step-dot text-center me-2 opacity-50" data-step="3" role="button" aria-label="Step 3">
                  <div class="num">3</div>
                  <div class="lbl">Details</div>
                </div>
                <div class="step-line"></div>

                <div class="step-dot text-center opacity-50" data-step="4" role="button" aria-label="Step 4">
                  <div class="num">4</div>
                  <div class="lbl">Contact</div>
                </div>

              </div>

              <div class="d-none d-md-flex align-items-center gap-2 px-3 py-2 rounded-3"
                   style="background: rgba(31,153,216,.07); border:1px solid rgba(31,153,216,.12);">
                <i class="fa-solid fa-bolt" style="color: var(--smartOrange);"></i>
                <div class="small fw-bold" style="color: var(--smartDarkBlue);">
                  Step <span id="current-step-num">1</span> of 4
                </div>
              </div>
            </div>
          </div>

          <!-- Progress bar -->
          <div class="progress-track">
            <div id="progress-bar" class="progress-barx"></div>
          </div>

          <!-- FORM -->
          <form id="smart-quote-form" class="p-3 p-md-4 p-lg-5" autocomplete="off" onsubmit="return false;">

            <!-- STEP 1 -->
            <div id="step-1" class="wizard-step active">
              <div class="text-center mb-4 mb-md-5">
                <h2 class="h2 fw-black" style="font-family:Montserrat; font-weight:900;">Your Need</h2>
                <p class="mb-0" style="color: rgba(35,31,32,.60); font-weight:600;">
                  Select the logistics service that fits your requirement.
                </p>
              </div>

              <div class="row g-3 g-lg-4">
                <div class="col-12 col-md-6 col-lg-3">
                  <label class="service-pick d-block position-relative">
                    <input type="radio" name="service" value="air" class="service-radio" checked onchange="updateStep2Logic('air')">
                    <div class="service-card text-center">
                      <div class="iconwrap mx-auto"><i class="fa-solid fa-plane-departure"></i></div>
                      <h3>Air Freight</h3>
                      <p>Time-critical global transport.</p>
                    </div>
                  </label>
                </div>

                <div class="col-12 col-md-6 col-lg-3">
                  <label class="service-pick d-block position-relative">
                    <input type="radio" name="service" value="sea" class="service-radio" onchange="updateStep2Logic('sea')">
                    <div class="service-card text-center">
                      <div class="iconwrap mx-auto"><i class="fa-solid fa-ship"></i></div>
                      <h3>Sea Freight</h3>
                      <p>Cost-effective FCL &amp; LCL.</p>
                    </div>
                  </label>
                </div>

                <div class="col-12 col-md-6 col-lg-3">
                  <label class="service-pick d-block position-relative">
                    <input type="radio" name="service" value="land" class="service-radio" onchange="updateStep2Logic('land')">
                    <div class="service-card text-center">
                      <div class="iconwrap mx-auto"><i class="fa-solid fa-truck-front"></i></div>
                      <h3>Land Freight</h3>
                      <p>Cross-border CEMAC trucking.</p>
                    </div>
                  </label>
                </div>

                <div class="col-12 col-md-6 col-lg-3">
                  <label class="service-pick d-block position-relative">
                    <input type="radio" name="service" value="warehouse" class="service-radio" onchange="updateStep2Logic('warehouse')">
                    <div class="service-card text-center">
                      <div class="iconwrap mx-auto"><i class="fa-solid fa-warehouse"></i></div>
                      <h3>Warehousing</h3>
                      <p>Secure storage &amp; handling.</p>
                    </div>
                  </label>
                </div>
              </div>

              <div class="d-flex justify-content-end mt-4 mt-md-5">
                <button type="button" class="btn-smart-next" onclick="changeStep(2)">
                  Continue <i class="fa-solid fa-arrow-right ms-2"></i>
                </button>
              </div>
            </div>

            <!-- STEP 2 -->
            <div id="step-2" class="wizard-step">

              <!-- SHIPPING HEADER -->
              <div id="header-shipping" class="text-center mb-4 mb-md-5">
                <h2 class="h2 fw-black" style="font-family:Montserrat; font-weight:900;">Your Route</h2>
                <p class="mb-0" style="color: rgba(35,31,32,.60); font-weight:600;">
                  Where is your cargo traveling?
                </p>
              </div>

              <!-- WAREHOUSE HEADER -->
              <div id="header-warehouse" class="text-center mb-4 mb-md-5 d-none">
                <h2 class="h2 fw-black" style="font-family:Montserrat; font-weight:900;">Warehouse Details</h2>
                <p class="mb-0" style="color: rgba(35,31,32,.60); font-weight:600;">
                  Where should we store your cargo, and for how long?
                </p>
              </div>

              <!-- SHIPPING ROUTE -->
              <div id="route-shipping" class="row g-3 g-md-4 justify-content-center">
                <div class="col-12 col-lg-6 position-relative autocomplete-container">
                  <label id="label-origin" class="form-label fw-bold mb-2">Origin City/Port</label>
                  <div class="position-relative">
                    <div class="input-icon"><i class="fa-solid fa-location-dot"></i></div>
                    <input type="text" id="origin-input" class="form-control smart-input input-pad-left"
                           placeholder="e.g. Dubai, UAE">
                  </div>
                </div>

                <div class="col-12 col-lg-6 position-relative autocomplete-container">
                  <label id="label-dest" class="form-label fw-bold mb-2">Destination</label>
                  <div class="position-relative">
                    <div class="input-icon"><i class="fa-solid fa-location-crosshairs"></i></div>
                    <input type="text" id="dest-input" class="form-control smart-input input-pad-left"
                           placeholder="e.g. Bangui, CAR">
                  </div>
                </div>

                <div class="col-12 col-lg-12">
                  <div class="rounded-3 p-3 d-flex gap-3 align-items-start"
                       style="background: rgba(31,153,216,.07); border:1px solid rgba(31,153,216,.12);">
                    <i class="fa-solid fa-circle-info mt-1" style="color: var(--smartBlue);"></i>
                    <div style="font-weight:650; color: rgba(5,91,131,.88); font-size:.88rem; line-height:1.55;">
                      <strong>Smart Autocomplete:</strong> Start typing a city (e.g., "Douala", "Paris", "Kribi", "Shanghai") to see suggestions.
                      <div class="opacity-75 fst-italic mt-1" style="font-weight:600;">*Connects to Google Places API in Production.</div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- WAREHOUSING ROUTE -->
              <div id="route-warehouse" class="row g-3 g-md-4 justify-content-center d-none">
                <div class="col-12 col-lg-6 position-relative autocomplete-container">
                  <label class="form-label fw-bold mb-2">Preferred Location</label>
                  <div class="position-relative">
                    <div class="input-icon"><i class="fa-solid fa-map-pin"></i></div>
                    <input type="text" id="warehouse-loc-input" class="form-control smart-input input-pad-left"
                           placeholder="e.g. Douala Port Zone">
                  </div>
                </div>

                <div class="col-12 col-lg-6">
                  <label class="form-label fw-bold mb-2">Duration Needed</label>
                  <div class="position-relative">
                    <div class="input-icon"><i class="fa-regular fa-calendar"></i></div>
                    <select class="form-select smart-input input-pad-left">
                      <option>Short Term (&lt; 1 Month)</option>
                      <option>Medium Term (1-6 Months)</option>
                      <option>Long Term (&gt; 6 Months)</option>
                      <option>Indefinite / Recurring</option>
                    </select>
                  </div>
                </div>
              </div>

              <div class="d-flex justify-content-between align-items-center mt-4 mt-md-5">
                <a class="btn-back" href="javascript:void(0)" onclick="changeStep(1)"><i class="fa-solid fa-arrow-left me-2"></i>Back</a>
                <button type="button" class="btn-smart-next" onclick="changeStep(3)">
                  Next Step <i class="fa-solid fa-arrow-right ms-2"></i>
                </button>
              </div>
            </div>

            <!-- STEP 3 -->
            <div id="step-3" class="wizard-step">
              <div class="text-center mb-4 mb-md-5">
                <h2 class="h2 fw-black" style="font-family:Montserrat; font-weight:900;">Cargo Details</h2>
                <p class="mb-0" style="color: rgba(35,31,32,.60); font-weight:600;">
                  Tell us about your shipment.
                </p>
              </div>

              <div class="mx-auto" style="max-width: 860px;">

                <!-- Bulk toggle -->
                <div class="toggle-wrap d-flex align-items-center justify-content-between gap-3 mb-4">
                  <div class="d-flex align-items-center gap-3">
                    <div class="rounded-circle d-flex align-items-center justify-content-center"
                         style="width:42px; height:42px; background: rgba(238,125,4,.10); color: var(--smartOrange);">
                      <i class="fa-solid fa-cubes-stacked"></i>
                    </div>
                    <div>
                      <div class="fw-black" style="font-weight:900;">Project Cargo / High Volume?</div>
                      <div class="small" style="color: rgba(35,31,32,.60); font-weight:600;">Select this for Cargo Out of Range or OOG.</div>
                    </div>
                  </div>

                  <label class="d-flex align-items-center gap-2 mb-0" style="cursor:pointer;">
                    <input type="checkbox" id="toggle-bulk" class="visually-hidden" onchange="toggleBulkMode()">
                    <span class="toggle-bg">
                      <span class="toggle-dot"></span>
                    </span>
                  </label>
                </div>

                <!-- Standard mode -->
                <div id="mode-standard">
                  <div class="weight-card mb-4">
                    <div class="d-flex justify-content-between align-items-end mb-3">
                      <label class="text-uppercase" style="font-weight:900; letter-spacing:.10em; font-size:.85rem;">
                        Total Estimated Weight
                      </label>
                      <div class="fw-black" style="font-weight:900; color: var(--smartBlue); font-size: 2.4rem; line-height:1;">
                        <span id="weight-display">500</span>
                        <span style="font-size: 1.05rem; color: rgba(35,31,32,.45); font-weight:700;">Kg</span>
                      </div>
                    </div>
                    <input type="range" min="1" max="30000" value="500" oninput="updateWeight(this.value)">
                    <div class="d-flex justify-content-between mt-2" style="font-size:.78rem; color: rgba(35,31,32,.45); font-weight:900; letter-spacing:.10em; text-transform:uppercase;">
                      <span>1 Kg</span>
                      <span>30,000 Kg+</span>
                    </div>
                  </div>
                </div>

                <!-- Bulk mode -->
                <div id="mode-bulk" class="d-none">
                  <label class="form-label fw-bold mb-2">Project Cargo Description</label>
                  <textarea class="form-control smart-input" rows="5"
                            placeholder="Please describe your shipment: Number of containers, dimensions for Out-of-Gauge (OOG) cargo, special handling requirements, etc."></textarea>
                </div>

                <!-- Upload -->
                <div class="mt-4">
                  <label class="form-label fw-bold mb-2">
                    Upload Documents <span class="text-danger">*</span>
                  </label>

                  <div class="upload-box">
                    <input type="file" name="docs" accept=".pdf,.jpg,.jpeg,.png">
                    <div class="rounded-circle d-flex align-items-center justify-content-center mx-auto mb-2"
                         style="width:56px;height:56px;background:#fff; box-shadow: 0 10px 18px rgba(0,0,0,.06); color: rgba(17,24,39,.35); font-size: 20px;">
                      <i class="fa-solid fa-cloud-arrow-up"></i>
                    </div>
                    <div style="font-weight:900;">Click to upload Commercial Invoice / Packing List</div>
                    <div class="small mt-1" style="color: rgba(35,31,32,.55); font-weight:650;">PDF, JPG, PNG (Max 10MB)</div>
                  </div>
                </div>

              </div>

              <div class="d-flex justify-content-between align-items-center mt-4 mt-md-5" style="max-width: 860px; margin: 0 auto;">
                <a class="btn-back" href="javascript:void(0)" onclick="changeStep(2)"><i class="fa-solid fa-arrow-left me-2"></i>Back</a>
                <button type="button" class="btn-smart-next" onclick="changeStep(4)">
                  Next Step <i class="fa-solid fa-arrow-right ms-2"></i>
                </button>
              </div>
            </div>

            <!-- STEP 4 -->
            <div id="step-4" class="wizard-step">
              <div class="text-center mb-4 mb-md-5">
                <h2 class="h2 fw-black" style="font-family:Montserrat; font-weight:900;">Final Step</h2>
                <p class="mb-0" style="color: rgba(35,31,32,.60); font-weight:600;">
                  Who is receiving the quote?
                </p>
              </div>

              <div class="row g-3 g-md-4 mx-auto" style="max-width: 980px;">
                <div class="col-12 col-md-6">
                  <label class="form-label text-uppercase" style="font-size:.72rem; font-weight:900; letter-spacing:.12em; color: rgba(35,31,32,.45);">Full Name</label>
                  <input type="text" class="form-control smart-input" placeholder="John Doe">
                </div>
                <div class="col-12 col-md-6">
                  <label class="form-label text-uppercase" style="font-size:.72rem; font-weight:900; letter-spacing:.12em; color: rgba(35,31,32,.45);">Email Address</label>
                  <input type="email" class="form-control smart-input" placeholder="john@company.com">
                </div>
                <div class="col-12 col-md-6">
                  <label class="form-label text-uppercase" style="font-size:.72rem; font-weight:900; letter-spacing:.12em; color: rgba(35,31,32,.45);">Phone Number</label>
                  <input type="tel" class="form-control smart-input" placeholder="+237 ...">
                </div>
                <div class="col-12 col-md-6">
                  <label class="form-label text-uppercase" style="font-size:.72rem; font-weight:900; letter-spacing:.12em; color: rgba(35,31,32,.45);">Organization</label>
                  <input type="text" class="form-control smart-input" placeholder="Company Name">
                </div>
                <div class="col-12">
                  <label class="form-label text-uppercase" style="font-size:.72rem; font-weight:900; letter-spacing:.12em; color: rgba(35,31,32,.45);">Notes (Optional)</label>
                  <textarea class="form-control smart-input" rows="4" placeholder="Any specific instructions?"></textarea>
                </div>
              </div>

              <div class="d-flex justify-content-between align-items-center mt-4 mt-md-5 mx-auto" style="max-width: 980px;">
                <a class="btn-back" href="javascript:void(0)" onclick="changeStep(3)"><i class="fa-solid fa-arrow-left me-2"></i>Back</a>
                <button type="button" class="btn-smart-submit" onclick="submitQuote()">
                  SUBMIT REQUEST <i class="fa-solid fa-paper-plane ms-2"></i>
                </button>
              </div>
            </div>

            <!-- SUCCESS -->
            <div id="success-msg" class="d-none text-center py-5">
              <div class="success-badge">
                <i class="fa-solid fa-check text-white" style="font-size: 42px;"></i>
              </div>
              <h2 class="fw-black" style="font-family:Montserrat; font-weight:900; font-size: clamp(2rem, 1.3rem + 1.5vw, 2.6rem);">
                Request Received!
              </h2>

              <div class="mx-auto mt-3 rounded-4 p-4"
                   style="max-width: 520px; background: rgba(31,153,216,.07); border:1px solid rgba(31,153,216,.12);">
                <div style="color: rgba(35,31,32,.72); font-weight:650;">
                  Your Request ID:
                  <span class="ms-1" style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-weight:900; color: var(--smartBlue);">
                    #SLAS-RFQ-001892
                  </span>
                </div>
                <div class="small mt-3 pt-3" style="border-top: 1px solid rgba(31,153,216,.12); color: rgba(35,31,32,.62); font-weight:650; line-height:1.6;">
                  We have sent a confirmation to your email.<br>
                  Your request has been routed to <strong>customerservice@smartls.cm</strong><br>
                  (CC: info@smartls.cm)
                </div>
              </div>

              <button type="button" class="btn btn-link mt-3" style="font-weight:900; color: var(--smartBlue);"
                      onclick="location.reload()">
                Start New Quote
              </button>
            </div>

          </form>
        </div>

        <!-- Trust badges -->
        <div class="trust-row mt-4 d-flex flex-wrap justify-content-center gap-4">
          <div class="d-flex align-items-center gap-2">
            <i class="fa-solid fa-certificate" style="font-size: 1.35rem; color: var(--smartOrange);"></i>
            <span class="small fw-bold" style="letter-spacing:.12em;">ISO 9001:2015</span>
          </div>
          <div class="d-flex align-items-center gap-2">
            <i class="fa-solid fa-globe" style="font-size: 1.35rem; color: var(--smartBlue);"></i>
            <span class="small fw-bold" style="letter-spacing:.12em;">WCA MEMBER</span>
          </div>
          <div class="d-flex align-items-center gap-2">
            <i class="fa-solid fa-shield-halved" style="font-size: 1.35rem; color: var(--smartGreen);"></i>
            <span class="small fw-bold" style="letter-spacing:.12em;">SSL SECURE</span>
          </div>
        </div>

      </div>
    </section>
  </main>

  <!-- Use your standard site footer -->
  <?php require __DIR__ . "/partials/footer.php"; ?>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>

  <script>
    // === STATE ===
    let completedSteps = 1;

    // === STEP 2 LABEL LOGIC ===
    const routeLabels = {
      air: { origin: "Airport of Loading", dest: "Airport of Discharge" },
      sea: { origin: "Port of Loading", dest: "Port of Discharge" },
      land: { origin: "Place of Loading", dest: "Place of Delivery" }
    };

    function updateStep2Logic(service){
      const shipUI = document.getElementById('route-shipping');
      const wareUI = document.getElementById('route-warehouse');
      const headerShipping = document.getElementById('header-shipping');
      const headerWarehouse = document.getElementById('header-warehouse');

      if(service === 'warehouse'){
        shipUI.classList.add('d-none');
        wareUI.classList.remove('d-none');

        headerShipping.classList.add('d-none');
        headerWarehouse.classList.remove('d-none');
      } else {
        wareUI.classList.add('d-none');
        shipUI.classList.remove('d-none');

        headerWarehouse.classList.add('d-none');
        headerShipping.classList.remove('d-none');

        document.getElementById('label-origin').innerText = routeLabels[service].origin;
        document.getElementById('label-dest').innerText = routeLabels[service].dest;
      }
    }

    // === AUTOCOMPLETE (SIMULATED) ===
    const cities = [
      "Douala, Cameroon", "Yaoundé, Cameroon", "Kribi, Cameroon", "Garoua, Cameroon",
      "Bangui, CAR", "N'Djamena, Chad", "Libreville, Gabon", "Brazzaville, Congo",
      "Dubai, UAE", "Paris, France", "Shanghai, China", "Guangzhou, China",
      "Lagos, Nigeria", "Abidjan, Cote d'Ivoire", "Mumbai, India", "Istanbul, Turkey",
      "London, UK", "New York, USA", "Houston, USA", "Antwerp, Belgium"
    ];

    function autocomplete(inp, arr){
      let currentFocus;

      inp.addEventListener("input", function(){
        let a, b, i, val = this.value;
        closeAllLists();
        if(!val) return false;
        currentFocus = -1;

        a = document.createElement("DIV");
        a.setAttribute("id", this.id + "-autocomplete-list");
        a.setAttribute("class", "autocomplete-items");
        this.parentNode.appendChild(a);

        let count = 0;
        for(i=0; i<arr.length; i++){
          if(arr[i].toUpperCase().includes(val.toUpperCase()) && count < 5){
            b = document.createElement("DIV");

            const matchIndex = arr[i].toUpperCase().indexOf(val.toUpperCase());
            b.innerHTML = arr[i].substr(0, matchIndex);
            b.innerHTML += "<strong style='color:var(--smartBlue)'>" + arr[i].substr(matchIndex, val.length) + "</strong>";
            b.innerHTML += arr[i].substr(matchIndex + val.length);
            b.innerHTML += "<input type='hidden' value='" + arr[i].replace(/'/g, "&apos;") + "'>";

            b.addEventListener("click", function(){
              inp.value = this.getElementsByTagName("input")[0].value;
              closeAllLists();
            });

            a.appendChild(b);
            count++;
          }
        }
      });

      inp.addEventListener("keydown", function(e){
        let x = document.getElementById(this.id + "-autocomplete-list");
        if(x) x = x.getElementsByTagName("div");
        if(e.keyCode == 40){ // down
          currentFocus++;
          addActive(x);
        } else if(e.keyCode == 38){ // up
          currentFocus--;
          addActive(x);
        } else if(e.keyCode == 13){ // enter
          e.preventDefault();
          if(currentFocus > -1 && x) x[currentFocus].click();
        }
      });

      function addActive(x){
        if(!x) return false;
        removeActive(x);
        if(currentFocus >= x.length) currentFocus = 0;
        if(currentFocus < 0) currentFocus = (x.length - 1);
        x[currentFocus].classList.add("autocomplete-active");
      }

      function removeActive(x){
        for(let i=0; i<x.length; i++) x[i].classList.remove("autocomplete-active");
      }

      function closeAllLists(elmnt){
        const x = document.getElementsByClassName("autocomplete-items");
        for(let i=0; i<x.length; i++){
          if(elmnt != x[i] && elmnt != inp){
            x[i].parentNode.removeChild(x[i]);
          }
        }
      }

      document.addEventListener("click", function(e){ closeAllLists(e.target); });
    }

    autocomplete(document.getElementById("origin-input"), cities);
    autocomplete(document.getElementById("dest-input"), cities);
    autocomplete(document.getElementById("warehouse-loc-input"), cities);

    // === BULK TOGGLE ===
    function toggleBulkMode(){
      const isBulk = document.getElementById('toggle-bulk').checked;
      const stdMode = document.getElementById('mode-standard');
      const bulkMode = document.getElementById('mode-bulk');

      if(isBulk){
        stdMode.classList.add('d-none');
        bulkMode.classList.remove('d-none');
      } else {
        stdMode.classList.remove('d-none');
        bulkMode.classList.add('d-none');
      }
    }

    // === WIZARD NAVIGATION ===
    function setDots(stepNum){
      const dots = document.querySelectorAll('.step-dot');
      dots.forEach((d, idx)=>{
        const n = idx + 1;
        if(n <= completedSteps){
          d.classList.remove('opacity-50');
          d.classList.add('active');
        } else {
          d.classList.add('opacity-50');
          d.classList.remove('active');
        }
      });
      document.getElementById('current-step-num').innerText = stepNum;
    }

    function changeStep(stepNum){
      if(stepNum > completedSteps) completedSteps = stepNum;

      // hide all
      document.querySelectorAll('.wizard-step').forEach(el=>{
        el.classList.remove('active');
        el.style.display = 'none';
      });

      // show target
      const target = document.getElementById(`step-${stepNum}`);
      target.style.display = 'block';
      setTimeout(()=> target.classList.add('active'), 10);

      // progress bar
      document.getElementById('progress-bar').style.width = `${stepNum * 25}%`;

      // dots
      setDots(stepNum);
    }

    // click dots only if completed
    document.querySelectorAll('.step-dot').forEach(dot=>{
      dot.addEventListener('click', ()=>{
        const s = parseInt(dot.getAttribute('data-step'), 10);
        if(s <= completedSteps) changeStep(s);
      });
    });

    // === WEIGHT ===
    function updateWeight(val){
      document.getElementById('weight-display').innerText = parseInt(val, 10).toLocaleString();
    }

    // === SUBMIT ===
    function submitQuote(){
      document.querySelectorAll('.wizard-step').forEach(el=>{
        el.style.display = 'none';
        el.classList.remove('active');
      });
      document.getElementById('success-msg').classList.remove('d-none');
      document.getElementById('progress-bar').style.width = '100%';
      document.getElementById('progress-bar').style.background = 'var(--smartGreen)';
    }

    // init
    changeStep(1);
    updateStep2Logic('air');
  </script>
</body>
</html>
