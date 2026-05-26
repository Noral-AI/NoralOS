/**
 * `noralvoice:upload_kb_document` tool handler.
 *
 * Phase 9C — Tier 1 write tool (manager tier).
 *
 * Three-step upload:
 *   1. POST /api/v1/knowledge-base/upload-url — get a pre-signed S3 URL.
 *   2. PUT <uploadUrl> — stream the raw bytes to S3.
 *   3. POST /api/v1/knowledge-base/process-document — register + chunk.
 *
 * The agent supplies file bytes as a base64-encoded string in `contentBase64`.
 * URL-fetching is explicitly NOT supported — pass raw bytes only.
 */

import {
  NoralVoiceClientError,
  type NoralVoiceClientConfig,
  type UploadKbDocumentResult,
  uploadKbDocument,
} from "../noralvoice-client.js";

export interface UploadKbDocumentParams {
  filename: string;
  contentBase64: string;
  contentType?: string;
}

export interface UploadKbDocumentToolResult {
  content: string;
  data: UploadKbDocumentResult;
}

export async function executeUploadKbDocument(
  config: NoralVoiceClientConfig,
  params: UploadKbDocumentParams,
): Promise<UploadKbDocumentToolResult> {
  if (!params.filename || typeof params.filename !== "string") {
    throw new NoralVoiceClientError("upload_kb_document.filename is required.", "HTTP_4XX", 400);
  }
  if (!params.contentBase64 || typeof params.contentBase64 !== "string") {
    throw new NoralVoiceClientError(
      "upload_kb_document.contentBase64 is required (base64-encoded file bytes). URL-based uploads are not supported.",
      "HTTP_4XX",
      400,
    );
  }
  const result = await uploadKbDocument(config, params);
  return {
    content: `KB document "${params.filename}" uploaded (uuid=${result.document_uuid}, status=${result.status}).`,
    data: result,
  };
}
