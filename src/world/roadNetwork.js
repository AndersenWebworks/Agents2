export function attachRoadNetworkMethods(proto) {
    proto.buildRoadNetwork = function () {
        try {
            console.log('🚧  Erstelle organisches Straßennetzwerk...');

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
    };

    proto.extractRoadCenterline = function (zone, addWaypoint) {
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
    };

    proto.traceRoadSegment = function (roadPoints, startIndex, processedPoints) {
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
    };

    proto.createWaypointsForSegment = function (segment, addWaypoint) {
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
    };

    proto.sortPointsForFlow = function (points) {
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
    };

    proto.connectNearbyWaypoints = function () {
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
    };

    proto.identifyIntersections = function () {
        for (let i = 0; i < this.roadNetwork.points.length; i++) {
            const connections = this.roadNetwork.connections[i];

            if (connections.length >= 3) {
                // Mark as intersection point
                this.roadNetwork.points[i].isIntersection = true;

                // Check if we need additional waypoints around the intersection
                this.enhanceIntersection(i);
            }
        }
    };

    proto.enhanceIntersection = function (intersectionIndex) {
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
    };

    proto.optimizeIntersectionConnections = function () {
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
    };

    proto.hasRoadPathBetween = function (pointA, pointB) {
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
    };

    proto.identifyEdgePoints = function () {
        const edgeThreshold = this.EDGE_THRESHOLD;

        for (let i = 0; i < this.roadNetwork.points.length; i++) {
            const point = this.roadNetwork.points[i];

            if (point.x <= edgeThreshold || point.x >= this.worldWidth - edgeThreshold ||
                point.y <= edgeThreshold || point.y >= this.worldHeight - edgeThreshold) {
                this.roadNetwork.edgePoints.push(i);
            }
        }
    };

    proto.findZoneEntryPoints = function () {
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
    };

    proto.findNetworkPath = function (startPointId, targetZoneIndex) {
        const entryPoints = this.roadNetwork.zoneEntries.get(targetZoneIndex);
        if (!entryPoints || entryPoints.length === 0) {
            return [];
        }

        // Simple BFS to nearest zone entry point
        const visited = new Set();
        const queue = [{ pointId: startPointId, path: [startPointId] }];

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
    };

    proto.findNetworkPathBetweenNodes = function (startPointId, targetPointId) {
        if (startPointId === targetPointId) {
            return [this.roadNetwork.points[startPointId]];
        }

        // Simple BFS to target node
        const visited = new Set();
        const queue = [{ pointId: startPointId, path: [startPointId] }];

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
    };

    proto.findClosestNetworkPoint = function (x, y) {
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
    };

    proto.findNearestRoadSegment = function (x, y) {
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
    };

    proto.calculateRoadDirection = function (x, y) {
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
    };

    proto.calculatePerpendicularDirection = function (roadDirection) {
        // Perpendicular vector: if road direction is (x,y), perpendicular is (-y,x) or (y,-x)
        // We choose the direction that points away from road center
        return {
            x: -roadDirection.y,
            y: roadDirection.x
        };
    };

    proto.isOnRoad = function (x, y) {
        for (let zone of this.roadZones) {
            for (let point of zone.points) {
                const distance = Math.hypot(x - point.x, y - point.y);
                if (distance <= point.radius) {
                    return true;
                }
            }
        }
        return false;
    };
}
