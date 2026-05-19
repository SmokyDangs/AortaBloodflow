import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let renderer, scene1, scene2, camera1, camera2, controls1;
let ambient1, ambient2, direct1, direct2;
let group1, group2, section2Group, aortaObj, camS2; 
let flow1 = { system: null, data: [], paths: [] };
let flow2 = { system: null, data: [], paths: [] };
let posCurve, lookCurve;

// Berechnete Punkte für einen perfekten Kreisflug (Orbit)
const radius = 500;       // Wie weit ist die Kamera vom Modell entfernt
const hoehe = 150;        // Auf welcher Höhe fliegt die Kamera
const blickHoehe = 100;   // Auf welche Höhe des Modells schaut die Kamera (Target Y)

const hotspots = [
    // Start: Vorne (0 Grad)
    { 
        pos: new THREE.Vector3(Math.cos(0) * radius, hoehe, Math.sin(0) * radius), 
        target: new THREE.Vector3(0, blickHoehe, 0) 
    },
    // Viertel-Drehung (90 Grad)
    { 
        pos: new THREE.Vector3(Math.cos(Math.PI * 0.5) * radius, hoehe, Math.sin(Math.PI * 0.5) * radius), 
        target: new THREE.Vector3(0, blickHoehe, 0) 
    },
    // Halbe Drehung (180 Grad)
    { 
        pos: new THREE.Vector3(Math.cos(Math.PI) * radius, hoehe, Math.sin(Math.PI) * radius), 
        target: new THREE.Vector3(0, blickHoehe, 0) 
    },
    // Dreiviertel-Drehung (270 Grad)
    { 
        pos: new THREE.Vector3(Math.cos(Math.PI * 1.5) * radius, hoehe, Math.sin(Math.PI * 1.5) * radius), 
        target: new THREE.Vector3(0, blickHoehe, 0) 
    },
    // Ende: Wieder am Start (360 Grad / Vollkreis)
    { 
        pos: new THREE.Vector3(Math.cos(Math.PI * 2) * radius, hoehe, Math.sin(Math.PI * 2) * radius), 
        target: new THREE.Vector3(0, blickHoehe, 0) 
    }
    ];
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const dummy = new THREE.Object3D();
const colorHelper = new THREE.Color();

const settings = {
    count: isMobile ? 300 : 800,
    speedMultiplier: 0.5,
    glyphSize: 1.5,
    turbulence: 0.2,
    spawnSpread: 1.0,
    flowVariation: 0.4,
    dynamicScaling: true,
    moveMode: 'Spline',
    colorSlow: "#ff4444",
    colorFast: "#ff4444",
    colorMode: 'Solid',
    aortaOpacity: 0.15,
    aortaColor: "#888888",
    wireframe: false,
    ambientIntensity: 1.0,
    directIntensity: 2.5,
    fadeRange: 0.02,
    bgColor: "#000000"
};

const colorStagnation = new THREE.Color("#ff4444");
const colorNormal = new THREE.Color("#ff4444");
const colorStress = new THREE.Color("#ff4444");

// 1. SYNC-LOGIK: Einstellungen laden
const savedSettings = localStorage.getItem('aorta_sync_settings');

settings.moveMode = 'Spline';
settings.colorMode = 'Solid';
settings.colorSlow = '#ff4444';
settings.colorFast = '#ff4444';

