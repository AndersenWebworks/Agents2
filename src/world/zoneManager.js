export const zoneMethods = {
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
    },

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
    },

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
    },

    calculateVelocity(p1, p2) {
        const distance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const timeDelta = Math.max(1, p2.time - p1.time); // Avoid division by zero
        return distance / timeDelta * 1000; // pixels per second
    },

    calculateQuadraticBezier(p0, p1, p2, t) {
        const oneMinusT = 1 - t;
        return {
            x: oneMinusT * oneMinusT * p0.x + 2 * oneMinusT * t * p1.x + t * t * p2.x,
            y: oneMinusT * oneMinusT * p0.y + 2 * oneMinusT * t * p1.y + t * t * p2.y
        };
    },

    paintZoneAtPoint(x, y, customBrushSize = null) {
        const originalBrushSize = this.buildMode.brushSize;
        if (customBrushSize) {
            this.buildMode.brushSize = customBrushSize;
        }

        this.paintZone(x, y, true);

        // Restore original brush size
        this.buildMode.brushSize = originalBrushSize;
    },

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

            // Check if the new point overlaps with existing road zones - roads are dominant
            const overlapRadius = this.buildMode.brushSize;
            let overlapsWithRoad = false;
            for (let i = 0; i < this.roadZones.length; i++) {
                const zone = this.roadZones[i];
                for (let j = 0; j < zone.points.length; j++) {
                    const point = zone.points[j];
                    const distance = Math.hypot(x - point.x, y - point.y);
                    if (distance < overlapRadius) {
                        overlapsWithRoad = true;
                        break;
                    }
                }
                if (overlapsWithRoad) break;
            }

            // Skip placing residential zone if it overlaps with roads
            if (overlapsWithRoad) {
                return;
            }

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
    },

    invalidateZoneCache(zoneType) {
        if (zoneType === 'residential' || zoneType === 'all') {
            this.zoneCache.residential.clear();
        }
        if (zoneType === 'road' || zoneType === 'all') {
            this.zoneCache.road.clear();
        }
    },

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
    },

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
    },
};
