import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GUI } from 'lil-gui';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

const isMobile = window.innerWidth < 768;

const settings = {
    count: isMobile ? 1000 : 2000, // Weniger Partikel auf dem Handy
    speedMultiplier: 0.6,
    glyphSize: 1.2,
    glyphType: 'Capsule', 
    dynamicScaling: false,
    opacity: 0.9,
    turbulence: 0.15,
    vorticity: 0.4,       
    laminarFactor: 0.4,   
    spawnSpread: 1.2,
    flowVariation: 0.4,
    colorSlow: "#00d4ff",
    colorFast: "#ff3300",
    colorMode: 'Velocity',
    moveMode: isMobile ? 'Spline' : 'Spline', // 'Step' ist CPU-schonender
    fadeRange: 0.05,
    showFlow: true,
    showPaths: true,
    // Szene & Lighting
    ambientIntensity: 0.8,
    directIntensity: 2.0,
    bgColor: "#00122c",
    zoom: 450,
    
    // Aorta Wand
    showAorta: true,
    aortaOpacity: 0.05,
    wireframe: false,
    aortaColor: "#ffffff",
    
    // Pfade
    modelPath: 'assets/models/sick_aorta_pathlines.glb',
    wallModelPath: 'assets/models/sick_aorta_mesh.glb',
    spawnRate: 4,
    pathStyle: 'Comets', // 'Tube', 'Glow', 'Basic', 'Comets', 'Flow', 'Ribbon'
    pathColor: '#ffffff',
    pathWidth: 1.2,
    pathOpacity: 0.5,

    // Herz-Puls Logic
    usePulse: false,
    bpm: 60,
    systoleRatio: 0.3,
    pulseBase: 0.12 
};

let scene, camera, renderer, controls, flowSystem, mainGroup, ambientLight, directLight;
let gizmoScene, gizmoCamera, gizmoRenderer, gizmoCube;
let flowPaths = [];
let currentPulse = 1.0;
let pulseHistory = new Array(100).fill(0);
let pulseCanvas, pulseCtx;
let pathLinesGroup; 

const dummy = new THREE.Object3D();
const colorHelper = new THREE.Color();
const vortexOffset = new THREE.Vector3(); // Global deklariert für Performance

const colorStagnation = new THREE.Color("#0000ff");
const colorNormal = new THREE.Color("#00ff44");
const colorStress = new THREE.Color("#ff0000");

async function init() {
    try {
        scene = new THREE.Scene();
        scene.background = new THREE.Color(settings.bgColor);
        mainGroup = new THREE.Group(); 
        scene.add(mainGroup);

        camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 5000);
        camera.position.set(0, 200, 500);

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        // Performance-Fix: PixelRatio auf Mobilgeräten deckeln
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.0));
        document.getElementById('canvas-container').appendChild(renderer.domElement);

        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true; // Geschmeidiger für Touch
        controls.dampingFactor = 0.05;

        initGizmo();

        ambientLight = new THREE.AmbientLight(0xffffff, settings.ambientIntensity);
        scene.add(ambientLight);
        
        directLight = new THREE.DirectionalLight(0xffffff, settings.directIntensity);
        directLight.position.set(100, 200, 150);
        scene.add(directLight);

        pulseCanvas = document.getElementById('pulse-canvas');
        if (pulseCanvas) pulseCtx = pulseCanvas.getContext('2d');

        const loader = new GLTFLoader();
        
        const [pathlinesGltf, wallGltf] = await Promise.all([
            loader.loadAsync(settings.modelPath),
            loader.loadAsync(settings.wallModelPath)
        ]);

        processPathlines(pathlinesGltf.scene);
        processWall(wallGltf.scene);
        
        const box = new THREE.Box3().setFromObject(mainGroup);
        const center = box.getCenter(new THREE.Vector3());
        mainGroup.position.set(-center.x, -center.y + 80, -center.z); // Zentrieren und nach oben schieben
        
        controls.target.set(0, 80, 0); // Kamera-Fokus auf das Modell setzen
        controls.update();

        rebuildPaths(); 
        rebuildSystem(); 
        setupGUI();
        alignCamera(0); // Start-Ansicht: Seite X
        animate();
    } catch (err) {
        console.error("Initialization Error:", err);
    }
}

