<script lang="ts">
	import { History } from '@lucide/svelte';

	type FieldChange = { field: string; before: unknown; after: unknown };
	type AuditEntry = {
		id: number;
		action: 'create' | 'update' | 'delete';
		changes: FieldChange[] | null;
		createdAt: string;
		userId: number | null;
		userName: string | null;
	};

	let { recordType, recordId }: { recordType: string; recordId: number } = $props();

	let entries = $state<AuditEntry[]>([]);
	let loading = $state(true);

	export async function refresh() {
		loading = true;
		try {
			const res = await fetch(`/api/audit/${recordType}/${recordId}`);
			if (res.ok) entries = await res.json();
		} finally {
			loading = false;
		}
	}

	// refresh() reads recordType/recordId synchronously (building the fetch URL) before its
	// first await, so this effect re-runs whenever the sheet is pointed at a different record.
	$effect(() => {
		refresh();
	});

	function formatTimestamp(sqliteDatetime: string): string {
		// sqlite datetime('now') is "YYYY-MM-DD HH:MM:SS" UTC.
		const d = new Date(sqliteDatetime.replace(' ', 'T') + 'Z');
		if (isNaN(d.getTime())) return sqliteDatetime;
		const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		const hh = String(d.getHours()).padStart(2, '0');
		const mm = String(d.getMinutes()).padStart(2, '0');
		return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${hh}:${mm}`;
	}

	function formatValue(v: unknown): string {
		if (v === null || v === undefined || v === '') return '—';
		if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
		return String(v);
	}

	function summary(entry: AuditEntry): string {
		if (entry.action === 'create') return 'created this record';
		if (entry.action === 'delete') return 'deleted this record';
		if (!entry.changes || entry.changes.length === 0) return 'updated this record';
		return entry.changes.map((c) => `${c.field} ${formatValue(c.before)} → ${formatValue(c.after)}`).join(', ');
	}
</script>

{#if !loading && entries.length > 0}
	<div class="detail-section-label">Activity</div>
	<div class="audit-list">
		{#each entries as entry (entry.id)}
			<div class="audit-entry">
				<div class="audit-entry-icon"><History size={13} /></div>
				<div class="audit-entry-main">
					<div class="audit-entry-line">
						<span class="audit-entry-user">{entry.userName ?? 'Someone'}</span> {summary(entry)}
					</div>
					<div class="audit-entry-time">{formatTimestamp(entry.createdAt)}</div>
				</div>
			</div>
		{/each}
	</div>
{/if}
