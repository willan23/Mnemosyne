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
import { getUniverseTheme } from '../../engines/universeThemes';

interface Space3DBackdropProps {
  universeType: UniverseType;
  detailLevel: UniverseDetailLevel;
  starCount: number;
  reduceEffects?: boolean;
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

  useFrame((state, delta) => {
    points.rotation.y += delta * rotationSpeed;
    material.opacity = opacity * (0.9 + 0.1 * Math.sin(state.clock.elapsedTime * 0.28 + rotationSpeed * 18));
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

const AccretionDisk: React.FC<{
  color: string;
  opacity: number;
  detailLevel: UniverseDetailLevel;
}> = ({ color, opacity, detailLevel }) => {
  const geometry = useMemo(
    () => new THREE.RingGeometry(3.2, 11.5, detailLevel === 'high' ? 96 : 48),
    [detailLevel],
  );
  const material = useMemo(() => new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }), [color, opacity]);

  const mesh = useMemo(() => {
    const disk = new THREE.Mesh(geometry, material);
    disk.rotation.x = Math.PI / 2.15;
    return disk;
  }, [geometry, material]);

  useFrame((_, delta) => {
    mesh.rotation.z += delta * 0.08;
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
  reduceEffects = false,
}) => {
  const theme = getUniverseTheme(universeType);
  const bd = theme.backdrop;

  const detailMultiplier = reduceEffects
    ? 0.5
    : detailLevel === 'low'
      ? 0.55
      : detailLevel === 'medium'
        ? 0.78
        : 1;

  const farStars = useMemo(() => createStarShell({
    count: Math.max(220, Math.floor(starCount * 0.62 * detailMultiplier * bd.farStarMul)),
    radiusMin: 95,
    radiusMax: 190,
    seed: `${universeType}:far`,
    eccentricity: bd.planeEccentricity,
    planeBias: Math.min(0.35, bd.planeBias * 0.35),
    palette: [...bd.starPalette],
  }), [bd.farStarMul, bd.planeBias, bd.planeEccentricity, bd.starPalette, detailMultiplier, starCount, universeType]);

  const planeStars = useMemo(() => createStarShell({
    count: Math.max(120, Math.floor(starCount * 0.22 * detailMultiplier * bd.planeStarMul)),
    radiusMin: 62,
    radiusMax: 145,
    seed: `${universeType}:plane`,
    eccentricity: bd.planeEccentricity,
    planeBias: bd.planeBias,
    palette: [...bd.starPalette],
  }), [bd.planeBias, bd.planeEccentricity, bd.planeStarMul, bd.starPalette, detailMultiplier, starCount, universeType]);

  const galaxy = useMemo(() => {
    if (bd.spiralWeight <= 0.05) return null;
    const baseCount = reduceEffects || detailLevel === 'low' ? 520 : detailLevel === 'medium' ? 780 : 1100;
    return createSpiralGalaxy({
      count: Math.max(80, Math.floor(baseCount * bd.spiralWeight)),
      arms: bd.spiralArms,
      radius: bd.spiralRadius,
      thickness: bd.spiralThickness,
      seed: `${universeType}:spiral`,
      coreColor: bd.spiralCoreColor,
      armColorA: bd.spiralArmA,
      armColorB: bd.spiralArmB,
    });
  }, [bd, detailLevel, reduceEffects, universeType]);

  const nebulae = useMemo(
    () => createNebulaClouds(
      universeType,
      'mnemosyne-space3d',
      reduceEffects || detailLevel === 'low'
        ? Math.max(1, Math.min(bd.nebulaCount, 3))
        : bd.nebulaCount,
      bd.nebulaOpacityMul,
    ),
    [bd.nebulaCount, bd.nebulaOpacityMul, detailLevel, reduceEffects, universeType],
  );

  const dust = useMemo(
    () => createCosmicDust(
      Math.max(
        80,
        Math.floor((reduceEffects ? 280 : detailLevel === 'low' ? 420 : detailLevel === 'medium' ? 720 : 1100) * bd.dustMul),
      ),
      `${universeType}:near-dust`,
      52,
    ),
    [bd.dustMul, detailLevel, reduceEffects, universeType],
  );

  const core = useMemo(
    () => createGalacticCore(
      detailLevel === 'low' ? 180 : detailLevel === 'medium' ? 280 : 420,
      `${universeType}:core`,
    ),
    [detailLevel, universeType],
  );

  return (
    <group>
      <mesh>
        <sphereGeometry args={[bd.coreSize, detailLevel === 'high' ? 48 : 24, detailLevel === 'high' ? 48 : 24]} />
        <meshBasicMaterial
          color={bd.coreColor}
          transparent
          opacity={universeType === 'void' ? 0.04 : 0.1}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[bd.coreSize * 2.7, 24, 24]} />
        <meshBasicMaterial
          color={bd.coreGlowColor}
          transparent
          opacity={bd.coreGlowOpacity}
          depthWrite={false}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {bd.showAccretionDisk && bd.accretionOpacity > 0 && (
        <AccretionDisk
          color={bd.accretionColor}
          opacity={bd.accretionOpacity}
          detailLevel={detailLevel}
        />
      )}

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
      {galaxy && (
        <PointLayer
          data={galaxy}
          size={0.24}
          opacity={0.42 + bd.spiralWeight * 0.2}
          rotationSpeed={0.012}
          rotation={bd.spiralTilt}
        />
      )}
      <PointLayer
        data={core}
        size={0.18}
        opacity={universeType === 'void' ? 0.35 : 0.78}
        rotationSpeed={0.02}
      />
      {!reduceEffects && bd.dustMul > 0.2 && (
        <PointLayer
          data={dust}
          size={0.09}
          opacity={0.38}
          rotationSpeed={0.008}
          rotation={[0.1, -0.4, 0.05]}
        />
      )}
    </group>
  );
};
