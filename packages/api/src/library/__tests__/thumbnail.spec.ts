import { createFakeLibraryMethods } from './helpers/fakeLibraryMethods';
import { fetchThumbnail, sniffImage } from '../ingest/image';
import { createLibraryService } from '../service';

const PAGE = `<!doctype html><html lang="en"><head><title>Memory notes</title>
<meta property="og:image" content="https://example.test/lead.png"></head>
<body><article><h1>Memory notes</h1><p>${Array.from({ length: 16 }, () => 'Memory decays on a forgetting curve and spacing helps.').join(' ')}</p></article></body></html>`;

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]);
const user = 'user-a';

function setup(fetchImage: jest.Mock) {
  const fake = createFakeLibraryMethods();
  const service = createLibraryService({ methods: fake.methods, fetchImage });
  return { ...fake, service };
}

describe('thumbnails for saved pages', () => {
  it('keeps the lead image of a page beside it', async () => {
    const fetchImage = jest.fn().mockResolvedValue({ mediaType: 'image/png', bytes: PNG });
    const { service, resources } = setup(fetchImage);
    const saved = await service.saveFromHtml(user, 'https://example.test/a', PAGE);
    expect(fetchImage).toHaveBeenCalledWith('https://example.test/lead.png');
    expect(saved.document.thumbnailPath).toBe('__thumbnail__');
    expect(resources.get(`${saved.document.id}:__thumbnail__`)?.mediaType).toBe('image/png');
    const listed = await service.list(user, { limit: 10 });
    expect(listed[0]?.thumbnailPath).toBe('__thumbnail__');
  });

  it('saves the page without a picture when the image cannot be fetched', async () => {
    const fetchImage = jest.fn().mockRejectedValue(new Error('down'));
    const { service } = setup(fetchImage);
    const saved = await service.saveFromHtml(user, 'https://example.test/a', PAGE);
    expect(saved.created).toBe(true);
    expect(saved.document.thumbnailPath).toBeUndefined();
  });

  it('does not fetch the image again for a page that already has one', async () => {
    const fetchImage = jest.fn().mockResolvedValue({ mediaType: 'image/png', bytes: PNG });
    const { service } = setup(fetchImage);
    await service.saveFromHtml(user, 'https://example.test/a', PAGE);
    await service.saveFromHtml(user, 'https://example.test/a', PAGE);
    expect(fetchImage).toHaveBeenCalledTimes(1);
  });
});

describe('sniffImage', () => {
  it('types raster images by their bytes and refuses anything else', () => {
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe('image/jpeg');
    expect(
      sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).toBeNull();
    expect(sniffImage(new TextEncoder().encode('RIFF....WEBPVP8 '))).toBe('image/webp');
  });

  it('gives up quietly when the address is not safe to fetch', async () => {
    expect(await fetchThumbnail('http://127.0.0.1/pic.png')).toBeNull();
  });
});
