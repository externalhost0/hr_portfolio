import type { Program } from "ts-play-core";
const fireChars = [" ", "░", "▒", "▓", "█"];

// ═══════════════════════════════════════════════════════════════════════════
// 🔧 TUNABLE PARAMETERS
// ═══════════════════════════════════════════════════════════════════════════

// ─── Fire ──────────────────────────────────────────────────────────────────
// Heat injected at the cursor cell each frame (0–255)
const FIRE_CURSOR_HEAT          = 220;
// Extra random heat added on top of cursor heat (0–255)
const FIRE_CURSOR_HEAT_JITTER   = 35;
// Base heat injected into the 8 cells surrounding the cursor (0–255)
const FIRE_NEIGHBOR_HEAT        = 150;
// Random jitter on top of neighbor heat (0–255)
const FIRE_NEIGHBOR_JITTER      = 80;
// How much the cell below contributes upward each step (flame rises). 0–1
const FIRE_RISE_FACTOR          = 0.82;
// Total side-spread weight shared between left and right neighbours. 0–1
const FIRE_SIDE_SPREAD          = 0.18;
// Amplitude of random per-cell turbulence added each frame
const FIRE_TURBULENCE           = 12;
// Base heat decay subtracted every frame
const FIRE_DECAY_BASE           = 1.5;
// Extra random decay on top of base (higher = flames die faster)
const FIRE_DECAY_JITTER         = 6;
// How fast the internal time counter advances each frame (drives all animation)
const TIME_STEP                 = 0.04;

// ─── Wind ─────────────────────────────────────────────────────────────────
// Overall strength of the global wind sway (higher = wider left/right drift)
const WIND_GLOBAL_STRENGTH      = 4.0;
// Speed of the primary slow wind wave
const WIND_SLOW_SPEED           = 1.3;
// Speed of the secondary wind wave (different speed = irregular, organic rhythm)
const WIND_FAST_SPEED           = 0.13;
// Amplitude of the fine-grained per-cell local turbulence wind
const WIND_LOCAL_STRENGTH       = 0.35;

// ─── Sparks ───────────────────────────────────────────────────────────────
// Minimum frames between spark bursts
const SPARK_INTERVAL_BASE       = 40;
// Maximum extra random frames added on top of base (larger = more sporadic)
const SPARK_INTERVAL_JITTER     = 60;
// Minimum distance (cells) from the cursor that sparks can spawn
const SPARK_SPAWN_RADIUS        = 2.5;
// Additional random distance on top of the minimum spawn radius
const SPARK_SPAWN_RADIUS_JITTER = 1.5;
// Maximum sparks emitted per burst (actual count is random 1–this)
const SPARK_BURST_MAX           = 3;
// Sparks launch slightly upward before gravity takes over — these set the range
const SPARK_RISE_MIN            = 0.1;
const SPARK_RISE_MAX            = 0.4;
// Horizontal launch scatter (higher = sparks fly wider)
const SPARK_SCATTER             = 0.6;
// Gravity applied to spark vertical velocity each frame
const SPARK_GRAVITY             = 0.08;
// Random sideways wobble applied to sparks each frame
const SPARK_WOBBLE              = 0.05;
// Fade rate range — each spark picks a random value in this range
const SPARK_DECAY_MIN           = 0.015;
const SPARK_DECAY_MAX           = 0.040;
// Heat scorched onto the grid as a spark passes through (scales with spark life)
const SPARK_SCORCH_HEAT         = 80;

// ═══════════════════════════════════════════════════════════════════════════

// state arrays
let heat: number[] = [];
let t = 0;

interface Spark {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;   // 0–1, decreases over time
    decay: number;  // how fast it fades
}

let sparks: Spark[] = [];
let sparkCooldown = Math.floor(Math.random() * SPARK_INTERVAL_BASE);

