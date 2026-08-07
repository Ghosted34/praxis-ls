# Error Command Center — Admin Dashboard Module

## Prompt for Development Team

---

## 1. Overview

Build a real-time error monitoring and collaboration module for the Praxis LS admin dashboard (`https://admin.praxisls.com/#/overview`). This module replaces the legacy PHP error monitor with a modern, AI-powered, collaborative tool that enables admins to:

- **Detect** errors in real-time as they occur
- **Diagnose** exact module/source with full stack trace analysis
- **Explain** errors in plain language via AI
- **Share** errors via WhatsApp, email, or in-house push notifications
- **Track** error history and trends over 30 days
- **Filter** by tenant or view platform-wide (general) errors

### Placement in Admin Dashboard

| View | What Shows |
|------|------------|
| **Overview Page** | Minimal: Uptime %, Error Rate (e.g., "3 errors today") |
| **Error Center Page** | Full KPI dashboard + error feed + all management features |

This is a **full feature set** build expected to take **4-6 weeks**.

---

## 2. Technical Architecture

### 2.1 Real-Time Communication (Hybrid Approach)

**Primary:** WebSocket via existing Socket.IO infrastructure

- Subscribe to tenant-specific error channel: `error:{tenant_id}`
- Backend emits error events immediately when logged
- Frontend receives and renders without page refresh

**Fallback:** Short polling (10-second interval)

- If WebSocket connection fails or drops, automatically switch to polling `/api/admin/errors/recent`
- Visual indicator in UI when operating in polling mode ("🔄 Live" → "📡 Polling")
- Auto-reconnect WebSocket every 30 seconds

### 2.2 Data Storage

**PostgreSQL Schema:**

```sql
CREATE TABLE admin_error_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    signature       VARCHAR(255) NOT NULL,  -- normalized hash
    level           VARCHAR(20) NOT NULL,   -- fatal, error, warning, notice, info
    message         TEXT NOT NULL,
    stack_trace     JSONB,
    module          VARCHAR(100),
    route           VARCHAR(255),
    file_path       VARCHAR(500),
    line_number     INTEGER,
    first_seen      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    occurrence_count INTEGER NOT NULL DEFAULT 1,
    resolved_at     TIMESTAMPTZ,
    resolved_by     UUID REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_errors_tenant_time ON admin_error_logs(tenant_id, last_seen DESC);
CREATE INDEX idx_errors_signature ON admin_error_logs(tenant_id, signature);
CREATE INDEX idx_errors_level ON admin_error_logs(tenant_id, level);
```

**Retention:** 30 days auto-purge via scheduled job (daily at 02:00 UTC)

### 2.3 Error Capture Points

Backend must capture errors from:

1. **NestJS Exception Filters** — global and local
2. **Unhandled Promise rejections** — process-level handler
3. **Frontend JavaScript errors** — global error handler (window.onerror, unhandledrejection)
4. **API validation failures** — Zod/DTO validation errors
5. **Database errors** — TypeORM/Prisma connection/query errors

---

## 3. UI Components

### 3.1 Main Dashboard View

Located at `/admin/error-center` route

**Layout Structure:**

