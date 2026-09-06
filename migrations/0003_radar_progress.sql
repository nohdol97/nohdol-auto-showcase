ALTER TABLE radar_runs ADD COLUMN heartbeat_at TEXT;

UPDATE radar_runs
SET heartbeat_at = COALESCE(completed_at, started_at)
WHERE heartbeat_at IS NULL;

CREATE INDEX radar_runs_status_heartbeat_idx
ON radar_runs(status, heartbeat_at);
