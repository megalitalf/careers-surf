// =========================================================================
// GAME LOOP — update, render, reset, Game.run
// Remaining modules: game.config.js, game.session.js, game.road.js,
//                    game.cars.js, game.ui.js, game.input.js
// =========================================================================

//=========================================================================
// UPDATE THE GAME WORLD
//=========================================================================

function update(dt) {

    var n, car, carW, sprite, spriteW;
    var playerSegment = findSegment(position + playerZ);
    var playerW       = SPRITES.PLAYER_STRAIGHT.w * SPRITES.SCALE;
    var speedPercent  = speed / maxSpeed;
    var dx            = dt * 2 * speedPercent; // at top speed, cross from left to right (-1 to 1) in 1 second
    var startPosition = position;

    updateCars(dt, playerSegment, playerW);

    position = Util.increase(position, dt * speed, trackLength);

    var playerSteering = keyLeft || keyRight || keyFaster || keySlower;

    if (playerSteering) {
        // Manual input — full control, LKA off
        if (keyLeft)       playerX = playerX - dx;
        else if (keyRight) playerX = playerX + dx;
    } else {
        // LKA: find nearest lane centre and gently pull toward it
        var laneWidth   = 2 / lanes;
        var nearestLane = Math.round((playerX + 1) / laneWidth - 0.5);
        nearestLane     = Util.limit(nearestLane, 0, lanes - 1);
        var laneCentre  = -1 + laneWidth * (nearestLane + 0.5);
        playerX = Util.interpolate(playerX, laneCentre, Math.min(1, lkaRate * dt));
    }

    // Follow road curvature automatically
    playerX = playerX - (dx * speedPercent * playerSegment.curve * centrifugal * 2);

    // Adaptive cruise control: scan ahead and match speed of any slower car in our lane
    var accFollowing = false;
    var accTarget    = maxSpeed / 2; // default cruise
    var nearestSemi  = null;         // closest SEMI with a listing in our lane
    for (var i = 1; i <= accLookahead; i++) {
        var lookSeg = segments[(playerSegment.index + i) % segments.length];
        for (var j = 0; j < lookSeg.cars.length; j++) {
            var ahead  = lookSeg.cars[j];
            var aheadW = ahead.sprite.w * SPRITES.SCALE;
            if (ahead.speed < speed && Util.overlap(playerX, playerW, ahead.offset, aheadW, 1.0)) {
                accTarget    = Math.min(accTarget, ahead.speed * (i / accLookahead));
                accFollowing = true;
            }
            if (!nearestSemi && SPRITES.SEMIS.indexOf(ahead.sprite) >= 0 && ahead.listing &&
                Util.overlap(playerX, playerW, ahead.offset, aheadW, 1.2)) {
                nearestSemi = ahead;
            }
        }
    }

    // Follow-timer: count up while tailing a SEMI with a listing
    if (!menuActive && nearestSemi) {
        if (nearestSemi !== followedSemi) {
            followedSemi = nearestSemi;
            followTimer  = 0;
            if (dismissedSemi && dismissedSemi !== nearestSemi) {
                dismissedSemi = null;
            }
        }
        if (nearestSemi !== dismissedSemi) {
            followTimer += dt;
            if (followTimer >= FOLLOW_DELAY) {
                var popupEl = Dom.get('car_popup');
                if (!popupEl || popupEl.style.display === 'none') {
                    showCarPopup(followedSemi.listing);
                }
            }
        }
    } else {
        if (followedSemi) {
            followedSemi  = null;
            followTimer   = 0;
            dismissedSemi = null;
            Dom.get('car_popup').style.display = 'none';
        }
    }

    var activeCruise = keyFaster ? maxSpeed / 2 : accTarget; // ACC ignored while player boosts

    // Cruise control: auto-run at cruise speed; UP boosts above it, DOWN brakes
    if (keyFaster)
        speed = Util.accelerate(speed, accel,       dt); // boost above cruise
    else if (keySlower)
        speed = Util.accelerate(speed, breaking,    dt); // hard brake
    else if (speed < activeCruise)
        speed = Util.accelerate(speed, cruiseAccel, dt); // drift back up
    else if (speed > activeCruise)
        speed = Util.accelerate(speed, decel,       dt); // ease back down

    if ((playerX < -1) || (playerX > 1)) {
        if (speed > offRoadLimit)
            speed = Util.accelerate(speed, offRoadDecel, dt);

        for (n = 0; n < playerSegment.sprites.length; n++) {
            sprite  = playerSegment.sprites[n];
            spriteW = sprite.source.w * SPRITES.SCALE;
            if (Util.overlap(playerX, playerW, sprite.offset + spriteW / 2 * (sprite.offset > 0 ? 1 : -1), spriteW)) {
                speed    = maxSpeed / 5;
                position = Util.increase(playerSegment.p1.world.z, -playerZ, trackLength);
                break;
            }
        }
    }

    for (n = 0; n < playerSegment.cars.length; n++) {
        car  = playerSegment.cars[n];
        carW = car.sprite.w * SPRITES.SCALE;
        if (speed > car.speed) {
            if (Util.overlap(playerX, playerW, car.offset, carW, 0.8)) {
                speed    = car.speed * (car.speed / speed);
                position = Util.increase(car.z, -playerZ, trackLength);
                break;
            }
        }
    }

    playerX = Util.limit(playerX, -3, 3);      // don't ever let it go too far out of bounds
    speed   = Util.limit(speed,   0, maxSpeed); // or exceed maxSpeed

    skyOffset  = Util.increase(skyOffset,  skySpeed  * playerSegment.curve * (position - startPosition) / segmentLength, 1);
    hillOffset = Util.increase(hillOffset, hillSpeed * playerSegment.curve * (position - startPosition) / segmentLength, 1);
    treeOffset = Util.increase(treeOffset, treeSpeed * playerSegment.curve * (position - startPosition) / segmentLength, 1);

    if (position > playerZ) {
        if (lapActive && currentLapTime && (startPosition < playerZ)) {
            lastLapTime    = currentLapTime;
            currentLapTime = 0;
            lapActive      = false;
            menuActive     = true; // freeze controls while results are up
            if (lastLapTime <= Util.toFloat(Dom.storage.fast_lap_time)) {
                Dom.storage.fast_lap_time = lastLapTime;
                updateHud('fast_lap_time', formatTime(lastLapTime));
                Dom.addClassName('fast_lap_time', 'fastest');
                Dom.addClassName('last_lap_time', 'fastest');
            } else {
                Dom.removeClassName('fast_lap_time', 'fastest');
                Dom.removeClassName('last_lap_time', 'fastest');
            }
            updateHud('last_lap_time', formatTime(lastLapTime));
            Dom.show('last_lap_time');
            showResults();
        } else if (lapActive) {
            currentLapTime += dt;
        }
    }

    updateHud('speed', Math.round(speed / maxSpeed * 200));
    updateHud('current_lap_time', formatTime(currentLapTime));

    var accEl = Dom.get('acc_indicator');
    accEl.className = (accFollowing && !keyFaster) ? 'hud following' : 'hud free';

    var lkaEl = Dom.get('lka_indicator');
    if (playerSteering) {
        lkaEl.className = 'hud off';
    } else {
        var lkaWidth   = 2 / lanes;
        var lkaNearest = Math.round((playerX + 1) / lkaWidth - 0.5);
        lkaNearest     = Util.limit(lkaNearest, 0, lanes - 1);
        var lkaCentre  = -1 + lkaWidth * (lkaNearest + 0.5);
        var lkaOffset  = Math.abs(playerX - lkaCentre);
        lkaEl.className = (lkaOffset > 0.05) ? 'hud correcting' : 'hud standby';
    }
}

