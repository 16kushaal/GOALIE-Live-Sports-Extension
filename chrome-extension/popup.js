// --- Global State ---
let userToken = null;
let currentSocket = null;
let allMatches = []; // Holds all matches
let favoriteMatches = []; // Holds only favorite matches
let allTeams = []; // Holds all teams for searching
let favoriteTeamIds = new Set(); // Keep track of followed team IDs

// --- DOM Elements ---
const loginView = document.getElementById('login-view');
const mainAppView = document.getElementById('main-app-view');
const liveFeedView = document.getElementById('live-feed-view');
const feedList = document.getElementById('feed-list');
const feedHeaderTitle = document.getElementById('feed-header-title');

const allMatchesListEl = document.getElementById('all-matches-list');
const favMatchesListEl = document.getElementById('fav-matches-list');
const teamSearchListEl = document.getElementById('team-search-list');
const searchInput = document.getElementById('search-input');

const API_URL = 'http://localhost:5000';

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Check if user is already logged in
    chrome.storage.local.get(['token'], (result) => {
        if (result.token) {
            userToken = result.token;
            showMainApp();
        } else {
            showLoginView();
        }
    });

    setupAuthListeners();
    setupMainAppListeners();
});

// --- View Toggling ---
function showLoginView() {
    mainAppView.style.display = 'none';
    liveFeedView.style.display = 'none';
    loginView.style.display = 'block';
}

function showMainApp() {
    loginView.style.display = 'none';
    liveFeedView.style.display = 'none';
    mainAppView.style.display = 'block';

    // Connect socket and fetch all data
    connectSocket(userToken);
    fetchMatches();
    fetchTeams(); // Fetch teams which will also trigger fetching favorites
}

function showLiveFeed(matchId, matchName) {
    mainAppView.style.display = 'none';
    liveFeedView.style.display = 'block';
    feedHeaderTitle.textContent = matchName;

    // Join the WebSocket room
    if (currentSocket && currentSocket.connected) {
        console.log(`Attempting to join match ${matchId}`);
        currentSocket.emit('join_match', { match_id: matchId });
        feedList.innerHTML = '<li class="feed-item">Waiting for updates...</li>';
    } else {
        feedList.innerHTML = '<li class="feed-item">Error: Not connected. Please log in again.</li>';
    }
}

