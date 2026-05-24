# `@noralos-plugins/noralai-google-sheets`

NoralAI Google Sheets integration for NoralOS.

Wraps the Google Sheets v4 REST API (cells/ranges) and a Drive v3
spreadsheet-discovery helper behind a NoralOS-branded plugin surface.
Lets agents (Brooklyn, directors, managers) read spreadsheet context and
append activity rows mid-conversation.

## What's in v0.1.0

Five agent tools, namespaced `noralai.google-sheets:`:

| Tool                          | Tier     | What it does                                                              |
| ----------------------------- | -------- | ------------------------------------------------------------------------- |
| `gsheets_list_spreadsheets`   | worker   | Discover spreadsheets the credential has access to (via Drive v3).        |
| `gsheets_get_spreadsheet`     | worker   | Read a spreadsheet's tab list, ranges, and basic metadata.                |
| `gsheets_read_range`          | worker   | Read a single A1-notation range from a spreadsheet.                       |
| `gsheets_append_rows`         | manager  | Append rows to a sheet (`values.append`, INSERT_ROWS, USER_ENTERED).      |
| `gsheets_update_range`        | manager  | Overwrite a range with explicit values (`values.update`, USER_ENTERED).   |

## Credentials

OAuth 2.0 authorization-code (refresh token), Google. Configure under
**Settings → Integrations → Google Sheets**:

1. Create an OAuth 2.0 Client ID in Google Cloud Console (type:
   Web application).
2. Set the authorized redirect URI to
   `<noralos-origin>/api/integrations/oauth/google_sheets/callback`.
3. Paste Client ID + Client Secret in NoralOS, click Connect.
4. Approve the consent screen on Google (asks for Sheets read+write
   and Drive read-only).

The encrypted material is a JSON blob `{ clientId, clientSecret,
refreshToken }`. Access tokens are minted on demand by the plugin worker
and cached in-process.

## How the worker resolves credentials

1. `ctx.config.get()` returns `{ secretRef }`.
2. `ctx.secrets.resolve(secretRef)` returns the JSON blob.
3. The client parses `clientId`, `clientSecret`, `refreshToken`.
4. On first call, exchanges `refreshToken` for an access token at
   `https://oauth2.googleapis.com/token`.
5. Access token is cached in-process until ~60 s before expiry.
6. Each API call sends `Authorization: Bearer <access-token>` to
   `https://sheets.googleapis.com/v4/...` (or
   `https://www.googleapis.com/drive/v3/...` for spreadsheet listing).

## Auto-registration

Like the Brooklyn / NoralSign / NoralVoice / Zoho plugins, this package
ships in-tree and is auto-registered on first boot via
`server/src/services/auto-register-google-sheets.ts`. The plugin row is
harmless until an operator pastes Google credentials.
