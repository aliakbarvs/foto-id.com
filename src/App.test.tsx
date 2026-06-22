import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const removeBackgroundMock = vi.fn();

vi.mock('@imgly/background-removal', () => ({
  removeBackground: removeBackgroundMock
}));

const objectUrlMock = vi.fn(() => 'blob:foto-id-preview');
const revokeObjectUrlMock = vi.fn();

beforeEach(() => {
  removeBackgroundMock.mockReset();
  removeBackgroundMock.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
  objectUrlMock.mockClear();
  revokeObjectUrlMock.mockClear();
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: objectUrlMock,
    revokeObjectURL: revokeObjectUrlMock
  });
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
      'foto-id-produk.png'
    );
    expect(screen.getByRole('slider', { name: /atur perbandingan/i })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: /warna background/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /transparan/i })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: /merah/i }));
    expect(screen.getByRole('radio', { name: /merah/i })).toBeChecked();
    expect(screen.getByRole('button', { name: /3x4 pasfoto/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /lamaran kerja/i }));
    expect(screen.getByText(/preset: Lamaran kerja/i)).toBeInTheDocument();
    expect(screen.getByText(/hasil siap/i)).toBeInTheDocument();
  });
});
