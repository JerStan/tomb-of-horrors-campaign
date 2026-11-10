# GameVault live gameplay — deployment and acceptance

## Current status

- The public GameVault website has a Play tab, Memory tab, and original campaign library.
- `gateway/server.py` implements the **local** persistent Codex app-server adapter and authoritative SQLite turn storage.
- **Not yet deployed.** The GitHub repository does not supply a running host, Codex authentication, database service or permanent HTTPS endpoint.
- Never publish OpenAI/Codex credentials or an access token in this public repository.

## Host requirements

A trusted Windows or Linux machine that remains powered on, Python 3.11+ and a working/authenticated Codex CLI. Ensure the exact machine/account can run `codex app-server --stdio` with the current CLI version.

Run from the repository root:

Windows PowerShell:

```powershell
$env:GAMEVAULT_ACCESS_TOKEN = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
python .\gateway\server.py
```

Linux/macOS (generate a token using `python -c "import secrets;print(secrets.token_hex(32))"` and set it in the server environment):

```sh
python3 gateway/server.py
```

The gateway binds **only to 127.0.0.1:8765**. Keep it loopback-only; do not directly expose this port to the public internet. The SQLite file is `gateway/gamevault.sqlite3` by default. Back it up regularly and exclude it from git. The initial campaign state is loaded from `campaign-memory.json` only on first launch.

## Secure public gateway

A separate secure HTTPS reverse proxy or managed private access service must be installed on the host. The proxy should forward only to 127.0.0.1:8765, require authentication, support the GitHub Pages origin `https://jerstan.github.io`, and provide a **stable hostname** and trusted TLS certificate. Avoid Tailscale conflicts and expiring temporary Cloudflare links.

The frontend sends a bearer token to the gateway. Use a strong random secret, do not share it in chat, and place it only in the Play configuration field. Note: the frontend currently stores the token in browser session storage, which is suitable only for the owner's trusted devices; a production deployment should instead use a short-lived, scoped access credential.

The host must be **on** and the gateway must be running for gameplay. Static GitHub Pages cannot host Python, SQLite or a long-running Codex process.

## Acceptance checks

1. Run `python -m py_compile gateway/server.py` on the hosting machine.
2. Start the server and verify it authenticates to Codex correctly.
3. Configure the stable HTTPS gateway URL in GameVault → Play.
4. Test connection and confirm `saveBackend: sqlite` and `persistentSession: true` after the session is started.
5. Send `Examine the Bronze Eye Door` as a player action. Verify a real Codex response and an increment in SQLite `turns` and `campaigns.revision`.
6. Repeat the exact same `clientTurnId` and action; verify the *same* result and revision (idempotent replay).
7. Reload the browser and confirm the journal remains available. Stop/restart the app-server and confirm the stored thread is resumed rather than replaced.
8. Inspect `campaign-memory.json`, the pictures and explored-floor-plan: do not modify those public artifacts during ordinary gameplay.
9. Benchmark at least 10 warm turns against a fresh-process baseline before claiming measured speed or cost savings.
10. Once validated, implement an explicit owner-approved public publishing step. GitHub Pages mirrors are not the authoritative SQLite state.

## Known limitations and follow-up work

- No gateway has been deployed or accepted end-to-end yet. The website is not yet a working AI game.
- Error recovery for a Codex response generated but not committed to SQLite is conservative: the gateway rejects/does not commit ambiguous outputs. Investigate thread history manually instead of automatically replaying a possibly completed action.
- This prototype uses the Codex app-server JSON-RPC protocol and a compact state snapshot on each turn. It does not yet include automatic scheduled thread compaction or performance instrumentation.
- Player dialogue is mirrored to the browser memory after a confirmed server response. Public GitHub memory publication remains a separate operation requiring the owner's explicit command.
- A second game branch requires a **different** database, access policy and Codex thread; do not point both Branch A and B at this database.
- User authentication and API usage/quota policies must be checked on the chosen host and account.

## Source

Protocol overview: https://learn.chatgpt.com/docs/app-server
