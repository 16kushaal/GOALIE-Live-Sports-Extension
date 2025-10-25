from confluent_kafka import Producer
import json, time, os
import psycopg2
from psycopg2.extras import RealDictCursor

RAW_TOPIC = "raw_commentary"
EVENTS_TOPIC = "match_events"
DB_CONN_STRING = "postgresql://admin:admin@localhost:5432/goalie"

producer = Producer({"bootstrap.servers": "localhost:9092"})

def get_live_matches():
    """Gets all 'live' match IDs from the database."""
    try:
        conn = psycopg2.connect(DB_CONN_STRING)
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT match_id FROM matches WHERE status = 'live'")
        matches = cursor.fetchall()
        cursor.close()
        conn.close()
        # Return a simple list of match IDs
        return [match['match_id'] for match in matches]
    except Exception as e:
        print(f"[DB ERROR] Could not get live matches: {e}")
        return []

def load_commentary_data():
    """Loads the pre-canned commentary from the JSON file."""
    try:
        # Assumes the JSON is in the same directory
        with open("services/api-service/commentary_data.json", 'r') as f:
            return json.load(f)
    except Exception as e:
        print(f"[FILE ERROR] Could not load commentary_data.json: {e}")
        return {}

def simulate_matches(live_match_ids, all_commentary):
    """
    Simulates live commentary for all active matches, line by line.
    """
    # Keep track of which line we're on for each match
    # e.g., {'EP25001': 0} (index 0)
    match_progress = {match_id: 0 for match_id in live_match_ids}
    
    while True:
        # Loop through each live match and send one line
        for match_id in live_match_ids:
            commentary_lines = all_commentary.get(match_id)
            if not commentary_lines:
                print(f"[WARN] No commentary data found for live match: {match_id}")
                continue 

            # Get the current line index for this match
            current_index = match_progress[match_id]
            
            # Get the specific line object from the JSON
            comment_obj = commentary_lines[current_index]
            comment_line = comment_obj['line']
            
            message = {
                "match_id": match_id,
                "timestamp": time.time(),
                "game_minute": comment_obj.get('minute', ''),
                "commentary": comment_line
            }
            
            # Key Logic: Send to the correct topic based on content
            if "GOAL!" in comment_line or "CARD!" in comment_line:
                producer.produce(EVENTS_TOPIC, key=match_id.encode('utf-8'), value=json.dumps(message).encode("utf-8"))
                print(f"[EVENT PRODUCER] ({match_id}) Sent: {comment_line}")
            else:
                producer.produce(RAW_TOPIC, key=match_id.encode('utf-8'), value=json.dumps(message).encode("utf-8"))
                print(f"[RAW PRODUCER] ({match_id}) Sent: {comment_line}")
            
            producer.flush()
            
            # Move to the next line for this match
            match_progress[match_id] += 1
            
            # If we're at the end of the commentary, loop back to the start
            if match_progress[match_id] >= len(commentary_lines):
                match_progress[match_id] = 0
                print(f"--- Restarting commentary for {match_id} ---")
        
        # Wait 5 seconds before sending the next round of commentary
        time.sleep(5)

if __name__ == "__main__":
    print("🔥 Starting stateful producer...")
    live_matches = get_live_matches()
    all_commentary = load_commentary_data()
    
    print(f"Tracking {len(live_matches)} live matches: {live_matches}")
    
    if live_matches and all_commentary:
        simulate_matches(live_matches, all_commentary)
    else:
        print("No live matches or no commentary data found. Exiting.")