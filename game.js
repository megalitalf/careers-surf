// number of lanes
var lanes = 3;

// actually half the roads width, 
// easier math if the road spans from -roadWidth to +roadWidth
var roadWidth = 1000;

// z height of camera
var cameraHeight = 1000;

// number of segments to draw
var drawDistance = 300;

// angle (degrees) for field of view
var fieldOfView = 100;

// exponential fog density
var fogDensity = 5;

var fps = 60;                      // how many 'update' frames per second
var step = 1 / fps;                   // how long is each frame (in seconds)
var mobileSpeedFactor = ('ontouchstart' in window) ? 0.75 : 1.0; // mobile screens feel faster, compensate
var width = window.innerWidth;       // logical canvas width
var height = window.innerHeight;     // logical canvas height
var centrifugal = 0.15;                    // centrifugal force multiplier when going around curves
var offRoadDecel = 0.99;                    // speed multiplier when off road (e.g. you lose 2% speed each update frame)
var skySpeed = 0.001;                   // background sky layer scroll speed when going around curve (or up hill)
var hillSpeed = 0.002;                   // background hill layer scroll speed when going around curve (or up hill)
var treeSpeed = 0.003;                   // background tree layer scroll speed when going around curve (or up hill)
var skyOffset = 0;                       // current sky scroll offset
var hillOffset = 0;                       // current hill scroll offset
var treeOffset = 0;                       // current tree scroll offset
var segments = [];                      // array of road segments
var cars = [];                      // array of cars on the road
var stats = Game.stats('fps');       // mr.doobs FPS counter
var canvas = Dom.get('canvas');       // our canvas...
var ctx = canvas.getContext('2d'); // ...and its drawing context

var resolution = null;                    // scaling factor to provide resolution independence (computed)

var segmentLength = 200;                     // length of a single segment
var rumbleLength = 3;                       // number of segments per red/white rumble strip
var trackLength = null;                    // z length of entire track (computed)


var cameraDepth = null;                    // z distance camera is from screen (computed)

var playerX = 0;                       // player x offset from center of road (-1 to 1 to stay independent of roadWidth)
var playerZ = null;                    // player relative z distance from camera (computed)

var position = 0;                       // current camera Z position (add playerZ to get player's absolute Z position)
var speed = 0;                       // current speed (will be set to cruiseSpeed after reset)
var maxSpeed = segmentLength / step * mobileSpeedFactor; // top speed (ensure we can't move more than 1 segment in a single frame to make collision detection easier)
var cruiseSpeed = maxSpeed / 2;       // cruise control speed - matches average traffic speed
var accel = maxSpeed / 5;             // acceleration rate when pressing UP
var breaking = -maxSpeed;               // deceleration rate when braking (DOWN key)
var decel = -maxSpeed / 5;             // 'natural' deceleration rate when neither accelerating, nor braking
var cruiseAccel = maxSpeed / 8;       // gentle rate at which speed drifts back to cruiseSpeed
var accLookahead = 10;                // segments ahead to scan for ACC (adaptive cruise)
var lkaRate = 1.2;                    // how gently LKA pulls back to lane centre (lower = softer)
var offRoadDecel = -maxSpeed / 2;             // off road deceleration is somewhere in between
var offRoadLimit = maxSpeed / 4;             // limit when off road deceleration no longer applies (e.g. you can always go at least this speed even when off road)
var totalCars = 200;                     // total number of cars on the road
var currentLapTime = 0;                       // current lap time
var lastLapTime = null;                    // last lap time
var visibleSemis = [];                     // screen rects of visible SEMI trucks this frame
var playerCarRect = null;                  // screen rect of player car (updated each render frame)
var followedSemi  = null;                  // the SEMI car currently being tailed by ACC
var followTimer   = 0;                     // seconds spent tailing followedSemi
var FOLLOW_DELAY  = 2.0;                   // seconds before popup auto-opens
var dismissedSemi = null;                  // truck whose banner the user last closed — won't re-show until player leaves and re-enters its zone

// ── Session UUID ──────────────────────────────────────────────────────────────
// Generates a v4-style UUID on first visit and persists it in localStorage so
// the same player keeps the same ID across page refreshes. The ID can later be
// linked to an authenticated account to save progress.
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
// ──────────────────────────────────────────────────────────────────────────────

// Job listings from jobs.js (produced by scrape_jobs.js).
// jobs.js is loaded as a <script> before game.js and declares: var jobs = [...];
var SEMI_LISTINGS = (typeof jobs !== 'undefined') ? jobs : [];
if (!SEMI_LISTINGS.length) console.warn('No job listings — run: node scrape_jobs.js');
else console.log('Loaded ' + SEMI_LISTINGS.length + ' job listings.');

var keyLeft = false;
var keyRight = false;
var keyFaster = false;
var keySlower = false;
var menuActive = true;   // controls blocked until player hits Start

