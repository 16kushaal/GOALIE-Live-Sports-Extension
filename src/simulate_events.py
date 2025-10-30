import time
import json
from kafka import KafkaProducer

# --- Configuration ---
KAFKA_BROKER = '127.0.0.1:9092'
TOPIC = 'match_events'
EVENTS_FILE = 'data/events.json'
SIMULATION_SPEED_SECONDS = 12 # Events are less frequent

def get_producer():
    """Initializes and returns a Kafka Producer."""
    return KafkaProducer(
        bootstrap_servers=[KAFKA_BROKER],
        value_serializer=lambda v: json.dumps(v).encode('utf-8')
    )

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
        print("Producer connected. Starting event simulation...")
        
        events = load_event_data()
        
        for event in events:
            print(f"Sending event for {event['match_id']}: {event.get('text') or event['event_type']}")
            producer.send(TOPIC, value=event)
            producer.flush()
            time.sleep(SIMULATION_SPEED_SECONDS)
            
        print("Event simulation finished.")

    except Exception as e:
        print(f"An error occurred: {e}")
    finally:
        if producer:
            producer.close()

if __name__ == "__main__":
    main()