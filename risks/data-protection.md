# Data Protection & Privacy Policy

## Blocked Actions

- **PII in logs**: Writing code that logs personally identifiable information — names, email addresses, phone numbers, IP addresses, national IDs, health data — to any log stream without explicit redaction.
- **PII in non-production data**: Copying or seeding production data containing real PII into development, staging, or test environments without anonymization.
- **Unencrypted sensitive storage**: Writing sensitive or regulated data (PII, financial records, health data) to disk, a database, or object storage without encryption at rest.
- **Sensitive data in error responses**: Returning raw exception messages, stack traces, or database error details to external clients.
- **Unencrypted backups**: Creating backup routines for sensitive data without applying encryption before writing the backup.
- **Retention violations**: Writing data pipelines that accumulate PII indefinitely without a deletion or expiry mechanism.

## Intent Violations

Requests that ask SentinelAI or Copilot to:
- Expose a full user record (including PII fields) in a debug endpoint or health check
- Skip anonymization when generating test fixtures from real data
- Disable encryption "to improve backup performance"
- Return detailed internal error state to an unauthenticated API caller

## Required Practices

- Log entries that reference users must use opaque identifiers (UUIDs) rather than names or emails.
- Test fixtures and seed data must be synthetically generated or anonymized.
- Any endpoint returning user data must enforce authentication and return only the fields required for the operation (principle of least exposure).

## Exemptions

- Logging a user's opaque ID (UUID, numeric ID) for audit trail purposes is permitted.
- Displaying PII back to the authenticated user who owns that data is permitted.
