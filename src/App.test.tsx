import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const removeBackgroundMock = vi.fn();

vi.mock('@imgly/background-removal', () => ({
  removeBackground: removeBackgroundMock
}));

let objectUrlIndex = 0;
const objectUrlMock = vi.fn(() => {
  objectUrlIndex += 1;
  return `blob:foto-id-preview-${objectUrlIndex}`;
});
const revokeObjectUrlMock = vi.fn();
let canvasMocks: CanvasMocks;

type CanvasMocks = {
  createdAnchors: HTMLAnchorElement[];
  createdCanvases: HTMLCanvasElement[];
  fillRectMock: ReturnType<typeof vi.fn>;
  toBlobMock: ReturnType<typeof vi.fn>;
};

const installImageMock = () => {
  vi.stubGlobal(
    'Image',
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 120;
      naturalHeight = 180;
      width = 120;
      height = 180;

      set src(_src: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
  );
};

const installCanvasMocks = (): CanvasMocks => {
  const createdAnchors: HTMLAnchorElement[] = [];
  const createdCanvases: HTMLCanvasElement[] = [];
  const fillRectMock = vi.fn();
  const toBlobMock = vi.fn((callback: BlobCallback) => {
    callback(new Blob(['composed'], { type: 'image/png' }));
  });
  const originalCreateElement = document.createElement.bind(document);
  const imageData = new Uint8ClampedArray(120 * 180 * 4);

  for (let y = 20; y < 160; y += 1) {
    for (let x = 32; x < 88; x += 1) {
      imageData[(y * 120 + x) * 4 + 3] = 255;
    }
  }

  vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
    const element = originalCreateElement(tagName);

    if (tagName === 'canvas') {
      const canvas = element as HTMLCanvasElement;
      createdCanvases.push(canvas);
      Object.defineProperty(canvas, 'getContext', {
        value: vi.fn(() => ({
          clearRect: vi.fn(),
          drawImage: vi.fn(),
          fillRect: fillRectMock,
          getImageData: vi.fn(() => ({ width: 120, height: 180, data: imageData }))
        }))
      });
      Object.defineProperty(canvas, 'toBlob', { value: toBlobMock });
    }

    if (tagName === 'a') {
      const anchor = element as HTMLAnchorElement;
      createdAnchors.push(anchor);
      vi.spyOn(anchor, 'click').mockImplementation(() => undefined);
    }

    return element;
  }) as typeof document.createElement);

  return { createdAnchors, createdCanvases, fillRectMock, toBlobMock };
};

