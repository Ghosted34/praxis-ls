<?php
  $pageTitle = "Services | Smart Logistics & Services Ltd";
  $pageDescription = "Explore Smart Logistics & Services Ltd services: air, sea, and land freight forwarding; customs brokerage; import/export support; business representation; transportation; and warehousing across Cameroon and the CEMAC region.";
  $pageKeywords = "Smart Logistics, Logistics Services, Freight Forwarding, Air Freight Cameroon, Sea Freight Douala, Land Freight CEMAC, Customs Brokerage, Import Export, Business Representation, Transportation, Warehousing, 3PL, Douala";
  $canonicalUrl = "https://smartls.cm/services.php"; // update to your real domain

  // Language from cookie (aligns with app.js)
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
  <meta property="og:image" content="https://smartls.cm/images/og/services-og.jpg">

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="<?php echo htmlspecialchars($pageTitle); ?>">
  <meta name="twitter:description" content="<?php echo htmlspecialchars($pageDescription); ?>">
  <meta name="twitter:image" content="https://smartls.cm/images/og/services-og.jpg">

  <!-- Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@600;700;800&display=swap" rel="stylesheet">

  <!-- Bootstrap -->
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">

  <!-- Icons -->
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" rel="stylesheet">

  <!-- CSS -->
  <link rel="stylesheet" href="css/style.css">
</head>

<body>
<?php
  // Prevent header warning + set active state
  $activePage = 'services.php';
  require __DIR__ . "/partials/header.php";
?>