// --- Authentication ---
function setupAuthListeners() {
    // Form toggling
    document.getElementById('show-register').addEventListener('click', () => {
        document.getElementById('login-form').style.display = 'none';
        document.getElementById('register-form').style.display = 'block';
    });
    document.getElementById('show-login').addEventListener('click', () => {
        document.getElementById('register-form').style.display = 'none';
        document.getElementById('login-form').style.display = 'block';
    });

    // Register Button
    document.getElementById('register-btn').addEventListener('click', async () => {
        const email = document.getElementById('register-email').value;
        const password = document.getElementById('register-password').value;
        const errorDiv = document.getElementById('auth-error-register');
        errorDiv.style.display = 'none'; // Hide error initially

        try {
            const res = await fetch(`${API_URL}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Registration failed');

            // Success! Show login form
            document.getElementById('show-login').click();
            document.getElementById('login-email').value = email; // Pre-fill email
            alert('Registration successful! Please log in.'); // Give user feedback

        } catch (err) {
            errorDiv.textContent = err.message;
            errorDiv.style.display = 'block';
        }
    });

    // Login Button
    document.getElementById('login-btn').addEventListener('click', async () => {
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        const errorDiv = document.getElementById('auth-error-login');
        errorDiv.style.display = 'none'; // Hide error initially

        try {
            const res = await fetch(`${API_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Login failed');

            // SUCCESS! Store token and show main app
            userToken = data.access_token;
            chrome.storage.local.set({ token: userToken }, () => {
                console.log('Token saved.');
                showMainApp();
            });

        } catch (err) {
            errorDiv.textContent = err.message;
            errorDiv.style.display = 'block';
        }
    });

    // Logout Button
    document.getElementById('logout-btn').addEventListener('click', () => {
        if (currentSocket) {
            currentSocket.disconnect();
            currentSocket = null;
        }
        userToken = null;
        chrome.storage.local.remove('token', () => {
            console.log('Token removed, logging out.');
            // Clear state
            allMatches = [];
            favoriteMatches = [];
            allTeams = [];
            favoriteTeamIds.clear();
            showLoginView();
        });
    });
}

// --- Main App Listeners & Logic ---
function setupMainAppListeners() {
    // Main Tab navigation
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            const tabContent = document.getElementById(`tab-${btn.dataset.tab}`);
            tabContent.classList.add('active');

            // Re-render lists when switching tabs to apply current filter
            const activeFilter = tabContent.querySelector('.sub-tab-btn.active')?.dataset.filter;
            if (activeFilter) {
                 if (tabContent.id === 'tab-all-matches') {
                    renderMatches(allMatches, 'all-matches-list', activeFilter);
                } else if (tabContent.id === 'tab-favorites') {
                    renderMatches(favoriteMatches, 'fav-matches-list', activeFilter);
                }
            }
        });
    });

    // Sub-Tab navigation (delegated listener)
    document.querySelectorAll('.sub-tab-nav').forEach(nav => {
        nav.addEventListener('click', (e) => {
            if (!e.target.matches('.sub-tab-btn')) return;

            const btn = e.target;
            const filter = btn.dataset.filter;
            const parentTabContent = btn.closest('.tab-content');

            // Update active button state within this sub-nav
            parentTabContent.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Re-render the correct list with the new filter
            if (parentTabContent.id === 'tab-all-matches') {
                renderMatches(allMatches, 'all-matches-list', filter);
            } else if (parentTabContent.id === 'tab-favorites') {
                renderMatches(favoriteMatches, 'fav-matches-list', filter);
            }
        });
    });

    // Search input listener
    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase().trim();
        if (searchTerm.length < 1) { // Show placeholder if empty
            teamSearchListEl.innerHTML = '<div class="list-placeholder">Start typing to find teams.</div>';
            return;
        }
        // Filter teams based on the search term
        const filteredTeams = allTeams.filter(team =>
            team.name.toLowerCase().includes(searchTerm)
        );
        renderTeams(filteredTeams); // Render the filtered list
    });

    // Back button from live feed
    document.getElementById('back-to-matches').addEventListener('click', showMainApp);
}

// --- API Fetching ---
async function fetchApi(endpoint, options = {}) {
    const defaultHeaders = {
        'Content-Type': 'application/json',
    };
    if (userToken) {
        defaultHeaders['Authorization'] = `Bearer ${userToken}`;
    }

    try {
        const res = await fetch(`${API_URL}${endpoint}`, {
            ...options,
            headers: {
                ...defaultHeaders,
                ...options.headers,
            },
        });

        // Handle cases where the response might not have JSON (e.g., successful DELETE)
        if (res.status === 204 || res.headers.get('content-length') === '0') {
             return null; // Or return a success indicator if needed
        }

        const data = await res.json();
        if (!res.ok) {
            // Check for auth errors (e.g., expired token)
             if (res.status === 401 || res.status === 422) {
                 console.warn("Auth error detected, logging out.");
                 document.getElementById('logout-btn').click(); // Trigger logout flow
             }
            throw new Error(data.error || `API Error: ${res.status}`);
        }
        return data;
    } catch (error) {
         console.error(`API Fetch Error (${endpoint}):`, error);
         // Handle error appropriately, maybe show a message to the user
         throw error; // Re-throw to be caught by calling function
    }
}

async function fetchMatches() {
    try {
        allMatches = await fetchApi('/matches');
        const activeFilter = document.querySelector('#tab-all-matches .sub-tab-btn.active').dataset.filter;
        renderMatches(allMatches, 'all-matches-list', activeFilter);
    } catch (err) {
        console.error("Failed to fetch matches:", err);
        allMatchesListEl.innerHTML = '<div class="list-placeholder">Could not load matches. Try logging out and back in.</div>';
    }
}

