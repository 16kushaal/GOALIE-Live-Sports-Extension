import json
import joblib
from kafka import KafkaConsumer, KafkaProducer

# --- Configuration ---
KAFKA_BROKER = '127.0.0.1:9092'
CONSUME_TOPIC = 'raw_commentary'
PRODUCE_TOPIC = 'classified_commentary'
GROUP_ID = 'classifier-group'

# Path to your saved model
MODEL_FILE = 'model/classifier.joblib'

def get_kafka_client():
    """Initializes and returns a Kafka Consumer and Producer."""
    consumer = KafkaConsumer(
        CONSUME_TOPIC,
        bootstrap_servers=[KAFKA_BROKER],
        auto_offset_reset='earliest',
        group_id=GROUP_ID,
        value_deserializer=lambda v: json.loads(v.decode('utf-8'))
    )
    
    producer = KafkaProducer(
        bootstrap_servers=[KAFKA_BROKER],
        value_serializer=lambda v: json.dumps(v).encode('utf-8')
    )
    return consumer, producer

def load_model(path):
    """Loads the pre-trained joblib model."""
    try:
        model = joblib.load(path)
        print(f"✅ Successfully loaded model from {path}")
        return model
    except FileNotFoundError:
        print(f"❌ Error: Model file not found at {path}")
        print("Please make sure 'classifier.joblib' is in the 'model/' folder.")
        exit(1)
    except Exception as e:
        print(f"❌ Error loading model: {e}")
        exit(1)

def main():
    consumer, producer = get_kafka_client()
    model = load_model(MODEL_FILE)
    
    print("✅ Classifier service running (using Joblib model)...")
    
    for message in consumer:
        try:
            data = message.value
            text = data.get('text', '')
            
            # Use the model to predict the tag
            # model.predict() expects a list or array-like
            classification_tag = model.predict([text])[0]
            
            # *** IMPORTANT ***
            # Change 'current' to be the exact positive tag your model outputs
            if classification_tag == 'CURRENT': 
                print(f"Forwarding (CURRENT): {text}")
                producer.send(PRODUCE_TOPIC, value=data)
            else:
                print(f"Discarding ({classification_tag}): {text}")
                
        except Exception as e:
            print(f"Error processing message: {e}")

if __name__ == "__main__":
    main()