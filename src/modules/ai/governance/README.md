# AiGovernance module

**Spec:** AI Control & Governance (V2.2 §6.31)
**Permission key:** `ai_governance`

## Backing tables

- `ai_feature_flags`
- `ai_vendor_credentials`
- `ai_access_grants`
- `ai_budget_periods`
- `ai_usage_ledger`
- `ai_usage_daily`
- `ai_knowledge_chunks`

## Files

| File                       | Purpose                              |
| -------------------------- | ------------------------------------ |
| `governance.routes.js`     | Express router — URL → controller    |
| `governance.controller.js` | HTTP handlers (req/res only)         |
| `governance.service.js`    | Business logic, transactions, events |
| `governance.repo.js`       | Parameterised SQL only               |
| `governance.validator.js`  | Zod input schemas                    |
| `governance.events.js`     | Domain events for realtime + AI      |

## TODOs

- [ ] Implement repo create/update with real columns
- [ ] Implement validator schemas with actual field definitions
- [ ] Add module-specific endpoints to routes (state transitions, sub-resources)
- [ ] Wire events to Socket.io rooms (see `src/realtime/rooms.js`)
- [ ] Add unit tests in `tests/unit/ai_governance/`
- [ ] Add integration tests in `tests/integration/ai_governance/`
