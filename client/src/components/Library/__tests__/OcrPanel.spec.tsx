import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { mockClient } from 'test/libraryMocks';

let mockSource: { data?: Blob; isLoading: boolean; isError: boolean };
const mockSourceConfigs: Array<{ enabled?: boolean } | undefined> = [];
const mockSave = jest.fn();
const mockRecognize = jest.fn();
const mockTerminate = jest.fn();
const mockDestroy = jest.fn();
const mockRender = jest.fn();
const mockOpen = jest.fn();
const mockCreateEngine = jest.fn();

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}));
jest.mock('~/data-provider', () => ({
  useLibrarySourceQuery: (_id: string, config?: { enabled?: boolean }) => {
    mockSourceConfigs.push(config);
    return config?.enabled ? mockSource : { isLoading: false, isError: false };
  },
  useSaveLibraryUnitTextMutation: () => ({ mutateAsync: mockSave }),
}));
jest.mock('~/utils/ocr', () => ({
  ...jest.requireActual('~/utils/ocr'),
  createOcrEngine: (...args: unknown[]) => mockCreateEngine(...args),
}));
jest.mock('~/utils/pdfPages', () => ({ openPdfPages: (...args: unknown[]) => mockOpen(...args) }));
jest.mock('@librechat/client', () => mockClient);

import OcrPanel from '../OcrPanel';

const blob = () => {
  const file = new Blob(['%PDF-1.7']);
  Object.assign(file, { arrayBuffer: async () => new ArrayBuffer(8) });
  return file;
};
const apiError = (code: string) => ({ response: { data: { error: { code } } } });

beforeEach(() => {
  localStorage.clear();
  mockSource = { data: blob(), isLoading: false, isError: false };
  mockSourceConfigs.length = 0;
  mockSave.mockResolvedValue({});
  mockRecognize.mockResolvedValue('Some text read from the page.');
  mockTerminate.mockResolvedValue(undefined);
  mockDestroy.mockResolvedValue(undefined);
  mockRender.mockReturnValue({ promise: Promise.resolve(), cancel: jest.fn() });
  mockOpen.mockResolvedValue({ numPages: 5, render: mockRender, destroy: mockDestroy });
  mockCreateEngine.mockResolvedValue({ recognize: mockRecognize, terminate: mockTerminate });
});
afterEach(() => jest.clearAllMocks());

