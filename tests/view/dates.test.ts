import { describe, expect, it } from 'vitest';
import { formatAbsolute, formatDate } from '../../src/view/dates';

const now = new Date('2026-09-06T12:00:00Z');

describe('formatDate', () => {
	it('formats relative distances', () => {
		expect(formatDate('2026-09-06T11:59:40Z', 'relative', now)).toBe('just now');
		expect(formatDate('2026-09-06T11:55:00Z', 'relative', now)).toBe('5 minutes ago');
		expect(formatDate('2026-09-06T09:00:00Z', 'relative', now)).toBe('3 hours ago');
		expect(formatDate('2026-09-03T12:00:00Z', 'relative', now)).toBe('3 days ago');
		expect(formatDate('2026-08-06T12:00:00Z', 'relative', now)).toBe('1 month ago');
		expect(formatDate('2024-09-06T12:00:00Z', 'relative', now)).toBe('2 years ago');
	});

	it('formats absolute dates in local time as YYYY-MM-DD HH:mm', () => {
		expect(formatDate('2026-09-06T10:00:00Z', 'absolute', now)).toMatch(/^2026-09-0[56] \d\d:\d\d$/);
		expect(formatAbsolute('2026-09-06T10:00:00Z')).toMatch(/^2026-09-0[56] \d\d:\d\d$/);
	});

	it('returns the input when it is not a date', () => {
		expect(formatDate('garbage', 'relative', now)).toBe('garbage');
	});
});