async function init() {
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    renderer = new THREE.WebGLRenderer({ 
        antialias: !isMobile, 
        alpha: true, 
        powerPreference: "high-performance"
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1 : 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.autoClear = false;
    renderer.setScissorTest(true);
    renderer.setClearColor(settings.bgColor); // Hintergrundfarbe anwenden
    document.getElementById('container3d').appendChild(renderer.domElement);

    scene1 = new THREE.Scene();
    scene2 = new THREE.Scene();
    scene1.background = new THREE.Color(settings.bgColor);
    scene2.background = new THREE.Color(settings.bgColor);

    group1 = new THREE.Group();
    group2 = new THREE.Group();
    section2Group = new THREE.Group();
    scene1.add(group1);
    scene2.add(group2);
    // Wir fügen section2Group zu scene1 hinzu oder erstellen eine eigene für Sektion 2
    scene1.add(section2Group);

    // 2. LICHT-SYNC
    ambient1 = new THREE.AmbientLight(0xffffff, settings.ambientIntensity);
    direct1 = new THREE.DirectionalLight(0xffffff, settings.directIntensity);
    direct1.position.set(2, 2, 5);
    scene1.add(ambient1, direct1);

    ambient2 = ambient1.clone();
    direct2 = direct1.clone();
    scene2.add(ambient2, direct2);

    posCurve = new THREE.CatmullRomCurve3(hotspots.map(h => h.pos));
    lookCurve = new THREE.CatmullRomCurve3(hotspots.map(h => h.target));

    camera1 = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 10000);
    camera2 = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 10000);
    
    controls1 = new OrbitControls(camera1, renderer.domElement);
    controls1.enableDamping = true;
    controls1.enableZoom = false; 
    controls1.enablePan = false;  

// Lazy Load Funktion für Sektion 2
let s2Loaded = false;
async function loadSection2Models() {
    if (s2Loaded) return;
    s2Loaded = true;
    
    const loader = new GLTFLoader();
    const modelsS2 = [
        'human body male/VH_M_Blood_Vasculature.glb',
        'human body male/VH_M_Heart.glb',
        'human body male/VH_M_Kidney_L.glb',
        'human body male/VH_M_Kidney_R.glb',
        'human body male/VH_M_Liver.glb',
        'human body male/3d-vh-f-lung.glb',
        'human body male/3d-vh-m-skin.glb'
    ];

    try {
        const gltfModels = await Promise.all(modelsS2.map(url => loader.loadAsync(url).catch(e => {
            console.error("Failed to load model:", url, e);
            return null;
        })));
        
        gltfModels.forEach(gltf => {
            if (gltf) {
                section2Group.add(gltf.scene);
            }
        });

        let aortaObj = null;
        section2Group.traverse((child) => {
            if (child.isMesh && child.name.toLowerCase().includes('aorta')) {
                aortaObj = child;
            }
        });

        const s2Container = document.getElementById('model-s2-container');
        if (s2Container) {
            const rendererS2 = new THREE.WebGLRenderer({ antialias: true, alpha: true });
            rendererS2.setSize(s2Container.clientWidth, s2Container.clientHeight);
            s2Container.appendChild(rendererS2.domElement);
            const sceneS2 = new THREE.Scene();
            
            camS2 = new THREE.PerspectiveCamera(60, s2Container.clientWidth / s2Container.clientHeight, 1, 10000);
            camS2.position.set(0, 0, 50);
            camS2.lookAt(0, 0, 0);

            if (section2Group) {
                section2Group.position.set(0, -10, 0);
                section2Group.scale.set(50, 50, 50);
                sceneS2.add(section2Group);
                section2Group.traverse(child => {
                    if (child.isMesh) {
                        if (child === aortaObj) {
                            child.material = new THREE.MeshBasicMaterial({ color: 0xff0000, depthWrite: true });
                        } else {
                            child.material = new THREE.MeshBasicMaterial({ 
                                color: 0xffffff, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false 
                            });
                        }
                    }
                });
            }

            function animateS2() {
                requestAnimationFrame(animateS2);
                section2Group.rotation.y += 0.01;
                rendererS2.render(sceneS2, camS2);
            }
            animateS2();
        }
    } catch (e) { console.error("Loader Error S2:", e); }
}

    // Modellladen für S1
    const loader = new GLTFLoader();
    const [sickLines, sickMesh, healthyLines, healthyMesh] = await Promise.all([
        loader.loadAsync('assets/models/sick_aorta_pathlines.glb'),
        loader.loadAsync('assets/models/sick_aorta_mesh.glb'),
        loader.loadAsync('assets/models/healthy_aorta_pathlines.glb'),
        loader.loadAsync('assets/models/healthy_aorta_mesh.glb')
    ]);
    processWall(sickMesh.scene, group1);
    processPathlines(sickLines.scene, flow1);
    processWall(healthyMesh.scene, group2);
    processPathlines(healthyLines.scene, flow2);

    centerGroup(group1);
    centerGroup(group2);
    applyResponsiveAortaLayout();
    createFlowSystem(flow1, group1);
    createFlowSystem(flow2, group2);
    updateCameraScroll();
    controls1.update();
    animate();

    // Observer für Sektion 2
    const anatomySection = document.getElementById('anatomy');
    if (anatomySection) {
        new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) loadSection2Models();
        }, { threshold: 0.1 }).observe(anatomySection);
    }

    setupUI();
}

