import { onMount, onCleanup, createSignal } from "solid-js";
import type { JSX } from "solid-js";

export type DitherConfig = {
	/** Char set dense→sparse (dark→light). Default: "@#S%?*+;:,. " */
	chars?: string;
	/** Text fill color. Default: random orange. Ignored when colorRamp is set. */
	color?: string;
	/** Fixed font size px, or [min, max] range randomized at mount. Default: [8, 13] */
	fontSizeRange?: number | [number, number];
	/** Canvas background. Default: "rgba(0,0,0,0.92)". Ignored in overlay mode. */
	bgColor?: string;
	/**
	 * Overlay mode: canvas is transparent, chars drawn on top of the real video.
	 * Default: false.
	 */
	overlay?: boolean;
	/**
	 * In overlay mode, fraction (0–1) of the canvas area covered by the char
	 * region. e.g. 0.4 = ~40% of area. Default: 1 (full video).
	 */
	coverageFraction?: number;
	/**
	 * In overlay mode, randomize the position of the char sub-region each mount.
	 * Default: false (region anchored at top-left, no offset).
	 */
	randomizeRegion?: boolean;
	/**
	 * How luminance maps to characters.
	 * "ramp" = linear gradient across full char set (default).
	 * "threshold" = binary split at luminance 128 — below uses first char, above uses last.
	 * { threshold: number } = binary split at a custom luminance value (0–255).
	 */
	maskMode?: "ramp" | "threshold" | { threshold: number };
	/**
	 * Invert the character mapping only. Dark pixels get chars from the sparse
	 * (light) end of the char set, light pixels get chars from the dense (dark)
	 * end. Does NOT affect colorRamp direction. Default: false.
	 */
	invert?: boolean;
	/**
	 * Cubic bezier control points [x1, y1, x2, y2] for luminance→char/color mapping.
	 * Works like CSS cubic-bezier(). Default: [0, 0, 1, 1] (linear).
	 */
	curve?: [number, number, number, number];
	/**
	 * Gradient color ramp. Array of CSS color strings mapped across the luminance range.
	 * Colors are evenly spaced and interpolated. Overrides `color` when provided.
	 * e.g. ["#000000", "#f76611", "#ffffff"]
	 */
	colorRamp?: string[];
	/**
	 * Frame trail/bleed intensity (0 | 1 | [0, 1]). 0 = fully clear each frame (no trail),
	 * 1 = never clear (full ghosting). Default: 0.08 (subtle trail from the
	 * default semi-transparent background). Set to 0 for crisp frames.
     * Values between 0-1 will act as the fade out time between frames.
	 */
	trail?: number;
};

type Props = {
	webm: string;
	mp4: string;
	/** Defaults to video's natural width. */
	width?: number;
	/** Defaults to video's natural height. */
	height?: number;
	/**
	 * Uniform scale factor applied to the video's native resolution.
	 * e.g. 0.5 = half size, 2 = double size.
	 * Applied to native dimensions before `width`/`height` overrides — explicit
	 * props always win. Defaults to 1 (no scaling).
	 */
	scale?: number;
	/**
	 * Character density multiplier. Higher = denser grid (more, smaller chars).
	 * Uses high-DPI canvas scaling internally. Default: 1 (density from video resolution).
	 */
	dpr?: number;
	dither?: DitherConfig;
	playbackSpeed?: number;
	class?: string;
	id?: string;
	style?: JSX.CSSProperties;
	onRef?: (el: HTMLDivElement) => void;
};

const DEFAULT_CHARS = "@#S%?*+;:,. ";

/** Evaluate cubic bezier y for a given x. P0=(0,0), P1=(x1,y1), P2=(x2,y2), P3=(1,1). */
function cubicBezierY(x: number, x1: number, y1: number, x2: number, y2: number): number {
	if (x <= 0) return 0;
	if (x >= 1) return 1;
	let t = x;
	for (let i = 0; i < 8; i++) {
		const t2 = t * t;
		const t3 = t2 * t;
		const mt = 1 - t;
		const mt2 = mt * mt;
		const bx = 3 * mt2 * t * x1 + 3 * mt * t2 * x2 + t3;
		const dx = 3 * mt2 * x1 + 6 * mt * t * (x2 - x1) + 3 * t2 * (1 - x2);
		if (Math.abs(dx) < 1e-9) break;
		t -= (bx - x) / dx;
		t = Math.max(0, Math.min(1, t));
	}
	const mt = 1 - t;
	return 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t;
}