function initMenu() {
    var menuEl = document.getElementById('menu');
    if (!menuEl) return;
    // Wire buttons once
    if (!menuEl.dataset.init) {
        menuEl.dataset.init = '1';
        document.getElementById('menu-start').addEventListener('click', function () {
            menuActive = false;
            menuEl.classList.add('hide');
            setTimeout(function () { menuEl.style.display = 'none'; }, 520);
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

var hud = {
    speed: { value: null, dom: Dom.get('speed_value') },
    current_lap_time: { value: null, dom: Dom.get('current_lap_time_value') },
    last_lap_time: { value: null, dom: Dom.get('last_lap_time_value') },
    fast_lap_time: { value: null, dom: Dom.get('fast_lap_time_value') }
}

//=========================================================================
// UPDATE THE GAME WORLD
//=========================================================================

function update(dt) {

    var n, car, carW, sprite, spriteW;
    var playerSegment = findSegment(position + playerZ);
    var playerW = SPRITES.PLAYER_STRAIGHT.w * SPRITES.SCALE;
    var speedPercent = speed / maxSpeed;
    var dx = dt * 2 * speedPercent; // at top speed, should be able to cross from left to right (-1 to 1) in 1 second
    var startPosition = position;

    updateCars(dt, playerSegment, playerW);

    position = Util.increase(position, dt * speed, trackLength);

    var playerSteering = keyLeft || keyRight || keyFaster || keySlower;

    if (playerSteering) {
        // Manual input — full control, LKA off
        if (keyLeft)
            playerX = playerX - dx;
        else if (keyRight)
            playerX = playerX + dx;
    } else {
        // LKA: find nearest lane centre and gently pull toward it
        var laneWidth = 2 / lanes;
        var nearestLane = Math.round((playerX + 1) / laneWidth - 0.5);
        nearestLane = Util.limit(nearestLane, 0, lanes - 1);
        var laneCentre = -1 + laneWidth * (nearestLane + 0.5);
        playerX = Util.interpolate(playerX, laneCentre, Math.min(1, lkaRate * dt));
    }

    // Follow road curvature automatically
    playerX = playerX - (dx * speedPercent * playerSegment.curve * centrifugal * 2);

    // Adaptive cruise control: scan ahead and match speed of any slower car in our lane
    var accFollowing = false;
    var accTarget = maxSpeed / 2; // default cruise
    var nearestSemi = null;       // closest SEMI with a listing in our lane
    for (var i = 1; i <= accLookahead; i++) {
        var lookSeg = segments[(playerSegment.index + i) % segments.length];
        for (var j = 0; j < lookSeg.cars.length; j++) {
            var ahead = lookSeg.cars[j];
            var aheadW = ahead.sprite.w * SPRITES.SCALE;
            if (ahead.speed < speed && Util.overlap(playerX, playerW, ahead.offset, aheadW, 1.0)) {
                // weight by proximity: closer car = stronger influence
                accTarget = Math.min(accTarget, ahead.speed * (i / accLookahead));
                accFollowing = true;
            }
            // track the closest SEMI with a listing we are locked onto
            if (!nearestSemi && SPRITES.SEMIS.indexOf(ahead.sprite) >= 0 && ahead.listing &&
                Util.overlap(playerX, playerW, ahead.offset, aheadW, 1.2)) {
                nearestSemi = ahead;
            }
        }
    }

    // Follow-timer: count up while tailing a SEMI with a listing
    if (!menuActive && nearestSemi) {
        if (nearestSemi !== followedSemi) {
            // switched to a different truck — reset timer and clear dismiss lock
            followedSemi  = nearestSemi;
            followTimer   = 0;
            // clear dismiss lock only when the player moves to a genuinely different truck
            if (dismissedSemi && dismissedSemi !== nearestSemi) {
                dismissedSemi = null;
            }
        }
        if (nearestSemi !== dismissedSemi) {
            followTimer += dt;
            if (followTimer >= FOLLOW_DELAY) {
                showCarPopup(followedSemi.listing);
            }
        }
    } else {
        if (followedSemi) {
            // lost the truck — close popup, reset timer, clear dismiss lock for that truck
            followedSemi  = null;
            followTimer   = 0;
            dismissedSemi = null;
            Dom.get('car_popup').style.display = 'none';
        }
    }
    var activeCruise = keyFaster ? maxSpeed / 2 : accTarget; // ACC ignored while player boosts

    // Cruise control: auto-run at cruise speed; UP boosts above it, DOWN brakes
    if (keyFaster)
        speed = Util.accelerate(speed, accel, dt);               // boost above cruise
    else if (keySlower)
        speed = Util.accelerate(speed, breaking, dt);            // hard brake
    else if (speed < activeCruise)
        speed = Util.accelerate(speed, cruiseAccel, dt);         // drift back up to cruise
    else if (speed > activeCruise)
        speed = Util.accelerate(speed, decel, dt);               // ease back down to cruise

    if ((playerX < -1) || (playerX > 1)) {

        if (speed > offRoadLimit)
            speed = Util.accelerate(speed, offRoadDecel, dt);

        for (n = 0; n < playerSegment.sprites.length; n++) {
            sprite = playerSegment.sprites[n];
            spriteW = sprite.source.w * SPRITES.SCALE;
            if (Util.overlap(playerX, playerW, sprite.offset + spriteW / 2 * (sprite.offset > 0 ? 1 : -1), spriteW)) {
                speed = maxSpeed / 5;
                position = Util.increase(playerSegment.p1.world.z, -playerZ, trackLength); // stop in front of sprite (at front of segment)
                break;
            }
        }
    }

    for (n = 0; n < playerSegment.cars.length; n++) {
        car = playerSegment.cars[n];
        carW = car.sprite.w * SPRITES.SCALE;
        if (speed > car.speed) {
            if (Util.overlap(playerX, playerW, car.offset, carW, 0.8)) {
                speed = car.speed * (car.speed / speed);
                position = Util.increase(car.z, -playerZ, trackLength);
                break;
            }
        }
    }

    playerX = Util.limit(playerX, -3, 3);     // dont ever let it go too far out of bounds
    speed = Util.limit(speed, 0, maxSpeed); // or exceed maxSpeed

    skyOffset = Util.increase(skyOffset, skySpeed * playerSegment.curve * (position - startPosition) / segmentLength, 1);
    hillOffset = Util.increase(hillOffset, hillSpeed * playerSegment.curve * (position - startPosition) / segmentLength, 1);
    treeOffset = Util.increase(treeOffset, treeSpeed * playerSegment.curve * (position - startPosition) / segmentLength, 1);

    if (position > playerZ) {
        if (currentLapTime && (startPosition < playerZ)) {
            lastLapTime = currentLapTime;
            currentLapTime = 0;
            if (lastLapTime <= Util.toFloat(Dom.storage.fast_lap_time)) {
                Dom.storage.fast_lap_time = lastLapTime;
                updateHud('fast_lap_time', formatTime(lastLapTime));
                Dom.addClassName('fast_lap_time', 'fastest');
                Dom.addClassName('last_lap_time', 'fastest');
            }
            else {
                Dom.removeClassName('fast_lap_time', 'fastest');
                Dom.removeClassName('last_lap_time', 'fastest');
            }
            updateHud('last_lap_time', formatTime(lastLapTime));
            Dom.show('last_lap_time');
        }
        else {
            currentLapTime += dt;
        }
    }

    updateHud('speed', Math.round(speed / maxSpeed * 200));
    updateHud('current_lap_time', formatTime(currentLapTime));

    var accEl = Dom.get('acc_indicator');
    accEl.className = (accFollowing && !keyFaster) ? 'hud following' : 'hud free';

    var lkaEl = Dom.get('lka_indicator');
    if (playerSteering) {
        lkaEl.className = 'hud off';         // grey  - overridden by driver
    } else {
        var lkaWidth = 2 / lanes;
        var lkaNearest = Math.round((playerX + 1) / lkaWidth - 0.5);
        lkaNearest = Util.limit(lkaNearest, 0, lanes - 1);
        var lkaCentre = -1 + lkaWidth * (lkaNearest + 0.5);
        var lkaOffset = Math.abs(playerX - lkaCentre);
        lkaEl.className = (lkaOffset > 0.05) ? 'hud correcting' : 'hud standby';
    }
}

//-------------------------------------------------------------------------

function updateCars(dt, playerSegment, playerW) {
    var n, car, oldSegment, newSegment;
    for (n = 0; n < cars.length; n++) {
        car = cars[n];
        oldSegment = findSegment(car.z);
        car.offset = car.offset + updateCarOffset(car, oldSegment, playerSegment, playerW);
        car.z = Util.increase(car.z, dt * car.speed, trackLength);
        car.percent = Util.percentRemaining(car.z, segmentLength); // useful for interpolation during rendering phase
        newSegment = findSegment(car.z);
        if (oldSegment != newSegment) {
            index = oldSegment.cars.indexOf(car);
            oldSegment.cars.splice(index, 1);
            newSegment.cars.push(car);
        }
    }
}

function updateCarOffset(car, carSegment, playerSegment, playerW) {

    var i, j, dir, segment, otherCar, otherCarW, lookahead = 20, carW = car.sprite.w * SPRITES.SCALE;

    // optimization, dont bother steering around other cars when 'out of sight' of the player
    if ((carSegment.index - playerSegment.index) > drawDistance)
        return 0;

    for (i = 1; i < lookahead; i++) {
        segment = segments[(carSegment.index + i) % segments.length];

        if ((segment === playerSegment) && (car.speed > speed) && (Util.overlap(playerX, playerW, car.offset, carW, 1.2))) {
            if (playerX > 0.5)
                dir = -1;
            else if (playerX < -0.5)
                dir = 1;
            else
                dir = (car.offset > playerX) ? 1 : -1;
            return dir * 1 / i * (car.speed - speed) / maxSpeed; // the closer the cars (smaller i) and the greated the speed ratio, the larger the offset
        }

        for (j = 0; j < segment.cars.length; j++) {
            otherCar = segment.cars[j];
            otherCarW = otherCar.sprite.w * SPRITES.SCALE;
            if ((car.speed > otherCar.speed) && Util.overlap(car.offset, carW, otherCar.offset, otherCarW, 1.2)) {
                if (otherCar.offset > 0.5)
                    dir = -1;
                else if (otherCar.offset < -0.5)
                    dir = 1;
                else
                    dir = (car.offset > otherCar.offset) ? 1 : -1;
                return dir * 1 / i * (car.speed - otherCar.speed) / maxSpeed;
            }
        }
    }

    // if no cars ahead, but I have somehow ended up off road, then steer back on
    if (car.offset < -0.9)
        return 0.1;
    else if (car.offset > 0.9)
        return -0.1;
    else
        return 0;
}

//-------------------------------------------------------------------------

function updateHud(key, value) { // accessing DOM can be slow, so only do it if value has changed
    if (hud[key].value !== value) {
        hud[key].value = value;
        Dom.set(hud[key].dom, value);
    }
}

function formatTime(dt) {
    var minutes = Math.floor(dt / 60);
    var seconds = Math.floor(dt - (minutes * 60));
    var tenths = Math.floor(10 * (dt - Math.floor(dt)));
    if (minutes > 0)
        return minutes + "." + (seconds < 10 ? "0" : "") + seconds + "." + tenths;
    else
        return seconds + "." + tenths;
}

//=========================================================================
// RENDER THE GAME WORLD
//=========================================================================

function render() {

    var baseSegment = findSegment(position);
    var basePercent = Util.percentRemaining(position, segmentLength);
    var playerSegment = findSegment(position + playerZ);
    var playerPercent = Util.percentRemaining(position + playerZ, segmentLength);
    var playerY = Util.interpolate(playerSegment.p1.world.y, playerSegment.p2.world.y, playerPercent);
    var maxy = height;

    var x = 0;
    var dx = - (baseSegment.curve * basePercent);

    ctx.clearRect(0, 0, width, height);

    visibleSemis = []; // reset tracked semis each frame

    Render.background(ctx, null, width, height, BACKGROUND.SKY, skyOffset, resolution * skySpeed * playerY);
    Render.background(ctx, null, width, height, BACKGROUND.HILLS, hillOffset, resolution * hillSpeed * playerY);
    Render.background(ctx, null, width, height, BACKGROUND.TREES, treeOffset, resolution * treeSpeed * playerY);

    var n, i, segment, car, sprite, spriteScale, spriteX, spriteY;

    for (n = 0; n < drawDistance; n++) {

        segment = segments[(baseSegment.index + n) % segments.length];
        segment.looped = segment.index < baseSegment.index;
        segment.fog = Util.exponentialFog(n / drawDistance, fogDensity);
        segment.clip = maxy;

        Util.project(segment.p1, (playerX * roadWidth) - x, playerY + cameraHeight, position - (segment.looped ? trackLength : 0), cameraDepth, width, height, roadWidth);
        Util.project(segment.p2, (playerX * roadWidth) - x - dx, playerY + cameraHeight, position - (segment.looped ? trackLength : 0), cameraDepth, width, height, roadWidth);

        x = x + dx;
        dx = dx + segment.curve;

        if ((segment.p1.camera.z <= cameraDepth) || // behind us
            (segment.p2.screen.y >= segment.p1.screen.y) || // back face cull
            (segment.p2.screen.y >= maxy))                  // clip by (already rendered) hill
            continue;

        Render.segment(ctx, width, lanes,
            segment.p1.screen.x,
            segment.p1.screen.y,
            segment.p1.screen.w,
            segment.p2.screen.x,
            segment.p2.screen.y,
            segment.p2.screen.w,
            segment.fog,
            segment.color);

        maxy = segment.p1.screen.y;
    }

    for (n = (drawDistance - 1); n > 0; n--) {
        segment = segments[(baseSegment.index + n) % segments.length];

        for (i = 0; i < segment.cars.length; i++) {
            car = segment.cars[i];
            sprite = car.sprite;
            spriteScale = Util.interpolate(segment.p1.screen.scale, segment.p2.screen.scale, car.percent);
            spriteX = Util.interpolate(segment.p1.screen.x, segment.p2.screen.x, car.percent) + (spriteScale * car.offset * roadWidth * width / 2);
            spriteY = Util.interpolate(segment.p1.screen.y, segment.p2.screen.y, car.percent);
            Render.sprite(ctx, width, height, resolution, roadWidth, null, car.sprite, spriteScale, spriteX, spriteY, -0.5, -1, segment.clip);

            // Track SEMI position for click detection and draw price label
            if (SPRITES.SEMIS.indexOf(car.sprite) >= 0) {
                var sw = (car.sprite.w * spriteScale * width / 2) * (SPRITES.SCALE * roadWidth);
                var sh = (car.sprite.h * spriteScale * width / 2) * (SPRITES.SCALE * roadWidth);
                var sx = spriteX - sw * 0.5;
                var sy = spriteY - sh;
                visibleSemis.push({ car: car, x: sx, y: sy, w: sw, h: sh });

                // Draw labels above the truck — only when a listing is loaded
                var listing = car.listing;
                if (listing) {
                    var labelX    = sx + sw / 2;
                    var labelY    = sy - 8;
                    var priceSize = Math.max(10, Math.round(sh * 0.35));
                    var nameSize  = Math.max(8,  Math.round(sh * 0.22));
                    ctx.save();
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';

                    // Salary label (always visible)
                    ctx.font = 'bold ' + priceSize + 'px Arial';
                    ctx.fillStyle = 'rgba(0,0,0,0.55)';
                    ctx.fillText(listing.salary || '?', labelX + 1, labelY + 1);
                    ctx.fillStyle = '#ffe066';
                    ctx.fillText(listing.salary || '?', labelX, labelY);

                    // Name label — only when truck is large enough (close)
                    if (sh > 28) {
                        ctx.font = nameSize + 'px Arial';
                        ctx.fillStyle = 'rgba(0,0,0,0.55)';
                        ctx.fillText(listing.title, labelX + 1, labelY - priceSize + 1);
                        ctx.fillStyle = '#ffffff';
                        ctx.fillText(listing.title, labelX, labelY - priceSize);
                    }

                    // Arc loader — shown while follow timer is counting for this truck
                    if (car === followedSemi && followTimer < FOLLOW_DELAY) {
                        var progress = followTimer / FOLLOW_DELAY;
                        var arcR     = Math.max(8, Math.round(sh * 0.28));
                        var arcX     = labelX;
                        var arcY     = sy - sh * 0.55;
                        // background ring
                        ctx.beginPath();
                        ctx.arc(arcX, arcY, arcR, 0, Math.PI * 2);
                        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
                        ctx.lineWidth = Math.max(2, arcR * 0.28);
                        ctx.stroke();
                        // progress arc (clockwise from top)
                        ctx.beginPath();
                        ctx.arc(arcX, arcY, arcR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
                        ctx.strokeStyle = '#ffe066';
                        ctx.lineWidth = Math.max(2, arcR * 0.28);
                        ctx.stroke();
                    }

                    ctx.restore();
                }
            }
        }

        for (i = 0; i < segment.sprites.length; i++) {
            sprite = segment.sprites[i];
            spriteScale = segment.p1.screen.scale;
            spriteX = segment.p1.screen.x + (spriteScale * sprite.offset * roadWidth * width / 2);
            spriteY = segment.p1.screen.y;
            Render.sprite(ctx, width, height, resolution, roadWidth, null, sprite.source, spriteScale, spriteX, spriteY, (sprite.offset < 0 ? -1 : 0), -1, segment.clip);
        }

        if (segment == playerSegment) {
            var playerScale = cameraDepth / playerZ;
            var renderScale = playerScale;
            var playerDestX = width / 2;
            var playerDestY = (height / 2) - (cameraDepth / playerZ * Util.interpolate(playerSegment.p1.camera.y, playerSegment.p2.camera.y, playerPercent) * height / 2);
            Render.player(ctx, width, height, resolution, roadWidth, null, speed / maxSpeed,
                renderScale,
                playerDestX,
                playerDestY,
                speed * (keyLeft ? -1 : keyRight ? 1 : (playerSegment.curve < -0.05 ? -1 : playerSegment.curve > 0.05 ? 1 : 0)),
                playerSegment.p2.world.y - playerSegment.p1.world.y);

            // Expose car screen rect for touch zone & overlay (updated every frame)
            var sprW = SPRITES.PLAYER_STRAIGHT.w * renderScale * roadWidth * width / 2 * SPRITES.SCALE;
            var sprH = SPRITES.PLAYER_STRAIGHT.h * renderScale * roadWidth * width / 2 * SPRITES.SCALE;
            playerCarRect = {
                left:   playerDestX - sprW * 0.5,
                right:  playerDestX + sprW * 0.5,
                bottom: playerDestY,
                top:    playerDestY - sprH
            };

            // Brake lights — only on manual braking (DOWN / S), not cruise control
            if (keySlower) {
                var lightY  = playerDestY - sprH * 0.5;  // near bottom of sprite
                var lightRX = playerDestX + sprW * 0.36;  // right tail light
                var lightLX = playerDestX - sprW * 0.36;  // left tail light
                var rx = Math.max(2, sprW * 0.09);
                var ry = Math.max(1, sprH * 0.13);

                [lightLX, lightRX].forEach(function(lx) {
                    // outer glow
                    var glow = ctx.createRadialGradient(lx, lightY, 0, lx, lightY, rx * 2);
                    glow.addColorStop(0, 'rgba(255,40,0,0.55)');
                    glow.addColorStop(1, 'rgba(255,0,0,0)');
                    ctx.beginPath();
                    ctx.ellipse(lx, lightY, rx * 2, ry * 2, 0, 0, Math.PI * 2);
                    ctx.fillStyle = glow;
                    ctx.fill();
                    // bright core
                    // ctx.beginPath();
                    // ctx.ellipse(lx, lightY, rx, ry, 0, 0, Math.PI * 2);
                    // ctx.fillStyle = '#ff2200';
                    // ctx.fill();
                });
            }
        }
    }

    renderTouchHints(step);
}

function findSegment(z) {
    return segments[Math.floor(z / segmentLength) % segments.length];
}

//=========================================================================
// BUILD ROAD GEOMETRY
//=========================================================================

function lastY() { return (segments.length == 0) ? 0 : segments[segments.length - 1].p2.world.y; }

function addSegment(curve, y) {
    var n = segments.length;
    segments.push({
        index: n,
        p1: { world: { y: lastY(), z: n * segmentLength }, camera: {}, screen: {} },
        p2: { world: { y: y, z: (n + 1) * segmentLength }, camera: {}, screen: {} },
        curve: curve,
        sprites: [],
        cars: [],
        color: Math.floor(n / rumbleLength) % 2 ? COLORS.DARK : COLORS.LIGHT
    });
}

function addSprite(n, sprite, offset) {
    segments[n].sprites.push({ source: sprite, offset: offset });
}

function addRoad(enter, hold, leave, curve, y) {
    var startY = lastY();
    var endY = startY + (Util.toInt(y, 0) * segmentLength);
    var n, total = enter + hold + leave;
    for (n = 0; n < enter; n++)
        addSegment(Util.easeIn(0, curve, n / enter), Util.easeInOut(startY, endY, n / total));
    for (n = 0; n < hold; n++)
        addSegment(curve, Util.easeInOut(startY, endY, (enter + n) / total));
    for (n = 0; n < leave; n++)
        addSegment(Util.easeInOut(curve, 0, n / leave), Util.easeInOut(startY, endY, (enter + hold + n) / total));
}

var ROAD = {
    LENGTH: { NONE: 0, SHORT: 25, MEDIUM: 50, LONG: 100 },
    HILL: { NONE: 0, LOW: 20, MEDIUM: 40, HIGH: 60 },
    CURVE: { NONE: 0, EASY: 2, MEDIUM: 4, HARD: 6 }
};

function addStraight(num) {
    num = num || ROAD.LENGTH.MEDIUM;
    addRoad(num, num, num, 0, 0);
}

function addHill(num, height) {
    num = num || ROAD.LENGTH.MEDIUM;
    height = height || ROAD.HILL.MEDIUM;
    addRoad(num, num, num, 0, height);
}

function addCurve(num, curve, height) {
    num = num || ROAD.LENGTH.MEDIUM;
    curve = curve || ROAD.CURVE.MEDIUM;
    height = height || ROAD.HILL.NONE;
    addRoad(num, num, num, curve, height);
}

function addLowRollingHills(num, height) {
    num = num || ROAD.LENGTH.SHORT;
    height = height || ROAD.HILL.LOW;
    addRoad(num, num, num, 0, height / 2);
    addRoad(num, num, num, 0, -height);
    addRoad(num, num, num, ROAD.CURVE.EASY, height);
    addRoad(num, num, num, 0, 0);
    addRoad(num, num, num, -ROAD.CURVE.EASY, height / 2);
    addRoad(num, num, num, 0, 0);
}

function addSCurves() {
    addRoad(ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, -ROAD.CURVE.EASY, ROAD.HILL.NONE);
    addRoad(ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.CURVE.MEDIUM, ROAD.HILL.MEDIUM);
    addRoad(ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.CURVE.EASY, -ROAD.HILL.LOW);
    addRoad(ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, -ROAD.CURVE.EASY, ROAD.HILL.MEDIUM);
    addRoad(ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, -ROAD.CURVE.MEDIUM, -ROAD.HILL.MEDIUM);
}

function addBumps() {
    addRoad(10, 10, 10, 0, 5);
    addRoad(10, 10, 10, 0, -2);
    addRoad(10, 10, 10, 0, -5);
    addRoad(10, 10, 10, 0, 8);
    addRoad(10, 10, 10, 0, 5);
    addRoad(10, 10, 10, 0, -7);
    addRoad(10, 10, 10, 0, 5);
    addRoad(10, 10, 10, 0, -2);
}

function addDownhillToEnd(num) {
    num = num || 200;
    addRoad(num, num, num, -ROAD.CURVE.EASY, -lastY() / segmentLength);
}

function resetRoad() {
    segments = [];

    addStraight(ROAD.LENGTH.SHORT);
    addLowRollingHills();
    addSCurves();
    addCurve(ROAD.LENGTH.MEDIUM, ROAD.CURVE.MEDIUM, ROAD.HILL.LOW);
    addBumps();
    addLowRollingHills();
    addCurve(ROAD.LENGTH.LONG * 2, ROAD.CURVE.MEDIUM, ROAD.HILL.MEDIUM);
    addStraight();
    addHill(ROAD.LENGTH.MEDIUM, ROAD.HILL.HIGH);
    addSCurves();
    addCurve(ROAD.LENGTH.LONG, -ROAD.CURVE.MEDIUM, ROAD.HILL.NONE);
    addHill(ROAD.LENGTH.LONG, ROAD.HILL.HIGH);
    addCurve(ROAD.LENGTH.LONG, ROAD.CURVE.MEDIUM, -ROAD.HILL.LOW);
    addBumps();
    addHill(ROAD.LENGTH.LONG, -ROAD.HILL.MEDIUM);
    addStraight();
    addSCurves();
    addDownhillToEnd();

    resetSprites();
    resetCars();

    segments[findSegment(playerZ).index + 2].color = COLORS.START;
    segments[findSegment(playerZ).index + 3].color = COLORS.START;
    for (var n = 0; n < rumbleLength; n++)
        segments[segments.length - 1 - n].color = COLORS.FINISH;

    trackLength = segments.length * segmentLength;
}

function resetSprites() {
    var n, i;

    addSprite(20, SPRITES.BILLBOARD07, -1);
    addSprite(40, SPRITES.BILLBOARD06, -1);
    addSprite(60, SPRITES.BILLBOARD08, -1);
    addSprite(80, SPRITES.BILLBOARD09, -1);
    addSprite(100, SPRITES.BILLBOARD01, -1);
    addSprite(120, SPRITES.BILLBOARD02, -1);
    addSprite(140, SPRITES.BILLBOARD03, -1);
    addSprite(160, SPRITES.BILLBOARD04, -1);
    addSprite(180, SPRITES.BILLBOARD05, -1);

    addSprite(240, SPRITES.BILLBOARD07, -1.2);
    addSprite(240, SPRITES.BILLBOARD06, 1.2);
    addSprite(segments.length - 25, SPRITES.BILLBOARD07, -1.2);
    addSprite(segments.length - 25, SPRITES.BILLBOARD06, 1.2);

    for (n = 10; n < 200; n += 4 + Math.floor(n / 100)) {
        addSprite(n, SPRITES.PALM_TREE, 0.5 + Math.random() * 0.5);
        addSprite(n, SPRITES.PALM_TREE, 1 + Math.random() * 2);
    }

    for (n = 250; n < 1000; n += 5) {
        addSprite(n, SPRITES.COLUMN, 1.1);
        addSprite(n + Util.randomInt(0, 5), SPRITES.TREE1, -1 - (Math.random() * 2));
        addSprite(n + Util.randomInt(0, 5), SPRITES.TREE2, -1 - (Math.random() * 2));
    }

    for (n = 200; n < segments.length; n += 3) {
        addSprite(n, Util.randomChoice(SPRITES.PLANTS), Util.randomChoice([1, -1]) * (2 + Math.random() * 5));
    }

    var side, sprite, offset;
    for (n = 1000; n < (segments.length - 50); n += 100) {
        side = Util.randomChoice([1, -1]);
        addSprite(n + Util.randomInt(0, 50), Util.randomChoice(SPRITES.BILLBOARDS), -side);
        for (i = 0; i < 20; i++) {
            sprite = Util.randomChoice(SPRITES.PLANTS);
            offset = side * (1.5 + Math.random());
            addSprite(n + Util.randomInt(0, 50), sprite, offset);
        }

    }

}

function resetCars() {
    cars = [];
    var n, car, segment, offset, z, sprite, speed;
    for (var n = 0; n < totalCars; n++) {
        offset = Math.random() * Util.randomChoice([-0.8, 0.8]);
        z = Math.floor(Math.random() * segments.length) * segmentLength;
        sprite = Util.randomChoice(SPRITES.CARS);
        var isSemi = SPRITES.SEMIS.indexOf(sprite) >= 0;
        speed = maxSpeed / 4 + Math.random() * maxSpeed / (isSemi ? 4 : 2);
        var listing = isSemi ? Util.randomChoice(SEMI_LISTINGS) : null;
        car = { offset: offset, z: z, sprite: sprite, speed: speed, listing: listing };
        segment = findSegment(car.z);
        segment.cars.push(car);
        cars.push(car);
    }
}

//=========================================================================
// THE GAME LOOP
//=========================================================================

Game.run({
    canvas: canvas, render: render, update: update, stats: stats, step: step,
    keys: [
        { keys: [KEY.LEFT, KEY.A],  mode: 'down', action: function () { if (!menuActive) keyLeft   = true;  } },
        { keys: [KEY.RIGHT, KEY.D], mode: 'down', action: function () { if (!menuActive) keyRight  = true;  } },
        { keys: [KEY.UP, KEY.W],    mode: 'down', action: function () { if (!menuActive) keyFaster = true;  } },
        { keys: [KEY.DOWN, KEY.S],  mode: 'down', action: function () { if (!menuActive) keySlower = true;  } },
        { keys: [KEY.LEFT, KEY.A],  mode: 'up',   action: function () { keyLeft   = false; } },
        { keys: [KEY.RIGHT, KEY.D], mode: 'up',   action: function () { keyRight  = false; } },
        { keys: [KEY.UP, KEY.W],    mode: 'up',   action: function () { keyFaster = false; } },
        { keys: [KEY.DOWN, KEY.S],  mode: 'up',   action: function () { keySlower = false; } }
    ],
    ready: function () {
        reset();
        Dom.storage.fast_lap_time = Dom.storage.fast_lap_time || 180;
        updateHud('fast_lap_time', formatTime(Util.toFloat(Dom.storage.fast_lap_time)));
        // Show menu immediately (underneath splash), then fade splash out
        initMenu();
        var loadingEl = document.getElementById('loading');
        if (loadingEl) {
            var minDisplay = 800;
            var elapsed = Date.now() - (window._loadStart || Date.now());
            var remaining = Math.max(0, minDisplay - elapsed);
            setTimeout(function() {
                loadingEl.classList.add('hide');
                setTimeout(function() {
                    loadingEl.style.display = 'none';
                }, 520);
            }, remaining);
        }
    }
});

function reset(options) {
    options = options || {};
    canvas.width = width = Util.toInt(options.width, width);
    canvas.height = height = Util.toInt(options.height, height);
    lanes = Util.toInt(options.lanes, lanes);
    roadWidth = Util.toInt(options.roadWidth, roadWidth);
    cameraHeight = Util.toInt(options.cameraHeight, cameraHeight);
    drawDistance = Util.toInt(options.drawDistance, drawDistance);
    fogDensity = Util.toInt(options.fogDensity, fogDensity);
    fieldOfView = Util.toInt(options.fieldOfView, fieldOfView);
    segmentLength = Util.toInt(options.segmentLength, segmentLength);
    rumbleLength = Util.toInt(options.rumbleLength, rumbleLength);
    cameraDepth = 1 / Math.tan((fieldOfView / 2) * Math.PI / 180);
    playerZ = (cameraHeight * cameraDepth);
    resolution = height / 480;
    maxSpeed = segmentLength / step * mobileSpeedFactor;
    cruiseSpeed = maxSpeed / 2;
    accel = maxSpeed / 5;
    breaking = -maxSpeed;
    decel = -maxSpeed / 5;
    cruiseAccel = maxSpeed / 8;
    offRoadDecel = -maxSpeed / 2;
    offRoadLimit = maxSpeed / 4;
    speed = cruiseSpeed;
    playerX = 0;
    refreshTweakUI();

    if ((segments.length == 0) || (options.segmentLength) || (options.rumbleLength))
        resetRoad(); // only rebuild road when necessary
}

window.addEventListener('resize', function () {
    reset({ width: window.innerWidth, height: window.innerHeight });
});

//=========================================================================
// TOUCH CONTROLS
//=========================================================================

// The player car is always centred at (width/2, height/2).
// We split the screen into zones per touch point:
//
//   ┌──────────────────────────────┐
//   │   LEFT  │   ACCEL   │ RIGHT  │   (above car zone)
//   ├──────────┼───────────┼───────┤
//   │   LEFT  │   ACCEL   │ RIGHT  │   (above car: middle column, top of screen to car top)
//   │   LEFT  │   BRAKE   │ RIGHT  │   (car zone: middle column, full car height)
//   └──────────┴───────────┴───────┘
//
// • tap left third   → steer left
// • tap right third  → steer right
// • tap middle+above car → accelerate (keyFaster)
// • tap middle+on car   → brake      (keySlower)

// Map from touch identifier → which flags it set
var touchFlags = {};

function getTouchZone(cx, cy) {
    // Use actual rendered car bounds when available
    var r = playerCarRect;
    if (r) {
        var inCarH = (cx >= r.left && cx <= r.right);
        if (inCarH && cy >= r.top)  return 'brake';  // on the car
        if (inCarH && cy <  r.top)  return 'accel';  // above the car
    }
    // Outside car horizontally → steer
    if (cx < width / 2) return 'left';
    return 'right';
}

function applyTouchZone(zone, on) {
    if (zone === 'left')  keyLeft   = on;
    if (zone === 'right') keyRight  = on;
    if (zone === 'accel') keyFaster = on;
    if (zone === 'brake') keySlower = on;
}

function getCanvasCoords(touch) {
    var rect = canvas.getBoundingClientRect();
    var scaleX = width  / rect.width;
    var scaleY = height / rect.height;
    return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top)  * scaleY
    };
}

canvas.addEventListener('touchstart', function (ev) {
    ev.preventDefault();
    for (var i = 0; i < ev.changedTouches.length; i++) {
        var t   = ev.changedTouches[i];
        var pos = getCanvasCoords(t);
        var zone = getTouchZone(pos.x, pos.y);
        touchFlags[t.identifier] = zone;
        applyTouchZone(zone, true);
    }
}, { passive: false });

canvas.addEventListener('touchmove', function (ev) {
    ev.preventDefault();
    for (var i = 0; i < ev.changedTouches.length; i++) {
        var t    = ev.changedTouches[i];
        var pos  = getCanvasCoords(t);
        var newZone = getTouchZone(pos.x, pos.y);
        var oldZone = touchFlags[t.identifier];
        if (newZone !== oldZone) {
            applyTouchZone(oldZone, false);
            touchFlags[t.identifier] = newZone;
            applyTouchZone(newZone, true);
        }
    }
}, { passive: false });

function releaseTouches(changedTouches) {
    for (var i = 0; i < changedTouches.length; i++) {
        var t = changedTouches[i];
        var zone = touchFlags[t.identifier];
        if (zone) {
            applyTouchZone(zone, false);
            delete touchFlags[t.identifier];
        }
    }
}

canvas.addEventListener('touchend',    function (ev) { ev.preventDefault(); releaseTouches(ev.changedTouches); }, { passive: false });
canvas.addEventListener('touchcancel', function (ev) { ev.preventDefault(); releaseTouches(ev.changedTouches); }, { passive: false });

//=========================================================================
// TOUCH ZONE OVERLAY (visual hint)
//=========================================================================

// Draw semi-transparent touch zone hints on top of the game canvas.
// They fade out after a short idle period so they don't clutter gameplay.

var touchHintAlpha   = 0;      // 0 = invisible, 1 = fully visible
var touchHintTimer   = 0;      // seconds since last touch
var TOUCH_HINT_SHOW  = 3.0;    // seconds to show hint after last touch
var TOUCH_HINT_FADE  = 0.8;    // fade-in / fade-out duration

// Called from render() after the main scene is drawn
function renderTouchHints(dt) {
    // Only relevant on touch devices
    if (!('ontouchstart' in window)) return;
    if (!playerCarRect) return;

    var anyActive = Object.keys(touchFlags).length > 0;
    if (anyActive) {
        touchHintTimer = 0;
        touchHintAlpha = Math.min(1, touchHintAlpha + dt / TOUCH_HINT_FADE);
    } else {
        touchHintTimer += dt;
        if (touchHintTimer > TOUCH_HINT_SHOW) {
            touchHintAlpha = Math.max(0, touchHintAlpha - dt / TOUCH_HINT_FADE);
        } else {
            touchHintAlpha = Math.min(1, touchHintAlpha + dt / TOUCH_HINT_FADE);
        }
    }

    if (touchHintAlpha <= 0) return;

    var r       = playerCarRect;
    var a  = touchHintAlpha * 0.22;
    var a2 = a * 2.5;  // active zone brightness
    var fs = Math.round(height * 0.035);

    ctx.save();

    // Left strip (full height)
    ctx.fillStyle = keyLeft  ? 'rgba(255,220,0,' + a2 + ')' : 'rgba(255,255,255,' + a + ')';
    ctx.fillRect(0, 0, r.left, height);

    // Right strip (full height)
    ctx.fillStyle = keyRight ? 'rgba(255,220,0,' + a2 + ')' : 'rgba(255,255,255,' + a + ')';
    ctx.fillRect(r.right, 0, width - r.right, height);

    // Accel zone — middle column, above the car
    ctx.fillStyle = keyFaster ? 'rgba(0,220,100,' + a2 + ')' : 'rgba(255,255,255,' + a + ')';
    ctx.fillRect(r.left, 0, r.right - r.left, r.top);

    // Brake zone — full car rect
    ctx.fillStyle = keySlower ? 'rgba(255,60,60,' + a2 + ')' : 'rgba(255,255,255,' + a + ')';
    ctx.fillRect(r.left, r.top, r.right - r.left, r.bottom - r.top);

    // Labels
    ctx.globalAlpha = touchHintAlpha * 0.6;
    ctx.font = 'bold ' + fs + 'px Arial';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';

    ctx.fillText('◀', r.left  / 2,           height / 2);
    ctx.fillText('▶', (width + r.right) / 2, height / 2);
    ctx.fillText('▲',  width / 2, r.top / 2);
    ctx.fillText('▼',  width / 2, (r.top + r.bottom) / 2);

    ctx.restore();
}

// Canvas click: open popup when a SEMI truck is clicked
canvas.addEventListener('click', function (ev) {
    var rect = canvas.getBoundingClientRect();
    var scaleX = width / rect.width;
    var scaleY = height / rect.height;
    var cx = (ev.clientX - rect.left) * scaleX;
    var cy = (ev.clientY - rect.top) * scaleY;
    for (var i = 0; i < visibleSemis.length; i++) {
        var s = visibleSemis[i];
        if (cx >= s.x && cx <= s.x + s.w && cy >= s.y && cy <= s.y + s.h) {
            dismissedSemi = null;  // explicit tap — clear dismiss lock so it can show
            showCarPopup(s.car.listing);
            break;
        }
    }
});

function showCarPopup(listing) {
    if (!listing) return;
    Dom.get('car_popup_title').innerHTML   = listing.title   || '';
    Dom.get('car_popup_salary').innerHTML  = listing.salary  || 'Salary not disclosed';
    Dom.get('car_popup_company').innerHTML = listing.company || '';
    Dom.get('car_popup_loc').innerHTML     = listing.location || '';
    Dom.get('car_popup_buy').onclick = function () { window.open(listing.url, '_blank'); };
    Dom.get('car_popup').style.display = 'flex';
}

function closeCarPopup() {
    dismissedSemi = followedSemi;   // lock this truck — won't re-show until player leaves its zone
    Dom.get('car_popup').style.display = 'none';
}

//=========================================================================
// TWEAK UI HANDLERS
//=========================================================================

Dom.on('resolution', 'change', function (ev) {
    var w, h, ratio;
    switch (ev.target.options[ev.target.selectedIndex].value) {
        case 'fine': w = 1280; h = 960; ratio = w / width; break;
        case 'high': w = 1024; h = 768; ratio = w / width; break;
        case 'medium': w = 640; h = 480; ratio = w / width; break;
        case 'low': w = 480; h = 360; ratio = w / width; break;
    }
    reset({ width: w, height: h })
    Dom.blur(ev);
});

Dom.on('lanes', 'change', function (ev) { Dom.blur(ev); reset({ lanes: ev.target.options[ev.target.selectedIndex].value }); });
Dom.on('roadWidth', 'change', function (ev) { Dom.blur(ev); reset({ roadWidth: Util.limit(Util.toInt(ev.target.value), Util.toInt(ev.target.getAttribute('min')), Util.toInt(ev.target.getAttribute('max'))) }); });
Dom.on('cameraHeight', 'change', function (ev) { Dom.blur(ev); reset({ cameraHeight: Util.limit(Util.toInt(ev.target.value), Util.toInt(ev.target.getAttribute('min')), Util.toInt(ev.target.getAttribute('max'))) }); });
Dom.on('drawDistance', 'change', function (ev) { Dom.blur(ev); reset({ drawDistance: Util.limit(Util.toInt(ev.target.value), Util.toInt(ev.target.getAttribute('min')), Util.toInt(ev.target.getAttribute('max'))) }); });
Dom.on('fieldOfView', 'change', function (ev) { Dom.blur(ev); reset({ fieldOfView: Util.limit(Util.toInt(ev.target.value), Util.toInt(ev.target.getAttribute('min')), Util.toInt(ev.target.getAttribute('max'))) }); });
Dom.on('fogDensity', 'change', function (ev) { Dom.blur(ev); reset({ fogDensity: Util.limit(Util.toInt(ev.target.value), Util.toInt(ev.target.getAttribute('min')), Util.toInt(ev.target.getAttribute('max'))) }); });

function refreshTweakUI() {
    Dom.get('lanes').selectedIndex = lanes - 1;
    Dom.get('currentRoadWidth').innerHTML = Dom.get('roadWidth').value = roadWidth;
    Dom.get('currentCameraHeight').innerHTML = Dom.get('cameraHeight').value = cameraHeight;
    Dom.get('currentDrawDistance').innerHTML = Dom.get('drawDistance').value = drawDistance;
    Dom.get('currentFieldOfView').innerHTML = Dom.get('fieldOfView').value = fieldOfView;
    Dom.get('currentFogDensity').innerHTML = Dom.get('fogDensity').value = fogDensity;
}

