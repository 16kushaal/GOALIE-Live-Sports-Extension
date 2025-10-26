import os
import json
import time
from collections import defaultdict
from kafka import KafkaConsumer, KafkaProducer
from dotenv import load_dotenv
import google.generativeai as genai

# --- Configuration ---
load_dotenv()
KAFKA_BROKER = '127.0.0.1:9092'
CONSUME_TOPIC = 'classified_commentary'
PRODUCE_TOPIC = 'snippets_processed'
GROUP_ID = 'snippet-group'

# Batching settings
BATCH_SIZE = 5       # Process after 5 messages
BATCH_TIMEOUT_SECONDS = 10 # Or process after 10 seconds

# Configure Gemini
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
if not GEMINI_API_KEY:
    raise ValueError("GEMINI_API_KEY not found in .env file")
genai.configure(api_key=GEMINI_API_KEY)
model = genai.GenerativeModel('gemini-2.5-flash')

def get_kafka_client():
    consumer = KafkaConsumer(
        CONSUME_TOPIC,
        bootstrap_servers=[KAFKA_BROKER],
        auto_offset_reset='earliest',
        group_id=GROUP_ID,
        value_deserializer=lambda v: json.loads(v.decode('utf-8')),
        consumer_timeout_ms=1000 # Poll timeout to allow non-blocking loop
    )
    producer = KafkaProducer(
        bootstrap_servers=[KAFKA_BROKER],
        value_serializer=lambda v: json.dumps(v).encode('utf-8')
    )
    return consumer, producer

def generate_snippet(commentary_lines):
    """
    Calls the Gemini API to generate a snippet from a batch of lines.
    """
    if not commentary_lines:
        return None

    # Combine lines into a single block
    full_commentary = " ".join(line['text'] for line in commentary_lines)
    
    prompt = f"""
    You are a live football commentator. Summarize the following play-by-play commentary 
    into a single, exciting 20-word snippet for a user who cannot watch the match.
    
    Commentary:
    "{full_commentary}"
    
    Snippet:
    """
    
    try:
        response = model.generate_content(prompt)
        return response.text.strip().replace("\n", " ")
    except Exception as e:
        print(f"Error calling Gemini API: {e}")
        return None

def process_batch(batch, producer):
    """
    Processes a batch of messages, grouping by match_id.
    """
    # Group messages by match_id
    matches_data = defaultdict(list)
    for msg in batch:
        data = msg.value
        matches_data[data['match_id']].append(data)
    
    print(f"Processing batch with {len(batch)} messages for {len(matches_data)} matches...")

    for match_id, lines in matches_data.items():
        snippet = generate_snippet(lines)
        
        if snippet:
            snippet_data = {
                "match_id": match_id,
                "snippet": snippet,
                "timestamp": int(time.time())
            }
            print(f"Producing snippet for match {match_id}: {snippet}")
            producer.send(PRODUCE_TOPIC, value=snippet_data)

def main():
    consumer, producer = get_kafka_client()
    print("Snippet service running...")
    
    batch = []
    last_batch_time = time.time()
    
    while True:
        try:
            # Poll for new messages
            for message in consumer:
                batch.append(message)
            
            # Check if batch is ready to be processed
            current_time = time.time()
            if (len(batch) >= BATCH_SIZE) or \
               (current_time - last_batch_time > BATCH_TIMEOUT_SECONDS and len(batch) > 0):
                
                process_batch(batch, producer)
                producer.flush()
                
                # Reset batch
                batch = []
                last_batch_time = current_time
        
        except Exception as e:
            print(f"An error occurred in the main loop: {e}")
            time.sleep(5) # Avoid rapid-fire errors

if __name__ == "__main__":
    main()