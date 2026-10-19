// Competition entries: a team holds several players, each in one unit per tournament. The
// members table carries that constraint (the entry row keeps its first player for the existing
// references) and lets a member's history be found. Existing entries are singles: their player
// is their only member. JSON documents are upgraded when read (upgradeTournament).
export const migration3 = `
CREATE TABLE entry_members (tournament_id TEXT NOT NULL REFERENCES tournaments(id), entry_id TEXT NOT NULL, player_id TEXT NOT NULL REFERENCES players(id), position INTEGER NOT NULL CHECK(position>0), PRIMARY KEY(entry_id,player_id), UNIQUE(tournament_id,player_id), UNIQUE(entry_id,position), FOREIGN KEY(entry_id,tournament_id) REFERENCES tournament_entries(id,tournament_id) ON DELETE CASCADE);
CREATE INDEX entry_members_player_idx ON entry_members(player_id);
INSERT INTO entry_members (tournament_id, entry_id, player_id, position) SELECT tournament_id, id, player_id, 1 FROM tournament_entries;
`;
