-- twominutes.in Admin Portal draft storage (D1)
-- Migration 0001. Apply only to the dedicated admin database.
-- This migration does not publish posts or alter the public website.

CREATE TABLE IF NOT EXISTS admin_drafts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'ready_for_review')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_drafts_slug_unique
  ON admin_drafts(slug)
  WHERE slug <> '';

CREATE INDEX IF NOT EXISTS idx_admin_drafts_updated_at
  ON admin_drafts(updated_at DESC);
