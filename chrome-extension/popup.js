// --- Global State ---
let userToken = null;
let currentSocket = null;
let allMatches = []; // Holds all matches
let favoriteMatches = []; // Holds only favorite matches
let allTeams = []; // Holds all teams for searching

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
    fetchFavoriteMatches();
    fetchTeams();
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

        try {
            const res = await fetch(`${API_URL}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Registration failed');
            
            // Success! Show login form
            errorDiv.style.display = 'none';
            document.getElementById('show-login').click();
            
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

    // --- NEW --- Logout Button
    document.getElementById('logout-btn').addEventListener('click', () => {
        if (currentSocket) {
            currentSocket.disconnect();
        }
        userToken = null;
        chrome.storage.local.remove('token', () => {
            console.log('Token removed, logging out.');
            showLoginView();
        });
    });
}

// --- Main App Logic ---
function setupMainAppListeners() {
    // Main Tab navigation
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // Deactivate all
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            // Activate clicked
            btn.classList.add('active');
            document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
        });
    });
    
    // --- NEW --- Sub-Tab navigation
    document.querySelectorAll('.sub-tab-nav').forEach(nav => {
        nav.addEventListener('click', (e) => {
            if (!e.target.matches('.sub-tab-btn')) return;
            
            const btn = e.target;
            const filter = btn.dataset.filter;
            const parentTabContent = btn.closest('.tab-content');

            // Update active button state
            parentTabContent.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Re-render the correct list
            if (parentTabContent.id === 'tab-all-matches') {
                renderMatches(allMatches, 'all-matches-list', filter);
            } else if (parentTabContent.id === 'tab-favorites') {
                renderMatches(favoriteMatches, 'fav-matches-list', filter);
            }
        });
    });
    
    // --- NEW --- Search input listener
    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        if (searchTerm.length < 2) {
            teamSearchListEl.innerHTML = '<div class="list-placeholder">Start typing to find teams.</div>';
            return;
        }
        const filteredTeams = allTeams.filter(team => 
            team.name.toLowerCase().includes(searchTerm)
        );
        renderTeams(filteredTeams);
    });

    // --- NEW --- Back button from live feed
    document.getElementById('back-to-matches').addEventListener('click', showMainApp);
}

// --- API Fetching ---
async function fetchApi(endpoint, options = {}) {
    const defaultHeaders = {
        'Content-Type': 'application/json',
    };
    // Add auth token if we have one
    if (userToken) {
        defaultHeaders['Authorization'] = `Bearer ${userToken}`;
    }
    
    const res = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers: {
            ...defaultHeaders,
            ...options.headers,
        },
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `API Error: ${res.status}`);
    return data;
}

async function fetchMatches() {
    try {
        allMatches = await fetchApi('/matches');
        // Get the currently active filter
        const activeFilter = document.querySelector('#tab-all-matches .sub-tab-btn.active').dataset.filter;
        renderMatches(allMatches, 'all-matches-list', activeFilter);
    } catch (err) {
        console.error("Failed to fetch matches:", err);
        allMatchesListEl.innerHTML = '<div class="list-placeholder">Could not load matches.</div>';
    }
}

async function fetchFavoriteMatches() {
    try {
        favoriteMatches = await fetchApi('/my-matches'); // This is a protected endpoint
        const activeFilter = document.querySelector('#tab-favorites .sub-tab-btn.active').dataset.filter;
        renderMatches(favoriteMatches, 'fav-matches-list', activeFilter);
    } catch (err) {
        console.error("Failed to fetch favorite matches:", err);
        favMatchesListEl.innerHTML = '<div class="list-placeholder">Could not load favorites.</div>';
    }
}

async function fetchTeams() {
    try {
        allTeams = await fetchApi('/teams');
        // Initially render nothing, wait for user input
    } catch (err) {
        console.error("Failed to fetch teams:", err);
    }
}

// --- NEW --- Follow Team API Call
async function followTeam(teamId, buttonEl) {
    try {
        buttonEl.disabled = true;
        buttonEl.textContent = '...';
        await fetchApi('/follow', {
            method: 'POST',
            body: JSON.stringify({ team_id: teamId })
        });
        buttonEl.textContent = 'Followed!';
        // Refresh favorite matches after following
        fetchFavoriteMatches();
    } catch (err) {
        console.error('Failed to follow team:', err);
        buttonEl.textContent = 'Error';
    }
}

// --- Rendering Functions ---

// --- MODIFIED --- Now includes filter logic
function renderMatches(matchList, listElementId, filter) {
    const listEl = document.getElementById(listElementId);
    listEl.innerHTML = ''; // Clear list
    
    const now = new Date();
    let filteredList = [];

    if (filter === 'live') {
        filteredList = matchList.filter(m => m.status === 'LIVE');
    } else if (filter === 'finished') {
        filteredList = matchList.filter(m => m.status === 'FINISHED');
    } else if (filter === 'upcoming') {
        filteredList = matchList.filter(m => m.status === 'SCHEDULED' && new Date(m.match_time) > now);
    }

    if (filteredList.length === 0) {
        listEl.innerHTML = `<div class="list-placeholder">No ${filter} matches found.</div>`;
        return;
    }
    
    filteredList.forEach(match => {
        const card = document.createElement('div');
        card.className = 'match-card';
        card.innerHTML = `
            <div class="match-teams">
                <div class="team">
                    <img src="${match.home_logo || ''}" alt="${match.home_team}">
                    <span>${match.home_team}</span>
                </div>
                <span class="match-score">
                    ${match.status === 'LIVE' ? `<span class="live-dot">●</span> ${match.score || '0-0'}` : (match.score || 'vs')}
                </span>
                <div class="team">
                    <span>${match.away_team || 'TBD'}</span>
                    <img src="${match.away_logo || ''}" alt="${match.away_team || 'TBD'}">
                </div>
            </div>
            <div class="match-info">
                ${new Date(match.match_time).toLocaleString()} (${match.status})
            </div>
        `;
        
        // Add click listener to watch the match
        card.addEventListener('click', () => {
            const matchName = `${match.home_team} vs ${match.away_team || 'TBD'}`;
            showLiveFeed(match.id, matchName);
        });
        
        listEl.appendChild(card);
    });
}

// --- NEW --- Renders the team search results
function renderTeams(teamList) {
    teamSearchListEl.innerHTML = ''; // Clear list

    if (teamList.length === 0) {
        teamSearchListEl.innerHTML = '<div class="list-placeholder">No teams found.</div>';
        return;
    }

    teamList.forEach(team => {
        const item = document.createElement('div');
        item.className = 'team-list-item';
        
        item.innerHTML = `
            <div class="team">
                <img src="${team.logo_url || ''}" alt="${team.name}">
                <span>${team.name}</span>
            </div>
            <button class="follow-btn" data-team-id="${team.id}">Follow</button>
        `;
        
        // Add click listener for the follow button
        item.querySelector('.follow-btn').addEventListener('click', (e) => {
            e.stopPropagation(); // Don't trigger other clicks
            followTeam(team.id, e.target);
        });
        
        teamSearchListEl.appendChild(item);
    });
}

// --- WebSocket Logic ---
function connectSocket(token) {
    if (currentSocket) {
        currentSocket.disconnect();
    }

    // Authenticate by sending the token in the 'auth' payload
    // THIS IS THE NEW AUTH METHOD
    currentSocket = io(API_URL, {
        query: { token } 
    });

    currentSocket.on('connect', () => {
        console.log('Socket connected and authenticated');
    });

    currentSocket.on('disconnect', () => {
        console.log('Socket disconnected');
    });

    currentSocket.on('connect_error', (err) => {
        console.error('Socket connection error:', err.message);
        // If auth error, clear token and force re-login
        if (err.message.includes("No token")) {
            chrome.storage.local.remove('token', () => showLoginView());
        }
    });

    currentSocket.on('joined_room', (data) => {
        console.log('Successfully joined room:', data.room);
    });

    currentSocket.on('new_snippet', (data) => {
        console.log('New snippet:', data);
        addFeedItem(`[Play] ${data.snippet}`, 'snippet');
    });

    currentSocket.on('new_event', (data) => {
        console.log('New event:', data);
        const text = data.text || `${data.event_type} - ${data.player || ''}`;
        addFeedItem(`[${data.time || '!'}] ${text}`, 'event');
    });
}

function addFeedItem(text, type) {
    const li = document.createElement('li');
    li.className = `feed-item ${type}`; // 'snippet' or 'event'
    li.textContent = text;
    // Prepend (newest first) but remove the "waiting" message
    if (feedList.firstElementChild && feedList.firstElementChild.textContent.includes('Waiting')) {
        feedList.innerHTML = '';
    }
    feedList.prepend(li);
}