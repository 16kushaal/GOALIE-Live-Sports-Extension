from confluent_kafka import Consumer, Producer
import json
import os
import time
from collections import defaultdict
import google.generativeai as genai

CLASSIFIED_TOPIC = "classified_commentary"
SNIPPET_TOPIC = "snippets"
KAFKA_BROKER = "127.0.0.1:9092"

# --- Gemini Config ---
try:
    genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
    gemini_model = genai.GenerativeModel("gemini-2.5-flash") # Use a valid model
    print("[GEMINI] Configured successfully.")
except Exception as e:
    print(f"[ERROR] Gemini configuration failed: {e}")
    gemini_model = None
# --------------------

# --- Batching Config ---
batches = defaultdict(list) # Stores {"match_id": ["commentary1", "commentary2"]}
last_received = defaultdict(float)
BATCH_INTERVAL_SECONDS = 15 
BATCH_SIZE_LIMIT = 3
# --------------------

def delivery_report(err, msg):
    if err is not None:
        print(f'[SNIPPET PRODUCER ERROR] Failed delivery: {err}')

def generate_snippet(match_id, texts):
    if not gemini_model:
        print("[GEMINI] Model not available. Returning last commentary.")
        return f"(No AI) Latest: {texts[-1]}" # Fallback if Gemini isn't configured

    print(f"[GEMINI] ({match_id}) Calling API with {len(texts)} lines...")
    prompt = f"You are a sports commentator. Summarize these live football commentary lines for match {match_id} into a single, concise, exciting news snippet:\n\n" + "\n".join(texts)
    
    try:
        response = gemini_model.generate_content(prompt)
        return response.text.strip()
    except Exception as e:
        print(f"[GEMINI ERROR] ({match_id}) API call failed: {e}")
        return f"(AI Error) Latest: {texts[-1]}" # Fallback on API error

def should_flush(match_id):
    time_elapsed = (time.time() - last_received[match_id]) > BATCH_INTERVAL_SECONDS
    size_reached = len(batches[match_id]) >= BATCH_SIZE_LIMIT
    return time_elapsed or size_reached

def flush_batch(producer, match_id):
    texts = batches.pop(match_id, None) # Remove batch atomically
    if not texts: return

    print(f"\n[SNIPPET FLUSH] ({match_id}) Flushing batch ({len(texts)} items)...")
    snippet_text = generate_snippet(match_id, texts)
    
    out_msg = {
        "match_id": match_id,
        "snippet": snippet_text,
        "timestamp": time.time()
    }
    
    producer.produce(
        SNIPPET_TOPIC, 
        key=match_id.encode('utf-8'), 
        value=json.dumps(out_msg).encode("utf-8"),
        callback=delivery_report
    )
    print(f"[SNIPPET PRODUCING] ({match_id}) Snippet sent.")
    # Reset timer (or remove if using pop)
    # last_received[match_id] = time.time() 

if __name__ == "__main__":
    consumer_conf = {
        'bootstrap.servers': KAFKA_BROKER,
        'group.id': 'snippet-generator-group',
        'auto.offset.reset': 'earliest'
    }
    consumer = Consumer(consumer_conf)
    consumer.subscribe([CLASSIFIED_TOPIC])

    producer_conf = {'bootstrap.servers': KAFKA_BROKER}
    producer = Producer(producer_conf)

    print(f"[SNIPPET GENERATOR] Listening for {CLASSIFIED_TOPIC}...")

    while True:
        msg = consumer.poll(1.0) # Poll with timeout

        # 1. Process message if received
        if msg is not None and not msg.error():
            try:
                data = json.loads(msg.value().decode("utf-8"))
                match_id = data.get("match_id")
                commentary = data.get("commentary")

                if match_id and commentary:
                    batches[match_id].append(commentary)
                    last_received[match_id] = time.time() # Update time on receive
                    print(f"[SNIPPET BATCHING] ({match_id}) Added. Size: {len(batches[match_id])}/{BATCH_SIZE_LIMIT}")
                    
                    # Flush immediately if size limit reached
                    if len(batches[match_id]) >= BATCH_SIZE_LIMIT:
                       flush_batch(producer, match_id)
                       
            except json.JSONDecodeError:
                 print("[SNIPPET ERROR] Could not decode JSON.")
            except Exception as e:
                 print(f"[SNIPPET ERROR] Processing message failed: {e}")

        elif msg is not None and msg.error():
            print(f"[SNIPPET CONSUMER ERROR] {msg.error()}")

        # 2. Check all batches for time-based flush (even if no message received)
        current_time = time.time()
        for match_id in list(batches.keys()):
            if (current_time - last_received[match_id]) > BATCH_INTERVAL_SECONDS:
                flush_batch(producer, match_id)
        
        # 3. Poll producer for delivery reports
        producer.poll(0)

    # consumer.close()
    # producer.flush()