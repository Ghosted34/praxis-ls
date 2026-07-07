<?php
  require_once __DIR__ . '/api/config/db.php';
  $pageTitle = "Smart Logistics & Services Ltd | Going beyond your expectations";
  $pageDescription = "We streamline logistics operations for International Organizations and Multinationals through air, land and sea freight forwarding, customs brokerage, representation and warehousing.";
  $pageKeywords = "Smart Logistics, logistics Cameroon, freight forwarding Douala, customs clearance Cameroon, CEMAC logistics, air freight, sea freight, land freight, warehousing, transportation, 3PL";
  $canonicalUrl = "https://smartls.cm/index"; // update to real domain

  // Language from cookie (aligns with app.js)
  $lang = $_COOKIE['slas_lang'] ?? 'en';
  if ($lang !== 'fr' && $lang !== 'en') $lang = 'en';
?>
<!doctype html>
<html lang="<?php echo htmlspecialchars($lang); ?>" id="docRoot">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">

  <title><?php echo htmlspecialchars($pageTitle ?? 'Smart Logistics & Services Ltd'); ?></title>

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
  <meta property="og:image" content="https://smartls.cm/images/og/home-og.jpg">

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="<?php echo htmlspecialchars($pageTitle); ?>">
  <meta name="twitter:description" content="<?php echo htmlspecialchars($pageDescription); ?>">
  <meta name="twitter:image" content="https://smartls.cm/images/og/home-og.jpg">

  <!-- Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@600;700;800&display=swap" rel="stylesheet">

  <!-- Bootstrap -->
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">

  <!-- Icons -->
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" rel="stylesheet">

  <!-- App styles -->
  <link rel="stylesheet" href="css/style.css">
  <link rel="stylesheet" href="css/style.css">
  
  <style>
    /* --- HERO TAGLINE PULSE EFFECT --- */
@keyframes smartPulse {
  0% {
    text-shadow: 0 0 10px rgba(238, 125, 4, 0.2), 0 0 5px rgba(238, 125, 4, 0.1);
    opacity: 0.85;
  }
  50% {
    text-shadow: 0 0 20px rgba(238, 125, 4, 0.6), 0 0 10px rgba(238, 125, 4, 0.4);
    opacity: 1;
  }
  100% {
    text-shadow: 0 0 10px rgba(238, 125, 4, 0.2), 0 0 5px rgba(238, 125, 4, 0.1);
    opacity: 0.85;
  }
}

.hero-tagline-pulse {
  color: #EE7D04;
  font-weight: 600;
  letter-spacing: 0.5px;
  animation: smartPulse 3s infinite ease-in-out;
}
    @keyframes smartPulse {
      0% { text-shadow: 0 0 10px rgba(238, 125, 4, 0.2); opacity: 0.85; }
      50% { text-shadow: 0 0 20px rgba(238, 125, 4, 0.6); opacity: 1; }
      100% { text-shadow: 0 0 10px rgba(238, 125, 4, 0.2); opacity: 0.85; }
    }
    .hero-tagline-pulse {
      color: #EE7D04;
      font-weight: 600;
      letter-spacing: 0.5px;
      animation: smartPulse 3s infinite ease-in-out;
    }
  </style>
</head>
</head>
<body>

<?php
  // Prevent header warning + set active state
  $activePage = 'index.php';
  require __DIR__ . "/partials/header.php";
?>

<section class="hero" id="homeHero">
  <div class="hero-bg-layer"></div>

  <div class="hero-overlay-layer"></div>

  <canvas id="heroCanvas"></canvas>

  <div class="container hero-content text-center">
    <div class="row justify-content-center">
      <div class="col-lg-9">

        <h1 class="display-4 hero-title mb-3 text-white" data-reveal>
          SMART LOGISTICS & SERVICES LTD
        </h1>

        <p class="lead fst-italic mb-3" data-reveal>
  <span class="hero-tagline-pulse" data-i18n="home_hero_tagline">
    Going beyond your expectations...
  </span>
</p>

        <p class="mb-4 text-white-75" data-reveal style="max-width: 760px; color: #fff; margin-inline:auto;">
          <span data-i18n="home_hero_subtext">
            Discover how we optimize supply chain management for International Organizations,
            Multinationals, Local Corporations, and Project Execution in the CEMAC Sub-Region.
          </span>
        </p>

        <div class="track-shell mx-auto" style="max-width: 600px;" data-reveal>
          <form class="row g-0" onsubmit="return smartQuickTrack(event)">
            <div class="col">
              <input id="heroTrackRef"
                     type="text"
                     class="form-control track-input"
                     data-i18n-placeholder="home_track_placeholder"
                     placeholder="Enter file reference here">
              
              <div id="heroTrackError" class="small fw-bold text-warning text-start mt-1 ps-1" style="display:none;"></div>
            </div>

            <div class="col-auto">
              <button class="btn btn-smart px-4 py-3" type="submit" aria-label="Track shipment">
                <i class="fa-solid fa-crosshairs" aria-hidden="true"></i>
                <span data-i18n="home_track_btn">TRACK</span>
              </button>
            </div>
          </form>
        </div>

      </div>
    </div>
  </div>
</section>