/** Build a 256-entry LUT mapping input luminance → curved output (0-255). */
function buildCurveLUT(curve: [number, number, number, number]): Uint8Array {
	const lut = new Uint8Array(256);
	const [x1, y1, x2, y2] = curve;
	for (let i = 0; i < 256; i++) {
		lut[i] = Math.round(cubicBezierY(i / 255, x1, y1, x2, y2) * 255);
	}
	return lut;
}

/** Reusable 1x1 canvas for CSS color parsing. */
let _parseCanvas: HTMLCanvasElement | null = null;
let _parseCtx: CanvasRenderingContext2D | null = null;

/** Parse any CSS color string to [r, g, b] using a shared canvas. */
function parseColor(css: string): [number, number, number] {
	if (!_parseCanvas) {
		_parseCanvas = document.createElement("canvas");
		_parseCanvas.width = _parseCanvas.height = 1;
		_parseCtx = _parseCanvas.getContext("2d", { willReadFrequently: true })!;
	}
	_parseCtx!.clearRect(0, 0, 1, 1);
	_parseCtx!.fillStyle = css;
	_parseCtx!.fillRect(0, 0, 1, 1);
	const d = _parseCtx!.getImageData(0, 0, 1, 1).data;
	return [d[0], d[1], d[2]];
}

/** Build 256-entry hex color LUT from gradient stops. */
function buildColorLUT(colors: string[]): string[] {
	const parsed = colors.map(parseColor);
	const lut: string[] = new Array(256);
	if (parsed.length === 1) {
		const hex = rgbHex(parsed[0]);
		lut.fill(hex);
		return lut;
	}
	const segments = parsed.length - 1;
	for (let i = 0; i < 256; i++) {
		const pos = (i / 255) * segments;
		const seg = Math.min(Math.floor(pos), segments - 1);
		const frac = pos - seg;
		const a = parsed[seg];
		const b = parsed[seg + 1];
		lut[i] = rgbHex([
			Math.round(a[0] + (b[0] - a[0]) * frac),
			Math.round(a[1] + (b[1] - a[1]) * frac),
			Math.round(a[2] + (b[2] - a[2]) * frac),
		]);
	}
	return lut;
}

function rgbHex(c: [number, number, number]): string {
	return `#${((1 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]).toString(16).slice(1)}`;
}

/**
 * Build combined char + color-index LUTs indexed by raw luminance (0-255).
 * Bakes in curve, invert, threshold/ramp logic so the hot loop is branch-free.
 */
function buildCombinedLUTs(
	charStr: string,
	curveLUT: Uint8Array,
	isThreshold: boolean,
	thresholdCutoff: number,
	invert: boolean,
): { charLUT: string[]; colorIdxLUT: Uint8Array; charColLUT: Uint8Array } {
	const charLUT = new Array<string>(256);
	const colorIdxLUT = new Uint8Array(256);
	const charColLUT = new Uint8Array(256);
	const charsLen = charStr.length;
	const charScale = charsLen / 256;
	const lastCharIdx = charsLen - 1;

	for (let i = 0; i < 256; i++) {
		const curved = curveLUT[i];
		colorIdxLUT[i] = curved;

		if (isThreshold) {
			const isDark = i < thresholdCutoff;
			const col = (isDark !== invert) ? 0 : lastCharIdx;
			charLUT[i] = charStr.charAt(col);
			charColLUT[i] = col;
		} else {
			const charLum = invert ? 255 - curved : curved;
			const col = (charLum * charScale) | 0;
			charLUT[i] = charStr.charAt(col);
			charColLUT[i] = col;
		}
	}

	return { charLUT, colorIdxLUT, charColLUT };
}

