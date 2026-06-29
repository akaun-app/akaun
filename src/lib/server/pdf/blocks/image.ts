import type PDFDocument from 'pdfkit';
import type { BlockDef, ThemeData } from '../template-types.js';
import { existsSync } from 'fs';
import { join } from 'path';
import { STORAGE_PATH } from '$lib/server/env.js';

type Bounds = { x: number; y: number; width: number };
type Fonts = { regular: string; bold: string };

export function render(
	doc: InstanceType<typeof PDFDocument>,
	block: BlockDef,
	_data: unknown,
	_theme: ThemeData,
	{ x, y, width }: Bounds,
	_fonts: Fonts
): number {
	const cfg = block.config as { path?: string; height?: number; align?: 'left' | 'center' | 'right' };

	if (!cfg.path) return y;
	const absPath = join(STORAGE_PATH, cfg.path);
	if (!existsSync(absPath)) return y;

	const h = cfg.height ?? 60;
	let imgX = x;
	if (cfg.align === 'center') imgX = x + (width - h) / 2;
	if (cfg.align === 'right') imgX = x + width - h;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(doc as any).image(absPath, imgX, y, { height: h, fit: [width, h] });
	return y + h;
}
