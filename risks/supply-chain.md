# Dependency & Supply Chain Policy

## Blocked Actions

- **Unpinned dependencies**: Adding dependencies without pinning to a specific version (e.g. `requests` instead of `requests==2.31.0` in `requirements.txt`, or `^` ranges for production packages).
- **Unvetted registries**: Installing packages from unofficial or private registries without explicit team approval.
- **Known-vulnerable packages**: Adding or upgrading to a package version with a known critical or high CVE.
- **Typosquat risk**: Adding packages whose names closely resemble well-known packages but differ by one character (e.g. `reques ts`, `nump1`).
- **Post-install scripts without review**: Adding packages that execute arbitrary scripts on install without reviewing what those scripts do.
- **Direct GitHub/URL installs**: Installing packages directly from git URLs or raw URLs instead of a versioned registry release.

## Intent Violations

Requests that ask SentinelAI or Copilot to:
- Disable dependency auditing or vulnerability scanning steps in CI
- Downgrade a dependency to bypass a security check
- Add a package because it is "faster to install" without checking its provenance
- Commit a `node_modules/` or vendored dependency tree that has not been audited

## Required Practices

- All new dependencies must be checked with `pip-audit`, `npm audit`, or equivalent before being committed.
- `requirements.txt` and `package-lock.json` / `poetry.lock` must be committed alongside any dependency addition.
- Transitive dependencies introduced by a new package must be reviewed for known CVEs.

## Exemptions

- Development-only dependencies (test frameworks, linters) may use minor version ranges but must still pass audit checks.
- Approved internal packages distributed via a verified private registry are permitted.
