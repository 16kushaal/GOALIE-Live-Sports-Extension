from confluent_kafka import Consumer, Producer
import json, os, time
from collections import defaultdict
import google.generativeai as genai

# KAFKA_BROKER = { 'bootstrap-servers': "localhost:9292"}
CLASSIFIED_TOPIC = "classified_commentary"
SNIPPET_TOPIC = "snippets"

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

consumer_conf = {
    "bootstrap.servers": "localhost:9092",
    "group.id": "snippet-generator",
    "auto.offset.reset": "earliest"
}
consumer = Consumer(consumer_conf)
consumer.subscribe([CLASSIFIED_TOPIC])

producer = Producer({"bootstrap.servers": "localhost:9092"})
batches = defaultdict(list)
last_flush = defaultdict(float)

# --- Batching rules ---
FLUSH_INTERVAL = 15  # seconds
BATCH_SIZE_LIMIT = 3 # Flush when batch reaches this size

def generate_snippet(texts):
    print(f"[GEMINI] Calling API with {len(texts)} lines...")
    prompt = "You are a real-time sports reporter. Turn the following live commentary lines into one single, exciting news snippet. Be concise.\n\nCOMMENTARY:\n" + "\n".join(texts)
    
    # Using gemini-1.5-flash, as 2.5 isn't a recognized model
    model = genai.GenerativeModel("gemini-2.5-flash") 
    
    try:
        response = model.generate_content(prompt)
        return response.text.strip()
    except Exception as e:
        print(f"[GEMINI ERROR] {e}")
        return f"Error generating snippet. Last update: {texts[-1]}" # Fallback

def should_flush_time(match_id):
    """Checks if the batch timer has expired."""
    return (time.time() - last_flush[match_id]) > FLUSH_INTERVAL

def should_flush_size(match_id):
    """Checks if the batch size limit has been reached."""
    return len(batches[match_id]) >= BATCH_SIZE_LIMIT

def flush_batch(match_id):
    """Generates and sends a snippet for a given match_id batch."""
    texts = batches.get(match_id)
    if not texts:
        return # Nothing to flush

    print(f"\n[BATCH FLUSH] Flushing batch for {match_id} ({len(texts)} items)...")
    
    snippet = generate_snippet(texts)
    out_msg = {
        "match_id": match_id,
        "snippet": snippet,
        "timestamp": time.time()
    }
    producer.produce(SNIPPET_TOPIC, json.dumps(out_msg).encode("utf-8"))
    producer.flush()
    
    print(f"[PRODUCING] → Snippet sent to '{SNIPPET_TOPIC}': {out_msg}")
    
    batches[match_id] = [] # Clear batch
    last_flush[match_id] = time.time() # Reset timer

print("[SNIPPET GENERATOR] Listening for classified_commentary...")

while True:
    msg = consumer.poll(1.0)
    
    # 1. Time-based flushing (for idle topics)
    if msg is None:
        # Check all current batches to see if any need to be flushed
        for match_id in list(batches.keys()):
            if should_flush_time(match_id):
                print(f"\n[TIMER FLUSH] Flushing idle batch for {match_id}...")
                flush_batch(match_id)
        continue # Go back to polling

    if msg.error():
        print(f"[ERROR] {msg.error()}")
        continue

    # 2. Message received logic
    data = json.loads(msg.value().decode("utf-8"))
    match_id = data["match_id"]
    
    # --- ADDED: Show what's received ---
    print(f"\n[RECEIVED] Batching commentary for {match_id}: '{data['commentary']}'")

    batches[match_id].append(data["commentary"])
    
    if match_id not in last_flush:
        last_flush[match_id] = time.time()

    # --- ADDED: Show batch status ---
    print(f"[BATCHING] Match {match_id} batch size: {len(batches[match_id])}/{BATCH_SIZE_LIMIT}")

    # 3. Size-based flushing
    if should_flush_size(match_id):
        flush_batch(match_id)