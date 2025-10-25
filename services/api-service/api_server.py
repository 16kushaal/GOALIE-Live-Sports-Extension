# [FIX 1] Eventlet must be imported and run FIRST
import eventlet
eventlet.monkey_patch()

# All other imports now come AFTER monkey-patching
import os
import threading
import json
import time
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO, join_room, leave_room
from confluent_kafka import Consumer
import psycopg2
from psycopg2.extras import RealDictCursor
from flask_bcrypt import Bcrypt
from flask_jwt_extended import create_access_token, get_jwt_identity, jwt_required, JWTManager
import redis

# --- 1. App & Security Setup ---
app = Flask(__name__)
CORS(app) 
app.config['SECRET_KEY'] = 'your-super-secret-key!'
app.config['JWT_SECRET_KEY'] = 'your-jwt-secret-key!'
bcrypt = Bcrypt(app)
jwt = JWTManager(app)
socketio = SocketIO(app, async_mode='eventlet', cors_allowed_origins="*")

# --- 2. Connection Config ---
KAFKA_SERVER = '127.0.0.1:9092'
DB_CONN_STRING = "postgresql://admin:admin@127.0.0.1:5432/goalie"

# Connect to Redis
try:
    redis_client = redis.Redis(host='127.0.0.1', port=6379, decode_responses=True)
    redis_client.ping()
    print("[REDIS] Connected to Redis at 127.0.0.1:6379")
except Exception as e:
    print(f"[REDIS ERROR] Could not connect: {e}")
    redis_client = None

# =================================================================
# 3. Helper Functions (Unchanged)
# =================================================================
def get_db_connection():
    return psycopg2.connect(DB_CONN_STRING)

def query_db(query, args=(), fetch_one=False):
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute(query, args)
        if fetch_one:
            result = cursor.fetchone()
        else:
            result = cursor.fetchall()
        conn.commit()
        cursor.close()
        return result
    except Exception as e:
        print(f"[DB ERROR] {e}")
        if conn: conn.rollback()
        return None
    finally:
        if conn: conn.close()

def get_match_query():
    return """
        SELECT 
            m.match_id, m.league, m.status, m.start_time,
            ht.name AS home_team_name, ht.logo_url AS home_team_logo,
            at.name AS away_team_name, at.logo_url AS away_team_logo
        FROM matches m
        JOIN teams ht ON m.home_team_id = ht.id
        JOIN teams at ON m.away_team_id = at.id
    """

# =================================================================
# 4. Auth Endpoints
# =================================================================
@app.route('/api/register', methods=['POST'])
def register():
    # ... (this function is fine)
    pass 

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')

    user = query_db("SELECT * FROM users WHERE email = %s", (email,), fetch_one=True)

    if not user:
        print("[LOGIN DEBUG] User not found in database.")
        return jsonify({"msg": "Bad email or password"}), 401

    # [FIX 1] Strip any hidden whitespace from the hash
    db_hash = user['password_hash'].strip() 
    
    check_result = bcrypt.check_password_hash(db_hash, password)

    print("\n--- LOGIN ATTEMPT ---")
    print(f"[DEBUG] Password from UI: '{password}'")
    print(f"[DEBUG] Hash from DB:     '{db_hash}' (Stripped)")
    print(f"[DEBUG] Check Result:     {check_result}")
    print("---------------------\n")

    if check_result:
        access_token = create_access_token(identity={'id': user['id'], 'username': user['username']})
        return jsonify(access_token=access_token), 200
    else:
        return jsonify({"msg": "Bad email or password"}), 401

# =================================================================
# 5. Match Data Endpoints (Unchanged)
# =================================================================
@app.route('/api/matches/all')
@jwt_required()
def get_all_matches():
    status = request.args.get('status') 
    base_query = get_match_query()
    
    if status in ['live', 'scheduled', 'completed']:
        query = base_query + " WHERE m.status = %s ORDER BY m.start_time"
        matches = query_db(query, (status,))
    else:
        query = base_query + " ORDER BY m.start_time"
        matches = query_db(query)
        
    return jsonify(matches), 200

@app.route('/api/matches/favorites')
@jwt_required()
def get_favorite_matches():
    current_user = get_jwt_identity()
    user_id = current_user['id']
    status = request.args.get('status')

    base_query = get_match_query()
    query = base_query + """
        WHERE (m.home_team_id IN (SELECT team_id FROM user_favorites WHERE user_id = %s)
           OR m.away_team_id IN (SELECT team_id FROM user_favorites WHERE user_id = %s))
    """
    params = [user_id, user_id]

    if status in ['live', 'scheduled', 'completed']:
        query += " AND m.status = %s"
        params.append(status)
        
    query += " ORDER BY m.start_time"
    
    matches = query_db(query, tuple(params))
    return jsonify(matches), 200

# =================================================================
# 6. WebSocket Bridge (Unchanged)
# =================================================================
def create_kafka_consumer(topic_name):
    conf = {
        'bootstrap.servers': KAFKA_SERVER,
        'group.id': 'ui-websocket-bridge-group',
        'auto.offset.reset': 'latest'
    }
    consumer = Consumer(conf)
    consumer.subscribe([topic_name])
    return consumer

def consume_and_emit(topic_name):
    consumer = create_kafka_consumer(topic_name)
    print(f"[KAFKA BRIDGE] Listening for topic: {topic_name}...")
    
    while True:
        msg = consumer.poll(1.0) 

        if msg is None:
            # This 'continue' also yields control to other eventlet green threads
            continue
        if msg.error():
            print(f"[KAFKA ERROR] {msg.error()}")
            continue
        
        try:
            data = json.loads(msg.value().decode('utf-8'))
            match_id = data.get('match_id')
            if match_id:
                socketio.emit(topic_name, data, room=match_id)
        except Exception as e:
            print(f"[SOCKET.IO ERROR] Failed to emit: {e}")
        
@socketio.on('connect')
def handle_connect():
    print('[SOCKET.IO] Client connected')

@socketio.on('join_match')
def handle_join_match(data):
    match_id = data.get('match_id')
    if match_id:
        join_room(match_id)
        if redis_client:
            new_count = redis_client.incr(f"watchers:{match_id}")
            redis_client.expire(f"watchers:{match_id}", 3600 * 4)
            print(f"[SOCKET.IO] Client joined room: {match_id}. Active watchers: {new_count}")

@socketio.on('leave_match')
def handle_leave_match(data):
    match_id = data.get('match_id')
    if match_id:
        leave_room(match_id)
        if redis_client:
            new_count = redis_client.decr(f"watchers:{match_id}")
            print(f"[SOCKET.IO] Client left room: {match_id}. Active watchers: {new_count}")

@socketio.on('disconnect')
def handle_disconnect():
    print('[SOCKET.IO] Client disconnected')

# =================================================================
# 7. Main Server Execution
# =================================================================
if __name__ == '__main__':
    print("[SERVER] Starting full API and WebSocket server...")
    
    # [FIX 2] Use eventlet.spawn, not threading.Thread
    # This is the correct way to do background tasks with eventlet
    print("[SERVER] Spawning Kafka listeners...")
    eventlet.spawn(consume_and_emit, 'snippets')
    eventlet.spawn(consume_and_emit, 'match_events')
    
    print("🚀 API server running on http://localhost:8000")
    # This line starts the main web server
    eventlet.wsgi.server(eventlet.listen(('0.0.0.0', 8000)), app)