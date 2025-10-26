import eventlet
eventlet.monkey_patch()

import os
import json
import threading
import logging
from flask import Flask, jsonify, request
from flask_socketio import SocketIO, join_room, leave_room
from kafka import KafkaConsumer
from dotenv import load_dotenv
import psycopg2
import psycopg2.extras # for dict cursor

# --- NEW IMPORTS ---
from flask_cors import CORS           # For security
from flask_bcrypt import Bcrypt        # For hashing passwords
from flask_jwt_extended import create_access_token, get_jwt_identity, jwt_required, JWTManager, decode_token
from flask import Flask, jsonify, request, session # Make sure session is imported

# --- Configuration ---
load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- App Setup ---
app = Flask(__name__)

# --- NEW CONFIG ---
# This is required for your extension (chrome-extension://...) to talk to localhost
CORS(app, resources={r"/*": {"origins": "*"}}) 

# Setup the JWT token manager
app.config["JWT_SECRET_KEY"] = os.getenv("JWT_SECRET_KEY")
jwt = JWTManager(app)

# Setup the password hasher
bcrypt = Bcrypt(app)

# Setup SocketIO
socketio = SocketIO(app, async_mode='eventlet', cors_allowed_origins="*")
# --- END NEW CONFIG ---

# --- Kafka Setup ---
KAFKA_BROKER = '127.0.0.1:9092' # Use IP, not localhost
SNIPPET_TOPIC = 'snippets_processed'
EVENT_TOPIC = 'match_events'

# --- Database Setup ---
def get_db_connection():
    try:
        conn = psycopg2.connect(
            host=os.getenv('POSTGRES_HOST'),
            database=os.getenv('POSTGRES_DB'),
            user=os.getenv('POSTGRES_USER'),
            password=os.getenv('POSTGRES_PASSWORD'),
            cursor_factory=psycopg2.extras.DictCursor # Use DictCursor
        )
        return conn
    except Exception as e:
        logger.error(f"Error connecting to database: {e}")
        return None

# --- NEW: Auth REST Endpoints ---

@app.route('/register', methods=['POST'])
def register():
    data = request.json
    email = data.get('email')
    password = data.get('password')

    if not email or not password:
        return jsonify({"error": "Email and password required"}), 400

    hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')
    
    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500
        
    try:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO users (email, password_hash) VALUES (%s, %s)",
                        (email, hashed_password))
            conn.commit()
        return jsonify({"message": "User registered successfully"}), 201
    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        return jsonify({"error": "Email already exists"}), 409
    except Exception as e:
        conn.rollback()
        logger.error(f"Register error: {e}")
        return jsonify({"error": "Registration failed"}), 500
    finally:
        conn.close()

@app.route('/login', methods=['POST'])
def login():
    data = request.json
    email = data.get('email')
    password = data.get('password')

    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500

    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, password_hash FROM users WHERE email = %s", (email,))
            user = cur.fetchone()

        if user and bcrypt.check_password_hash(user['password_hash'], password):
            # Create a token. We store the user's ID (user['id']) in the token
            access_token = create_access_token(identity=str(user['id']))
            return jsonify(access_token=access_token), 200
        else:
            return jsonify({"error": "Invalid email or password"}), 401
    except Exception as e:
        logger.error(f"Login error: {e}")
        return jsonify({"error": "Login failed"}), 500
    finally:
        conn.close()

# --- MODIFIED: Match & Team Endpoints ---

@app.route('/matches', methods=['GET'])
def get_matches():
    """Fetches ALL matches (for the 'All Matches' tab)."""
    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500
        
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT m.id, m.status, m.score, m.match_time,
                       t1.name as home_team, t1.logo_url as home_logo,
                       t2.name as away_team, t2.logo_url as away_logo
                FROM matches m
                LEFT JOIN teams t1 ON m.home_team_id = t1.id
                LEFT JOIN teams t2 ON m.away_team_id = t2.id
                ORDER BY m.match_time
                """
            )
            matches = [dict(row) for row in cur.fetchall()]
            for m in matches: # Convert datetime to string
                m['match_time'] = m['match_time'].isoformat()
            return jsonify(matches)
    except Exception as e:
        logger.error(f"Error fetching matches: {e}")
        return jsonify({"error": "Failed to fetch matches"}), 500
    finally:
        conn.close()

@app.route('/my-matches', methods=['GET'])
@jwt_required() # This route is now protected
def get_my_matches():
    """Fetches ONLY favorite matches (for the 'Favorites' tab)."""
    user_id = get_jwt_identity() # Get user ID from their token
    
    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500
        
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT m.id, m.status, m.score, m.match_time,
                       t1.name as home_team, t1.logo_url as home_logo,
                       t2.name as away_team, t2.logo_url as away_logo
                FROM matches m
                JOIN teams t1 ON m.home_team_id = t1.id
                JOIN teams t2 ON m.away_team_id = t2.id
                WHERE m.home_team_id IN (SELECT team_id FROM user_favorite_teams WHERE user_id = %s)
                   OR m.away_team_id IN (SELECT team_id FROM user_favorite_teams WHERE user_id = %s)
                ORDER BY m.match_time
                """, (user_id, user_id)
            )
            matches = [dict(row) for row in cur.fetchall()]
            for m in matches:
                m['match_time'] = m['match_time'].isoformat()
            return jsonify(matches)
    except Exception as e:
        logger.error(f"Error fetching my-matches: {e}")
        return jsonify({"error": "Failed to fetch matches"}), 500
    finally:
        conn.close()


