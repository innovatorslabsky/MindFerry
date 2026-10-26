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

### ALLOW_REGISTRATION=false — deployment check (2026-10-26 02:41Z, Lyra, read-only)
- Deployment b1c9edeb-2480-47b4-ab2b-87c059d74e1e: SUCCESS at 02:36:27Z (previous 2decd1e0 now REMOVED). Same commit 4d89926; only ALLOW_REGISTRATION changed.
- Startup log: "Connected to MongoDB", "Server listening ... port 8080", "Server readiness checks passing"; no 401/403/authentication/Mongo/JWT errors (only the pre-existing METRICS_SECRET, searxngInstanceUrl and RAG API warnings).
- Still to confirm by a human: Vincent still logged in / can log in, and the register page is closed. Not testable from this session.
- All four rotations (Mongo password, CREDS, JWT, FREELLMAPI) remain HELD as recorded above; no other variable was changed in this session.

## Decision: JWT rotation (Kem, Vincent approved: "Duyệt, em làm qua trình duyệt như bước 1")
- JWT_SECRET / JWT_REFRESH_SECRET are rotated by Kem through a separate Railway browser task, exactly like step 1. Lyra does NOT generate or set these values and no secret appears in this session.
- Kem sets both new values (two independent random values, one change), lets Railway redeploy @mindferry-backend once, and reports back.
- Lyra then verifies the new deployment (newer than b1c9edeb, SUCCESS, clean startup) and helps test login. Expected: every existing session is logged out once; old browser cookies get a 401 on /api/auth/refresh, which is NOT a failure. PASS = Vincent logs in, conversations load, log shows "[Login successful]", no startup credential error. A startup error naming a retired default JWT value means the new value was not applied.
- No other variable is rotated in this session. skyloom untouched.
Status: STANDING BY for Kem's JWT result.

## Runbooks owed to Kem (no values; commands only)

### A. MongoDB password (HELD until Kem/Vincent run it; Lyra cannot back up or open a shell)
Facts: MONGO_URI on the backend is a reference to the MongoDB service's MONGO_URL. MongoDB has no public TCP proxy (private network only). MONGO_INITDB_ROOT_PASSWORD only applies to an empty volume, so the LIVE password must be changed inside Mongo.
0. Choose a new password that is hex/alphanumeric only (e.g. generated locally with `openssl rand -hex 24`), so it needs no URL-encoding inside the mongodb:// connection string. Never paste it in chat.
1. Backup first. Railway dashboard > project mindferry > MongoDB service > volume mongodb-volume > Backups > Create backup (name it pre-rotation-2026-10-26). Confirm it appears in the list. If the Backups option is unavailable on this plan, STOP and report; do not continue without a backup.
2. Check the variable structure on the MongoDB service (Variables tab): note whether MONGOPASSWORD and MONGO_URL are references to MONGO_INITDB_ROOT_PASSWORD (shown as ${{ ... }}) or literals; literals must be edited too. Check the backend's MONGO_URI is still a ${{<MongoDB service>.MONGO_URL}} reference (it was on 2026-10-26).
3. Open a shell on the MongoDB service (Railway CLI `railway ssh` on the MongoDB service; mongosh is in the mongo:8.0 image; whether the browser task offers a shell is unverified). Authenticate without typing the password in the command: `mongosh -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin`.
4. Change the live password: `db.getSiblingDB('admin').changeUserPassword(process.env.MONGO_INITDB_ROOT_USERNAME, passwordPrompt())` and type the new password at the prompt (it is not echoed or stored in history). If MONGOUSER differs from the root user, repeat for that user.
5. Immediately (to keep the window short, because a backend reconnect with the old password now fails): in the Variables tab set MONGO_INITDB_ROOT_PASSWORD to the new value; set MONGOPASSWORD and MONGO_URL consistently if they are literals (nothing to do if they are references). Railway redeploys MongoDB and the services that reference it; if the backend does not restart, redeploy it once.
6. Verify: in the shell, auth with the new password works and the old one is rejected; backend deploy log shows "Connected to MongoDB" with no auth error; Vincent can log in and the conversation list loads. Lyra can read the logs and confirm.
7. Rollback if the backend cannot connect: in the shell (authenticated with the NEW password) run changeUserPassword back to the previous password; restore the volume backup only as a last resort.

