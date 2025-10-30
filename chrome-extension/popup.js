// --- Global State ---
let userToken = null;
let currentSocket = null;
let allMatches = []; // Holds all matches fetched from /matches
let favoriteMatches = []; // Holds matches involving followed teams fetched from /my-matches
let allTeams = []; // Holds all teams fetched from /teams
let favoriteTeamIds = new Set(); // Holds *only* the IDs of teams the user follows, fetched from /my-teams
let currentMatchData = null; // Store data of the match being viewed

// --- DOM Elements ---
const loginView = document.getElementById('login-view');
const mainAppView = document.getElementById('main-app-view');
const liveFeedView = document.getElementById('live-feed-view');
const feedList = document.getElementById('feed-list');
const feedHeaderTitle = document.getElementById('feed-header-title');
const feedLiveDot = document.getElementById('feed-live-dot');
const feedMatchTime = document.getElementById('feed-match-time');
const feedMatchScore = document.getElementById('feed-match-score');
const feedHomeLogo = document.getElementById('feed-home-logo');
const feedAwayLogo = document.getElementById('feed-away-logo');

const allMatchesListEl = document.getElementById('all-matches-list');
const favMatchesListEl = document.getElementById('fav-matches-list');
const teamSearchListEl = document.getElementById('team-search-list');
const searchInput = document.getElementById('search-input');
const allLeagueFilter = document.getElementById('all-league-filter');
const favLeagueFilter = document.getElementById('fav-league-filter');

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
    currentMatchData = null; // Reset current match when going back

    // Ensure socket is connected and fetch data
    if (!currentSocket || !currentSocket.connected) {
        connectSocket(userToken);
    }
    // Fetch crucial data on showing main view
    // *** FIX ***: Fetch favorite *teams* first, then matches
    fetchFavoriteTeamsAndUpdateIds().then(() => {
        fetchMatches(); // Fetch all matches
        fetchFavoriteMatches(); // Fetch the filtered favorite matches
        fetchTeams(); // Fetch all teams for search
    });
}


function showLiveFeed(matchId) {
    // Find the full match data from our lists
    currentMatchData = allMatches.find(m => m.id === matchId) || favoriteMatches.find(m => m.id === matchId);

    if (!currentMatchData) {
        console.error("Could not find match data for ID:", matchId);
        showMainApp(); // Go back if data is missing
        return;
    }

    mainAppView.style.display = 'none';
    liveFeedView.style.display = 'block';

    const matchName = `${currentMatchData.home_team} vs ${currentMatchData.away_team || 'TBD'}`;
    feedHeaderTitle.textContent = matchName;

    const isLive = currentMatchData.status === 'LIVE' || currentMatchData.status === 'HALF_TIME';
    feedLiveDot.style.display = isLive ? 'inline-block' : 'none';
    // Find the latest time from the match card if available, otherwise default
    const cardTimeEl = document.querySelector(`.match-card[data-match-id="${matchId}"] [data-match-time]`);
    feedMatchTime.textContent = cardTimeEl ? cardTimeEl.textContent : (isLive ? "0'" : "--'"); // Default to 0' if live
    feedMatchScore.textContent = currentMatchData.score || (isLive ? '0-0' : '');

    // Set Logos
    feedHomeLogo.src = currentMatchData.home_logo || '';
    feedHomeLogo.alt = currentMatchData.home_team;
    feedHomeLogo.style.visibility = currentMatchData.home_logo ? 'visible' : 'hidden';
    feedAwayLogo.src = currentMatchData.away_logo || '';
    feedAwayLogo.alt = currentMatchData.away_team || 'TBD';
    feedAwayLogo.style.visibility = currentMatchData.away_logo ? 'visible' : 'hidden';


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
        document.getElementById('auth-error-login').style.display = 'none'; // Hide other error
    });
    document.getElementById('show-login').addEventListener('click', () => {
        document.getElementById('register-form').style.display = 'none';
        document.getElementById('login-form').style.display = 'block';
        document.getElementById('auth-error-register').style.display = 'none'; // Hide other error
    });

    // Register Button
    document.getElementById('register-btn').addEventListener('click', async () => {
        const email = document.getElementById('register-email').value;
        const password = document.getElementById('register-password').value;
        const errorDiv = document.getElementById('auth-error-register');
        errorDiv.style.display = 'none';

        if (!email || !password) {
             errorDiv.textContent = 'Email and password are required.';
             errorDiv.style.display = 'block';
             return;
        }

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
            alert('Registration successful! Please log in.');

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
        errorDiv.style.display = 'none';

         if (!email || !password) {
             errorDiv.textContent = 'Email and password are required.';
             errorDiv.style.display = 'block';
             return;
        }

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
            currentMatchData = null;
            // Clear UI elements before showing login
            allMatchesListEl.innerHTML = '';
            favMatchesListEl.innerHTML = '';
            teamSearchListEl.innerHTML = '';
            searchInput.value = '';
            showLoginView();
        });
    });
}