//=========================================================================
// RENDER THE GAME WORLD
//=========================================================================

function render() {

    var baseSegment   = findSegment(position);
    var basePercent   = Util.percentRemaining(position, segmentLength);
    var playerSegment = findSegment(position + playerZ);
    var playerPercent = Util.percentRemaining(position + playerZ, segmentLength);
    var playerY       = Util.interpolate(playerSegment.p1.world.y, playerSegment.p2.world.y, playerPercent);
    var maxy          = height;

    var x  = 0;
    var dx = -(baseSegment.curve * basePercent);

    ctx.clearRect(0, 0, width, height);

    visibleSemis = []; // reset tracked semis each frame

    Render.background(ctx, null, width, height, BACKGROUND.SKY,   skyOffset,  resolution * skySpeed  * playerY);
    Render.background(ctx, null, width, height, BACKGROUND.HILLS, hillOffset, resolution * hillSpeed * playerY);
    Render.background(ctx, null, width, height, BACKGROUND.TREES, treeOffset, resolution * treeSpeed * playerY);

    var n, i, segment, car, sprite, spriteScale, spriteX, spriteY;

    for (n = 0; n < drawDistance; n++) {

        segment        = segments[(baseSegment.index + n) % segments.length];
        segment.looped = segment.index < baseSegment.index;
        segment.fog    = Util.exponentialFog(n / drawDistance, fogDensity);
        segment.clip   = maxy;

        Util.project(segment.p1, (playerX * roadWidth) - x,      playerY + cameraHeight, position - (segment.looped ? trackLength : 0), cameraDepth, width, height, roadWidth);
        Util.project(segment.p2, (playerX * roadWidth) - x - dx, playerY + cameraHeight, position - (segment.looped ? trackLength : 0), cameraDepth, width, height, roadWidth);

        x  = x + dx;
        dx = dx + segment.curve;

        if ((segment.p1.camera.z <= cameraDepth) ||          // behind us
            (segment.p2.screen.y >= segment.p1.screen.y) ||  // back face cull
            (segment.p2.screen.y >= maxy))                   // clip by already-rendered hill
            continue;

        Render.segment(ctx, width, lanes,
            segment.p1.screen.x, segment.p1.screen.y, segment.p1.screen.w,
            segment.p2.screen.x, segment.p2.screen.y, segment.p2.screen.w,
            segment.fog, segment.color);

        maxy = segment.p1.screen.y;
    }

    for (n = (drawDistance - 1); n > 0; n--) {
        segment = segments[(baseSegment.index + n) % segments.length];

        for (i = 0; i < segment.cars.length; i++) {
            car         = segment.cars[i];
            sprite      = car.sprite;
            spriteScale = Util.interpolate(segment.p1.screen.scale, segment.p2.screen.scale, car.percent);
            spriteX     = Util.interpolate(segment.p1.screen.x,     segment.p2.screen.x,     car.percent) + (spriteScale * car.offset * roadWidth * width / 2);
            spriteY     = Util.interpolate(segment.p1.screen.y,     segment.p2.screen.y,     car.percent);
            Render.sprite(ctx, width, height, resolution, roadWidth, null, car.sprite, spriteScale, spriteX, spriteY, -0.5, -1, segment.clip);

            // Track SEMI position for click detection and draw price label
            if (SPRITES.SEMIS.indexOf(car.sprite) >= 0) {
                var sw = (car.sprite.w * spriteScale * width / 2) * (SPRITES.SCALE * roadWidth);
                var sh = (car.sprite.h * spriteScale * width / 2) * (SPRITES.SCALE * roadWidth);
                var sx = spriteX - sw * 0.5;
                var sy = spriteY - sh;
                visibleSemis.push({ car: car, x: sx, y: sy, w: sw, h: sh });

                var listing = car.listing;
                if (listing) {
                    var labelX    = sx + sw / 2;
                    var labelY    = sy - 8;
                    var priceSize = Math.max(10, Math.round(sh * 0.35));
                    var nameSize  = Math.max(8,  Math.round(sh * 0.22));
                    ctx.save();
                    ctx.textAlign    = 'center';
                    ctx.textBaseline = 'bottom';

                    // Salary label (always visible)
                    ctx.font      = 'bold ' + priceSize + 'px Arial';
                    ctx.fillStyle = 'rgba(0,0,0,0.55)';
                    ctx.fillText(listing.salary || '?', labelX + 1, labelY + 1);
                    ctx.fillStyle = '#ffe066';
                    ctx.fillText(listing.salary || '?', labelX, labelY);

                    // Name label — only when truck is large enough (close)
                    if (sh > 28) {
                        ctx.font      = nameSize + 'px Arial';
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
                        ctx.beginPath();
                        ctx.arc(arcX, arcY, arcR, 0, Math.PI * 2);
                        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
                        ctx.lineWidth   = Math.max(2, arcR * 0.28);
                        ctx.stroke();
                        ctx.beginPath();
                        ctx.arc(arcX, arcY, arcR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
                        ctx.strokeStyle = '#ffe066';
                        ctx.lineWidth   = Math.max(2, arcR * 0.28);
                        ctx.stroke();
                    }

                    // Purple seen-dot — shown when this listing was already opened
                    if (listing.id && seenListings.has(listing.id)) {
                        var dotR = Math.max(5, Math.round(sh * 0.18));
                        var dotX = sx + sw - dotR * 0.6;
                        var dotY = sy + dotR * 0.6;
                        ctx.beginPath();
                        ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
                        ctx.fillStyle   = '#a855f7';
                        ctx.fill();
                        ctx.lineWidth   = 1.5;
                        ctx.strokeStyle = '#fff';
                        ctx.stroke();
                    }

                    ctx.restore();
                }
            }
        }

        for (i = 0; i < segment.sprites.length; i++) {
            sprite      = segment.sprites[i];
            spriteScale = segment.p1.screen.scale;
            spriteX     = segment.p1.screen.x + (spriteScale * sprite.offset * roadWidth * width / 2);
            spriteY     = segment.p1.screen.y;
            Render.sprite(ctx, width, height, resolution, roadWidth, null, sprite.source, spriteScale, spriteX, spriteY, (sprite.offset < 0 ? -1 : 0), -1, segment.clip);
        }

        if (segment === playerSegment) {
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
                var lightY  = playerDestY - sprH * 0.5;
                var lightRX = playerDestX + sprW * 0.36;
                var lightLX = playerDestX - sprW * 0.36;
                var rx = Math.max(2, sprW * 0.09);
                var ry = Math.max(1, sprH * 0.13);

                [lightLX, lightRX].forEach(function(lx) {
                    var glow = ctx.createRadialGradient(lx, lightY, 0, lx, lightY, rx * 2);
                    glow.addColorStop(0, 'rgba(255,40,0,0.55)');
                    glow.addColorStop(1, 'rgba(255,0,0,0)');
                    ctx.beginPath();
                    ctx.ellipse(lx, lightY, rx * 2, ry * 2, 0, 0, Math.PI * 2);
                    ctx.fillStyle = glow;
                    ctx.fill();
                });
            }
        }
    }

    renderTouchHints(step);
}

