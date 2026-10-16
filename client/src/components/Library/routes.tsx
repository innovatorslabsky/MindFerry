import LibraryGate from './LibraryGate';
import LibraryView from './LibraryView';
import ReaderView from './ReaderView';

export function LibraryListRoute() {
  return (
    <LibraryGate>
      <LibraryView />
    </LibraryGate>
  );
}

export function LibraryReaderRoute() {
  return (
    <LibraryGate>
      <ReaderView />
    </LibraryGate>
  );
}
