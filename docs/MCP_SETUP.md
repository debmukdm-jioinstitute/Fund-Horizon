# Fund Horizon in Claude: setup, architecture, operations

Fund Horizon exposes one MCP server, `POST https://api.fundhorizon.website/mcp` (code: `backend/app/mcp_server.py`).
Staff only. Claude acts with the signed-in staff member's own permissions.

## Why phones failed before

Desktop used a `.mcpb` file with a personal token baked in. Claude on phones and claude.ai only supports **remote
connectors** added with a URL, and those sign in with **OAuth**; they cannot take a pasted bearer token. Our `/mcp`
answered `401` with no OAuth hints, so the connector could not start sign-in. Fixed by `backend/app/mcp_oauth.py`.

## Connection paths

| Where | How | Credential |
|---|---|---|
| Claude Desktop | Settings, Claude connection, *Download Fund Horizon for Claude*, open the `.mcpb` | personal token (90 days) |
| Claude Code | Settings, Claude connection, *Copy the connect command* | personal token (90 days) |
| claude.ai + iPhone + Android | Add custom connector with the `/mcp` address, sign in | OAuth, 1-day access token, 90-day rotating refresh token |

All three end in the same `mcp_tokens` + `sessions` rows, so permissions, the audit log (`mcp_audit_log`) and revocation
are identical. Removing a connection in Settings kills its refresh token too.

## User guide: phone

1. Staff opens `https://fundhorizon.website/backoffice/settings/mcp` and clicks **Copy the Fund Horizon address**
   (`https://api.fundhorizon.website/mcp`).
2. On claude.ai (phone browser or computer): **Settings, Connectors, Add custom connector**. Name `Fund Horizon`, paste the
   address, **Add**. (The phone app cannot add new connectors; it uses the ones added on the web.)
3. **Connect**. A Fund Horizon page opens: enter staff email and password, tap **Sign in and allow**.
4. Open the Claude phone app, start a chat, tap **+**, switch **Fund Horizon** on. Ask: "Show Fund Horizon data health."

Needs Claude Pro, Max, Team or Enterprise. On Team/Enterprise an owner adds the connector once for the organisation.
Customer (non-staff) accounts are refused with "Staff access required."

## How the OAuth flow works (RFC 9728, 8414, 7591, 7636)

1. Claude calls `POST /mcp` with no token. Reply `401` + `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource"`.
2. Claude reads `/.well-known/oauth-protected-resource` then `/.well-known/oauth-authorization-server`.
3. `POST /oauth/register` (dynamic client registration). Redirect URIs must be https (http only for localhost).
4. Browser opens `GET /oauth/authorize` (PKCE S256 required). Staff signs in on the page; `POST` creates a 5-minute single-use code and redirects to the registered callback (`https://claude.ai/api/mcp/auth_callback`).
5. `POST /oauth/token`: `authorization_code` + `code_verifier` returns `access_token` (1 day) and `refresh_token` (90 days). `refresh_token` grant rotates both; reuse of an old refresh token fails.
6. Claude calls `/mcp` with `Authorization: Bearer <access_token>`.

Tables (created on first use): `mcp_oauth_clients`, `mcp_oauth_codes`, `mcp_oauth_refresh`.

## Operations

- `FH_MCP_URL` (default `https://api.fundhorizon.website/mcp`) fixes the public address used in OAuth metadata. Set it if the API host ever changes. Never derived from the request.
- The reverse proxy must pass `/mcp`, `/oauth/*` and `/.well-known/*` to the API. The blue/green proxy in `deploy/redeploy.sh` forwards `/` to the API, so nothing to add.
- Verify after deploy:
  ```bash
  curl -si -X POST https://api.fundhorizon.website/mcp | grep -i www-authenticate
  curl -s https://api.fundhorizon.website/.well-known/oauth-authorization-server
  ```
- Revoke a lost phone: Settings, Claude connection, My connections, **Remove**. Access stops at once and it cannot refresh.
- Password change / suspended account: a refresh or new sign-in is refused; an access token already issued lasts up to 1 day unless removed.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Couldn't connect" when adding | Address wrong (must end `/mcp`), or proxy not passing `/.well-known`. Run the curl checks above. |
| Sign-in page says Staff access required | Account is a customer account. |
| "Invalid email or password" repeatedly | Login is rate-limited per IP; wait a minute. |
| "Too many wrong passwords" | The account is locked on the MCP sign-in for 15 minutes after 5 wrong passwords (any IP). Wait, then use the right password. |
| Connector worked, then asks to reconnect | Refresh token expired (90 days) or connection was removed. Reconnect. |
| 25 connections error | Limit per user. Remove old ones in Settings. |

## Tests

`backend/tests/test_mcp_oauth.py` (discovery, registration limits, PKCE, single-use codes, refresh rotation, revoke, staff-only, CSP).
Run: `cd backend && .venv/bin/python -m pytest tests/test_mcp_oauth.py tests/test_mcp.py -q`
