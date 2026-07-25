# MNEMOSYNE: VISUAL SPECIFICATIONS & SHADERS

## ÍNDICE

1. [Filosofia Visual](#filosofia-visual)
2. [Paleta de Cores](#paleta-de-cores)
3. [Shaders de Objetos Celestes](#shaders)
4. [Efeitos de Partículas](#partículas)
5. [Animações e Transições](#animações)
6. [Post-Processing](#post-processing)
7. [Performance Optimization](#performance)

---

## FILOSOFIA VISUAL

### Princípios

1. **Profundidade Real** — não é 2D disfarçado, é verdadeiramente espacial
2. **Beleza Funcional** — cada elemento visual serve a cognição
3. **Minimalismo Cósmico** — simplicidade externa, complexidade interna
4. **Movimento Orgânico** — nada é estático, tudo respira
5. **Luz como Significado** — brilho comunica importância

### Referências Visuais

- **Celestia** — navegação espacial fluida
- **Space Engine** — profundidade e escala
- **No Man's Sky** — paleta de cores vibrante
- **Interstellar** — física e gravidade visual
- **Particle Life** — movimento orgânico

---

## PALETA DE CORES

### Cores Primárias (Categorias)

```typescript
const CATEGORY_COLORS = {
  business: {
    primary: '#4A90E2',    // Azul profissional
    glow: '#6BA3E8',
    dark: '#2E5A8F'
  },
  technology: {
    primary: '#50E3C2',    // Ciano tecnológico
    glow: '#6EEBD0',
    dark: '#2D8A73'
  },
  personal: {
    primary: '#F5A623',    // Laranja pessoal
    glow: '#F7B84A',
    dark: '#C27D0E'
  },
  creative: {
    primary: '#BD10E0',    // Roxo criativo
    glow: '#D03EF0',
    dark: '#7A0A91'
  },
  research: {
    primary: '#7ED321',    // Verde científico
    glow: '#95DC4A',
    dark: '#5A9A18'
  },
  planning: {
    primary: '#D0021B',    // Vermelho estratégico
    glow: '#E02A3F',
    dark: '#8F0113'
  },
  reflection: {
    primary: '#9013FE',    // Violeta reflexivo
    glow: '#A83FFF',
    dark: '#5C0CA5'
  }
};
```

### Cores de Sistema

```typescript
const SYSTEM_COLORS = {
  background: '#000000',           // Preto absoluto
  backgroundAlt: '#0A0A0F',        // Preto azulado
  
  text: {
    primary: '#FFFFFF',
    secondary: '#B0B0B0',
    tertiary: '#707070'
  },
  
  ui: {
    border: 'rgba(255, 255, 255, 0.1)',
    hover: 'rgba(255, 255, 255, 0.05)',
    active: 'rgba(255, 255, 255, 0.1)'
  },
  
  states: {
    success: '#7ED321',
    warning: '#F5A623',
    error: '#D0021B',
    info: '#4A90E2'
  },
  
  special: {
    blackhole: '#000000',
    accretionDisk: '#FF6B6B',
    nebula: ['#BD10E0', '#4A90E2', '#50E3C2'], // Gradient
    comet: '#FFFFFF',
    cometTail: 'rgba(255, 255, 255, 0.3)'
  }
};
```

---

## SHADERS DE OBJETOS CELESTES

### 1. Star Shader (Estrela)

```glsl
// vertex shader
varying vec3 vNormal;
varying vec3 vPosition;

void main() {
  vNormal = normalize(normalMatrix * normal);
  vPosition = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}

// fragment shader
uniform vec3 color;
uniform float intensity;
uniform float time;

varying vec3 vNormal;
varying vec3 vPosition;

void main() {
  // Fresnel effect
  vec3 viewDirection = normalize(cameraPosition - vPosition);
  float fresnel = pow(1.0 - dot(viewDirection, vNormal), 3.0);
  
  // Pulsação
  float pulse = sin(time * 2.0) * 0.1 + 0.9;
  
  // Cor final
  vec3 finalColor = color * intensity * pulse;
  float alpha = fresnel * 0.8;
  
  gl_FragColor = vec4(finalColor, alpha);
}
```

### 2. Sun Shader (Sol)

```glsl
// vertex shader
varying vec3 vNormal;
varying vec3 vPosition;
varying vec2 vUv;

void main() {
  vNormal = normalize(normalMatrix * normal);
  vPosition = position;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}

// fragment shader
uniform vec3 color;
uniform float intensity;
uniform float time;

varying vec3 vNormal;
varying vec3 vPosition;
varying vec2 vUv;

// Noise function
float noise(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  // Surface turbulence
  vec2 uv = vUv * 10.0;
  float n = noise(uv + time * 0.1);
  n += noise(uv * 2.0 + time * 0.2) * 0.5;
  n += noise(uv * 4.0 + time * 0.3) * 0.25;
  n /= 1.75;
  
  // Fresnel
  vec3 viewDirection = normalize(cameraPosition - vPosition);
  float fresnel = pow(1.0 - dot(viewDirection, vNormal), 2.0);
  
  // Corona effect
  float corona = fresnel * (n * 0.5 + 0.5);
  
  // Final color
  vec3 finalColor = color * (intensity + corona);
  float alpha = 0.9 + corona * 0.1;
  
  gl_FragColor = vec4(finalColor, alpha);
}
```

### 3. Black Hole Shader (Buraco Negro)

```glsl
// vertex shader
varying vec3 vNormal;
varying vec3 vPosition;
varying vec2 vUv;

void main() {
  vNormal = normalize(normalMatrix * normal);
  vPosition = position;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}

// fragment shader
uniform float time;
uniform vec3 accretionColor;

varying vec3 vNormal;
varying vec3 vPosition;
varying vec2 vUv;

// Distortion function
vec2 distort(vec2 uv, float strength) {
  vec2 center = vec2(0.5, 0.5);
  vec2 delta = uv - center;
  float dist = length(delta);
  
  // Gravitational lensing
  float distortion = strength / (dist * dist + 0.1);
  
  return uv + delta * distortion;
}

void main() {
  // Event horizon (pure black)
  float distToCenter = length(vUv - vec2(0.5, 0.5));
  
  if (distToCenter < 0.3) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  
  // Accretion disk
  vec2 distortedUv = distort(vUv, 0.1);
  float angle = atan(distortedUv.y - 0.5, distortedUv.x - 0.5);
  float rotation = angle + time * 0.5;
  
  // Spiral pattern
  float spiral = sin(rotation * 5.0 + distToCenter * 20.0) * 0.5 + 0.5;
  
  // Color based on distance and spiral
  vec3 diskColor = accretionColor * spiral;
  float alpha = smoothstep(0.3, 0.5, distToCenter) * (1.0 - smoothstep(0.5, 0.7, distToCenter));
  
  gl_FragColor = vec4(diskColor, alpha);
}
```

### 4. Nebula Shader (Nebulosa)

```glsl
// vertex shader
varying vec3 vPosition;
varying vec2 vUv;
attribute float size;
attribute vec3 customColor;

varying vec3 vColor;

void main() {
  vPosition = position;
  vUv = uv;
  vColor = customColor;
  
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * (300.0 / -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
}

// fragment shader
uniform float time;
varying vec3 vColor;

void main() {
  // Circular particle
  vec2 center = gl_PointCoord - vec2(0.5);
  float dist = length(center);
  
  if (dist > 0.5) discard;
  
  // Soft edges
  float alpha = 1.0 - smoothstep(0.3, 0.5, dist);
  
  // Flickering
  float flicker = sin(time * 3.0 + dist * 10.0) * 0.2 + 0.8;
  
  gl_FragColor = vec4(vColor * flicker, alpha * 0.6);
}
```

### 5. Comet Shader (Cometa)

```glsl
// vertex shader
varying vec3 vPosition;
varying vec2 vUv;

void main() {
  vPosition = position;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}

// fragment shader
uniform vec3 color;
uniform float time;
uniform vec3 velocity;

varying vec3 vPosition;
varying vec2 vUv;

void main() {
  // Nucleus
  float distToCenter = length(vUv - vec2(0.5, 0.5));
  
  if (distToCenter < 0.2) {
    gl_FragColor = vec4(color, 1.0);
    return;
  }
  
  // Tail direction based on velocity
  vec2 tailDir = normalize(velocity.xy);
  vec2 toCenter = vUv - vec2(0.5, 0.5);
  float alignment = dot(normalize(toCenter), -tailDir);
  
  // Tail only in opposite direction of movement
  if (alignment < 0.0) {
    discard;
  }
  
  // Tail gradient
  float tailLength = length(toCenter);
  float alpha = alignment * (1.0 - smoothstep(0.2, 1.0, tailLength));
  
  // Turbulence
  float turbulence = sin(vUv.x * 10.0 + time) * 0.1;
  alpha *= (1.0 + turbulence);
  
  gl_FragColor = vec4(color, alpha * 0.7);
}
```

### 6. Planet Shader (Planeta)

```glsl
// vertex shader
varying vec3 vNormal;
varying vec3 vPosition;
varying vec2 vUv;

void main() {
  vNormal = normalize(normalMatrix * normal);
  vPosition = position;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}

// fragment shader
uniform vec3 color;
uniform float time;
uniform sampler2D noiseTexture;

varying vec3 vNormal;
varying vec3 vPosition;
varying vec2 vUv;

void main() {
  // Surface texture
  vec2 uv = vUv + vec2(time * 0.01, 0.0); // Rotation
  vec3 noise = texture2D(noiseTexture, uv).rgb;
  
  // Lighting
  vec3 lightDirection = normalize(vec3(1.0, 1.0, 1.0));
  float diffuse = max(dot(vNormal, lightDirection), 0.0);
  
  // Ambient occlusion
  float ao = 0.3 + 0.7 * diffuse;
  
  // Atmosphere
  vec3 viewDirection = normalize(cameraPosition - vPosition);
  float fresnel = pow(1.0 - dot(viewDirection, vNormal), 3.0);
  vec3 atmosphere = color * 0.5 * fresnel;
  
  // Final color
  vec3 surfaceColor = color * noise * ao;
  vec3 finalColor = surfaceColor + atmosphere;
  
  gl_FragColor = vec4(finalColor, 1.0);
}
```

---

## EFEITOS DE PARTÍCULAS

### 1. Sistema de Partículas Base

```typescript
// src/engine/visual/ParticleSystem.ts

import * as THREE from 'three';

interface ParticleConfig {
  count: number;
  size: number;
  color: THREE.Color;
  lifetime: number;
  velocity: THREE.Vector3;
  spread: number;
}

class ParticleSystem {
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;
  private particles: THREE.Points;
  private particleData: ParticleData[];

  constructor(config: ParticleConfig) {
    this.initializeGeometry(config);
    this.initializeMaterial(config);
    this.particles = new THREE.Points(this.geometry, this.material);
    this.particleData = [];
  }

  private initializeGeometry(config: ParticleConfig) {
    const positions = new Float32Array(config.count * 3);
    const velocities = new Float32Array(config.count * 3);
    const lifetimes = new Float32Array(config.count);
    const sizes = new Float32Array(config.count);

    for (let i = 0; i < config.count; i++) {
      // Random position within spread
      positions[i * 3] = (Math.random() - 0.5) * config.spread;
      positions[i * 3 + 1] = (Math.random() - 0.5) * config.spread;
      positions[i * 3 + 2] = (Math.random() - 0.5) * config.spread;

      // Random velocity
      velocities[i * 3] = (Math.random() - 0.5) * config.velocity.x;
      velocities[i * 3 + 1] = (Math.random() - 0.5) * config.velocity.y;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * config.velocity.z;

      // Random lifetime
      lifetimes[i] = Math.random() * config.lifetime;

      // Random size
      sizes[i] = Math.random() * config.size;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
    this.geometry.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  }

  private initializeMaterial(config: ParticleConfig) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: config.color },
        time: { value: 0 }
      },
      vertexShader: `
        attribute float lifetime;
        attribute float size;
        attribute vec3 velocity;
        
        uniform float time;
        
        varying float vLifetime;
        
        void main() {
          vLifetime = lifetime - time;
          
          vec3 pos = position + velocity * time;
          
          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_PointSize = size * (300.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        varying float vLifetime;
        
        void main() {
          if (vLifetime < 0.0) discard;
          
          vec2 center = gl_PointCoord - vec2(0.5);
          float dist = length(center);
          
          if (dist > 0.5) discard;
          
          float alpha = (1.0 - dist * 2.0) * (vLifetime / 5.0);
          
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
  }

  update(deltaTime: number) {
    this.material.uniforms.time.value += deltaTime / 1000;
  }

  getObject(): THREE.Points {
    return this.particles;
  }
}
```

### 2. Efeito de Supernova

```typescript
class SupernovaEffect {
  private particleSystems: ParticleSystem[];
  private shockwave: THREE.Mesh;

  constructor(position: THREE.Vector3, color: THREE.Color) {
    this.particleSystems = [];
    this.createExplosion(position, color);
    this.createShockwave(position, color);
  }

  private createExplosion(position: THREE.Vector3, color: THREE.Color) {
    // Core explosion
    const coreParticles = new ParticleSystem({
      count: 1000,
      size: 5,
      color: color,
      lifetime: 3,
      velocity: new THREE.Vector3(100, 100, 100),
      spread: 10
    });
    coreParticles.getObject().position.copy(position);
    this.particleSystems.push(coreParticles);

    // Outer debris
    const debrisParticles = new ParticleSystem({
      count: 500,
      size: 3,
      color: new THREE.Color(0xFFFFFF),
      lifetime: 5,
      velocity: new THREE.Vector3(50, 50, 50),
      spread: 20
    });
    debrisParticles.getObject().position.copy(position);
    this.particleSystems.push(debrisParticles);
  }

  private createShockwave(position: THREE.Vector3, color: THREE.Color) {
    const geometry = new THREE.SphereGeometry(1, 32, 32);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: color },
        time: { value: 0 }
      },
      vertexShader: `
        uniform float time;
        varying vec3 vNormal;
        
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec3 pos = position * (1.0 + time * 100.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        uniform float time;
        varying vec3 vNormal;
        
        void main() {
          float alpha = (1.0 - time) * 0.5;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });

    this.shockwave = new THREE.Mesh(geometry, material);
    this.shockwave.position.copy(position);
  }

  update(deltaTime: number) {
    this.particleSystems.forEach(ps => ps.update(deltaTime));
    
    if (this.shockwave) {
      const material = this.shockwave.material as THREE.ShaderMaterial;
      material.uniforms.time.value += deltaTime / 1000;
      
      if (material.uniforms.time.value > 1) {
        // Effect complete
        return true;
      }
    }
    
    return false;
  }

  getObjects(): THREE.Object3D[] {
    return [
      ...this.particleSystems.map(ps => ps.getObject()),
      this.shockwave
    ];
  }
}
```

---

## ANIMAÇÕES E TRANSIÇÕES

### 1. Easing Functions

```typescript
// src/engine/visual/Easing.ts

export const Easing = {
  linear: (t: number) => t,
  
  easeInQuad: (t: number) => t * t,
  easeOutQuad: (t: number) => t * (2 - t),
  easeInOutQuad: (t: number) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  
  easeInCubic: (t: number) => t * t * t,
  easeOutCubic: (t: number) => (--t) * t * t + 1,
  easeInOutCubic: (t: number) => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
  
  easeInQuart: (t: number) => t * t * t * t,
  easeOutQuart: (t: number) => 1 - (--t) * t * t * t,
  easeInOutQuart: (t: number) => t < 0.5 ? 8 * t * t * t * t : 1 - 8 * (--t) * t * t * t,
  
  easeInElastic: (t: number) => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4);
  },
  
  easeOutElastic: (t: number) => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  
  easeInBounce: (t: number) => 1 - Easing.easeOutBounce(1 - t),
  
  easeOutBounce: (t: number) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    
    if (t < 1 / d1) {
      return n1 * t * t;
    } else if (t < 2 / d1) {
      return n1 * (t -= 1.5 / d1) * t + 0.75;
    } else if (t < 2.5 / d1) {
      return n1 * (t -= 2.25 / d1) * t + 0.9375;
    } else {
      return n1 * (t -= 2.625 / d1) * t + 0.984375;
    }
  }
};
```

### 2. Animation Controller

```typescript
// src/engine/visual/AnimationController.ts

interface Animation {
  id: string;
  startTime: number;
  duration: number;
  easing: (t: number) => number;
  onUpdate: (progress: number) => void;
  onComplete?: () => void;
}

class AnimationController {
  private animations: Map<string, Animation>;

  constructor() {
    this.animations = new Map();
  }

  add(animation: Omit<Animation, 'startTime'>): string {
    const id = animation.id || this.generateId();
    
    this.animations.set(id, {
      ...animation,
      id,
      startTime: Date.now()
    });

    return id;
  }

  remove(id: string) {
    this.animations.delete(id);
  }

  update() {
    const now = Date.now();
    const toRemove: string[] = [];

    this.animations.forEach((animation, id) => {
      const elapsed = now - animation.startTime;
      const progress = Math.min(elapsed / animation.duration, 1);
      const eased = animation.easing(progress);

      animation.onUpdate(eased);

      if (progress >= 1) {
        if (animation.onComplete) {
          animation.onComplete();
        }
        toRemove.push(id);
      }
    });

    toRemove.forEach(id => this.remove(id));
  }

  private generateId(): string {
    return `anim_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export default AnimationController;
```

---

## POST-PROCESSING

### 1. Bloom Effect

```typescript
// src/engine/visual/PostProcessing.ts

import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass';

class PostProcessing {
  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera
  ) {
    this.composer = new EffectComposer(renderer);

    // Render pass
    const renderPass = new RenderPass(scene, camera);
    this.composer.addPass(renderPass);

    // Bloom pass
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      1.5,  // strength
      0.4,  // radius
      0.85  // threshold
    );
    this.composer.addPass(this.bloomPass);

    // Custom vignette pass
    const vignettePass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        darkness: { value: 0.5 },
        offset: { value: 1.0 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float darkness;
        uniform float offset;
        varying vec2 vUv;
        
        void main() {
          vec4 texel = texture2D(tDiffuse, vUv);
          vec2 uv = (vUv - vec2(0.5)) * vec2(offset);
          float vignette = 1.0 - dot(uv, uv) * darkness;
          gl_FragColor = vec4(texel.rgb * vignette, texel.a);
        }
      `
    });
    this.composer.addPass(vignettePass);
  }

  render() {
    this.composer.render();
  }

  setBloomStrength(strength: number) {
    this.bloomPass.strength = strength;
  }

  resize(width: number, height: number) {
    this.composer.setSize(width, height);
  }
}

export default PostProcessing;
```

---

## PERFORMANCE OPTIMIZATION

### 1. Level of Detail (LOD)

```typescript
// src/engine/visual/LODManager.ts

class LODManager {
  private lodLevels: Map<string, THREE.LOD>;

  constructor() {
    this.lodLevels = new Map();
  }

  createLOD(
    id: string,
    highDetail: THREE.Object3D,
    mediumDetail: THREE.Object3D,
    lowDetail: THREE.Object3D
  ): THREE.LOD {
    const lod = new THREE.LOD();

    lod.addLevel(highDetail, 0);      // 0-100 units
    lod.addLevel(mediumDetail, 100);  // 100-500 units
    lod.addLevel(lowDetail, 500);     // 500+ units

    this.lodLevels.set(id, lod);

    return lod;
  }

  update(camera: THREE.Camera) {
    this.lodLevels.forEach(lod => {
      lod.update(camera);
    });
  }
}
```

### 2. Frustum Culling

```typescript
// src/engine/visual/FrustumCuller.ts

class FrustumCuller {
  private frustum: THREE.Frustum;
  private projScreenMatrix: THREE.Matrix4;

  constructor() {
    this.frustum = new THREE.Frustum();
    this.projScreenMatrix = new THREE.Matrix4();
  }

  update(camera: THREE.Camera) {
    this.projScreenMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    );
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);
  }

  isVisible(object: THREE.Object3D): boolean {
    const boundingSphere = new THREE.Sphere();
    
    if (object.geometry) {
      object.geometry.computeBoundingSphere();
      boundingSphere.copy(object.geometry.boundingSphere!);
      boundingSphere.applyMatrix4(object.matrixWorld);
    }

    return this.frustum.intersectsSphere(boundingSphere);
  }

  cullObjects(objects: THREE.Object3D[]): THREE.Object3D[] {
    return objects.filter(obj => this.isVisible(obj));
  }
}
```

### 3. Object Pooling

```typescript
// src/engine/visual/ObjectPool.ts

class ObjectPool<T> {
  private pool: T[];
  private factory: () => T;
  private reset: (obj: T) => void;

  constructor(factory: () => T, reset: (obj: T) => void, initialSize: number = 100) {
    this.factory = factory;
    this.reset = reset;
    this.pool = [];

    for (let i = 0; i < initialSize; i++) {
      this.pool.push(factory());
    }
  }

  acquire(): T {
    if (this.pool.length > 0) {
      return this.pool.pop()!;
    }
    return this.factory();
  }

  release(obj: T) {
    this.reset(obj);
    this.pool.push(obj);
  }

  clear() {
    this.pool = [];
  }
}

// Usage example
const particlePool = new ObjectPool(
  () => new THREE.Mesh(
    new THREE.SphereGeometry(1, 8, 8),
    new THREE.MeshBasicMaterial()
  ),
  (mesh) => {
    mesh.position.set(0, 0, 0);
    mesh.scale.set(1, 1, 1);
    mesh.visible = false;
  },
  1000
);
```

---

## CONCLUSÃO

Esta especificação visual define:

1. **Paleta de cores** consistente e significativa
2. **Shaders customizados** para cada tipo de objeto celeste
3. **Sistema de partículas** flexível e performante
4. **Animações suaves** com easing functions
5. **Post-processing** para qualidade visual
6. **Otimizações** para performance em larga escala

Todos os elementos visuais servem a **cognição** — não são decorativos, são **funcionais**.

O resultado é um universo que parece **10 anos à frente** do mercado atual.
