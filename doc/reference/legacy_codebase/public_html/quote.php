<?php
// quote.php - Public Client Facing Proposal Portal
$token = $_GET['token'] ?? '';
// In Phase 4, we will use this token to query the DB directly if needed, 
// but the UI relies on the API endpoint fetching data via this token.
?>
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Proposition Commerciale | Smart Logistics</title>
    
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&family=Montserrat:wght@400;700;800;900&display=swap" rel="stylesheet">
    
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            theme: {
                extend: {
                    fontFamily: { 
                        sans: ['Manrope', 'sans-serif'],
                        serif: ['Montserrat', 'serif']
                    },
                    colors: {
                        smart: {
                            dark: '#055B83',   /* Deep Blue */
                            light: '#1F99D8',  /* Light Blue */
                            orange: '#EE7D04', /* Smart Orange */
                            canvas: '#F0F4F8',
                            charcoal: '#231F20'
                        }
                    }
                }
            }
        }
    </script>

    <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">

    <style>
        body { background-color: #F0F4F8; color: #231F20; -webkit-print-color-adjust: exact; }
        
        /* Multi-Page A4 Styling */
        #document-capture { display: flex; flex-direction: column; gap: 2rem; align-items: center; padding: 2rem 0; }
        
        .a4-page {
            width: 210mm;
            height: 297mm;
            background: #FFFFFF;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
            position: relative;
            box-sizing: border-box;
            overflow: hidden;
            flex-shrink: 0;
            display: flex;
            flex-direction: column;
        }

        /* Print formatting */
        @media print {
            body { background: white; margin: 0; padding: 0; }
            .no-print { display: none !important; }
            #document-capture { gap: 0; padding: 0; display: block; }
            .a4-page { box-shadow: none; margin: 0; page-break-after: always; height: 297mm; }
        }

        .pdf-table th { border-bottom: 2px solid #055B83; color: #055B83; }
        .pdf-table td { border-bottom: 1px solid #E5E7EB; }
        .bg-smart-pattern { background-image: radial-gradient(#E5E7EB 1px, transparent 1px); background-size: 20px 20px; }
        
        /* Custom Scrollbar */
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: #F0F4F8; }
        ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
    </style>
</head>
<body class="min-h-screen flex flex-col font-sans selection:bg-smart-orange selection:text-white">

    <nav class="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-40 shadow-sm no-print">
        <div class="max-w-7xl mx-auto flex justify-between items-center">
            <div class="flex items-center gap-4">
                <img src="/assets/img-webp/logo-smart.webp" alt="Smart Logistics Logo" class="h-10 w-auto object-contain" onerror="this.src='https://via.placeholder.com/150x50?text=SMART+LOGISTICS'">
                <div>
                    <h1 class="text-xl font-extrabold text-smart-dark leading-tight">Smart Logistics & Services</h1>
                    <span class="text-xs text-gray-500 font-bold uppercase tracking-widest" id="nav-ref">Loading...</span>
                </div>
            </div>

            <div class="flex items-center gap-3">
                <div class="bg-gray-100 p-1 rounded-lg border border-gray-200 flex">
                    <button onclick="APP.setLang('fr')" id="btn-lang-fr" class="px-4 py-1.5 text-sm font-bold rounded-md bg-white shadow-sm text-smart-dark transition-all">FR</button>
                    <button onclick="APP.setLang('en')" id="btn-lang-en" class="px-4 py-1.5 text-sm font-bold rounded-md text-gray-500 hover:text-gray-900 transition-all">EN</button>
                </div>

                <div class="h-8 w-px bg-gray-200 mx-2"></div>

                <button onclick="APP.generatePDF()" id="btn-download" class="flex items-center gap-2 px-6 py-2 bg-smart-orange text-white rounded-lg font-bold text-sm hover:bg-[#d06b03] transition-all shadow-md">
                    <i class="fas fa-file-pdf"></i> <span id="lbl_btn_pdf">Download PDF</span>
                </button>
            </div>
        </div>
    </nav>

    <main class="flex-1 w-full overflow-y-auto">
        <div id="document-capture">
            </div>
    </main>

    <script>
        const APP = (function() {
            let apiData = null;
            let currentLang = 'fr';

            // --- BILINGUAL DICTIONARY ---
            const dict = {
                en: {
                    slogan: "Going beyond your expectations...",
                    btn_pdf: "Download PDF",
                    cover_title: "Commercial Proposal",
                    cover_prep_for: "Prepared For:",
                    cover_prep_by: "Prepared By:",
                    meta_ref: "Reference",
                    meta_date: "Date",
                    hdr_profile: "Company Profile & Context",
                    hdr_expertise: "Your Business Operations & Our Expertise",
                    hdr_services: "Service Highlights",
                    hdr_commercial: "Commercial Offer",
                    hdr_sla: "SLAs & Commitments",
                    hdr_terms: "Terms & Conditions",
                    sec1_title: "1. Executive Summary",
                    sec1_p1: "We are pleased to present this Corporate Partnership Proposal, outlining a strategic collaboration between SMART LOGISTICS & SERVICES LTD and your esteemed organization. Our goal is to leverage our logistics and supply chain management expertise to enhance your operations.",
                    sec2_title: "2. About Smart Logistics and Services Ltd",
                    sec2_body: "We view logistics as a strategic driver of trade, growth, and competitiveness. Beyond merely moving cargo, we deliver control, visibility, and reliable execution within complex operating environments. Headquartered in Douala, we serve as a critical gateway to the CEMAC region and the broader African market. We empower international organizations, multinationals, and project-driven operations demanding disciplined processes, strict regulatory compliance, and dependable last-mile delivery. As Africa enters an era of enhanced economic integration via the African Continental Free Trade Area, the demand for efficient freight forwarding, customs brokerage, and coordinated transport is rapidly intensifying. Smart Logistics & Services Ltd is strategically positioned to meet this demand. We are actively building the systems, expertise, and strategic partnerships necessary to facilitate seamless cross-border trade. Our ambition is to be a premier logistics authority and the preferred gateway for international commerce, driven by a dynamic culture of innovation, continuous improvement, and social responsibility.",
                    miss_title: "Mission",
                    miss_body: "Our mission is to revolutionize the logistics landscape by delivering tailored solutions that consistently exceed customer expectations. We foster a dynamic environment that inspires our team to provide unparalleled service and innovative supply chain strategies.",
                    vis_title: "Vision",
                    vis_body: "Our vision is to reign supreme as the logistics leaders of choice, setting the gold standard for excellence in Cameroon and the CEMAC subregion. We aspire to be the benchmark against which all others are measured.",
                    val_title: "Core Values",
                    val_body: "Customer Satisfaction | Innovation | Team Empowerment | Excellence | Ethics",
                    sec3_title: "3. Proven Track Record",
                    case1_title: "Energy Interconnection Project (Cameroon - Chad)",
                    case1_body: "Awarded preferred vendor status by Larsen & Toubro for the 225 kV interconnection project (SONATREL). We managed 250+ TEUs from India, securing highly competitive freight rates and reducing transit time by 15 days through optimal routing. Customs clearances were completed in 72 hours.",
                    case2_title: "UNFPA - PMTCT Pharmaceutical Logistics",
                    case2_body: "Managed air and sea freight shipments for the PETVISIDAME project. Successfully delivered 100+ cartons of pharmaceuticals and logistics equipment in reefer containers. Navigated complex suspensive customs regimes specifically designed for UN cargo.",
                    case3_title: "Heavy Equipment Re-exportation",
                    case3_body: "Facilitated the re-exportation of heavy machinery and logistics accessories under temporary admission for FMA SERVICES CONSTRUCTIONS to ports in Ivory Coast and Mayotte.",
                    sec4_title: "4. Service Highlight",
                    srv_desc: "Based on your specific routing requirements, our dedicated team will execute this operation leveraging our specialized expertise.",
                    why_us_title: "Why Choose Us?",
                    why_us_list: "<li><strong>Smart Track Platform:</strong> Gain complete visibility of your cargo in real-time. Simply enter your file reference at www.smartls.cm/smart-track to monitor your shipments from origin to destination.</li><li><strong>Global Network & Alliances:</strong> Strategic alliances with top shipping lines (MAERSK, MSC, CMA-CGM) and active membership in the JCTrans network and WCA in progress.</li><li><strong>Robust Infrastructure:</strong> Access to highly secured warehousing facilities totaling 2000+ sqm² in Douala and Kribi, coupled with a transport management network of over 150 trucks and flatbeds carriers.</li><li><strong>Specialized Expertise:</strong> Proven capability in handling special equipment, heavy machinery, and navigating complex suspensive customs regimes.</li><li><strong>Cost Efficiency & Reliability:</strong> Highly competitive pricing and proven diligence in execution, ensuring smooth project workflows without compromising quality.</li>",
                    sec5_title: "5. Financial Breakdown",
                    tbl_desc: "Description of Service/Charge",
                    tbl_qty: "Qty",
                    tbl_price: "Unit Rate",
                    tbl_total: "Total",
                    tbl_grand: "Total Estimated Value:",
                    tbl_note: "* Note: All rates are exclusive of VAT. Customs duties, taxes, and specific disbursements are considered 'TBD' (To Be Determined) and will be billed at cost based on actual official receipts according to the specificities of the shipment.",
                    sec6_title: "6. SLAs & Commitments",
                    sla_customs: "Customs Clearance Target",
                    sla_transit: "Estimated Transit Time",
                    sla_free: "Free Days",
                    sla_pay: "Payment Conditions",
                    sla_val: "Offer Validity",
                    sec7_title: "7. General Terms & Conditions",
                    tc_1: "<strong>Invoicing & Disbursements:</strong> Disbursements such as carrier fees, port terminal charges, and customs duties must be pre-financed or paid immediately upon presentation of the proforma to avoid demurrage, unless specific credit lines are established.",
                    tc_2: "<strong>Liability & Insurance:</strong> Smart Logistics acts as an agent and is subject to the standard trading conditions of the freight forwarding industry. Cargo insurance is highly recommended as our liability is limited to standard industry carriage terms.",
                    tc_3: "<strong>Offer Validity:</strong> The rates quoted in this proposal are valid as specified in the SLAs, subject to fluctuations in carrier tariffs, exchange rates, and statutory government surcharges.",
                    tc_4: "<strong>Force Majeure:</strong> We shall not be held liable for any delay or failure in performance resulting directly or indirectly from acts of nature, forces, or causes beyond our reasonable control, including but not limited to port strikes, extreme weather, or regulatory lock-downs.",
                    sig_smart: "For Smart Logistics & Services:",
                    sig_client: "Agreed & Accepted (The Client):",
                    hdr_context: "Business Understanding",
                    hdr_strategy: "Operational Strategy",
                    sig_date: "Date & Stamp:"
                    
                },
                fr: {
                    slogan: "Going Beyond Your Expectations...",
                    btn_pdf: "Télécharger PDF",
                    cover_title: "Proposition Commerciale",
                    cover_prep_for: "Préparé pour :",
                    cover_prep_by: "Préparé par :",
                    meta_ref: "Référence",
                    meta_date: "Date",
                    hdr_profile: "Profil & Contexte",
                    hdr_expertise: "Vos Opérations & Notre Expertise",
                    hdr_services: "Focus Service",
                    hdr_commercial: "Offre Commerciale",
                    hdr_sla: "Engagements & SLA",
                    hdr_terms: "Conditions & Signatures",
                    sec1_title: "1. Contexte",
                    sec1_p1: "Nous sommes heureux de présenter cette Proposition de Partenariat. Cette offre vise à favoriser une collaboration stratégique entre SMART LOGISTICS ET SERVICES LTD et votre structure, en nous appuyant sur notre expertise pour optimiser votre chaîne d'approvisionnement.",
                    sec2_title: "2. À Propos de Smart Logistics et Services Ltd",
                    sec2_body: "Nous considérons la logistique comme un levier stratégique de croissance et de compétitivité. Au-delà de la simple transaction, nous apportons contrôle, visibilité et exécution fiable dans des environnements complexes. Depuis notre siège à Douala, véritable porte d'entrée vers la CEMAC et le marché africain, nous accompagnons multinationales, organisations internationales et autres grands projets exigeant rigueur, conformité réglementaire et fiabilité jusqu'au bout de la chaîne. Avec l’essor de la Zone de libre-échange continentale africaine (ZLECAf), les flux transfrontaliers s'intensifient, accroissant le besoin de solutions de transit, de dédouanement et de transport hautement coordonnées. C’est ici que Smart Logistics & Services Ltd se distingue. Nous bâtissons les systèmes, l’expertise et les partenariats stratégiques indispensables pour fluidifier les échanges interrégionaux. Notre ambition : devenir une autorité logistique de premier plan et le partenaire privilégié du commerce international, en permettant à nos clients d'opérer et de croître en toute confiance.",
                    miss_title: "Mission",
                    miss_body: "Notre mission est de redéfinir le paysage logistique en offrant des solutions sur mesure qui surpassent les attentes de nos clients. Nous cultivons un environnement dynamique qui inspire nos équipes à concevoir des stratégies innovantes.",
                    vis_title: "Vision",
                    vis_body: "Notre vision est de nous imposer comme le partenaire logistique de référence, en définissant les standards d’excellence au Cameroun et dans toute la sous-région CEMAC. Nous aspirons à devenir la mesure de toute réussite dans notre secteur.",
                    val_title: "Valeurs Fondamentales",
                    val_body: "Satisfaction client | Innovation | Valorisation de l'équipe | Excellence | Ethiques",
                    sec3_title: "3. Projets de Référence",
                    case1_title: "Projet d'interconnexion électrique (Cameroun - Tchad)",
                    case1_body: "Désigné fournisseur privilégié par Larsen & Toubro pour le projet 225 kV (SONATREL). Gestion de plus de 250 EVP depuis l'Inde, réalisant des économies majeures sur le fret et réduisant le temps de transit de 15 jours grâce à notre optimisation. Dédouanement en 72 heures en moyenne.",
                    case2_title: "UNFPA - Logistique Pharmaceutique",
                    case2_body: "Gestion du fret maritime et aérien pour le projet PETVISIDAME. Livraison réussie de plus de 100 cartons de produits pharmaceutiques en conteneurs frigorifiques. Gestion optimale des régimes douaniers suspensifs de l'ONU.",
                    case3_title: "Réexportation d'Engins Lourds",
                    case3_body: "Facilitation de la réexportation de machines lourdes en admission temporaire pour FMA SERVICES CONSTRUCTIONS vers les ports d'Abidjan et de Mayotte.",
                    sec4_title: "4. Focus Opérationnel",
                    srv_desc: "Conformément à vos exigences logistiques, notre équipe dédiée exécutera cette opération en s'appuyant sur notre expertise technique ciblée.",
                    why_us_title: "Pourquoi Nous Choisir ?",
                    why_us_list: "<li><strong>Plateforme Smart Track :</strong> Obtenez une visibilité totale de vos mouvements de fret en temps réel. Entrez simplement votre référence de dossier sur www.smartls.cm/smart-track pour suivre vos expéditions de l'origine à la destination.</li><li><strong>Réseau Mondial et Alliances :</strong> Alliances stratégiques avec les principales compagnies maritimes (MAERSK, MSC, CMA-CGM) et adhésion active au réseau JCTrans et WCA en cours.</li><li><strong>Infrastructure Solide :</strong> Accès à des installations d'entreposage sécurisées totalisant 2000+ m² à Douala et Kribi, associées à un réseau de gestion des transports de plus de 150 camions et porte-chars .</li><li><strong>Expertise Spécialisée :</strong> Capacité éprouvée dans la gestion d'équipements spéciaux, de machines lourdes et dans la navigation de régimes douaniers suspensifs complexes.</li><li><strong>Rentabilité et Fiabilité :</strong> Tarification hautement compétitive et diligence prouvée dans l'exécution, assurant des flux de projets fluides sans compromettre la qualité.</li>",
                    sec5_title: "5. Détail de l'Offre Financière",
                    tbl_desc: "Désignation (Service/Frais)",
                    tbl_qty: "Qté",
                    tbl_price: "Prix Unitaire",
                    tbl_total: "Montant Total",
                    tbl_grand: "Valeur Totale Estimée :",
                    tbl_note: "* Note : Tous les tarifs s'entendent Hors Taxes (HT). Les droits de douane, taxes et débours spécifiques sont notés 'À définir' (TBD) et seront facturés au réel sur la base des quittances officielles selon les spécificités du dossier.",
                    sec6_title: "6. Accord de Niveau de Service (SLA)",
                    sla_customs: "Objectif Dédouanement",
                    sla_transit: "Temps de Transit Estimé",
                    sla_free: "Jours de Franchise (Demurrage)",
                    sla_pay: "Conditions de Paiement",
                    sla_val: "Validité de l'Offre",
                    sec7_title: "7. Conditions Générales",
                    tc_1: "<strong>Débours et Taxes :</strong> Les débours douaniers, frais de terminaux et transporteurs doivent être préfinancés à la présentation de la proforma pour éviter les surestaries, sauf si des lignes de crédit spécifiques ont été établies.",
                    tc_2: "<strong>Responsabilité et Assurance :</strong> Smart Logistics agit en tant que commissionnaire et est soumis aux conditions standards de l'industrie. Une assurance marchandise est vivement recommandée, notre responsabilité étant limitée aux conditions standards de transport.",
                    tc_3: "<strong>Validité de l'Offre :</strong> Les tarifs proposés sont valides selon les SLA indiqués, sous réserve de fluctuations des tarifs des transporteurs, des taux de change et des surcharges gouvernementales.",
                    tc_4: "<strong>Force Majeure :</strong> Nous ne serons pas tenus responsables des retards ou défaillances résultant directement ou indirectement de cas de force majeure, y compris les grèves portuaires, conditions météorologiques extrêmes ou restrictions réglementaires.",
                    sig_smart: "Pour Smart Logistics & Services :",
                    sig_client: "Bon pour Accord (Le Client) :",
                    hdr_context: "Compréhension du Besoin",
                    hdr_strategy: "Stratégie Opérationnelle",
                    sig_date: "Date et Cachet :"
                }
            };

            function get(key) { return dict[currentLang][key]; }
            function fmtCur(n) { return new Intl.NumberFormat(currentLang === 'fr' ? 'fr-FR' : 'en-US').format(n); }
            function fmtDate(d) { return new Date(d).toLocaleDateString(currentLang === 'fr' ? 'fr-FR' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric'}); }

            // --- FETCH LIVE DATA ---
            async function fetchProposalData() {
                const urlParams = new URLSearchParams(window.location.search);
                const token = urlParams.get('token');
                
                if(!token) { alert('No token provided.'); return; }
            
                try {
                    // Absolute path ensures it always finds the API regardless of URL structure
                    const res = await fetch(`/administration/api/public_quote_api.php?token=${token}`);
                    const result = await res.json();
                
                    if(result.success) {
                    apiData = result.data;
                    document.getElementById('nav-ref').innerText = apiData.proposal.ref; // <-- FIXES THE LOADING BUG
                    apiData.proposal.grand_total = apiData.lines.reduce((acc, line) => acc + parseFloat(line.total), 0);
                    currentLang = urlParams.get('lang') || apiData.proposal.language || 'fr';
                    renderDocument();
                    } else {
                        document.getElementById('document-capture').innerHTML = `<h2 class="text-center text-red-500 mt-20 font-bold">Error: ${result.error}</h2>`;
                    }
                } catch (e) {
                    console.error("Fetch Error: ", e);
                    document.getElementById('document-capture').innerHTML = `<h2 class="text-center text-red-500 mt-20 font-bold">Failed to load proposal from server.</h2>`;
                }
            }

            // --- PAGE BUILDERS ---
            function buildHeader(title, ref) {
                return `
                <header class="h-24 bg-smart-dark text-white flex items-center px-16 justify-between shrink-0">
                    <span class="font-bold tracking-widest text-sm uppercase">${title}</span>
                    <span class="text-smart-orange font-bold font-serif">${ref}</span>
                </header>`;
            }

            function buildFooter(page, total) {
                return `
                <footer class="h-16 bg-gray-50 border-t border-gray-200 flex items-center justify-between px-16 text-xs text-gray-500 font-bold shrink-0">
                    <span class="text-smart-dark tracking-widest">SMART LOGISTICS & SERVICES LTD</span>
                    <span>Page ${page} / ${total}</span>
                </footer>`;
            }

            function renderDocument() {
                document.getElementById('btn-lang-en').className = currentLang === 'en' ? "px-4 py-1.5 text-sm font-bold rounded-md bg-white shadow-sm text-smart-dark transition-all" : "px-4 py-1.5 text-sm font-bold rounded-md text-gray-500 hover:text-gray-900 transition-all";
                document.getElementById('btn-lang-fr').className = currentLang === 'fr' ? "px-4 py-1.5 text-sm font-bold rounded-md bg-white shadow-sm text-smart-dark transition-all" : "px-4 py-1.5 text-sm font-bold rounded-md text-gray-500 hover:text-gray-900 transition-all";
                document.getElementById('lbl_btn_pdf').innerText = get('btn_pdf');

                const p = apiData.proposal;
                const c = apiData.client;
                const container = document.getElementById('document-capture');
                container.innerHTML = '';
                
                let pagesHTML = [];

                // --- PAGE 1: COVER ---
                pagesHTML.push(`
                <div class="a4-page bg-smart-pattern">
                    <div class="absolute top-0 right-0 w-64 h-64 bg-smart-light rounded-bl-full opacity-10"></div>
                    <div class="absolute bottom-0 left-0 w-96 h-96 bg-smart-dark rounded-tr-full opacity-10"></div>
                    
                    <div class="flex-1 flex flex-col px-24 py-20 z-10 h-full">
                        
                        <div class="mb-20">
                            <img src="/assets/img-webp/logo-smart.webp" onerror="this.src='https://via.placeholder.com/200x60?text=SMART+LOGISTICS'" alt="Smart Logistics" class="h-20 w-auto mb-4">
                            <p class="text-[14px] font-extrabold text-smart-light tracking-widest capitalize mb-8 italic opacity-90">${get('slogan')}</p>
                            <div class="h-2 w-32 bg-smart-orange mb-6"></div>
                            <h2 class="text-4xl font-serif font-black text-smart-dark uppercase tracking-tight">${get('cover_title')}</h2>
                        </div>

                        <div class="bg-white border-l-4 border-smart-orange p-8 mb-24 shadow-xl shadow-gray-200/50">
                            <p class="text-sm font-bold text-gray-400 uppercase tracking-widest mb-2">${get('cover_prep_for')}</p>
                            <h3 class="text-3xl font-black text-smart-dark mb-1">${c.company}</h3>
                            <p class="text-gray-600 font-bold text-lg">Attn: ${c.contact}</p>
                            <p class="text-smart-light underline mt-1 font-medium">${c.email}</p>
                        </div>

                        <div class="mt-auto flex flex-col">
                            
                            <div class="self-end border-2 border-smart-dark rounded-lg p-3 bg-white/90 shadow-sm flex items-center gap-3 w-80 mb-6 z-20">
                                <i class="fa-solid fa-shield-halved text-4xl text-smart-dark"></i>
                                <div class="text-[9px] leading-tight text-smart-charcoal font-mono break-all text-left">
                                    <strong class="text-smart-orange uppercase text-[11px] sans-serif tracking-widest mb-1 block">Certified Proposal</strong>
                                    Signatory: ${p.rep_name}<br>
                                    Timestamp: ${p.timestamp}<br>
                                    SHA-256: ${p.hash}
                                </div>
                            </div>

                            <div class="border-t-2 border-gray-200 pt-8 flex justify-between w-full">
                                <div class="text-left">
                                    <p class="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">${get('meta_date')}</p>
                                    <p class="font-bold text-smart-dark text-lg">${fmtDate(p.date)}</p>
                                </div>
                                <div class="text-left">
                                    <p class="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">${get('meta_ref')}</p>
                                    <p class="font-bold text-smart-dark text-lg font-serif">${p.ref}</p>
                                </div>
                                <div class="text-right">
                                    <p class="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">${get('cover_prep_by')}</p>
                                    <p class="font-bold text-smart-orange text-lg">${p.rep_name}</p>
                                    <p class="text-sm text-gray-500">${p.rep_title}</p>
                                </div>
                            </div>
                            
                        </div>
                    </div>
                </div>`);

                // --- PAGE 2: EXECUTIVE SUMMARY & PROFILE ---
                pagesHTML.push(`
                <div class="a4-page">
                    ${buildHeader(get('hdr_profile'), p.ref)}
                    <div class="px-16 py-12 flex-1">
                        <h3 class="text-2xl font-serif font-black text-smart-dark mb-6">${get('sec1_title')}</h3>
                        <p class="text-[14px] text-gray-700 leading-relaxed mb-10 text-justify font-medium">${get('sec1_p1')}</p>

                        <h3 class="text-2xl font-serif font-black text-smart-dark mb-6">${get('sec2_title')}</h3>
                        <div class="grid grid-cols-2 gap-8 mb-8">
                            <p class="text-[14px] text-gray-700 leading-relaxed text-justify font-medium">${get('sec2_body')}</p>
                            
                            <div class="bg-smart-canvas p-6 rounded-xl border border-gray-200 flex flex-col gap-5">
                                <div>
                                    <h4 class="font-bold text-smart-orange mb-1 uppercase tracking-widest text-xs">${get('miss_title')}</h4>
                                    <p class="text-sm font-bold text-smart-dark leading-relaxed">${get('miss_body')}</p>
                                </div>
                                <div>
                                    <h4 class="font-bold text-smart-orange mb-1 uppercase tracking-widest text-xs">${get('vis_title')}</h4>
                                    <p class="text-sm font-bold text-smart-dark leading-relaxed">${get('vis_body')}</p>
                                </div>
                                <div>
                                    <h4 class="font-bold text-smart-orange mb-1 uppercase tracking-widest text-xs">${get('val_title')}</h4>
                                    <p class="text-sm font-bold text-smart-dark leading-relaxed">${get('val_body')}</p>
                                </div>
                            </div>
                            
                        </div>
                    </div>
                    ${buildFooter(2, 7)}
                </div>`);

                const n = apiData.narrative; // Retrieve AI Narrative data

                // --- PAGE 3: CLIENT CONTEXT (70%) & RELEVANT CASE STUDY (30%) ---
                let contextText = currentLang === 'en' ? (n?.context_en || get('sec1_p1')) : (n?.context_fr || get('sec1_p1'));
                contextText = contextText.replace(/\n/g, '<br><br>');

                // Dynamically load the AI-generated Case Study
                let caseTitle = currentLang === 'en' ? (n?.case_title_en || get('case1_title')) : (n?.case_title_fr || get('case1_title'));
                let caseBody = currentLang === 'en' ? (n?.case_body_en || get('case1_body')) : (n?.case_body_fr || get('case1_body'));

                pagesHTML.push(`
                <div class="a4-page">
                    ${buildHeader(get('hdr_expertise'), p.ref)}
                    <div class="px-16 py-12 flex-1 flex flex-col">
                        <div class="mb-auto">
                            <h3 class="text-2xl font-serif font-black text-smart-dark mb-6">${get('hdr_context')}</h3>
                            <p class="text-[14px] text-gray-700 leading-relaxed text-justify font-medium">${contextText}</p>
                        </div>
                        
                        <div class="mt-8">
                            <h3 class="text-xl font-serif font-black text-smart-dark mb-4">Notre Expertise Pertinente</h3>
                            <div class="border-l-4 border-smart-orange pl-6 bg-smart-canvas p-4 rounded-r-xl shadow-sm">
                                <h4 class="text-md font-bold text-smart-dark mb-2">${caseTitle}</h4>
                                <p class="text-[13px] text-gray-600 leading-relaxed text-justify font-medium">${caseBody}</p>
                            </div>
                        </div>
                    </div>
                    ${buildFooter(3, 7)}
                </div>`);

                // --- PAGE 4: DYNAMIC OPERATIONAL STRATEGY ---
                let strategyText = currentLang === 'en' ? (n?.strategy_en || get('srv_desc')) : (n?.strategy_fr || get('srv_desc'));
                strategyText = strategyText.replace(/\n/g, '<br><br>');

                pagesHTML.push(`
                <div class="a4-page">
                    ${buildHeader(get('hdr_services'), p.ref)}
                    <div class="px-16 py-12 flex-1">
                        <h3 class="text-2xl font-serif font-black text-smart-dark mb-6">${get('sec4_title')} : <span class="text-smart-orange">${p.service_category}</span></h3>
                        
                        <div class="bg-smart-dark text-white p-6 rounded-xl mb-8 shadow-lg">
                            <div class="grid grid-cols-2 gap-4 text-sm">
                                <div><span class="text-smart-light font-bold uppercase tracking-widest text-[10px]">Origin</span><br><span class="font-bold text-md">${p.origin || 'N/A'}</span></div>
                                <div><span class="text-smart-light font-bold uppercase tracking-widest text-[10px]">Destination</span><br><span class="font-bold text-md">${p.dest || 'N/A'}</span></div>
                                <div><span class="text-smart-light font-bold uppercase tracking-widest text-[10px]">Incoterm</span><br><span class="font-bold text-md">${p.incoterm}</span></div>
                                <div><span class="text-smart-light font-bold uppercase tracking-widest text-[10px]">Cargo</span><br><span class="font-bold text-md">${p.desc}</span></div>
                            </div>
                        </div>

                        <h3 class="text-xl font-serif font-black text-smart-dark mb-4">${get('hdr_strategy')}</h3>
                        <p class="text-[14px] text-gray-700 leading-relaxed font-medium mb-8 text-justify">${strategyText}</p>

                        <h3 class="text-lg font-serif font-black text-smart-dark mb-3">${get('why_us_title')}</h3>
                        <ul class="space-y-2 text-[12px] text-gray-700 font-medium list-disc pl-5 marker:text-smart-orange">
                            ${get('why_us_list')}
                        </ul>
                    </div>
                    ${buildFooter(4, 7)}
                </div>`);

                // --- FLUID PAGINATION FOR COMMERCIAL TABLE ---
                const lines = apiData.lines;
                const LINES_FIRST_PAGE = 12;
                const LINES_NEXT_PAGES = 18;
                const tablePages = [];
                let currentIndex = 0;

                while (currentIndex < lines.length) {
                    const limit = (tablePages.length === 0) ? LINES_FIRST_PAGE : LINES_NEXT_PAGES;
                    tablePages.push(lines.slice(currentIndex, currentIndex + limit));
                    currentIndex += limit;
                }
                if (tablePages.length === 0) tablePages.push([]); 

                tablePages.forEach((chunk, index) => {
                    const isLastTablePage = (index === tablePages.length - 1);
                    const globalPageNum = 5 + index;

                    let tbodyHTML = chunk.map((l, i) => {
                        // TBD Logic: If rate/total is exactly 0, show TBD/À définir instead of 0 FCFA
                        let rateStr = parseFloat(l.rate) === 0 
                            ? `<span class="text-smart-orange italic text-xs">${currentLang === 'en' ? 'TBD' : 'À définir'}</span>` 
                            : fmtCur(l.rate);
                            
                        let totalStr = parseFloat(l.total) === 0 
                            ? `<span class="text-smart-orange italic text-xs">${currentLang === 'en' ? 'TBD' : 'À définir'}</span>` 
                            : fmtCur(l.total);

                        return `
                        <tr>
                            <td class="py-3 px-4 text-gray-800 font-bold text-[13px]">${l.desc}</td>
                            <td class="py-3 px-4 text-center text-gray-600 font-bold">${l.qty}</td>
                            <td class="py-3 px-4 text-right text-gray-600 font-mono">${rateStr}</td>
                            <td class="py-3 px-4 text-right text-smart-dark font-black font-mono">${totalStr}</td>
                        </tr>
                        `;
                    }).join('');

                    let tfootHTML = isLastTablePage ? `
                        <tfoot class="bg-smart-canvas">
                            <tr>
                                <td colspan="3" class="py-5 px-4 text-right font-black text-smart-dark uppercase text-xs tracking-wider">${get('tbl_grand')}</td>
                                <td class="py-5 px-4 text-right font-black text-xl text-smart-orange font-mono">${fmtCur(p.grand_total)} <span class="text-sm">${p.currency}</span></td>
                            </tr>
                        </tfoot>
                    ` : '';

                    pagesHTML.push(`
                    <div class="a4-page">
                        ${buildHeader(get('hdr_commercial'), p.ref)}
                        <div class="px-16 py-10 flex-1">
                            ${index === 0 ? `<h3 class="text-2xl font-serif font-black text-smart-dark mb-6">${get('sec5_title')}</h3>` : ''}
                            
                            <div class="rounded-xl overflow-hidden border border-gray-200">
                                <table class="w-full text-left border-collapse pdf-table">
                                    <thead class="bg-gray-100 text-xs uppercase text-gray-500 font-bold">
                                        <tr>
                                            <th class="py-4 px-4 w-[50%]">${get('tbl_desc')}</th>
                                            <th class="py-4 px-4 text-center">${get('tbl_qty')}</th>
                                            <th class="py-4 px-4 text-right">${get('tbl_price')}</th>
                                            <th class="py-4 px-4 text-right">${get('tbl_total')}</th>
                                        </tr>
                                    </thead>
                                    <tbody class="bg-white">
                                        ${tbodyHTML}
                                    </tbody>
                                    ${tfootHTML}
                                </table>
                            </div>
                            ${isLastTablePage ? `<p class="text-[11px] text-gray-400 italic mt-4">${get('tbl_note')}</p>` : ''}
                        </div>
                        ${buildFooter(globalPageNum, 7)}
                    </div>`);
                });

                // --- PAGE 6: AI-GENERATED SLAs ---
                const slaPageNum = 5 + tablePages.length;
                const aiSlas = currentLang === 'en' ? (n?.slas_en || []) : (n?.slas_fr || []);
                
                let slasHtml = '';
                if (Array.isArray(aiSlas)) {
                    slasHtml = aiSlas.map(sla => `
                        <div class="border-b-2 border-gray-100 pb-3">
                            <span class="text-smart-orange text-[10px] font-black uppercase tracking-widest block mb-1">${sla.title || 'Metric'}</span>
                            <span class="font-black text-smart-dark text-md">${sla.value || 'N/A'}</span>
                        </div>
                    `).join('');
                }

                pagesHTML.push(`
                <div class="a4-page">
                    ${buildHeader(get('hdr_sla'), p.ref)}
                    <div class="px-16 py-12 flex-1">
                        <h3 class="text-2xl font-serif font-black text-smart-dark mb-10">${get('sec6_title')}</h3>
                        
                        <div class="grid grid-cols-2 gap-x-12 gap-y-10">
                            ${slasHtml}
                            <div class="border-b-2 border-gray-100 pb-3 col-span-2 mt-4">
                                <span class="text-smart-orange text-[10px] font-black uppercase tracking-widest block mb-1">${get('sla_pay')}</span>
                                <span class="font-black text-smart-dark text-md">${p.payment}</span>
                            </div>
                            <div class="border-b-2 border-gray-100 pb-3 col-span-2">
                                <span class="text-smart-orange text-[10px] font-black uppercase tracking-widest block mb-1">${get('sla_val')}</span>
                                <span class="font-black text-smart-dark text-md">${p.validity}</span>
                            </div>
                        </div>
                    </div>
                    ${buildFooter(slaPageNum, 7)}
                </div>`);

                // --- PAGE 7: TERMS & SIGNATURES ---
                const termPageNum = slaPageNum + 1;
                pagesHTML.push(`
                <div class="a4-page">
                    ${buildHeader(get('hdr_terms'), p.ref)}
                    
                    <div class="px-16 py-12 flex-1 flex flex-col h-full">
                        <h3 class="text-2xl font-serif font-black text-smart-dark mb-6">${get('sec7_title')}</h3>
                        
                        <div class="space-y-6 text-sm text-gray-600 leading-relaxed text-justify mb-12">
                            <p>${get('tc_1')}</p>
                            <p>${get('tc_2')}</p>
                            <p>${get('tc_3')}</p>
                            <p>${get('tc_4')}</p>
                        </div>

                        <div class="mt-auto grid grid-cols-2 gap-16 pt-12 border-t-2 border-smart-orange items-start">
                            
                            <div class="flex flex-col">
                                <p class="text-xs font-black text-gray-400 uppercase tracking-widest mb-6">${get('sig_smart')}</p>
                                
                                <div class="border-4 border-blue-800 text-blue-800 p-1.5 rounded transform -rotate-3 opacity-85 w-64 bg-white shadow-sm inline-block">
                                    <div class="text-center border-2 border-blue-800 p-1 bg-blue-50/20">
                                        <div class="font-black text-[13px] tracking-wide uppercase mb-1">SMART LOGISTICS & SERVICES</div>
                                        <div class="text-[9px] font-bold uppercase border-y-2 border-blue-800 py-1 mb-1">Digitally Signed & Approved</div>
                                        <div class="text-[8px] font-mono leading-tight">
                                            By: ${p.rep_name} (${p.rep_title})<br>
                                            On: ${p.timestamp}<br>
                                            ID: ${p.hash ? p.hash.substring(0, 20) : 'Pending'}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div class="flex flex-col">
                                <p class="text-xs font-black text-gray-400 uppercase tracking-widest mb-16">${get('sig_client')}</p>
                                
                                <div class="border-b border-gray-300 w-full mb-3"></div>
                                <p class="font-black text-smart-dark text-sm">${c.company}</p>
                                <p class="text-xs text-gray-500 font-bold">Authorized Signatory</p>
                                <p class="text-xs text-gray-400 mt-1">${get('sig_date')}</p>
                            </div>
                            
                        </div>
                    </div>
                    
                    <footer class="h-20 bg-smart-dark flex flex-col items-center justify-center px-16 text-xs text-white shrink-0 font-bold">
                        <p class="tracking-widest">SMART LOGISTICS & SERVICES LTD | B.P. 5120 DOUALA, CAMEROON</p>
                        <p class="text-smart-orange mt-1">1030, Avenue Douala Manga Bell | info@smartls.cm</p>
                    </footer>
                </div>`);
                container.innerHTML = pagesHTML.join('');
            }

            function setLang(lang) {
                currentLang = lang;
                renderDocument();
            }

            async function generatePDF() {
                const btn = document.getElementById('btn-download');
                const originalHTML = btn.innerHTML;
                btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Processing...`;
                btn.classList.add('opacity-75', 'cursor-not-allowed');

                try {
                    const pdf = new jspdf.jsPDF('p', 'mm', 'a4');
                    const pdfWidth = pdf.internal.pageSize.getWidth();
                    const pdfHeight = pdf.internal.pageSize.getHeight();
                    
                    const pages = document.querySelectorAll('.a4-page');

                    for (let i = 0; i < pages.length; i++) {
                        const canvas = await html2canvas(pages[i], {
                            scale: 2, 
                            useCORS: true,
                            logging: false,
                            backgroundColor: '#FFFFFF'
                        });

                        const imgData = canvas.toDataURL('image/jpeg', 1.0);
                        
                        if (i > 0) pdf.addPage();
                        pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
                    }

                    pdf.save(`Smart_Logistics_Quote_${apiData.proposal.ref}.pdf`);

                } catch (error) {
                    console.error("PDF Generation failed:", error);
                    alert("Error generating PDF. Please try on a desktop browser.");
                } finally {
                    btn.innerHTML = originalHTML;
                    btn.classList.remove('opacity-75', 'cursor-not-allowed');
                }
            }

            // --- EXPOSE PUBLIC METHODS (Properly closed IIFE) ---
            return {
                init: fetchProposalData,
                setLang,
                generatePDF
            };
        })();

        window.onload = APP.init;
    </script>
</body>
</html>