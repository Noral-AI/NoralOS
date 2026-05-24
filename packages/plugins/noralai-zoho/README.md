# `@noralos-plugins/noralai-zoho`

NoralAI Zoho CRM integration for NoralOS.

Wraps the Zoho CRM REST API (v7) behind a NoralOS-branded plugin surface
so agents (Brooklyn, directors, managers) can read CRM context and write
activity mid-conversation.

## What's in v0.1.0

Five agent tools, namespaced `noralai.zoho:`:

| Tool                  | Tier     | What it does                                                                 |
| --------------------- | -------- | ---------------------------------------------------------------------------- |
| `zoho_list_modules`   | worker   | List the CRM modules available in the company's Zoho org (Leads, Contacts…). |
| `zoho_search_records` | worker   | Search records in a module by `criteria`, `email`, `phone`, or `word`.       |
| `zoho_get_record`     | worker   | Fetch a single record by id from a module.                                   |
| `zoho_create_record` | manager  | Create a new record (e.g. a lead) in a module.                               |
| `zoho_update_record` | manager  | Patch an existing record by id.                                              |

## Credentials

OAuth 2.0 authorization-code (refresh token). Configure under
**Settings → Integrations → Zoho CRM**:

1. Create a Server-based app in the Zoho API Console.
2. Set the redirect URI to `<noralos-origin>/api/integrations/oauth/zoho/callback`.
3. Paste Client ID + Client Secret in NoralOS, pick your data center, click Connect.
4. Approve the consent screen on Zoho.

The encrypted material is a JSON blob `{ clientId, clientSecret, refreshToken }`.
Access tokens are minted on demand by the plugin worker and cached in-process.

The plugin needs to know which data center the org is in so it can pick
the right `accounts.zoho.<tld>` token endpoint and `www.zohoapis.<tld>` API host.
That's propagated from `credential.metadata.fields.dataCenter` into the
plugin's instanceConfig via the assignment slot's `pairedFields`.

## How the worker resolves credentials

1. `ctx.config.get()` returns `{ secretRef, dataCenter, apiDomain? }`.
2. `ctx.secrets.resolve(secretRef)` returns the JSON blob.
3. The client parses `clientId`, `clientSecret`, `refreshToken`.
4. On first call, exchanges `refreshToken` for an access token at
   `https://accounts.zoho.<tld>/oauth/v2/token`.
5. Access token is cached in-process until ~60 s before expiry.
6. Each API call sends `Authorization: Zoho-oauthtoken <access-token>` to
   `https://www.zohoapis.<tld>/crm/v7/...` (or the `apiDomain` override).

## Auto-registration

Like the Brooklyn / NoralSign / NoralVoice plugins, this package ships in-tree
and is auto-registered on first boot via
`server/src/services/auto-register-zoho.ts`. The plugin row is harmless
until an operator pastes Zoho credentials.
