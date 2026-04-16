import { onMount, createSignal, Show, For } from "solid-js";
import { gsap } from "gsap";
import DitheredVideo from "./misc/DitheredVideo";
import liquidVideo_webm from "../assets/videos/liquid1-optimized.webm";
import liquidVideo_mp4 from "../assets/videos/liquid1-optimized.mp4";
import schizoVideo_webm from "../assets/videos/schizo-optimized.webm";
import schizoVideo_mp4 from "../assets/videos/schizo-optimized.mp4";
import bloomVideo_webm from "../assets/videos/bloom-optimized.webm";
import bloomVideo_mp4 from "../assets/videos/bloom-optimized.mp4";

// ─── video config ────────────────────────────────────────────────────────────

const VIDEO_W = 640;
const VIDEO_H = 360;
// rough vw/vh footprint at 1920×1080 — used for square biasing only
const VIDEO_VW = (VIDEO_W / 1920) * 100;
const VIDEO_VH = (VIDEO_H / 1080) * 100;

// non-overlapping: video 0 left zone, video 1 right zone
const videoPlacements = [
	{ x: 5 + Math.random() * 10, y: 10 + Math.random() * 55 },
	{ x: 58 + Math.random() * 10, y: 10 + Math.random() * 55 },
] as const;

// ─── tuning constants ────────────────────────────────────────────────────────

const SQUARE_COUNT = 20;          // total grid-distributed squares (before cascades)
const CASCADE_COUNT = 3;          // number of cascade clusters
const CASCADE_LENGTH = 6;         // squares per cascade (4–8 is the sweet spot)

// ─── shapes ──────────────────────────────────────────────────────────────────

type ShapeKind = "filled" | "outlined" | "line" | "cross" | "circle" | "dot";

type Shape = {
	id: number;
	x: number;        // vw
	y: number;        // vh
	w: number;        // px
	h: number;        // px
	color: string;
	kind: ShapeKind;
	rotation?: number; // degrees — used by lines
};

const KIND_WEIGHTS: [ShapeKind, number][] = [
	["filled", 0.35],
	["outlined", 0.20],
	["line", 0.15],
	["cross", 0.10],
	["circle", 0.10],
	["dot", 0.10],
];

function pickKind(): ShapeKind {
	const r = Math.random();
	let acc = 0;
	for (const [kind, weight] of KIND_WEIGHTS) {
		acc += weight;
		if (r < acc) return kind;
	}
	return "filled";
}

function color() {
	return getRandomColor(200, 100);
}
const getRandomColor = (baseHue = 200, range = 20) => {
	const h = baseHue + (Math.random() * range - range / 2);
	const s = 88 + (Math.random() * 12);
	const l = 50 + (Math.random() * 20);
	return `hsl(${h}, ${s}%, ${l}%)`;
};

function mkSize(kind: ShapeKind): { w: number; h: number; rotation?: number } {
	switch (kind) {
		case "line": {
			// biased toward 0° and 90°, but any angle possible
			const r = Math.random();
			const rot = r < 0.35 ? (Math.random() - 0.5) * 12          // ~0° ± 6
				: r < 0.70 ? 90 + (Math.random() - 0.5) * 12           // ~90° ± 6
				: Math.random() * 180;                                   // any angle
			return { w: 80 + Math.random() * 120, h: 3, rotation: rot };
		}
		case "dot": {
			const d = 8 + Math.random() * 8;
			return { w: d, h: d };
		}
		case "circle": {
			const s = 40 + Math.random() * 60;
			return { w: s, h: s };
		}
		case "cross": {
			const s = 60 + Math.random() * 40;
			return { w: s, h: s };
		}
		default: {
			const large = Math.random() > 0.75;
			return large ? { w: 200, h: 200 } : { w: 100, h: 100 };
		}
	}
}

