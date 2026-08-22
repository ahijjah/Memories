# Production Deployment — VPS Setup Runbook

This is a **one-time setup**, done once on the VPS. After this, every push
to `main` deploys automatically via `.github/workflows/deploy.yml`.

Everything here is scoped to this project's own directory, containers,
network, and Nginx server block — nothing here modifies or restarts your
other apps on this VPS.

## 0. Before you start

Subdomain for this project: **memories.ai970.cloud** (already baked into
`infra/nginx/memory-app.conf` — no substitution needed).

Check nothing on the VPS is already using port 3000 on `127.0.0.1`, and
that `memory-app-postgres` / `memory-app-redis` / `memory-app-api` don't
collide with existing container names:

```bash
docker ps --format '{{.Names}}'
ss -tulpn | grep 3000
```

## 1. DNS

At your domain registrar / DNS provider, add an A record:

```
memories.ai970.cloud  ->  <your VPS IP>
```

Wait for it to propagate (`dig memories.ai970.cloud` should return your
VPS IP) before running Certbot in step 5.

## 2. Clone the repo on the VPS

```bash
mkdir -p ~/apps
cd ~/apps
git clone https://github.com/ahijjah/Memories.git memory-app
cd memory-app
```

## 3. Create the production env file (server-side only, never committed)

```bash
cp infra/.env.production.example infra/.env.production
nano infra/.env.production
```

Fill in real values — especially `POSTGRES_PASSWORD`, `JWT_SECRET`
(generate with `openssl rand -hex 32`), and `ANTHROPIC_API_KEY`.

## 4. First build and start (isolated Docker network + volumes)

```bash
cd infra
docker compose -f docker-compose.prod.yml --env-file .env.production build
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm api npm run prisma:deploy --workspace=apps/api
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
docker compose -f docker-compose.prod.yml ps
```

You should see `memory-app-postgres`, `memory-app-redis`, `memory-app-api`
running, with Postgres/Redis showing no host port mappings (internal-only
by design). Confirm the API is up locally on the VPS:

```bash
curl http://127.0.0.1:3000/docs
```

## 5. Install Nginx + Certbot (only if not already present)

If Nginx isn't installed anywhere on this VPS yet:

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

If Nginx **is** already running for other projects, skip installation —
you're just adding one more server block, which doesn't touch the others.

## 6. Add this project's Nginx server block

```bash
sudo cp ~/apps/memory-app/infra/nginx/memory-app.conf /etc/nginx/sites-available/memory-app.conf
sudo ln -s /etc/nginx/sites-available/memory-app.conf /etc/nginx/sites-enabled/memory-app.conf
sudo nginx -t   # validate config before reloading — catches typos safely
sudo systemctl reload nginx
```

`nginx -t` checks the *entire* Nginx config, including your existing
sites, but only reports errors — it does not change or restart anything by
itself. Only proceed to `reload` if it prints "syntax is ok" / "test is
successful".

## 7. Get an SSL certificate for the subdomain

```bash
sudo certbot --nginx -d memories.ai970.cloud
```

This only touches the `memory-app.conf` server block (matched by
`server_name`), adding the 443/SSL listener and HTTP→HTTPS redirect.
Certbot auto-renewal is typically already scheduled system-wide if you've
used it before on this VPS; if this is the first time, it sets up a
renewal timer that will also cover any future certs.

## 8. Firewall (only if not already open)

```bash
sudo ufw status
# If 80/443 aren't already allowed:
sudo ufw allow 80,443/tcp
```

Do **not** open 5432 or 6379 — they're intentionally not exposed outside
the Docker network.

## 9. Wire up automatic deploys

In the GitHub repo (Settings → Secrets and variables → Actions), add:

- `DEPLOY_SSH_HOST` — this VPS's IP/hostname
- `DEPLOY_SSH_USER` — the user you SSH'd in as above
- `DEPLOY_SSH_KEY` — a private key (PEM) authorized for that user (consider
  creating a dedicated deploy key rather than reusing your personal one)
- `DEPLOY_SSH_PORT` — only if not 22

From then on, every merge to `main` that passes CI will `git pull`, rebuild
the Docker image, run migrations, and restart just this project's
containers — via `.github/workflows/deploy.yml`.

## Rolling back

```bash
cd ~/apps/memory-app
git log --oneline -5          # find the commit to roll back to
git reset --hard <commit-sha>
cd infra
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

## Removing this project later (if ever needed)

Because everything is namespaced, teardown is clean and won't affect
anything else on the VPS:

```bash
cd ~/apps/memory-app/infra
docker compose -f docker-compose.prod.yml down -v   # -v also removes this project's volumes
sudo rm /etc/nginx/sites-enabled/memory-app.conf /etc/nginx/sites-available/memory-app.conf
sudo nginx -t && sudo systemctl reload nginx
sudo certbot delete --cert-name memories.ai970.cloud
```