// --- Main App Listeners & Logic ---
function setupMainAppListeners() {
    // Main Tab navigation
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.parentElement.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            const tabContent = document.getElementById(`tab-${btn.dataset.tab}`);
            if (tabContent) {
                tabContent.classList.add('active');

                // Re-render lists when switching tabs to apply current filters
                const activeFilterBtn = tabContent.querySelector('.sub-tab-btn.active');
                const leagueFilterSelect = tabContent.querySelector('.league-filter select');

                const statusFilter = activeFilterBtn ? activeFilterBtn.dataset.filter : 'live';
                const leagueFilter = leagueFilterSelect ? leagueFilterSelect.value : 'ALL';

                if (tabContent.id === 'tab-all-matches') {
                    renderMatches(allMatches, 'all-matches-list', statusFilter, leagueFilter);
                } else if (tabContent.id === 'tab-favorites') {
                    renderMatches(favoriteMatches, 'fav-matches-list', statusFilter, leagueFilter);
                } else if (tabContent.id === 'tab-search') {
                    const searchTerm = searchInput.value.toLowerCase().trim();
                    if (searchTerm) {
                        const filteredTeams = allTeams.filter(team => team.name.toLowerCase().includes(searchTerm));
                        renderTeams(filteredTeams);
                    } else {
                         teamSearchListEl.innerHTML = '<div class="list-placeholder">Start typing to find teams.</div>';
                    }
                }
            } else {
                 console.error("Tab content not found for:", btn.dataset.tab);
            }
        });
    });


    // Sub-Tab navigation (delegated listener)
    document.querySelectorAll('.sub-tab-nav').forEach(nav => {
        nav.addEventListener('click', (e) => {
             if (!e.target.matches('.sub-tab-btn')) return;
             const btn = e.target;
             const statusFilter = btn.dataset.filter;
             const parentTabContent = btn.closest('.tab-content');
             parentTabContent.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
             btn.classList.add('active');
             
             const leagueFilterSelect = parentTabContent.querySelector('.league-filter select');
             const leagueFilter = leagueFilterSelect ? leagueFilterSelect.value : 'ALL';

             if (parentTabContent.id === 'tab-all-matches') {
                 renderMatches(allMatches, 'all-matches-list', statusFilter, leagueFilter);
             } else if (parentTabContent.id === 'tab-favorites') {
                 renderMatches(favoriteMatches, 'fav-matches-list', statusFilter, leagueFilter);
             }
        });
    });

    // League Filter dropdown listeners
    [allLeagueFilter, favLeagueFilter].forEach(selectEl => {
        selectEl.addEventListener('change', (e) => {
             const leagueFilter = e.target.value;
             const parentTabContent = e.target.closest('.tab-content');
             const activeSubTabBtn = parentTabContent.querySelector('.sub-tab-btn.active');
             const statusFilter = activeSubTabBtn ? activeSubTabBtn.dataset.filter : 'live';

             if (parentTabContent.id === 'tab-all-matches') {
                 renderMatches(allMatches, 'all-matches-list', statusFilter, leagueFilter);
             } else if (parentTabContent.id === 'tab-favorites') {
                 renderMatches(favoriteMatches, 'fav-matches-list', statusFilter, leagueFilter);
             }
        });
    });

    // Search input listener
    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase().trim();
        if (searchTerm.length < 1) {
            teamSearchListEl.innerHTML = '<div class="list-placeholder">Start typing to find teams.</div>';
            return;
        }
        const filteredTeams = allTeams.filter(team =>
            team.name.toLowerCase().includes(searchTerm)
        );
        renderTeams(filteredTeams);
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

        // Handle successful DELETE (no content)
        if (res.ok && options.method === 'DELETE') {
             return { success: true }; // Indicate success
        }
        if (res.status === 204 || res.headers.get('content-length') === '0') {
             return null;
        }

        const data = await res.json(); 

        if (!res.ok) {
             if (res.status === 401 || res.status === 422) {
                 console.warn("Auth error detected from API, logging out.");
                 document.getElementById('logout-btn').click();
             }
            throw new Error(data.message || data.error || `API Error: ${res.status}`);
        }
        return data;

    } catch (error) {
         console.error(`API Fetch Error (${endpoint}):`, error);
         if (!(error.message.includes("401") || error.message.includes("422"))) {
             throw error;
         }
         return null;
    }
}