//=========================================================================
// FIND SEGMENT
//=========================================================================

function findSegment(z) {
    return segments[Math.floor(z / segmentLength) % segments.length];
}

//=========================================================================
// RESET
//=========================================================================

function reset(options) {
    options       = options || {};
    canvas.width  = width        = Util.toInt(options.width,         width);
    canvas.height = height       = Util.toInt(options.height,        height);
    lanes         = Util.toInt(options.lanes,         lanes);
    roadWidth     = Util.toInt(options.roadWidth,     roadWidth);
    cameraHeight  = Util.toInt(options.cameraHeight,  cameraHeight);
    drawDistance  = Util.toInt(options.drawDistance,  drawDistance);
    fogDensity    = Util.toInt(options.fogDensity,    fogDensity);
    fieldOfView   = Util.toInt(options.fieldOfView,   fieldOfView);
    segmentLength = Util.toInt(options.segmentLength, segmentLength);
    rumbleLength  = Util.toInt(options.rumbleLength,  rumbleLength);
    cameraDepth   = 1 / Math.tan((fieldOfView / 2) * Math.PI / 180);
    playerZ       = (cameraHeight * cameraDepth);
    resolution    = height / 480;
    maxSpeed      = segmentLength / step * mobileSpeedFactor;
    cruiseSpeed   = maxSpeed / 2;
    accel         = maxSpeed / 5;
    breaking      = -maxSpeed;
    decel         = -maxSpeed / 5;
    cruiseAccel   = maxSpeed / 8;
    offRoadDecel  = -maxSpeed / 2;
    offRoadLimit  = maxSpeed / 4;
    speed         = cruiseSpeed;
    playerX       = 0;
    refreshTweakUI();

    if ((segments.length === 0) || (options.segmentLength) || (options.rumbleLength))
        resetRoad(); // only rebuild road when necessary
}

