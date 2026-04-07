// =========================================================================
// INPUT — keyboard, touch controls, touch zone overlay
// =========================================================================

// ── Canvas click: open popup when a SEMI truck is clicked ─────────────────────

canvas.addEventListener('click', function (ev) {
    var rect   = canvas.getBoundingClientRect();
    var scaleX = width  / rect.width;
    var scaleY = height / rect.height;
    var cx = (ev.clientX - rect.left) * scaleX;
    var cy = (ev.clientY - rect.top)  * scaleY;
    for (var i = 0; i < visibleSemis.length; i++) {
        var s = visibleSemis[i];
        if (cx >= s.x && cx <= s.x + s.w && cy >= s.y && cy <= s.y + s.h) {
            dismissedSemi = null; // explicit tap — clear dismiss lock so it can show
            showCarPopup(s.car.listing);
            break;
        }
    }
});

// ── Touch controls ────────────────────────────────────────────────────────────
//
// Screen split into zones per touch point:
//
//   ┌──────────────────────────────┐
//   │   LEFT  │   ACCEL   │ RIGHT  │  (above car zone)
//   ├──────────┼───────────┼───────┤
//   │   LEFT  │   BRAKE   │ RIGHT  │  (on/over car)
//   └──────────┴───────────┴───────┘
//
// • tap left third        → steer left
// • tap right third       → steer right
// • tap middle + above car → accelerate (keyFaster)
// • tap middle + on car    → brake      (keySlower)

// Map from touch identifier → which flags it set
var touchFlags = {};

function getTouchZone(cx, cy) {
    var r = playerCarRect;
    if (r) {
        var inCarH = (cx >= r.left && cx <= r.right);
        if (inCarH && cy >= r.top) return 'brake'; // on the car
        if (inCarH && cy <  r.top) return 'accel'; // above the car
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
    var rect   = canvas.getBoundingClientRect();
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
        var t    = ev.changedTouches[i];
        var pos  = getCanvasCoords(t);
        var zone = getTouchZone(pos.x, pos.y);
        touchFlags[t.identifier] = zone;
        applyTouchZone(zone, true);
    }
}, { passive: false });

canvas.addEventListener('touchmove', function (ev) {
    ev.preventDefault();
    for (var i = 0; i < ev.changedTouches.length; i++) {
        var t       = ev.changedTouches[i];
        var pos     = getCanvasCoords(t);
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
        var t    = changedTouches[i];
        var zone = touchFlags[t.identifier];
        if (zone) {
            applyTouchZone(zone, false);
            delete touchFlags[t.identifier];
        }
    }
}

canvas.addEventListener('touchend',    function (ev) { ev.preventDefault(); releaseTouches(ev.changedTouches); }, { passive: false });
canvas.addEventListener('touchcancel', function (ev) { ev.preventDefault(); releaseTouches(ev.changedTouches); }, { passive: false });

// ── Touch zone overlay (visual hint) ─────────────────────────────────────────
//
// Semi-transparent hints drawn on top of the game canvas.
// They fade out after a short idle period so they don't clutter gameplay.

var touchHintAlpha  = 0;    // 0 = invisible, 1 = fully visible
var touchHintTimer  = 0;    // seconds since last touch
var TOUCH_HINT_SHOW = 3.0;  // seconds to show hint after last touch
var TOUCH_HINT_FADE = 0.8;  // fade-in / fade-out duration

// Called from render() after the main scene is drawn
function renderTouchHints(dt) {
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

    var r  = playerCarRect;
    var a  = touchHintAlpha * 0.22;
    var a2 = a * 2.5; // active zone brightness
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
    ctx.globalAlpha  = touchHintAlpha * 0.6;
    ctx.font         = 'bold ' + fs + 'px Arial';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = '#fff';
    ctx.textAlign    = 'center';

    ctx.fillText('◀', r.left  / 2,           height / 2);
    ctx.fillText('▶', (width + r.right) / 2, height / 2);
    ctx.fillText('▲',  width / 2, r.top / 2);
    ctx.fillText('▼',  width / 2, (r.top + r.bottom) / 2);

    ctx.restore();
}
