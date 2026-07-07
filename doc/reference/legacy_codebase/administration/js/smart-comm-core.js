/**
 * SMART COMM CORE v4.0 (Enterprise Edition)
 * -------------------------------------------------------------------------
 * @author      JBS Praxis / Development Team
 * @description The central nervous system for Smart LS Communication.
 * Handles Real-time messaging, Heartbeat Polling, System Notifications,
 * Tab Hijacking, and Optimistic UI updates.
 * -------------------------------------------------------------------------
 * * FEATURES:
 * 1. Float-to-Top: Users with unread messages sort to the top of the DM list.
 * 2. System Notifications: Native browser Push API for background alerts.
 * 3. Tab Hijacker: Modifies document.title to alert users in other tabs.
 * 4. Critical Ack: Interactive buttons for CRITICAL message compliance.
 * 5. Horizontal Scroll: Compact user list logic.
 */

(function () {
    // --- 1. GLOBAL SAFETY CHECK ---
    // Prevent double-execution if script is loaded twice by mistake.
    if (window.__smartCommInitialized) return;
    window.__smartCommInitialized = true;

    // --- 2. CONFIGURATION ---
    const CONFIG = {
        API_URL: '../../api/chat_controller.php',
        CORE_CHANNELS: ['SMART LS', 'FINANCE', 'OPERATIONS', 'SALES', 'MANAGEMENT'],
        HEARTBEAT_MS: 10000,       // Global check every 10s
        CHAT_POLL_MS: 3000,        // Active chat refresh every 3s
        SEARCH_DEBOUNCE_MS: 400,   // Delay before searching
        PAGE_TITLE_ORIGINAL: document.title,
        SOUND_ENABLED: true
    };

    // --- 3. APP STATE MANAGEMENT ---
    let appState = {
        mode: 'CHANNELS',          // 'CHANNELS' or 'DM'
        currentChannelId: null,    // ID of the currently open chat
        lastMessageId: 0,          // ID of the last loaded message (for efficient fetching)
        isSending: false,          // Lock to prevent double-submit
        
        // Timers
        pollTimer: null,           // The active chat poller
        heartbeatTimer: null,      // The global notification poller
        searchTimer: null,         // The typing delay timer
        titleBlinkTimer: null,     // The tab title blinker
        
        // Notifications
        hasPermission: false,      // Browser notification permission status
        lastUnreadCount: 0         // Memory of last count to detect NEW messages
    };

    // --- 4. DOM ELEMENT CACHE ---
    const UI = {
        tabs: document.getElementById('channelTabs'),
        feed: document.getElementById('chatFeed'),
        input: document.getElementById('chatInput'),
        urgency: document.getElementById('urgencySelect'),
        badge: document.getElementById('commBadge'),
        title: document.getElementById('commDrawerTitle'),
        btnChannels: document.getElementById('commModeChannels'),
        btnDm: document.getElementById('commModeDm'),
        search: document.getElementById('commSearch'),
        backdrop: document.getElementById('commBackdrop')
    };

    // --- 5. INITIALIZATION SEQUENCE ---
    document.addEventListener('DOMContentLoaded', () => {
        // Critical dependency check
        if (!UI.tabs || !UI.feed || !UI.input) {
            console.error('SmartComm: Critical DOM elements missing. Chat disabled.');
            return;
        }

        // A. Request Notification Permissions immediately
        if ('Notification' in window && Notification.permission !== 'granted') {
            Notification.requestPermission().then(p => {
                appState.hasPermission = (p === 'granted');
            });
        } else if (Notification.permission === 'granted') {
            appState.hasPermission = true;
        }

        // B. Bind Event Listeners
        
        // 1. Enter Key to Send
        UI.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        // 2. Intelligent Search (Debounced)
        if (UI.search) {
            UI.search.addEventListener('input', (e) => {
                const query = e.target.value.trim();
                
                clearTimeout(appState.searchTimer);
                appState.searchTimer = setTimeout(() => {
                    if (appState.mode === 'DM') {
                        // In DM mode, search calls the backend API
                        handleUserSearch(query);
                    } else {
                        // In Channel mode, search filters the DOM nodes
                        handleMessageFilter(query);
                    }
                }, CONFIG.SEARCH_DEBOUNCE_MS);
            });
        }

        // 3. Mode Switchers
        if (UI.btnChannels) UI.btnChannels.addEventListener('click', () => switchMode('CHANNELS'));
        if (UI.btnDm) UI.btnDm.addEventListener('click', () => switchMode('DM'));

        // C. Start Background Processes
        startHeartbeat();

        // D. Load Default View
        switchMode('CHANNELS');
    });


    // =========================================================================
    // SECTION A: VIEW MANAGEMENT (MODES)
    // =========================================================================

    function switchMode(newMode) {
        appState.mode = newMode;
        appState.currentChannelId = null;
        appState.lastMessageId = 0;
        
        stopChatPolling(); // Stop asking for messages from the old channel

        // Visual Updates
        if (UI.btnChannels) UI.btnChannels.classList.toggle('active', newMode === 'CHANNELS');
        if (UI.btnDm) UI.btnDm.classList.toggle('active', newMode === 'DM');

        // Reset Feed & Inputs
        UI.feed.innerHTML = '';
        UI.tabs.innerHTML = '';
        if (UI.search) {
            UI.search.value = '';
            UI.search.placeholder = (newMode === 'DM') 
                ? 'Type to find colleague...' 
                : 'Filter current messages...';
        }

        // Load Content based on Mode
        if (newMode === 'CHANNELS') {
            if (UI.title) UI.title.textContent = 'Communication Hub';
            loadCoreChannels();
        } else {
            if (UI.title) UI.title.textContent = 'Direct Messages';
            // IMPORTANT: Loads the user list immediately (The "Float to Top" list)
            loadUserList(); 
        }
    }

    // =========================================================================
    // SECTION B: CHANNELS & USERS LOADING
    // =========================================================================

    // --- B1. Load Public Channels ---
    async function loadCoreChannels() {
        UI.tabs.innerHTML = renderSkeleton();
        try {
            const res = await fetch(`${CONFIG.API_URL}?action=list_channels`);
            const json = await res.json();
            
            // Filter: Only show channels defined in CONFIG.CORE_CHANNELS
            const channels = (json.data || []).filter(c => 
                CONFIG.CORE_CHANNELS.includes(c.name.toUpperCase())
            );

            UI.tabs.innerHTML = '';
            if (!channels.length) {
                UI.tabs.innerHTML = '<div class="small text-danger p-2">No channels available.</div>';
                return;
            }

            channels.forEach(c => {
                const btn = document.createElement('button');
                btn.className = 'channel-box';
                btn.textContent = c.name;
                btn.onclick = () => openChannel(c.id, c.name);
                UI.tabs.appendChild(btn);
            });

            // Auto-open first channel for convenience
            if (channels[0]) openChannel(channels[0].id, channels[0].name);

        } catch (e) {
            UI.tabs.innerHTML = '<div class="small text-danger p-2">Connection failed.</div>';
        }
    }

    function openChannel(id, name) {
        appState.currentChannelId = id;
        appState.lastMessageId = 0;
        
        // Update active class
        document.querySelectorAll('.channel-box').forEach(b => {
            b.classList.toggle('active', b.textContent === name);
        });

        UI.feed.innerHTML = ''; // clear old chat
        startChatPolling();     // begin fetching new messages
    }

    // --- B2. Load User List (The DM Logic) ---
    // This calls 'list_users' which is sorted by Unread > Recency > Name
    async function loadUserList() {
        UI.tabs.innerHTML = renderSkeleton();
        try {
            const res = await fetch(`${CONFIG.API_URL}?action=list_users`);
            const json = await res.json();
            
            UI.tabs.innerHTML = '';
            if (json.data && json.data.length > 0) {
                json.data.forEach(u => {
                    const btn = document.createElement('button');
                    btn.className = 'channel-box text-start';
                    
                    // Unread Badge Logic inside the user button
                    let badgeHtml = '';
                    if (u.unread_count > 0) {
                        badgeHtml = `<span class="badge bg-danger rounded-pill ms-1" style="font-size:0.6rem">${u.unread_count}</span>`;
                        btn.style.borderColor = 'var(--bs-danger)'; // Highlight the box border
                        btn.style.backgroundColor = 'rgba(220, 53, 69, 0.05)';
                    }

                    btn.innerHTML = `
                        <div class="d-flex align-items-center justify-content-between w-100">
                            <span>${escapeHtml(u.full_name)}</span>
                            ${badgeHtml}
                        </div>
                        <div class="small">${escapeHtml(u.department)}</div>
                    `;
                    
                    btn.onclick = () => openDmChat(u.user_id, u.full_name);
                    UI.tabs.appendChild(btn);
                });
            } else {
                UI.tabs.innerHTML = '<div class="small text-muted p-2">No users found.</div>';
            }
        } catch (e) {
            UI.tabs.innerHTML = '<div class="small text-danger p-2">List failed.</div>';
        }
    }

    // --- B3. Search Users (Autofill) ---
    async function handleUserSearch(query) {
        if (query.length < 2) {
            loadUserList(); // If user clears search, revert to the Sorted List
            return;
        }

        UI.tabs.innerHTML = renderSkeleton();
        try {
            const res = await fetch(`${CONFIG.API_URL}?action=search_users&q=${encodeURIComponent(query)}`);
            const json = await res.json();

            UI.tabs.innerHTML = '';
            if (json.data && json.data.length > 0) {
                json.data.forEach(u => {
                    const btn = document.createElement('button');
                    btn.className = 'channel-box text-start';
                    btn.innerHTML = `<div>${escapeHtml(u.full_name)}</div><div class="small">${escapeHtml(u.department)}</div>`;
                    btn.onclick = () => openDmChat(u.user_id, u.full_name);
                    UI.tabs.appendChild(btn);
                });
            } else {
                UI.tabs.innerHTML = '<div class="small text-muted p-2">No users found.</div>';
            }
        } catch (e) {
            UI.tabs.innerHTML = '<div class="small text-danger p-2">Search Error</div>';
        }
    }

    async function openDmChat(targetId, name) {
        try {
            const res = await fetch(`${CONFIG.API_URL}?action=open_dm&target_user_id=${targetId}`);
            const json = await res.json();
            
            if (json.status === 'success') {
                if (UI.title) UI.title.textContent = `DM: ${name}`;
                appState.currentChannelId = json.data.channel_id;
                appState.lastMessageId = 0;
                UI.feed.innerHTML = '';
                startChatPolling();
            }
        } catch (e) {
            alert('Could not open DM.');
        }
    }

    // =========================================================================
    // SECTION C: MESSAGING ENGINE
    // =========================================================================

    function startChatPolling() {
        stopChatPolling();
        fetchMessages(); // Immediate fetch
        appState.pollTimer = setInterval(fetchMessages, CONFIG.CHAT_POLL_MS);
    }

    function stopChatPolling() {
        if (appState.pollTimer) clearInterval(appState.pollTimer);
    }

    async function fetchMessages() {
        if (!appState.currentChannelId) return;

        try {
            const url = `${CONFIG.API_URL}?action=fetch&channel_id=${appState.currentChannelId}&last_id=${appState.lastMessageId}`;
            const res = await fetch(url);
            const json = await res.json();

            if (json.status === 'success' && json.data.length > 0) {
                renderMessages(json.data);
                appState.lastMessageId = json.data[json.data.length - 1].id;
                
                // If local filter is active, re-apply it to new messages
                if (UI.search && UI.search.value && appState.mode === 'CHANNELS') {
                    handleMessageFilter(UI.search.value);
                }
            }
        } catch (e) { /* silent fail on network glitch */ }
    }

    async function sendMessage() {
        if (appState.isSending) return;
        const text = UI.input.value.trim();
        if (!text || !appState.currentChannelId) return;

        appState.isSending = true;
        const urgency = UI.urgency ? UI.urgency.value : 'NORMAL';

        try {
            const res = await fetch(`${CONFIG.API_URL}?action=send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    channel_id: appState.currentChannelId,
                    message: text,
                    urgency: urgency
                })
            });

            const json = await res.json();
            if (json.status === 'success') {
                UI.input.value = '';
                fetchMessages(); // Instant refresh
            }
        } catch (e) {
            alert('Failed to send message. Check network.');
        } finally {
            appState.isSending = false;
        }
    }

    // =========================================================================
    // SECTION D: RENDERING & ACKNOWLEDGMENT
    // =========================================================================

    function renderMessages(msgs) {
        msgs.forEach(msg => {
            const isMine = msg.is_mine;
            const urgency = msg.urgency;
            const isAck = (msg.acknowledged_at !== null);

            let rowClass = `msg-row ${isMine ? 'mine' : ''}`;
            
            // Critical logic: Pulse if Critical AND Not Acknowledged
            if (urgency === 'CRITICAL' && !isAck) {
                rowClass += ' critical'; 
            }

            // Badge HTML
            let badgeHtml = '';
            if (urgency === 'URGENT') badgeHtml = '<div class="urgency-badge urgency-urgent">URGENT</div>';
            if (urgency === 'CRITICAL') badgeHtml = '<div class="urgency-badge urgency-critical">CRITICAL</div>';

            // Ack Button Logic
            let ackHtml = '';
            if (urgency === 'CRITICAL') {
                if (isAck) {
                    ackHtml = `<div class="mt-2 text-success small fw-bold"><i class="fa-solid fa-check-double"></i> Acknowledged</div>`;
                } else if (!isMine) {
                    // I am receiver, I need to ACK
                    ackHtml = `
                        <button class="btn btn-sm btn-outline-danger mt-2 fw-bold w-100" 
                                onclick="window.smartCommAck(${msg.id}, this)">
                            <i class="fa-regular fa-square-check"></i> ACKNOWLEDGE
                        </button>`;
                } else {
                    // I am sender, waiting for ACK
                    ackHtml = `<div class="mt-2 text-muted small fst-italic">Waiting for acknowledgment...</div>`;
                }
            }

            const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(msg.full_name)}&background=231F20&color=fff`;

            const div = document.createElement('div');
            div.className = rowClass;
            div.innerHTML = `
                <img src="${avatarUrl}" class="msg-avatar">
                <div class="msg-content" style="max-width: 85%;">
                    ${badgeHtml}
                    <div class="msg-bubble">
                        <div class="fw-bold mb-1" style="font-size:0.8rem; opacity:0.8">${escapeHtml(msg.full_name)}</div>
                        <div style="white-space: pre-wrap;">${escapeHtml(msg.message_text)}</div>
                        ${ackHtml}
                    </div>
                    <div class="msg-meta">${msg.time}</div>
                </div>
            `;

            UI.feed.appendChild(div);
        });

        // Scroll to bottom
        UI.feed.scrollTop = UI.feed.scrollHeight;
    }

    // =========================================================================
    // SECTION E: GLOBAL HEARTBEAT & NOTIFICATIONS
    // =========================================================================

    function startHeartbeat() {
        setInterval(async () => {
            // Don't pulse if drawer is already open (Assume user is looking)
            if (document.body.classList.contains('chat-active')) {
                resetPageTitle(); // Stop blinking if open
                return;
            }

            try {
                // Cache Buster (_t) ensures browser doesn't serve old data
                const res = await fetch(`${CONFIG.API_URL}?action=heartbeat&_t=${new Date().getTime()}`);
                const json = await res.json();
                
                if (json.status === 'success') {
                    const count = parseInt(json.unread);
                    
                    // 1. Update Red Badge
                    if (UI.badge) {
                        if (count > 0) {
                            UI.badge.textContent = count > 9 ? '9+' : count;
                            UI.badge.style.display = 'flex';
                        } else {
                            UI.badge.style.display = 'none';
                        }
                    }

                    // 2. Trigger Notifications if count INCREASED
                    if (count > 0 && count > appState.lastUnreadCount) {
                        triggerSystemNotification(count);
                        startTitleBlink(count);
                    }

                    // 3. Reset title if count drops to 0 (user read messages elsewhere)
                    if (count === 0 && appState.lastUnreadCount > 0) {
                        resetPageTitle();
                    }

                    appState.lastUnreadCount = count;
                }
            } catch (e) { /* silent fail */ }
        }, CONFIG.HEARTBEAT_MS);
    }

    // --- Browser Push Notification ---
    function triggerSystemNotification(count) {
        if (appState.hasPermission) {
            new Notification('Smart LS Communication', {
                body: `You have ${count} new unread message(s).`,
                icon: 'https://cdn-icons-png.flaticon.com/512/3119/3119338.png', // Generic Chat Icon
                tag: 'smart-ls-chat' // Prevents notification stacking
            });
        }
    }

    // --- Tab Hijacker (Blinking Title) ---
    function startTitleBlink(count) {
        if (appState.titleBlinkTimer) clearInterval(appState.titleBlinkTimer);
        
        let isOriginal = true;
        appState.titleBlinkTimer = setInterval(() => {
            document.title = isOriginal 
                ? `🔴 (${count}) NEW MESSAGE` 
                : CONFIG.PAGE_TITLE_ORIGINAL;
            isOriginal = !isOriginal;
        }, 1500); // Toggle every 1.5 seconds
    }

    function resetPageTitle() {
        if (appState.titleBlinkTimer) {
            clearInterval(appState.titleBlinkTimer);
            appState.titleBlinkTimer = null;
        }
        document.title = CONFIG.PAGE_TITLE_ORIGINAL;
    }

    // =========================================================================
    // SECTION F: GLOBAL EXPORTS & HELPERS
    // =========================================================================

    // Expose Send function to HTML onclick
    window.sendMessage = sendMessage;

    // Expose Acknowledge function to HTML onclick
    window.smartCommAck = async function(msgId, btn) {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        try {
            const formData = new FormData();
            formData.append('message_id', msgId);
            
            const res = await fetch(`${CONFIG.API_URL}?action=acknowledge`, {
                method: 'POST',
                body: formData
            });
            const json = await res.json();

            if (json.status === 'success') {
                // Optimistic Update
                const row = btn.closest('.msg-row');
                if (row) row.classList.remove('critical');
                btn.outerHTML = `<div class="mt-2 text-success small fw-bold"><i class="fa-solid fa-check-double"></i> Acknowledged</div>`;
            } else {
                btn.innerHTML = 'Error';
            }
        } catch (e) {
            btn.innerHTML = 'Retry';
        }
    };

    // Client-side Filter
    function handleMessageFilter(val) {
        const term = val.toLowerCase();
        const rows = UI.feed.querySelectorAll('.msg-row');
        rows.forEach(r => {
            r.style.display = r.textContent.toLowerCase().includes(term) ? 'flex' : 'none';
        });
    }

    function renderSkeleton() {
        return `<div class="channel-skeleton"></div><div class="channel-skeleton"></div><div class="channel-skeleton"></div>`;
    }

    function escapeHtml(text) {
        if (!text) return '';
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

})();