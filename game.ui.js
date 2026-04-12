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

        // ── City combobox ──────────────────────────────────────────────
        var cities = (window._CITIES && window._CITIES.length) ? window._CITIES : [];
        var selectedCity = cities.length ? cities[0].slug : null;
        var input    = document.getElementById('menu-city-input');
        var listEl   = document.getElementById('menu-city-list');
        var focusIdx = -1;
        var prevCity = { slug: selectedCity, label: cities.length ? cities[0].label : '' };

        // Seed input with default
        if (cities.length) input.value = cities[0].label;

        function renderList(filter) {
            var q = (filter || '').toLowerCase().trim();
            var matches = q
                ? cities.filter(function(c) { return c.label.toLowerCase().indexOf(q) !== -1; })
                : cities;
            listEl.innerHTML = '';
            focusIdx = -1;
            if (!matches.length) {
                var empty = document.createElement('li');
                empty.textContent = 'No cities found';
                empty.dataset.empty = '1';
                listEl.appendChild(empty);
                return;
            }
            matches.forEach(function(c) {
                var li = document.createElement('li');
                li.textContent    = c.label;
                li.dataset.slug   = c.slug;
                li.dataset.label  = c.label;
                li.addEventListener('mousedown', function(e) {
                    e.preventDefault(); // keep focus on input
                    selectCity(c.slug, c.label);
                });
                listEl.appendChild(li);
            });
        }

        function selectCity(slug, label) {
            selectedCity = slug;
            prevCity     = { slug: slug, label: label };
            input.value  = label;
            listEl.classList.remove('open');
            input.blur();
        }

        function cancelSelect() {
            selectedCity = prevCity.slug;
            input.value  = prevCity.label;
            listEl.classList.remove('open');
        }

        function moveFocus(dir) {
            var items = listEl.querySelectorAll('li:not([data-empty])');
            if (!items.length) return;
            items[focusIdx] && items[focusIdx].classList.remove('focused');
            focusIdx = Math.max(0, Math.min(items.length - 1, focusIdx + dir));
            items[focusIdx].classList.add('focused');
            items[focusIdx].scrollIntoView({ block: 'nearest' });
        }

        input.addEventListener('focus', function() {
            input.value = '';          // clear so user sees full list / can type freely
            renderList('');
            listEl.classList.add('open');
        });
        input.addEventListener('input', function() {
            renderList(input.value);
            listEl.classList.add('open');
        });
        input.addEventListener('keydown', function(e) {
            if (e.key === 'ArrowDown')       { e.preventDefault(); moveFocus(+1); }
            else if (e.key === 'ArrowUp')    { e.preventDefault(); moveFocus(-1); }
            else if (e.key === 'Enter') {
                var focused = listEl.querySelector('li.focused');
                if (focused && focused.dataset.slug) selectCity(focused.dataset.slug, focused.dataset.label);
                else cancelSelect();
                listEl.classList.remove('open');
            }
            else if (e.key === 'Escape')     { cancelSelect(); }
        });
        input.addEventListener('blur', function() {
            // short delay so mousedown on list fires first
            setTimeout(function() { cancelSelect(); }, 150);
        });
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
                        console.log('Loaded ' + cityJobs.length + ' listings for ' + selectedCity + ' (' + label + ')');
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

