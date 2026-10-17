/** Hands a blob to the browser as a file download, then lets go of it. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Released after the click has been handled; revoking at once can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
