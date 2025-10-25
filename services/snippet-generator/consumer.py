from confluent_kafka import Consumer, Producer
import json, os, time
from collections import defaultdict
import google.generativeai as genai

# --- Kafka & Gemini Config ---
CLASSIFIED_TOPIC = "classified_commentary"
SNIPPET_TOPIC = "snippets"
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

consumer_conf = {
    "bootstrap.servers": "127.0.0.1:9092",
    "group.id": "snippet-generator",
    "auto.offset.reset": "earliest"
}
consumer = Consumer(consumer_conf)
consumer.subscribe([CLASSIFIED_TOPIC])
producer = Producer({"bootstrap.servers": "127.0.0.1:9092"})

# --- Batching Config ---
batches = defaultdict(list)
last_flush = defaultdict(float)
FLUSH_INTERVAL = 15  # seconds
BATCH_SIZE_LIMIT = 3 # Flush when batch reaches this size

def generate_snippet(texts):
    print(f"[GEMINI] Calling API with {len(texts)} lines...")
    prompt = "You are a real-time sports reporter. Turn the following live commentary lines into one single, exciting news snippet. Be concise.\n\nCOMMENTARY:\n" + "\n".join(texts)
    model = genai.GenerativeModel("gemini-2.5-flash") 
    try:
        response = model.generate_content(prompt)
        return response.text.strip()
    except Exception as e:
        print(f"[GEMINI ERROR] {e}")
        return f"Error generating snippet. Last update: {texts[-1]}" # Fallback

def should_flush_time(match_id):
    return (time.time() - last_flush[match_id]) > FLUSH_INTERVAL

def should_flush_size(match_id):
    return len(batches[match_id]) >= BATCH_SIZE_LIMIT

def flush_batch(match_id):
    texts = batches.get(match_id)
    if not texts: return

    # --- NO REDIS CHECK - ALWAYS GENERATE ---
    print(f"\n[BATCH FLUSH] Flushing batch for {match_id} ({len(texts)} items)...")
    
    snippet = generate_snippet(texts) # Call Gemini
    out_msg = {
        "match_id": match_id,
        "snippet": snippet,
        "timestamp": time.time()
    }
    producer.produce(SNIPPET_TOPIC, json.dumps(out_msg).encode("utf-8"))
    producer.flush()
    
    print(f"[PRODUCING] → Snippet sent to '{SNIPPET_TOPIC}'")
    batches[match_id] = []
    last_flush[match_id] = time.time()

print("[SNIPPET GENERATOR] Listening for classified_commentary...")
while True:
    msg = consumer.poll(1.0)
    
    if msg is None:
        for match_id in list(batches.keys()):
            if should_flush_time(match_id):
                flush_batch(match_id)
        continue

    if msg.error():
        print(f"[ERROR] {msg.error()}")
        continue

    data = json.loads(msg.value().decode("utf-8"))
    match_id = data["match_id"]
    
    batches[match_id].append(data["commentary"])
    if match_id not in last_flush:
        last_flush[match_id] = time.time()

    if should_flush_size(match_id):
        flush_batch(match_id)