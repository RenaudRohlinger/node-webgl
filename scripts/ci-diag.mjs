// Prints which EGL/GL backend a machine ended up with (used by CI before running the suite).
import { createCanvas, getDisplayInfo } from '../src/index.ts';
const canvas = createCanvas(4, 4);
const gl = canvas.getContext('webgl2');
const info = getDisplayInfo();
console.log(JSON.stringify({ backend: info.backend, angle: info.angle, dynamic: info.dynamic, vendor: info.vendor, version: info.version }));
const dbg = gl.getExtension('WEBGL_debug_renderer_info');
console.log('renderer:', gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL));
console.log('extensions:', gl.getSupportedExtensions().length, '| MAX_TEXTURE_SIZE', gl.getParameter(gl.MAX_TEXTURE_SIZE), '| SAMPLES', gl.getParameter(gl.SAMPLES));
canvas.dispose();