function processPathlines(model) {
    flowPaths = [];
    model.updateMatrixWorld(true);
    model.traverse((child) => {
        if (child.isLine || child.name.toLowerCase().includes("flow") || child.isMesh) {
            const points = [];
            const posAttr = child.geometry.attributes.position;
            if (!posAttr) return;

            for (let i = 0; i < posAttr.count; i++) {
                let p = new THREE.Vector3().fromBufferAttribute(posAttr, i);
                p.applyMatrix4(child.matrixWorld);
                points.push(p);
            }
            if (points.length > 1) {
                const curve = new THREE.CatmullRomCurve3(points);
                const rawQuats = [];
                for (let i = 0; i < points.length; i++) {
                    const next = points[(i + 1) % points.length];
                    dummy.position.copy(points[i]);
                    dummy.lookAt(next);
                    rawQuats.push(new THREE.Quaternion().copy(dummy.quaternion));
                }
                flowPaths.push({ curve, points, quats: rawQuats, length: points.length });
            }
        }
    });
}

function rebuildPaths() {
    if (pathLinesGroup) mainGroup.remove(pathLinesGroup);
    pathLinesGroup = new THREE.Group();
    pathLinesGroup.visible = settings.showPaths;
    mainGroup.add(pathLinesGroup);

    if (flowPaths.length === 0) return;

    const color = new THREE.Color(settings.pathColor);

    flowPaths.forEach(path => {
        let pathObj;
        const isSolid = settings.colorMode === 'Solid';
        
        // Calculate vertex colors based on segment length (proxy for velocity)
        const colors = [];
        const velocities = [];
        let maxV = 0;
        for (let i = 0; i < path.points.length; i++) {
            const next = path.points[Math.min(i + 1, path.points.length - 1)];
            const v = path.points[i].distanceTo(next);
            velocities.push(v);
            if (v > maxV) maxV = v;
        }

        for (let i = 0; i < path.points.length; i++) {
            const vNorm = maxV > 0 ? velocities[i] / maxV : 0.5;
            let c;
            if (vNorm < 0.2) c = new THREE.Color(colorStagnation).lerp(new THREE.Color(settings.colorSlow), vNorm * 5);
            else if (vNorm < 0.6) c = new THREE.Color(settings.colorSlow).lerp(colorNormal, (vNorm - 0.2) * 2.5);
            else c = new THREE.Color(colorNormal).lerp(new THREE.Color(settings.colorFast), Math.min((vNorm - 0.6) * 2.5, 1));
            colors.push(c.r, c.g, c.b);
        }

        if (settings.pathStyle === 'Tube') {
            const tubularSegments = Math.floor(path.points.length * 0.8);
            const radialSegments = 8;
            const tubeGeo = new THREE.TubeGeometry(path.curve, tubularSegments, settings.pathWidth * 0.5, radialSegments, false);
            
            if (!isSolid) {
                const count = tubeGeo.attributes.position.count;
                const tubeColors = new Float32Array(count * 3);
                for (let i = 0; i <= tubularSegments; i++) {
                    const t = i / tubularSegments;
                    const idx = t * (path.points.length - 1);
                    const i0 = Math.floor(idx);
                    const i1 = Math.min(i0 + 1, path.points.length - 1);
                    const alpha = idx - i0;
                    
                    const r = colors[i0 * 3] * (1 - alpha) + colors[i1 * 3] * alpha;
                    const g = colors[i0 * 3 + 1] * (1 - alpha) + colors[i1 * 3 + 1] * alpha;
                    const b = colors[i0 * 3 + 2] * (1 - alpha) + colors[i1 * 3 + 2] * alpha;
                    
                    for (let j = 0; j <= radialSegments; j++) {
                        const vIdx = (i * (radialSegments + 1) + j) * 3;
                        tubeColors[vIdx] = r; tubeColors[vIdx + 1] = g; tubeColors[vIdx + 2] = b;
                    }
                }
                tubeGeo.setAttribute('color', new THREE.BufferAttribute(tubeColors, 3));
            }
            const tubeMat = new THREE.MeshStandardMaterial({ 
                color: isSolid ? color : 0xffffff,
                vertexColors: !isSolid,
                transparent: true, 
                opacity: settings.pathOpacity,
                metalness: 0.3,
                roughness: 0.4
            });
            pathObj = new THREE.Mesh(tubeGeo, tubeMat);
        } else if (settings.pathStyle === 'Ribbon') {
            const segments = path.points.length - 1;
            const ribbonGeo = new THREE.PlaneGeometry(1, 1, segments, 1);
            const pos = ribbonGeo.attributes.position;
            const ribColors = new Float32Array((segments + 1) * 2 * 3);
            
            const frames = path.curve.computeFrenetFrames(segments, false);
            const ribbonPoints = path.curve.getPoints(segments);
            
            for (let i = 0; i <= segments; i++) {
                const p = ribbonPoints[i];
                const binormal = frames.binormals[i];
                const w = settings.pathWidth * 0.5;
                
                // PlaneGeometry vertices: [bottom row: 0..segments], [top row: segments+1..segments*2+1]
                pos.setXYZ(i, p.x - binormal.x * w, p.y - binormal.y * w, p.z - binormal.z * w);
                pos.setXYZ(segments + 1 + i, p.x + binormal.x * w, p.y + binormal.y * w, p.z + binormal.z * w);
                
                if (!isSolid) {
                    const r = colors[i * 3], g = colors[i * 3 + 1], b = colors[i * 3 + 2];
                    ribColors[i * 3] = r; ribColors[i * 3 + 1] = g; ribColors[i * 3 + 2] = b;
                    ribColors[(segments + 1 + i) * 3] = r; 
                    ribColors[(segments + 1 + i) * 3 + 1] = g; 
                    ribColors[(segments + 1 + i) * 3 + 2] = b;
                }
            }
            pos.needsUpdate = true;
            if (!isSolid) ribbonGeo.setAttribute('color', new THREE.BufferAttribute(ribColors, 3));

            const ribbonMat = new THREE.MeshStandardMaterial({
                color: isSolid ? color : 0xffffff,
                vertexColors: !isSolid,
                transparent: true,
                opacity: settings.pathOpacity,
                side: THREE.DoubleSide,
                roughness: 0.3,
                metalness: 0.7
            });
            pathObj = new THREE.Mesh(ribbonGeo, ribbonMat);
        } else if (settings.pathStyle === 'Flow' || settings.pathStyle === 'Comets') {
            const isComet = settings.pathStyle === 'Comets';
            const lineGeo = new THREE.BufferGeometry().setFromPoints(path.points);
            if (!isSolid) lineGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
            const lineMat = new THREE.LineDashedMaterial({
                color: isSolid ? color : 0xffffff,
                vertexColors: !isSolid,
                transparent: true,
                opacity: settings.pathOpacity * (isComet ? 3 : 2),
                dashSize: isComet ? 20 : 4,
                gapSize: isComet ? 60 : 4,
                scale: 1
            });
            pathObj = new THREE.Line(lineGeo, lineMat);
            pathObj.computeLineDistances();
            if (isComet) {
                pathObj.userData.isComet = true;
                const distAttr = pathObj.geometry.attributes.lineDistance;
                pathObj.userData.totalLength = distAttr.getX(distAttr.count - 1);
            } else { pathObj.userData.isFlow = true; }
        } else {
            const isGlow = settings.pathStyle === 'Glow';
            const lineGeo = new THREE.BufferGeometry().setFromPoints(path.points);
            if (!isSolid) lineGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
            const lineMat = new THREE.LineBasicMaterial({ 
                color: isSolid ? color : 0xffffff,
                vertexColors: !isSolid,
                transparent: true, 
                opacity: settings.pathOpacity * (isGlow ? 2 : 1),
                blending: isGlow ? THREE.AdditiveBlending : THREE.NormalBlending,
                depthWrite: !isGlow
            });
            pathObj = new THREE.Line(lineGeo, lineMat);
        }
        pathLinesGroup.add(pathObj);
    });
}