<section class="marquee py-3 section-bg section-bg--surface">
  <div class="container overflow-hidden">
    <div class="d-flex justify-content-between align-items-center mb-2">
      <div class="small text-uppercase fw-bold" style="letter-spacing:.18em; color: rgba(35,31,32,.55); font-size: 1.2rem;">
        <span data-i18n="home_trust_title">Trusted by Global Leaders</span>
      </div>
      <div class="small fw-bold" style="color: rgba(35,31,32,.55);">
      </div>
    </div>

    <div class="marquee-track">
      <!-- Logos (do not translate brand names) -->
      <div class="marquee-item"><img src="assets/logos-webp/unfpa.webp" alt="UNFPA" loading="lazy" width="100" height="40"></div>
      
      <div class="marquee-item"><img src="assets/logos-webp/minusca.webp" alt="MINUSCA United Nations Mission" loading="lazy" width="120" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/magil.webp" alt="MAGIL Construction" loading="lazy" width="110" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/lt.svg" alt="Larsen &amp; Toubro" loading="lazy" width="110" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/tatalogo.svg" alt="Tata" loading="lazy" width="110" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/giz.webp" alt="GIZ Deutsche Gesellschaft für Internationale Zusammenarbeit" loading="lazy" width="80" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/fma.webp" alt="FMA Services Construction International" loading="lazy" width="110" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/profab.webp" alt="Prometer Group" loading="lazy" width="100" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/prometal.webp" alt="Prometal" loading="lazy" width="100" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/horizon.webp" alt="Horizon" loading="lazy" width="110" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/wfp.webp" alt="World Food Programme" loading="lazy" width="90" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/fmlogistic.webp" alt="FM Logistics" loading="lazy" width="90" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/msc.webp" alt="MSC Mediterranean Shipping Company" loading="lazy" width="110" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/sgs.webp" alt="SGS Inspection Services" loading="lazy" width="80" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/pad.webp" alt="Port Autonome de Douala" loading="lazy" width="100" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/maersk.webp" alt="Maersk" loading="lazy" width="120" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/cma-cgm.webp" alt="CMA CGM Group" loading="lazy" width="120" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/hapag-lloyd.webp" alt="Hapag-Lloyd" loading="lazy" width="130" height="40"></div>
      <div class="marquee-item"><img src="assets/logos/clinton.webp" alt="Clinton Health Access Initiative (CHAI)" loading="lazy" width="120" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/cimencan.webp" alt="CIMENCAM" loading="lazy" width="110" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/dhl.webp" alt="DHL Global Forwarding" loading="lazy" width="90" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/sigma.webp" alt="Sigma" loading="lazy" width="100" height="40"></div>

      <!-- Duplicate set for infinite scroll -->
      <div class="marquee-item"><img src="assets/logos-webp/unfpa.webp" alt="UNFPA" loading="lazy" width="100" height="40"></div>
      
      <div class="marquee-item"><img src="assets/logos-webp/minusca.webp" alt="MINUSCA United Nations Mission" loading="lazy" width="120" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/hapag-lloyd.webp" alt="Hapag-Lloyd" loading="lazy" width="130" height="40"></div>
      <div class="marquee-item"><img src="assets/logos/clinton.webp" alt="Clinton Health Access Initiative (CHAI)" loading="lazy" width="120" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/magil.webp" alt="MAGIL Construction" loading="lazy" width="110" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/lt.svg" alt="Larsen &amp; Toubro" loading="lazy" width="110" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/tatalogo.svg" alt="Tata" loading="lazy" width="110" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/giz.webp" alt="GIZ Deutsche Gesellschaft für Internationale Zusammenarbeit" loading="lazy" width="80" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/fma.webp" alt="FMA Services Construction International" loading="lazy" width="110" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/horizon.webp" alt="Horizon" loading="lazy" width="110" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/wfp.webp" alt="World Food Programme" loading="lazy" width="90" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/fmlogistics.webp" alt="FM Logistics" loading="lazy" width="90" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/msc.webp" alt="MSC Mediterranean Shipping Company" loading="lazy" width="110" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/fmlogistic.webp" alt="FM Logistic" loading="lazy" width="100" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/sgs.webp" alt="SGS Inspection Services" loading="lazy" width="80" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/pad.webp" alt="Port Autonome de Douala" loading="lazy" width="100" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/maersk.webp" alt="Maersk" loading="lazy" width="120" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/cma-cgm.webp" alt="CMA CGM Group" loading="lazy" width="120" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/hapag-lloyd.webp" alt="Hapag-Lloyd" loading="lazy" width="130" height="40"></div>
      <div class="marquee-item"><img src="assets/logos/clinton.webp" alt="Clinton Health Access Initiative (CHAI)" loading="lazy" width="120" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/cimencan.webp" alt="CIMENCAM" loading="lazy" width="110" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/dhl.webp" alt="DHL Global Forwarding" loading="lazy" width="90" height="40"></div>
      <div class="marquee-item"><img src="assets/logos-webp/sigma.webp" alt="Sigma" loading="lazy" width="100" height="40"></div>
    </div>
  </div>
</section>

