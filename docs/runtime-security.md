# Runtime security configuration

Production requires `BETTER_AUTH_SECRET` to contain at least 32 characters and rejects the checked-in development/example values. Generate a random secret during deployment configuration. Do not reuse test/example values. Local development can use the development fallback.

The API enforces 300 requests per minute per route, per client IP, per API process. Health probes are exempt. Better Auth's separately mounted middleware retains its own rate limiting; Nest guards do not wrap that handler. Queue workers are outside the HTTP budget. Multiple API replicas each have a separate budget.

Production proxy trust assumes the supported Compose topology: only Caddy publishes application HTTP ports, and the API has exactly one proxy hop. Caddy overwrites untrusted incoming forwarding headers and adds the client IP. The API uses the nearest forwarded address, ignoring forged earlier hops. Do not publish the API directly with this production setting; a different ingress topology requires updating the trust configuration. Development connections ignore forwarded headers.

`REDIS_URL`, when supplied, is authoritative for all queue, draft-lease and OAuth clients, even when `REDIS_HOST` is also present. It accepts `redis://` and `rediss://`, preserves authentication and the logical database path, and enables TLS for `rediss://`. Invalid URLs, unsupported schemes, query/fragment options, invalid database indexes, and invalid ports fail at configuration rather than falling back to localhost. Without a URL, `REDIS_HOST` and `REDIS_PORT` select the server, defaulting to localhost:6379. This preserves the internal Redis setup in the checked-in Compose configuration.
