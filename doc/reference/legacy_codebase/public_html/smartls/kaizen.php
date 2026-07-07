<?php
  $pageTitle = "Kaizen Hub | Smart Logistics & Services Ltd";
  $pageDescription = "Kaizen Hub — a knowledge hub for logistics insights, humanitarian operations, and supply chain performance across Cameroon and the CEMAC region.";
  $pageKeywords = "Kaizen Hub, Logistics Knowledge Hub, Supply Chain Insights, Humanitarian Logistics, CEMAC, Smart Logistics Cameroon, Douala Logistics";
  $canonicalUrl = "https://smartls.cm/kaizen.php"; // update to exact public URL

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
  <meta property="og:image" content="https://smartls.cm/images/og/kaizen-og.jpg">

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="<?php echo htmlspecialchars($pageTitle); ?>">
  <meta name="twitter:description" content="<?php echo htmlspecialchars($pageDescription); ?>">
  <meta name="twitter:image" content="https://smartls.cm/images/og/kaizen-og.jpg">

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
  // Prevent header warnings + keep nav active state correct
  $activePage = 'kaizen.php';
  require __DIR__ . "/partials/header.php";
?>

<main class="kaizen-page">

  <!-- HERO -->
  <section class="kaizen-page__hero">
    <div class="container">
      <div class="row g-4 align-items-end">
        <div class="col-lg-9">
          <div class="kaizen-page__kicker" data-reveal>
            <i class="fa-solid fa-book-open"></i>
            <span data-i18n="kaizen_kicker">KNOWLEDGE HUB</span>
          </div>

          <h1 class="kaizen-page__title" data-reveal data-i18n="kaizen_title">KAIZEN HUB</h1>

          <!-- Optional: keep empty if you want, but empty <p> is minor SEO/UX waste -->
          <p class="kaizen-page__sub" data-reveal data-i18n="kaizen_sub">
            Practical insights, operational guidance, and thought leadership for modern logistics in the CEMAC region.
          </p>

          <div class="kaizen-page__tools" data-reveal>
            <div class="kaizen-page__search">
              <i class="fa-solid fa-magnifying-glass"></i>
              <input
                id="kaizenSearch"
                class="form-control"
                type="search"
                placeholder="Search articles..."
                data-i18n-placeholder="kaizen_search_ph"
                aria-label="Search articles"
              >
            </div>

            <div class="kaizen-page__filters">
              <button type="button" class="kaizen-page__filter is-active" data-filter="all" data-i18n="kaizen_filter_all">All</button>
              <button type="button" class="kaizen-page__filter" data-filter="strategy" data-i18n="kaizen_filter_strategy">Strategy</button>
              <button type="button" class="kaizen-page__filter" data-filter="humanitarian" data-i18n="kaizen_filter_humanitarian">Humanitarian</button>
              <button type="button" class="kaizen-page__filter" data-filter="technology" data-i18n="kaizen_filter_technology">Technology</button>
            </div>
          </div>
        </div>

        <div class="col-lg-3 text-lg-end" data-reveal>
          <a class="btn btn-smart" href="#articles" data-i18n="kaizen_browse_cta">Browse Articles</a>
        </div>
      </div>
    </div>
  </section>

  <!-- ARTICLES GRID -->
  <section class="kaizen-page__section" id="articles">
    <div class="container">

      <div class="row g-3">
        <!-- Article 1 -->
        <div
          class="col-12 col-lg-6 kaizen-page__item"
          data-tags="all strategy technology"
          data-title="Unlocking the Power of Logistics, the Backbone of Business Growth"
          data-title-key="kaizen_a1_title"
          data-reveal
        >
          <a class="kaizen-page__card" href="kaizen-article.php?slug=unlocking-the-power-of-logistics">
            <div class="kaizen-page__media" style="--kbg:url('../assets/img-webp/article-coo.webp');">
              <span class="kaizen-page__pill"><i class="fa-solid fa-layer-group me-2"></i><span data-i18n="kaizen_pill_strategy">Strategy</span></span>
              <span class="kaizen-page__pill"><i class="fa-solid fa-microchip me-2"></i><span data-i18n="kaizen_pill_technology">Technology</span></span>
            </div>

            <div class="kaizen-page__body">
              <h2 class="kaizen-page__h2 kaizen-page__title-clamp mb-1" data-i18n="kaizen_a1_title">
                Unlocking the Power of Logistics, the Backbone of Business Growth
              </h2>

              <div class="kaizen-page__meta">
                <span>
                  <i class="fa-solid fa-user me-2" style="color:var(--smart-orange)"></i>
                  <span data-i18n="kaizen_by_prefix">By</span>
                  Joseph MOUKOKO, <span data-i18n="kaizen_role_coo">Chief Operating Officer</span> <span data-i18n="kaizen_at">at</span> SMART LOGISTICS &amp; SERVICES LTD.
                </span>
              </div>

              <div class="kaizen-page__cta">
                <span class="kaizen-page__read" data-i18n="kaizen_read">Read Article</span>
                <i class="fa-solid fa-arrow-right"></i>
              </div>
            </div>
          </a>
        </div>

        <!-- Article 2 -->
        <div
          class="col-12 col-lg-6 kaizen-page__item"
          data-tags="all humanitarian strategy"
          data-title="The role Local Logistics Solutions Providers play in ensuring Operational efficiency in Humanitarian and Development Projects"
          data-title-key="kaizen_a2_title"
          data-reveal
        >
          <a class="kaizen-page__card" href="kaizen-article.php?slug=the-role-of-local-logistics">
            <div class="kaizen-page__media" style="--kbg:url('../assets/img-webp/article-ceo.webp');">
              <span class="kaizen-page__pill"><i class="fa-solid fa-hand-holding-heart me-2"></i><span data-i18n="kaizen_pill_humanitarian">Humanitarian</span></span>
              <span class="kaizen-page__pill"><i class="fa-solid fa-compass me-2"></i><span data-i18n="kaizen_pill_operations">Operations</span></span>
            </div>

            <div class="kaizen-page__body">
              <h2 class="kaizen-page__h2 mb-1" data-i18n="kaizen_a2_title">
                The role Local Logistics Solutions Providers play in ensuring Operational efficiency in Humanitarian and Development Projects
              </h2>

              <div class="kaizen-page__meta">
                <span>
                  <i class="fa-solid fa-user me-2" style="color:var(--smart-orange)"></i>
                  <span data-i18n="kaizen_by_prefix">By</span>
                  Timothee MASSOMBA, <span data-i18n="kaizen_role_ceo">Chief Executive Officer</span> <span data-i18n="kaizen_at">at</span> SMART LOGISTICS &amp; SERVICES LTD.
                </span>
              </div>

              <div class="kaizen-page__cta">
                <span class="kaizen-page__read" data-i18n="kaizen_read">Read Article</span>
                <i class="fa-solid fa-arrow-right"></i>
              </div>
            </div>
          </a>
        </div>

        <!-- Article: Demurrage -->
        <div
          class="col-12 col-lg-6 kaizen-page__item"
          data-tags="all strategy operations"
          data-title="Demurrage, Detention, and Storage: Understanding and Avoiding Extra Logistics Charges"
          data-title-key="kaizen_a3_title"
          data-reveal
        >
          <a class="kaizen-page__card" href="kaizen-article.php?slug=demurrage-detention-storage">
            <div class="kaizen-page__media" style="--kbg:url('../assets/img-webp/kaizen-demurrage.webp');">
              <span class="kaizen-page__pill"><i class="fa-solid fa-exclamation-triangle me-2"></i>Operations</span>
            </div>

            <div class="kaizen-page__body">
              <h2 class="kaizen-page__h2 kaizen-page__title-clamp mb-1" data-i18n="kaizen_a3_title">
                Demurrage, Detention, and Storage: Understanding and Avoiding Extra Logistics Charges
              </h2>

              <div class="kaizen-page__meta">
                <i class="fa-solid fa-user me-2" style="color:var(--smart-orange)"></i>
                <span data-i18n="kaizen_a3_author">By Clovis Tiako, Operations Officer</span>
              </div>

              <div class="kaizen-page__cta">
                <span class="kaizen-page__read" data-i18n="kaizen_read">Read Article</span>
                <i class="fa-solid fa-arrow-right"></i>
              </div>
            </div>
          </a>
        </div>

        <!-- Article: Smart Integration -->
        <div
          class="col-12 col-lg-6 kaizen-page__item"
          data-tags="all technology strategy"
          data-title="Boosting Supply Chain Performance Through Smart Integration"
          data-title-key="kaizen_a4_title"
          data-reveal
        >
          <a class="kaizen-page__card" href="kaizen-article.php?slug=smart-integration-case-study">
            <div class="kaizen-page__media" style="--kbg:url('../assets/img-webp/kaizen-smart-ls.webp');">
              <span class="kaizen-page__pill"><i class="fa-solid fa-network-wired me-2"></i>Technology</span>
            </div>

            <div class="kaizen-page__body">
              <h2 class="kaizen-page__h2 kaizen-page__title-clamp mb-1" data-i18n="kaizen_a4_title">
                Boosting Supply Chain Performance Through Smart Integration: A Case Study
              </h2>

              <div class="kaizen-page__meta">
                <i class="fa-solid fa-user me-2" style="color:var(--smart-orange)"></i>
                <span data-i18n="kaizen_a3_author">By Joseph Moukoko, COO</span>
              </div>

              <div class="kaizen-page__cta">
                <span class="kaizen-page__read" data-i18n="kaizen_read">Read Article</span>
                <i class="fa-solid fa-arrow-right"></i>
              </div>
            </div>
          </a>
        </div>

        <!-- Article: Green Logistics -->
        <div
          class="col-12 col-lg-6 kaizen-page__item"
          data-tags="all strategy sustainability"
          data-title="The Future is Green: Sustainable Logistics in the CEMAC Region"
          data-title-key="kaizen_a5_title"
          data-reveal
        >
          <a class="kaizen-page__card" href="kaizen-article.php?slug=green-logistics-cemac">
            <div class="kaizen-page__media" style="--kbg:url('../assets/img-webp/kaizen-green.webp');">
              <span class="kaizen-page__pill"><i class="fa-solid fa-leaf me-2"></i>Sustainability</span>
            </div>

            <div class="kaizen-page__body">
              <h2 class="kaizen-page__h2 kaizen-page__title-clamp mb-1" data-i18n="kaizen_a5_title">
                The Future is Green: Sustainable Logistics in the CEMAC Region
              </h2>

              <div class="kaizen-page__meta">
                <i class="fa-solid fa-user me-2" style="color:var(--smart-orange)"></i>
                <span data-i18n="kaizen_a3_author">By Timothee Massomba, CEO</span>
              </div>

              <div class="kaizen-page__cta">
                <span class="kaizen-page__read" data-i18n="kaizen_read">Read Article</span>
                <i class="fa-solid fa-arrow-right"></i>
              </div>
            </div>
          </a>
        </div>

      </div>

    </div>
  </section>

