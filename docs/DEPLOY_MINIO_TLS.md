# MinIO HTTPS TLS Deployment Checklist

This document provides a **controlled, step-by-step deployment plan** for enabling HTTPS/TLS between nginx and MinIO to support SSE-C (Server-Side Encryption with Customer-provided keys) image uploads.

**Status:** All technical verification items complete. Ready for controlled deployment with validation at each phase.

## Deployment Phases

### Phase 0: Pre-Deployment Preparation (Local Development)

Ensure all code changes are committed and tested locally:

- [x] `apps/api/src/modules/assets/assets.service.ts` — `requestChecksumCalculation: 'WHEN_REQUIRED'` on `s3PublicClient` ✓
- [x] `apps/mobile/src/utils/photo-upload.ts` — Enhanced error logging with case-insensitive header checks ✓
- [x] `infra/docker-compose.prod.yml` — Updated with certificate mounts and HTTPS endpoint ✓
- [x] `.gitignore` — Added entries for private keys and CA certificate ✓
- [x] `docs/CERTIFICATES.md` — Certificate generation and renewal procedures ✓
- [x] `docs/NGINX_TLS_SETUP.md` — nginx HTTPS proxying configuration ✓

**Deliverable:** Commit message describing TLS infrastructure setup (non-secret files only).

### Phase 1: VPS Certificate Generation (One-Time)

On the VPS, as root, generate the internal CA and MinIO server certificate.

**Prerequisites:**
- SSH access to VPS as root
- `/root/apps/memory-app/` directory exists
- OpenSSL installed (standard on most Linux systems)

**Steps:**

1. Create certificate directory:
   ```bash
   mkdir -p /root/apps/memory-app/certs
   cd /root/apps/memory-app/certs
   ```

2. Generate internal CA and MinIO server certificate (from `docs/CERTIFICATES.md`, "Initial Certificate Generation" section):
   ```bash
   # Step 1: Generate CA
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

   # Step 2: Generate MinIO server certificate
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

   # Step 3: Sign certificate
   openssl x509 -req -in minio-server.csr \
     -CA internal-ca.crt -CAkey internal-ca.key -CAcreateserial \
     -out minio-server.crt -days 1095 \
     -extensions server_cert_extensions -extfile /tmp/server-extensions.conf
   chmod 644 minio-server.crt

   # Cleanup
   rm minio-server.csr internal-ca.srl
   rm /tmp/ca-extensions.conf /tmp/server-extensions.conf
   ```

3. Verify certificates:
   ```bash
   # Verify CA
   openssl x509 -in internal-ca.crt -text -noout | grep -A 5 "X509v3 extensions"
   # Expected: basicConstraints = critical,CA:TRUE

   # Verify server certificate
   openssl x509 -in minio-server.crt -text -noout | grep -A 10 "X509v3 extensions"
   # Expected: subjectAltName = DNS:minio,DNS:localhost,IP:127.0.0.1

   # Verify chain
   openssl verify -CAfile internal-ca.crt minio-server.crt
   # Expected: minio-server.crt: OK
   ```

4. Confirm file permissions:
   ```bash
   ls -la /root/apps/memory-app/certs/
   # Expected:
   # -rw-r--r-- internal-ca.crt (0644)
   # -rw------- internal-ca.key (0600)
   # -rw-r--r-- minio-server.crt (0644)
   # -rw------- minio-server.key (0600)
   ```

**Verification:** All four certificate files exist with correct permissions. `openssl verify` succeeds.

### Phase 2: nginx CA Certificate Deployment

Copy the internal CA certificate to nginx configuration directory (on VPS, as root):

```bash
sudo mkdir -p /etc/nginx/ssl/memory-app
sudo cp /root/apps/memory-app/certs/internal-ca.crt /etc/nginx/ssl/memory-app/internal-ca.crt
sudo chown root:root /etc/nginx/ssl/memory-app/internal-ca.crt
sudo chmod 644 /etc/nginx/ssl/memory-app/internal-ca.crt

# Verify:
ls -la /etc/nginx/ssl/memory-app/internal-ca.crt
# Expected: -rw-r--r-- root root
```

**Verification:** CA certificate accessible to nginx at correct path with correct permissions.

### Phase 3: Prepare docker-compose.prod.yml Configuration (Already Done)