export default {
    settings: {},
    pre(context, cursor, buffer) {
        const size = buffer.length;
        const cols = context.cols;
        const rows = context.rows;

        if (heat.length !== size) heat = new Array(size).fill(0);

        t += TIME_STEP;

        //
        // 🔥 1. Inject heat at cursor
        //
        if (cursor.inBounds) {
            const cx = Math.floor(cursor.x);
            const cy = Math.floor(cursor.y);
            const idx = cx + cy * cols;

            heat[idx] = FIRE_CURSOR_HEAT + Math.random() * FIRE_CURSOR_HEAT_JITTER;

            const around = [
                idx - 1, idx + 1,
                idx - cols, idx + cols,
                idx - cols - 1, idx - cols + 1,
                idx + cols - 1, idx + cols + 1,
            ];
            for (const a of around) {
                if (a >= 0 && a < size)
                    heat[a] = Math.max(heat[a], FIRE_NEIGHBOR_HEAT + Math.random() * FIRE_NEIGHBOR_JITTER);
            }

            //
            // ✨ 2. Emit sparks on irregular intervals
            //
            sparkCooldown--;
            if (sparkCooldown <= 0) {
                const count = 1 + Math.floor(Math.random() * SPARK_BURST_MAX);
                for (let s = 0; s < count; s++) {
                    const angle = Math.random() * Math.PI * 2;
                    const dist  = SPARK_SPAWN_RADIUS + Math.random() * SPARK_SPAWN_RADIUS_JITTER;
                    sparks.push({
                        x:     cx + Math.cos(angle) * dist,
                        y:     cy + Math.sin(angle) * dist,
                        vx:    (Math.random() - 0.5) * SPARK_SCATTER,
                        vy:    -(SPARK_RISE_MIN + Math.random() * (SPARK_RISE_MAX - SPARK_RISE_MIN)),
                        life:  1.0,
                        decay: SPARK_DECAY_MIN + Math.random() * (SPARK_DECAY_MAX - SPARK_DECAY_MIN),
                    });
                }
                sparkCooldown = SPARK_INTERVAL_BASE + Math.floor(Math.random() * SPARK_INTERVAL_JITTER);
            }
        }

        //
        // 🔥 3. Fire simulation
        //
        const globalWind =
            Math.sin(t * WIND_SLOW_SPEED) * 0.6 * WIND_GLOBAL_STRENGTH +
            Math.sin(t * WIND_FAST_SPEED) * 0.4 * WIND_GLOBAL_STRENGTH;

        const newHeat = new Array(size).fill(0);
        for (let i = 0; i < size; i++) {
            const x     = i % cols;
            const y     = (i / cols) | 0;
            const below = i + cols;
            const left  = x > 0        ? i - 1 : -1;
            const right = x < cols - 1 ? i + 1 : -1;

            const hb = below < size ? heat[below] : 0;
            const hl = left  >= 0   ? heat[left]  : 0;
            const hr = right >= 0   ? heat[right] : 0;

            const localWind =
                Math.sin((x * 0.15) + (t * 1.3)) * 0.2 * WIND_LOCAL_STRENGTH +
                Math.cos((y * 0.1)  - (t * 0.9)) * 0.15 * WIND_LOCAL_STRENGTH;

            const wind     = globalWind + localWind;
            const windBias = Math.max(-1, Math.min(1, wind)) * 0.5;
            const wl       = FIRE_SIDE_SPREAD * (0.5 + windBias);
            const wr       = FIRE_SIDE_SPREAD * (0.5 - windBias);

            let n =
                hb * FIRE_RISE_FACTOR +
                hl * wl + hr * wr +
                (Math.random() - 0.5) * FIRE_TURBULENCE;

            n -= FIRE_DECAY_BASE + Math.random() * FIRE_DECAY_JITTER;
            newHeat[i] = Math.max(0, Math.min(255, n));
        }
        heat = newHeat;

        //
        // ✨ 4. Update sparks
        //
        for (const sp of sparks) {
            sp.vy += SPARK_GRAVITY;
            sp.vx += (Math.random() - 0.5) * SPARK_WOBBLE;
            sp.x  += sp.vx;
            sp.y  += sp.vy;
            sp.life -= sp.decay;

            const sx = Math.round(sp.x);
            const sy = Math.round(sp.y);
            if (sx >= 0 && sx < cols && sy >= 0 && sy < rows) {
                const si = sx + sy * cols;
                heat[si] = Math.max(heat[si], sp.life * SPARK_SCORCH_HEAT);
            }
        }

        sparks = sparks.filter(sp =>
            sp.life > 0 &&
            sp.x >= 0 && sp.x < cols &&
            sp.y >= 0 && sp.y < rows
        );
    },

    main(coord, ctx, cursor, buffer) {
        const cx = coord.x;
        const cy = coord.y;

        for (const sp of sparks) {
            if (Math.round(sp.x) === cx && Math.round(sp.y) === cy) {
                if (sp.life > 0.7) return "★";
                if (sp.life > 0.4) return "✦";
                return "·";
            }
        }

        const h = heat[coord.index];
        return fireChars[Math.floor((h / 255) * (fireChars.length - 1))];
    },
} satisfies Program;