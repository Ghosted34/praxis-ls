<?php
  $pageTitle = "Project Portfolio | Smart Logistics & Services Ltd";
  $pageDescription = "Project Portfolio featuring detailed logistics case studies across freight forwarding, humanitarian supply chains, and cross-border industrial movements.";
  $pageKeywords = "Smart Logistics, Project Portfolio, Case Studies, Logistics Cameroon, Customs Clearance, Cold Chain, OOG Cargo, Cross-Border Transit, CEMAC";
  $canonicalUrl = "https://smartls.cm/portfolio.php"; // update to exact public URL

  // Read language from cookie set by /js/app.js
  $lang = $_COOKIE['slas_lang'] ?? 'en';
  if ($lang !== 'fr' && $lang !== 'en') $lang = 'en';

  // Case registry (single source of truth)
  $cases = [
    "lt" => [
      "title_en" => "POWERING THE NATIONAL GRID (L&T)",
      "title_fr" => "RENFORCER LE RÉSEAU NATIONAL (L&T)",

      "client_en" => "L&T Power Transmission & Distribution",
      "client_fr" => "L&T Power Transmission & Distribution",

      "scope_en" => "Multi-year logistics support for high-voltage transmission line construction across Cameroon.",
      "scope_fr" => "Support logistique pluriannuel pour la construction de lignes haute tension à travers le Cameroun.",

      "summary_en" => "L&T required the movement of massive, Out-of-Gauge (OOG) transmission towers and transformers into remote, rugged terrains.",
      "summary_fr" => "L&T devait acheminer des pylônes et transformateurs hors gabarit (OOG) vers des zones isolées et difficiles d’accès.",

      "thumb" => "../assets/img-webp/lt-hero.webp",
      "hero"  => "../assets/img-webp/lt-hero.webp",
      "icon" => "fa-bolt"
    ],
    "unfpa" => [
      "title_en" => "THE LIFELINE SUPPLY CHAIN (UNFPA)",
      "title_fr" => "LA CHAÎNE D’APPROVISIONNEMENT VITALE (UNFPA)",

      "client_en" => "United Nations Population Fund (UNFPA)",
      "client_fr" => "Fonds des Nations Unies pour la population (UNFPA)",

      "scope_en" => "Importation and distribution of sensitive reproductive health commodities and pharmaceuticals.",
      "scope_fr" => "Importation et distribution de produits sensibles de santé reproductive et de produits pharmaceutiques.",

      "summary_en" => "Pharmaceuticals are highly sensitive to temperature and time. Any delay in customs or a break in the cold chain could render millions of dollars of aid unusable, directly impacting lives.",
      "summary_fr" => "Les produits pharmaceutiques sont très sensibles à la température et au temps. Tout retard en douane ou rupture de la chaîne du froid peut rendre inutilisable une aide de plusieurs millions de dollars, avec un impact direct sur des vies.",

      "thumb" => "../assets/img-webp/unfpa-hero.webp",
      "hero"  => "../assets/img-webp/unfpa-hero.webp",
      "icon" => "fa-kit-medical"
    ],
    "fma" => [
      "title_en" => "CROSS-BORDER INDUSTRIAL MOVEMENT (FMA)",
      "title_fr" => "MOUVEMENT INDUSTRIEL TRANSFRONTALIER (FMA)",

      "client_en" => "FMA Services Construction International",
      "client_fr" => "FMA Services Construction International",

      "scope_en" => "Re-exportation of a full fleet of heavy construction machinery from Cameroon to Ivory Coast.",
      "scope_fr" => "Réexportation d’une flotte complète d’engins lourds de construction du Cameroun vers la Côte d’Ivoire.",

      "summary_en" => "Re-exportation under temporary admission is notoriously complex, involving dual customs regimes (export from Cameroon, import to Ivory Coast), strict bond cancellations, and cross-border transit permits.",
      "summary_fr" => "La réexportation sous admission temporaire est complexe : double régime douanier (export Cameroun, import Côte d’Ivoire), annulation stricte des cautions et autorisations de transit transfrontalier.",

      "thumb" => "../assets/img-webp/fma-hero.webp",
      "hero"  => "../assets/img-webp/fma-hero.webp",
      "icon" => "fa-truck-ramp-box"
    ],
  ];

  // Localized aria-label prefix
  $ariaReadPrefix = ($lang === 'fr') ? "Lire l’étude de cas : " : "Read case study: ";

  // Optional: localized page title/description for SEO (keeps functionality intact)
  if ($lang === 'fr') {
    $pageTitle = "Portfolio Projets | Smart Logistics & Services Ltd";
    $pageDescription = "Portfolio de projets présentant des études de cas logistiques : transit, chaîne du froid humanitaire et opérations transfrontalières.";
    $pageKeywords = "Smart Logistics, Portfolio Projets, Études de cas, Logistique Cameroun, Dédouanement, Chaîne du froid, Hors gabarit OOG, Transit transfrontalier, CEMAC";
  }
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
  <meta property="og:image" content="https://smartls.cm/images/og/portfolio-og.jpg">

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="<?php echo htmlspecialchars($pageTitle); ?>">
  <meta name="twitter:description" content="<?php echo htmlspecialchars($pageDescription); ?>">
  <meta name="twitter:image" content="https://smartls.cm/images/og/portfolio-og.jpg">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@600;700;800&display=swap" rel="stylesheet">

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" rel="stylesheet">
  <link rel="stylesheet" href="css/style.css">
