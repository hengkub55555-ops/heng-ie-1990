# Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Identity & Ownership**: Every document in `production_logs`, `production_alerts`, and `line_configs` belongs strictly to `ownerId == request.auth.uid` (or bootstrapped verified admin `hengkub55555@gmail.com`).
2. **Verified Email**: Every mutating operation (`create`, `update`, `delete`) requires `request.auth.token.email_verified == true`.
3. **Strict Schema & Keys**: No undocumented shadow fields (`hasOnly` + `hasAll`) are permitted on any document.
4. **Temporal Integrity**: `createdAt` (on create) and `updatedAt` (on create/update) must equal server time `request.time`. `createdAt` and `ownerId` are immutable on update.
5. **Query Enforcer**: `allow list` rules strictly evaluate `resource.data.ownerId == request.auth.uid` (or `isAdmin()`) to prevent unauthorized query scraping.

## 2. The "Dirty Dozen" Payloads
1. **Unauthenticated Write**: `auth = null`, creating a document in `/production_logs/log_1`.
2. **Unverified Email Write**: `auth.token.email_verified = false`, creating a document in `/production_logs/log_1`.
3. **Identity Spoofing on Create**: `ownerId = "victim_uid"` while `request.auth.uid = "attacker_uid"`.
4. **Shadow Field Injection on Create**: Adding `"isAdmin": true` to `/production_logs/log_1`.
5. **Path ID Poisoning**: Creating `/production_logs/invalid id with spaces and $$$` (>128 chars or invalid regex).
6. **Negative Quantity Injection**: Creating `/production_logs/log_1` with `onlineQty: -50` or `onlineQty: 9999999`.
7. **Invalid Enum Injection**: Creating `/production_logs/log_1` with `line: "Production Line Z"`.
8. **Client Timestamp Forgery**: Creating `/production_logs/log_1` with a past timestamp instead of `request.time`.
9. **Immutable Field Mutation**: Updating `ownerId` or `createdAt` on `/production_logs/log_1`.
10. **Terminal State Bypass on Alert**: Updating an already `"Resolved"` alert's severity or title without admin privileges.
11. **Value Poisoning on Update**: Updating `onlineQty` on `/production_logs/log_1` with a string `"100"` instead of a number.
12. **Blanket List Scraping**: Listing `/production_logs` without `where('ownerId', '==', request.auth.uid)`.
