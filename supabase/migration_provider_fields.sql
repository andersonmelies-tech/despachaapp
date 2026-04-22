-- Migration: campos do prestador
-- Execute no SQL Editor do Supabase

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS provider_obs  TEXT DEFAULT '';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS provider_new_date DATE;
