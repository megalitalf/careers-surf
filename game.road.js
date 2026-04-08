// =========================================================================
// ROAD GEOMETRY — segment building, sprites, track layout
// =========================================================================

var ROAD = {
    LENGTH: { NONE: 0, SHORT: 25, MEDIUM: 50, LONG: 100 },
    HILL:   { NONE: 0, LOW: 20, MEDIUM: 40, HIGH: 60 },
    CURVE:  { NONE: 0, EASY: 2, MEDIUM: 4, HARD: 6 }
};

// ── Segment helpers ───────────────────────────────────────────────────────────

function lastY() {
    return (segments.length === 0) ? 0 : segments[segments.length - 1].p2.world.y;
}

function addSegment(curve, y) {
    var n = segments.length;
    segments.push({
        index: n,
        p1: { world: { y: lastY(), z: n * segmentLength },       camera: {}, screen: {} },
        p2: { world: { y: y,       z: (n + 1) * segmentLength }, camera: {}, screen: {} },
        curve:   curve,
        sprites: [],
        cars:    [],
        color: Math.floor(n / rumbleLength) % 2 ? COLORS.DARK : COLORS.LIGHT
    });
}

function addSprite(n, sprite, offset) {
    segments[n].sprites.push({ source: sprite, offset: offset });
}

function addRoad(enter, hold, leave, curve, y) {
    var startY = lastY();
    var endY   = startY + (Util.toInt(y, 0) * segmentLength);
    var n, total = enter + hold + leave;
    for (n = 0; n < enter; n++)
        addSegment(Util.easeIn(0, curve, n / enter), Util.easeInOut(startY, endY, n / total));
    for (n = 0; n < hold; n++)
        addSegment(curve, Util.easeInOut(startY, endY, (enter + n) / total));
    for (n = 0; n < leave; n++)
        addSegment(Util.easeInOut(curve, 0, n / leave), Util.easeInOut(startY, endY, (enter + hold + n) / total));
}

// ── Road shape primitives ─────────────────────────────────────────────────────

function addStraight(num) {
    num = num || ROAD.LENGTH.MEDIUM;
    addRoad(num, num, num, 0, 0);
}

function addHill(num, height) {
    num    = num    || ROAD.LENGTH.MEDIUM;
    height = height || ROAD.HILL.MEDIUM;
    addRoad(num, num, num, 0, height);
}

function addCurve(num, curve, height) {
    num    = num    || ROAD.LENGTH.MEDIUM;
    curve  = curve  || ROAD.CURVE.MEDIUM;
    height = height || ROAD.HILL.NONE;
    addRoad(num, num, num, curve, height);
}

function addLowRollingHills(num, height) {
    num    = num    || ROAD.LENGTH.SHORT;
    height = height || ROAD.HILL.LOW;
    addRoad(num, num, num,  0,               height / 2);
    addRoad(num, num, num,  0,               -height);
    addRoad(num, num, num,  ROAD.CURVE.EASY,  height);
    addRoad(num, num, num,  0,                0);
    addRoad(num, num, num, -ROAD.CURVE.EASY,  height / 2);
    addRoad(num, num, num,  0,                0);
}

function addSCurves() {
    addRoad(ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, -ROAD.CURVE.EASY,    ROAD.HILL.NONE);
    addRoad(ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM,  ROAD.CURVE.MEDIUM,  ROAD.HILL.MEDIUM);
    addRoad(ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM,  ROAD.CURVE.EASY,   -ROAD.HILL.LOW);
    addRoad(ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, -ROAD.CURVE.EASY,    ROAD.HILL.MEDIUM);
    addRoad(ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, -ROAD.CURVE.MEDIUM, -ROAD.HILL.MEDIUM);
}

