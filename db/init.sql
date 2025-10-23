-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Teams table
CREATE TABLE IF NOT EXISTS teams (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    league VARCHAR(50) NOT NULL
);

-- Matches table
CREATE TABLE IF NOT EXISTS matches (
    match_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    home_team_id INT REFERENCES teams(id),
    away_team_id INT REFERENCES teams(id),
    league VARCHAR(50),
    start_time TIMESTAMPTZ,
    status VARCHAR(20) DEFAULT 'scheduled'
);

-- User favorites / subscriptions
CREATE TABLE IF NOT EXISTS user_favorites (
    user_id INT REFERENCES users(id),
    team_id INT REFERENCES teams(id),
    PRIMARY KEY(user_id, team_id)
);