<section class="section section-bg section-bg--wash" id="services">
  <div class="container">
    <div class="row g-4 align-items-center">
      <div class="col-lg-6">
        <h2 class="section-title mb-3" data-reveal data-i18n="home_services_title">Unlock Efficient Logistics Solutions</h2>
        <p class="section-sub" data-reveal data-i18n="home_services_sub">
          SMART LOGISTICS &amp; SERVICES LTD is a leading logistics and supply chain management company based in Douala, Cameroon,
          serving the entire CEMAC region. We streamline logistics operations for International Organizations and Multinationals
          through air, land and sea freight forwarding, customs brokerage, representation and warehousing.
        </p>

        <div class="row g-3 mt-3">
          <div class="col-12" data-reveal>
            <div class="card-premium p-4">
              <div class="d-flex gap-3">
                <div class="rounded-3 d-flex align-items-center justify-content-center" style="width:44px;height:44px;background:rgba(31,153,216,.10);">
                  <i class="fa-solid fa-plane-departure" style="color:var(--smart-blue-2)"></i>
                </div>
                <div>
                  <div class="fw-bold" data-i18n="home_services_feature_1_title">Multimodal expertise</div>
                  <div class="small" style="color: rgba(35,31,32,.70);" data-i18n="home_services_feature_1_sub">Air, Land, Sea freight forwarding with operational excellence.</div>
                </div>
              </div>
            </div>
          </div>

          <div class="col-12" data-reveal>
            <div class="card-premium p-4">
              <div class="d-flex gap-3">
                <div class="rounded-3 d-flex align-items-center justify-content-center" style="width:44px;height:44px;background:rgba(238,125,4,.12);">
                  <i class="fa-solid fa-user-shield" style="color:var(--smart-orange)"></i>
                </div>
                <div>
                  <div class="fw-bold" data-i18n="home_services_feature_2_title">Compliance-led execution</div>
                  <div class="small" style="color: rgba(35,31,32,.70);" data-i18n="home_services_feature_2_sub">Reliable documentation, brokerage procedures, and visibility.</div>
                </div>
              </div>
            </div>
          </div>

          <div class="col-12" data-reveal>
            <div class="card-premium p-4">
              <div class="d-flex gap-3">
                <div class="rounded-3 d-flex align-items-center justify-content-center" style="width:44px;height:44px;background:rgba(46,204,113,.14);">
                  <i class="fa-solid fa-route" style="color:var(--eco-green)"></i>
                </div>
                <div>
                  <div class="fw-bold" data-i18n="home_services_feature_3_title">Project logistics at scale</div>
                  <div class="small" style="color: rgba(35,31,32,.70);" data-i18n="home_services_feature_3_sub">Tailored solutions across Health, Construction, Manufacturing and Humanitarian projects.</div>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>

      <div class="col-lg-6">
        <div class="row g-3">
          <div class="col-12" data-reveal>
            <div class="card-premium p-4 h-100" style="background: linear-gradient(135deg, rgba(5,91,131,.94), rgba(31,153,216,.66)); color:#fff;">
              <div class="d-flex align-items-start justify-content-between">
                <div>
                  <div class="fw-bold" style="opacity:.92;" data-i18n="home_stat_cbm_title">CBM Managed</div>
                  <div class="display-6 fw-bold mt-1 mb-1">
                    <span data-counter="41850">0</span><span class="ms-1">+</span>
                  </div>
                  <div class="small" style="opacity:.86;" data-i18n="home_stat_cbm_sub">For Internationally Funded Projects</div>
                </div>
                <i class="fa-solid fa-cubes fa-lg" style="color: rgba(255,255,255,.85)"></i>
              </div>
            </div>
          </div>

          <div class="col-12" data-reveal>
            <div class="card-premium p-4 h-100" style="background: linear-gradient(135deg, rgba(5,91,131,.94), rgba(31,153,216,.66)); color:#fff;">
              <div class="d-flex align-items-start justify-content-between">
                <div>
                  <div class="fw-bold" style="opacity:.92;" data-i18n="home_stat_clearance_title">Clearance Time</div>
                  <div class="display-6 fw-bold mt-1 mb-1">
                    <span data-counter="72">0</span><span class="ms-1" data-i18n="home_stat_clearance_unit">Hours</span>
                  </div>
                  <div class="small" style="opacity:.86;" data-i18n="home_stat_clearance_sub">Average customs clearance</div>
                </div>
                <i class="fa-solid fa-stopwatch fa-lg" style="color: rgba(255,255,255,.85)"></i>
              </div>
            </div>
          </div>

          <div class="col-12" data-reveal>
            <div class="card-premium p-4 h-100" style="background: linear-gradient(135deg, rgba(5,91,131,.94), rgba(31,153,216,.66)); color:#fff;">
              <div class="d-flex align-items-start justify-content-between">
                <div>
                  <div class="fw-bold" style="opacity:.92;" data-i18n="home_stat_perf_title">Operational performance across the CEMAC region.</div>
                  <div class="display-6 fw-bold mt-1 mb-1">
                    <span data-counter="123433">0</span>+
                  </div>
                  <div class="small" style="opacity:.86;" data-i18n="home_stat_perf_sub">Miles covered in land freight in 2025</div>
                </div>
                <i class="fa-solid fa-tachometer-alt fa-lg" style="color: rgba(255,255,255,.85)"></i>
              </div>
            </div>
          </div>

        </div>
      </div>

    </div>
  </div>
</section>

