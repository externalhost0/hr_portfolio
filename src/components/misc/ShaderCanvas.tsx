import { onMount, onCleanup, createEffect, createSignal } from "solid-js";

interface Props {
	class?: string;
	frag: string;
}

export default function ShaderCanvas(props: Props) {
	let canvas: HTMLCanvasElement | undefined;
	let gl: WebGLRenderingContext | null = null;
	let tLoc: WebGLUniformLocation | null = null;

	const [time, setTime] = createSignal(0);
	let raf = 0;

	const vert = `
    attribute vec2 p;
    void main() { gl_Position = vec4(p, 0, 1); }
  `;

	onMount(() => {
		if (!canvas) return;
		gl = canvas.getContext("webgl");
		if (!gl) return;

		const compile = (type: number, src: string) => {
			const s = gl!.createShader(type)!;
			gl!.shaderSource(s, src);
			gl!.compileShader(s);
			return s;
		};

		const prog = gl.createProgram()!;
		gl.attachShader(prog, compile(gl.VERTEX_SHADER, vert));
		gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, props.frag));
		gl.linkProgram(prog);
		gl.useProgram(prog);

		const buf = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.bufferData(
			gl.ARRAY_BUFFER,
			new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
			gl.STATIC_DRAW,
		);

		const loc = gl.getAttribLocation(prog, "p");
		gl.enableVertexAttribArray(loc);
		gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

		tLoc = gl.getUniformLocation(prog, "t");
		const rLoc = gl.getUniformLocation(prog, "res");

		const rect = canvas.getBoundingClientRect();
		canvas.width = rect.width * devicePixelRatio;
		canvas.height = rect.height * devicePixelRatio;
		gl.viewport(0, 0, canvas.width, canvas.height);
		gl.uniform2f(rLoc, canvas.width, canvas.height);

		const loop = (t: number) => {
			setTime(t * 0.001);
			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);

		onCleanup(() => {
			cancelAnimationFrame(raf);
			gl = null;
		});
	});

	createEffect(() => {
		if (!gl || tLoc === null) return;
		gl.uniform1f(tLoc, time());
		gl.drawArrays(gl.TRIANGLES, 0, 6);
	});

	return (
        <div class={props.class}>
            <canvas ref={canvas} style={{ display: "block", width: "100%", height: "100%" }} />
        </div>
    )
}
