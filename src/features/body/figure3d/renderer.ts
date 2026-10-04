// Compact WebGL2 figure renderer. Morphed skin surfaces and a static anatomical asset share an orthographic stage.
// Smooth vertex normals give matte lighting; camera turns only change uniforms. No external rendering dependency.

import type { BodyComposition } from './composition';

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
  /** Camera turn in radians; a front view starts at zero. */
  angleRad?: number;
  /** Increment when a reused position buffer has new morph data. */
  geometryRevision?: number;
  anatomy?: {
    composition: BodyComposition;
    layers: {
      skin: boolean;
      subcutaneousFat: boolean;
      visceralFat: boolean;
      muscles: boolean;
      skeleton: boolean;
    };
  };
}

export interface AnatomyMesh {
  positions: Float32Array;
  indices: Uint16Array | Uint32Array;
  heightCm: number;
  groups: {
    kind: 'bone' | 'muscle';
    region: 'head' | 'trunk' | 'arms' | 'legs';
    start: number;
    count: number;
    anchor?: [number, number, number];
    sideAnchorX?: number;
  }[];
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
uniform vec3 u_scale;
uniform vec3 u_anchor;
uniform float u_sideAnchorX;
uniform vec3 u_translate;
uniform float u_stature;
uniform float u_frame;
uniform float u_armFrame;
uniform float u_referenceHeight;
uniform float u_push;      // outline width in clip units (0 for the body)
uniform vec2 u_px;         // clip units per pixel (x, y)
out vec3 v_normal;
float ease(float a, float b, float x) {
  float t = clamp((x - a) / (b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
vec3 armFrameDelta(float y) {
  // Atlas arms are registered to the hips-led MakeHuman frame at 165.9 cm.
  vec3 hand = vec3(4.7, -6.1, 8.9);
  vec3 wrist = vec3(4.6, -4.1, 7.5);
  vec3 shoulder = vec3(0.5, 2.0, 1.0);
  if (y < 87.0) return mix(hand, wrist, ease(72.0, 87.0, y));
  if (y < 129.0) return mix(wrist, shoulder, ease(87.0, 129.0, y));
  return shoulder * (1.0 - ease(129.0, 136.0, y));
}
void main() {
  vec3 anchor = u_anchor;
  if (u_sideAnchorX > 0.0) {
    float midline = smoothstep(0.0, u_sideAnchorX * 0.7, abs(a_pos.x));
    anchor.x = sign(a_pos.x) * u_sideAnchorX * midline;
  }
  vec3 p = anchor + (a_pos - anchor) * u_scale;
  if (u_armFrame > 0.0) {
    vec3 d = armFrameDelta(a_pos.y);
    p += u_armFrame * vec3(sign(a_pos.x) * d.x, d.y, d.z);
  }
  p *= u_stature;
  p.x *= 1.0 + u_frame * (p.y / max(u_referenceHeight * u_stature, 1.0) - 0.5);
  p += u_translate;
  vec4 clip = u_mvp * vec4(p, 1.0);
  vec3 n = normalize(u_rot * (a_nrm / u_scale));
  if (u_push > 0.0) {
    vec2 d = normalize(n.xy + vec2(1e-6));
    clip.xy += d * u_push * u_px * clip.w;
  }
  v_normal = n;
  gl_Position = clip;
}`;

const FS = `#version 300 es
precision highp float;
in vec3 v_normal;
uniform vec3 u_colour;
uniform float u_alpha;
uniform int u_flat;        // 1 = unlit colour (outline, ghost)
uniform int u_ghostOutline;
out vec4 o_colour;
void main() {
  if (u_ghostOutline == 1) {
    // Grazing angles form a contour; no filled comparison surface can veil the active anatomy.
    float edge = 1.0 - abs(normalize(v_normal).z);
    float alpha = smoothstep(0.68, 0.92, edge) * u_alpha;
    if (alpha < 0.015) discard;
    o_colour = vec4(u_colour, alpha);
    return;
  }
  if (u_flat == 1) { o_colour = vec4(u_colour, u_alpha); return; }
  vec3 n = normalize(v_normal);
  vec3 key = normalize(vec3(-0.5, 0.7, 0.6));
  vec3 fill = normalize(vec3(0.65, 0.25, 0.55));
  float light = 0.46 + 0.39 * max(dot(n, key), 0.0) + 0.13 * max(dot(n, fill), 0.0);
  float rim = pow(1.0 - max(dot(n, vec3(0.0, 0.0, 1.0)), 0.0), 3.0) * 0.1;
  o_colour = vec4(min(u_colour * light + rim, vec3(1.0)), u_alpha);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error(`figure shader: ${gl.getShaderInfoLog(s) ?? ''}`);
  return s;
}

/** Area-weighted smooth vertex normals (for the outline offset only). */
export function vertexNormals(
  P: Float32Array,
  idx: Uint16Array | Uint32Array,
  out: Float32Array = new Float32Array(P.length),
): Float32Array {
  out.fill(0);
  for (let f = 0; f < idx.length; f += 3) {
    const a = 3 * idx[f]!,
      b = 3 * idx[f + 1]!,
      c = 3 * idx[f + 2]!;
    const ux = P[b]! - P[a]!,
      uy = P[b + 1]! - P[a + 1]!,
      uz = P[b + 2]! - P[a + 2]!;
    const wx = P[c]! - P[a]!,
      wy = P[c + 1]! - P[a + 1]!,
      wz = P[c + 2]! - P[a + 2]!;
    const nx = uy * wz - uz * wy,
      ny = uz * wx - ux * wz,
      nz = ux * wy - uy * wx;
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
  source?: Float32Array;
  revision?: number;
}

export class FigureRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly prog: WebGLProgram;
  private readonly ibo: WebGLBuffer;
  private readonly count: number;
  private readonly meshes: MeshBuffers[] = [];
  private anatomy: { mesh: AnatomyMesh; buffers: MeshBuffers; index: WebGLBuffer; indexType: number } | null =
    null;
  private vat: { buffers: MeshBuffers; index: WebGLBuffer; count: number } | null = null;
  private readonly shaders: WebGLShader[];
  private readonly u: Record<
    | 'mvp'
    | 'rot'
    | 'push'
    | 'px'
    | 'colour'
    | 'alpha'
    | 'flat'
    | 'ghostOutline'
    | 'scale'
    | 'anchor'
    | 'sideAnchorX'
    | 'translate'
    | 'stature'
    | 'frame'
    | 'armFrame'
    | 'referenceHeight',
    WebGLUniformLocation | null
  >;
  lost = false;

  /** Throws if WebGL2 is unavailable (callers fall back to the SVG figure). */
  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly indices: Uint16Array,
    vertexCount: number,
  ) {
    const gl = canvas.getContext('webgl2', {
      antialias: true,
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    const prog = gl.createProgram()!;
    this.shaders = [compile(gl, gl.VERTEX_SHADER, VS), compile(gl, gl.FRAGMENT_SHADER, FS)];
    for (const shader of this.shaders) gl.attachShader(prog, shader);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error(`figure program: ${gl.getProgramInfoLog(prog) ?? ''}`);
    this.prog = prog;
    const loc = (n: string) => gl.getUniformLocation(prog, n);
    this.u = {
      mvp: loc('u_mvp'),
      rot: loc('u_rot'),
      push: loc('u_push'),
      px: loc('u_px'),
      colour: loc('u_colour'),
      alpha: loc('u_alpha'),
      flat: loc('u_flat'),
      ghostOutline: loc('u_ghostOutline'),
      scale: loc('u_scale'),
      anchor: loc('u_anchor'),
      sideAnchorX: loc('u_sideAnchorX'),
      translate: loc('u_translate'),
      stature: loc('u_stature'),
      frame: loc('u_frame'),
      armFrame: loc('u_armFrame'),
      referenceHeight: loc('u_referenceHeight'),
    };
    this.ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    this.count = indices.length;
    // three mesh slots: envelope, core, ghost
    for (let i = 0; i < 3; i++) {
      this.meshes.push(this.makeMesh(vertexCount, this.ibo));
    }
    gl.bindVertexArray(null);
    canvas.addEventListener('webglcontextlost', this.onLost);
  }

  private onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
  };

  private makeMesh(vertexCount: number, index: WebGLBuffer): MeshBuffers {
    const gl = this.gl;
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
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    return { vao, pos, nrm, normals: new Float32Array(vertexCount * 3) };
  }

  /** The anatomy asset is immutable, so upload it once, then change only uniforms while it rotates. */
  setAnatomy(mesh: AnatomyMesh): void {
    if (this.anatomy?.mesh === mesh || this.lost) return;
    const gl = this.gl;
    if (this.anatomy) {
      this.deleteMesh(this.anatomy.buffers);
      gl.deleteBuffer(this.anatomy.index);
    }
    gl.bindVertexArray(null);
    const index = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.bufferData(
      gl.ELEMENT_ARRAY_BUFFER,
      mesh.indices as Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>,
      gl.STATIC_DRAW,
    );
    const buffers = this.makeMesh(mesh.positions.length / 3, index);
    this.uploadMesh(buffers, mesh.positions, mesh.indices, 0);
    this.anatomy = {
      mesh,
      buffers,
      index,
      indexType: mesh.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
    };
    gl.bindVertexArray(null);
  }

  private ensureVat(): NonNullable<FigureRenderer['vat']> {
    if (this.vat) return this.vat;
    const gl = this.gl;
    const rings = 14,
      segments = 20;
    const P = new Float32Array((rings + 1) * (segments + 1) * 3);
    const idx: number[] = [];
    for (let r = 0; r <= rings; r++) {
      const phi = (Math.PI * r) / rings;
      for (let s = 0; s <= segments; s++) {
        const theta = (Math.PI * 2 * s) / segments;
        const k = 3 * (r * (segments + 1) + s);
        P[k] = Math.sin(phi) * Math.cos(theta);
        P[k + 1] = Math.cos(phi);
        P[k + 2] = Math.sin(phi) * Math.sin(theta);
        if (r < rings && s < segments) {
          const a = r * (segments + 1) + s,
            b = a + segments + 1;
          idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
    }
    const indices = new Uint16Array(idx);
    gl.bindVertexArray(null);
    const index = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    const buffers = this.makeMesh(P.length / 3, index);
    this.uploadMesh(buffers, P, indices, 0);
    gl.bindVertexArray(null);
    this.vat = { buffers, index, count: indices.length };
    return this.vat;
  }

  private uploadMesh(
    m: MeshBuffers,
    P: Float32Array,
    indices: Uint16Array | Uint32Array,
    revision: number,
  ): void {
    if (m.source === P && m.revision === revision) return;
    const gl = this.gl;
    vertexNormals(P, indices, m.normals);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.pos);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, P as Float32Array<ArrayBuffer>);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.nrm);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, m.normals as Float32Array<ArrayBuffer>);
    m.source = P;
    m.revision = revision;
  }

  private upload(slot: number, P: Float32Array, revision: number): void {
    this.uploadMesh(this.meshes[slot]!, P, this.indices, revision);
  }

  draw(frame: FigureFrame): void {
    if (this.lost) return;
    const gl = this.gl;
    const W = this.canvas.width,
      H = this.canvas.height;
    const revision = frame.geometryRevision ?? 0;
    this.upload(0, frame.positions, revision);
    if (frame.core) this.upload(1, frame.core, revision);
    if (frame.ghost) this.upload(2, frame.ghost, revision);
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
    const outlinePx = (frame.outlinePx ?? 2) * dpr;
    const L = frame.layout;
    frame.views.forEach((view, i) => {
      gl.clear(gl.DEPTH_BUFFER_BIT);
      const cx = frame.centre[view] ?? 0;
      // rotation: side view looks at the body's right side, front (+z) to screen right
      const angle = (frame.angleRad ?? 0) + (view === 'side' ? Math.PI / 2 : 0);
      const cos = Math.cos(angle),
        sin = Math.sin(angle);
      const rot = [cos, 0, -sin, 0, 1, 0, sin, 0, cos];
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
        sx * rot[0]!,
        sy * rot[1]!,
        sz * rot[2]!,
        0,
        sx * rot[3]!,
        sy * rot[4]!,
        sz * rot[5]!,
        0,
        sx * rot[6]!,
        sy * rot[7]!,
        sz * rot[8]!,
        0,
        tx - sx * cx,
        ty,
        0,
        1,
      ]);
      gl.uniformMatrix4fv(this.u.mvp, false, mvp);
      gl.uniformMatrix3fv(
        this.u.rot,
        false,
        new Float32Array([rot[0]!, rot[1]!, rot[2]!, rot[3]!, rot[4]!, rot[5]!, rot[6]!, rot[7]!, rot[8]!]),
      );
      gl.uniform2f(this.u.px, 2 / pxW, 2 / H);
      gl.uniform3f(this.u.scale, 1, 1, 1);
      gl.uniform3f(this.u.anchor, 0, 0, 0);
      gl.uniform1f(this.u.sideAnchorX, 0);
      gl.uniform3f(this.u.translate, 0, 0, 0);
      gl.uniform1f(this.u.stature, 1);
      gl.uniform1f(this.u.frame, 0);
      gl.uniform1f(this.u.armFrame, 0);
      gl.uniform1f(this.u.referenceHeight, frame.stageCm);
      gl.uniform1i(this.u.ghostOutline, 0);
      const drawMesh = (
        slot: number,
        colour: [number, number, number],
        alpha: number,
        flat: boolean,
        push = 0,
      ) => {
        gl.bindVertexArray(this.meshes[slot]!.vao);
        gl.uniform3f(this.u.colour, colour[0], colour[1], colour[2]);
        gl.uniform1f(this.u.alpha, alpha);
        gl.uniform1i(this.u.flat, flat ? 1 : 0);
        gl.uniform1f(this.u.push, push);
        gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
      };
      gl.enable(gl.CULL_FACE);
      if (frame.ghost) {
        // The comparison shape is a rim only, drawn before opaque tissues and without depth writes.
        gl.depthMask(false);
        gl.cullFace(gl.BACK);
        gl.uniform1i(this.u.ghostOutline, 1);
        drawMesh(2, frame.colours.ghost, 0.7, true);
        gl.uniform1i(this.u.ghostOutline, 0);
        gl.depthMask(true);
      }
      const A = frame.anatomy;
      const anatomy = this.anatomy;
      if (A && anatomy) {
        const { composition: c, layers } = A;
        const stature = c.skeleton.heightCm / anatomy.mesh.heightCm;
        gl.uniform1f(this.u.stature, stature);
        gl.uniform1f(this.u.referenceHeight, anatomy.mesh.heightCm);
        gl.uniform1f(this.u.frame, c.skeleton.shoulderScale - c.skeleton.hipScale);
        gl.cullFace(gl.BACK);
        const drawAnatomy = (kind: 'bone' | 'muscle', colour: [number, number, number]) => {
          gl.bindVertexArray(anatomy.buffers.vao);
          gl.uniform3f(this.u.colour, ...colour);
          gl.uniform1f(this.u.alpha, kind === 'muscle' && layers.visceralFat ? 0.62 : 1);
          gl.uniform1i(this.u.flat, 0);
          gl.uniform1f(this.u.push, 0);
          for (const group of anatomy.mesh.groups) {
            if (group.kind !== kind) continue;
            const q =
              kind === 'muscle'
                ? Math.max(
                    0.83,
                    Math.min(
                      1.26,
                      c.muscle[group.region === 'head' ? 'trunk' : group.region].transverseScale,
                    ),
                  )
                : 1;
            const bilateral = group.region === 'arms' || group.region === 'legs';
            const cx = bilateral ? (group.anchor?.[0] ?? 0) : 0;
            const cy = group.anchor?.[1] ?? 0,
              cz = group.anchor?.[2] ?? 0;
            gl.uniform3f(this.u.anchor, cx, cy, cz);
            gl.uniform1f(this.u.sideAnchorX, bilateral ? (group.sideAnchorX ?? 0) : 0);
            gl.uniform1f(this.u.armFrame, group.region === 'arms' ? c.skeleton.frame : 0);
            gl.uniform3f(this.u.scale, q, 1, q);
            gl.drawElements(
              gl.TRIANGLES,
              group.count,
              anatomy.indexType,
              group.start * (anatomy.indexType === gl.UNSIGNED_INT ? 4 : 2),
            );
          }
        };
        if (layers.skeleton) drawAnatomy('bone', [0.84, 0.81, 0.72]);
        if (layers.visceralFat) gl.depthMask(false);
        if (layers.muscles) drawAnatomy('muscle', [0.64, 0.28, 0.26]);
        gl.depthMask(true);
        gl.uniform3f(this.u.scale, 1, 1, 1);
        gl.uniform3f(this.u.anchor, 0, 0, 0);
        gl.uniform1f(this.u.sideAnchorX, 0);
        gl.uniform1f(this.u.stature, 1);
        gl.uniform1f(this.u.frame, 0);
        gl.uniform1f(this.u.armFrame, 0);
        gl.uniform1f(this.u.referenceHeight, frame.stageCm);
      }
      if (A?.layers.visceralFat) {
        // A bounded abdominal estimate, placed inside the trunk. Volume tracks the estimated visceral area.
        const vat = this.ensureVat();
        const q = A.composition.visceral.transverseScale;
        const radiusX = Math.min(9.8 * q, A.composition.visceral.cavityHalfWidthCm);
        const radiusZ = Math.min(7.4 * q, A.composition.visceral.cavityHalfDepthCm);
        gl.bindVertexArray(vat.buffers.vao);
        gl.uniform3f(this.u.scale, radiusX, (12.2 * A.composition.skeleton.heightCm) / 170, radiusZ);
        gl.uniform3f(this.u.translate, 0, A.composition.skeleton.heightCm * 0.55, -1.4);
        gl.uniform3f(this.u.colour, 0.97, 0.62, 0.26);
        gl.uniform1f(this.u.alpha, 0.83);
        gl.uniform1i(this.u.flat, 0);
        gl.uniform1f(this.u.push, 0);
        gl.depthMask(false);
        gl.drawElements(gl.TRIANGLES, vat.count, gl.UNSIGNED_SHORT, 0);
        gl.depthMask(true);
        gl.uniform3f(this.u.scale, 1, 1, 1);
        gl.uniform3f(this.u.translate, 0, 0, 0);
      }
      // The surface is a skin boundary. The interval to the inner lean surface stands for subcutaneous fat.
      const showSkin = !A || A.layers.skin;
      const showSat = !!A?.layers.subcutaneousFat;
      const innerVisible = !!A && (A.layers.skeleton || A.layers.muscles || A.layers.visceralFat);
      if (showSkin || showSat) {
        gl.cullFace(gl.FRONT);
        drawMesh(0, frame.colours.outline, innerVisible ? 0.88 : 0.9, true, outlinePx);
        gl.cullFace(gl.BACK);
      }
      if (!A && frame.core) {
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
      } else if (A) {
        // Keep depth writes disabled for translucent tissues so the internal anatomy remains legible.
        gl.depthMask(false);
        if (showSat && frame.core) drawMesh(1, [0.9, 0.64, 0.4], 0.19, false);
        if (showSat) drawMesh(0, [0.95, 0.74, 0.48], showSkin ? 0.22 : 0.34, false);
        if (showSkin) {
          const b = frame.colours.body,
            e = frame.colours.outline;
          const skin: [number, number, number] = [
            0.68 * b[0] + 0.32 * e[0],
            0.68 * b[1] + 0.32 * e[1],
            0.68 * b[2] + 0.32 * e[2],
          ];
          drawMesh(0, skin, innerVisible || showSat ? 0.42 : 1, false);
        }
        gl.depthMask(true);
      } else drawMesh(0, frame.colours.body, 1, false);
    });
    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    const gl = this.gl;
    for (const m of this.meshes) this.deleteMesh(m);
    if (this.anatomy) {
      this.deleteMesh(this.anatomy.buffers);
      gl.deleteBuffer(this.anatomy.index);
      this.anatomy = null;
    }
    if (this.vat) {
      this.deleteMesh(this.vat.buffers);
      gl.deleteBuffer(this.vat.index);
      this.vat = null;
    }
    gl.deleteBuffer(this.ibo);
    gl.deleteProgram(this.prog);
    for (const shader of this.shaders) gl.deleteShader(shader);
  }

  private deleteMesh(m: MeshBuffers): void {
    this.gl.deleteBuffer(m.pos);
    this.gl.deleteBuffer(m.nrm);
    this.gl.deleteVertexArray(m.vao);
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
  const raw = ['--lm-avatar-fat', '--lm-avatar-lean', '--lm-avatar-outline', '--lm-avatar-ghost'].map((n) =>
    cs.getPropertyValue(n),
  );
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
