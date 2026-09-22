# TLS Certificate Management for MinIO Internal Communication

This document describes certificate generation, deployment, and renewal for HTTPS communication between nginx and MinIO (SSE-C operations over secure connection).

## Architecture Overview

- **Internal CA**: Self-signed root certificate authority (`internal-ca.crt`, `internal-ca.key`) — not publicly trusted, only for internal VPS communication
- **MinIO Server Certificate**: Signed by internal CA, contains SANs for:
  - `DNS:minio` (Docker internal hostname)
  - `DNS:localhost` (healthcheck)
  - `IP:127.0.0.1` (nginx proxy)
- **nginx Configuration**: Verifies MinIO certificate against internal CA before proxying requests

## Certificate Storage

### On VPS (never committed to Git)

Location: `/root/apps/memory-app/certs/`

```
internal-ca.key    (0600, private: CA signing key — used only for cert generation/renewal)
internal-ca.crt    (0644, public: CA certificate)
minio-server.key   (0600, private: MinIO server private key)
minio-server.crt   (0644, public: MinIO server certificate, signed by CA)
```

### In Git repository

```
.gitignore:
  infra/certs/*.key
  infra/certs/internal-ca.crt

docs/CERTIFICATES.md (this file)
```

### In Running Containers (mounted, not owned by container)

- **MinIO container** (`/root/.minio/certs/`):
  - `public.crt` (MinIO server certificate)
  - `private.key` (MinIO server private key)
  - `ca.crt` (Internal CA for healthcheck verification)
- **API Node.js container** (`/etc/ssl/certs/`):
  - `internal-ca.crt` (CA certificate, read via NODE_EXTRA_CA_CERTS)
- **nginx** (`/etc/nginx/ssl/memory-app/`):
  - `internal-ca.crt` (CA certificate, read via proxy_ssl_trusted_certificate)

## Initial Certificate Generation (First-Time Setup)

Run these commands on the VPS in a secure location (as root):

```bash
cd /root/apps/memory-app/certs

# Step 1: Create CA with proper extensions
cat > /tmp/ca-extensions.conf <<'EOF'
[ca_cert_extensions]
basicConstraints = critical, CA:TRUE
keyUsage = critical, keyCertSign, cRLSign
EOF

openssl genrsa -out internal-ca.key 2048
openssl req -new -x509 -days 3650 -key internal-ca.key -out internal-ca.crt \
  -subj "/CN=Memory App Internal CA/O=Memory App/C=US" \
  -extensions ca_cert_extensions -config /tmp/ca-extensions.conf

chmod 600 internal-ca.key
chmod 644 internal-ca.crt

# Step 2: Generate MinIO server key and CSR
cat > /tmp/server-extensions.conf <<'EOF'
[server_cert_extensions]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = DNS:minio, DNS:localhost, IP:127.0.0.1
EOF

openssl genrsa -out minio-server.key 2048
openssl req -new -key minio-server.key -out minio-server.csr \
  -subj "/CN=minio/O=Memory App/C=US" \
  -extensions server_cert_extensions -config /tmp/server-extensions.conf

chmod 600 minio-server.key

# Step 3: Sign server certificate with CA
openssl x509 -req -in minio-server.csr \
  -CA internal-ca.crt -CAkey internal-ca.key -CAcreateserial \
  -out minio-server.crt -days 1095 \
  -extensions server_cert_extensions -extfile /tmp/server-extensions.conf

chmod 644 minio-server.crt

# Cleanup
rm minio-server.csr internal-ca.srl
rm /tmp/ca-extensions.conf /tmp/server-extensions.conf
```

**Verification:**

```bash
# Verify CA certificate
openssl x509 -in internal-ca.crt -text -noout | grep -A 5 "X509v3 extensions"
# Expected: basicConstraints = critical,CA:TRUE; keyUsage = critical,keyCertSign,cRLSign

# Verify server certificate
openssl x509 -in minio-server.crt -text -noout | grep -A 10 "X509v3 extensions"
# Expected: basicConstraints = critical,CA:FALSE; keyUsage = critical,digitalSignature,keyEncipherment; 
#           extendedKeyUsage = serverAuth; subjectAltName = DNS:minio,DNS:localhost,IP:127.0.0.1

# Verify certificate chain
openssl verify -CAfile internal-ca.crt minio-server.crt
# Expected: minio-server.crt: OK
```

## Deployment Steps

### 1. Copy CA to nginx configuration directory

```bash
sudo mkdir -p /etc/nginx/ssl/memory-app
sudo cp /root/apps/memory-app/certs/internal-ca.crt /etc/nginx/ssl/memory-app/internal-ca.crt
sudo chown root:root /etc/nginx/ssl/memory-app/internal-ca.crt
sudo chmod 644 /etc/nginx/ssl/memory-app/internal-ca.crt
```

### 2. Update docker-compose.prod.yml

Mount certificates into containers (see deployment section below).

### 3. Validate nginx configuration (on VPS)

