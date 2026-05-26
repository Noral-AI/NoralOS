// Browser-safe type-only file extracted from ssh.ts so the public adapter-utils
// barrel can re-export `SshRemoteExecutionSpec` without dragging in Node-only
// runtime modules (workspace-restore-merge → node:crypto, etc.).
//
// `ssh.ts` itself imports these same types so there is exactly one source of
// truth for the SSH config shape.

export interface SshConnectionConfig {
  host: string;
  port: number;
  username: string;
  remoteWorkspacePath: string;
  privateKey: string | null;
  knownHosts: string | null;
  strictHostKeyChecking: boolean;
}

export interface SshCommandResult {
  stdout: string;
  stderr: string;
}

export interface SshRemoteExecutionSpec extends SshConnectionConfig {
  remoteCwd: string;
  noralosApiUrl?: string | null;
}
