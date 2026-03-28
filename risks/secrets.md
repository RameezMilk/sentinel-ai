# Secrets & Credentials Policy

## Blocked Actions

- **Hardcoded secrets**: Writing API keys, passwords, tokens, private keys, or connection strings as literals in source code or config files.
- **Secrets in logs**: Generating code that logs, prints, or surfaces credentials, tokens, or private keys in any output stream.
- **Secrets in version control**: Adding `.env` files, key files (`.pem`, `.p12`, `.pfx`), or credential files to a repository without explicit `.gitignore` exclusion.
- **Plaintext passwords**: Storing or comparing passwords without hashing (e.g. direct string equality checks against a password field).
- **Credentials in URLs**: Embedding usernames or passwords in connection strings or URLs (e.g. `postgres://user:pass@host`).

## Intent Violations

Requests that ask SentinelAI or Copilot to:
- Inline a real secret value into source code "just for testing"
- Disable secret scanning or pre-commit hooks
- Commit or push files known to contain credentials
- Generate code that reads secrets from environment and then re-emits them to a log or response body

## Required Practices

- Secrets must be referenced via environment variables or a secret manager (e.g. AWS Secrets Manager, HashiCorp Vault).
- Any generated `.env.example` or config template must use placeholder values only (e.g. `GEMINI_API_KEY=your-key-here`).

## Exemptions

- Placeholder or dummy values clearly marked as non-real (e.g. `sk-test-xxxx`, `your-api-key-here`) are permitted in examples and documentation.