</main>

<?php require __DIR__ . "/partials/footer.php"; ?>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
<script src="js/app.js"></script>

<!-- Kaizen Hub filtering + search (small, professional, no frameworks) -->
<script>
(function(){
  const search = document.getElementById('kaizenSearch');
  const items = Array.from(document.querySelectorAll('.kaizen-page__item'));
  const filters = Array.from(document.querySelectorAll('.kaizen-page__filter'));
  if(!items.length) return;

  let active = "all";

  function apply(){
    const q = (search?.value || "").trim().toLowerCase();

    items.forEach(el=>{
      const tags = (el.getAttribute('data-tags') || "").toLowerCase();

      // Use translated title for search when available, otherwise fallback to data-title
      const titleKey = el.getAttribute('data-title-key');
      const translatedTitle = titleKey ? (document.querySelector(`[data-i18n="${titleKey}"]`)?.textContent || "") : "";
      const title = (translatedTitle || el.getAttribute('data-title') || "").toLowerCase();

      const tagOk = (active === "all") ? true : tags.includes(active);
      const qOk = !q ? true : (title.includes(q));
      el.style.display = (tagOk && qOk) ? "" : "none";
    });
  }

  filters.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      filters.forEach(b=>b.classList.remove('is-active'));
      btn.classList.add('is-active');
      active = btn.getAttribute('data-filter') || "all";
      apply();
    });
  });

  search?.addEventListener('input', apply);

  // Re-apply after language changes (so search works with translated titles)
  window.addEventListener('storage', (e)=>{
    if(e.key === "slas_lang") apply();
  });
})();
</script>

</body>
</html>
