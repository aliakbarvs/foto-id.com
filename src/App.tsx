import {
  ChangeEvent,
  CSSProperties,
  DragEvent,
  MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState
} from 'react';
import { getPresetSpec, planImageComposition } from './imageComposition';
import { ensureUpscalerModel, upscaleImage } from './upscaler';

type ProcessingState = 'idle' | 'loading' | 'ready' | 'error';

type PreviewCompositionState = {
  status: ProcessingState;
  url: string;
  errorMessage: string;
};

type ImageState = {
  fileName: string;
  originalUrl: string;
  resultUrl: string;
};

type ProgressStatus = {
  label: string;
  value: number;
};

type RemovalOptions = {
  progress?: (key: string, current: number, total: number) => void;
};

type BackgroundRemovalModule = {
  removeBackground: (image: File, options?: RemovalOptions) => Promise<Blob>;
};

type BackgroundChoiceId = 'transparent' | 'red' | 'blue' | 'white' | 'gray';

type BackgroundChoice = {
  id: BackgroundChoiceId;
  label: string;
  cssValue: string;
  downloadLabel: string;
};

type SizePreset = {
  id: string;
  label: string;
  detail: string;
};

const MAX_FILE_SIZE = 12 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const BACKGROUND_CHOICES: BackgroundChoice[] = [
  { id: 'transparent', label: 'Transparan', cssValue: 'transparent', downloadLabel: 'transparan' },
  { id: 'red', label: 'Merah', cssValue: '#d32027', downloadLabel: 'merah' },
  { id: 'blue', label: 'Biru', cssValue: '#1f6feb', downloadLabel: 'biru' },
  { id: 'white', label: 'Putih', cssValue: '#ffffff', downloadLabel: 'putih' },
  { id: 'gray', label: 'Abu-abu', cssValue: '#e5e7eb', downloadLabel: 'abu-abu' }
];

const SIZE_PRESETS: SizePreset[] = [
  { id: '2x3', label: '2x3', detail: 'Pasfoto kecil' },
  { id: '3x4', label: '3x4', detail: 'Pasfoto' },
  { id: '4x6', label: '4x6', detail: 'Dokumen' },
  { id: 'ktp', label: 'KTP', detail: 'Identitas' },
  { id: 'skck', label: 'SKCK', detail: 'Berkas resmi' },
  { id: 'sekolah', label: 'Sekolah', detail: 'Administrasi' },
  { id: 'lamaran-kerja', label: 'Lamaran kerja', detail: 'CV dan berkas' },
  { id: 'ecommerce', label: 'Ecommerce', detail: 'Foto produk' }
];

const formatFileSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const createSafeBaseName = (fileName: string) => {
  const nameWithoutExtension = fileName.replace(/\.[^/.]+$/, '') || 'foto';
  return nameWithoutExtension
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
};

const createComposedDownloadName = (fileName: string, presetId: string, backgroundLabel: string) => {
  const safeName = createSafeBaseName(fileName) || 'hasil';
  return `foto-id-${safeName}-${presetId}-${backgroundLabel}.png`;
};

const progressLabel = (key: string) => {
  const normalizedKey = key.toLowerCase();

  if (normalizedKey.includes('download') || normalizedKey.includes('fetch')) {
    return 'Menyiapkan model AI di browser';
  }

  if (normalizedKey.includes('segment') || normalizedKey.includes('infer')) {
    return 'AI memproses foto';
  }

  if (normalizedKey.includes('decode')) {
    return 'Membaca foto';
  }

  if (normalizedKey.includes('encode')) {
    return 'Menyusun hasil';
  }

  if (normalizedKey.includes('upscale')) {
    return 'Meningkatkan kualitas';
  }

  return 'Memproses foto';
};

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image failed to load'));
    image.src = src;
  });

const canvasToPngBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }

      reject(new Error('Canvas failed to export'));
    }, 'image/png');
  });

const bitmapToBlob = (bitmap: ImageBitmap): Promise<Blob> => {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas context unavailable');
  }

  ctx.drawImage(bitmap, 0, 0);
  return canvasToPngBlob(canvas);
};

