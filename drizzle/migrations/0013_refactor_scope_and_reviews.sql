ALTER TABLE `user` ADD COLUMN `writePasscodeHash` text;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `memory_recommendations_new` (
	`id` text PRIMARY KEY NOT NULL,
	`orgId` text REFERENCES `organizations`(`id`) ON DELETE cascade,
	`userId` text NOT NULL REFERENCES `user`(`id`) ON DELETE cascade,
	`fact` text NOT NULL,
	`category` text NOT NULL,
	`tags` text NOT NULL DEFAULT '',
	`projectKey` text,
	`scopeType` text NOT NULL DEFAULT 'personal',
	`scopeId` text,
	`recommendationType` text NOT NULL DEFAULT 'add',
	`targetMemoryId` text REFERENCES `memories`(`id`) ON DELETE cascade,
	`status` text NOT NULL DEFAULT 'pending',
	`reviewedBy` text REFERENCES `user`(`id`),
	`reviewNotes` text,
	`createdAt` integer NOT NULL,
	`reviewedAt` integer
);
--> statement-breakpoint
INSERT INTO `memory_recommendations_new` (
	`id`, `orgId`, `userId`, `fact`, `category`, `tags`, `projectKey`,
	`scopeType`, `scopeId`, `recommendationType`, `targetMemoryId`,
	`status`, `reviewedBy`, `reviewNotes`, `createdAt`, `reviewedAt`
)
SELECT
	`id`, `orgId`, `userId`, `fact`, `category`, `tags`, `projectKey`,
	'organization', `orgId`, 'add', NULL,
	`status`, `reviewedBy`, `reviewNotes`, `createdAt`, `reviewedAt`
FROM `memory_recommendations`;
--> statement-breakpoint
DROP TABLE `memory_recommendations`;
--> statement-breakpoint
ALTER TABLE `memory_recommendations_new` RENAME TO `memory_recommendations`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
CREATE TRIGGER fki_memories_scope_org
BEFORE INSERT ON memories
FOR EACH ROW
WHEN NEW.scopeType = 'organization' AND NEW.scopeId IS NOT NULL
BEGIN
  SELECT CASE
    WHEN (SELECT 1 FROM organizations WHERE id = NEW.scopeId) IS NULL
    THEN RAISE(ABORT, 'Foreign key violation: scopeId must exist in organizations when scopeType is organization')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER fku_memories_scope_org
BEFORE UPDATE OF scopeType, scopeId ON memories
FOR EACH ROW
WHEN NEW.scopeType = 'organization' AND NEW.scopeId IS NOT NULL
BEGIN
  SELECT CASE
    WHEN (SELECT 1 FROM organizations WHERE id = NEW.scopeId) IS NULL
    THEN RAISE(ABORT, 'Foreign key violation: scopeId must exist in organizations when scopeType is organization')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER fki_memories_scope_team
BEFORE INSERT ON memories
FOR EACH ROW
WHEN NEW.scopeType = 'team' AND NEW.scopeId IS NOT NULL
BEGIN
  SELECT CASE
    WHEN (SELECT 1 FROM teams WHERE id = NEW.scopeId) IS NULL
    THEN RAISE(ABORT, 'Foreign key violation: scopeId must exist in teams when scopeType is team')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER fku_memories_scope_team
BEFORE UPDATE OF scopeType, scopeId ON memories
FOR EACH ROW
WHEN NEW.scopeType = 'team' AND NEW.scopeId IS NOT NULL
BEGIN
  SELECT CASE
    WHEN (SELECT 1 FROM teams WHERE id = NEW.scopeId) IS NULL
    THEN RAISE(ABORT, 'Foreign key violation: scopeId must exist in teams when scopeType is team')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER fki_memories_scope_personal
BEFORE INSERT ON memories
FOR EACH ROW
WHEN NEW.scopeType = 'personal' AND NEW.scopeId IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Constraint violation: scopeId must be NULL when scopeType is personal');
END;
--> statement-breakpoint
CREATE TRIGGER fku_memories_scope_personal
BEFORE UPDATE OF scopeType, scopeId ON memories
FOR EACH ROW
WHEN NEW.scopeType = 'personal' AND NEW.scopeId IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Constraint violation: scopeId must be NULL when scopeType is personal');
END;
--> statement-breakpoint
CREATE TRIGGER fki_api_tokens_scope_org
BEFORE INSERT ON api_tokens
FOR EACH ROW
WHEN NEW.scopeType = 'organization' AND NEW.scopeId IS NOT NULL
BEGIN
  SELECT CASE
    WHEN (SELECT 1 FROM organizations WHERE id = NEW.scopeId) IS NULL
    THEN RAISE(ABORT, 'Foreign key violation: scopeId must exist in organizations when scopeType is organization')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER fku_api_tokens_scope_org
