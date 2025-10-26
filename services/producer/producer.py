from confluent_kafka import Producer
import json
import time
import os
import random

RAW_TOPIC = "raw_commentary"
KAFKA_BROKER = "127.0.0.1:9092"

# --- Simulation Config ---
# Choose which matches from the JSON are "live"
LIVE_MATCH_IDS = ["MATCH_1", "MATCH_2"] 
SECONDS_BETWEEN_LINES = 5
# ------------------------

def load_commentary_data():
    try:
        with open("services/producer/commentary_data.json", 'r') as f:
            return json.load(f)
    except Exception as e:
        print(f"[ERROR] Could not load commentary_data.json: {e}")
        return {}

def delivery_report(err, msg):
    if err is not None:
        print(f'[PRODUCER ERROR] Failed delivery: {err}')

if __name__ == "__main__":
    print("🔥 Starting Simple Producer...")
    producer_conf = {'bootstrap.servers': KAFKA_BROKER}
    producer = Producer(producer_conf)
    
    all_commentary = load_commentary_data()
    if not all_commentary:
        exit("Exiting: Commentary data not found.")

    match_progress = {match_id: 0 for match_id in LIVE_MATCH_IDS}
    print(f"Simulating matches: {LIVE_MATCH_IDS}")

    while True:
        for match_id in LIVE_MATCH_IDS:
            commentary_lines = all_commentary.get(match_id)
            if not commentary_lines: continue

            current_index = match_progress[match_id]
            comment_obj = commentary_lines[current_index]
            
            message = {
                "match_id": match_id,
                "timestamp": time.time(),
                "game_minute": comment_obj.get('minute', ''),
                "commentary": comment_obj['line']
            }
            
            try:
                producer.produce(
                    RAW_TOPIC, 
                    key=match_id.encode('utf-8'), 
                    value=json.dumps(message).encode("utf-8"),
                    callback=delivery_report
                )
                print(f"[RAW PRODUCER] ({match_id}) Sent: {message['commentary']}")
            except BufferError:
                 print('[PRODUCER BUFFER] Queue is full, waiting...')
                 producer.poll(1) # Wait for buffer space

            match_progress[match_id] = (current_index + 1) % len(commentary_lines)
        
        # Poll for delivery reports (non-blocking)
        producer.poll(0) 
        time.sleep(SECONDS_BETWEEN_LINES)

    # producer.flush() # Optional: Flush on exit if needed