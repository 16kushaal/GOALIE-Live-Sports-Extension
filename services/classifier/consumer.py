from confluent_kafka import Consumer, Producer
import json
import os
import joblib # For loading your model

RAW_TOPIC = "raw_commentary"
CLASSIFIED_TOPIC = "classified_commentary"
KAFKA_BROKER = "127.0.0.1:9092"
MODEL_PATH = "services/classifier/models/model.joblib" # Path to your model

def delivery_report(err, msg):
    if err is not None:
        print(f'[CLASSIFIER PRODUCER ERROR] Failed delivery: {err}')

# --- Load Model ---
try:
    model = joblib.load(MODEL_PATH)
    print(f"[CLASSIFIER] Model loaded successfully from {MODEL_PATH}")
except Exception as e:
    print(f"[ERROR] Could not load model from {MODEL_PATH}: {e}")
    # Fallback: Dummy classifier if model fails to load
    model = None 
    print("[CLASSIFIER] Using dummy classification (all pass).")

def classify_commentary(text):
    if model:
        try:
            # Assumes model.predict returns an array, get first element
            return model.predict([text])[0] 
        except Exception as e:
            print(f"[MODEL ERROR] Prediction failed: {e}. Defaulting to CURRENT.")
            return "CURRENT" # Default to passing if prediction fails
    else:
        # Dummy logic if no model
        return "CURRENT" # Pass everything through

if __name__ == "__main__":
    consumer_conf = {
        'bootstrap.servers': KAFKA_BROKER,
        'group.id': 'classifier-group',
        'auto.offset.reset': 'earliest'
    }
    consumer = Consumer(consumer_conf)
    consumer.subscribe([RAW_TOPIC])

    producer_conf = {'bootstrap.servers': KAFKA_BROKER}
    producer = Producer(producer_conf)

    print(f"[CLASSIFIER] Listening for {RAW_TOPIC}...")

    while True:
        msg = consumer.poll(1.0)
        if msg is None: continue
        if msg.error():
            print(f"[CLASSIFIER CONSUMER ERROR] {msg.error()}")
            continue

        try:
            data = json.loads(msg.value().decode("utf-8"))
            commentary = data.get("commentary", "")
            match_id = data.get("match_id", "unknown")
            print(f"\n[CLASSIFIER RECEIVED] ({match_id}) '{commentary}'")

            classification = classify_commentary(commentary)

            if classification == "CURRENT": # Check for uppercase
                producer.produce(
                    CLASSIFIED_TOPIC,
                    key=msg.key(), # Pass the original key
                    value=msg.value(), # Pass the original value
                    callback=delivery_report
                )
                print(f"[CLASSIFIER PRODUCING] ({match_id}) Forwarded as CURRENT.")
            else:
                print(f"[CLASSIFIER FILTERED] ({match_id}) Discarded (Reason: '{classification}')")
            
            producer.poll(0) # Trigger delivery reports

        except json.JSONDecodeError:
            print("[CLASSIFIER ERROR] Could not decode JSON message.")
        except Exception as e:
            print(f"[CLASSIFIER ERROR] Unexpected error: {e}")
            
    # consumer.close() # Unreachable in while True
    # producer.flush()