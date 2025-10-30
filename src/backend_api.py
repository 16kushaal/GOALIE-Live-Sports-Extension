import eventlet
eventlet.monkey_patch()

import os
import json
import threading
import logging
from flask import Flask, jsonify, request, session
from flask_socketio import SocketIO, join_room, leave_room
from kafka import KafkaConsumer
from dotenv import load_dotenv
import psycopg2
import psycopg2.extras # for dict cursor

# --- NEW IMPORTS ---
from flask_cors import CORS
from flask_bcrypt import Bcrypt
from flask_jwt_extended import create_access_token, get_jwt_identity, jwt_required, JWTManager, decode_token

# --- Configuration ---
load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- App Setup ---
app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}}) 
app.config["JWT_SECRET_KEY"] = os.getenv("JWT_SECRET_KEY")
jwt = JWTManager(app)
bcrypt = Bcrypt(app)
socketio = SocketIO(app, async_mode='eventlet', cors_allowed_origins="*")

# --- Kafka Setup ---
KAFKA_BROKER = '127.0.0.1:9092'
SNIPPET_TOPIC = 'snippets_processed'
EVENT_TOPIC = 'match_events'
TIME_TOPIC = 'classified_commentary' # --- NEW: Topic for live time updates

# --- Database Setup ---
def get_db_connection():
    try:
        conn = psycopg2.connect(
            host=os.getenv('POSTGRES_HOST'),
            database=os.getenv('POSTGRES_DB'),
            user=os.getenv('POSTGRES_USER'),
            password=os.getenv('POSTGRES_PASSWORD'),
            cursor_factory=psycopg2.extras.DictCursor
        )
        return conn
    except Exception as e:
        logger.error(f"Error connecting to database: {e}")
        return None

# --- Auth REST Endpoints ---
@app.route('/register', methods=['POST'])
def register():
    # ... (code is correct and unchanged)
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
        if conn: conn.close()

@app.route('/login', methods=['POST'])
def login():
    # ... (code is correct and unchanged)
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
            access_token = create_access_token(identity=str(user['id']))
            return jsonify(access_token=access_token), 200
        else:
            return jsonify({"error": "Invalid email or password"}), 401
    except Exception as e:
        logger.error(f"Login error: {e}")
        return jsonify({"error": "Login failed"}), 500
    finally:
        if conn: conn.close()

