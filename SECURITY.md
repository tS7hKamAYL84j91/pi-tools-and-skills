# Security Policy

## Supported versions

| Version | Supported Node.js | Status |
| ------- | ----------------- | ------ |
| >= 1.2.0 | Node.js 22, 24, 25 | Active |
| 1.1.x | Node.js 22, 24, 25 | Maintenance only |
| < 1.1.0 | — | Unsupported |

## Reporting a vulnerability

Please report security vulnerabilities privately so we can coordinate a fix before public disclosure.

- Email: security@example.invalid (replace with your project security contact)
- Do not open public issues for undisclosed vulnerabilities.
- Include a minimal reproduction, affected versions, and suggested severity if possible.

We aim to acknowledge reports within 5 business days and release a patched version within 30 days for critical issues.

## Security practices

- Production dependencies are audited with `npm audit --omit=dev --audit-level=high` in CI.
- Pull requests are scanned with gitleaks for accidental secret commits.
- Matrix credentials are read from environment variables only; this package never writes secrets.
- Matrix attachments are size-bounded and MIME-filtered; encrypted attachments are not auto-downloaded.

## Disclosure policy

We follow coordinated disclosure. After a fix is released we will publish a security advisory and update this file with CVE references when applicable.
