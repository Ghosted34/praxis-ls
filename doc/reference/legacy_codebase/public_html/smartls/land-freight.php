<?php
  $pageTitle = "Land Freight / Inland Transport | Smart Logistics & Services Ltd";

  // SEO defaults
  $pageDescription = "Reliable land freight and inland transport across Cameroon and the CEMAC region. Secure, compliant trucking for project cargo, OOG loads, humanitarian distribution, and cross-border transit.";
  $pageKeywords = "Land Freight, Inland Transport, Trucking Cameroon, CEMAC Transport, Cross Border Logistics, OOG Cargo Transport, Project Cargo, GPS Convoy Monitoring, Douala Logistics, Smart Logistics";
  $canonicalUrl = "https://smartls.cm/land-freight.php"; // update to exact public URL

  // Language from cookie (aligns with app.js)
  $lang = $_COOKIE['slas_lang'] ?? 'en';
  if ($lang !== 'fr' && $lang !== 'en') $lang = 'en';

  // Prevent header warning and enable active nav state
  $activePage = 'land-freight.php';
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
  <meta property="og:image" content="https://smartls.cm/images/og/land-freight-og.jpg">

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="<?php echo htmlspecialchars($pageTitle); ?>">
  <meta name="twitter:description" content="<?php echo htmlspecialchars($pageDescription); ?>">
  <meta name="twitter:image" content="https://smartls.cm/images/og/land-freight-og.jpg">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@600;700;800&display=swap" rel="stylesheet">

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" rel="stylesheet">
  <link rel="stylesheet" href="css/style.css">
</head>
<body>

<?php require __DIR__ . "/partials/header.php"; ?>

<main class="freight-lp">

  <section class="freight-lp__hero freight-lp__hero--land">
    <div class="container">
      <div class="freight-lp__hero-inner" data-reveal>
        <div class="freight-lp__kicker">
          <i class="fa-solid fa-truck-fast me-2"></i>
          <span data-i18n="landfreight_kicker">🚚 LAND FREIGHT / INLAND TRANSPORT</span>
        </div>
        <h1 class="freight-lp__title" data-i18n="landfreight_title">Reliable. Secure. Region-Focused.</h1>
      </div>
    </div>
  </section>

  <section class="freight-lp__body">
    <div class="container">
      <div class="freight-lp__reader card-premium p-4 p-lg-5" data-reveal>

        <h2 class="freight-lp__h2" data-i18n="landfreight_overview_title">Overview</h2>
        <p class="freight-lp__p" data-i18n="landfreight_overview_body">
          SMART LOGISTICS &amp; SERVICES LTD provides inland transportation across Cameroon and the wider CEMAC region, ensuring safe and compliant delivery even in remote or challenging terrains.
        </p>

        <h2 class="freight-lp__h2 mt-4" data-i18n="landfreight_delivery_title">How we deliver</h2>
        <ul class="freight-lp__ul">
          <li data-i18n="landfreight_delivery_li_1">Route surveys and risk assessment before dispatch</li>
          <li data-i18n="landfreight_delivery_li_2">Specialized transport for heavy, OOG, and sensitive cargo</li>
          <li data-i18n="landfreight_delivery_li_3">Cross-border transit documentation and customs coordination</li>
          <li data-i18n="landfreight_delivery_li_4">GPS-enabled convoy monitoring and escort services</li>
          <li data-i18n="landfreight_delivery_li_5">Direct delivery to project sites, warehouses, or final clients</li>
        </ul>

        <h2 class="freight-lp__h2 mt-4" data-i18n="landfreight_ideal_title">Ideal for</h2>
        <ul class="freight-lp__ul">
          <li data-i18n="landfreight_ideal_li_1">Project and construction cargo</li>
          <li data-i18n="landfreight_ideal_li_2">Humanitarian distribution</li>
          <li data-i18n="landfreight_ideal_li_3">Industrial and energy sector equipment</li>
          <li data-i18n="landfreight_ideal_li_4">Cross-border CEMAC movements</li>
        </ul>

        <h2 class="freight-lp__h2 mt-4" data-i18n="landfreight_advantage_title">Our advantage</h2>
        <p class="freight-lp__p mb-0" data-i18n="landfreight_advantage_body">
          Deep regional expertise, regulatory mastery, and reliable execution beyond major corridors.
        </p>

        <div class="freight-lp__cta mt-4 pt-3">
          <a class="btn btn-smart btn-lg px-4" href="smart-quote.php?service=land" data-i18n="landfreight_cta">
            Request a Quote for this Service
          </a>
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
