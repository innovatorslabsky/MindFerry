import AskLibraryView from './AskLibraryView';
import LibraryGate from './LibraryGate';
import LibraryView from './LibraryView';
import ReviewView from './ReviewView';
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

export function LibraryReviewRoute() {
  return (
    <LibraryGate>
      <ReviewView />
    </LibraryGate>
  );
}

export function LibraryAskRoute() {
  return (
    <LibraryGate>
      <AskLibraryView />
    </LibraryGate>
  );
}