BEFORE UPDATE OF scopeType, scopeId ON api_tokens
FOR EACH ROW
WHEN NEW.scopeType = 'organization' AND NEW.scopeId IS NOT NULL
BEGIN
  SELECT CASE
    WHEN (SELECT 1 FROM organizations WHERE id = NEW.scopeId) IS NULL
    THEN RAISE(ABORT, 'Foreign key violation: scopeId must exist in organizations when scopeType is organization')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER fki_api_tokens_scope_team
BEFORE INSERT ON api_tokens
FOR EACH ROW
WHEN NEW.scopeType = 'team' AND NEW.scopeId IS NOT NULL
BEGIN
  SELECT CASE
    WHEN (SELECT 1 FROM teams WHERE id = NEW.scopeId) IS NULL
    THEN RAISE(ABORT, 'Foreign key violation: scopeId must exist in teams when scopeType is team')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER fku_api_tokens_scope_team
BEFORE UPDATE OF scopeType, scopeId ON api_tokens
FOR EACH ROW
WHEN NEW.scopeType = 'team' AND NEW.scopeId IS NOT NULL
BEGIN
  SELECT CASE
    WHEN (SELECT 1 FROM teams WHERE id = NEW.scopeId) IS NULL
    THEN RAISE(ABORT, 'Foreign key violation: scopeId must exist in teams when scopeType is team')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER fki_api_tokens_scope_personal
BEFORE INSERT ON api_tokens
FOR EACH ROW
WHEN NEW.scopeType = 'personal' AND NEW.scopeId IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Constraint violation: scopeId must be NULL when scopeType is personal');
END;
--> statement-breakpoint
CREATE TRIGGER fku_api_tokens_scope_personal
BEFORE UPDATE OF scopeType, scopeId ON api_tokens
FOR EACH ROW
WHEN NEW.scopeType = 'personal' AND NEW.scopeId IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Constraint violation: scopeId must be NULL when scopeType is personal');
END;
--> statement-breakpoint
CREATE TRIGGER fki_memory_recommendations_scope_org
BEFORE INSERT ON memory_recommendations
FOR EACH ROW
WHEN NEW.scopeType = 'organization' AND NEW.scopeId IS NOT NULL
BEGIN
  SELECT CASE
    WHEN (SELECT 1 FROM organizations WHERE id = NEW.scopeId) IS NULL
    THEN RAISE(ABORT, 'Foreign key violation: scopeId must exist in organizations when scopeType is organization')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER fku_memory_recommendations_scope_org
BEFORE UPDATE OF scopeType, scopeId ON memory_recommendations
FOR EACH ROW
WHEN NEW.scopeType = 'organization' AND NEW.scopeId IS NOT NULL
BEGIN
  SELECT CASE
    WHEN (SELECT 1 FROM organizations WHERE id = NEW.scopeId) IS NULL
    THEN RAISE(ABORT, 'Foreign key violation: scopeId must exist in organizations when scopeType is organization')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER fki_memory_recommendations_scope_team
BEFORE INSERT ON memory_recommendations
FOR EACH ROW
WHEN NEW.scopeType = 'team' AND NEW.scopeId IS NOT NULL
BEGIN
  SELECT CASE
    WHEN (SELECT 1 FROM teams WHERE id = NEW.scopeId) IS NULL
    THEN RAISE(ABORT, 'Foreign key violation: scopeId must exist in teams when scopeType is team')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER fku_memory_recommendations_scope_team
BEFORE UPDATE OF scopeType, scopeId ON memory_recommendations
FOR EACH ROW
WHEN NEW.scopeType = 'team' AND NEW.scopeId IS NOT NULL
BEGIN
  SELECT CASE
    WHEN (SELECT 1 FROM teams WHERE id = NEW.scopeId) IS NULL
    THEN RAISE(ABORT, 'Foreign key violation: scopeId must exist in teams when scopeType is team')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER fki_memory_recommendations_scope_personal
BEFORE INSERT ON memory_recommendations
FOR EACH ROW
WHEN NEW.scopeType = 'personal' AND NEW.scopeId IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Constraint violation: scopeId must be NULL when scopeType is personal');
END;
--> statement-breakpoint
CREATE TRIGGER fku_memory_recommendations_scope_personal
BEFORE UPDATE OF scopeType, scopeId ON memory_recommendations
FOR EACH ROW
WHEN NEW.scopeType = 'personal' AND NEW.scopeId IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Constraint violation: scopeId must be NULL when scopeType is personal');
END;