from flask import Flask, jsonify
from flask_socketio import SocketIO, join_room, leave_room
from flask_cors import CORS
from confluent_kafka import Consumer
import threading
import json
import time
import os

app = Flask(__name__)
CORS(app) # Allow cross-origin requests
app.config['SECRET_KEY'] = 'simple-secret!'
# Use standard threading async_mode if eventlet isn't installed or causing issues
socketio = SocketIO(app, cors_allowed_origins="*") 

KAFKA_BROKER = "127.0.0.1:9092"
SNIPPET_TOPIC = "snippets"

def create_kafka_consumer():
    conf = {
        'bootstrap.servers': KAFKA_BROKER,
        'group.id': 'websocket-server-group',
        'auto.offset.reset': 'latest'
    }
    consumer = Consumer(conf)
    consumer.subscribe([SNIPPET_TOPIC])
    return consumer

def consume_and_emit():
    consumer = create_kafka_consumer()
    print(f"[WEBSOCKET KAFKA] Listening for topic: {SNIPPET_TOPIC}...")
    while True:
        msg = consumer.poll(1.0) 
        if msg is None: continue
        if msg.error(): print(f"[WEBSOCKET KAFKA ERROR] {msg.error()}"); continue
        try:
            data = json.loads(msg.value().decode('utf-8'))
            match_id = data.get('match_id')
            if match_id:
                print(f"[SOCKET.IO EMIT] Sending snippet for {match_id}")
                # Emit directly using the main socketio instance
                socketio.emit('new_snippet', data, room=match_id) 
        except Exception as e: print(f"[SOCKET.IO EMIT ERROR] Failed: {e}")
        time.sleep(0.01) # Small sleep

@app.route('/')
def index():
    return jsonify({"status": "WebSocket server running"})

@socketio.on('connect')
def handle_connect(): print('[SOCKET.IO] Client connected')

@socketio.on('disconnect')
def handle_disconnect(): print('[SOCKET.IO] Client disconnected')

# Renamed event for clarity
@socketio.on('watch_match') 
def handle_watch_match(data):
    match_id = data.get('match_id')
    if match_id:
        join_room(match_id)
        print(f"[SOCKET.IO] Client watching match: {match_id}")

# Renamed event for clarity
@socketio.on('unwatch_match') 
def handle_unwatch_match(data):
    match_id = data.get('match_id')
    if match_id:
        leave_room(match_id)
        print(f"[SOCKET.IO] Client stopped watching: {match_id}")

if __name__ == '__main__':
    print("[SERVER] Starting WebSocket Server...")
    
    # Run Kafka consumer in background thread
    kafka_thread = threading.Thread(target=consume_and_emit, daemon=True)
    kafka_thread.start()
    
    print("🚀 WebSocket server running on http://localhost:5000")
    # Use socketio.run for simplicity
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, allow_unsafe_werkzeug=True)