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

    eraseZone(x, y, forceErase = false) {
        if (!this.buildMode.active) return;

        if (!forceErase && this.buildMode.lastPaintX !== null && this.buildMode.lastPaintY !== null) {
            const distance = Math.hypot(x - this.buildMode.lastPaintX, y - this.buildMode.lastPaintY);
            const samplingDistance = this.buildMode.brushSize * 0.15; // keep similar sampling as paint
            if (distance < samplingDistance) {
                return;
            }
        }

        // Update last erase position
        this.buildMode.lastPaintX = x;
        this.buildMode.lastPaintY = y;

        const radius = this.buildMode.brushSize;
        for (let i = this.residentialZones.length - 1; i >= 0; i--) {
            const zone = this.residentialZones[i];
            zone.points = zone.points.filter(p => Math.hypot(x - p.x, y - p.y) >= radius);
            if (zone.points.length === 0) {
                this.residentialZones.splice(i, 1);
            }
        }

        // Erase road zones
        for (let i = this.roadZones.length - 1; i >= 0; i--) {
            const zone = this.roadZones[i];
            zone.points = zone.points.filter(p => Math.hypot(x - p.x, y - p.y) >= radius);
            if (zone.points.length === 0) {
                this.roadZones.splice(i, 1);
            }
        }

        // Schedule connection update, network rebuild and cache update
        this.needsConnectionUpdate = true;
        this.roadNetwork.needsRebuild = true;
        this.invalidateZoneCache('residential');
        this.invalidateZoneCache('road');
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

    setupBuildMenu() {
        // Build menu toggle
        const menuHeader = document.getElementById('buildMenuHeader');
        const menuContent = document.getElementById('buildMenuContent');
        const menuToggle = document.getElementById('buildMenuToggle');

        menuHeader.addEventListener('click', () => {
            const isCollapsed = menuContent.classList.contains('collapsed');
            if (isCollapsed) {
                menuContent.classList.remove('collapsed');
                menuToggle.classList.remove('collapsed');
                menuToggle.textContent = '▼';
            } else {
                menuContent.classList.add('collapsed');
                menuToggle.classList.add('collapsed');
                menuToggle.textContent = '▶';
            }
            // Normalize toggle icon
            menuToggle.textContent = menuContent.classList.contains('collapsed') ? '▸' : '▾';
        });

        // Build item selection
        const buildItems = document.querySelectorAll('.build-item');
        buildItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();

                // Remove selection from all items
                buildItems.forEach(i => i.classList.remove('selected'));

                // Select clicked item
                item.classList.add('selected');

                // Activate build mode
                const buildType = item.dataset.type;
                const brushSize = parseInt(item.dataset.size) || 50;
                this.activateBuildMode(buildType, brushSize);
            });
        });
    }

    activateBuildMode(buildType, brushSize) {
        this.buildMode.active = true;
        this.buildMode.selectedType = buildType;
        this.buildMode.brushSize = brushSize;

        // Update UI
        document.getElementById('buildMode').style.display = 'block';
        this.updateBuildModeUI();

        // Change cursor
        this.canvas.style.cursor = 'crosshair';
    }

    deactivateBuildMode() {
        this.buildMode.active = false;
        this.buildMode.selectedType = null;
        this.buildMode.brushSize = 50;
        this.buildMode.previewZone = null;
        this.buildMode.isPainting = false;
        this.buildMode.lastPaintX = null;
        this.buildMode.lastPaintY = null;
        this.buildMode.eraser = false;
        this.buildMode.isErasingDrag = false;
        // Clear stroke history when deactivating build mode
        this.buildMode.strokeHistory = [];

        // Update UI
        document.getElementById('buildMode').style.display = 'none';

        // Remove selection from build items
        document.querySelectorAll('.build-item').forEach(item => {
            item.classList.remove('selected');
        });

        // Reset cursor
        this.canvas.style.cursor = 'grab';
    }

    updateBuildModeUI() {
        const sel = this.buildMode.selectedType || 'None';
        const size = this.buildMode.brushSize;
        const mode = this.buildMode.eraser ? 'Eraser' : 'Brush';
        document.getElementById('selectedBuildItem').textContent = `${sel} (${size}px, ${mode})`;
    }

    // Smooth painting system with Bezier curves
    smoothPaintZone(x, y, forcePaint = false) {
        if (!this.buildMode.active || !this.buildMode.selectedType) return;

        const currentTime = performance.now();

        // Add current position to stroke history
        const newPoint = {
            x: x,
            y: y,
            time: currentTime,
            brushSize: this.buildMode.brushSize
        };

        this.buildMode.strokeHistory.push(newPoint);

        // Keep only the last maxHistoryLength points
        if (this.buildMode.strokeHistory.length > this.buildMode.maxHistoryLength) {
            this.buildMode.strokeHistory.shift();
        }

        // If we have enough points for smooth interpolation
        if (this.buildMode.strokeHistory.length >= 3 && this.buildMode.smoothingEnabled) {
            this.paintSmoothStroke();
        } else {
            // Fallback to direct painting for first few points
            this.paintZone(x, y, forcePaint);
        }

        this.buildMode.lastPaintTime = currentTime;
    }

    // Paint smooth stroke using Bezier curves between recent points
    paintSmoothStroke() {
        const history = this.buildMode.strokeHistory;
        const historyLength = history.length;

        if (historyLength < 3) return;

        // Get the last 3 points for quadratic Bezier curve
        const p0 = history[historyLength - 3];
        const p1 = history[historyLength - 2];
        const p2 = history[historyLength - 1];

        // Calculate velocity for adaptive sampling
        const velocity = this.calculateVelocity(p1, p2);
        const adaptiveSampling = Math.max(0.1, Math.min(1.0, velocity / 100)); // Normalize velocity

        // Dynamic step count based on distance and velocity
        const distance = Math.hypot(p2.x - p0.x, p2.y - p0.y);
        const baseSteps = Math.ceil(distance / (this.buildMode.brushSize * 0.3));
        const steps = Math.max(3, Math.floor(baseSteps * adaptiveSampling));

        // Paint along the Bezier curve
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const curvePoint = this.calculateQuadraticBezier(p0, p1, p2, t);

            // Vary brush size slightly based on velocity for more organic feel
            const velocityVariation = 1.0 + (Math.sin(velocity * 0.01 + t * Math.PI * 2) * 0.1);
            const variableBrushSize = this.buildMode.brushSize * velocityVariation;

            // Paint at this curve point with variable size
            this.paintZoneAtPoint(curvePoint.x, curvePoint.y, variableBrushSize);
        }
    }

    // Calculate velocity between two points
    calculateVelocity(p1, p2) {
        const distance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const timeDelta = Math.max(1, p2.time - p1.time); // Avoid division by zero
        return distance / timeDelta * 1000; // pixels per second
    }

    // Calculate point on quadratic Bezier curve
    calculateQuadraticBezier(p0, p1, p2, t) {
        const oneMinusT = 1 - t;
        return {
            x: oneMinusT * oneMinusT * p0.x + 2 * oneMinusT * t * p1.x + t * t * p2.x,
            y: oneMinusT * oneMinusT * p0.y + 2 * oneMinusT * t * p1.y + t * t * p2.y
        };
    }

    // Paint at specific point with custom brush size
    paintZoneAtPoint(x, y, customBrushSize = null) {
        const originalBrushSize = this.buildMode.brushSize;
        if (customBrushSize) {
            this.buildMode.brushSize = customBrushSize;
        }

        this.paintZone(x, y, true);

        // Restore original brush size
        this.buildMode.brushSize = originalBrushSize;
    }

    paintZone(x, y, forcePaint = false) {
        if (!this.buildMode.active || !this.buildMode.selectedType) return;

        // Skip if too close to last painted position (dabbing technique)
        if (!forcePaint && this.buildMode.lastPaintX !== null && this.buildMode.lastPaintY !== null) {
            const distance = Math.sqrt((x - this.buildMode.lastPaintX) ** 2 + (y - this.buildMode.lastPaintY) ** 2);
            const samplingDistance = this.buildMode.brushSize * 0.15; // 15% of brush size for dense filling
            if (distance < samplingDistance) {
                return;
            }
        }

        // Update last paint position
        this.buildMode.lastPaintX = x;
        this.buildMode.lastPaintY = y;

        // Create/extend residential zone area (city game style)
        if (this.buildMode.selectedType.startsWith('residential')) {
            const newZonePoint = {
                x: x,
                y: y,
                radius: this.buildMode.brushSize
            };

            // Find all nearby zones to merge with
            const mergeDistance = this.buildMode.brushSize * 1.2;
            const matchedIndices = [];
            for (let i = 0; i < this.residentialZones.length; i++) {
                const zone = this.residentialZones[i];
                for (let j = 0; j < zone.points.length; j++) {
                    const point = zone.points[j];
                    const distance = Math.hypot(x - point.x, y - point.y);
                    if (distance < mergeDistance) {
                        matchedIndices.push(i);
                        break;
                    }
                }
            }

            if (matchedIndices.length === 0) {
                const newZone = {
                    type: 'residential',
                    points: [newZonePoint],
                    color: 'rgba(76, 175, 80, 0.6)',
                    borderColor: 'rgba(60, 140, 60, 1.0)'
                };
                this.residentialZones.push(newZone);
            } else {
                // Merge into the first matched zone and consolidate others
                const primaryIndex = matchedIndices[0];
                const primary = this.residentialZones[primaryIndex];
                primary.points.push(newZonePoint);

                const toRemove = [...new Set(matchedIndices.slice(1))].sort((a, b) => b - a);
                toRemove.forEach(idx => {
                    const z = this.residentialZones[idx];
                    primary.points.push(...z.points);
                    this.residentialZones.splice(idx, 1);
                });
            }

            // Schedule connection update, network rebuild and cache update
            this.needsConnectionUpdate = true;
            this.roadNetwork.needsRebuild = true;
            this.invalidateZoneCache('residential');
        }

        // Create/extend road zone area
        if (this.buildMode.selectedType === 'road') {
            const newZonePoint = {
                x: x,
                y: y,
                radius: this.buildMode.brushSize
            };

            // Remove residential zones that overlap with the new road zone
            const overlapRadius = this.buildMode.brushSize;
            for (let i = this.residentialZones.length - 1; i >= 0; i--) {
                const zone = this.residentialZones[i];
                zone.points = zone.points.filter(p => {
                    const distance = Math.hypot(x - p.x, y - p.y);
                    return distance >= overlapRadius;
                });
                if (zone.points.length === 0) {
                    this.residentialZones.splice(i, 1);
                }
            }

            // Find all nearby road zones to merge with
            const mergeDistance = this.buildMode.brushSize * 1.2;
            const matchedIndices = [];
            for (let i = 0; i < this.roadZones.length; i++) {
                const zone = this.roadZones[i];
                for (let j = 0; j < zone.points.length; j++) {
                    const point = zone.points[j];
                    const distance = Math.hypot(x - point.x, y - point.y);
                    if (distance < mergeDistance) {
                        matchedIndices.push(i);
                        break;
                    }
                }
            }

            if (matchedIndices.length === 0) {
                const newZone = {
                    type: 'road',
                    points: [newZonePoint],
                    color: 'rgba(80, 80, 80, 0.9)',
                    borderColor: 'rgba(40, 40, 40, 1.0)'
                };
                this.roadZones.push(newZone);
            } else {
                // Merge into the first matched zone and consolidate others
                const primaryIndex = matchedIndices[0];
                const primary = this.roadZones[primaryIndex];
                primary.points.push(newZonePoint);

                const toRemove = [...new Set(matchedIndices.slice(1))].sort((a, b) => b - a);
                toRemove.forEach(idx => {
                    const z = this.roadZones[idx];
                    primary.points.push(...z.points);
                    this.roadZones.splice(idx, 1);
                });
            }

            // Schedule connection update, network rebuild and cache update
            this.needsConnectionUpdate = true;
            this.roadNetwork.needsRebuild = true;
            this.invalidateZoneCache('road');
            this.invalidateZoneCache('residential');
        }
    }

    // Zone cache management
    invalidateZoneCache(zoneType) {
        if (zoneType === 'residential' || zoneType === 'all') {
            this.zoneCache.residential.clear();
        }
        if (zoneType === 'road' || zoneType === 'all') {
            this.zoneCache.road.clear();
        }
    }

    getCachedZone(zoneType, zoneIndex, zone) {
        const cache = this.zoneCache[zoneType];
        if (!cache) return null;

        // Check if we have a cached version
        const cached = cache.get(zoneIndex);
        if (cached && cached.lastUpdate >= zone.lastModified) {
            return cached.canvas;
        }

        // Create new cached version
        const canvas = this.createZoneCanvas(zone);
        cache.set(zoneIndex, {
            canvas: canvas,
            lastUpdate: Date.now()
        });

        return canvas;
    }

    createZoneCanvas(zone) {
        if (!zone.points || zone.points.length === 0) return null;

        // Calculate bounding box
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        zone.points.forEach(p => {
            minX = Math.min(minX, p.x - p.radius);
            minY = Math.min(minY, p.y - p.radius);
            maxX = Math.max(maxX, p.x + p.radius);
            maxY = Math.max(maxY, p.y + p.radius);
        });

        const width = Math.ceil(maxX - minX);
        const height = Math.ceil(maxY - minY);

        if (width <= 0 || height <= 0) return null;

        // Create offscreen canvas
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        // Draw zone on offscreen canvas
        ctx.save();
        ctx.translate(-minX, -minY);
        ctx.fillStyle = zone.color;
        ctx.beginPath();
        zone.points.forEach(p => {
            ctx.moveTo(p.x + p.radius, p.y);
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        });
        ctx.fill();
        ctx.restore();

        return { canvas, offsetX: minX, offsetY: minY };
    }

    // Road Network Generation System - Following actual road curves
    buildRoadNetwork() {
        try {
            console.log('🛣️  Erstelle organisches Straßennetzwerk...');

            // Clear existing network
            this.roadNetwork.points = [];
            this.roadNetwork.connections = [];
            this.roadNetwork.edgePoints = [];
            this.roadNetwork.zoneEntries.clear();

        const pointMap = new Map(); // Maps "x,y" -> pointId for deduplication
        let pointIdCounter = 0;
        const minPointDistance = this.MIN_POINT_DISTANCE;

        // Helper function to add a waypoint
        const addWaypoint = (x, y, metadata = {}) => {
            // Round to avoid floating point issues
            x = Math.round(x);
            y = Math.round(y);

            // Check if point already exists nearby
            for (let existingPoint of this.roadNetwork.points) {
                if (Math.hypot(x - existingPoint.x, y - existingPoint.y) < minPointDistance) {
                    return existingPoint.id; // Return existing point
                }
            }

            const pointId = pointIdCounter++;
            const point = {
                id: pointId,
                x: x,
                y: y,
                ...metadata
            };

            this.roadNetwork.points.push(point);
            this.roadNetwork.connections.push([]);
            return pointId;
        };

        // Process each road zone to extract centerlines
        for (let zoneIndex = 0; zoneIndex < this.roadZones.length; zoneIndex++) {
            const zone = this.roadZones[zoneIndex];
            this.extractRoadCenterline(zone, addWaypoint);
        }

        // Connect nearby waypoints to form the network
        this.connectNearbyWaypoints();

        // Identify edge points (connection to map boundaries)
        this.identifyEdgePoints();

        // Find zone entry points
        this.findZoneEntryPoints();

            console.log(`✅ Straßennetzwerk erstellt: ${this.roadNetwork.points.length} Wegpunkte, ${this.roadNetwork.edgePoints.length} Kanten-Verbindungen`);
            this.roadNetwork.needsRebuild = false;
        } catch (error) {
            console.error('Straßennetzwerk-Erstellung Fehler:', error);
            this.roadNetwork.needsRebuild = false; // Prevent infinite retry
        }
    }

    // Extract centerline waypoints from a road zone following the natural flow
    extractRoadCenterline(zone, addWaypoint) {
        if (zone.points.length === 0) return;

        // Create a more intelligent road flow by connecting nearby road points
        const processedPoints = new Set();
        const roadSegments = [];

        // Group connected road points into segments
        for (let i = 0; i < zone.points.length; i++) {
            if (processedPoints.has(i)) continue;

            const segment = this.traceRoadSegment(zone.points, i, processedPoints);
            if (segment.length > 0) {
                roadSegments.push(segment);
            }
        }

        // Create waypoints for each segment
        for (let segment of roadSegments) {
            this.createWaypointsForSegment(segment, addWaypoint);
        }
    }

    // Trace a connected road segment starting from a point
    traceRoadSegment(roadPoints, startIndex, processedPoints) {
        const segment = [];
        const queue = [startIndex];
        const connectionRadius = this.CONNECTION_RADIUS;

        while (queue.length > 0) {
            const currentIndex = queue.shift();
            if (processedPoints.has(currentIndex)) continue;

            processedPoints.add(currentIndex);
            segment.push(roadPoints[currentIndex]);

            // Find nearby unprocessed points
            for (let i = 0; i < roadPoints.length; i++) {
                if (processedPoints.has(i)) continue;

                const distance = Math.hypot(
                    roadPoints[currentIndex].x - roadPoints[i].x,
                    roadPoints[currentIndex].y - roadPoints[i].y
                );

                if (distance <= connectionRadius) {
                    queue.push(i);
                }
            }
        }

        return segment;
    }

    // Create waypoints along a road segment following the natural curve
    createWaypointsForSegment(segment, addWaypoint) {
        if (segment.length === 0) return;

        // Sort segment points to create a natural flow
        const sortedSegment = this.sortPointsForFlow(segment);

        // Create waypoints with adaptive density
        for (let i = 0; i < sortedSegment.length; i++) {
            const point = sortedSegment[i];

            // Always create waypoint at the road point center
            const waypointId = addWaypoint(point.x, point.y, {
                roadRadius: point.radius,
                segmentIndex: i,
                isRoadCenter: true
            });

            // For larger road segments, create intermediate waypoints
            if (i < sortedSegment.length - 1) {
                const nextPoint = sortedSegment[i + 1];
                const distance = Math.hypot(nextPoint.x - point.x, nextPoint.y - point.y);

                // Add intermediate waypoints for longer stretches
                if (distance > 50) {
                    const steps = Math.ceil(distance / 30);
                    for (let step = 1; step < steps; step++) {
                        const t = step / steps;
                        const interpX = point.x + (nextPoint.x - point.x) * t;
                        const interpY = point.y + (nextPoint.y - point.y) * t;

                        // Only add if it's actually on road
                        if (this.isOnRoad(interpX, interpY)) {
                            addWaypoint(interpX, interpY, {
                                roadRadius: Math.min(point.radius, nextPoint.radius),
                                segmentIndex: i + t,
                                isIntermediate: true
                            });
                        }
                    }
                }
            }
        }
    }

    // Sort points to create natural flow (simple distance-based for now)
    sortPointsForFlow(points) {
        if (points.length <= 1) return points;

        const sorted = [points[0]];
        const remaining = points.slice(1);

        while (remaining.length > 0) {
            const lastPoint = sorted[sorted.length - 1];
            let closestIndex = 0;
            let closestDistance = Infinity;

            // Find closest remaining point
            for (let i = 0; i < remaining.length; i++) {
                const distance = Math.hypot(
                    lastPoint.x - remaining[i].x,
                    lastPoint.y - remaining[i].y
                );
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestIndex = i;
                }
            }

            sorted.push(remaining[closestIndex]);
            remaining.splice(closestIndex, 1);
        }

        return sorted;
    }

    // Connect nearby waypoints to form a cohesive network with intelligent intersections
    connectNearbyWaypoints() {
        const maxConnectionDistance = this.CONNECTION_RADIUS;
        const intersectionPoints = new Set(); // Track intersection waypoints

        for (let i = 0; i < this.roadNetwork.points.length; i++) {
            const pointA = this.roadNetwork.points[i];

            for (let j = i + 1; j < this.roadNetwork.points.length; j++) {
                const pointB = this.roadNetwork.points[j];
                const distance = Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y);

                if (distance <= maxConnectionDistance) {
                    // Check if there's a clear road path between these points
                    if (this.hasRoadPathBetween(pointA, pointB)) {
                        if (!this.roadNetwork.connections[i].includes(j)) {
                            this.roadNetwork.connections[i].push(j);
                            this.roadNetwork.connections[j].push(i);
                        }
                    }
                }
            }
        }

        // Identify and enhance intersection points
        this.identifyIntersections();

        // Create smoother connections for complex intersections
        this.optimizeIntersectionConnections();
    }

    // Identify waypoints that serve as intersections (3+ connections)
    identifyIntersections() {
        for (let i = 0; i < this.roadNetwork.points.length; i++) {
            const connections = this.roadNetwork.connections[i];

            if (connections.length >= 3) {
                // Mark as intersection point
                this.roadNetwork.points[i].isIntersection = true;

                // Check if we need additional waypoints around the intersection
                this.enhanceIntersection(i);
            }
        }
    }

    // Add waypoints around complex intersections for smoother navigation
    enhanceIntersection(intersectionIndex) {
        const intersection = this.roadNetwork.points[intersectionIndex];
        const connections = this.roadNetwork.connections[intersectionIndex];

        // For intersections with many connections, add approach points
        if (connections.length >= 4) {
            const approachDistance = 25; // Distance to place approach points

            for (let connectionId of connections) {
                const connectedPoint = this.roadNetwork.points[connectionId];

                // Calculate approach point position
                const dx = intersection.x - connectedPoint.x;
                const dy = intersection.y - connectedPoint.y;
                const distance = Math.hypot(dx, dy);

                if (distance > approachDistance * 2) {
                    const normalizedDx = dx / distance;
                    const normalizedDy = dy / distance;

                    const approachX = intersection.x - normalizedDx * approachDistance;
                    const approachY = intersection.y - normalizedDy * approachDistance;

                    // Only add if on road and not too close to existing points
                    if (this.isOnRoad(approachX, approachY)) {
                        let tooClose = false;
                        for (let existingPoint of this.roadNetwork.points) {
                            if (Math.hypot(approachX - existingPoint.x, approachY - existingPoint.y) < 15) {
                                tooClose = true;
                                break;
                            }
                        }

                        if (!tooClose) {
                            const approachId = this.roadNetwork.points.length;
                            this.roadNetwork.points.push({
                                id: approachId,
                                x: Math.round(approachX),
                                y: Math.round(approachY),
                                isApproach: true,
                                parentIntersection: intersectionIndex
                            });
                            this.roadNetwork.connections.push([intersectionIndex, connectionId]);

                            // Update connections
                            this.roadNetwork.connections[intersectionIndex].push(approachId);
                            this.roadNetwork.connections[connectionId].push(approachId);
                        }
                    }
                }
            }
        }
    }

    // Optimize connections around intersections for better flow
    optimizeIntersectionConnections() {
        for (let i = 0; i < this.roadNetwork.points.length; i++) {
            const point = this.roadNetwork.points[i];

            if (point.isIntersection) {
                // Sort connections by angle for better navigation
                const connections = this.roadNetwork.connections[i];
                connections.sort((a, b) => {
                    const pointA = this.roadNetwork.points[a];
                    const pointB = this.roadNetwork.points[b];

                    const angleA = Math.atan2(pointA.y - point.y, pointA.x - point.x);
                    const angleB = Math.atan2(pointB.y - point.y, pointB.x - point.x);

                    return angleA - angleB;
                });
            }
        }
    }

    // Check if there's a road path between two points
    hasRoadPathBetween(pointA, pointB) {
        const steps = 10;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = pointA.x + (pointB.x - pointA.x) * t;
            const y = pointA.y + (pointB.y - pointA.y) * t;

            if (!this.isOnRoad(x, y)) {
                return false;
            }
        }
        return true;
    }

    // Identify waypoints at map edges
    identifyEdgePoints() {
        const edgeThreshold = this.EDGE_THRESHOLD;

        for (let i = 0; i < this.roadNetwork.points.length; i++) {
            const point = this.roadNetwork.points[i];

            if (point.x <= edgeThreshold || point.x >= this.worldWidth - edgeThreshold ||
                point.y <= edgeThreshold || point.y >= this.worldHeight - edgeThreshold) {
                this.roadNetwork.edgePoints.push(i);
            }
        }
    }

    // Find waypoints that serve as zone entry points
    findZoneEntryPoints() {
        for (let zoneIndex = 0; zoneIndex < this.residentialZones.length; zoneIndex++) {
            const zone = this.residentialZones[zoneIndex];
            const entryPoints = [];

            for (let i = 0; i < this.roadNetwork.points.length; i++) {
                const waypoint = this.roadNetwork.points[i];

                // Check if waypoint is near the zone boundary
                for (let zonePoint of zone.points) {
                    const distance = Math.hypot(waypoint.x - zonePoint.x, waypoint.y - zonePoint.y);
                    const proximityThreshold = zonePoint.radius + 40; // Slightly outside zone

                    if (distance <= proximityThreshold && distance >= zonePoint.radius - 20) {
                        entryPoints.push(i);
                        break;
                    }
                }
            }

            this.roadNetwork.zoneEntries.set(zoneIndex, entryPoints);
        }
    }

    // Find path using shared network
    findNetworkPath(startPointId, targetZoneIndex) {
        const entryPoints = this.roadNetwork.zoneEntries.get(targetZoneIndex);
        if (!entryPoints || entryPoints.length === 0) {
            return [];
        }

        // Simple BFS to nearest zone entry point
        const visited = new Set();
        const queue = [{pointId: startPointId, path: [startPointId]}];

        while (queue.length > 0) {
            const current = queue.shift();

            if (visited.has(current.pointId)) continue;
            visited.add(current.pointId);

            // Check if we reached a zone entry point
            if (entryPoints.includes(current.pointId)) {
                return current.path.map(id => this.roadNetwork.points[id]);
            }

            // Add neighbors
            for (let neighborId of this.roadNetwork.connections[current.pointId] || []) {
                if (!visited.has(neighborId)) {
                    queue.push({
                        pointId: neighborId,
                        path: [...current.path, neighborId]
                    });
                }
            }
        }

        return []; // No path found
    }

    // Find path between two specific network nodes
    findNetworkPathBetweenNodes(startPointId, targetPointId) {
        if (startPointId === targetPointId) {
            return [this.roadNetwork.points[startPointId]];
        }

        // Simple BFS to target node
        const visited = new Set();
        const queue = [{pointId: startPointId, path: [startPointId]}];

        while (queue.length > 0) {
            const current = queue.shift();

            if (visited.has(current.pointId)) continue;
            visited.add(current.pointId);

            // Check if we reached the target node
            if (current.pointId === targetPointId) {
                return current.path.map(id => this.roadNetwork.points[id]);
            }

            // Add neighbors
            for (let neighborId of this.roadNetwork.connections[current.pointId] || []) {
                if (!visited.has(neighborId)) {
                    queue.push({
                        pointId: neighborId,
                        path: [...current.path, neighborId]
                    });
                }
            }
        }

        return []; // No path found
    }

    // Find closest network point to a position
    findClosestNetworkPoint(x, y) {
        let closestId = -1;
        let closestDistance = Infinity;

        for (let i = 0; i < this.roadNetwork.points.length; i++) {
            const point = this.roadNetwork.points[i];
            const distance = Math.hypot(x - point.x, y - point.y);
            if (distance < closestDistance) {
                closestDistance = distance;
                closestId = i;
            }
        }

        return closestId;
    }

    // Find nearest road segment and calculate its direction
    findNearestRoadSegment(x, y) {
        let closestPoint = null;
        let closestDistance = Infinity;
        let roadDirection = { x: 0, y: 1 }; // Default direction (north)

        // Search through all road zones
        for (let zone of this.roadZones) {
            for (let point of zone.points) {
                const distance = Math.hypot(x - point.x, y - point.y);
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestPoint = point;
                }
            }
        }

        if (closestPoint) {
            // Calculate road direction by looking at nearby road points
            roadDirection = this.calculateRoadDirection(closestPoint.x, closestPoint.y);
        }

        return {
            position: closestPoint,
            direction: roadDirection,
            distance: closestDistance
        };
    }

    // Calculate road direction at a specific point by analyzing nearby road points
    calculateRoadDirection(x, y) {
        const sampleRadius = 40;
        const roadPoints = [];

        // Collect nearby road points
        for (let zone of this.roadZones) {
            for (let point of zone.points) {
                const distance = Math.hypot(x - point.x, y - point.y);
                if (distance <= sampleRadius && distance > 0) {
                    roadPoints.push({
                        x: point.x,
                        y: point.y,
                        distance: distance
                    });
                }
            }
        }

        if (roadPoints.length === 0) {
            return { x: 0, y: 1 }; // Default direction
        }

        // Calculate average direction vector
        let sumX = 0, sumY = 0;
        for (let point of roadPoints) {
            const dx = point.x - x;
            const dy = point.y - y;
            const weight = 1 / (point.distance + 1); // Closer points have more influence
            sumX += dx * weight;
            sumY += dy * weight;
        }

        // Normalize direction vector
        const length = Math.hypot(sumX, sumY);
        if (length > 0) {
            return { x: sumX / length, y: sumY / length };
        }

        return { x: 0, y: 1 }; // Default direction
    }

    // Calculate perpendicular direction to road (for lot depth)
    calculatePerpendicularDirection(roadDirection) {
        // Perpendicular vector: if road direction is (x,y), perpendicular is (-y,x) or (y,-x)
        // We choose the direction that points away from road center
        return {
            x: -roadDirection.y,
            y: roadDirection.x
        };
    }

    // Generate adaptive lot polygon for an agent based on road shape and available space
    generateAdaptiveLot(agent) {
        const roadSegment = this.findNearestRoadSegment(agent.finalPosition.x, agent.finalPosition.y);

        if (!roadSegment.position) {
            // Fallback to circular lot if no road found
            return this.generateCircularLot(agent.finalPosition.x, agent.finalPosition.y, 30);
        }

        const roadDirection = roadSegment.direction;
        const perpDirection = this.calculatePerpendicularDirection(roadDirection);

        // Parameters for lot generation
        const minLotDepth = 25;
        const maxLotDepth = 50;
        const minLotWidth = 20;
        const maxLotWidth = 60;

        // Find street front position (close to road)
        const streetFrontDistance = 5; // Distance from road edge
        const streetFrontX = agent.finalPosition.x - perpDirection.x * streetFrontDistance;
        const streetFrontY = agent.finalPosition.y - perpDirection.y * streetFrontDistance;

        // Calculate lot depth (going away from road)
        const availableDepth = this.calculateAvailableDepth(streetFrontX, streetFrontY, perpDirection, maxLotDepth);
        const lotDepth = Math.max(minLotDepth, availableDepth);

        // Calculate lot width (along the road)
        const availableWidth = this.calculateAvailableWidth(streetFrontX, streetFrontY, roadDirection, maxLotWidth);
        const lotWidth = Math.max(minLotWidth, availableWidth);

        // Generate lot polygon points
        const halfWidth = lotWidth / 2;

        const frontLeft = {
            x: streetFrontX + roadDirection.x * halfWidth,
            y: streetFrontY + roadDirection.y * halfWidth
        };

        const frontRight = {
            x: streetFrontX - roadDirection.x * halfWidth,
            y: streetFrontY - roadDirection.y * halfWidth
        };

        const backLeft = {
            x: frontLeft.x + perpDirection.x * lotDepth,
            y: frontLeft.y + perpDirection.y * lotDepth
        };

        const backRight = {
            x: frontRight.x + perpDirection.x * lotDepth,
            y: frontRight.y + perpDirection.y * lotDepth
        };

        return {
            points: [frontLeft, frontRight, backRight, backLeft],
            center: agent.finalPosition,
            area: lotWidth * lotDepth
        };
    }

    // Calculate available depth from street going inward
    calculateAvailableDepth(startX, startY, direction, maxDepth) {
        const stepSize = 5;
        let depth = 0;

        for (let d = stepSize; d <= maxDepth; d += stepSize) {
            const checkX = startX + direction.x * d;
            const checkY = startY + direction.y * d;

            // Check if position is still in residential zone and not occupied
            if (this.isPositionInResidentialZone(checkX, checkY) &&
                !this.isPositionOccupiedByOtherAgent(checkX, checkY)) {
                depth = d;
            } else {
                break;
            }
        }

        return depth;
    }

    // Calculate available width along the road
    calculateAvailableWidth(centerX, centerY, roadDirection, maxWidth) {
        const stepSize = 5;
        let leftWidth = 0;
        let rightWidth = 0;

        // Check left side
        for (let w = stepSize; w <= maxWidth / 2; w += stepSize) {
            const checkX = centerX + roadDirection.x * w;
            const checkY = centerY + roadDirection.y * w;

            if (this.isPositionInResidentialZone(checkX, checkY) &&
                !this.isPositionOccupiedByOtherAgent(checkX, checkY)) {
                leftWidth = w;
            } else {
                break;
            }
        }

        // Check right side
        for (let w = stepSize; w <= maxWidth / 2; w += stepSize) {
            const checkX = centerX - roadDirection.x * w;
            const checkY = centerY - roadDirection.y * w;

            if (this.isPositionInResidentialZone(checkX, checkY) &&
                !this.isPositionOccupiedByOtherAgent(checkX, checkY)) {
                rightWidth = w;
            } else {
                break;
            }
        }

        return leftWidth + rightWidth;
    }

    // Check if position is in any residential zone
    isPositionInResidentialZone(x, y) {
        for (let zone of this.residentialZones) {
            for (let point of zone.points) {
                const distance = Math.hypot(x - point.x, y - point.y);
                if (distance <= point.radius) {
                    return true;
                }
            }
        }
        return false;
    }

    // Check if position is occupied by another agent's lot
    isPositionOccupiedByOtherAgent(x, y) {
        const minDistance = 15; // Minimum distance between agent territories

        for (let agent of this.agents) {
            if (agent.lotPolygon && agent.phase === 'settled') {
                if (this.isPointInPolygon(x, y, agent.lotPolygon.points)) {
                    return true;
                }
            } else if (agent.finalPosition) {
                const distance = Math.hypot(x - agent.finalPosition.x, y - agent.finalPosition.y);
                if (distance < minDistance) {
                    return true;
                }
            }
        }
        return false;
    }

    // Fallback circular lot generation
    generateCircularLot(x, y, radius) {
        const points = [];
        const segments = 8;

        for (let i = 0; i < segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            points.push({
                x: x + Math.cos(angle) * radius,
                y: y + Math.sin(angle) * radius
            });
        }

        return {
            points: points,
            center: { x, y },
            area: Math.PI * radius * radius
        };
    }

    // Point in polygon test using ray casting algorithm
    isPointInPolygon(x, y, polygonPoints) {
        let isInside = false;
        let j = polygonPoints.length - 1;

        for (let i = 0; i < polygonPoints.length; i++) {
            const xi = polygonPoints[i].x;
            const yi = polygonPoints[i].y;
            const xj = polygonPoints[j].x;
            const yj = polygonPoints[j].y;

            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                isInside = !isInside;
            }
            j = i;
        }

        return isInside;
    }

    // Check if two polygons overlap
    doPolygonsOverlap(poly1Points, poly2Points) {
        // Simple check: if any point of poly1 is inside poly2 or vice versa
        for (let point of poly1Points) {
            if (this.isPointInPolygon(point.x, point.y, poly2Points)) {
                return true;
            }
        }

        for (let point of poly2Points) {
            if (this.isPointInPolygon(point.x, point.y, poly1Points)) {
                return true;
            }
        }

        return false;
    }

    // Connection checking system
    isOnRoad(x, y) {
        for (let zone of this.roadZones) {
            for (let point of zone.points) {
                const distance = Math.hypot(x - point.x, y - point.y);
                if (distance <= point.radius) {
                    return true;
                }
            }
        }
        return false;
    }

    findRoadConnectionsAtEdge() {
        const connections = [];
        const step = 50; // Check every 50 pixels along the edge

        // Check all four edges of the map
        const edges = [
            // Top edge
            { start: {x: 0, y: 0}, end: {x: this.worldWidth, y: 0}, dir: 'horizontal' },
            // Bottom edge
            { start: {x: 0, y: this.worldHeight}, end: {x: this.worldWidth, y: this.worldHeight}, dir: 'horizontal' },
            // Left edge
            { start: {x: 0, y: 0}, end: {x: 0, y: this.worldHeight}, dir: 'vertical' },
            // Right edge
            { start: {x: this.worldWidth, y: 0}, end: {x: this.worldWidth, y: this.worldHeight}, dir: 'vertical' }
        ];

        edges.forEach(edge => {
            if (edge.dir === 'horizontal') {
                for (let x = edge.start.x; x <= edge.end.x; x += step) {
                    if (this.isOnRoad(x, edge.start.y)) {
                        connections.push({x, y: edge.start.y});
                    }
                }
            } else {
                for (let y = edge.start.y; y <= edge.end.y; y += step) {
                    if (this.isOnRoad(edge.start.x, y)) {
                        connections.push({x: edge.start.x, y});
                    }
                }
            }
        });

        return connections;
    }

    checkZoneConnection(zoneIndex) {
        if (zoneIndex >= this.residentialZones.length) return false;

        const zone = this.residentialZones[zoneIndex];
        const edgeConnections = this.findRoadConnectionsAtEdge();

        if (edgeConnections.length === 0) return false;

        // Simple flood-fill from each edge connection to see if we can reach the zone
        for (let startPoint of edgeConnections) {
            if (this.pathExistsToZone(startPoint, zone)) {
                return true;
            }
        }

        return false;
    }

    pathExistsToZone(startPoint, targetZone) {
        const visited = new Set();
        const queue = [startPoint];
        const step = this.PATHFINDING_STEP_SIZE;

        while (queue.length > 0) {
            const current = queue.shift();
            const key = `${Math.floor(current.x / step)},${Math.floor(current.y / step)}`;

            if (visited.has(key)) continue;
            visited.add(key);

            // Check if we've reached the target zone
            if (this.isPointInZone(current, targetZone)) {
                return true;
            }

            // Add neighboring road positions to queue
            const neighbors = [
                {x: current.x + step, y: current.y},
                {x: current.x - step, y: current.y},
                {x: current.x, y: current.y + step},
                {x: current.x, y: current.y - step}
            ];

            for (let neighbor of neighbors) {
                // Check bounds
                if (neighbor.x < 0 || neighbor.x > this.worldWidth ||
                    neighbor.y < 0 || neighbor.y > this.worldHeight) continue;

                const neighborKey = `${Math.floor(neighbor.x / step)},${Math.floor(neighbor.y / step)}`;
                if (visited.has(neighborKey)) continue;

                // Only continue on roads or if we've reached the target zone
                if (this.isOnRoad(neighbor.x, neighbor.y) || this.isPointInZone(neighbor, targetZone)) {
                    queue.push(neighbor);
                }
            }
        }

        return false;
    }

    findPathToZone(startPoint, targetZone) {
        const visited = new Set();
        const queue = [{point: startPoint, path: [startPoint]}];
        const step = this.PATHFINDING_STEP_SIZE;

        while (queue.length > 0) {
            const current = queue.shift();
            const key = `${Math.floor(current.point.x / step)},${Math.floor(current.point.y / step)}`;

            if (visited.has(key)) continue;
            visited.add(key);

            // Check if we've reached the target zone
            if (this.isPointInZone(current.point, targetZone)) {
                // Add final position to the path
                return [...current.path, current.point];
            }

            // Add neighboring road positions to queue
            const neighbors = [
                {x: current.point.x + step, y: current.point.y},
                {x: current.point.x - step, y: current.point.y},
                {x: current.point.x, y: current.point.y + step},
                {x: current.point.x, y: current.point.y - step}
            ];

            for (let neighbor of neighbors) {
                // Check bounds
                if (neighbor.x < 0 || neighbor.x > this.worldWidth ||
                    neighbor.y < 0 || neighbor.y > this.worldHeight) continue;

                const neighborKey = `${Math.floor(neighbor.x / step)},${Math.floor(neighbor.y / step)}`;
                if (visited.has(neighborKey)) continue;

                // Only continue on roads or if we've reached the target zone
                if (this.isOnRoad(neighbor.x, neighbor.y) || this.isPointInZone(neighbor, targetZone)) {
                    queue.push({
                        point: neighbor,
                        path: [...current.path, neighbor]
                    });
                }
            }
        }

        return [startPoint]; // No path found, return just start point
    }

    isPointInZone(point, zone) {
        for (let zonePoint of zone.points) {
            const distance = Math.hypot(point.x - zonePoint.x, point.y - zonePoint.y);
            if (distance <= zonePoint.radius) {
                return true;
            }
        }
        return false;
    }

    updateAllConnections() {
        for (let i = 0; i < this.residentialZones.length; i++) {
            const wasConnected = this.zoneConnections.get(i) || false;
            const isConnected = this.checkZoneConnection(i);
            this.zoneConnections.set(i, isConnected);

            // Handle connection changes
            if (!wasConnected && isConnected) {
                this.spawnAgentsForZone(i);
            } else if (wasConnected && !isConnected) {
                this.removeAgentsFromZone(i);
            } else if (isConnected) {
                // Zone is connected - check if we need more agents due to size increase
                this.updateAgentsForZone(i);
            }
        }
    }

    updateAgentsForZone(zoneIndex) {
        const zone = this.residentialZones[zoneIndex];
        const maxAgents = this.calculateMaxAgents(zone);
        const existingAgents = this.agents.filter(agent => agent.targetZoneIndex === zoneIndex);
        const agentsToSpawn = maxAgents - existingAgents.length;

        // Spawn additional agents if zone got bigger
        if (agentsToSpawn > 0) {
            for (let i = 0; i < agentsToSpawn; i++) {
                const finalPosition = this.findFreePositionInZone(zone, existingAgents);
                if (!finalPosition) break; // No more free positions

                const spawnPoint = this.findRandomEdgeConnection();
                if (!spawnPoint) break; // No edge connection available

                // Find closest road node to final position
                const closestNodeToFinalPosition = this.findClosestNetworkPoint(finalPosition.x, finalPosition.y);

                // Calculate path using network - first to closest node to final position
                let pathToNode = [];
                if (this.roadNetwork.points.length > 0) {
                    const startPointId = this.findClosestNetworkPoint(spawnPoint.x, spawnPoint.y);
                    if (startPointId >= 0 && closestNodeToFinalPosition >= 0) {
                        pathToNode = this.findNetworkPathBetweenNodes(startPointId, closestNodeToFinalPosition);
                    }
                }

                // Fallback to old pathfinding if network fails
                if (pathToNode.length === 0) {
                    pathToNode = this.findPathToZone(spawnPoint, zone);
                }

                const agent = {
                    x: spawnPoint.x,
                    y: spawnPoint.y,
                    targetZoneIndex: zoneIndex,
                    finalPosition: finalPosition,
                    closestNodeToFinalPosition: closestNodeToFinalPosition,
                    pathToNode: pathToNode,
                    pathToNodeIndex: 0,
                    phase: 'traveling_to_node',
                    speed: 2,
                    radius: 10,
                    color: '#ffff00'
                };

                this.agents.push(agent);
                existingAgents.push(agent);
            }
        }
    }

    calculateMaxAgents(zone) {
        // Calculate total area of the zone
        let totalArea = 0;
        for (let point of zone.points) {
            totalArea += Math.PI * point.radius * point.radius;
        }

        // Each agent needs minimum area of residential-small size (50px radius)
        const agentArea = Math.PI * 50 * 50;

        // Apply packing efficiency - circles can't pack perfectly
        const packingEfficiency = this.PACKING_EFFICIENCY;
        const maxAgents = Math.floor((totalArea / agentArea) * packingEfficiency);

        // Debug output
        console.log(`Zonenfläche: ${totalArea.toFixed(0)}, Agent-Fläche: ${agentArea.toFixed(0)}, Max. Agenten: ${maxAgents}`);

        return Math.max(0, Math.min(maxAgents, this.MAX_AGENTS_PER_ZONE));
    }

    findFreePositionInZone(zone, existingAgents = []) {
        // Try to find a free position in the zone
        const maxAttempts = this.MAX_PATHFINDING_ATTEMPTS;
        const minDistance = this.MIN_AGENT_DISTANCE;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            // Pick a random zone point
            const randomPoint = zone.points[Math.floor(Math.random() * zone.points.length)];

            // Pick a random position within that point's radius
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * (randomPoint.radius - 55); // Leave margin for agent radius
            const x = randomPoint.x + Math.cos(angle) * distance;
            const y = randomPoint.y + Math.sin(angle) * distance;

            // Check if position is free (not too close to existing agents)
            let isFree = true;
            for (let agent of existingAgents) {
                // Check against final position if it exists, otherwise current position
                const checkX = agent.finalPosition ? agent.finalPosition.x : agent.x;
                const checkY = agent.finalPosition ? agent.finalPosition.y : agent.y;

                if (Math.hypot(x - checkX, y - checkY) < minDistance) {
                    isFree = false;
                    break;
                }
            }

            if (isFree) {
                return {x, y};
            }
        }

        return null; // No free position found
    }

    findRandomEdgeConnection() {
        // Use network edge points if available
        if (this.roadNetwork.edgePoints.length > 0) {
            const randomEdgeId = this.roadNetwork.edgePoints[Math.floor(Math.random() * this.roadNetwork.edgePoints.length)];
            return this.roadNetwork.points[randomEdgeId];
        }

        // Fallback to old method
        const edgeConnections = this.findRoadConnectionsAtEdge();
        if (edgeConnections.length === 0) return null;
        return edgeConnections[Math.floor(Math.random() * edgeConnections.length)];
    }

    spawnAgentsForZone(zoneIndex) {
        const zone = this.residentialZones[zoneIndex];
        const maxAgents = this.calculateMaxAgents(zone);

        // Find existing agents for this zone
        const existingAgents = this.agents.filter(agent => agent.targetZoneIndex === zoneIndex);
        const agentsToSpawn = maxAgents - existingAgents.length;

        // Queue agents for delayed spawning instead of spawning all at once
        for (let i = 0; i < agentsToSpawn; i++) {
            const finalPosition = this.findFreePositionInZone(zone, existingAgents);
            if (!finalPosition) break; // No more free positions

            const spawnPoint = this.findRandomEdgeConnection();
            if (!spawnPoint) break; // No edge connection available

            // Find closest road node to final position
            const closestNodeToFinalPosition = this.findClosestNetworkPoint(finalPosition.x, finalPosition.y);

            // Calculate path using network - first to closest node to final position
            let pathToNode = [];
            if (this.roadNetwork.points.length > 0) {
                const startPointId = this.findClosestNetworkPoint(spawnPoint.x, spawnPoint.y);
                if (startPointId >= 0 && closestNodeToFinalPosition >= 0) {
                    pathToNode = this.findNetworkPathBetweenNodes(startPointId, closestNodeToFinalPosition);
                }
            }

            // Fallback to old pathfinding if network fails
            if (pathToNode.length === 0) {
                pathToNode = this.findPathToZone(spawnPoint, zone);
            }

            const agentConfig = {
                x: spawnPoint.x,
                y: spawnPoint.y,
                targetZoneIndex: zoneIndex,
                finalPosition: finalPosition,
                closestNodeToFinalPosition: closestNodeToFinalPosition,
                pathToNode: pathToNode,
                pathToNodeIndex: 0,
                phase: 'traveling_to_node',
                speed: 2,
                radius: 10,
                color: '#ffff00'
            };

            // Add to spawn queue instead of spawning immediately
            this.agentSpawnQueue.push(agentConfig);
            existingAgents.push({finalPosition: finalPosition}); // Reserve position
        }
    }

    removeAgentsFromZone(zoneIndex) {
        // Remove all agents that belong to this zone
        this.agents = this.agents.filter(agent => agent.targetZoneIndex !== zoneIndex);
    }

    processAgentSpawnQueue() {
        const currentTime = performance.now();

        // Check if enough time has passed since last spawn
        if (currentTime - this.lastSpawnTime >= this.spawnDelay && this.agentSpawnQueue.length > 0) {
            const agentConfig = this.agentSpawnQueue.shift();

            // Create and add the agent
            this.agents.push(agentConfig);

            this.lastSpawnTime = currentTime;
        }
    }

    updateAgents() {
        for (let agent of this.agents) {
            if (agent.phase === 'traveling_to_node') {
                this.updateAgentTravelingToNode(agent);
            } else if (agent.phase === 'traveling_to_area') {
                this.updateAgentTravelingToArea(agent);
            } else if (agent.phase === 'settling') {
                this.updateAgentSettling(agent);
            }
        }
    }

    updateAgentTravelingToNode(agent) {
        if (!agent.pathToNode || agent.pathToNode.length === 0) {
            // No path to node, switch to area traveling
            agent.phase = 'traveling_to_area';
            return;
        }

        // Get current target point in path to node
        if (agent.pathToNodeIndex >= agent.pathToNode.length) {
            // Reached the closest node to final position, now go to area
            agent.phase = 'traveling_to_area';
            return;
        }

        const targetPoint = agent.pathToNode[agent.pathToNodeIndex];
        const dx = targetPoint.x - agent.x;
        const dy = targetPoint.y - agent.y;
        const distance = Math.hypot(dx, dy);

        if (distance < agent.speed) {
            // Reached current waypoint, move to next
            agent.x = targetPoint.x;
            agent.y = targetPoint.y;
            agent.pathToNodeIndex++;
        } else {
            // Move towards current waypoint
            const moveX = (dx / distance) * agent.speed;
            const moveY = (dy / distance) * agent.speed;
            agent.x += moveX;
            agent.y += moveY;
        }
    }

    updateAgentTravelingToArea(agent) {
        // Agent has reached the closest road node to final position
        // Now move directly to the final position in the area
        const dx = agent.finalPosition.x - agent.x;
        const dy = agent.finalPosition.y - agent.y;
        const distance = Math.hypot(dx, dy);

        if (distance < agent.speed) {
            // Close enough to final position, start settling
            agent.phase = 'settling';
        } else {
            // Move towards final position
            const moveX = (dx / distance) * agent.speed;
            const moveY = (dy / distance) * agent.speed;
            agent.x += moveX;
            agent.y += moveY;
        }
    }

    updateAgentSettling(agent) {
        // Agent is in the zone, move to final position
        const dx = agent.finalPosition.x - agent.x;
        const dy = agent.finalPosition.y - agent.y;
        const distance = Math.hypot(dx, dy);

        if (distance < agent.speed) {
            // Reached final position
            agent.x = agent.finalPosition.x;
            agent.y = agent.finalPosition.y;
            agent.phase = 'settled';

            // Generate adaptive lot polygon when agent settles
            agent.lotPolygon = this.generateAdaptiveLot(agent);
        } else {
            // Move towards final position
            const moveX = (dx / distance) * agent.speed;
            const moveY = (dy / distance) * agent.speed;
            agent.x += moveX;
            agent.y += moveY;
        }
    }

    // Removed previous pixel-heavy procedural grass helpers in favor of a simple vector-derived pattern

    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    setupEventListeners() {
        // Window resize
        window.addEventListener('resize', () => {
            this.resizeCanvas();
        });

        // Prevent context menu for right-click erasing
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });

        // Mouse events for panning / zoning
        this.canvas.addEventListener('mousedown', (e) => {
            if (this.buildMode.active) {
                // Start zone painting or erasing
                this.buildMode.isPainting = true;
                this.buildMode.isErasingDrag = (e.button === 2);
                const worldPos = this.screenToWorld(e.clientX, e.clientY);
                if (this.buildMode.isErasingDrag || this.buildMode.eraser) {
                    this.eraseZone(worldPos.x, worldPos.y, true);
                } else {
                    this.smoothPaintZone(worldPos.x, worldPos.y, true);
                }
            } else {
                this.mouse.isDragging = true;
                this.mouse.dragStartX = e.clientX;
                this.mouse.dragStartY = e.clientY;
                this.mouse.lastX = e.clientX;
                this.mouse.lastY = e.clientY;
                this.canvas.style.cursor = 'grabbing';
            }
        });

        this.canvas.addEventListener('mousemove', (e) => {
            this.mouse.x = e.clientX;
            this.mouse.y = e.clientY;

            if (this.buildMode.active) {
                const worldPos = this.screenToWorld(e.clientX, e.clientY);

                // Continue painting while dragging
                if (this.buildMode.isPainting) {
                    if (this.buildMode.isErasingDrag || this.buildMode.eraser) {
                        this.eraseZone(worldPos.x, worldPos.y);
                    } else {
                        this.smoothPaintZone(worldPos.x, worldPos.y);
                    }
                }

                // Update preview zone position with enhanced eraser feedback
                let previewColor, previewBorderColor, previewPattern = null;
                if (this.buildMode.eraser || this.buildMode.isErasingDrag) {
                    previewColor = 'rgba(255, 69, 69, 0.6)';
                    previewBorderColor = 'rgba(255, 0, 0, 1.0)';
                    previewPattern = 'eraser';
                } else if (this.buildMode.selectedType === 'road') {
                    previewColor = 'rgba(80, 80, 80, 0.9)';
                    previewBorderColor = 'rgba(40, 40, 40, 1.0)';
                } else {
                    previewColor = 'rgba(76, 175, 80, 0.4)';
                    previewBorderColor = 'rgba(60, 140, 60, 1.0)';
                }

                this.buildMode.previewZone = {
                    x: worldPos.x,
                    y: worldPos.y,
                    radius: this.buildMode.brushSize,
                    color: previewColor,
                    borderColor: previewBorderColor,
                    pattern: previewPattern
                };
            } else if (this.mouse.isDragging) {
                const deltaX = e.clientX - this.mouse.lastX;
                const deltaY = e.clientY - this.mouse.lastY;

                this.camera.x -= deltaX / this.camera.zoom;
                this.camera.y -= deltaY / this.camera.zoom;

                this.mouse.lastX = e.clientX;
                this.mouse.lastY = e.clientY;

                this.updateUI();
            }
        });

        this.canvas.addEventListener('mouseup', () => {
            if (this.buildMode.active) {
                // Stop painting
                this.buildMode.isPainting = false;
                this.buildMode.lastPaintX = null;
                this.buildMode.lastPaintY = null;
                this.buildMode.isErasingDrag = false;
                // Clear stroke history for clean start of next stroke
                this.buildMode.strokeHistory = [];
            } else {
                this.mouse.isDragging = false;
                this.canvas.style.cursor = 'grab';
            }
        });

        this.canvas.addEventListener('mouseleave', () => {
            if (this.buildMode.active) {
                // Stop painting when leaving canvas
                this.buildMode.isPainting = false;
                this.buildMode.lastPaintX = null;
                this.buildMode.lastPaintY = null;
                this.buildMode.previewZone = null;
                this.buildMode.isErasingDrag = false;
                // Clear stroke history when leaving canvas
                this.buildMode.strokeHistory = [];
            } else {
                this.mouse.isDragging = false;
                this.canvas.style.cursor = 'grab';
            }
        });

        // Keyboard events
        document.addEventListener('keydown', (e) => {
            if (this.buildMode.active) {
                if (e.key === 'Escape') {
                    this.deactivateBuildMode();
                    return;
                }
                // Brush size shortcuts and eraser toggle
                if (e.key === '[') {
                    this.buildMode.brushSize = Math.max(this.buildMode.minBrushSize, this.buildMode.brushSize - 5);
                    this.updateBuildModeUI();
                } else if (e.key === ']') {
                    this.buildMode.brushSize = Math.min(this.buildMode.maxBrushSize, this.buildMode.brushSize + 5);
                    this.updateBuildModeUI();
                } else if (e.key.toLowerCase() === 'e') {
                    this.buildMode.eraser = !this.buildMode.eraser;
                    this.updateBuildModeUI();
                } else if (e.key.toLowerCase() === 'p') {
                    this.showWaypoints = !this.showWaypoints;
                    console.log(`Wegpunkt-Anzeige: ${this.showWaypoints ? 'AN' : 'AUS'}`);
                }
            }
        });

        // Zoom with mouse wheel
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();

            const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
            const newZoom = this.camera.zoom * zoomFactor;

            if (newZoom >= this.camera.minZoom && newZoom <= this.camera.maxZoom) {
                // Zoom towards mouse position
                const mouseWorldX = (this.mouse.x / this.camera.zoom) + this.camera.x;
                const mouseWorldY = (this.mouse.y / this.camera.zoom) + this.camera.y;

                this.camera.zoom = newZoom;

                this.camera.x = mouseWorldX - (this.mouse.x / this.camera.zoom);
                this.camera.y = mouseWorldY - (this.mouse.y / this.camera.zoom);

                this.updateUI();
            }
        });
    }

    worldToScreen(worldX, worldY) {
        return {
            x: (worldX - this.camera.x) * this.camera.zoom,
            y: (worldY - this.camera.y) * this.camera.zoom
        };
    }

    screenToWorld(screenX, screenY) {
        return {
            x: (screenX / this.camera.zoom) + this.camera.x,
            y: (screenY / this.camera.zoom) + this.camera.y
        };
    }

    drawGrid() {
        const ctx = this.ctx;
        const gridSize = 500; // Grid every 500 pixels

        // Calculate visible grid lines
        const startX = Math.floor(this.camera.x / gridSize) * gridSize;
        const startY = Math.floor(this.camera.y / gridSize) * gridSize;
        const endX = this.camera.x + (this.canvas.width / this.camera.zoom);
        const endY = this.camera.y + (this.canvas.height / this.camera.zoom);

        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1 / this.camera.zoom;
        ctx.beginPath();

        // Vertical lines
        for (let x = startX; x <= endX + gridSize; x += gridSize) {
            const screenPos = this.worldToScreen(x, startY);
            const screenPosEnd = this.worldToScreen(x, endY + gridSize);
            ctx.moveTo(screenPos.x, screenPos.y);
            ctx.lineTo(screenPosEnd.x, screenPosEnd.y);
        }

        // Horizontal lines
        for (let y = startY; y <= endY + gridSize; y += gridSize) {
            const screenPos = this.worldToScreen(startX, y);
            const screenPosEnd = this.worldToScreen(endX + gridSize, y);
            ctx.moveTo(screenPos.x, screenPos.y);
            ctx.lineTo(screenPosEnd.x, screenPosEnd.y);
        }

        ctx.stroke();
    }

    drawWorldBounds() {
        const ctx = this.ctx;
        const topLeft = this.worldToScreen(0, 0);
        const bottomRight = this.worldToScreen(this.worldWidth, this.worldHeight);

        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 2 / this.camera.zoom;
        ctx.strokeRect(
            topLeft.x,
            topLeft.y,
            bottomRight.x - topLeft.x,
            bottomRight.y - topLeft.y
        );
    }

    drawAgents() {
        const ctx = this.ctx;

        this.agents.forEach(agent => {
            // Draw occupied space (territory) for settled agents
            if (agent.phase === 'settled' && agent.finalPosition) {
                this.drawAgentTerritory(agent);
            }

            // Draw the agent itself
            const screenPos = this.worldToScreen(agent.x, agent.y);

            ctx.fillStyle = agent.color || '#ffff00';
            ctx.beginPath();
            ctx.arc(
                screenPos.x,
                screenPos.y,
                (agent.radius || 10) * this.camera.zoom,
                0,
                2 * Math.PI
            );
            ctx.fill();

            // Draw a border
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1 * this.camera.zoom;
            ctx.stroke();
        });
    }

    drawAgentTerritory(agent) {
        const ctx = this.ctx;

        ctx.save();
        ctx.globalAlpha = 0.8;

        // Always generate intelligent space-optimized polygon territory
        if (true) {
            // Generate intelligent space-optimized polygon territory
            const polygon = this.generateOptimalPolygonTerritory(agent);

            // Store polygon on agent for collision detection
            agent.territoryPolygon = polygon;

            ctx.fillStyle = 'rgba(255, 170, 0, 0.6)';
            ctx.strokeStyle = '#ff8800';
            ctx.lineWidth = Math.max(1, 2 * this.camera.zoom);
            ctx.setLineDash([5, 5]);

            ctx.beginPath();
            const firstPoint = this.worldToScreen(polygon.points[0].x, polygon.points[0].y);
            ctx.moveTo(firstPoint.x, firstPoint.y);

            for (let i = 1; i < polygon.points.length; i++) {
                const screenPoint = this.worldToScreen(polygon.points[i].x, polygon.points[i].y);
                ctx.lineTo(screenPoint.x, screenPoint.y);
            }

            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }

        ctx.restore();
    }

    // Generate intelligent space-optimized polygon territory
    generateOptimalPolygonTerritory(agent) {
        const x = agent.finalPosition.x;
        const y = agent.finalPosition.y;

        // Scan available space in all directions
        const boundaries = this.scanAvailableSpace(x, y, agent);

        // Generate polygon that maximally uses available space
        return this.createOptimalPolygon(x, y, boundaries);
    }

    // Scan available space around agent position
    scanAvailableSpace(x, y, currentAgent) {
        const maxRadius = 80; // Maximum territory size
        const rayCount = 12; // Number of rays to cast
        const boundaries = [];

        for (let i = 0; i < rayCount; i++) {
            const angle = (i / rayCount) * Math.PI * 2;
            const rayX = Math.cos(angle);
            const rayY = Math.sin(angle);

            // Cast ray and find boundary
            const boundary = this.castRayForBoundary(x, y, rayX, rayY, maxRadius, currentAgent);
            boundaries.push({
                angle: angle,
                distance: boundary.distance,
                x: x + rayX * boundary.distance,
                y: y + rayY * boundary.distance,
                reason: boundary.reason
            });
        }

        return boundaries;
    }

    // Cast ray to find boundary (other agent, zone edge, etc.)
    castRayForBoundary(startX, startY, dirX, dirY, maxDistance, currentAgent) {
        const stepSize = 5;

        for (let distance = stepSize; distance <= maxDistance; distance += stepSize) {
            const checkX = startX + dirX * distance;
            const checkY = startY + dirY * distance;

            // Check if we hit another agent's territory
            for (let agent of this.agents) {
                if (agent === currentAgent) continue;
                if (!agent.finalPosition) continue;

                // Check if point is inside another agent's existing territory
                if (agent.territoryPolygon && this.isPointInPolygon(checkX, checkY, agent.territoryPolygon.points)) {
                    return { distance: distance - stepSize, reason: 'agent_territory' };
                }

                // Fallback: check distance to agent center
                const agentDist = Math.hypot(checkX - agent.finalPosition.x, checkY - agent.finalPosition.y);
                if (agentDist < 30) { // Minimum distance between agent centers
                    return { distance: distance - stepSize, reason: 'agent' };
                }
            }

            // Check if we're outside residential zone
            if (!this.isPositionInResidentialZone(checkX, checkY)) {
                return { distance: distance - stepSize, reason: 'zone_boundary' };
            }

            // Check if we're on a road - grundstücke dürfen nie straßen überlappen
            if (this.isOnRoad(checkX, checkY)) {
                return { distance: distance - stepSize, reason: 'road_boundary' };
            }

            // Check world bounds
            if (checkX < 0 || checkX > this.worldWidth || checkY < 0 || checkY > this.worldHeight) {
                return { distance: distance - stepSize, reason: 'world_boundary' };
            }
        }

        return { distance: maxDistance, reason: 'max_reached' };
    }

    // Create optimal polygon from boundary points
    createOptimalPolygon(centerX, centerY, boundaries) {
        // Use boundary points to create polygon
        const points = boundaries.map(b => ({ x: b.x, y: b.y }));

        // Smooth the polygon to avoid sharp angles
        const smoothedPoints = this.smoothPolygonPoints(points);

        return {
            points: smoothedPoints,
            center: { x: centerX, y: centerY }
        };
    }

    // Smooth polygon points to create more natural shapes
    smoothPolygonPoints(points) {
        if (points.length < 3) return points;

        const smoothed = [];
        const smoothingFactor = 0.3;

        for (let i = 0; i < points.length; i++) {
            const prev = points[(i - 1 + points.length) % points.length];
            const curr = points[i];
            const next = points[(i + 1) % points.length];

            // Smooth current point based on neighbors
            const smoothX = curr.x + (prev.x + next.x - 2 * curr.x) * smoothingFactor;
            const smoothY = curr.y + (prev.y + next.y - 2 * curr.y) * smoothingFactor;

            smoothed.push({ x: smoothX, y: smoothY });
        }

        return smoothed;
    }

    // Find nearest road direction for polygon orientation
    findNearestRoadDirection(x, y) {
        let closestDirection = {x: 1, y: 0}; // Default: horizontal
        let closestDistance = Infinity;

        // Sample nearby road points to determine direction
        for (let zone of this.roadZones) {
            for (let point of zone.points) {
                const distance = Math.hypot(x - point.x, y - point.y);
                if (distance < closestDistance && distance < 100) {
                    closestDistance = distance;

                    // Calculate direction from agent to road
                    const dx = point.x - x;
                    const dy = point.y - y;
                    const length = Math.hypot(dx, dy);

                    if (length > 0) {
                        closestDirection = {x: dx/length, y: dy/length};
                    }
                }
            }
        }

        return closestDirection;
    }

    // Draw a simple house on the agent's lot
    drawHouseOnLot(agent) {
        if (!agent.lotPolygon || !agent.finalPosition) return;

        const ctx = this.ctx;
        const houseSize = 8;
        const screenPos = this.worldToScreen(agent.finalPosition.x, agent.finalPosition.y);
        const screenSize = houseSize * this.camera.zoom;

        ctx.save();
        ctx.globalAlpha = 0.8;

        // Draw simple rectangular house
        ctx.fillStyle = '#8B4513'; // Brown house
        ctx.strokeStyle = '#654321';
        ctx.lineWidth = Math.max(1, 1 * this.camera.zoom);

        ctx.fillRect(
            screenPos.x - screenSize / 2,
            screenPos.y - screenSize / 2,
            screenSize,
            screenSize
        );

        ctx.strokeRect(
            screenPos.x - screenSize / 2,
            screenPos.y - screenSize / 2,
            screenSize,
            screenSize
        );

        ctx.restore();
    }

    drawWaypoints() {
        const ctx = this.ctx;

        // Only show waypoints at certain zoom levels (when zoomed in enough to see detail)
        if (this.camera.zoom < 0.5) return;

        ctx.save();

        // Adjust opacity based on zoom level
        const minZoom = 0.5;
        const maxZoom = 2.0;
        const opacity = Math.min(1.0, (this.camera.zoom - minZoom) / (maxZoom - minZoom));
        ctx.globalAlpha = opacity * 0.6;

        // Draw waypoint connections first (thin lines)
        ctx.strokeStyle = '#666666';
        ctx.lineWidth = Math.max(0.5, 1 * this.camera.zoom);
        ctx.beginPath();

        for (let i = 0; i < this.roadNetwork.points.length; i++) {
            const point = this.roadNetwork.points[i];
            const screenPos = this.worldToScreen(point.x, point.y);

            // Skip if point is off-screen
            if (screenPos.x < -50 || screenPos.x > this.canvas.width + 50 ||
                screenPos.y < -50 || screenPos.y > this.canvas.height + 50) {
                continue;
            }

            // Draw connections to neighbors
            for (let neighborId of this.roadNetwork.connections[i] || []) {
                const neighbor = this.roadNetwork.points[neighborId];
                const neighborScreenPos = this.worldToScreen(neighbor.x, neighbor.y);

                ctx.moveTo(screenPos.x, screenPos.y);
                ctx.lineTo(neighborScreenPos.x, neighborScreenPos.y);
            }
        }
        ctx.stroke();

        // Draw waypoints themselves
        const pointRadius = Math.max(2, 3 * this.camera.zoom);

        for (let i = 0; i < this.roadNetwork.points.length; i++) {
            const point = this.roadNetwork.points[i];
            const screenPos = this.worldToScreen(point.x, point.y);

            // Skip if point is off-screen
            if (screenPos.x < -50 || screenPos.x > this.canvas.width + 50 ||
                screenPos.y < -50 || screenPos.y > this.canvas.height + 50) {
                continue;
            }

            // Different colors for different types of points
            if (this.roadNetwork.edgePoints.includes(i)) {
                // Edge points (spawn locations)
                ctx.fillStyle = '#44ff44';
                ctx.strokeStyle = '#22aa22';
            } else if (this.roadNetwork.points[i].isIntersection) {
                // Intersection points
                ctx.fillStyle = '#ff6644';
                ctx.strokeStyle = '#cc4422';
            } else if (this.roadNetwork.points[i].isApproach) {
                // Approach points to intersections
                ctx.fillStyle = '#ffaa44';
                ctx.strokeStyle = '#cc8822';
            } else if (this.roadNetwork.points[i].isRoadCenter) {
                // Main road centerpoints
                ctx.fillStyle = '#ffffff';
                ctx.strokeStyle = '#888888';
            } else {
                // Intermediate waypoints
                ctx.fillStyle = '#cccccc';
                ctx.strokeStyle = '#666666';
            }

            ctx.lineWidth = Math.max(0.5, 1 * this.camera.zoom);

            ctx.beginPath();
            ctx.arc(screenPos.x, screenPos.y, pointRadius, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
        }

        // Draw zone entry indicators
        ctx.fillStyle = '#ffaa44';
        ctx.strokeStyle = '#cc8822';
        for (let [zoneIndex, entryPointIds] of this.roadNetwork.zoneEntries) {
            for (let pointId of entryPointIds) {
                const point = this.roadNetwork.points[pointId];
                const screenPos = this.worldToScreen(point.x, point.y);

                if (screenPos.x < -50 || screenPos.x > this.canvas.width + 50 ||
                    screenPos.y < -50 || screenPos.y > this.canvas.height + 50) {
                    continue;
                }

                ctx.beginPath();
                ctx.arc(screenPos.x, screenPos.y, pointRadius * 1.5, 0, 2 * Math.PI);
                ctx.fill();
                ctx.stroke();
            }
        }

        ctx.restore();
    }

    updatePerformanceMetrics() {
        try {
            const currentTime = performance.now();
            const deltaTime = currentTime - this.performance.lastFrameTime;

            if (deltaTime > 0) {
                const currentFps = 1000 / deltaTime;
                this.performance.frameHistory.push(currentFps);

                // Keep only last N frames for average calculation
                if (this.performance.frameHistory.length > this.performance.maxFrameHistory) {
                    this.performance.frameHistory.shift();
                }

                // Calculate average FPS
                this.performance.averageFps = this.performance.frameHistory.reduce((a, b) => a + b, 0) / this.performance.frameHistory.length;
                this.performance.fps = currentFps;
            }

            this.performance.lastFrameTime = currentTime;
            this.performance.frameCount++;

            // Update memory usage (if available)
            if (performance.memory) {
                this.performance.memoryUsage = Math.round(performance.memory.usedJSHeapSize / 1024 / 1024 * 10) / 10;
            }
        } catch (error) {
            console.error('Performance-Metriken Fehler:', error);
        }
    }

    updateUI() {
        try {
            const cameraElement = document.getElementById('cameraPos');
            const zoomElement = document.getElementById('zoomLevel');
            const perfElement = document.getElementById('performance');

            if (cameraElement) {
                cameraElement.textContent = `${Math.round(this.camera.x)}, ${Math.round(this.camera.y)}`;
            }

            if (zoomElement) {
                zoomElement.textContent = this.camera.zoom.toFixed(2);
            }

            // Update performance display
            if (perfElement) {
                perfElement.innerHTML = `
                    FPS: ${Math.round(this.performance.fps)} (Ø ${Math.round(this.performance.averageFps)})
                    ${this.performance.memoryUsage ? `<br>Memory: ${this.performance.memoryUsage} MB` : ''}
                `;
            }
        } catch (error) {
            console.error('UI-Update Fehler:', error);
        }
    }

    drawGrassBackground() {
        const ctx = this.ctx;

        // Calculate visible world area
        const startX = Math.floor(this.camera.x);
        const startY = Math.floor(this.camera.y);
        const endX = Math.ceil(this.camera.x + (this.canvas.width / this.camera.zoom));
        const endY = Math.ceil(this.camera.y + (this.canvas.height / this.camera.zoom));

        // Only draw grass within world bounds
        const clampedStartX = Math.max(0, startX);
        const clampedStartY = Math.max(0, startY);
        const clampedEndX = Math.min(this.worldWidth, endX);
        const clampedEndY = Math.min(this.worldHeight, endY);

        if (clampedStartX < clampedEndX && clampedStartY < clampedEndY) {
            const topLeft = this.worldToScreen(clampedStartX, clampedStartY);
            const bottomRight = this.worldToScreen(clampedEndX, clampedEndY);

            ctx.save();
            ctx.fillStyle = '#2f5d2b';
            ctx.fillRect(
                topLeft.x,
                topLeft.y,
                bottomRight.x - topLeft.x,
                bottomRight.y - topLeft.y
            );
            ctx.restore();
        }
    }

    render() {
        const ctx = this.ctx;

        // Clear canvas
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw background (dark outside world)
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw flat green background within world bounds
        this.drawGrassBackground();

        // Draw world bounds
        this.drawWorldBounds();

        // Draw residential zones
        this.drawResidentialZones();

        // Draw road zones
        this.drawRoadZones();

        // Draw warning icons for unconnected zones
        this.drawZoneWarnings();

        // Draw buildings
        this.drawBuildings();

        // Draw zone preview
        if (this.buildMode.active && this.buildMode.previewZone) {
            this.drawZonePreview(this.buildMode.previewZone);
        }

        // Draw agents
        this.drawAgents();

        // Draw waypoints if enabled
        if (this.showWaypoints) {
            this.drawWaypoints();
        }
    }

    drawResidentialZones() {
        const ctx = this.ctx;

        this.residentialZones.forEach((zone, index) => {
            if (!zone.points || zone.points.length === 0) return;

            // Check if zone is visible on screen
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            zone.points.forEach(p => {
                const s = this.worldToScreen(p.x, p.y);
                const r = p.radius * this.camera.zoom;
                minX = Math.min(minX, s.x - r);
                minY = Math.min(minY, s.y - r);
                maxX = Math.max(maxX, s.x + r);
                maxY = Math.max(maxY, s.y + r);
            });

            // Skip if not visible
            if (maxX < 0 || minX > this.canvas.width || maxY < 0 || minY > this.canvas.height) {
                return;
            }

            // Use cached version for small zones or fallback to dynamic rendering for large ones
            if (zone.points.length < 50) {
                this.drawZoneUsingCache(ctx, zone, index, 'residential');
            } else {
                this.drawZoneDynamic(ctx, zone);
            }
        });
    }

    drawZoneUsingCache(ctx, zone, index, zoneType) {
        // This would use cached rendering - simplified for now
        this.drawZoneDynamic(ctx, zone);
    }

    drawZoneDynamic(ctx, zone) {
        // Fallback to original dynamic rendering
        const circles = zone.points.map(p => {
            const s = this.worldToScreen(p.x, p.y);
            return { x: s.x, y: s.y, r: p.radius * this.camera.zoom };
        });
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        circles.forEach(c => {
            minX = Math.min(minX, c.x - c.r);
            minY = Math.min(minY, c.y - c.r);
            maxX = Math.max(maxX, c.x + c.r);
            maxY = Math.max(maxY, c.y + c.r);
        });
        const width = Math.max(1, Math.ceil(maxX - minX));
        const height = Math.max(1, Math.ceil(maxY - minY));
        if (!isFinite(width) || !isFinite(height)) return;

        // Offscreen mask canvas
        const mask = document.createElement('canvas');
        mask.width = width;
        mask.height = height;
        const mctx = mask.getContext('2d');

        // Draw opaque mask of union of circles
        mctx.save();
        mctx.translate(-minX, -minY);
        mctx.fillStyle = '#ffffff';
        mctx.beginPath();
        circles.forEach(c => {
            mctx.moveTo(c.x + c.r, c.y);
            mctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        });
        mctx.fill();
        mctx.restore();

        // Tint mask with zone color using source-in to avoid seam darkening
        mctx.globalCompositeOperation = 'source-in';
        mctx.fillStyle = zone.color;
        mctx.fillRect(0, 0, width, height);
        mctx.globalCompositeOperation = 'source-over';

        // Draw result onto main canvas
        ctx.drawImage(mask, minX, minY);
    }

    drawRoadZones() {
        const ctx = this.ctx;

        this.roadZones.forEach(zone => {
            if (!zone.points || zone.points.length === 0) return;

            // Compute screen-space circles and bounding box
            const circles = zone.points.map(p => {
                const s = this.worldToScreen(p.x, p.y);
                return { x: s.x, y: s.y, r: p.radius * this.camera.zoom };
            });
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            circles.forEach(c => {
                minX = Math.min(minX, c.x - c.r);
                minY = Math.min(minY, c.y - c.r);
                maxX = Math.max(maxX, c.x + c.r);
                maxY = Math.max(maxY, c.y + c.r);
            });
            const width = Math.max(1, Math.ceil(maxX - minX));
            const height = Math.max(1, Math.ceil(maxY - minY));
            if (!isFinite(width) || !isFinite(height)) return;

            // Offscreen mask canvas
            const mask = document.createElement('canvas');
            mask.width = width;
            mask.height = height;
            const mctx = mask.getContext('2d');

            // Draw opaque mask of union of circles
            mctx.save();
            mctx.translate(-minX, -minY);
            mctx.fillStyle = '#ffffff';
            mctx.beginPath();
            circles.forEach(c => {
                mctx.moveTo(c.x + c.r, c.y);
                mctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
            });
            mctx.fill();
            mctx.restore();

            // Tint mask with zone color using source-in to avoid seam darkening
            mctx.globalCompositeOperation = 'source-in';
            mctx.fillStyle = zone.color;
            mctx.fillRect(0, 0, width, height);
            mctx.globalCompositeOperation = 'source-over';

            // Draw result onto main canvas
            ctx.drawImage(mask, minX, minY);
        });
    }

    drawWarningIcon(x, y, size = 30) {
        const ctx = this.ctx;
        const screenPos = this.worldToScreen(x, y);
        const screenSize = size * this.camera.zoom;

        // Only draw if visible on screen
        if (screenPos.x < -screenSize || screenPos.x > this.canvas.width + screenSize ||
            screenPos.y < -screenSize || screenPos.y > this.canvas.height + screenSize) {
            return;
        }

        // Blink effect
        const blinkIntensity = 0.5 + 0.5 * Math.sin(this.warningBlinkTime * 0.01);

        ctx.save();
        ctx.globalAlpha = blinkIntensity;

        // Draw warning triangle background
        ctx.fillStyle = '#ff4444';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1, 2 * this.camera.zoom);

        ctx.beginPath();
        ctx.moveTo(screenPos.x, screenPos.y - screenSize / 2);
        ctx.lineTo(screenPos.x - screenSize / 2, screenPos.y + screenSize / 2);
        ctx.lineTo(screenPos.x + screenSize / 2, screenPos.y + screenSize / 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Draw exclamation mark
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.max(12, screenSize * 0.6)}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('!', screenPos.x, screenPos.y);

        ctx.restore();
    }

    getCenterOfZone(zone) {
        if (!zone.points || zone.points.length === 0) return {x: 0, y: 0};

        let sumX = 0, sumY = 0;
        for (let point of zone.points) {
            sumX += point.x;
            sumY += point.y;
        }

        return {
            x: sumX / zone.points.length,
            y: sumY / zone.points.length
        };
    }

    drawZoneWarnings() {
        for (let i = 0; i < this.residentialZones.length; i++) {
            const isConnected = this.zoneConnections.get(i) || false;
            if (!isConnected) {
                const zone = this.residentialZones[i];
                const center = this.getCenterOfZone(zone);
                this.drawWarningIcon(center.x, center.y);
            }
        }
    }

    drawZonePreview(zone) {
        const ctx = this.ctx;
        const screenPos = this.worldToScreen(zone.x, zone.y);
        const screenRadius = zone.radius * this.camera.zoom;

        ctx.save();
        ctx.globalAlpha = 0.7;

        // Special handling for eraser mode
        if (zone.pattern === 'eraser') {
            // Draw red eraser circle with X pattern
            ctx.fillStyle = zone.color || 'rgba(255, 69, 69, 0.6)';
            ctx.beginPath();
            ctx.arc(screenPos.x, screenPos.y, screenRadius, 0, 2 * Math.PI);
            ctx.fill();

            // Draw X pattern inside eraser circle
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.lineWidth = Math.max(2, 3 * this.camera.zoom);
            ctx.beginPath();
            const crossSize = screenRadius * 0.6;
            ctx.moveTo(screenPos.x - crossSize, screenPos.y - crossSize);
            ctx.lineTo(screenPos.x + crossSize, screenPos.y + crossSize);
            ctx.moveTo(screenPos.x + crossSize, screenPos.y - crossSize);
            ctx.lineTo(screenPos.x - crossSize, screenPos.y + crossSize);
            ctx.stroke();

            // Draw pulsing red border
            const pulseIntensity = 0.7 + 0.3 * Math.sin(performance.now() * 0.008);
            ctx.globalAlpha = pulseIntensity;
            ctx.setLineDash([6, 4]);
            ctx.strokeStyle = zone.borderColor || 'rgba(255, 0, 0, 1.0)';
            ctx.lineWidth = Math.max(2, 3 * this.camera.zoom);
            ctx.beginPath();
            ctx.arc(screenPos.x, screenPos.y, screenRadius, 0, 2 * Math.PI);
            ctx.stroke();
        } else {
            // Normal build mode preview
            ctx.fillStyle = zone.color || 'rgba(76, 175, 80, 0.4)';
            ctx.beginPath();
            ctx.arc(screenPos.x, screenPos.y, screenRadius, 0, 2 * Math.PI);
            ctx.fill();

            // Draw clear dashed border for preview
            ctx.setLineDash([8, 4]);
            ctx.strokeStyle = zone.borderColor || 'rgba(60, 140, 60, 1.0)';
            ctx.lineWidth = Math.max(1, 2 * this.camera.zoom);
            ctx.beginPath();
            ctx.arc(screenPos.x, screenPos.y, screenRadius, 0, 2 * Math.PI);
            ctx.stroke();
        }

        ctx.restore();
    }

    drawBuildings() {
        this.buildings.forEach(building => {
            this.drawBuilding(building);
        });
    }

    drawBuilding(building) {
        const ctx = this.ctx;

        if (building.type === 'house') {
            // Draw walls
            ctx.fillStyle = '#8B4513'; // Brown color for walls
            building.walls.forEach(wall => {
                const screenPos = this.worldToScreen(building.x + wall.x, building.y + wall.y);
                ctx.fillRect(
                    screenPos.x,
                    screenPos.y,
                    wall.width * this.camera.zoom,
                    wall.height * this.camera.zoom
                );
            });

            // Draw door opening (darker green background visible)
            const door = building.doorOpening;
            const doorScreenPos = this.worldToScreen(building.x + door.x, building.y + door.y);
            ctx.fillStyle = '#2a4a2a'; // Dark green for door opening
            ctx.fillRect(
                doorScreenPos.x,
                doorScreenPos.y,
                door.width * this.camera.zoom,
                door.height * this.camera.zoom
            );
        }
    }

    drawBuildingPreview(building) {
        const ctx = this.ctx;
        ctx.save();
        ctx.globalAlpha = 0.6;

        if (building.type === 'house') {
            // Draw preview walls with lighter color
            ctx.fillStyle = '#D2B48C'; // Light brown for preview
            building.walls.forEach(wall => {
                const screenPos = this.worldToScreen(building.x + wall.x, building.y + wall.y);
                ctx.fillRect(
                    screenPos.x,
                    screenPos.y,
                    wall.width * this.camera.zoom,
                    wall.height * this.camera.zoom
                );
            });

            // Draw preview door opening
            const door = building.doorOpening;
            const doorScreenPos = this.worldToScreen(building.x + door.x, building.y + door.y);
            ctx.fillStyle = '#4a6a4a'; // Light green for door preview
            ctx.fillRect(
                doorScreenPos.x,
                doorScreenPos.y,
                door.width * this.camera.zoom,
                door.height * this.camera.zoom
            );
        }

        ctx.restore();
    }

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

// Start the game when the page loads
window.addEventListener('load', () => {
    new Game();
});