function processWall(model) {
    model.updateMatrixWorld(true);
    model.traverse((child) => {
        if (child.isMesh) {
            child.material = new THREE.MeshStandardMaterial({
                color: settings.aortaColor, 
                transparent: true, 
                opacity: settings.aortaOpacity, 
                side: THREE.DoubleSide, 
                depthWrite: false,
                wireframe: settings.wireframe
            });
            child.name = "AortaWall";
        }
    });
    mainGroup.add(model);
}

function rebuildSystem() {
    if (flowSystem) {
        flowSystem.geometry.dispose();
        flowSystem.material.dispose();
        mainGroup.remove(flowSystem);
    }

    const geo = getGeometry();
    // Performance-Fix: MeshStandard statt MeshPhysical für Mobile
    const mat = new THREE.MeshStandardMaterial({ 
        transparent: true, 
        opacity: settings.opacity,
        metalness: 0.1,
        roughness: 0.4,
        emissive: new THREE.Color(settings.colorSlow),
        emissiveIntensity: 0.5
    });
    
    flowSystem = new THREE.InstancedMesh(geo, mat, settings.count);
    flowSystem.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    flowSystem.userData.particles = [];

    for (let i = 0; i < settings.count; i++) {
        const pIdx = Math.floor(Math.random() * flowPaths.length);
        const radius = Math.random();
        flowSystem.userData.particles.push({
            pIdx, 
            u: Math.random(), 
            radius,
            speed: (Math.random() * 0.4 + 0.1) * 0.005, 
            randomOffset: new THREE.Vector3(
                (Math.random() - 0.5),
                (Math.random() - 0.5),
                (Math.random() - 0.5)
            ).multiplyScalar(settings.spawnSpread),
            phase: Math.random() * Math.PI * 2,
            momentum: 0
        });
    }
    mainGroup.add(flowSystem);
}