function addBumps() {
    addRoad(10, 10, 10, 0,  5);
    addRoad(10, 10, 10, 0, -2);
    addRoad(10, 10, 10, 0, -5);
    addRoad(10, 10, 10, 0,  8);
    addRoad(10, 10, 10, 0,  5);
    addRoad(10, 10, 10, 0, -7);
    addRoad(10, 10, 10, 0,  5);
    addRoad(10, 10, 10, 0, -2);
}

function addDownhillToEnd(num) {
    num = num || 200;
    addRoad(num, num, num, -ROAD.CURVE.EASY, -lastY() / segmentLength);
}

// =========================================================================
// MAP SYSTEM
// Each map defines:
//   name     – display label shown in the results screen
//   build()  – calls addStraight / addCurve / addHill etc. to lay out the road
//   sprites()– adds roadside objects (called after build, segments already exist)
//   theme    – optional overrides: { fogDensity, skySpeed, hillSpeed, treeSpeed }
//
// Add as many maps as you like; the lap cycles through them in order.
// =========================================================================

var MAPS = [

    // ── MAP 1 · Downtown Sprint ───────────────────────────────────────────────
    {
        name: 'Downtown Sprint',
        build: function() {
            addStraight(ROAD.LENGTH.SHORT);
            addLowRollingHills();
            addSCurves();
            addCurve(ROAD.LENGTH.MEDIUM, ROAD.CURVE.MEDIUM, ROAD.HILL.LOW);
            addBumps();
            addStraight(ROAD.LENGTH.MEDIUM);
            addDownhillToEnd(ROAD.LENGTH.MEDIUM);
        },
        sprites: function() {
            var n, i;
            // Opening billboard alley
            addSprite(20,  SPRITES.BILLBOARD07, -1);
            addSprite(40,  SPRITES.BILLBOARD06, -1);
            addSprite(60,  SPRITES.BILLBOARD08, -1);
            addSprite(80,  SPRITES.BILLBOARD09, -1);
            addSprite(100, SPRITES.BILLBOARD01, -1);
            addSprite(120, SPRITES.BILLBOARD02, -1);
            addSprite(140, SPRITES.BILLBOARD03, -1);
            addSprite(160, SPRITES.BILLBOARD04, -1);
            addSprite(180, SPRITES.BILLBOARD05, -1);
            // Palm trees near start
            for (n = 10; n < 150; n += 4 + Math.floor(n / 100)) {
                addSprite(n, SPRITES.PALM_TREE, 0.5 + Math.random() * 0.5);
                addSprite(n, SPRITES.PALM_TREE, 1   + Math.random() * 2);
            }
            // Columns mid-track
            for (n = 150; n < 500; n += 5) {
                addSprite(n, SPRITES.COLUMN, 1.1);
                addSprite(n + Util.randomInt(0, 5), SPRITES.TREE1, -1 - (Math.random() * 2));
            }
            // Scattered plants everywhere
            for (n = 100; n < segments.length; n += 3) {
                addSprite(n, Util.randomChoice(SPRITES.PLANTS), Util.randomChoice([1, -1]) * (2 + Math.random() * 5));
            }
            // Billboard clusters
            var side, sprite, offset;
            for (n = 300; n < (segments.length - 50); n += 80) {
                side = Util.randomChoice([1, -1]);
                addSprite(n + Util.randomInt(0, 30), Util.randomChoice(SPRITES.BILLBOARDS), -side);
            }
        },
        theme: { fogDensity: 4 }
    },

    // ── MAP 2 · Mountain Pass ─────────────────────────────────────────────────
    {
        name: 'Mountain Pass',
        build: function() {
            addStraight(ROAD.LENGTH.SHORT);
            addHill(ROAD.LENGTH.MEDIUM, ROAD.HILL.HIGH);
            addSCurves();
            addCurve(ROAD.LENGTH.LONG, -ROAD.CURVE.MEDIUM, ROAD.HILL.NONE);
            addHill(ROAD.LENGTH.LONG, ROAD.HILL.HIGH);
            addCurve(ROAD.LENGTH.MEDIUM, ROAD.CURVE.HARD, ROAD.HILL.MEDIUM);
            addStraight(ROAD.LENGTH.SHORT);
            addDownhillToEnd(ROAD.LENGTH.MEDIUM);
        },
        sprites: function() {
            var n, i;
            // Dense trees on both sides (mountain forest feel)
            for (n = 10; n < segments.length - 20; n += 3) {
                addSprite(n, SPRITES.TREE1, -(1.5 + Math.random() * 2));
                addSprite(n, SPRITES.TREE2,  (1.5 + Math.random() * 2));
            }
            // Occasional billboard
            for (n = 100; n < (segments.length - 50); n += 120) {
                addSprite(n + Util.randomInt(0, 20), Util.randomChoice(SPRITES.BILLBOARDS), Util.randomChoice([-1, 1]));
            }
        },
        theme: { fogDensity: 7 }
    },

    // ── MAP 3 · Coastal Cruise ────────────────────────────────────────────────
    {
        name: 'Coastal Cruise',
        build: function() {
            addStraight(ROAD.LENGTH.SHORT);
            addLowRollingHills();
            addCurve(ROAD.LENGTH.LONG, ROAD.CURVE.EASY, ROAD.HILL.LOW);
            addBumps();
            addSCurves();
            addHill(ROAD.LENGTH.MEDIUM, -ROAD.HILL.MEDIUM);
            addStraight(ROAD.LENGTH.MEDIUM);
            addDownhillToEnd(ROAD.LENGTH.MEDIUM);
        },
        sprites: function() {
            var n, i;
            // Palm trees + open roadside
            for (n = 10; n < segments.length - 20; n += 6) {
                addSprite(n, SPRITES.PALM_TREE,  1.2 + Math.random() * 2);
                addSprite(n, Util.randomChoice(SPRITES.PLANTS), -(1.5 + Math.random() * 3));
            }
            // Billboard stretch
            addSprite(segments.length - 25, SPRITES.BILLBOARD07, -1.2);
            addSprite(segments.length - 25, SPRITES.BILLBOARD06,  1.2);
            for (n = 200; n < (segments.length - 50); n += 100) {
                var side = Util.randomChoice([1, -1]);
                addSprite(n + Util.randomInt(0, 40), Util.randomChoice(SPRITES.BILLBOARDS), -side);
                for (i = 0; i < 10; i++) {
                    addSprite(n + Util.randomInt(0, 40), Util.randomChoice(SPRITES.PLANTS), side * (1.5 + Math.random()));
                }
            }
        },
        theme: { fogDensity: 3 }
    }

];