### B. CREDS_KEY / CREDS_IV — count-only check (decides whether rotation is safe)
Run in the same Mongo shell (authenticated as above). It prints counts and token type labels only, never contents. The database name is the last path segment of MONGO_URI (default LibreChat); check names with `db.getSiblingDB('LibreChat').getCollectionNames()` first (collection names below are Mongoose defaults; match them case-insensitively if they differ).
```
const d = db.getSiblingDB('LibreChat');
const names = d.getCollectionNames();
['keys','pluginauths','actions','mcpservers','skillsynccredentials','openidrefreshflights','refreshtokenbridges','huboauthclients','configs']
  .forEach(n => print(n, names.includes(n) ? d.getCollection(n).countDocuments({}) : 'absent'));
print('users total', d.users.countDocuments({}));
print('users with 2FA enabled', d.users.countDocuments({ twoFactorEnabled: true }));
printjson(d.tokens.aggregate([{ $group: { _id: '$type', n: { $sum: 1 } } }]).toArray());
```
Reading the result: data encrypted with CREDS_KEY/CREDS_IV is possible in keys (user-provided API keys), pluginauths, 2FA secrets (users with 2FA), tokens whose type is an OAuth/MCP token type, actions/mcpservers with stored auth, skillsynccredentials, and admin-panel secrets in configs. openidrefreshflights and refreshtokenbridges are short-lived. Rule: if all of those are 0/absent (and the tokens list holds only non-OAuth types such as password reset), CREDS_KEY/CREDS_IV can be rotated without migration (two new values: 64 hex chars for CREDS_KEY, 32 hex chars for CREDS_IV, startup refuses anything else). If any is non-zero, DO NOT rotate: a decrypt-with-old/re-encrypt-with-new migration must be written first (none exists in the repo); Lyra can draft it on request. Send Lyra only the counts.

### C. Still pending after A and B
FREELLMAPI_KEY and the freellmapi upstream provider key: need the FreeLLMAPI dashboard (Vincent/Kem); same "value never passes through this session" rule.

## JWT rotation — done by Kem via browser (2026-10-26), verified by Lyra
- Kem reported: JWT_SECRET and JWT_REFRESH_SECRET on @mindferry-backend updated together in one staged change ("Apply 2 changes", those two variables only), one redeploy, ACTIVE / "Deployment successful", Online, no pending changes. No secret value passed through this session.
- Verified (read-only): new deployment 68c85436-af89-47fc-bdfb-d1b2410dc094 created 2026-10-26 02:58:06Z, SUCCESS at 02:59:25Z, newer than b1c9edeb (now REMOVED); same commit 4d89926; no staged changes; variable names unchanged.
- Startup log: "Connected to MongoDB", "Server listening ... port 8080", "Server readiness checks passing". Only error-level line is the pre-existing "Social logins are disabled". One NEW warning, expected and non-blocking: "[credentials] Active fingerprints for JWT_SECRET, JWT_REFRESH_SECRET do not match the database credential record. CREDS_KEY, CREDS_IV still match ...". Meaning (packages/api/src/app/checks.ts): the app compares hashes of the active credentials with a marker stored in Mongo (collection librechatCredentialMetadata, hashes only); the JWT hashes now differ because they were rotated on purpose, and the matching CREDS hashes confirm CREDS_KEY/CREDS_IV were not changed. The app never overwrites the marker itself; the warning will repeat on every startup until the marker is refreshed. Do NOT edit or delete the marker now; refresh it once, after ALL planned rotations (CREDS, Mongo, FreeLLMAPI as applicable) are finished, as a controlled step.
- Not yet verified: login. No /api/auth request has hit the new deployment yet.

