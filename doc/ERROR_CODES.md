# Error code registry

**GENERATED — do not edit by hand.** `node scripts/generate-api-docs.js`

Closes API F-5. Every `AppError` code raised anywhere in `src/`, with how often it is raised and the HTTP status it carries. There was no exported enum, so nothing prevented the 189th code — and the long tail contains near-synonyms a consumer cannot switch on.

Every error body has the same shape:

```json
{ "error": { "code": "…", "message": "…", "fields": { } }, "request_id": "…" }
```

`fields` appears on validation failures only. `request_id` is ALWAYS present — including on the tenant-gate failures, which used to omit it (F-3).

## Known near-synonyms

Recorded, deliberately NOT renamed: a code a client already switches on cannot be changed without breaking it. Prefer the canonical form in new code; the alias stays until a version boundary lets it be retired.

| Alias | Prefer | Raised |
|---|---|---|
| `BAD_AMOUNT` | `INVALID_AMOUNT` | 8× |
| `BAD_STATE` | `BAD_STATUS` | 15× |
| `EMPLOYEE_NOT_FOUND` | `NOT_FOUND` | 2× |
| `FORBIDDEN` | `PERMISSION_DENIED` | 4× |
| `NOT_A_MEMBER` | `PERMISSION_DENIED` | 2× |
| `NOT_YOURS` | `PERMISSION_DENIED` | 2× |

## All codes (224)

