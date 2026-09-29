export function versionMatches(current: number | null, baseVersion: number): boolean {
 return (current ?? 0) === baseVersion;
}
