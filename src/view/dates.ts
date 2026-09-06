import type { DateFormat } from '../settings/types';

/** Sub-month buckets, largest first. Months and years are counted on the calendar instead (see `calendarMonths`). */
const UNITS: [name: string, seconds: number][] = [
	['day', 24 * 3600],
	['hour', 3600],
	['minute', 60],
];

const pad = (n: number): string => String(n).padStart(2, '0');
const ago = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'} ago`;

/** Whole calendar months from `from` to `to` on the UTC calendar; a month counts only once its day-of-month has passed. */
function calendarMonths(from: Date, to: Date): number {
	const months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
	return to.getUTCDate() < from.getUTCDate() ? months - 1 : months;
}

export function formatAbsolute(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDate(iso: string, format: DateFormat, now: Date = new Date()): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	if (format === 'absolute') return formatAbsolute(iso);
	const seconds = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 1000));
	const months = seconds === 0 ? 0 : calendarMonths(d, now);
	if (months >= 12) return ago(Math.floor(months / 12), 'year');
	if (months >= 1) return ago(months, 'month');
	for (const [name, size] of UNITS) {
		if (seconds >= size) return ago(Math.floor(seconds / size), name);
	}
	return 'just now';
}
