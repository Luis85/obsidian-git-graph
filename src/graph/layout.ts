import type { Commit } from '../git/types';
import type { Row, Segment } from './types';

/**
 * Lane layout. Rows are the commits in the order given (newest first, topological). The graph
 * is drawn as *strands*: a strand is one colour of line that starts on a commit's row and steps
 * down one row at a time. Strands are drawn one after another, and every row hands out its
 * columns left to right in the order strands arrive at it. A commit sits in the column of the
 * first strand that lands on it.
 *
 * Rows are visited top to bottom; while the current commit is unplaced or still has a parent
 * without a line, one more strand is drawn for it:
 *
 * - A *chain* starts at the commit and follows first parents downwards, placing every parent
 *   it lands on, until it reaches a commit that is already placed (it curves into that
 *   commit's column), a root, or a parent outside the loaded page (it runs off the bottom).
 * - A *join* is drawn instead when the commit is a placed merge whose next parent is already
 *   placed: it runs beside the graph in the parent's colour until a row where a column already
 *   leads to that parent, and merges into that column.
 *
 * Consequences: the first-parent chain of the top commit owns column 0, a line slides left as
 * soon as a line to its left has ended, and a chain takes the lowest colour no other strand is
 * using at its start row.
 */

const PALETTE_SIZE = 8;
/** A parent that is not among the loaded commits. */
const OUTSIDE = -1;

interface Node {
	/** Row indexes of the parents, or `OUTSIDE`; a parent listed twice is kept once. */
	parents: number[];
	/** How many of `parents` already have a line. */
	drawn: number;
	/** The strand that placed this commit, or null while it is unplaced. */
	strand: number | null;
	column: number;
}

/** Column bookkeeping for one row. */
interface Slots {
	/** The lowest column not handed out yet. */
	free: number;
	/** `target/strand` → the column on this row whose line heads for that target on that strand. */
	leads: Map<string, number>;
}

/** A line from column `from` on `row` to column `to` on `row + 1`. */
interface Edge { row: number; from: number; to: number; color: number }

const leadKey = (target: number, strand: number): string => `${target}/${strand}`;

class Tracer {
	readonly nodes: Node[];
	readonly slots: Slots[];
	readonly edges: Edge[] = [];
	readonly strandColors: number[] = [];
	/** Per colour: the last row its latest strand touched, or Infinity while one is being drawn. */
	private readonly colorFreeAfter: number[] = [];
	/** Columns already used by lines leaving the bottom of the last row. */
	private readonly exits = new Set<number>();

	constructor(commits: readonly Commit[]) {
		const rowOf = new Map(commits.map((commit, row) => [commit.hash, row]));
		this.nodes = commits.map((commit) => ({
			parents: [...new Set(commit.parents)].map((hash) => rowOf.get(hash) ?? OUTSIDE),
			drawn: 0,
			strand: null,
			column: 0,
		}));
		this.slots = commits.map(() => ({ free: 0, leads: new Map() }));
	}

	run(): void {
		let row = 0;
		while (row < this.nodes.length) {
			const node = this.node(row);
			const parent = node.parents[node.drawn];
			if (node.strand !== null && parent === undefined) row++;
			else if (node.strand !== null && node.parents.length > 1 && parent !== undefined && this.nodes[parent]?.strand != null) this.join(row, parent);
			else this.chain(row);
		}
	}

	node(row: number): Node {
		return this.nodes[row] as Node;
	}

	/** Records that `column` on `row` carries a line to `target` on `strand`, if it is the row's next free column. */
	private claim(row: number, column: number, target: number, strand: number): void {
		const slots = this.slots[row] as Slots;
		if (column < slots.free) return;
		slots.free = column + 1;
		const key = leadKey(target, strand);
		if (!slots.leads.has(key)) slots.leads.set(key, column);
	}

	private colorFor(startRow: number): number {
		const free = this.colorFreeAfter.findIndex((last) => last < startRow);
		if (free >= 0) return free;
		this.colorFreeAfter.push(Infinity);
		return this.colorFreeAfter.length - 1;
	}

