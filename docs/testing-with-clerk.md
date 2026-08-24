# Testing with Clerk

This document explains how to obtain a Clerk test token and test the Memory API endpoints.

## Prerequisites

1. A Clerk account and organization (create one at https://clerk.com)
2. `CLERK_SECRET_KEY` from your Clerk dashboard (Settings → API Keys)
3. `curl` for testing endpoints

## Getting a Test Token

### Step 1: Create a test user in Clerk

```bash
curl -X POST https://api.clerk.com/v1/users \
  -H "Authorization: Bearer $CLERK_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "email_address": ["test@example.com"],
    "password": "TestPassword123!"
  }'
```

Response will include `id` (the Clerk user ID):
```json
{
  "id": "user_...",
  "email_addresses": [{"email_address": "test@example.com"}],
  ...
}
```

### Step 2: Create a session for the test user

Replace `USER_ID` with the `id` from Step 1:

```bash
curl -X POST https://api.clerk.com/v1/users/USER_ID/sessions \
  -H "Authorization: Bearer $CLERK_SECRET_KEY"
```

Response will include `id` (the session ID):
```json
{
  "id": "sess_...",
  ...
}
```

### Step 3: Create a session token

Replace `SESSION_ID` with the `id` from Step 2:

```bash
curl -X POST https://api.clerk.com/v1/sessions/SESSION_ID/tokens \
  -H "Authorization: Bearer $CLERK_SECRET_KEY"
```

Response will include `jwt`:
```json
{
  "jwt": "eyJhbGciOiJSUzI1NiIsImtpZCI6Iin...",
  ...
}
```

Save this JWT token — it's your `$ACCESS_TOKEN`.

## Testing API Endpoints

Use the JWT token from Step 3 to test the API. Replace `$ACCESS_TOKEN` with your token:

### Create a Memory

```bash
curl -X POST http://localhost:3000/memories \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceType": "url",
    "sourceUri": "https://example.com/some-article",
    "title": "Interesting article about X",
    "idempotencyKey": "11111111-1111-1111-1111-111111111111"
  }'
```

Response:
```json
{
  "id": "mem_...",
  "processingState": "queued",
  ...
}
```

### Poll processing status

```bash
curl http://localhost:3000/memories/mem_.../processing-status \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Processing states: `queued` → `processing` → `understood` (or `failed`)

### Fetch Memory detail

```bash
curl http://localhost:3000/memories/mem_... \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

### Get user profile

```bash
curl http://localhost:3000/users/me \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

## Important Security Notes

**Never commit your CLERK_SECRET_KEY or session tokens to version control.** These are sensitive credentials that can be used to impersonate users.

- `CLERK_SECRET_KEY` is for server-to-server communication only
- Tokens are short-lived; create new ones when they expire
- In production, the mobile app or web client will obtain tokens via Clerk's official SDKs
