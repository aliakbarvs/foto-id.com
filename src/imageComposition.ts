export type ImageDataLike = {
  width: number;
  height: number;
  data: ArrayLike<number>;
};

export type AlphaBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type CompositionKind = 'official' | 'ecommerce';

export type PresetSpec = {
  id: string;
  label: string;
  output: {
    width: number;
    height: number;
  };
  kind: CompositionKind;
};

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CompositionPlan = {
  preset: PresetSpec;
  output: PresetSpec['output'];
  subjectBounds: AlphaBounds;
  subjectRect: Rect;
  drawImage: Rect;
};

const PRESET_SPECS: PresetSpec[] = [
  { id: '2x3', label: '2x3', output: { width: 600, height: 900 }, kind: 'official' },
  { id: '3x4', label: '3x4', output: { width: 900, height: 1200 }, kind: 'official' },
  { id: '4x6', label: '4x6', output: { width: 800, height: 1200 }, kind: 'official' },
  { id: 'ktp', label: 'KTP', output: { width: 600, height: 900 }, kind: 'official' },
  { id: 'skck', label: 'SKCK', output: { width: 900, height: 1200 }, kind: 'official' },
  { id: 'sekolah', label: 'Sekolah', output: { width: 900, height: 1200 }, kind: 'official' },
  { id: 'lamaran-kerja', label: 'Lamaran kerja', output: { width: 900, height: 1200 }, kind: 'official' },
  { id: 'ecommerce', label: 'Ecommerce', output: { width: 1200, height: 1200 }, kind: 'ecommerce' }
];

const OFFICIAL_TOP_HEADROOM_RATIO = 0.08;
const OFFICIAL_BOTTOM_SPACE_RATIO = 0.12;
const OFFICIAL_MAX_WIDTH_RATIO = 0.82;
const ECOMMERCE_PADDING_RATIO = 0.15;

export const getPresetSpec = (presetId: string) =>
  PRESET_SPECS.find((preset) => preset.id === presetId) ?? PRESET_SPECS[1];

export const detectAlphaBounds = (imageData: ImageDataLike, alphaThreshold = 0): AlphaBounds | null => {
  const { width, height, data } = imageData;
  const expectedRgbaLength = width * height * 4;

  if (width <= 0 || height <= 0 || data.length < expectedRgbaLength) {
    return null;
  }

  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3] ?? 0;

      if (alpha > alphaThreshold) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x + 1);
        bottom = Math.max(bottom, y + 1);
      }
    }
  }

  if (right < 0 || bottom < 0) {
    return null;
  }

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top
  };
};

const fullImageBounds = (sourceWidth: number, sourceHeight: number): AlphaBounds => ({
  left: 0,
  top: 0,
  right: sourceWidth,
  bottom: sourceHeight,
  width: sourceWidth,
  height: sourceHeight
});

const buildPlan = (
  preset: PresetSpec,
  sourceWidth: number,
  sourceHeight: number,
  subjectBounds: AlphaBounds,
  subjectRect: Rect
): CompositionPlan => {
  const scale = subjectRect.width / subjectBounds.width;

  return {
    preset,
    output: preset.output,
    subjectBounds,
    subjectRect,
    drawImage: {
      x: subjectRect.x - subjectBounds.left * scale,
      y: subjectRect.y - subjectBounds.top * scale,
      width: sourceWidth * scale,
      height: sourceHeight * scale
    }
  };
};

export const planImageComposition = ({
  presetId,
  sourceWidth,
  sourceHeight,
  alphaMask
}: {
  presetId: string;
  sourceWidth: number;
  sourceHeight: number;
  alphaMask?: ImageDataLike | null;
}): CompositionPlan => {
  const preset = getPresetSpec(presetId);
  const output = preset.output;
  const detectedBounds = alphaMask ? detectAlphaBounds(alphaMask) : null;
  const subjectBounds = detectedBounds ?? fullImageBounds(sourceWidth, sourceHeight);

  if (preset.kind === 'ecommerce') {
    const maxSubjectSize = output.width * (1 - ECOMMERCE_PADDING_RATIO * 2);
    const scale = Math.min(maxSubjectSize / subjectBounds.width, maxSubjectSize / subjectBounds.height);
    const subjectWidth = subjectBounds.width * scale;
    const subjectHeight = subjectBounds.height * scale;

    return buildPlan(preset, sourceWidth, sourceHeight, subjectBounds, {
      x: (output.width - subjectWidth) / 2,
      y: (output.height - subjectHeight) / 2,
      width: subjectWidth,
      height: subjectHeight
    });
  }

  const maxSubjectWidth = output.width * OFFICIAL_MAX_WIDTH_RATIO;
  const maxSubjectHeight = output.height * (1 - OFFICIAL_TOP_HEADROOM_RATIO - OFFICIAL_BOTTOM_SPACE_RATIO);
  const scale = Math.min(maxSubjectWidth / subjectBounds.width, maxSubjectHeight / subjectBounds.height);
  const subjectWidth = subjectBounds.width * scale;
  const subjectHeight = subjectBounds.height * scale;

  return buildPlan(preset, sourceWidth, sourceHeight, subjectBounds, {
    x: (output.width - subjectWidth) / 2,
    y: output.height * OFFICIAL_TOP_HEADROOM_RATIO,
    width: subjectWidth,
    height: subjectHeight
  });
};