async function fetchMatches() {
    try {
        allMatches = await fetchApi('/matches') || [];
        const activeFilter = document.querySelector('#tab-all-matches .sub-tab-btn.active').dataset.filter;
        const leagueFilter = allLeagueFilter.value;
        renderMatches(allMatches, 'all-matches-list', activeFilter, leagueFilter);
    } catch (err) {
        allMatchesListEl.innerHTML = '<div class="list-placeholder">Could not load matches.</div>';
    }
}

// --- FIX: Use the dedicated /my-teams endpoint ---
async function fetchFavoriteTeamsAndUpdateIds() {
     try {
         const followedIds = await fetchApi('/my-teams') || []; // Returns ['EP001', 'LL001', ...]
         favoriteTeamIds = new Set(followedIds); // Update the global set
         console.log("Fetched favoriteTeamIds:", favoriteTeamIds);
     } catch (err) {
          console.error("Failed to fetch favorite teams:", err);
          // Don't clear existing set on error
     }
}

async function fetchFavoriteMatches() {
    try {
        // Fetch only matches involving favorite teams
        // This endpoint now returns { matches: [], followed_team_ids: [] }
        const favData = await fetchApi('/my-matches'); 

        // Use the accurate list of IDs from the backend
        if (favData?.followed_team_ids) {
            favoriteTeamIds = new Set(favData.followed_team_ids);
        } else {
             // Fallback just in case
             await fetchFavoriteTeamsAndUpdateIds();
        }

        favoriteMatches = favData?.matches || []; // Store the filtered matches

        const activeFilter = document.querySelector('#tab-favorites .sub-tab-btn.active').dataset.filter;
        const leagueFilter = favLeagueFilter.value;
        renderMatches(favoriteMatches, 'fav-matches-list', activeFilter, leagueFilter);

    } catch (err) {
        favMatchesListEl.innerHTML = '<div class="list-placeholder">Could not load favorites.</div>';
    }
}


async function fetchTeams() {
    try {
        allTeams = await fetchApi('/teams') || [];
        // Ensure favoriteTeamIds is up-to-date *before* rendering search results
        // This is already called in showMainApp, but we call it again
        // here to be safe, especially if called from somewhere else.
        await fetchFavoriteTeamsAndUpdateIds(); 

        if (document.getElementById('tab-search').classList.contains('active')) {
            const searchTerm = searchInput.value.toLowerCase().trim();
            if (searchTerm.length > 0) {
                const filteredTeams = allTeams.filter(team =>
                    team.name.toLowerCase().includes(searchTerm)
                );
                renderTeams(filteredTeams); // Render uses the updated favoriteTeamIds
            } else {
                 teamSearchListEl.innerHTML = '<div class="list-placeholder">Start typing to find teams.</div>';
            }
        }
    } catch (err) {
         teamSearchListEl.innerHTML = '<div class="list-placeholder">Could not load teams.</div>';
    }
}

// --- FIX: More robust Follow/Unfollow button handling ---

// Define the click handlers *outside* the functions
// so they can be added and removed properly
const followTeamHandler = (e) => {
    e.stopPropagation();
    const teamId = e.target.dataset.teamId;
    followTeam(teamId, e.target);
};