// 3. WAND-SYNC: Nutzt die Farben aus dem Analyzer
function processWall(model, targetGroup) {
    model.updateMatrixWorld(true);
    model.traverse((child) => {
        if (child.isMesh) {
            child.material = new THREE.MeshStandardMaterial({
                color: new THREE.Color(settings.aortaColor), 
                transparent: true, 
                opacity: settings.aortaOpacity, 
                side: THREE.DoubleSide, 
                depthWrite: false,
                wireframe: settings.wireframe
            });
        }
    });
    targetGroup.add(model);
}

function processPathlines(model, flowObj) {
    model.updateMatrixWorld(true);
    model.traverse((child) => {
        if (child.geometry && (child.isLine || child.name.toLowerCase().includes("flow") || child.isMesh)) {
            const posAttr = child.geometry.attributes.position;
            if (!posAttr) return;

            let points = [];
            for (let i = 0; i < posAttr.count; i++) {
                let v = new THREE.Vector3().fromBufferAttribute(posAttr, i);
                v.applyMatrix4(child.matrixWorld);
                points.push(v);
            }
            if (points.length > 1) {
                const curve = new THREE.CatmullRomCurve3(points);
                const rawQuats = [];
                for (let i = 0; i < points.length; i++) {
                    const next = points[(i + 1) % points.length] || points[0];
                    dummy.position.copy(points[i]);
                    dummy.lookAt(next);
                    rawQuats.push(new THREE.Quaternion().copy(dummy.quaternion));
                }
                flowObj.paths.push({ curve, points, quats: rawQuats });
            }
        }
    });
}

function centerGroup(group) {
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    group.position.sub(center);
}

function applyResponsiveAortaLayout() {
    if (!group1 || !group2) return;

    const mobilePortrait = window.innerWidth <= 820;
    const rotationX = -Math.PI * 0.5;
    const scale = mobilePortrait ? 0.58 : 0.62;
    const xOffset = 0;
    const yOffset = mobilePortrait ? 85 : 300;
    const zOffset = 0;

    [group1, group2].forEach((group) => {
        group.rotation.set(rotationX, 0, 0);
        group.scale.setScalar(scale);
        group.position.x = xOffset;
        group.position.y = yOffset;
        group.position.z = zOffset;
    });
}

function createFlowSystem(flowObj, targetGroup) {
    if (flowObj.paths.length === 0) return;
    const s = settings.glyphSize;
    const geo = new THREE.ConeGeometry(s * 0.4, s * 1.5, 6);
    geo.rotateX(Math.PI * 0.5);
    
    // 4. PARTIKEL-SYNC: Nutzt colorSlow als Basis-Emissive
    const mat = new THREE.MeshStandardMaterial({ 
        transparent: true, 
        opacity: 0.8, 
        metalness: 0.1, 
        roughness: 0.5,
        emissive: new THREE.Color(settings.colorSlow),
        emissiveIntensity: 0.5
    });
    
    flowObj.system = new THREE.InstancedMesh(geo, mat, settings.count);
    flowObj.system.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    flowObj.data = [];

    for (let i = 0; i < settings.count; i++) {
        const pIdx = Math.floor(Math.random() * flowObj.paths.length);
        flowObj.data.push({
            pIdx, 
            u: Math.random(), 
            speed: (Math.random() * 0.4 + 0.1) * 0.005,
            randomOffset: new THREE.Vector3(
                (Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)
            ).multiplyScalar(settings.spawnSpread),
            phase: Math.random() * Math.PI * 2
        });
    }
    targetGroup.add(flowObj.system);
}

