import type { PluginSidebarProps } from "@noralos/plugin-sdk/ui";

const CONFERENCE_ROOM_URL = "https://platform.noral.ai/conference";

const linkClassName = [
  "flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium transition-colors",
  "text-foreground/80 hover:bg-accent/50 hover:text-foreground",
  "no-underline",
].join(" ");

export function ConferenceRoomSidebarLink(_props: PluginSidebarProps) {
  return (
    <a
      href={CONFERENCE_ROOM_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={linkClassName}
      aria-label="Open the Conference Room in a new tab"
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
