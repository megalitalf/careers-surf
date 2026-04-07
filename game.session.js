// =========================================================================
// SESSION — Player UUID + job listings bootstrap
// =========================================================================

// Generates a v4-style UUID on first visit and persists it in localStorage so
// the same player keeps the same ID across page refreshes.
function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // Fallback for environments without crypto.randomUUID
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0;
        var v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

var SESSION_UUID_KEY = 'careers_surf_player_uuid';
var playerUUID = localStorage.getItem(SESSION_UUID_KEY);
if (!playerUUID) {
    playerUUID = generateUUID();
    localStorage.setItem(SESSION_UUID_KEY, playerUUID);
    console.log('New player UUID assigned:', playerUUID);
} else {
    console.log('Returning player UUID:', playerUUID);
}

// Show a short version (first 8 chars) in the HUD; full UUID is in playerUUID
(function() {
    var el = Dom.get('player_uuid_value');
    if (el) el.textContent = playerUUID.split('-')[0]; // e.g. "a3f1c2b0"
})();

// ── Job listings ──────────────────────────────────────────────────────────────
// jobs.js is loaded as a <script> before game.js and declares: var jobs = [...];
var SEMI_LISTINGS = (typeof jobs !== 'undefined') ? jobs : [];
if (!SEMI_LISTINGS.length) console.warn('No job listings — run: node scrape_jobs.js');
else console.log('Loaded ' + SEMI_LISTINGS.length + ' job listings.');
