CREATE TABLE `rate_limit_counters` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`minuteStart` integer NOT NULL
);
