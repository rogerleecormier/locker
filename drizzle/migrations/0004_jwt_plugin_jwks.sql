-- better-auth jwt plugin: jwks key store

CREATE TABLE IF NOT EXISTS `jwks` (
  `id` text PRIMARY KEY NOT NULL,
  `publicKey` text NOT NULL,
  `privateKey` text NOT NULL,
  `createdAt` integer NOT NULL,
  `expiresAt` integer
);