function updateCameraScroll() {
    const scrollY = window.scrollY;
    const stepHeight = window.innerHeight * 1.5; 
    const totalHeight = (hotspots.length - 1) * stepHeight;

    // Nur im Vergleichs-Modus, wenn wir im Story-Bereich sind
    const storyEnd = totalHeight + stepHeight; 
    if (scrollY > stepHeight * 0.5 && scrollY < storyEnd) {
        document.body.classList.add('in-comparison');
    } else {
        document.body.classList.remove('in-comparison');
    }

    const t = Math.max(0, Math.min(scrollY / totalHeight, 1));
    const mobilePortrait = window.innerWidth <= 820;
    posCurve.getPoint(t, camera1.position);
    lookCurve.getPoint(t, controls1.target);

    if (mobilePortrait) {
        camera1.position.set(0, 0, 900);
        controls1.target.set(0, 0, 0);
    }
}

function animate() {
    requestAnimationFrame(animate);
    updateCameraScroll();
    controls1.update();

    // Pulse effect for aorta
    if (aortaObj) {
        const pulse = 1.0 + Math.sin(performance.now() * 0.005) * 0.05;
        aortaObj.scale.set(pulse, pulse, pulse);
    }

    updateFlow(flow1);
    updateFlow(flow2);

    const w = window.innerWidth, h = window.innerHeight, scrollY = window.scrollY;
    const stepHeight = h * 1.5;

    let splitFactor = scrollY < stepHeight ? 1.0 - (scrollY / stepHeight) * 0.5 : 0.5;
    const w1 = Math.floor(w * (1 - splitFactor));
    const w2 = w - w1;
    
    if (w1 > 0) {
        camera1.aspect = w1 / h;
        camera1.updateProjectionMatrix();
        renderer.setViewport(0, 0, w1, h);
        renderer.setScissor(0, 0, w1, h);
        renderer.render(scene1, camera1);
    }

    if (w2 > 0) {
        camera2.position.copy(camera1.position);
        camera2.quaternion.copy(camera1.quaternion);
        camera2.aspect = w2 / h;
        camera2.updateProjectionMatrix();
        renderer.setViewport(w1, 0, w2, h);
        renderer.setScissor(w1, 0, w2, h);
        renderer.render(scene2, camera2);
    }
}

