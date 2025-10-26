import time
import json
from kafka import KafkaProducer

# --- Configuration ---
KAFKA_BROKER = '127.0.0.1:9092'
TOPIC = 'raw_commentary'
COMMENTARY_FILE = 'data/commentary.json'
SIMULATION_SPEED_SECONDS = 8 # Time between messages

def get_producer():
    """Initializes and returns a Kafka Producer."""
    return KafkaProducer(
        bootstrap_servers=[KAFKA_BROKER],
        value_serializer=lambda v: json.dumps(v).encode('utf-8')
    )

def load_commentary_data():
    """Loads simulation data from the JSON file."""
    try:
        with open(COMMENTARY_FILE, 'r') as f:
            data = json.load(f)
        print(f"Loaded {len(data)} commentary lines from {COMMENTARY_FILE}")
        return data
    except FileNotFoundError:
        print(f"Error: {COMMENTARY_FILE} not found.")
        return []

def main():
    producer = None
    try:
        producer = get_producer()
        print("Producer connected. Starting commentary simulation...")
        
        commentary_lines = load_commentary_data()
        
        for line in commentary_lines:
            print(f"Sending commentary for {line['match_id']}: {line['text']}")
            producer.send(TOPIC, value=line)
            producer.flush() # Ensure message is sent
            time.sleep(SIMULATION_SPEED_SECONDS)
            
        print("Simulation finished.")

    except Exception as e:
        print(f"An error occurred: {e}")
    finally:
        if producer:
            producer.close()

if __name__ == "__main__":
    main()