async function fetchFavoriteMatches() {
    try {
        // --- IMPORTANT: Backend needs to return list of *teams*, not just matches ---
        // For now, we will fetch the favorite *matches* and infer favorite teams
        // This is inefficient and should be fixed in the backend later.
        favoriteMatches = await fetchApi('/my-matches');

        // Update the set of favorite team IDs based on the fetched matches
        favoriteTeamIds.clear();
        favoriteMatches.forEach(match => {
            // Need the actual team IDs from the match object
            // Assuming backend provides home_team_id and away_team_id
            if (match.home_team_id) favoriteTeamIds.add(match.home_team_id);
            if (match.away_team_id) favoriteTeamIds.add(match.away_team_id);
        });
        // A better approach: Create a '/my-teams' endpoint returning followed team IDs/objects.
        // Then call that here: const favTeamsData = await fetchApi('/my-teams'); favoriteTeamIds = new Set(favTeamsData.map(t => t.id));

        const activeFilter = document.querySelector('#tab-favorites .sub-tab-btn.active').dataset.filter;
        renderMatches(favoriteMatches, 'fav-matches-list', activeFilter);

    } catch (err) {
        console.error("Failed to fetch favorite matches:", err);
        favMatchesListEl.innerHTML = '<div class="list-placeholder">Could not load favorites. Try logging out and back in.</div>';
    }
}


async function fetchTeams() {
    try {
        allTeams = await fetchApi('/teams');
        // We fetch favorites *after* fetching all teams to ensure favoriteTeamIds is populated
        await fetchFavoriteMatches();
        // Render search results based on current input
        const searchTerm = searchInput.value.toLowerCase().trim();
         if (searchTerm.length > 0) {
              const filteredTeams = allTeams.filter(team =>
                  team.name.toLowerCase().includes(searchTerm)
              );
              renderTeams(filteredTeams);
         } else {
             teamSearchListEl.innerHTML = '<div class="list-placeholder">Start typing to find teams.</div>';
         }

    } catch (err) {
        console.error("Failed to fetch teams:", err);
    }
}

// Follow Team API Call
async function followTeam(teamId, buttonEl) {
    try {
        buttonEl.disabled = true;
        buttonEl.textContent = '...';
        await fetchApi('/follow', {
            method: 'POST',
            body: JSON.stringify({ team_id: teamId })
        });
        // Update button appearance and behavior AFTER success
        buttonEl.textContent = 'Unfollow';
        buttonEl.className = 'unfollow-btn';
        buttonEl.onclick = (e) => { // Change the event listener
             e.stopPropagation();
             unfollowTeam(teamId, buttonEl);
        };
        favoriteTeamIds.add(teamId); // Update local state
        fetchFavoriteMatches(); // Refresh favorite matches list
    } catch (err) {
        console.error('Failed to follow team:', err);
        buttonEl.textContent = 'Error'; // Show error on button
         setTimeout(() => { // Reset button after a delay
             buttonEl.textContent = 'Follow'; // Reset text
             buttonEl.className = 'follow-btn'; // Reset class
             buttonEl.onclick = (e) => { // Reset listener
                 e.stopPropagation();
                 followTeam(teamId, buttonEl);
             };
         }, 2000);
    } finally {
        buttonEl.disabled = false; // Always re-enable button
    }
}

// Unfollow Team API Call
async function unfollowTeam(teamId, buttonEl) {
    try {
        buttonEl.disabled = true;
        buttonEl.textContent = '...';
        await fetchApi('/unfollow', {
            method: 'DELETE',
            body: JSON.stringify({ team_id: teamId })
        });
        // Update button appearance and behavior AFTER success
        buttonEl.textContent = 'Follow';
        buttonEl.className = 'follow-btn';
        buttonEl.onclick = (e) => { // Change the event listener back
             e.stopPropagation();
             followTeam(teamId, buttonEl);
        };
        favoriteTeamIds.delete(teamId); // Update local state
        fetchFavoriteMatches(); // Refresh favorite matches list
    } catch (err) {
        console.error('Failed to unfollow team:', err);
        buttonEl.textContent = 'Error';
         setTimeout(() => { // Reset button after a delay
             buttonEl.textContent = 'Unfollow'; // Reset text
             buttonEl.className = 'unfollow-btn'; // Reset class
             buttonEl.onclick = (e) => { // Reset listener
                 e.stopPropagation();
                 unfollowTeam(teamId, buttonEl);
             };
         }, 2000);
    } finally {
        buttonEl.disabled = false; // Always re-enable button
    }
}


