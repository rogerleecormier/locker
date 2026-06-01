-- Migration: 0013_add_expires_at_to_api_tokens.sql
-- Adds missing expiresAt column to api_tokens table

ALTER TABLE `api_tokens` ADD COLUMN `expiresAt` integer;