```
┌─────────────────────────────────────────────────────────────────────┐
│  🔴 Live   [Filter ▾]  [Level ▾]  [Time Range ▾]  [🔍 Search]     │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐      │
│  │ 247     │ │ 12      │ │ 3       │ │ 89%     │ │ 2.3s    │      │
│  │ Total   │ │ Fatal   │ │ Unique  │ │ Resolved│ │ Avg Fix │      │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘      │
├─────────────────────────────────────────────────────────────────────┤
│  ████░░░░░░██████████████░░░░░░░░░░░░░░░░░░░░░░  24h Activity     │
│  00   04     08        12        16        20        24           │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─ [🔴 FATAL ×23] src/modules/shipments/shipment.controller.ts ─┐│
│  │  TypeError: Cannot read property 'id' of undefined             ││
│  │  Module: Shipments  |  Route: POST /api/shipments/assign        ││
│  │  Last seen: 2 min ago  |  First: 3 hours ago                  ││
│  │  ┌─ Actions ─────────────────────────────────────────────────┐ ││
│  │  │ [🤖 Explain] [📋 Copy] [🔗 Share] [✓ Resolve] [▶ Trace] │ ││
│  │  └──────────────────────────────────────────────────────────┘ ││
│  └────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  ┌─ [🟡 WARNING ×8] src/services/validator.service.ts ────────────┐│
│  │  ...                                                           ││
│  └────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Error Detail Panel (Slide-in Drawer)

When clicking an error group or "Trace" button:

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Back to list                              [✓ Mark Resolved]   │
├─────────────────────────────────────────────────────────────────┤
│  🔴 FATAL ×23                                                    │
│  ─────────────────────────────────────────────────────────────  │
│  TypeError: Cannot read property 'id' of undefined               │
│                                                                 │
│  📍 Location                                                      │
│  ├─ Primary: src/modules/shipments/shipment.controller.ts:142   │
│  ├─ Module: Shipments                                            │
│  └─ Route: POST /api/shipments/assign                            │
│                                                                 │
│  🔍 Stack Trace Analysis                                         │
│  ├─ [1] shipment.service.ts:89  → createShipment()            │
│  ├─ [2] shipment.controller.ts:142 → assignDriver()             │
│  ├─ [3] auth.middleware.ts:45     → verifyToken()              │
│  └─ [4] index.js:1               → (entry)                     │
│                                                                 │
│  🤖 AI Explanation                                              │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ This error occurs when the driver object is undefined when  ││
│  │ shipment.service.ts:89 tries to access driver.id. This      ││
│  │ typically happens when: (1) the driver lookup fails in the  ││
│  │ database, (2) the request payload is missing driverId, or   ││
│  │ (3) there's a race condition in async handling.            ││
│  │                                                             ││
│  │ Suggested fix: Add null check before accessing driver.id... ││
│  └─────────────────────────────────────────────────────────────┘│
│  [🔄 Regenerate] [📋 Copy Explanation]                          │
│                                                                 │
│  📊 Occurrences (Last 30 days)                                   │
│  ●●●●●●●○○○○○○○○○○○○○○○○○○○○○○○○○○○○○○○ 23 occurrences            │
│  ↑ Aug 1              ↑ Aug 4           ↑ Today               │
│                                                                 │
│  📋 Raw Error Sample                                             │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ TypeError: Cannot read property 'id' of undefined           ││
│  │     at createShipment (/app/src/modules/shipments/...:89)   ││
│  │     at assignDriver (/app/src/modules/shipments/...:142)    ││
│  └─────────────────────────────────────────────────────────────┘│
│  [📋 Copy Full Error] [📥 Download Trace] [🔗 Share]            │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 Share Modal

Triggered by "Share" or "🔗" button:

```
┌─────────────────────────────────────────────────────┐
│  Share Error                           [×]          │
│  ─────────────────────────────────────────────────  │
│                                                     │
│  Select sharing method:                             │
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │ 📱 WhatsApp                                   │ │
│  │     Opens wa.me with pre-filled message       │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │ ✉️ Email                                     │ │
│  │     Opens mailto with formatted subject/body  │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │ 🔔 In-House Notification                      │ │
│  │     Send to team member in Praxis LS           │ │
│  │                                              │ │
│  │     To: [Search user... ▾]                   │ │
│  │     Message: [Optional note...]               │ │
│  │                                              │ │
│  │     [🔔 Send Notification]                    │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│  ┌─ Preview ────────────────────────────────────┐ │
│  │ 📋 Plain text (for clipboard/AI):            │ │
│  │ ┌───────────────────────────────────────────┐ │ │
│  │ │ [FATAL ×23] TypeError: Cannot read...    │ │ │
│  │ │ Module: Shipments | Route: POST /api/... │ │ │
│  │ │ File: shipment.controller.ts:142         │ │ │
│  │ └───────────────────────────────────────────┘ │ │
│  │                                              │ │
│  │ [📋 Copy to Clipboard]                       │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│                         [Close]                    │
└─────────────────────────────────────────────────────┘
```

**WhatsApp Integration:**

```
wa.me/?text=URL-encoded message:
[🔴 FATAL] Cannot read property 'id' of undefined
Module: Shipments | Route: POST /api/shipments/assign
File: shipment.controller.ts:142
First seen: 3 hours ago | Occurrences: 23
🔗 https://admin.praxisls.com/admin/error-center?sig=abc123
```

**Email Integration:**

```
mailto:?subject=[PRAXXIS-LS] Fatal Error: Shipments Module
&body=formatted plain text with all error details
```

**In-House Push Notification:**

```
POST /api/admin/notifications/push
{
  "to_user_id": "uuid",
  "type": "error_escalation",
  "title": "Fatal Error in Shipments Module",
  "body": "23 occurrences | Last seen 2 min ago",
  "metadata": {
    "error_signature": "abc123",
    "error_id": "uuid",
    "module": "Shipments",
    "route": "POST /api/shipments/assign"
  }
}
```

### 3.4 Filter & Search Bar

| Control | Options | Behavior |
|---------|---------|----------|
| Status | All / Active / Resolved | Toggle |
| Level | All / Fatal / Error / Warning / Notice / Info | Multi-select |
| Time Range | Last hour / 6 hours / 24 hours / 7 days / 30 days / Custom | Dropdown + date picker |
| Module | All modules / Dropdown of detected modules | Filter by affected module |
| Search | Text input | Searches message, file path, stack trace |

---

## 4. Multi-Tenancy & Access Control

### 4.1 Error Scope

Errors fall into two categories:

| Scope | Description | Visibility |
|-------|-------------|------------|
| **Tenant-specific** | Errors from a specific tenant's operations | Filter by tenant |
| **Platform-wide** | Infrastructure, core framework, auth errors | All admins see these |

### 4.2 Filtering

- **Filter bar** includes "Scope" dropdown: `All / [Select Tenant] / Platform-wide`
- Tenant list populated from `tenants` table
- Default view: "All" (shows combined view)

### 4.3 Access Control

- All admins with `admin.errors.view` permission see **all errors** (both tenant and platform-wide)
- No module-based restrictions — admins have full visibility
- Resolution requires `admin.errors.resolve` permission
- Escalation settings require `admin.errors.configure` permission

---

## 5. Escalation Engine

### 5.1 Configurable Escalation Rules

```typescript
interface EscalationRule {
  id: string;
  tenant_id: UUID | null;  // null = platform-wide rule
  name: string;
  conditions: {
    level: ('fatal' | 'error' | 'warning')[];
    threshold_count: number;      // e.g., 5
    threshold_window_minutes: number;  // e.g., 10
  };
  actions: {
    email: boolean;
    in_house: boolean;
    webhook_url?: string;
  };
  escalation_delay_minutes: number;  // Wait before escalating
  repeat_interval_minutes: number;  // Repeat if still active
  active: boolean;
}
```

### 5.2 Admin Settings Page

Located at `/admin/error-center/settings`:

```
┌─────────────────────────────────────────────────────────────────┐
│  Error Escalation Settings                            [Save]    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─ Escalation Rule: High Error Volume ─────────────────────┐  │
│  │  When: [Fatal × 3] OR [Error × 10] within [15] minutes  │  │
│  │  Then: [✓ Email] [✓ In-house]                           │  │
│  │  After: [0] minutes delay                               │  │
│  │  Repeat every: [60] minutes if still active              │  │
│  │  [✓ Active] [Delete]                                    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  [+ Add New Rule]                                              │
│                                                                 │
│  ┌─ Email Recipients ──────────────────────────────────────┐  │
│  │  [email@example.com] [×]                                 │  │
│  │  [dev-oncall@company.com] [×]                           │  │
│  │  [+ Add Email]                                          │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.3 Escalation Flow