<section class="section section-bg section-bg--fixed" id="industries"
  style="--fixed-bg:url('../assets/img-webp/industries.webp');">

  <div class="container">
    <div class="d-flex flex-wrap align-items-end justify-content-between gap-2 mb-4">
      <div>
        <h2 class="section-title mb-1" data-reveal data-i18n="home_industries_title">Some Industries We Serve</h2>
        <div class="section-sub" data-reveal data-i18n="home_industries_sub">High-impact logistics across critical sectors</div>
      </div>
      <a class="btn btn-smart" href="index#contact_entry" data-reveal data-i18n="home_industries_cta">Talk to an Expert</a>
    </div>

    <div class="row g-3">
      <div class="col-12 col-md-6 col-lg-3" data-reveal>
        <div class="card-premium p-4 h-100">
          <i class="fa-solid fa-oil-well fa-xl" style="color:var(--smart-orange)"></i>
          <div class="mt-3 fw-bold" data-i18n="home_industry_1_title">Oil &amp; Gas / Energy</div>
          <div class="small" style="color: rgba(35,31,32,.70);" data-i18n="home_industry_1_sub">Handling complex, out-of-gauge cargo for upstream and downstream projects with strict HSE compliance.</div>
        </div>
      </div>

      <div class="col-12 col-md-6 col-lg-3" data-reveal>
        <div class="card-premium p-4 h-100">
          <i class="fa-solid fa-hand-holding-heart fa-xl" style="color:var(--smart-orange)"></i>
          <div class="mt-3 fw-bold" data-i18n="home_industry_2_title">Humanitarian &amp; Aid</div>
          <div class="small" style="color: rgba(35,31,32,.70);" data-i18n="home_industry_2_sub">Rapid deployment logistics for NGOs and UN agencies ensuring life-saving supplies reach the last mile in time.</div>
        </div>
      </div>

      <div class="col-12 col-md-6 col-lg-3" data-reveal>
        <div class="card-premium p-4 h-100">
          <i class="fa-solid fa-trowel-bricks fa-xl" style="color:var(--smart-orange)"></i>
          <div class="mt-3 fw-bold" data-i18n="home_industry_3_title">Construction &amp; Infrastructure</div>
          <div class="small" style="color: rgba(35,31,32,.70);" data-i18n="home_industry_3_sub">End-to-end project cargo management for heavy machinery and materials, supporting major infrastructure developments.</div>
        </div>
      </div>

      <div class="col-12 col-md-6 col-lg-3" data-reveal>
        <div class="card-premium p-4 h-100">
          <i class="fa-solid fa-pills fa-xl" style="color:var(--smart-orange)"></i>
          <div class="mt-3 fw-bold" data-i18n="home_industry_4_title">Healthcare &amp; Pharma</div>
          <div class="small" style="color: rgba(35,31,32,.70);" data-i18n="home_industry_4_sub">Temperature-controlled supply chains for sensitive pharmaceuticals, ensuring integrity from port to patient/warehouse.</div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- SERVICES -->
<section class="section section-bg section-bg--surface" id="service-pillars">
  <div class="container">
    <div class="d-flex flex-wrap align-items-end justify-content-between gap-2 mb-4">
      <div>
        <h2 class="section-title mb-1" data-reveal data-i18n="home_pillars_title">Services</h2>
        <p class="section-sub mb-0" data-reveal data-i18n="home_pillars_sub">
          Three service pillars engineered for speed, compliance, and dependable execution across the CEMAC region
        </p>
      </div>
      <a class="btn btn-smart" href="services" data-reveal data-i18n="home_pillars_cta">Explore Services</a>
    </div>

    <div class="row g-3">
      <!-- Freight Solutions -->
      <div class="col-12 col-lg-4" data-reveal>
        <a href="services#section-a" class="service-link">
          <div class="service-card p-4 h-100" style="--service-bg:url('../assets/img-webp/services-freight-forwarding.webp');">
            <div class="d-flex align-items-center justify-content-between mb-3">
              <div class="service-logo" style="background: rgba(238,125,4,.12); border-color: rgba(238,125,4,.20);">
                <i class="fa-solid fa-plane-departure" style="color: var(--smart-orange);"></i>
              </div>
              <span class="badge rounded-pill text-bg-light border px-3 py-2 fw-bold" data-i18n="home_pillar_1_badge">
                Freight Solutions
              </span>
            </div>

            <p class="mb-0" data-i18n="home_pillar_1_body">
              Efficient air, land, and sea freight forwarding for time-sensitive cargo, supported by multimodal coordination,
              flexible container options (FCL/LCL, RF/DC), and visibility through real-time tracking.
            </p>
          </div>
        </a>
      </div>

      <!-- Logistics Solutions -->
      <div class="col-12 col-lg-4" data-reveal>
        <a href="services#section-b" class="service-link">
          <div class="service-card p-4 h-100" style="--service-bg:url('../assets/img-webp/services-logistics-solutions-business-representation.webp');">
            <div class="d-flex align-items-center justify-content-between mb-3">
              <div class="service-logo" style="background: rgba(238,125,4,.12); border-color: rgba(238,125,4,.20);">
                <i class="fa-solid fa-clipboard-check" style="color: var(--smart-orange);"></i>
              </div>
              <span class="badge rounded-pill text-bg-light border px-3 py-2 fw-bold" data-i18n="home_pillar_2_badge">
                Logistics Solutions
              </span>
            </div>

            <p class="mb-0" data-i18n="home_pillar_2_body">
              Compliance-led logistics services including customs brokerage, import/export operations, and business representation—
              structured to reduce delays, control cost, and ensure correct documentation and regulatory alignment.
            </p>
          </div>
        </a>
      </div>

      <!-- Value-Added Solutions -->
      <div class="col-12 col-lg-4" data-reveal>
        <a href="services#section-c" class="service-link">
          <div class="service-card p-4 h-100" style="--service-bg:url('../assets/img-webp/services-logistics-solutions-customs-brokerage.webp');">
            <div class="d-flex align-items-center justify-content-between mb-3">
              <div class="service-logo" style="background: rgba(46,204,113,.14); border-color: rgba(46,204,113,.22);">
                <i class="fa-solid fa-warehouse" style="color: var(--eco-green);"></i>
              </div>
              <span class="badge rounded-pill text-bg-light border px-3 py-2 fw-bold" data-i18n="home_pillar_3_badge">
                Value-Added Solutions
              </span>
            </div>

            <p class="mb-0" data-i18n="home_pillar_3_body">
              Reliable transportation for project cargo and sensitive goods, plus secure warehousing with flexible storage and
              WMS-enabled inventory visibility—built for last-mile performance and controlled handling.
            </p>
          </div>
        </a>
      </div>

    </div>
  </div>
</section>

