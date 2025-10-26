-- Set ID columns to appropriate VARCHAR lengths
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
);

CREATE TABLE leagues (
    id VARCHAR(3) PRIMARY KEY, -- EP, LL, BL
    name TEXT NOT NULL
);

CREATE TABLE teams (
    id VARCHAR(10) PRIMARY KEY, -- EP001, LL001
    name TEXT NOT NULL,
    league_id VARCHAR(3) REFERENCES leagues(id),
    logo_url TEXT -- NEW: Added for logos
);

CREATE TABLE matches (
    id VARCHAR(10) PRIMARY KEY, -- EP25001
    home_team_id VARCHAR(10) REFERENCES teams(id),
    away_team_id VARCHAR(10) REFERENCES teams(id),
    match_time TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'SCHEDULED',
    score TEXT
);

CREATE TABLE user_favorite_teams (
    user_id INT REFERENCES users(id),
    team_id VARCHAR(10) REFERENCES teams(id),
    PRIMARY KEY (user_id, team_id)
);

-- Insert sample data for leagues and teams
INSERT INTO leagues (id, name) VALUES 
('EP', 'English Premier League'), 
('LL', 'LaLiga'), 
('BL', 'Bundesliga');

INSERT INTO teams (id, name, league_id, logo_url) VALUES 
('EP001', 'Arsenal', 'EP', 'https://upload.wikimedia.org/wikipedia/en/5/53/Arsenal_FC.svg'), 
('EP002', 'Man City', 'EP', 'https://upload.wikimedia.org/wikipedia/en/e/eb/Manchester_City_FC_badge.svg'), 
('LL001', 'Real Madrid', 'LL', 'https://upload.wikimedia.org/wikipedia/en/5/56/Real_Madrid_CF.svg'), 
('LL002', 'Barcelona', 'LL', 'https://upload.wikimedia.org/wikipedia/en/4/47/FC_Barcelona_%28crest%29.svg'),
('BL001', 'Bayern Munich', 'BL', 'https://upload.wikimedia.org/wikipedia/commons/1/1b/FC_Bayern_M%C3%BCnchen_logo_%282017%29.svg');

-- Insert sample matches
INSERT INTO matches (id, home_team_id, away_team_id, match_time, status)
VALUES 
('EP25001', 'EP001', 'EP002', NOW() - INTERVAL '10 minutes', 'LIVE'),
('LL25001', 'LL001', 'LL002', NOW() + INTERVAL '2 hours', 'SCHEDULED'),
('BL25001', 'BL001', NULL, NOW() + INTERVAL '1 day', 'SCHEDULED');

-- ---------------------------------------------------
-- NEW: ADDED SAMPLE USER DATA
-- ---------------------------------------------------

-- Add a test user. User ID will be 1.
-- The password is: password123
INSERT INTO users (email, password_hash) VALUES 
('user@example.com', '$2b$12$Ea/7f.2a.m2.09.u.U0kP.e.a.d.w.S.L.D.g.O.s.A.X.y.O.Q.S.C');

-- Make the test user (ID 1) follow Arsenal (ID 'EP001')
INSERT INTO user_favorite_teams (user_id, team_id) VALUES
(1, 'EP001');