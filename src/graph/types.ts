export interface Lane { waitingFor: string; color: number }
export type SegmentKind = 'pass' | 'in' | 'out';
export interface Segment { fromLane: number; toLane: number; color: number; kind: SegmentKind }
export interface Row { hash: string; lane: number; color: number; isMerge: boolean; segments: Segment[]; laneCount: number }
export interface LayoutState { lanes: (Lane | null)[]; nextColor: number }
