# Injection Vulnerability Policy

## Blocked Actions

- **SQL injection**: Constructing SQL queries by string concatenation or f-string interpolation with unsanitized user input instead of parameterized queries or an ORM.
- **Command injection**: Passing user-controlled strings to `subprocess`, `os.system`, `exec`, `shell=True`, or equivalent without sanitization.
- **Path traversal**: Using unsanitized user input to construct file paths (e.g. `open(base_dir + user_input)`) without canonicalization and boundary checks.
- **Template injection**: Rendering user-supplied content directly through a template engine (e.g. Jinja2 `render_string`, `eval`-based templates) without sandboxing.
- **XML/XXE injection**: Parsing XML from external sources without disabling external entity resolution.
- **NoSQL injection**: Constructing MongoDB or similar queries by merging raw user input into query objects without validation.

## Intent Violations

Requests that ask SentinelAI or Copilot to:
- Deliberately skip input validation "for performance" or "for simplicity" on an endpoint that accepts external data
- Use `shell=True` with a variable that originates from user input
- Disable ORM query escaping or use raw query methods with unsanitized input

## Required Practices

- All database queries must use parameterized statements or ORM methods that handle escaping.
- File path construction from user input must use `os.path.realpath` / `Path.resolve()` and validate the result stays within the expected base directory.
- Subprocess calls with any dynamic content must use list form (never `shell=True`) and validate each argument.

## Exemptions

- Hardcoded, developer-controlled values (not derived from external input) used in queries or shell calls are permitted.
- Unit tests that construct intentionally malicious payloads to verify sanitization logic are permitted, provided they do not execute against a live system.
