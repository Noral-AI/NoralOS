import { useMemo, useState } from "react";
import { Link, NavLink, useLocation } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  MoreHorizontal,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plus,
  Trash2,
  Users,
  Building2,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useSidebar } from "../context/SidebarContext";
import { useToastActions } from "../context/ToastContext";
import { agentsApi } from "../api/agents";
import { departmentsApi } from "../api/departments";
import { authApi } from "../api/auth";
import { heartbeatsApi } from "../api/heartbeats";
import { SIDEBAR_SCROLL_RESET_STATE } from "../lib/navigation-scroll";
import { queryKeys } from "../lib/queryKeys";
import { cn, agentRouteRef, agentUrl } from "../lib/utils";
import { useAgentOrder } from "../hooks/useAgentOrder";
import { AgentIcon } from "./AgentIconPicker";
import { BudgetSidebarMarker } from "./BudgetSidebarMarker";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Agent, Department } from "@noralos/shared";

const UNASSIGNED_KEY = "__unassigned__";

function SidebarAgentItem({
  activeAgentId,
  activeTab,
  agent,
  disabled,
  isMobile,
  onPauseResume,
  runCount,
  setSidebarOpen,
}: {
  activeAgentId: string | null;
  activeTab: string | null;
  agent: Agent;
  disabled: boolean;
  isMobile: boolean;
  onPauseResume: (agent: Agent, action: "pause" | "resume") => void;
  runCount: number;
  setSidebarOpen: (open: boolean) => void;
}) {
  const routeRef = agentRouteRef(agent);
  const href = activeTab ? `${agentUrl(agent)}/${activeTab}` : agentUrl(agent);
  const editHref = `${agentUrl(agent)}/configuration`;
  const isActive = activeAgentId === routeRef;
  const isPaused = agent.status === "paused";
  const isBudgetPaused = isPaused && agent.pauseReason === "budget";
  const pauseResumeLabel = isPaused ? "Resume agent" : "Pause agent";
  const pauseResumeDisabled = disabled || agent.status === "pending_approval" || isBudgetPaused;
  const pauseResumeDisabledLabel = disabled
    ? "Updating..."
    : isBudgetPaused
      ? "Budget paused"
      : pauseResumeLabel;

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `agent:${agent.id}`,
    data: { type: "agent", agent },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group/agent relative flex items-center",
        isDragging && "opacity-40",
      )}
    >
      <button
        type="button"
        aria-label="Drag to reassign"
        className={cn(
          "absolute left-0 top-1/2 -translate-y-1/2 px-1 cursor-grab text-muted-foreground/40 hover:text-muted-foreground transition-opacity",
          isMobile
            ? "opacity-0 pointer-events-none"
            : "opacity-0 group-hover/agent:opacity-100",
        )}
        {...attributes}
        {...listeners}
      >
        <span className="text-xs leading-none select-none" aria-hidden>⋮⋮</span>
      </button>
      <NavLink
        to={href}
        state={SIDEBAR_SCROLL_RESET_STATE}
        onClick={() => {
          if (isMobile) setSidebarOpen(false);
        }}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2.5 px-3 py-1.5 pr-8 text-[13px] font-medium transition-colors",
          isActive
            ? "bg-accent text-foreground"
            : "text-foreground/80 hover:bg-accent/50 hover:text-foreground"
        )}
      >
        <AgentIcon icon={agent.icon} className="shrink-0 h-3.5 w-3.5 text-muted-foreground" />
        <span className="flex-1 truncate">{agent.name}</span>
        {(agent.pauseReason === "budget" || runCount > 0) && (
          <span className="ml-auto flex items-center gap-1.5 shrink-0">
            {agent.pauseReason === "budget" ? (
              <BudgetSidebarMarker title="Agent paused by budget" />
            ) : null}
            {runCount > 0 ? (
              <span className="relative flex h-2 w-2">
                <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
              </span>
            ) : null}
            {runCount > 0 ? (
              <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400">
                {runCount} live
              </span>
            ) : null}
          </span>
        )}
      </NavLink>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn(
              "absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 transition-opacity data-[state=open]:pointer-events-auto data-[state=open]:opacity-100",
              isMobile
                ? "opacity-100"
                : "pointer-events-none opacity-0 group-hover/agent:pointer-events-auto group-hover/agent:opacity-100 group-focus-within/agent:pointer-events-auto group-focus-within/agent:opacity-100",
            )}
            aria-label={`Open actions for ${agent.name}`}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem asChild>
            <Link
              to={editHref}
              onClick={() => {
                if (isMobile) setSidebarOpen(false);
              }}
            >
              <Pencil className="size-4" />
              <span>Edit agent</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              if (pauseResumeDisabled) return;
              onPauseResume(agent, isPaused ? "resume" : "pause");
            }}
            disabled={pauseResumeDisabled}
            title={isBudgetPaused ? "Agent was paused by budget limits" : undefined}
          >
            {isPaused ? <PlayCircle className="size-4" /> : <PauseCircle className="size-4" />}
            <span>{pauseResumeDisabledLabel}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function DepartmentSection({
  department,
  agents,
  activeAgentId,
  activeTab,
  pendingAgentIds,
  isMobile,
  setSidebarOpen,
  onPauseResume,
  liveCountByAgent,
  onEdit,
  onDelete,
}: {
  department: Department | null; // null = Unassigned
  agents: Agent[];
  activeAgentId: string | null;
  activeTab: string | null;
  pendingAgentIds: Set<string>;
  isMobile: boolean;
  setSidebarOpen: (open: boolean) => void;
  onPauseResume: (agent: Agent, action: "pause" | "resume") => void;
  liveCountByAgent: Map<string, number>;
  onEdit?: (department: Department) => void;
  onDelete?: (department: Department) => void;
}) {
  const [open, setOpen] = useState(true);
  const droppableId = `department:${department?.id ?? UNASSIGNED_KEY}`;
  const { isOver, setNodeRef } = useDroppable({
    id: droppableId,
    data: { type: "department", departmentId: department?.id ?? null },
  });

  const label = department ? department.name : "Unassigned";
  const Icon = department ? Building2 : Users;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        ref={setNodeRef}
        className={cn(
          "group/dept rounded-sm transition-colors",
          isOver && "bg-accent/40 ring-1 ring-accent",
        )}
      >
        <div className="flex items-center px-3 py-1 gap-1">
          <CollapsibleTrigger className="flex items-center gap-1.5 flex-1 min-w-0 text-left">
            <ChevronRight
              className={cn(
                "h-3 w-3 text-muted-foreground/60 transition-transform shrink-0",
                open && "rotate-90",
              )}
            />
            <Icon className="h-3 w-3 shrink-0 text-muted-foreground/60" />
            <span className="truncate text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
              {label}
            </span>
            <span className="text-[10px] text-muted-foreground/50 shrink-0">
              {agents.length}
            </span>
          </CollapsibleTrigger>
          {department && (onEdit || onDelete) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="opacity-0 group-hover/dept:opacity-100 text-muted-foreground/60 hover:text-foreground p-0.5 rounded transition-all"
                  aria-label={`Open actions for ${label}`}
                >
                  <MoreHorizontal className="h-3 w-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                {onEdit && (
                  <DropdownMenuItem onClick={() => onEdit(department)}>
                    <Pencil className="size-4" />
                    <span>Rename / edit</span>
                  </DropdownMenuItem>
                )}
                {onDelete && (
                  <DropdownMenuItem
                    onClick={() => onDelete(department)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="size-4" />
                    <span>Delete</span>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <CollapsibleContent>
          <div className="flex flex-col gap-0.5 mt-0.5 min-h-[8px]">
            {agents.length === 0 && (
              <div className="px-3 py-2 text-[11px] italic text-muted-foreground/50">
                Drop an agent here
              </div>
            )}
            {agents.map((agent) => {
              const runCount = liveCountByAgent.get(agent.id) ?? 0;
              return (
                <SidebarAgentItem
                  key={agent.id}
                  activeAgentId={activeAgentId}
                  activeTab={activeTab}
                  agent={agent}
                  disabled={pendingAgentIds.has(agent.id)}
                  isMobile={isMobile}
                  onPauseResume={onPauseResume}
                  runCount={runCount}
                  setSidebarOpen={setSidebarOpen}
                />
              );
            })}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function SidebarAgents() {
  const [open, setOpen] = useState(true);
  const [pendingAgentIds, setPendingAgentIds] = useState<Set<string>>(() => new Set());
  const queryClient = useQueryClient();
  const { selectedCompanyId } = useCompany();
  const { openNewAgent, openNewDepartment } = useDialog();
  const { isMobile, setSidebarOpen } = useSidebar();
  const { pushToast } = useToastActions();
  const location = useLocation();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const { data: departments } = useQuery({
    queryKey: queryKeys.departments.list(selectedCompanyId!),
    queryFn: () => departmentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });

  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.liveRuns(selectedCompanyId!),
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 10_000,
  });

  const liveCountByAgent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const run of liveRuns ?? []) {
      counts.set(run.agentId, (counts.get(run.agentId) ?? 0) + 1);
    }
    return counts;
  }, [liveRuns]);

  const visibleAgents = useMemo(() => {
    return (agents ?? []).filter((a: Agent) => a.status !== "terminated");
  }, [agents]);
  const currentUserId = session?.user?.id ?? session?.session?.userId ?? null;
  const { orderedAgents } = useAgentOrder({
    agents: visibleAgents,
    companyId: selectedCompanyId,
    userId: currentUserId,
  });

  const groupedAgents = useMemo(() => {
    const byDepartment = new Map<string, Agent[]>();
    for (const dept of departments ?? []) byDepartment.set(dept.id, []);
    const unassigned: Agent[] = [];
    for (const agent of orderedAgents) {
      const deptId = agent.departmentId ?? null;
      if (deptId && byDepartment.has(deptId)) {
        byDepartment.get(deptId)!.push(agent);
      } else {
        unassigned.push(agent);
      }
    }
    return { byDepartment, unassigned };
  }, [departments, orderedAgents]);

  const agentMatch = location.pathname.match(/^\/(?:[^/]+\/)?agents\/([^/]+)(?:\/([^/]+))?/);
  const activeAgentId = agentMatch?.[1] ?? null;
  const activeTab = agentMatch?.[2] ?? null;

  const pauseResumeAgent = useMutation({
    mutationFn: ({ agent, action }: { agent: Agent; action: "pause" | "resume" }) =>
      action === "pause"
        ? agentsApi.pause(agent.id, selectedCompanyId ?? undefined)
        : agentsApi.resume(agent.id, selectedCompanyId ?? undefined),
    onMutate: ({ agent }) => {
      setPendingAgentIds((current) => {
        const next = new Set(current);
        next.add(agent.id);
        return next;
      });
    },
    onSuccess: async (_agent, { agent, action }) => {
      if (selectedCompanyId) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.liveRuns(selectedCompanyId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(selectedCompanyId) }),
        ]);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agent.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agentRouteRef(agent)) }),
      ]);
      pushToast({
        title: action === "pause" ? "Agent paused" : "Agent resumed",
        body: agent.name,
        tone: "success",
      });
    },
    onError: (error, { agent, action }) => {
      pushToast({
        title: action === "pause" ? "Could not pause agent" : "Could not resume agent",
        body: error instanceof Error ? error.message : agent.name,
        tone: "error",
      });
    },
    onSettled: (_data, _error, { agent }) => {
      setPendingAgentIds((current) => {
        const next = new Set(current);
        next.delete(agent.id);
        return next;
      });
    },
  });

  const reassignAgent = useMutation({
    mutationFn: ({ agent, departmentId }: { agent: Agent; departmentId: string | null }) =>
      agentsApi.update(
        agent.id,
        { departmentId },
        selectedCompanyId ?? undefined,
      ),
    onSuccess: async (_data, { agent, departmentId }) => {
      if (selectedCompanyId) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.agents.list(selectedCompanyId),
        });
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agent.id) });
      const target =
        departmentId === null
          ? "Unassigned"
          : (departments ?? []).find((d) => d.id === departmentId)?.name ?? "department";
      pushToast({
        title: "Agent moved",
        body: `${agent.name} → ${target}`,
        tone: "success",
      });
    },
    onError: (error, { agent }) => {
      pushToast({
        title: "Could not move agent",
        body: error instanceof Error ? error.message : agent.name,
        tone: "error",
      });
    },
  });

  const deleteDepartment = useMutation({
    mutationFn: (department: Department) =>
      departmentsApi.remove(selectedCompanyId!, department.id),
    onSuccess: async (data, department) => {
      if (selectedCompanyId) {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: queryKeys.departments.list(selectedCompanyId),
          }),
          queryClient.invalidateQueries({
            queryKey: queryKeys.agents.list(selectedCompanyId),
          }),
        ]);
      }
      const moved = data?.agentsUnassigned ?? 0;
      pushToast({
        title: `${department.name} deleted`,
        body:
          moved > 0
            ? `${moved} agent${moved === 1 ? "" : "s"} moved to Unassigned`
            : "No agents to move",
        tone: "success",
      });
    },
    onError: (error, department) => {
      pushToast({
        title: "Could not delete department",
        body: error instanceof Error ? error.message : department.name,
        tone: "error",
      });
    },
  });

  function handleDragEnd(event: DragEndEvent) {
    const activeData = event.active.data.current as
      | { type?: string; agent?: Agent }
      | undefined;
    const overData = event.over?.data.current as
      | { type?: string; departmentId?: string | null }
      | undefined;
    if (
      !activeData ||
      activeData.type !== "agent" ||
      !activeData.agent ||
      !overData ||
      overData.type !== "department"
    ) {
      return;
    }
    const agent = activeData.agent;
    const targetDeptId = overData.departmentId ?? null;
    const currentDeptId = agent.departmentId ?? null;
    if (currentDeptId === targetDeptId) return;
    reassignAgent.mutate({ agent, departmentId: targetDeptId });
  }

  function handleDeleteDepartment(department: Department) {
    const inDept = groupedAgents.byDepartment.get(department.id) ?? [];
    const message =
      inDept.length > 0
        ? `Delete "${department.name}"? ${inDept.length} agent${inDept.length === 1 ? " will be moved" : "s will be moved"} to Unassigned.`
        : `Delete "${department.name}"?`;
    if (typeof window !== "undefined" && !window.confirm(message)) return;
    deleteDepartment.mutate(department);
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="group">
        <div className="flex items-center px-3 py-1.5">
          <CollapsibleTrigger className="flex items-center gap-1 flex-1 min-w-0">
            <ChevronRight
              className={cn(
                "h-3 w-3 text-muted-foreground/60 transition-transform opacity-0 group-hover:opacity-100",
                open && "rotate-90"
              )}
            />
            <span className="text-[10px] font-medium uppercase tracking-widest font-mono text-muted-foreground/60">
              Agents
            </span>
          </CollapsibleTrigger>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                className="flex items-center justify-center h-4 w-4 rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent/50 transition-colors"
                aria-label="Add to agents"
              >
                <Plus className="h-3 w-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={openNewAgent}>
                <Users className="size-4" />
                <span>New agent</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openNewDepartment()}>
                <Building2 className="size-4" />
                <span>New department</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <CollapsibleContent>
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="flex flex-col gap-0.5 mt-0.5">
            {(departments ?? []).map((dept) => (
              <DepartmentSection
                key={dept.id}
                department={dept}
                agents={groupedAgents.byDepartment.get(dept.id) ?? []}
                activeAgentId={activeAgentId}
                activeTab={activeTab}
                pendingAgentIds={pendingAgentIds}
                isMobile={isMobile}
                setSidebarOpen={setSidebarOpen}
                onPauseResume={(agent, action) =>
                  pauseResumeAgent.mutate({ agent, action })
                }
                liveCountByAgent={liveCountByAgent}
                onEdit={(d) =>
                  openNewDepartment({
                    editId: d.id,
                    name: d.name,
                    description: d.description ?? undefined,
                    icon: d.icon,
                  })
                }
                onDelete={handleDeleteDepartment}
              />
            ))}
            <DepartmentSection
              department={null}
              agents={groupedAgents.unassigned}
              activeAgentId={activeAgentId}
              activeTab={activeTab}
              pendingAgentIds={pendingAgentIds}
              isMobile={isMobile}
              setSidebarOpen={setSidebarOpen}
              onPauseResume={(agent, action) =>
                pauseResumeAgent.mutate({ agent, action })
              }
              liveCountByAgent={liveCountByAgent}
            />
          </div>
        </DndContext>
      </CollapsibleContent>
    </Collapsible>
  );
}
