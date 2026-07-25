import React, { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { UniverseType } from '../../types/universe';
import type { UniverseDetailLevel } from '../../engines/celestialLayout';
import {
  createCosmicDust,
  createGalacticCore,
  createNebulaClouds,
  createSpiralGalaxy,
  createStarShell,
  type PointCloudData,
} from '../../engines/space3dBackdrop';

interface Space3DBackdropProps {
  universeType: UniverseType;
  detailLevel: UniverseDetailLevel;
  starCount: number;
}

interface PointLayerProps {
  data: PointCloudData;
  size: number;
  opacity: number;
  rotationSpeed: number;
  rotation?: [number, number, number];
}

const PointLayer: React.FC<PointLayerProps> = ({
  data,
  size,
  opacity,
  rotationSpeed,
  rotation = [0, 0, 0],
}) => {
  const geometry = useMemo(() => {
    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    buffer.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    return buffer;
  }, [data]);

  const material = useMemo(() => new THREE.PointsMaterial({
    size,
    vertexColors: true,
    transparent: true,
    opacity,
    sizeAttenuation: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }), [opacity, size]);

  const points = useMemo(() => {
    const pointCloud = new THREE.Points(geometry, material);
    pointCloud.rotation.set(rotation[0], rotation[1], rotation[2]);
    return pointCloud;
  }, [geometry, material, rotation]);

  useFrame((_, delta) => {
    points.rotation.y += delta * rotationSpeed;
  });

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  return <primitive object={points} />;
};

const NebulaHaze: React.FC<{
  cloud: ReturnType<typeof createNebulaClouds>[number];
  detailLevel: UniverseDetailLevel;
}> = ({ cloud, detailLevel }) => {
  const geometry = useMemo(() => new THREE.SphereGeometry(1, detailLevel === 'high' ? 32 : 16, detailLevel === 'high' ? 16 : 8), [detailLevel]);
  const material = useMemo(() => new THREE.MeshBasicMaterial({
    color: cloud.color,
    transparent: true,
    opacity: cloud.opacity,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
  }), [cloud.color, cloud.opacity]);

  const mesh = useMemo(() => {
    const haze = new THREE.Mesh(geometry, material);
    haze.position.set(...cloud.position);
    haze.scale.set(...cloud.scale);
    haze.rotation.set(...cloud.rotation);
    return haze;
  }, [cloud.position, cloud.rotation, cloud.scale, geometry, material]);

  useFrame((_, delta) => {
    mesh.rotation.y += delta * 0.012;
    mesh.rotation.z += delta * 0.004;
  });

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  return <primitive object={mesh} />;
};

export const Space3DBackdrop: React.FC<Space3DBackdropProps> = ({
  universeType,
  detailLevel,
  starCount,
}) => {
  const detailMultiplier = detailLevel === 'low' ? 0.55 : detailLevel === 'medium' ? 0.78 : 1;
  const farStars = useMemo(() => createStarShell({
    count: Math.max(500, Math.floor(starCount * 0.62 * detailMultiplier)),
    radiusMin: 95,
    radiusMax: 190,
    seed: `${universeType}:far`,
    eccentricity: [1.25, 0.92, 1.1],
    planeBias: 0.18,
  }), [detailMultiplier, starCount, universeType]);

  const planeStars = useMemo(() => createStarShell({
    count: Math.max(260, Math.floor(starCount * 0.22 * detailMultiplier)),
    radiusMin: 62,
    radiusMax: 145,
    seed: `${universeType}:plane`,
    eccentricity: [1.45, 0.2, 1.25],
    planeBias: 0.92,
  }), [detailMultiplier, starCount, universeType]);

  const galaxy = useMemo(() => createSpiralGalaxy({
    count: detailLevel === 'low' ? 520 : detailLevel === 'medium' ? 780 : 1100,
    arms: universeType === 'void' ? 3 : 5,
    radius: 42,
    thickness: 7,
    seed: `${universeType}:spiral`,
  }), [detailLevel, universeType]);

  const nebulae = useMemo(
    () => createNebulaClouds(universeType, 'mnemosyne-space3d', detailLevel === 'low' ? 3 : 5),
    [detailLevel, universeType]
  );

  const dust = useMemo(
    () => createCosmicDust(
      detailLevel === 'low' ? 420 : detailLevel === 'medium' ? 720 : 1100,
      `${universeType}:near-dust`,
      52
    ),
    [detailLevel, universeType]
  );

  const core = useMemo(
    () => createGalacticCore(
      detailLevel === 'low' ? 180 : detailLevel === 'medium' ? 280 : 420,
      `${universeType}:core`
    ),
    [detailLevel, universeType]
  );

  return (
    <group>
      {/* Núcleo luminoso — âncora visual do universo */}
      <mesh>
        <sphereGeometry args={[2.4, detailLevel === 'high' ? 48 : 24, detailLevel === 'high' ? 48 : 24]} />
        <meshBasicMaterial
          color="#fff1c4"
          transparent
          opacity={0.09}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[6.5, 24, 24]} />
        <meshBasicMaterial
          color={universeType === 'solar' ? '#ff9f1c' : universeType === 'void' ? '#4c1d95' : '#7c5cff'}
          transparent
          opacity={0.035}
          depthWrite={false}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {nebulae.map((cloud) => (
        <NebulaHaze key={cloud.id} cloud={cloud} detailLevel={detailLevel} />
      ))}
      <PointLayer
        data={farStars}
        size={0.32}
        opacity={0.68}
        rotationSpeed={0.0025}
      />
      <PointLayer
        data={planeStars}
        size={0.48}
        opacity={0.55}
        rotationSpeed={-0.005}
        rotation={[0.18, 0.35, -0.08]}
      />
      <PointLayer
        data={galaxy}
        size={0.24}
        opacity={0.52}
        rotationSpeed={0.012}
        rotation={[0.74, -0.22, 0.18]}
      />
      <PointLayer
        data={core}
        size={0.18}
        opacity={0.78}
        rotationSpeed={0.02}
      />
      <PointLayer
        data={dust}
        size={0.09}
        opacity={0.38}
        rotationSpeed={0.008}
        rotation={[0.1, -0.4, 0.05]}
      />
    </group>
  );
};
