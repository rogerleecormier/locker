DROP TABLE IF EXISTS `project_baselines`;
--> statement-breakpoint
DROP TABLE IF EXISTS `technical_baselines`;
--> statement-breakpoint
CREATE TABLE `memory_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`category` text DEFAULT 'stack' NOT NULL,
	`config_payload` text NOT NULL,
	`created_at` integer NOT NULL
);
