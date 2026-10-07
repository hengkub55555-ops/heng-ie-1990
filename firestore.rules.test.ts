/**
 * Phase 0 Security Rules Verification Spec
 * Verifies that all Dirty Dozen payloads return PERMISSION_DENIED.
 */

export interface SecurityTestCase {
  id: number;
  name: string;
  collection: string;
  docId: string;
  operation: 'create' | 'update' | 'get' | 'list' | 'delete';
  auth: { uid: string; email: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED' | 'ALLOWED';
}

export const DIRTY_DOZEN_TESTS: SecurityTestCase[] = [
  {
    id: 1,
    name: 'Unauthenticated Write',
    collection: 'production_logs',
    docId: 'log_1',
    operation: 'create',
    auth: null,
    payload: { ownerId: 'user_1', line: 'Production Line B', onlineQty: 100 },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unverified Email Write',
    collection: 'production_logs',
    docId: 'log_1',
    operation: 'create',
    auth: { uid: 'user_1', email: 'user@example.com', email_verified: false },
    payload: { ownerId: 'user_1', line: 'Production Line B', onlineQty: 100 },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Identity Spoofing on Create',
    collection: 'production_logs',
    docId: 'log_1',
    operation: 'create',
    auth: { uid: 'attacker_1', email: 'attacker@example.com', email_verified: true },
    payload: { ownerId: 'victim_1', line: 'Production Line B', onlineQty: 100 },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Shadow Field Injection',
    collection: 'production_logs',
    docId: 'log_1',
    operation: 'create',
    auth: { uid: 'user_1', email: 'user@example.com', email_verified: true },
    payload: { ownerId: 'user_1', isVerifiedAdmin: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Path ID Poisoning',
    collection: 'production_logs',
    docId: 'bad$id!with*spaces',
    operation: 'create',
    auth: { uid: 'user_1', email: 'user@example.com', email_verified: true },
    payload: { ownerId: 'user_1' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Negative Quantity Injection',
    collection: 'production_logs',
    docId: 'log_1',
    operation: 'create',
    auth: { uid: 'user_1', email: 'user@example.com', email_verified: true },
    payload: { ownerId: 'user_1', onlineQty: -25 },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Invalid Enum Injection',
    collection: 'production_logs',
    docId: 'log_1',
    operation: 'create',
    auth: { uid: 'user_1', email: 'user@example.com', email_verified: true },
    payload: { ownerId: 'user_1', line: 'Production Line Z' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Client Timestamp Forgery',
    collection: 'production_logs',
    docId: 'log_1',
    operation: 'create',
    auth: { uid: 'user_1', email: 'user@example.com', email_verified: true },
    payload: { ownerId: 'user_1', createdAt: '1999-01-01T00:00:00Z' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Immutable Field Mutation (ownerId)',
    collection: 'production_logs',
    docId: 'log_1',
    operation: 'update',
    auth: { uid: 'user_1', email: 'user@example.com', email_verified: true },
    payload: { ownerId: 'user_2' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Terminal State Bypass on Resolved Alert',
    collection: 'production_alerts',
    docId: 'alert_1',
    operation: 'update',
    auth: { uid: 'user_1', email: 'user@example.com', email_verified: true },
    payload: { status: 'Open' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Value Poisoning on Update',
    collection: 'production_logs',
    docId: 'log_1',
    operation: 'update',
    auth: { uid: 'user_1', email: 'user@example.com', email_verified: true },
    payload: { onlineQty: 'not_a_number' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Blanket List Scraping Across Users',
    collection: 'production_logs',
    docId: '*',
    operation: 'list',
    auth: { uid: 'attacker_1', email: 'attacker@example.com', email_verified: true },
    expectedResult: 'PERMISSION_DENIED',
  },
];
