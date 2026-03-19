import { onCleanup, onMount, type JSX } from "solid-js";

export type WitnessTheme = "light" | "dark" | "custom";

export type WitnessPuzzleRuleSettings = Partial<{
	NEGATIONS_CANCEL_NEGATIONS: boolean;
	SHAPELESS_ZERO_POLY: boolean;
	PRECISE_POLYOMINOS: boolean;
	FLASH_FOR_ERRORS: boolean;
	FAT_STARTPOINTS: boolean;
	CUSTOM_MECHANICS: boolean;
}>;

export type WitnessPalette = Partial<{
	BACKGROUND: string;
	OUTER_BACKGROUND: string;
	FOREGROUND: string;
	BORDER: string;
	LINE_DEFAULT: string;
	LINE_SUCCESS: string;
	LINE_FAIL: string;
	CURSOR: string;
	TEXT_COLOR: string;
	PAGE_BACKGROUND: string;
	ALT_BACKGROUND: string;
	ACTIVE_COLOR: string;
	LINE_PRIMARY: string;
	LINE_SECONDARY: string;
}>;

export type WitnessConfig = Partial<{
	theme: WitnessTheme;
	palette: WitnessPalette;
	vignette: number;
	sensitivity: number;
	volume: number;
	wittleTracing: boolean;
	debug: boolean;
	puzzleSettings: WitnessPuzzleRuleSettings;
}>;

export type TraceCompleteDetail = {
	puzzle: unknown;
	serialized: string;
	solved: boolean;
	aborted?: boolean;
	rawPath: unknown[] | null;
	puzzleData: unknown;
};

declare global {
	interface Window {
		__witnessTraceCompletionHandlers?: Map<
			string,
			(detail: {
				svgId?: string;
				puzzle: unknown;
				rawPath: unknown[] | null;
				solved: boolean;
				puzzleData: unknown;
			}) => void
		>;
		Puzzle?: { deserialize: (json: string) => unknown };
		draw?: (puzzle: unknown, target?: string) => void;
		deserializePuzzle?: (data: string) => unknown;
		settings?: Record<string, string>;
		WITNESS_EXTERNAL_THEME?: boolean;
		WITNESS_DEBUG?: boolean;
		abortTrace?: () => boolean;
	}
}

export interface PuzzleProps {
	serialized: string;
	config?: WitnessConfig;
	class?: string;
	style?: JSX.CSSProperties;
	onSolved?: (detail: TraceCompleteDetail) => void;
	onFailed?: (detail: TraceCompleteDetail) => void;
	onAborted?: (detail: TraceCompleteDetail) => void;
	onTraceComplete?: (detail: TraceCompleteDetail) => void;
}

let witnessLoaded: Promise<void> | null = null;
function loadWitnessOnce(): Promise<void> {
	if (!witnessLoaded) {
		witnessLoaded = (async () => {
            // @ts-ignore
			await import("../../lib/witness/utilities.js");
            // @ts-ignore
			await import("../../lib/witness/svg.js");
            // @ts-ignore
			await import("../../lib/witness/polyominos.js");
            // @ts-ignore
			await import("../../lib/witness/puzzle.js");
            // @ts-ignore
			await import("../../lib/witness/serializer.js");
            // @ts-ignore
			await import("../../lib/witness/validate.js");
            // @ts-ignore
			await import("../../lib/witness/custom_mechanics.js");
            // @ts-ignore
			await import("../../lib/witness/display2.js");
            // @ts-ignore
			await import("../../lib/witness/trace2.js");
		})();
	}
	return witnessLoaded;
}

function applyThemePalette(theme: WitnessTheme | undefined) {
	if (!theme || theme === "custom") return;
	const w = window as any;
	if (theme === "dark") {
        // dark theme
		w.BACKGROUND = "#221";
		w.OUTER_BACKGROUND = "#33230d";
		w.FOREGROUND = "#751";
		w.BORDER = "#666";
		w.LINE_DEFAULT = "#888";
		w.LINE_SUCCESS = "#BBB";
		w.LINE_FAIL = "#000";
		w.CURSOR = "#FFF";
		w.TEXT_COLOR = "#AAA";
		w.PAGE_BACKGROUND = "#000";
		w.ALT_BACKGROUND = "#333";
		w.ACTIVE_COLOR = "#555";
	} else {
        // light theme
		w.BACKGROUND = "#0A8";
		w.OUTER_BACKGROUND = "#113833";
		w.FOREGROUND = "#344";
		w.BORDER = "#000";
		w.LINE_DEFAULT = "#AAA";
		w.LINE_SUCCESS = "#FFF";
		w.LINE_FAIL = "#000";
		w.CURSOR = "#FFF";
		w.TEXT_COLOR = "#000";
		w.PAGE_BACKGROUND = "#FFF";
		w.ALT_BACKGROUND = "#EEE";
		w.ACTIVE_COLOR = "#DDD";
	}
}

