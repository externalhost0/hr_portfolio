import { onMount, onCleanup, createSignal, Show } from "solid-js";
import type { JSX } from "solid-js";

export type DitherConfig = {
	chars?: string;
	color?: string;
	fontSizeRange?: number | [number, number];
	bgColor?: string;
	overlay?: boolean;
	coverageFraction?: number;
	randomizeRegion?: boolean;
	maskMode?: "ramp" | "threshold" | { threshold: number };
	invert?: boolean;
	curve?: [number, number, number, number];
	colorRamp?: string[];
	trail?: number;
	screenBlendIntensity?: number;
	useVideoColor?: boolean;
};

type Props = {
	webm: string;
	mp4: string;
	width?: number;
	height?: number;
	scale?: number;
	dpr?: number;
	dither?: DitherConfig;
	playbackSpeed?: number;
	class?: string;
	id?: string;
	style?: JSX.CSSProperties;
	onRef?: (el: HTMLDivElement) => void;
};

// ─── Utility functions (inlined from DitheredVideo.tsx) ───────────────────────

const DEFAULT_CHARS = "@#S%?*+;:,. ";

function cubicBezierY(x: number, x1: number, y1: number, x2: number, y2: number): number {
	if (x <= 0) return 0;
	if (x >= 1) return 1;
	let t = x;
	for (let i = 0; i < 8; i++) {
		const t2 = t * t, t3 = t2 * t, mt = 1 - t, mt2 = mt * mt;
		const bx = 3 * mt2 * t * x1 + 3 * mt * t2 * x2 + t3;
		const dx = 3 * mt2 * x1 + 6 * mt * t * (x2 - x1) + 3 * t2 * (1 - x2);
		if (Math.abs(dx) < 1e-9) break;
		t -= (bx - x) / dx;
		t = Math.max(0, Math.min(1, t));
	}
	const mt = 1 - t;
	return 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t;
}

function buildCurveLUT(curve: [number, number, number, number]): Uint8Array {
	const lut = new Uint8Array(256);
	const [x1, y1, x2, y2] = curve;
	for (let i = 0; i < 256; i++)
		lut[i] = Math.round(cubicBezierY(i / 255, x1, y1, x2, y2) * 255);
	return lut;
}

let _parseCanvas: HTMLCanvasElement | null = null;
let _parseCtx: CanvasRenderingContext2D | null = null;

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

function parseColorRGBA(css: string): [number, number, number, number] {
	if (!_parseCanvas) {
		_parseCanvas = document.createElement("canvas");
		_parseCanvas.width = _parseCanvas.height = 1;
		_parseCtx = _parseCanvas.getContext("2d", { willReadFrequently: true })!;
	}
	_parseCtx!.clearRect(0, 0, 1, 1);
	_parseCtx!.fillStyle = css;
	_parseCtx!.fillRect(0, 0, 1, 1);
	const d = _parseCtx!.getImageData(0, 0, 1, 1).data;
	return [d[0], d[1], d[2], d[3]];
}

function rgbHex(c: [number, number, number]): string {
	return `#${((1 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]).toString(16).slice(1)}`;
}

function buildColorLUT(colors: string[]): string[] {
	const parsed = colors.map(parseColor);
	const lut: string[] = new Array(256);
	if (parsed.length === 1) { lut.fill(rgbHex(parsed[0])); return lut; }
	const segments = parsed.length - 1;
	for (let i = 0; i < 256; i++) {
		const pos = (i / 255) * segments;
		const seg = Math.min(Math.floor(pos), segments - 1);
		const frac = pos - seg;
		const a = parsed[seg], b = parsed[seg + 1];
		lut[i] = rgbHex([
			Math.round(a[0] + (b[0] - a[0]) * frac),
			Math.round(a[1] + (b[1] - a[1]) * frac),
			Math.round(a[2] + (b[2] - a[2]) * frac),
		]);
	}
	return lut;
}

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
			for (let ci = 0; ci < charsLen; ci++)
				actx.fillText(charStr[ci], ci * cellW, row * cellH);
		}
	} else {
		actx.fillStyle = monoColor;
		for (let ci = 0; ci < charsLen; ci++)
			actx.fillText(charStr[ci], ci * cellW, 0);
	}
	return canvas;
}

