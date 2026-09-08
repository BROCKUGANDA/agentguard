/**
 * Tiny formatter helpers — date / duration / CSV.
 */

export function formatRelative(iso: string | number | undefined | null): string {
  if (iso == null) return '—';
  const t = typeof iso === 'number' ? iso : new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Date.now() - t;
  if (diff < 0) return 'in the future';
  if (diff < 1000) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(t).toLocaleDateString();
}

export function formatExact(iso: string | number | undefined | null): string {
  if (iso == null) return '—';
  const t = typeof iso === 'number' ? iso : new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  return new Date(t).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

export function shortenHash(hash: string): string {
  if (hash.length <= 10) return hash;
  return `${hash.slice(0, 4)}…${hash.slice(-2)}`;
}

export function exportCsv(filename: string, rows: Array<Record<string, unknown>>): void {
  if (rows.length === 0) {
    const blob = new Blob(['(empty)'], { type: 'text/csv' });
    triggerDownload(blob, filename);
    return;
  }
  const headers = Array.from(
    rows.reduce<Set<string>>((acc, row) => {
      Object.keys(row).forEach((k) => acc.add(k));
      return acc;
    }, new Set<string>()),
  );
  const escape = (v: unknown): string => {
    const s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const csv = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  triggerDownload(blob, filename);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}