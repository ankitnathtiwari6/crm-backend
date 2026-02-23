#!/bin/bash

#############################################
# CRM Backend — One-Time Server Setup Script
# DigitalOcean Ubuntu Droplet
# Domain : api.globalgrads.in
# Server : 68.183.86.63
# Run via DigitalOcean web console as root
#############################################

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ─── Configuration ─────────────────────────────────────────────
DOMAIN="api.globalgrads.in"
EMAIL="ankitnathtiwari6@gmail.com"        # used for SSL cert (Let's Encrypt)
PROJECT_DIR="/root/crm-backend"
REPO_URL="https://github.com/ankitnathtiwari6/crm-backend.git"
APP_PORT=3000
# ───────────────────────────────────────────────────────────────

print_status()  { echo -e "${GREEN}[✓]${NC} $1"; }
print_error()   { echo -e "${RED}[✗]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[!]${NC} $1"; }
print_step()    { echo -e "\n${YELLOW}$1${NC}"; }
print_banner()  {
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

echo ""
print_banner "CRM Backend — Server Setup"
echo ""

# ─── Root check ────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
    print_error "Please run as root: bash deploy.sh"
    exit 1
fi

# ═══════════════════════════════════════════════════════════════
# STEP 0 — Generate SSH deploy key for GitHub Actions
# ═══════════════════════════════════════════════════════════════
print_step "Step 0: Generating SSH deploy key for GitHub Actions..."

mkdir -p /root/.ssh
chmod 700 /root/.ssh

if [ ! -f /root/.ssh/github_actions_deploy ]; then
    ssh-keygen -t ed25519 -C "github-actions-crm-deploy" \
        -f /root/.ssh/github_actions_deploy -N ""
    print_status "SSH deploy key generated"
else
    print_warning "SSH deploy key already exists — skipping generation"
fi

# Add public key to authorized_keys (idempotent)
PUB_KEY=$(cat /root/.ssh/github_actions_deploy.pub)
if ! grep -qF "$PUB_KEY" /root/.ssh/authorized_keys 2>/dev/null; then
    echo "$PUB_KEY" >> /root/.ssh/authorized_keys
    chmod 600 /root/.ssh/authorized_keys
    print_status "Public key added to authorized_keys"
fi

echo ""
print_banner "ACTION REQUIRED — Add this private key to GitHub Secrets"
echo ""
echo -e "${YELLOW}Secret name: ${GREEN}DO_SSH_PRIVATE_KEY${NC}"
echo ""
cat /root/.ssh/github_actions_deploy
echo ""
print_banner "End of private key"
echo ""
read -rp "$(echo -e ${YELLOW}Press Enter after you have copied the private key to GitHub Secrets...${NC})"

# ═══════════════════════════════════════════════════════════════
# STEP 1 — Update system
# ═══════════════════════════════════════════════════════════════
print_step "Step 1: Updating system packages..."
apt update -y && apt upgrade -y
print_status "System updated"

# ═══════════════════════════════════════════════════════════════
# STEP 2 — Install Docker
# ═══════════════════════════════════════════════════════════════
print_step "Step 2: Installing Docker..."
if ! command -v docker &>/dev/null; then
    apt install -y apt-transport-https ca-certificates curl software-properties-common gnupg lsb-release
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
        gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] \
https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
        | tee /etc/apt/sources.list.d/docker.list >/dev/null
    apt update -y
    apt install -y docker-ce docker-ce-cli containerd.io
    systemctl enable docker
    systemctl start docker
    print_status "Docker installed"
else
    print_status "Docker already installed ($(docker --version))"
fi

# Configure Docker daemon with registry mirror (fixes Docker Hub timeout on BLR region)
echo -e "${YELLOW}Configuring Docker registry mirror...${NC}"
cat > /etc/docker/daemon.json << 'EOF'
{
  "registry-mirrors": ["https://mirror.gcr.io"],
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF
systemctl restart docker
sleep 3
print_status "Docker daemon configured with registry mirror"

# ═══════════════════════════════════════════════════════════════
# STEP 3 — Install Docker Compose
# ═══════════════════════════════════════════════════════════════
print_step "Step 3: Installing Docker Compose..."
if ! command -v docker-compose &>/dev/null; then
    COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest \
        | grep '"tag_name"' | cut -d'"' -f4)
    curl -L "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" \
        -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    print_status "Docker Compose installed (${COMPOSE_VERSION})"