const unfollowTeamHandler = (e) => {
    e.stopPropagation();
    const teamId = e.target.dataset.teamId;
    unfollowTeam(teamId, e.target);
};

async function followTeam(teamId, buttonEl) {
    buttonEl.disabled = true;
    buttonEl.textContent = '...';
    try {
        await fetchApi('/follow', {
            method: 'POST',
            body: JSON.stringify({ team_id: teamId })
        });
        
        favoriteTeamIds.add(teamId); // Update local state
        
        // Update button AFTER success
        buttonEl.textContent = 'Unfollow';
        buttonEl.className = 'unfollow-btn';
        
        // Remove old listener and add new one
        buttonEl.removeEventListener('click', followTeamHandler);
        buttonEl.addEventListener('click', unfollowTeamHandler);

        fetchFavoriteMatches(); // Refresh favorite matches list
    } catch (err) {
        console.error('Failed to follow team:', err);
        buttonEl.textContent = 'Error';
         setTimeout(() => { // Reset button on error
             buttonEl.textContent = 'Follow';
             buttonEl.className = 'follow-btn';
         }, 2000);
    } finally {
        buttonEl.disabled = false; // Always re-enable
    }
}

async function unfollowTeam(teamId, buttonEl) {
    buttonEl.disabled = true;
    buttonEl.textContent = '...';
    try {
        await fetchApi('/unfollow', {
            method: 'DELETE',
            body: JSON.stringify({ team_id: teamId })
        });
        
        favoriteTeamIds.delete(teamId); // Update local state
        
        // Update button AFTER success
        buttonEl.textContent = 'Follow';
        buttonEl.className = 'follow-btn';
        
        // Remove old listener and add new one
        buttonEl.removeEventListener('click', unfollowTeamHandler);
        buttonEl.addEventListener('click', followTeamHandler);

        fetchFavoriteMatches(); // Refresh favorite matches list
    } catch (err) {
        console.error('Failed to unfollow team:', err);
        buttonEl.textContent = 'Error';
         setTimeout(() => { // Reset button on error
             buttonEl.textContent = 'Unfollow';
             buttonEl.className = 'unfollow-btn';
         }, 2000);
    } finally {
        buttonEl.disabled = false; // Always re-enable
    }
}


// --- Rendering Functions ---

// --- FIX: Corrected League Filtering Logic ---
function renderMatches(matchList, listElementId, statusFilter, leagueFilter) {
    const listEl = document.getElementById(listElementId);
    listEl.innerHTML = '';

    const now = new Date();
    let filteredList = [];

    const statusMap = {
        'LIVE': 'live',
        'HALF_TIME': 'live',
        'SCHEDULED': 'upcoming',
        'FINISHED': 'finished',
        'POSTPONED': 'upcoming',
        'CANCELLED': 'finished'
    };

    // Apply BOTH filters
    filteredList = matchList.filter(m => {
        // --- FIX FOR LEAGUE FILTER ---
        // Check if EITHER team belongs to the selected league
        // (m.home_league_id and m.away_league_id come from the backend query)
        const leagueMatch = (leagueFilter === 'ALL') || 
                            (m.home_league_id === leagueFilter) || 
                            (m.away_league_id === leagueFilter);
        if (!leagueMatch) {
            return false; // Skip if neither team matches
        }
        // --- END FIX ---

        // Status Filter
        const mappedStatus = statusMap[m.status] || 'upcoming';
        if (statusFilter === 'upcoming') {
            return mappedStatus === 'upcoming' && new Date(m.match_time) > now;
        }
        return mappedStatus === statusFilter;
    });

    // Sorting
    if (statusFilter === 'upcoming') {
        filteredList.sort((a, b) => new Date(a.match_time) - new Date(b.match_time)); // Ascending
    } else { 
        filteredList.sort((a, b) => new Date(b.match_time) - new Date(a.match_time)); // Descending
    }

    if (filteredList.length === 0) {
        const leagueSelect = document.getElementById(listElementId.includes('all') ? 'all-league-filter' : 'fav-league-filter');
        const leagueName = leagueSelect.selectedOptions[0].text;
        listEl.innerHTML = `<div class="list-placeholder">No ${statusFilter} matches found${leagueFilter !== 'ALL' ? ` in ${leagueName}` : ''}.</div>`;
        return;
    }

    // Render cards
    filteredList.forEach(match => {
        const card = document.createElement('div');
        card.className = 'match-card';
        card.setAttribute('data-match-id', match.id);

        const isLive = match.status === 'LIVE' || match.status === 'HALF_TIME';
        const displayScore = match.score || (isLive ? '0-0' : 'vs');
        const liveDotHtml = isLive ? '<span class="live-dot">●</span> ' : '';
        const homeLogo = match.home_logo || '';
        const awayLogo = match.away_logo || '';
        const latestTime = match.latestTime || (isLive ? '0\'' : '--\'');

        card.innerHTML = `
            ${isLive ? `<span class="match-time" data-match-time>${latestTime}</span>` : ''}
            <div class="match-teams">
                <div class="team home">
                    ${homeLogo ? `<img src="${homeLogo}" alt="${match.home_team}" onerror="this.style.display='none'; this.nextElementSibling.style.marginLeft='24px';">` : '<span style="width: 24px; display: inline-block;"></span>' }
                    <span>${match.home_team}</span>
                </div>
                <span class="match-score" data-match-score>
                   ${liveDotHtml}${displayScore}
                </span>
                <div class="team away">
                    <span>${match.away_team || 'TBD'}</span>
                     ${awayLogo ? `<img src="${awayLogo}" alt="${match.away_team || 'TBD'}" onerror="this.style.display='none'; this.previousElementSibling.style.marginRight='24px';">` : '<span style="width: 24px; display: inline-block;"></span>' }
                </div>
            </div>
            <div class="match-info">
                ${new Date(match.match_time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })} (${match.status})
            </div>
        `;
        card.addEventListener('click', () => { showLiveFeed(match.id); });
        listEl.appendChild(card);
     });
}