window.addEventListener('resize', function () {
    reset({ width: window.innerWidth, height: window.innerHeight });
});

//=========================================================================
// THE GAME LOOP
//=========================================================================

Game.run({
    canvas: canvas, render: render, update: update, stats: stats, step: step,
    keys: [
        { keys: [KEY.LEFT,  KEY.A], mode: 'down', action: function () { if (!menuActive) keyLeft   = true;  } },
        { keys: [KEY.RIGHT, KEY.D], mode: 'down', action: function () { if (!menuActive) keyRight  = true;  } },
        { keys: [KEY.UP,    KEY.W], mode: 'down', action: function () { if (!menuActive) keyFaster = true;  } },
        { keys: [KEY.DOWN,  KEY.S], mode: 'down', action: function () { if (!menuActive) keySlower = true;  } },
        { keys: [KEY.LEFT,  KEY.A], mode: 'up',   action: function () { keyLeft   = false; } },
        { keys: [KEY.RIGHT, KEY.D], mode: 'up',   action: function () { keyRight  = false; } },
        { keys: [KEY.UP,    KEY.W], mode: 'up',   action: function () { keyFaster = false; } },
        { keys: [KEY.DOWN,  KEY.S], mode: 'up',   action: function () { keySlower = false; } }
    ],
    ready: function () {
        reset();
        Dom.storage.fast_lap_time = Dom.storage.fast_lap_time || 180;
        updateHud('fast_lap_time', formatTime(Util.toFloat(Dom.storage.fast_lap_time)));
        initMenu();
        var loadingEl = document.getElementById('loading');
        if (loadingEl) {
            var minDisplay = 800;
            var elapsed    = Date.now() - (window._loadStart || Date.now());
            var remaining  = Math.max(0, minDisplay - elapsed);
            setTimeout(function() {
                loadingEl.classList.add('hide');
                setTimeout(function() { loadingEl.style.display = 'none'; }, 520);
            }, remaining);
        }
    }
});
