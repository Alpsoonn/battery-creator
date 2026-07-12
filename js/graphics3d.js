// 3D Graphics Engine - Three.js WebGL - Global Script
// Renders the spatial 3D model of the battery pack, physical nickel strips, insulation, and applies the thermal heatmap

class Graphics3D {
  constructor() {
    this.container = null;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.cellsGroup = null;
    this.frameGroup = null;
    this.ctrlGroup = null;
    this.stripsGroup = null;
    
    this.isInitialized = false;
    this.animationId = null;
  }

  init(container) {
    if (this.isInitialized) return;
    this.container = container;
    
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 500;
    
    // 1. Create Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f172a);
    
    // 2. Create Camera
    this.camera = new THREE.PerspectiveCamera(45, width / height, 1, 3000);
    this.camera.position.set(0, 450, 600);
    
    // 3. Create WebGL Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    // Clear container and append canvas
    container.innerHTML = '';
    container.appendChild(this.renderer.domElement);
    
    // 4. Create Orbit Controls
    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05; // don't go below floor
    
    // 5. Add Lights
    this.addLights();
    
    // 6. Add Helper Groups
    this.cellsGroup = new THREE.Group();
    this.frameGroup = new THREE.Group();
    this.ctrlGroup = new THREE.Group();
    this.stripsGroup = new THREE.Group();
    
    this.scene.add(this.cellsGroup);
    this.scene.add(this.frameGroup);
    this.scene.add(this.ctrlGroup);
    this.scene.add(this.stripsGroup);
    
    // Add grid floor
    const gridFloor = new THREE.GridHelper(1500, 50, 0x334155, 0x1e293b);
    gridFloor.position.y = -21.5;
    this.scene.add(gridFloor);
    
    this.isInitialized = true;
    
    // Resize Listener
    window.addEventListener('resize', this.handleResize.bind(this));
    
    // Start animation loop
    this.animate();
  }

  addLights() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
    this.scene.add(ambientLight);
    
    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight1.position.set(200, 400, 300);
    dirLight1.castShadow = true;
    dirLight1.shadow.mapSize.width = 1024;
    dirLight1.shadow.mapSize.height = 1024;
    dirLight1.shadow.camera.near = 0.5;
    dirLight1.shadow.camera.far = 1500;
    
    const d = 500;
    dirLight1.shadow.camera.left = -d;
    dirLight1.shadow.camera.right = d;
    dirLight1.shadow.camera.top = d;
    dirLight1.shadow.camera.bottom = -d;
    this.scene.add(dirLight1);
    
