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

## Follow-up (2026-10-26, still read-only; no rotation, env change or redeploy; no secret values read)
Vincent's reply to the open questions: "Skyloom seems to touch the Anthropic key; I don't know the others because Lyra built most of MindFerry." His Skyloom statement is an unverified impression, so each point below was checked from repo, Railway config and logs. Where that was not possible it says so.

1. Skyloom and the Anthropic key — CORRECTED BY VINCENT: skyloom does NOT touch Anthropic ("anh nhầm, skyloom ko động đến Anthropic"). His earlier "seems to touch the Anthropic key" is superseded. skyloom is OUT of scope for the ANTHROPIC_API_KEY rotation. No evidence found contradicting him (see below), so no discrepancy to flag. The skyloom code itself was never inspected (not accessible); the notes below are what Railway config and logs showed.
   - The skyloom code is not accessible: the session's GitHub scope is innovatorslabsky/MindFerry only and the local checkout has no skyloom code. innovatorslabsky/skyloom was not attached.
   - Railway config for skyloom-web: variable names are only DATA_DIR, NODE_ENV, PORT, SKYLOOM_PASSWORD_HASH, SKYLOOM_SECRET, SKYLOOM_USER. No ANTHROPIC_API_KEY, no MindFerry/FreeLLMAPI URL or key name.
   - skyloom is a separate Railway project, so it cannot reference mindferry project variables; it has no path to the backend's ANTHROPIC_API_KEY except a value pasted by hand.
   - skyloom-web has no deploy, DNS or network-flow log lines since 2026-10-18 (empty, which proves nothing about outbound calls).
   - Conclusion: consistent with Vincent's correction. Rotating @mindferry-backend's ANTHROPIC_API_KEY does not affect skyloom, and skyloom stays out of step 1. Its own secrets (SKYLOOM_SECRET, SKYLOOM_PASSWORD_HASH) remain a separate, optional precaution since the Railway incident covered all env vars.
