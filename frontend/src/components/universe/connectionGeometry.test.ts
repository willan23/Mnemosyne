import { describe, expect, it } from 'vitest';
import {
  connectionControlPoint,
  quadraticBezierPoint,
  sampleArcPoint,
  writeArcLinePairs,
} from './connectionGeometry';

describe('connectionGeometry', () => {
  it('evaluates a quadratic bezier at the endpoints and midpoint', () => {
    const out = new Float32Array(3);

    quadraticBezierPoint(out, 0, 0, 0, 0, 0, 0, 1, 0, 2, 0, 0);
    expect(Array.from(out)).toEqual([0, 0, 0]);

    quadraticBezierPoint(out, 0, 1, 0, 0, 0, 0, 1, 0, 2, 0, 0);
    expect(Array.from(out)).toEqual([2, 0, 0]);

    quadraticBezierPoint(out, 0, 0.5, 0, 0, 0, 0, 2, 0, 2, 0, 0);
    expect(out[0]).toBeCloseTo(0.5, 5);
    expect(out[1]).toBeCloseTo(1, 5);
  });

  it('lifts the control point away from the origin along the midpoint', () => {
    const [cx, cy, cz] = connectionControlPoint(2, 0, 0, 4, 0, 0);
    expect(cx).toBeGreaterThan(3);
    expect(cy).toBe(0);
    expect(cz).toBe(0);
  });

  it('writes the requested number of line pairs for an arc', () => {
    const positions = new Float32Array(6 * 4);
    const next = writeArcLinePairs(positions, 0, 0, 0, 0, 4, 0, 0, 4);

    expect(next).toBe(24);
    expect(positions[0]).toBeCloseTo(0, 5);
    expect(positions[21]).toBeCloseTo(4, 5);
    expect(positions[3]).toBeCloseTo(positions[6], 5);
  });

  it('samples a point along the same arc used by the line pairs', () => {
    const point = new Float32Array(3);
    sampleArcPoint(point, 0, 0, 0, 0, 0, 5, 0, 0);
    expect(point[0]).toBeCloseTo(0, 5);
    sampleArcPoint(point, 0, 1, 0, 0, 0, 5, 0, 0);
    expect(point[0]).toBeCloseTo(5, 5);
  });
});