function updateFlow(flowObj) {
    if (!flowObj.system || flowObj.paths.length === 0) return;
    const timeSec = performance.now() * 0.001;
    const { system, data, paths } = flowObj;

    for (let i = 0; i < settings.count; i++) {
        const d = data[i];
        const path = paths[d.pIdx];
        
        d.u += d.speed * settings.speedMultiplier;

        if (d.u >= 1.0) {
            d.u = 0;
            d.pIdx = Math.floor(Math.random() * paths.length);
            d.speed = (Math.random() * 0.4 + 0.1) * 0.005;
            d.randomOffset.set(
                (Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)
            ).multiplyScalar(settings.spawnSpread);
        }

        if (settings.moveMode === 'Spline') {
            path.curve.getPoint(d.u, dummy.position);
            const tangent = path.curve.getTangent(d.u);
            dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
        } 
        else if (settings.moveMode === 'Linear') {
            const totalPoints = path.points.length;
            const exactIdx = d.u * (totalPoints - 1);
            const idxA = Math.floor(exactIdx);
            const idxB = Math.min(idxA + 1, totalPoints - 1);
            const alpha = exactIdx - idxA;
            dummy.position.lerpVectors(path.points[idxA], path.points[idxB], alpha);
            dummy.quaternion.slerpQuaternions(path.quats[idxA], path.quats[idxB], alpha);
        }
        else if (settings.moveMode === 'Step') {
            const idx = Math.floor(d.u * (path.points.length - 1));
            dummy.position.copy(path.points[idx]);
            dummy.quaternion.copy(path.quats[idx]);
        }

        if (settings.spawnSpread > 0 || settings.turbulence > 0) {
            dummy.position.add(d.randomOffset);
            dummy.position.x += Math.sin(timeSec * 2 + d.phase) * settings.turbulence;
            dummy.position.y += Math.cos(timeSec * 1.5 + d.phase) * settings.turbulence;
        }

        let scaleMultiplier = 1.0;
        if (d.u < settings.fadeRange || d.u > (1.0 - settings.fadeRange)) scaleMultiplier = 0.0;

        if (settings.dynamicScaling) {
            const s = (1 + (d.speed * 200 * settings.speedMultiplier * 2)) * scaleMultiplier;
            dummy.scale.set(scaleMultiplier, scaleMultiplier, s);
        } else {
            dummy.scale.set(scaleMultiplier, scaleMultiplier, scaleMultiplier);
        }

        dummy.updateMatrix();
        system.setMatrixAt(i, dummy.matrix);
        colorHelper.set('#ff4444');
        system.setColorAt(i, colorHelper);
    }
    system.instanceMatrix.needsUpdate = true;
    system.instanceColor.needsUpdate = true;
}

function setupUI() {
    const inputSpeed = document.getElementById('input-speed');
    if(inputSpeed) inputSpeed.oninput = (e) => settings.speedMultiplier = parseFloat(e.target.value);
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) entry.target.classList.add('active');
            else entry.target.classList.remove('active');
        });
    }, { threshold: 0.5 });
    document.querySelectorAll('.step').forEach(step => observer.observe(step));
}

window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    applyResponsiveAortaLayout();
});


// Chart Logic
function initCharts() {
    // 1. Ort des Geschehens (Donut Chart)
    const locCanvas = document.getElementById('location-chart');
    if (locCanvas) {
        new Chart(locCanvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Bauch (80%)', 'Brust (20%)'],
                datasets: [{ 
                    data: [80, 20], 
                    backgroundColor: ['#ff4444', '#555'],
                    borderColor: 'rgba(0,0,0,0)'
                }]
            },
            options: { 
                responsive: true, 
                plugins: { 
                    title: { display: true, text: 'Lokalisation (AAA vs TAA)', color: '#fff', font: { size: 14 } },
                    legend: { labels: { color: '#fff' } } 
                } 
            }
        });
    }

    // 2. Geschlechterverteilung (Donut Chart)
    const genCanvas = document.getElementById('gender-chart');
    if (genCanvas) {
        new Chart(genCanvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Männer (80%)', 'Frauen (20%)'],
                datasets: [{ 
                    data: [80, 20], 
                    backgroundColor: ['#00d4ff', '#ff4444'],
                    borderColor: 'rgba(0,0,0,0)'
                }]
            },
            options: { 
                responsive: true, 
                plugins: { 
                    title: { display: true, text: 'Geschlechterverteilung', color: '#fff', font: { size: 14 } },
                    legend: { labels: { color: '#fff' } } 
                } 
            }
        });
    }
}

// Init Mobile Nav
window.addEventListener('DOMContentLoaded', () => {
    const navToggle = document.getElementById('nav-toggle');
    const navMenu = document.getElementById('nav-menu-mobile');
    if (navToggle && navMenu) {
        navToggle.addEventListener('click', () => {
            navMenu.classList.toggle('active');
        });
    }
    const script = document.createElement('script');
    script.src = "https://cdn.jsdelivr.net/npm/chart.js";
    script.onload = initCharts;
    document.head.appendChild(script);
});

init();
