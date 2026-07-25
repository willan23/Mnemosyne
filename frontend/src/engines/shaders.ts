export const starVertexShader = `
varying vec3 vNormal;
varying vec2 vUv;
uniform float uTime;
void main() {
  vNormal = normal;
  vUv = uv;
  vec3 pos = position;
  pos += normal * sin(uTime * 3.0 + position.x * 10.0) * 0.02;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const starFragmentShader = `
varying vec3 vNormal;
varying vec2 vUv;
uniform float uTime;
uniform vec3 uColor;
uniform float uIntensity;
void main() {
  float glow = pow(0.6 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
  vec3 pulse = uColor * (1.0 + 0.3 * sin(uTime * 2.0));
  vec3 color = mix(pulse, vec3(1.0), glow * 0.5) * uIntensity;
  float alpha = 0.7 + 0.3 * sin(uTime * 1.5);
  gl_FragColor = vec4(color, alpha);
}
`;

export const sunVertexShader = `
varying vec3 vNormal;
varying vec2 vUv;
uniform float uTime;
void main() {
  vNormal = normal;
  vUv = uv;
  vec3 pos = position;
  float noise = sin(pos.x * 5.0 + uTime) * cos(pos.y * 5.0 + uTime * 0.7) * 0.05;
  pos += normal * noise;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const sunFragmentShader = `
varying vec3 vNormal;
varying vec2 vUv;
uniform float uTime;
uniform vec3 uColor;
void main() {
  float rim = 1.0 - max(0.0, dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)));
  rim = pow(rim, 2.0);
  vec3 core = vec3(1.0, 0.95, 0.7);
  vec3 corona = uColor * 1.5;
  vec3 color = mix(core, corona, rim);
  color += vec3(0.3, 0.1, 0.0) * sin(uTime + vUv.x * 20.0) * 0.1;
  gl_FragColor = vec4(color, 1.0);
}
`;

export const blackHoleVertexShader = `
varying vec3 vNormal;
varying vec2 vUv;
uniform float uTime;
void main() {
  vNormal = normal;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const blackHoleFragmentShader = `
varying vec3 vNormal;
varying vec2 vUv;
uniform float uTime;
uniform vec3 uAccretionColor;
void main() {
  vec2 center = vec2(0.5, 0.5);
  float dist = length(vUv - center);
  float accretion = smoothstep(0.45, 0.5, dist) * smoothstep(0.65, 0.5, dist);
  float rotation = atan(vUv.y - 0.5, vUv.x - 0.5) + uTime * 2.0;
  float bands = sin(rotation * 8.0 + dist * 20.0) * 0.5 + 0.5;
  vec3 color = uAccretionColor * accretion * bands;
  float core = smoothstep(0.3, 0.0, dist);
  float alpha = accretion * 0.9 + core;
  gl_FragColor = vec4(color, alpha);
}
`;

export const nebulaVertexShader = `
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vPosition;
void main() {
  vNormal = normal;
  vUv = uv;
  vPosition = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const nebulaFragmentShader = `
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vPosition;
uniform float uTime;
uniform vec3 uColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
}
void main() {
  vec2 uv = vUv * 3.0 + uTime * 0.05;
  float n = noise(uv) * noise(uv * 2.0 + 0.5) * noise(uv * 4.0 - 0.3);
  float rim = 1.0 - length(vUv - 0.5) * 2.0;
  rim = max(0.0, rim);
  vec3 color = uColor * n * rim * 1.5;
  color += uColor * 0.3 * rim;
  gl_FragColor = vec4(color, n * rim * 0.8);
}
`;

export const cometVertexShader = `
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vNormal = normal;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const cometFragmentShader = `
varying vec3 vNormal;
varying vec2 vUv;
uniform float uTime;
uniform vec3 uColor;
void main() {
  float core = smoothstep(0.15, 0.0, length(vUv - vec2(0.5, 0.5)));
  float tail = smoothstep(0.0, 1.0, vUv.x) * smoothstep(0.6, 0.4, abs(vUv.y - 0.5));
  vec3 color = uColor * (core * 2.0 + tail * 0.5);
  float alpha = core + tail * 0.4;
  gl_FragColor = vec4(color, alpha);
}
`;

export const planetVertexShader = `
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vNormal = normal;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const planetFragmentShader = `
varying vec3 vNormal;
varying vec2 vUv;
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uColor2;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    value += amplitude * noise(p);
    p *= 2.05;
    amplitude *= 0.5;
  }
  return value;
}
void main() {
  vec2 uv = vUv;
  float latitude = abs(uv.y - 0.5) * 2.0;
  float drift = uTime * 0.018;
  float landmass = fbm(vec2(uv.x * 3.4 + drift, uv.y * 2.2));
  float fineWeather = fbm(vec2(uv.x * 13.0 - drift * 1.8, uv.y * 8.0 + sin(uv.x * 8.0) * 0.08));
  float gasBand = sin((uv.y + fineWeather * 0.05) * 42.0) * 0.5 + 0.5;
  float continents = smoothstep(0.42, 0.72, landmass + latitude * 0.12);
  vec3 ocean = mix(uColor * 0.62, uColor2 * 0.85, landmass);
  vec3 terrain = mix(uColor2 * 0.85, uColor * 1.35, fineWeather);
  vec3 color = mix(ocean, terrain, continents * 0.72);
  color = mix(color, mix(uColor, uColor2, gasBand) * 1.15, 0.18 + gasBand * 0.12);

  vec3 normal = normalize(vNormal);
  float light = 0.38 + 0.62 * max(0.0, dot(normal, normalize(vec3(-0.35, 0.25, 1.0))));
  float rim = pow(1.0 - max(0.0, dot(normal, vec3(0, 0, 1))), 2.7);
  vec3 atmosphere = mix(vec3(0.28, 0.48, 1.0), uColor2, 0.35) * rim * 0.42;
  gl_FragColor = vec4(color * light + atmosphere, 1.0);
}
`;