beforeEach(() => {
  vi.unstubAllGlobals();
  objectUrlIndex = 0;
  removeBackgroundMock.mockReset();
  removeBackgroundMock.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
  objectUrlMock.mockClear();
  revokeObjectUrlMock.mockClear();
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: objectUrlMock,
    revokeObjectURL: revokeObjectUrlMock
  });
  installImageMock();
  canvasMocks = installCanvasMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Foto-ID app', () => {
  it('renders Indonesian-first pasfoto copy, privacy assurance, and size presets', () => {
    render(<App />);

    expect(screen.getByText('Foto-ID')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /pasfoto siap pakai/i })).toBeInTheDocument();
    expect(screen.getByText(/AI lokal di browser/i)).toBeInTheDocument();
    expect(screen.getByText(/tidak disimpan oleh Foto-ID/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2x3/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /3x4/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /4x6/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /KTP/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /SKCK/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sekolah/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /lamaran kerja/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ecommerce/i })).toBeInTheDocument();
  });

  it('rejects oversized uploads with an accessible error', async () => {
    const user = userEvent.setup();
    render(<App />);

    const input = screen.getByLabelText(/pilih foto/i);
    const file = new File([new Uint8Array(13 * 1024 * 1024)], 'besar.jpg', { type: 'image/jpeg' });
    await user.upload(input, file);

    expect(await screen.findByRole('alert')).toHaveTextContent(/ukuran foto maksimal/i);
    expect(removeBackgroundMock).not.toHaveBeenCalled();
  });

  it('removes the background and exposes comparison, color, preset, and download controls', async () => {
    const user = userEvent.setup();
    render(<App />);

    const input = screen.getByLabelText(/pilih foto/i);
    const file = new File(['image'], 'produk.jpg', { type: 'image/jpeg' });
    await user.upload(input, file);

    await waitFor(() => expect(removeBackgroundMock).toHaveBeenCalledWith(file, expect.any(Object)));
    expect(await screen.findByRole('link', { name: /unduh png transparan/i })).toHaveAttribute(
      'download',
      'foto-id-produk-3x4-transparan.png'
    );
    expect(screen.getByRole('slider', { name: /atur perbandingan/i })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: /warna background/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /transparan/i })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: /merah/i }));
    expect(screen.getByRole('radio', { name: /merah/i })).toBeChecked();
    expect(screen.getByRole('button', { name: /3x4 pasfoto/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /lamaran kerja/i }));
    expect(screen.getByText(/preset: Lamaran kerja/i)).toHaveTextContent(/auto crop/i);
    expect(screen.getByText(/preset: Lamaran kerja/i)).toHaveTextContent(/900 x 1200 px/i);
    expect(screen.getByText(/terpilih: Lamaran kerja/i)).toHaveTextContent(/ekspor 900 x 1200 px/i);
    expect(screen.getByText(/hasil siap/i)).toBeInTheDocument();
  });

  it('recomposes the preview and export metadata when ecommerce and KTP presets are selected', async () => {
    const user = userEvent.setup();
    render(<App />);

    const input = screen.getByLabelText(/pilih foto/i);
    const file = new File(['image'], 'produk.jpg', { type: 'image/jpeg' });
    await user.upload(input, file);

    const previewImage = await screen.findByRole('img', { name: /hasil foto sesuai preset export/i });

    await waitFor(() => {
      expect(canvasMocks.toBlobMock).toHaveBeenCalled();
      expect(canvasMocks.createdCanvases.some((canvas) => canvas.width === 900 && canvas.height === 1200)).toBe(true);
    });
    const initialPreviewUrl = previewImage.getAttribute('src');
    expect(screen.getByRole('link', { name: /unduh png transparan 3x4/i })).toHaveAttribute(
      'download',
      'foto-id-produk-3x4-transparan.png'
    );

    await user.click(screen.getByRole('button', { name: /ecommerce/i }));

    await waitFor(() => {
      expect(canvasMocks.createdCanvases.some((canvas) => canvas.width === 1200 && canvas.height === 1200)).toBe(true);
      expect(screen.getByRole('img', { name: /hasil foto sesuai preset export/i })).not.toHaveAttribute(
        'src',
        initialPreviewUrl ?? ''
      );
    });
    const ecommercePreviewUrl = screen
      .getByRole('img', { name: /hasil foto sesuai preset export/i })
      .getAttribute('src');
    expect(screen.getByText(/preset: Ecommerce/i)).toHaveTextContent(/1200 x 1200 px/i);
    expect(screen.getByRole('link', { name: /unduh png transparan ecommerce/i })).toHaveAttribute(
      'download',
      'foto-id-produk-ecommerce-transparan.png'
    );

    await user.click(screen.getByRole('button', { name: /KTP/i }));

    await waitFor(() => {
      expect(canvasMocks.createdCanvases.some((canvas) => canvas.width === 600 && canvas.height === 900)).toBe(true);
      expect(screen.getByRole('img', { name: /hasil foto sesuai preset export/i })).not.toHaveAttribute(
        'src',
        ecommercePreviewUrl ?? ''
      );
    });
    expect(screen.getByText(/preset: KTP/i)).toHaveTextContent(/600 x 900 px/i);
    expect(screen.getByRole('link', { name: /unduh png transparan KTP/i })).toHaveAttribute(
      'download',
      'foto-id-produk-ktp-transparan.png'
    );
  });

  it('recomposes the preset preview and export metadata when a solid background is selected', async () => {
    const user = userEvent.setup();
    render(<App />);

    const input = screen.getByLabelText(/pilih foto/i);
    const file = new File(['image'], 'produk.jpg', { type: 'image/jpeg' });
    await user.upload(input, file);

    const initialPreviewUrl = (
      await screen.findByRole('img', { name: /hasil foto sesuai preset export/i })
    ).getAttribute('src');
    canvasMocks.fillRectMock.mockClear();

    await user.click(screen.getByRole('radio', { name: /merah/i }));

    await waitFor(() => {
      expect(canvasMocks.fillRectMock).toHaveBeenCalled();
      expect(screen.getByRole('img', { name: /hasil foto sesuai preset export/i })).not.toHaveAttribute(
        'src',
        initialPreviewUrl ?? ''
      );
    });
    expect(screen.getByText(/preset: 3x4/i)).toHaveTextContent(/Background: Merah/i);
    expect(screen.getByRole('link', { name: /unduh png merah 3x4/i })).toHaveAttribute(
      'download',
      'foto-id-produk-3x4-merah.png'
    );
  });

  it('shows a preview composition error when preset preview canvas export fails', async () => {
    canvasMocks.toBlobMock.mockImplementation((callback: BlobCallback) => {
      callback(null);
    });
    const user = userEvent.setup();
    render(<App />);

    const input = screen.getByLabelText(/pilih foto/i);
    const file = new File(['image'], 'produk.jpg', { type: 'image/jpeg' });
    await user.upload(input, file);

    expect(await screen.findByRole('alert')).toHaveTextContent(/preview preset belum bisa disusun/i);
  });

  it('composes transparent downloads through a preset-sized PNG canvas', async () => {
    const user = userEvent.setup();
    render(<App />);

    const input = screen.getByLabelText(/pilih foto/i);
    const file = new File(['image'], 'produk.jpg', { type: 'image/jpeg' });
    await user.upload(input, file);

    const downloadLink = await screen.findByRole('link', { name: /unduh png transparan/i });
    const { createdAnchors, createdCanvases, fillRectMock, toBlobMock } = canvasMocks;
    const canvasCountBeforeDownload = createdCanvases.length;
    const anchorCountBeforeDownload = createdAnchors.length;
    fillRectMock.mockClear();
    toBlobMock.mockClear();

    await user.click(downloadLink);

    await waitFor(() => expect(toBlobMock).toHaveBeenCalled());
    expect(createdCanvases[canvasCountBeforeDownload + 1]).toMatchObject({ width: 900, height: 1200 });
    expect(fillRectMock).not.toHaveBeenCalled();
    expect(createdAnchors[anchorCountBeforeDownload]).toMatchObject({ download: 'foto-id-produk-3x4-transparan.png' });

  });
});