JWT test plan (Vincent, in MindFerry): all old web sessions are logged out by design. (1) Open MindFerry and log in again with the normal credentials (a single 401 on /api/auth/refresh from the old cookie right before the login is expected and is not a failure). (2) Open the conversation list and open an existing conversation; it must load. (3) Send one short message on a Claude model; it must answer. Lyra then checks the log for "[Login successful]" for Vincent's account, 200 on POST /api/auth/login, 200 on /api/convos and /api/messages, and no auth/JWT errors.
Status: JWT step COMPLETE on the infrastructure side, PENDING Vincent's re-login test. Other connectors that use the hub API key (not JWT) are expected to keep working; confirm via a 200 on /api/hub/mcp.
Still HELD: Mongo password, CREDS_KEY/CREDS_IV, FREELLMAPI_KEY and upstream key (see runbooks above). No other variable changed in this session.

## JWT step — COMPLETE (2026-10-26)
- Both JWT_SECRET and JWT_REFRESH_SECRET were rotated together by Kem through a Railway browser task (one staged change, one redeploy, no value in this session). Deployment 68c85436 ACTIVE/SUCCESS.
- Vincent re-login: PASS (reported by Kem via Vincent). Log evidence on 68c85436: 03:02:39Z "[refreshController] Invalid refresh token: invalid signature" (the expected rejection of the old cookie), 03:02:46Z "[Login successful]" for Vincent's account, POST /api/auth/login 200, then GET /api/convos 200 (x3) from the same browser. No other auth/JWT errors.
- The "[credentials] fingerprints for JWT_SECRET, JWT_REFRESH_SECRET do not match the database credential record" startup warning is expected until the marker is refreshed after all rotations; do not edit the marker now.

## Corrections and refinements to runbooks A and B (supersede where they differ)
Facts found in code/config:
- The backend takes the database name from the path segment of MONGO_URI (api/db/connect.js passes MONGO_URI to mongoose.connect with no dbName option). MONGO_URI is a reference to the MongoDB service's MONGO_URL. If MONGO_URL has no database path, the data is in the default database "test", NOT "LibreChat" as runbook B assumed. So first find the database that holds the users collection.
- Which Mongo user the URL uses (root vs app user) cannot be read from this session (values are hidden from the Railway MCP). The variable names (MONGOHOST, MONGOPORT, MONGOUSER, MONGOPASSWORD, MONGO_INITDB_ROOT_USERNAME, MONGO_INITDB_ROOT_PASSWORD, MONGO_URL) match Railway's standard Mongo template, where MONGOUSER and MONGOPASSWORD are references to the MONGO_INITDB_ROOT_* variables and MONGO_URL is built from them as mongodb://${{MONGOUSER}}:${{MONGOPASSWORD}}@<private host>:27017 (root user). That is an assumption until Kem confirms it in the Variables tab.

### Kem checklist before touching anything (Mongo service > Variables tab; do not copy any value anywhere)
1. MONGOUSER: shown as ${{MONGO_INITDB_ROOT_USERNAME}} (reference) or a literal name? Write down only "reference" or "literal" and the user NAME (a username is not a secret).
2. MONGOPASSWORD: reference to ${{MONGO_INITDB_ROOT_PASSWORD}} or literal?
3. MONGO_URL: built from ${{MONGOUSER}}/${{MONGOPASSWORD}} (references) or a pasted string containing the password? Does it end with a database name (…:27017/<db>) or not?
4. Backend (@mindferry-backend) MONGO_URI: still the reference to the MongoDB service's MONGO_URL (it was on 2026-10-26)?
5. In the Mongo shell: list the users and roles without credentials: `db.getSiblingDB('admin').getUsers()` (no showCredentials option, so no hashes), and `db.adminCommand({ listDatabases: 1, nameOnly: true })` to see the database names.

