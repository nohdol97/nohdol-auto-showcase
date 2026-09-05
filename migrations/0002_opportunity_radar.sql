PRAGMA foreign_keys = ON;

CREATE TABLE radar_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  location TEXT NOT NULL,
  keywords_json TEXT NOT NULL,
  radius_meters INTEGER NOT NULL CHECK (radius_meters BETWEEN 300 AND 5000),
  max_candidates INTEGER NOT NULL CHECK (max_candidates BETWEEN 1 AND 10),
  auto_enabled INTEGER NOT NULL CHECK (auto_enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE radar_runs (
  id TEXT PRIMARY KEY,
  run_key TEXT NOT NULL UNIQUE,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'scheduled')),
  local_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'failed')),
  settings_json TEXT NOT NULL,
  places_found INTEGER NOT NULL DEFAULT 0,
  candidates_analyzed INTEGER NOT NULL DEFAULT 0,
  error_class TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE radar_candidates (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES radar_runs(id) ON DELETE CASCADE,
  kakao_id TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  category TEXT NOT NULL,
  phone TEXT,
  map_url TEXT,
  distance_meters INTEGER,
  analysis_json TEXT,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  confidence INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  source_count INTEGER NOT NULL DEFAULT 0,
  analysis_status TEXT NOT NULL CHECK (analysis_status IN ('completed', 'failed')),
  error_class TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(run_id, kakao_id)
);

CREATE INDEX radar_runs_started_idx ON radar_runs(started_at DESC);
CREATE UNIQUE INDEX radar_runs_single_active_idx ON radar_runs(status) WHERE status = 'running';
CREATE INDEX radar_candidates_run_score_idx ON radar_candidates(run_id, score DESC, distance_meters ASC);