</head>

<body>
<?php
  // Prevent "Undefined variable $activePage" warnings in header.php
  $activePage = 'portfolio.php';
  require __DIR__ . "/partials/header.php";
?>

<main class="portfolio-page">

  <!-- HERO -->
  <section class="portfolio-page__hero">
    <div class="container position-relative">
      <div class="row g-3 align-items-end">
        <div class="col-lg-9">
          <div class="portfolio-page__kicker" data-reveal>
            <i class="fa-solid fa-shield-halved"></i>
            <span data-i18n="portfolio_kicker">SOLUTIONS IN ACTION</span>
          </div>

          <h1 class="portfolio-page__title" data-reveal data-i18n="portfolio_title">PROJECT PORTFOLIO</h1>

          <p class="portfolio-page__sub" data-reveal data-i18n="portfolio_sub">
            Detailed Case Studies with distinct "Challenge," "Solution," and "Impact" sections
          </p>
        </div>
      </div>
    </div>
  </section>

  <!-- CASE CARDS -->
  <section class="portfolio-page__section">
    <div class="container">
      <div class="row g-3">

        <?php foreach ($cases as $key => $c): ?>
          <?php
            $title = ($lang === 'fr') ? $c['title_fr'] : $c['title_en'];
            $client = ($lang === 'fr') ? $c['client_fr'] : $c['client_en'];
            $summary = ($lang === 'fr') ? $c['summary_fr'] : $c['summary_en'];
          ?>

          <div class="col-12 col-md-6 col-lg-4" data-reveal>
            <a class="portfolio-page__card"
               href="portfolio-case.php?case=<?php echo urlencode($key); ?>"
               aria-label="<?php echo htmlspecialchars($ariaReadPrefix . $title); ?>">

              <div class="portfolio-page__card-media" style="--card-bg:url('<?php echo htmlspecialchars($c["thumb"]); ?>');">
                <div class="portfolio-page__card-badge">
                  <i class="fa-solid <?php echo htmlspecialchars($c["icon"]); ?>"></i>
                </div>
              </div>

              <div class="portfolio-page__card-body">
                <div class="portfolio-page__card-title"><?php echo htmlspecialchars($title); ?></div>

                <div class="portfolio-page__card-meta">
                  <span><i class="fa-solid fa-building me-2"></i><?php echo htmlspecialchars($client); ?></span>
                </div>

                <p class="portfolio-page__card-summary">
                  <?php echo htmlspecialchars($summary); ?>
                </p>

                <div class="portfolio-page__card-footer">
                  <span class="portfolio-page__readmore" data-i18n="portfolio_read_full_case">
                    Read full case <i class="fa-solid fa-arrow-right ms-2"></i>
                  </span>
                </div>
              </div>

            </a>
          </div>
        <?php endforeach; ?>

      </div>
    </div>
  </section>

</main>

<?php require __DIR__ . "/partials/footer.php"; ?>
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
<script src="js/app.js"></script>

</body>
</html>
