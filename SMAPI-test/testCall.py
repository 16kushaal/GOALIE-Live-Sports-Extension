import requests

# Replace with your actual API token from MySportmonks
API_TOKEN = "YOUR_TOKEN"

# Base URL
BASE_URL = "https://api.sportmonks.com/v3/football"

def get_fixtures_basic():
    """Get basic fixture data"""
    url = f"{BASE_URL}/fixtures?api_token={API_TOKEN}"
    response = requests.get(url)
    if response.status_code == 200:
        return response.json()
    else:
        print("Error:", response.status_code, response.text)
        return None

def get_fixtures_with_includes():
    """Get fixtures including statistics and events"""
    url = f"{BASE_URL}/fixtures?api_token={API_TOKEN}&include=statistics;events"
    response = requests.get(url)
    if response.status_code == 200:
        return response.json()
    else:
        print("Error:", response.status_code, response.text)
        return None

def get_fixture_name(fixture_id):
    """Get only the fixture's name field"""
    url = f"{BASE_URL}/fixtures/{fixture_id}?api_token={API_TOKEN}&select=name"
    response = requests.get(url)
    if response.status_code == 200:
        return response.json()
    else:
        print("Error:", response.status_code, response.text)
        return None

if __name__ == "__main__":
    # Example 1: Basic fixtures
    fixtures = get_fixtures_basic()
    if fixtures:
        print("Basic Fixtures Response:")
        print(fixtures)

    # Example 2: Fixtures with statistics and events
    fixtures_includes = get_fixtures_with_includes()
    if fixtures_includes:
        print("\nFixtures with Statistics & Events:")
        print(fixtures_includes)

    # Example 3: Specific fixture name
    fixture_id = 18535517  # Example fixture ID
    fixture_name = get_fixture_name(fixture_id)
    if fixture_name:
        print("\nFixture Name:")
        print(fixture_name)