<!-- TESTIMONIALS -->
<section class="section testimonials-pro" id="testimonials">
  <div class="container">
    <div class="text-center mb-4">
      <h2 class="section-title mb-2" data-reveal data-i18n="home_testimonials_title">What they say about us</h2>
    </div>

    <div class="testimonials-pro__wrap mx-auto" data-reveal>
      <div id="testimonialsProCarousel" class="carousel slide"
           data-bs-ride="carousel" data-bs-interval="7000" data-bs-touch="true" data-bs-pause="false">

        <div class="carousel-inner">

          <div class="carousel-item active">
            <article class="testimonials-pro__card">
              <header class="testimonials-pro__top">
                <div class="testimonials-pro__left">
                  <div class="testimonials-pro__avatar" aria-hidden="true">SM</div>
                  <div class="min-w-0">
                    <div class="testimonials-pro__name">Smith A. MENGOT</div>
                    <div class="testimonials-pro__role">
                      Executive Logistics - Cameroon Ops, L&amp;T Power Transmission and Distribution
                    </div>
                  </div>
                </div>
              </header>

              <p class="testimonials-pro__quote" data-i18n="home_testimonial_1_quote">
                “SMART LOGISTICS AND SERVICES LTD. has been an invaluable partner. Their expertise in customs clearance and transportation has saved us millions of FCFA. Their professionalism is unmatched.”
              </p>
            </article>
          </div>

          <div class="carousel-item">
            <article class="testimonials-pro__card">
              <header class="testimonials-pro__top">
                <div class="testimonials-pro__left">
                  <div class="testimonials-pro__avatar" aria-hidden="true">CE</div>
                  <div class="min-w-0">
                    <div class="testimonials-pro__name">Dr. Christian Ewane</div>
                    <div class="testimonials-pro__role">
                      Supply Chain &amp; Logistics Analyst, UNFPA
                    </div>
                  </div>
                </div>
              </header>

              <p class="testimonials-pro__quote" data-i18n="home_testimonial_2_quote">
                “We entrusted SMART LOGISTICS with our sensitive pharmaceutical shipments. Their real-time tracking and monitoring ensured seamless delivery, and their customer service was top-notch.”
              </p>
            </article>
          </div>

          <div class="carousel-item">
            <article class="testimonials-pro__card">
              <header class="testimonials-pro__top">
                <div class="testimonials-pro__left">
                  <div class="testimonials-pro__avatar" aria-hidden="true">SY</div>
                  <div class="min-w-0">
                    <div class="testimonials-pro__name">Serge Yannick SOUTHY</div>
                    <div class="testimonials-pro__role">
                      Logistics Manager, FMA SERVICES CONSTRUCTIONS INTERNATIONAL
                    </div>
                  </div>
                </div>
              </header>

              <p class="testimonials-pro__quote" data-i18n="home_testimonial_3_quote">
                “SMART LOGISTICS exceeded our expectations in re-exporting heavy equipment from Cameroon to Ivory Coast. Their expertise saved us valuable time.”
              </p>
            </article>
          </div>

        </div>

        <button class="carousel-control-prev testimonials-pro__control" type="button"
                data-bs-target="#testimonialsProCarousel" data-bs-slide="prev" aria-label="Previous testimonial">
          <span class="testimonials-pro__control-btn" aria-hidden="true">
            <i class="fa-solid fa-chevron-left"></i>
          </span>
        </button>

        <button class="carousel-control-next testimonials-pro__control" type="button"
                data-bs-target="#testimonialsProCarousel" data-bs-slide="next" aria-label="Next testimonial">
          <span class="testimonials-pro__control-btn" aria-hidden="true">
            <i class="fa-solid fa-chevron-right"></i>
          </span>
        </button>

        <div class="carousel-indicators testimonials-pro__dots">
          <button type="button" data-bs-target="#testimonialsProCarousel" data-bs-slide-to="0" class="active" aria-current="true"></button>
          <button type="button" data-bs-target="#testimonialsProCarousel" data-bs-slide-to="1"></button>
          <button type="button" data-bs-target="#testimonialsProCarousel" data-bs-slide-to="2"></button>
        </div>

      </div>
    </div>
  </div>
</section>

