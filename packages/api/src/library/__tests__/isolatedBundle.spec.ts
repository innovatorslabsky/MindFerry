import fs from 'node:fs';
import path from 'node:path';
import { createProcessRunner, supportsPermissionModel } from '../worker/runner';
import { createFakeLibraryMethods } from './helpers/fakeLibraryMethods';
import { UnsupportedUploadError } from '../ingest/upload';
import { createIsolatedIngest } from '../worker/ingest';
import { PdfEncryptedError } from '../pdf/parsePdf';
import { UnsafeUrlError } from '../net/safeFetch';
import { createLibraryService } from '../service';
import { makePdf } from './helpers/pdfFixture';
import { epub3 } from './helpers/epubFixture';

/**
 * Runs the real, built parser program (`dist/library/worker/entry.cjs`) under the permission model.
 * It is the only test that proves the shipped bundle can still read what it needs once it is
 * sandboxed, so it runs whenever the package has been built (CI builds it before testing) and says
 * so loudly when it has not.
 */
const ENTRY = path.resolve(__dirname, '..', '..', '..', 'dist', 'library', 'worker', 'entry.cjs');
const built = fs.existsSync(ENTRY) && supportsPermissionModel();
const suite = built ? describe : describe.skip;

if (!built) {
  console.warn(`[library] isolatedBundle.spec skipped: build @librechat/api first (${ENTRY})`);
}

suite('the built parser, sandboxed', () => {
  const runner = createProcessRunner({ entryPath: ENTRY, timeoutMs: 30_000 });
  const ingest = createIsolatedIngest(runner);

  it('reads a PDF and an EPUB through the whole service', async () => {
    const fake = createFakeLibraryMethods();
    const service = createLibraryService({ methods: fake.methods, ingest });
    const pdf = await service.saveUpload(
      'u1',
      Buffer.from(
        makePdf({ title: 'A Test Paper', pages: [[[72, 720, 'Hello brave new world']]] }),
      ),
    );
    expect(pdf.document).toMatchObject({ kind: 'pdf', title: 'A Test Paper', unitCount: 1 });
    const epub = await service.saveUpload('u1', epub3());
    expect(epub.document).toMatchObject({ kind: 'epub', title: 'The Test Book' });
  }, 60_000);

  it('extracts an article from HTML', async () => {
    const fake = createFakeLibraryMethods();
    const service = createLibraryService({ methods: fake.methods, ingest });
    const page = `<html><head><title>Notes</title></head><body><article><h1>Notes</h1><p>${'Memory decays. '.repeat(30)}</p><p>${'Second paragraph. '.repeat(30)}</p></article></body></html>`;
    const saved = await service.saveFromHtml('u1', 'https://example.test/n', page);
    expect(saved.document.title).toBe('Notes');
  }, 60_000);

  it('keeps the error types the routes depend on across the process boundary', async () => {
    await expect(ingest.ingestUpload(new TextEncoder().encode('plain'))).rejects.toBeInstanceOf(
      UnsupportedUploadError,
    );
    await expect(ingest.saveUrl('http://169.254.169.254/latest/meta-data/')).rejects.toBeInstanceOf(
      UnsafeUrlError,
    );
    const encrypted = makePdf({ pages: [[[72, 720, 'x']]], encrypt: true });
    await expect(ingest.ingestUpload(encrypted)).rejects.toBeInstanceOf(PdfEncryptedError);
  }, 60_000);
});