| Code | Status | Raised | Alias of |
|---|---|---|---|
| `2FA_NOT_IMPLEMENTED` | 501 | 1× | — |
| `AI_ACTION_FORBIDDEN` | 403 | 1× | — |
| `ALREADY_ACTED` | 422 | 1× | — |
| `ALREADY_CLOCKED_IN` | 409 | 1× | — |
| `ALREADY_CLOSED` | 422 | 2× | — |
| `ALREADY_DISPOSED` | 422 | 1× | — |
| `ALREADY_GRANTED` | 409 | 1× | — |
| `ALREADY_INSTANTIATED` | 409 | 1× | — |
| `ALREADY_RESTORED` | 409 | 1× | — |
| `ALREADY_REVERSED` | 409 | 1× | — |
| `APPROVAL_PENDING` | 422 | 1× | — |
| `ASSET_DISPOSED` | 422 | 1× | — |
| `AUTH_REQUIRED` | 401 | 13× | — |
| `BAD_ACTION` | 422 | 2× | — |
| `BAD_AMOUNT` | 422 | 8× | `INVALID_AMOUNT` |
| `BAD_APPLIES_TO` | 422 | 1× | — |
| `BAD_CODE` | 422 | 1× | — |
| `BAD_CONTEXT` | 422 | 1× | — |
| `BAD_CREDENTIALS` | 401 | 1× | — |
| `BAD_CUSTOM_FIELD` | 422 | 5× | — |
| `BAD_DECISION` | 422 | 1× | — |
| `BAD_FEE_ACCOUNT` | 422 | 1× | — |
| `BAD_FILE` | 400 | 1× | — |
| `BAD_FONT` | 422 | 3× | — |
| `BAD_IMAGE` | 400 | 5× | — |
| `BAD_INPUT` | 422 | 4× | — |
| `BAD_KIND` | 422 | 1× | — |
| `BAD_LAYOUT` | 422 | 1× | — |
| `BAD_MIRROR` | 422 | 1× | — |
| `BAD_MONTH` | 422 | 2× | — |
| `BAD_ORIGINAL` | 422 | 1× | — |
| `BAD_PARTY_KIND` | 422 | 5× | — |
| `BAD_PORTAL` | 422 | 1× | — |
| `BAD_PRINCIPAL` | 422 | 2× | — |
| `BAD_PWA_VALUE` | 422 | 2× | — |
| `BAD_RATE` | 422 | 3× | — |
| `BAD_REPLACEMENT` | 422 | 1× | — |
| `BAD_ROLE` | 422 | 1× | — |
| `BAD_SCHEME` | 422 | 2× | — |
| `BAD_SEARCH` | 422 | 1× | — |
| `BAD_SECRET` | 422 | 2× | — |
| `BAD_SENDER` | 422 | 1× | — |
| `BAD_SIGNATURE` | 422 | 1× | — |
| `BAD_STAGE` | 422 | 1× | — |
| `BAD_STATE` | 400, 409, 422 | 15× | `BAD_STATUS` |
| `BAD_STATUS` | 422 | 3× | — |
| `BAD_TEMPLATE` | 422 | 5× | — |
| `BAD_THEME` | 422 | 1× | — |
| `BAD_TOKEN` | 500 | 1× | — |
| `BAD_TOTALS` | 422 | 1× | — |
| `BAD_TRANSITION` | 422 | 2× | — |
| `BAD_VALUE` | 422 | 1× | — |
| `BAD_WINDOW` | 422 | 2× | — |
| `BREACHED_PASSWORD` | 422 | 1× | — |
| `CAMPAIGN_ENDED` | 422 | 1× | — |
| `CAPABILITY_REQUIRED` | 403 | 1× | — |
| `CLASS_MISMATCH` | 422 | 1× | — |
| `CLIENT_REQUIRED` | 422 | 2× | — |
| `CLOSE_BLOCKED` | 422 | 1× | — |
| `CODE_TAKEN` | 409 | 2× | — |
| `DATE_REQUIRED` | 422 | 1× | — |
| `DOSSIER_REQUIRED` | 422 | 1× | — |
| `DUPLICATE_CODE` | 409 | 1× | — |
| `DUPLICATE_KEY` | 422 | 1× | — |
| `EMAIL_REQUIRED` | 422 | 1× | — |
| `EMAIL_TAKEN` | 409 | 2× | — |
| `EMPLOYEE_INACTIVE` | 422 | 1× | — |
| `EMPLOYEE_NOT_FOUND` | 404, 422 | 2× | `NOT_FOUND` |
| `EMPTY_FILE` | 422 | 1× | — |
| `EMPTY_IMAGE` | 422 | 1× | — |
| `EMPTY_MESSAGE` | 422 | 1× | — |
| `ENTITY_NOT_IN_IDENTITY_SCHEMA` | — | 1× | — |
| `ENTITY_REQUIRED` | 422 | 6× | — |
| `EXISTS` | 409 | 2× | — |
| `FEATURE_DISABLED` | 403 | 1× | — |
| `FIELD_NOT_WRITABLE` | — | 1× | — |
| `FILE_TOO_LARGE` | 413 | 1× | — |
| `FORBIDDEN` | 403 | 4× | `PERMISSION_DENIED` |
| `GL_POST_FAILED` | 422, 500 | 2× | — |
| `HARD_BLOCKED` | 409 | 1× | — |
| `HAS_ACTIVITY` | 409 | 1× | — |
| `IMAGE_PROCESSING_FAILED` | 422 | 1× | — |
| `IMAGE_TOO_LARGE` | 413 | 5× | — |
| `INVALID_2FA_CODE` | 401 | 3× | — |
| `INVALID_AMOUNT` | 422 | 7× | — |
| `INVALID_CREDENTIALS` | 401 | 2× | — |
| `INVALID_DATE` | 422 | 1× | — |
| `INVALID_DAYS` | 422 | 1× | — |
| `INVALID_FIELD` | — | 1× | — |
| `INVALID_INVITE` | 400 | 1× | — |
| `INVALID_MARGIN` | 100 | 1× | — |
| `INVALID_PRICE` | 422 | 1× | — |
| `INVALID_QTY` | 422 | 2× | — |
| `INVALID_RESET_TOKEN` | 400 | 1× | — |
| `INVALID_SORT` | — | 1× | — |
| `INVALID_STATE` | 422 | 1× | — |
| `INVALID_SUBSCRIPTION` | 422 | 1× | — |
| `INVALID_TOKEN` | 401 | 10× | — |
| `INVALID_TRANSITION` | 422 | 13× | — |
| `IN_USE` | 409 | 1× | — |
| `LAST_CEO` | 409 | 2× | — |
| `LAST_ROOT_ADMIN` | 409 | 2× | — |
| `LOCKED` | 422 | 14× | — |
| `LOGIN_THROTTLED` | 429 | 1× | — |
| `METHOD_NOT_ALLOWED` | — | 1× | — |
| `MISSING_FIELDS` | 422 | 1× | — |
| `NEGATIVE_STOCK` | 422 | 1× | — |
| `NOT_ACTIVE` | 422 | 2× | — |
| `NOT_APPROVABLE` | 400 | 1× | — |
| `NOT_A_MEMBER` | 403 | 2× | `PERMISSION_DENIED` |
| `NOT_CASH_ACCOUNT` | 422 | 1× | — |
| `NOT_CONFIGURED` | 400, 422 | 2× | — |
| `NOT_CONNECTED` | 409 | 1× | — |
| `NOT_ELIGIBLE` | 403 | 3× | — |
| `NOT_ENABLED` | 400 | 1× | — |
| `NOT_FOUND` | 404 | 228× | — |
| `NOT_LEAF` | 422 | 1× | — |
| `NOT_QUALIFIED` | 422 | 1× | — |
| `NOT_READY` | 409 | 1× | — |
| `NOT_REVERSIBLE` | 422 | 1× | — |
| `NOT_SIGNED_OFF` | 422 | 1× | — |
| `NOT_YOURS` | 403 | 2× | `PERMISSION_DENIED` |
| `NO_COA` | 422 | 1× | — |
| `NO_CONTROL_ACCOUNT` | 500 | 2× | — |
| `NO_COUNTERPART` | 422 | 1× | — |
| `NO_DEBOURS_ACCOUNT` | 422 | 1× | — |
| `NO_DOC_TYPE` | 422 | 1× | — |
| `NO_DOSSIER` | 422 | 1× | — |
| `NO_EFFECTIVE_CODE` | 422 | 1× | — |
| `NO_EFFECTIVE_TAX` | 422 | 1× | — |
| `NO_EMPLOYEE` | 400, 422 | 2× | — |
| `NO_ENTITY` | 422 | 1× | — |
| `NO_ENTITY_REF` | 422 | 4× | — |
| `NO_EXPENSE_ACCOUNT` | 422 | 3× | — |
| `NO_FX_RATE` | 422 | 1× | — |
| `NO_HASH` | 422 | 1× | — |
| `NO_ITEMS` | 422 | 1× | — |
| `NO_LINES` | 422 | 6× | — |
| `NO_MODULE` | 422 | 1× | — |
| `NO_NETWORK` | 422 | 1× | — |
| `NO_OPEN_SHIFT` | 404 | 1× | — |
| `NO_PARENT` | 422 | 1× | — |
| `NO_PERIOD` | 404, 422 | 2× | — |
| `NO_POSTING_RULE` | 422 | 1× | — |
| `NO_QUOTE` | 422 | 1× | — |
| `NO_RATE` | 422 | 2× | — |
| `NO_RATE_MATCH` | 422 | 1× | — |
| `NO_RECIPIENT` | 422 | 1× | — |
| `NO_REVENUE_ACCOUNT` | 422 | 1× | — |
| `NO_SCHEDULE` | 422 | 1× | — |
| `NO_STAGES` | 422 | 1× | — |
| `NO_TARGET` | 422 | 1× | — |
| `NO_TARIFF` | 422 | 1× | — |
| `NO_TEMPLATE` | 422 | 1× | — |
| `NO_TENANT_CONTEXT` | 500 | 5× | — |
| `NO_VAT_ACCOUNT` | 422 | 2× | — |
| `OAUTH_PROBE_FAILED` | 502 | 1× | — |
| `ODOMETER_BACKWARDS` | 422 | 1× | — |
| `ORDER_LOCKED` | 422 | 1× | — |
| `OUT_OF_GEOFENCE` | 422 | 1× | — |
| `PERIOD_NOT_OPEN` | 422 | 1× | — |
| `PERMISSION_DENIED` | 403 | 6× | — |
| `PIN_LOGIN_UNAVAILABLE` | 401 | 1× | — |
| `PLAN_IN_USE` | 409 | 1× | — |
| `PORTAL_FORBIDDEN` | 403 | 1× | — |
| `PORTAL_USER_INACTIVE` | 401 | 1× | — |
| `PO_NOT_RECEIVABLE` | 422 | 1× | — |
| `PRIVILEGED_TARGET` | 403 | 1× | — |
| `PROTECTED_ROLE` | 409 | 1× | — |
| `PROVIDER_UNSUPPORTED` | 400 | 3× | — |
| `REFERENCED` | 409 | 2× | — |
| `REF_REQUIRED` | 422 | 1× | — |
| `REPORTING_CYCLE` | 422 | 2× | — |
| `REQUIRED_FIELDS_MISSING` | — | 1× | — |
| `RESTORE_NOT_SUPPORTED` | 422 | 1× | — |
| `RESULT_SET_TOO_LARGE` | 500 | 1× | — |
| `REWARD_LOCKED` | 409 | 1× | — |
| `ROLE_ESCALATION` | — | 1× | — |
| `ROLE_IN_USE` | 409 | 1× | — |
| `ROOT_LOCKED` | 409 | 1× | — |
| `RUN_EXISTS` | 409 | 1× | — |
| `RUN_LOCKED` | 422 | 1× | — |
| `SCAN_REQUIRED` | 422 | 1× | — |
| `SCOPE_CYCLE` | 422 | 2× | — |
| `SELF_APPROVAL` | 403 | 1× | — |
| `SELF_DELETE` | 409 | 1× | — |
| `SELF_GRANT_FORBIDDEN` | 403 | 1× | — |
| `SELF_ROLE_CHANGE` | 403 | 1× | — |
| `SESSION_EXPIRED` | 401 | 1× | — |
| `SESSION_REVOKED` | 401 | 8× | — |
| `SETUP_REQUIRED` | 400 | 1× | — |
| `SOURCE_DOC_REQUIRED` | 422 | 1× | — |
| `SYSTEM_ACCOUNT` | 422 | 1× | — |
| `SYSTEM_RECORD` | 422 | 1× | — |
| `SYSTEM_ROLE` | 409 | 1× | — |
| `SYSTEM_TYPE` | 422 | 1× | — |
| `TARIFF_GAP` | 422 | 1× | — |
| `TEMPLATE_NOT_PUBLISHED` | 409 | 1× | — |
| `TENANT_MISMATCH` | 400 | 1× | — |
| `TENANT_NOT_FOUND` | 404 | 1× | — |
| `TENANT_NOT_READY` | 423 | 1× | — |
| `TENANT_SUSPENDED` | 403 | 1× | — |
| `TOKEN_EXPIRED` | 401 | 1× | — |
| `UNKNOWN_DEPARTMENT` | 422 | 1× | — |
| `UNKNOWN_DOC` | 404 | 6× | — |
| `UNKNOWN_DOC_TYPE` | 422 | 1× | — |
| `UNKNOWN_EVENT_TYPE` | 400 | 1× | — |
| `UNKNOWN_FILTER` | — | 1× | — |
| `UNKNOWN_JOURNAL` | 422 | 1× | — |
| `UNKNOWN_REPORT` | 404, 422 | 4× | — |
| `UNKNOWN_STEP_REFERENCE` | 422 | 1× | — |
| `UNSUPPORTED_FORMAT` | 422 | 1× | — |
| `UNSUPPORTED_IMAGE` | 400, 415 | 5× | — |
| `USER_INACTIVE` | 401 | 3× | — |
| `VALIDATION_ERROR` | 422 | 104× | — |
| `VEHICLE_COMMITTED` | — | 1× | — |
| `VEHICLE_NOT_FOUND` | 404 | 1× | — |
| `VEHICLE_UNAVAILABLE` | 422 | 1× | — |
| `WEAK_PASSWORD` | 422 | 2× | — |
| `WRONG_ACTION_FOR_STEP` | 422 | 1× | — |
| `WRONG_AUDIENCE` | 401 | 1× | — |
| `WRONG_HOST` | — | 1× | — |
| `ZERO_LINE` | 422 | 2× | — |
| `ZERO_REPAYMENT` | 422 | 1× | — |

