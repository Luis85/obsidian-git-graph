export type SegmentKind = 'pass' | 'in' | 'out';
/**
 * One piece of line in a row's SVG cell. `pass` runs straight through the row in `fromLane`;
 * `out` is the upper half of a line leaving this row's centre at `fromLane` for `toLane` on
 * the row below, and `in` is the lower half of that same line, arriving at `toLane` on this
 * row from `fromLane` on the row above.
 */
export interface Segment { fromLane: number; toLane: number; color: number; kind: SegmentKind }
export interface Row { hash: string; lane: number; color: number; isMerge: boolean; segments: Segment[]; laneCount: number }
