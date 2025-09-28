export function attachUiMethods(proto) {

    proto.setupBuildMenu = function () {
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
    };

    proto.activateBuildMode = function (buildType, brushSize) {
        this.buildMode.active = true;
        this.buildMode.selectedType = buildType;
        this.buildMode.brushSize = brushSize;

        // Update UI
        document.getElementById('buildMode').style.display = 'block';
        this.updateBuildModeUI();

        // Change cursor
        this.canvas.style.cursor = 'crosshair';
    };

    proto.deactivateBuildMode = function () {
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
    };

    proto.updateBuildModeUI = function () {
        const sel = this.buildMode.selectedType || 'None';
        const size = this.buildMode.brushSize;
        const mode = this.buildMode.eraser ? 'Eraser' : 'Brush';
        document.getElementById('selectedBuildItem').textContent = `${sel} (${size}px, ${mode})`;
    };

    proto.resizeCanvas = function () {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    };

    proto.setupEventListeners = function () {
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
    };

    proto.updatePerformanceMetrics = function () {
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
    };

    proto.updateUI = function () {
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
    };

}