<!-- PARTNER WITH US -->
<section class="section partner-with-us" id="partner">
  <div class="container">
    <div class="row g-4 align-items-stretch">

      <div class="col-lg-5" data-reveal>
        <div class="partner-with-us__intro card-premium p-4 p-lg-5 h-100">
          <div class="partner-with-us__kicker">
            <i class="fa-solid fa-globe"></i>
            <span data-i18n="home_partner_kicker">PARTNER WITH US</span>
          </div>

          <h2 class="section-title mb-2" data-i18n="home_partner_title">Join Us!</h2>

          <p class="partner-with-us__sub mb-4" data-i18n="home_partner_sub">
            SMART LOGISTICS &amp; SERVICES LTD Ltd is always looking to expand its network of trusted agents and partners. If you are a freight forwarder, NVOCC, or logistics provider looking for a reliable partner in the CEMAC region, connect with us.
          </p>

          <div class="partner-with-us__points">
            <div class="partner-with-us__point">
              <span class="dot"></span>
              <div class="txt" data-i18n="home_partner_point_1">CEMAC-region execution with compliance discipline</div>
            </div>
            <div class="partner-with-us__point">
              <span class="dot"></span>
              <div class="txt" data-i18n="home_partner_point_2">Partner onboarding designed for clarity and speed</div>
            </div>
            <div class="partner-with-us__point">
              <span class="dot"></span>
              <div class="txt" data-i18n="home_partner_point_3">Trusted network alignment (WCA • FIATA • JC Trans)</div>
            </div>
          </div>

          
        </div>
      </div>

      <div class="col-lg-7" data-reveal>
        <div class="partner-with-us__form card-premium p-4 p-lg-5 h-100">

          <div class="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
            <h3 class="h5 mb-0" style="font-weight:900;" data-i18n="home_partner_form_title">Portal Form Fields</h3>
            <span class="partner-with-us__badge">
              <i class="fa-solid fa-circle-check me-2"></i> <span data-i18n="home_partner_form_badge">Partnership Intake</span>
            </span>
          </div>

            <form id="partnerForm" class="partner-with-us__grid" enctype="multipart/form-data" onsubmit="return false;">
              <div class="row g-3">

                <div class="col-12 col-md-6">
                  <label class="form-label fw-bold">Company Name</label>
                  <input
                    type="text"
                    class="form-control partner-with-us__control"
                    name="company_name"
                    required
                    placeholder="Company name">
                </div>

                <div class="col-12 col-md-6">
                  <label class="form-label fw-bold">Country of Origin</label>
                  <input
                    type="text"
                    class="form-control partner-with-us__control"
                    name="country_of_origin"
                    required
                    placeholder="Country">
                </div>

                <div class="col-12">
                  <label class="form-label fw-bold">Network Memberships (WCA, FIATA, JC Trans)</label>
                  <input
                    type="text"
                    class="form-control partner-with-us__control"
                    name="network_memberships"
                    placeholder="e.g., WCA, FIATA">
                </div>

                <div class="col-12 col-md-6">
                  <label class="form-label fw-bold">Contact Person</label>
                  <input
                    type="text"
                    class="form-control partner-with-us__control"
                    name="contact_person"
                    required
                    placeholder="Full name">
                </div>

                <div class="col-12 col-md-6">
                  <label class="form-label fw-bold">Contact Title</label>
                  <input
                    type="text"
                    class="form-control partner-with-us__control"
                    name="contact_title"
                    required
                    placeholder="Title (e.g., Operations Manager)">
                </div>

                <div class="col-12 col-md-6">
                  <label class="form-label fw-bold">Contact Email</label>
                  <input
                    type="email"
                    class="form-control partner-with-us__control"
                    name="contact_email"
                    required
                    placeholder="name@company.com">
                </div>

                <div class="col-12 col-md-6">
                  <label class="form-label fw-bold">Proposal Type</label>
                  <select class="form-select partner-with-us__control" name="proposal_type" required>
                    <option value="AGENCY_PARTNERSHIP" selected>Agency Partnership</option>
                    <option value="VENDOR_REGISTRATION">Vendor Registration</option>
                  </select>
                </div>

                <div class="col-12">
                  <label class="form-label fw-bold">Upload Corporate Profile (PDF) if applicable</label>
                  <div class="partner-with-us__upload">
                    <input type="file" class="form-control partner-with-us__control" name="corporate_profile" accept="application/pdf">
                    <div class="partner-with-us__upload-hint">PDF only. Keep file size reasonable.</div>
                  </div>
                </div>

                <div class="col-12 d-flex flex-wrap gap-2 pt-2">
                  <button id="partnerSubmiBtn" class="btn btn-smart px-4" type="submit">
                    <i class="fa-solid fa-paper-plane me-2"></i> Submit
                  </button>
                </div>

              </div>
            </form>


        </div>
      </div>

    </div>
  </div>
</section>

<!-- CONTACT -->
<section class="section section-bg section-bg--surface" id="contact">
  <div class="container">
    <div class="d-flex flex-wrap align-items-end justify-content-between gap-2 mb-4">
      <div>
        <h2 class="section-title mb-1" data-reveal data-i18n="home_contact_title">Contact</h2>
        <div class="section-sub mb-0" data-reveal data-i18n="home_contact_sub">Speak with our operations team</div>
      </div>
      <div class="d-flex gap-2" data-reveal>
        <a class="btn btn-smart-outline" href="mailto:info@smartls.cm">
          <i class="fa-solid fa-envelope me-2"></i><span data-i18n="home_contact_btn_email">Email</span>
        </a>
        <a class="btn btn-smart" href="tel:+237696122511">
          <i class="fa-solid fa-phone me-2"></i><span data-i18n="home_contact_btn_call">Call</span>
        </a>
      </div>
    </div>

    <div class="row g-4 align-items-stretch">
      <div class="col-lg-5" data-reveal>
        <div class="card-premium p-4 h-100 contact-card">
          <div class="fw-bold mb-3" data-i18n="home_contact_form_title">Send a message</div>

          <form id="contactForm" onsubmit="return false;">
  <div class="row g-3">

    <div class="col-12">
      <label class="form-label small fw-bold mb-1">Full Name</label>
      <input type="text" name="full_name" class="form-control" required id="contact_entry">
    </div>

    <div class="col-12">
      <label class="form-label small fw-bold mb-1">Email</label>
      <input type="email" name="email" class="form-control" required>
    </div>

    <div class="col-12">
      <label class="form-label small fw-bold mb-1">Phone (optional)</label>
      <input type="tel" name="phone" class="form-control">
    </div>

    <div class="col-12">
      <label class="form-label small fw-bold mb-1">Message</label>
      <textarea name="message" class="form-control" rows="4" required></textarea>
    </div>

    <div class="col-12 pt-1">
      <button class="btn btn-smart w-100" type="submit">
        <i class="fa-solid fa-paper-plane me-2"></i>Send
      </button>
    </div>

    <div class="col-12">
      <div id="contactFeedback" class="small"></div>
    </div>

  </div>