1. Error matches rule conditions
2. Wait for `escalation_delay_minutes`
3. If conditions still met, trigger actions:
   - **Email**: Send to configured recipients with error summary
   - **In-house**: Create notification for on-call team
   - **Webhook**: POST to configured URL (Slack, PagerDuty, etc.)
4. If error persists, repeat after `repeat_interval_minutes`

---

## 6. Backend API Endpoints

### 4.1 WebSocket Events

**Server → Client:**

```typescript
// New error event
interface ErrorEvent {
  type: 'new_error';
  payload: {
    id: string;
    signature: string;
    level: 'fatal' | 'error' | 'warning' | 'notice' | 'info';
    message: string;
    module: string;
    route: string;
    file_path: string;
    line_number: number;
    occurrence_count: number;
    first_seen: string; // ISO timestamp
    last_seen: string;
  };
}

// Error resolved event
interface ErrorResolvedEvent {
  type: 'error_resolved';
  payload: {
    signature: string;
    resolved_by: string;
    resolved_at: string;
  };
}
```

**Client → Server:**

```typescript
// Subscribe to tenant errors
{ type: 'subscribe', tenant_id: string }

// Unsubscribe
{ type: 'unsubscribe' }
```

### 4.2 REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/errors` | List errors with pagination, filtering |
| GET | `/api/admin/errors/:id` | Get single error detail |
| GET | `/api/admin/errors/recent` | Recent errors (for polling fallback) |
| POST | `/api/admin/errors/:id/resolve` | Mark error as resolved |
| POST | `/api/admin/errors/:id/explain` | Get AI explanation |
| GET | `/api/admin/errors/stats` | Dashboard statistics |
| GET | `/api/admin/errors/trends` | 30-day trend data |
| POST | `/api/admin/notifications/push` | Send in-house notification |
| GET | `/api/admin/errors/export` | Export errors (CSV/JSON) |
| GET | `/api/admin/escalation/rules` | List escalation rules |
| POST | `/api/admin/escalation/rules` | Create escalation rule |
| PUT | `/api/admin/escalation/rules/:id` | Update rule |
| DELETE | `/api/admin/escalation/rules/:id` | Delete rule |
| GET | `/api/admin/health` | System health metrics (uptime, latency) |

