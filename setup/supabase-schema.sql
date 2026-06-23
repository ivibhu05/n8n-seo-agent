-- ============================================================
-- SEO Content Writer - Supabase Schema
-- Run this in Supabase SQL Editor
-- ============================================================

-- Enable full-text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- CORE TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS websites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT UNIQUE NOT NULL,   -- 'grynow' | 'mywall'
  name          TEXT NOT NULL,
  url           TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO websites (slug, name, url) VALUES
  ('grynow', 'GryNow', 'https://grynow.in'),
  ('mywall', 'MyWall', 'https://mywall.me')
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- INTERNAL LINKS MAP (populated by crawler)
-- ============================================================

CREATE TABLE IF NOT EXISTS internal_links (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id       UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  url              TEXT NOT NULL,
  title            TEXT,
  h1               TEXT,
  meta_description TEXT,
  links_on_page    JSONB DEFAULT '[]',  -- [{anchor: "", href: ""}]
  depth            INTEGER DEFAULT 0,
  crawled_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(website_id, url)
);

CREATE INDEX idx_internal_links_website ON internal_links(website_id);
CREATE INDEX idx_internal_links_title ON internal_links USING gin(to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(h1, '')));

-- ============================================================
-- KNOWLEDGE BASE (business docs, guidelines, tone guides)
-- ============================================================

