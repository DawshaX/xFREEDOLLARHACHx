// Legacy NOVA startup is quarantined during the security migration.
// See docs/SECURITY_REVIEW.md and docs/MIGRATION.md before re-enabling any subsystem.
console.error("Legacy NOVA API is disabled pending authentication, authorization, and scope enforcement.");
process.exit(1);
