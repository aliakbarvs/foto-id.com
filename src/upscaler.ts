declare module 'onnxruntime-web';

type ProgressCallback = (progress: number) => void;

type ORTSession = {
  inputNames: string[];
  outputNames: string[];
  run: (feeds: Record<string, unknown>) => Promise<Record<string, { dims: number[]; data: Float32Array }>>;
};

type ORTTensor = {
  dims: number[];
  data: Float32Array;
};

const MODEL_URL = 'https://huggingface.co/xiongjie/lightweight-real-ESRGAN-anime/resolve/main/RealESRGAN_x4plus_anime_4B32F.onnx';
const MODEL_CACHE_KEY = 'foto-id-realesrgan-model';

export async function ensureUpscalerModel(
  onProgress?: ProgressCallback
): Promise<ORTSession> {
  const cached = await getCachedModel();
  if (cached) {
    onProgress?.(100);
    return cached;
  }

  onProgress?.(10);

  let response: Response;
  try {
    response = await fetch(MODEL_URL, {
      mode: 'cors'
    });
  } catch (fetchError) {
    const detail = fetchError instanceof Error ? fetchError.message : String(fetchError);
    console.error('[foto-id] upscaler fetch failed:', detail);
    throw new Error(`Gagal mengunduh model AI: ${detail}`);
  }

  if (!response.ok) {
    console.error('[foto-id] upscaler fetch HTTP error:', response.status, response.statusText);
    throw new Error(`Gagal mengunduh model AI (HTTP ${response.status}).`);
  }

  const contentLength = response.headers.get('content-length');
  const total = contentLength ? Number(contentLength) : 0;
  const chunks: Uint8Array[] = [];

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Streaming tidak didukung di browser ini.');
  }

  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    chunks.push(value);
    loaded += value.length;

    if (total > 0) {
      const pct = Math.min(90, Math.round((loaded / total) * 80) + 10);
      onProgress?.(pct);
    }
  }

  const buffer = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }

  onProgress?.(95);

  try {
    const ort = require('onnxruntime-web') as {
      InferenceSession: new (buffer: ArrayBuffer, options?: { executionProviders?: string[] }) => ORTSession;
      Tensor: new (type: string, data: Float32Array, dims: number[]) => ORTTensor;
    };
    const session = await new (ort.InferenceSession as any)(buffer, {
      executionProviders: ['wasm']
    });

    await cacheModel(buffer);
    onProgress?.(100);

    return session;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('[foto-id] upscaler init failed:', detail);
    throw new Error(`Model AI tidak bisa dijalankan di browser ini: ${detail}`);
  }
}

export async function upscaleImage(
  imageBitmap: ImageBitmap,
  session: ORTSession,
  scale: number = 2
): Promise<ImageBitmap> {
  const sourceWidth = imageBitmap.width;
  const sourceHeight = imageBitmap.height;

  const targetWidth = sourceWidth * scale;
  const targetHeight = sourceHeight * scale;

  const inputTensor = buildInputTensor(imageBitmap, targetWidth, targetHeight);
  const feeds = { [session.inputNames[0]]: inputTensor };

  const results = await session.run(feeds);
  const output = results[session.outputNames[0]];

  return createBitmapFromOutput(output, targetWidth, targetHeight);
}

function buildInputTensor(
  imageBitmap: ImageBitmap,
  targetWidth: number,
  targetHeight: number
) {
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas context tidak tersedia.');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(imageBitmap, 0, 0, targetWidth, targetHeight);

  const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
  const { data } = imageData;

  const float32 = new Float32Array(3 * targetHeight * targetWidth);

  for (let i = 0; i < targetWidth * targetHeight; i++) {
    const srcIdx = i * 4;
    const dstIdx = i;

    float32[dstIdx] = data[srcIdx] / 255;
    float32[targetWidth * targetHeight + dstIdx] = data[srcIdx + 1] / 255;
    float32[2 * targetWidth * targetHeight + dstIdx] = data[srcIdx + 2] / 255;
  }

  const ort = require('onnxruntime-web') as {
    Tensor: new (type: string, data: Float32Array, dims: number[]) => ORTTensor;
  };

  return new ort.Tensor('float32', float32, [1, 3, targetHeight, targetWidth]);
}

function createBitmapFromOutput(
  output: ORTTensor,
  width: number,
  height: number
): Promise<ImageBitmap> {
  const [, channels,,] = output.dims;
  const data = output.data;

  if (channels !== 3) {
    throw new Error(`Output channel tidak didukung: ${channels}`);
  }

  const imageData = new ImageData(width, height);
  const { data: rgba } = imageData;

  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = Math.round(data[i] * 255);
    rgba[i * 4 + 1] = Math.round(data[width * height + i] * 255);
    rgba[i * 4 + 2] = Math.round(data[2 * width * height + i] * 255);
    rgba[i * 4 + 3] = 255;
  }

  return createImageBitmap(imageData);
}

async function getCachedModel(): Promise<ORTSession | null> {
  try {
    if (typeof indexedDB === 'undefined') {
      return null;
    }

    const db = await openDb();
    const tx = db.transaction('models', 'readonly');
    const store = tx.objectStore('models');

    const cached = await new Promise<{ blob?: Blob } | undefined>((resolve) => {
      const request = store.get(MODEL_CACHE_KEY);
      request.onsuccess = () => resolve(request.result as { blob?: Blob } | undefined);
      request.onerror = () => resolve(undefined);
    });

    if (!cached?.blob) {
      return null;
    }

    const buffer = new Uint8Array(await cached.blob.arrayBuffer());
    try {
      const ort = require('onnxruntime-web') as {
        InferenceSession: new (buffer: ArrayBuffer, options?: { executionProviders?: string[] }) => ORTSession;
      };
      return await new (ort.InferenceSession as any)(buffer, {
        executionProviders: ['wasm']
      });
    } catch (cachedError) {
      console.error('[foto-id] upscaler cache restore failed:', cachedError);
      return null;
    }
  } catch {
    return null;
  }
}

async function cacheModel(buffer: Uint8Array): Promise<void> {
  try {
    if (typeof indexedDB === 'undefined') {
      return;
    }

    const db = await openDb();
    const tx = db.transaction('models', 'readwrite');
    const store = tx.objectStore('models');

    await new Promise<void>((resolve, reject) => {
      const request = store.put({
        key: MODEL_CACHE_KEY,
        blob: new Blob([buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)] as BlobPart[]),
        cachedAt: Date.now()
      });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // non-fatal
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('foto-id-upscaler', 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('models')) {
        db.createObjectStore('models');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
