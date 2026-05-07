{{/*
Expand the name of the chart.
*/}}
{{- define "feloxi.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
Truncated at 63 chars because Kubernetes DNS naming spec.
*/}}
{{- define "feloxi.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the helm.sh/chart label.
*/}}
{{- define "feloxi.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to every resource.
*/}}
{{- define "feloxi.labels" -}}
helm.sh/chart: {{ include "feloxi.chart" . }}
{{ include "feloxi.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels (stable — used in Deployment/StatefulSet selectors and Services).
Do NOT add version-dependent fields here; selectors are immutable after first apply.
*/}}
{{- define "feloxi.selectorLabels" -}}
app.kubernetes.io/name: {{ include "feloxi.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
ServiceAccount name.
*/}}
{{- define "feloxi.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "feloxi.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Resolved API image (tag falls back to Chart.AppVersion).
*/}}
{{- define "feloxi.apiImage" -}}
{{- $tag := .Values.image.api.tag | default .Chart.AppVersion }}
{{- printf "%s:%s" .Values.image.api.repository $tag }}
{{- end }}

{{/*
Resolved web image (tag falls back to Chart.AppVersion).
*/}}
{{- define "feloxi.webImage" -}}
{{- $tag := .Values.image.web.tag | default .Chart.AppVersion }}
{{- printf "%s:%s" .Values.image.web.repository $tag }}
{{- end }}

{{/*
Name of the Secret used for JWT. Returns existingSecret when set,
otherwise the chart-generated secret.
*/}}
{{- define "feloxi.secretName" -}}
{{- if .Values.auth.existingSecret }}
{{- .Values.auth.existingSecret }}
{{- else }}
{{- printf "%s-secrets" (include "feloxi.fullname" .) }}
{{- end }}
{{- end }}

{{/*
Name of the Secret used for PostgreSQL credentials.
Falls back to the chart-generated secret.
*/}}
{{- define "feloxi.pgSecretName" -}}
{{- if .Values.postgresql.auth.existingSecret }}
{{- .Values.postgresql.auth.existingSecret }}
{{- else }}
{{- include "feloxi.secretName" . }}
{{- end }}
{{- end }}

{{/*
Name of the Secret used for ClickHouse credentials.
Falls back to the chart-generated secret.
*/}}
{{- define "feloxi.chSecretName" -}}
{{- if .Values.clickhouse.auth.existingSecret }}
{{- .Values.clickhouse.auth.existingSecret }}
{{- else }}
{{- include "feloxi.secretName" . }}
{{- end }}
{{- end }}

{{/*
Resolved PostgreSQL hostname (embedded service or external host).
*/}}
{{- define "feloxi.postgresHost" -}}
{{- if .Values.postgresql.enabled }}
{{- printf "%s-postgres" (include "feloxi.fullname" .) }}
{{- else }}
{{- required "externalPostgresql.host is required when postgresql.enabled=false" .Values.externalPostgresql.host }}
{{- end }}
{{- end }}

{{/*
Resolved ClickHouse hostname (embedded service or external host).
*/}}
{{- define "feloxi.clickhouseHost" -}}
{{- if .Values.clickhouse.enabled }}
{{- printf "%s-clickhouse" (include "feloxi.fullname" .) }}
{{- else }}
{{- required "externalClickhouse.host is required when clickhouse.enabled=false" .Values.externalClickhouse.host }}
{{- end }}
{{- end }}

{{/*
Resolved Redis hostname (embedded service or external host).
*/}}
{{- define "feloxi.redisHost" -}}
{{- if .Values.redis.enabled }}
{{- printf "%s-redis" (include "feloxi.fullname" .) }}
{{- else }}
{{- required "externalRedis.host is required when redis.enabled=false" .Values.externalRedis.host }}
{{- end }}
{{- end }}

{{/*
Resolved CORS origin. Uses corsOrigin value if set; derives from ingress host otherwise.
*/}}
{{- define "feloxi.corsOrigin" -}}
{{- if .Values.api.env.corsOrigin }}
{{- .Values.api.env.corsOrigin }}
{{- else if .Values.ingress.enabled }}
{{- $scheme := ternary "https" "http" .Values.ingress.tls }}
{{- printf "%s://%s" $scheme .Values.ingress.host }}
{{- end }}
{{- end }}
