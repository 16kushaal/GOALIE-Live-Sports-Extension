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
    league_id VARCHAR(3) REFERENCES leagues(id)
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

-- Insert sample data with new IDs
INSERT INTO leagues (id, name) VALUES 
('EP', 'English Premier League'), 
('LL', 'LaLiga'), 
('BL', 'Bundesliga');

INSERT INTO teams (id, name, league_id) VALUES 
('EP001', 'Arsenal', 'EP'), 
('EP002', 'Man City', 'EP'), 
('LL001', 'Real Madrid', 'LL'), 
('LL002', 'Barcelona', 'LL'),
('BL001', 'Bayern Munich', 'BL');

INSERT INTO matches (id, home_team_id, away_team_id, match_time, status)
VALUES 
('EP25001', 'EP001', 'EP002', NOW() - INTERVAL '10 minutes', 'LIVE'),
('LL25001', 'LL001', 'LL002', NOW() + INTERVAL '2 hours', 'SCHEDULED'),
('BL25001', 'BL001', NULL, NOW() + INTERVAL '1 day', 'SCHEDULED');