```bash
# Create temporary backup of current nginx config
sudo cp /etc/nginx/sites-available/memory-app.conf /etc/nginx/sites-available/memory-app.conf.backup

# Edit the file to add HTTPS upstream and verify
sudo nginx -t

# If test passes, reload; if fails, restore backup
sudo systemctl reload nginx
# Or if reload fails:
# sudo cp /etc/nginx/sites-available/memory-app.conf.backup /etc/nginx/sites-available/memory-app.conf
# sudo systemctl reload nginx
```

### 4. Restart MinIO container with certificate mounts

```bash
cd /root/apps/memory-app
docker compose -f docker-compose.prod.yml up -d --force-recreate minio
docker compose -f docker-compose.prod.yml logs -f minio
# Wait for "Listening on" message for both :9000 and :9001 over HTTPS
```

### 5. Restart API container with CA environment variable

```bash
docker compose -f docker-compose.prod.yml up -d --force-recreate api
docker compose -f docker-compose.prod.yml logs -f api
# Verify startup succeeds; check for S3 connection tests if present
```

### 6. Test healthchecks

```bash
# Check MinIO healthcheck status
docker inspect memory-app-minio --format='{{.State.Health.Status}}'
# Expected: healthy

# Check docker compose health summary
docker compose -f docker-compose.prod.yml ps
# All services should be "healthy" or "running"
```

## Certificate Renewal

MinIO server certificate expires after 1095 days (3 years). To renew:

```bash
cd /root/apps/memory-app/certs

# Step 1: Generate new server key and CSR (same as initial generation)
cat > /tmp/server-extensions.conf <<'EOF'
[server_cert_extensions]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = DNS:minio, DNS:localhost, IP:127.0.0.1
EOF

openssl genrsa -out minio-server.key.new 2048
openssl req -new -key minio-server.key.new -out minio-server.csr \
  -subj "/CN=minio/O=Memory App/C=US" \
  -extensions server_cert_extensions -config /tmp/server-extensions.conf

# Step 2: Sign with CA
openssl x509 -req -in minio-server.csr \
  -CA internal-ca.crt -CAkey internal-ca.key -CAcreateserial \
  -out minio-server.crt.new -days 1095 \
  -extensions server_cert_extensions -extfile /tmp/server-extensions.conf

# Step 3: Backup current and activate new
cp minio-server.key minio-server.key.old
cp minio-server.crt minio-server.crt.old
mv minio-server.key.new minio-server.key
mv minio-server.crt.new minio-server.crt

chmod 600 minio-server.key
chmod 644 minio-server.crt

# Step 4: Restart MinIO
cd /root/apps/memory-app
docker compose -f docker-compose.prod.yml up -d --force-recreate minio

# Step 5: Verify healthcheck
sleep 5
docker compose -f docker-compose.prod.yml ps | grep minio
# Should show "healthy" status

# Cleanup on success
rm /root/apps/memory-app/certs/minio-server.csr /root/apps/memory-app/certs/internal-ca.srl /tmp/server-extensions.conf
```

## CA Certificate Renewal (Low Priority)

The CA certificate expires after 3650 days (10 years). Before expiration:

1. Repeat certificate generation steps (CA + server cert)
2. Update `/etc/nginx/ssl/memory-app/internal-ca.crt`
3. Update container mounts in docker-compose.prod.yml
4. Restart all affected services

## Troubleshooting

### MinIO healthcheck fails after certificate installation

Check MinIO logs:
```bash
docker compose -f docker-compose.prod.yml logs minio | head -50
```

Expected startup messages include TLS listening on both 9000 and 9001. If you see HTTP-only messages, certificates may not have been mounted correctly.

### nginx proxy fails with "certificate verify failed"

```bash
# Test certificate chain validity
openssl verify -CAfile /etc/nginx/ssl/memory-app/internal-ca.crt \
  /root/apps/memory-app/certs/minio-server.crt

# Check nginx error logs
sudo tail -50 /var/log/nginx/error.log

# Verify certificate SANs include IP:127.0.0.1
openssl x509 -in /root/apps/memory-app/certs/minio-server.crt -text -noout | grep -A 1 "Subject Alternative Name"
```

### API Node.js fails to connect to MinIO

Ensure `NODE_EXTRA_CA_CERTS` is set in docker-compose.prod.yml environment and points to `/etc/ssl/certs/internal-ca.crt` within the container.

```bash
# Verify API container has CA mounted
docker exec memory-app-api ls -la /etc/ssl/certs/internal-ca.crt

# Check NODE_EXTRA_CA_CERTS is set
docker exec memory-app-api env | grep NODE_EXTRA_CA_CERTS
```

## Private Key Security

- `internal-ca.key` is the master signing key. Store with 0600 permissions and keep offline backups in a secure location.
- `minio-server.key` is rotated on certificate renewal (1095-day cycle). Old copies can be securely deleted after verification that renewal succeeded.
- Neither private key is ever committed to Git (.gitignore entries prevent accidental commits).
- Private keys are never logged, transmitted in error messages, or exposed in monitoring systems.
