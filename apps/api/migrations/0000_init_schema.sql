CREATE TABLE `agent_categories` (
	`agent_id` text NOT NULL,
	`category_id` text NOT NULL,
	PRIMARY KEY(`agent_id`, `category_id`),
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_categories_category_idx` ON `agent_categories` (`category_id`);--> statement-breakpoint
CREATE TABLE `agent_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`agent_version_id` text NOT NULL,
	`installation_id` text,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`input_json` text DEFAULT '{}' NOT NULL,
	`output_json` text,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`requires_ai` integer DEFAULT 0 NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_version_id`) REFERENCES `agent_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`installation_id`) REFERENCES `agent_installations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "agent_executions_status_ck" CHECK(status IN ('pending', 'running', 'awaiting_approval', 'completed', 'failed', 'canceled')),
	CONSTRAINT "agent_executions_requires_ai_ck" CHECK("agent_executions"."requires_ai" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `agent_executions_workspace_idx` ON `agent_executions` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_executions_user_idx` ON `agent_executions` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_executions_agent_idx` ON `agent_executions` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_executions_status_idx` ON `agent_executions` (`status`);--> statement-breakpoint
CREATE TABLE `agent_installations` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`installed_version_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`installed_version_id`) REFERENCES `agent_versions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "agent_installations_status_ck" CHECK(status IN ('active', 'uninstalled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_installations_uq` ON `agent_installations` (`agent_id`,`workspace_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `agent_installations_user_idx` ON `agent_installations` (`user_id`);--> statement-breakpoint
CREATE INDEX `agent_installations_workspace_idx` ON `agent_installations` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `agent_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`user_id` text NOT NULL,
	`installation_id` text NOT NULL,
	`rating` integer NOT NULL,
	`body` text,
	`verified` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'visible' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`installation_id`) REFERENCES `agent_installations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "agent_reviews_rating_ck" CHECK("agent_reviews"."rating" BETWEEN 1 AND 5),
	CONSTRAINT "agent_reviews_verified_ck" CHECK("agent_reviews"."verified" IN (0, 1)),
	CONSTRAINT "agent_reviews_status_ck" CHECK(status IN ('visible', 'hidden'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_reviews_agent_user_uq` ON `agent_reviews` (`agent_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `agent_reviews_agent_idx` ON `agent_reviews` (`agent_id`);--> statement-breakpoint
CREATE TABLE `agent_tests` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_version_id` text NOT NULL,
	`name` text NOT NULL,
	`input_json` text DEFAULT '{}' NOT NULL,
	`expected_json` text,
	`last_result` text,
	`last_run_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`agent_version_id`) REFERENCES `agent_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_tests_version_idx` ON `agent_tests` (`agent_version_id`);--> statement-breakpoint
CREATE TABLE `agent_tools` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_version_id` text NOT NULL,
	`tool_key` text NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`agent_version_id`) REFERENCES `agent_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_tools_version_tool_uq` ON `agent_tools` (`agent_version_id`,`tool_key`);--> statement-breakpoint
CREATE TABLE `agent_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`version` integer NOT NULL,
	`objective` text DEFAULT '' NOT NULL,
	`instructions` text DEFAULT '' NOT NULL,
	`output_format` text DEFAULT 'text' NOT NULL,
	`limits_json` text DEFAULT '{}' NOT NULL,
	`changelog` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "agent_versions_status_ck" CHECK(status IN ('draft', 'published', 'deprecated'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_versions_agent_version_uq` ON `agent_versions` (`agent_id`,`version`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`creator_user_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`current_version_id` text,
	`is_demo` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`creator_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "agents_visibility_ck" CHECK(visibility IN ('private', 'workspace', 'public')),
	CONSTRAINT "agents_status_ck" CHECK(status IN ('draft', 'published', 'suspended', 'archived')),
	CONSTRAINT "agents_scope_ck" CHECK(("agents"."visibility" = 'public' AND "agents"."workspace_id" IS NULL) OR ("agents"."visibility" <> 'public' AND "agents"."workspace_id" IS NOT NULL)),
	CONSTRAINT "agents_demo_ck" CHECK("agents"."is_demo" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agents_slug_uq` ON `agents` (`slug`);--> statement-breakpoint
CREATE INDEX `agents_workspace_idx` ON `agents` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `agents_creator_idx` ON `agents` (`creator_user_id`);--> statement-breakpoint
CREATE INDEX `agents_catalog_idx` ON `agents` (`visibility`,`status`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`workspace_id` text,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`metadata_json` text,
	`ip_hash` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_logs_action_idx` ON `audit_logs` (`action`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_actor_idx` ON `audit_logs` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_workspace_idx` ON `audit_logs` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name_en` text NOT NULL,
	`name_pt` text NOT NULL,
	`name_es` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_slug_uq` ON `categories` (`slug`);--> statement-breakpoint
CREATE TABLE `execution_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`execution_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`approver_user_id` text,
	`decision` text DEFAULT 'pending' NOT NULL,
	`method` text NOT NULL,
	`reason` text,
	`decided_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`execution_id`) REFERENCES `agent_executions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approver_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "execution_approvals_decision_ck" CHECK(decision IN ('pending', 'approved', 'rejected')),
	CONSTRAINT "execution_approvals_method_ck" CHECK(method IN ('workspace_admin', 'self_second_step'))
);
--> statement-breakpoint
CREATE INDEX `execution_approvals_exec_idx` ON `execution_approvals` (`execution_id`);--> statement-breakpoint
CREATE INDEX `execution_approvals_approver_idx` ON `execution_approvals` (`approver_user_id`);--> statement-breakpoint
CREATE TABLE `execution_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`execution_id` text NOT NULL,
	`name` text NOT NULL,
	`mime_type` text DEFAULT 'text/plain' NOT NULL,
	`content_text` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`execution_id`) REFERENCES `agent_executions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `execution_artifacts_exec_idx` ON `execution_artifacts` (`execution_id`);--> statement-breakpoint
CREATE TABLE `execution_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`execution_id` text NOT NULL,
	`seq` integer NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`input_json` text,
	`output_json` text,
	`error` text,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`execution_id`) REFERENCES `agent_executions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "execution_steps_status_ck" CHECK(status IN ('pending', 'running', 'completed', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `execution_steps_exec_seq_uq` ON `execution_steps` (`execution_id`,`seq`);--> statement-breakpoint
CREATE TABLE `favorites` (
	`user_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `agent_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `favorites_agent_idx` ON `favorites` (`agent_id`);--> statement-breakpoint
CREATE TABLE `feature_flags` (
	`key` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`description` text,
	`updated_by` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "feature_flags_enabled_ck" CHECK("feature_flags"."enabled" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`data_json` text,
	`read_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `organization_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`workspace_id` text,
	`token_hash` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_by` text NOT NULL,
	`expires_at` integer NOT NULL,
	`max_uses` integer DEFAULT 1 NOT NULL,
	`use_count` integer DEFAULT 0 NOT NULL,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "organization_invites_role_ck" CHECK(role IN ('owner', 'admin', 'member')),
	CONSTRAINT "organization_invites_uses_ck" CHECK("organization_invites"."use_count" <= "organization_invites"."max_uses")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_invites_token_uq` ON `organization_invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `organization_invites_org_idx` ON `organization_invites` (`organization_id`);--> statement-breakpoint
CREATE TABLE `organization_members` (
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`organization_id`, `user_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "organization_members_role_ck" CHECK(role IN ('owner', 'admin', 'member'))
);
--> statement-breakpoint
CREATE INDEX `organization_members_user_idx` ON `organization_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`kind` text DEFAULT 'company' NOT NULL,
	`owner_user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "organizations_kind_ck" CHECK(kind IN ('personal', 'company'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_slug_uq` ON `organizations` (`slug`);--> statement-breakpoint
CREATE INDEX `organizations_owner_idx` ON `organizations` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `rate_limit_counters` (
	`key` text NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`key`, `window_start`)
);
--> statement-breakpoint
CREATE INDEX `rate_limit_counters_window_idx` ON `rate_limit_counters` (`window_start`);--> statement-breakpoint
CREATE TABLE `referrals` (
	`id` text PRIMARY KEY NOT NULL,
	`referrer_user_id` text NOT NULL,
	`code` text NOT NULL,
	`referred_user_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`converted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`referrer_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`referred_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "referrals_status_ck" CHECK(status IN ('pending', 'converted', 'void'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `referrals_code_uq` ON `referrals` (`code`);--> statement-breakpoint
CREATE INDEX `referrals_referrer_idx` ON `referrals` (`referrer_user_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`prev_token_hash` text,
	`prev_valid_until` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`rotated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`ip_hash` text,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_uq` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_prev_token_hash_idx` ON `sessions` (`prev_token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `system_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_by` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `usage_quotas` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`scope_id` text DEFAULT '' NOT NULL,
	`metric` text NOT NULL,
	`limit_value` integer NOT NULL,
	`period` text DEFAULT 'day' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "usage_quotas_scope_ck" CHECK(scope IN ('global', 'workspace', 'member')),
	CONSTRAINT "usage_quotas_period_ck" CHECK(period IN ('day', 'month')),
	CONSTRAINT "usage_quotas_limit_ck" CHECK("usage_quotas"."limit_value" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usage_quotas_uq` ON `usage_quotas` (`scope`,`scope_id`,`metric`,`period`);--> statement-breakpoint
CREATE TABLE `usage_records` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`user_id` text,
	`metric` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`day` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `usage_records_workspace_idx` ON `usage_records` (`workspace_id`,`metric`,`day`);--> statement-breakpoint
CREATE INDEX `usage_records_user_idx` ON `usage_records` (`user_id`,`metric`,`day`);--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`display_name` text,
	`locale` text DEFAULT 'en' NOT NULL,
	`bio` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_profiles_locale_ck" CHECK(locale IN ('en', 'pt', 'es'))
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`platform_role` text DEFAULT 'user' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`email_verified_at` integer,
	`last_login_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "users_email_lower_ck" CHECK("users"."email" = lower("users"."email")),
	CONSTRAINT "users_platform_role_ck" CHECK(platform_role IN ('user', 'admin')),
	CONSTRAINT "users_status_ck" CHECK(status IN ('active', 'suspended', 'deleted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_uq` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `workspace_members` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`workspace_id`, `user_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workspace_members_role_ck" CHECK(role IN ('owner', 'admin', 'member'))
);
--> statement-breakpoint
CREATE INDEX `workspace_members_user_idx` ON `workspace_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_org_slug_uq` ON `workspaces` (`organization_id`,`slug`);