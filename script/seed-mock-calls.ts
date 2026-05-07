#!/usr/bin/env tsx
/**
 * Standalone script to seed mock outbound call messages for each spirit,
 * so the ActivityPub outbox endpoints return demo content.
 *
 * Safe to run multiple times — skips spirits that already have messages.
 *
 * Usage:
 *   npm run db:seed-mock-calls
 */
import { seedMockOutboundCalls } from "../server/seed";

await seedMockOutboundCalls();
process.exit(0);