	private join(row: number, parent: number): void {
		const source = this.node(row);
		const strand = this.node(parent).strand as number;
		const color = this.strandColors[strand] as number;
		let column = source.column;
		for (let r = row + 1; r < this.nodes.length; r++) {
			const existing = (this.slots[r] as Slots).leads.get(leadKey(parent, strand));
			const next = existing ?? (this.slots[r] as Slots).free;
			this.edges.push({ row: r - 1, from: column, to: next, color });
			this.claim(r, next, parent, strand);
			column = next;
			if (existing !== undefined) break;
		}
		source.drawn++;
	}

	private chain(start: number): void {
		const strand = this.strandColors.length;
		const color = this.colorFor(start);
		this.strandColors.push(color);
		let node = this.node(start);
		let column = node.strand === null ? (this.slots[start] as Slots).free : node.column;
		if (node.strand === null) Object.assign(node, { strand, column });
		this.claim(start, column, start, strand);
		let target = node.parents[node.drawn];
		let lastRow = start;
		for (let r = start + 1; r < this.nodes.length && target !== undefined; r++) {
			const here = this.node(r);
			const lands = target === r;
			const next = lands && here.strand !== null ? here.column : (this.slots[r] as Slots).free;
			this.edges.push({ row: r - 1, from: column, to: next, color });
			this.claim(r, next, target, strand);
			column = next;
			lastRow = r;
			if (!lands) continue;
			node.drawn++;
			const unplaced = here.strand === null;
			if (unplaced) Object.assign(here, { strand, column: next });
			node = here;
			target = unplaced ? here.parents[here.drawn] : undefined;
		}
		// Still heading somewhere: the parent is outside the page (or, in a malformed order, above
		// its child). The line leaves the bottom of the last row and the parent counts as drawn.
		if (target !== undefined) {
			node.drawn++;
			this.edges.push({ row: this.nodes.length - 1, from: column, to: this.exitColumn(column), color });
		}
		this.colorFreeAfter[color] = lastRow;
	}

	/**
	 * The column a line leaves the bottom of the page in: its own, unless another line already
	 * left there (several parents of a merge on the last row), in which case the last row's next
	 * free column. Every exit column is below the last row's `free`, so that can never repeat one.
	 */
	private exitColumn(preferred: number): number {
		if (!this.exits.has(preferred)) {
			this.exits.add(preferred);
			return preferred;
		}
		const last = this.slots[this.slots.length - 1] as Slots;
		const column = last.free++;
		this.exits.add(column);
		return column;
	}
}

const toSegment = (kind: Segment['kind'], edge: Edge): Segment => ({ kind, fromLane: edge.from, toLane: edge.to, color: edge.color % PALETTE_SIZE });

/**
 * Each edge is drawn as an `out` half on the row it leaves and an `in` half on the row it
 * reaches. A straight edge arriving outside the commit's column that continues straight in the
 * same column and colour is drawn once, as a `pass`.
 */
function segmentsFor(arriving: readonly Edge[], leaving: readonly Edge[], nodeColumn: number): Segment[] {
	const unmatched = [...leaving];
	const segments = arriving.map((edge) => {
		const straight = edge.from === edge.to && edge.to !== nodeColumn;
		const i = straight ? unmatched.findIndex((o) => o.from === edge.to && o.to === edge.to && o.color === edge.color) : -1;
		if (i < 0) return toSegment('in', edge);
		unmatched.splice(i, 1);
		return toSegment('pass', edge);
	});
	return [...segments, ...unmatched.map((edge) => toSegment('out', edge))];
}

export function layoutGraph(commits: readonly Commit[]): Row[] {
	const tracer = new Tracer(commits);
	tracer.run();
	const leaving: Edge[][] = commits.map(() => []);
	const arriving: Edge[][] = commits.map(() => []);
	for (const edge of tracer.edges) {
		leaving[edge.row]?.push(edge);
		arriving[edge.row + 1]?.push(edge);
	}
	return commits.map((commit, row) => {
		const node = tracer.node(row);
		const segments = segmentsFor(arriving[row] as Edge[], leaving[row] as Edge[], node.column);
		const laneCount = Math.max(node.column, ...segments.flatMap((s) => [s.fromLane, s.toLane])) + 1;
		const color = (tracer.strandColors[node.strand as number] as number) % PALETTE_SIZE;
		return { hash: commit.hash, lane: node.column, color, isMerge: commit.parents.length > 1, segments, laneCount };
	});
}
