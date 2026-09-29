import * as THREE from 'three';

const clamp = (value, a, b) => Math.max(a, Math.min(b, value));
const smoothStep = (a, b, value) => {
  const t = clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** A mutable height field. Heights are world-space offsets from the original island. */
export class TerrainSystem {
  constructor({ group, grassColor = 0x91b889, sandColor = 0xd8c19a, radiusX = 64, radiusZ = 47 } = {}) {
    this.radiusX = radiusX;
    this.radiusZ = radiusZ;
    this.columns = 160;
    this.rows = 120;
    this.extentX = radiusX * 1.06;
    this.extentZ = radiusZ * 1.06;
    this.stepX = this.extentX * 2 / this.columns;
    this.stepZ = this.extentZ * 2 / this.rows;
    this.heights = new Float32Array((this.columns + 1) * (this.rows + 1));
    this.damage = new Float32Array(this.heights.length);
    this.registered = [];
    this.revision = 0;
    this.dirtyCount = 0;
    this.lastEdit = null;
    this.grassColor = new THREE.Color(grassColor);
    this.soilColor = new THREE.Color(sandColor).lerp(new THREE.Color(0x65503d), 0.58);
    this.mesh = new THREE.Mesh(this._makeGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94 }));
    this.mesh.name = 'Deformable island terrain';
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.userData.terrain = true;
    this.surfacePositions = this.mesh.geometry.attributes.position.array.slice();
    this.surfaceNormals = this.mesh.geometry.attributes.normal.array.slice();
    this.surfaceColors = this.mesh.geometry.attributes.color.array.slice();
    this.mesh.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
    this.mesh.geometry.attributes.color.setUsage(THREE.DynamicDrawUsage);
    if (group) group.add(this.mesh);
  }

  contains(x, z) {
    const nx = x / this.radiusX;
    const nz = z / this.radiusZ;
    const angle = Math.atan2(nz, nx);
    const edge = 1 + 0.032 * Math.sin(angle * 3 + 0.2) + 0.022 * Math.cos(angle * 5);
    return Math.hypot(nx, nz) <= edge;
  }

  _makeGeometry() {
    const positions = [];
    const indices = [];
    const stride = this.columns + 1;
    const count = stride * (this.rows + 1);
    const inside = new Uint8Array(count);
    const nodeVertex = new Int32Array(count).fill(-1);
    const crossingVertices = new Map();
    const coordinate = index => [index % stride * this.stepX - this.extentX, Math.floor(index / stride) * this.stepZ - this.extentZ];
    const addVertex = (x, z) => {
      const index = positions.length / 3;
      positions.push(x, 0, z);
      return index;
    };
    for (let i = 0; i < count; i++) {
      const [x, z] = coordinate(i);
      if (this.contains(x, z)) {
        inside[i] = 1;
        nodeVertex[i] = addVertex(x, z);
      }
    }
    const crossing = (a, b) => {
      const key = Math.min(a, b) * count + Math.max(a, b);
      if (crossingVertices.has(key)) return crossingVertices.get(key);
      let [ix, iz] = coordinate(inside[a] ? a : b);
      let [ox, oz] = coordinate(inside[a] ? b : a);
      for (let iteration = 0; iteration < 22; iteration++) {
        const mx = (ix + ox) / 2;
        const mz = (iz + oz) / 2;
        if (this.contains(mx, mz)) { ix = mx; iz = mz; }
        else { ox = mx; oz = mz; }
      }
      const vertex = addVertex((ix + ox) / 2, (iz + oz) / 2);
      crossingVertices.set(key, vertex);
      return vertex;
    };
    const triangle = (a, b, c) => {
      const nodes = [a, b, c];
      const polygon = [];
      for (let i = 0; i < 3; i++) {
        const previous = nodes[(i + 2) % 3];
        const current = nodes[i];
        if (inside[previous] && !inside[current]) polygon.push(crossing(previous, current));
        if (!inside[previous] && inside[current]) polygon.push(crossing(previous, current));
        if (inside[current]) polygon.push(nodeVertex[current]);
      }
      for (let i = 1; i < polygon.length - 1; i++) indices.push(polygon[0], polygon[i], polygon[i + 1]);
    };
    for (let z = 0; z < this.rows; z++) {
      for (let x = 0; x < this.columns; x++) {
        const a = z * stride + x;
        triangle(a, a + stride, a + 1);
        triangle(a + 1, a + stride, a + stride + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    const colors = new Float32Array(positions.length);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = this.grassColor.r;
      colors[i + 1] = this.grassColor.g;
      colors[i + 2] = this.grassColor.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  _sample(array, x, z) {
    const gx = clamp((x + this.extentX) / this.stepX, 0, this.columns);
    const gz = clamp((z + this.extentZ) / this.stepZ, 0, this.rows);
    const ix = Math.min(this.columns - 1, Math.floor(gx));
    const iz = Math.min(this.rows - 1, Math.floor(gz));
    const fx = gx - ix;
    const fz = gz - iz;
    const i = iz * (this.columns + 1) + ix;
    const row = this.columns + 1;
    return (array[i] * (1 - fx) + array[i + 1] * fx) * (1 - fz)
      + (array[i + row] * (1 - fx) + array[i + row + 1] * fx) * fz;
  }

  heightAt(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !this.contains(x, z)) return 0;
    return this._sample(this.heights, x, z);
  }

  sampleSurface(x, z, baseHeight = 0.17) {
    if (!this.contains(x, z)) return { height: baseHeight, grip: 1, roughness: 0 };
    const height = this.heightAt(x, z);
    const damage = this._sample(this.damage, x, z);
    const dx = (this.heightAt(x + this.stepX * 0.5, z) - this.heightAt(x - this.stepX * 0.5, z)) / this.stepX;
    const dz = (this.heightAt(x, z + this.stepZ * 0.5) - this.heightAt(x, z - this.stepZ * 0.5)) / this.stepZ;
    const roughness = clamp(damage * 0.55 + Math.hypot(dx, dz) * 0.55, 0, 1);
    return { height: baseHeight + height, grip: clamp(1 - damage * 0.34 - roughness * 0.12, 0.6, 1), roughness };
  }

  _mutate(x, z, radius, type, operation) {
    if (![x, z, radius].every(Number.isFinite) || radius <= 0) return 0;
    radius = clamp(radius, 0.4, 36);
    const minX = Math.max(0, Math.floor((x - radius + this.extentX) / this.stepX));
    const maxX = Math.min(this.columns, Math.ceil((x + radius + this.extentX) / this.stepX));
    const minZ = Math.max(0, Math.floor((z - radius + this.extentZ) / this.stepZ));
    const maxZ = Math.min(this.rows, Math.ceil((z + radius + this.extentZ) / this.stepZ));
    let changed = 0;
    for (let iz = minZ; iz <= maxZ; iz++) {
      for (let ix = minX; ix <= maxX; ix++) {
        const px = ix * this.stepX - this.extentX;
        const pz = iz * this.stepZ - this.extentZ;
        const distance = Math.hypot(px - x, pz - z);
        if (distance >= radius || !this.contains(px, pz)) continue;
        const index = iz * (this.columns + 1) + ix;
        if (operation(index, distance / radius)) changed++;
      }
    }
    this.dirtyCount = changed;
    if (!changed) return 0;
    this.revision++;
    this.lastEdit = { x, z, radius, type };
    const bounds = { minX: x - radius - this.stepX, maxX: x + radius + this.stepX, minZ: z - radius - this.stepZ, maxZ: z + radius + this.stepZ };
    this._updateSurface(bounds);
    this._updateRegistered(bounds);
    return changed;
  }

  impact(x, z, energy = 1, radius = 4) {
    if (!Number.isFinite(energy) || energy <= 0) return 0;
    const depth = clamp(energy * 0.38, 0.025, 1.4);
    const scarring = clamp(energy * 0.52, 0, 1);
    return this._mutate(x, z, radius, 'impact', (index, t) => {
      const crater = t < 0.78 ? -depth * (1 - (t / 0.78) ** 2) ** 2 : 0;
      const rim = depth * 0.27 * Math.exp(-(((t - 0.82) / 0.12) ** 2))
        * smoothStep(0.55, 0.72, t) * (1 - smoothStep(0.9, 1, t));
      this.heights[index] = clamp(this.heights[index] + crater + rim, -2.2, 3);
      this.damage[index] = clamp(this.damage[index] + scarring * (1 - t * t), 0, 1);
      return true;
    });
  }

  sculpt(x, z, delta, radius = 5) {
    if (!Number.isFinite(delta) || delta === 0) return 0;
    return this._mutate(x, z, radius, 'sculpt', (index, t) => {
      const influence = (1 - t * t) ** 2;
      this.heights[index] = clamp(this.heights[index] + delta * influence, -2.2, 3);
      this.damage[index] = clamp(this.damage[index] + Math.abs(delta) * 0.07 * influence, 0, 1);
      return true;
    });
  }

  repairAt(x, z, radius = 6) {
    return this._mutate(x, z, radius, 'repair', (index, t) => {
      const preserve = smoothStep(0.55, 1, t);
      const before = this.heights[index];
      const beforeDamage = this.damage[index];
      this.heights[index] *= preserve;
      this.damage[index] *= preserve;
      return before !== this.heights[index] || beforeDamage !== this.damage[index];
    });
  }

  _updateSurface(bounds) {
    const geometry = this.mesh.geometry;
    const positions = geometry.attributes.position.array;
    const colors = geometry.attributes.color.array;
    for (let i = 0; i < positions.length; i += 3) {
      const x = this.surfacePositions[i];
      const z = this.surfacePositions[i + 2];
      if (bounds && (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ)) continue;
      // Boundary rounding in Float32 may put a clipped vertex a few microns out.
      positions[i + 1] = this._sample(this.heights, x, z);
      const soil = clamp(this._sample(this.damage, x, z) * 1.25, 0, 1);
      colors[i] = this.grassColor.r * (1 - soil) + this.soilColor.r * soil;
      colors[i + 1] = this.grassColor.g * (1 - soil) + this.soilColor.g * soil;
      colors[i + 2] = this.grassColor.b * (1 - soil) + this.soilColor.b * soil;
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  }

  /** Keep a static road mesh's original world location, including rotated parents. */
  registerMesh(mesh) {
    if (!mesh?.isMesh || !mesh.geometry?.attributes.position || mesh === this.mesh) return false;
    if (this.registered.some(item => item.mesh === mesh)) return false;
    mesh.updateWorldMatrix(true, false);
    // Registration owns a geometry copy so shared primitives cannot deform twice.
    mesh.geometry = mesh.geometry.clone();
    const geometry = mesh.geometry;
    const originals = geometry.attributes.position.array.slice();
    const worldXZ = new Float64Array(originals.length / 3 * 2);
    const matrix = mesh.matrixWorld.clone();
    const inverse = matrix.clone().invert();
    const up = [inverse.elements[4], inverse.elements[5], inverse.elements[6]];
    const point = new THREE.Vector3();
    const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (let i = 0; i < originals.length; i += 3) {
      point.set(originals[i], originals[i + 1], originals[i + 2]).applyMatrix4(matrix);
      const j = i / 3 * 2;
      worldXZ[j] = point.x;
      worldXZ[j + 1] = point.z;
      bounds.minX = Math.min(bounds.minX, point.x);
      bounds.maxX = Math.max(bounds.maxX, point.x);
      bounds.minZ = Math.min(bounds.minZ, point.z);
      bounds.maxZ = Math.max(bounds.maxZ, point.z);
    }
    geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
    const item = { mesh, originals, worldXZ, matrix, inverse, up, bounds, normals: geometry.attributes.normal?.array.slice() };
    this.registered.push(item);
    if (this.revision) this._updateRegistered(null, item);
    return true;
  }

  _updateRegistered(editBounds, singleItem = null) {
    const items = singleItem ? [singleItem] : this.registered;
    for (const item of items) {
      if (editBounds && (item.bounds.maxX < editBounds.minX || item.bounds.minX > editBounds.maxX || item.bounds.maxZ < editBounds.minZ || item.bounds.minZ > editBounds.maxZ)) continue;
      const geometry = item.mesh.geometry;
      const positions = geometry.attributes.position.array;
      let touched = false;
      for (let i = 0; i < positions.length; i += 3) {
        const j = i / 3 * 2;
        const x = item.worldXZ[j];
        const z = item.worldXZ[j + 1];
        if (editBounds && (x < editBounds.minX || x > editBounds.maxX || z < editBounds.minZ || z > editBounds.maxZ)) continue;
        const delta = this.heightAt(x, z);
        positions[i] = item.originals[i] + item.up[0] * delta;
        positions[i + 1] = item.originals[i + 1] + item.up[1] * delta;
        positions[i + 2] = item.originals[i + 2] + item.up[2] * delta;
        touched = true;
      }
      if (touched) {
        geometry.attributes.position.needsUpdate = true;
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        geometry.computeBoundingBox();
      }
    }
  }

  reset() {
    this.heights.fill(0);
    this.damage.fill(0);
    const geometry = this.mesh.geometry;
    geometry.attributes.position.array.set(this.surfacePositions);
    geometry.attributes.color.array.set(this.surfaceColors);
    geometry.attributes.normal.array.set(this.surfaceNormals);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
    geometry.attributes.normal.needsUpdate = true;
    geometry.computeBoundingSphere();
    for (const item of this.registered) {
      const registeredGeometry = item.mesh.geometry;
      registeredGeometry.attributes.position.array.set(item.originals);
      if (item.normals && registeredGeometry.attributes.normal) {
        registeredGeometry.attributes.normal.array.set(item.normals);
        registeredGeometry.attributes.normal.needsUpdate = true;
      }
      registeredGeometry.attributes.position.needsUpdate = true;
      registeredGeometry.computeBoundingSphere();
      registeredGeometry.computeBoundingBox();
    }
    this.revision++;
    this.dirtyCount = 0;
    this.lastEdit = { type: 'reset' };
  }

  getStats() {
    let damagedSamples = 0;
    let minHeight = 0;
    let maxHeight = 0;
    for (let i = 0; i < this.heights.length; i++) {
      if (this.damage[i] > 0.01) damagedSamples++;
      minHeight = Math.min(minHeight, this.heights[i]);
      maxHeight = Math.max(maxHeight, this.heights[i]);
    }
    return { revision: this.revision, dirtyCount: this.dirtyCount, damagedSamples, minHeight, maxHeight, registeredMeshes: this.registered.length, vertexCount: this.mesh.geometry.attributes.position.count };
  }

  get stats() { return this.getStats(); }
}
