# Slack Bridge

Sends a Slack channel's messages to one MindFerry agent and posts its reply back —
over the Remote Agent trigger API this app already exposes at
`POST /api/agents/v1/events` (see
`packages/api/src/agents/triggers/README.md`), the same way any external
integration would reach it.

## What this is — and isn't

**v1 scope, deliberately**: every Slack message starts a **new** agent conversation.
There is no per-channel or per-thread memory across messages. The trigger API's
`continue` mode — which would let a Slack thread map to one ongoing conversation —
needs a **binding** registered against a parent LibreChat agent conversation the
caller's user already owns, with the target agent listed as that parent's subagent.
A bare Slack channel has none of that by default, so wiring it up is future work,
not a corner cut here — see [Adding thread continuity](#adding-thread-continuity)
for exactly what it would take.

**One bridge, one agent.** Every message across every channel goes to the same
configured `agentId`. Routing different channels to different agents isn't built —
if you need that, run more than one bridge (this integration has no shared state
beyond its config, so nothing stops registering the route at a second path with a
second config).

**No page for the reply's content.** The trigger API's delivery-status endpoint
deliberately never exposes message text — only conversation/generation identity
(see its README). This bridge reads the reply the same way `getReplyText` is wired
in `api/server/routes/channels/slack.js`: querying LibreChat's own Message model
for the target conversation after the delivery reports `succeeded`.

## Setup

### 1. Create a Slack app

At [api.slack.com/apps](https://api.slack.com/apps), create an app and configure:

- **Event Subscriptions**: Request URL = `https://<your-domain>/api/channels/slack/events`.
  Slack will send a `url_verification` challenge to this URL as soon as you save it —
  the bridge answers it automatically, but only once `channels.slack.enabled` is `true`
  below and the app is running.
- Subscribe to the `message.channels` bot event (and `message.groups`/`message.im` if
  you want private channels or DMs too).
- **OAuth & Permissions**: add the `chat:write` bot scope, then install the app to your
  workspace. Copy the **Bot User OAuth Token** (`xoxb-...`).
- **Basic Information**: copy the **Signing Secret**.
- Invite the bot to whichever channels should reach it (`/invite @your-bot-name`).

### 2. Create a LibreChat bridge user and API key

The bridge acts as one LibreChat user for every Slack message. Use an existing
account or create a dedicated one, then mint a Remote Agents API key for it
(Settings → API Keys → Agent API Keys). That user needs the `REMOTE_AGENTS` role
permission and **VIEW** access to whichever agent should answer — the trigger API's
own ACL check enforces this, so a misconfigured bridge fails closed with a 403
rather than silently doing nothing.

### 3. Configure `librechat.yaml`

```yaml
channels:
  slack:
    enabled: true
    agentId: 'agent_abc123' # the agent that answers every Slack message
    signingSecret: '${SLACK_SIGNING_SECRET}'
    apiKey: '${SLACK_BRIDGE_API_KEY}' # the Remote Agents API key from step 2
    botToken: '${SLACK_BOT_TOKEN}'
```

Add the referenced variables to `.env`:

```bash
SLACK_SIGNING_SECRET=...
SLACK_BRIDGE_API_KEY=...
SLACK_BOT_TOKEN=xoxb-...
```

`DOMAIN_SERVER` (already required for the [context hub](mindferry.md)'s OAuth
server) must also be set — the bridge uses it to build the trigger API URL it
calls, the same reason that page gives for why a client-supplied `Host` header
isn't trusted for this.

## How a message flows through

```
Slack channel          MindFerry                         Trigger API
     │                     │                                   │
     ├─ message event ────▶│ verify signature                  │
     │                     │ ack (200) immediately ────────────┤
     │                     │                                   │
     │                     ├─ POST /events (mode: fire) ───────▶│
     │                     │◀── 202 Accepted, Location ─────────┤
     │                     │                                   │
     │                     ├─ poll GET /events/:id ────────────▶│
     │                     │◀── succeeded, conversationId ──────┤
     │                     │                                   │
     │                     │ read the agent's reply from        │
     │                     │ that conversation's messages       │
     │◀── chat.postMessage ┤                                   │
```

Slack requires a fast ack regardless of what happens next, so the bridge responds
`200` immediately and does the fire → poll → reply round trip afterward, in the
background. A Slack retry of the same event (Slack retries on a slow/missing ack)
carries the same `event_id`, which becomes this call's `Idempotency-Key` — so a
retry can never fire the agent twice for one message.

## Adding thread continuity

To make a Slack thread map to one ongoing conversation instead of a fresh one per
message, you'd need:

1. The target agent configured with `subagents.enabled: true` and itself listed in
   `subagents.agent_ids` (a "self-spawn" binding, which the trigger API's bindings
   endpoint allows unless `allowSelf: false`).
2. On the first message in a thread: after the `fire` call succeeds, register a
   binding (`POST /api/agents/v1/events/bindings`) with `parentConversationId`/
   `parentMessageId` from that result and `target.agentId` equal to the same agent,
   getting back a `bindingId`.
3. Persist `slack thread_ts → bindingId` somewhere durable (a small Mongo
   collection, not the in-memory `Map` this would otherwise tempt you into — a
   restart would silently lose every thread's continuity).
4. On a later message in the same thread: send `mode: 'continue'` with that
   `bindingId` at the top level of the `/events` body instead of `fire`.

This is real, buildable work, not hand-waving — it just needs a persistence
decision (step 3) this v1 deliberately doesn't make for you.

## Security notes

- Every request's Slack signature is verified (HMAC-SHA256 over
  `v0:{timestamp}:{rawBody}`, constant-time compared) before anything else runs,
  with a 5-minute replay window — Slack's own documented scheme, unmodified.
  Requests failing this check get a plain 401, with the body never inspected.
- The bridge's own Remote Agents API key is exactly as powerful as any other API
  key for that user — scope the bridge user's role and the target agent's ACL
  deliberately, the same as you would for any other integration reusing that key
  type.
- A message the bridge itself posts back to Slack (`bot_id` set) is explicitly
  ignored on the way back in, so the bridge can never trigger itself in a loop.
