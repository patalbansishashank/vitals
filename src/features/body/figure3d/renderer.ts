// Tiny in-house WebGL2 renderer for the figure (R2 sec. 5.2): one mesh, orthographic front + side views side by side
// in one canvas sharing one cm scale, matte "clay" flat shading (face normals from screen-space derivatives, so no
// normal attribute is needed for shading), an inverted-hull outline, an optional translucent fat envelope over an
// opaque lean core, and a flat ghost of the start body. No three.js, no WebAssembly, no eval (CSP script-src 'self').

export type FigureView = 'front' | 'side';

export interface FigureColours {
  /** Envelope / single-layer clay. */
  body: [number, number, number];
  /** Lean core (two-layer mode). */
  core: [number, number, number];
  outline: [number, number, number];
  ghost: [number, number, number];
}

export interface FigureFrame {
  /** Interleaved xyz positions (cm, y up, z front), already scaled to stature and placed with the floor at y = 0. */
  positions: Float32Array;
  /** Optional lean core (two-layer mode): drawn opaque, the envelope then drawn translucent over it. */
  core?: Float32Array | null;
  /** Optional ghost (start state), drawn flat behind the figure. */
  ghost?: Float32Array | null;
  views: readonly FigureView[];
  /** Stage height in cm (shared vertical extent of every view). */
  stageCm: number;
  /** Horizontal centre (x for front, z for side) per view, cm. */
  centre: Partial<Record<FigureView, number>>;
  /**
   * Pixel layout shared with an SVG overlay (ruler, labels, handles): CSS px of the canvas box, `k` px per cm, the
   * floor line and each view's centre line. The view's `centre` (cm) lands on `x[view]`. Without it the views split
   * the canvas evenly and the stage height fills it.
   */
  layout?: FigureLayout | null;
  colours: FigureColours;
  /** Envelope alpha in two-layer mode. */
  envelopeAlpha?: number;
  outlinePx?: number;
}

export interface FigureLayout {
  width: number;
  height: number;
  k: number;
  floorY: number;
  x: Partial<Record<FigureView, number>>;
}

const VS = `#version 300 es
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_nrm;
uniform mat4 u_mvp;
uniform mat3 u_rot;
uniform float u_push;      // outline width in clip units (0 for the body)
uniform vec2 u_px;         // clip units per pixel (x, y)
out vec3 v_view;
void main() {
  vec4 clip = u_mvp * vec4(a_pos, 1.0);
  if (u_push > 0.0) {
    vec3 n = u_rot * a_nrm;
    vec2 d = normalize(n.xy + vec2(1e-6));
    clip.xy += d * u_push * u_px * clip.w;
  }
  v_view = u_rot * a_pos;
  gl_Position = clip;
}`;

