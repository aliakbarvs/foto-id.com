import { ChangeEvent, CSSProperties, DragEvent, useEffect, useId, useRef, useState } from 'react';

type ProcessingState = 'idle' | 'loading' | 'ready' | 'error';

type ImageState = {
  fileName: string;
  originalUrl: string;
  resultUrl: string;
  downloadName: string;
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

const MAX_FILE_SIZE = 12 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const formatFileSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const createDownloadName = (fileName: string) => {
  const nameWithoutExtension = fileName.replace(/\.[^/.]+$/, '') || 'foto';
  const safeName = nameWithoutExtension
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  return `foto-id-${safeName || 'hasil'}.png`;
};

const progressLabel = (key: string) => {
  const normalizedKey = key.toLowerCase();

  if (normalizedKey.includes('download') || normalizedKey.includes('fetch')) {
    return 'Menyiapkan model AI di browser';
  }

  if (normalizedKey.includes('segment') || normalizedKey.includes('infer')) {
    return 'Memisahkan subjek dari latar';
  }

  return 'Memproses foto';
};

function App() {
  const fileInputId = useId();
  const [processingState, setProcessingState] = useState<ProcessingState>('idle');
  const [imageState, setImageState] = useState<ImageState | null>(null);
  const [progress, setProgress] = useState<ProgressStatus>({
    label: 'Menunggu foto',
    value: 0
  });
  const [errorMessage, setErrorMessage] = useState('');
  const [comparisonValue, setComparisonValue] = useState(52);
  const [isDragging, setIsDragging] = useState(false);
  const objectUrlsRef = useRef<string[]>([]);
  const runIdRef = useRef(0);

  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const rememberObjectUrl = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    objectUrlsRef.current.push(url);
    return url;
  };

  const clearObjectUrls = () => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];
  };

  const validateImage = (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      return 'Gunakan file gambar JPG, PNG, atau WebP.';
    }

    if (file.size > MAX_FILE_SIZE) {
      return `Ukuran foto maksimal ${formatFileSize(MAX_FILE_SIZE)}.`;
    }

    return '';
  };

  const processFile = async (file: File) => {
    const validationMessage = validateImage(file);

    if (validationMessage) {
      runIdRef.current += 1;
      clearObjectUrls();
      setImageState(null);
      setProgress({ label: 'Gagal divalidasi', value: 0 });
      setProcessingState('error');
      setErrorMessage(validationMessage);
      return;
    }

    const currentRunId = runIdRef.current + 1;
    runIdRef.current = currentRunId;
    clearObjectUrls();
    setErrorMessage('');
    setImageState(null);
    setComparisonValue(52);
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

      const resultUrl = rememberObjectUrl(resultBlob);
      setImageState({
        fileName: file.name,
        originalUrl,
        resultUrl,
        downloadName: createDownloadName(file.name)
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
  };

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

  const isLoading = processingState === 'loading';
  const hasResult = processingState === 'ready' && imageState;

  return (
    <main className="app-shell">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">Foto-ID</p>
          <h1 id="hero-title">Hapus background foto dalam hitungan detik.</h1>
          <p className="hero-lede">
            Buat pasfoto, foto profil, dan gambar produk dengan latar transparan. Foto diproses lokal di browser
            saat didukung, dan tidak disimpan oleh Foto-ID.
          </p>
          <div className="trust-row" aria-label="Keunggulan Foto-ID">
            <span>Tanpa upload ke server Foto-ID</span>
            <span>PNG transparan</span>
            <span>Mobile friendly</span>
          </div>
        </div>
        <aside className="privacy-panel" aria-label="Privasi">
          <span className="privacy-icon" aria-hidden="true">
            ID
          </span>
          <div>
            <h2>Privasi tetap di tangan Anda</h2>
            <p>
              Pemrosesan berjalan di perangkat Anda ketika browser mendukung. Foto tidak masuk ke penyimpanan
              Foto-ID.
            </p>
          </div>
        </aside>
      </section>

      <section className="workspace" aria-label="Penghapus background">
        <div className="tool-panel">
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
            <span className="dropzone-title">Pilih foto atau tarik ke sini</span>
            <span id="file-help" className="dropzone-help">
              JPG, PNG, atau WebP. Maksimal {formatFileSize(MAX_FILE_SIZE)}.
            </span>
          </label>

          {isLoading ? (
            <div className="status-card" role="status" aria-live="polite">
              <div className="status-topline">
                <span>{progress.label}</span>
                <span>{progress.value}%</span>
              </div>
              <div className="progress-track" aria-hidden="true">
                <span style={{ width: `${progress.value}%` }} />
              </div>
              <p>Jangan tutup tab ini. Model AI mungkin perlu dimuat saat pemakaian pertama.</p>
            </div>
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
              <h2>Preview akan muncul di sini</h2>
              <p>Bandingkan foto asli dan hasil transparan sebelum mengunduh PNG.</p>
            </div>
          ) : null}

          {isLoading ? (
            <div className="loading-preview" aria-hidden="true">
              <div className="skeleton-image" />
              <div className="skeleton-line" />
              <div className="skeleton-line short" />
            </div>
          ) : null}

          {hasResult ? (
            <div className="result-stack">
              <div className="result-header">
                <div>
                  <p className="result-kicker">Hasil siap</p>
                  <h2>{imageState.fileName}</h2>
                </div>
                <a className="download-button" href={imageState.resultUrl} download={imageState.downloadName}>
                  Unduh PNG transparan
                </a>
              </div>

              <div className="comparison-card">
                <div className="comparison-labels" aria-hidden="true">
                  <span>Asli</span>
                  <span>Transparan</span>
                </div>
                <div className="comparison-frame" style={{ '--comparison': `${comparisonValue}%` } as CSSProperties}>
                  <img src={imageState.resultUrl} alt="Hasil foto dengan background transparan" />
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
