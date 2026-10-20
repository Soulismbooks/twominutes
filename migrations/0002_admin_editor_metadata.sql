-- Admin editor metadata and review state (migration 0002).
-- Apply only to the dedicated Admin D1 database. Do not alter migration 0001.
ALTER TABLE admin_drafts ADD COLUMN seo_title TEXT NOT NULL DEFAULT '';
ALTER TABLE admin_drafts ADD COLUMN seo_description TEXT NOT NULL DEFAULT '';
ALTER TABLE admin_drafts ADD COLUMN category TEXT NOT NULL DEFAULT '';
ALTER TABLE admin_drafts ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE admin_drafts ADD COLUMN featured_image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE admin_drafts ADD COLUMN featured_image_alt TEXT NOT NULL DEFAULT '';
ALTER TABLE admin_drafts ADD COLUMN canonical_url TEXT NOT NULL DEFAULT '';
ALTER TABLE admin_drafts ADD COLUMN github_pr_url TEXT NOT NULL DEFAULT '';
ALTER TABLE admin_drafts ADD COLUMN github_pr_number INTEGER NOT NULL DEFAULT 0;