const composePngBlob = async (
  imageUrl: string,
  presetId: string,
  background: BackgroundChoice
): Promise<Blob> => {
  const image = await loadImage(imageUrl);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = sourceWidth;
  maskCanvas.height = sourceHeight;

  const maskContext = maskCanvas.getContext('2d');
  if (!maskContext) {
    throw new Error('Canvas context unavailable');
  }

  maskContext.drawImage(image, 0, 0, sourceWidth, sourceHeight);
  const alphaMask = maskContext.getImageData(0, 0, sourceWidth, sourceHeight);
  const plan = planImageComposition({
    presetId,
    sourceWidth,
    sourceHeight,
    alphaMask
  });

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = plan.output.width;
  outputCanvas.height = plan.output.height;

  const outputContext = outputCanvas.getContext('2d');
  if (!outputContext) {
    throw new Error('Canvas context unavailable');
  }

  if (background.id === 'transparent') {
    outputContext.clearRect(0, 0, plan.output.width, plan.output.height);
  } else {
    outputContext.fillStyle = background.cssValue;
    outputContext.fillRect(0, 0, plan.output.width, plan.output.height);
  }

  const targetWidth = plan.drawImage.width;
  const targetHeight = plan.drawImage.height;

  outputContext.drawImage(
    image,
    plan.drawImage.x,
    plan.drawImage.y,
    targetWidth,
    targetHeight,
    plan.drawImage.x,
    plan.drawImage.y,
    targetWidth,
    targetHeight
  );

  return canvasToPngBlob(outputCanvas);
};