### 4.3 Query Parameters for GET /api/admin/errors

```typescript
interface ErrorQuery {
  page?: number;           // Default: 1
  limit?: number;          // Default: 20, Max: 100
  level?: string;          // Comma-separated: 'fatal,error,warning'
  status?: 'active' | 'resolved' | 'all';  // Default: 'active'
  module?: string;          // Filter by module name
  signature?: string;      // Specific error signature
  search?: string;         // Text search
  from?: string;           // ISO date
  to?: string;             // ISO date
  sort?: 'recent' | 'count' | 'severity';  // Default: 'recent'
}
```

---

## 7. AI Integration

### 5.1 On-Demand Explanation Flow

1. User clicks "🤖 Explain" on an error
2. Frontend sends POST `/api/admin/errors/:id/explain`
3. Backend constructs context payload:

```typescript
interface ExplainRequest {
  error_id: string;
  signature: string;
  message: string;
  stack_trace: string[];
  module: string;
  route: string;
  occurrence_count: number;
  recent_occurrences: string[]; // Last 3 timestamps
}
```

4. Backend calls AI (DeepSeek primary, Gemini fallback):

```
System prompt: "You are an expert backend developer specializing in Node.js/NestJS debugging. 
Explain this error in plain English for a non-technical ops team lead. Include:
1. What happened (one sentence)
2. Why it happened (technical cause)
3. Which module/function is responsible
4. Suggested fix (code snippet if applicable)

Format your response in clear sections. Keep explanations concise but actionable."
```

5. Response is cached in Redis with signature-based key (1-hour TTL)
6. Same error signature re-requests return cached response

### 5.2 Explanation Storage

