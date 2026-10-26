#!/bin/sh
# Startup script of the shoebox-worker e2-micro VM (test env, owner decision 2026-10-26 [test-env]).
# Runs on every boot: adds 1 GB swap, installs Docker once, then pulls and starts the worker image
# named in the instance metadata key "worker-image". Secrets come from Secret Manager at start, so
# they are never stored in the VM metadata. A deploy sets the metadata and resets the VM.
set -eu
if [ ! -f /swapfile ]; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
swapon -a || true
if ! command -v docker >/dev/null 2>&1; then
  apt-get update && apt-get install -y --no-install-recommends docker.io
  systemctl enable --now docker
fi

MD=http://metadata.google.internal/computeMetadata/v1
IMAGE=$(curl -sf -H 'Metadata-Flavor: Google' "$MD/instance/attributes/worker-image")
PROJECT=$(curl -sf -H 'Metadata-Flavor: Google' "$MD/project/project-id")
TOKEN=$(curl -sf -H 'Metadata-Flavor: Google' "$MD/instance/service-accounts/default/token" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')

: > /run/worker.env
chmod 600 /run/worker.env
for NAME in ANTHROPIC_API_KEY SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY DATABASE_URL WORKER_DATABASE_URL; do
  VALUE=$(curl -sf -H "Authorization: Bearer $TOKEN" \
    "https://secretmanager.googleapis.com/v1/projects/$PROJECT/secrets/$NAME/versions/latest:access" \
    | python3 -c 'import base64,json,sys; print(base64.b64decode(json.load(sys.stdin)["payload"]["data"]).decode())')
  printf '%s=%s\n' "$NAME" "$VALUE" >> /run/worker.env
done
printf '%s\n' APP_ENV=test SHOEBOX_LLM_PROVIDER=anthropic SHOEBOX_LLM_MODEL=claude-haiku-5-5 PORT=8081 \
  >> /run/worker.env

REGISTRY=${IMAGE%%/*}
curl -sf -H "Authorization: Bearer $TOKEN" -o /dev/null "https://$REGISTRY/v2/" || true
printf '%s' "$TOKEN" | docker login -u oauth2accesstoken --password-stdin "https://$REGISTRY"
docker pull "$IMAGE"
docker rm -f worker 2>/dev/null || true
docker run -d --name worker --restart unless-stopped --memory 700m --env-file /run/worker.env "$IMAGE"
