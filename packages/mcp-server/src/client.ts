import type { NoralosMcpConfig } from "./config.js";

export class NoralosApiError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly body: unknown;

  constructor(input: {
    status: number;
    method: string;
    path: string;
    body: unknown;
    message: string;
  }) {
    super(input.message);
    this.name = "NoralosApiError";
    this.status = input.status;
    this.method = input.method;
    this.path = input.path;
    this.body = input.body;
  }
}

export interface JsonRequestOptions {
  body?: unknown;
  includeRunId?: boolean;
  /** Abort the request after this many milliseconds (best-effort). */
  timeoutMs?: number;
}

function isWriteMethod(method: string): boolean {
  return !["GET", "HEAD"].includes(method.toUpperCase());
}

function buildErrorMessage(method: string, path: string, status: number, body: unknown): string {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return `${method} ${path} failed with ${status}: ${body.error}`;
  }
  return `${method} ${path} failed with ${status}`;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export class NoralosApiClient {
  constructor(private readonly config: NoralosMcpConfig) {}

  get defaults() {
    return {
      companyId: this.config.companyId,
      agentId: this.config.agentId,
      runId: this.config.runId,
    };
  }

  resolveCompanyId(companyId?: string | null): string {
    const resolved = companyId?.trim() || this.config.companyId;
    if (!resolved) {
      throw new Error("companyId is required because NORALOS_COMPANY_ID is not set");
    }
    return resolved;
  }

  resolveAgentId(agentId?: string | null): string {
    const resolved = agentId?.trim() || this.config.agentId;
    if (!resolved) {
      throw new Error("agentId is required because NORALOS_AGENT_ID is not set");
    }
    return resolved;
  }

  async requestJson<T>(method: string, path: string, options: JsonRequestOptions = {}): Promise<T> {
    if (!path.startsWith("/")) {
      throw new Error(`API path must start with "/": ${path}`);
    }

    const url = new URL(path.slice(1), `${this.config.apiUrl}/`);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
      Accept: "application/json",
    };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if ((options.includeRunId ?? isWriteMethod(method)) && this.config.runId) {
      headers["X-NoralOS-Run-Id"] = this.config.runId;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal:
        typeof options.timeoutMs === "number" && options.timeoutMs > 0
          ? AbortSignal.timeout(options.timeoutMs)
          : undefined,
    });
    const parsedBody = await parseResponseBody(response);

    if (!response.ok) {
      throw new NoralosApiError({
        status: response.status,
        method: method.toUpperCase(),
        path,
        body: parsedBody,
        message: buildErrorMessage(method.toUpperCase(), path, response.status, parsedBody),
      });
    }

    return parsedBody as T;
  }

  /**
   * List the host plugin tools available to this agent
   * (`GET /api/plugins/tools` → `AgentToolDescriptor[]`). Returns an empty
   * array if the host responds with a non-array body.
   */
  async listPluginTools(): Promise<Array<Record<string, unknown>>> {
    // Bounded: this gates MCP-server startup, so a slow/unreachable host must
    // not wedge the agent run — on timeout we register zero plugin tools.
    const body = await this.requestJson<unknown>("GET", "/plugins/tools", { timeoutMs: 8000 });
    return Array.isArray(body) ? (body as Array<Record<string, unknown>>) : [];
  }

  /**
   * Execute a host plugin tool by its fully namespaced name
   * (`POST /api/plugins/tools/execute`). `projectId` is omitted from the run
   * context — the route resolves it server-side from `runId`.
   */
  async executePluginTool(
    tool: string,
    parameters: Record<string, unknown>,
    runContext: { agentId: string; runId: string; companyId: string },
  ): Promise<unknown> {
    return this.requestJson<unknown>("POST", "/plugins/tools/execute", {
      body: { tool, parameters, runContext },
      includeRunId: true,
    });
  }
}