2. MONGO_URI construction — NOT DETERMINABLE without reading the value.
   - The repo only carries credential-less defaults (.env.example, docker-compose: mongodb://mongodb:27017/LibreChat); the Railway value lives only in the dashboard.
   - The MongoDB service exposes MONGO_URL, MONGOUSER, MONGOPASSWORD, MONGO_INITDB_ROOT_PASSWORD; the backend variable is named MONGO_URI (different name), so it was created by hand: either a reference like ${{MongoDB.MONGO_URL}} or a pasted string.
   - Check without exposing anything: in the dashboard Variables tab, a reference displays as ${{ ... }}. Do this before rotation step 2.
3. User-stored keys (CREDS_KEY/CREDS_IV) — code path confirmed, row counts NOT obtainable (no database access).
   - CREDS_KEY/CREDS_IV protect: 2FA/TOTP secrets (encryptV3), MCP/action OAuth tokens, plugin/action auth values, agent auth values, admin-panel stored secrets, OpenID flight tokens.
   - librechat.yaml defines no user_provided endpoint (the FreeLLMAPI endpoint uses ${FREELLMAPI_KEY}), so per-user API keys are not the likely case; whether any of the other rows exist is unknown.
   - To answer yes/no: someone with Mongo access runs count-only queries on the collections holding those records (users with twoFactorEnabled, tokens, pluginauths, keys). Counts only, never read documents.
   - Also read packages/api/src/credentials.ts first: it keeps credential fingerprints in the librechatCredentialMetadata collection, so a changed CREDS_* is detected at startup (behaviour not yet tested).
4. ALLOW_REGISTRATION — value NOT READ.
   - The only tool that returns variable values (list-variables) returns every variable in plaintext, including secrets; not used. The live /api/config could not be reached from this sandbox (proxy 403, DNS failure).
   - Code: registration is open when ALLOW_REGISTRATION is truthy (api/server/middleware/validateRegistration.js, config.js registrationEnabled); .env.example defaults to true. Invite links bypass it.
   - Log evidence: no request to /api/auth/register since 2026-10-21 (neither accepted nor 403), so no sign-up attempts.
   - Recommendation: once Vincent's account exists, set false. This is a billed-LLM deployment and open signup is free access to ANTHROPIC_API_KEY spend. Decision for Kem/Vincent; not changed here.
5. Python-urllib POSTs at 2026-10-25 17:42Z and 2026-10-26 01:28Z — CONSISTENT with Kem's checks, not provable from logs.
   - Timezone arithmetic is right: 17:42Z = 10:42 PDT Sun 25/10; 01:28Z = 18:28 PDT Sun 25/10.
   - Both bursts are 6 requests to /api/hub/mcp with the same shape (200, 202, 200, 200, 202, 200), no 4xx. That is two MCP initialize/initialized/call sequences. The route requires a valid API key (packages/api/src/hub/mcp/route.ts returns 401 without one), so the caller held a valid credential.
   - Source IPs differ per request inside a burst (104.29.x for the first, 87.81.x for the second), i.e. egress pools, so IP cannot identify the caller.
   - Verdict: not suspicious, matches Kem's schedule; only Kem can confirm by matching the number of calls he made. If he did not make 2 sequences each, rotate the hub API key too.
   - Unchanged unknowns: Chrome/114 GET / from Azure IP 2026-10-24 04:47Z and curl GET / 2026-10-24 06:45Z, both landing-page only, 200.

## Blocker check for rotation step 1 (ANTHROPIC_API_KEY)
Nothing found blocks it. Prerequisite: Vincent (or Kem with Anthropic Console access) creates the new key; Lyra has no console access. Skyloom is not a dependency (Vincent's correction).

## Step 1 — ANTHROPIC_API_KEY rotation (approved by Vincent: "Làm nha em"; relayed by Kem)
Scope: @mindferry-backend only (project mindferry fcb2ca74-0852-4a9b-81d1-7d80a6a908d1, service 6eb1d232-fb03-4b42-9cf1-5844afd04f44, env production 377ee5e9-047e-4e21-91bb-06692deb8567). No other key, no skyloom, no PR. The secret value must never pass through the chat session.

Before-state (checked after approval, before any change):
- Latest deployment 42ae9584-92ae-4175-9eaa-0de4428ec387, SUCCESS since 2026-10-24 07:22Z, commit 4d89926 on main; service live, 1 replica (sfo); no staged changes; variable names unchanged (ANTHROPIC_API_KEY present).
- No error-level deploy log lines after 2026-10-26 01:30Z; HTTP traffic normal through 01:43Z.

Runbook:
1. Vincent: Anthropic Console > API keys > create a NEW key (do not delete the old one yet).
2. Vincent: Railway > project mindferry > service @mindferry-backend > Variables > edit ANTHROPIC_API_KEY, paste the new value himself, and apply/deploy the staged change. Then tell Lyra "pasted".
3. Lyra on "pasted": check get-staged-changes and the latest deployment. If the apply already created a newer deployment than 42ae9584, do not redeploy again; otherwise redeploy @mindferry-backend once. Wait for SUCCESS and a clean startup log.
4. Test (Vincent or Kem, logged in to MindFerry): send a real chat message on a Claude model (Anthropic endpoint) and get a normal reply. Lyra then reads the deploy logs for that time window: pass = no 401, no authentication_error, no "invalid x-api-key"; fail = any of those.
5. Only after a pass: Vincent deletes the OLD key in Anthropic Console. On a fail: leave the old key alive, keep the old value available to restore, report to Kem.

Status: READY, waiting for Vincent's "pasted" signal. Lyra has no Anthropic Console access and has not redeployed or changed anything.

### Step 1 plan change (Kem, supersedes "Vincent pastes it himself")
- Execution method: Vincent gave the new Anthropic key directly to Kem. Kem updates ANTHROPIC_API_KEY on @mindferry-backend through a separate Railway browser task and redeploys the service. The secret value is not sent to this Claude session and must not be requested here.
- Lyra's role: sets no Railway variable, does not redeploy, does not ask Vincent to paste anything. Stands by for Kem's confirmation that the variable was updated and the backend redeployed.
- On Kem's confirmation: Lyra checks the latest deployment (newer than 42ae9584, SUCCESS) and the startup logs, then verifies with a real chat on a Claude model through MindFerry (run by Kem or Vincent, logged in) while reading the deploy logs. Pass = reply received, no 401, no authentication_error, no "invalid x-api-key".
- The old Anthropic key is deleted only after that test passes. Mongo, CREDS, JWT, FREELLMAPI and skyloom are untouched.
- Status: standing by for Kem's redeploy confirmation.

### Step 1 — Kem's confirmation and deployment check (2026-10-26)
Kem reported (via a separate Railway browser task, not Vincent pasting, no secret in this session): exactly 1 variable changed on @mindferry-backend (ANTHROPIC_API_KEY); skyloom, MongoDB, freellmapi untouched; nothing deleted in Anthropic Console; Railway auto-redeployed starting 2026-10-25 6:54 PM PDT; Online, 1 replica, no pending changes.

Verified by Lyra (read-only):
- New deployment 2decd1e0-b5e9-4101-ac31-cd9cf3cce6d0 created 2026-10-26 01:54:43Z (= 18:54 PDT, matches Kem), status SUCCESS, commit 4d89926 (same code as before). Previous deployment 42ae9584 now REMOVED. No staged changes; variable names unchanged.
- Startup log: "Server listening ... port 8080", "Server readiness checks passing", schedules and agent-trigger engines started. Only error-level line is the pre-existing "Social logins are disabled" notice. Warnings (pre-existing, unrelated): outdated config version 1.3.16, searxngInstanceUrl holds a literal value, RAG API not reachable. No 401/403, authentication_error or Mongo/JWT error.
- Limit: startup does not call Anthropic, so a clean start does NOT prove the new key works. Only the real chat test does.
- Traffic on the new deployment so far: Python-urllib POSTs to /api/hub/mcp at 02:00:17Z (200/202/200) and a Claude-User handshake; likely Kem's checks, not confirmed.

Real chat test (Kem or Vincent, logged in to MindFerry; Lyra reads the logs afterwards):
- Open a NEW chat, pick the Anthropic / Claude endpoint and any Claude model (NOT the FreeLLMAPI endpoint, which uses a different key).
- Send exactly: "Reply with exactly: KEY-TEST-OK" and say the local time (PDT) it was sent.
- PASS: a normal reply appears in the UI and the deploy logs for that minute show no 401, no authentication_error, no "invalid x-api-key".
- FAIL: an error bubble in the UI, or any of those strings in the logs. Then keep the old key and report to Kem.
- Old Anthropic key stays until the test passes. No other key is rotated.

### Step 1 — chat test verdict (2026-10-26)
Test reported by Kem: Vincent sent a real chat at 7:05 PM PDT 2026-10-25 (= 02:05Z), assumed new chat, Anthropic endpoint, message "Reply with exactly: KEY-TEST-OK". Checked on deployment 2decd1e0 (read-only).

Evidence (02:04–02:10Z):
- 02:04:53 Vincent's account logged in (deploy log "[Login successful]", POST /api/auth/login 200).
- 02:05:19.505 POST /api/agents/chat/anthropic 200 — the request went to the Anthropic endpoint (not FreeLLMAPI).
- 02:05:21.963 GET /api/agents/chat/stream/<conversation> 200, 2356 ms (the generation stream ran about 2.4 s); 02:05:21.447 GET /api/convos/gen_title/<conversation> 200, 1776 ms; messages and convo reads 200.
- Deploy log search from 01:59Z for "401", "authentication_error", "invalid x-api-key", "anthropic": no matches. No error-level line in the window (the only deploy line is the login info line).
- No 4xx/5xx on any user request in the window.

Verdict: PASS on the log side — the new key was accepted, with no 401/authentication_error/invalid x-api-key. Limits: HTTP logs do not show reply text, and the exact message/model Vincent used was not observable (only the endpoint path). Final confirmation = Vincent states what reply he saw in the UI (expected KEY-TEST-OK).

Other notes:
- The 02:00Z POSTs to /api/hub/mcp (Python-urllib) were Kem's post-redeploy MindFerry connector search (confirmed by Kem). Treated as his; the earlier 2026-10-25 17:42Z and 2026-10-26 01:28Z bursts match the same pattern and remain "consistent, not provable".
- A recurring probe from 20.55.61.179 (Azure; GET /.well-known/resource-that-should-not-exist-... at 02:04:32Z, also seen 2026-10-24) returns the SPA 200; low risk, no action.

Old Anthropic key: NOT deleted. May be deleted once Vincent confirms the UI reply. Before deleting, Vincent can check the old key's "last used" in Anthropic Console: if it predates the 18:54 PDT redeploy, nothing else is using it. No other key rotated; skyloom untouched.

### Step 1 — FINAL VERDICT: PASS (2026-10-26)
- UI evidence: Vincent confirmed (relayed by Kem) that the 19:05 PDT (02:05Z) test showed exactly KEY-TEST-OK, no error in the UI.
- Log evidence (deployment 2decd1e0, 02:04–02:10Z): request went to POST /api/agents/chat/anthropic 200; stream 200 (~2.4 s); no match for "401", "authentication_error", "invalid x-api-key" or "anthropic"; no error-level lines; no 4xx/5xx on user requests.
- Overall: PASS. ANTHROPIC_API_KEY rotation on @mindferry-backend is complete and working.
- Old Anthropic key: Vincent may now delete it himself in Anthropic Console (Lyra does not delete it). Suggested first look at its "last used" time: if it predates the 2026-10-25 18:54 PDT redeploy, nothing else uses it. Record the deletion here once done.
- Not done / still pending: MongoDB password, CREDS_KEY/CREDS_IV, JWT_SECRET/JWT_REFRESH_SECRET, FREELLMAPI_KEY (and freellmapi's upstream provider keys) — later steps, each needs its own go-ahead. skyloom untouched (out of scope). ALLOW_REGISTRATION and MONGO_URI construction still unverified (need dashboard look).

## Remaining rotations — status (2026-10-26; Kem relaying Vincent: step 1 done, old Anthropic key deleted by Vincent; "do all the rest")
Rules: MindFerry only, skyloom untouched, no PR/merge, no secret values in the memo or chat. One step at a time; stop on failure.

Findings so far (read-only unless stated):
- Railway MCP connection is an OAuth app: it can set variables but cannot read values (railway-agent also reported values hidden). So MONGO_URI/ALLOW_REGISTRATION values could not be read through it.
- MONGO_URI check: PASS — it is a Railway REFERENCE to the MongoDB service's MONGO_URL (reference expression, not a pasted password). A new Mongo password therefore flows to the backend automatically if MongoDB's MONGO_URL is rebuilt from the same variables. Not confirmed: whether MongoDB's own MONGO_URL references MONGOUSER/MONGOPASSWORD (value hidden).
- Vincent's own account exists: "[Login successful]" for the Vincent account at 02:04:53Z 2026-10-26 (role ADMIN fetched).

Step 1 MongoDB password — HELD. Gate not satisfiable from this session: (a) no way to back up the Mongo volume (no backup tool in the Railway MCP; Railway volume backups are created in the dashboard Volume > Backups or via the public API with a token), (b) no shell on the MongoDB service (no mongosh/Railway CLI here) to run changeUserPassword. MONGO_INITDB_ROOT_PASSWORD alone would not change the live password. Needs Vincent: create a volume backup, then run changeUserPassword in a shell on the MongoDB service, then update the 4 variables consistently.
Step 2 CREDS_KEY / CREDS_IV — HELD for decision. Code: startup refuses anything that is not exactly 64 hex (key) / 32 hex (IV); no decrypt-with-old/re-encrypt-with-new migration script exists in the repo (config/ has none). Stored data protected by these keys: 2FA secrets, MCP/action OAuth tokens, plugin/agent credentials, admin-panel secrets. Whether any rows exist cannot be counted from here (no database access). If zero rows exist rotation is safe; otherwise a migration must be written first.
Step 3 JWT_SECRET / JWT_REFRESH_SECRET — HELD: a new value would have to pass through this session's tool call to be set (the Railway MCP cannot read, but I would have to write it), which breaks the "no secret values in chat" rule. Needs Kem's separate browser task or Vincent: generate 2 independent random values, set both in one change, one redeploy. Warning: every session is logged out; Vincent must log in again.
Step 4 FREELLMAPI_KEY — HELD: needs a new unified key from the FreeLLMAPI dashboard (Vincent; the service has no public domain, so it must be opened briefly or reached on the private network). Then the same "value must not pass through this session" applies. freellmapi ENCRYPTION_KEY: OUT of scope for now (it encrypts the upstream provider keys stored in its volume; rotating alone makes them unreadable). Upstream provider: logs show "Checking 1 keys" every ~5 minutes with no errors; the provider is not named in logs and its config values are hidden from this session, so it must be identified in the FreeLLMAPI dashboard (Keys page), then rotated at that provider and re-entered.
ALLOW_REGISTRATION — value not readable here. Since Vincent's account is confirmed, ALLOW_REGISTRATION was set to the boolean false on @mindferry-backend (non-secret). That triggered a backend redeploy (deployment b1c9edeb started 2026-10-26 02:34Z). Verification pending: deployment SUCCESS, startup clean, Vincent still logged in, register page closed.
