# Feloxi Kubernetes Deployment

Complete Kubernetes manifests for deploying Feloxi on GKE (tested on Autopilot).

## Architecture

```
Internet → GCE Ingress (HTTPS) → feloxi-web (Next.js :3000)
                                        ↓ (server-side API_URL)
                                  feloxi-api (Rust :8080)
                                    ├── feloxi-postgres (StatefulSet, 5Gi PVC)
                                    ├── feloxi-clickhouse (StatefulSet, 10Gi PVC)
                                    └── feloxi-redis (Deployment, in-memory)
```

## Prerequisites

- GKE cluster (Autopilot or Standard)
- `kubectl` configured for the cluster
- GHCR image access (images are public)
- A static IP and DNS pointing to it (for Ingress + managed cert)

## Deployment Order

```bash
# 1. Create namespace (if not exists)
kubectl create namespace core

# 2. Create secrets (edit values first!)
kubectl apply -f 00-secrets.yaml

# 3. Infrastructure (databases)
kubectl apply -f 10-postgres.yaml
kubectl apply -f 11-clickhouse.yaml
kubectl apply -f 12-redis.yaml

# 4. Wait for databases to be ready
kubectl wait --for=condition=ready pod -l app=feloxi-postgres -n core --timeout=120s
kubectl wait --for=condition=ready pod -l app=feloxi-clickhouse -n core --timeout=120s
kubectl wait --for=condition=ready pod -l app=feloxi-redis -n core --timeout=60s

# 5. Application
kubectl apply -f 20-api.yaml
kubectl apply -f 21-web.yaml

# 6. Networking (Ingress + managed cert)
kubectl apply -f 30-ingress.yaml
```

## File Reference

| File | Resources | Notes |
|------|-----------|-------|
| `00-secrets.yaml` | Secret | Database passwords, JWT secret — edit before applying |
| `10-postgres.yaml` | StatefulSet + Service | PostgreSQL 17, 5Gi PVC |
| `11-clickhouse.yaml` | StatefulSet + Service + ConfigMap | ClickHouse 24.12, 10Gi PVC, system log TTLs |
| `12-redis.yaml` | Deployment + Service | Redis 7, in-memory with LRU eviction |
| `20-api.yaml` | Deployment + Service | Rust API, connects to all DBs |
| `21-web.yaml` | Deployment + Service (NodePort) | Next.js frontend, connects to API |
| `30-ingress.yaml` | Ingress + ManagedCertificate + FrontendConfig | HTTPS via GCE managed cert |

## Important Notes

### No Deployments for StatefulSets
PostgreSQL and ClickHouse use **StatefulSets only** (not Deployments). Having both a StatefulSet and a Deployment with the same label selector causes the Service to load-balance between two databases — one with data, one empty. This was the root cause of multiple staging incidents.

### ClickHouse System Log TTLs
ClickHouse logs everything about itself (queries, traces, metrics) into `system.*` tables. Without TTLs, these grow to gigabytes and fill the disk. The ConfigMap includes a config that caps all system log tables to 3 days. The API also applies these TTLs at startup as a safety net.

### ClickHouse Disk Sizing
The Feloxi data itself is small (MBs even with millions of events due to compression). But system logs can use GBs. With the 3-day TTL config, 10Gi is sufficient for most deployments. For production with high query volume, consider 20-50Gi.

### Image Tags
Always use specific version tags (e.g., `v0.3.1`), never `latest`. The API image is built from the Rust workspace, the web image from the Next.js app. Both are pushed to GHCR on version tags via GitHub Actions.

### Secrets
The `00-secrets.yaml` has placeholder values. Change them before deploying:
- `postgres-user` / `postgres-password` / `postgres-db` — PostgreSQL credentials
- `clickhouse-user` / `clickhouse-password` — ClickHouse credentials
- `jwt-secret` — Must be at least 32 characters, used for JWT signing

### Ingress
The ingress manifest is specific to GKE with:
- GCE ingress class
- Google-managed HTTPS certificate
- Static IP (`kubernetes.io/ingress.global-static-ip-name`)
- HTTPS redirect via FrontendConfig

Adapt for your cluster if not using GKE.
