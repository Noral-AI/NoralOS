import type { PluginSidebarProps } from "@noralos/plugin-sdk/ui";

const linkClassName = [
  "flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium transition-colors",
  "text-foreground/80 hover:bg-accent/50 hover:text-foreground",
  "no-underline cursor-pointer",
].join(" ");

export function ConferenceRoomSidebarLink({ context }: PluginSidebarProps) {
  // Internal navigation. The Conference Room page is rendered as a plugin
  // `page` slot with routePath "conference-room", so the host route
  // `<Route path=":pluginRoutePath">` resolves it to <ConferenceRoomPage>.
  // We use a plain anchor + history.pushState so the plugin bundle doesn't
  // need to depend on react-router from the host. The host listens for
  // `popstate`/`pushState` and re-renders.
  const href = context.companyPrefix
    ? `/${context.companyPrefix}/conference-room`
    : "/conference-room";

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
      aria-label="Open Conference Room"
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
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" x2="12" y1="19" y2="22" />
        </svg>
      </span>
      <span className="flex-1 truncate">Conference Room</span>
    </a>
  );
}