const FS = `#version 300 es
precision highp float;
in vec3 v_view;
uniform vec3 u_colour;
uniform float u_alpha;
uniform int u_flat;        // 1 = unlit colour (outline, ghost)
out vec4 o_colour;
void main() {
  if (u_flat == 1) { o_colour = vec4(u_colour, u_alpha); return; }
  vec3 n = normalize(cross(dFdx(v_view), dFdy(v_view)));
  if (n.z < 0.0) n = -n;
  vec3 key = normalize(vec3(-0.45, 0.6, 0.65));
  float diffuse = max(dot(n, key), 0.0);
  float hemi = 0.5 + 0.5 * n.y;
  float light = 0.52 + 0.38 * diffuse + 0.12 * hemi;
  float rim = pow(1.0 - abs(n.z), 3.0) * 0.12;
  o_colour = vec4(u_colour * light + rim, u_alpha);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`figure shader: ${gl.getShaderInfoLog(s) ?? ''}`);
  return s;
}

/** Area-weighted smooth vertex normals (for the outline offset only). */
export function vertexNormals(P: Float32Array, idx: Uint16Array, out: Float32Array = new Float32Array(P.length)): Float32Array {
  out.fill(0);
  for (let f = 0; f < idx.length; f += 3) {
    const a = 3 * idx[f]!, b = 3 * idx[f + 1]!, c = 3 * idx[f + 2]!;
    const ux = P[b]! - P[a]!, uy = P[b + 1]! - P[a + 1]!, uz = P[b + 2]! - P[a + 2]!;
    const wx = P[c]! - P[a]!, wy = P[c + 1]! - P[a + 1]!, wz = P[c + 2]! - P[a + 2]!;
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    for (const v of [a, b, c]) {
      out[v] = out[v]! + nx;
      out[v + 1] = out[v + 1]! + ny;
      out[v + 2] = out[v + 2]! + nz;
    }
  }
  for (let v = 0; v < out.length; v += 3) {
    const l = Math.hypot(out[v]!, out[v + 1]!, out[v + 2]!) || 1;
    out[v] = out[v]! / l;
    out[v + 1] = out[v + 1]! / l;
    out[v + 2] = out[v + 2]! / l;
  }
  return out;
}

interface MeshBuffers {
  vao: WebGLVertexArrayObject;
  pos: WebGLBuffer;
  nrm: WebGLBuffer;
  normals: Float32Array;
}

export class FigureRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly prog: WebGLProgram;
  private readonly ibo: WebGLBuffer;
  private readonly count: number;
  private readonly meshes: MeshBuffers[] = [];
  private readonly u: Record<'mvp' | 'rot' | 'push' | 'px' | 'colour' | 'alpha' | 'flat', WebGLUniformLocation | null>;
  lost = false;

  /** Throws if WebGL2 is unavailable (callers fall back to the SVG figure). */
  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly indices: Uint16Array,
    vertexCount: number,
  ) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`figure program: ${gl.getProgramInfoLog(prog) ?? ''}`);
    this.prog = prog;
    const loc = (n: string) => gl.getUniformLocation(prog, n);
    this.u = { mvp: loc('u_mvp'), rot: loc('u_rot'), push: loc('u_push'), px: loc('u_px'), colour: loc('u_colour'), alpha: loc('u_alpha'), flat: loc('u_flat') };
    this.ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    this.count = indices.length;
    // three mesh slots: envelope, core, ghost
    for (let i = 0; i < 3; i++) {
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      const pos = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, pos);
      gl.bufferData(gl.ARRAY_BUFFER, vertexCount * 12, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      const nrm = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, nrm);
      gl.bufferData(gl.ARRAY_BUFFER, vertexCount * 12, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      this.meshes.push({ vao, pos, nrm, normals: new Float32Array(vertexCount * 3) });
    }
    gl.bindVertexArray(null);
    canvas.addEventListener('webglcontextlost', this.onLost);
  }

  private onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
  };

  private upload(slot: number, P: Float32Array): void {
    const gl = this.gl;
    const m = this.meshes[slot]!;
    vertexNormals(P, this.indices, m.normals);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.pos);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, P as Float32Array<ArrayBuffer>);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.nrm);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, m.normals as Float32Array<ArrayBuffer>);
  }

  draw(frame: FigureFrame): void {
    if (this.lost) return;
    const gl = this.gl;
    const W = this.canvas.width, H = this.canvas.height;
    this.upload(0, frame.positions);
    if (frame.core) this.upload(1, frame.core);
    if (frame.ghost) this.upload(2, frame.ghost);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const nViews = frame.views.length;
    const vw = Math.floor(W / nViews);
    // shared scale: stage height fills the canvas; cm per px identical in every view
    const cmPerPx = frame.stageCm / H;
    const halfW = (vw * cmPerPx) / 2;
    const dpr = this.canvas.clientWidth > 0 ? W / this.canvas.clientWidth : 1;
    const outlinePx = (frame.outlinePx ?? 1.25) * dpr;
    const L = frame.layout;
    frame.views.forEach((view, i) => {
      gl.clear(gl.DEPTH_BUFFER_BIT);
      const cx = frame.centre[view] ?? 0;
      // rotation: side view looks at the body's right side, front (+z) to screen right
      const rot = view === 'front' ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : [0, 0, -1, 0, 1, 0, 1, 0, 0];
      // clip = (sx * (r.x - cx) + tx, sy * r.y + ty): either the overlay's pixel layout or an even split
      let sx: number, sy: number, tx: number, ty: number, pxW: number;
      const lx = L?.x[view];
      if (L && lx !== undefined && L.width > 0 && L.height > 0) {
        gl.viewport(0, 0, W, H);
        sx = (2 * L.k) / L.width;
        sy = (2 * L.k) / L.height;
        tx = (2 * lx) / L.width - 1;
        ty = 1 - (2 * L.floorY) / L.height;
        pxW = W;
      } else {
        gl.viewport(i * vw, 0, vw, H);
        sx = 1 / halfW;
        sy = 2 / frame.stageCm;
        tx = 0;
        ty = -1;
        pxW = vw;
      }
      const sz = -1 / 200;
      // column-major mvp = ortho * rot
      const mvp = new Float32Array([
        sx * rot[0]!, sy * rot[1]!, sz * rot[2]!, 0,
        sx * rot[3]!, sy * rot[4]!, sz * rot[5]!, 0,
        sx * rot[6]!, sy * rot[7]!, sz * rot[8]!, 0,
        tx - sx * cx, ty, 0, 1,
      ]);
      gl.uniformMatrix4fv(this.u.mvp, false, mvp);
      gl.uniformMatrix3fv(this.u.rot, false, new Float32Array([rot[0]!, rot[1]!, rot[2]!, rot[3]!, rot[4]!, rot[5]!, rot[6]!, rot[7]!, rot[8]!]));
      gl.uniform2f(this.u.px, 2 / pxW, 2 / H);
      const drawMesh = (slot: number, colour: [number, number, number], alpha: number, flat: boolean, push = 0) => {
        gl.bindVertexArray(this.meshes[slot]!.vao);
        gl.uniform3f(this.u.colour, colour[0], colour[1], colour[2]);
        gl.uniform1f(this.u.alpha, alpha);
        gl.uniform1i(this.u.flat, flat ? 1 : 0);
        gl.uniform1f(this.u.push, push);
        gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
      };
      gl.enable(gl.CULL_FACE);
      if (frame.ghost) {
        // flat ghost silhouette behind everything
        gl.depthMask(false);
        gl.cullFace(gl.BACK);
        drawMesh(2, frame.colours.ghost, 0.5, true);
        gl.depthMask(true);
      }
      // outline: back faces pushed outward along the normal
      gl.cullFace(gl.FRONT);
      drawMesh(0, frame.colours.outline, 1, true, outlinePx);
      gl.cullFace(gl.BACK);
      if (frame.core) {
        // core pushed back in depth so the envelope wins where both surfaces coincide (head, hands, feet)
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(2, 4);
        drawMesh(1, frame.colours.core, 1, false);
        gl.disable(gl.POLYGON_OFFSET_FILL);
        // envelope: depth pre-pass so only its nearest surface blends over the core
        gl.colorMask(false, false, false, false);
        drawMesh(0, frame.colours.body, 1, false);
        gl.colorMask(true, true, true, true);
        gl.depthFunc(gl.LEQUAL);
        drawMesh(0, frame.colours.body, frame.envelopeAlpha ?? 0.45, false);
        gl.depthFunc(gl.LESS);
      } else drawMesh(0, frame.colours.body, 1, false);
    });
    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    const gl = this.gl;
    for (const m of this.meshes) {
      gl.deleteBuffer(m.pos);
      gl.deleteBuffer(m.nrm);
      gl.deleteVertexArray(m.vao);
    }
    gl.deleteBuffer(this.ibo);
    gl.deleteProgram(this.prog);
  }
}

/** Resolves a CSS colour (any syntax) to linear-ish 0..1 RGB via a 2D canvas; falls back on parse failure. */
export function cssColour(value: string, fallback: [number, number, number]): [number, number, number] {
  if (typeof document === 'undefined') return fallback;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx || !value.trim()) return fallback;
  ctx.fillStyle = '#000';
  ctx.fillStyle = value.trim();
  const s = String(ctx.fillStyle);
  const hex = /^#([0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const rgb = /rgba?\(([^)]+)\)/.exec(s);
  if (rgb) {
    const [r, g, b] = rgb[1]!.split(/[ ,/]+/).map(Number);
    if ([r, g, b].every((v) => Number.isFinite(v))) return [r! / 255, g! / 255, b! / 255];
  }
  return fallback;
}

let colourMemo: { key: string; colours: FigureColours } | null = null;

/** Avatar colour tokens (light/dark follow the theme scope of `el`); parsed only when the token strings change. */
export function readColours(el: Element): FigureColours {
  const cs = getComputedStyle(el);
  const raw = ['--lm-avatar-fat', '--lm-avatar-lean', '--lm-avatar-outline', '--lm-avatar-ghost'].map((n) => cs.getPropertyValue(n));
  const key = raw.join('|');
  if (colourMemo?.key === key) return colourMemo.colours;
  const colours: FigureColours = {
    body: cssColour(raw[0]!, [0.82, 0.85, 0.89]),
    core: cssColour(raw[1]!, [0.45, 0.53, 0.65]),
    outline: cssColour(raw[2]!, [0.2, 0.24, 0.3]),
    ghost: cssColour(raw[3]!, [0.51, 0.53, 0.55]),
  };
  colourMemo = { key, colours };
  return colours;
}
