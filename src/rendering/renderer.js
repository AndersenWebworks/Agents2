export function attachRenderingMethods(proto) {

    proto.worldToScreen = function (worldX, worldY) {
        return {
            x: (worldX - this.camera.x) * this.camera.zoom,
            y: (worldY - this.camera.y) * this.camera.zoom
        };
    };

    proto.screenToWorld = function (screenX, screenY) {
        return {
            x: (screenX / this.camera.zoom) + this.camera.x,
            y: (screenY / this.camera.zoom) + this.camera.y
        };
    };

    proto.drawGrid = function () {
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
    };

    proto.drawWorldBounds = function () {
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
    };

    proto.drawAgents = function () {
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
    };

    proto.drawAgentTerritory = function (agent) {
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
    };

    proto.generateOptimalPolygonTerritory = function (agent) {
        const x = agent.finalPosition.x;
        const y = agent.finalPosition.y;

        // Scan available space in all directions
        const boundaries = this.scanAvailableSpace(x, y, agent);

        // Generate polygon that maximally uses available space
        return this.createOptimalPolygon(x, y, boundaries);
    };

    proto.scanAvailableSpace = function (x, y, currentAgent) {
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
    };

    proto.castRayForBoundary = function (startX, startY, dirX, dirY, maxDistance, currentAgent) {
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
    };

    proto.createOptimalPolygon = function (centerX, centerY, boundaries) {
        // Use boundary points to create polygon
        const points = boundaries.map(b => ({ x: b.x, y: b.y }));

        // Smooth the polygon to avoid sharp angles
        const smoothedPoints = this.smoothPolygonPoints(points);

        return {
            points: smoothedPoints,
            center: { x: centerX, y: centerY }
        };
    };

    proto.smoothPolygonPoints = function (points) {
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
    };

    proto.findNearestRoadDirection = function (x, y) {
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
    };

    proto.drawHouseOnLot = function (agent) {
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
    };

    proto.drawWaypoints = function () {
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
    };

    proto.drawGrassBackground = function () {
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
    };

    proto.render = function () {
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
    };

    proto.drawResidentialZones = function () {
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
    };

    proto.drawZoneUsingCache = function (ctx, zone, index, zoneType) {
        // This would use cached rendering - simplified for now
        this.drawZoneDynamic(ctx, zone);
    };

    proto.drawZoneDynamic = function (ctx, zone) {
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
    };

    proto.drawRoadZones = function () {
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
    };

    proto.drawWarningIcon = function (x, y, size = 30) {
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
    };

    proto.getCenterOfZone = function (zone) {
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
    };

    proto.drawZoneWarnings = function () {
        for (let i = 0; i < this.residentialZones.length; i++) {
            const isConnected = this.zoneConnections.get(i) || false;
            if (!isConnected) {
                const zone = this.residentialZones[i];
                const center = this.getCenterOfZone(zone);
                this.drawWarningIcon(center.x, center.y);
            }
        }
    };

    proto.drawZonePreview = function (zone) {
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
    };

    proto.drawBuildings = function () {
        this.buildings.forEach(building => {
            this.drawBuilding(building);
        });
    };

    proto.drawBuilding = function (building) {
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
    };

    proto.drawBuildingPreview = function (building) {
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
    };

}