Verify that `infra/docker-compose.prod.yml` contains:
- MinIO volume mounts for certificates (3 mounts: public.crt, private.key, ca.crt)
- MinIO healthcheck using `--cacert` with HTTPS endpoint
- API volume mount for internal CA certificate
- API environment variable `NODE_EXTRA_CA_CERTS: /etc/ssl/certs/internal-ca.crt`
- API environment variable `OBJECT_STORAGE_ENDPOINT: https://minio:9000`

**Verification:** `git diff infra/docker-compose.prod.yml` shows expected certificate mounts and HTTPS endpoint.

### Phase 4: nginx Configuration Update (Manual VPS Step)

On the VPS, update `/etc/nginx/sites-available/memory-app.conf` to proxy HTTPS to MinIO.

**Steps:**

1. Backup current nginx configuration:
   ```bash
   sudo cp /etc/nginx/sites-available/memory-app.conf /etc/nginx/sites-available/memory-app.conf.backup
   ```

2. Edit the `/storage/` location block (from `docs/NGINX_TLS_SETUP.md`):
   ```bash
   # Use your editor to update the location block:
   # - Change: proxy_pass http://127.0.0.1:9000/
   # - To: proxy_pass https://127.0.0.1:9000/
   # - Add TLS verification directives (proxy_ssl_verify, proxy_ssl_trusted_certificate, etc.)
   ```

3. Test syntax:
   ```bash
   sudo nginx -t
   # Expected: nginx: configuration file /etc/nginx/nginx.conf syntax is ok
   ```

4. If test passes, reload:
   ```bash
   sudo systemctl reload nginx
   sudo systemctl status nginx
   # Expected: active (running)
   ```

5. If test fails, restore backup:
   ```bash
   sudo cp /etc/nginx/sites-available/memory-app.conf.backup /etc/nginx/sites-available/memory-app.conf
   sudo systemctl reload nginx
   ```

**Verification:** `sudo nginx -t` passes, nginx reloads successfully.

### Phase 5: Container Restart with TLS

On the VPS, restart MinIO and API containers with new configuration:

```bash
cd /root/apps/memory-app

# Recreate MinIO with certificate mounts
docker compose -f docker-compose.prod.yml up -d --force-recreate minio

# Wait for MinIO to start and verify healthcheck
sleep 10
docker compose -f docker-compose.prod.yml ps minio
# Expected status: healthy (or "Up", then healthy within 30s)

# Check MinIO logs for HTTPS confirmation
docker compose -f docker-compose.prod.yml logs minio | grep -i "listen"
# Expected: messages showing listening on HTTPS (not HTTP)

# Recreate API with new certificates and HTTPS endpoint
docker compose -f docker-compose.prod.yml up -d --force-recreate api

# Wait for API to start
sleep 10
docker compose -f docker-compose.prod.yml ps api
# Expected status: healthy or Up

# Check API logs for S3 connection initialization
docker compose -f docker-compose.prod.yml logs api | grep -i "s3\|minio\|storage" | head -20
# Expected: No TLS errors, successful connection to minio:9000
```

**Verification:** Both MinIO and API containers show healthy status; MinIO logs confirm HTTPS listening; API logs show no TLS errors.

### Phase 6: End-to-End Upload Testing

Test image upload through the entire stack:

1. Authenticate as test user:
   ```bash
   # Get Clerk auth token for a test user (from your auth system)
   TOKEN="<your_clerk_bearer_token>"
   ```

2. Create a test memory:
   ```bash
   curl -X POST https://memories.ai970.cloud/memories/create-memory \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "sourceType": "camera",
       "title": "TLS Upload Test",
       "latitude": 37.7749,
       "longitude": -122.4194
     }'
   # Expected: 201 Created with memory object
   # Note the memory.id
   ```

3. Test presigned URL generation and upload:
   ```bash
   MEMORY_ID="<from_step_2>"
   
   curl -X POST https://memories.ai970.cloud/assets/create-upload \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d "{\"memoryId\": \"$MEMORY_ID\", \"mimeType\": \"image/jpeg\"}"
   # Expected: 201 Created with uploadUrl, uploadHeaders, objectKey, etc.
   # Note the uploadUrl
   ```

4. Upload test image through nginx to MinIO:
   ```bash
   UPLOAD_URL="<from_step_3>"
   
   # Create a small test image
   convert -size 100x100 xc:blue test.jpg
   
   # Upload through nginx (which proxies to MinIO with HTTPS)
   curl -X PUT "$UPLOAD_URL" \
     -H "Content-Type: image/jpeg" \
     -d @test.jpg \
     -v
   # Expected: 200 OK
   # The upload goes: curl → nginx HTTPS → MinIO HTTPS → success
   ```