# --- Match & Team Endpoints ---
@app.route('/matches', methods=['GET'])
def get_matches():
    # ... (code is correct and unchanged)
    conn = get_db_connection()
    if not conn: return jsonify({"error": "Database connection failed"}), 500
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT m.id, m.status, m.score, m.match_time,
                       m.home_team_id, m.away_team_id,
                       t1.name as home_team, t1.logo_url as home_logo, t1.league_id as home_league_id,
                       t2.name as away_team, t2.logo_url as away_logo, t2.league_id as away_league_id
                FROM matches m
                LEFT JOIN teams t1 ON m.home_team_id = t1.id
                LEFT JOIN teams t2 ON m.away_team_id = t2.id
                ORDER BY m.match_time
                """
            )
            matches = [dict(row) for row in cur.fetchall()]
            for m in matches:
                m['match_time'] = m['match_time'].isoformat()
            return jsonify(matches)
    except Exception as e:
        logger.error(f"Error fetching matches: {e}")
        return jsonify({"error": "Failed to fetch matches"}), 500
    finally:
        if conn: conn.close()

@app.route('/my-matches', methods=['GET'])
@jwt_required()
def get_my_matches():
    # ... (code is correct and unchanged)
    user_id = get_jwt_identity()
    conn = get_db_connection()
    if not conn: return jsonify({"error": "Database connection failed"}), 500
    try:
        with conn.cursor() as cur:
             cur.execute("SELECT team_id FROM user_favorite_teams WHERE user_id = %s", (user_id,))
             followed_team_ids = {row['team_id'] for row in cur.fetchall()}
             cur.execute(
                """
                SELECT m.id, m.status, m.score, m.match_time,
                       m.home_team_id, m.away_team_id,
                       t1.name as home_team, t1.logo_url as home_logo, t1.league_id as home_league_id,
                       t2.name as away_team, t2.logo_url as away_logo, t2.league_id as away_league_id
                FROM matches m
                LEFT JOIN teams t1 ON m.home_team_id = t1.id
                LEFT JOIN teams t2 ON m.away_team_id = t2.id
                WHERE m.home_team_id = ANY(SELECT team_id FROM user_favorite_teams WHERE user_id = %s)
                   OR m.away_team_id = ANY(SELECT team_id FROM user_favorite_teams WHERE user_id = %s)
                ORDER BY m.match_time
                """, (user_id, user_id)
             )
             matches = [dict(row) for row in cur.fetchall()]
             for m in matches:
                m['match_time'] = m['match_time'].isoformat()
             return jsonify({
                 "matches": matches,
                 "followed_team_ids": list(followed_team_ids)
             })
    except Exception as e:
        logger.error(f"Error fetching my-matches: {e}")
        return jsonify({"error": "Failed to fetch matches"}), 500
    finally:
        if conn: conn.close()

@app.route('/my-teams', methods=['GET'])
@jwt_required()
def get_my_teams():
    # ... (code is correct and unchanged)
    user_id = get_jwt_identity()
    conn = get_db_connection()
    if not conn: return jsonify({"error": "Database connection failed"}), 500
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT team_id FROM user_favorite_teams WHERE user_id = %s", (user_id,))
            followed_team_ids = [row['team_id'] for row in cur.fetchall()]
            return jsonify(followed_team_ids)
    except Exception as e:
        logger.error(f"Error fetching my-teams: {e}")
        return jsonify({"error": "Failed to fetch followed teams"}), 500
    finally:
        if conn: conn.close()

@app.route('/teams', methods=['GET'])
def get_all_teams():
    # ... (code is correct and unchanged)
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, name, logo_url FROM teams")
            teams = [dict(row) for row in cur.fetchall()]
            return jsonify(teams)
    finally:
        if conn: conn.close()

@app.route('/follow', methods=['POST'])
@jwt_required()
def follow_team():
    # ... (code is correct and unchanged)
    user_id = get_jwt_identity()
    team_id = request.json.get('team_id')
    if not team_id:
        return jsonify({"error": "team_id required"}), 400
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
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
        if conn: conn.close()

@app.route('/unfollow', methods=['DELETE'])
@jwt_required()
def unfollow_team():
    # ... (code is correct and unchanged)
    user_id = get_jwt_identity()
    team_id = request.json.get('team_id')
    if not team_id:
        return jsonify({"error": "team_id required"}), 400
    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500
    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM user_favorite_teams WHERE user_id = %s AND team_id = %s",
                (user_id, team_id)
            )
            conn.commit()
            if cur.rowcount > 0:
                logger.info(f"User {user_id} unfollowed team {team_id}")
                return jsonify({"message": f"Successfully unfollowed team {team_id}"}), 200
            else:
                logger.warning(f"User {user_id} tried to unfollow team {team_id}, but was not following.")
                return jsonify({"message": "Not following this team"}), 200
    except Exception as e:
        conn.rollback()
        logger.error(f"Unfollow error: {e}")
        return jsonify({"error": "Could not unfollow team"}), 500
    finally:
        if conn: conn.close()

# --- WebSocket Handlers ---

@socketio.on('connect')
def handle_connect():
    # ... (code is correct and unchanged)
    token = request.args.get('token')
    if not token:
        logger.warning("Client connected without token. Disconnecting.")
        return False
    try:
        user_identity = decode_token(token)['sub']
        session['user_id'] = user_identity 
        logger.info(f"Client {request.sid} connected, user_id: {user_identity}")
    except Exception as e:
        logger.warning(f"Client connection failed (invalid token?): {e}")
        return False

@socketio.on('disconnect')
def handle_disconnect():
    logger.info(f"Client disconnected: {request.sid}")

@socketio.on('join_match')
def handle_join_match(data):
    # ... (code is correct and unchanged)
    try:
        user_id = session.get('user_id')
        if not user_id:
            logger.warning(f"Unauthenticated client {request.sid} tried to join room.")
            return
        match_id = data['match_id']
        room = f"match_{match_id}"
        join_room(room)
        logger.info(f"Client {request.sid} (User {user_id}) joined room: {room}")
        socketio.emit('joined_room', {'room': room}, to=request.sid)
    except Exception as e:
        logger.error(f"Error in join_match: {e}")


# --- Kafka Consumer Threads ---

def start_kafka_consumer(topic, handler_function, group_id):
    # ... (code is correct and unchanged)
    logger.info(f"Initializing consumer thread for topic: {topic}")
    try:
        consumer = KafkaConsumer(
            topic,
            bootstrap_servers=[KAFKA_BROKER],
            auto_offset_reset='latest', # Use latest to avoid old messages
            group_id=group_id,
            value_deserializer=lambda v: json.loads(v.decode('utf-8'))
        )
        logger.info(f"Consumer started for topic: {topic}")
        for message in consumer:
            # logger.info(f"Received message from {topic}") # Optional: reduce log noise
            handler_function(message.value)
    except Exception as e:
        logger.error(f"Kafka consumer for {topic} failed: {e}")

# --- NEW: Handler for continuous time updates ---
def handle_time_update(data):
    """
    Handles raw classified commentary to emit only time updates.
    """
    try:
        match_id = data.get('match_id')
        match_time = data.get('time')
        
        if not match_id or not match_time:
            return # Ignore messages without ID or time

        room = f"match_{match_id}"
        # Emit a small, dedicated 'time_update' event
        socketio.emit('time_update', {"match_id": match_id, "time": match_time}, room=room)
        
    except Exception as e:
        logger.error(f"Error handling time update: {e}")

# --- Snippet handler (NO CHANGE, it doesn't send time anymore) ---
def handle_snippet_message(data):
    try:
        match_id = data['match_id']
        room = f"match_{match_id}"
        # logger.info(f"Emitting 'new_snippet' to room {room}") # Optional: reduce log noise
        socketio.emit('new_snippet', data, room=room)
    except Exception as e:
        logger.error(f"Error handling snippet: {e}")

# --- MODIFIED: Event handler (score/status update logic) ---
def handle_event_message(data):
    """
    Handles incoming match events from Kafka.
    Updates DB score/status on GOAL, KICK_OFF, etc.
    Emits the event data via WebSocket.
    """
    try:
        match_id = data.get('match_id')
        event_type = data.get('event_type')
        score = data.get('score')
        match_time = data.get('time')

        if not match_id:
            logger.warning("Received event message without match_id")
            return

        conn = None 
        new_status = None
        update_score = False

        if event_type == 'KICK_OFF' or event_type == 'SECOND_HALF_KICK_OFF':
            new_status = 'LIVE'
            # Reset score to 0-0 ONLY at the *first* kick-off
            if event_type == 'KICK_OFF':
                score = '0-0'
                data['score'] = score # Ensure '0-0' is in the data sent to UI
            update_score = True # Update score in DB (either to 0-0 or to existing score if 2nd half)
        elif event_type == 'GOAL':
            new_status = 'LIVE'
            update_score = True # A goal event *always* updates the score
        elif event_type == 'HALF_TIME':
            new_status = 'HALF_TIME'
        elif event_type == 'FULL_TIME':
            new_status = 'FINISHED'
        
        # Update database if score or status changed
        if new_status or update_score:
            conn = get_db_connection()
            if conn:
                try:
                    with conn.cursor() as cur:
                        if new_status and update_score: # e.g., KICK_OFF or GOAL
                            cur.execute("UPDATE matches SET status = %s, score = %s WHERE id = %s", (new_status, score, match_id))
                        elif new_status: # e.g., HALF_TIME, FULL_TIME (no score change)
                            cur.execute("UPDATE matches SET status = %s WHERE id = %s", (new_status, match_id))
                        elif update_score: # e.g. GOAL (status was already LIVE)
                             cur.execute("UPDATE matches SET score = %s WHERE id = %s", (score, match_id))
                        conn.commit()
                    logger.info(f"Updated DB for match {match_id} (Status: {new_status}, Score: {score})")
                except Exception as e:
                    conn.rollback()
                    logger.error(f"Failed to update DB for match {match_id}: {e}")
                finally:
                    if conn: conn.close()
            
        # Emit the full event data to the WebSocket room
        room = f"match_{match_id}"
        logger.info(f"Emitting 'new_event' to room {room} with data: {data}")
        socketio.emit('new_event', data, room=room)

    except Exception as e:
        logger.error(f"Error handling event message: {e} | Data: {data}")

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
    # --- NEW: Thread for time updates ---
    time_thread = threading.Thread(
        target=start_kafka_consumer,
        args=(TIME_TOPIC, handle_time_update, 'backend-time-group'),
        daemon=True
    )
    
    snippet_thread.start()
    event_thread.start()
    time_thread.start() # --- NEW: Start the time thread ---
    
    logger.info("Starting SocketIO server on http://localhost:5000")
    socketio.run(app, host='0.0.0.0', port=5000)
