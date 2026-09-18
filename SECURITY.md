# Security

Report vulnerabilities through [GitHub's private reporting form](https://github.com/AlbionaHoti/refgarden/security/advisories/new). Include a minimal reproduction using synthetic credentials. Never attach real API keys, private photos, `.env` files or exported personal searches.

The local server binds to loopback. Keep it local; it is not a multi-user hosted service. Its provider key authorizes paid requests. The hosted source-search variant has different credential boundaries, documented in [How it works](docs/HOW_IT_WORKS.md).

If a key is exposed, revoke it at the provider and replace it locally. Removing a file from a new commit does not remove it from Git history or copies already downloaded.

This is an early project. Security reports are reviewed by the maintainer; no response-time commitment or support contract is offered.