describe('OcrPanel', () => {
  it('shows nothing when no page is blank', () => {
    const { container } = render(<OcrPanel documentId="d1" blankPages={[]} currentPage={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers the current page only when it is blank, and does not fetch the file until asked', () => {
    const { rerender } = render(<OcrPanel documentId="d1" blankPages={[1, 3]} currentPage={0} />);
    expect(screen.getByText('com_library_ocr_blank:2')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'com_library_ocr_this' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'com_library_ocr_all:2' })).toBeInTheDocument();
    expect(mockSourceConfigs.every((config) => config?.enabled === false)).toBe(true);
    rerender(<OcrPanel documentId="d1" blankPages={[1, 3]} currentPage={1} />);
    expect(screen.getByRole('button', { name: 'com_library_ocr_this' })).toBeInTheDocument();
  });

  it('reads the chosen page at OCR size and saves its text', async () => {
    render(<OcrPanel documentId="d1" blankPages={[1, 3]} currentPage={1} />);
    fireEvent.click(screen.getByRole('button', { name: 'com_library_ocr_this' }));
    await waitFor(() => expect(screen.getByText('com_library_ocr_done:1,0')).toBeInTheDocument());
    expect(mockRender).toHaveBeenCalledTimes(1);
    expect(mockRender).toHaveBeenCalledWith(2, expect.any(HTMLCanvasElement), 1700, 1);
    expect(mockSave).toHaveBeenCalledWith({
      id: 'd1',
      index: 1,
      text: 'Some text read from the page.',
    });
    expect(mockTerminate).toHaveBeenCalled();
    expect(mockDestroy).toHaveBeenCalled();
  });

  it('reads every blank page in order and counts pages with nothing readable', async () => {
    mockSave
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(apiError('empty_text'))
      .mockRejectedValueOnce(apiError('has_text'));
    render(<OcrPanel documentId="d1" blankPages={[0, 2, 4]} currentPage={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'com_library_ocr_all:3' }));
    await waitFor(() => expect(screen.getByText('com_library_ocr_done:1,2')).toBeInTheDocument());
    expect(mockSave.mock.calls.map(([call]) => call.index)).toEqual([0, 2, 4]);
    // Only the result is shown afterwards, not a count that may not have refreshed.
    expect(screen.queryByText(/com_library_ocr_blank/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /com_library_ocr_all/ })).not.toBeInTheDocument();
  });

  it('says so, and stops, when reading fails for another reason', async () => {
    mockCreateEngine.mockRejectedValueOnce(new Error('wasm blocked'));
    render(<OcrPanel documentId="d1" blankPages={[0]} currentPage={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'com_library_ocr_all:1' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('com_library_ocr_error');
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockDestroy).toHaveBeenCalled();
  });

  it('fails the run when saving fails for a reason other than an empty or filled page', async () => {
    mockSave.mockRejectedValueOnce(apiError('not_found'));
    render(<OcrPanel documentId="d1" blankPages={[0, 1]} currentPage={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'com_library_ocr_all:2' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('com_library_ocr_error');
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it("starts from the document's own language", () => {
    render(<OcrPanel documentId="d1" blankPages={[0]} currentPage={0} documentLang="vi" />);
    expect(screen.getByLabelText('com_library_ocr_language')).toHaveValue('vie');
  });

  it.each([
    ['zh-CN', 'chi_sim'],
    ['ja', 'jpn'],
    ['ko-KR', 'kor'],
    ['fr', 'fra'],
    ['es-MX', 'spa'],
    ['de', 'deu'],
    [undefined, 'eng'],
    ['pt', 'eng'],
  ])('maps the document language %s to %s', (lang, expected) => {
    render(<OcrPanel documentId="d1" blankPages={[0]} currentPage={0} documentLang={lang} />);
    expect(screen.getByLabelText('com_library_ocr_language')).toHaveValue(expected);
  });

  it('reads with the language chosen, and remembers it on this device', async () => {
    const { unmount } = render(<OcrPanel documentId="d1" blankPages={[0]} currentPage={0} />);
    fireEvent.change(screen.getByLabelText('com_library_ocr_language'), {
      target: { value: 'jpn' },
    });
    expect(localStorage.getItem('libraryOcrLanguage')).toBe('jpn');
    fireEvent.click(screen.getByRole('button', { name: /com_library_ocr_all/ }));
    await waitFor(() => expect(mockCreateEngine).toHaveBeenCalledWith('jpn'));
    await screen.findByText(/com_library_ocr_done/);
    unmount();
    render(<OcrPanel documentId="d2" blankPages={[0]} currentPage={0} documentLang="fr" />);
    expect(screen.getByLabelText('com_library_ocr_language')).toHaveValue('jpn');
  });

  it('ignores a remembered language that is not on the list', () => {
    localStorage.setItem('libraryOcrLanguage', 'klingon');
    render(<OcrPanel documentId="d1" blankPages={[0]} currentPage={0} documentLang="de" />);
    expect(screen.getByLabelText('com_library_ocr_language')).toHaveValue('deu');
  });

  it('stops after the page being read when cancelled', async () => {
    let release: () => void = () => undefined;
    mockRecognize.mockImplementationOnce(
      () => new Promise<string>((resolve) => (release = () => resolve('Text for the first page.'))),
    );
    render(<OcrPanel documentId="d1" blankPages={[0, 1, 2]} currentPage={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'com_library_ocr_all:3' }));
    fireEvent.click(await screen.findByRole('button', { name: 'com_library_ocr_cancel' }));
    await act(async () => release());
    await waitFor(() => expect(screen.getByText('com_library_ocr_done:1,0')).toBeInTheDocument());
    expect(mockSave).toHaveBeenCalledTimes(1);
  });
});
