"""Batch 4: UI components."""
from pathlib import Path

resolutions = [
    # AgentConfigForm.tsx — fork (multi-environment support)
    ("./ui/src/components/AgentConfigForm.tsx",
     """<<<<<<< v2026.525.0
        environmentId: currentDefaultEnvironmentId || null,
=======
        environmentId:
          typeof selectedEnvironmentId === "string" && selectedEnvironmentId.length > 0
            ? selectedEnvironmentId
            : null,
>>>>>>> master""",
     """        environmentId:
          typeof selectedEnvironmentId === "string" && selectedEnvironmentId.length > 0
            ? selectedEnvironmentId
            : null,"""),

    # IssueBlockedNotice.tsx — upstream (new feature, new types + icons + Link+Button)
    ("./ui/src/components/IssueBlockedNotice.tsx",
     """<<<<<<< v2026.525.0
import type {
  IssueBlockerAttention,
  IssueRecoveryAction,
  IssueRelationIssueSummary,
  IssueScheduledRetry,
  SuccessfulRunHandoffState,
} from "@paperclipai/shared";
import { AlertTriangle, CheckCircle2, Flag, Loader2, RotateCcw } from "lucide-react";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
=======
import type { IssueBlockerAttention, IssueRelationIssueSummary } from "@noralos/shared";
import { AlertTriangle } from "lucide-react";
>>>>>>> master""",
     """import type {
  IssueBlockerAttention,
  IssueRecoveryAction,
  IssueRelationIssueSummary,
  IssueScheduledRetry,
  SuccessfulRunHandoffState,
} from "@noralos/shared";
import { AlertTriangle, CheckCircle2, Flag, Loader2, RotateCcw } from "lucide-react";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";"""),

    # IssueChatThread.tsx — union both icon sets
    ("./ui/src/components/IssueChatThread.tsx",
     """<<<<<<< v2026.525.0
import { AlertTriangle, ArrowRight, Brain, Check, ChevronDown, ClipboardList, Copy, Hammer, Loader2, MoreHorizontal, Paperclip, PauseCircle, Search, Square, ThumbsDown, ThumbsUp } from "lucide-react";
=======
import { AlertTriangle, ArrowRight, Brain, Check, ChevronDown, Copy, Hammer, Loader2, MoreHorizontal, Paperclip, PauseCircle, Search, Square, ThumbsDown, ThumbsUp, Volume2, VolumeX } from "lucide-react";
>>>>>>> master""",
     'import { AlertTriangle, ArrowRight, Brain, Check, ChevronDown, ClipboardList, Copy, Hammer, Loader2, MoreHorizontal, Paperclip, PauseCircle, Search, Square, ThumbsDown, ThumbsUp, Volume2, VolumeX } from "lucide-react";'),

    # Layout.test.tsx — upstream (cleaner mock fixture)
    ("./ui/src/components/Layout.test.tsx",
     """<<<<<<< v2026.525.0
    companies: mockCompanyState.companies,
    loading: false,
    selectedCompany: mockCompanyState.selectedCompany,
    selectedCompanyId: mockCompanyState.selectedCompanyId,
=======
    companies: [{ id: "company-1", issuePrefix: "PAP", name: "NoralOS" }],
    loading: false,
    selectedCompany: { id: "company-1", issuePrefix: "PAP", name: "NoralOS" },
    selectedCompanyId: "company-1",
>>>>>>> master""",
     """    companies: mockCompanyState.companies,
    loading: false,
    selectedCompany: mockCompanyState.selectedCompany,
    selectedCompanyId: mockCompanyState.selectedCompanyId,"""),

    # MarkdownBody.test.tsx — upstream (more comprehensive test) + brand rename
    ("./ui/src/components/MarkdownBody.test.tsx",
     """<<<<<<< v2026.525.0
            {`[@Taylor](${buildUserMentionHref("user-123")}) [@CodexCoder](${buildAgentMentionHref("agent-123", "code")}) [@Paperclip App](${buildProjectMentionHref("project-456", "#336699")}) [/release-changelog](${buildSkillMentionHref("skill-789", "release-changelog")}) [/routine:Weekly review](${buildRoutineMentionHref("routine-123")})`}
=======
            {`[@Taylor](${buildUserMentionHref("user-123")}) [@CodexCoder](${buildAgentMentionHref("agent-123", "code")}) [@NoralOS App](${buildProjectMentionHref("project-456", "#336699")}) [/release-changelog](${buildSkillMentionHref("skill-789", "release-changelog")})`}
>>>>>>> master""",
     '            {`[@Taylor](${buildUserMentionHref("user-123")}) [@CodexCoder](${buildAgentMentionHref("agent-123", "code")}) [@NoralOS App](${buildProjectMentionHref("project-456", "#336699")}) [/release-changelog](${buildSkillMentionHref("skill-789", "release-changelog")}) [/routine:Weekly review](${buildRoutineMentionHref("routine-123")})`}'),

    # CompanyAccess.tsx — fork (adds PermissionKey, drops unused Shield)
    ("./ui/src/pages/CompanyAccess.tsx",
     """<<<<<<< v2026.525.0
} from "@paperclipai/shared";
import { Shield, ShieldCheck, Trash2, Users } from "lucide-react";
=======
  type PermissionKey,
} from "@noralos/shared";
import { ShieldCheck, Trash2, Users } from "lucide-react";
>>>>>>> master""",
     """  type PermissionKey,
} from "@noralos/shared";
import { ShieldCheck, Trash2, Users } from "lucide-react";"""),

    # CompanyEnvironments.tsx — fork (shorter header)
    ("./ui/src/pages/CompanyEnvironments.tsx",
     """<<<<<<< v2026.525.0
                  <th className="px-3 py-2 font-medium">Sandbox via plugin</th>
=======
                  <th className="px-3 py-2 font-medium">Sandbox</th>
>>>>>>> master""",
     '                  <th className="px-3 py-2 font-medium">Sandbox</th>'),

    # IssueDetail.test.tsx — fork (drops unused AnchorHTMLAttributes import)
    ("./ui/src/pages/IssueDetail.test.tsx",
     """<<<<<<< v2026.525.0
import type { Agent, Issue, IssueTreeControlPreview, IssueTreeHold } from "@paperclipai/shared";
import { act, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from "react";
=======
import type { Agent, Issue, IssueTreeControlPreview, IssueTreeHold } from "@noralos/shared";
import { act, type ButtonHTMLAttributes, type ReactNode } from "react";
>>>>>>> master""",
     """import type { Agent, Issue, IssueTreeControlPreview, IssueTreeHold } from "@noralos/shared";
import { act, type ButtonHTMLAttributes, type ReactNode } from "react";"""),

    # api/issues.ts — upstream (adds excludeRoot)
    ("./ui/src/api/issues.ts",
     """<<<<<<< v2026.525.0
  getCostSummary: (id: string, options: { excludeRoot?: boolean } = {}) => {
    const qs = options.excludeRoot ? "?excludeRoot=true" : "";
    return api.get<IssueCostSummary>(`/issues/${id}/cost-summary${qs}`);
  },
=======
  getCostSummary: (id: string) => api.get<IssueCostSummary>(`/issues/${id}/cost-summary`),
>>>>>>> master""",
     """  getCostSummary: (id: string, options: { excludeRoot?: boolean } = {}) => {
    const qs = options.excludeRoot ? "?excludeRoot=true" : "";
    return api.get<IssueCostSummary>(`/issues/${id}/cost-summary${qs}`);
  },"""),

    # api/secrets.ts — upstream (adds many types) + brand rename
    ("./ui/src/api/secrets.ts",
     """<<<<<<< v2026.525.0
import type {
  CompanySecret,
  CompanySecretUsageBinding,
  CompanySecretProviderConfig,
  SecretProviderConfigDiscoveryPreviewResult,
  RemoteSecretImportPreviewResult,
  RemoteSecretImportResult,
  SecretAccessEvent,
  SecretManagedMode,
  SecretProvider,
  SecretProviderConfigStatus,
  SecretProviderConfigHealthResponse,
  SecretProviderDescriptor,
  SecretStatus,
} from "@paperclipai/shared";
=======
import type { CompanySecret, SecretProviderDescriptor, SecretProvider } from "@noralos/shared";
>>>>>>> master""",
     """import type {
  CompanySecret,
  CompanySecretUsageBinding,
  CompanySecretProviderConfig,
  SecretProviderConfigDiscoveryPreviewResult,
  RemoteSecretImportPreviewResult,
  RemoteSecretImportResult,
  SecretAccessEvent,
  SecretManagedMode,
  SecretProvider,
  SecretProviderConfigStatus,
  SecretProviderConfigHealthResponse,
  SecretProviderDescriptor,
  SecretStatus,
} from "@noralos/shared";"""),

    # RoutineDetail.tsx — upstream + brand rename
    ("./ui/src/pages/RoutineDetail.tsx",
     """<<<<<<< v2026.525.0
import type {
  EnvBinding,
  RoutineDetail as RoutineDetailType,
  RoutineEnvConfig,
  RoutineTrigger,
  RoutineVariable,
} from "@paperclipai/shared";
=======
import type { RoutineTrigger, RoutineVariable } from "@noralos/shared";
>>>>>>> master""",
     """import type {
  EnvBinding,
  RoutineDetail as RoutineDetailType,
  RoutineEnvConfig,
  RoutineTrigger,
  RoutineVariable,
} from "@noralos/shared";"""),

    # Routines.tsx — fork (adds MoreHorizontal)
    ("./ui/src/pages/Routines.tsx",
     """<<<<<<< v2026.525.0
import { ArrowUpDown, Check, ChevronDown, ChevronRight, Layers, Plus, Repeat } from "lucide-react";
=======
import { ArrowUpDown, Check, ChevronDown, ChevronRight, Layers, MoreHorizontal, Plus, Repeat } from "lucide-react";
>>>>>>> master""",
     'import { ArrowUpDown, Check, ChevronDown, ChevronRight, Layers, MoreHorizontal, Plus, Repeat } from "lucide-react";'),
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

print()
print(f"=== Applied {applied}/{len(resolutions)} ===")
if failed:
    print("FAILURES:")
    for path, reason in failed:
        print(f"  ✗ {path}: {reason}")
