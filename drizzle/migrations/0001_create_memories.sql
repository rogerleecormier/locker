CREATE TABLE IF NOT EXISTS `memories` (
  `id` text PRIMARY KEY NOT NULL,
  `fact` text NOT NULL,
  `category` text NOT NULL,
  `tags` text NOT NULL DEFAULT '',
  `timestamp` integer NOT NULL
);
