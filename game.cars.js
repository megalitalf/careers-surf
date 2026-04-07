// =========================================================================
// CARS — traffic spawning, movement, AI offset
// =========================================================================

function resetCars() {
    cars = [];
    // Clear per-segment car lists so stale cars don't linger on the road
    for (var s = 0; s < segments.length; s++)
        segments[s].cars = [];

    var car, segment, offset, z, sprite, speed;

    // Build the current lap's listings batch
    var lapListings = [];
    if (SEMI_LISTINGS.length) {
        for (var li = 0; li < JOBS_PER_LAP; li++) {
            lapListings.push(SEMI_LISTINGS[(lapJobOffset + li) % SEMI_LISTINGS.length]);
        }
    }
    currentLapBatch = lapListings.slice(); // snapshot for results screen

    // Spawn exactly one SEMI per listing, spread evenly across the track
    var numSemis = lapListings.length;
    for (var si = 0; si < numSemis; si++) {
        // Space semis evenly, with a small random jitter so they're not perfectly aligned
        var zFraction = (si / numSemis) + (Math.random() * 0.04);
        z      = Math.floor(zFraction * segments.length) * segmentLength;
        offset = Math.random() * Util.randomChoice([-0.8, 0.8]);
        sprite = Util.randomChoice(SPRITES.SEMIS);
        speed  = maxSpeed / 4 + Math.random() * maxSpeed / 4;
        car    = { offset: offset, z: z, sprite: sprite, speed: speed, listing: lapListings[si] };
        segment = findSegment(car.z);
        segment.cars.push(car);
        cars.push(car);
    }

    // Spawn regular traffic (no listings)
    var regularSprites = [SPRITES.CAR01, SPRITES.CAR02, SPRITES.CAR03, SPRITES.CAR04, SPRITES.CAR05, SPRITES.TRUCK];
    for (var n = 0; n < totalCars; n++) {
        offset  = Math.random() * Util.randomChoice([-0.8, 0.8]);
        z       = Math.floor(Math.random() * segments.length) * segmentLength;
        sprite  = Util.randomChoice(regularSprites);
        speed   = maxSpeed / 4 + Math.random() * maxSpeed / 2;
        car     = { offset: offset, z: z, sprite: sprite, speed: speed, listing: null };
        segment = findSegment(car.z);
        segment.cars.push(car);
        cars.push(car);
    }

    lapActive = (lapListings.length > 0); // only activate timing when there are actual job trucks
}

// ─────────────────────────────────────────────────────────────────────────────

function updateCars(dt, playerSegment, playerW) {
    var n, car, oldSegment, newSegment;
    for (n = 0; n < cars.length; n++) {
        car = cars[n];
        oldSegment  = findSegment(car.z);
        car.offset  = car.offset + updateCarOffset(car, oldSegment, playerSegment, playerW);
        car.z       = Util.increase(car.z, dt * car.speed, trackLength);
        car.percent = Util.percentRemaining(car.z, segmentLength); // useful for interpolation during rendering phase
        newSegment  = findSegment(car.z);
        if (oldSegment !== newSegment) {
            var index = oldSegment.cars.indexOf(car);
            oldSegment.cars.splice(index, 1);
            newSegment.cars.push(car);
        }
    }
}

function updateCarOffset(car, carSegment, playerSegment, playerW) {
    var i, j, dir, segment, otherCar, otherCarW;
    var lookahead = 20;
    var carW = car.sprite.w * SPRITES.SCALE;

    // optimisation: don't bother steering around other cars when 'out of sight' of the player
    if ((carSegment.index - playerSegment.index) > drawDistance)
        return 0;

    for (i = 1; i < lookahead; i++) {
        segment = segments[(carSegment.index + i) % segments.length];

        if ((segment === playerSegment) && (car.speed > speed) && (Util.overlap(playerX, playerW, car.offset, carW, 1.2))) {
            if (playerX > 0.5)       dir = -1;
            else if (playerX < -0.5) dir =  1;
            else                     dir = (car.offset > playerX) ? 1 : -1;
            return dir * 1 / i * (car.speed - speed) / maxSpeed;
        }

        for (j = 0; j < segment.cars.length; j++) {
            otherCar  = segment.cars[j];
            otherCarW = otherCar.sprite.w * SPRITES.SCALE;
            if ((car.speed > otherCar.speed) && Util.overlap(car.offset, carW, otherCar.offset, otherCarW, 1.2)) {
                if (otherCar.offset > 0.5)       dir = -1;
                else if (otherCar.offset < -0.5) dir =  1;
                else                             dir = (car.offset > otherCar.offset) ? 1 : -1;
                return dir * 1 / i * (car.speed - otherCar.speed) / maxSpeed;
            }
        }
    }

    // if no cars ahead but somehow off road, steer back on
    if      (car.offset < -0.9) return  0.1;
    else if (car.offset >  0.9) return -0.1;
    else                        return  0;
}
