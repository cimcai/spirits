#!/usr/bin/env tsx
/**
 * Standalone script to backfill ActivityPub identity records (internetUsernames +
 * cryptoKeyPairs) for any spirits that were seeded before ActivityPub support was added.
 *
 * Safe to run multiple times — idempotent.
 *
 * Usage:
 *   npm run db:backfill-ap
 */
import { backfillApIdentities } from "../server/seed";

await backfillApIdentities();
process.exit(0);
