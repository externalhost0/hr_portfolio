import { onMount, createSignal, For } from "solid-js";

const TEXT = "Loading...";

export default function Tickerbar({ id } : { id: string }) {
	const [copies, setCopies] = createSignal(0);

	// used for psuedo text measurement
	function measure() {
		const probe = document.createElement("span");
		probe.className = "text-white text-xl md:text-4xl tracking-widest select-none uppercase font-semibold";
		probe.textContent = TEXT;
		probe.style.visibility = "hidden";
		probe.style.position = "absolute";
		document.body.appendChild(probe);
		const unitWidth = probe.getBoundingClientRect().width;
		document.body.removeChild(probe);
		setCopies(Math.ceil((window.innerWidth * 2) / unitWidth) + 1);
	}

	onMount(() => {
		measure();
        window.dispatchEvent(new CustomEvent("ticker:ready", { detail: { id } }));
	});

	return (
		<div id={`${id}-track`} class="flex items-center whitespace-nowrap py-2">
			<div id={`${id}-track-content`} class="flex items-center ticker-content">
				<For each={Array.from({ length: copies() })}>
					{(_, i) => (
						<>
							<span
								class="text-neutral-100 text-2xl md:text-4xl select-none uppercase font-medium"
								aria-hidden={i() >= Math.floor(copies() / 2) ? "true" : undefined}
							>
								{TEXT}
							</span>
							<div class="inline-block bg-neutral-100 h-10 w-0.5 mx-8"></div>
						</>
					)}
				</For>
			</div>
		</div>
	);
}
