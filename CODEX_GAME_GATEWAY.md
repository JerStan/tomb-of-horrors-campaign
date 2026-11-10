# GameVault Persistent Codex Gateway — Integration Contract

## What has been deployed
The GitHub Pages public site now has a **Play** tab. Its client is `play.js`.
This page is static and **does not** host Codex, the SQLite save database, or a game backend.
The old temporary Cloudflare 'Play' URL in the home-card is legacy and must not be used as a permanent endpoint.

## Required execution architecture (previously agreed)
- Keep Branch A and Branch B sessions isolated; do not mix their SQLite databases or warm Codex sessions.
- Run **one persistent Codex app-server process/session per active game branch**, not a new process for each turn.
- Periodically compact session context into **checkpoint summaries** rather than replaying the entire transcript on every move.
- Keep **SQLite as the authoritative state** for locations, explored map segments, inventory, flags, journal, and turn IDs.
- Preserve original map pixels/geometries; **append new explored areas only**.
- Persist each accepted turn transactionally, and use a client turn ID for idempotency.
- Use existing pictures and sound assets. Do not regenerate them.
- Only publish changed public library files when the owner explicitly says **"Publish GameVault update."**
- Verify the faster/cheaper execution method with actual latency/token metrics; do not claim improvements until measured.

## Security and connectivity
- Expose a **stable authenticated HTTPS gateway**, not a temporary trycloudflare URL or a Tailscale address that conflicts with Norton VPN.
- Never expose a Codex process, SQLite file, GitHub token, or OpenAI API key directly on the internet.
- Bind the Codex service locally; the gateway authenticates/authorizes each action, adds appropriate CORS for the GitHub Pages origin, and forwards validated requests.
- Enable TLS, rate limiting, origin checks, CSRF defenses where applicable, and logs that do not store secrets.
- Ideally put the backend on an always-on trusted machine/server. A Windows process that is off cannot answer requests.
- The frontend accepts an optional gateway access token in **sessionStorage only**; use narrowly-scoped short-lived credentials.

## Required HTTP JSON interface
### POST /v1/game/status
Input:
```json
{"campaignId":"tomb-of-horrors-seraphina"}
```
Successful output:
```json
{"status":"ready","session":"branch-A","persistentSession":true,"saveBackend":"sqlite","checkpointVersion":1}
```

### POST /v1/game/turn
Input:
```json
{"campaignId":"tomb-of-horrors-seraphina","action":"Examine the parchment","clientTurnId":"uuid"}
```
Successful output:
```json
{
  "response":"Narrated result from the persistent Codex Dungeon Master",
  "turnId":128,
  "state":{
    "location":"Bronze Eye Door",
    "objective":"Investigate the wind-sequence mechanism",
    "newClues":[]
  }
}
```

The server must commit the result in SQLite before acknowledging it. Repeat requests with the same clientTurnId must return the **same committed outcome** without applying the action twice. Use 409 for stale/conflicting state with a clear recoverable error. Network timeouts are ambiguous and the client currently tells the user to check before retrying, to prevent double turns.

## Not yet implemented
1. Deploy the persistent Codex app-server / SQLite backend on an always-on host.
2. Implement the authenticated HTTPS gateway with the above contract and CORS.
3. Configure the gateway URL in the site's Play tab and run end-to-end acceptance tests.
4. Implement automated authoritative state-to-GitHub public-library publication, triggered **only** by the specified owner instruction.
5. Measure token use, warm-session reuse and turn latency against the prior fresh-process baseline.

Do **not** label browser-only fallback text or ChatGPT redirects as the agreed persistent Codex architecture. They are different methods.
