// =========================================================================
// UI — menu, HUD, popups, results screen, tweak panel
// =========================================================================

// ── Menu ──────────────────────────────────────────────────────────────────────

function initMenu() {
    var menuEl = document.getElementById('menu');
    if (!menuEl) return;
    // Wire buttons once
    if (!menuEl.dataset.init) {
        menuEl.dataset.init = '1';

        // ── City pill selector ─────────────────────────────────────────
        var CITY_SLUGS = {
            warsaw:   'Warsaw',
            szczecin: 'Szczecin',
            krakow:   'Kraków',
        };
        var selectedCity = null;
        var pills = document.querySelectorAll('.city-pill');

        pills.forEach(function(pill) {
            pill.addEventListener('click', function() {
                pills.forEach(function(p) { p.classList.remove('active'); });
                pill.classList.add('active');
                selectedCity = pill.dataset.city;
            });
        });

        // Default to first pill
        if (pills.length) {
            pills[0].classList.add('active');
            selectedCity = pills[0].dataset.city;
        }
        // ──────────────────────────────────────────────────────────────

        document.getElementById('menu-start').addEventListener('click', function () {
            menuActive = false;
            menuEl.classList.add('hide');
            setTimeout(function () { menuEl.style.display = 'none'; }, 520);

            // Load jobs for the selected city — try S3 first, fall back to local cities/
            if (selectedCity) {
                // Remove any previously injected city script
                var prev = document.getElementById('city-jobs-script');
                if (prev) prev.parentNode.removeChild(prev);

                var localSrc = 'cities/' + selectedCity + '/latest.js';
                var s3Src    = window._S3_CITIES
                    ? window._S3_CITIES + '/' + selectedCity + '/latest.js'
                    : null;

                function applyCityJobs(label) {
                    if (typeof cityJobs !== 'undefined' && cityJobs.length) {
                        SEMI_LISTINGS = cityJobs;
                        currentLap      = 0;
                        lapJobOffset    = 0;
                        seenListings    = new Set();
                        clickedListings = new Set();
                        currentLapBatch = [];
                        resetCars();
                        console.log('Loaded ' + cityJobs.length + ' listings for ' + CITY_SLUGS[selectedCity] + ' (' + label + ')');
                    } else {
                        console.warn('city jobs script loaded but cityJobs is empty (' + label + ')');
                    }
                }

                function loadScript(src, onok, onfail) {
                    var s = document.createElement('script');
                    s.id      = 'city-jobs-script';
                    s.src     = src;
                    s.onload  = onok;
                    s.onerror = onfail;
                    document.head.appendChild(s);
                }

                if (s3Src) {
                    loadScript(s3Src,
                        function() { applyCityJobs('s3'); },
                        function() {
                            console.warn('S3 city jobs unavailable, falling back to local: ' + localSrc);
                            var prev2 = document.getElementById('city-jobs-script');
                            if (prev2) prev2.parentNode.removeChild(prev2);
                            loadScript(localSrc,
                                function() { applyCityJobs('local'); },
                                function() { console.warn('Could not load city jobs: ' + localSrc); }
                            );
                        }
                    );
                } else {
                    loadScript(localSrc,
                        function() { applyCityJobs('local'); },
                        function() { console.warn('Could not load city jobs: ' + localSrc); }
                    );
                }
            }
        });

        var hudBtn = document.getElementById('hud-menu-btn');
        if (hudBtn) {
            hudBtn.addEventListener('click', function () {
                menuActive = true;
                menuEl.classList.remove('hide');
                menuEl.style.display = 'flex';
            });
        }
    }
    // Show
    menuEl.classList.remove('hide');
    menuEl.style.display = 'flex';
}

// ── HUD helpers ───────────────────────────────────────────────────────────────

function updateHud(key, value) { // accessing DOM can be slow, so only do it if value has changed
    if (hud[key].value !== value) {
        hud[key].value = value;
        Dom.set(hud[key].dom, value);
    }
}

function formatTime(dt) {
    var minutes = Math.floor(dt / 60);
    var seconds = Math.floor(dt - (minutes * 60));
    var tenths  = Math.floor(10 * (dt - Math.floor(dt)));
    if (minutes > 0)
        return minutes + "." + (seconds < 10 ? "0" : "") + seconds + "." + tenths;
    else
        return seconds + "." + tenths;
}