function getGeometry() {
    const s = settings.glyphSize;
    // Mobile-Fix: Weniger Segmente für Geometrien
    const segs = isMobile ? 4 : 8;
    let geo;
    switch(settings.glyphType) {
        case 'Arrow':
            const cone = new THREE.ConeGeometry(s * 0.4, s * 1.0, segs);
            cone.translate(0, s * 0.5, 0);
            const cylinder = new THREE.CylinderGeometry(s * 0.1, s * 0.1, s * 1.0, segs);
            cylinder.translate(0, -s * 0.2, 0);
            geo = BufferGeometryUtils.mergeGeometries([cone, cylinder]);
            break;
        case 'Tetra': geo = new THREE.TetrahedronGeometry(s); break;
        case 'Capsule': geo = new THREE.CapsuleGeometry(s * 0.3, s * 0.8, 2, segs); break;
        case 'Sphere': geo = new THREE.SphereGeometry(s * 0.5, segs, segs); break;
        case 'Box': geo = new THREE.BoxGeometry(s, s, s); break;
        default: geo = new THREE.ConeGeometry(s * 0.4, s * 1.5, segs);
    }
    geo.rotateX(Math.PI * 0.5); 
    return geo;
}

function setupGUI() {
    const gui = new GUI({ title: 'Aorta Flow EXPERT' });
    gui.domElement.style.top = '80px'; 
    if (isMobile) gui.close(); // Auf Handys einklappen
    
    const fFlow = gui.addFolder('1. Flow Physik');
    if (isMobile) fFlow.close();
    fFlow.add(settings, 'showFlow').name('Teilchen sichtbar').onChange(v => flowSystem.visible = v);
    fFlow.add(settings, 'showPaths').name('Pfad-Linien sichtbar').onChange(v => pathLinesGroup.visible = v);
    fFlow.add(settings, 'moveMode', ['Spline', 'Linear', 'Step']).name('Algorithmus');
    fFlow.add(settings, 'count', 50, 5000, 50).name('Partikel-Pool').onFinishChange(rebuildSystem);
    fFlow.add(settings, 'speedMultiplier', 0, 5).name('Grund-Tempo');
    fFlow.add(settings, 'flowVariation', 0, 2).name('Geschw. Varianz');
    fFlow.add(settings, 'turbulence', 0, 10).name('Turbulenz');
    fFlow.add(settings, 'spawnSpread', 0, 15).name('Pfad-Ausscherung');
    fFlow.add(settings, 'fadeRange', 0, 0.2).name('Loop-Fade Zone');

    const fPaths = gui.addFolder('1b. Pfade / Streamlines');
    fPaths.close();
    fPaths.add(settings, 'showPaths').name('Sichtbar').onChange(v => pathLinesGroup.visible = v);
    fPaths.add(settings, 'pathStyle', ['Basic', 'Tube', 'Glow', 'Flow', 'Ribbon', 'Comets']).name('Stil').onChange(rebuildPaths);
    fPaths.add(settings, 'pathWidth', 0.1, 5).name('Breite').onChange(rebuildPaths);
    fPaths.add(settings, 'pathOpacity', 0, 1).name('Deckkraft').onChange(rebuildPaths);
    fPaths.addColor(settings, 'pathColor').name('Farbe').onChange(rebuildPaths);

    const fGlyph = gui.addFolder('2. Glyphen Design');
    fGlyph.close();
    fGlyph.add(settings, 'glyphType', ['Cone', 'Arrow', 'Tetra', 'Capsule', 'Sphere', 'Box']).name('Form').onChange(rebuildSystem);
    fGlyph.add(settings, 'glyphSize', 0.1, 10).name('Größe').onChange(rebuildSystem);
    fGlyph.add(settings, 'dynamicScaling').name('Tempo-Skalierung');
    fGlyph.add(settings, 'opacity', 0.1, 1).name('Flow-Deckkraft').onChange(v => flowSystem.material.opacity = v);

    const fColor = gui.addFolder('3. Heatmap & Farben');
    fColor.close();
    fColor.add(settings, 'colorMode', ['Velocity', 'Direction', 'Rainbow', 'Solid']).name('Modus');
    fColor.addColor(settings, 'colorSlow').name('Farbe (Langsam)');
    fColor.addColor(settings, 'colorFast').name('Farbe (Schnell)');

    const fAorta = gui.addFolder('4. Aorta Wand');
    fAorta.close();
    fAorta.add(settings, 'showAorta').name('Sichtbar').onChange(v => {
        mainGroup.traverse(c => { if(c.name === "AortaWall") c.visible = v; });
    });
    fAorta.add(settings, 'aortaOpacity', 0, 1).name('Deckkraft').onChange(v => {
        mainGroup.traverse(c => { if(c.name === "AortaWall") c.material.opacity = v; });
    });
    fAorta.add(settings, 'wireframe').name('Wireframe').onChange(v => {
        mainGroup.traverse(c => { if(c.name === "AortaWall") c.material.wireframe = v; });
    });
    fAorta.addColor(settings, 'aortaColor').name('Wand-Farbe').onChange(v => {
        mainGroup.traverse(c => { if(c.name === "AortaWall") c.material.color.set(v); });
    });

    const fScene = gui.addFolder('5. Szene & Licht');
    fScene.close();
    fScene.addColor(settings, 'bgColor').name('Hintergrund').onChange(v => scene.background.set(v));
    fScene.add(settings, 'zoom', 100, 2000, 10).name('Kamera Zoom (Abstand)').onChange(v => {
        camera.position.z = v;
        controls.update();
    });
    fScene.add(settings, 'ambientIntensity', 0, 5).name('Umgebungslicht').onChange(v => ambientLight.intensity = v);
    fScene.add(settings, 'directIntensity', 0, 5).name('Punktlicht').onChange(v => directLight.intensity = v);

    const fPulse = gui.addFolder('6. Herz-Zyklus (Puls)');
    if (isMobile) fPulse.close();
    fPulse.add(settings, 'usePulse').name('Puls simulieren');
    fPulse.add(settings, 'bpm', 30, 180, 1).name('Herzschlag (BPM)');
    fPulse.add(settings, 'systoleRatio', 0.1, 0.8).name('Systole Anteil');
    fPulse.add(settings, 'pulseBase', 0, 1).name('Diastolischer Fluss');

    const fSync = gui.addFolder('7. EXPORT / SYNC');
    fSync.close();
    settings.syncSettings = () => {
        const syncData = {
            pathStyle: settings.pathStyle,
            pathWidth: settings.pathWidth,
            pathOpacity: settings.pathOpacity,
            pathColor: settings.pathColor,
            colorMode: settings.colorMode
        };
        localStorage.setItem('aorta_visualisation_settings', JSON.stringify(syncData));
        alert('🚀 VISUALISIERUNGS-STIL FÜR STORY EXPORTIERT!');
    };
    fSync.add(settings, 'syncSettings').name('STIL IN STORY ÜBERNEHMEN');

    fSync.add(settings, 'modelPath', {
        'Aneurysma (Erkrankt)': 'assets/models/sick_aorta_pathlines.glb',
        'Gesunde Aorta': 'assets/models/healthy_aorta_pathlines.glb'
    }).name('Modell wechseln').onChange(async (path) => {
        const wallPath = path.replace('_pathlines.glb', '_mesh.glb');
        mainGroup.clear();
        mainGroup.position.set(0, 0, 0); 
        flowPaths = [];
        const loader = new GLTFLoader();
        const [pathlinesGltf, wallGltf] = await Promise.all([
            loader.loadAsync(path),
            loader.loadAsync(wallPath)
        ]);
        processPathlines(pathlinesGltf.scene);
        processWall(wallGltf.scene);
        const box = new THREE.Box3().setFromObject(mainGroup);
        const center = box.getCenter(new THREE.Vector3());
        mainGroup.position.set(-center.x, -center.y + 80, -center.z); // Erneut zentrieren und hochschieben
        rebuildPaths();
        rebuildSystem();
    });
}