// ─── WebGL helpers ────────────────────────────────────────────────────────────

type GL = WebGL2RenderingContext;

function compileShader(gl: GL, type: number, src: string): WebGLShader | null {
	const s = gl.createShader(type)!;
	gl.shaderSource(s, src);
	gl.compileShader(s);
	if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
		console.error("Shader compile error:", gl.getShaderInfoLog(s));
		gl.deleteShader(s);
		return null;
	}
	return s;
}

function linkProgram(gl: GL, vert: string, frag: string): WebGLProgram | null {
	const vs = compileShader(gl, gl.VERTEX_SHADER, vert);
	const fs = compileShader(gl, gl.FRAGMENT_SHADER, frag);
	if (!vs || !fs) return null;
	const prog = gl.createProgram()!;
	gl.attachShader(prog, vs);
	gl.attachShader(prog, fs);
	gl.linkProgram(prog);
	gl.deleteShader(vs);
	gl.deleteShader(fs);
	if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
		console.error("Program link error:", gl.getProgramInfoLog(prog));
		gl.deleteProgram(prog);
		return null;
	}
	return prog;
}

function createTex(
	gl: GL,
	w: number,
	h: number,
	internalFormat: number,
	format: number,
	type: number,
	data: ArrayBufferView | ImageBitmap | null,
	filter: number = gl.NEAREST,
): WebGLTexture {
	const tex = gl.createTexture()!;
	gl.bindTexture(gl.TEXTURE_2D, tex);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	if (data instanceof ImageBitmap)
		gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, format, type, data);
	else
		gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, data as ArrayBufferView | null);
	gl.bindTexture(gl.TEXTURE_2D, null);
	return tex;
}

function createFBO(
	gl: GL,
	w: number,
	h: number,
	internalFormat: number = gl.RGBA8,
	format: number = gl.RGBA,
	type: number = gl.UNSIGNED_BYTE,
): { fbo: WebGLFramebuffer; tex: WebGLTexture } {
	const tex = createTex(gl, w, h, internalFormat, format, type, null);
	const fbo = gl.createFramebuffer()!;
	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	return { fbo, tex };
}

function createCheckedFBO(
	gl: GL,
	w: number,
	h: number,
	internalFormat: number,
	format: number,
	type: number,
): { fbo: WebGLFramebuffer; tex: WebGLTexture } | null {
	const target = createFBO(gl, w, h, internalFormat, format, type);
	gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
	const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	if (complete) return target;
	gl.deleteTexture(target.tex);
	gl.deleteFramebuffer(target.fbo);
	return null;
}

function getTrailAlphaFloor(trail: number, highPrecision: boolean): number {
	if (trail <= 0 || trail >= 1) return 0;
	if (highPrecision) return 0.5 / 255;
	const stableByteFloor = Math.ceil(0.5 / trail) + 1;
	return Math.min(32, Math.max(2, stableByteFloor)) / 255;
}

// ─── GLSL ─────────────────────────────────────────────────────────────────────

