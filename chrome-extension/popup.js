document.addEventListener('DOMContentLoaded', () => {
    const statusDiv = document.getElementById('status');
    const joinButton = document.getElementById('join-btn');
    const matchSelect = document.getElementById('match-select');
    const feedList = document.getElementById('feed-list');
    
    let currentRoom = null;
    let socket;

    // --- API & Socket Functions ---

    function connectSocket() {
        // Disconnect if already connected
        if (socket) {
            socket.disconnect();
        }

        socket = io('http://localhost:5000', {
            reconnectionAttempts: 3 // Try to reconnect 3 times
        });

        socket.on('connect', () => {
            statusDiv.textContent = 'Connected';
            statusDiv.style.color = 'green';
            console.log('Connected to server');
        });

        socket.on('disconnect', () => {
            statusDiv.textContent = 'Disconnected';
            statusDiv.style.color = 'red';
            console.log('Disconnected from server');
        });

        socket.on('connect_error', (err) => {
            console.error('Connection error:', err.message);
            statusDiv.textContent = 'Failed to connect. Is server running?';
            statusDiv.style.color = 'red';
        });

        socket.on('joined_room', (data) => {
            console.log('Successfully joined room:', data.room);
            currentRoom = data.room;
            const matchName = matchSelect.options[matchSelect.selectedIndex].text;
            statusDiv.textContent = `Following: ${matchName}`;
            feedList.innerHTML = ''; // Clear the list
        });

        socket.on('new_snippet', (data) => {
            console.log('New snippet:', data);
            addFeedItem(`[Play] ${data.snippet}`, 'snippet');
        });

        socket.on('new_event', (data) => {
            console.log('New event:', data);
            const text = data.text || `${data.event_type} - ${data.player || ''}`;
            addFeedItem(`[${data.time || '!'}] ${text}`, 'event');
        });
    }

    function addFeedItem(text, type) {
        const li = document.createElement('li');
        li.className = type; // 'snippet' or 'event'
        li.textContent = text;
        feedList.prepend(li);
    }

    async function fetchMatches() {
        try {
            const response = await fetch('http://localhost:5000/matches');
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            const matches = await response.json();
            
            // Clear existing options (except the first "Select")
            matchSelect.options.length = 1;
            
            matches.forEach(match => {
                // Use away_team or 'TBD' if null
                const awayTeam = match.away_team || 'TBD';
                const optionText = `${match.home_team} vs ${awayTeam} (${match.status})`;
                
                const option = new Option(optionText, match.id);
                matchSelect.add(option);
            });

        } catch (error) {
            console.error('Failed to fetch matches:', error);
            statusDiv.textContent = 'Could not fetch matches.';
            statusDiv.style.color = 'red';
        }
    }

    // --- Event Listeners ---

    joinButton.addEventListener('click', () => {
        const matchId = matchSelect.value;
        if (!matchId || !socket || !socket.connected) {
            statusDiv.textContent = 'Please select a match and ensure you are connected.';
            return;
        }
        
        console.log(`Attempting to join match ${matchId}`);
        // The ID is a string (e.g., "EP25001"), so no parseInt
        socket.emit('join_match', { match_id: matchId });
    });

    // --- Initial Load ---
    fetchMatches();
    connectSocket();
});