function updatePulseGraph(value) {
    if (!pulseCtx) return;
    pulseHistory.push(value);
    pulseHistory.shift();
    pulseCtx.clearRect(0, 0, pulseCanvas.width, pulseCanvas.height);
    pulseCtx.beginPath();
    pulseCtx.strokeStyle = '#00ff44';
    pulseCtx.lineWidth = 2;
    for (let i = 0; i < pulseHistory.length; i++) {
        const x = (i / pulseHistory.length) * pulseCanvas.width;
        const y = pulseCanvas.height - (pulseHistory[i] * pulseCanvas.height * 0.8) - 5;
        if (i === 0) pulseCtx.moveTo(x, y);
        else pulseCtx.lineTo(x, y);
    }
    pulseCtx.stroke();
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();

    if (flowSystem && flowPaths.length > 0) {
        const timeSec = performance.now() * 0.001;
        const particles = flowSystem.userData.particles;

        if (settings.usePulse) {
            const cycleTime = 60 / settings.bpm;
            const t = (timeSec % cycleTime) / cycleTime; 
            const phaseEl = document.getElementById('pulse-phase');
            const sR = settings.systoleRatio; 
            const dR = 1.0 - sR;

            if (t < sR) {
                const normT = t / sR;
                let v = Math.pow(Math.sin(normT * Math.PI), 1.5);
                if (normT > 0.8) v -= Math.max(0, Math.sin((normT - 0.8) * 5 * Math.PI) * 0.2);
                currentPulse = settings.pulseBase + v * (1.0 - settings.pulseBase);
                if(phaseEl) { phaseEl.innerText = "SYSTOLE (Ejection)"; phaseEl.style.color = "#ff3300"; }
            } else {
                const normT = (t - sR) / dR;
                let v = Math.exp(-normT * 3.0) * 0.15;
                if (normT < 0.15) v += Math.sin(normT / 0.15 * Math.PI) * 0.05;
                currentPulse = settings.pulseBase + v;
                if(phaseEl) { phaseEl.innerText = "DIASTOLE (Refill)"; phaseEl.style.color = "#00d4ff"; }
            }
        } else {
            currentPulse = 1.0;
            const phaseEl = document.getElementById('pulse-phase');
            if(phaseEl) { phaseEl.innerText = "STATIC FLOW"; phaseEl.style.color = "#888"; }
        }
        updatePulseGraph(currentPulse);

        const intensityNorm = (currentPulse - settings.pulseBase) / (1.0 - settings.pulseBase);
        const pressureBar = document.getElementById('pressure-bar');
        const pulseFlash = document.getElementById('pulse-flash');
        if (pressureBar) pressureBar.style.height = `${Math.max(5, intensityNorm * 100)}%`;
        if (pulseFlash) pulseFlash.style.opacity = intensityNorm * 0.4;

        if (ambientLight) ambientLight.intensity = settings.ambientIntensity * (0.7 + intensityNorm * 0.5);
        if (directLight) {
            directLight.intensity = settings.directIntensity * (0.8 + intensityNorm * 1.2);
            directLight.color.setHSL(0, intensityNorm * 0.3, 1);
        }

        for (let i = 0; i < settings.count; i++) {
            const p = particles[i];
            const path = flowPaths[p.pIdx];
            
            const profile = 1.0 - (p.radius * p.radius * settings.laminarFactor);
            const targetVelocity = p.speed * settings.speedMultiplier * currentPulse * profile * 2.5;
            p.momentum = THREE.MathUtils.lerp(p.momentum, targetVelocity, 0.15);
            p.u += p.momentum;

            if (p.u >= 1.0) {
                p.u = 0;
                p.pIdx = Math.floor(Math.random() * flowPaths.length);
                p.radius = Math.random();
            }

            const swirl = Math.sin(p.u * 20 + p.phase) * settings.vorticity * (1.0 - p.u);
            vortexOffset.set(
                Math.sin(timeSec * 2 + p.phase) * swirl,
                Math.cos(timeSec * 2 + p.phase) * swirl,
                0
            );

            if (settings.moveMode === 'Spline') {
                path.curve.getPoint(p.u, dummy.position);
                const tangent = path.curve.getTangent(p.u);
                dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
            } else if (settings.moveMode === 'Step') {
                const idx = Math.floor(p.u * (path.points.length - 1));
                dummy.position.copy(path.points[idx]);
                dummy.quaternion.copy(path.quats[idx]);
            } else {
                const exactIdx = p.u * (path.points.length - 1);
                const idxA = Math.floor(exactIdx), idxB = Math.min(idxA + 1, path.points.length - 1);
                const alpha = exactIdx - idxA;
                dummy.position.lerpVectors(path.points[idxA], path.points[idxB], alpha);
                dummy.quaternion.slerpQuaternions(path.quats[idxA], path.quats[idxB], alpha);
            }
            
            dummy.position.add(p.randomOffset);
            dummy.position.add(vortexOffset);

            let scaleMultiplier = 1.0;
            if (p.u < settings.fadeRange || p.u > (1.0 - settings.fadeRange)) scaleMultiplier = 0.0;
            
            if (settings.dynamicScaling) {
                const stretch = Math.min(3.5, 1.0 + p.momentum * 1200);
                const widthScale = scaleMultiplier * (1.1 / Math.sqrt(stretch));
                dummy.scale.set(widthScale, widthScale, scaleMultiplier * stretch);
            } else {
                dummy.scale.set(scaleMultiplier, scaleMultiplier, scaleMultiplier);
            }

            dummy.updateMatrix();
            flowSystem.setMatrixAt(i, dummy.matrix);

            if (settings.colorMode === 'Velocity') {
                const vDisplay = p.momentum * 800; 
                if (vDisplay < 0.2) colorHelper.copy(colorStagnation).lerp(new THREE.Color(settings.colorSlow), vDisplay * 5);
                else if (vDisplay < 0.6) colorHelper.set(settings.colorSlow).lerp(colorNormal, (vDisplay - 0.2) * 2.5);
                else colorHelper.copy(colorNormal).lerp(new THREE.Color(settings.colorFast), Math.min((vDisplay - 0.6) * 2.5, 1));
            } else {
                colorHelper.set(settings.colorSlow);
            }
            flowSystem.setColorAt(i, colorHelper);
        }
        flowSystem.instanceMatrix.needsUpdate = true;
        flowSystem.instanceColor.needsUpdate = true;
        flowSystem.material.emissiveIntensity = 0.3 + intensityNorm * 0.7;
    }

    if (pathLinesGroup && pathLinesGroup.visible) {
        pathLinesGroup.children.forEach(child => {
            if (child.userData.isFlow && child.material.dashOffset !== undefined) {
                child.material.dashOffset -= 0.05 * settings.speedMultiplier * currentPulse;
            }
            if (child.userData.isComet && child.material.dashOffset !== undefined) {
                // Comets move faster and wrap around their total length
                child.material.dashOffset -= 0.15 * settings.speedMultiplier * currentPulse;
            }
        });
    }

    renderer.render(scene, camera);

    if (gizmoRenderer) {
        gizmoCube.quaternion.copy(camera.quaternion).invert();
        gizmoRenderer.render(gizmoScene, gizmoCamera);
    }
}

