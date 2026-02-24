import type { Program } from "ts-play-core";

const dot = "█";


export default {
    settings: {},

    pre(context, cursor, buffer) {
        if (!cursor.inBounds) return ' '; 
        // Clear whole buffer extremely cheaply
        for (let i = 0; i < buffer.length; i++) buffer[i].char = 0;

        // Mark cursor position as “active”
        const x = Math.floor(cursor.x);
        const y = Math.floor(cursor.y);
        const idx = x + y * context.cols;
        if (buffer[idx]) buffer[idx].char = 1;
    },

    main(coord, context, cursor, buffer) {
        if (!cursor.inBounds) return dot;
        return buffer[coord.index].char == 0 ? dot : " ";
    },

} satisfies Program;
