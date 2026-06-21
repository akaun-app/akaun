// A captured, cropped, filtered, and rotation-baked page ready to drop into a
// multi-page PDF. `dataUrl` is already a JPEG with rotation applied — no
// further per-page transforms are needed at assembly time.
export interface FinishedPage {
	id: string;
	dataUrl: string;
	width: number;
	height: number;
}
