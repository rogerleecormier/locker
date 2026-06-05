-- Envelope Encryption: vault_keys table
-- Stores one wrapped Data Encryption Key (DEK) per vault (user or org/team scope).
-- The DEK is encrypted with the master ENCRYPTION_KEY (KEK) using AES-256-GCM.
-- vault_id is either a userId (personal vault) or a projectKey string ("org:xxx" / "team:xxx").
CREATE TABLE IF NOT EXISTS `vault_keys` (
  `vault_id` text PRIMARY KEY NOT NULL,
  `wrapped_dek` text NOT NULL,
  `created_at` integer NOT NULL
);