// --- Rendering Functions ---

// Render Matches - Includes filter logic and data attributes
function renderMatches(matchList, listElementId, filter) {
    const listEl = document.getElementById(listElementId);
    listEl.innerHTML = ''; // Clear previous content

    const now = new Date();
    let filteredList = [];

    // Map status for filtering
    const statusMap = {
        'LIVE': 'live',
        'HALF_TIME': 'live',
        'SCHEDULED': 'upcoming',
        'FINISHED': 'finished',
        'POSTPONED': 'upcoming', // Example: Treat postponed as upcoming
        'CANCELLED': 'finished' // Example: Treat cancelled as finished
    };

    filteredList = matchList.filter(m => {
        const mappedStatus = statusMap[m.status] || 'upcoming'; // Default unknown status to upcoming

        // Special handling for upcoming: only show future matches
        if (filter === 'upcoming') {
            return mappedStatus === 'upcoming' && new Date(m.match_time) > now;
        }
        return mappedStatus === filter;
    });

    if (filteredList.length === 0) {
        listEl.innerHTML = `<div class="list-placeholder">No ${filter} matches found.</div>`;
        return;
    }

    filteredList.forEach(match => {
        const card = document.createElement('div');
        card.className = 'match-card';
        card.setAttribute('data-match-id', match.id); // Set ID for updates

        const isLive = match.status === 'LIVE' || match.status === 'HALF_TIME';
        const displayScore = match.score || (isLive ? '0-0' : 'vs');
        const liveDotHtml = isLive ? '<span class="live-dot">●</span> ' : '';

        card.innerHTML = `
            ${isLive ? '<span class="match-time" data-match-time>--\'</span>' : ''}
            <div class="match-teams">
                <div class="team home">
                    <img src="${match.home_logo || ''}" alt="${match.home_team}">
                    <span>${match.home_team}</span>
                </div>
                <span class="match-score" data-match-score>
                   ${liveDotHtml}${displayScore}
                </span>
                <div class="team away">
                    <span>${match.away_team || 'TBD'}</span>
                    <img src="${match.away_logo || ''}" alt="${match.away_team || 'TBD'}">
                </div>
            </div>
            <div class="match-info">
                ${new Date(match.match_time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })} (${match.status})
            </div>
        `;

        card.addEventListener('click', () => {
            const matchName = `${match.home_team} vs ${match.away_team || 'TBD'}`;
            showLiveFeed(match.id, matchName);
        });

        listEl.appendChild(card);
    });
}

// Render Team Search Results - Includes Follow/Unfollow Button Logic
function renderTeams(teamList) {
    teamSearchListEl.innerHTML = ''; // Clear previous results

    if (teamList.length === 0) {
        teamSearchListEl.innerHTML = '<div class="list-placeholder">No teams found matching your search.</div>';
        return;
    }

    teamList.forEach(team => {
        const item = document.createElement('div');
        item.className = 'team-list-item';

        const isFollowed = favoriteTeamIds.has(team.id); // Check if already followed
        const buttonClass = isFollowed ? 'unfollow-btn' : 'follow-btn';
        const buttonText = isFollowed ? 'Unfollow' : 'Follow';

        item.innerHTML = `
            <div class="team">
                <img src="${team.logo_url || ''}" alt="${team.name}">
                <span>${team.name}</span>
            </div>
            <button class="${buttonClass}" data-team-id="${team.id}">${buttonText}</button>
        `;

        // Add correct click listener based on follow status
        const buttonEl = item.querySelector('button');
        if (isFollowed) {
            buttonEl.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent card click
                unfollowTeam(team.id, e.target);
            });
        } else {
            buttonEl.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent card click
                followTeam(team.id, e.target);
            });
        }

        teamSearchListEl.appendChild(item);
    });
}