```sql
CREATE TABLE admin_error_explanations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    error_signature VARCHAR(255) NOT NULL,
    explanation     TEXT NOT NULL,
    generated_by     VARCHAR(20) NOT NULL,  -- 'deepseek' or 'gemini'
    cached_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(error_signature)
);

CREATE TABLE admin_escalation_rules (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID REFERENCES tenants(id) ON DELETE CASCADE,
    name                        VARCHAR(100) NOT NULL,
    level_filter                VARCHAR(20)[] NOT NULL,  -- ['fatal', 'error']
    threshold_count             INTEGER NOT NULL DEFAULT 5,
    threshold_window_minutes    INTEGER NOT NULL DEFAULT 15,
    action_email                BOOLEAN NOT NULL DEFAULT TRUE,
    action_inhouse              BOOLEAN NOT NULL DEFAULT TRUE,
    action_webhook_url          VARCHAR(500),
    escalation_delay_minutes    INTEGER NOT NULL DEFAULT 0,
    repeat_interval_minutes     INTEGER NOT NULL DEFAULT 60,
    active                      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE admin_escalation_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id         UUID REFERENCES admin_escalation_rules(id) ON DELETE CASCADE,
    error_signature VARCHAR(255) NOT NULL,
    triggered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actions_taken   JSONB NOT NULL,
    resolved        BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_at     TIMESTAMPTZ
);

CREATE TABLE admin_health_metrics (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
    metric_name     VARCHAR(50) NOT NULL,  -- 'uptime', 'db_latency', 'api_latency'
    value           NUMERIC(10, 4) NOT NULL,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 8. Frontend Requirements

### 8.1 Tech Stack

- React 18 + TypeScript
- Zustand for state management (error store)
- React Query for API calls
- Socket.IO-client for WebSocket
- Tailwind CSS (matching admin dashboard theme)

### 8.2 Admin Dashboard Integration

#### Overview Page Widgets

```
┌─────────────────────────────────────────────────────────────────────┐
│  System Health                                              [Refresh]│
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐   │
│  │ 99.97%          │  │ 3 errors        │  │ ● All Systems   │   │
│  │ Uptime (30d)    │  │ Today           │  │ Operational     │   │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘   │
│                           ↑                         ↑               │
│                    Click to open                 Status from        │
│                    Error Center                  health checks       │
└─────────────────────────────────────────────────────────────────────┘
```

#### Error Center Page (`/admin/error-center`)

Full-featured error management interface (see Section 3 for all components)

### 8.3 Key Components

```
src/
├── features/
│   └── error-center/
│       ├── components/
│       │   ├── ErrorFeed.tsx           # Main real-time error list
│       │   ├── ErrorCard.tsx            # Individual error group card
│       │   ├── ErrorDetailDrawer.tsx    # Slide-in detail panel
│       │   ├── StackTraceViewer.tsx     # Collapsible stack trace
│       │   ├── AIExplanationPanel.tsx   # AI response display
│       │   ├── ShareModal.tsx           # Share modal (3 tabs)
│       │   ├── FilterBar.tsx            # Search & filter controls
│       │   ├── StatsCards.tsx           # KPI cards row
│       │   ├── ActivityChart.tsx        # 24h bar chart
│       │   ├── ConnectionStatus.tsx     # Live/Polling indicator
│       │   └── NotificationToast.tsx    # Real-time toast
│       ├── hooks/
│       │   ├── useErrorSocket.ts        # WebSocket subscription
│       │   ├── useErrorPolling.ts       # Fallback polling
│       │   ├── useErrorExplain.ts      # AI explanation hook
│       │   └── useErrorFilters.ts       # Filter state
│       ├── stores/
│       │   └── errorStore.ts            # Zustand store
│       ├── api/
│       │   └── errorsApi.ts             # API client functions
│       └── pages/
│           └── ErrorCenterPage.tsx      # Route component
├── components/admin/
│   ├── OverviewHealthWidget.tsx         # Uptime + Error rate widget
│   └── SystemStatusIndicator.tsx        # Operational/Warning/Critical
├── pages/
│   └── admin/
│       ├── ErrorCenter.tsx              # Lazy-loaded route
│       └── ErrorCenterSettings.tsx      # Escalation config page
```

### 6.3 Global Error Handler (Frontend)

```typescript
// Capture unhandled errors
window.addEventListener('error', (event) => {
  ErrorMonitor.capture({
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    stack: event.error?.stack,
  });
});

window.addEventListener('unhandledrejection', (event) => {
  ErrorMonitor.capture({
    message: 'Unhandled Promise Rejection',
    stack: event.reason?.stack || String(event.reason),
  });
});
```

---

## 9. Design Specifications

### 7.1 Color Tokens

| Severity | Background | Text | Border | Badge |
|----------|------------|------|--------|-------|
| Fatal | `#FEE2E2` | `#991B1B` | `#FECACA` | 🔴 |
| Error | `#FEF3C7` | `#92400E` | `#FDE68A` | 🟠 |
| Warning | `#FEF9C3` | `#854D0E` | `#FDE047` | 🟡 |
| Notice | `#DBEAFE` | `#1E40AF` | `#BFDBFE` | 🔵 |
| Info | `#F3F4F6` | `#374151` | `#D1D5DB` | ⚪ |