@app.route('/teams', methods=['GET'])
def get_all_teams():
    """Fetches ALL teams (for the 'Search' tab)."""
    conn = get_db_connection()
    # ... (Error handling) ...
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, name, logo_url FROM teams")
            teams = [dict(row) for row in cur.fetchall()]
            return jsonify(teams)
    finally:
        conn.close()

@app.route('/follow', methods=['POST'])
@jwt_required() # This route is protected
def follow_team():
    user_id = get_jwt_identity()
    team_id = request.json.get('team_id')

    if not team_id:
        return jsonify({"error": "team_id required"}), 400

    conn = get_db_connection()
    # ... (Error handling) ...
    try:
        with conn.cursor() as cur:
            # Using "ON CONFLICT DO NOTHING" avoids duplicates
            cur.execute(
                "INSERT INTO user_favorite_teams (user_id, team_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                (user_id, team_id)
            )
            conn.commit()
        return jsonify({"message": f"User {user_id} now following team {team_id}"}), 201
    except Exception as e:
        conn.rollback()
        logger.error(f"Follow error: {e}")
        return jsonify({"error": "Could not follow team"}), 500
    finally:
        conn.close()

# --- MODIFIED: WebSocket Handlers ---
# We will store the user's ID on their socket connection
# to ensure they are authenticated

@socketio.on('connect')
def handle_connect():
    """
    New connect handler. Client sends token in the query.
    """
    token = request.args.get('token')
    if not token:
        logger.warning("Client connected without token. Disconnecting.")
        return False # Disconnects the user

    try:
        user_identity = decode_token(token)['sub']
        
        # --- THIS MUST BE session['user_id'] ---
        session['user_id'] = user_identity 
        # --- END FIX ---
        
        logger.info(f"Client {request.sid} connected, user_id: {user_identity}")
        
    except Exception as e:
        logger.warning(f"Client connection failed (invalid token?): {e}")
        return False # Disconnects the user

@socketio.on('disconnect')
def handle_disconnect():
    logger.info(f"Client disconnected: {request.sid}")

@socketio.on('join_match')
def handle_join_match(data):
    """
    User joins a match room.
    """
    try:
        # --- THIS MUST READ FROM session ---
        user_id = session.get('user_id')
        if not user_id:
        # --- END FIX ---
            logger.warning(f"Unauthenticated client {request.sid} tried to join room.")
            return

        match_id = data['match_id']
        room = f"match_{match_id}"
        join_room(room)
        
        # --- THIS MUST USE THE user_id VARIABLE ---
        logger.info(f"Client {request.sid} (User {user_id}) joined room: {room}")
        # --- END FIX ---
            
        socketio.emit('joined_room', {'room': room}, to=request.sid)
    except Exception as e:
        logger.error(f"Error in join_match: {e}")


# --- Kafka Consumer Threads (Unchanged, but with the 'room=room' fix) ---

def start_kafka_consumer(topic, handler_function, group_id):
    logger.info(f"Initializing consumer thread for topic: {topic}")
    try:
        consumer = KafkaConsumer(
            topic,
            bootstrap_servers=[KAFKA_BROKER],
            auto_offset_reset='latest',
            group_id=group_id,
            value_deserializer=lambda v: json.loads(v.decode('utf-8'))
        )
        logger.info(f"Consumer started for topic: {topic}")
        for message in consumer:
            logger.info(f"Received message from {topic}")
            handler_function(message.value)
    except Exception as e:
        logger.error(f"Kafka consumer for {topic} failed: {e}")

def handle_snippet_message(data):
    try:
        match_id = data['match_id']
        room = f"match_{match_id}"
        logger.info(f"Emitting 'new_snippet' to room {room}")
        socketio.emit('new_snippet', data, room=room) # <-- Use room=room
    except Exception as e:
        logger.error(f"Error handling snippet: {e}")

def handle_event_message(data):
    try:
        match_id = data['match_id']
        room = f"match_{match_id}"
        logger.info(f"Emitting 'new_event' to room {room}")
        socketio.emit('new_event', data, room=room) # <-- Use room=room
    except Exception as e:
        logger.error(f"Error handling event: {e}")

# --- Main Execution ---

if __name__ == "__main__":
    logger.info("Starting backend server...")
    
    snippet_thread = threading.Thread(
        target=start_kafka_consumer,
        args=(SNIPPET_TOPIC, handle_snippet_message, 'backend-snippet-group'),
        daemon=True
    )
    event_thread = threading.Thread(
        target=start_kafka_consumer,
        args=(EVENT_TOPIC, handle_event_message, 'backend-event-group'),
        daemon=True
    )
    
    snippet_thread.start()
    event_thread.start()
    
    logger.info("Starting SocketIO server on http://localhost:5000")
    # Run the app with SocketIO
    socketio.run(app, host='0.0.0.0', port=5000)