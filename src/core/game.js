import { zoneMethods } from '../world/zoneManager.js';
import { attachRoadNetworkMethods } from '../world/roadNetwork.js';
import { attachAgentMethods } from '../agents/agentManager.js';
import { attachRenderingMethods } from '../rendering/renderer.js';
import { attachUiMethods } from '../ui/uiManager.js';

class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');

        // Game constants
        this.WORLD_WIDTH = 10000;
        this.WORLD_HEIGHT = 10000;

        // Zone constants
        this.MIN_POINT_DISTANCE = 20;
        this.CONNECTION_RADIUS = 60;
        this.MERGE_DISTANCE_MULTIPLIER = 1.2;
        this.SAMPLING_DISTANCE_MULTIPLIER = 0.15;

        // Agent constants
        this.AGENT_RADIUS = 10;
        this.AGENT_SPEED = 2;
        this.MAX_AGENTS_PER_ZONE = 10;
        this.PACKING_EFFICIENCY = 0.8;
        this.MIN_AGENT_DISTANCE = 100;

        // Performance constants
        this.FRAME_HISTORY_LENGTH = 60;
        this.WARNING_BLINK_RATE = 16;

        // Pathfinding constants
        this.PATHFINDING_STEP_SIZE = 25;
        this.EDGE_THRESHOLD = 30;
        this.MAX_PATHFINDING_ATTEMPTS = 100;

        // Game world size (using constants)
        this.worldWidth = this.WORLD_WIDTH;
        this.worldHeight = this.WORLD_HEIGHT;

        // Zone rendering cache
        this.zoneCache = {
            residential: new Map(), // Map zone index to cached canvas
            road: new Map(),
            needsUpdate: new Set()  // Track which zones need cache update
        };

        // Performance monitoring
        this.performance = {
            frameCount: 0,
            lastFrameTime: performance.now(),
            fps: 0,
            averageFps: 0,
            frameHistory: [],
            maxFrameHistory: this.FRAME_HISTORY_LENGTH,
            memoryUsage: 0
        };

        // Camera properties
        this.camera = {
            x: 0,
            y: 0,
            zoom: 1.0,
            minZoom: 0.1,
            maxZoom: 5.0
        };

        // Mouse/Pan state
        this.mouse = {
            x: 0,
            y: 0,
            isDragging: false,
            dragStartX: 0,
            dragStartY: 0,
            lastX: 0,
            lastY: 0
        };

        // Agents (dynamic yellow dots)
        this.agents = [];

        // Buildings
        this.buildings = [];

        // Residential zones
        this.residentialZones = [];

        // Road zones
        this.roadZones = [];

        // Zone connection status
        this.zoneConnections = new Map(); // Maps zone index to connection status
        this.needsConnectionUpdate = false;
        this.warningBlinkTime = 0;

        // Agent spawning with delay
        this.agentSpawnQueue = []; // Queue of agents to spawn with delay
        this.lastSpawnTime = 0;
        this.spawnDelay = 1000; // 1 second delay between spawns

        // Road network system
        this.roadNetwork = {
            points: [],           // All waypoints in the network
            connections: [],      // Adjacency list of connections
            edgePoints: [],       // Points that connect to map edges
            zoneEntries: new Map(), // Map from zone index to entry point IDs
            needsRebuild: true    // Flag to rebuild network
        };
        this.showWaypoints = false; // Toggle for waypoint visualization

        // Build mode
        this.buildMode = {
            active: false,
            selectedType: null,
            brushSize: 50,
            previewZone: null,
            isPainting: false,
            lastPaintX: null,
            lastPaintY: null,
            eraser: false,
            isErasingDrag: false,
            minBrushSize: 10,
            maxBrushSize: 300,
            // Smooth brush system
            strokeHistory: [], // Buffer for last brush positions
            maxHistoryLength: 4, // Keep last 4 positions for smooth curves
            lastPaintTime: 0,
            smoothingEnabled: true
        };

        this.init();
    }


    init() {
        this.resizeCanvas();
        this.createMeadowTexture();
        this.setupEventListeners();
        this.setupBuildMenu();
        this.gameLoop();

        // Start camera at top-left of the map
        this.camera.x = 0;
        this.camera.y = 0;
    }

    createMeadowTexture() {
        const tileSize = 192;
        this.grassCanvas = document.createElement('canvas');
        this.grassCanvas.width = tileSize;
        this.grassCanvas.height = tileSize;
        const g = this.grassCanvas.getContext('2d');

        // Simple vertical gradient as base
        const grad = g.createLinearGradient(0, 0, 0, tileSize);
        grad.addColorStop(0, '#3d7a38');
        grad.addColorStop(1, '#2f5d2b');
        g.fillStyle = grad;
        g.fillRect(0, 0, tileSize, tileSize);

        // A few soft elliptical patches for subtle variation (vector style)
        const patches = [
            { color: 'rgba(120, 190, 100, 0.15)', rx: 42, ry: 28, x: 40, y: 48, rot: 0.2 },
            { color: 'rgba(90, 160, 85, 0.14)', rx: 36, ry: 22, x: 120, y: 60, rot: -0.3 },
            { color: 'rgba(70, 120, 70, 0.12)', rx: 58, ry: 34, x: 80, y: 120, rot: 0.6 },
            { color: 'rgba(150, 210, 110, 0.10)', rx: 24, ry: 18, x: 150, y: 150, rot: -0.1 },
            { color: 'rgba(60, 100, 60, 0.10)', rx: 30, ry: 16, x: 24, y: 140, rot: 0.9 }
        ];
        patches.forEach(p => {
            g.save();
            g.translate(p.x, p.y);
            g.rotate(p.rot);
            g.fillStyle = p.color;
            g.beginPath();
            g.ellipse(0, 0, p.rx, p.ry, 0, 0, Math.PI * 2);
            g.fill();
            g.restore();
        });

        // A few gentle, thin curved strokes to suggest grass direction
        g.strokeStyle = 'rgba(120, 180, 100, 0.25)';
        g.lineWidth = 2;
        const strokes = [
            { ax: 10, ay: 30, bx: 60, by: 20, cx: 110, cy: 40 },
            { ax: 20, ay: 100, bx: 80, by: 90, cx: 160, cy: 110 },
            { ax: 0, ay: 160, bx: 70, by: 150, cx: 130, cy: 170 },
        ];
        strokes.forEach(s => {
            g.beginPath();
            g.moveTo(s.ax, s.ay);
            g.quadraticCurveTo(s.bx, s.by, s.cx, s.cy);
            g.stroke();
        });

        this.grassPattern = this.ctx.createPattern(this.grassCanvas, 'repeat');
    }





    // Smooth painting system with Bezier curves

    // Paint smooth stroke using Bezier curves between recent points

    // Calculate velocity between two points

    // Calculate point on quadratic Bezier curve

    // Paint at specific point with custom brush size


    // Zone cache management



    // Road Network Generation System - Following actual road curves

    // Extract centerline waypoints from a road zone following the natural flow

    // Trace a connected road segment starting from a point

    // Create waypoints along a road segment following the natural curve

    // Sort points to create natural flow (simple distance-based for now)

    // Connect nearby waypoints to form a cohesive network with intelligent intersections

    // Identify waypoints that serve as intersections (3+ connections)

    // Add waypoints around complex intersections for smoother navigation

    // Optimize connections around intersections for better flow

    // Check if there's a road path between two points

    // Identify waypoints at map edges

    // Find waypoints that serve as zone entry points

    // Find path using shared network

    // Find path between two specific network nodes

    // Find closest network point to a position

    // Find nearest road segment and calculate its direction

    // Calculate road direction at a specific point by analyzing nearby road points

    // Calculate perpendicular direction to road (for lot depth)

    // Generate adaptive lot polygon for an agent based on road shape and available space

    // Calculate available depth from street going inward

    // Calculate available width along the road

    // Check if position is in any residential zone

    // Check if position is occupied by another agent's lot

    // Fallback circular lot generation

    // Point in polygon test using ray casting algorithm

    // Check if two polygons overlap

    // Connection checking system


















    // Removed previous pixel-heavy procedural grass helpers in favor of a simple vector-derived pattern









    // Generate intelligent space-optimized polygon territory

    // Scan available space around agent position

    // Cast ray to find boundary (other agent, zone edge, etc.)

    // Create optimal polygon from boundary points

    // Smooth polygon points to create more natural shapes

    // Find nearest road direction for polygon orientation

    // Draw a simple house on the agent's lot

















    gameLoop() {
        try {
            // Update performance metrics
            this.updatePerformanceMetrics();

            // Rebuild road network if needed
            if (this.roadNetwork.needsRebuild) {
                this.buildRoadNetwork();
            }

            // Update connections if needed
            if (this.needsConnectionUpdate) {
                this.updateAllConnections();
                this.needsConnectionUpdate = false;
            }

            // Update warning blink animation
            this.warningBlinkTime += this.WARNING_BLINK_RATE;

            // Process agent spawn queue with delay
            this.processAgentSpawnQueue();

            // Update agent movement
            this.updateAgents();

            this.render();
            this.updateUI();
        } catch (error) {
            console.error('Game Loop Fehler:', error);
            // Continue running despite errors
        }

        requestAnimationFrame(() => this.gameLoop());
    }
}

Object.assign(Game.prototype, zoneMethods);
attachRoadNetworkMethods(Game.prototype);
attachAgentMethods(Game.prototype);
attachRenderingMethods(Game.prototype);
attachUiMethods(Game.prototype);

export default Game;
