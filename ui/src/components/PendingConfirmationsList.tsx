import type { PendingConfirmationListItem } from "@noralos/shared";
import { Link } from "@/lib/router";
import { ChevronRight, MessageCircleQuestion } from "lucide-react";
import { createIssueDetailPath } from "../lib/issueDetailBreadcrumb";

interface PendingConfirmationsListProps {
  confirmations: PendingConfirmationListItem[];
}

export function PendingConfirmationsList({ confirmations }: PendingConfirmationsListProps) {
  if (confirmations.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Agent confirmations
      </h3>
      <div className="grid gap-2">
        {confirmations.map(({ interaction, issue }) => {
          const pathId = issue.identifier ?? issue.id;
          const issueLabel = issue.identifier ?? issue.id.slice(0, 8);
          return (
            <Link
              key={interaction.id}
              to={createIssueDetailPath(pathId)}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-foreground/30"
            >
              <div className="flex items-start gap-3 min-w-0">
                <MessageCircleQuestion className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {interaction.title ?? "Confirmation requested"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {issueLabel} · {issue.title}
                  </p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
