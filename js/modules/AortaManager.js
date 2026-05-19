// Shared Aorta Model Logic
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class AortaManager {
    constructor(group, modelPath, wallPath, settings) {
        this.group = group;
        this.modelPath = modelPath;
        this.wallPath = wallPath;
        this.settings = settings;
        this.paths = [];
        this.system = null;
        this.pathLinesGroup = new THREE.Group();
        this.group.add(this.pathLinesGroup);
    }

    async init() {
        const loader = new GLTFLoader();
        const [linesGltf, wallGltf] = await Promise.all([
            loader.loadAsync(this.modelPath),
            loader.loadAsync(this.wallPath)
        ]);
        this.processWall(wallGltf.scene);
        this.processPathlines(linesGltf.scene);
        this.rebuildPaths();
    }

    processWall(model) {
        model.traverse(child => {
            if (child.isMesh) {
                child.material = new THREE.MeshStandardMaterial({
                    color: this.settings.aortaColor,
                    transparent: true,
                    opacity: this.settings.aortaOpacity,
                    side: THREE.DoubleSide
                });
            }
        });
        this.group.add(model);
    }

    processPathlines(model) {
        this.paths = [];
        model.traverse(child => {
            if (child.geometry && (child.isLine || child.isMesh)) {
                const posAttr = child.geometry.attributes.position;
                if (!posAttr) return;
                const points = [];
                for (let i = 0; i < posAttr.count; i++) {
                    points.push(new THREE.Vector3().fromBufferAttribute(posAttr, i).applyMatrix4(child.matrixWorld));
                }
                this.paths.push({ curve: new THREE.CatmullRomCurve3(points), points });
            }
        });
    }

    rebuildPaths() {
        this.pathLinesGroup.clear();
        const color = new THREE.Color(this.settings.pathColor);
        const isSolid = this.settings.colorMode === 'Solid';

        this.paths.forEach(path => {
            let pathObj;
            if (this.settings.pathStyle === 'Tube') {
                const tubeGeo = new THREE.TubeGeometry(path.curve, 30, this.settings.pathWidth * 0.5, 8, false);
                const tubeMat = new THREE.MeshStandardMaterial({ 
                    color: isSolid ? color : 0xffffff,
                    transparent: true, opacity: this.settings.pathOpacity
                });
                pathObj = new THREE.Mesh(tubeGeo, tubeMat);
            } else if (this.settings.pathStyle === 'Ribbon') {
                const segments = path.points.length - 1;
                const ribbonGeo = new THREE.PlaneGeometry(1, 1, segments, 1);
                const pos = ribbonGeo.attributes.position;
                const frames = path.curve.computeFrenetFrames(segments, false);
                const ribbonPoints = path.curve.getPoints(segments);
                for (let i = 0; i <= segments; i++) {
                    const p = ribbonPoints[i];
                    const binormal = frames.binormals[i];
                    const w = this.settings.pathWidth * 0.5;
                    pos.setXYZ(i, p.x - binormal.x * w, p.y - binormal.y * w, p.z - binormal.z * w);
                    pos.setXYZ(segments + 1 + i, p.x + binormal.x * w, p.y + binormal.y * w, p.z + binormal.z * w);
                }
                pos.needsUpdate = true;
                const ribbonMat = new THREE.MeshStandardMaterial({
                    color: isSolid ? color : 0xffffff,
                    transparent: true, opacity: this.settings.pathOpacity, side: THREE.DoubleSide
                });
                pathObj = new THREE.Mesh(ribbonGeo, ribbonMat);
            } else if (this.settings.pathStyle === 'Flow' || this.settings.pathStyle === 'Comets') {
                const isComet = this.settings.pathStyle === 'Comets';
                const lineGeo = new THREE.BufferGeometry().setFromPoints(path.points);
                const lineMat = new THREE.LineDashedMaterial({
                    color: isSolid ? color : 0xffffff,
                    transparent: true,
                    opacity: this.settings.pathOpacity * (isComet ? 3 : 2),
                    dashSize: isComet ? 20 : 4,
                    gapSize: isComet ? 60 : 4,
                    scale: 1
                });
                pathObj = new THREE.Line(lineGeo, lineMat);
                pathObj.computeLineDistances();
                if (isComet) pathObj.userData.isComet = true;
                else pathObj.userData.isFlow = true;
            } else {
                const lineGeo = new THREE.BufferGeometry().setFromPoints(path.points);
                const lineMat = new THREE.LineBasicMaterial({ 
                    color: isSolid ? color : 0xffffff,
                    transparent: true, 
                    opacity: this.settings.pathOpacity 
                });
                pathObj = new THREE.Line(lineGeo, lineMat);
            }
            this.pathLinesGroup.add(pathObj);
        });
    }
}
