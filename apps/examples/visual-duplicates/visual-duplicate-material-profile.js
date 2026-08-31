export function createVisualDuplicateMaterialProfile(options) {
  const profile = options.createDefaultProfile(options.view);
  profile.material.vertexShader = addRoleShineToVertexShader(profile.material.vertexShader);
  profile.material.fragmentShader = addRoleShineToFragmentShader(profile.material.fragmentShader);
  profile.material.needsUpdate = true;
  return profile;
}

function addRoleShineToVertexShader(shader) {
  return replaceOnce(
    replaceOnce(
      replaceOnce(
        shader,
        'attribute float magAbs;',
        'attribute float magAbs;\n  attribute float visual_duplicate_role;',
      ),
      'varying float vWhiteMix;',
      [
        'varying float vWhiteMix;',
        '  varying float vVisualDuplicateRole;',
        '  varying float vStarSpriteScale;',
      ].join('\n'),
    ),
    'gl_PointSize = clamp(radius, 0.0, uSizeMax);',
    [
      'float starPointSize = clamp(radius, 0.0, uSizeMax);',
      '    float shinePointSize = visual_duplicate_role > 0.5 && fade > 0.0',
      '      ? max(starPointSize + 6.0, 15.0)',
      '      : starPointSize;',
      '    gl_PointSize = shinePointSize;',
      '    vVisualDuplicateRole = visual_duplicate_role;',
      '    vStarSpriteScale = starPointSize / max(shinePointSize, 0.0001);',
    ].join('\n'),
  );
}

function addRoleShineToFragmentShader(shader) {
  const withVaryings = replaceOnce(
    shader,
    'varying float vWhiteMix;',
    [
      'varying float vWhiteMix;',
      '  varying float vVisualDuplicateRole;',
      '  varying float vStarSpriteScale;',
    ].join('\n'),
  );
  return replaceOnce(
    withVaryings,
    [
      'float dist = distance(gl_PointCoord, vec2(0.5));',
      '    if (dist > 0.5) discard;',
      '    vec4 texColor = texture2D(map, gl_PointCoord);',
      '    float core = exp(-dist * 18.0);',
      '    float halo = texColor.a;',
      '    vec3 finalColor = mix(vColor, vec3(1.0), core * vWhiteMix);',
      '    float starAlpha = min(halo + core, 1.0) * vAlpha;',
      '    if (starAlpha < 0.003) discard;',
      '    gl_FragColor = vec4(finalColor, starAlpha);',
    ].join('\n'),
    [
      'vec2 starCoord = (gl_PointCoord - vec2(0.5)) / max(vStarSpriteScale, 0.0001) + vec2(0.5);',
      '    bool insideStar = starCoord.x >= 0.0 && starCoord.x <= 1.0 &&',
      '      starCoord.y >= 0.0 && starCoord.y <= 1.0;',
      '    float starAlpha = 0.0;',
      '    vec3 finalColor = vColor;',
      '    if (insideStar) {',
      '      float starDistance = distance(starCoord, vec2(0.5));',
      '      if (starDistance <= 0.5) {',
      '        vec4 texColor = texture2D(map, starCoord);',
      '        float core = exp(-starDistance * 18.0);',
      '        finalColor = mix(vColor, vec3(1.0), core * vWhiteMix);',
      '        starAlpha = min(texColor.a + core, 1.0) * vAlpha;',
      '      }',
      '    }',
      '',
      '    float markerRadius = distance(gl_PointCoord, vec2(0.5));',
      '    float ring = vVisualDuplicateRole < 1.5',
      '      ? smoothstep(0.16, 0.20, markerRadius) *',
      '        (1.0 - smoothstep(0.25, 0.29, markerRadius))',
      '      : smoothstep(0.30, 0.36, markerRadius) *',
      '        (1.0 - smoothstep(0.43, 0.49, markerRadius));',
      '    float shineAlpha = vVisualDuplicateRole > 0.5 ? ring * vAlpha * 0.72 : 0.0;',
      '    if (starAlpha < 0.003 && shineAlpha < 0.003) discard;',
      '',
      '    vec3 gaiaColor = vec3(0.26, 0.91, 1.0);',
      '    vec3 hipColor = vec3(1.0, 0.74, 0.34);',
      '    vec3 shineColor = vVisualDuplicateRole < 1.5 ? gaiaColor : hipColor;',
      '    float combinedAlpha = max(starAlpha, shineAlpha);',
      '    vec3 combinedColor = shineAlpha > starAlpha',
      '      ? mix(finalColor, shineColor, shineAlpha)',
      '      : finalColor;',
      '    gl_FragColor = vec4(combinedColor, combinedAlpha);',
    ].join('\n'),
  );
}

function replaceOnce(source, search, replacement) {
  if (!source.includes(search)) {
    throw new Error('The SkyKit star shader no longer matches the visual-duplicate extension.');
  }
  return source.replace(search, replacement);
}
