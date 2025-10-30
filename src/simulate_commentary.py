import time
import json
from kafka import KafkaProducer
from collections import defaultdict # --- NEW ---

# --- Configuration ---
KAFKA_BROKER = '127.0.0.1:9092'

# --- Commentary Topic (UNCHANGED) ---
COMMENTARY_TOPIC = 'raw_commentary'
COMMENTARY_FILE = 'data/commentary.json'

# --- Event Topic (NEW - from simulate_events.py) ---
EVENTS_TOPIC = 'match_events'
EVENTS_FILE = 'data/events.json'

SIMULATION_SPEED_SECONDS = 8 # Time between "minutes"

def get_producer():
    """Initializes and returns a Kafka Producer."""
    return KafkaProducer(
        bootstrap_servers=[KAFKA_BROKER],
        value_serializer=lambda v: json.dumps(v).encode('utf-8')
    )

def load_commentary_data():
    """Loads commentary data from the JSON file."""
    try:
        with open(COMMENTARY_FILE, 'r') as f:
            data = json.load(f)
        print(f"Loaded {len(data)} commentary lines from {COMMENTARY_FILE}")
        return data
    except FileNotFoundError:
        print(f"Error: {COMMENTARY_FILE} not found.")
        return []

# --- NEW: Function from simulate_events.py ---
def load_event_data():
    """Loads simulation data from the JSON file."""
    try:
        with open(EVENTS_FILE, 'r') as f:
            data = json.load(f)
        print(f"Loaded {len(data)} events from {EVENTS_FILE}")
        return data
    except FileNotFoundError:
        print(f"Error: {EVENTS_FILE} not found.")
        return []

def main():
    producer = None
    try:
        producer = get_producer()
        print("Producer connected. Starting SYNCHRONIZED simulation...")
        
        commentary_lines = load_commentary_data()
        event_lines = load_event_data()
        
        # --- NEW: Create a quick lookup for events by time ---
        events_by_time = defaultdict(list)
        for event in event_lines:
            if 'time' in event:
                events_by_time[event['time']].append(event)
        
        print(f"Mapped {len(event_lines)} events to {len(events_by_time)} timestamps.")

        # --- MODIFIED: Main simulation loop ---
        for line in commentary_lines:
            # 1. Send the commentary line (this is the "clock")
            current_time = line['time']
            print(f"Sending commentary for {line['match_id']} [{current_time}]: {line['text']}")
            producer.send(COMMENTARY_TOPIC, value=line)
            
            # 2. Check if any events happen at this exact time
            if current_time in events_by_time:
                # 3. Send all events for this timestamp
                for event_to_send in events_by_time[current_time]:
                    print(f"--- Sending EVENT for {event_to_send['match_id']} [{current_time}]: {event_to_send.get('text') or event_to_send['event_type']} ---")
                    producer.send(EVENTS_TOPIC, value=event_to_send)
                
                # Optional: Remove events after sending to avoid re-sending if clock is weird
                del events_by_time[current_time] 

            producer.flush() # Ensure all messages for this "minute" are sent
            time.sleep(SIMULATION_SPEED_SECONDS)
            
        print("Simulation finished.")

    except Exception as e:
        print(f"An error occurred: {e}")
    finally:
        if producer:
            producer.close()

if __name__ == "__main__":
    main()