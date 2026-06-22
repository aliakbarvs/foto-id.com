import { describe, expect, it } from 'vitest';
import {
  detectAlphaBounds,
  getPresetSpec,
  planImageComposition,
  type ImageDataLike
} from './imageComposition';

const imageData = (width: number, height: number, alphaByPixel: number[]): ImageDataLike => {
  const data = new Uint8ClampedArray(width * height * 4);

  alphaByPixel.forEach((alpha, index) => {
    data[index * 4] = 20;
    data[index * 4 + 1] = 40;
    data[index * 4 + 2] = 60;
    data[index * 4 + 3] = alpha;
  });

  return { width, height, data };
};

describe('detectAlphaBounds', () => {
  it('detects the non-transparent alpha mask bounding box from ImageData-like data', () => {
    const bounds = detectAlphaBounds(
      imageData(5, 4, [
        0, 0, 0, 0, 0,
        0, 255, 255, 255, 0,
        0, 255, 255, 0, 0,
        0, 0, 0, 0, 0
      ])
    );

    expect(bounds).toEqual({
      left: 1,
      top: 1,
      right: 4,
      bottom: 3,
      width: 3,
      height: 2
    });
  });

  it('returns null when the cutout is fully transparent or has no alpha channel', () => {
    expect(detectAlphaBounds(imageData(2, 2, [0, 0, 0, 0]))).toBeNull();
    expect(detectAlphaBounds({ width: 2, height: 2, data: new Uint8ClampedArray(2 * 2 * 3) })).toBeNull();
  });
});

describe('planImageComposition', () => {
  it('plans pasfoto and KTP exports with real aspect dimensions, centered subjects, and headroom', () => {
    const mask = imageData(120, 180, new Array(120 * 180).fill(0));
    const data = mask.data as Uint8ClampedArray;

    for (let y = 20; y < 160; y += 1) {
      for (let x = 32; x < 88; x += 1) {
        data[(y * 120 + x) * 4 + 3] = 255;
      }
    }

    const pasfotoPlan = planImageComposition({
      presetId: '3x4',
      sourceWidth: 120,
      sourceHeight: 180,
      alphaMask: mask
    });
    const ktpPlan = planImageComposition({
      presetId: 'ktp',
      sourceWidth: 120,
      sourceHeight: 180,
      alphaMask: mask
    });

    expect(pasfotoPlan.output).toEqual({ width: 900, height: 1200 });
    expect(pasfotoPlan.output.width / pasfotoPlan.output.height).toBeCloseTo(3 / 4, 4);
    expect(pasfotoPlan.subjectRect.x + pasfotoPlan.subjectRect.width / 2).toBeCloseTo(450, 0);
    expect(pasfotoPlan.subjectRect.y).toBeCloseTo(96, 0);
    expect(pasfotoPlan.drawImage.width).toBeGreaterThan(pasfotoPlan.subjectRect.width);
    expect(pasfotoPlan.drawImage.height).toBeGreaterThan(pasfotoPlan.subjectRect.height);

    expect(ktpPlan.output).toEqual({ width: 600, height: 900 });
    expect(ktpPlan.output.width / ktpPlan.output.height).toBeCloseTo(2 / 3, 4);
    expect(ktpPlan.subjectRect.x + ktpPlan.subjectRect.width / 2).toBeCloseTo(300, 0);
    expect(ktpPlan.subjectRect.y).toBeCloseTo(72, 0);
  });

  it('plans ecommerce exports as square canvases with centered object padding', () => {
    const mask = imageData(200, 120, new Array(200 * 120).fill(0));
    const data = mask.data as Uint8ClampedArray;

    for (let y = 34; y < 86; y += 1) {
      for (let x = 40; x < 160; x += 1) {
        data[(y * 200 + x) * 4 + 3] = 255;
      }
    }

    const plan = planImageComposition({
      presetId: 'ecommerce',
      sourceWidth: 200,
      sourceHeight: 120,
      alphaMask: mask
    });

    expect(plan.output).toEqual({ width: 1200, height: 1200 });
    expect(plan.subjectRect.x).toBeCloseTo(180, 0);
    expect(plan.subjectRect.y).toBeCloseTo(418, 0);
    expect(plan.subjectRect.width).toBeCloseTo(840, 0);
    expect(plan.subjectRect.height).toBeCloseTo(364, 0);
  });

  it('falls back to the full image when there is no usable alpha mask', () => {
    const plan = planImageComposition({
      presetId: 'ecommerce',
      sourceWidth: 640,
      sourceHeight: 480,
      alphaMask: imageData(640, 480, new Array(640 * 480).fill(0))
    });
    const noAlphaPlan = planImageComposition({
      presetId: 'ecommerce',
      sourceWidth: 640,
      sourceHeight: 480,
      alphaMask: { width: 640, height: 480, data: new Uint8ClampedArray(640 * 480 * 3) }
    });

    expect(plan.subjectBounds).toEqual({ left: 0, top: 0, right: 640, bottom: 480, width: 640, height: 480 });
    expect(noAlphaPlan.subjectBounds).toEqual(plan.subjectBounds);
    expect(plan.subjectRect.x).toBeCloseTo(180, 0);
    expect(plan.subjectRect.y).toBeCloseTo(285, 0);
    expect(plan.subjectRect.width).toBeCloseTo(840, 0);
    expect(plan.subjectRect.height).toBeCloseTo(630, 0);
  });

  it('exposes preset specs for UI copy and export names', () => {
    expect(getPresetSpec('3x4')).toMatchObject({
      id: '3x4',
      label: '3x4',
      output: { width: 900, height: 1200 }
    });
  });
});
