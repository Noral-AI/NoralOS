"""Batch 6: issue-execution-policy, ProjectWorkspaceDetail, SidebarAgents, and SidebarAgents takes fork wholesale."""
from pathlib import Path

resolutions = [
    # ProjectWorkspaceDetail.tsx — fork (better UI)
    ("./ui/src/pages/ProjectWorkspaceDetail.tsx",
     """<<<<<<< v2026.525.0
            <p className="max-w-2xl text-sm text-muted-foreground">
              Configure the concrete workspace Paperclip attaches to this project. These values drive per-workspace
              checkout behavior, default runtime services for child execution workspaces, and let you override setup
              or cleanup commands when one workspace needs special handling.
            </p>
=======
            <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Project workspace
                </div>
                <h1 className="text-2xl font-semibold">{workspace.name}</h1>
                <p className="max-w-2xl text-sm text-muted-foreground">
                  Configure the concrete workspace NoralOS attaches to this project. These values drive per-workspace
                  checkout behavior, default runtime services for child execution workspaces, and let you override setup
                  or cleanup commands when one workspace needs special handling.
                </p>
              </div>
              {!workspace.isPrimary ? (
                <Button
                  variant="outline"
                  className="w-full sm:w-auto"
                  disabled={setPrimaryWorkspace.isPending}
                  onClick={() => setPrimaryWorkspace.mutate()}
                >
                  {setPrimaryWorkspace.isPending
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    : <Check className="mr-2 h-4 w-4" />}
                  Make primary
                </Button>
              ) : (
                <div className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300 sm:max-w-sm">
                  <Sparkles className="h-4 w-4" />
                  This is the project’s primary codebase workspace.
                </div>
              )}
            </div>
>>>>>>> master""",
     """            <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Project workspace
                </div>
                <h1 className="text-2xl font-semibold">{workspace.name}</h1>
                <p className="max-w-2xl text-sm text-muted-foreground">
                  Configure the concrete workspace NoralOS attaches to this project. These values drive per-workspace
                  checkout behavior, default runtime services for child execution workspaces, and let you override setup
                  or cleanup commands when one workspace needs special handling.
                </p>
              </div>
              {!workspace.isPrimary ? (
                <Button
                  variant="outline"
                  className="w-full sm:w-auto"
                  disabled={setPrimaryWorkspace.isPending}
                  onClick={() => setPrimaryWorkspace.mutate()}
                >
                  {setPrimaryWorkspace.isPending
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    : <Check className="mr-2 h-4 w-4" />}
                  Make primary
                </Button>
              ) : (
                <div className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300 sm:max-w-sm">
                  <Sparkles className="h-4 w-4" />
                  This is the project’s primary codebase workspace.
                </div>
              )}
            </div>"""),

    # issue-execution-policy.ts
    ("./server/src/services/issue-execution-policy.ts",
     """<<<<<<< v2026.525.0
import type {
  IssueExecutionDecision,
  IssueExecutionMonitorClearReason,
  IssueExecutionMonitorPolicy,
  IssueExecutionMonitorState,
  IssueExecutionPolicy,
  IssueExecutionStage,
  IssueExecutionStagePrincipal,
  IssueExecutionState,
  IssueMonitorScheduledBy,
} from "@paperclipai/shared";
import { issueExecutionPolicySchema, issueExecutionStateSchema } from "@paperclipai/shared";
=======
import type { IssueExecutionDecision, IssueExecutionPolicy, IssueExecutionStage, IssueExecutionStagePrincipal, IssueExecutionState } from "@noralos/shared";
import { issueExecutionPolicySchema, issueExecutionStateSchema } from "@noralos/shared";
>>>>>>> master""",
     """import type {
  IssueExecutionDecision,
  IssueExecutionMonitorClearReason,
  IssueExecutionMonitorPolicy,
  IssueExecutionMonitorState,
  IssueExecutionPolicy,
  IssueExecutionStage,
  IssueExecutionStagePrincipal,
  IssueExecutionState,
  IssueMonitorScheduledBy,
} from "@noralos/shared";
import { issueExecutionPolicySchema, issueExecutionStateSchema } from "@noralos/shared";"""),
]

applied = 0
failed = []
for path, old, new in resolutions:
    p = Path(path)
    try:
        content = p.read_text(encoding='utf-8')
    except Exception as e:
        failed.append((path, f"read error: {e}"))
        continue
    if old not in content:
        failed.append((path, "old text not found"))
        continue
    new_content = content.replace(old, new, 1)
    p.write_text(new_content, encoding='utf-8')
    applied += 1
    print(f"  ✓ {path}")

print(f"\n=== Applied {applied}/{len(resolutions)} ===")
if failed:
    for path, reason in failed:
        print(f"  ✗ {path}: {reason}")