5. Complete the upload:
   ```bash
   curl -X POST https://memories.ai970.cloud/assets/complete-upload \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d "{\"memoryId\": \"$MEMORY_ID\", \"objectKey\": \"<from_step_3>\", \"mimeType\": \"image/jpeg\"}"
   # Expected: 201 Created with asset object
   ```

**Verification:** All steps succeed; image is stored in MinIO and retrievable via GET /memories/:id/assets.

### Phase 7: Production Monitoring and Rollback

After deployment, monitor for issues:

1. Check MinIO healthcheck status:
   ```bash
   docker compose -f docker-compose.prod.yml ps
   # All services should be healthy
   ```

2. Monitor logs for TLS errors:
   ```bash
   docker compose -f docker-compose.prod.yml logs -f api | grep -i "error\|tls\|certificate"
   docker compose -f docker-compose.prod.yml logs -f minio | grep -i "error"
   ```

3. Test image uploads from mobile app (if available in testing phase)

**If issues occur, rollback:**

1. Revert nginx to HTTP proxying (from backup):
   ```bash
   sudo cp /etc/nginx/sites-available/memory-app.conf.backup /etc/nginx/sites-available/memory-app.conf
   sudo nginx -t
   sudo systemctl reload nginx
   ```

2. Restart containers with HTTP endpoint:
   ```bash
   cd /root/apps/memory-app
   # Edit .env.production to revert OBJECT_STORAGE_ENDPOINT if needed
   docker compose -f docker-compose.prod.yml up -d --force-recreate minio api
   ```

3. Verify service recovery and monitor logs

## Code Commit (After Successful Deployment)

After all phases complete successfully, commit the configuration changes to the repository:

```bash
git add \
  docs/CERTIFICATES.md \
  docs/NGINX_TLS_SETUP.md \
  docs/DEPLOY_MINIO_TLS.md \
  infra/docker-compose.prod.yml \
  .gitignore

git commit -m "infra: Enable HTTPS/TLS for MinIO to support SSE-C uploads

- Mount TLS certificates into MinIO container (public.crt, private.key, ca.crt)
- Update MinIO healthcheck to use HTTPS with internal CA trust
- Configure API to connect to MinIO over HTTPS (https://minio:9000)
- Add NODE_EXTRA_CA_CERTS for internal CA trust in Node.js
- Add .gitignore entries for private keys and CA certificate
- Document certificate generation, deployment, and renewal procedures

TLS encryption ensures that SSE-C (Server-Side Encryption with Customer-provided
keys) operations are performed over a secure connection, not just X-Forwarded-Proto
header spoofing. nginx verifies MinIO's certificate against the internal CA before
proxying requests.

See docs/CERTIFICATES.md for certificate generation and renewal.
See docs/NGINX_TLS_SETUP.md for nginx configuration changes.
See docs/DEPLOY_MINIO_TLS.md for controlled deployment procedures."

git push origin HEAD:main
```

## Summary

**Before deployment:**
- ✓ Code changes committed (photo-upload.ts, assets.service.ts)
- ✓ docker-compose.prod.yml configured for TLS
- ✓ Certificate documentation complete
- ✓ nginx configuration guide prepared

**During deployment:**
- Phase 0: All code changes ready
- Phase 1: Generate certificates on VPS (one-time)
- Phase 2: Copy CA to nginx directory (one-time)
- Phase 3: docker-compose.prod.yml configuration (already done)
- Phase 4: Update nginx configuration and test syntax
- Phase 5: Restart containers with new TLS configuration
- Phase 6: Test end-to-end uploads through HTTPS stack
- Phase 7: Monitor and rollback if needed

**After successful deployment:**
- Commit non-secret configuration changes to main branch
- Update deployment runbook (docs/deployment.md) to reference new certificate procedures
- Monitor image uploads in production for SSE-C success

## Known Limitations (Minor)

- Console access at https://memories.ai970.cloud/console will not work until console certificate is properly configured. Use minio CLI (`mc`) for admin operations instead.
- Vault re-authentication is not required before accessing vault content (known gap from CLAUDE.md)

## Questions / Issues

If any phase encounters unexpected behavior:
1. Check certificate validity: `openssl verify -CAfile internal-ca.crt minio-server.crt`
2. Check nginx syntax: `sudo nginx -t`
3. Check container logs: `docker compose -f docker-compose.prod.yml logs <service>`
4. Refer to troubleshooting section in `docs/CERTIFICATES.md`
