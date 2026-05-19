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
