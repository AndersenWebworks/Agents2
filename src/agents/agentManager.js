export function attachAgentMethods(proto) {
    proto.generateAdaptiveLot = function (agent) {
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
    };

    proto.calculateAvailableDepth = function (startX, startY, direction, maxDepth) {
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
    };

    proto.calculateAvailableWidth = function (centerX, centerY, roadDirection, maxWidth) {
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
    };

    proto.isPositionInResidentialZone = function (x, y) {
        for (let zone of this.residentialZones) {
            for (let point of zone.points) {
                const distance = Math.hypot(x - point.x, y - point.y);
                if (distance <= point.radius) {
                    return true;
                }
            }
        }
        return false;
    };

    proto.isPositionOccupiedByOtherAgent = function (x, y) {
        for (let agent of this.agents) {
            const distance = Math.hypot(x - agent.x, y - agent.y);
            if (distance < this.MIN_AGENT_DISTANCE) {
                return true;
            }
        }
        return false;
    };

    proto.generateCircularLot = function (x, y, radius) {
        const points = [];
        const segments = 8;

        for (let i = 0; i < segments; i++) {
            const angle = (Math.PI * 2 * i) / segments;
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
    };

    proto.isPointInPolygon = function (x, y, polygonPoints) {
        let isInside = false;
        let j = polygonPoints.length - 1;

        for (let i = 0; i < polygonPoints.length; i++) {
            const pointI = polygonPoints[i];
            const pointJ = polygonPoints[j];

            const intersects = ((pointI.y > y) !== (pointJ.y > y)) &&
                (x < (pointJ.x - pointI.x) * (y - pointI.y) / (pointJ.y - pointI.y) + pointI.x);

            if (intersects) {
                isInside = !isInside;
            }

            j = i;
        }

        return isInside;
    };

    proto.doPolygonsOverlap = function (poly1Points, poly2Points) {
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
    };

    proto.findRoadConnectionsAtEdge = function () {
        const connections = [];
        const step = 50;

        const edges = [
            { start: { x: 0, y: 0 }, end: { x: this.worldWidth, y: 0 }, dir: 'horizontal' },
            { start: { x: 0, y: this.worldHeight }, end: { x: this.worldWidth, y: this.worldHeight }, dir: 'horizontal' },
            { start: { x: 0, y: 0 }, end: { x: 0, y: this.worldHeight }, dir: 'vertical' },
            { start: { x: this.worldWidth, y: 0 }, end: { x: this.worldWidth, y: this.worldHeight }, dir: 'vertical' }
        ];

        edges.forEach(edge => {
            if (edge.dir === 'horizontal') {
                for (let x = edge.start.x; x <= edge.end.x; x += step) {
                    if (this.isOnRoad(x, edge.start.y)) {
                        connections.push({ x, y: edge.start.y });
                    }
                }
            } else {
                for (let y = edge.start.y; y <= edge.end.y; y += step) {
                    if (this.isOnRoad(edge.start.x, y)) {
                        connections.push({ x: edge.start.x, y });
                    }
                }
            }
        });

        return connections;
    };

    proto.checkZoneConnection = function (zoneIndex) {
        if (zoneIndex >= this.residentialZones.length) return false;

        const zone = this.residentialZones[zoneIndex];
        const edgeConnections = this.findRoadConnectionsAtEdge();

        if (edgeConnections.length === 0) return false;

        for (let startPoint of edgeConnections) {
            if (this.pathExistsToZone(startPoint, zone)) {
                return true;
            }
        }

        return false;
    };

    proto.pathExistsToZone = function (startPoint, targetZone) {
        const visited = new Set();
        const queue = [startPoint];
        const step = this.PATHFINDING_STEP_SIZE;

        while (queue.length > 0) {
            const current = queue.shift();
            const key = `${Math.floor(current.x / step)},${Math.floor(current.y / step)}`;

            if (visited.has(key)) continue;
            visited.add(key);

            if (this.isPointInZone(current, targetZone)) {
                return true;
            }

            const neighbors = [
                { x: current.x + step, y: current.y },
                { x: current.x - step, y: current.y },
                { x: current.x, y: current.y + step },
                { x: current.x, y: current.y - step }
            ];

            for (let neighbor of neighbors) {
                if (neighbor.x < 0 || neighbor.x > this.worldWidth ||
                    neighbor.y < 0 || neighbor.y > this.worldHeight) continue;

                const neighborKey = `${Math.floor(neighbor.x / step)},${Math.floor(neighbor.y / step)}`;
                if (visited.has(neighborKey)) continue;

                if (this.isOnRoad(neighbor.x, neighbor.y) || this.isPointInZone(neighbor, targetZone)) {
                    queue.push(neighbor);
                }
            }
        }

        return false;
    };

    proto.findPathToZone = function (startPoint, targetZone) {
        const visited = new Set();
        const queue = [{ point: startPoint, path: [startPoint] }];
        const step = this.PATHFINDING_STEP_SIZE;

        while (queue.length > 0) {
            const current = queue.shift();
            const key = `${Math.floor(current.point.x / step)},${Math.floor(current.point.y / step)}`;

            if (visited.has(key)) continue;
            visited.add(key);

            if (this.isPointInZone(current.point, targetZone)) {
                return [...current.path, current.point];
            }

            const neighbors = [
                { x: current.point.x + step, y: current.point.y },
                { x: current.point.x - step, y: current.point.y },
                { x: current.point.x, y: current.point.y + step },
                { x: current.point.x, y: current.point.y - step }
            ];

            for (let neighbor of neighbors) {
                if (neighbor.x < 0 || neighbor.x > this.worldWidth ||
                    neighbor.y < 0 || neighbor.y > this.worldHeight) continue;

                const neighborKey = `${Math.floor(neighbor.x / step)},${Math.floor(neighbor.y / step)}`;
                if (visited.has(neighborKey)) continue;

                if (this.isOnRoad(neighbor.x, neighbor.y) || this.isPointInZone(neighbor, targetZone)) {
                    queue.push({
                        point: neighbor,
                        path: [...current.path, neighbor]
                    });
                }
            }
        }

        return [startPoint];
    };

    proto.isPointInZone = function (point, zone) {
        for (let zonePoint of zone.points) {
            const distance = Math.hypot(point.x - zonePoint.x, point.y - zonePoint.y);
            if (distance <= zonePoint.radius) {
                return true;
            }
        }
        return false;
    };

    proto.updateAllConnections = function () {
        for (let i = 0; i < this.residentialZones.length; i++) {
            const wasConnected = this.zoneConnections.get(i) || false;
            const isConnected = this.checkZoneConnection(i);
            this.zoneConnections.set(i, isConnected);

            if (!wasConnected && isConnected) {
                this.spawnAgentsForZone(i);
            } else if (wasConnected && !isConnected) {
                this.removeAgentsFromZone(i);
            } else if (isConnected) {
                this.updateAgentsForZone(i);
            }
        }
    };

    proto.updateAgentsForZone = function (zoneIndex) {
        const zone = this.residentialZones[zoneIndex];
        const maxAgents = this.calculateMaxAgents(zone);
        const existingAgents = this.agents.filter(agent => agent.targetZoneIndex === zoneIndex);
        const agentsToSpawn = maxAgents - existingAgents.length;

        if (agentsToSpawn > 0) {
            for (let i = 0; i < agentsToSpawn; i++) {
                const finalPosition = this.findFreePositionInZone(zone, existingAgents);
                if (!finalPosition) break;

                const spawnPoint = this.findRandomEdgeConnection();
                if (!spawnPoint) break;

                const closestNodeToFinalPosition = this.findClosestNetworkPoint(finalPosition.x, finalPosition.y);

                let pathToNode = [];
                if (this.roadNetwork.points.length > 0) {
                    const startPointId = this.findClosestNetworkPoint(spawnPoint.x, spawnPoint.y);
                    if (startPointId >= 0 && closestNodeToFinalPosition >= 0) {
                        pathToNode = this.findNetworkPathBetweenNodes(startPointId, closestNodeToFinalPosition);
                    }
                }

                if (pathToNode.length === 0) {
                    pathToNode = this.findPathToZone(spawnPoint, zone);
                }

                const agent = {
                    x: spawnPoint.x,
                    y: spawnPoint.y,
                    targetZoneIndex: zoneIndex,
                    finalPosition,
                    closestNodeToFinalPosition,
                    pathToNode,
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
    };

    proto.calculateMaxAgents = function (zone) {
        let totalArea = 0;
        for (let point of zone.points) {
            totalArea += Math.PI * point.radius * point.radius;
        }

        const agentArea = Math.PI * 50 * 50;
        const packingEfficiency = this.PACKING_EFFICIENCY;
        const maxAgents = Math.floor((totalArea / agentArea) * packingEfficiency);

        console.log(`Zonenfläche: ${totalArea.toFixed(0)}, Agent-Fläche: ${agentArea.toFixed(0)}, Max. Agenten: ${maxAgents}`);

        return Math.max(0, Math.min(maxAgents, this.MAX_AGENTS_PER_ZONE));
    };

    proto.findFreePositionInZone = function (zone, existingAgents = []) {
        const maxAttempts = this.MAX_PATHFINDING_ATTEMPTS;
        const minDistance = this.MIN_AGENT_DISTANCE;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const randomPoint = zone.points[Math.floor(Math.random() * zone.points.length)];
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * (randomPoint.radius - 55);
            const x = randomPoint.x + Math.cos(angle) * distance;
            const y = randomPoint.y + Math.sin(angle) * distance;

            let isFree = true;
            for (let agent of existingAgents) {
                const checkX = agent.finalPosition ? agent.finalPosition.x : agent.x;
                const checkY = agent.finalPosition ? agent.finalPosition.y : agent.y;

                if (Math.hypot(x - checkX, y - checkY) < minDistance) {
                    isFree = false;
                    break;
                }
            }

            if (isFree) {
                return { x, y };
            }
        }

        return null;
    };

    proto.findRandomEdgeConnection = function () {
        if (this.roadNetwork.edgePoints.length > 0) {
            const randomEdgeId = this.roadNetwork.edgePoints[Math.floor(Math.random() * this.roadNetwork.edgePoints.length)];
            return this.roadNetwork.points[randomEdgeId];
        }

        const edgeConnections = this.findRoadConnectionsAtEdge();
        if (edgeConnections.length === 0) return null;
        return edgeConnections[Math.floor(Math.random() * edgeConnections.length)];
    };

    proto.spawnAgentsForZone = function (zoneIndex) {
        const zone = this.residentialZones[zoneIndex];
        const maxAgents = this.calculateMaxAgents(zone);
        const existingAgents = this.agents.filter(agent => agent.targetZoneIndex === zoneIndex);
        const agentsToSpawn = maxAgents - existingAgents.length;

        for (let i = 0; i < agentsToSpawn; i++) {
            const finalPosition = this.findFreePositionInZone(zone, existingAgents);
            if (!finalPosition) break;

            const spawnPoint = this.findRandomEdgeConnection();
            if (!spawnPoint) break;

            const closestNodeToFinalPosition = this.findClosestNetworkPoint(finalPosition.x, finalPosition.y);

            let pathToNode = [];
            if (this.roadNetwork.points.length > 0) {
                const startPointId = this.findClosestNetworkPoint(spawnPoint.x, spawnPoint.y);
                if (startPointId >= 0 && closestNodeToFinalPosition >= 0) {
                    pathToNode = this.findNetworkPathBetweenNodes(startPointId, closestNodeToFinalPosition);
                }
            }

            if (pathToNode.length === 0) {
                pathToNode = this.findPathToZone(spawnPoint, zone);
            }

            const agentConfig = {
                x: spawnPoint.x,
                y: spawnPoint.y,
                targetZoneIndex: zoneIndex,
                finalPosition,
                closestNodeToFinalPosition,
                pathToNode,
                pathToNodeIndex: 0,
                phase: 'traveling_to_node',
                speed: 2,
                radius: 10,
                color: '#ffff00'
            };

            this.agentSpawnQueue.push(agentConfig);
            existingAgents.push({ finalPosition });
        }
    };

    proto.removeAgentsFromZone = function (zoneIndex) {
        // Remove all agents that belong to this zone
        this.agents = this.agents.filter(agent => agent.targetZoneIndex !== zoneIndex);
    };

    proto.processAgentSpawnQueue = function () {
        const currentTime = performance.now();

        // Check if enough time has passed since last spawn
        if (currentTime - this.lastSpawnTime >= this.spawnDelay && this.agentSpawnQueue.length > 0) {
            const agentConfig = this.agentSpawnQueue.shift();

            // Create and add the agent
            this.agents.push(agentConfig);

            this.lastSpawnTime = currentTime;
        }
    };

    proto.updateAgents = function () {
        for (let agent of this.agents) {
            if (agent.phase === 'traveling_to_node') {
                this.updateAgentTravelingToNode(agent);
            } else if (agent.phase === 'traveling_to_area') {
                this.updateAgentTravelingToArea(agent);
            } else if (agent.phase === 'settling') {
                this.updateAgentSettling(agent);
            }
        }
    };

    proto.updateAgentTravelingToNode = function (agent) {
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
    };

    proto.updateAgentTravelingToArea = function (agent) {
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
    };

    proto.updateAgentSettling = function (agent) {
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
    };

}