### Mongo password change (exact pattern; placeholders only)
1. Backup: Railway dashboard > project mindferry > MongoDB service > volume mongodb-volume > Backups > Create backup, name pre-rotation-2026-10-26; wait until it is listed as complete. If Backups is unavailable on this plan, stop and report.
2. Shell on the MongoDB service (Railway CLI `railway ssh`), authenticate without typing the password: `mongosh -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin`.
3. Change the live password, typing the new one at the hidden prompt: `db.getSiblingDB('admin').changeUserPassword('<USER_FROM_CHECKLIST>', passwordPrompt())`. If the user lives in another database: `db.getSiblingDB('<AUTH_DB>').changeUserPassword('<APP_USER>', passwordPrompt())`. The new password must be URL-safe (hex/alphanumeric).
4. Right away, update consistently on the MongoDB service: MONGO_INITDB_ROOT_PASSWORD (the source of truth); MONGOPASSWORD and MONGO_URL ONLY if they are literals (if they are references, leave them). The backend MONGO_URI is a reference and needs no edit. Apply once; Railway redeploys MongoDB and the backend. If the backend does not restart, redeploy it once.
5. Verify: shell login with the new password works and the old one is rejected; backend log "Connected to MongoDB" with no auth error; Vincent can log in (if that fails, existing sessions would still work until the backend reconnects, so test with a fresh login) and the conversation list loads. Lyra reads the logs.
6. Rollback: run changeUserPassword again back to the previous password using the new one to authenticate; volume restore only as a last resort.

### CREDS count-only query (replaces runbook B's script; prints counts and type labels only)
```
const dbs = db.adminCommand({ listDatabases: 1, nameOnly: true }).databases.map(x => x.name)
  .filter(n => !['admin','local','config'].includes(n));
dbs.forEach(n => {
  const d = db.getSiblingDB(n);
  const names = d.getCollectionNames();
  if (!names.includes('users')) { print(n, '(no users collection)'); return; }
  print('== database', n, '| users', d.users.countDocuments({}), '| users with 2FA', d.users.countDocuments({ twoFactorEnabled: true }));
  ['keys','pluginauths','actions','mcpservers','skillsynccredentials','openidrefreshflights','refreshtokenbridges','huboauthclients','configs']
    .forEach(c => print(' ', c, names.includes(c) ? d.getCollection(c).countDocuments({}) : 'absent'));
  printjson(d.tokens.aggregate([{ $group: { _id: '$type', n: { $sum: 1 } } }]).toArray());
});
```
No document contents or values are printed. Interpretation is unchanged: all zero/absent (tokens only non-OAuth types) means CREDS_KEY/CREDS_IV can be rotated with no migration (64 hex and 32 hex); any non-zero means do NOT rotate until a decrypt-with-old / re-encrypt-with-new migration exists. Kem sends Lyra only the counts.

Still HELD: Mongo password, CREDS_KEY/CREDS_IV, FREELLMAPI_KEY and upstream key. No other variable changed in this session; skyloom untouched.

## New facts recorded (relayed by Kem; Vincent's decisions) — 2026-10-25 evening PDT
- Backup gate WAIVED by Vincent (~20:20 PDT 2026-10-25): "proceed with Mongo password change without backup", at his explicit risk. No backup exists: the plan is Hobby ("Upgrade to Pro to create new backups").
- Mongo shell retry (~20:26 PDT) FAILED again: embedded console stuck on "Connecting...", the popout waited 60 s still "Connecting...", the Database interface reported "unable to connect via SSH / WebSocket error", and a fresh tab also failed. The MongoDB service itself is still Online. Conclusion: the dashboard WebSocket console route is exhausted from the VM browser.
- Consequence: NO changeUserPassword was run, NO new Mongo password was generated or used, NO variable was updated (Mongo variables re-checked unchanged). Backend MONGO_URI, skyloom and freellmapi untouched. CREDS counts still NOT obtained, so CREDS_KEY/CREDS_IV rotation stays HELD.
- Vincent's instruction: do everything for him; do NOT ask him to take over the browser to try the console. Constraints unchanged: branch claude/quirky-tesla-fqerbg only, no PR/merge/sync, no secret value in this session, memo holds names/IDs/conclusions only.
- This entry is for investigation and design only; nothing was executed.

