export class WaveformRenderer {
  gl: WebGL2RenderingContext;
  tex: WebGLTexture | undefined;
  vertices: number[][];
  program: WebGLProgram;
  uniformLocations: Record<string, WebGLUniformLocation>;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;

    const vertexShader = this.createShader(
      this.gl.VERTEX_SHADER,
      `#version 300 es
      precision mediump float;
      in vec2 position;

      void main() {
        gl_Position = vec4(position.x, position.y, 1.0, 1.0);
      }`,
    );

    const fragmentShader = this.createShader(
      this.gl.FRAGMENT_SHADER,
      `#version 300 es
      precision mediump float;

      uniform highp isampler2D texture;
      uniform int translate_x;
      uniform float waveform_height;
      uniform float waveform_center;
      uniform float scale;
      uniform vec3 waveform_color;
      out vec4 fragColor;

      vec2 get_min_max(int index) {
        ivec2 texture_size = textureSize(texture, 0);
        ivec2 tex_pos = ivec2(index % texture_size.x, index / texture_size.x);
        ivec4 texel = texelFetch(texture, tex_pos, 0);
        return vec2(texel.xy) / pow(2.0, 15.0);
      }

      vec2 get_min_max_from_scaled_waveform(float pos, float scale) {
        int data_index = int(pos * scale);

        vec2 acc = vec2(1.0, -1.0);
        for (int i = 0; float(i) < scale; i += 1) {
          vec2 data_point = get_min_max(data_index + i);
          acc.x = min(acc.x, data_point.x);
          acc.y = max(acc.y, data_point.y);
        }
        return acc;
      }

      void main(void) {
         vec2 value = get_min_max_from_scaled_waveform(gl_FragCoord.x + float(translate_x), scale) * waveform_height * 0.5 + waveform_center;

        if (gl_FragCoord.y > value.x && gl_FragCoord.y < value.y) {
          fragColor = vec4(waveform_color, 1.0);
        } else if (gl_FragCoord.y - 2.0 < value.x && gl_FragCoord.y > value.x) {
          // make line at least two pixels high
          fragColor = vec4(waveform_color, 1.0);
        } else {
          fragColor = vec4(0.0);
        }
      }`,
    );

    this.program = this.createProgram(vertexShader, fragmentShader);

    this.vertices = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [1, 1],
      [-1, 1],
      [-1, -1],
    ];

    const vertexData = new Float32Array(this.vertices.flat());
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.gl.createBuffer());
    this.gl.bufferData(this.gl.ARRAY_BUFFER, vertexData, this.gl.STATIC_DRAW);

    const vertexPosition = this.gl.getAttribLocation(this.program, 'position');
    this.gl.enableVertexAttribArray(vertexPosition);
    this.gl.vertexAttribPointer(vertexPosition, 2, this.gl.FLOAT, false, 0, 0);

    // TODO: handle resizing
    // this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);
    this.uniformLocations = {
      texture: this.getUniformLocation('texture'),
      translate_x: this.getUniformLocation('translate_x'),
      waveform_height: this.getUniformLocation('waveform_height'),
      waveform_center: this.getUniformLocation('waveform_center'),
      waveform_color: this.getUniformLocation('waveform_color'),
      scale: this.getUniformLocation('scale'),
    };
  }

  draw(pos: number, color: [number, number, number]) {
    if (!this.tex) {
      return;
    }

    this.gl.useProgram(this.program);

    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.uniform1i(this.uniformLocations.texture, 0);
    this.useTexture(this.tex);

    this.gl.uniform1i(this.uniformLocations.translate_x, pos);
    this.gl.uniform1f(this.uniformLocations.waveform_height, 100.0);
    this.gl.uniform1f(this.uniformLocations.waveform_center, 50.0);
    this.gl.uniform3f(this.uniformLocations.waveform_color, ...color);
    this.gl.uniform1f(this.uniformLocations.scale, 2);

    this.gl.drawArrays(this.gl.TRIANGLES, 0, this.vertices.length);
    this.gl.flush();
    this.gl.finish();
  }

  setData(dataIter: Iterable<number>) {
    if (this.tex) this.gl.deleteTexture(this.tex);
    this.tex = this.createTex(new Int16Array(dataIter));
  }

  useTexture(texture: WebGLTexture) {
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
  }

  getUniformLocation(name: string) {
    const loc = this.gl.getUniformLocation(this.program, name);
    if (!loc) {
      throw new Error(`Could not get uniform location for ${name}`);
    }
    return loc;
  }

  createTex(data: Int16Array) {
    const max_texture_size = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE);
    const width = Math.min(max_texture_size, data.length / 2);
    let height = Math.ceil(data.length / 2 / width);

    if (height > max_texture_size) {
      console.warn(
        'Trying to create larger texture than supported (MAX_TEXTURE_SIZE = ${max_texture_size}). Texture will be truncated.',
      );
      height = max_texture_size;
    }

    const resizedData = new Int16Array(width * height * 2);
    resizedData.set(data);

    const texture = this.gl.createTexture();
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RG16I,
      width,
      height,
      0,
      this.gl.RG_INTEGER,
      this.gl.SHORT,
      resizedData,
    );
    return texture;
  }

  createShader(
    type: WebGL2RenderingContext['FRAGMENT_SHADER'] | WebGL2RenderingContext['VERTEX_SHADER'],
    source: string,
  ) {
    const shader = this.gl.createShader(type);
    if (!shader) {
      throw new Error('Failed to create shader.');
    }

    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    const success = this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS);
    if (!success) {
      throw new Error(`Error while compiling shader: ${this.gl.getShaderInfoLog(shader)}`);
    }

    return shader;
  }

  createProgram(vertexShader: WebGLShader, fragmentShader: WebGLShader) {
    const program = this.gl.createProgram();
    this.gl.attachShader(program, vertexShader);
    this.gl.attachShader(program, fragmentShader);
    this.gl.linkProgram(program);
    const success = this.gl.getProgramParameter(program, this.gl.LINK_STATUS);
    if (!success) {
      throw new Error(`Failed to link program: ${this.gl.getProgramInfoLog(program)}`);
    }

    return program;
  }
}
