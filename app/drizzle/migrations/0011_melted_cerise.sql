CREATE TABLE `project_baselines` (
	`id` text PRIMARY KEY NOT NULL,
	`project_key` text NOT NULL,
	`baseline_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`baseline_id`) REFERENCES `technical_baselines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `technical_baselines` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`config_payload` text NOT NULL,
	`created_at` integer NOT NULL
);