</form>

        </div>
      </div>

      <div class="col-lg-7" data-reveal>
        <div class="card-premium p-4 h-100 contact-card">
          <div class="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
            <div>
              <div class="fw-bold mb-1" data-i18n="home_contact_office_title">Head Office</div>
              <div class="small text-muted" data-i18n="home_contact_office_sub">B.P. 5120, Douala, Cameroon</div>
            </div>
            <a class="btn btn-smart btn-sm"
               href="https://www.google.com/maps?q=Smart%20Logistics%20%26%20Services%20LTD%20Douala%20Cameroon"
               target="_blank" rel="noopener">
              <i class="fa-solid fa-location-crosshairs me-2"></i><span data-i18n="home_contact_open_maps">Open in Maps</span>
            </a>
          </div>

          <div class="row g-3 mb-3">
            <div class="col-12 col-md-6">
              <div class="contact-item">
                <i class="fa-solid fa-location-dot"></i>
                <div>
                  <div class="small text-muted" data-i18n="home_contact_address_label">Address</div>
                  <div class="fw-semibold" data-i18n="home_contact_address_value">1030, Avenue Douala Manga Bell, Douala, Cameroon</div>
                </div>
              </div>
            </div>

            <div class="col-12 col-md-6">
              <div class="contact-item">
                <i class="fa-solid fa-phone"></i>
                <div>
                  <div class="small text-muted" data-i18n="home_contact_phone_value_label">Phone</div>
                  <a class="fw-semibold" href="tel:+237233420281" style="color:inherit; text-decoration:none;">+237 233 420 281</a>
                </div>
              </div>
            </div>

            <div class="col-12 col-md-6">
              <div class="contact-item">
                <i class="fa-brands fa-whatsapp"></i>
                <div>
                  <div class="small text-muted" data-i18n="home_contact_whatsapp_label">WhatsApp</div>
                  <a class="fw-semibold" href="https://wa.me/237696122511" target="_blank" rel="noopener" style="color:inherit; text-decoration:none;">+237 696 122 511</a>
                </div>
              </div>
            </div>

            <div class="col-12 col-md-6">
              <div class="contact-item">
                <i class="fa-solid fa-envelope"></i>
                <div>
                  <div class="small text-muted" data-i18n="home_contact_email_value_label">Email</div>
                  <a class="fw-semibold" href="mailto:info@smartls.cm" style="color:inherit; text-decoration:none;">info@smartls.cm</a>
                </div>
              </div>
            </div>
          </div>

          <div class="contact-map">
            <iframe
              src="https://www.google.com/maps?q=Smart%20Logistics%20%26%20Services%20LTD%20Douala%20Cameroon&output=embed"
              style="border:0; width:100%; height: 320px;"
              loading="lazy"
              referrerpolicy="no-referrer-when-downgrade"
              aria-label="Smart Logistics &amp; Services Ltd location map"></iframe>
          </div>
        </div>
      </div>

    </div>
  </div>
</section>

<?php require __DIR__ . "/partials/footer.php"; ?>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
<script src="js/app.js"></script>
<script>
function smartQuickTrack(e){
  e.preventDefault();

  const refInput = document.getElementById("heroTrackRef");
  const errorDiv = document.getElementById("heroTrackError");
  const ref = refInput.value.trim();
  
  // 1. Reset Error State
  errorDiv.style.display = 'none';
  errorDiv.innerText = "";
  refInput.style.border = ""; // Reset border style if previously red

  // 2. Check for Empty or Invalid Entry
  if (!ref) {
    // Show error message
    errorDiv.innerText = "Please enter a file reference."; // You can change this text
    errorDiv.style.display = 'block';
    
    // Optional: Make the border red for visibility
    refInput.style.border = "2px solid #ffc107"; 
    return false;
  }

  // 3. Go straight to smart-track
  window.location.href = "smart-track?ref=" + encodeURIComponent(ref);
  return false;
}
</script>

<script>
document.getElementById('partnerForm').addEventListener('submit', async function (e) {
  e.preventDefault();
const endpoint = 'api/partner/submit_partnership.php'; // or your computed URL
console.log('FETCH URL →', new URL(endpoint, window.location.href).href);

  const form = e.target;
  const submitBtn = document.getElementById('partnerSubmiBtn');
  submitBtn.disabled = true;

  const formData = new FormData(form);

  try {
    const res = await fetch('api/partner/submit_partnership.php', {
      method: 'POST',
      body: formData
    });

    const raw = await res.text(); // read as text first (handles HTML/PHP warnings)

    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {
      console.error('Non-JSON response:', raw);
      throw new Error(`Server returned non-JSON response (HTTP ${res.status}). Check console.`);
    }

    if (!res.ok || !data.ok) {
      console.error('Server JSON error:', data);
      throw new Error(data.error || `Request failed (HTTP ${res.status})`);
    }

    alert('Partnership request submitted successfully.');
    form.reset();

  } catch (err) {
    console.error(err);
    alert(err.message || 'Error submitting partnership request. Please try again.');
  } finally {
    submitBtn.disabled = false;
  }
});
</script>
<script>
(() => {
  const form = document.getElementById('contactForm');
  const feedback = document.getElementById('contactFeedback');

  function showAlert(message, type = 'success', autoHideMs = 0) {
    // type: 'success' | 'danger' | 'warning' | 'info'
    feedback.classList.remove('d-none', 'alert-success', 'alert-danger', 'alert-warning', 'alert-info');
    feedback.classList.add(`alert-${type}`);

    // Optional close button (partnership-portal style)
    feedback.innerHTML = `
      <div class="d-flex align-items-start justify-content-between gap-3">
        <div>${escapeHtml(message)}</div>
        <button type="button" class="btn-close" aria-label="Close"></button>
      </div>
    `;

    feedback.querySelector('.btn-close').addEventListener('click', () => hideAlert(), { once: true });

    // Ensure user sees it (especially on mobile)
    feedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    if (autoHideMs > 0) {
      window.clearTimeout(showAlert._t);
      showAlert._t = window.setTimeout(() => hideAlert(), autoHideMs);
    }
  }

  function hideAlert() {
    feedback.classList.add('d-none');
    feedback.classList.remove('alert-success', 'alert-danger', 'alert-warning', 'alert-info');
    feedback.innerHTML = '';
  }

  // Basic HTML escaping to prevent injection in UI
  function escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert();

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      // Keep your correct base path
      const endpoint = `${location.origin}/api/contact/submit_contact.php`;

      const res = await fetch(endpoint, {
        method: 'POST',
        body: new FormData(form)
      });

      const raw = await res.text();

      let data;
      try { data = JSON.parse(raw); }
      catch {
        console.error('Non-JSON response:', raw);
        throw new Error(`Server returned non-JSON (HTTP ${res.status}).`);
      }

      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to send message.');
      }

      showAlert('Message sent successfully. We will contact you shortly.', 'success', 5000);
      form.reset();

    } catch (err) {
      console.error(err);
      showAlert(err.message || 'Failed to send message. Please try again.', 'danger');
    } finally {
      submitBtn.disabled = false;
    }
  });
})();
// If the URL has #contact_entry, wait a moment and then force focus
window.addEventListener('load', function() {
  if (window.location.hash === '#contact_entry') {
    setTimeout(function() {
      const input = document.getElementById('contact_entry');
      if (input) {
        input.focus();
        // Optional: Scroll slightly further to ensure label is visible
        input.scrollIntoView({behavior: "smooth", block: "center"}); 
      }
    }, 300); // Small delay to allow layout to settle
  }
});
</script>

