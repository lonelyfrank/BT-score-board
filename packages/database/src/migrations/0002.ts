// Game modes: the single-match format joins the tournament formats. SQLite cannot alter a CHECK,
// so the table is rebuilt (create, copy, drop, rename) with foreign keys disabled by the runner.
// Legacy JSON documents are upgraded when read (upgradeTournament), not rewritten here.
export const migration2 = `
CREATE TABLE tournaments_v2 (id TEXT PRIMARY KEY, event_id TEXT REFERENCES events(id), name TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('QUICK_HIGH_SCORE','GROUPS','SINGLE_MATCH')), status TEXT NOT NULL CHECK(status IN ('draft','registration','ready','active','paused','completed','cancelled')), version INTEGER NOT NULL CHECK(version>=0), data TEXT NOT NULL CHECK(json_valid(data)));
INSERT INTO tournaments_v2 (id, event_id, name, mode, status, version, data) SELECT id, event_id, name, mode, status, version, data FROM tournaments;
DROP TABLE tournaments;
ALTER TABLE tournaments_v2 RENAME TO tournaments;
CREATE INDEX tournaments_event_idx ON tournaments(event_id);
CREATE INDEX tournaments_status_idx ON tournaments(status);
`;