// --- FIX: renderTeams uses new listener assignment ---
function renderTeams(teamList) {
    teamSearchListEl.innerHTML = '';

    if (teamList.length === 0) {
        if (!searchInput.value.trim()) {
            teamSearchListEl.innerHTML = '<div class="list-placeholder">Start typing to find teams.</div>';
        } else {
            teamSearchListEl.innerHTML = '<div class="list-placeholder">No teams found matching your search.</div>';
        }
        return;
    }

    teamList.forEach(team => {
        const item = document.createElement('div');
        item.className = 'team-list-item';

        const isFollowed = favoriteTeamIds.has(team.id); // Check *updated* set
        const buttonClass = isFollowed ? 'unfollow-btn' : 'follow-btn';
        const buttonText = isFollowed ? 'Unfollow' : 'Follow';
        const teamLogo = team.logo_url || '';

        item.innerHTML = `
            <div class="team">
                 ${teamLogo ? `<img src="${teamLogo}" alt="${team.name}" onerror="this.style.display='none'; this.nextElementSibling.style.marginLeft='24px';">` : '<span style="width: 24px; display: inline-block;"></span>' }
                <span>${team.name}</span>
            </div>
            <button class="${buttonClass}" data-team-id="${team.id}">${buttonText}</button>
        `;

        // Add correct click listener based on follow status
        const buttonEl = item.querySelector('button');
        if (isFollowed) {
            buttonEl.addEventListener('click', unfollowTeamHandler); // Use named handler
        } else {
            buttonEl.addEventListener('click', followTeamHandler); // Use named handler
        }

        teamSearchListEl.appendChild(item);
    });
}


