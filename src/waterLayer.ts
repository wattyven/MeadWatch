// A MapLibre custom layer that draws Lake Mead's water surface as a flat plane
// at the selected elevation. The plane is masked per pixel by the flood
// threshold raster (W): a pixel is water when the lake surface is above W.
// Because the terrain underneath is the real lake floor and MapLibre's terrain
// writes depth, canyon walls and exposed lakebed correctly occlude the plane.

import type {CustomLayerInterface, CustomRenderMethodInput, Map as MlMap} from 'maplibre-gl';
import type {BathyMeta} from './data';
import type {Raster} from './terrain';

const FT_PER_M = 3.28084;
const EARTH_CIRCUMFERENCE = 40075016.686;

const VERT = `#version 300 es
uniform mat4 u_matrix;
uniform vec2 u_extent;
uniform float u_z;
in vec2 a_pos;
out vec2 v_uv;
void main() {
    v_uv = a_pos;
    gl_Position = u_matrix * vec4(a_pos * u_extent, u_z, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D u_w;
uniform highp sampler2D u_floor;
uniform vec2 u_size;
uniform float u_level;
uniform float u_wOffset;
uniform float u_wScale;
in vec2 v_uv;
out vec4 fragColor;

ivec2 cl(ivec2 p) { return clamp(p, ivec2(0), ivec2(u_size) - 1); }

float wAt(ivec2 p) {
    vec3 c = floor(texelFetch(u_w, cl(p), 0).rgb * 255.0 + 0.5);
    float v = c.r * 256.0 + c.g;
    return v > 65534.5 ? 1300.0 : v / u_wScale + u_wOffset;
}

float floorAt(ivec2 p, float fallback) {
    vec3 c = floor(texelFetch(u_floor, cl(p), 0).rgb * 255.0 + 0.5);
    if (c.r + c.g + c.b < 0.5) return fallback;
    return (c.r * 256.0 + c.g + c.b / 256.0 - 32768.0) * ${FT_PER_M};
}

void main() {
    vec2 p = v_uv * u_size - 0.5;
    ivec2 i = ivec2(floor(p));
    vec2 f = fract(p);
    float w00 = wAt(i), w10 = wAt(i + ivec2(1, 0)), w01 = wAt(i + ivec2(0, 1)), w11 = wAt(i + ivec2(1, 1));
    float W = mix(mix(w00, w10, f.x), mix(w01, w11, f.x), f.y);

    if (W >= u_level) discard;
    float bed = mix(mix(floorAt(i, w00), floorAt(i + ivec2(1, 0), w10), f.x),
                    mix(floorAt(i + ivec2(0, 1), w01), floorAt(i + ivec2(1, 1), w11), f.x), f.y);
    float depth = max(u_level - bed, 0.0);
    float t = clamp(depth / 320.0, 0.0, 1.0);
    vec3 shallow = vec3(0.42, 0.80, 0.82);
    vec3 mid = vec3(0.13, 0.52, 0.74);
    vec3 deep = vec3(0.04, 0.20, 0.42);
    vec3 col = mix(shallow, mid, smoothstep(0.0, 0.25, t));
    col = mix(col, deep, smoothstep(0.25, 1.0, t));
    float shore = 1.0 - smoothstep(0.0, 4.0, u_level - W);
    col = mix(col, vec3(0.88, 0.97, 1.0), shore * 0.55);
    float a = 0.94 * smoothstep(0.0, 0.35, u_level - W);
    fragColor = vec4(col * a, a);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
    return s;
}

export class WaterLayer implements CustomLayerInterface {
    readonly id = 'mead-water';
    readonly type = 'custom' as const;
    readonly renderingMode = '3d' as const;

    level = 1038;

    private map?: MlMap;
    private gl?: WebGL2RenderingContext;
    private program?: WebGLProgram;
    private vao?: WebGLVertexArrayObject;
    private texW?: WebGLTexture;
    private texFloor?: WebGLTexture;
    private uniforms: Record<string, WebGLUniformLocation | null> = {};
    private readonly origin: [number, number];
    private readonly extent: [number, number];

    constructor(private meta: BathyMeta, private wRaster: Raster, private floorRaster: Raster) {
        const world = 256 * 2 ** meta.z;
        this.origin = [meta.px0 / world, meta.py0 / world];
        this.extent = [meta.width / world, meta.height / world];
    }

    setLevel(ft: number) {
        this.level = ft;
        this.map?.triggerRepaint();
    }

    onAdd(map: MlMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
        if (!(gl instanceof WebGL2RenderingContext)) throw new Error('WebGL2 is required for the water layer');
        this.map = map;
        this.gl = gl;
        const prog = gl.createProgram()!;
        gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
        gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error');
        this.program = prog;
        for (const u of ['u_matrix', 'u_extent', 'u_z', 'u_w', 'u_floor', 'u_size', 'u_level', 'u_wOffset', 'u_wScale']) {
            this.uniforms[u] = gl.getUniformLocation(prog, u);
        }
        this.vao = gl.createVertexArray()!;
        gl.bindVertexArray(this.vao);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, 'a_pos');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);
    }

    private uploadTextures(gl: WebGL2RenderingContext) {
        const make = (r: Raster) => {
            const tex = gl.createTexture()!;
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, r.width, r.height, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength));
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            return tex;
        };
        this.texW = make(this.wRaster);
        this.texFloor = make(this.floorRaster);
    }

    render(glIn: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
        const gl = glIn as WebGL2RenderingContext;
        const map = this.map!;
        if (!this.texW) this.uploadTextures(gl);

        // Shift the (float64) matrix to the grid origin so float32 vertex
        // positions stay small and precise.
        const m = args.defaultProjectionData.mainMatrix as unknown as ArrayLike<number>;
        const [ox, oy] = this.origin;
        const mat = new Float32Array(16);
        for (let k = 0; k < 16; k++) mat[k] = m[k];
        for (let r = 0; r < 4; r++) mat[12 + r] = m[r] * ox + m[4 + r] * oy + m[12 + r];

        const exaggeration = map.getTerrain()?.exaggeration ?? 0;
        const lat = map.getCenter().lat;
        const zPerMeter = 1 / (EARTH_CIRCUMFERENCE * Math.cos(lat * Math.PI / 180));
        const zFor = (ft: number) => (ft / FT_PER_M) * exaggeration * zPerMeter;

        gl.useProgram(this.program!);
        gl.bindVertexArray(this.vao!);
        const u = this.uniforms;
        gl.uniformMatrix4fv(u.u_matrix, false, mat);
        gl.uniform2f(u.u_extent, this.extent[0], this.extent[1]);
        gl.uniform2f(u.u_size, this.meta.width, this.meta.height);
        gl.uniform1f(u.u_level, this.level);
        gl.uniform1f(u.u_wOffset, this.meta.wEncoding.offsetFt);
        gl.uniform1f(u.u_wScale, this.meta.wEncoding.scale);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texW!);
        gl.uniform1i(u.u_w, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.texFloor!);
        gl.uniform1i(u.u_floor, 1);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.CULL_FACE);

        gl.uniform1f(u.u_z, zFor(this.level));
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
        gl.activeTexture(gl.TEXTURE0);
    }

    onRemove() {
        const gl = this.gl;
        if (!gl) return;
        if (this.texW) gl.deleteTexture(this.texW);
        if (this.texFloor) gl.deleteTexture(this.texFloor);
        if (this.program) gl.deleteProgram(this.program);
        this.texW = this.texFloor = undefined;
    }
}
