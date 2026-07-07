<?php
  $slug = $_GET['slug'] ?? '';

  $articles = [
    "unlocking-the-power-of-logistics" => [
      "title_en" => "Unlocking the Power of Logistics, the Backbone of Business Growth",
      "title_fr" => "Libérer la puissance de la logistique, pilier de la croissance des entreprises",
      "author_en" => "Joseph MOUKOKO, Chief Operating Officer at SMART LOGISTICS & SERVICES LTD.",
      "author_fr" => "Joseph MOUKOKO, Directeur des Opérations (COO) chez SMART LOGISTICS & SERVICES LTD.",
      "hero_image" => "../assets/img-webp/article-coo.webp",
      "body_en" => [
        "In today's fast-paced business landscape, logistics is more than just a supporting function – it's a strategic driver of growth. Effective logistics management can make or break a company's success, influencing everything from supply chain efficiency to customer satisfaction.",
        "Smooth Operations: Efficient Supply Chain Management",
        "A well-oiled supply chain is the heartbeat of any business. Logistics ensures that raw materials are sourced, produced, and delivered to customers seamlessly. Poor logistics management can lead to:",
        "Delays and stockouts (GEODIS, 2022) [1]",
        "Increased costs (up to 10% of revenue lost due to inefficient supply chains) (University of Tennessee, 2019) [2]",
        "Damaged relationships with suppliers and customers",
        "Conversely, efficient logistics:",
        "Enhances supply chain visibility (reducing errors by up to 50%) (Bowersox et al., 2019) [3]",
        "Improves delivery times (boosting customer satisfaction by 25%) (Harvard Business Review, 2019) [4]",
        "Supports business scalability",
        "Cutting Costs, Boosting Growth: Logistics Optimization",
        "Logistics optimization is a treasure trove of cost savings. By streamlining transportation, warehousing, and inventory management:",
        "Companies can reduce logistics costs by up to 20% (Logistics Management, 2020) [5]",
        "Savings can be reinvested in business development and expansion",
        "Increased competitiveness in the market",
        "Delighting Customers, Driving Loyalty",
        "Timely deliveries and product availability are logistics' greatest customer-facing contributions:",
        "85% of customers consider delivery speed when choosing a retailer (Dropoff, 2020) [6]",
        "75% of customers will return to a retailer with a history of timely deliveries (Harvard Business Review, 2019) [4]",
        "Logistics-driven customer satisfaction boosts loyalty and repeat business",
        "Embracing Innovation: Technology in Logistics",
        "Technological advancements revolutionize logistics efficiency:",
        "Automation reduces labour costs by up to 70% (McKinsey, 2020) [7]",
        "AI optimizes routes, slashing transportation costs by 15% (Supply Chain Dive, 2020) [8]",
        "IoT enhances supply chain visibility and security (MarketsandMarkets, 2022) [9]",
        "Breaking Borders: Global Expansion through Logistics",
        "Robust logistics systems empower businesses to conquer international markets:",
        "Managing tariffs, regulations, and transportation logistics (Thomson Reuters, 2020) [10]",
        "Ensuring compliance with global trade regulations",
        "Unlocking new revenue streams (Journal of International Business Studies, 2019) [11]",
        "Resilience in the Face of Disruption",
        "A well-planned logistics system mitigates risks:",
        "Supply chain breakdowns",
        "Natural disasters",
        "Economic fluctuations (Deloitte, 2020) [12]",
        "Ensuring supply chain agility (MIT Center for Transportation and Logistics, 2019) [13]",
        "In conclusion, logistics plays a critical and vital role in business growth. By prioritizing efficient supply chain management, cost optimization, customer satisfaction, technological innovation, global expansion, and risk management, companies can unlock new heights of success.",
        "(References included in source text)"
      ],
      "body_fr" => [
        "Dans un environnement économique en évolution rapide, la logistique n’est plus une simple fonction de support : c’est un levier stratégique de croissance. Une gestion logistique performante peut faire ou défaire la réussite d’une entreprise, en influençant la performance de la chaîne d’approvisionnement comme la satisfaction client.",
        "Des opérations fluides : une gestion efficace de la chaîne d’approvisionnement",
        "Une chaîne d’approvisionnement bien huilée est le cœur de toute activité. La logistique garantit l’approvisionnement en matières premières, la production et la livraison aux clients de manière continue. Une logistique insuffisante peut entraîner :",
        "Retards et ruptures de stock (GEODIS, 2022) [1]",
        "Hausse des coûts (jusqu’à 10 % du chiffre d’affaires perdu à cause d’inefficacités) (University of Tennessee, 2019) [2]",
        "Dégradation des relations avec les fournisseurs et les clients",
        "À l’inverse, une logistique efficiente :",
        "Améliore la visibilité de la chaîne (réduction des erreurs jusqu’à 50 %) (Bowersox et al., 2019) [3]",
        "Raccourcit les délais de livraison (hausse de la satisfaction client de 25 %) (Harvard Business Review, 2019) [4]",
        "Soutient la capacité de montée en charge",
        "Réduire les coûts, accélérer la croissance : optimisation logistique",
        "L’optimisation logistique recèle un fort potentiel d’économies. En rationalisant le transport, l’entreposage et la gestion des stocks :",
        "Les entreprises peuvent réduire leurs coûts logistiques jusqu’à 20 % (Logistics Management, 2020) [5]",
        "Les économies peuvent être réinvesties dans le développement et l'expansion",
        "Compétitivité accrue sur le marché",
        "Satisfaire les clients, renforcer la fidélité",
        "La ponctualité des livraisons et la disponibilité des produits sont les apports les plus visibles de la logistique côté client :",
        "85 % des clients tiennent compte de la vitesse de livraison pour choisir un distributeur (Dropoff, 2020) [6]",
        "75 % des clients reviennent chez un distributeur ayant une historique de livraisons à l’heure (Harvard Business Review, 2019) [4]",
        "La satisfaction client portée par la logistique renforce la fidélité et la récurrence",
        "Adopter l’innovation : la technologie au service de la logistique",
        "Les avancées technologiques transforment l’efficacité logistique :",
        "L’automatisation réduit les coûts de main-d’œuvre jusqu’à 70 % (McKinsey, 2020) [7]",
        "L’IA optimise les itinéraires, réduisant les coûts de transport de 15 % (Supply Chain Dive, 2020) [8]",
        "L’IoT renforce la visibilité et la sécurité des flux (MarketsandMarkets, 2022) [9]",
        "Franchir les frontières : expansion internationale grâce à la logistique",
        "Des systèmes logistiques robustes permettent de conquérir les marchés internationaux :",
        "Gestion des droits, réglementations et contraintes de transport (Thomson Reuters, 2020) [10]",
        "Conformité aux règles du commerce international",
        "Ouverture de nouvelles sources de revenus (Journal of International Business Studies, 2019) [11]",
        "Résilience face aux perturbations",
        "Une logistique planifiée atténue les risques :",
        "Ruptures de la chaîne d’approvisionnement",
        "Catastrophes naturelles",
        "Variations économiques (Deloitte, 2020) [12]",
        "Agilité de la chaîne d’approvisionnement (MIT Center for Transportation and Logistics, 2019) [13]",
        "En conclusion, la logistique joue un rôle crucial dans la croissance des entreprises. En priorisant la gestion de la chaîne, l’optimisation des coûts, la satisfaction client, l’innovation, l’expansion internationale et la gestion des risques, les entreprises peuvent atteindre de nouveaux niveaux de performance.",
        "(Références incluses dans le texte source)"
      ]
    ],

    "the-role-of-local-logistics" => [
      "title_en" => "The role Local Logistics Solutions Providers play in ensuring Operational efficiency in Humanitarian and Development Projects",
      "title_fr" => "Le rôle des prestataires logistiques locaux dans l’efficacité opérationnelle des projets humanitaires et de développement",
      "author_en" => "Timothee MASSOMBA, Chief Executive Officer at SMART LOGISTICS & SERVICES LTD.",
      "author_fr" => "Timothee MASSOMBA, Directeur Général chez SMART LOGISTICS & SERVICES LTD.",
      "hero_image" => "../assets/img-webp/article-ceo.webp",
      "body_en" => [
        "The humanitarian and development projects world is characterized by complex operations, and logistics plays a vital role in ensuring timely and effective delivery of aid. When it comes to navigating the unique challenges of international development, local logistics providers offer unparalleled advantages. These go a long way to contribute to sustainable development.",
        "Cultural and Contextual Understanding: The Key to Seamless Operations",
        "Local logistics providers possess a deep understanding of the cultural, social, and economic contexts of the region. This expertise enables them to:",
        "Navigate local customs and regulations efficiently",
        "Build strong relationships with local stakeholders",
        "Anticipate and mitigate potential logistical hurdles",
        "As noted by the World Health Organization (WHO), \"local knowledge and expertise are essential for effective logistics management in humanitarian responses.\" [1]",
        "Cost Efficiency: Maximizing Value for Donors",
        "Partnering with local logistics companies can significantly reduce costs:",
        "Existing relationships with local suppliers and transport networks minimize storage, transportation, and labor expenses",
        "Local providers often have lower overhead costs compared to international companies",
        "A study by the Overseas Development Institute (ODI) found that localizing logistics can reduce costs by up to 30%. [2]",
        "Rapid Response and Flexibility: Saving Lives in Emergencies",
        "Local providers can respond quickly to emergencies and adapt to changing situations:",
        "Proximity to project sites enables faster mobilization",
        "Real-time adjustments to logistics plans ensure uninterrupted aid delivery",
        "The United Nations High Commissioner for Refugees (UNHCR) emphasizes the importance of local logistics capacity in emergency responses. [3]",
        "Building Local Capacity: Sustainable Outcomes Through Partnership",
        "Investing in local providers fosters long-term benefits:",
        "Development of local capacity and skills",
        "Strengthening economic and logistical infrastructure",
        "Enhanced community resilience",
        "The World Bank highlights the significance of local capacity building in achieving sustainable development goals. [4]",
        "Enhanced Security and Risk Management: Mitigating Disruptions",
        "Local providers offer better security and risk management:",
        "Familiarity with local terrain, potential risks, and community dynamics",
        "Reduced likelihood of disruptions and security breaches",
        "The International Committee of the Red Cross (ICRC) stresses the importance of local knowledge in ensuring secure and efficient logistics operations. [5]",
        "Supporting Local Economies: Empowering Communities",
        "Working with local providers:",
        "Bolsters local economies",
        "Promotes economic growth",
        "Provides job opportunities within the community",
        "The African Development Bank emphasizes the role of local logistics in driving economic growth and development. [6]",
        "Success Stories: The Impact of Local Logistics",
        "At SMART LOGISTICS & SERVICES, we've witnessed the power of local logistics firsthand. Our partnership with UNFPA on clearance of pharmaceuticals demonstrated the efficiency and effectiveness of local logistics expertise.",
        "By choosing local logistics providers, international organizations and development agencies can:",
        "Enhance cultural and contextual understanding",
        "Reduce costs",
        "Respond rapidly to emergencies",
        "Build local capacity",
        "Ensure security and risk management",
        "Support local economies",
        "Join the movement towards more effective and sustainable humanitarian and development projects. Partner with local logistics providers like SMART LOGISTICS & SERVICES to unlock the full potential of your aid efforts.",
        "(References included in source text)"
      ],
      "body_fr" => [
        "Le monde des projets humanitaires et de développement se caractérise par des opérations complexes, et la logistique joue un rôle déterminant pour garantir une livraison d’aide rapide et efficace. Pour relever les défis spécifiques du développement international, les prestataires logistiques locaux offrent des avantages uniques, contribuant directement à des résultats durables.",
        "Compréhension culturelle et contextuelle : la clé d’opérations fluides",
        "Les prestataires locaux disposent d’une connaissance approfondie des réalités culturelle, sociales et économiques de la région. Cette expertise leur permet de :",
        "Gérer efficacement les coutumes locales et les exigences réglementaires",
        "Construire des relations solides avec les parties prenantes locales",
        "Anticiper et réduire les obstacles logistiques potentiels",
        "Comme l’a souligné l’Organisation mondiale de la Santé (OMS), « la connaissance et l’expertise locales sont essentielles pour une gestion logistique efficace lors des réponses humanitaires ». [1]",
        "Efficience des coûts : maximiser la valeur pour les bailleurs",
        "Collaborer avec des entreprises logistiques locales peut réduire significativement les coûts :",
        "Les relations existantes avec les fournisseurs et réseaux de transport locaux réduisent les dépenses de stockage, transport et main-d’œuvre",
        "Les prestataires locaux ont souvent des frais généraux inférieurs à ceux des entreprises internationales",
        "Une étude de l’Overseas Development Institute (ODI) a montré que la localisation de la logistique peut réduire les coûts jusqu’à 30 %. [2]",
        "Réactivité et flexibilité : sauver des vies en situation d’urgence",
        "Les prestataires locaux peuvent répondre rapidement aux urgences et s’adapter aux changements :",
        "La proximité des sites permet une mobilisation plus rapide",
        "Des ajustements en temps réel des plans logistiques assurent la continuité des livraisons",
        "Le HCR (UNHCR) souligne l’importance des capacités logistiques locales dans les réponses d’urgence. [3]",
        "Renforcement des capacités locales : des résultats durables par le partenariat",
        "Investir dans les prestataires locaux génère des bénéfices de long terme :",
        "Développement des compétences et capacités locales",
        "Renforcement de l’infrastructure économique et logistique",
        "Résilience accrue des communautés",
        "La Banque mondiale met en avant l’importance du renforcement des capacités locales pour atteindre les objectifs de développement durable. [4]",
        "Sécurité et gestion des risques : limiter les perturbations",
        "Les prestataires locaux offrent une meilleure maîtrise des risques :",
        "Connaissance du terrain, des risques potentiels et des dynamiques communautaires",
        "Diminution des risques d’interruptions et d’incidents de sécurité",
        "Le CICR (ICRC) insiste sur l’importance de la connaissance locale pour des opérations logistiques sûres et efficaces. [5]",
        "Soutenir les économies locales : autonomiser les communautés",
        "Travailler avec des prestataires locaux :",
        "Renforce les économies locales",
        "Favorise la croissance économique",
        "Crée des opportunités d’emploi au sein des communautés",
        "La Banque africaine de développement souligne le rôle de la logistique locale dans la croissance et le développement économiques. [6]",
        "Retours d’expérience : l’impact de la logistique locale",
        "Chez SMART LOGISTICS & SERVICES, nous constatons concrètement la valeur de l’expertise locale. Notre partenariat avec l’UNFPA sur le dédouanement de produits pharmaceutiques a démontré l’efficacité d’une logistique maîtrisée localement.",
        "En choisissant des prestataires locaux, les organisations internationales et agences de développement peuvent :",
        "Renforcer la compréhension culturelle et contextuelle",
        "Réduire les coûts",
        "Répondre rapidement aux urgences",
        "Renforcer les capacités locales",
        "Assurer la sécurité et la gestion des risques",
        "Soutenir les économies locales",
        "Rejoignez le mouvement pour des projets humanitaires et de développement plus efficaces et durables. Collaborez avec des prestataires locaux comme SMART LOGISTICS & SERVICES pour libérer tout le potentiel de vos opérations d’aide.",
        "(Références incluses dans le texte source)"
      ]
    ],

    "demurrage-detention-storage" => [
      "title_en" => "Demurrage, Detention, and Storage: Understanding and Avoiding Extra Logistics Charges",
      "title_fr" => "Surestaries, détention et stockage : comprendre et éviter les frais logistiques",
      "author_en" => "Clovis Tiako, Operations Officer, Smart Logistics & Services Ltd",
      "author_fr" => "Clovis Tiako, Responsable des Opérations, Smart Logistics & Services Ltd",
      "hero_image" => "../assets/img-webp/kaizen-demurrage.webp",
      "body_en" => [
        "In the world of international trade, \"extra charges\" are the nightmare of every importer. You calculate your freight costs, pay your duties, and suddenly receive an invoice labeled \"Demurrage\" or \"Detention.\" These charges can sometimes exceed the value of the cargo itself.",
        "At Smart Logistics & Services Ltd, we believe that an educated client is an empowered client. This guide breaks down exactly what these charges are, why they happen, and how our operational strategies help you avoid them.",
        "The \"Big Three\" Charges Defined",
        "Many shippers use these terms interchangeably, but they refer to distinctly different phases of the shipping cycle.",
        "Demurrage (Inside the Port)",
        "What it is: A penalty charged by the shipping line when a full container sits inside the terminal after the allowed free days have expired.",
        "Why it happens: The shipping line wants you to pick up your cargo quickly so they can free up space in the terminal.",
        "Common Causes: Delayed documentation, customs blocks, or lack of funds to pay duties.",
        "Detention (Outside the Port)",
        "What it is: A penalty charged by the shipping line when you hold onto their container (the empty box) outside the port for too long.",
        "Why it happens: The shipping line needs their container back to ship goods for another client.",
        "Common Causes: Slow offloading at the warehouse, delays in returning the empty unit to the depot, or using the container for temporary storage.",
        "Port Storage / Terminal Handling Charges",
        "What it is: A fee charged by the Port Terminal Operator (not the shipping line) for the space your container occupies on the ground.",
        "The Catch: Even if you have 14 free days of Demurrage from the shipping line, the Port Terminal might only give you 7 free days of storage. You could be safe on one but paying on the other.",
        "How They Are Calculated",
        "These charges are typically calculated on a progressive daily rate. Days 1-7 (after free time): Standard Rate. Days 8-15: Double Rate. Days 16+: Punitive Rate. A delay of just one week can result in exponential costs.",
        "Smart Strategies to Avoid Extra Charges",
        "At Smart Logistics, avoiding these costs is a core KPI for our operations team. Here is how we protect our clients:",
        "Pre-Clearance Protocol (The Golden Rule) — We initiate the Provisional Declaration as soon as we receive draft documents so Liquidation is ready before the ship berths.",
        "Smart Track Monitoring — Our digital tracking system monitors the 'Free Time Clock' and flags containers as Critical when 2 days remain.",
        "Efficient 'Live' Offloading — Prioritise live offloading (truck waits while unloading) to return the container immediately and avoid detention.",
        "Negotiation of Free Time — For project or complex shipments we negotiate extended free time (14–21 days) with shipping lines before booking.",
        "Conclusion",
        "Demurrage and detention are not inevitable costs of doing business; they are penalties for inefficiency. By understanding timelines and partnering with a logistics provider that prioritizes speed and pre-planning, you can avoid these penalties."
      ],
      "body_fr" => [
        "Dans le commerce international, les \"frais supplémentaires\" sont le cauchemar de l’importateur. Vous calculez vos coûts de fret, payez vos droits, puis recevez une facture intitulée \"Surestaries\" ou \"Détention\". Ces frais peuvent parfois dépasser la valeur de la cargaison.",
        "Chez Smart Logistics & Services Ltd, un client informé est un client responsabilisé. Ce guide explique ce que sont ces frais, pourquoi ils apparaissent et comment nos stratégies opérationnelles vous protègent.",
        "Les trois principaux frais",
        "Surestaries (à l'intérieur du port)",
        "Qu'est-ce que c'est : Une pénalité facturée par la compagnie maritime lorsqu'un conteneur plein reste dans le terminal après la période gratuite.",
        "Pourquoi : La compagnie doit libérer de l'espace dans le terminal.",
        "Causes courantes : Documents retardés, blocages douaniers, manque de fonds pour régler les droits.",
        "Détention (à l'extérieur du port)",
        "Qu'est-ce que c'est : Une pénalité lorsque vous conservez le conteneur vide en dehors du port trop longtemps.",
        "Pourquoi : La compagnie a besoin du conteneur pour d'autres expéditions.",
        "Frais de stockage / manutention portuaire",
        "Facturés par l'opérateur terminal pour l'occupation d'espace au sol — attention aux différences entre le 'free time' de la ligne et celui du terminal.",
        "Calcul",
        "Tarifs progressifs journaliers — semaine 1 taux standard, semaine 2 taux double, semaine 3 taux punitif — un retard d'une semaine peut être exponentiel.",
        "Stratégies Smart Logistics",
        "Pré-dédouanement, suivi Smart Track, déchargement immédiat et négociation de 'free time' pour projets.",
        "Conclusion : Ces pénalités sont évitables grâce à la planification et l'exécution."
      ]
    ],

    "smart-integration-case-study" => [
      "title_en" => "Boosting Supply Chain Performance Through Smart Integration: A Case Study",
      "title_fr" => "Amélioration de la performance de la chaîne d'approvisionnement par l'intégration intelligente : étude de cas",
      "author_en" => "Joseph Moukoko, Chief Operating Officer, Smart Logistics & Services Ltd",
      "author_fr" => "Joseph Moukoko, Directeur des opérations, Smart Logistics & Services Ltd",
      "hero_image" => "../assets/img-webp/kaizen-smart-ls.webp",
      "body_en" => [
        "Date: April 25, 2025",
        "In the modern logistics landscape, data fragmentation is the silent killer of efficiency. Traditional supply chains often operate in silos — customs brokerage, freight forwarding, and warehousing on disconnected systems.",
        "The Challenge of Disconnected Systems",
        "Booking data in emails; customs in government portals; transport planning in spreadsheets; client updates via phone — this fragmentation creates data latency which can cause demurrage and cost overruns.",
        "The SMART-LS Solution: A Unified Digital Hub",
        "Real-Time Visibility via API — integrations with port community systems and GPS providers update status automatically and trigger notifications.",
        "Predictive Analytics for Customs — historical clearance data helps predict inspections so brokerage prepares documents proactively.",
        "Automated Client Communication — Smart Track provides granular transparency down to convoy ID and truck location, freeing ops for complex tasks.",
        "Impact on Performance",
        "Reduced Administrative Overhead: 30% reduction in man-hours.",
        "Cost Avoidance: Zero demurrage penalties recorded for integrated project cargo in Q1 2025.",
        "Client Satisfaction: Smart Quote reduced time-to-quote from 24 hours to under 2 hours for standard shipments.",
        "Conclusion",
        "Smart integration is not just software — it's an ecosystem where every stakeholder shares the same real-time reality. In the CEMAC region, technology is the ultimate driver of logistics excellence."
      ],
      "body_fr" => [
        "Date : 25 avril 2025",
        "La fragmentation des données est un facteur majeur d'inefficacité. Avant Smart-LS, les données étaient dispersées : réservations par email, déclarations douanières sur portails, planification sur tableurs, communications manuelles.",
        "Solution Smart-LS : un hub numérique unifié",
        "Visibilité temps réel via API, analytique prédictive pour la douane et communication client automatisée.",
        "Résultats : réduction de 30% du travail administratif, zéro surestarie pour les projets intégrés sur Q1 2025 et réduction du temps de cotation.",
        "Conclusion : L'intégration intelligente transforme la performance logistique."
      ]
    ],

    "green-logistics-cemac" => [
      "title_en" => "The Future is Green: Sustainable Logistics in the CEMAC Region",
      "title_fr" => "L'avenir est vert : la logistique durable en zone CEMAC",
      "author_en" => "Timothee Massomba, CEO, Smart Logistics & Services Ltd",
      "author_fr" => "Timothée Massomba, Directeur Général, Smart Logistics & Services Ltd",
      "hero_image" => "../assets/img-webp/kaizen-green.webp",
      "body_en" => [
        "For decades, logistics was measured by speed and cost; today sustainability is equally critical. In Africa, Green Logistics equals smarter, leaner, more profitable supply chains.",
        "What is Green Logistics?",
        "Measuring and minimizing ecological impact: reducing carbon from transport, minimizing packaging waste, optimizing reverse logistics.",
        "Why It Matters",
        "Fuel efficiency equals cost efficiency; compliance for multinationals; asset longevity through proper maintenance.",
        "How Smart Logistics Leads the Charge",
        "Route optimization algorithms to avoid congestion and idle time.",
        "Paperless operations via the Smart Operations Portal.",
        "Reverse logistics for empty containers to reduce empty miles.",
        "The Road Ahead",
        "Exploring electric handling equipment and committing to carbon footprint auditing — sustainability is a journey not a destination."
      ],
      "body_fr" => [
        "Depuis des décennies la logistique se mesurait à la vitesse et au coût ; aujourd'hui la durabilité est tout aussi importante. En Afrique, la logistique verte signifie des chaînes plus intelligentes et rentables.",
        "Qu'est-ce que la logistique verte ?",
        "Réduire l'impact écologique : émissions, déchets d'emballage, logistique inverse.",
        "Pourquoi c'est important ?",
        "Efficacité carburant = efficacité des coûts ; conformité des multinationales ; longévité des actifs.",
        "Initiatives Smart Logistics",
        "Optimisation d'itinéraires, opérations sans papier, réutilisation des unités vides.",
        "Conclusion : La durabilité est une démarche continue pour une logistique responsable."
      ]
    ],
  ];

  // preserve insertion order
  $articleOrder = array_keys($articles);

  // PHP 7 helper
  function ends_with($haystack, $needle) {
    $len = strlen($needle);
    if ($len === 0) return true;
    return substr($haystack, -$len) === $needle;
  }

  // Language
  $lang = $_COOKIE['slas_lang'] ?? 'en';
  if ($lang !== 'fr' && $lang !== 'en') $lang = 'en';

  // Page meta defaults (will be overridden when article exists)
  $exists = isset($articles[$slug]);

  if (!$exists) {
    http_response_code(404);
    $pageTitle = "Article Not Found | Kaizen Hub";
    $pageDescription = "The requested Kaizen Hub article could not be found. Browse Smart Logistics & Services Ltd insights on logistics, trade compliance, and supply chain performance in Cameroon and the CEMAC region.";
    $pageKeywords = "Kaizen Hub, Logistics Articles, Smart Logistics, Cameroon, CEMAC";
    $canonicalUrl = "https://smartls.cm/kaizen-article?slug=" . urlencode($slug);
    $ogImage = "https://smartls.cm/images/og/kaizen-og.jpg"; // provide a default OG image
  } else {
    $a = $articles[$slug];
    $title = ($lang === 'fr') ? $a['title_fr'] : $a['title_en'];
    $author = ($lang === 'fr') ? $a['author_fr'] : $a['author_en'];
    $body = ($lang === 'fr') ? $a['body_fr'] : $a['body_en'];

    $pageTitle = $title . " | Kaizen Hub";

    // Better description: prefer first paragraph-like line (avoid "Date:" or headings)
    $desc = "";
    foreach ($body as $line) {
      $t = trim($line);
      if ($t === "") continue;
      if (stripos($t, "Date:") === 0 || stripos($t, "Date :") === 0) continue;
      if (mb_strlen($t) < 40) continue; // likely heading/bullet
      $desc = $t;
      break;
    }
    if ($desc === "") $desc = "Kaizen Hub insight from Smart Logistics & Services Ltd on logistics operations, compliance, and supply chain performance in Cameroon and the CEMAC region.";

    // Hard cap for SERP snippet hygiene
    if (mb_strlen($desc) > 160) $desc = mb_substr($desc, 0, 157) . "...";

    $pageDescription = $desc;

    // Keywords: add contextual keywords per hub
    $pageKeywords = "Kaizen Hub, Smart Logistics, Logistics Insights, Supply Chain, Trade Compliance, Freight Forwarding, Customs Brokerage, Cameroon, Douala, CEMAC";

    $canonicalUrl = "https://smartls.cm/kaizen-article?slug=" . urlencode($slug);

    // OG image: use absolute URL (preferred by crawlers)
    $heroPath = $a['hero_image'] ?? "";
    $ogImage = "https://smartls.cm/images/og/kaizen-og.jpg";
    if ($heroPath) {
      // if your public path mirrors /assets/... then map it
      // example: ../assets/img-webp/x.webp -> https://smartls.cm/assets/img-webp/x.webp
      $ogImage = "https://smartls.cm/" . ltrim(str_replace("../", "", $heroPath), "/");
    }
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
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Smart Logistics & Services Ltd">
  <meta property="og:title" content="<?php echo htmlspecialchars($pageTitle); ?>">
  <meta property="og:description" content="<?php echo htmlspecialchars($pageDescription); ?>">
  <meta property="og:url" content="<?php echo htmlspecialchars($canonicalUrl); ?>">
  <meta property="og:image" content="<?php echo htmlspecialchars($ogImage); ?>">

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="<?php echo htmlspecialchars($pageTitle); ?>">
  <meta name="twitter:description" content="<?php echo htmlspecialchars($pageDescription); ?>">
  <meta name="twitter:image" content="<?php echo htmlspecialchars($ogImage); ?>">

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

  <?php if ($exists): ?>
  <!-- Article structured data (JSON-LD) -->
  <script type="application/ld+json">
  <?php
    $jsonLd = [
      "@context" => "https://schema.org",
      "@type" => "Article",
      "headline" => $pageTitle,
      "description" => $pageDescription,
      "image" => [$ogImage],
      "author" => [
        "@type" => "Person",
        "name" => $author
      ],
      "publisher" => [
        "@type" => "Organization",
        "name" => "Smart Logistics & Services Ltd",
        "logo" => [
          "@type" => "ImageObject",
          "url" => "https://smartls.cm/assets/img-webp/logo-smart.webp"
        ]
      ],
      "mainEntityOfPage" => [
        "@type" => "WebPage",
        "@id" => $canonicalUrl
      ]
    ];
    echo json_encode($jsonLd, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  ?>
  </script>
  <?php endif; ?>
</head>

<body>
<?php
  // Prevent header warnings + set active nav
  $activePage = 'kaizen.php';
  require __DIR__ . "/partials/header.php";
?>

<main class="kaizen-page">

<?php if (!$exists): ?>

  <section class="kaizen-page__article-hero">
    <div class="container">
      <div class="kaizen-page__article-shell card-premium p-4 p-lg-5" data-reveal>
        <h1 class="kaizen-page__article-title mb-2" data-i18n="kaizen_not_found_title">Article Not Found</h1>
        <p class="kaizen-page__article-lead mb-4" data-i18n="kaizen_not_found_lead">The requested article could not be located.</p>
        <a href="kaizen" class="btn btn-smart" data-i18n="kaizen_not_found_cta">Back to Kaizen Hub</a>
      </div>
    </div>
  </section>

<?php else:
  // compute prev / next based on $articleOrder
  $currentIndex = array_search($slug, $articleOrder);
  $prevSlug = ($currentIndex !== false && $currentIndex > 0) ? $articleOrder[$currentIndex - 1] : null;
  $nextSlug = ($currentIndex !== false && isset($articleOrder[$currentIndex + 1])) ? $articleOrder[$currentIndex + 1] : null;
?>

  <!-- ARTICLE HERO -->
  <section class="kaizen-page__article-hero" style="--kaizen-hero:url('<?php echo htmlspecialchars($a["hero_image"]); ?>');">
    <div class="container">
      <div class="row g-4 align-items-end">
        <div class="col-lg-10">
          <div class="kaizen-page__crumbs" data-reveal>
            <a href="kaizen" data-i18n="kaizen_crumb_hub">Kaizen Hub</a>
            <span class="sep">/</span>
            <span data-i18n="kaizen_crumb_article">Article</span>
          </div>

          <h1 class="kaizen-page__article-title" data-reveal><?php echo htmlspecialchars($title); ?></h1>

          <div class="kaizen-page__article-meta" data-reveal>
            <span><i class="fa-solid fa-user me-2" style="color:var(--smart-orange)"></i><?php echo htmlspecialchars($author); ?></span>
          </div>
        </div>

        <div class="col-lg-2 text-lg-end" data-reveal>
          <a href="kaizen#articles" class="btn btn-smart btn-sm px-3 py-2" data-i18n="kaizen_back_to_hub">Back to Hub</a>
        </div>
      </div>
    </div>
  </section>

  <!-- ARTICLE BODY -->
  <section class="kaizen-page__article-body">
    <div class="container">
      <div class="row justify-content-center">
        <div class="col-12">

          <article class="kaizen-page__prose card-premium p-4 p-lg-5" data-reveal>
            <?php foreach ($body as $line): ?>
              <?php
                $trim = trim($line);

                $isHeading = (
                  ends_with($trim, ":") ||
                  preg_match('/^(Smooth Operations:|Cutting Costs, Boosting Growth:|Delighting Customers, Driving Loyalty|Embracing Innovation:|Breaking Borders:|Resilience in the Face of Disruption|Cultural and Contextual Understanding:|Cost Efficiency:|Rapid Response and Flexibility:|Building Local Capacity:|Enhanced Security and Risk Management:|Supporting Local Economies:|Success Stories:|Des opérations fluides :|Réduire les coûts, accélérer la croissance :|Satisfaire les clients, renforcer la fidélité|Adopter l’innovation :|Franchir les frontières :|Résilience face aux perturbations|Compréhension culturelle et contextuelle :|Efficience des coûts :|Réactivité et flexibilité :|Renforcement des capacités locales :|Sécurité et gestion des risques :|Soutenir les économies locales :|Retours d’expérience :)/u', $trim)
                );

                $isBullet = preg_match('/^\s*([A-ZÀ-ÖØ-Ý0-9][^\.]{0,140})(\[[0-9]+\])?\s*$/u', $trim) && (mb_strlen($trim) <= 120);
              ?>

              <?php if ($isHeading): ?>
                <h2 class="kaizen-page__h2"><?php echo htmlspecialchars($trim); ?></h2>
              <?php elseif ($isBullet): ?>
                <div class="kaizen-page__bullet">
                  <span class="dot"></span>
                  <div class="txt"><?php echo htmlspecialchars($trim); ?></div>
                </div>
              <?php else: ?>
                <p class="kaizen-page__p"><?php echo htmlspecialchars($trim); ?></p>
              <?php endif; ?>
            <?php endforeach; ?>
          </article>

          <div class="kaizen-page__nextprev d-flex gap-3 mt-4" data-reveal>
            <?php if ($prevSlug): ?>
              <a class="kaizen-page__navcard" href="kaizen-article?slug=<?php echo urlencode($prevSlug); ?>">
                <div class="label" data-i18n="kaizen_prev_label">Previous Article</div>
                <div class="title"><?php echo htmlspecialchars(($lang === 'fr') ? $articles[$prevSlug]['title_fr'] : $articles[$prevSlug]['title_en']); ?></div>
              </a>
            <?php endif; ?>

            <?php if ($nextSlug): ?>
              <a class="kaizen-page__navcard ms-auto" href="kaizen-article?slug=<?php echo urlencode($nextSlug); ?>">
                <div class="label" data-i18n="kaizen_next_label">Next Article</div>
                <div class="title"><?php echo htmlspecialchars(($lang === 'fr') ? $articles[$nextSlug]['title_fr'] : $articles[$nextSlug]['title_en']); ?></div>
              </a>
            <?php endif; ?>
          </div>

        </div>
      </div>
    </div>
  </section>

<?php endif; ?>

</main>

<?php require __DIR__ . "/partials/footer.php"; ?>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
<script src="js/app.js"></script>
</body>
</html>
