import type { Commit } from '../git/types';
import type { Row, Segment } from './types';

/**
 * The lane layout is a port of the algorithm behind VS Code's Git Graph extension
 * (mhutchie/vscode-git-graph, web/graph.ts): paths are traced one at a time in row order,
 * each following first parents down the list, and every row hands out its columns
 * left-to-right in the order the paths reach it. That gives the graph its shape: the
 * first-parent chain of the top commit owns column 0 all the way down, a line whose parent
 * was already placed runs beside the graph until the parent's row and curves in there, and
 * lines slide left as soon as a line to their left ends.
 */

const LANE_COLORS = 8;
/** A parent that is not among the laid-out commits: its line runs off the bottom of the graph. */
const EXTERNAL = -1;
const NONE = -1;

interface Vertex {
	/** Vertex indexes, or `EXTERNAL`; a hash repeated in one commit's parent list is kept once. */
	parents: number[];
	nextParent: number;
	/** Index into `Graph.branchColors`; `NONE` until a path places the vertex. */
	branch: number;
	x: number;
	nextX: number;
	/** Per column: what the line through that column is heading for, and on which branch. */
	connections: { vertex: number; branch: number }[];
}

/** One line of a path, from column `x1` on `row` to column `x2` on the row below. */
interface Line { row: number; x1: number; x2: number; color: number }

interface Graph {
	vertices: Vertex[];
	lines: Line[];
	branchColors: number[];
	/** Per color: the last row a path of that color touched, or Infinity while one is still running. */
	colorEnds: number[];
	/** Columns already carrying a line off the bottom of the last row. */
	bottomColumns: Set<number>;
}

function buildVertices(commits: readonly Commit[]): Vertex[] {
	const indexOf = new Map(commits.map((c, i) => [c.hash, i]));
	return commits.map((c) => ({
		parents: [...new Set(c.parents)].map((h) => indexOf.get(h) ?? EXTERNAL),
		nextParent: 0,
		branch: NONE,
		x: 0,
		nextX: 0,
		connections: [],
	}));
}

function nextParent(v: Vertex): number | null {
	return v.parents[v.nextParent] ?? null;
}

function registerPoint(v: Vertex, x: number, vertex: number, branch: number): void {
	if (x !== v.nextX) return;
	v.nextX = x + 1;
	v.connections[x] = { vertex, branch };
}

function pointConnectingTo(v: Vertex, vertex: number, branch: number): number {
	return v.connections.findIndex((c) => c.vertex === vertex && c.branch === branch);
}

function place(v: Vertex, branch: number, x: number): void {
	if (v.branch !== NONE) return;
	v.branch = branch;
	v.x = x;
}

/** The lowest color whose last path ended above `startAt`, else a new one. */
function availableColor(g: Graph, startAt: number): number {
	const free = g.colorEnds.findIndex((end) => startAt > end);
	if (free !== NONE) return free;
	g.colorEnds.push(Infinity);
	return g.colorEnds.length - 1;
}

/**
 * A merge whose parent is already placed: run beside the graph until a row where a line is
 * already heading for that parent on its branch, and join it there. The line is drawn in the
 * parent's color.
 */
function connectToPlaced(g: Graph, startAt: number, parent: number): void {
	const v = g.vertices[startAt] as Vertex;
	const branch = (g.vertices[parent] as Vertex).branch;
	const color = g.branchColors[branch] as number;
	let lastX = v.x;
	for (let i = startAt + 1; i < g.vertices.length; i++) {
		const cur = g.vertices[i] as Vertex;
		const joinX = pointConnectingTo(cur, parent, branch);
		const x = joinX === NONE ? cur.nextX : joinX;
		g.lines.push({ row: i - 1, x1: lastX, x2: x, color });
		registerPoint(cur, x, parent, branch);
		lastX = x;
		if (joinX !== NONE) break;
	}
	v.nextParent++;
}

/**
 * A new path: place the start vertex if it is not placed yet, then follow first parents,
 * placing each unplaced parent and continuing from it, until a parent that is already placed
 * (curve into it), a root, or a parent outside the loaded commits (run off the bottom).
 */
