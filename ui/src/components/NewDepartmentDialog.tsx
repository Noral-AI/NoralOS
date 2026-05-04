import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, ArrowLeft } from "lucide-react";
import { useDialog } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { agentsApi } from "../api/agents";
import { departmentsApi } from "../api/departments";
import { queryKeys } from "@/lib/queryKeys";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ApiError } from "../api/client";

export function NewDepartmentDialog() {
  const queryClient = useQueryClient();
  const {
    newDepartmentOpen,
    newDepartmentDefaults,
    closeNewDepartment,
    openNewIssue,
  } = useDialog();
  const { selectedCompanyId } = useCompany();

  const isEdit = Boolean(newDepartmentDefaults.editId);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Reset / hydrate state when the dialog opens
  useEffect(() => {
    if (!newDepartmentOpen) return;
    setError(null);
    if (isEdit) {
      setShowForm(true);
      setName(newDepartmentDefaults.name ?? "");
      setDescription(newDepartmentDefaults.description ?? "");
    } else {
      setShowForm(false);
      setName("");
      setDescription("");
    }
  }, [newDepartmentOpen, isEdit, newDepartmentDefaults.name, newDepartmentDefaults.description]);

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId && newDepartmentOpen && !isEdit,
  });
  const ceoAgent = (agents ?? []).find((a) => a.role === "ceo");

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCompanyId) throw new Error("No company selected");
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error("Name is required");
      const payload = {
        name: trimmedName,
        description: description.trim() ? description.trim() : null,
      };
      if (isEdit && newDepartmentDefaults.editId) {
        return departmentsApi.update(
          selectedCompanyId,
          newDepartmentDefaults.editId,
          payload,
        );
      }
      return departmentsApi.create(selectedCompanyId, payload);
    },
    onSuccess: async () => {
      if (selectedCompanyId) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.departments.list(selectedCompanyId),
        });
      }
      closeNewDepartment();
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Could not save department");
      }
    },
  });

  function handleAskCeo() {
    closeNewDepartment();
    openNewIssue({
      assigneeAgentId: ceoAgent?.id,
      title: "Create a new department",
      description:
        "Use the noralos-create-department skill to add a new department, then organize agents into it. Reply with the department name and which agents (if any) should be assigned.",
    });
  }

  return (
    <Dialog
      open={newDepartmentOpen}
      onOpenChange={(open) => {
        if (!open) {
          closeNewDepartment();
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md p-0 gap-0 overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <span className="text-sm text-muted-foreground">
            {isEdit ? "Edit department" : "Add a new department"}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            onClick={closeNewDepartment}
          >
            <span className="text-lg leading-none">&times;</span>
          </Button>
        </div>

        <div className="p-6 space-y-6">
          {!showForm ? (
            <>
              <div className="text-center space-y-3">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent">
                  <Building2 className="h-6 w-6 text-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">
                  Group agents by team. We recommend letting your CEO add the
                  department — they know the org structure and can move agents
                  in for you.
                </p>
              </div>

              <Button
                className="w-full"
                size="lg"
                onClick={handleAskCeo}
                disabled={!ceoAgent}
              >
                <Building2 className="h-4 w-4 mr-2" />
                Ask the CEO to create a new department
              </Button>

              <div className="text-center">
                <button
                  className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                  onClick={() => setShowForm(true)}
                >
                  I want to create one myself
                </button>
              </div>
            </>
          ) : (
            <>
              {!isEdit && (
                <button
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowForm(false)}
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </button>
              )}

              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (saveMutation.isPending) return;
                  saveMutation.mutate();
                }}
              >
                <div>
                  <label
                    htmlFor="department-name"
                    className="text-xs text-muted-foreground mb-1 block"
                  >
                    Name
                  </label>
                  <input
                    id="department-name"
                    name="name"
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Marketing"
                    maxLength={80}
                    className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                  />
                </div>
                <div>
                  <label
                    htmlFor="department-description"
                    className="text-xs text-muted-foreground mb-1 block"
                  >
                    Description <span className="text-muted-foreground/60">(optional)</span>
                  </label>
                  <textarea
                    id="department-description"
                    name="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Owners growth, brand, and content."
                    rows={3}
                    maxLength={2000}
                    className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50 resize-none"
                  />
                </div>

                {error && <p className="text-xs text-destructive">{error}</p>}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={saveMutation.isPending || name.trim().length === 0}
                >
                  {saveMutation.isPending
                    ? "Saving…"
                    : isEdit
                      ? "Save changes"
                      : "Create department"}
                </Button>
              </form>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
