#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRETS_DIR="$ROOT_DIR/.secrets"
SECRETS_FILE="$SECRETS_DIR/worker-secrets.env"

mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR" 2>/dev/null || true

make_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32
  else
    node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  fi
}

if [[ ! -f "$SECRETS_FILE" ]]; then
  cat > "$SECRETS_FILE" <<EOF_INNER
EMAIL_MANAGEMENT_WORKER_SESSION_SECRET=$(make_secret)
EMAIL_MANAGEMENT_WORKER_ENCRYPTION_SECRET=$(make_secret)
EOF_INNER
  chmod 600 "$SECRETS_FILE" 2>/dev/null || true
  echo "已生成本地密钥文件：$SECRETS_FILE"
else
  echo "复用已有本地密钥文件：$SECRETS_FILE"
fi

# shellcheck disable=SC1090
source "$SECRETS_FILE"

if [[ -z "${EMAIL_MANAGEMENT_WORKER_SESSION_SECRET:-}" || -z "${EMAIL_MANAGEMENT_WORKER_ENCRYPTION_SECRET:-}" ]]; then
  echo "密钥文件缺少必要字段，请删除后重新运行：$SECRETS_FILE" >&2
  exit 1
fi

printf '%s' "$EMAIL_MANAGEMENT_WORKER_SESSION_SECRET" | npx wrangler secret put EMAIL_MANAGEMENT_WORKER_SESSION_SECRET
printf '%s' "$EMAIL_MANAGEMENT_WORKER_ENCRYPTION_SECRET" | npx wrangler secret put EMAIL_MANAGEMENT_WORKER_ENCRYPTION_SECRET

echo "Worker Secrets 已上传完成。"
echo "本地密钥文件已保存在 .secrets/，请勿公开分享。"