// ── Job listing popup ─────────────────────────────────────────────────────────

function showCarPopup(listing) {
    if (!listing) return;
    // Mark as seen
    if (listing.id) seenListings.add(listing.id);
    
    console.log(' >>> seenListings listing:', seenListings);

    Dom.get('car_popup_title').innerHTML   = listing.title   || '';
    Dom.get('car_popup_salary').innerHTML  = listing.salary  || 'Salary not disclosed';
    Dom.get('car_popup_company').innerHTML = listing.company || '';
    Dom.get('car_popup_loc').innerHTML     = listing.location || '';
    // Dev info: id
    var idEl = Dom.get('car_popup_id');
    if (idEl) idEl.textContent = listing.id ? '#' + listing.id : '';
    // Dev info: description
    var descEl = Dom.get('car_popup_desc');
    if (descEl) descEl.textContent = listing.description || '';
    // Dev info: batch (e.g. "Batch 1/5 · jobs 1–10")
    var batchEl = Dom.get('car_popup_batch');
    if (batchEl && SEMI_LISTINGS.length) {
        var batchNum     = currentLap + 1;
        var totalBatches = Math.ceil(SEMI_LISTINGS.length / JOBS_PER_LAP);
        var firstJob     = lapJobOffset + 1;
        var lastJob      = Math.min(lapJobOffset + JOBS_PER_LAP, SEMI_LISTINGS.length);
        batchEl.textContent = 'Batch ' + batchNum + '/' + totalBatches + ' · jobs ' + firstJob + '–' + lastJob;
    } else if (batchEl) {
        batchEl.textContent = '';
    }
    // Dev info: seen badge
    var seenBadge = Dom.get('car_popup_seen');
    if (seenBadge) seenBadge.style.display = (listing.id && seenListings.has(listing.id)) ? 'inline-flex' : 'none';
    Dom.get('car_popup_buy').onclick = function () {
        if (listing.id) clickedListings.add(listing.id);
        window.open(listing.url, '_blank');
    };
    Dom.get('car_popup').style.display = 'flex';
}

function closeCarPopup() {
    dismissedSemi = followedSemi; // lock this truck — won't re-show until player leaves its zone
    Dom.get('car_popup').style.display = 'none';
}

// ── Results screen ────────────────────────────────────────────────────────────

function showResults() {
    var el = Dom.get('results');
    if (!el) return;

    var batch = currentLapBatch;

    var totalBatches = Math.ceil((SEMI_LISTINGS.length || 1) / JOBS_PER_LAP);
    var isLast = (currentLap + 1) >= totalBatches;

    var mapName = (typeof MAPS !== 'undefined') ? MAPS[currentMapIndex % MAPS.length].name : '';
    Dom.get('results-lap').textContent = 'Convoy ' + (currentLap + 1) + ' / ' + totalBatches + (mapName ? ' · ' + mapName : '');

    var list = Dom.get('results-list');
    list.innerHTML = '';
    console.log('[results] batch:', batch.length, 'seen:', [...seenListings], 'clicked:', [...clickedListings]);
    for (var i = 0; i < batch.length; i++) {
        var job = batch[i];
        var jobKey  = job && job.id;
        var clicked = jobKey && clickedListings.has(job.id);

        var row = document.createElement('div');
        row.className = 'results-row' + (clicked ? ' results-clicked' : '');

        var title = document.createElement('div');
        title.className = 'results-job-title';
        title.textContent = (job && job.title) ? job.title : '—';

        var co = document.createElement('div');
        co.className = 'results-job-co';
        co.textContent = (job && job.company) ? job.company : '';

        var info = document.createElement('div');
        info.className = 'results-job-info';

        var salary = document.createElement('span');
        salary.className = 'results-salary';
        salary.textContent = (job && job.salary) ? job.salary : '';

        var badges = document.createElement('span');
        badges.className = 'results-badges';
        var seen = jobKey && seenListings.has(job.id);
        if (clicked) {
            var b = document.createElement('span');
            b.className = 'badge badge-clicked';
            b.textContent = '✓ Applied';
            badges.appendChild(b);
        } else if (seen) {
            var b = document.createElement('span');
            b.className = 'badge badge-opened';
            b.textContent = '👁 Seen';
            badges.appendChild(b);
        }

        info.appendChild(salary);
        info.appendChild(badges);
        row.appendChild(title);
        row.appendChild(co);
        row.appendChild(info);

        // Clicking a row opens the job URL
        if (job && job.url) {
            (function(j) {
                row.style.cursor = 'pointer';
                row.addEventListener('click', function() {
                    if (j.id) clickedListings.add(j.id);
                    window.open(j.url, '_blank');
                    row.classList.remove('results-opened');
                    row.classList.add('results-clicked');
                    badges.innerHTML = '';
                    var b2 = document.createElement('span');
                    b2.className = 'badge badge-clicked';
                    b2.textContent = '✓ Applied';
                    badges.appendChild(b2);
                });
            })(job);
        }

        list.appendChild(row);
    }

    var btn = Dom.get('results-next-btn');
    if (isLast) {
        btn.textContent = '🏆 Finish';
        btn.className   = 'results-next-btn results-finish-btn';
    } else {
        btn.textContent = '🚛 Next Job Convoy';
        btn.className   = 'results-next-btn';
    }

    el.style.display = 'flex';
    requestAnimationFrame(function() { el.classList.add('visible'); });
}

