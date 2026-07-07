<?php
// index.php - Standalone Glassmorphic Success Stories Portfolio
// Location: /home/smartqaq/public_html/success-stories/index.php
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Our Track Record | Smart Logistics Showcase</title>
    
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&family=Montserrat:wght@200;400;700;800;900&display=swap" rel="stylesheet">
    
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
                            dark: '#055B83',   
                            light: '#1F99D8',  
                            orange: '#EE7D04', 
                        }
                    },
                    animation: {
                        'fade-in-up': 'fadeInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards',
                        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                    },
                    keyframes: {
                        fadeInUp: {
                            '0%': { opacity: 0, transform: 'translateY(40px)' },
                            '100%': { opacity: 1, transform: 'translateY(0)' },
                        }
                    }
                }
            }
        }
    </script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    
    <style>
        /* Immersive Reset */
        html, body { height: 100%; margin: 0; background-color: #000; overflow: hidden; color: #fff; }
        
        /* Hidden but accessible scrollbar for the glass panels */
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.2); border-radius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(238, 125, 4, 0.8); }

        /* The Dynamic Ambient Background */
        #ambient-bg {
            position: absolute; inset: -5%; z-index: 0;
            background-size: cover; background-position: center;
            filter: blur(8px) brightness(0.6);
            transition: background-image 1.2s ease-in-out, filter 1.2s ease-in-out;
            transform: scale(1.05); /* Prevents blur bleeding edges */
        }
        
        /* The Moody Vignette Overlay */
        .vignette-overlay {
            position: absolute; inset: 0; z-index: 1;
            background: radial-gradient(circle at center, rgba(5, 91, 131, 0.3) 0%, rgba(0, 0, 0, 0.85) 100%);
            pointer-events: none;
        }

        /* Glassmorphism Core Classes */
        .glass-panel {
            background: rgba(255, 255, 255, 0.03);
            backdrop-filter: blur(24px);
            -webkit-backdrop-filter: blur(24px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            box-shadow: 0 30px 60px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1);
        }
        
        .glass-card {
            background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.01) 100%);
            backdrop-filter: blur(16px);
            border: 1px solid rgba(255, 255, 255, 0.08);
            transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }
        
        .glass-card:hover {
            background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.02) 100%);
            border-color: rgba(238, 125, 4, 0.5); /* Smart Orange glow */
            transform: translateY(-10px);
            box-shadow: 0 20px 40px rgba(0,0,0,0.6), 0 0 20px rgba(238, 125, 4, 0.15);
        }

        /* Loader */
        .loader { width: 48px; height: 48px; border: 3px solid rgba(255,255,255,0.1); border-radius: 50%; border-top-color: #EE7D04; animation: spin 1s ease-in-out infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
    </style>
</head>
<body class="font-sans antialiased selection:bg-smart-orange selection:text-white">

    <!-- Dynamic Background Layer -->
    <div id="ambient-bg" style="background-image: url('/assets/img-webp/services-freight-forwarding.webp');"></div>
    <div class="vignette-overlay"></div>

    <!-- Main Scrollable App Container -->
    <main id="app-root" class="relative z-10 h-full w-full overflow-y-auto overflow-x-hidden scroll-smooth pb-20"></main>

    <script>
        const PORTFOLIO = (function() {
            const root = document.getElementById('app-root');
            const ambientBg = document.getElementById('ambient-bg');
            const API_URL = '/administration/api/public_portfolio_api.php'; 
            
            // Default Masterpiece Backgrounds
            const DEFAULT_BG = '/assets/img-webp/services-freight-forwarding.webp';

            function updateBackground(imgUrl, blurAmount = '8px') {
                ambientBg.style.backgroundImage = `url('${imgUrl}')`;
                ambientBg.style.filter = `blur(${blurAmount}) brightness(0.5)`;
            }

            function showLoader() {
                root.innerHTML = `<div class="h-full w-full flex justify-center items-center"><div class="loader"></div></div>`;
            }

            function showError(msg) {
                root.innerHTML = `
                    <div class="h-full w-full flex justify-center items-center p-6">
                        <div class="glass-panel p-10 rounded-3xl text-center max-w-lg">
                            <i class="fa-solid fa-triangle-exclamation text-smart-orange text-5xl mb-6 animate-pulse-slow"></i>
                            <h2 class="text-2xl font-serif font-bold text-white mb-2">Transmission Lost</h2>
                            <p class="text-gray-400 mb-8">${msg}</p>
                            <a href="?" class="px-8 py-3 bg-white/10 hover:bg-smart-orange text-white text-sm font-bold tracking-widest uppercase rounded-full transition-all border border-white/20 hover:border-smart-orange backdrop-blur-md">Return to Showcase</a>
                        </div>
                    </div>`;
            }

            // --- VIEW 1: THE IMMERSIVE GRID ---
            async function renderGrid() {
                showLoader();
                updateBackground(DEFAULT_BG, '12px'); // Heavier blur for the grid view
                
                try {
                    const res = await fetch(`${API_URL}?action=get_all_stories`);
                    const json = await res.json();

                    if (!json.success) throw new Error(json.error || 'Failed to load records.');

                    let html = `
                        <div class="max-w-7xl mx-auto px-6 pt-24 pb-12 opacity-0 animate-fade-in-up">
                            <div class="text-center mb-20">
                                <img src="/assets/img-webp/logo-smart.webp" alt="Smart Logistics" class="h-10 mx-auto mb-6 opacity-80" onerror="this.style.display='none'">
                                <h1 class="text-4xl md:text-6xl font-serif font-black text-white mb-4 tracking-tighter drop-shadow-lg">Execution.<br><span class="text-transparent bg-clip-text bg-gradient-to-r from-smart-light to-smart-orange">Perfected.</span></h1>
                                <p class="text-lg text-gray-300 max-w-2xl mx-auto font-light tracking-wide">A curated portfolio of complex supply chain challenges solved through discipline, infrastructure, and strategic partnerships.</p>
                            </div>
                    `;

                    if (json.data.length === 0) {
                        html += `<div class="text-center py-20 text-gray-400 font-light tracking-widest uppercase">Initializing Secure Archives... Check back soon.</div>`;
                    } else {
                        html += `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">`;
                        
                        json.data.forEach((story, index) => {
                            const delay = index * 0.1; // Staggered animation
                            const coverImg = story.cover_image_path || DEFAULT_BG;
                            
                            const brandingHtml = story.client_logo_path 
                                ? `<img src="${story.client_logo_path}" class="h-6 w-auto object-contain brightness-0 invert opacity-70" alt="Client">` 
                                : `<span class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">${story.client_name || 'Confidential'}</span>`;

                            html += `
                                <a href="?slug=${story.slug}" class="glass-card rounded-2xl overflow-hidden group block text-decoration-none opacity-0" style="animation: fadeInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) ${delay}s forwards;">
                                    <div class="relative h-60 overflow-hidden">
                                        <div class="absolute inset-0 bg-smart-dark/20 group-hover:bg-transparent transition-all z-10"></div>
                                        <img src="${coverImg}" class="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110 opacity-70 group-hover:opacity-100" alt="Cover">
                                        <div class="absolute bottom-4 left-4 z-20 flex items-center gap-3">
                                            <div class="bg-black/50 backdrop-blur-md text-white text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full border border-white/10">
                                                ${story.service_category}
                                            </div>
                                        </div>
                                    </div>
                                    <div class="p-8 flex flex-col">
                                        <div class="flex justify-between items-center mb-6">
                                            ${brandingHtml}
                                            <span class="text-[10px] font-medium text-gray-500 uppercase tracking-widest">${story.publish_date}</span>
                                        </div>
                                        <h3 class="text-xl font-serif font-bold text-white mb-6 leading-snug group-hover:text-smart-orange transition-colors">${story.title}</h3>
                                        <div class="mt-auto pt-6 border-t border-white/10 flex items-center justify-between text-gray-400 text-xs font-bold uppercase tracking-widest group-hover:text-white transition-colors">
                                            <span>Access File</span>
                                            <i class="fa-solid fa-arrow-right-long transform group-hover:translate-x-2 transition-transform"></i>
                                        </div>
                                    </div>
                                </a>
                            `;
                        });
                        html += `</div>`;
                    }
                    html += `</div>`;
                    root.innerHTML = html;

                } catch (e) {
                    showError(e.message);
                }
            }

            // --- VIEW 2: THE DETAILED MASTERPIECE ---
            async function renderDetail(slug) {
                showLoader();
                try {
                    const res = await fetch(`${API_URL}?action=get_story_details&slug=${slug}`);
                    const json = await res.json();

                    if (!json.success) throw new Error(json.error || 'Archive corrupted or missing.');
                    
                    const story = json.data;
                    const coverImg = story.cover_image_path || DEFAULT_BG;
                    
                    // Shift the background to match the project, reduce blur to make it feel closer
                    updateBackground(coverImg, '4px');

                    // KPIs - Glass Pills
                    let kpisHtml = '';
                    if (story.hard_kpis && story.hard_kpis.length > 0) {
                        kpisHtml = `<div class="grid grid-cols-2 gap-4 mt-8">`;
                        story.hard_kpis.forEach(kpi => {
                            kpisHtml += `
                                <div class="bg-white/5 border border-white/10 rounded-xl p-5 backdrop-blur-md hover:bg-white/10 transition-colors">
                                    <span class="block text-[10px] font-medium text-smart-orange uppercase tracking-widest mb-2">${kpi.label}</span>
                                    <span class="block text-2xl font-serif font-light text-white">${kpi.value}</span>
                                </div>
                            `;
                        });
                        kpisHtml += `</div>`;
                    }

                    // Gallery - Masonry feel
                    let galleryHtml = '';
                    if (story.gallery_images && story.gallery_images.length > 0) {
                        galleryHtml = `
                            <div class="mt-16 pt-12 border-t border-white/10">
                                <h3 class="text-xs font-bold text-gray-400 uppercase tracking-widest mb-6">Visual Evidence</h3>
                                <div class="grid grid-cols-2 gap-4">
                        `;
                        story.gallery_images.forEach(img => {
                            galleryHtml += `
                                <div class="aspect-video rounded-xl overflow-hidden bg-black/50 border border-white/10 group cursor-pointer relative">
                                    <div class="absolute inset-0 bg-smart-orange/20 opacity-0 group-hover:opacity-100 transition-opacity z-10 mix-blend-overlay"></div>
                                    <img src="${img}" class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105 opacity-80 group-hover:opacity-100" alt="Operation Asset">
                                </div>`;
                        });
                        galleryHtml += `</div></div>`;
                    }

                    // Layout injected into the DOM
                    root.innerHTML = `
                        <div class="max-w-6xl mx-auto px-4 md:px-8 pt-12 pb-24 opacity-0 animate-fade-in-up">
                            
                            <!-- Floating Navigation -->
                            <a href="?" class="inline-flex items-center gap-3 px-6 py-2 bg-black/30 backdrop-blur-md border border-white/10 rounded-full text-xs font-bold text-white uppercase tracking-widest hover:bg-smart-orange hover:border-smart-orange transition-all mb-10 shadow-xl">
                                <i class="fa-solid fa-arrow-left"></i> Archive Index
                            </a>

                            <!-- The Massive Glass Panel -->
                            <div class="glass-panel rounded-[2.5rem] p-8 md:p-16 relative overflow-hidden">
                                
                                <!-- Decorative Glow inside the panel -->
                                <div class="absolute -top-40 -right-40 w-96 h-96 bg-smart-orange/20 rounded-full blur-[100px] pointer-events-none"></div>
                                
                                <div class="flex flex-col lg:flex-row gap-16 relative z-10">
                                    
                                    <!-- Left: The Narrative -->
                                    <div class="w-full lg:w-3/5">
                                        <div class="inline-block border border-white/20 bg-white/5 backdrop-blur-sm text-[10px] font-black text-smart-light uppercase tracking-widest px-3 py-1 rounded-full mb-6">
                                            ${story.service_category}
                                        </div>
                                        
                                        <h1 class="text-3xl md:text-5xl font-serif font-black text-white leading-tight mb-12 tracking-tight drop-shadow-md">
                                            ${story.title}
                                        </h1>

                                        <div class="prose prose-invert prose-lg max-w-none">
                                            <h3 class="text-sm font-bold text-smart-orange uppercase tracking-widest mb-4 border-b border-white/10 pb-2 inline-block">The Challenge</h3>
                                            <div class="text-gray-300 font-light leading-relaxed mb-12 text-[15px] whitespace-pre-line">${story.exec_summary}</div>
                                            
                                            <h3 class="text-sm font-bold text-smart-orange uppercase tracking-widest mb-4 border-b border-white/10 pb-2 inline-block">Strategic Execution</h3>
                                            <div class="text-gray-300 font-light leading-relaxed text-[15px] whitespace-pre-line">${story.ops_execution}</div>
                                        </div>

                                        ${galleryHtml}
                                    </div>

                                    <!-- Right: The Metrics & Info -->
                                    <div class="w-full lg:w-2/5">
                                        <div class="sticky top-10">
                                            
                                            <div class="mb-10">
                                                <p class="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3">Partner Identity</p>
                                                ${story.client_logo_path 
                                                    ? `<img src="${story.client_logo_path}" class="h-12 w-auto object-contain brightness-0 invert opacity-90" alt="Client Logo">` 
                                                    : `<h2 class="text-xl font-serif font-bold text-white">${story.client_name || 'Classified Partner'}</h2>`
                                                }
                                            </div>

                                            <div class="border-t border-white/10 pt-8">
                                                <h3 class="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                                                    <i class="fa-solid fa-crosshairs text-smart-orange"></i> Extracted Parameters
                                                </h3>
                                                ${kpisHtml}
                                            </div>

                                            <!-- Silent Call to Action -->
                                            <div class="mt-16 p-8 bg-gradient-to-br from-smart-dark/40 to-black/40 border border-smart-light/20 rounded-2xl text-center">
                                                <i class="fa-solid fa-shield-halved text-smart-light text-3xl mb-4 opacity-50"></i>
                                                <h4 class="text-white font-serif font-bold mb-2">Require Similar Execution?</h4>
                                                <p class="text-xs text-gray-400 mb-6">Our command center is ready to architect your logistics framework.</p>
                                                <a href="/contact" class="inline-block w-full py-3 bg-white text-black font-black rounded-xl hover:bg-smart-orange hover:text-white transition-colors text-[11px] uppercase tracking-widest">
                                                    Initiate Dialogue
                                                </a>
                                            </div>

                                        </div>
                                    </div>

                                </div>
                            </div>
                        </div>
                    `;
                } catch (e) {
                    showError(e.message);
                }
            }

            // --- Router Initialization ---
            function init() {
                const urlParams = new URLSearchParams(window.location.search);
                const slug = urlParams.get('slug');
                
                if (slug) {
                    document.title = "Classified File | Smart Logistics";
                    renderDetail(slug);
                } else {
                    renderGrid();
                }
            }

            return { init };
        })();

        document.addEventListener('DOMContentLoaded', PORTFOLIO.init);
    </script>
</body>
</html>