function followChain(g: Graph, startAt: number): void {
	const branch = g.branchColors.length;
	const color = availableColor(g, startAt);
	g.branchColors.push(color);
	let v = g.vertices[startAt] as Vertex;
	let parent = nextParent(v);
	let lastX = v.branch === NONE ? v.nextX : v.x;
	let end = startAt;
	place(v, branch, lastX);
	registerPoint(v, lastX, startAt, branch);
	for (let i = startAt + 1; i < g.vertices.length && parent !== null; i++) {
		const cur = g.vertices[i] as Vertex;
		const reached = parent === i;
		const x = reached && cur.branch !== NONE ? cur.x : cur.nextX;
		g.lines.push({ row: i - 1, x1: lastX, x2: x, color });
		registerPoint(cur, x, parent, branch);
		lastX = x;
		end = i;
		if (!reached) continue;
		v.nextParent++;
		const wasPlaced = cur.branch !== NONE;
		place(cur, branch, x);
		v = cur;
		parent = wasPlaced ? null : nextParent(cur);
	}
	// The parent is outside the loaded commits (or, with a malformed order, above its child):
	// the line runs off the bottom of the last row, and the parent counts as handled. A line that
	// crossed rows below its start already owns a unique column there; one that starts on the
	// last row would otherwise leave at the commit's own column for every parent, so each after
	// the first takes the next free column instead.
	if (parent !== null) {
		v.nextParent++;
		const x2 = offBottomColumn(g, lastX);
		g.lines.push({ row: g.vertices.length - 1, x1: lastX, x2, color });
	}
	g.colorEnds[color] = end;
}

function offBottomColumn(g: Graph, preferred: number): number {
	const last = g.vertices[g.vertices.length - 1] as Vertex;
	let x = preferred;
	if (g.bottomColumns.has(x)) {
		x = last.nextX;
		last.nextX = x + 1;
	}
	g.bottomColumns.add(x);
	return x;
}

function tracePaths(commits: readonly Commit[]): Graph {
	const g: Graph = { vertices: buildVertices(commits), lines: [], branchColors: [], colorEnds: [], bottomColumns: new Set() };
	let i = 0;
	while (i < g.vertices.length) {
		const v = g.vertices[i] as Vertex;
		const parent = nextParent(v);
		if (v.branch !== NONE && parent === null) {
			i++;
		} else if (parent !== null && parent !== EXTERNAL && v.parents.length > 1 && v.branch !== NONE && (g.vertices[parent] as Vertex).branch !== NONE) {
			connectToPlaced(g, i, parent);
		} else {
			followChain(g, i);
		}
	}
	return g;
}

const segment = (kind: Segment['kind'], line: Line): Segment => ({ kind, fromLane: line.x1, toLane: line.x2, color: line.color % LANE_COLORS });

/**
 * A line is drawn as an `out` half on the row it leaves and an `in` half on the row it
 * reaches; a straight line through a row that is not the commit's own column collapses to
 * one `pass`.
 */
function rowSegments(ins: readonly Line[], outs: readonly Line[], nodeLane: number): Segment[] {
	const segments: Segment[] = [];
	const remaining = new Set(outs);
	for (const line of ins) {
		const through = line.x1 === line.x2 && line.x2 !== nodeLane
			? outs.find((o) => remaining.has(o) && o.x1 === line.x2 && o.x2 === line.x2 && o.color === line.color)
			: undefined;
		if (through === undefined) {
			segments.push(segment('in', line));
			continue;
		}
		remaining.delete(through);
		segments.push(segment('pass', line));
	}
	for (const line of outs) if (remaining.has(line)) segments.push(segment('out', line));
	return segments;
}

export function layoutGraph(commits: readonly Commit[]): Row[] {
	const g = tracePaths(commits);
	const outs: Line[][] = commits.map(() => []);
	const ins: Line[][] = commits.map(() => []);
	for (const line of g.lines) {
		(outs[line.row] as Line[]).push(line);
		ins[line.row + 1]?.push(line);
	}
	return commits.map((commit, i) => {
		const v = g.vertices[i] as Vertex;
		const segments = rowSegments(ins[i] as Line[], outs[i] as Line[], v.x);
		const touched = [v.x, ...segments.flatMap((s) => [s.fromLane, s.toLane])];
		const color = (g.branchColors[v.branch] as number) % LANE_COLORS;
		return { hash: commit.hash, lane: v.x, color, isMerge: commit.parents.length > 1, segments, laneCount: Math.max(...touched) + 1 };
	});
}
