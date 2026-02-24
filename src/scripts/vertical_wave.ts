/**
 * @author Raurir
 * @title  Vertical Wave Shader (Abstracted)
 * @desc   Fully configurable vertical stacked sine waves using a single intensity parameter
 */

import type { Program } from "ts-play-core";

const chars: string[] = "█▓▒░ ".split('');

export const WaveConfig = {
    speed: 0.01,        // animation speed
    baseOffset: 35, // vertical starting offset
    detail: 5       // single number controlling amplitudes, layers, frequency
}

export default {
    settings: {},

    main(coord, context, cursor, buffer, userVars) {

        const t = context.time * WaveConfig.speed;
        const x = coord.x;
        const y = 1.0 - coord.y;

        const layers = Math.max(1, Math.floor(WaveConfig.detail)); // number of stacked waves
        let v = WaveConfig.baseOffset;

        for (let i = 0; i < layers; i++) {
            // Automatically generate amplitude and frequency from layer index and detail
            const amplitude = (Math.sin(i * 1.3) + 1) * (WaveConfig.detail / 2);
            const freq = 0.1 + 0.05 * i;
            v += wave(t, x, freq, amplitude);
        }

        // Map the y-coordinate to a character
        const ratio = (y / context.rows) * chars.length;
        const index = Math.min(chars.length - 1, Math.floor(ratio + (v / context.rows) * chars.length));

        return chars[index];
    },
} satisfies Program;

function wave(t: number, val: number, freq: number, amp: number) {
    return (Math.sin(t + val * freq) + 1) * amp;
}
