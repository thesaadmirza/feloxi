# Feloxi Helm Chart

[Feloxi](https://github.com/thesaadmirza/feloxi) is an open-source Celery task queue monitoring platform — a modern alternative to Flower. Real-time task and worker visibility powered by a Rust API, Next.js dashboard, PostgreSQL, ClickHouse, and Redis.

## Prerequisites

- Kubernetes 1.23+
- Helm 3.8+
- A storage class that supports `ReadWriteOnce` (for PostgreSQL and ClickHouse PVCs)

## Quick start

```bash
helm install feloxi oci://ghcr.io/thesaadmirza/charts/feloxi \
  --namespace feloxi \
  --create-namespace \
  --set auth.jwtSecret="<min-32-char-secret>" \
  --set auth.encryptionKey="$(openssl rand -base64 32)" \
  --set postgresql.auth.password="<pgpassword>" \
  --set clickhouse.auth.password="<chpassword>"
```

Then access the dashboard:

```bash
kubectl port-forward -n feloxi svc/feloxi-web 3000:80
# open http://localhost:3000
```

## Install from local source

```bash
git clone https://github.com/thesaadmirza/feloxi
helm install feloxi ./feloxi/charts/feloxi \
  --namespace feloxi --create-namespace \
  --set auth.jwtSecret="thisisasecretthatisatleast32chars" \
  --set auth.encryptionKey="$(openssl rand -base64 32)" \
  --set postgresql.auth.password="pgpass" \
  --set clickhouse.auth.password="chpass"
```

## Configuration

### Required values

| Parameter | Description |
|-----------|-------------|
| `auth.jwtSecret` | JWT signing key — minimum 32 characters. Use `existingSecret` instead for production. |
| `auth.encryptionKey` | Base64-encoded 32-byte key for secrets at rest (`openssl rand -base64 32`). Required unless `existingSecret` is set. Losing it makes stored integration tokens and the SMTP password unrecoverable. |
| `postgresql.auth.password` | PostgreSQL password (when `postgresql.enabled=true` and no `existingSecret`). |
| `clickhouse.auth.password` | ClickHouse password (when `clickhouse.enabled=true` and no `existingSecret`). |

### Using an existing Secret (recommended for production)

Create a Secret containing all credentials:

```bash
kubectl create secret generic feloxi-creds -n feloxi \
  --from-literal=jwt-secret="<min-32-char-secret>" \
  --from-literal=encryption-key="$(openssl rand -base64 32)" \
  --from-literal=postgres-user=feloxi \
  --from-literal=postgres-password="<pgpassword>" \
  --from-literal=postgres-db=feloxi \
  --from-literal=clickhouse-user=default \
  --from-literal=clickhouse-password="<chpassword>"
```

Then install without inline passwords:

```bash
helm install feloxi ./charts/feloxi \
  --namespace feloxi --create-namespace \
  --set auth.existingSecret=feloxi-creds
```

You can also override per-component secrets independently:

```bash
--set postgresql.auth.existingSecret=my-pg-secret
--set clickhouse.auth.existingSecret=my-ch-secret
```

### Ingress

```bash
# nginx
helm install feloxi ./charts/feloxi \
  --set ingress.enabled=true \
  --set ingress.className=nginx \
  --set ingress.host=feloxi.example.com \
  --set ingress.tls=true \
  --set "ingress.annotations.cert-manager\.io/cluster-issuer=letsencrypt-prod" \
  ...

# Traefik
helm install feloxi ./charts/feloxi \
  --set ingress.enabled=true \
  --set ingress.className=traefik \
  --set ingress.host=feloxi.example.com \
  ...

# AWS ALB
helm install feloxi ./charts/feloxi \
  --set ingress.enabled=true \
  --set ingress.className=alb \
  --set ingress.host=feloxi.example.com \
  --set "ingress.annotations.alb\.ingress\.kubernetes\.io/scheme=internet-facing" \
  --set "ingress.annotations.alb\.ingress\.kubernetes\.io/target-type=ip" \
  ...
```

### External databases (bring your own)

Disable any embedded database and point to your external instance:

```bash
# External PostgreSQL (e.g. RDS)
helm install feloxi ./charts/feloxi \
  --set postgresql.enabled=false \
  --set externalPostgresql.host=mydb.rds.amazonaws.com \
  --set externalPostgresql.database=feloxi \
  --set externalPostgresql.username=feloxi \
  --set externalPostgresql.existingSecret=my-pg-secret \
  ...

# External Redis (e.g. ElastiCache)
helm install feloxi ./charts/feloxi \
  --set redis.enabled=false \
  --set externalRedis.host=my-redis.cache.amazonaws.com \
  ...

# External ClickHouse
helm install feloxi ./charts/feloxi \
  --set clickhouse.enabled=false \
  --set externalClickhouse.host=my-clickhouse.example.com \
  --set externalClickhouse.existingSecret=my-ch-secret \
  ...
```

### Storage

Set `storageClass` explicitly if your cluster uses a non-default class:

```bash
--set postgresql.persistence.storageClass=gp2       # AWS EKS
--set clickhouse.persistence.storageClass=premium-rwo  # Azure AKS
--set postgresql.persistence.size=20Gi              # increase disk
```

### Upgrading tuning parameters

Tuning values (`api.tuning.*`) are strings in the schema. Use `--set-string` when overriding them on the command line to avoid a type mismatch:

```bash
# Wrong — Helm parses 300 as an integer, schema rejects it
helm upgrade feloxi ... --set api.tuning.taskBatchSize=300

# Correct
helm upgrade feloxi ... --set-string api.tuning.taskBatchSize=300
```

Alternatively, use a values file:
```yaml
# custom-values.yaml
api:
  tuning:
    taskBatchSize: "300"
```

### Full values reference

| Parameter | Default | Description |
|-----------|---------|-------------|
| `nameOverride` | `""` | Override the chart name |
| `fullnameOverride` | `""` | Override the full release name |
| `image.api.repository` | `ghcr.io/thesaadmirza/feloxi/api` | API image |
| `image.api.tag` | `""` (Chart.appVersion) | API image tag |
| `image.web.repository` | `ghcr.io/thesaadmirza/feloxi/web` | Web image |
| `image.web.tag` | `""` (Chart.appVersion) | Web image tag |
| `auth.jwtSecret` | `""` | JWT signing key (min 32 chars) |
| `auth.existingSecret` | `""` | Use existing K8s Secret for all credentials |
| `api.replicaCount` | `1` | API replica count |
| `api.env.allowSignup` | `"false"` | Allow new user registration |
| `api.env.disableSwagger` | `"true"` | Disable Swagger UI |
| `api.env.corsOrigin` | `""` | CORS origin (auto-derived from ingress.host) |
| `api.tuning.pubsubChannelCapacity` | `"500000"` | Broadcast channel capacity |
| `web.replicaCount` | `1` | Web replica count |
| `ingress.enabled` | `false` | Enable Ingress |
| `ingress.className` | `nginx` | Ingress class name |
| `ingress.host` | `""` | Public hostname |
| `ingress.tls` | `false` | Enable TLS |
| `postgresql.enabled` | `true` | Deploy embedded PostgreSQL |
| `postgresql.auth.username` | `feloxi` | PostgreSQL username |
| `postgresql.auth.database` | `feloxi` | PostgreSQL database |
| `postgresql.persistence.size` | `5Gi` | PostgreSQL storage size |
| `postgresql.persistence.storageClass` | `""` | StorageClass (empty = cluster default) |
| `clickhouse.enabled` | `true` | Deploy embedded ClickHouse |
| `clickhouse.persistence.size` | `10Gi` | ClickHouse storage size |
| `clickhouse.systemLogTtlDays` | `3` | TTL for ClickHouse system log tables |
| `redis.enabled` | `true` | Deploy embedded Redis |
| `redis.maxmemory` | `256mb` | Redis memory limit |
| `redis.persistence.enabled` | `false` | Enable Redis AOF persistence |

## Upgrading

```bash
helm upgrade feloxi ./charts/feloxi -n feloxi --reuse-values
```

StatefulSet upgrades (PostgreSQL, ClickHouse) may require manual intervention if you change selector labels. Always back up data before upgrading.

## Uninstalling

```bash
helm uninstall feloxi -n feloxi
```

PersistentVolumeClaims are **not** deleted automatically. To remove all data:

```bash
kubectl delete pvc -n feloxi -l app.kubernetes.io/instance=feloxi
```

## Testing the chart locally

```bash
# Static validation
helm lint charts/feloxi
helm template feloxi charts/feloxi \
  --set auth.jwtSecret="thisisasecretthatisatleast32chars" \
  --set postgresql.auth.password=pgpass \
  --set clickhouse.auth.password=chpass

# Full install on kind
kind create cluster --name feloxi-test
helm install feloxi charts/feloxi \
  --namespace feloxi --create-namespace \
  --set auth.jwtSecret="thisisasecretthatisatleast32chars" \
  --set postgresql.auth.password=pgpass \
  --set clickhouse.auth.password=chpass \
  --wait --timeout 5m
kubectl get pods -n feloxi
```
