CREATE TABLE "integration_credentials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "secret_id" uuid,
  "provider" text NOT NULL,
  "category" text NOT NULL,
  "credential_type" text NOT NULL,
  "display_name" text NOT NULL,
  "description" text,
  "environment" text DEFAULT 'production' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "masked_suffix" text NOT NULL,
  "last_tested_at" timestamp with time zone,
  "last_test_status" text,
  "last_test_error" text,
  "rotation_notes" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by_user_id" text,
  "created_by_agent_id" uuid,
  "updated_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_credential_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "credential_id" uuid NOT NULL,
  "target_kind" text NOT NULL,
  "target_plugin_id" uuid NOT NULL,
  "target_config_path" text NOT NULL,
  "assigned_by_user_id" text,
  "assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_credentials"
  ADD CONSTRAINT "integration_credentials_company_id_companies_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "integration_credentials"
  ADD CONSTRAINT "integration_credentials_secret_id_company_secrets_id_fk"
  FOREIGN KEY ("secret_id") REFERENCES "public"."company_secrets"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "integration_credentials"
  ADD CONSTRAINT "integration_credentials_created_by_agent_id_agents_id_fk"
  FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "integration_credential_assignments"
  ADD CONSTRAINT "integration_credential_assignments_company_id_companies_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "integration_credential_assignments"
  ADD CONSTRAINT "integration_credential_assignments_credential_id_integration_credentials_id_fk"
  FOREIGN KEY ("credential_id") REFERENCES "public"."integration_credentials"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "integration_credential_assignments"
  ADD CONSTRAINT "integration_credential_assignments_target_plugin_id_plugins_id_fk"
  FOREIGN KEY ("target_plugin_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "integration_credentials_company_name_uq"
  ON "integration_credentials" USING btree ("company_id","display_name");
--> statement-breakpoint
CREATE INDEX "integration_credentials_company_idx"
  ON "integration_credentials" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "integration_credentials_company_provider_idx"
  ON "integration_credentials" USING btree ("company_id","provider");
--> statement-breakpoint
CREATE INDEX "integration_credentials_company_category_idx"
  ON "integration_credentials" USING btree ("company_id","category");
--> statement-breakpoint
CREATE UNIQUE INDEX "integration_credential_assignments_slot_uq"
  ON "integration_credential_assignments" USING btree ("target_plugin_id","target_config_path");
--> statement-breakpoint
CREATE INDEX "integration_credential_assignments_credential_idx"
  ON "integration_credential_assignments" USING btree ("credential_id");
