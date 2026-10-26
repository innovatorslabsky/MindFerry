# Railway incident audit — state as of 2026-10-26 (read-only, no secrets)

Context: Railway disclosed a security incident on 2026-10-21 (env vars possibly accessed; attacker access ended 2026-10-22). On 2026-10-24 Railway did a broad, precautionary key revocation (not proof any of our keys were taken; keys created after the incident may have been revoked too).

Nothing has been rotated or redeployed. No secret value was read or recorded. `list-variables` was deliberately NOT used because it returns plaintext values; only `describe-service` (names only) was used.

## Access
- Railway MCP: OK (user innovatorslabsky, workspace "Innovators Lab's Projects", id 42c2708a-440c-4eef-b407-b4f8f8e6ca5a).
- Repo innovatorslabsky/MindFerry: OK (local checkout + GitHub).
- Not available to Claude: Anthropic Console, MongoDB shell, FreeLLMAPI dashboard, anything that needs a login by Vincent.

## Inventory (variable NAMES only)
Project `mindferry` (fcb2ca74-0852-4a9b-81d1-7d80a6a908d1), env production (377ee5e9-047e-4e21-91bb-06692deb8567)

| Service | Id | Variables |
|---|---|---|
| @mindferry-backend (repo main, Dockerfile, domain mindferrybackend-production-de43.up.railway.app, last deploy 2026-10-24 07:22Z) | 6eb1d232-fb03-4b42-9cf1-5844afd04f44 | ALLOW_REGISTRATION, ANTHROPIC_API_KEY, CREDS_IV, CREDS_KEY, CSP_ALLOW_WASM, DOMAIN_CLIENT, DOMAIN_SERVER, FREELLMAPI_BASE_URL, FREELLMAPI_KEY, JWT_REFRESH_SECRET, JWT_SECRET, MONGO_URI, NODE_ENV, SCHEDULES_SINGLE_PROCESS |
| MongoDB (mongo:8.0, private only, no TCP proxy, last deploy 2026-09-23) | 25e2bf75-cd4e-47b6-a99a-4122f6fa9a16 | MONGOHOST, MONGOPASSWORD, MONGOPORT, MONGOUSER, MONGO_INITDB_ROOT_PASSWORD, MONGO_INITDB_ROOT_USERNAME, MONGO_URL |
| freellmapi (ghcr image, private only, no public domain, last deploy 2026-10-13) | 93090bca-8b0b-4936-9aac-0b4a81858bff | ENCRYPTION_KEY, FREEAPI_CONFIG_JSON, NODE_ENV, PORT |

Project `skyloom` (98b260af-4f65-4c5e-85c9-22213b86a6cf): service skyloom-web (cf83ad20-154a-4375-93dd-082855eb40ab), vars DATA_DIR, NODE_ENV, PORT, SKYLOOM_PASSWORD_HASH, SKYLOOM_SECRET, SKYLOOM_USER. Not in the requested rotation list; scope decision pending with Vincent.

Not set: METRICS_SECRET (harmless, /metrics returns 401).

## Log findings (backend, from 2026-10-21; log retention only covers the current deployment from 2026-10-24 05:22Z)
- No 401/403, "invalid x-api-key", Mongo auth failure, or JWT verify error found. Only error-level lines: "Social logins are disabled" x3 and the METRICS_SECRET warning.
- MongoDB healthy (WiredTiger checkpoints through 2026-10-26 01:30Z). freellmapi healthy ("[Health] Checking 1 keys... Check complete", no errors; one upstream key configured).
- /api/hub/mcp 400 followed by 200/202 from Claude-User is the normal MCP handshake pattern, not an auth failure.
- Unverified traffic to confirm with Vincent: Python-urllib POSTs to /api/hub/mcp on 2026-10-25 17:42Z (104.29.x) and 2026-10-26 01:28Z (87.81.x); one Chrome/114 GET from an Azure IP on 2026-10-24 04:47Z; curl GET / on 2026-10-24 06:45Z.
- LIMIT: the logs show no LLM call at all, so they cannot prove ANTHROPIC_API_KEY still works. Only a real chat message on an Anthropic model proves it.
- Conclusion: no service is currently broken. Rotation is precautionary.

## Rotation order and gotchas
1. ANTHROPIC_API_KEY — console.anthropic.com > API keys: create new, set on @mindferry-backend, redeploy backend, send a real chat on a Claude model, confirm no 401/authentication_error in logs, then delete the old key.
2. Mongo password — gotcha: MONGO_INITDB_ROOT_PASSWORD only applies to an empty volume, so changing the env var alone does NOT change the password of existing data. Change it inside Mongo (changeUserPassword via mongosh on the service), then update MONGOPASSWORD, MONGO_INITDB_ROOT_PASSWORD, MONGO_URL and the backend's MONGO_URI, redeploy backend. Back up the volume first. Unknown: whether MONGO_URI references ${{MongoDB...}} or holds a pasted password (values not read).
3. CREDS_KEY / CREDS_IV — encrypt user-stored secrets in Mongo (packages/api/src/credentials.ts). Rotating without re-encrypting makes existing stored secrets undecryptable. Check whether any exist before rotating.
4. JWT_SECRET / JWT_REFRESH_SECRET — rotate together; logs out all sessions, no data loss.
5. FREELLMAPI_KEY — unified key from the FreeLLMAPI dashboard; update on backend, redeploy. Also in scope but not on the list: the upstream provider key(s) held by freellmapi (FREEAPI_CONFIG_JSON / volume) should be rotated at their providers; rotating freellmapi ENCRYPTION_KEY would orphan its stored keys.

## Open questions for Vincent
- Is skyloom in scope (SKYLOOM_SECRET, SKYLOOM_PASSWORD_HASH)?
- Do users store personal API keys in MindFerry (CREDS_KEY impact)?
- Were the 2026-10-25/26 Python-urllib calls his own checks?
- Is the backend MONGO_URI a reference variable or a pasted value?
- Value of ALLOW_REGISTRATION (should be false if no public signup is wanted).
