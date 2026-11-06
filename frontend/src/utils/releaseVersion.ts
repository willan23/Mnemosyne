export interface ParsedReleaseVersion { core: string[]; prerelease: string[] }
const versionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** Release metadata has bounded ASCII SemVer; numeric identifiers need no lossy Number conversion. */
export function parseReleaseVersion(value: string): ParsedReleaseVersion | null {
  if (typeof value !== 'string' || value.length > 256 || value !== value.trim()) return null;
  const match = versionPattern.exec(value); if (!match) return null;
  const prerelease = match[4]?.split('.') ?? [];
  if (prerelease.some(part => /^[0-9]+$/.test(part) && part.length > 1 && part[0] === '0')) return null;
  return { core: [match[1], match[2], match[3]], prerelease };
}

const digits = (a: string, b: string) => a.length !== b.length ? Math.sign(a.length - b.length) : a === b ? 0 : a > b ? 1 : -1;
export function compareReleaseVersions(a: ParsedReleaseVersion, b: ParsedReleaseVersion): number {
  for (let i = 0; i < 3; i++) { const difference = digits(a.core[i], b.core[i]); if (difference) return difference; }
  if (!a.prerelease.length || !b.prerelease.length) return a.prerelease.length ? -1 : b.prerelease.length ? 1 : 0;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const first = a.prerelease[i], second = b.prerelease[i];
    if (first === undefined || second === undefined) return first === undefined ? -1 : 1;
    if (first === second) continue;
    const numericA = /^[0-9]+$/.test(first), numericB = /^[0-9]+$/.test(second);
    if (numericA && numericB) return digits(first, second);
    if (numericA !== numericB) return numericA ? -1 : 1;
    return first > second ? 1 : -1;
  }
  return 0;
}
