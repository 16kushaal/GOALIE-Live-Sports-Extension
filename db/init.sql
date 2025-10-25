-- Users table (Plaintext Password)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL, -- Plaintext password column
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Teams table
CREATE TABLE IF NOT EXISTS teams (
    id VARCHAR(10) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    league VARCHAR(50) NOT NULL,
    logo_url TEXT -- Added logo URL
);

-- Matches table
CREATE TABLE IF NOT EXISTS matches (
    match_id VARCHAR(20) PRIMARY KEY,
    home_team_id VARCHAR(10) REFERENCES teams(id),
    away_team_id VARCHAR(10) REFERENCES teams(id),
    league VARCHAR(50),
    start_time TIMESTAMPTZ,
    status VARCHAR(20) DEFAULT 'scheduled'
);

-- User favorites
CREATE TABLE IF NOT EXISTS user_favorites (
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    team_id VARCHAR(10) REFERENCES teams(id) ON DELETE CASCADE,
    PRIMARY KEY(user_id, team_id)
);

-- --- INDEXES ---
CREATE INDEX IF NOT EXISTS idx_matches_status_start_time ON matches(status, start_time);
CREATE INDEX IF NOT EXISTS idx_user_favorites_team_id ON user_favorites(team_id);

-- --- SAMPLE DATA ---

-- Teams
INSERT INTO teams (id, name, league, logo_url) VALUES
('E001', 'Manchester United', 'Premier League', 'https://upload.wikimedia.org/wikipedia/en/thumb/7/7a/Manchester_United_FC_crest.svg/1200px-Manchester_United_FC_crest.svg.png'),
('E002', 'Liverpool', 'Premier League', 'https://upload.wikimedia.org/wikipedia/en/thumb/0/0c/Liverpool_FC.svg/1200px-Liverpool_FC.svg.png'),
('L001', 'Real Madrid', 'La Liga', 'https://upload.wikimedia.org/wikipedia/en/thumb/5/56/Real_Madrid_CF.svg/1200px-Real_Madrid_CF.svg.png'),
('L002', 'Barcelona', 'La Liga', 'https://upload.wikimedia.org/wikipedia/en/thumb/4/47/FC_Barcelona_%28crest%29.svg/1200px-FC_Barcelona_%28crest%29.svg.png'),
('B001', 'Bayern Munich', 'Bundesliga', 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/FC_Bayern_M%C3%BCnchen_logo_%282017%29.svg/1200px-FC_Bayern_M%C3%BCnchen_logo_%282017%29.svg.png');

-- Users (Password 'password123' plaintext)
INSERT INTO users (username, email, password) VALUES
('testuser', 'test@user.com', 'password123');

-- Matches
INSERT INTO matches (match_id, home_team_id, away_team_id, league, start_time, status) VALUES
('EP25001', 'E001', 'E002', 'Premier League', NOW() - INTERVAL '1 hour', 'live'),
('LL25001', 'L001', 'L002', 'La Liga', NOW() + INTERVAL '1 day', 'scheduled'),
('BL25001', 'B001', 'E001', 'Bundesliga', NOW() - INTERVAL '2 day', 'completed');

-- Favorites
-- Ensure user_id matches the one created above (it will be 1 if starting fresh)
INSERT INTO user_favorites (user_id, team_id) VALUES (1, 'E001');