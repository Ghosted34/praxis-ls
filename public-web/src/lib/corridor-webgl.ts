import { laneControl, type CorridorGraph } from "./corridor-graph";

/**
 * The corridor scene's WebGL layer — the deferred, capability-gated
 * enhancement (§7.5).
 *
 * ── THIS MODULE IS NEVER ON THE FIRST-PAINT PATH ──────────────────────────
 *
 * It is reached only through a dynamic `import()` in `corridor-scene.tsx`, and
 * only after that component's gate has decided the device can afford it. Rollup
 * therefore emits it as its own chunk, which is the whole point: a visitor on a
 * metered connection never fetches a byte of it.
 *
 * ── WHY THERE IS NO THREE.JS ───────────────────────────────────────────────
 *
 * §5.6 gives the homepage's deferred chunks a combined budget of 220 kB gzip.
 * Three.js core is roughly 170 kB of that on its own, before a single line of
 * scene code, for a scene that draws lines and points and needs neither a
 * material system, a scene graph, a loader stack nor a physics-adjacent maths
 * library. Hand-written WebGL for this is about six kilobytes and does exactly
 * what the scene needs. The budget is what makes that the obvious answer rather
 * than a purist one.
 *
 * ── WHAT IT ADDS OVER THE BASELINE ─────────────────────────────────────────
 *
 * Depth that an SVG cannot do: the network is rendered in real perspective, so
 * moving the pointer (or tilting a phone) moves THROUGH it rather than sliding
 * layers past each other. Lanes carry travelling cargo as GL points, and the
 * whole scene is lit from the same top-left source the rest of the site states.
 *
 * ── EVERY FAILURE PATH ENDS IN "DO NOTHING" ────────────────────────────────
 *
 * No context, a driver that will not compile a shader, a lost context mid-life:
 * each returns or tears down, and the baseline SVG underneath is already the
 * finished scene. There is no error state to show because nothing is broken —
 * §7.5's "fails to the baseline silently".
 */

const VERT = `
attribute vec3 aPos;
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
uniform mat4 uProj;
uniform vec2 uLook;
varying vec3 vColor;
varying float vAlpha;
void main() {
  // The look vector orbits the network rather than sliding it: a small rotation
  // about Y and X, which is what makes the movement read as parallax through a
  // volume instead of a layer sliding.
  float cy = cos(uLook.x), sy = sin(uLook.x);
  float cx = cos(uLook.y), sx = sin(uLook.y);
  vec3 p = aPos;
  p = vec3(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy);
  p = vec3(p.x, p.y * cx - p.z * sx, p.y * sx + p.z * cx);
  p.z -= 3.2;
  gl_Position = uProj * vec4(p, 1.0);
  // Nearer marks are larger. Divided by -z so the falloff is the projection's
  // own, which keeps points consistent with the lines they sit on.
  gl_PointSize = aSize / max(-p.z, 0.1) * 60.0;
  vColor = aColor;
  vAlpha = aAlpha;
}`;

const FRAG = `
precision mediump float;
varying vec3 vColor;
varying float vAlpha;
void main() {
  // A soft round mark. gl_PointCoord is only meaningful for POINTS; for LINES
  // it is undefined, so the falloff is clamped to 1.0 there and the line keeps
  // its own alpha.
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d);
  float soft = gl_PointCoord == vec2(0.0) ? 1.0 : smoothstep(0.5, 0.12, r);
  gl_FragColor = vec4(vColor, vAlpha * soft);
}`;

type Attr = { pos: number[]; color: number[]; size: number[]; alpha: number[] };

const push = (a: Attr, p: number[], c: number[], size: number, alpha: number) => {
  a.pos.push(p[0], p[1], p[2]);
  a.color.push(c[0], c[1], c[2]);
  a.size.push(size);
  a.alpha.push(alpha);
};

/** `--mode-sea` etc. arrive as "40 148 94". GL wants 0…1. */
function readToken(el: HTMLElement, token: string, fallback: number[]): number[] {
  const raw = getComputedStyle(el).getPropertyValue(token).trim();
  const parts = raw.split(/[\s,]+/).map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return fallback;
  return [parts[0] / 255, parts[1] / 255, parts[2] / 255];
}

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  // A driver that refuses this is not an error to report — it is a device that
  // gets the baseline, which is already on screen.
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

/**
 * Mount the layer over `host`. Returns a teardown, or null when the device
 * turned out not to be able to run it after all.
 *
 * The caller has already applied §7.5's capability gate. Everything checked
 * here is about whether the machinery actually works on this machine, which is
 * a different question and cannot be asked without trying.
 */
