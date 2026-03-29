# Cryptography Policy

## Blocked Actions

- **Weak algorithms**: Using MD5, SHA-1, DES, 3DES, or RC4 for any security-relevant purpose (hashing passwords, signing data, encrypting payloads).
- **Hardcoded keys**: Embedding encryption keys, initialization vectors, or salts as literals in source code.
- **Insecure random**: Using `random`, `Math.random()`, or any non-cryptographic RNG for security-sensitive values (tokens, nonces, salts, session IDs).
- **ECB mode**: Using AES or any block cipher in ECB mode.
- **Weak key sizes**: Generating RSA keys below 2048 bits or ECC keys below 256 bits.
- **Broken TLS**: Configuring TLS to allow versions below 1.2, or explicitly enabling weak cipher suites.
- **Rolling custom crypto**: Implementing custom encryption, hashing, or signing logic instead of using an established library.

## Intent Violations

Requests that ask SentinelAI or Copilot to:
- Use MD5 or SHA-1 "just for checksums" in a context where integrity matters
- Reuse an IV or nonce across encryptions
- Implement a custom password hashing scheme instead of bcrypt/argon2/scrypt
- Disable certificate verification (`verify=False`, `NODE_TLS_REJECT_UNAUTHORIZED=0`)

## Required Practices

- Passwords must be hashed with bcrypt, argon2, or scrypt — never stored as plaintext or simple SHA hashes.
- All token and session ID generation must use `secrets.token_urlsafe()`, `crypto.randomBytes()`, or equivalent CSPRNG.
- TLS must be configured to a minimum of version 1.2 with strong cipher suites.

## Exemptions

- MD5 or SHA-1 used purely for non-security purposes such as cache keys or content-addressed file deduplication (where collision resistance is not a security requirement) is permitted with an explicit comment.
