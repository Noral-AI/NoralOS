/**
 * Sidebar link that opens the NoralSign templates page.
 *
 * Visually mirrors the existing SidebarNavItem style — same padding,
 * hover treatment, and 16px stroke icon — so the entry doesn't look
 * like a foreign element.
 */

import type { PluginSidebarProps } from "@noralos/plugin-sdk/ui";

const linkClassName = [
  "flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium transition-colors",
  "text-foreground/80 hover:bg-accent/50 hover:text-foreground",
  "no-underline cursor-pointer",
].join(" ");

export function NoralSignSidebarLink({ context }: PluginSidebarProps) {
  // Internal navigation: the NoralSign templates page is mounted as a
  // company-scoped plugin page slot with routePath "noralsign", so the
  // host resolves /<company>/noralsign to the page component.
  const href = context.companyPrefix
    ? `/${context.companyPrefix}/noralsign`
    : "/noralsign";

  return (
    <a
      href={href}
      className={linkClassName}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        window.history.pushState({}, "", href);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }}
      aria-label="Open NoralSign"
    >
      <span className="relative shrink-0">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <path d="M9 17l2 2 4-4" />
        </svg>
      </span>
      <span className="flex-1 truncate">NoralSign</span>
    </a>
  );
}
