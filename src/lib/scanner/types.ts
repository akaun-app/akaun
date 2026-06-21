export interface Point {
	x: number;
	y: number;
}

export interface Quad {
	topLeft: Point;
	topRight: Point;
	bottomRight: Point;
	bottomLeft: Point;
}

export type FilterType = 'color' | 'grayscale' | 'bw';

export type Phase = 'loading' | 'idle' | 'scanned';

// One captured & edited page in a multi-page scan session. `dataUrl` is the
// original (un-warped) photo — corners/rotation/filter are re-applied from it
// on demand, mirroring how EditView treats a single scan, so reordering or
// revisiting an earlier page doesn't require re-running detection.
export interface ScannedPage {
	id: string;
	dataUrl: string;
	corners: Point[];
	filterType: FilterType;
	rotation: 0 | 90 | 180 | 270;
	thumbnailUrl: string;
}
