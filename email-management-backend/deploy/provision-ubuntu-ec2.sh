#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/email-management-backend}"
FRONTEND_DIR="${FRONTEND_DIR:-$APP_DIR/frontend-dist}"
APP_DATA_DIR="${APP_DATA_DIR:-/var/lib/email-management-worker}"
RUN_USER="${RUN_USER:-ubuntu}"
API_DOMAIN="${API_DOMAIN:-api.example.com}"
CORS_ORIGIN="${CORS_ORIGIN:-https://app.example.com}"
PORT="${PORT:-8788}"

if [[ ! -f "$APP_DIR/requirements.txt" ]]; then
  echo "requirements.txt not found in $APP_DIR" >&2
  exit 1
fi

if [[ ! -f "$FRONTEND_DIR/index.html" ]]; then
  echo "frontend index.html not found in $FRONTEND_DIR" >&2
  exit 1
fi

sudo apt-get update
sudo apt-get install -y python3-venv python3-pip nginx

sudo chown -R "$RUN_USER:$RUN_USER" "$APP_DIR"
sudo mkdir -p "$APP_DATA_DIR"
sudo chown -R "$RUN_USER:$RUN_USER" "$APP_DATA_DIR"

if [[ -f "$APP_DIR/.env" ]]; then
  set -a
  source "$APP_DIR/.env"
  set +a
fi

python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install --upgrade pip
"$APP_DIR/.venv/bin/pip" install -r "$APP_DIR/requirements.txt"

cat > "$APP_DIR/.env" <<EOF
EMAIL_MANAGEMENT_WORKER_CORS_ORIGIN=$CORS_ORIGIN
EMAIL_MANAGEMENT_WORKER_FRONTEND_DIR=$FRONTEND_DIR
EMAIL_MANAGEMENT_WORKER_DB_PATH=${EMAIL_MANAGEMENT_WORKER_DB_PATH:-$APP_DATA_DIR/email_management_worker.sqlite3}
EMAIL_MANAGEMENT_WORKER_SENSITIVE_KEY_PATH=${EMAIL_MANAGEMENT_WORKER_SENSITIVE_KEY_PATH:-$APP_DATA_DIR/email_management_worker_sensitive_fernet.key}
EMAIL_MANAGEMENT_WORKER_MAIL_FETCH_LIMIT=${EMAIL_MANAGEMENT_WORKER_MAIL_FETCH_LIMIT:-20}
EMAIL_MANAGEMENT_WORKER_AUTH_SESSION_TTL_DAYS=${EMAIL_MANAGEMENT_WORKER_AUTH_SESSION_TTL_DAYS:-30}
EMAIL_MANAGEMENT_WORKER_GOOGLE_CLIENT_ID=${EMAIL_MANAGEMENT_WORKER_GOOGLE_CLIENT_ID:-}
EMAIL_MANAGEMENT_WORKER_GOOGLE_CLIENT_SECRET=${EMAIL_MANAGEMENT_WORKER_GOOGLE_CLIENT_SECRET:-}
EMAIL_MANAGEMENT_WORKER_GOOGLE_REDIRECT_URI=${EMAIL_MANAGEMENT_WORKER_GOOGLE_REDIRECT_URI:-}
EMAIL_MANAGEMENT_WORKER_GOOGLE_AUTH_URL=${EMAIL_MANAGEMENT_WORKER_GOOGLE_AUTH_URL:-https://accounts.google.com/o/oauth2/v2/auth}
EMAIL_MANAGEMENT_WORKER_GOOGLE_TOKEN_URL=${EMAIL_MANAGEMENT_WORKER_GOOGLE_TOKEN_URL:-https://oauth2.googleapis.com/token}
EMAIL_MANAGEMENT_WORKER_GMAIL_API_BASE_URL=${EMAIL_MANAGEMENT_WORKER_GMAIL_API_BASE_URL:-https://gmail.googleapis.com/gmail/v1}
EMAIL_MANAGEMENT_WORKER_GOOGLE_STATE_SECRET=${EMAIL_MANAGEMENT_WORKER_GOOGLE_STATE_SECRET:-}
EMAIL_MANAGEMENT_WORKER_TURNSTILE_SITE_KEY=${EMAIL_MANAGEMENT_WORKER_TURNSTILE_SITE_KEY:-}
EMAIL_MANAGEMENT_WORKER_TURNSTILE_SECRET_KEY=${EMAIL_MANAGEMENT_WORKER_TURNSTILE_SECRET_KEY:-}
EMAIL_MANAGEMENT_WORKER_TURNSTILE_VERIFY_URL=${EMAIL_MANAGEMENT_WORKER_TURNSTILE_VERIFY_URL:-https://challenges.cloudflare.com/turnstile/v0/siteverify}
PORT=$PORT
EOF
chmod 600 "$APP_DIR/.env"

sudo cp "$APP_DIR/deploy/email-management-backend.service" /etc/systemd/system/email-management-backend.service
sudo sed -i "s#__APP_DIR__#$APP_DIR#g" /etc/systemd/system/email-management-backend.service
sudo sed -i "s#__RUN_USER__#$RUN_USER#g" /etc/systemd/system/email-management-backend.service
sudo sed -i "s#__PORT__#$PORT#g" /etc/systemd/system/email-management-backend.service

sudo cp "$APP_DIR/deploy/nginx-api.conf" /etc/nginx/sites-available/email-management-worker-api
sudo sed -i "s#__API_DOMAIN__#$API_DOMAIN#g" /etc/nginx/sites-available/email-management-worker-api
sudo sed -i "s#__PORT__#$PORT#g" /etc/nginx/sites-available/email-management-worker-api
sudo ln -sf /etc/nginx/sites-available/email-management-worker-api /etc/nginx/sites-enabled/email-management-worker-api

sudo nginx -t
sudo systemctl daemon-reload
sudo systemctl enable email-management-backend
sudo systemctl restart email-management-backend
sudo systemctl reload nginx

echo "Provisioned successfully:"
echo "  app dir: $APP_DIR"
echo "  frontend dir: $FRONTEND_DIR"
echo "  data dir: $APP_DATA_DIR"
echo "  api domain: $API_DOMAIN"
echo "  cors origin: $CORS_ORIGIN"