export function mountCorridorWebgl(
  host: HTMLElement,
  graph: CorridorGraph,
): (() => void) | null {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  // The baseline SVG stays in the accessibility tree and in the tab order; this
  // is paint over the top of it. Pointer events belong to the SVG underneath,
  // which is what carries the focusable nodes.
  canvas.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";

  const gl =
    (canvas.getContext("webgl", { alpha: true, antialias: true, powerPreference: "low-power" }) as
      | WebGLRenderingContext
      | null) || null;
  if (!gl) return null;

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  const prog = vs && fs ? gl.createProgram() : null;
  if (!vs || !fs || !prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;

  host.appendChild(canvas);

  const MODES: Record<string, string> = {
    SEA: "--mode-sea",
    AIR: "--mode-air",
    LAND: "--mode-road",
    OTHER: "",
  };
  const accent = readToken(host, "--brand-orange", [1, 0.35, 0]);
  const muted = [0.62, 0.64, 0.65];

  /* ── the static geometry: the ring, the lanes, the places ────────────────
   *
   * Built once. The only thing that changes per frame is the look vector and
   * the cargo, so the lane and node buffers are uploaded a single time and the
   * per-frame cost is one small buffer update and three draw calls.
   *
   * `z` spreads the network into a shallow slab rather than a plane. Without it
   * the perspective has nothing to work on and the result is an SVG that costs
   * a GPU context.
   */
  const lines: Attr = { pos: [], color: [], size: [], alpha: [] };
  const dots: Attr = { pos: [], color: [], size: [], alpha: [] };

  const zOf = (i: number) => Math.sin(i * 1.7) * 0.22;

  for (const lane of graph.lanes) {
    const a = graph.nodes[lane.from];
    const b = graph.nodes[lane.to];
    if (!a || !b || a === b) continue;
    const token = MODES[lane.mode] || "";
    const color = token ? readToken(host, token, muted) : muted;
    const c = laneControl(a, b);
    const za = zOf(lane.from);
    const zb = zOf(lane.to);
    // The curve as a short line strip. Sixteen segments is past the point where
    // another one is visible at this scale, and every segment is two vertices.
    const SEG = 16;
    let prev: number[] | null = null;
    for (let s = 0; s <= SEG; s++) {
      const t = s / SEG;
      const u = 1 - t;
      const x = u * u * a.x + 2 * u * t * c.x + t * t * b.x;
      const y = u * u * a.y + 2 * u * t * c.y + t * t * b.y;
      const z = u * za + t * zb;
      const p = [x, -y, z];
      if (prev) {
        push(lines, prev, color, 1, 0.18 + lane.strength * 0.32);
        push(lines, p, color, 1, 0.18 + lane.strength * 0.32);
      }
      prev = p;
    }
  }

  graph.nodes.forEach((n, i) => {
    push(dots, [n.x, -n.y, zOf(i)], accent, 0.06 + Math.min(n.weight / 400, 0.05), 0.95);
  });

  const buffers = {
    linePos: gl.createBuffer(),
    lineColor: gl.createBuffer(),
    lineSize: gl.createBuffer(),
    lineAlpha: gl.createBuffer(),
    dotPos: gl.createBuffer(),
    dotColor: gl.createBuffer(),
    dotSize: gl.createBuffer(),
    dotAlpha: gl.createBuffer(),
    cargoPos: gl.createBuffer(),
    cargoColor: gl.createBuffer(),
    cargoSize: gl.createBuffer(),
    cargoAlpha: gl.createBuffer(),
  };

  const aPos = gl.getAttribLocation(prog, "aPos");
  const aColor = gl.getAttribLocation(prog, "aColor");
  const aSize = gl.getAttribLocation(prog, "aSize");
  const aAlpha = gl.getAttribLocation(prog, "aAlpha");
  const uProj = gl.getUniformLocation(prog, "uProj");
  const uLook = gl.getUniformLocation(prog, "uLook");

  const upload = (buf: WebGLBuffer | null, data: number[], dynamic = false) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array(data),
      dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW,
    );
  };
  const bind = (buf: WebGLBuffer | null, loc: number, size: number) => {
    if (loc < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  };

  upload(buffers.linePos, lines.pos);
  upload(buffers.lineColor, lines.color);
  upload(buffers.lineSize, lines.size);
  upload(buffers.lineAlpha, lines.alpha);
  upload(buffers.dotPos, dots.pos);
  upload(buffers.dotColor, dots.color);
  upload(buffers.dotSize, dots.size);
  upload(buffers.dotAlpha, dots.alpha);

  /* ── cargo, the only thing rebuilt per frame ─────────────────────────────── */
  const CARGO_PER_LANE = 2;
  const cargoColor: number[] = [];
  const cargoSize: number[] = [];
  const cargoAlpha: number[] = [];
  const cargoLanes: Array<{ a: number; b: number; phase: number; speed: number }> = [];
  graph.lanes.forEach((lane, i) => {
    if (lane.from === lane.to) return;
    const token = MODES[lane.mode] || "";
    const color = token ? readToken(host, token, muted) : muted;
    for (let c = 0; c < CARGO_PER_LANE; c++) {
      cargoLanes.push({
        a: lane.from,
        b: lane.to,
        phase: c / CARGO_PER_LANE + i * 0.13,
        speed: 0.05 + lane.strength * 0.05,
      });
      cargoColor.push(color[0], color[1], color[2]);
      cargoSize.push(0.05);
      cargoAlpha.push(0.9);
    }
  });
  upload(buffers.cargoColor, cargoColor);
  upload(buffers.cargoSize, cargoSize);
  upload(buffers.cargoAlpha, cargoAlpha);
  const cargoPos = new Array(cargoLanes.length * 3).fill(0);

  let dpr = 1;
  const resize = () => {
    const rect = host.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(Math.round(rect.width * dpr), 1);
    canvas.height = Math.max(Math.round(rect.height * dpr), 1);
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  resize();

  /** A plain perspective matrix. One projection, no library. */
  const projection = (aspect: number) => {
    const f = 1 / Math.tan(0.62 / 2);
    const near = 0.1;
    const far = 20;
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) / (near - far), -1,
      0, 0, (2 * far * near) / (near - far), 0,
    ]);
  };

  let raf = 0;
  let last = 0;
  let clock = 0;
  let lost = false;

  const onLost = (e: Event) => {
    // A lost context is a normal event on a laptop that sleeps. Stop cleanly
    // and leave the baseline showing rather than trying to restore a
    // decoration.
    e.preventDefault();
    lost = true;
    if (raf) cancelAnimationFrame(raf);
    canvas.remove();
  };
  canvas.addEventListener("webglcontextlost", onLost);

  const frame = (now: number) => {
    if (lost) return;
    clock += Math.min((now - last) / 1000, 0.1);
    last = now;

    // The look vector comes from the SAME `--lx`/`--ly` the rest of the site
    // uses, read off the host that `usePointerLight` and `useTilt` write to.
    // One contract: a cursor on a laptop, a gyroscope on a phone, and this
    // module does not know or care which.
    const cs = getComputedStyle(host);
    const lx = Number(cs.getPropertyValue("--lx")) || 0.5;
    const ly = Number(cs.getPropertyValue("--ly")) || 0.5;

    for (let i = 0; i < cargoLanes.length; i++) {
      const c = cargoLanes[i];
      const a = graph.nodes[c.a];
      const b = graph.nodes[c.b];
      if (!a || !b) continue;
      const ctrl = laneControl(a, b);
      const t = ((clock * c.speed + c.phase) % 1 + 1) % 1;
      const u = 1 - t;
      cargoPos[i * 3] = u * u * a.x + 2 * u * t * ctrl.x + t * t * b.x;
      cargoPos[i * 3 + 1] = -(u * u * a.y + 2 * u * t * ctrl.y + t * t * b.y);
      cargoPos[i * 3 + 2] = u * zOf(c.a) + t * zOf(c.b);
    }
    upload(buffers.cargoPos, cargoPos, true);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(prog);
    gl.uniformMatrix4fv(uProj, false, projection(canvas.width / Math.max(canvas.height, 1)));
    // ±0.35 rad. Enough to feel like moving through the network, little enough
    // that the composition never turns edge-on and loses its shape.
    gl.uniform2f(uLook, (lx - 0.5) * 0.7, (ly - 0.5) * 0.45);

    bind(buffers.linePos, aPos, 3);
    bind(buffers.lineColor, aColor, 3);
    bind(buffers.lineSize, aSize, 1);
    bind(buffers.lineAlpha, aAlpha, 1);
    gl.drawArrays(gl.LINES, 0, lines.size.length);

    bind(buffers.dotPos, aPos, 3);
    bind(buffers.dotColor, aColor, 3);
    bind(buffers.dotSize, aSize, 1);
    bind(buffers.dotAlpha, aAlpha, 1);
    gl.drawArrays(gl.POINTS, 0, dots.size.length);

    bind(buffers.cargoPos, aPos, 3);
    bind(buffers.cargoColor, aColor, 3);
    bind(buffers.cargoSize, aSize, 1);
    bind(buffers.cargoAlpha, aAlpha, 1);
    gl.drawArrays(gl.POINTS, 0, cargoSize.length);

    raf = requestAnimationFrame(frame);
  };

  const onResize = () => resize();
  window.addEventListener("resize", onResize, { passive: true });

  // The SVG underneath is the scene until this paints its first frame, so there
  // is never a blank moment to cover.
  host.classList.add("has-gl");
  last = performance.now();
  raf = requestAnimationFrame(frame);

  return () => {
    if (raf) cancelAnimationFrame(raf);
    canvas.removeEventListener("webglcontextlost", onLost);
    window.removeEventListener("resize", onResize);
    host.classList.remove("has-gl");
    canvas.remove();
    // Release the context rather than waiting for GC: a page that mounts and
    // unmounts this a few times would otherwise hold several live contexts, and
    // browsers cap how many exist at once.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };
}