    const dirLight2 = new THREE.DirectionalLight(0x38bdf8, 0.3); // blueish rim fill
    dirLight2.position.set(-200, 200, -300);
    this.scene.add(dirLight2);
  }

  handleResize() {
    if (!this.isInitialized || !this.container) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  animate() {
    if (!this.isInitialized) return;
    this.animationId = requestAnimationFrame(this.animate.bind(this));
    
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    this.isInitialized = false;
    window.removeEventListener('resize', this.handleResize);
  }

  updatePack(state) {
    if (!this.isInitialized) return;
    
    // Clear existing groups
    this.clearGroup(this.cellsGroup);
    this.clearGroup(this.frameGroup);
    this.clearGroup(this.ctrlGroup);
    this.clearGroup(this.stripsGroup);
    
    const isManual = state.isManualMode;
    const cells = isManual ? state.manual.cells : state.geometry.cells;
    const tri = isManual ? null : state.geometry.triInfo;
    const controller = isManual ? state.manual.controller : state.geometry.controller;
    const controllerOn = isManual ? state.manual.controllerOn : state.geometry.controllerOn;
    
    if (cells.length === 0) return;
    
    const cellDiameter = isManual ? state.manual.cellType : state.geometry.cellType;
    const cellHeight = 70; // 70mm height for 18650 / 21700
    
    // 1. Center OrbitControls target around battery pack
    const xs = cells.map(c => c.x);
    const ys = cells.map(c => c.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    
    // Translate cellsGroup and groups to be centered at origin in 3D
    this.cellsGroup.position.set(-cx, 0, -cy);
    this.frameGroup.position.set(-cx, 0, -cy);
    this.ctrlGroup.position.set(-cx, 0, -cy);
    this.stripsGroup.position.set(-cx, 0, -cy);
    
    this.controls.target.set(0, 0, 0);
    
    // 2. Build Cells (Cylinders)
    const cellGeom = new THREE.CylinderGeometry(cellDiameter / 2, cellDiameter / 2, cellHeight, 32);
    
    const colors = [
      0x2b6cb0, 0xc05621, 0x2f855a, 0x805ad5, 0xb83280,
      0x0f766e, 0xb7791f, 0x4a5568, 0xdd6b20, 0x3182ce,
      0x38a169, 0x9f7aea, 0xd53f8c, 0x319795, 0x718096,
      0xe53e3e, 0x667eea, 0x975a16, 0x2c7a7b, 0x6b46c1
    ];
    
    const defaultColor = 0xd8dee8;
    const simResults = state.simulation.results;
    
    cells.forEach((cell, idx) => {
      // Cell temperature coloring fallback, or section color
      let hexColor = defaultColor;
      
      if (state.currentStage === 3 && simResults && simResults.cellTemps) {
        // FEM thermal analysis state - thermal heatmap coloring
        const temp = simResults.cellTemps[idx] || 25.0;
        const ratio = Math.max(0, Math.min(1, (temp - 25.0) / 50.0));
        const color = new THREE.Color();
        color.setHSL((1.0 - ratio) * 0.33, 1.0, 0.45); // green -> yellow -> red
        hexColor = color.getHex();
      } else if (cell.section !== null && cell.section !== undefined && cell.section >= 0) {
        hexColor = colors[cell.section % colors.length];
      }
      
      // Cell body material (shiny plastic shrink wrap)
      const cellMat = new THREE.MeshStandardMaterial({
        color: hexColor,
        roughness: 0.18,
        metalness: 0.1,
        clearcoat: 0.4
      });
      
      const mesh = new THREE.Mesh(cellGeom, cellMat);
      mesh.position.set(cell.x, 0, cell.y); // y-axis is height in Three.js
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      
      // Metal terminals (metallic caps)
      const capGeom = new THREE.CylinderGeometry(cellDiameter / 3, cellDiameter / 3, 1, 16);
      const capMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.9, roughness: 0.2 });
      
      const capTop = new THREE.Mesh(capGeom, capMat);
      capTop.position.set(0, cellHeight / 2 + 0.5, 0);
      mesh.add(capTop);
      
      const capBottom = new THREE.Mesh(capGeom, capMat);
      capBottom.position.set(0, -cellHeight / 2 - 0.5, 0);
      mesh.add(capBottom);
      
      this.cellsGroup.add(mesh);
    });
    
    // 3. Build Frame Acrylic Plates (top/bottom plates)
    if (!isManual && tri && tri.points) {
      this.build3DFramePlates(tri.points, cellHeight);
    }
    
    // 4. Build Controller Box
    if (controller && controllerOn) {
      const ctrlGeom = new THREE.BoxGeometry(controller.w, cellHeight - 4, controller.h);
      const ctrlMat = new THREE.MeshStandardMaterial({
        color: 0x222530,
        roughness: 0.5,
        metalness: 0.7
      });
      
      const ctrlMesh = new THREE.Mesh(ctrlGeom, ctrlMat);
      ctrlMesh.position.set(controller.cx, 0, controller.cy);
      ctrlMesh.rotation.y = -(controller.angle || 0) * Math.PI / 180;
      ctrlMesh.castShadow = true;
      ctrlMesh.receiveShadow = true;
      
      this.ctrlGroup.add(ctrlMesh);
    }
    
    // 5. Build Connections (Nickel Strips)
    if (state.currentStage >= 2 && cells.length > 0) {
      this.build3DStrips(cells, cellHeight, cellDiameter);
    }
  }

  build3DFramePlates(points, cellHeight) {
    const shape = new THREE.Shape();
    shape.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      shape.lineTo(points[i].x, points[i].y);
    }
    shape.closePath();
    
    const extrudeSettings = {
      depth: 3, // 3mm thickness plate
      bevelEnabled: true,
      bevelSegments: 2,
      steps: 1,
      bevelSize: 0.8,
      bevelThickness: 0.8
    };
    
    const plateGeom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    
    // Black transparent acrylic plates
    const plateMat = new THREE.MeshPhysicalMaterial({
      color: 0x111827,
      transparent: true,
      opacity: 0.45,
      roughness: 0.1,
      transmission: 0.5,
      thickness: 3.0,
      clearcoat: 0.8
    });
    
    // Top Plate
    const topPlate = new THREE.Mesh(plateGeom, plateMat);
    topPlate.rotation.x = Math.PI / 2;
    topPlate.position.y = cellHeight / 2 + 3; // resting above cells
    topPlate.receiveShadow = true;
    this.frameGroup.add(topPlate);
    
    // Bottom Plate
    const bottomPlate = new THREE.Mesh(plateGeom, plateMat);
    bottomPlate.rotation.x = Math.PI / 2;
    bottomPlate.position.y = -cellHeight / 2 - 6;
    bottomPlate.receiveShadow = true;
    this.frameGroup.add(bottomPlate);
    
    // Structural pillars (standoffs in corners)
    const pillarGeom = new THREE.CylinderGeometry(4, 4, cellHeight + 6, 16);
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.25 });
    
    points.forEach(pt => {
      const pillar = new THREE.Mesh(pillarGeom, pillarMat);
      pillar.position.set(pt.x, -1.5, pt.y);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      this.frameGroup.add(pillar);
    });
  }

  build3DStrips(cells, cellHeight, cellDiameter) {
    const pitch = cellDiameter + 1.5;
    const maxNeighDist = pitch * 1.35;
    
    // Nickel physical material
    const stripMatFront = new THREE.MeshStandardMaterial({ color: 0xef4444, metalness: 0.8, roughness: 0.3 }); // S connections red
    const stripMatBack = new THREE.MeshStandardMaterial({ color: 0x3b82f6, metalness: 0.8, roughness: 0.3 }); // P connections blue
    
    const N = cells.length;
    for (let i = 0; i < N; i++) {
      const c1 = cells[i];
      if (c1.section === null || c1.section === undefined) continue;
      
      for (let j = i + 1; j < N; j++) {
        const c2 = cells[j];
        if (c2.section === null || c2.section === undefined) continue;
        
        const dist = Math.hypot(c1.x - c2.x, c1.y - c2.y);
        if (dist <= maxNeighDist) {
          const isFront = (c1.section % 2 === 0);
          const mat = isFront ? stripMatFront : stripMatBack;
          
          // Render a simple flat metal bar between cells
          const width = 8; // 8mm nickel width
          const thickness = 0.15; // 0.15mm thickness
          
          const boxGeom = new THREE.BoxGeometry(width, thickness, dist);
          const mesh = new THREE.Mesh(boxGeom, mat);
          
          // Place strip
          const cx = (c1.x + c2.x) / 2;
          const cy = (c1.y + c2.y) / 2;
          const angle = Math.atan2(c2.x - c1.x, c2.y - c1.y);
          
          // S-series connections on top plate, parallel P-connections on bottom plate
          const planeY = (c1.section === c2.section) ? (cellHeight / 2 + 0.6) : (-cellHeight / 2 - 0.6);
          
          mesh.position.set(cx, planeY, cy);
          mesh.rotation.y = angle;
          
          this.stripsGroup.add(mesh);
        }
      }
    }
  }

  clearGroup(group) {
    while (group.children.length > 0) {
      const obj = group.children[0];
      group.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    }
  }
}

// Global instance
window.graphics3D = new Graphics3D();