function nextConvoy() {
    var el = Dom.get('results');
    if (el) {
        el.classList.remove('visible');
        setTimeout(function() { el.style.display = 'none'; }, 400);
    }
    currentLap++;
    currentMapIndex = currentLap % MAPS.length;  // advance map
    lapJobOffset = (currentLap * JOBS_PER_LAP) % (SEMI_LISTINGS.length || 1);
    menuActive   = false;
    // Rebuild road for the new map (force by clearing segments)
    segments = [];
    reset();
}

// ── Tweak UI ──────────────────────────────────────────────────────────────────

Dom.on('resolution', 'change', function (ev) {
    var w, h;
    switch (ev.target.options[ev.target.selectedIndex].value) {
        case 'fine':   w = 1280; h = 960; break;
        case 'high':   w = 1024; h = 768; break;
        case 'medium': w = 640;  h = 480; break;
        case 'low':    w = 480;  h = 360; break;
    }
    reset({ width: w, height: h });
    Dom.blur(ev);
});

Dom.on('lanes',        'change', function (ev) { Dom.blur(ev); reset({ lanes: ev.target.options[ev.target.selectedIndex].value }); });
Dom.on('roadWidth',    'change', function (ev) { Dom.blur(ev); reset({ roadWidth:    Util.limit(Util.toInt(ev.target.value), Util.toInt(ev.target.getAttribute('min')), Util.toInt(ev.target.getAttribute('max'))) }); });
Dom.on('cameraHeight', 'change', function (ev) { Dom.blur(ev); reset({ cameraHeight: Util.limit(Util.toInt(ev.target.value), Util.toInt(ev.target.getAttribute('min')), Util.toInt(ev.target.getAttribute('max'))) }); });
Dom.on('drawDistance', 'change', function (ev) { Dom.blur(ev); reset({ drawDistance: Util.limit(Util.toInt(ev.target.value), Util.toInt(ev.target.getAttribute('min')), Util.toInt(ev.target.getAttribute('max'))) }); });
Dom.on('fieldOfView',  'change', function (ev) { Dom.blur(ev); reset({ fieldOfView:  Util.limit(Util.toInt(ev.target.value), Util.toInt(ev.target.getAttribute('min')), Util.toInt(ev.target.getAttribute('max'))) }); });
Dom.on('fogDensity',   'change', function (ev) { Dom.blur(ev); reset({ fogDensity:   Util.limit(Util.toInt(ev.target.value), Util.toInt(ev.target.getAttribute('min')), Util.toInt(ev.target.getAttribute('max'))) }); });

function refreshTweakUI() {
    Dom.get('lanes').selectedIndex = lanes - 1;
    Dom.get('currentRoadWidth').innerHTML    = Dom.get('roadWidth').value    = roadWidth;
    Dom.get('currentCameraHeight').innerHTML = Dom.get('cameraHeight').value = cameraHeight;
    Dom.get('currentDrawDistance').innerHTML = Dom.get('drawDistance').value = drawDistance;
    Dom.get('currentFieldOfView').innerHTML  = Dom.get('fieldOfView').value  = fieldOfView;
    Dom.get('currentFogDensity').innerHTML   = Dom.get('fogDensity').value   = fogDensity;
}