function generateShapes(): Shape[] {
	const shapes: Shape[] = [];

	// divide viewport into a grid of cells, place one square per cell
	// with jitter so it doesn't look mechanical
	const COLS = 7;
	const ROWS = 5;
	const MARGIN = 4; // vw/vh margin from edges (enough for half a large element)
	const cellW = (100 - MARGIN * 2) / COLS;
	const cellH = (100 - MARGIN * 2) / ROWS;

	// mark cells occupied by videos so we skip them
	const videoOccupied = new Set<string>();
	for (const vp of videoPlacements) {
		const colStart = Math.floor((vp.x - MARGIN) / cellW);
		const colEnd = Math.floor((vp.x + VIDEO_VW - MARGIN) / cellW);
		const rowStart = Math.floor((vp.y - MARGIN) / cellH);
		const rowEnd = Math.floor((vp.y + VIDEO_VH - MARGIN) / cellH);
		for (let r = rowStart; r <= rowEnd; r++) {
			for (let c = colStart; c <= colEnd; c++) {
				if (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
					videoOccupied.add(`${r},${c}`);
				}
			}
		}
	}

	// build list of all cells, shuffle, then place squares
	const cells: { col: number; row: number }[] = [];
	for (let r = 0; r < ROWS; r++) {
		for (let c = 0; c < COLS; c++) {
			cells.push({ col: c, row: r });
		}
	}
	// Fisher-Yates shuffle
	for (let i = cells.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[cells[i], cells[j]] = [cells[j], cells[i]];
	}

	// place up to SQUARE_COUNT shapes across shuffled cells, cycling if needed
	for (let i = 0; i < SQUARE_COUNT; i++) {
		const cell = cells[i % cells.length];
		const kind = pickKind();
		const { w, h, rotation } = mkSize(kind);
		const jitterX = (Math.random() - 0.5) * cellW * 0.4;
		const jitterY = (Math.random() - 0.5) * cellH * 0.4;
		const x = MARGIN + cell.col * cellW + cellW * 0.5 + jitterX;
		const y = MARGIN + cell.row * cellH + cellH * 0.5 + jitterY;

		shapes.push({
			id: shapes.length,
			x: Math.max(MARGIN, Math.min(100 - MARGIN, x)),
			y: Math.max(MARGIN, Math.min(100 - MARGIN, y)),
			w,
			h,
			color: color(),
			kind,
			rotation,
		});
	}

	// cascade clusters — stacked shapes stepping diagonally
	for (let c = 0; c < CASCADE_COUNT; c++) {
		const cx = MARGIN + Math.random() * (100 - MARGIN * 2);
		const cy = MARGIN + Math.random() * (100 - MARGIN * 2);
		for (let i = 0; i < CASCADE_LENGTH; i++) {
			const kind = pickKind();
			const { w, h, rotation } = mkSize(kind);
			shapes.push({
				id: shapes.length,
				x: Math.max(MARGIN, Math.min(100 - MARGIN, cx + i * 2.2 + (Math.random() - 0.5) * 2)),
				y: Math.max(MARGIN, Math.min(100 - MARGIN, cy + i * 2.8 + (Math.random() - 0.5) * 2)),
				w,
				h,
				color: color(),
				kind,
				rotation,
			});
		}
	}

	return shapes;
}

const GENERATED_SHAPES = generateShapes();

// ─── component ───────────────────────────────────────────────────────────────

