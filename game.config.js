// =========================================================================
// GAME CONFIGURATION & PHYSICS TUNABLES
// =========================================================================

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

var fps = 60;                        // how many 'update' frames per second
var step = 1 / fps;                  // how long is each frame (in seconds)
var mobileSpeedFactor = ('ontouchstart' in window) ? 0.75 : 1.0; // mobile screens feel faster, compensate
var width = window.innerWidth;       // logical canvas width
var height = window.innerHeight;     // logical canvas height
var centrifugal = 0.15;              // centrifugal force multiplier when going around curves
var offRoadDecel = 0.99;             // speed multiplier when off road (e.g. you lose 2% speed each update frame)
var skySpeed  = 0.001;               // background sky layer scroll speed when going around curve (or up hill)
var hillSpeed = 0.002;               // background hill layer scroll speed when going around curve (or up hill)
var treeSpeed = 0.003;               // background tree layer scroll speed when going around curve (or up hill)
var skyOffset  = 0;                  // current sky scroll offset
var hillOffset = 0;                  // current hill scroll offset
var treeOffset = 0;                  // current tree scroll offset
var segments = [];                   // array of road segments
var cars = [];                       // array of cars on the road
var stats  = Game.stats('fps');      // mr.doobs FPS counter
var canvas = Dom.get('canvas');      // our canvas...
var ctx    = canvas.getContext('2d');// ...and its drawing context

var resolution = null;               // scaling factor to provide resolution independence (computed)

var segmentLength = 200;             // length of a single segment
var rumbleLength  = 3;               // number of segments per red/white rumble strip
var trackLength   = null;            // z length of entire track (computed)

var cameraDepth = null;              // z distance camera is from screen (computed)

var playerX = 0;                     // player x offset from center of road (-1 to 1 to stay independent of roadWidth)
var playerZ = null;                  // player relative z distance from camera (computed)

var position = 0;                    // current camera Z position (add playerZ to get player's absolute Z position)
var speed    = 0;                    // current speed (will be set to cruiseSpeed after reset)
var maxSpeed     = segmentLength / step * mobileSpeedFactor; // top speed (ensure we can't move more than 1 segment in a single frame to make collision detection easier)
var cruiseSpeed  = maxSpeed / 2;     // cruise control speed - matches average traffic speed
var accel        = maxSpeed / 5;     // acceleration rate when pressing UP
var breaking     = -maxSpeed;        // deceleration rate when braking (DOWN key)
var decel        = -maxSpeed / 5;    // 'natural' deceleration rate when neither accelerating, nor braking
var cruiseAccel  = maxSpeed / 8;     // gentle rate at which speed drifts back to cruiseSpeed
var accLookahead = 10;               // segments ahead to scan for ACC (adaptive cruise)
var lkaRate      = 1.2;              // how gently LKA pulls back to lane centre (lower = softer)
var offRoadDecel = -maxSpeed / 2;    // off road deceleration is somewhere in between
var offRoadLimit = maxSpeed / 4;     // limit when off road deceleration no longer applies (e.g. you can always go at least this speed even when off road)
var totalCars    = 50;               // total number of non-semi cars on the road

// ── Lap / job-reveal pacing ───────────────────────────────────────────────────
var LAP_DURATION    = 60;            // target seconds per lap (used to pace job reveals)
var JOBS_PER_LAP    = 6;            // job-truck listings shown per lap
var currentLap      = 0;             // lap counter (0 = first lap)
var currentMapIndex = 0;             // which MAP entry is active (0 = first map)
var lapJobOffset    = 0;             // index into SEMI_LISTINGS for the current lap's batch
var seenListings    = new Set();     // ids of listings whose popup was opened (for purple dot)
var passedListings  = new Set();     // ids of listings whose truck was overtaken without opening
var clickedListings = new Set();     // ids of listings whose Apply Now was clicked
var currentLapBatch = [];            // the exact listing objects spawned in the current race
var currentLapTime  = 0;             // current lap time
var lastLapTime     = null;          // last lap time
var lapActive       = false;         // true while a race lap is running (false = results screen / before start)

// ── SEMI truck tracking ───────────────────────────────────────────────────────
var visibleSemis  = [];              // screen rects of visible SEMI trucks this frame
var playerCarRect = null;            // screen rect of player car (updated each render frame)
var followedSemi  = null;            // the SEMI car currently being tailed by ACC
var followTimer   = 0;               // seconds spent tailing followedSemi
var FOLLOW_DELAY  = 2.0;             // seconds before popup auto-opens
var dismissedSemi = null;            // truck whose banner the user last closed — won't re-show until player leaves and re-enters its zone

// ── Fuel drops (credits) ─────────────────────────────────────────────────────
var fuelDrops = 0;                   // earned by seeing jobs (+1 each), spent by applying (-1 each)

// ── Input state ───────────────────────────────────────────────────────────────
var keyLeft    = false;
var keyRight   = false;
var keyFaster  = false;
var keySlower  = false;
var menuActive = true;               // controls blocked until player hits Start

// ── HUD object (populated after DOM is ready) ─────────────────────────────────
var hud = {
    speed:            { value: null, dom: Dom.get('speed_value') },
    current_lap_time: { value: null, dom: Dom.get('current_lap_time_value') },
    last_lap_time:    { value: null, dom: Dom.get('last_lap_time_value') },
    fast_lap_time:    { value: null, dom: Dom.get('fast_lap_time_value') }
};