### 7.2 Typography

- **Headings:** Inter 600
- **Body:** Inter 400
- **Code/Stack Trace:** JetBrains Mono / ui-monospace
- **Error counts:** Inter 700, tabular-nums

### 7.3 Spacing

- Card padding: 16px (p-4)
- Card gap: 12px (gap-3)
- Section spacing: 24px (gap-6)

---

## 10. Performance Requirements

- **Initial load:** < 2 seconds for first 20 errors
- **Real-time latency:** < 500ms from backend log to UI render
- **AI explanation:** < 5 seconds (with loading state)
- **Stack trace parsing:** < 100ms
- **Share modal open:** < 200ms

---

## 11. Security Requirements

- Admin-only access (RBAC: `admin.errors.view`)
- Rate limiting on AI explanation endpoint (10 req/min per user)
- Error messages sanitized before storage (no PII)
- WebSocket authenticated via existing session
- Audit log for error resolutions and shares

---

## 12. Testing Requirements

- Unit tests for error parsing/normalization
- Integration tests for WebSocket events
- E2E tests for share flow (WhatsApp, email, in-house)
- AI explanation response validation
- Polling fallback simulation tests

---

## 14. Out of Scope (v1)

- Mobile-specific UI optimization
- Automatic code fix suggestions
- Error replay (click to reproduce)
- Slack/Teams native integrations (use webhook for these)

---

## 13. Acceptance Criteria

1. ✅ Errors appear in real-time without page refresh
2. ✅ Exact module and line number clearly identified
3. ✅ AI explains error in plain language on demand
4. ✅ Copy error with one click in LLM-friendly format
5. ✅ Share via WhatsApp, email, or in-house notification
6. ✅ 30-day error history with trend visualization
7. ✅ Filter by level, module, time range, **and tenant/platform-wide**
8. ✅ Graceful fallback from WebSocket to polling
9. ✅ Manual resolution with "who resolved" tracking
10. ✅ Escalation rules configurable per tenant and platform-wide
11. ✅ Email + In-house notifications triggered by rules
12. ✅ Overview shows: Uptime %, Error Rate (minimal)
13. ✅ Error Center shows: Full KPIs + detailed error management
14. ✅ Admin dashboard theme consistency

---

## Appendix A: Reference File Analysis

The legacy PHP error monitor (`reference.html`) provided these inspirations:

1. **Server-side aggregation** — group errors by signature before sending to UI
2. **Plain-text copy format** — formatted specifically for LLM pasting
3. **Multi-location tracking** — show all files where an error occurs
4. **Logging health checks** — monitor log file writability and disk space
5. **Stale detection** — alert if no errors written recently (possible logging failure)
6. **Severity bucketing** — map raw levels to severity categories
7. **"What it means" explanations** — human-readable error descriptions
8. **Multi-select copy** — copy multiple errors at once

All of these patterns should inform the design of this module.

---

## Appendix B: Share Modal Message Templates

**WhatsApp:**
```
🔴 [PRAXXIS-LS] Fatal Error Detected

❗ Error: {message}
📦 Module: {module}
🔗 Route: {route}
📄 Location: {file}:{line}
⏱ Occurred: {first_seen}
🔁 Count: {occurrence_count}

🔗 View in Admin: {admin_url}
```

**Email Subject:**
```
[PRAXXIS-LS] [{level}] {module} — {message_truncated}
```

**Email Body:**
```
Error Level: {level}
Module: {module}
Route: {route}
File: {file}:{line}
First Occurrence: {first_seen}
Recent Occurrence: {last_seen}
Occurrence Count: {occurrence_count}

Stack Trace:
{stack_trace}

View in Admin Dashboard:
{admin_url}
```

**In-House Notification:**
```
Title: [{level}] {module}
Body: {message_truncated} — {occurrence_count} occurrences
Metadata: {error_id, signature, route}
```

---

*Document Version: 1.0*
*Created: 2026-08-06*
*For: Praxis LS Development Team*
