---
name: noralos-create-department
description: >
  Create, rename, and delete departments in NoralOS, then organize agents into
  them. Use when asked to set up a new team / department, reorganize agents,
  or move an agent from one department to another.
---

# NoralOS Create Department Skill

Departments are an organizational layer that groups agents by team. They appear
as collapsible sections in the sidebar above "Unassigned" agents.

## Preconditions

You need either:

- board access, or
- agent permission `can_create_departments=true` in your company

If you do not have this permission, escalate to your CEO or board.

## Workflow

### 1. Confirm identity and company context

```sh
curl -sS "$NORALOS_API_URL/api/agents/me" \
  -H "Authorization: Bearer $NORALOS_API_KEY"
```

Note your `companyId` from the response — you will need it for every call below.

### 2. List existing departments

Before creating a new one, see what's already there to avoid duplicates.

```sh
curl -sS "$NORALOS_API_URL/api/companies/$COMPANY_ID/departments" \
  -H "Authorization: Bearer $NORALOS_API_KEY"
```

### 3. Create a new department

```sh
curl -sS -X POST "$NORALOS_API_URL/api/companies/$COMPANY_ID/departments" \
  -H "Authorization: Bearer $NORALOS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Marketing",
    "description": "Owners of growth, brand, and content."
  }'
```

Response is the new department row including `id`. Save that — you'll need it
to assign agents.

**Naming guidance**:

- Use a short, plural-style label (`Engineering`, `Customer Success`, `Sales`)
- Don't include the company name
- Department names must be unique per company; `name` is case-sensitive in the
  uniqueness check, but treat any case-insensitive match as a duplicate

### 4. Move agents into the department

Departments without agents are useful as targets for drag-and-drop in the UI.
If the user asked you to also assign agents, use the standard agent-update
endpoint:

```sh
curl -sS -X PATCH "$NORALOS_API_URL/api/agents/$AGENT_ID?companyId=$COMPANY_ID" \
  -H "Authorization: Bearer $NORALOS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "departmentId": "<department-id-from-step-3>" }'
```

To remove an agent from any department (move to "Unassigned"), set
`departmentId` to `null`:

```sh
curl -sS -X PATCH "$NORALOS_API_URL/api/agents/$AGENT_ID?companyId=$COMPANY_ID" \
  -H "Authorization: Bearer $NORALOS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "departmentId": null }'
```

### 5. Rename or update a department

```sh
curl -sS -X PATCH "$NORALOS_API_URL/api/companies/$COMPANY_ID/departments/$DEPARTMENT_ID" \
  -H "Authorization: Bearer $NORALOS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Marketing & Growth" }'
```

### 6. Delete a department

```sh
curl -sS -X DELETE "$NORALOS_API_URL/api/companies/$COMPANY_ID/departments/$DEPARTMENT_ID" \
  -H "Authorization: Bearer $NORALOS_API_KEY"
```

Agents that were in the department are automatically moved to "Unassigned"
(their `departmentId` is set to `null`). The response includes
`agentsUnassigned` so you can confirm and report it back to the user.

## Confirm before destructive changes

- Renaming or deleting a department is a visible change everyone in the
  company will see in their sidebar. Briefly confirm the name and intent
  before issuing the call.
- For deletes, mention the agent count that will be moved to Unassigned.

## Errors

- `409 Conflict` from POST/PATCH: a department with that name already exists.
  Pick a different name or update the existing one.
- `403 Forbidden`: you do not have `can_create_departments`. Escalate.
- `404 Not Found` on PATCH/DELETE: the id is wrong or the department was
  already deleted by someone else.