function applyPaletteOverrides(theme: WitnessTheme | undefined, palette?: WitnessPalette) {
	if (!palette || theme !== "custom") return;
	const w = window as any;
	for (const [k, v] of Object.entries(palette)) {
		if (typeof v === "string") w[k] = v;
	}
}

function clamp01(n: number) {
	if (!Number.isFinite(n)) return 0;
	return Math.max(0, Math.min(1, n));
}

function ensureHandlersMap(): Map<string, (detail: any) => void> {
	if (!window.__witnessTraceCompletionHandlers) {
		window.__witnessTraceCompletionHandlers = new Map();
	}
	return window.__witnessTraceCompletionHandlers;
}

export default function PuzzleClient(props: PuzzleProps) {
	let wrapperRef!: HTMLDivElement;
	let svgRef!: SVGSVGElement;
	let registeredId: string | undefined;

	onMount(async () => {
		const cfg: WitnessConfig = props.config ?? {};

		const id = `witness_${crypto.randomUUID?.() ?? Math.random().toString(16).slice(2)}`;
		svgRef.id = id;
		// Mark this SVG as responsive so the legacy renderer won't force pixel width/height.
		svgRef.dataset.responsive = "true";
		registeredId = id;

		window.WITNESS_DEBUG = cfg.debug === true;
		window.WITNESS_EXTERNAL_THEME = true;

		if (!window.settings) window.settings = {};
		if (typeof cfg.sensitivity === "number" && Number.isFinite(cfg.sensitivity)) {
			window.settings.sensitivity = String(cfg.sensitivity);
		}
		if (typeof cfg.volume === "number" && Number.isFinite(cfg.volume)) {
			window.settings.volume = String(cfg.volume);
		}
		if (typeof cfg.wittleTracing === "boolean") {
			window.settings.wittleTracing = String(cfg.wittleTracing);
		}

		// Always set a deterministic base theme in settings.
		// For custom palettes, we treat the base as light and then overlay the provided keys.
		const effectiveTheme: WitnessTheme = cfg.theme ?? "light";
		if (effectiveTheme === "dark") window.settings.theme = "night";
		else window.settings.theme = "light";

		// Apply theme/palette BEFORE the witness utilities build their CSS.
		if (effectiveTheme === "custom") {
			applyThemePalette("light");
		} else {
			applyThemePalette(effectiveTheme);
		}
		applyPaletteOverrides(effectiveTheme, cfg.palette);

		// Vignette is controlled via config (with palette.VIGNETTE as fallback for older callers).
		const vignette = effectiveTheme === "custom" ? clamp01(cfg.vignette ?? 0) : 0;
		(window as any).VIGNETTE = vignette;

		await loadWitnessOnce();

		ensureHandlersMap().set(id, (detail) => {
			const solved = !!detail?.solved;
			const aborted = detail?.aborted === true;
			const traceDetail: TraceCompleteDetail = {
				puzzle: detail?.puzzle,
				serialized: props.serialized,
				solved,
				aborted,
				rawPath: detail?.rawPath ?? null,
				puzzleData: detail?.puzzleData,
			};

			props.onTraceComplete?.(traceDetail);
			if (aborted) props.onAborted?.(traceDetail);
			else if (solved) props.onSolved?.(traceDetail);
			else props.onFailed?.(traceDetail);

			wrapperRef.dispatchEvent(
				new CustomEvent("puzzle:tracecomplete", { detail: traceDetail, bubbles: true }),
			);
			wrapperRef.dispatchEvent(
				new CustomEvent(aborted ? "puzzle:aborted" : solved ? "puzzle:solved" : "puzzle:failed", {
					detail: traceDetail,
					bubbles: true,
				}),
			);
		});

		let puzzle: unknown;
		if (window.deserializePuzzle) {
			puzzle = window.deserializePuzzle(props.serialized);
		} else if (window.Puzzle?.deserialize) {
			puzzle = window.Puzzle.deserialize(props.serialized);
		} else {
			throw new Error("Witness deserialization not loaded");
		}

		if (
			cfg.puzzleSettings &&
			typeof puzzle === "object" &&
			puzzle != null &&
			"settings" in (puzzle as any)
		) {
			(puzzle as any).settings = { ...(puzzle as any).settings, ...cfg.puzzleSettings };
		}

		if (!window.draw) throw new Error("Witness draw() not loaded");
		window.draw(puzzle, id);
	});

	onCleanup(() => {
		if (registeredId) {
			try {
				ensureHandlersMap().delete(registeredId);
			} catch {
				/* ignore */
			}
		}
	});

	return (
		<div
			ref={wrapperRef}
			class={props.class}
			data-puzzle
			style={{ width: "100%", height: "100%" }}
		>
			<svg
				ref={svgRef}
				style={{
					display: "block",
					width: "100%",
					height: "100%",
					"pointer-events": "auto",
					...((props.style as any) ?? {}),
				}}
			/>
		</div>
	);
}