<style>
/* --- HERO NETWORK ANIMATION LAYERS --- */
.hero {
  position: relative;
  overflow: hidden; /* Keeps particles inside the box */
  background: transparent !important; /* Disable old background */
  min-height: 80vh; /* Optional: Ensure it has good height */
}

/* Layer 1: The Image */
.hero-bg-layer {
  position: absolute;
  inset: 0;
  /* Using the image from your login page as requested */
  background-image: url('../assets/img-webp/services-freight-forwarding.webp');
  background-size: cover;
  background-position: center;
  z-index: 0;
}

/* Layer 2: The Dark Blue Overlay */
.hero-overlay-layer {
  position: absolute;
  inset: 0;
  /* Smart LS Gradient: Dark Blue to lighter Blue */
  background: linear-gradient(135deg, rgba(5, 91, 131, 0.50), rgba(31, 153, 216, 0.30));
  z-index: 1;
}

/* Layer 3: The Particle Canvas */
#heroCanvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 2;
  pointer-events: none; /* Allows clicking through to the form/buttons */
}

/* Layer 4: The Content (Text & Form) */
.hero-content {
  position: relative;
  z-index: 3; /* Must be higher than the canvas */
}
</style>

<script>
/**
 * HERO NETWORK ANIMATION
 * Adapted for the specific dimensions of the Hero Section
 */
(function() {
  const canvas = document.getElementById('heroCanvas');
  const heroSection = document.getElementById('homeHero');
  
  // Safety check: if elements don't exist, stop.
  if (!canvas || !heroSection) return;

  const ctx = canvas.getContext('2d');
  let particlesArray;

  // Function to set canvas size to match the Hero Section precisely
  function setCanvasSize() {
    canvas.width = heroSection.offsetWidth;
    canvas.height = heroSection.offsetHeight;
    initParticles(); // Re-initialize particles on resize to prevent stretching
  }

  // Particle Class
  class Particle {
    constructor() {
      this.x = Math.random() * canvas.width;
      this.y = Math.random() * canvas.height;
      this.directionX = (Math.random() * 0.4) - 0.2; // Slow speed
      this.directionY = (Math.random() * 0.4) - 0.2;
      this.size = Math.random() * 2 + 1;
    }
    update() {
      // Bounce off edges
      if (this.x > canvas.width || this.x < 0) this.directionX = -this.directionX;
      if (this.y > canvas.height || this.y < 0) this.directionY = -this.directionY;
      
      this.x += this.directionX;
      this.y += this.directionY;
    }
    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)'; // Slightly more transparent than login
      ctx.fill();
    }
  }

  function initParticles() {
    particlesArray = [];
    // Calculate density based on area size
    let numberOfParticles = (canvas.height * canvas.width) / 9000; 
    for (let i = 0; i < numberOfParticles; i++) {
      particlesArray.push(new Particle());
    }
  }

  function animateParticles() {
    requestAnimationFrame(animateParticles);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < particlesArray.length; i++) {
      particlesArray[i].update();
      particlesArray[i].draw();

      // Connect particles
      for (let j = i; j < particlesArray.length; j++) {
        const dx = particlesArray[i].x - particlesArray[j].x;
        const dy = particlesArray[i].y - particlesArray[j].y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 110) {
          ctx.beginPath();
          // Fade line based on distance
          ctx.strokeStyle = `rgba(255, 255, 255, ${1 - distance/110})`; 
          ctx.lineWidth = 0.4;
          ctx.moveTo(particlesArray[i].x, particlesArray[i].y);
          ctx.lineTo(particlesArray[j].x, particlesArray[j].y);
          ctx.stroke();
        }
      }
    }
  }

  // Initialize
  setCanvasSize();
  window.addEventListener('resize', setCanvasSize);
  animateParticles();
})();
</script>

</body>
</html>