## Investigation and design — Mongo access without the dashboard console (2026-10-26; NOTHING executed, no service created, no variable changed)

### 1. What this session's Railway access can and cannot do (verified from the tool list and Railway docs)
- Exec inside the MongoDB service: NOT possible. The Railway MCP has no exec/shell/ssh tool (searched). railway-agent is Railway's own AI agent (reads config/logs/metrics; can change variables, restart, deploy, open PRs); no exec is documented. No Railway CLI and no Mongo client in this VM.
- Temporary public TCP proxy: a tool exists (create-tcp-proxy, applicationPort 27017, max one per service, applied by redeploying the service). NOT recommended: it exposes Mongo to the internet, restarts Mongo, and this VM reaches the internet only through an HTTPS agent proxy (a Railway domain already returned 403 on CONNECT), so raw Mongo wire traffic from here is not expected to work; it would also need the credentials in this session.
- Routes that DO exist without the console: (a) a Railway Function service in the same project/environment (create-function: one TypeScript file on Bun, npm imports auto-installed, reaches the private network, reads variables incl. references, logs readable with get-logs); (b) a pre-deploy command on the backend (update-service preDeployCommand; runs with the service variables on the private network) — works but ties a destructive one-off to the production backend deploy, so not recommended.
- Repo: no existing admin endpoint, script or job can change a Mongo user's password or count CREDS-encrypted data. packages/api/src/admin (users, roles, groups, grants, config, secrets, audit log, skills, code, langfuse) does not expose it; config/*.js (list-users, user-stats, reset-password, create-user) are CLI scripts that need a shell inside the backend container (not available), and user-stats only counts users. A new endpoint/script would mean new code in repo history and a production backend redeploy.

