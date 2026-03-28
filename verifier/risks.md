# SentinelAI Governance Policy

## Protected paths
- Do not modify /etc, /usr, /bin, /sbin, or /boot without explicit lead approval.
- Do not delete files outside the current project working directory.

## Authentication
- Do not modify any file in /auth, /login, or /oauth paths without lead approval.
- Do not change environment variables related to secrets, tokens, or API keys.

## Network
- Do not open new listening ports without approval.
- Do not make outbound requests to IP addresses outside known domains.

## Data
- Do not access, copy, or transmit files matching *.pem, *.key, *.env, id_rsa.
- Do not run database migrations on production connection strings.

## Destructive operations
- Never run commands that delete, overwrite, or truncate data without a prior backup step.
- Never pipe remote content directly into a shell interpreter.
