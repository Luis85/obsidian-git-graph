import type { DateFormat } from '../settings/types';

const UNITS: [name: string, seconds: number][] = [
	['year', 365 * 24 * 3600],
	['month', 30 * 24 * 3600],
	['day', 24 * 3600],
	['hour', 3600],
	['minute', 60],
];

const pad = (n: number): string => String(n).padStart(2, '0');

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
	for (const [name, size] of UNITS) {
		if (seconds >= size) {
			const n = Math.floor(seconds / size);
			return `${n} ${name}${n === 1 ? '' : 's'} ago`;
		}
	}
	return 'just now';
}