function App() {
  const fileInputId = useId();
  const backgroundLegendId = useId();
  const [processingState, setProcessingState] = useState<ProcessingState>('idle');
  const [imageState, setImageState] = useState<ImageState | null>(null);
  const [progress, setProgress] = useState<ProgressStatus>({
    label: 'Menunggu foto',
    value: 0
  });
  const [selectedBackgroundId, setSelectedBackgroundId] = useState<BackgroundChoiceId>('transparent');
  const [selectedPresetId, setSelectedPresetId] = useState('3x4');
  const [errorMessage, setErrorMessage] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [previewComposition, setPreviewComposition] = useState<PreviewCompositionState>({
    status: 'idle',
    url: '',
    errorMessage: ''
  });
  const [comparisonValue, setComparisonValue] = useState(52);
  const [isDragging, setIsDragging] = useState(false);
  const [isOnboarded, setIsOnboarded] = useState(true);
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  const [upscaleEnabled, setUpscaleEnabled] = useState(false);
  const [upscaleProgress, setUpscaleProgress] = useState({ label: '', value: 0 });
  const objectUrlsRef = useRef<string[]>([]);
  const previewObjectUrlRef = useRef('');
  const runIdRef = useRef(0);
  const previewRunIdRef = useRef(0);

  useEffect(() => {
    const onboarded = window.localStorage.getItem('foto-id-onboarded') === 'true';

    if (!onboarded) {
      setIsOnboarded(false);
    }
  }, []);

  const dismissOnboarding = useCallback(() => {
    window.localStorage.setItem('foto-id-onboarded', 'true');
    setIsOnboarded(true);
  }, []);

  const rememberObjectUrl = useCallback((blobOrFile: Blob | File) => {
    const url = URL.createObjectURL(blobOrFile);
    objectUrlsRef.current.push(url);
    return url;
  }, []);

  const clearObjectUrls = useCallback(() => {
    for (const url of objectUrlsRef.current) {
      URL.revokeObjectURL(url);
    }

    objectUrlsRef.current = [];
  }, []);

  const clearPreviewObjectUrl = useCallback(() => {
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
      previewObjectUrlRef.current = '';
    }
  }, []);

  const resetState = useCallback(() => {
    runIdRef.current += 1;
    previewRunIdRef.current += 1;
    clearObjectUrls();
    clearPreviewObjectUrl();
    setPreviewComposition({ status: 'idle', url: '', errorMessage: '' });
    setImageState(null);
    setProcessingState('idle');
    setProgress({ label: 'Menunggu foto', value: 0 });
    setErrorMessage('');
    setDownloadError('');
    setDownloadSuccess(false);
    setUpscaleProgress({ label: '', value: 0 });
    setUpscaleEnabled(false);
  }, [clearObjectUrls, clearPreviewObjectUrl]);

  const processFile = useCallback(async (file: File) => {
    const { size, type } = file;
    const validationMessage = (() => {
      if (!ACCEPTED_TYPES.includes(type)) {
        return `Format tidak didukung: ${type}. Gunakan JPG, PNG, atau WebP.`;
      }

      if (size > MAX_FILE_SIZE) {
        return `Foto terlalu besar (${formatFileSize(size)}). Maksimal ${formatFileSize(MAX_FILE_SIZE)}.`;
      }

      return '';
    })();

    if (validationMessage) {
      runIdRef.current += 1;
      clearObjectUrls();
      previewRunIdRef.current += 1;
      clearPreviewObjectUrl();
      setPreviewComposition({ status: 'idle', url: '', errorMessage: '' });
      setImageState(null);
      setProgress({ label: 'Gagal divalidasi', value: 0 });
      setProcessingState('error');
      setErrorMessage(validationMessage);
      setDownloadSuccess(false);
      return;
    }

    const currentRunId = runIdRef.current + 1;
    runIdRef.current = currentRunId;
    clearObjectUrls();
    previewRunIdRef.current += 1;
    clearPreviewObjectUrl();
    setPreviewComposition({ status: 'idle', url: '', errorMessage: '' });
    setErrorMessage('');
    setDownloadError('');
    setImageState(null);
    setSelectedBackgroundId('transparent');
    setComparisonValue(52);
    setDownloadSuccess(false);
    setProcessingState('loading');
    setProgress({ label: 'Membaca foto', value: 8 });

    const originalUrl = rememberObjectUrl(file);

    try {
      const { removeBackground } = (await import('@imgly/background-removal')) as BackgroundRemovalModule;
      const resultBlob = await removeBackground(file, {
        progress: (key, current, total) => {
          if (runIdRef.current !== currentRunId) {
            return;
          }

          const nextValue = total > 0 ? Math.min(96, Math.max(12, Math.round((current / total) * 92))) : 48;
          setProgress({
            label: progressLabel(key),
            value: nextValue
          });
        }
      });

      if (runIdRef.current !== currentRunId) {
        URL.revokeObjectURL(originalUrl);
        return;
      }

      let finalResultUrl = rememberObjectUrl(resultBlob);

      if (upscaleEnabled) {
        setProgress({ label: 'Meningkatkan kualitas foto', value: 97 });
        setUpscaleProgress({ label: 'Mempersiapkan peningkatan kualitas', value: 0 });

        try {
          const sourceBitmap = await createImageBitmap(resultBlob);
          let session: any;
          try {
            session = await ensureUpscalerModel((pct) => {
              setUpscaleProgress({ label: 'Mengunduh model AI', value: pct });
            });
          } catch (modelError) {
            const detail = modelError instanceof Error ? modelError.message : String(modelError);
            console.error('[foto-id] upscaler model init failed:', detail);
            throw new Error(`Model AI gagal dimuat: ${detail}`);
          }

          let upscaledBitmap: ImageBitmap;
          try {
            upscaledBitmap = await upscaleImage(sourceBitmap, session, 2);
          } catch (runError) {
            const detail = runError instanceof Error ? runError.message : String(runError);
            console.error('[foto-id] upscaler inference failed:', detail);
            throw new Error(`Peningkatan kualitas gagal saat memproses: ${detail}`);
          }

          sourceBitmap.close();

          const upscaledBlob = await bitmapToBlob(upscaledBitmap);
          upscaledBitmap.close();

          URL.revokeObjectURL(finalResultUrl);
          clearObjectUrls();
          finalResultUrl = rememberObjectUrl(upscaledBlob);

          setUpscaleProgress({ label: 'Selesai meningkatkan kualitas', value: 100 });
        } catch (upscaleError) {
          const message = upscaleError instanceof Error ? upscaleError.message : String(upscaleError);
          console.error('[foto-id] upscaling failed:', message);
          setUpscaleProgress({ label: message || 'Peningkatan kualitas gagal', value: 0 });
        }
      }

      setImageState({
        fileName: file.name,
        originalUrl,
        resultUrl: finalResultUrl
      });
      setProgress({ label: 'Hasil siap', value: 100 });
      setProcessingState('ready');
    } catch {
      if (runIdRef.current !== currentRunId) {
        URL.revokeObjectURL(originalUrl);
        return;
      }

      setProcessingState('error');
      setProgress({ label: 'Gagal diproses', value: 0 });
      setErrorMessage(
        'Foto belum bisa diproses. Coba gambar lain, pastikan koneksi stabil saat model pertama kali dimuat, lalu ulangi.'
      );
    }
  }, [upscaleEnabled, clearObjectUrls, clearPreviewObjectUrl, rememberObjectUrl]);

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = Array.from(event.target.files ?? []);

    if (file) {
      void processFile(file);
    }

    event.target.value = '';
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);

    const [file] = Array.from(event.dataTransfer.files);
    if (file) {
      void processFile(file);
    }
  };

  const handleDragOver = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLLabelElement>) => {
    const nextTarget = event.relatedTarget;

    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
      setIsDragging(false);
    }
  };

  const handleDownload = async (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!imageState) {
      return;
    }

    event.preventDefault();
    setDownloadError('');
    setDownloadSuccess(false);

    try {
      const blob = await composePngBlob(imageState.resultUrl, selectedPresetSpec.id, selectedBackground);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = composedDownloadName;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDownloadSuccess(true);
      window.setTimeout(() => setDownloadSuccess(false), 4000);
    } catch {
      setDownloadError('PNG belum bisa disusun. Coba ulangi unduhan atau proses foto kembali.');
    }
  };

  const isLoading = processingState === 'loading';
  const hasResult = processingState === 'ready' && imageState;
  const hasComposedPreview = previewComposition.status === 'ready' && previewComposition.url;

  const selectedPresetSpec = getPresetSpec(selectedPresetId);
  const selectedBackground = BACKGROUND_CHOICES.find((b) => b.id === selectedBackgroundId)!;
  const presetBehavior = selectedPresetSpec.kind === 'ecommerce' ? 'center' : 'crop';
  const exportDimensions = selectedPresetSpec.kind === 'official'
    ? `${selectedPresetSpec.output.width}×${selectedPresetSpec.output.height}`
    : `disesuaikan`;
  const composedDownloadName = imageState ? createComposedDownloadName(imageState.fileName, selectedPresetSpec.id, selectedBackground.downloadLabel) : '';

  return (
    <main className="app-shell">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">Foto-ID</p>
          <h1 id="hero-title">Pasfoto siap pakai, langsung dari browser.</h1>
          <p className="hero-lede">
            Hapus background untuk pasfoto, profil, lamaran kerja, dan ecommerce. Pilih warna latar Indonesia,
            simpan PNG, dan lanjut tanpa akun.
          </p>
          <div className="trust-row" aria-label="Keunggulan Foto-ID">
            <span>Pasfoto siap pakai</span>
            <span>Proses lokal saat didukung</span>
            <span>PNG transparan atau warna</span>
          </div>
        </div>
        <aside className="privacy-panel" aria-label="Privasi">
          <span className="privacy-icon" aria-hidden="true" />
          <div>
            <h2>Privasi ramah, tanpa penyimpanan</h2>
            <p>
              Foto diproses oleh AI lokal di browser ketika didukung. Gambar Anda tidak disimpan oleh Foto-ID.
            </p>
          </div>
        </aside>
      </section>

      <section className="workspace" aria-label="Wizard pasfoto Foto-ID">
        <div className="tool-panel">
          {!isOnboarded ? (
            <div className="onboarding-strip" role="note" aria-label="Panduan pertama">
              <div className="onboarding-steps">
                <span className="onboarding-step">
                  <span className="onboarding-step-num" aria-hidden="true">1</span>
                  <span>Upload atau tarik foto ke sini</span>
                </span>
                <span className="onboarding-step" aria-hidden="true">→</span>
                <span className="onboarding-step">
                  <span className="onboarding-step-num" aria-hidden="true">2</span>
                  <span>Pilih ukuran dan background</span>
                </span>
                <span className="onboarding-step" aria-hidden="true">→</span>
                <span className="onboarding-step">
                  <span className="onboarding-step-num" aria-hidden="true">3</span>
                  <span>Unduh PNG tanpa watermark</span>
                </span>
              </div>
              <button type="button" className="onboarding-dismiss" onClick={dismissOnboarding}>
                Mengerti
              </button>
            </div>
          ) : null}

          <label
            className={`dropzone${isDragging ? ' is-dragging' : ''}${isLoading ? ' is-loading' : ''}`}
            htmlFor={fileInputId}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <input
              id={fileInputId}
              type="file"
              accept={ACCEPTED_TYPES.join(',')}
              onChange={handleInputChange}
              aria-describedby="file-help"
            />
            <span className="dropzone-mark" aria-hidden="true">
              +
            </span>
            {!imageState && !isLoading ? (
              <>
                <span className="dropzone-title">Tarif foto di sini untuk mulai</span>
                <span id="file-help" className="dropzone-help">
                  Pilih foto atau tarik ke sini. JPG, PNG, atau WebP. Maksimal {formatFileSize(MAX_FILE_SIZE)}.
                </span>
              </>
            ) : (
              <>
                <span className="dropzone-title">Ganti foto</span>
                <span id="file-help" className="dropzone-help">
                  Klik atau tarik foto lain untuk mengganti.
                </span>
              </>
            )}
          </label>

          <section className="preset-card" aria-labelledby="preset-title">
            <div className="section-heading">
              <p className="mini-kicker">Ukuran</p>
              <h2 id="preset-title">Pilih kebutuhan pasfoto</h2>
            </div>
            <div className="preset-grid">
              {SIZE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  className={`preset-button${preset.id === selectedPresetId ? ' is-selected' : ''}`}
                  type="button"
                  aria-label={`${preset.label} ${preset.detail}`}
                  aria-pressed={preset.id === selectedPresetId}
                  onClick={() => setSelectedPresetId(preset.id)}
                >
                  <span>{preset.label}</span>
                  <small>{preset.detail}</small>
                </button>
              ))}
            </div>
            <p className="preset-note">
              Terpilih: {selectedPresetSpec.label} - {presetBehavior}; ekspor {exportDimensions}.
            </p>
          </section>

          {hasResult ? (
            <section className="output-card" aria-labelledby="output-title">
              <div className="section-heading">
                <p className="mini-kicker">Output</p>
                <h2 id="output-title">Atur hasil PNG</h2>
              </div>
              
              <fieldset className="enhancer-fieldset" aria-labelledby="enhancer-label">
                <legend id="enhancer-label" className="mini-kicker">Kualitas</legend>
                <label className="enhancer-toggle" htmlFor="enhance-toggle">
                  <input
                    id="enhance-toggle"
                    type="checkbox"
                    checked={upscaleEnabled}
                    onChange={(event) => setUpscaleEnabled(event.target.checked)}
                  />
                  <span className="enhancer-label-text">
                    <strong>HD (2x upscale)</strong>
                    <small>AI upscaler lokal</small>
                  </span>
                </label>
                {upscaleProgress.label ? (
                  <div className="enhancer-status" role="status" aria-live="polite">
                    <span>{upscaleProgress.label}</span>
                    <span>{upscaleProgress.value}%</span>
                    <div className="enhancer-progress-track" aria-hidden="true">
                      <span style={{ width: `${upscaleProgress.value}%` as string }} />
                    </div>
                  </div>
                ) : null}
              </fieldset>

              <fieldset className="background-control" aria-labelledby={backgroundLegendId}>
                <legend className="mini-kicker" id={backgroundLegendId}>Warna background</legend>
                <div className="background-options" role="radiogroup" aria-labelledby={backgroundLegendId}>
                  {BACKGROUND_CHOICES.map((background) => (
                    <label key={background.id} className="background-option">
                      <input
                        type="radio"
                        name="background"
                        checked={background.id === selectedBackgroundId}
                        onChange={() => setSelectedBackgroundId(background.id)}
                      />
                      <span
                        className={`swatch swatch-${background.id}`}
                        style={{ '--swatch': background.cssValue } as CSSProperties}
                        aria-hidden="true"
                      />
                      <span>{background.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </section>
          ) : null}

          {processingState === 'error' ? (
            <div className="error-card" role="alert">
              <strong>Belum berhasil</strong>
              <p>{errorMessage}</p>
            </div>
          ) : null}
        </div>

        <div className="preview-panel">
          {!imageState && !isLoading ? (
            <div className="empty-state">
              <div className="empty-frame" aria-hidden="true">
                <span />
              </div>
              <h2>Mulai dari satu foto</h2>
              <p>Hasil pasfoto akan muncul di sini setelah background dihapus.</p>
            </div>
          ) : null}

          {isLoading ? (
            <div className="processing-overlay">
              <div className="processing-card">
                <div className="processing-animation">
                  <div className="pulse-ring" />
                  <div className="pulse-ring inner" />
                  <span className="processing-icon">F</span>
                </div>

                <div className="processing-progress">
                  <div className="progress-bar">
                    <span style={{ width: `${progress.value}%` }} />
                  </div>
                  <div className="progress-label-row">
                    <span className="progress-step-label">{progress.label}</span>
                    <span className="progress-value">{progress.value}%</span>
                  </div>
                </div>

                <p className="processing-note">
                  AI berjalan lokal di browser. Jangan tutup tab ini.
                </p>
              </div>
            </div>
          ) : null}

          {hasResult ? (
            <div className="result-stack">
              <div className="result-header">
                <div>
                  <p className="result-kicker">Hasil siap</p>
                  <h2>{imageState.fileName}</h2>
                  <p className="result-meta">
                    Preset: {selectedPresetSpec.label} - {presetBehavior}, ekspor {exportDimensions} · Background:{' '}
                    {selectedBackground.label}
                  </p>
                </div>
                <div className="result-actions">
                  <a
                    className="download-button"
                    href={imageState.resultUrl}
                    download={composedDownloadName}
                    onClick={handleDownload}
                  >
                    Unduh PNG {selectedBackground.downloadLabel} {selectedPresetSpec.label}
                  </a>
                  <button type="button" className="reset-button" onClick={resetState}>
                    Foto baru
                  </button>
                </div>
              </div>
              {downloadError ? (
                <p className="download-error" role="alert">
                  {downloadError}
                </p>
              ) : null}
              {downloadSuccess ? (
                <div className="download-toast" role="status" aria-live="polite">
                  Unduhan berhasil. PNG penuh, tanpa watermark.
                </div>
              ) : null}

              <div className="comparison-card">
                <div className="comparison-labels" aria-hidden="true">
                  <span>Asli</span>
                  <span>Auto crop export</span>
                </div>
                <div
                  className={`comparison-frame background-${selectedBackground.id}`}
                  style={
                    {
                      '--comparison': `${comparisonValue}%`,
                      '--result-background': selectedBackground.cssValue
                    } as CSSProperties
                  }
                >
                  {previewComposition.status === 'loading' ? (
                    <div className="composition-status" role="status" aria-live="polite">
                      Menyusun preview preset...
                    </div>
                  ) : null}
                  {previewComposition.status === 'error' ? (
                    <div className="composition-error" role="alert">
                      {previewComposition.errorMessage}
                    </div>
                  ) : null}
                  {hasComposedPreview ? (
                    <img src={previewComposition.url} alt="Hasil foto sesuai preset export" />
                  ) : null}
                  <div className="comparison-before">
                    <img src={imageState.originalUrl} alt="Foto asli sebelum background dihapus" />
                  </div>
                  <div className="comparison-handle" aria-hidden="true" />
                </div>
                <label className="slider-control">
                  <span>Atur perbandingan</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={comparisonValue}
                    onChange={(event) => setComparisonValue(Number(event.target.value))}
                  />
                </label>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

export default App;