export default function IntroMotionGraphcis() {
	let containerRef!: HTMLDivElement;
	let vid1Ref!: HTMLDivElement;
	let vid2Ref!: HTMLDivElement;
	const [alive, setAlive] = createSignal(true);

	onMount(() => {
		const sqs = containerRef.querySelectorAll(".sq");
		const lines = containerRef.querySelectorAll('[data-kind="line"]');
		const crosses = containerRef.querySelectorAll('[data-kind="cross"]');
		const outlined = containerRef.querySelectorAll('[data-kind="outlined"]');

		const tl = gsap.timeline({
			onComplete: () => {
				tl.kill();
				setAlive(false);
			},
		});

		// shapes snap in cluster-by-cluster
		tl.to(
			sqs,
			{
				scale: 1,
				duration: 0.06,
				stagger: { each: 0.055, from: "start" },
				ease: "steps(1)",
			},
			0.3,
		);

		// videos grow in organically at the same time
		tl.to(
			[vid1Ref, vid2Ref],
			{
				scale: 1,
				duration: 0.45,
				stagger: 0.12,
				ease: "back.out(1.4)",
			},
			0.3,
		);

		// hold — with micro-animations for specific shape kinds
		const holdLabel = "hold";
		tl.addLabel(holdLabel);
		tl.to({}, { duration: 0.5 }, holdLabel);

		if (lines.length > 0) {
			tl.to(lines, {
				rotation: "+=random(-10, 10)",
				duration: 0.15,
				stagger: { each: 0.03, from: "random" },
				yoyo: true,
				repeat: 2,
				ease: "power1.inOut",
			}, holdLabel);
		}

		if (crosses.length > 0) {
			tl.to(crosses, {
				rotation: "+=90",
				duration: 0.3,
				stagger: { each: 0.05, from: "random" },
				ease: "power2.inOut",
			}, holdLabel);
		}

		if (outlined.length > 0) {
			tl.to(outlined, {
				keyframes: [
					{ borderWidth: "4px", duration: 0.12 },
					{ borderWidth: "2px", duration: 0.12 },
				],
				stagger: { each: 0.04, from: "random" },
			}, holdLabel);
		}

		// videos vanish instantly
		tl.set([vid1Ref, vid2Ref], { opacity: 0 });

		// shapes blink out
		tl.to(sqs, {
			keyframes: [
				{ opacity: 0, duration: 0.05 },
				{ opacity: 1, duration: 0.05 },
				{ opacity: 0, duration: 0.05 },
				{ opacity: 1, duration: 0.05 },
				{ opacity: 0, scale: 0, duration: 0.1 },
			],
			stagger: { each: 0.01, from: "random" },
		});
	});

	return (
		<Show when={alive()}>
			<DitheredVideo
				webm={liquidVideo_webm}
				mp4={liquidVideo_mp4}
				dither={{ fontSizeRange: 10, overlay: true }}
				onRef={(el) => (vid1Ref = el)}
				style={{
					position: "fixed",
					left: `${videoPlacements[0].x}vw`,
					top: `${videoPlacements[0].y}vh`,
					translate: "-50% -50%",
					transform: "scale(0)",
					"z-index": 10,
                    "mix-blend-mode": "exclusion",
					"pointer-events": "none",
				}}
			/>
			<DitheredVideo
				webm={schizoVideo_webm}
				mp4={schizoVideo_mp4}
				dither={{ chars: "█▓▒░ ", fontSizeRange: [10, 16], overlay: true }}
				onRef={(el) => (vid2Ref = el)}
				style={{
					position: "fixed",
					left: `${videoPlacements[1].x}vw`,
					top: `${videoPlacements[1].y}vh`,
					translate: "-50% -50%",
					transform: "scale(0)",
					"z-index": 10,
					"pointer-events": "none",
                    "mix-blend-mode": "overlay",
				}}
			/>
			<div
				ref={containerRef}
				style={{
					position: "fixed",
					inset: 0,
					"pointer-events": "none",
					overflow: "hidden",
					"z-index": 9,
                    "mix-blend-mode": 'difference',
				}}
			>
				<For each={GENERATED_SHAPES}>
					{(sh) => {
						const base = {
							position: "absolute" as const,
							left: `${sh.x}vw`,
							top: `${sh.y}vh`,
							width: `${sh.w}px`,
							height: `${sh.h}px`,
							"will-change": "transform, opacity",
							translate: "-50% -50%",
							transform: sh.kind === "line" ? `rotate(${sh.rotation ?? 0}deg) scale(0)` : "scale(0)",
						};

						if (sh.kind === "cross") {
							const bar = {
								position: "absolute" as const,
								"background-color": sh.color,
							};
							return (
								<div class="sq" data-kind="cross" style={base}>
									{/* horizontal bar */}
									<div style={{ ...bar, top: "50%", left: "0", width: "100%", height: "3px", translate: "0 -50%" }} />
									{/* vertical bar */}
									<div style={{ ...bar, left: "50%", top: "0", width: "3px", height: "100%", translate: "-50% 0" }} />
								</div>
							);
						}

						const kindStyles = ((): Record<string, string> => {
							switch (sh.kind) {
								case "filled":
									return { "background-color": sh.color, "border-radius": "1px" };
								case "outlined":
									return { border: `2px solid ${sh.color}`, "border-radius": "1px" };
								case "line":
									return { "background-color": sh.color };
								case "circle":
									return { border: `2px solid ${sh.color}`, "border-radius": "50%" };
								case "dot":
									return { "background-color": sh.color, "border-radius": "50%" };
								default:
									return { "background-color": sh.color };
							}
						})();

						return (
							<div
								class="sq"
								data-kind={sh.kind}
								style={{ ...base, ...kindStyles }}
							/>
						);
					}}
				</For>
			</div>
		</Show>
	);
}