const VERT = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUV;
void main() {
    vUV = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// Pass 1: sample video → output chars only (transparent bg, no bgColor baked in).
// bgColor is composited in the final pass so the trail accumulation stays clean.
const DITHER_FRAG = `#version 300 es
precision mediump float;
precision mediump int;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uVideoTex;
uniform sampler2D uAtlasTex;
uniform sampler2D uCharColLUT;
uniform sampler2D uColorIdxLUT;

uniform vec2  uResolution;
uniform vec2  uCellSize;
uniform vec2  uGridSize;
uniform vec3  uMonoColor;
uniform int   uHasColorRamp;
uniform int   uUseVideoColor;
uniform int   uAtlasCharCount;
uniform vec2  uRegionStart;
uniform vec2  uRegionEnd;

void main() {
    // Flip Y: WebGL origin is bottom-left; canvas is top-left.
    vec2 fc = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);

    vec2  cellF = fc / uCellSize;
    ivec2 cell  = ivec2(floor(cellF));
    vec2  subUV = fract(cellF);

    // Outside region → transparent (composite pass applies bgColor everywhere).
    if (float(cell.x) < uRegionStart.x || float(cell.y) < uRegionStart.y ||
        float(cell.x) >= uRegionEnd.x   || float(cell.y) >= uRegionEnd.y) {
        fragColor = vec4(0.0);
        return;
    }

    // Sample video at cell center.
    // fc.y=0 is at screen top; with UNPACK_FLIP_Y_WEBGL=false UV y=0 = image top.
    vec2 videoUV = (vec2(cell) + 0.5) / uGridSize;
    vec3 rgb = texture(uVideoTex, videoUV).rgb;

    // Luminance BT.601
    float lum = dot(rgb, vec3(0.299, 0.587, 0.114));

    // LUT lookups (256×1 R8, NEAREST)
    vec2 lutUV = vec2(lum, 0.5);
    int charCol  = int(texture(uCharColLUT,  lutUV).r * 255.0 + 0.5);
    int colorIdx = int(texture(uColorIdxLUT, lutUV).r * 255.0 + 0.5);

    // Atlas sample — no Y-flip on upload, UV y=0 = row 0 (dark).
    float atlasU = (float(charCol) + subUV.x) / float(uAtlasCharCount);
    float atlasV = (uHasColorRamp == 1)
        ? (float(colorIdx) + subUV.y) / 256.0
        : subUV.y;
    vec4 glyph = texture(uAtlasTex, vec2(atlasU, atlasV));

    float charAlpha = glyph.a;
    vec3  charRGB   = (uUseVideoColor == 1) ? rgb
                    : (uHasColorRamp == 1) ? glyph.rgb
                    : uMonoColor;

    // Output chars only — no bgColor composited here.
    fragColor = vec4(charRGB, charAlpha);
}`;

// Pass 2: accumulate trail.
// Replicates the original's Canvas 2D approach:
//   1. Fade accumulated trail by (1 - trail) — alpha decays each frame.
//   2. Draw current chars ON TOP via Porter-Duff "src over dst".
// Positions with no character decay as (1-trail)^N; positions with a char stay full.
const ACCUM_FRAG = `#version 300 es
precision mediump float;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uCurrentTex;   // current dither pass (chars, transparent bg)
uniform sampler2D uPreviousTex;  // previous accumulated trail
uniform float     uTrail;        // 0 = no ghost, 1 = full ghost
uniform float     uAlphaFloor;
uniform float     uScreenBlendIntensity;

void main() {
    vec4 cur  = texture(uCurrentTex,  vUV);

    // trail=0 matches the original's no-trail code path: output current frame only.
    if (uTrail <= 0.0) {
        fragColor = cur;
        return;
    }

    vec4 prev = texture(uPreviousTex, vUV);

    // Fade previous trail: multiply alpha by (1 - trail).
    float fadedAlpha = prev.a * (1.0 - uTrail);

    float outAlpha = cur.a + fadedAlpha * (1.0 - cur.a);

    // Trail targets can otherwise keep tiny alpha residue alive forever after
    // byte conversion. The JS side lowers this for half-float trail buffers.
    if (outAlpha <= uAlphaFloor) {
        fragColor = vec4(0.0);
        return;
    }

    vec3 srcOverRGB = outAlpha > 0.001
        ? (cur.rgb * cur.a + prev.rgb * fadedAlpha * (1.0 - cur.a)) / outAlpha
        : vec3(0.0);

    // Softer screen blend. Work in premultiplied alpha so transparent atlas
    // pixels cannot brighten the trail into white.
    vec3 curScreenRGB  = cur.rgb * cur.a;
    vec3 prevScreenRGB = prev.rgb * fadedAlpha;
    vec3 screenPremul  = curScreenRGB + prevScreenRGB - curScreenRGB * prevScreenRGB;
    vec3 screenRGB     = outAlpha > 0.001 ? screenPremul / outAlpha : vec3(0.0);
    vec3 outRGB        = mix(srcOverRGB, screenRGB, uScreenBlendIntensity);
    fragColor = vec4(outRGB, outAlpha);
}`;

// Pass 3: composite accumulated trail over bgColor and output to screen.
const COMPOSITE_FRAG = `#version 300 es
precision mediump float;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uTrailTex;
uniform vec4      uBgColor;
uniform int       uOverlay;  // 1 = overlay mode (no bg composite, video shows behind)

void main() {
    vec4 trail = texture(uTrailTex, vUV);

    if (uOverlay == 1) {
        // Canvas is transparent; CSS compositing shows video underneath.
        fragColor = trail;
    } else {
        // Porter-Duff trail over bgColor.
        float outAlpha = trail.a + uBgColor.a * (1.0 - trail.a);
        vec3  outRGB   = outAlpha > 0.001
            ? (trail.rgb * trail.a + uBgColor.rgb * uBgColor.a * (1.0 - trail.a)) / outAlpha
            : uBgColor.rgb;
        fragColor = vec4(outRGB, outAlpha);
    }
}`;

// ─── Component ────────────────────────────────────────────────────────────────

export default function DitheredVideoGL(props: Props) {
	let containerRef!: HTMLDivElement;
	let videoRef!: HTMLVideoElement;
	let canvasRef!: HTMLCanvasElement;
	let rafId: number;
	// Populated by init(); called from the sync onCleanup registered in onMount.
	let cleanupGL: (() => void) | null = null;
	let visible = true;
	let lastVisibilityCheck = 0;
	let wasRenderPaused = false;

	const overlay = () => props.dither?.overlay ?? false;

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
	const [glFailed, setGlFailed] = createSignal(false);
	const [firstFrameDrawn, setFirstFrameDrawn] = createSignal(false);

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

	async function init(w: number, h: number) {
		setFirstFrameDrawn(false);
		const dpr = props.dpr ?? 1;
		const cw = w * dpr;
		const ch = h * dpr;

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
		const screenBlendIntensity = Math.max(0, Math.min(1, cfg.screenBlendIntensity ?? 0.50));
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

		// Parse bgColor → vec4
		const [br, bg, bb, ba] = parseColorRGBA(bgColor);
		// Parse mono color → vec3
		const [mr, mg, mb] = parseColor(color);

		// Measure cell dimensions
		const measureCanvas = new OffscreenCanvas(1, 1);
		const mctx = measureCanvas.getContext("2d")!;
		mctx.font = `${fontSize}px monospace`;
		const metrics = mctx.measureText("Mg");
		const cellW = Math.ceil(mctx.measureText("M").width);
		const cellH = Math.ceil(metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent);
		const cols = Math.floor(cw / cellW);
		const rows = Math.floor(ch / cellH);

		// Coverage region
		const side = Math.sqrt(coverageFraction);
		const regionCols = Math.max(1, Math.floor(cols * side));
		const regionRows = Math.max(1, Math.floor(rows * side));
		const regionX = randomizeRegion ? Math.floor(Math.random() * (cols - regionCols + 1)) : 0;
		const regionY = randomizeRegion ? Math.floor(Math.random() * (rows - regionRows + 1)) : 0;

		// Build LUTs
		const curveLUT = buildCurveLUT(cfg.curve ?? [0, 0, 1, 1]);
		const hasColorRamp = !!(cfg.colorRamp && cfg.colorRamp.length > 0);
		const colorLUTHex = hasColorRamp ? buildColorLUT(cfg.colorRamp!) : null;
		const { charColLUT, colorIdxLUT } = buildCombinedLUTs(
			charStr, curveLUT, isThreshold, thresholdCutoff, invert,
		);

		// Build atlas
		const atlas = buildAtlas(charStr, cellW, cellH, fontSize, colorLUTHex, color);
		const atlasBitmap = await createImageBitmap(atlas);

		// ── WebGL setup ──────────────────────────────────────────────────────
		canvasRef.width  = cw;
		canvasRef.height = ch;
		const glOrNull = canvasRef.getContext("webgl2", {
			alpha: true,          // always on — supports transparent bgColor and overlay mode
			premultipliedAlpha: false,
			antialias: false,
			preserveDrawingBuffer: false,
		}) as WebGL2RenderingContext | null;

		if (!glOrNull) {
			console.warn("DitheredVideoGL: WebGL 2 not available, falling back.");
			setGlFailed(true);
			return;
		}
		// Non-null typed alias — closures (draw, cleanupGL) see GL, not GL|null.
		const gl: GL = glOrNull;

		const ditherProg    = linkProgram(gl, VERT, DITHER_FRAG);
		const accumProg     = linkProgram(gl, VERT, ACCUM_FRAG);
		const compositeProg = linkProgram(gl, VERT, COMPOSITE_FRAG);
		if (!ditherProg || !accumProg || !compositeProg) { setGlFailed(true); return; }

		// VAO + quad
		const vao = gl.createVertexArray()!;
		gl.bindVertexArray(vao);
		const buf = gl.createBuffer()!;
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.bufferData(gl.ARRAY_BUFFER,
			new Float32Array([-1, -1,  1, -1,  -1, 1,  -1, 1,  1, -1,  1, 1]),
			gl.STATIC_DRAW);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
		gl.bindVertexArray(null);

		// Textures
		// videoTex — updated each frame; start as 1×1 placeholder
		const videoTex = createTex(gl, 1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE,
			new Uint8Array([0, 0, 0, 255]));

		// atlasTex — no Y-flip: image top (row 0, darkest chars) stays at UV y=0.
		// NEAREST filter: the original does exact pixel copies from the atlas (drawImage),
		// so NEAREST avoids LINEAR blending adjacent chars at cell boundaries.
		const atlasTex = createTex(gl, atlas.width, atlas.height,
			gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, atlasBitmap);
		atlasBitmap.close();

		// LUT textures — 256×1 R8, NEAREST
		const charColTex  = createTex(gl, 256, 1, gl.R8, gl.RED, gl.UNSIGNED_BYTE, charColLUT);
		const colorIdxTex = createTex(gl, 256, 1, gl.R8, gl.RED, gl.UNSIGNED_BYTE, colorIdxLUT);

		// FBOs:
		// fboTemp  — holds current dither output (chars only, transparent bg)
		// fboTrailA/B — ping-pong for accumulated trail
		const fboTemp = createFBO(gl, cw, ch);
		let trailCurrent: { fbo: WebGLFramebuffer; tex: WebGLTexture };
		let trailPrev: { fbo: WebGLFramebuffer; tex: WebGLTexture };
		const floatTrailSupported = !!gl.getExtension("EXT_color_buffer_float");
		const floatTrailCurrent = floatTrailSupported
			? createCheckedFBO(gl, cw, ch, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT)
			: null;
		const floatTrailPrev = floatTrailSupported
			? createCheckedFBO(gl, cw, ch, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT)
			: null;
		const usingHighPrecisionTrail = Boolean(floatTrailCurrent && floatTrailPrev);

		if (floatTrailCurrent && floatTrailPrev) {
			trailCurrent = floatTrailCurrent;
			trailPrev = floatTrailPrev;
		} else {
			floatTrailCurrent && (gl.deleteTexture(floatTrailCurrent.tex), gl.deleteFramebuffer(floatTrailCurrent.fbo));
			floatTrailPrev && (gl.deleteTexture(floatTrailPrev.tex), gl.deleteFramebuffer(floatTrailPrev.fbo));
			trailCurrent = createFBO(gl, cw, ch);
			trailPrev = createFBO(gl, cw, ch);
		}
		const trailAlphaFloor = getTrailAlphaFloor(trail, usingHighPrecisionTrail);

		const clearFBO = (fbo: WebGLFramebuffer | null) => {
			gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
			gl.viewport(0, 0, cw, ch);
			gl.clearColor(0, 0, 0, 0);
			gl.clear(gl.COLOR_BUFFER_BIT);
		};
		const clearTrailBuffers = () => {
			clearFBO(fboTemp.fbo);
			clearFBO(trailCurrent.fbo);
			clearFBO(trailPrev.fbo);
			clearFBO(null);
		};
		clearTrailBuffers();

		// Static uniforms — dither program
		gl.useProgram(ditherProg);
		gl.uniform1i(gl.getUniformLocation(ditherProg, "uVideoTex"),      0);
		gl.uniform1i(gl.getUniformLocation(ditherProg, "uAtlasTex"),      1);
		gl.uniform1i(gl.getUniformLocation(ditherProg, "uCharColLUT"),    2);
		gl.uniform1i(gl.getUniformLocation(ditherProg, "uColorIdxLUT"),   3);
		gl.uniform2f(gl.getUniformLocation(ditherProg, "uResolution"),    cw, ch);
		gl.uniform2f(gl.getUniformLocation(ditherProg, "uCellSize"),      cellW, cellH);
		gl.uniform2f(gl.getUniformLocation(ditherProg, "uGridSize"),      cols, rows);
		gl.uniform3f(gl.getUniformLocation(ditherProg, "uMonoColor"),     mr / 255, mg / 255, mb / 255);
		gl.uniform1i(gl.getUniformLocation(ditherProg, "uHasColorRamp"),   hasColorRamp ? 1 : 0);
		gl.uniform1i(gl.getUniformLocation(ditherProg, "uUseVideoColor"),  cfg.useVideoColor ? 1 : 0);
		gl.uniform1i(gl.getUniformLocation(ditherProg, "uAtlasCharCount"), charStr.length);
		gl.uniform2f(gl.getUniformLocation(ditherProg, "uRegionStart"),   regionX, regionY);
		gl.uniform2f(gl.getUniformLocation(ditherProg, "uRegionEnd"),     regionX + regionCols, regionY + regionRows);

		// Static uniforms — accumulate program
		gl.useProgram(accumProg);
		gl.uniform1i(gl.getUniformLocation(accumProg, "uCurrentTex"),  0);
		gl.uniform1i(gl.getUniformLocation(accumProg, "uPreviousTex"), 1);
		gl.uniform1f(gl.getUniformLocation(accumProg, "uTrail"),       trail);
		gl.uniform1f(gl.getUniformLocation(accumProg, "uAlphaFloor"),  trailAlphaFloor);
		gl.uniform1f(gl.getUniformLocation(accumProg, "uScreenBlendIntensity"), screenBlendIntensity);

		// Static uniforms — composite program
		gl.useProgram(compositeProg);
		gl.uniform1i(gl.getUniformLocation(compositeProg, "uTrailTex"), 0);
		gl.uniform4f(gl.getUniformLocation(compositeProg, "uBgColor"),  br / 255, bg / 255, bb / 255, ba / 255);
		gl.uniform1i(gl.getUniformLocation(compositeProg, "uOverlay"),  isOverlay ? 1 : 0);

		let lastVideoTime = -1;

		function draw(now: number) {
			rafId = requestAnimationFrame(draw);

			if (!shouldRender(now)) {
				if (!wasRenderPaused) {
					videoRef.pause();
					clearTrailBuffers();
					lastVideoTime = -1;
					wasRenderPaused = true;
				}
				return;
			}

			if (wasRenderPaused) {
				videoRef.play().catch(() => {});
				wasRenderPaused = false;
			}

			if (videoRef.readyState < 2) return;
			if (videoRef.currentTime === lastVideoTime) return;
			lastVideoTime = videoRef.currentTime;

			gl.bindVertexArray(vao);

			// Pass 1: dither → fboTemp (chars only, transparent bg)
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, videoTex);
			gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, videoRef);

			gl.bindFramebuffer(gl.FRAMEBUFFER, fboTemp.fbo);
			gl.viewport(0, 0, cw, ch);
			gl.useProgram(ditherProg);
			gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, videoTex);
			gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, atlasTex);
			gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, charColTex);
			gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, colorIdxTex);
			gl.drawArrays(gl.TRIANGLES, 0, 6);

			// Pass 2: accumulate → trailCurrent (fade trailPrev + overlay fboTemp)
			gl.bindFramebuffer(gl.FRAMEBUFFER, trailCurrent.fbo);
			gl.viewport(0, 0, cw, ch);
			gl.useProgram(accumProg);
			gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fboTemp.tex);
			gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, trailPrev.tex);
			gl.drawArrays(gl.TRIANGLES, 0, 6);

			// Pass 3: composite → screen (trail over bgColor)
			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
			gl.viewport(0, 0, cw, ch);
			gl.useProgram(compositeProg);
			gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, trailCurrent.tex);
			gl.drawArrays(gl.TRIANGLES, 0, 6);

			if (!firstFrameDrawn()) setFirstFrameDrawn(true);

			// Advance trail ping-pong
			const tmp = trailCurrent; trailCurrent = trailPrev; trailPrev = tmp;
		}

		const start = () => {
			videoRef.play().catch(() => {});
			rafId = requestAnimationFrame(draw);
		};

		// Context loss recovery
		canvasRef.addEventListener("webglcontextlost", (e) => {
			e.preventDefault();
			cancelAnimationFrame(rafId);
		}, { once: false });
		canvasRef.addEventListener("webglcontextrestored", () => init(w, h), { once: false });

		if (videoRef.readyState >= 2) start();
		else videoRef.addEventListener("canplay", start, { once: true });

		// Store cleanup for the synchronous onCleanup registered in onMount.
		cleanupGL = () => {
			cancelAnimationFrame(rafId);
			gl.deleteTexture(videoTex);
			gl.deleteTexture(atlasTex);
			gl.deleteTexture(charColTex);
			gl.deleteTexture(colorIdxTex);
			gl.deleteTexture(fboTemp.tex);        gl.deleteFramebuffer(fboTemp.fbo);
			gl.deleteTexture(trailCurrent.tex);   gl.deleteFramebuffer(trailCurrent.fbo);
			gl.deleteTexture(trailPrev.tex);      gl.deleteFramebuffer(trailPrev.fbo);
			gl.deleteBuffer(buf);
			gl.deleteVertexArray(vao);
			gl.deleteProgram(ditherProg);
			gl.deleteProgram(accumProg);
			gl.deleteProgram(compositeProg);
		};
	}

	onMount(() => {
		// Register cleanup synchronously (before any async work) so SolidJS tracks it.
		onCleanup(() => {
			cancelAnimationFrame(rafId);
			cleanupGL?.();
		});

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
					// Show video if overlay mode (renders behind canvas) or GL failed
					opacity: overlay() || glFailed() ? 1 : 0,
				}}
			>
				<source src={props.webm} type="video/webm" />
				<source src={props.mp4} type="video/mp4" />
			</video>
			<Show when={!glFailed()}>
				<canvas
					ref={canvasRef}
					style={{
						display: "block",
						position: "absolute",
						"image-rendering": "pixelated",
						top: 0,
						left: 0,
						width: `${dims()?.w ?? 0}px`,
						height: `${dims()?.h ?? 0}px`,
						opacity: firstFrameDrawn() ? 1 : 0,
					}}
				/>
			</Show>
		</div>
	);
}