else
    print_status "Docker Compose already installed ($(docker-compose --version))"
fi

# ═══════════════════════════════════════════════════════════════
# STEP 4 — Install Nginx
# ═══════════════════════════════════════════════════════════════
print_step "Step 4: Installing Nginx..."
if ! command -v nginx &>/dev/null; then
    apt install -y nginx
    systemctl enable nginx
    systemctl start nginx
    print_status "Nginx installed"
else
    print_status "Nginx already installed"
fi

# ═══════════════════════════════════════════════════════════════
# STEP 5 — Install Git & Certbot
# ═══════════════════════════════════════════════════════════════
print_step "Step 5: Installing Git and Certbot..."
apt install -y git certbot python3-certbot-nginx
print_status "Git and Certbot installed"

# ═══════════════════════════════════════════════════════════════
# STEP 6 — Clone repository
# ═══════════════════════════════════════════════════════════════
print_step "Step 6: Cloning repository..."
if [ -d "$PROJECT_DIR/.git" ]; then
    print_warning "Repo already cloned — pulling latest..."
    cd "$PROJECT_DIR"
    git fetch origin
    git reset --hard origin/$(git symbolic-ref --short HEAD)
else
    git clone "$REPO_URL" "$PROJECT_DIR"
    print_status "Repository cloned to $PROJECT_DIR"
fi

# ═══════════════════════════════════════════════════════════════
# STEP 7 — Create placeholder .env
#   GitHub Actions will overwrite this with real secrets on
#   every deploy. This placeholder lets docker-compose validate.
# ═══════════════════════════════════════════════════════════════
print_step "Step 7: Creating .env file..."
if [ ! -f "$PROJECT_DIR/.env" ]; then
    cat > "$PROJECT_DIR/.env" << 'EOF'
PORT=3000
NODE_ENV=production
LOG_LEVEL=info

JWT_SECRET=REPLACE_VIA_GITHUB_ACTIONS

MONGODB_URI=REPLACE_VIA_GITHUB_ACTIONS

WHATSAPP_ACCESS_TOKEN=REPLACE_VIA_GITHUB_ACTIONS
WHATSAPP_PHONE_NUMBER_ID=REPLACE_VIA_GITHUB_ACTIONS
WHATSAPP_VERIFY_TOKEN=REPLACE_VIA_GITHUB_ACTIONS

GEMINI_API_KEY=REPLACE_VIA_GITHUB_ACTIONS
EOF
    print_status "Placeholder .env created (GitHub Actions will overwrite with real values on first deploy)"
else
    print_warning ".env already exists — skipping"
fi

# ═══════════════════════════════════════════════════════════════
# STEP 8 — Configure firewall
# ═══════════════════════════════════════════════════════════════
print_step "Step 8: Configuring firewall..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
print_status "Firewall configured (SSH + HTTP/HTTPS allowed)"

# ═══════════════════════════════════════════════════════════════
# STEP 9 — Configure Nginx (HTTP only — SSL added in step 11)
# ═══════════════════════════════════════════════════════════════
print_step "Step 9: Configuring Nginx..."
cat > /etc/nginx/sites-available/$DOMAIN << EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    # Security headers
    add_header X-Frame-Options       "SAMEORIGIN"   always;
    add_header X-Content-Type-Options "nosniff"      always;
    add_header X-XSS-Protection      "1; mode=block" always;

    # Logging
    access_log /var/log/nginx/${DOMAIN}.access.log;
    error_log  /var/log/nginx/${DOMAIN}.error.log;

    client_max_body_size 10M;

    location / {
        proxy_pass         http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;

        proxy_set_header Upgrade           \$http_upgrade;
        proxy_set_header Connection        'upgrade';
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        proxy_connect_timeout 60s;
        proxy_send_timeout    60s;
        proxy_read_timeout    60s;
        proxy_cache_bypass    \$http_upgrade;
    }

    location /health {
        proxy_pass  http://127.0.0.1:${APP_PORT}/health;
        access_log  off;
    }
}
EOF

ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

nginx -t && systemctl reload nginx
print_status "Nginx configured for HTTP"

