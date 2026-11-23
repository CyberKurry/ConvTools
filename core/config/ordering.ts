/**
 * Locale-independent ordering for generated IDs and persisted module lists.
 * Code-point ordering keeps output identical across developer and CI locales.
 */
export function compareCodePoints(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const leftPoint = (leftPoints[index] ?? '').codePointAt(0) ?? 0;
    const rightPoint = (rightPoints[index] ?? '').codePointAt(0) ?? 0;
    if (leftPoint !== rightPoint) {
      return leftPoint - rightPoint;
    }
  }
  return leftPoints.length - rightPoints.length;
}