function buildAtlas(
	charStr: string,
	cellW: number,
	cellH: number,
	fontSize: number,
	colorLUT: string[] | null,
	monoColor: string,
): OffscreenCanvas {
	const charsLen = charStr.length;
	const rowCount = colorLUT ? 256 : 1;
	const canvas = new OffscreenCanvas(charsLen * cellW, rowCount * cellH);
	const actx = canvas.getContext("2d")!;
	actx.font = `${fontSize}px monospace`;
	actx.textBaseline = "top";
	if (colorLUT) {
		for (let row = 0; row < 256; row++) {
			actx.fillStyle = colorLUT[row];
			for (let ci = 0; ci < charsLen; ci++) {
				actx.fillText(charStr[ci], ci * cellW, row * cellH);
			}
		}
	} else {
		actx.fillStyle = monoColor;
		for (let ci = 0; ci < charsLen; ci++) {
			actx.fillText(charStr[ci], ci * cellW, 0);
		}
	}
	return canvas;
}

function getTrailResidueByteFloor(trail: number): number {
	if (trail <= 0 || trail >= 1) return 0;
	const stableByteFloor = Math.ceil(0.5 / trail) + 1;
	return Math.min(32, Math.max(2, stableByteFloor));
}

export default function DitheredVideo(props: Props) {
	let containerRef!: HTMLDivElement;
	let videoRef!: HTMLVideoElement;
	let canvasRef!: HTMLCanvasElement;
	let rafId: number;
	let latestBitmap: ImageBitmap | null = null;
	let captureInFlight = false;
	let visible = true;
	let lastVisibilityCheck = 0;
	let wasRenderPaused = false;

	const overlay = () => props.dither?.overlay ?? false;

	/**
	 * Resolve final pixel dimensions from props. Priority:
	 *   1. Explicit width/height props (always win).
	 *   2. Native video dimensions × scale (default scale = 1).
	 */
	function resolveSize(nativeW: number, nativeH: number): { w: number; h: number } {
		const s = props.scale ?? 1;
		return {
			w: props.width  ?? Math.round(nativeW * s),
			h: props.height ?? Math.round(nativeH * s),
		};
	}

	const [dims, setDims] = createSignal<{ w: number; h: number } | null>(
		props.width != null && props.height != null
			? { w: props.width, h: props.height }
			: null,
	);

	function isEffectivelyVisible() {
		if (document.hidden || !containerRef?.isConnected) return false;

		let opacity = 1;
		let el: HTMLElement | null = containerRef;
		while (el && el !== document.documentElement) {
			const style = getComputedStyle(el);
			if (style.display === "none" || style.visibility === "hidden") return false;
			opacity *= Number.parseFloat(style.opacity || "1");
			if (opacity <= 0.01) return false;
			el = el.parentElement;
		}

		return true;
	}

	function shouldRender(now: number) {
		if (now - lastVisibilityCheck > 120) {
			visible = isEffectivelyVisible();
			lastVisibilityCheck = now;
		}
		return visible;
	}

	function init(w: number, h: number) {
		const dpr = props.dpr ?? 1;
		const cw = w * dpr;
		const ch = h * dpr;

		canvasRef.width = cw;
		canvasRef.height = ch;

		const cfg = props.dither ?? {};
		const charStr = cfg.chars ?? DEFAULT_CHARS;
		const color =
			cfg.color ??
			`hsl(${20 + Math.random() * 15}, 95%, ${52 + Math.random() * 10}%)`;
		const fsRange = cfg.fontSizeRange ?? [8, 13];
		const fontSize =
			typeof fsRange === "number"
				? fsRange
				: Math.round(fsRange[0] + Math.random() * (fsRange[1] - fsRange[0]));
		const trail = Math.max(0, Math.min(1, cfg.trail ?? 0.08));
		const bgColor = cfg.bgColor ?? `rgba(0,0,0,${1 - trail})`;
		const isOverlay = cfg.overlay ?? false;
		const coverageFraction = cfg.coverageFraction ?? 1;
		const randomizeRegion = cfg.randomizeRegion ?? false;
		const charModeRaw = cfg.maskMode ?? "ramp";
		const isThreshold = charModeRaw !== "ramp";
		const invert = cfg.invert ?? false;

		const thresholdCutoff = isThreshold
			? (typeof charModeRaw === "object" ? charModeRaw.threshold : 128)
			: 0;

		const curveLUT = buildCurveLUT(cfg.curve ?? [0, 0, 1, 1]);

		const hasColorRamp = cfg.colorRamp && cfg.colorRamp.length > 0;
		const colorLUTHex = hasColorRamp ? buildColorLUT(cfg.colorRamp!) : null;

		// Combined LUTs: eliminates all per-cell branching in the hot loop
		const { charLUT, colorIdxLUT, charColLUT } = buildCombinedLUTs(
			charStr, curveLUT, isThreshold, thresholdCutoff, invert,
		);

		const ctx = canvasRef.getContext("2d")!;

		ctx.font = `${fontSize}px monospace`;
		ctx.textBaseline = "top";
		const metrics = ctx.measureText("Mg");
		const cellW = Math.ceil(ctx.measureText("M").width);
		const cellH = Math.ceil(
			metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
		);

		const cols = Math.floor(cw / cellW);
		const rows = Math.floor(ch / cellH);

		// Sub-region for overlay mode
		const side = Math.sqrt(coverageFraction);
		const regionCols = Math.max(1, Math.floor(cols * side));
		const regionRows = Math.max(1, Math.floor(rows * side));
		const regionX = randomizeRegion
			? Math.floor(Math.random() * (cols - regionCols + 1))
			: 0;
		const regionY = randomizeRegion
			? Math.floor(Math.random() * (rows - regionRows + 1))
			: 0;

		// Offscreen canvas for pixel sampling — use OffscreenCanvas when available
		const offscreen = typeof OffscreenCanvas !== "undefined"
			? new OffscreenCanvas(cols, rows)
			: (() => { const c = document.createElement("canvas"); c.width = cols; c.height = rows; return c; })();
		const octx = offscreen.getContext("2d", { willReadFrequently: true })! as CanvasRenderingContext2D;

		// Trail accumulation buffer (only when trail > 0 in non-overlay mode)
		let trailCanvas: HTMLCanvasElement | null = null;
		let tctx: CanvasRenderingContext2D | null = null;
		if (!isOverlay && trail > 0) {
			trailCanvas = document.createElement("canvas");
			trailCanvas.width = cw;
			trailCanvas.height = ch;
			tctx = trailCanvas.getContext("2d", { willReadFrequently: true })!;
			tctx.font = `${fontSize}px monospace`;
			tctx.textBaseline = "top";
		}

		// Pre-compute loop bounds
		const cStart = isOverlay ? regionX : 0;
		const cEnd = isOverlay ? regionX + regionCols : cols;
		const rStart = isOverlay ? regionY : 0;
		const rEnd = isOverlay ? regionY + regionRows : rows;

		// Pre-compute x/y position arrays — eliminates per-cell multiplies
		const xPos = new Float64Array(cols);
		for (let c = 0; c < cols; c++) xPos[c] = c * cellW;
		const yPos = new Float64Array(rows);
		for (let r = 0; r < rows; r++) yPos[r] = r * cellH;

		const atlas = buildAtlas(charStr, cellW, cellH, fontSize, colorLUTHex, color);

		// Frame dedup — skip draw when video frame hasn't changed
		let lastVideoTime = -1;

		/**
		 * Specialized draw functions selected at init time.
		 * Each variant is monomorphic — no per-frame branching on mode/colorRamp.
		 * resolvePixel logic is inlined: just two LUT lookups per cell.
		 */
		let drawFrame: (px: Uint8ClampedArray) => void;

		if (isOverlay) {
			if (colorLUTHex) {
				drawFrame = (px) => {
					ctx.clearRect(0, 0, cw, ch);
					for (let r = rStart; r < rEnd; r++) {
						const rowOffset = r * cols;
						const y = yPos[r];
						for (let c = cStart; c < cEnd; c++) {
							const i = (rowOffset + c) << 2;
							const rawLum = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;
							ctx.drawImage(atlas, charColLUT[rawLum] * cellW, colorIdxLUT[rawLum] * cellH, cellW, cellH, xPos[c], y, cellW, cellH);
						}
					}
				};
			} else {
				drawFrame = (px) => {
					ctx.clearRect(0, 0, cw, ch);
					for (let r = rStart; r < rEnd; r++) {
						const rowOffset = r * cols;
						const y = yPos[r];
						for (let c = cStart; c < cEnd; c++) {
							const i = (rowOffset + c) << 2;
							const rawLum = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;
							ctx.drawImage(atlas, charColLUT[rawLum] * cellW, 0, cellW, cellH, xPos[c], y, cellW, cellH);
						}
					}
				};
			}
		} else if (!tctx) {
			// No trail
			if (colorLUTHex) {
				drawFrame = (px) => {
					ctx.clearRect(0, 0, cw, ch);
					ctx.fillStyle = bgColor;
					ctx.fillRect(0, 0, cw, ch);
					for (let r = rStart; r < rEnd; r++) {
						const rowOffset = r * cols;
						const y = yPos[r];
						for (let c = cStart; c < cEnd; c++) {
							const i = (rowOffset + c) << 2;
							const rawLum = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;
							ctx.drawImage(atlas, charColLUT[rawLum] * cellW, colorIdxLUT[rawLum] * cellH, cellW, cellH, xPos[c], y, cellW, cellH);
						}
					}
				};
			} else {
				drawFrame = (px) => {
					ctx.clearRect(0, 0, cw, ch);
					ctx.fillStyle = bgColor;
					ctx.fillRect(0, 0, cw, ch);
					ctx.fillStyle = color;
					for (let r = rStart; r < rEnd; r++) {
						const rowOffset = r * cols;
						let rowStr = "";
						for (let c = cStart; c < cEnd; c++) {
							const i = (rowOffset + c) << 2;
							const rawLum = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;
							rowStr += charLUT[rawLum];
						}
						ctx.fillText(rowStr, xPos[cStart], yPos[r]);
					}
				};
			}
		} else {
			// Trail mode — tctx and trailCanvas guaranteed non-null in this branch
			const tc = tctx!;
			const tCanvas = trailCanvas!;
			let trailFrameCount = 0;
			const trailResidueByteFloor = getTrailResidueByteFloor(trail);
			const pruneInterval = trail < 1
				? Math.max(30, Math.min(120, Math.ceil(Math.log(trailResidueByteFloor / 255) / Math.log(1 - trail))))
				: 0;
			const pruneTrailResidue = () => {
				if (!pruneInterval || ++trailFrameCount % pruneInterval !== 0) return;
				const img = tc.getImageData(0, 0, cw, ch);
				const data = img.data;
				let changed = false;
				for (let i = 3; i < data.length; i += 4) {
					if (data[i] > 0 && data[i] <= trailResidueByteFloor) {
						data[i - 3] = 0;
						data[i - 2] = 0;
						data[i - 1] = 0;
						data[i] = 0;
						changed = true;
					}
				}
				if (changed) tc.putImageData(img, 0, 0);
			};

			if (colorLUTHex) {
				drawFrame = (px) => {
					if (trail < 1) {
						tc.globalCompositeOperation = "destination-in";
						tc.globalAlpha = 1 - trail;
						tc.fillStyle = "#fff";
						tc.fillRect(0, 0, cw, ch);
						tc.globalCompositeOperation = "source-over";
						tc.globalAlpha = 1;
					}
					pruneTrailResidue();
					for (let r = rStart; r < rEnd; r++) {
						const rowOffset = r * cols;
						const y = yPos[r];
						for (let c = cStart; c < cEnd; c++) {
							const i = (rowOffset + c) << 2;
							const rawLum = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;
							tc.drawImage(atlas, charColLUT[rawLum] * cellW, colorIdxLUT[rawLum] * cellH, cellW, cellH, xPos[c], y, cellW, cellH);
						}
					}
					ctx.clearRect(0, 0, cw, ch);
					ctx.fillStyle = bgColor;
					ctx.fillRect(0, 0, cw, ch);
					ctx.drawImage(tCanvas, 0, 0);
				};
			} else {
				drawFrame = (px) => {
					if (trail < 1) {
						tc.globalCompositeOperation = "destination-in";
						tc.globalAlpha = 1 - trail;
						tc.fillStyle = "#fff";
						tc.fillRect(0, 0, cw, ch);
						tc.globalCompositeOperation = "source-over";
						tc.globalAlpha = 1;
					}
					pruneTrailResidue();
					tc.fillStyle = color;
					for (let r = rStart; r < rEnd; r++) {
						const rowOffset = r * cols;
						let rowStr = "";
						for (let c = cStart; c < cEnd; c++) {
							const i = (rowOffset + c) << 2;
							const rawLum = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;
							rowStr += charLUT[rawLum];
						}
						tc.fillText(rowStr, xPos[cStart], yPos[r]);
					}
					ctx.clearRect(0, 0, cw, ch);
					ctx.fillStyle = bgColor;
					ctx.fillRect(0, 0, cw, ch);
					ctx.drawImage(tCanvas, 0, 0);
				};
			}
		}

		function clearTransientState() {
			latestBitmap?.close();
			latestBitmap = null;
			lastVideoTime = -1;
			ctx.clearRect(0, 0, cw, ch);
			tctx?.clearRect(0, 0, cw, ch);
		}

		async function captureFrame() {
			if (captureInFlight) return;
			if (videoRef.readyState < 2) return;
			if (videoRef.currentTime === lastVideoTime) return;
			lastVideoTime = videoRef.currentTime;
			captureInFlight = true;
			try {
				const bm = await createImageBitmap(videoRef, {
					resizeWidth: cols,
					resizeHeight: rows,
					resizeQuality: "low",
				});
				if (!visible || wasRenderPaused) {
					bm.close();
					return;
				}
				latestBitmap?.close();
				latestBitmap = bm;
			} finally {
				captureInFlight = false;
			}
		}

		function draw(now: number) {
			rafId = requestAnimationFrame(draw);

			if (!shouldRender(now)) {
				if (!wasRenderPaused) {
					videoRef.pause();
					clearTransientState();
					wasRenderPaused = true;
				}
				return;
			}

			if (wasRenderPaused) {
				videoRef.play().catch(() => {});
				wasRenderPaused = false;
			}

			captureFrame();
			if (!latestBitmap) return;
			const bm = latestBitmap;
			latestBitmap = null;
			octx.drawImage(bm, 0, 0);
			bm.close();
			const px = octx.getImageData(0, 0, cols, rows).data;
			drawFrame(px);
		}

		const start = () => {
			videoRef.play().catch(() => {});
			rafId = requestAnimationFrame(draw);
		};

		if (videoRef.readyState >= 2) {
			start();
		} else {
			videoRef.addEventListener("canplay", start, { once: true });
		}
	}

	onMount(() => {
		const d = dims();
		if (d) {
			init(d.w, d.h);
		} else {
			videoRef.addEventListener(
				"loadedmetadata",
				() => {
					const { w, h } = resolveSize(videoRef.videoWidth, videoRef.videoHeight);
					setDims({ w, h });
					init(w, h);
				},
				{ once: true },
			);
		}

		onCleanup(() => {
			cancelAnimationFrame(rafId);
			latestBitmap?.close();
			latestBitmap = null;
		});
	});

	return (
		<div
			ref={(el) => {
				containerRef = el;
				props.onRef?.(el);
			}}
			class={props.class}
			id={props.id}
			style={{
				position: "relative",
				width: dims() ? `${dims()!.w}px` : undefined,
				height: dims() ? `${dims()!.h}px` : undefined,
				overflow: "hidden",
				...props.style,
			}}
		>
			<video
				ref={videoRef}
				width={dims()?.w}
				height={dims()?.h}
				autoplay
				muted
				playsinline
				loop
				onLoadedMetadata={(e) => e.currentTarget.playbackRate = props.playbackSpeed ?? 1.0}
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					opacity: overlay() ? 1 : 0,
				}}
			>
				<source src={props.webm} type="video/webm" />
				<source src={props.mp4} type="video/mp4" />
			</video>
			<canvas
				ref={canvasRef}
				width={(dims()?.w ?? 0) * (props.dpr ?? 1)}
				height={(dims()?.h ?? 0) * (props.dpr ?? 1)}
				style={{
					display: "block",
					position: "absolute",
					"image-rendering": "pixelated",
					top: 0,
					left: 0,
					width: `${dims()?.w ?? 0}px`,
					height: `${dims()?.h ?? 0}px`,
				}}
			/>
		</div>
	);
}
