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
	data: { settings?: { companyLogoPath?: string } },
	_theme: ThemeData,
	{ x, y, width }: Bounds,
	_fonts: Fonts
): number {
	const path = data.settings?.companyLogoPath;
	if (!path) return y;
	const absPath = join(STORAGE_PATH, path);
	if (!existsSync(absPath)) return y;

	const align = (block.style?.align ?? 'left') as 'left' | 'center' | 'right';
	const h = 50;
	let imgX = x;
	if (align === 'center') imgX = x + (width - h) / 2;
	if (align === 'right') imgX = x + width - h;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(doc as any).image(absPath, imgX, y, { height: h, fit: [width, h] });
	return y + h;
}