CREATE TABLE IF NOT EXISTS knowledge_base (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id  UUID REFERENCES websites(id) ON DELETE CASCADE,  -- NULL = global
  category    TEXT NOT NULL,
  -- categories: business-overview | audience | competitors | brand-voice |
  --             seo-guidelines | writing-guidelines | on-page-tone | off-page-tone
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_kb_website_category ON knowledge_base(website_id, category);
CREATE INDEX idx_kb_content_search ON knowledge_base USING gin(to_tsvector('english', content));

-- ============================================================
-- CONTENT REQUESTS (each SEO form submission)
-- ============================================================

CREATE TABLE IF NOT EXISTS content_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id       UUID NOT NULL REFERENCES websites(id),
  placement        TEXT NOT NULL CHECK (placement IN ('on-page', 'off-page')),
  content_type     TEXT NOT NULL CHECK (content_type IN ('blog', 'web-page', 'listicle')),
  topic            TEXT NOT NULL,
  keywords         TEXT[] NOT NULL,
  layout_notes     TEXT,
  additional_brief TEXT,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','researching','strategizing','drafting','review','rework','approved')),
  research_brief   JSONB,
  strategy_brief   JSONB,
  current_version  INTEGER DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_requests_website ON content_requests(website_id);
CREATE INDEX idx_requests_status ON content_requests(status);

-- ============================================================
-- CONTENT VERSIONS (each draft / rework iteration)
-- ============================================================

CREATE TABLE IF NOT EXISTS content_versions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id          UUID NOT NULL REFERENCES content_requests(id) ON DELETE CASCADE,
  version_number      INTEGER NOT NULL DEFAULT 1,
  content_markdown    TEXT NOT NULL,
  word_count          INTEGER,
  google_doc_url      TEXT,
  google_doc_id       TEXT,
  keyword_stats       JSONB,   -- {keyword: count}
  internal_links_used JSONB,   -- [{url, anchor}]
  meta_title          TEXT,
  meta_description    TEXT,
  status              TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','under_review','approved','rework_requested')),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_versions_request ON content_versions(request_id);

-- ============================================================
-- SEO FEEDBACK
-- ============================================================

CREATE TABLE IF NOT EXISTS seo_feedback (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id          UUID NOT NULL REFERENCES content_requests(id) ON DELETE CASCADE,
  content_version_id  UUID NOT NULL REFERENCES content_versions(id) ON DELETE CASCADE,
  version_number      INTEGER NOT NULL,
  decision            TEXT NOT NULL CHECK (decision IN ('approve', 'rework')),
  feedback_text       TEXT,
  category            TEXT CHECK (category IN ('tone','structure','keywords','facts','length','other')),
  severity            TEXT CHECK (severity IN ('minor','major')),
  reviewer_name       TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_feedback_request ON seo_feedback(request_id);

-- ============================================================
-- MEMORY PATTERNS (self-learning layer)
-- ============================================================

CREATE TABLE IF NOT EXISTS memory_patterns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id    UUID REFERENCES websites(id) ON DELETE CASCADE,  -- NULL = global
  placement     TEXT,        -- 'on-page' | 'off-page' | NULL (all)
  content_type  TEXT,        -- 'blog' | 'web-page' | 'listicle' | NULL (all)
  pattern_type  TEXT NOT NULL CHECK (pattern_type IN ('positive','negative','structural')),
  category      TEXT,        -- tone | structure | keywords | facts | length
  pattern       TEXT NOT NULL,
  source        TEXT,        -- 'feedback' | 'approved_content'
  frequency     INTEGER DEFAULT 1,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_patterns_website ON memory_patterns(website_id);
CREATE INDEX idx_patterns_type ON memory_patterns(placement, content_type, pattern_type);
CREATE INDEX idx_patterns_search ON memory_patterns USING gin(to_tsvector('english', pattern));

-- ============================================================
-- APPROVED CONTENT ARCHIVE (memory for writing style)
-- ============================================================

CREATE TABLE IF NOT EXISTS content_archive (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_version_id  UUID NOT NULL REFERENCES content_versions(id),
  request_id          UUID NOT NULL REFERENCES content_requests(id),
  website_id          UUID NOT NULL REFERENCES websites(id),
  placement           TEXT NOT NULL,
  content_type        TEXT NOT NULL,
  topic               TEXT NOT NULL,
  keywords            TEXT[],
  word_count          INTEGER,
  content_excerpt     TEXT,   -- first 500 chars for context retrieval
  full_content        TEXT,
  google_doc_url      TEXT,
  approved_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_archive_website ON content_archive(website_id, placement, content_type);
CREATE INDEX idx_archive_search ON content_archive USING gin(to_tsvector('english', topic || ' ' || COALESCE(content_excerpt, '')));

-- ============================================================
-- HELPER: auto-update updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_requests_updated_at
  BEFORE UPDATE ON content_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_patterns_updated_at
  BEFORE UPDATE ON memory_patterns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- HELPER: full-text search function for knowledge base
-- Used by Research Agent to pull relevant KB sections
-- ============================================================

CREATE OR REPLACE FUNCTION search_knowledge_base(
  p_website_id UUID,
  p_query      TEXT,
  p_limit      INTEGER DEFAULT 5
)
RETURNS TABLE(id UUID, category TEXT, title TEXT, content TEXT, relevance REAL)
LANGUAGE SQL AS $$
  SELECT
    kb.id, kb.category, kb.title, kb.content,
    ts_rank(to_tsvector('english', kb.content), plainto_tsquery('english', p_query)) AS relevance
  FROM knowledge_base kb
  WHERE (kb.website_id = p_website_id OR kb.website_id IS NULL)
    AND to_tsvector('english', kb.content) @@ plainto_tsquery('english', p_query)
  ORDER BY relevance DESC
  LIMIT p_limit;
$$;

-- ============================================================
-- HELPER: get relevant internal links for a topic
-- ============================================================

CREATE OR REPLACE FUNCTION search_internal_links(
  p_website_id UUID,
  p_query      TEXT,
  p_limit      INTEGER DEFAULT 10
)
RETURNS TABLE(url TEXT, title TEXT, h1 TEXT, relevance REAL)
LANGUAGE SQL AS $$
  SELECT
    il.url, il.title, il.h1,
    ts_rank(
      to_tsvector('english', COALESCE(il.title,'') || ' ' || COALESCE(il.h1,'')),
      plainto_tsquery('english', p_query)
    ) AS relevance
  FROM internal_links il
  WHERE il.website_id = p_website_id
    AND to_tsvector('english', COALESCE(il.title,'') || ' ' || COALESCE(il.h1,''))
        @@ plainto_tsquery('english', p_query)
  ORDER BY relevance DESC
  LIMIT p_limit;
$$;
