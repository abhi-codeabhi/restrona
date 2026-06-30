# Restorna — Cloud-agnostic & portable by design

Restorna runs on **any cloud or your own hardware** with no vendor lock-in. This is a deliberate
architectural property, not an afterthought.

## Two things up front

- **No Claude / Anthropic runtime dependency.** The product is plain Node.js + standard
  infrastructure. Nothing in the codebase calls Anthropic or Claude at runtime — Claude was only the
  tool used to design and write it. You can run, fork, and ship it with zero ties to any AI vendor.
- **No cloud lock-in.** The application code (domain + use cases) imports *nothing* cloud-specific.
  Every external dependency — database, cache, event broker, object storage, secrets — sits behind a
  **port** (interface). Only thin **adapters** touch a concrete provider. Moving clouds = swap an
  adapter or an env var, not a rewrite.

## Why it's portable (ports & adapters)

```
domain / application  ──depends on──►  PORTS (interfaces)
                                          ▲
                                          │ implemented by
                              ADAPTERS (the only cloud-aware code)
                    InMemory* (dev)  ·  Postgres/Redis/S3/NATS (prod)
```

The reference build ships in-memory adapters; production swaps them at the **composition root**
(`build.js` / `main.js`) — the single place implementations meet interfaces. Nothing else changes.

## Portable primitives only — and where each runs

We depend exclusively on open standards with multiple independent implementations:

| Capability | Port (in code) | Open standard | Runs on (any of) |
|---|---|---|---|
| Relational store | `OrderRepository`, … | PostgreSQL / SQL | AWS RDS · GCP Cloud SQL · Azure DB · Supabase · Neon · self-hosted Postgres |
| Cache / projections | `Cache` | Redis protocol | ElastiCache · Memorystore · Azure Cache · Upstash · self-hosted Redis/Valkey |
| Event backbone | `EventBus` / `Outbox` | NATS / Kafka / AMQP | self-hosted NATS/Kafka/RabbitMQ · Confluent · MSK · any managed broker |
| Object storage | `ObjectStore` | S3 API | AWS S3 · GCS (S3 mode) · Azure Blob · Cloudflare R2 · MinIO (self-host) |
| Secrets | `SecretsProvider` | — | Vault · AWS/GCP/Azure secret managers · K8s Secrets · env |
| Telemetry | `observability` | OpenTelemetry (OTLP) | any OTel-compatible backend (Grafana, Datadog, Honeycomb, self-host) |
| Identity | `Identity`/OIDC | OIDC/OAuth2 + JWT | Auth0 · Cognito · Keycloak (self-host) · Supabase Auth |

No proprietary SDK appears in domain code; OTel (not a vendor agent) is the telemetry contract; the
S3 *API* (not the AWS SDK specifically) is the storage contract.

## 12-factor config (everything via env)

All wiring is environment-driven — no hardcoded endpoints, no provider baked into the image:

```
APP=customer            # which BFF/service this process runs (customer|waiter|kitchen|billing|ordering)
PORT=8080
DATABASE_URL=postgres://…        # any Postgres (use the pooled/transaction URL on serverless)
REDIS_URL=redis://…
BROKER_URL=nats://…              # or kafka://… / amqp://…
OBJECT_STORE_ENDPOINT=…          # any S3-compatible endpoint
OTEL_EXPORTER_OTLP_ENDPOINT=…    # any OTel collector
```

## Packaging: one image, runs anywhere

The whole platform is a standard **OCI container** running a Node process that listens on `$PORT`.
That means it runs unchanged on:

- **Any container runtime** — Docker, containerd, Podman.
- **Any orchestrator** — Kubernetes (EKS, GKE, AKS, k3s, OpenShift, self-managed), Nomad, ECS.
- **Any container PaaS** — Cloud Run, Fly.io, Railway, Render, App Runner — just set `APP`, `PORT`, env.
- **A plain VM** — `docker compose up`, or `node bin/serve.js`.

See `deploy/` for: a generic `Dockerfile`, `docker-compose.yml` (full local stack), vanilla
Kubernetes manifests (no cloud-specific annotations), and a minimal Helm chart. A `Procfile`
(`web: node bin/serve.js`) covers buildpack/PaaS hosts.

## Rules that keep it portable (enforce in review)

1. **No cloud SDK import in `domain/` or `application/`** — adapters only.
2. **Talk protocols, not products** — SQL, Redis protocol, S3 API, OTLP, OIDC.
3. **All config from env** — nothing provider-specific compiled in.
4. **Stateless processes** — state lives in Postgres/Redis/broker, so any host can run any instance.
5. **Telemetry via OpenTelemetry** — never a single-vendor agent in app code.

Migrating from, say, Supabase Postgres + NATS to AWS RDS + MSK is: point `DATABASE_URL`/`BROKER_URL`
at the new endpoints (and, if the broker family changes, use the Kafka adapter instead of the NATS
one). The domain never notices.
