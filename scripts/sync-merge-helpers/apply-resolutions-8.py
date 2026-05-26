"""Batch 8: UI nav UNION cases."""
from pathlib import Path

resolutions = [
    # CompanySettingsSidebar imports — UNION
    ("./ui/src/components/CompanySettingsSidebar.tsx",
     """<<<<<<< v2026.525.0
import { ChevronLeft, CloudUpload, KeyRound, MailPlus, MonitorCog, Puzzle, Settings, SlidersHorizontal, Users } from "lucide-react";
=======
import { ChevronLeft, MailPlus, MonitorCog, Plug, Settings, Shield, SlidersHorizontal } from "lucide-react";
>>>>>>> master""",
     'import { ChevronLeft, CloudUpload, KeyRound, MailPlus, MonitorCog, Plug, Puzzle, Settings, Shield, SlidersHorizontal, Users } from "lucide-react";'),

    # CompanySettingsSidebar nav items — UNION
    ("./ui/src/components/CompanySettingsSidebar.tsx",
     """<<<<<<< v2026.525.0
          {showCloudUpstream ? (
            <SidebarNavItem
              to="/company/settings/cloud-upstream"
              label="Cloud upstream"
              icon={CloudUpload}
              end
            />
          ) : null}
          <SidebarNavItem
            to="/company/settings/members"
            label="Members"
            icon={Users}
=======
          <SidebarNavItem
            to="/company/settings/integrations"
            label="Integrations"
            icon={Plug}
            end
          />
          <SidebarNavItem
            to="/company/settings/access"
            label="Access"
            icon={Shield}
>>>>>>> master""",
     """          {showCloudUpstream ? (
            <SidebarNavItem
              to="/company/settings/cloud-upstream"
              label="Cloud upstream"
              icon={CloudUpload}
              end
            />
          ) : null}
          <SidebarNavItem
            to="/company/settings/integrations"
            label="Integrations"
            icon={Plug}
            end
          />
          <SidebarNavItem
            to="/company/settings/members"
            label="Members"
            icon={Users}"""),

    # CompanySettingsNav values — UNION
    ("./ui/src/components/access/CompanySettingsNav.tsx",
     """<<<<<<< v2026.525.0
  { value: "cloud-upstream", label: "Cloud upstream", href: "/company/settings/cloud-upstream" },
  { value: "members", label: "Members", href: "/company/settings/members" },
=======
  { value: "access", label: "Access", href: "/company/settings/access" },
>>>>>>> master""",
     """  { value: "cloud-upstream", label: "Cloud upstream", href: "/company/settings/cloud-upstream" },
  { value: "members", label: "Members", href: "/company/settings/members" },
  { value: "access", label: "Access", href: "/company/settings/access" },"""),

    # CompanySettingsNav fallback logic — upstream wins (more comprehensive)
    ("./ui/src/components/access/CompanySettingsNav.tsx",
     """<<<<<<< v2026.525.0
  if (pathname.includes("/company/settings/cloud-upstream")) {
    return "cloud-upstream";
  }

  if (pathname.includes("/company/settings/members") || pathname.includes("/company/settings/access")) {
    return "members";
=======
  if (pathname.includes("/company/settings/access")) {
    return "access";
>>>>>>> master""",
     """  if (pathname.includes("/company/settings/cloud-upstream")) {
    return "cloud-upstream";
  }

  if (pathname.includes("/company/settings/members") || pathname.includes("/company/settings/access")) {
    return "members";"""),

    # ExecutionWorkspaceDetail imports — UNION
    ("./ui/src/pages/ExecutionWorkspaceDetail.tsx",
     """<<<<<<< v2026.525.0
import type { ExecutionWorkspace, Issue, Project, ProjectWorkspace, RoutineListItem } from "@paperclipai/shared";
import { Copy, ExternalLink, Loader2, Play, Repeat } from "lucide-react";
=======
import type { ExecutionWorkspace, Issue, Project, ProjectWorkspace } from "@noralos/shared";
import { ArrowLeft, Copy, ExternalLink, Loader2 } from "lucide-react";
>>>>>>> master""",
     """import type { ExecutionWorkspace, Issue, Project, ProjectWorkspace, RoutineListItem } from "@noralos/shared";
import { ArrowLeft, Copy, ExternalLink, Loader2, Play, Repeat } from "lucide-react";"""),
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