// --- WebSocket Logic ---
function connectSocket(token) {
    if (currentSocket && currentSocket.connected) {
        console.log("Socket already connected.");
        return;
    }
    if (currentSocket) {
        currentSocket.off('connect');
        currentSocket.off('disconnect');
        currentSocket.off('connect_error');
        currentSocket.off('joined_room');
        currentSocket.off('new_snippet');
        currentSocket.off('new_event');
        currentSocket.off('time_update'); // Add this
        currentSocket.disconnect();
    }

    console.log("Attempting to connect socket...");
    currentSocket = io(API_URL, {
        query: { token },
        reconnectionAttempts: 3
    });

    // --- Attach all event listeners ---
    currentSocket.on('connect', () => {
        console.log('Socket connected and authenticated with ID:', currentSocket.id);
         if (liveFeedView.style.display === 'block' && currentMatchData) {
             console.log(`Rejoining match room ${currentMatchData.id} after reconnect`);
             currentSocket.emit('join_match', { match_id: currentMatchData.id });
         }
    });

    currentSocket.on('disconnect', (reason) => {
        console.log('Socket disconnected:', reason);
         if (reason === 'io server disconnect' || reason === 'transport close' || reason === 'transport error') {
             console.warn("Unexpected socket disconnection.");
         }
    });

    currentSocket.on('connect_error', (err) => {
        console.error('Socket connection error:', err);
        const errorMsg = err.message || (err.data ? JSON.stringify(err.data) : 'Unknown connection error');
        if (errorMsg.includes("Invalid token") || errorMsg.includes("No token") || errorMsg === "Unauthorized" || (err.data && err.data.message === "Unauthorized")) {
             console.warn("Auth error during connection, logging out.");
             document.getElementById('logout-btn').click();
        } else {
             if (loginView.style.display === 'block') {
                 const errorDiv = document.getElementById('auth-error-login');
                 errorDiv.textContent = 'Cannot connect to live update server.';
                 errorDiv.style.display = 'block';
             }
        }
    });

    currentSocket.on('joined_room', (data) => {
        console.log('Successfully joined room:', data.room);
    });

    // --- 'new_snippet' handler ---
    currentSocket.on('new_snippet', (data) => {
        // console.log('New snippet:', data);
        if (liveFeedView.style.display === 'block' && currentMatchData && data.match_id === currentMatchData.id) {
             const time = data.time || currentMatchData.latestTime || ''; // Use snippet time or last known time
             addFeedItem(`${time ? `<span class="time">[${time}]</span> ` : ''}${data.snippet}`, 'snippet');
             
             // Update latest time in feed header if this one is newer
             if (time) feedMatchTime.textContent = time;
             if (time && currentMatchData) currentMatchData.latestTime = time;
        }
    });

    // --- 'time_update' handler (for continuous time) ---
    currentSocket.on('time_update', (data) => {
        // console.log('Time update:', data);
        const { match_id, time } = data;
        if (!match_id || !time) return;

        // 1. Update internal state
        let affectedMatch = allMatches.find(m => m.id === match_id) || favoriteMatches.find(m => m.id === match_id);
        if (affectedMatch) {
            affectedMatch.latestTime = time;
        }
        if (currentMatchData && currentMatchData.id === match_id) {
            currentMatchData.latestTime = time;
        }

        // 2. Update live feed header (if viewing)
        if (liveFeedView.style.display === 'block' && currentMatchData && currentMatchData.id === match_id) {
            feedMatchTime.textContent = time;
        }

        // 3. Update main match card (if visible)
        const matchCards = document.querySelectorAll(`.match-card[data-match-id="${match_id}"]`);
        matchCards.forEach(card => {
            const timeEl = card.querySelector('[data-match-time]');
            if (timeEl) {
                timeEl.textContent = time;
            } else { // Add time element if match just went live
                 const currentStatus = affectedMatch?.status;
                 const isLiveNow = currentStatus === 'LIVE' || currentStatus === 'HALF_TIME';
                 if (isLiveNow) {
                     const newTimeEl = document.createElement('span');
                     newTimeEl.className = 'match-time';
                     newTimeEl.setAttribute('data-match-time', '');
                     newTimeEl.textContent = time;
                     card.prepend(newTimeEl);
                 }
            }
        });
    });


    // --- 'new_event' handler (No re-rendering) ---
    currentSocket.on('new_event', (data) => {
        // console.log('New event:', data);
        const matchId = data.match_id;
        if (!matchId) return;

        const score = data.score;
        const matchTime = data.time;
        const eventType = data.event_type;

        let newStatus = null;
        if (eventType === 'FULL_TIME') newStatus = 'FINISHED';
        else if (eventType === 'HALF_TIME') newStatus = 'HALF_TIME';
        else if (eventType === 'KICK_OFF' || eventType === 'SECOND_HALF_KICK_OFF') newStatus = 'LIVE';

        // --- Update Internal State FIRST ---
        let matchChangedInState = false;
        let affectedMatch = null;

        [allMatches, favoriteMatches].forEach(list => {
            const matchIndex = list.findIndex(m => m.id === matchId);
            if (matchIndex > -1) {
                const match = list[matchIndex];
                if (!affectedMatch) affectedMatch = match; 

                if (score && match.score !== score) {
                    match.score = score;
                    matchChangedInState = true;
                }
                if (newStatus && match.status !== newStatus) {
                    match.status = newStatus;
                    matchChangedInState = true;
                }
                if (matchTime) {
                    match.latestTime = matchTime;
                }
                list[matchIndex] = match;
            }
        });
        if(currentMatchData && currentMatchData.id === matchId) {
            if (score) currentMatchData.score = score;
            if (newStatus) currentMatchData.status = newStatus;
            if (matchTime) currentMatchData.latestTime = matchTime;
        }
        // --- END Internal State Update ---

        // 1. Add event text to the live feed
        if (liveFeedView.style.display === 'block' && currentMatchData && matchId === currentMatchData.id) {
            const text = data.text || `${eventType} - ${data.player || ''}`;
            const time = matchTime || currentMatchData.latestTime || '!';

            let eventClass = 'event';
            if (eventType === 'GOAL') eventClass += ' goal';
            else if (eventType && eventType.includes('CARD')) eventClass += ' card';
            else if (eventType === 'SUBSTITUTION') eventClass += ' sub';

            addFeedItem(`<span class="time">[${time}]</span> ${text}`, eventClass);

            if (score) feedMatchScore.textContent = score;
            // if (matchTime) feedMatchTime.textContent = matchTime;
            const currentStatus = newStatus || currentMatchData?.status;
            const isLiveNow = (currentStatus === 'LIVE' || currentStatus === 'HALF_TIME');
            feedLiveDot.style.display = isLiveNow ? 'inline-block' : 'none';
        }

        // 2. Update all visible match cards
        const matchCards = document.querySelectorAll(`.match-card[data-match-id="${matchId}"]`);

        matchCards.forEach(card => {
            const scoreEl = card.querySelector('[data-match-score]');
            const timeEl = card.querySelector('[data-match-time]');
            const infoEl = card.querySelector('.match-info');

            const currentStatus = affectedMatch?.status;
            const isLiveNow = currentStatus === 'LIVE' || currentStatus === 'HALF_TIME';

            if (scoreEl) {
                 const displayScore = score || affectedMatch?.score || (isLiveNow ? '0-0' : 'vs');
                 const liveDotHtml = isLiveNow ? '<span class="live-dot">●</span> ' : '';
                 scoreEl.innerHTML = `${liveDotHtml}${displayScore}`;
            }

            const latestTime = matchTime || affectedMatch?.latestTime;
             if (latestTime) {
                 if (timeEl) {
                     timeEl.textContent = latestTime;
                 } else if (isLiveNow) {
                      const newTimeEl = document.createElement('span');
                      newTimeEl.className = 'match-time';
                      newTimeEl.setAttribute('data-match-time', '');
                      newTimeEl.textContent = latestTime;
                      card.prepend(newTimeEl);
                 }
             }
             if (timeEl && !isLiveNow) {
                 timeEl.remove();
             }

            if (infoEl && newStatus) {
                 const timeString = new Date(affectedMatch?.match_time || Date.now()).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
                 infoEl.textContent = `${timeString} (${newStatus})`;
            }
        });

        // --- FIX: NO LONGER RE-RENDERS LISTS ---
        // The lists will only re-render when the user clicks a tab or filter,
        // which fixes the "blank screen" bug.
    });
}


function addFeedItem(htmlContent, typeClass) {
    const li = document.createElement('li');
    li.className = `feed-item ${typeClass}`;
    li.innerHTML = htmlContent; // Use innerHTML to parse the <span> time tag

    const firstItem = feedList.firstElementChild;
    if (firstItem && firstItem.textContent.includes('Waiting')) {
        feedList.innerHTML = '';
    }
    feedList.prepend(li); // Add new item to the top

    const MAX_FEED_ITEMS = 100; // Limit feed length
    while (feedList.childElementCount > MAX_FEED_ITEMS) {
        feedList.removeChild(feedList.lastElementChild);
    }
}