CREATE TABLE "integration_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"secret_id" uuid NOT NULL,
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
	"last_rotated_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_credential_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"credential_id" uuid NOT NULL,
	"target_kind" text DEFAULT 'plugin_config' NOT NULL,
	"target_plugin_id" uuid NOT NULL,
	"target_field" text NOT NULL,
	"assigned_by_user_id" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_credentials" ADD CONSTRAINT "integration_credentials_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credentials" ADD CONSTRAINT "integration_credentials_secret_id_company_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."company_secrets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credential_assignments" ADD CONSTRAINT "integration_credential_assignments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credential_assignments" ADD CONSTRAINT "integration_credential_assignments_credential_id_integration_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."integration_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credential_assignments" ADD CONSTRAINT "integration_credential_assignments_target_plugin_id_plugins_id_fk" FOREIGN KEY ("target_plugin_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_credentials_company_category_idx" ON "integration_credentials" USING btree ("company_id","category");--> statement-breakpoint
CREATE INDEX "integration_credentials_company_provider_idx" ON "integration_credentials" USING btree ("company_id","provider");--> statement-breakpoint
CREATE INDEX "integration_credentials_company_status_idx" ON "integration_credentials" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_credentials_secret_uq" ON "integration_credentials" USING btree ("secret_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_credentials_company_provider_name_uq" ON "integration_credentials" USING btree ("company_id","provider","display_name");--> statement-breakpoint
CREATE INDEX "integration_credential_assignments_credential_idx" ON "integration_credential_assignments" USING btree ("credential_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_credential_assignments_target_uq" ON "integration_credential_assignments" USING btree ("company_id","target_plugin_id","target_field");