// --- WebSocket Logic ---
function connectSocket(token) {
    if (currentSocket && currentSocket.connected) {
        console.log("Socket already connected.");
        return; // Don't reconnect if already connected
    }
    if (currentSocket) {
        currentSocket.disconnect(); // Disconnect previous if exists but not connected
    }


    console.log("Attempting to connect socket with token:", token);
    currentSocket = io(API_URL, {
        query: { token }
    });

    currentSocket.on('connect', () => {
        console.log('Socket connected and authenticated');
    });

    currentSocket.on('disconnect', (reason) => {
        console.log('Socket disconnected:', reason);
        // Optionally handle reconnection logic or notify user
    });

    currentSocket.on('connect_error', (err) => {
        console.error('Socket connection error:', err.message);
        if (err.message.includes("Invalid token") || err.message.includes("No token")) {
             console.warn("Auth error detected during connection, logging out.");
             document.getElementById('logout-btn').click(); // Trigger logout
        }
    });

    currentSocket.on('joined_room', (data) => {
        console.log('Successfully joined room:', data.room);
    });

    currentSocket.on('new_snippet', (data) => {
        console.log('New snippet:', data);
        // Ensure we are in the live feed view before adding
        if (liveFeedView.style.display === 'block') {
             addFeedItem(`[Play] ${data.snippet}`, 'snippet');
        }
    });

    currentSocket.on('new_event', (data) => {
        console.log('New event:', data);
        const text = data.text || `${data.event_type} - ${data.player || ''}`;
        const time = data.time || '!'; // Use '!' if time is missing

        // Add to live feed if currently viewing
        if (liveFeedView.style.display === 'block') {
            // Determine event class for styling
            let eventClass = 'event';
            if (data.event_type === 'GOAL') eventClass += ' goal';
            else if (data.event_type.includes('CARD')) eventClass += ' card';
            else if (data.event_type === 'SUBSTITUTION') eventClass += ' sub';
            
             addFeedItem(`[${time}] ${text}`, eventClass);
        }

        // Update score and time on match card(s) in main view
        const matchId = data.match_id;
        const score = data.score;
        const matchTime = data.time;
        const status = data.event_type === 'FULL_TIME' ? 'FINISHED' : (data.event_type === 'HALF_TIME' ? 'HALF_TIME' : 'LIVE'); // Update status

        const matchCards = document.querySelectorAll(`.match-card[data-match-id="${matchId}"]`);

        matchCards.forEach(card => {
            const scoreEl = card.querySelector('[data-match-score]');
            const timeEl = card.querySelector('[data-match-time]');
            const infoEl = card.querySelector('.match-info'); // Element for status

            if (scoreEl && score) {
                const liveDotHtml = (status === 'LIVE' || status === 'HALF_TIME') ? '<span class="live-dot">●</span> ' : '';
                scoreEl.innerHTML = `${liveDotHtml}${score}`;
            }
            if (timeEl && matchTime) {
                timeEl.textContent = matchTime;
            }
            if (infoEl && (status === 'FINISHED' || status === 'HALF_TIME')) {
                 // Update the status text in the info line
                 const timeString = new Date(allMatches.find(m=>m.id===matchId)?.match_time || Date.now()).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
                 infoEl.textContent = `${timeString} (${status})`;
                 // Remove live time element if match finished
                 if (status === 'FINISHED' && timeEl) timeEl.remove();
            }
        });
    });
}


function addFeedItem(text, typeClass) {
    const li = document.createElement('li');
    li.className = `feed-item ${typeClass}`; // Apply base and specific class
    li.textContent = text;

    // Remove "Waiting" message if present
    const firstItem = feedList.firstElementChild;
    if (firstItem && firstItem.textContent.includes('Waiting')) {
        feedList.innerHTML = '';
    }
    feedList.prepend(li); // Add new item to the top
}