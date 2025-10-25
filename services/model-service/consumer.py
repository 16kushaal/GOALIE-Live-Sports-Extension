from confluent_kafka import Consumer, Producer
import json, joblib, os

# KAFKA_BROKER = os.getenv("KAFKA_BROKER", "localhost:9092")
RAW_TOPIC = "raw_commentary"
CLASSIFIED_TOPIC = "classified_commentary"

consumer_conf = {
    "bootstrap.servers": "localhost:9092",
    "group.id": "model-service",
    "auto.offset.reset": "earliest"
}
consumer = Consumer(consumer_conf)
consumer.subscribe([RAW_TOPIC])

producer = Producer({"bootstrap.servers": "localhost:9092"})

# Load local ML model and vectorizer
model = joblib.load("models/Logistic_Regression_TF-IDF_Char_2-5.joblib")
# vectorizer = joblib.load("models/vectorizer.pkl")

def classify_commentary(text):
    # X = vectorizer.transform([text])
    return model.predict([text])[0]  # Get the string value from the array

print("[MODEL SERVICE] Listening for raw_commentary...")

while True:
    msg = consumer.poll(1.0)
    if msg is None:
        continue
    if msg.error():
        print(f"[ERROR] {msg.error()}")
        continue

    data = json.loads(msg.value().decode("utf-8"))
    
    # 1. --- ADDED: Show what's received ---
    print(f"\n[RECEIVED] Processing commentary: '{data['commentary']}'")

    classification = classify_commentary(data["commentary"])

    if classification == "CURRENT":
        out = {
            "match_id": data["match_id"],
            "commentary": data["commentary"],
            "timestamp": data["timestamp"],
            "classification": classification
        }
        producer.produce(CLASSIFIED_TOPIC, json.dumps(out).encode("utf-8"))
        producer.flush()
        
        # 2. --- UPDATED: More explicit "producing" message ---
        print(f"[PRODUCING] → Forwarded as 'CURRENT' to '{CLASSIFIED_TOPIC}'")

    else:
        # 3. --- ADDED: Show what's being filtered out ---
        print(f"[FILTERED] → Discarded (Reason: '{classification}')")

consumer.close()