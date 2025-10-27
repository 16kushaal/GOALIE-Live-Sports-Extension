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
    currentMatchData = null;

    if (!currentSocket || !currentSocket.connected) {
        connectSocket(userToken);
    }
    // Fetch crucial data on showing main view
    fetchFavoriteTeamsAndUpdateIds().then(() => {
        // Fetch matches *after* knowing which teams are favorites
        fetchMatches();
        fetchFavoriteMatches(); // Fetch the actual favorite matches
        fetchTeams(); // Fetch all teams for search
    });
}


function showLiveFeed(matchId) {
    // Find the full match data from our lists
    // Combine search across both lists just in case
    currentMatchData = allMatches.find(m => m.id === matchId) || favoriteMatches.find(m => m.id === matchId);

    if (!currentMatchData) {
        console.error("Could not find match data for ID:", matchId);
        showMainApp(); // Go back if data is missing
        return;
    }

    mainAppView.style.display = 'none';
    liveFeedView.style.display = 'block';

    // Set header title
    const matchName = `${currentMatchData.home_team} vs ${currentMatchData.away_team || 'TBD'}`;
    feedHeaderTitle.textContent = matchName;

    // Update live score/time in feed header based on currentMatchData
    const isLive = currentMatchData.status === 'LIVE' || currentMatchData.status === 'HALF_TIME';
    feedLiveDot.style.display = isLive ? 'inline-block' : 'none';
    // Find the latest time from the match card if available, otherwise default
    const cardTimeEl = document.querySelector(`.match-card[data-match-id="${matchId}"] [data-match-time]`);
    feedMatchTime.textContent = cardTimeEl ? cardTimeEl.textContent : '--\'';
    feedMatchScore.textContent = currentMatchData.score || (isLive ? '0-0' : '');


    // Join the WebSocket room
    if (currentSocket && currentSocket.connected) {
        console.log(`Attempting to join match ${matchId}`);
        // Leave previous room if any? Depends on desired behavior.
        // currentSocket.emit('leave_match', { match_id: previousMatchId });
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
            // Deactivate all sibling buttons and content
            btn.parentElement.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            // Activate clicked button and corresponding content
            btn.classList.add('active');
            const tabContent = document.getElementById(`tab-${btn.dataset.tab}`);
            if (tabContent) {
                tabContent.classList.add('active');

                // Re-render lists when switching tabs to apply current filter
                const activeFilterBtn = tabContent.querySelector('.sub-tab-btn.active');
                if (activeFilterBtn) { // Check if sub-tabs exist
                    const activeFilter = activeFilterBtn.dataset.filter;
                    if (tabContent.id === 'tab-all-matches') {
                        renderMatches(allMatches, 'all-matches-list', activeFilter);
                    } else if (tabContent.id === 'tab-favorites') {
                        renderMatches(favoriteMatches, 'fav-matches-list', activeFilter);
                    }
                } else if (tabContent.id === 'tab-search') {
                    // Trigger search render if needed, maybe based on current input value
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


    // Sub-Tab navigation (remains the same, calls renderMatches with correct filters)
    // Sub-Tab navigation (remains the same, calls renderMatches with correct filters)
    document.querySelectorAll('.sub-tab-nav').forEach(nav => {
        nav.addEventListener('click', (e) => {
             if (!e.target.matches('.sub-tab-btn')) return;
             // ... (logic to get filters and call renderMatches is unchanged) ...
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

    // League Filter dropdown listeners (remains the same, calls renderMatches with correct filters)
    [allLeagueFilter, favLeagueFilter].forEach(selectEl => {
        selectEl.addEventListener('change', (e) => {
            // ... (logic to get filters and call renderMatches is unchanged) ...
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
        if (searchTerm.length < 1) { // Show placeholder if empty or just spaces
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

        // Handle successful DELETE (no content)
        if (res.status === 200 && options.method === 'DELETE') {
             return { success: true }; // Indicate success
        }
        // Handle other no content responses if needed
        if (res.status === 204 || res.headers.get('content-length') === '0') {
             return null;
        }

        const data = await res.json(); // Try parsing JSON only if content expected

        if (!res.ok) {
            // Specific check for auth errors
             if (res.status === 401 || res.status === 422) {
                 console.warn("Auth error detected from API, logging out.");
                 document.getElementById('logout-btn').click(); // Use existing logout logic
             }
            // Throw error with message from API if available
            throw new Error(data.message || data.error || `API Error: ${res.status}`);
        }
        return data;

    } catch (error) {
         console.error(`API Fetch Error (${endpoint}):`, error);
         // Don't re-throw auth errors handled above
         if (!(error.message.includes("401") || error.message.includes("422"))) {
             throw error; // Re-throw other errors
         }
         return null; // Return null on handled auth errors
    }
}


async function fetchMatches() {
    try {
        allMatches = await fetchApi('/matches') || [];
        const activeFilter = document.querySelector('#tab-all-matches .sub-tab-btn.active').dataset.filter;
        const leagueFilter = allLeagueFilter.value;
        renderMatches(allMatches, 'all-matches-list', activeFilter, leagueFilter);
    } catch (err) { /* ... error handling ... */ }
}

// --- NEW/REFINED: Fetch the actual list of followed team IDs ---
async function fetchFavoriteTeamsAndUpdateIds() {
     try {
         const followedIds = await fetchApi('/my-teams') || []; // Returns ['EP001', 'LL001', ...]
         favoriteTeamIds = new Set(followedIds); // Update the global set
         console.log("Fetched favoriteTeamIds:", favoriteTeamIds);
     } catch (err) {
          console.error("Failed to fetch favorite teams:", err);
          // Keep potentially stale favoriteTeamIds on error? Or clear? Clearing might be safer.
          // favoriteTeamIds.clear();
     }
}

async function fetchFavoriteMatches() {
    // Current workaround: Fetch favorite matches and infer teams
    try {
        // Fetch only matches involving favorite teams (backend handles filtering)
        const favData = await fetchApi('/my-matches'); // Returns { matches: [], followed_team_ids: [] }

        // We primarily use favoriteTeamIds fetched separately, but update just in case
        if (favData?.followed_team_ids) {
            favoriteTeamIds = new Set(favData.followed_team_ids);
        } else {
            // If backend didn't send IDs (old version?), fetch them explicitly
             await fetchFavoriteTeamsAndUpdateIds();
        }

        favoriteMatches = favData?.matches || []; // Store the filtered matches

        // Render using current filters
        const activeFilter = document.querySelector('#tab-favorites .sub-tab-btn.active').dataset.filter;
        const leagueFilter = favLeagueFilter.value;
        renderMatches(favoriteMatches, 'fav-matches-list', activeFilter, leagueFilter);
    } catch (err) {
        // Error logged by fetchApi
        favMatchesListEl.innerHTML = '<div class="list-placeholder">Could not load favorites.</div>';
    }
}


async function fetchTeams() {
    try {
        allTeams = await fetchApi('/teams') || [];
        // Ensure favoriteTeamIds is up-to-date *before* rendering search results
        await fetchFavoriteTeamsAndUpdateIds();

        // Render search results based on current input ONLY if search tab is active
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
        // Error logged by fetchApi
         teamSearchListEl.innerHTML = '<div class="list-placeholder">Could not load teams.</div>';
    }
}

// Follow Team API Call
// --- MODIFIED: Follow/Unfollow Button Logic ---
async function followTeam(teamId, buttonEl) {
    buttonEl.disabled = true;
    buttonEl.textContent = '...';
    try {
        await fetchApi('/follow', {
            method: 'POST',
            body: JSON.stringify({ team_id: teamId })
        });

        // Update local state FIRST
        favoriteTeamIds.add(teamId);

        // Update button AFTER success using the NEW reference
        const newButton = document.querySelector(`button[data-team-id="${teamId}"]`); // Re-select
        if (newButton) {
            newButton.textContent = 'Unfollow';
            newButton.className = 'unfollow-btn';
            // Replace listener correctly
            const clonedButton = newButton.cloneNode(true); // Clone to remove old listener
            newButton.parentNode.replaceChild(clonedButton, newButton);
            clonedButton.addEventListener('click', (e) => { // Attach NEW listener
                e.stopPropagation();
                unfollowTeam(teamId, clonedButton);
            });
            clonedButton.disabled = false; // Ensure it's enabled
        }

        // Refresh favorite matches list in background
        fetchFavoriteMatches();
    } catch (err) {
        console.error('Failed to follow team:', err);
        buttonEl.textContent = 'Error';
         setTimeout(() => { // Reset button visually on error
             if (buttonEl && !favoriteTeamIds.has(teamId)) { // Check if still relevant
                buttonEl.textContent = 'Follow';
                buttonEl.className = 'follow-btn';
                buttonEl.disabled = false;
             }
         }, 2000);
    } finally {
         if (buttonEl) buttonEl.disabled = false; // Re-enable unless button was removed
    }
}

// Unfollow Team API Call
async function unfollowTeam(teamId, buttonEl) {
    buttonEl.disabled = true;
    buttonEl.textContent = '...';
    try {
        await fetchApi('/unfollow', {
            method: 'DELETE',
            body: JSON.stringify({ team_id: teamId })
        });

        // Update local state FIRST
        favoriteTeamIds.delete(teamId);

        // Update button AFTER success using the NEW reference
        const newButton = document.querySelector(`button[data-team-id="${teamId}"]`); // Re-select
        if (newButton) {
            newButton.textContent = 'Follow';
            newButton.className = 'follow-btn';
            // Replace listener correctly
            const clonedButton = newButton.cloneNode(true); // Clone
            newButton.parentNode.replaceChild(clonedButton, newButton);
            clonedButton.addEventListener('click', (e) => { // Attach NEW listener
                e.stopPropagation();
                followTeam(teamId, clonedButton);
            });
             clonedButton.disabled = false; // Ensure it's enabled
        }

        // Refresh favorite matches list in background
        fetchFavoriteMatches();
    } catch (err) {
        console.error('Failed to unfollow team:', err);
        buttonEl.textContent = 'Error';
         setTimeout(() => { // Reset button visually on error
              if (buttonEl && favoriteTeamIds.has(teamId)) { // Check if still relevant
                buttonEl.textContent = 'Unfollow';
                buttonEl.className = 'unfollow-btn';
                buttonEl.disabled = false;
             }
         }, 2000);
    } finally {
        if (buttonEl) buttonEl.disabled = false; // Re-enable unless button was removed
    }
}


// --- Rendering Functions ---

// Render Matches - Includes filter, data attributes, placeholders
// --- MODIFIED: renderMatches accepts and uses leagueFilter correctly for BOTH teams ---
function renderMatches(matchList, listElementId, statusFilter, leagueFilter) {
    const listEl = document.getElementById(listElementId);
    listEl.innerHTML = ''; // Clear previous content

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
        // League Filter: Check if EITHER team belongs to the selected league
        const leagueMatch = (leagueFilter === 'ALL') || (m.home_league_id === leagueFilter) || (m.away_league_id === leagueFilter);
        if (!leagueMatch) {
            return false; // Skip if neither team matches the league filter
        }

        // Status Filter
        const mappedStatus = statusMap[m.status] || 'upcoming';
        if (statusFilter === 'upcoming') {
            return mappedStatus === 'upcoming' && new Date(m.match_time) > now;
        }
        return mappedStatus === statusFilter;
    });

    // Sorting (remains the same)
    if (statusFilter === 'upcoming') {
        filteredList.sort((a, b) => new Date(a.match_time) - new Date(b.match_time)); // Ascending
    } else { // live, finished
        filteredList.sort((a, b) => new Date(b.match_time) - new Date(a.match_time)); // Descending
    }


    if (filteredList.length === 0) {
        // Get league name from dropdown for better placeholder text
        const leagueSelect = document.getElementById(listElementId.includes('all') ? 'all-league-filter' : 'fav-league-filter');
        const leagueName = leagueSelect.selectedOptions[0].text;
        listEl.innerHTML = `<div class="list-placeholder">No ${statusFilter} matches found${leagueFilter !== 'ALL' ? ` in ${leagueName}` : ''}.</div>`;
        return;
    }

    // Render cards (card creation logic remains the same)
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

// Render Team Search Results - Includes Follow/Unfollow Button Logic & Placeholders
function renderTeams(teamList) {
    teamSearchListEl.innerHTML = ''; // Clear previous results

    if (teamList.length === 0) {
        // Check if input is empty or just whitespace
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

        const isFollowed = favoriteTeamIds.has(team.id); // Check the UPDATED set
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
        const teamId = team.id;
        if (isFollowed) {
            buttonEl.addEventListener('click', (e) => {
                e.stopPropagation();
                unfollowTeam(teamId, e.target);
            });
        } else {
            buttonEl.addEventListener('click', (e) => {
                e.stopPropagation();
                followTeam(teamId, e.target);
            });
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
        currentSocket.disconnect();
    }

    console.log("Attempting to connect socket...");
    currentSocket = io(API_URL, {
        query: { token } // Send token in query for auth
    });

    currentSocket.on('connect', () => {
        console.log('Socket connected and authenticated with ID:', currentSocket.id);
    });

    currentSocket.on('disconnect', (reason) => {
        console.log('Socket disconnected:', reason);
        // If disconnected unexpectedly, maybe try to reconnect or force logout
        if (reason === 'io server disconnect' || reason === 'transport error') {
            // Consider showing an error or attempting reconnect
        }
        // No need to remove token here unless specifically needed
    });

    currentSocket.on('connect_error', (err) => {
        console.error('Socket connection error:', err); // Log the full error
        // Handle specific auth errors
        if (err && (err.message.includes("Invalid token") || err.message.includes("No token") || err.message === "Unauthorized")) {
             console.warn("Auth error during connection, logging out.");
             document.getElementById('logout-btn').click();
        } else {
             // Handle other connection errors (e.g., server down)
             // Maybe update statusDiv in login view if that's visible?
             if (loginView.style.display === 'block') {
                 const errorDiv = document.getElementById('auth-error-login');
                 errorDiv.textContent = 'Cannot connect to server.';
                 errorDiv.style.display = 'block';
             }
        }
    });

    currentSocket.on('joined_room', (data) => {
        console.log('Successfully joined room:', data.room);
    });

    currentSocket.on('new_snippet', (data) => {
        console.log('New snippet:', data);
        // Only add if viewing the correct match feed
        if (liveFeedView.style.display === 'block' && currentMatchData && data.match_id === currentMatchData.id) {
             const time = data.time || currentMatchData.latestTime || ''; // Use time from snippet or last known time
             addFeedItem(`${time ? `<span class="time">[${time}]</span> ` : ''}${data.snippet}`, 'snippet');
        }
    });

    currentSocket.on('new_event', (data) => {
        console.log('New event:', data);
        const matchId = data.match_id;
        const score = data.score;
        const matchTime = data.time; // This is the match minute like 44'
        const eventType = data.event_type;

        // Determine if status changed based on event type
        let newStatus = null;
        if (eventType === 'FULL_TIME') newStatus = 'FINISHED';
        else if (eventType === 'HALF_TIME') newStatus = 'HALF_TIME';
        else if (eventType === 'KICK_OFF' || eventType === 'SECOND_HALF_KICK_OFF') newStatus = 'LIVE'; // Ensure it's marked live

        // --- Update Internal State FIRST ---
        let matchChanged = false;
        [allMatches, favoriteMatches].forEach(list => {
            const matchIndex = list.findIndex(m => m.id === matchId);
            if (matchIndex > -1) {
                const match = list[matchIndex];
                if (score && match.score !== score) {
                    match.score = score;
                    matchChanged = true;
                }
                if (newStatus && match.status !== newStatus) {
                    match.status = newStatus;
                    matchChanged = true;
                }
                 // Store latest time seen for this match (useful for snippets)
                 if (matchTime) {
                    match.latestTime = matchTime;
                    matchChanged = true; // Mark change to trigger potential re-render
                 }
                 // Update the match object in the array directly
                 list[matchIndex] = match;
            }
        });
        // Store latest time on currentMatchData too if viewing this match
        if(currentMatchData && currentMatchData.id === matchId && matchTime) {
            currentMatchData.latestTime = matchTime;
        }


        // 1. Add event text to the live feed if viewing this match
        if (liveFeedView.style.display === 'block' && currentMatchData && matchId === currentMatchData.id) {
            const text = data.text || `${eventType} - ${data.player || ''}`;
            const time = matchTime || '!';

            let eventClass = 'event';
            if (eventType === 'GOAL') eventClass += ' goal';
            else if (eventType && eventType.includes('CARD')) eventClass += ' card';
            else if (eventType === 'SUBSTITUTION') eventClass += ' sub';

            addFeedItem(`<span class="time">[${time}]</span> ${text}`, eventClass);

            // Update the feed header score/time
            if (score) feedMatchScore.textContent = score;
            if (matchTime) feedMatchTime.textContent = matchTime;
            const isLiveNow = (newStatus === 'LIVE' || newStatus === 'HALF_TIME' || (!newStatus && currentMatchData?.status === 'LIVE'));
            feedLiveDot.style.display = isLiveNow ? 'inline-block' : 'none';
        }

        // 2. Update score, time, and status on the main match card(s)
        const matchCards = document.querySelectorAll(`.match-card[data-match-id="${matchId}"]`);

        matchCards.forEach(card => {
            const scoreEl = card.querySelector('[data-match-score]');
            const timeEl = card.querySelector('[data-match-time]');
            const infoEl = card.querySelector('.match-info');
            const liveDotEl = scoreEl ? scoreEl.querySelector('.live-dot') : null; // Live dot is inside scoreEl now

             // Determine if the match should currently be considered live
             const currentStatus = newStatus || allMatches.find(m=>m.id===matchId)?.status || favoriteMatches.find(m=>m.id===matchId)?.status;
             const isLiveNow = currentStatus === 'LIVE' || currentStatus === 'HALF_TIME';

             // Update Score
             if (scoreEl && score) {
                 const liveDotHtml = isLiveNow ? '<span class="live-dot">●</span> ' : '';
                 scoreEl.innerHTML = `${liveDotHtml}${score}`;
             } else if (scoreEl && !score && isLiveNow && !liveDotEl) {
                 // Add live dot if match became live but score didn't change
                 scoreEl.insertAdjacentHTML('afterbegin', '<span class="live-dot">●</span> ');
             } else if (scoreEl && !isLiveNow && liveDotEl) {
                 // Remove live dot if match finished
                 liveDotEl.remove();
             }


            // Update Time
            if (timeEl && matchTime) { // Update time if element exists
                timeEl.textContent = matchTime;
            } else if (!timeEl && matchTime && isLiveNow ) {
                // Add time element if it doesn't exist but should (match is live)
                 const newTimeEl = document.createElement('span');
                 newTimeEl.className = 'match-time';
                 newTimeEl.setAttribute('data-match-time', '');
                 newTimeEl.textContent = matchTime;
                 card.prepend(newTimeEl);
            } else if (timeEl && !isLiveNow) {
                 // Remove time element if match finished
                 timeEl.remove();
            }


            // Update Status Text in Info Line
            if (infoEl && newStatus) {
                 const originalMatchData = allMatches.find(m=>m.id===matchId) || favoriteMatches.find(m=>m.id===matchId);
                 const timeString = new Date(originalMatchData?.match_time || Date.now()).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
                 infoEl.textContent = `${timeString} (${newStatus})`;
            }
        });

        // --- Re-render lists if a match status changed, to move it between sub-tabs ---
         if (matchChanged) {
             const activeAllFilterBtn = document.querySelector('#tab-all-matches .sub-tab-btn.active');
             if (activeAllFilterBtn) {
                 renderMatches(allMatches, 'all-matches-list', activeAllFilterBtn.dataset.filter);
             }
             const activeFavFilterBtn = document.querySelector('#tab-favorites .sub-tab-btn.active');
             if (activeFavFilterBtn) {
                 renderMatches(favoriteMatches, 'fav-matches-list', activeFavFilterBtn.dataset.filter);
             }
         }

    });
}

// --- WebSocket Event Handlers ---
// (on 'connect', 'disconnect', 'connect_error', 'joined_room' remain the same)
// (on 'new_snippet' remains the same)

// --- MODIFIED: on 'new_event' - Refined logic ---
currentSocket.on('new_event', (data) => {
    // console.log('New event:', data);
    const matchId = data.match_id;
    if (!matchId) return; // Ignore events without matchId

    const score = data.score;
    const matchTime = data.time; // Match minute like 44'
    const eventType = data.event_type;

    // Determine if status changed based on event type
    let newStatus = null;
    if (eventType === 'FULL_TIME') newStatus = 'FINISHED';
    else if (eventType === 'HALF_TIME') newStatus = 'HALF_TIME';
    // Treat KICK_OFF for either half as LIVE
    else if (eventType === 'KICK_OFF' || eventType === 'SECOND_HALF_KICK_OFF') newStatus = 'LIVE';

    // --- Update Internal State FIRST ---
    let matchChangedInState = false; // Flag specifically for state changes
    let affectedMatch = null;

    [allMatches, favoriteMatches].forEach(list => {
        const matchIndex = list.findIndex(m => m.id === matchId);
        if (matchIndex > -1) {
            const match = list[matchIndex];
            affectedMatch = match; // Keep ref

            if (score && match.score !== score) {
                match.score = score;
                matchChangedInState = true;
            }
            if (newStatus && match.status !== newStatus) {
                match.status = newStatus;
                matchChangedInState = true;
            }
            if (matchTime) { // Always update latest time
                match.latestTime = matchTime;
                // Consider if time update alone should trigger re-render maybe?
                // matchChangedInState = true; // Uncomment if time update should force re-render
            }
            list[matchIndex] = match; // Update the array
        }
    });
    // Update currentMatchData if viewing this match
    if(currentMatchData && currentMatchData.id === matchId) {
        if (score) currentMatchData.score = score;
        if (newStatus) currentMatchData.status = newStatus;
        if (matchTime) currentMatchData.latestTime = matchTime;
    }
    // --- END Internal State Update ---

    // 1. Add event text to the live feed if viewing this match
    if (liveFeedView.style.display === 'block' && currentMatchData && matchId === currentMatchData.id) {
        const text = data.text || `${eventType} - ${data.player || ''}`;
        const time = matchTime || currentMatchData.latestTime || '!'; // Use event time or latest known

        let eventClass = 'event';
        if (eventType === 'GOAL') eventClass += ' goal';
        else if (eventType && eventType.includes('CARD')) eventClass += ' card';
        else if (eventType === 'SUBSTITUTION') eventClass += ' sub';

        addFeedItem(`<span class="time">[${time}]</span> ${text}`, eventClass);

        // Update the feed header score/time/live status
        if (score) feedMatchScore.textContent = score;
        if (matchTime) feedMatchTime.textContent = matchTime;
        const currentStatus = newStatus || currentMatchData?.status;
        const isLiveNow = (currentStatus === 'LIVE' || currentStatus === 'HALF_TIME');
        feedLiveDot.style.display = isLiveNow ? 'inline-block' : 'none';
        // Update header logos too? They shouldn't change, but just in case
        feedHomeLogo.src = currentMatchData.home_logo || '';
        feedAwayLogo.src = currentMatchData.away_logo || '';
        feedHomeLogo.style.visibility = currentMatchData.home_logo ? 'visible' : 'hidden';
        feedAwayLogo.style.visibility = currentMatchData.away_logo ? 'visible' : 'hidden';
    }

    // 2. Update score, time, and status on the main match card(s)
    const matchCards = document.querySelectorAll(`.match-card[data-match-id="${matchId}"]`);

    matchCards.forEach(card => {
        const scoreEl = card.querySelector('[data-match-score]');
        const timeEl = card.querySelector('[data-match-time]');
        const infoEl = card.querySelector('.match-info');

        // Use the status from the updated internal state (affectedMatch)
        const currentStatus = affectedMatch?.status; // Might be null if match not found in lists
        const isLiveNow = currentStatus === 'LIVE' || currentStatus === 'HALF_TIME';

        // Update Score & Live Dot
        if (scoreEl) {
             const displayScore = score || affectedMatch?.score || (isLiveNow ? '0-0' : 'vs');
             const liveDotHtml = isLiveNow ? '<span class="live-dot">●</span> ' : '';
             scoreEl.innerHTML = `${liveDotHtml}${displayScore}`;
        }

        // Update Time Element
        const latestTime = matchTime || affectedMatch?.latestTime;
        if (latestTime) {
            if (timeEl) { // Update existing
                timeEl.textContent = latestTime;
            } else if (isLiveNow) { // Add if missing and should be there
                 const newTimeEl = document.createElement('span');
                 newTimeEl.className = 'match-time';
                 newTimeEl.setAttribute('data-match-time', '');
                 newTimeEl.textContent = latestTime;
                 card.prepend(newTimeEl);
            }
        }
        // Remove time element if match finished or not live
        if (timeEl && !isLiveNow) {
            timeEl.remove();
        }

        // Update Status Text in Info Line if status changed via this event
        if (infoEl && newStatus) {
            const timeString = new Date(affectedMatch?.match_time || Date.now()).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
            infoEl.textContent = `${timeString} (${newStatus})`;
        }
    });

    // --- Re-render lists ONLY if a match status changed, to move it between sub-tabs ---
     if (matchChangedInState && newStatus) { // Check the flag and if status actually changed
         console.log(`Match ${matchId} status changed to ${newStatus}. Re-rendering relevant lists.`);

         // Check which tab is active and re-render only that list if necessary
         const activeAllTab = document.getElementById('tab-all-matches').classList.contains('active');
         const activeFavTab = document.getElementById('tab-favorites').classList.contains('active');

         if (activeAllTab) {
              const activeAllFilterBtn = document.querySelector('#tab-all-matches .sub-tab-btn.active');
              renderMatches(allMatches, 'all-matches-list', activeAllFilterBtn.dataset.filter, allLeagueFilter.value);
         }
         // Re-render favorites only if the active tab is favorites OR if the match was in favorites list
         if (activeFavTab || favoriteTeamIds.has(affectedMatch?.home_team_id) || favoriteTeamIds.has(affectedMatch?.away_team_id) ) {
              const activeFavFilterBtn = document.querySelector('#tab-favorites .sub-tab-btn.active');
              // Ensure fav filter button exists before accessing dataset
               if (activeFavFilterBtn){
                   renderMatches(favoriteMatches, 'fav-matches-list', activeFavFilterBtn.dataset.filter, favLeagueFilter.value);
               }
         }
     }
});

// Add item to the live feed list
function addFeedItem(htmlContent, typeClass) {
    const li = document.createElement('li');
    li.className = `feed-item ${typeClass}`;
    li.innerHTML = htmlContent; // Use innerHTML to parse the <span> time tag

    // Remove "Waiting" message if present
    const firstItem = feedList.firstElementChild;
    if (firstItem && firstItem.textContent.includes('Waiting')) {
        feedList.innerHTML = '';
    }
    feedList.prepend(li); // Add new item to the top

    // Optional: Limit number of items in the feed
    // const MAX_FEED_ITEMS = 50;
    // while (feedList.childElementCount > MAX_FEED_ITEMS) {
    //     feedList.removeChild(feedList.lastElementChild);
    // }
}