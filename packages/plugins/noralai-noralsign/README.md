# @noralos-plugins/noralai-noralsign

NoralSign — document e-signing for NoralOS, backed by a self-hosted DocuSeal engine.

This plugin wraps the bundled DocuSeal service (see `docker/docker-compose.yml`,
service `docuseal`) behind a NoralOS-branded plugin surface. Agents call its
tools to look up templates, send envelopes for signature, and track status;
humans see a native NoralOS UI under **Documents → NoralSign**.

## Phase 1 scope (this PR)

- Plugin scaffold (manifest, worker, REST client, tests)
- One agent tool: `list_templates` — returns the company's NoralSign templates
- Bundled DocuSeal Docker service, internal-only (no host port mapped)

## Coming in later phases

- `create_submission_from_template`, `get_submission_status`,
  `download_signed_document`, `create_template_from_pdf`
- Webhook receiver for signer-lifecycle events (viewed, completed, declined)
- Dashboard UI: templates list, submissions inbox, signed-doc archive
- Sales-contract routing flow: Slack request → agent → approval → signature

## Operator config

| Key            | Required | Description |
| -------------- | -------- | ----------- |
| `apiUrl`       | Yes      | Base URL of the DocuSeal instance. Default: the bundled `http://docuseal:3000`. |
| `apiTokenRef`  | Yes      | Encrypted-secret reference to the DocuSeal API token (mint in DocuSeal admin → API). |

## Branding & licensing

The signer-facing pages and emails come from DocuSeal. Under the OSS license
DocuSeal requires a "Powered by DocuSeal" attribution on those surfaces; a
**DocuSeal Pro / commercial license** removes it. Set `DOCUSEAL_LICENSE_KEY`
in the deployment `.env` to activate full NoralSign white-label.

## Plugin id (stable, do not change)

`noralai.noralsign`

Tools registered: `noralai.noralsign:list_templates`
