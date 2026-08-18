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
| `BAD_STATE` | `BAD_STATUS` | 28× |
| `EMPLOYEE_NOT_FOUND` | `NOT_FOUND` | 2× |
| `FORBIDDEN` | `PERMISSION_DENIED` | 6× |
| `NOT_A_MEMBER` | `PERMISSION_DENIED` | 2× |
| `NOT_YOURS` | `PERMISSION_DENIED` | 2× |

## All codes (381)

| Code | Status | Raised | Alias of |
|---|---|---|---|
| `2FA_NOT_IMPLEMENTED` | 501 | 1× | — |
| `ACTUALS_LOCKED` | — | 1× | — |
| `AI_ACTION_FORBIDDEN` | 403 | 1× | — |
| `AI_UNAVAILABLE` | 403, 503 | 4× | — |
| `ALREADY_ACTED` | 422 | 1× | — |
| `ALREADY_ANSWERED` | 409 | 1× | — |
| `ALREADY_APPROVED` | 422 | 2× | — |
| `ALREADY_CLOCKED_IN` | 409 | 1× | — |
| `ALREADY_CLOSED` | 422 | 2× | — |
| `ALREADY_CONVERTED` | 422 | 1× | — |
| `ALREADY_DECIDED` | 422 | 2× | — |
| `ALREADY_DISPOSED` | 422 | 1× | — |
| `ALREADY_GRANTED` | 409 | 1× | — |
| `ALREADY_INSTANTIATED` | 409 | 1× | — |
| `ALREADY_MERGED` | 409 | 2× | — |
| `ALREADY_RESTORED` | 409 | 1× | — |
| `ALREADY_REVERSED` | 409 | 1× | — |
| `APPROVAL_PENDING` | 422 | 1× | — |
| `ASSET_DISPOSED` | 422 | 1× | — |
| `AUDIO_TOO_LARGE` | 413 | 1× | — |
| `AUTH_REQUIRED` | 401 | 14× | — |
| `AWAITING_DECISION` | — | 1× | — |
| `BAD_ACTION` | 422 | 2× | — |
| `BAD_AMOUNT` | 422 | 8× | `INVALID_AMOUNT` |
| `BAD_APPLIES_TO` | 422 | 1× | — |
| `BAD_AUDIO` | 400 | 3× | — |
| `BAD_AUDIO_TYPE` | — | 1× | — |
| `BAD_CODE` | 422 | 2× | — |
| `BAD_CONTEXT` | 422 | 1× | — |
| `BAD_CREDENTIALS` | 401 | 1× | — |
| `BAD_CUSTOM_FIELD` | 422 | 5× | — |
| `BAD_DECISION` | 422 | 2× | — |
| `BAD_FEE_ACCOUNT` | 422 | 1× | — |
| `BAD_FILE` | 400, 422 | 10× | — |
| `BAD_FILE_TYPE` | 422 | 6× | — |
| `BAD_FONT` | 422 | 3× | — |
| `BAD_HEADERS` | 422 | 1× | — |
| `BAD_IMAGE` | 400 | 5× | — |
| `BAD_INPUT` | 422 | 4× | — |
| `BAD_KIND` | 422 | 1× | — |
| `BAD_LAYOUT` | 422 | 1× | — |
| `BAD_LEGACY_KIND` | — | 1× | — |
| `BAD_MIRROR` | 422 | 1× | — |
| `BAD_MONTH` | 422 | 1× | — |
| `BAD_ORIGINAL` | 422 | 1× | — |
| `BAD_PARENT` | 422, 500 | 3× | — |
| `BAD_PARTY_KIND` | 422 | 9× | — |
| `BAD_PORTAL` | 422 | 1× | — |
| `BAD_PRINCIPAL` | 422 | 2× | — |
| `BAD_PWA_VALUE` | 422 | 2× | — |
| `BAD_RATE` | 422 | 3× | — |
| `BAD_REPLACEMENT` | 422 | 1× | — |
| `BAD_ROLE` | 422 | 1× | — |
| `BAD_SAVEPOINT` | 500 | 1× | — |
| `BAD_SCHEME` | 422 | 2× | — |
| `BAD_SEARCH` | 422 | 1× | — |
| `BAD_SECRET` | 422 | 2× | — |
| `BAD_SECTION` | — | 1× | — |
| `BAD_SENDER` | 422 | 1× | — |
| `BAD_SIGNATURE` | 422 | 1× | — |
| `BAD_SNAPSHOT_TARGET` | 500 | 1× | — |
| `BAD_STAGE` | 422 | 2× | — |
| `BAD_STATE` | 400, 409, 422 | 28× | `BAD_STATUS` |
| `BAD_STATUS` | 422 | 4× | — |
| `BAD_STORAGE_BUFFER` | 400 | 1× | — |
| `BAD_STORAGE_KEY` | 400 | 2× | — |
| `BAD_TEMPLATE` | 422 | 5× | — |
| `BAD_THEME` | 422 | 1× | — |
| `BAD_TOKEN` | 500 | 1× | — |
| `BAD_TOTALS` | 422 | 1× | — |
| `BAD_TRAINING_MODE` | — | 1× | — |
| `BAD_TRANSITION` | 422 | 3× | — |
| `BAD_VALUE` | 422 | 1× | — |
| `BAD_WINDOW` | 422 | 2× | — |
| `BASE_CURRENCY` | 409, 422 | 2× | — |
| `BREACHED_PASSWORD` | 422 | 1× | — |
| `CAMPAIGN_ENDED` | 422 | 1× | — |
| `CAPABILITY_REQUIRED` | 403 | 1× | — |
| `CATEGORY_INACTIVE` | 422 | 1× | — |
| `CLASS_MISMATCH` | 422 | 1× | — |
| `CLIENT_REQUIRED` | 422 | 12× | — |
| `CLOSE_BLOCKED` | 422 | 1× | — |
| `COA_IS_MANAGED` | 422 | 1× | — |
| `CODE_IN_USE` | 422 | 1× | — |
| `CODE_RESERVED` | 422 | 1× | — |
| `CODE_TAKEN` | 409 | 2× | — |
| `COLUMN_TAKEN` | 422 | 1× | — |
| `COMPLIANCE_BLOCKED` | 409 | 4× | — |
| `CONFIG_MISSING` | 424 | 1× | — |
| `CONTAINERS_DISABLED` | 422 | 1× | — |
| `CONTRACT_TEXT_FROZEN` | 422 | 1× | — |
| `COUNT_SHEET_DISAGREES` | 422 | 1× | — |
| `CURRENCY_IN_USE` | 409 | 1× | — |
| `CYCLIC_PARENT` | 422 | 2× | — |
| `DATE_REQUIRED` | 422 | 1× | — |
| `DEVICE_NOT_REGISTERED` | 422 | 1× | — |
| `DEVICE_REVOKED` | 422 | 1× | — |
| `DOC_NOT_VERIFIED` | 422 | 1× | — |
| `DOSSIERS_REQUIRED` | 422 | 1× | — |
| `DOSSIER_REQUIRED` | 422 | 1× | — |
| `DUPLICATE` | 409 | 3× | — |
| `DUPLICATE_CODE` | 409 | 2× | — |
| `DUPLICATE_CONTAINER` | 422 | 2× | — |
| `DUPLICATE_DOSSIER` | 422 | 1× | — |
| `DUPLICATE_KEY` | 422 | 2× | — |
| `DUPLICATE_ORDER` | — | 1× | — |
| `DUPLICATE_STATEMENT` | — | 1× | — |
| `EMAIL_REQUIRED` | 422 | 1× | — |
| `EMAIL_SEND_FAILED` | 502 | 1× | — |
| `EMAIL_TAKEN` | 409 | 2× | — |
| `EMPLOYEE_INACTIVE` | 422 | 1× | — |
| `EMPLOYEE_NOT_FOUND` | 404, 422 | 2× | `NOT_FOUND` |
| `EMPLOYEE_REQUIRED` | 422 | 1× | — |
| `EMPTY_AUDIO` | 422 | 3× | — |
| `EMPTY_FILE` | 422 | 1× | — |
| `EMPTY_IMAGE` | 422 | 1× | — |
| `EMPTY_MESSAGE` | 422 | 1× | — |
| `EMPTY_RECON` | 422 | 1× | — |
| `EMPTY_SET` | 422 | 1× | — |
| `EMPTY_STATEMENT` | 422 | 2× | — |
| `ENTITLEMENT_CHECK_UNAVAILABLE` | — | 1× | — |
| `ENTITLEMENT_EXCEEDED` | — | 1× | — |
| `ENTITY_NOT_IN_IDENTITY_SCHEMA` | — | 1× | — |
| `ENTITY_REQUIRED` | 422 | 9× | — |
| `EXISTS` | 409 | 3× | — |
| `FEATURE_DISABLED` | 403 | 1× | — |
| `FIELD_NOT_WRITABLE` | — | 2× | — |
| `FILE_TOO_LARGE` | 413 | 1× | — |
| `FORBIDDEN` | 403 | 6× | `PERMISSION_DENIED` |
| `GENERATION_UNAVAILABLE` | 502 | 1× | — |
| `GL_POST_FAILED` | 422, 500 | 2× | — |
| `HARD_BLOCKED` | 409 | 1× | — |
| `HAS_ACTIVITY` | 409 | 1× | — |
| `HAS_SUBSIDIARIES` | 409 | 1× | — |
| `IDEMPOTENCY_IN_PROGRESS` | 409 | 1× | — |
| `IDEMPOTENCY_KEY_INVALID` | 400 | 1× | — |
| `IDEMPOTENCY_KEY_REUSED` | 422 | 1× | — |
| `IMAGE_PROCESSING_FAILED` | 422 | 1× | — |
| `IMAGE_TOO_LARGE` | 413 | 5× | — |
| `INCOMPLETE` | — | 2× | — |
| `INCOMPLETE_APPLICATION` | 422 | 1× | — |
| `INELIGIBLE_DOSSIER` | — | 1× | — |
| `INSUFFICIENT_LEAVE` | — | 1× | — |
| `INVALID_2FA_CODE` | 401 | 3× | — |
| `INVALID_AMOUNT` | 422 | 7× | — |
| `INVALID_CREDENTIALS` | 401 | 2× | — |
| `INVALID_CURRENT_PASSWORD` | 403 | 1× | — |
| `INVALID_DATE` | 422 | 1× | — |
| `INVALID_DAYS` | 422 | 1× | — |
| `INVALID_EXTRACTION` | 422 | 1× | — |
| `INVALID_FIELD` | — | 1× | — |
| `INVALID_INVITE` | 400 | 1× | — |
| `INVALID_MARGIN` | 100 | 1× | — |
| `INVALID_PRICE` | 422 | 1× | — |
| `INVALID_PUBLIC_MEDIA` | 422 | 1× | — |
| `INVALID_QTY` | 422 | 2× | — |
| `INVALID_RESET_TOKEN` | 400 | 1× | — |
| `INVALID_SORT` | — | 1× | — |
| `INVALID_STATE` | 422 | 1× | — |
| `INVALID_SUBSCRIPTION` | 422 | 1× | — |
| `INVALID_TOKEN` | 401 | 10× | — |
| `INVALID_TRANSITION` | 422 | 23× | — |
| `IN_USE` | 409 | 2× | — |
| `ITINERARY_INVALID` | 422 | 1× | — |
| `ITINERARY_LEG_REQUIRED` | — | 1× | — |
| `JOIN_LINK_REQUIRED` | — | 1× | — |
| `KEY_IMMUTABLE` | 422 | 1× | — |
| `KPI_NOT_PARTITIONED` | 500 | 4× | — |
| `LAST_CEO` | 409 | 2× | — |
| `LAST_ROOT_ADMIN` | 409 | 2× | — |
| `LEAVE_OVERLAP` | 409 | 2× | — |
| `LEDGER_LINE_ALREADY_MATCHED` | 409 | 2× | — |
| `LOCATION_REQUIRED` | — | 1× | — |
| `LOCKED` | 422 | 30× | — |
| `LOGIN_THROTTLED` | 429 | 1× | — |
| `MAILBOX_AUTH_FAILED` | — | 1× | — |
| `MAIL_SEND_FAILED` | — | 1× | — |
| `MAINTENANCE_READ_ONLY` | 423 | 1× | — |
| `MANDATORY_ITEMS_OUTSTANDING` | 422 | 1× | — |
| `MERGE_SAME_RECORD` | 422 | 1× | — |
| `METHOD_NOT_ALLOWED` | — | 1× | — |
| `MILESTONE_MISMATCH` | 422 | 1× | — |
| `MISSING_FIELDS` | 422 | 1× | — |
| `MISSING_REQUIRED_FIELDS` | — | 1× | — |
| `NEEDS_MAPPING` | 409 | 1× | — |
| `NEGATIVE_STOCK` | 422 | 1× | — |
| `NOTHING_TO_SUMMARISE` | 422 | 1× | — |
| `NOT_ACTIVE` | 422 | 2× | — |
| `NOT_APPROVABLE` | 400 | 1× | — |
| `NOT_A_DRAFT` | 422 | 1× | — |
| `NOT_A_MEMBER` | 403 | 2× | `PERMISSION_DENIED` |
| `NOT_CASH_ACCOUNT` | 422 | 1× | — |
| `NOT_CONFIGURED` | 400 | 1× | — |
| `NOT_CONNECTED` | 409 | 1× | — |
| `NOT_DOCUMENT` | 422 | 1× | — |
| `NOT_DONE` | 422 | 1× | — |
| `NOT_EDITABLE` | 400 | 1× | — |
| `NOT_ELIGIBLE` | 403 | 3× | — |
| `NOT_ENABLED` | 400 | 1× | — |
| `NOT_FOUND` | 404 | 436× | — |
| `NOT_LEAF` | 422 | 1× | — |
| `NOT_OPEN` | 422 | 1× | — |
| `NOT_OPERATIONAL` | 422 | 1× | — |
| `NOT_PENDING` | 422 | 1× | — |
| `NOT_QUALIFIED` | 422 | 1× | — |
| `NOT_READY` | 409 | 1× | — |
| `NOT_RELEASED` | 422 | 1× | — |
| `NOT_REVERSIBLE` | 422 | 1× | — |
| `NOT_SENT` | 422 | 1× | — |
| `NOT_SIGNED_OFF` | 422 | 1× | — |
| `NOT_TREASURY_CLASS` | 422 | 2× | — |
| `NOT_YOURS` | 403 | 2× | `PERMISSION_DENIED` |
| `NO_CATEGORY` | 422 | 2× | — |
| `NO_CHANGES` | 400 | 1× | — |
| `NO_COA` | 422 | 1× | — |
| `NO_CONTROL_ACCOUNT` | 500 | 2× | — |
| `NO_COUNTERPART` | 422 | 1× | — |
| `NO_CUSTODIAN` | 422 | 2× | — |
| `NO_DISBURSEMENT_ACCOUNT` | 422 | 1× | — |
| `NO_DOC_TYPE` | 422 | 1× | — |
| `NO_DOSSIER` | 422 | 1× | — |
| `NO_EFFECTIVE_CODE` | 422 | 1× | — |
| `NO_EFFECTIVE_TAX` | 422 | 1× | — |
| `NO_EMPLOYEE` | 400, 422 | 4× | — |
| `NO_ENTITY` | 422 | 1× | — |
| `NO_ENTITY_REF` | 422 | 4× | — |
| `NO_EXPENSE_ACCOUNT` | 422 | 3× | — |
| `NO_FIELD_SET` | 422 | 1× | — |
| `NO_FINGERPRINT` | 422 | 1× | — |
| `NO_FX_RATE` | 422 | 1× | — |
| `NO_HASH` | 422 | 1× | — |
| `NO_ITEMS` | 422 | 1× | — |
| `NO_LINES` | 422 | 6× | — |
| `NO_MODULE` | 422 | 2× | — |
| `NO_NETWORK` | 422 | 1× | — |
| `NO_OPEN_SHIFT` | 404 | 1× | — |
| `NO_ORIGIN` | 422 | 1× | — |
| `NO_PARENT` | 422 | 1× | — |
| `NO_PERIOD` | 404, 422 | 2× | — |
| `NO_POSTING_RULE` | 422 | 1× | — |
| `NO_QUOTE` | 422 | 1× | — |
| `NO_RATE` | 422 | 2× | — |
| `NO_RATE_MATCH` | 422 | 1× | — |
| `NO_RECIPIENT` | 422 | 2× | — |
| `NO_REPLY_ADDRESS` | 422 | 1× | — |
| `NO_REVENUE_ACCOUNT` | 422 | 1× | — |
| `NO_SCHEDULE` | 422 | 1× | — |
| `NO_SIGNED_COPY` | 422 | 2× | — |
| `NO_TARGET` | 422 | 1× | — |
| `NO_TARIFF` | 422 | 1× | — |
| `NO_TEMPLATE` | 422 | 2× | — |
| `NO_TENANT_CONTEXT` | 500 | 5× | — |
| `NO_VAT_ACCOUNT` | 422 | 2× | — |
| `NO_WORKING_DAYS` | 422 | 1× | — |
| `OAUTH_PROBE_FAILED` | 502 | 1× | — |
| `ODOMETER_BACKWARDS` | 422 | 1× | — |
| `OPS_CODE_TAKEN` | 422 | 1× | — |
| `OPS_MARKER_EXHAUSTED` | 500 | 1× | — |
| `OPS_MARKER_TARGET_GONE` | 422 | 1× | — |
| `ORDER_LOCKED` | 422 | 1× | — |
| `OUT_OF_GEOFENCE` | 422 | 1× | — |
| `OVERRIDE_REASON_REQUIRED` | 422 | 1× | — |
| `OVERRIDE_REQUIRED` | 422 | 1× | — |
| `PARENT_POSTABLE` | 422 | 2× | — |
| `PERIOD_NOT_OPEN` | 422 | 1× | — |
| `PERMISSION_DENIED` | 403 | 6× | — |
| `PIN_LOGIN_UNAVAILABLE` | 401 | 1× | — |
| `PLACE_NAME_TAKEN` | 409 | 1× | — |
| `PLACE_NOT_STORED` | 409 | 1× | — |
| `PLACE_PROVIDER_UNAVAILABLE` | 502 | 1× | — |
| `PLACE_SUGGESTION_EXPIRED` | 409 | 1× | — |
| `PLAN_IN_USE` | 409 | 1× | — |
| `PLAN_LOCKED` | — | 1× | — |
| `POOL_EXHAUSTED` | 500 | 1× | — |
| `PORTAL_FORBIDDEN` | 403 | 1× | — |
| `PORTAL_USER_INACTIVE` | 401 | 1× | — |
| `PO_NOT_RECEIVABLE` | 422 | 1× | — |
| `PREFIX_IN_USE` | 422 | 1× | — |
| `PREFIX_TAKEN` | 422 | 1× | — |
| `PRIVILEGED_TARGET` | 403 | 1× | — |
| `PROTECTED` | 422 | 1× | — |
| `PROTECTED_ROLE` | 409 | 1× | — |
| `PROVIDER_UNSUPPORTED` | 400 | 3× | — |
| `PUBLISHED_SET` | — | 1× | — |
| `REASON_REQUIRED` | 422 | 4× | — |
| `RECONCILIATION_DOES_NOT_BALANCE` | — | 1× | — |
| `RECONCILIATION_LOCKED` | 409 | 1× | — |
| `RECON_OPEN` | 409 | 1× | — |
| `REFERENCED` | 409 | 2× | — |
| `REF_COLLISION_RETRY_EXHAUSTED` | 500 | 1× | — |
| `REF_ENTITY_REQUIRED` | 422 | 2× | — |
| `REF_IMMUTABLE` | 422 | 1× | — |
| `REF_REQUIRED` | 422 | 2× | — |
| `REF_WRITE_REQUIRED` | 500 | 1× | — |
| `REPORTING_CYCLE` | 422 | 2× | — |
| `REQUIRED_FIELDS_MISSING` | — | 1× | — |
| `RESTORE_NOT_SUPPORTED` | 422 | 1× | — |
| `RESULT_SET_TOO_LARGE` | 500 | 1× | — |
| `RETIRED_FIELD` | 422 | 1× | — |
| `REVIEWS_INCOMPLETE` | 422 | 1× | — |
| `REWARD_LOCKED` | 409 | 1× | — |
| `ROLE_ESCALATION` | — | 1× | — |
| `ROLE_IN_USE` | 409 | 1× | — |
| `ROOT_LOCKED` | 409 | 1× | — |
| `RUN_EXISTS` | 409 | 1× | — |
| `RUN_LOCKED` | 422 | 1× | — |
| `SAME_PASSWORD` | 422 | 1× | — |
| `SCANNED_PDF` | — | 1× | — |
| `SCAN_REQUIRED` | 422 | 3× | — |
| `SCOPE_CYCLE` | 422 | 2× | — |
| `SCORING_UNAVAILABLE` | 502 | 1× | — |
| `SELF_APPROVAL` | 403 | 2× | — |
| `SELF_DELETE` | 409 | 1× | — |
| `SELF_GRANT_FORBIDDEN` | 403 | 1× | — |
| `SELF_ROLE_CHANGE` | 403 | 1× | — |
| `SELF_VALIDATE` | 422 | 1× | — |
| `SENDER_NOT_AUTHORIZED` | — | 1× | — |
| `SESSION_EXPIRED` | 401 | 1× | — |
| `SESSION_REVOKED` | 401 | 8× | — |
| `SETUP_REQUIRED` | 400 | 1× | — |
| `SMTP_AUTH_FAILED` | 502 | 1× | — |
| `SMTP_SENDER_REJECTED` | 502 | 1× | — |
| `SMTP_SEND_FAILED` | 502 | 1× | — |
| `SMTP_SEND_REJECTED` | 502 | 1× | — |
| `SOP_HAS_NO_TEXT` | — | 1× | — |
| `SOURCE_DOC_REQUIRED` | 422 | 1× | — |
| `SPAM_REJECTED` | 422 | 1× | — |
| `STATEMENT_DOES_NOT_FOOT` | 409 | 1× | — |
| `STORAGE_LIMIT` | 413 | 1× | — |
| `SUPPLIER_NOT_VERIFIED` | — | 1× | — |
| `SUPPLIER_REQUIRED` | 422 | 1× | — |
| `SYSTEM_ACCOUNT` | 422 | 1× | — |
| `SYSTEM_CATEGORY` | 422 | 1× | — |
| `SYSTEM_RECORD` | 422 | 1× | — |
| `SYSTEM_ROLE` | 409 | 1× | — |
| `SYSTEM_TYPE` | 422 | 2× | — |
| `TARIFF_GAP` | 422 | 1× | — |
| `TEMPLATE_NOT_PUBLISHED` | 409 | 1× | — |
| `TENANT_MISMATCH` | 400 | 1× | — |
| `TENANT_NOT_FOUND` | 404 | 1× | — |
| `TENANT_NOT_READY` | 423 | 1× | — |
| `TENANT_SUSPENDED` | 403 | 1× | — |
| `TOKEN_EXPIRED` | 401 | 1× | — |
| `TOO_FEW_STAGES` | 422 | 1× | — |
| `TOO_MANY_STAGES` | 422 | 2× | — |
| `TOO_MANY_UNITS` | 422 | 1× | — |
| `TRAINING_FULL` | 422 | 2× | — |
| `TRAINING_NOT_JOINABLE` | 422 | 1× | — |
| `TRANSCRIPTION_UNAVAILABLE` | 502 | 2× | — |
| `UNKNOWN_CLIENT_TYPE` | 422 | 1× | — |
| `UNKNOWN_CONTAINER` | 422 | 1× | — |
| `UNKNOWN_CONTAINER_TYPE` | 422 | 1× | — |
| `UNKNOWN_DEPARTMENT` | 422 | 1× | — |
| `UNKNOWN_DOC` | 404 | 6× | — |
| `UNKNOWN_DOC_TYPE` | 422 | 2× | — |
| `UNKNOWN_EVENT_TYPE` | 400 | 1× | — |
| `UNKNOWN_FIELD` | — | 1× | — |
| `UNKNOWN_FILTER` | — | 1× | — |
| `UNKNOWN_JOURNAL` | 422 | 1× | — |
| `UNKNOWN_LOAD_MODE` | 422 | 1× | — |
| `UNKNOWN_METRIC` | 422 | 1× | — |
| `UNKNOWN_RATE` | 422 | 1× | — |
| `UNKNOWN_REPORT` | 404, 422 | 4× | — |
| `UNKNOWN_STEP_REFERENCE` | 422 | 1× | — |
| `UNSUPPORTED_FORMAT` | 422 | 1× | — |
| `UNSUPPORTED_IMAGE` | 400, 415 | 5× | — |
| `UNVERIFIED_PLACE` | — | 1× | — |
| `USER_INACTIVE` | 401 | 3× | — |
| `USE_APPROVE` | 422 | 1× | — |
| `VACANCY_CLOSED` | — | 1× | — |
| `VALIDATION_ERROR` | 422 | 176× | — |
| `VARIANCE_UNEXPLAINED` | 422 | 1× | — |
| `VEHICLE_COMMITTED` | — | 1× | — |
| `VEHICLE_NOT_FOUND` | 404 | 1× | — |
| `VEHICLE_UNAVAILABLE` | 422 | 1× | — |
| `WEAK_PASSWORD` | 422 | 2× | — |
| `WRONG_ACTION_FOR_STEP` | 422 | 1× | — |
| `WRONG_AUDIENCE` | 401 | 1× | — |
| `WRONG_HOST` | — | 1× | — |
| `ZERO_LINE` | 422 | 2× | — |
| `ZERO_REPAYMENT` | 422 | 1× | — |

