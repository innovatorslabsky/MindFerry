import { DEFAULT_MAX_RESULT_CHARS, MAX_STORED_IMAGE_BYTES, handleJob } from '../worker/job';
import * as upload from '../ingest/upload';

describe('handleJob: how much of a book is kept', () => {
  afterEach(() => jest.restoreAllMocks());

  it('asks the EPUB parser to keep at most 40 MiB of images, and nothing larger is ever sent back', async () => {
    const spy = jest.spyOn(upload, 'ingestUpload').mockResolvedValue({
      kind: 'pdf',
      draft: {} as never,
    });
    const bytes = new Uint8Array([1, 2, 3]);
    await handleJob({ op: 'parseUpload', bytes }, DEFAULT_MAX_RESULT_CHARS);
    expect(MAX_STORED_IMAGE_BYTES).toBe(40 * 1024 * 1024);
    expect(spy).toHaveBeenCalledWith(bytes, {
      epub: { maxImagesTotalBytes: MAX_STORED_IMAGE_BYTES },
    });
  });
});
