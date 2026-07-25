import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createCosmicDust,
  createGalacticCore,
  createNebulaClouds,
  createRingBands,
  createSpiralGalaxy,
  createStarShell,
} from './space3dBackdrop';

describe('space3d-inspired backdrop helpers', () => {
  it('generates deterministic star shells from a seed', () => {
    const first = createStarShell({ count: 8, radiusMin: 10, radiusMax: 20, seed: 'stellar' });
    const second = createStarShell({ count: 8, radiusMin: 10, radiusMax: 20, seed: 'stellar' });

    expect(Array.from(first.positions)).toEqual(Array.from(second.positions));
    expect(Array.from(first.colors)).toEqual(Array.from(second.colors));
  });

  it('keeps spiral galaxy points inside the requested visual radius', () => {
    const galaxy = createSpiralGalaxy({
      count: 120,
      arms: 5,
      radius: 42,
      thickness: 7,
      seed: 'test-galaxy',
    });

    const distances = Array.from({ length: 120 }, (_, index) => {
      const x = galaxy.positions[index * 3];
      const z = galaxy.positions[index * 3 + 2];
      return Math.hypot(x, z);
    });

    expect(Math.max(...distances)).toBeLessThan(48);
  });

  it('builds ordered translucent ring bands', () => {
    const bands = createRingBands('memory-1', 2, new THREE.Color('#4488ff'), 1);

    expect(bands.length).toBeGreaterThanOrEqual(5);
    for (const band of bands) {
      expect(band.outerRadius).toBeGreaterThan(band.innerRadius);
      expect(band.opacity).toBeGreaterThan(0);
      expect(band.opacity).toBeLessThanOrEqual(0.18);
    }
  });

  it('varies nebula color palettes by universe type', () => {
    const stellar = createNebulaClouds('stellar', 'seed', 2);
    const garden = createNebulaClouds('garden', 'seed', 2);

    expect(stellar.map((cloud) => cloud.color)).not.toEqual(garden.map((cloud) => cloud.color));
  });

  it('builds cosmic dust and galactic core point clouds', () => {
    const dust = createCosmicDust(64, 'dust-seed', 40);
    const core = createGalacticCore(48, 'core-seed');

    expect(dust.positions.length).toBe(64 * 3);
    expect(dust.colors.length).toBe(64 * 3);
    expect(core.positions.length).toBe(48 * 3);
    expect(Math.max(...Array.from(core.positions.map(Math.abs)))).toBeLessThan(12);
  });
});
