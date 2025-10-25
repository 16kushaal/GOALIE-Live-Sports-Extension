-- Users table (No changes needed)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Teams table (Changed id to VARCHAR)
CREATE TABLE IF NOT EXISTS teams (
    id VARCHAR(10) PRIMARY KEY, -- Changed from SERIAL
    name VARCHAR(100) NOT NULL,
    league VARCHAR(50) NOT NULL
);

-- Matches table (Changed match_id and team references to VARCHAR)
CREATE TABLE IF NOT EXISTS matches (
    match_id VARCHAR(20) PRIMARY KEY, -- Changed from UUID
    home_team_id VARCHAR(10) REFERENCES teams(id), -- Changed from INT
    away_team_id VARCHAR(10) REFERENCES teams(id), -- Changed from INT
    league VARCHAR(50),
    start_time TIMESTAMPTZ,
    status VARCHAR(20) DEFAULT 'scheduled'
);

-- User favorites (Changed team_id reference to VARCHAR)
CREATE TABLE IF NOT EXISTS user_favorites (
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    team_id VARCHAR(10) REFERENCES teams(id) ON DELETE CASCADE, -- Changed from INT
    PRIMARY KEY(user_id, team_id)
);

-- --- SAMPLE DATA ---

-- Insert sample teams
INSERT INTO teams (id, name, league) VALUES
('E001', 'Manchester United', 'Premier League'),
('E002', 'Liverpool', 'Premier League'),
('L001', 'Real Madrid', 'La Liga'),
('L002', 'Barcelona', 'La Liga'),
('B001', 'Bayern Munich', 'Bundesliga');

-- Insert sample users (plaintext passwords)
INSERT INTO users (username, email, password) VALUES
('testuser', 'test@user.com', 'password123'),
('anotheruser', 'another@user.com', 'pass456');

-- Insert sample matches
INSERT INTO matches (match_id, home_team_id, away_team_id, league, start_time, status)
VALUES
('EP25001', 'E001', 'E002', 'Premier League', NOW() - INTERVAL '1 hour', 'live'), -- A live match
('LL25001', 'L001', 'L002', 'La Liga', NOW() + INTERVAL '1 day', 'scheduled'), -- A future match
('BL25001', 'B001', 'E001', 'Bundesliga', NOW() - INTERVAL '2 day', 'completed'); -- A past match

-- Insert sample user favorites
INSERT INTO user_favorites (user_id, team_id) VALUES
(1, 'E001'), -- testuser likes Manchester United
(1, 'L001'), -- testuser also likes Real Madrid
(2, 'L002'); -- anotheruser likes Barcelona

-- OLD SCHEMA FOR REFERENCE

-- -- Users table
-- CREATE TABLE IF NOT EXISTS users (
--     id SERIAL PRIMARY KEY,
--     username VARCHAR(50) UNIQUE NOT NULL,
--     email VARCHAR(100) UNIQUE NOT NULL,
--     password_hash VARCHAR(255) NOT NULL,
--     created_at TIMESTAMPTZ DEFAULT NOW()
-- );

-- -- Teams table
-- CREATE TABLE IF NOT EXISTS teams (
--     id SERIAL PRIMARY KEY,
--     name VARCHAR(100) NOT NULL,
--     league VARCHAR(50) NOT NULL
-- );

-- -- Matches table
-- CREATE TABLE IF NOT EXISTS matches (
--     match_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--     home_team_id INT REFERENCES teams(id),
--     away_team_id INT REFERENCES teams(id),
--     league VARCHAR(50),
--     start_time TIMESTAMPTZ,
--     status VARCHAR(20) DEFAULT 'scheduled'
-- );

-- -- User favorites / subscriptions
-- CREATE TABLE IF NOT EXISTS user_favorites (
--     user_id INT REFERENCES users(id),
--     team_id INT REFERENCES teams(id),
--     PRIMARY KEY(user_id, team_id)
-- );
