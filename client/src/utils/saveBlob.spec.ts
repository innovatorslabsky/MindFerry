import { saveBlob } from './saveBlob';

describe('saveBlob', () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    jest.useRealTimers();
  });

  it('clicks a download link with the file name, removes it, and releases the blob later', () => {
    jest.useFakeTimers();
    URL.createObjectURL = jest.fn(() => 'blob:fake');
    URL.revokeObjectURL = jest.fn();
    const clicked: Array<{ href: string; download: string }> = [];
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ href: this.href, download: this.download });
    });
    saveBlob(new Blob(['hello']), 'notes.md');
    expect(clicked).toEqual([{ href: 'blob:fake', download: 'notes.md' }]);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    click.mockRestore();
  });
});
