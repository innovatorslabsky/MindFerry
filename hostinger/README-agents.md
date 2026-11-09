# Agents page: what to install on the VPS

The Agents page in MindFerry reads a task folder the agents already share, and a status snapshot a
small script writes once a minute. Nothing here runs a command from the web, and MindFerry never
gets the Docker socket.

Do the steps in order, as the `deploy` user (`HOME=/home/deploy`, never root), and stop at the end of
each part. Nothing here touches Railway.

## Part 1: the status script (safe to do first; changes nothing MindFerry runs)

In the repository these files are under `hostinger/`; the commands below save them on the VPS under
`/opt/agents/mindferry/scripts/`.

```bash
cd /opt/agents/mindferry
B=https://raw.githubusercontent.com/innovatorslabsky/MindFerry/<commit>/hostinger
curl -fsSL "$B/agents-status.py" -o scripts/agents-status.py
curl -fsSL "$B/test_agents_status.py" -o scripts/test_agents_status.py
chmod +x scripts/agents-status.py
sha256sum scripts/agents-status.py          # compare with the hash Lyra sends
python3 -m unittest scripts/test_agents_status.py     # 30 tests, no Docker needed
```

Look at what it would write, without writing:

```bash
time python3 scripts/agents-status.py --print
```

Expected: both agents `"state": "running"`, a `version`, and a `job` with `lastOk: true`. A part
that cannot be read is simply missing, which the page shows as "unknown". Send Lyra that JSON and
the time it took.

Write it once, then check the file:

```bash
python3 scripts/agents-status.py
ls -l /home/deploy/tasks/.status/
```

Expected: `agents.json` (`-rw-r--r--`) and `.cache.json`.

Run it every two minutes (one run takes about 7 seconds, and the page treats a snapshot as current for five minutes):

```bash
( crontab -l 2>/dev/null; echo '*/2 * * * * flock -n /tmp/mf-agents-status.lock /usr/bin/python3 /opt/agents/mindferry/scripts/agents-status.py' ) | crontab -
crontab -l
sleep 130; ls -l --time-style=full-iso /home/deploy/tasks/.status/agents.json
```

To undo: remove that line with `crontab -e`, then `rm -r /home/deploy/tasks/.status`.

## Part 2: turn the page on (changes the running MindFerry; backend is away for 1 to 2 minutes)

Do Part 1 first: `/home/deploy/tasks/.status/agents.json` must exist. Run it in `tmux new -As mf-bridge`,
as `deploy`, from `/opt/agents/mindferry`. Stop and report at the first line that does not match.

### 2.0 Before anything

```bash
cd /opt/agents/mindferry
id -un; echo "$HOME"                       # deploy  /home/deploy
export BK=/home/deploy/backups/mindferry-20261106
export SHA=<full commit sha Lyra sends>
for d in inbox processing outbox archive .status; do test -d /home/deploy/tasks/$d && echo "ok $d" || echo "MISSING $d"; done
ls -l /home/deploy/tasks/.status/agents.json
docker compose ps
docker image ls mindferry-backend
df -h / | tail -1; free -h | sed -n 2p
```

Any `MISSING` means stop: Docker would create the missing folder owned by root.

### 2.1 Fetch the new source into its own folder (the old `src/` stays for rollback)

```bash
cp -p compose.yaml compose.yaml.before-bridge
mkdir -p ~/incoming && cd ~/incoming
curl -fsSL -o mindferry-$SHA.tar.gz https://github.com/innovatorslabsky/MindFerry/archive/$SHA.tar.gz
mkdir -p /opt/agents/mindferry/src-bridge
tar xzf mindferry-$SHA.tar.gz -C /opt/agents/mindferry/src-bridge --strip-components=1
cd /opt/agents/mindferry
sha256sum src-bridge/Dockerfile src-bridge/librechat.yaml src-bridge/api/server/routes/bridge.js src-bridge/packages/api/src/bridge/routes.ts src-bridge/packages/api/src/bridge/store.ts src-bridge/client/src/components/Bridge/BridgeView.tsx
```

Compare with the hashes Lyra sends. A mismatch means stop.

### 2.2 The MindFerry config for this VPS (not in the repository, so Railway is unaffected)

```bash
cp src-bridge/librechat.yaml librechat.yaml
cat >> librechat.yaml <<'EOF'

# Agent bridge: this VPS only.
agentBridge:
  enabled: true
  tasksDir: /home/deploy/tasks
  statusStaleSeconds: 300
  dashboards:
    - name: Hermes
      url: http://localhost:9119
    - name: OpenClaw
      url: http://localhost:18789
  tunnelCommand: ssh -L 18789:localhost:18789 -L 9119:localhost:9119 deploy@187.124.141.236
EOF
tail -14 librechat.yaml
```