# ═══════════════════════════════════════════════════════════════
# STEP 10 — Build and start Docker containers
# ═══════════════════════════════════════════════════════════════
print_step "Step 10: Building and starting Docker containers..."
cd "$PROJECT_DIR"
docker-compose down 2>/dev/null || true
docker-compose up -d --build
print_status "Docker containers started"

# Wait for container to be healthy
echo "Waiting for backend to be ready..."
TRIES=0
until docker exec crm-backend wget -qO- http://localhost:${APP_PORT}/health &>/dev/null; do
    TRIES=$((TRIES + 1))
    [ $TRIES -ge 30 ] && { print_error "Backend did not start in time"; docker-compose logs; exit 1; }
    echo "  Attempt $TRIES/30..."
    sleep 3
done
print_status "Backend is healthy"

# ═══════════════════════════════════════════════════════════════
# STEP 11 — Obtain SSL certificate (Let's Encrypt)
# ═══════════════════════════════════════════════════════════════
print_step "Step 11: Obtaining SSL certificate for ${DOMAIN}..."

SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || echo "unknown")
DOMAIN_IP=$(dig +short "$DOMAIN" 2>/dev/null | tail -n1 || echo "unknown")

if [ "$SERVER_IP" != "$DOMAIN_IP" ]; then
    print_warning "DNS check: server IP ($SERVER_IP) ≠ domain IP ($DOMAIN_IP)"
    print_warning "Ensure $DOMAIN → 68.183.86.63 in GoDaddy DNS before continuing"
    read -rp "$(echo -e ${YELLOW}Continue anyway? [y/N]: ${NC})" REPLY
    [[ ! $REPLY =~ ^[Yy]$ ]] && { echo "Aborted. Re-run after DNS propagates."; exit 1; }
fi

certbot --nginx \
    -d "$DOMAIN" \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    --redirect

print_status "SSL certificate obtained — HTTPS enabled"

# Test auto-renewal
certbot renew --dry-run && print_status "SSL auto-renewal configured"

# ═══════════════════════════════════════════════════════════════
# STEP 12 — Final verification
# ═══════════════════════════════════════════════════════════════
print_step "Step 12: Final verification..."
sleep 3

HTTPS_STATUS=$(curl -sk -o /dev/null -w "%{http_code}" "https://${DOMAIN}/health" 2>/dev/null || echo "000")
if [ "$HTTPS_STATUS" = "200" ]; then
    print_status "HTTPS health check passed (200 OK)"
else
    print_warning "HTTPS returned $HTTPS_STATUS — may need DNS propagation time"
fi

docker-compose -f "$PROJECT_DIR/docker-compose.yml" ps

echo ""
print_banner "Setup Complete!"
echo ""
echo -e "  API URL  : ${GREEN}https://${DOMAIN}${NC}"
echo -e "  App dir  : ${GREEN}${PROJECT_DIR}${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Go to GitHub → Settings → Secrets → Actions"
echo "  2. Add the following secrets:"
echo ""
echo -e "     ${GREEN}DO_SSH_PRIVATE_KEY${NC}        — private key shown in Step 0"
echo -e "     ${GREEN}PORT${NC}                      — 3000"
echo -e "     ${GREEN}NODE_ENV${NC}                  — production"
echo -e "     ${GREEN}LOG_LEVEL${NC}                 — info"
echo -e "     ${GREEN}JWT_SECRET${NC}                — your JWT secret"
echo -e "     ${GREEN}MONGODB_URI${NC}               — your MongoDB connection string"
echo -e "     ${GREEN}WHATSAPP_ACCESS_TOKEN${NC}     — your token"
echo -e "     ${GREEN}WHATSAPP_PHONE_NUMBER_ID${NC}  — your phone number ID"
echo -e "     ${GREEN}WHATSAPP_VERIFY_TOKEN${NC}     — your verify token"
echo -e "     ${GREEN}GEMINI_API_KEY${NC}            — your Gemini API key"
echo ""
echo "  3. Push to main/master — GitHub Actions will deploy automatically"
echo ""
echo -e "${YELLOW}Useful commands:${NC}"
echo "  docker-compose -f $PROJECT_DIR/docker-compose.yml logs -f"
echo "  docker-compose -f $PROJECT_DIR/docker-compose.yml restart"
echo "  tail -f /var/log/nginx/${DOMAIN}.access.log"
echo "  certbot certificates"
echo ""