function initGizmo() {
    const container = document.getElementById('gizmo-container');
    if (!container) return;

    gizmoScene = new THREE.Scene();
    gizmoCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    gizmoCamera.position.set(0, 0, 4);

    gizmoRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    gizmoRenderer.setSize(120, 120);
    gizmoRenderer.setClearColor(0x000000, 0);
    container.appendChild(gizmoRenderer.domElement);

    const gizmoGroup = new THREE.Group();
    gizmoScene.add(gizmoGroup);

    const geometry = new THREE.BoxGeometry(1.5, 1.5, 1.5);
    
    const createLabel = (text, bgColor, color = 'white') => {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, 128, 128);
        ctx.fillStyle = color;
        ctx.font = 'bold 80px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 64, 64);
        return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas) });
    };

    const materials = [
        createLabel('X', '#ff3333'), // Rechts
        createLabel('-X', '#cc0000'), // Links
        createLabel('Y', '#33ff33'), // Oben
        createLabel('-Y', '#00cc00'), // Unten
        createLabel('Z', '#3333ff'), // Vorne
        createLabel('-Z', '#0000cc')  // Hinten
    ];

    gizmoCube = new THREE.Mesh(geometry, materials);
    gizmoGroup.add(gizmoCube);

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    container.addEventListener('mousedown', (event) => {
        const rect = container.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, gizmoCamera);
        const intersects = raycaster.intersectObject(gizmoCube);

        if (intersects.length > 0) {
            const faceIndex = Math.floor(intersects[0].faceIndex / 2);
            alignCamera(faceIndex);
        }
    });
}

function alignCamera(axis) {
    const distance = camera.position.distanceTo(controls.target);
    const targetPos = controls.target.clone();

    switch(axis) {
        case 0: camera.position.set(targetPos.x + distance, targetPos.y, targetPos.z); break; // X
        case 1: camera.position.set(targetPos.x - distance, targetPos.y, targetPos.z); break; // -X
        case 2: camera.position.set(targetPos.x, targetPos.y + distance, targetPos.z); break; // Y
        case 3: camera.position.set(targetPos.x, targetPos.y - distance, targetPos.z); break; // -Y
        case 4: camera.position.set(targetPos.x, targetPos.y, targetPos.z + distance); break; // Z
        case 5: camera.position.set(targetPos.x, targetPos.y, targetPos.z - distance); break; // -Z
    }
    camera.lookAt(targetPos);
    controls.update();
}

// Navbar Logic
const navbar = document.querySelector('.navbar');
const navToggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');

if (navbar) {
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });
}

if (navToggle) {
    navToggle.addEventListener('click', () => {
        navLinks.classList.toggle('active');
    });
}

init();