### 2.3 Edit compose.yaml (a scripted edit that refuses to run if the file is not what is expected)

```bash
python3 - <<'PY'
import os
sha = os.environ["SHA"][:7]
s = open("compose.yaml", encoding="utf8").read()
def sub(old, new):
    global s
    assert s.count(old) == 1, "unexpected compose.yaml: " + old.strip()
    s = s.replace(old, new)
sub("      context: ./src\n", "      context: ./src-bridge\n")
sub("    image: mindferry-backend:ae40d65\n", "    image: mindferry-backend:bridge-" + sha + "\n")
sub("    env_file: .env\n", """    env_file: .env
    volumes:
      - ./librechat.yaml:/app/librechat.yaml:ro
      - /home/deploy/tasks/inbox:/home/deploy/tasks/inbox
      - /home/deploy/tasks/processing:/home/deploy/tasks/processing:ro
      - /home/deploy/tasks/outbox:/home/deploy/tasks/outbox:ro
      - /home/deploy/tasks/archive:/home/deploy/tasks/archive:ro
      - /home/deploy/tasks/.status:/home/deploy/tasks/.status:ro
""")
open("compose.yaml", "w", encoding="utf8").write(s)
PY
diff compose.yaml.before-bridge compose.yaml
docker compose -f compose.yaml config -q && echo COMPOSE_OK
```

Only `inbox` is writable. The diff must show exactly the build folder, the image tag and the six mounts.

### 2.4 Build (about 7 minutes; the running site is not touched)

```bash
docker compose build backend 2>&1 | tail -15
docker image ls mindferry-backend
```

Two tags must be listed: `ae40d65` (the rollback) and `bridge-<sha7>`.

### 2.5 Switch the backend (the only downtime)

```bash
date -u
docker compose up -d backend
for i in $(seq 1 40); do s=$(docker inspect -f '{{.State.Health.Status}}' mindferry-backend); echo "$i $s"; [ "$s" = healthy ] && break; sleep 5; done
date -u
docker ps --format '{{.Names}}  {{.Status}}' | grep mindferry
```

MongoDB and freellmapi must keep their old uptime: only the backend is recreated.

### 2.6 Check

```bash
docker compose logs --tail 80 backend | grep -iE 'error|fail|bridge' | head -20
./scripts/mf-env.py verify "$BK"
curl -sS https://mindferry.smartcare.business/health; echo
docker compose logs backend 2>&1 | grep -i 'agentBridge' | head -3
curl -sS -o /dev/null -w 'overview, not signed in (want 401): %{http_code}\n' https://mindferry.smartcare.business/api/bridge/overview
docker exec mindferry-backend sh -c 'touch /home/deploy/tasks/outbox/.rwtest 2>&1; echo "rc=$?"'
curl -s -o /dev/null -w 'smartcare: %{http_code}\n' https://smartcare.business
```

Wanted: no new errors (the three known warnings about credentials, web search and RAG stay);
`ENV_VERIFY_OK`; `OK`; the start-up log shows the `agentBridge` settings with `enabled: true`; `401`; the `touch` in `outbox` fails with
"Read-only file system" and `rc=1`; `smartcare: 200`.

Then, in the browser as the admin: see "What the page should show" below.

### Undo

```bash
cd /opt/agents/mindferry
cp -p compose.yaml.before-bridge compose.yaml
docker compose up -d backend
```

This brings back the old image (`ae40d65`) and drops the mounts and the config file together.
`src-bridge/`, `librechat.yaml` and the new image can stay or be deleted later.

### What the page should show

1. The sidebar has "Agents". Signed out, `/bridge` goes to the login page.
2. Two cards, Hermes and OpenClaw: "Running", the version, and "Task poll is working". If the status
   file is missing or old, the page says so and shows "Unknown" (never "Running").
3. The tasks the agents already did (for example `readme-summary`) appear as "Done" with "View
   result"; the result opens as plain text.
4. New task: Agent Hermes, text "Read /home/deploy/tasks/README.md and write a 3-line summary of it.",
   output "a 3-line summary". "Preview file" shows `from: kem` and `via: mindferry`; "Create task" adds
   it to the list as "Waiting" and the file appears in `/home/deploy/tasks/inbox/`.
5. Within about 11 minutes the task becomes "Running", then "Done", with a result. The page refreshes
   itself every 20 seconds. Filing the task (moving it to `archive/`) stays a manual step for Kem.

## What the page can and cannot do

- It lists tasks, shows results, and writes one new task file into `inbox/`. It cannot run anything
  now: an agent picks the file up on its next poll (about ten minutes).
- It cannot move, delete or edit any other file. The other folders are mounted read-only.
- Results are written by the agents, who read the open web. The page draws them as plain Markdown:
  no HTML, no images, only http(s) links.
- Agents use a throwaway browser profile, so logins are not kept between tasks.
