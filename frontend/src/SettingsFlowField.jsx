import { useEffect, useRef } from "react";

const LOOP_SECONDS = 15.466667;
const ACTIVE_FRAME_MS = 1000 / 24;

const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_phase;
varying vec2 v_uv;

#define TAU 6.28318530718

float hash21(vec2 point) {
  point = fract(point * vec2(123.34, 456.21));
  point += dot(point, point + 45.32);
  return fract(point.x * point.y);
}

float noise21(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  local = local * local * (3.0 - 2.0 * local);
  float a = hash21(cell);
  float b = hash21(cell + vec2(1.0, 0.0));
  float c = hash21(cell + vec2(0.0, 1.0));
  float d = hash21(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
}

mat2 rotate2d(float angle) {
  float sine = sin(angle);
  float cosine = cos(angle);
  return mat2(cosine, -sine, sine, cosine);
}

float fbm(vec2 point) {
  float value = 0.0;
  float amplitude = 0.54;
  mat2 octaveTurn = rotate2d(0.61);
  for (int octave = 0; octave < 5; octave++) {
    value += amplitude * noise21(point);
    point = octaveTurn * point * 2.03 + vec2(19.1, 7.7);
    amplitude *= 0.48;
  }
  return value;
}

float ellipseMask(vec2 point, vec2 center, vec2 radius, float angle) {
  vec2 local = rotate2d(angle) * (point - center) / radius;
  return exp(-1.7 * dot(local, local));
}

void main() {
  vec2 point = v_uv * 2.0 - 1.0;
  point.x *= u_resolution.x / max(u_resolution.y, 1.0);

  float turn = u_phase * TAU;
  vec2 orbitA = vec2(cos(turn), sin(turn));
  vec2 orbitB = vec2(cos(turn * 2.0 + 1.7), sin(turn * 3.0 - 0.8));
  vec2 orbitC = vec2(cos(turn * 3.0 - 1.1), sin(turn * 2.0 + 2.4));

  vec2 broadPoint = point * 1.78;
  vec2 firstWarp = vec2(
    fbm(broadPoint + orbitA * 0.33),
    fbm(broadPoint + vec2(8.7, 3.1) - orbitA.yx * 0.29)
  );
  vec2 curledPoint = point + (firstWarp - 0.5) * 0.72;
  vec2 secondWarp = vec2(
    fbm(rotate2d(0.83) * curledPoint * 2.52 + orbitB * 0.25),
    fbm(rotate2d(-0.47) * curledPoint * 2.21 + vec2(4.3, 11.6) + orbitC * 0.23)
  );
  vec2 smokePoint = curledPoint + (secondWarp - 0.5) * 0.29;
  float detail = fbm(smokePoint * 4.25 + orbitC * 0.17);
  float folded = 1.0 - abs(detail * 2.0 - 1.0);

  vec2 greenCenter = vec2(-0.44, -0.12) + vec2(orbitA.x * 0.18, orbitB.y * 0.27);
  vec2 violetCenter = vec2(0.39, 0.08) + vec2(orbitB.x * 0.2, orbitA.y * 0.31);
  vec2 cyanCenter = vec2(-0.08, 0.64) + vec2(orbitC.x * 0.28, orbitB.y * 0.13);
  vec2 goldCenter = vec2(0.02, -0.68) + vec2(orbitA.y * 0.31, orbitC.x * 0.15);

  float greenMask = ellipseMask(smokePoint, greenCenter, vec2(0.47, 0.92), -0.39 + orbitA.y * 0.26);
  float violetMask = ellipseMask(smokePoint, violetCenter, vec2(0.51, 0.96), 0.45 + orbitB.x * 0.24);
  float cyanMask = ellipseMask(smokePoint, cyanCenter, vec2(0.7, 0.59), -0.16 + orbitC.y * 0.18);
  float goldMask = ellipseMask(smokePoint, goldCenter, vec2(0.65, 0.61), 0.2 + orbitA.x * 0.2);

  float turbulence = smoothstep(0.28, 0.91, detail + folded * 0.36);
  float filaments = pow(smoothstep(0.22, 0.96, folded), 2.25);
  float green = greenMask * mix(0.42, 1.15, turbulence) * (0.7 + 0.3 * filaments);
  float violet = violetMask * mix(0.38, 1.12, turbulence) * (0.68 + 0.4 * filaments);
  float cyan = cyanMask * mix(0.34, 1.02, turbulence) * (0.72 + 0.34 * filaments);
  float gold = goldMask * mix(0.32, 0.98, turbulence) * (0.72 + 0.31 * filaments);

  float total = max(max(green, violet), max(cyan, gold));
  float crossGlow = min(1.0, green * gold + violet * cyan) * 0.65;
  vec3 color = vec3(0.0);
  color += green * mix(vec3(0.04, 0.48, 0.04), vec3(0.82, 0.94, 0.08), 0.5 + 0.5 * orbitB.x);
  color += violet * mix(vec3(0.18, 0.025, 0.46), vec3(0.91, 0.08, 0.58), 0.52 + 0.48 * orbitC.y);
  color += cyan * mix(vec3(0.02, 0.34, 0.7), vec3(0.09, 0.82, 0.86), 0.5 + 0.5 * orbitA.y);
  color += gold * mix(vec3(0.88, 0.2, 0.015), vec3(1.0, 0.68, 0.04), 0.5 + 0.5 * orbitC.x);

  float weight = max(green + violet + cyan + gold, 0.001);
  color /= max(weight * 0.74, 1.0);
  float pearl = pow(filaments, 3.0) * total * 0.62 + crossGlow * 0.38;
  color = mix(color, vec3(1.0, 0.96, 0.99), clamp(pearl, 0.0, 0.42));

  float inkCore = smoothstep(0.62, 1.35, weight) * (1.0 - pearl) * 0.36;
  color = mix(color, vec3(0.11, 0.07, 0.18), inkCore);
  color = pow(max(color, 0.0), vec3(0.88));

  float edgeFade = smoothstep(1.2, 0.18, length(point * vec2(0.58, 0.43)));
  float alpha = clamp((total * 0.82 + crossGlow * 0.2) * edgeFade, 0.0, 0.9);
  gl_FragColor = vec4(color, alpha);
}
`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const reason = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(reason || "Unable to compile Settings flow shader");
  }
  return shader;
}

function createProgram(gl) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const reason = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(reason || "Unable to link Settings flow shader");
  }
  return program;
}

export default function SettingsFlowField() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const showFallback = () => {
      canvas.parentElement?.classList.add("settings-flow-field--fallback");
    };

    let disposeRenderer = () => {};

    const startRenderer = () => {
      const gl = canvas.getContext("webgl", {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        powerPreference: "high-performance",
        preserveDrawingBuffer: true,
      });
      if (!gl) {
        showFallback();
        return;
      }

      let program;
      try {
        program = createProgram(gl);
      } catch {
        showFallback();
        return;
      }

      const position = gl.getAttribLocation(program, "a_position");
      const resolution = gl.getUniformLocation(program, "u_resolution");
      const phase = gl.getUniformLocation(program, "u_phase");
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW,
      );
      gl.useProgram(program);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);

      const settingsSheet = canvas.closest(".settings-sheet");
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
      let animationFrame = 0;
      let lastFrame = -Infinity;
      let startedAt = performance.now();
      let scrolling = settingsSheet?.classList.contains("is-scrolling") ?? false;
      let disposed = false;

      const resize = () => {
        const rect = canvas.getBoundingClientRect();
        const longestSide = Math.max(rect.width, rect.height);
        const mobileScale = window.matchMedia("(max-width: 820px)").matches
          ? 0.64
          : 0.82;
        const renderScale = Math.min(
          mobileScale,
          760 / Math.max(longestSide, 1),
        );
        const width = Math.max(2, Math.round(rect.width * renderScale));
        const height = Math.max(2, Math.round(rect.height * renderScale));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
          gl.viewport(0, 0, width, height);
        }
      };

      const draw = (now) => {
        animationFrame = 0;
        if (disposed || scrolling) return;
        if (now - lastFrame >= ACTIVE_FRAME_MS || lastFrame < 0) {
          resize();
          const elapsed = (now - startedAt) / 1000;
          gl.useProgram(program);
          gl.uniform2f(resolution, canvas.width, canvas.height);
          gl.uniform1f(
            phase,
            reducedMotion.matches ? 0.64 : (elapsed % LOOP_SECONDS) / LOOP_SECONDS,
          );
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          canvas.parentElement?.classList.add("settings-flow-field--ready");
          lastFrame = now;
        }
        if (!reducedMotion.matches && !scrolling) {
          animationFrame = requestAnimationFrame(draw);
        }
      };

      const restart = () => {
        cancelAnimationFrame(animationFrame);
        lastFrame = -Infinity;
        if (reducedMotion.matches) {
          draw(performance.now());
        } else {
          startedAt = performance.now();
          animationFrame = requestAnimationFrame(draw);
        }
      };

      const scrollObserver = settingsSheet
        ? new MutationObserver(() => {
            const nextScrolling = settingsSheet.classList.contains("is-scrolling");
            if (scrolling === nextScrolling) return;
            scrolling = nextScrolling;
            if (scrolling) {
              cancelAnimationFrame(animationFrame);
              animationFrame = 0;
              canvas.parentElement?.classList.add("settings-flow-field--paused");
              return;
            }
            canvas.parentElement?.classList.remove("settings-flow-field--paused");
            lastFrame = -Infinity;
            if (!reducedMotion.matches) animationFrame = requestAnimationFrame(draw);
          })
        : null;
      scrollObserver?.observe(settingsSheet, {
        attributes: true,
        attributeFilter: ["class"],
      });

      const resizeObserver = new ResizeObserver(() => {
        lastFrame = -Infinity;
      });
      resizeObserver.observe(canvas);
      reducedMotion.addEventListener?.("change", restart);

      const handleContextLost = (event) => {
        event.preventDefault();
        cancelAnimationFrame(animationFrame);
        showFallback();
      };
      canvas.addEventListener("webglcontextlost", handleContextLost);
      restart();

      disposeRenderer = () => {
        disposed = true;
        cancelAnimationFrame(animationFrame);
        scrollObserver?.disconnect();
        resizeObserver.disconnect();
        reducedMotion.removeEventListener?.("change", restart);
        canvas.removeEventListener("webglcontextlost", handleContextLost);
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
      };
    };

    // Wait until the jelly sheet has fully settled so WebGL does not resize
    // through every animation frame on Android WebView.
    const warmupTimer = window.setTimeout(startRenderer, 720);
    return () => {
      window.clearTimeout(warmupTimer);
      disposeRenderer();
    };
  }, []);

  return (
    <div className="settings-flow-field" aria-hidden="true">
      <canvas className="settings-flow-canvas" ref={canvasRef} />
      <i className="settings-flow-ivory-light" />
      <i className="settings-flow-grain" />
    </div>
  );
}