function calcMedianSalary(listings) {
    if (!listings || !listings.length) return 0;
    var vals = [];
    for (var i = 0; i < listings.length; i++) {
        if (typeof listings[i].salaryAvg === 'number') vals.push(listings[i].salaryAvg);
    }
    if (!vals.length) return 0;
    vals.sort(function(a, b) { return a - b; });
    var mid = Math.floor(vals.length / 2);
    return vals.length % 2 !== 0 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

function salaryDollarIcons(salaryAvg, median) {
    if (!salaryAvg || !median) return '';
    // upper 3rd: above median + (max - median) * 2/3
    var vals = [];
    for (var i = 0; i < SEMI_LISTINGS.length; i++) {
        if (typeof SEMI_LISTINGS[i].salaryAvg === 'number') vals.push(SEMI_LISTINGS[i].salaryAvg);
    }
    var maxSalary = vals.length ? Math.max.apply(null, vals) : median * 2;
    var upper3rdThreshold = median + (maxSalary - median) * (2 / 3);
    if (salaryAvg >= upper3rdThreshold) return '💰💰';
    if (salaryAvg > median) return '💰';
    return '';
}

function updateFuelHud() {
    var el = Dom.get('fuel_drops_value');
    if (el) el.textContent = fuelDrops;
    var rel = Dom.get('results-fuel');
    if (rel) rel.textContent = '⛽ ' + fuelDrops;
}

function timeAgo(isoString) {
    if (!isoString) return '';
    var diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
    if (diff < 0) diff = 0;
    if (diff < 300)  return '<5 min ago';
    if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
    if (diff < 7200) {
        var m = Math.floor((diff % 3600) / 60);
        return '1h ' + (m > 0 ? m + 'm ' : '') + 'ago';
    }
    if (diff < 86400) return Math.floor(diff / 3600) + 'h+ ago';
    return Math.floor(diff / 86400) + ' d ago';
}

function showCarPopup(listing) {
    if (!listing) return;
    // Earn a fuel drop the first time this listing is seen
    if (listing.id && !seenListings.has(listing.id)) {
        fuelDrops++;
        updateFuelHud();
    }
    // Mark as seen
    if (listing.id) seenListings.add(listing.id);

    console.log(' >>> seenListings listing:', seenListings);

    Dom.get('car_popup_title').innerHTML   = listing.title   || '';
    var median = calcMedianSalary(SEMI_LISTINGS);
    var icons  = listing.salaryAvg ? salaryDollarIcons(listing.salaryAvg, median) : '';
    Dom.get('car_popup_salary').innerHTML  = (listing.salary  || 'Salary not disclosed') + (icons ? '<span class="salary-icons">' + icons + '</span>' : '');
    Dom.get('car_popup_company').innerHTML = listing.company || '';
    Dom.get('car_popup_loc').innerHTML     = listing.location || '';
    var pubEl = Dom.get('car_popup_pub');
    if (pubEl) pubEl.innerHTML = listing.lastPublicated ? '<span class="pub-ago">' + timeAgo(listing.lastPublicated) + '</span>' : '';
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
    var buyBtn = Dom.get('car_popup_buy');
    var alreadyApplied = listing.id && clickedListings.has(listing.id);
    buyBtn.disabled = false;
    buyBtn.onclick = function () {
        if (!alreadyApplied) {
            fuelDrops++;
            updateFuelHud();
        }
        if (listing.id) clickedListings.add(listing.id);
        window.open(listing.url, '_blank');
        alreadyApplied = true;
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
    updateFuelHud();

    var list = Dom.get('results-list');
    list.innerHTML = '';
    console.log('[results] batch:', batch.length, 'seen:', [...seenListings], 'clicked:', [...clickedListings]);
    var resultsMedian = calcMedianSalary(SEMI_LISTINGS);
    var allRevealBtns = []; // track all reveal buttons to sync disabled state after each spend

    function syncRevealBtns() {
        for (var ri = 0; ri < allRevealBtns.length; ri++) {
            allRevealBtns[ri].disabled = fuelDrops < 1;
        }
    }

    for (var i = 0; i < batch.length; i++) {
        var job = batch[i];
        var jobKey  = job && job.id;
        var clicked = jobKey && clickedListings.has(job.id);
        var seen    = jobKey && seenListings.has(job.id);
        var engaged = clicked || seen;

        var row = document.createElement('div');
        var salaryIcons = (job && job.salaryAvg) ? salaryDollarIcons(job.salaryAvg, resultsMedian) : '';

        if (!engaged) {
            // ── Compact row for unseen jobs — can spend 1 fuel to reveal ──
            row.className = 'results-row results-row-unseen';

            var compactSalary = document.createElement('span');
            compactSalary.className = 'results-salary results-salary-unseen';
            compactSalary.innerHTML = (job && job.salaryAvg)
                ? job.salaryAvg.toLocaleString() + ' zł avg' + (salaryIcons ? '<span class="salary-icons">' + salaryIcons + '</span>' : '')
                : '—';

            var revealBtn = document.createElement('button');
            revealBtn.className = 'results-reveal-btn';
            revealBtn.textContent = '⛽ 1  Reveal';
            revealBtn.disabled = fuelDrops < 1;
            allRevealBtns.push(revealBtn);

            row.appendChild(compactSalary);
            row.appendChild(revealBtn);

            if (job) {
                (function(j, r, rBtn, icons) {
                    rBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        if (fuelDrops < 1) return;
                        fuelDrops--;
                        updateFuelHud();
                        // Remove this button from the tracked list (it's gone after rebuild)
                        var idx = allRevealBtns.indexOf(rBtn);
                        if (idx >= 0) allRevealBtns.splice(idx, 1);
                        syncRevealBtns();
                        // Rebuild row as full detail
                        r.className = 'results-row results-opened';
                        r.innerHTML = '';

                        var t = document.createElement('div');
                        t.className = 'results-job-title';
                        var tTitle = document.createElement('span');
                        tTitle.textContent = j.title || '—';
                        t.appendChild(tTitle);
                        if (j.lastPublicated) {
                            var pa = document.createElement('span');
                            pa.className = 'pub-ago pub-ago-row';
                            pa.textContent = timeAgo(j.lastPublicated);
                            t.appendChild(pa);
                        }

                        var c = document.createElement('div');
                        c.className = 'results-job-co';
                        c.textContent = j.company || '';

                        var inf = document.createElement('div');
                        inf.className = 'results-job-info';

                        var sal = document.createElement('span');
                        sal.className = 'results-salary';
                        sal.innerHTML = (j.salary || '') + (icons ? '<span class="salary-icons">' + icons + '</span>' : '');

                        var bdg = document.createElement('span');
                        bdg.className = 'results-badges';
                        var bv = document.createElement('span');
                        bv.className = 'badge badge-opened';
                        bv.textContent = '👁 Seen';
                        bdg.appendChild(bv);

                        inf.appendChild(sal);
                        inf.appendChild(bdg);
                        r.appendChild(t);
                        r.appendChild(c);
                        r.appendChild(inf);

                        // Now clickable to apply
                        r.style.cursor = 'pointer';
                        r.addEventListener('click', function() {
                            if (j.id) clickedListings.add(j.id);
                            fuelDrops++;
                            updateFuelHud();
                            syncRevealBtns();
                            window.open(j.url, '_blank');
                            r.classList.remove('results-opened');
                            r.classList.add('results-clicked');
                            bdg.innerHTML = '';
                            var b2 = document.createElement('span');
                            b2.className = 'badge badge-clicked';
                            b2.textContent = '✓ Applied';
                            bdg.appendChild(b2);
                        });
                    });
                })(job, row, revealBtn, salaryIcons);
            }
        } else {
            // ── Full row for seen / applied jobs ──
            row.className = 'results-row' + (clicked ? ' results-clicked' : ' results-opened');

            var title = document.createElement('div');
            title.className = 'results-job-title';
            var titleSpan = document.createElement('span');
            titleSpan.textContent = (job && job.title) ? job.title : '—';
            title.appendChild(titleSpan);
            if (job && job.lastPublicated) {
                var pubAgo = document.createElement('span');
                pubAgo.className = 'pub-ago pub-ago-row';
                pubAgo.textContent = timeAgo(job.lastPublicated);
                title.appendChild(pubAgo);
            }

            var co = document.createElement('div');
            co.className = 'results-job-co';
            co.textContent = (job && job.company) ? job.company : '';

            var info = document.createElement('div');
            info.className = 'results-job-info';

            var salary = document.createElement('span');
            salary.className = 'results-salary';
            salary.innerHTML = ((job && job.salary) ? job.salary : '') + (salaryIcons ? '<span class="salary-icons">' + salaryIcons + '</span>' : '');

            var badges = document.createElement('span');
            badges.className = 'results-badges';
            if (clicked) {
                var b = document.createElement('span');
                b.className = 'badge badge-clicked';
                b.textContent = '✓ Applied';
                badges.appendChild(b);
            } else {
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

            // Clicking a full row opens the job URL
            if (job && job.url) {
                (function(j, r, bdg) {
                    r.style.cursor = 'pointer';
                    r.addEventListener('click', function() {
                        if (j.id) clickedListings.add(j.id);
                        fuelDrops++;
                        updateFuelHud();
                        syncRevealBtns();
                        window.open(j.url, '_blank');
                        r.classList.remove('results-opened');
                        r.classList.add('results-clicked');
                        bdg.innerHTML = '';
                        var b2 = document.createElement('span');
                        b2.className = 'badge badge-clicked';
                        b2.textContent = '✓ Applied';
                        bdg.appendChild(b2);
                    });
                })(job, row, badges);
            }
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

// ── Mini-map widget ───────────────────────────────────────────────────────────

(function () {
    var mmCanvas = null;
    var mmCtx    = null;

    function initMinimap() {
        mmCanvas = Dom.get('minimap');
        if (!mmCanvas) return;
        // Sync the canvas drawing buffer to its CSS pixel size
        var dpr = window.devicePixelRatio || 1;
        mmCanvas.width  = Math.round(mmCanvas.offsetWidth  * dpr);
        mmCanvas.height = Math.round(mmCanvas.offsetHeight * dpr);
        mmCtx = mmCanvas.getContext('2d');
        if (dpr !== 1) mmCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    window.renderMinimap = function () {
        if (!mmCanvas || !mmCtx) initMinimap();
        if (!mmCanvas || !mmCtx) return;
        if (!trackLength || menuActive) return;

        var W = mmCanvas.offsetWidth;
        var H = mmCanvas.offsetHeight;

        // Resize backing store if CSS size changed (e.g. window resize)
        var dpr = window.devicePixelRatio || 1;
        var bW  = Math.round(W * dpr);
        var bH  = Math.round(H * dpr);
        if (mmCanvas.width !== bW || mmCanvas.height !== bH) {
            mmCanvas.width  = bW;
            mmCanvas.height = bH;
            mmCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        mmCtx.clearRect(0, 0, W, H);

        // Background pill
        mmCtx.fillStyle = 'rgba(0,0,0,0.52)';
        mmCtx.beginPath();
        mmCtx.roundRect(0, 0, W, H, H / 2);
        mmCtx.fill();

        // Margins inside the pill
        var PAD  = H * 0.8;
        var MIDY = H / 2;
        var lineY = MIDY;

        // Track line
        mmCtx.strokeStyle = 'rgba(255,255,255,0.28)';
        mmCtx.lineWidth   = 2;
        mmCtx.beginPath();
        mmCtx.moveTo(PAD, lineY);
        mmCtx.lineTo(W - PAD, lineY);
        mmCtx.stroke();

        // Finish-line tick
        mmCtx.strokeStyle = 'rgba(255,255,255,0.6)';
        mmCtx.lineWidth   = 2;
        mmCtx.beginPath();
        mmCtx.moveTo(W - PAD, lineY - H * 0.3);
        mmCtx.lineTo(W - PAD, lineY + H * 0.3);
        mmCtx.stroke();

        var trackW = W - PAD * 2;

        // Helper: z position → x pixel on the bar
        function zToX(z) {
            return PAD + (z / trackLength) * trackW;
        }

        var DOT_R_SEMI   = Math.max(3, H * 0.26);
        var DOT_R_PLAYER = Math.max(4, H * 0.32);

        // Red dots — job-truck semis only
        for (var i = 0; i < cars.length; i++) {
            var car = cars[i];
            if (!car.listing) continue; // skip regular traffic
            var cx = zToX(car.z);
            mmCtx.beginPath();
            mmCtx.arc(cx, lineY, DOT_R_SEMI, 0, Math.PI * 2);
            mmCtx.fillStyle = '#ff3b3b';
            mmCtx.fill();
        }

        // Yellow dot — player
        var playerPos = position + playerZ;
        if (playerPos > trackLength) playerPos -= trackLength;
        var px = zToX(playerPos);
        mmCtx.beginPath();
        mmCtx.arc(px, lineY, DOT_R_PLAYER, 0, Math.PI * 2);
        mmCtx.fillStyle   = '#ffe800';
        mmCtx.fill();
        mmCtx.strokeStyle = 'rgba(0,0,0,0.5)';
        mmCtx.lineWidth   = 1.5;
        mmCtx.stroke();
    };
})();