// ── Full track layout ─────────────────────────────────────────────────────────

function resetRoad() {
    segments = [];

    var map = MAPS[currentMapIndex % MAPS.length];

    // Reset theme to defaults before applying per-map overrides
    fogDensity  = 5;
    skySpeed    = 0.001;
    hillSpeed   = 0.002;
    treeSpeed   = 0.003;

    // Apply optional theme overrides
    if (map.theme) {
        if (map.theme.fogDensity  !== undefined) fogDensity  = map.theme.fogDensity;
        if (map.theme.skySpeed    !== undefined) skySpeed    = map.theme.skySpeed;
        if (map.theme.hillSpeed   !== undefined) hillSpeed   = map.theme.hillSpeed;
        if (map.theme.treeSpeed   !== undefined) treeSpeed   = map.theme.treeSpeed;
    }

    map.build();

    map.sprites();
    resetCars();

    segments[findSegment(playerZ).index + 2].color = COLORS.START;
    segments[findSegment(playerZ).index + 3].color = COLORS.START;
    for (var n = 0; n < rumbleLength; n++)
        segments[segments.length - 1 - n].color = COLORS.FINISH;

    trackLength = segments.length * segmentLength;
}

// ── Legacy alias (kept for any external calls) ────────────────────────────────
function resetSprites() {
    MAPS[currentMapIndex % MAPS.length].sprites();
}
