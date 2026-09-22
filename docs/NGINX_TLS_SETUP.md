# nginx Configuration for MinIO HTTPS (Secure SSE-C)

This guide describes the nginx changes required to proxy HTTPS connections to MinIO with proper certificate verification.

## Current Issue

The current nginx configuration proxies to `http://127.0.0.1:9000/`, which causes MinIO to reject SSE-C (Server-Side Encryption with Customer-provided keys) upload requests with HTTP 400 error: "must be made over a secure connection". This is because MinIO requires actual TLS for SSE-C operations, not just an `X-Forwarded-Proto: https` header.

## Solution

Update the nginx `/storage/` location block to proxy over HTTPS with proper certificate verification against the internal CA.

## Step 1: Prepare nginx Configuration (Pre-Deployment)

Before applying changes to the live nginx configuration, create a new block for HTTPS proxying. This is a **temporary workaround** to dual-proxy both HTTP and HTTPS during transition:

```nginx
# Reverse proxy for the Memory App API — memories.ai970.cloud
# This file only touches this one subdomain's traffic — it does not
# interact with any other server blocks / apps already on this VPS.

server {
    listen 80;
    listen [::]:80;
    server_name memories.ai970.cloud;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # NOTE: This file was rewritten by Certbot to add HTTPS/SSL below.
    # The /storage/ location and SSL config follow (Certbot-generated).
}
```

The live `/etc/nginx/sites-available/memory-app.conf` already contains the Certbot-generated SSL block. **Do not replace the entire file** — only update the relevant location block as shown in Step 2 below.

## Step 2: Update `/storage/` Location Block (Production Deployment)

On the VPS, edit `/etc/nginx/sites-available/memory-app.conf` and locate the `/storage/` location block (currently proxying to `http://127.0.0.1:9000/`).

Replace it with:

```nginx
location /storage/ {
    proxy_pass https://127.0.0.1:9000/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_request_buffering off;
    chunked_transfer_encoding off;
    client_max_body_size 100M;
    
    # TLS certificate verification for internal MinIO connection:
    proxy_ssl_verify on;                                               # Enable verification
    proxy_ssl_verify_depth 2;                                          # Chain depth: root CA → server cert
    proxy_ssl_trusted_certificate /etc/nginx/ssl/memory-app/internal-ca.crt;
    proxy_ssl_server_name off;                                         # Connecting to IP (127.0.0.1), not hostname
    proxy_ssl_session_reuse on;                                        # Performance optimization
}
```

**Key changes:**
- `proxy_pass https://` instead of `http://` (required for SSE-C)
- Added `proxy_ssl_verify on`, `proxy_ssl_verify_depth 2`, `proxy_ssl_trusted_certificate` (certificate verification)
- Added `proxy_ssl_server_name off` (connecting to IP, not hostname)
- Added `proxy_ssl_session_reuse on` (performance)
- Added `chunked_transfer_encoding off` (required for proxying large uploads)
- Preserved existing headers and `client_max_body_size 100M`

## Step 3: Validate Configuration Syntax (Before Reload)

On the VPS, test the nginx configuration **before reloading**:

```bash
# Test syntax only (does not reload)
sudo nginx -t

# Expected output:
# nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
# nginx: configuration will be successful
```

If the test passes, proceed to Step 4. If it fails, fix the syntax error and re-test.

## Step 4: Reload nginx (After Validation)

```bash
# Reload nginx with the new configuration
sudo systemctl reload nginx

# Verify the reload succeeded (should show no errors)
sudo systemctl status nginx
```

If the reload fails, nginx automatically falls back to the previous configuration. Check the error logs:

```bash
sudo tail -50 /var/log/nginx/error.log
```

## Step 5: Verify HTTPS Proxying

After deployment, verify that the MinIO HTTPS proxying works correctly:

```bash
# From the API container (or any container with curl):
curl -v --cacert /root/.minio/certs/ca.crt https://127.0.0.1:9000/minio/health/live

# Expected output: 200 OK or similar healthy response
```

Alternatively, from the host (outside Docker):

```bash
# Test through nginx:
curl -v -H "Authorization: Bearer <valid_token>" \
  https://memories.ai970.cloud/storage/minio/health/live \
  --cacert /root/apps/memory-app/certs/internal-ca.crt

# Expected: proxied to MinIO, should return health status
```

## Rollback Plan

If HTTPS proxying causes issues, revert to HTTP proxying:

```bash
# On VPS:
# Edit /etc/nginx/sites-available/memory-app.conf
# Change: proxy_pass https://127.0.0.1:9000/
# Back to: proxy_pass http://127.0.0.1:9000/

# Remove TLS directives (proxy_ssl_* lines)

# Test syntax:
sudo nginx -t

# Reload:
sudo systemctl reload nginx
```

## Files Deployed

After completing these steps, the following file state should exist:

```
/root/apps/memory-app/certs/
├── internal-ca.crt               (0644, deployed by docker-compose.prod.yml)
├── internal-ca.key               (0600, backup only, never deployed)
├── minio-server.crt              (0644, deployed by docker-compose.prod.yml)
└── minio-server.key              (0600, deployed by docker-compose.prod.yml)

/etc/nginx/ssl/memory-app/
└── internal-ca.crt               (0644, root:root, manually copied)

/etc/nginx/sites-available/
└── memory-app.conf               (LIVE production config, modified by these steps)
```

## Notes

- nginx connects to `127.0.0.1:9000` (IP-based, not DNS). The MinIO certificate contains `IP:127.0.0.1` SAN, which nginx verifies automatically.
- `proxy_ssl_server_name off` disables SNI (Server Name Indication) because we're connecting to an IP, not a hostname. nginx still verifies the certificate chain and SANs against the trusted CA.
- The internal CA is not a system CA — it's only trusted for nginx connections to MinIO. External HTTPS connections (Clerk, Anthropic, etc.) continue to use the system CA bundle.
- See `docs/CERTIFICATES.md` for certificate generation, renewal, and troubleshooting.
