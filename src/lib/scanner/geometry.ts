import type { Point, Quad } from './types';

// Euclidean distance between two points.
export function distance(p1: Point, p2: Point): number {
	return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

// Scales every corner of a quad by the given factors — used to map a quad
// detected in a downscaled proxy image back to full-resolution coordinates.
export function scaleQuad(quad: Quad, scaleX: number, scaleY: number): Quad {
	const scale = (p: Point): Point => ({ x: p.x * scaleX, y: p.y * scaleY });
	return {
		topLeft: scale(quad.topLeft),
		topRight: scale(quad.topRight),
		bottomRight: scale(quad.bottomRight),
		bottomLeft: scale(quad.bottomLeft)
	};
}
