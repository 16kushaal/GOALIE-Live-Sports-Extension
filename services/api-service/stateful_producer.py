from confluent_kafka import Producer
import json, time, os
import psycopg2
from psycopg2.extras import RealDictCursor

RAW_TOPIC = "raw_commentary" # Only sending here now
DB_CONN_STRING = "postgresql://admin:admin@127.0.0.1:5432/goalie"

producer = Producer({"bootstrap.servers": "127.0.0.1:9092"})

def get_live_matches():
    try:
        conn = psycopg2.connect(DB_CONN_STRING)
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT match_id FROM matches WHERE status = 'live'")
        matches = cursor.fetchall()
        cursor.close()
        conn.close()
        return [match['match_id'] for match in matches]
    except Exception as e:
        print(f"[DB ERROR] Could not get live matches: {e}")
        return []

def load_commentary_data():
    try:
        with open("services/api-service/commentary_data.json", 'r') as f:
            return json.load(f)
    except Exception as e:
        print(f"[FILE ERROR] Could not load commentary_data.json: {e}")
        return {}

def simulate_matches(live_match_ids, all_commentary):
    match_progress = {match_id: 0 for match_id in live_match_ids}
    
    while True:
        for match_id in live_match_ids:
            commentary_lines = all_commentary.get(match_id)
            if not commentary_lines: continue

            current_index = match_progress[match_id]
            comment_obj = commentary_lines[current_index]
            comment_line = comment_obj['line']
            
            message = {
                "match_id": match_id,
                "timestamp": time.time(),
                "game_minute": comment_obj.get('minute', ''),
                "commentary": comment_line
            }
            
            # Send ALL commentary (including GOAL/CARD) to raw topic
            producer.produce(RAW_TOPIC, key=match_id.encode('utf-8'), value=json.dumps(message).encode("utf-8"))
            print(f"[RAW PRODUCER] ({match_id}) Sent: {comment_line}")
            
            producer.flush()
            
            match_progress[match_id] += 1
            if match_progress[match_id] >= len(commentary_lines):
                match_progress[match_id] = 0
                print(f"--- Restarting commentary for {match_id} ---")
        
        time.sleep(5)

if __name__ == "__main__":
    print("🔥 Starting SIMPLIFIED stateful producer...")
    live_matches = get_live_matches()
    all_commentary = load_commentary_data()
    print(f"Tracking {len(live_matches)} live matches: {live_matches}")
    if live_matches and all_commentary:
        simulate_matches(live_matches, all_commentary)
    else:
        print("No live matches or no commentary data found. Exiting.")