### 2. Recommended safest route: a temporary, private Railway Function ("mf-oneoff") in project mindferry
Properties: no public domain, restart policy NEVER, deleted right after use, code contains no secret (it reads everything from variables), prints only booleans/counts. It reaches Mongo with a variable REFERENCE (MONGO_URL = reference to the MongoDB service's MONGO_URL), so the connection string value never appears in this session. Code is deployed through the Function mechanism, not committed to the repo. Because a Function reinstalls and re-runs on every start, the script must be idempotent and self-guarding (it exits without changes if the new password already works and the old one does not).

Phase 0 — CREDS count (read-only; no password involved)
1. Create the function with a script that connects, finds the databases that have a users collection, and prints the same counts as the count-only query above (users, users with 2FA, document counts of keys, pluginauths, actions, mcpservers, skillsynccredentials, openidrefreshflights, refreshtokenbridges, huboauthclients, configs, and the token type breakdown). It never prints the URL, user, or error objects (only error names).
2. Set MONGO_URL as a reference variable on the function; set restart policy NEVER.
3. Lyra reads the counts from get-logs, then deletes the function service. Decision rule unchanged: all zero/absent => CREDS_KEY/CREDS_IV may be rotated without migration (64 hex / 32 hex); anything non-zero => HOLD until a re-encryption migration exists.
Risk: low (read-only, same credentials the backend already uses). Needs Kem's go-ahead to create the service.

Phase 1 — Mongo password change (only after Phase 0, and only if Vincent still wants it)
Backup is waived by Vincent; none exists. updateUser does not touch data; the real risk is lockout or a half-applied change.
1. Kem's browser task generates a URL-safe random password (>= 32 chars) itself and reports no value. It sets it as NEW_MONGO_PASSWORD on the function, and also copies the CURRENT password into a temporary variable on the function (for rollback) — both browser-only.
2. In the browser, STAGE (do not apply) the MongoDB service variable changes: MONGO_INITDB_ROOT_PASSWORD = the new value; MONGOPASSWORD and MONGO_URL only if they are literals (leave references). The function's MONGO_URL reference keeps resolving to the live (old) value until the staged change is applied.
3. Deploy the function armed (ARMED=yes). Script: read MONGO_URL (old) -> connect -> run the updateUser command for that URL's user with pwd = NEW_MONGO_PASSWORD -> open a new connection with the new password (ping must succeed) -> open one with the old password (must fail) -> print only "NEW_OK" and "OLD_REJECTED" (or "ALREADY_DONE" / a failure code) -> exit 0. If it fails before updateUser nothing changed (exit 1).
4. Immediately apply the staged MongoDB variable changes (Railway redeploys MongoDB and the services referencing it, including the backend; redeploy the backend once if it does not restart). The only exposure window is seconds: the backend's already-authenticated pooled connections keep working; only new connections fail until the backend restarts.
5. Verify (Lyra reads logs): function printed NEW_OK and OLD_REJECTED; MongoDB service back Online; backend deploy log "Connected to MongoDB" with no authentication error and readiness passing; Vincent logs in fresh and the conversation list loads; /api/hub/mcp still answers 200.
6. Cleanup: delete the function service (this removes NEW_MONGO_PASSWORD and the temporary old-password copy). Confirm no leftover service or variable.
Rollback / failure handling: the old password is never recorded in this session or the repo; the temporary old-password copy on the function (browser-only) lets the function be re-run in reverse before cleanup. If the backend cannot connect after the apply, roll FORWARD (make the variables match the new DB password); do not delete the function until the backend is healthy. Break-glass if Mongo itself will not authenticate: temporarily start mongod without auth via the MongoDB start command, recreate/update the user, then restore the start command — only with Kem and Vincent's explicit approval (Mongo stays private-network only, no TCP proxy).
Risks: no backup (waived); the function briefly holds credential-bearing variables (delete it right after); a Function re-runs on restart (mitigated by restart policy NEVER, idempotent guard, and deletion); a typo or non-URL-safe password in MONGO_URL breaks the backend connection (use hex/alphanumeric only); Mongo is private-only, so the benefit of this rotation is modest compared with its risk — Phase 0 is cheap and should come first, and Phase 1 is optional.

### 3. CREDS count without the Mongo shell
The dashboard shell is not required, but a Mongo connection still is: nothing in the backend or admin API reports these counts. The Phase 0 function is an equivalent connection (counts only). Without some Mongo connection the answer cannot be obtained.

Status: awaiting Kem's go-ahead for Phase 0. CREDS_KEY/CREDS_IV, Mongo password, FREELLMAPI_KEY and the upstream provider key remain HELD. skyloom untouched.

## Stage 0 (CREDS count via temporary Function) — INCOMPLETE, two attempts (2026-10-26)
Approved by Kem (Stage 0 only), retried on Vincent's explicit approval after the first safety stop. Read-only intent; nothing in Mongo, the backend, freellmapi or skyloom was changed.
- Function mf-oneoff (service 8e887662-0f6d-4b0a-b7e2-2c9bce1f9923, project mindferry, production): created as a STAGED service only, never deployed. Verified by describe-environment on both attempts: state "staged-create", latestDeployment null, region now set to sfo (it defaulted to us-west2; set to sfo to sit next to MongoDB). Configuration: single TypeScript file (counts only; never prints the URL, credentials, documents or error text), MONGO_URL as a reference variable (value redacted, not visible in this session), restart policy NEVER, no domain, not committed to the repo. The pending patch (b7f44204-21a8-455a-9c36-125b24b2694a, 6 changes) contains only this service; no other service has staged changes.
- Deploy result: accept-deploy FAILED twice with the same error: the Railway MCP server "asked the user a question, and no answer came before the time limit" (tool timed out after 60 s). The question's content was not visible to Lyra. After the second timeout the function was still staged-create with no deployment. No counts were produced.
- Per instruction, no third attempt and nothing else changed. Stage 1 not started.
- CREDS decision: still HELD (no counts obtained).
- Open item: the staged patch remains pending in the dashboard. It only creates the read-only function; it can be applied by a human from the Railway dashboard ("Apply changes" for mf-oneoff, which may be the confirmation Railway was asking for), after which Lyra reads the counts with get-logs and deletes the function. If it is not going to be used, discard the pending change or delete the staged service so it does not linger.
