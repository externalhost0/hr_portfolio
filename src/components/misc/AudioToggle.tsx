import { createSignal, createMemo, onMount, onCleanup } from "solid-js";
import styles from "./AudioToggle.module.css";
import gsap from "gsap";

export default function AudioToggle() {
	const [audioOn, setAudioOn] = createSignal(false);
	const [amplitude, setAmplitude] = createSignal(0);
	const [time, setTime] = createSignal(0);

	let rafId: number;
	let ampTween: gsap.core.Tween | null = null;

	const pathData = createMemo(() => {
		const scale = 2.6;
		const step = 0.1;
		const points: string[] = [];
		const effectiveAmplitude = amplitude() + 0.1;

		for (let x = -10; x <= 10; x += step) {
			const y = effectiveAmplitude * Math.sin(x * 0.5 + time() * 3);
			points.push(`${(x * scale).toFixed(2)},${(-y * scale).toFixed(2)}`);
		}

		return `M ${points.join(" L ")}`;
	});

	const animate = (timestamp: number) => {
		setTime(timestamp / 1000);
		rafId = requestAnimationFrame(animate);
	};

	onMount(() => {
		rafId = requestAnimationFrame(animate);
	});

	onCleanup(() => {
		cancelAnimationFrame(rafId);
		ampTween?.kill();
	});

	const toggle = () => {
		const next = !audioOn();
		setAudioOn(next);

		window.dispatchEvent(new CustomEvent("audio:toggle", { detail: next }));

		ampTween?.kill();
		ampTween = gsap.to(
			{ val: amplitude() },
			{
				val: next ? 1.0 : 0,
				duration: 0.5,
				ease: "power1.inOut",
				onUpdate() {
					setAmplitude(this.targets()[0].val);
				},
			},
		);
	};

	return (
		<svg
			width="60"
			height="20"
			viewBox="-30 -10 60 20"
			fill="none"
			class={`${styles.svg}${audioOn() ? ` ${styles.on}` : ""}`}
			onClick={toggle}
			style={{ cursor: "pointer" }}
		>
			<path d={pathData()} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
		</svg>
	);
}
