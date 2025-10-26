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

# --- Configuration ---
load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- App Setup ---
app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-very-secret-key-change-it!'
# Use eventlet for async mode, as recommended by SocketIO
socketio = SocketIO(app, async_mode='eventlet', cors_allowed_origins="*")

# --- Kafka Setup ---
KAFKA_BROKER = '127.0.0.1:9092'
SNIPPET_TOPIC = 'snippets_processed'
EVENT_TOPIC = 'match_events'

# --- Database Setup ---
def get_db_connection():
    """Establishes a connection to the PostgreSQL database."""
    try:
        conn = psycopg2.connect(
            host=os.getenv('POSTGRES_HOST'),
            database=os.getenv('POSTGRES_DB'),
            user=os.getenv('POSTGRES_USER'),
            password=os.getenv('POSTGRES_PASSWORD')
        )
        return conn
    except Exception as e:
        logger.error(f"Error connecting to database: {e}")
        return None

# --- REST API Endpoints ---

@app.route('/')
def index():
    return "Football Snippets API is running!"

@app.route('/login', methods=['POST'])
def login():
    # TODO: Implement proper user authentication
    logger.info("Login attempt received")
    return jsonify({"message": "Login successful (stub)", "token": "fake-jwt-token"}), 200

@app.route('/matches', methods=['GET'])
def get_matches():
    """Fetches all matches from the database."""
    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500
        
    try:
        # Use a DictCursor to get results as dictionaries
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            cur.execute(
                """
                SELECT m.id, t1.name as home_team, t2.name as away_team, 
                       m.match_time, m.status, m.score 
                FROM matches m 
                LEFT JOIN teams t1 ON m.home_team_id = t1.id 
                LEFT JOIN teams t2 ON m.away_team_id = t2.id 
                ORDER BY m.match_time
                """
            )
            matches = cur.fetchall()
            
            # Convert rows to dictionaries
            match_list = []
            for row in matches:
                row_dict = dict(row)
                # Convert datetime to ISO string for JSON
                row_dict['match_time'] = row_dict['match_time'].isoformat()
                match_list.append(row_dict)
                
            return jsonify(match_list)
    except Exception as e:
        logger.error(f"Error fetching matches: {e}")
        return jsonify({"error": "Failed to fetch matches"}), 500
    finally:
        conn.close()

# --- WebSocket Handlers ---

@socketio.on('connect')
def handle_connect():
    logger.info(f"Client connected: {request.sid}")

@socketio.on('disconnect')
def handle_disconnect():
    logger.info(f"Client disconnected: {request.sid}")

@socketio.on('join_match')
def handle_join_match(data):
    """
    Allows a client to subscribe to updates for a specific match.
    """
    try:
        # ID is a string, e.g., "EP25001"
        match_id = data['match_id'] 
        room = f"match_{match_id}"
        join_room(room)
        logger.info(f"Client {request.sid} joined room: {room}")
        socketio.emit('joined_room', {'room': room}, to=request.sid)
    except KeyError:
        logger.warning(f"Client {request.sid} sent invalid join_match request.")
    except Exception as e:
        logger.error(f"Error in join_match: {e}")

# --- Kafka Consumer Background Threads ---

def start_kafka_consumer(topic, handler_function, group_id):
    """
    Generic function to run a Kafka consumer in a background thread.
    """
    logger.info(f"Initializing consumer thread for topic: {topic}")
    try:
        consumer = KafkaConsumer(
            topic,
            bootstrap_servers=[KAFKA_BROKER],
            auto_offset_reset='latest', # Start from new messages
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
    """
    Called by the snippet consumer thread.
    Emits a WebSocket event to the correct match room.
    """
    try:
        match_id = data['match_id']
        room = f"match_{match_id}"
        logger.info(f"Emitting 'new_snippet' to room {room}")
        socketio.emit('new_snippet', data, room=room) #made a change here 
    except Exception as e:
        logger.error(f"Error handling snippet: {e}")

def handle_event_message(data):
    """
    Called by the event consumer thread.
    Emits a WebSocket event to the correct match room.
    """
    try:
        match_id = data['match_id']
        room = f"match_{match_id}"
        logger.info(f"Emitting 'new_event' to room {room}")
        socketio.emit('new_event', data, room=room) #made a change here 
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
    import eventlet
    eventlet.wsgi.server(eventlet.listen(('', 5000)), app)