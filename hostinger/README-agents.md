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

## Part 2: turn the page on (a change to the running MindFerry: wait for Vincent's go-ahead)

1. A MindFerry config for this VPS only, so Railway is unaffected. Copy the repo's `librechat.yaml`
   to `/opt/agents/mindferry/librechat.yaml` and add:

   ```yaml
   agentBridge:
     enabled: true
     tasksDir: /home/deploy/tasks
     dashboards:
       - name: Hermes
         url: http://localhost:9119
       - name: OpenClaw
         url: http://localhost:18789
     statusStaleSeconds: 300
     tunnelCommand: ssh -L 18789:localhost:18789 -L 9119:localhost:9119 deploy@<vps-address>
   ```

2. In `compose.yaml`, under `backend:`, add mounts. The folder is mounted at the same path the agents
   see, so the paths written into task files are valid for them. Only `inbox` can be written:

   ```yaml
       volumes:
         - ./librechat.yaml:/app/librechat.yaml:ro
         - /home/deploy/tasks/inbox:/home/deploy/tasks/inbox
         - /home/deploy/tasks/processing:/home/deploy/tasks/processing:ro
         - /home/deploy/tasks/outbox:/home/deploy/tasks/outbox:ro
         - /home/deploy/tasks/archive:/home/deploy/tasks/archive:ro
         - /home/deploy/tasks/.status:/home/deploy/tasks/.status:ro
   ```

3. Build the image from the new commit, then replace only the backend:

   ```bash
   docker compose build backend
   docker compose up -d backend
   ```

   MongoDB and freellmapi are not touched. The backend is away for about a minute.

4. Check: sign in as the admin, the sidebar shows "Agents". Signed out, or as anyone else, the page
   and `/api/bridge/*` must answer nothing (401, 403, or a redirect home).

To undo: remove the `agentBridge` block (or set `enabled: false`) and `docker compose up -d backend`.

## What the page can and cannot do

- It lists tasks, shows results, and writes one new task file into `inbox/`. It cannot run anything
  now: an agent picks the file up on its next poll (about ten minutes).
- It cannot move, delete or edit any other file. The other folders are mounted read-only.
- Results are written by the agents, who read the open web. The page draws them as plain Markdown:
  no HTML, no images, only http(s) links.
- Agents use a throwaway browser profile, so logins are not kept between tasks.
