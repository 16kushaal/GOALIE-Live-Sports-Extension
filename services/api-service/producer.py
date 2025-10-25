from confluent_kafka import Producer
import json, time, random, os

TOPIC = "raw_commentary"

producer = Producer({"bootstrap.servers": "localhost:9092"})  # force override, no env read

commentaries = [
    "Rashford scores a brilliant goal!",
    "Chelsea wins a corner kick.",
    "Bruno Fernandes attempts a through ball.",
    "Varane commits a foul near the box.",
    "Substitution: Mount in for Eriksen."
]

def simulate_commentary(match_id="E25001"):
    while True:
        commentary = random.choice(commentaries)
        message = {
            "match_id": match_id,
            "timestamp": time.time(),
            "commentary": commentary
        }
        producer.produce(TOPIC, json.dumps(message).encode("utf-8"))
        producer.flush()
        print(f"[RAW PRODUCER] Sent: {message}")
        time.sleep(3)

if __name__ == "__main__":
    print("🔥 Using Kafka broker at localhost:9092")
    simulate_commentary()
