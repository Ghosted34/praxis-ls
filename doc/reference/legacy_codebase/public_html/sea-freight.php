<?php
  $pageTitle = "Sea Freight Forwarding | Smart Logistics & Services Ltd";

  // SEO defaults
  $pageDescription = "Reliable sea freight forwarding from Smart Logistics & Services Ltd. FCL and LCL shipments, port coordination, customs support, and inland evacuation across Cameroon and the CEMAC region.";
  $pageKeywords = "Sea Freight Forwarding, Ocean Freight, FCL, LCL, Freight Forwarder Cameroon, Douala Port Logistics, Customs Clearance, Container Handling, CEMAC Logistics, Smart Logistics";
  $canonicalUrl = "https://smartls.cm/sea-freight"; // update to exact public URL

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
  <meta property="og:image" content="https://smartls.cm/images/og/sea-freight-og.jpg">

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="<?php echo htmlspecialchars($pageTitle); ?>">
  <meta name="twitter:description" content="<?php echo htmlspecialchars($pageDescription); ?>">
  <meta name="twitter:image" content="https://smartls.cm/images/og/sea-freight-og.jpg">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@600;700;800&display=swap" rel="stylesheet">

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" rel="stylesheet">
  <link rel="stylesheet" href="css/style.css">
</head>
<body>

<?php
  // Prevent "Undefined variable $activePage" in header.php
  $activePage = 'sea-freight';
  require __DIR__ . "/partials/header.php";
?>

<main class="freight-lp">

  <section class="freight-lp__hero freight-lp__hero--sea">
    <div class="container">
      <div class="freight-lp__hero-inner" data-reveal>
        <div class="freight-lp__kicker">
          <i class="fa-solid fa-ship me-2"></i>
          <span data-i18n="seafreight_kicker">🚢 SEA FREIGHT FORWARDING</span>
        </div>
        <h1 class="freight-lp__title" data-i18n="seafreight_title">Flexible. Scalable. Cost-Efficient.</h1>
        <div class="freight-lp__hero-row d-flex align-items-center justify-content-between">
          <h1 class="freight-lp__title mb-0">
            Fast. Controlled. Time-Critical.
          </h1>

          <a href="javascript:history.back()" class="btn btn-outline-light btn-sm btn-smart">
            <i class="fa-solid fa-arrow-left me-2"></i>
          </a>
        </div>

      </div>
    </div>
  </section>

  <section class="freight-lp__body">
    <div class="container">
      <div class="freight-lp__reader card-premium p-4 p-lg-5" data-reveal>

        <h2 class="freight-lp__h2" data-i18n="seafreight_overview_title">Overview</h2>
        <p class="freight-lp__p" data-i18n="seafreight_overview_body">
          We offer reliable sea freight forwarding solutions through major global shipping lines, handling both Full Container Load (FCL) and Less than Container Load (LCL) shipments. Our team manages port operations, customs processes, and inland evacuation seamlessly.
        </p>

        <h2 class="freight-lp__h2 mt-4" data-i18n="seafreight_delivery_title">How we deliver</h2>
        <ul class="freight-lp__ul">
          <li data-i18n="seafreight_delivery_li_1">Vessel booking and space optimization (FCL / LCL)</li>
          <li data-i18n="seafreight_delivery_li_2">Pre-arrival documentation and customs pre-clearance</li>
          <li data-i18n="seafreight_delivery_li_3">Port discharge coordination and cargo evacuation</li>
          <li data-i18n="seafreight_delivery_li_4">Container handling (DC, RF, special equipment)</li>
          <li data-i18n="seafreight_delivery_li_5">Integration with inland transport and warehousing</li>
        </ul>

        <h2 class="freight-lp__h2 mt-4" data-i18n="seafreight_ideal_title">Ideal for</h2>
        <ul class="freight-lp__ul">
          <li data-i18n="seafreight_ideal_li_1">Project cargo and heavy equipment</li>
          <li data-i18n="seafreight_ideal_li_2">Bulk and commercial goods</li>
          <li data-i18n="seafreight_ideal_li_3">Long-term and large-volume shipments</li>
          <li data-i18n="seafreight_ideal_li_4">Import, export, and re-export operations</li>
        </ul>

        <h2 class="freight-lp__h2 mt-4" data-i18n="seafreight_advantage_title">Our advantage</h2>
        <p class="freight-lp__p mb-0" data-i18n="seafreight_advantage_body">
          Minimized demurrage, controlled port dwell time, and smooth transition from vessel to final destination.
        </p>

        <div class="freight-lp__cta mt-4 pt-3">
          <a class="btn btn-smart btn-lg px-4" href="smart-quote?service=sea" data-i18n="seafreight_cta">
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
