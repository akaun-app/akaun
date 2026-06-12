<script lang="ts">
	import type { ActionData } from './$types.js';

	let { form }: { form: ActionData } = $props();
</script>

<div
	style="display:flex; min-height:100vh; align-items:center; justify-content:center; background:var(--background); padding:20px;"
>
	<div
		style="width:100%; max-width:380px; background:var(--card); border:1px solid var(--border); border-radius:var(--radius); padding:32px; box-shadow:var(--shadow-md);"
	>
		<!-- Brand -->
		<div style="display:flex; align-items:center; gap:12px; margin-bottom:28px;">
			<div class="sb-logo" style="width:40px; height:40px; border-radius:10px; font-size:20px;">A</div>
			<div>
				<div style="font-weight:700; font-size:18px; letter-spacing:-0.02em;">Akaun</div>
				<div style="font-size:12px; color:var(--muted-foreground);">Bookkeeping</div>
			</div>
		</div>

		<h1 style="font-size:19px; font-weight:600; letter-spacing:-0.02em; margin:0 0 6px;">
			Sign in
		</h1>
		<p style="font-size:13px; color:var(--muted-foreground); margin:0 0 24px;">
			Enter your credentials to continue.
		</p>

		{#if form?.error}
			<div
				style="background:var(--red-soft); color:var(--red); border-radius:8px; padding:10px 14px; font-size:13px; margin-bottom:18px; display:flex; align-items:center; gap:8px;"
			>
				<svg
					width="15"
					height="15"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path
						d="m10.29 3.86-8.18 14.14A2 2 0 0 0 3.84 21h16.32a2 2 0 0 0 1.73-3L13.71 3.86a2 2 0 0 0-3.42 0z"
					/>
					<line x1="12" x2="12" y1="9" y2="13" /><line x1="12" x2="12.01" y1="17" y2="17" />
				</svg>
				{form.error}
			</div>
		{/if}

		<form method="POST" style="display:flex; flex-direction:column; gap:16px;">
			<div class="field">
				<label
					for="username"
					class="field-label"
					style="display:block; font-size:13px; font-weight:500; margin-bottom:7px;"
					>Username</label
				>
				<input
					id="username"
					name="username"
					type="text"
					required
					autocomplete="username"
					placeholder="Enter username"
					style="width:100%; height:36px; border:1px solid var(--input); background:var(--card); color:var(--foreground); border-radius:8px; padding:0 12px; font-family:inherit; font-size:13.5px; transition:border-color .12s, box-shadow .12s; outline:none;"
					onfocus={(e) => { const el = e.currentTarget as HTMLInputElement; el.style.borderColor = 'var(--primary)'; el.style.boxShadow = '0 0 0 3px var(--primary-soft)'; }}
					onblur={(e) => { const el = e.currentTarget as HTMLInputElement; el.style.borderColor = ''; el.style.boxShadow = ''; }}
				/>
			</div>

			<div class="field">
				<label
					for="password"
					class="field-label"
					style="display:block; font-size:13px; font-weight:500; margin-bottom:7px;"
					>Password</label
				>
				<input
					id="password"
					name="password"
					type="password"
					required
					autocomplete="current-password"
					placeholder="Enter password"
					style="width:100%; height:36px; border:1px solid var(--input); background:var(--card); color:var(--foreground); border-radius:8px; padding:0 12px; font-family:inherit; font-size:13.5px; transition:border-color .12s, box-shadow .12s; outline:none;"
					onfocus={(e) => { const el = e.currentTarget as HTMLInputElement; el.style.borderColor = 'var(--primary)'; el.style.boxShadow = '0 0 0 3px var(--primary-soft)'; }}
					onblur={(e) => { const el = e.currentTarget as HTMLInputElement; el.style.borderColor = ''; el.style.boxShadow = ''; }}
				/>
			</div>

			<button
				type="submit"
				style="width:100%; height:38px; background:var(--primary); color:var(--primary-foreground); border:none; border-radius:8px; font-family:inherit; font-size:14px; font-weight:600; cursor:pointer; transition:filter .12s; letter-spacing:-0.01em; margin-top:4px;"
				onmouseover={(e) => { (e.currentTarget as HTMLButtonElement).style.filter = 'brightness(1.06)'; }}
				onmouseout={(e) => { (e.currentTarget as HTMLButtonElement).style.filter = ''; }}
			>
				Sign in
			</button>
		</form>
	</div>
</div>
