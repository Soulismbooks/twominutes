-- Admin metadata fields and inline featured image storage.
-- Inline images are browser-compressed JPEG data URLs capped by API validation.
-- This migration changes only the dedicated Admin D1 database.
ALTER TABLE admin_drafts ADD COLUMN seo_title TEXT NOT NULL DEFAULT '';
ALTER TABLE admin_drafts ADD COLUMN seo_description TEXT NOT NULL DEFAULT '';
ALTER TABLE admin_drafts ADD COLUMN category TEXT NOT NULL DEFAULT 'Happy Life'
  CHECK (category IN ('Happy Life', 'Money Tips', 'Soulism'));
ALTER TABLE admin_drafts ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE admin_drafts ADD COLUMN featured_image TEXT NOT NULL DEFAULT '';
ALTER TABLE admin_drafts ADD COLUMN featured_image_alt TEXT NOT NULL DEFAULT '';