<main class="service-page">

  <!-- HERO -->
  <section class="service-page__hero">
    <div class="container">
      <div class="row g-4 align-items-end">
        <div class="col-lg-9">
          <div class="service-page__kicker" data-reveal>
            <i class="fa-solid fa-shield-halved"></i>
            <span data-i18n="services_kicker">WITH OPERATIONAL EXCELLENCE</span>
          </div>

          <h1 class="service-page__title" data-reveal data-i18n="services_title">SERVICES</h1>

          <div class="service-page__jump" data-reveal>
            <a class="service-page__jump-link" href="#section-a">
              <i class="fa-solid fa-plane-departure"></i>
              <span data-i18n="services_jump_freight">Freight Forwarding</span>
            </a>
            <a class="service-page__jump-link" href="#section-b">
              <i class="fa-solid fa-clipboard-check"></i>
              <span data-i18n="services_jump_solutions">Logistics Solutions</span>
            </a>
            <a class="service-page__jump-link" href="#section-c">
              <i class="fa-solid fa-warehouse"></i>
              <span data-i18n="services_jump_value_added">Value-Added Services</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- SECTION A -->
  <section class="service-page__section" id="section-a">
    <div class="container">

      <div class="service-page__head" data-reveal>
        <h2 class="service-page__h2" data-i18n="services_a_head_title">Efficient and Secure Air, Land, and Sea Freight Solutions</h2>
        <p class="service-page__sub" data-i18n="services_a_head_sub">Comprehensive solutions for time-sensitive shipments</p>
      </div>

      <div class="row g-3">
        <div class="col-12 col-lg-6" data-reveal>
          <div class="service-page__card">
            <div class="service-page__card-body">
              <div class="service-page__card-top">
                <div class="service-page__icon"><i class="fa-solid fa-layer-group"></i></div>
              </div>

              <div class="service-page__list">
                <div class="service-page__list-item">
                  <div class="service-page__list-title" data-i18n="services_a_list_title_1">Multimodal Mastery</div>
                  <div class="service-page__list-text" data-i18n="services_a_list_text_1">Seamless integration of Air, Sea, and Land transport.</div>
                </div>
                <div class="service-page__list-item">
                  <div class="service-page__list-title" data-i18n="services_a_list_title_2">Speed</div>
                  <div class="service-page__list-text" data-i18n="services_a_list_text_2">Fast transit times with real-time tracking.</div>
                </div>
                <div class="service-page__list-item">
                  <div class="service-page__list-title" data-i18n="services_a_list_title_3">Flexibility</div>
                  <div class="service-page__list-text" data-i18n="services_a_list_text_3">Flexible container options (FCL/LCL) and types (RF/DC) and competitive pricing.</div>
                </div>
                <div class="service-page__list-item">
                  <div class="service-page__list-title" data-i18n="services_a_list_title_4">Documentation</div>
                  <div class="service-page__list-text" data-i18n="services_a_list_text_4">Expert brokerage formalities/procedures and documentation processing.</div>
                </div>
              </div>

            </div>
          </div>
        </div>

        <div class="col-12 col-lg-6" data-reveal>
          <div class="service-page__panel">
            <div class="service-page__panel-inner">
              <div class="service-page__panel-top">
                <div class="service-page__icon service-page__icon--orange"><i class="fa-solid fa-plane-departure"></i></div>
              </div>

              <h3 class="service-page__h3" data-i18n="services_a_panel_title">Efficient and Secure Air, Land, and Sea Freight Solutions</h3>
              <p class="service-page__p" data-i18n="services_a_panel_sub">Comprehensive solutions for time-sensitive shipments.</p>

              <div class="service-page__panel-divider"></div>

              <div class="service-page__pill-row" role="group" aria-label="Freight modes" data-i18n-html="services_a_modes_aria">
                <a class="service-page__mode-btn" href="air-freight.php" data-i18n="services_a_mode_air">Air</a>
                <a class="service-page__mode-btn" href="land-freight.php" data-i18n="services_a_mode_land">Land</a>
                <a class="service-page__mode-btn" href="sea-freight.php" data-i18n="services_a_mode_sea">Sea</a>
              </div>

            </div>
          </div>
        </div>

      </div>

    </div>
  </section>

  <!-- SECTION B -->
  <section class="service-page__section service-page__section--surface" id="section-b">
    <div class="container">

      <div class="service-page__head" data-reveal>
        <h2 class="service-page__h2" data-i18n="services_b_title">Logistics Solutions</h2>
      </div>

      <div class="row g-3">
        <div class="col-12 col-lg-4" data-reveal>
          <article class="service-page__card service-page__card--fill service-page__card--bg"
            style="--card-bg:url('../assets/img-webp/services-logistics-solutions-customs-brokerage.webp');">

            <div class="service-page__card-body">
              <div class="service-page__card-top">
                <div class="service-page__icon service-page__icon--orange"><i class="fa-solid fa-clipboard-check"></i></div>
              </div>

              <h3 class="service-page__h3" data-i18n="services_b1_title">Expert Customs Clearance.</h3>
              <p class="service-page__p" data-i18n="services_b1_body">Minimizing delays and costs through expert knowledge of regulations and efficient clearance procedures.</p>

              <div class="service-page__divider"></div>

              <div class="service-page__kv">
                <span class="v" data-i18n="services_b1_kv">Competitive pricing and average 48-hour clearance time.</span>
              </div>
            </div>
          </article>
        </div>

        <div class="col-12 col-lg-4" data-reveal>
          <article class="service-page__card service-page__card--fill service-page__card--bg"
            style="--card-bg:url('../assets/img-webp/services-import-export.webp');">

            <div class="service-page__card-body">
              <div class="service-page__card-top">
                <div class="service-page__icon"><i class="fa-solid fa-globe"></i></div>
              </div>

              <h3 class="service-page__h3" data-i18n="services_b2_title">Seamless Global Trade.</h3>
              <p class="service-page__p" data-i18n="services_b2_body">Ensuring regulatory compliance and efficient documentation processing for seamless import and export operations.</p>

              <div class="service-page__divider"></div>

              <div class="service-page__kv">
                <span class="v" data-i18n="services_b2_kv">Real-time tracking and expert customs brokerage services.</span>
              </div>
            </div>
          </article>
        </div>

        <div class="col-12 col-lg-4" data-reveal>
          <article class="service-page__card service-page__card--fill service-page__card--bg"
            style="--card-bg:url('../assets/img-webp/services-logistics-solutions-business-representation.webp');">

            <div class="service-page__card-body">
              <div class="service-page__card-top">
                <div class="service-page__icon service-page__icon--green"><i class="fa-solid fa-handshake"></i></div>
              </div>

              <h3 class="service-page__h3" data-i18n="services_b3_title">Your Local Partner.</h3>
              <p class="service-page__p" data-i18n="services_b3_body">Providing local representation services for international businesses. We offer local market expertise and handle regulatory compliance.</p>

              <div class="service-page__divider"></div>

              <div class="service-page__kv">
                <span class="v" data-i18n="services_b3_kv">
                  Faster market entry with compliant local representation and hands-on regulatory management.
                </span>
              </div>
            </div>
          </article>
        </div>
      </div>

    </div>
  </section>

  <!-- SECTION C -->
  <section class="service-page__section" id="section-c">
    <div class="container">

      <div class="service-page__head" data-reveal>
        <h2 class="service-page__h2" data-i18n="services_c_title">Value-Added Services</h2>
      </div>

      <div class="row g-3">
        <div class="col-12 col-lg-6" data-reveal>
          <article class="service-page__card service-page__card--fill service-page__card--bg"
            style="--card-bg:url('../assets/img-webp/services-transportation.webp');">

            <div class="service-page__card-body">
              <div class="service-page__card-top">
                <div class="service-page__icon service-page__icon--orange"><i class="fa-solid fa-truck-fast"></i></div>
              </div>

              <h3 class="service-page__h3" data-i18n="services_c1_title">Reliable Last-Mile Delivery</h3>
              <p class="service-page__p" data-i18n="services_c1_body">We provide reliable transportation solutions for Heavy Equipment, Project Cargo, Perishables, and Pharmaceutical goods, ensuring safe and timely delivery across the CEMAC region through optimized routing and compliant handling.</p>

              <div class="service-page__divider"></div>

              <div class="service-page__kv">
                <span class="v" data-i18n="services_c1_kv">Flexible transportation options and real-time tracking.</span>
              </div>
            </div>
          </article>
        </div>

        <div class="col-12 col-lg-6" data-reveal>
          <article class="service-page__card service-page__card--fill service-page__card--bg"
            style="--card-bg:url('../assets/img-webp/services-warehousing.webp');">

            <div class="service-page__card-body">
              <div class="service-page__card-top">
                <div class="service-page__icon service-page__icon--green"><i class="fa-solid fa-warehouse"></i></div>
              </div>

              <h3 class="service-page__h3" data-i18n="services_c2_title">Secure Storage Facilities</h3>
              <p class="service-page__p" data-i18n="services_c2_body">Secure warehousing facilities for safe storage solutions.</p>

              <div class="service-page__divider"></div>

              <div class="service-page__kv">
                <span class="v" data-i18n="services_c2_kv">Flexible storage options and real-time inventory tracking from WMS.</span>
              </div>
            </div>
          </article>
        </div>
      </div>

    </div>
  </section>

</main>

<?php require __DIR__ . "/partials/footer.php"; ?>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
<script src="js/app.js"></script>

</body>
</html>
