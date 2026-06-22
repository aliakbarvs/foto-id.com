# Foto-ID Project

Build a polished static web app for foto-id.com: Indonesian-first background remover for ID/profile/ecommerce photos.

## Stack
- Vite + React + TypeScript
- Client-side background removal using `@imgly/background-removal`
- Static deploy output: `dist/`
- No server secrets. No uploading user images to our server.

## Product Requirements
- Dropzone + file picker
- Preview original and processed image
- Before/after comparison slider
- Download transparent PNG
- Indonesian copy first, concise and trustworthy
- Mobile-first responsive UI
- Strong empty, loading, error states
- Privacy message: processing runs locally in the browser where supported; no image storage by Foto-ID

## Quality Bar
- Clean TypeScript build
- Accessible controls and labels
- Avoid generic template look
- Keep dependency footprint reasonable
