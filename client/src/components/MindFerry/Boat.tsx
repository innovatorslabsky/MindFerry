import { cn } from '~/utils';

/** MindFerry's mark, the boat from `assets/logo.svg`, round so it sits where a provider icon would. */
export default function Boat({ className }: { className?: string }) {
  return (
    <img
      src="assets/logo.svg"
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn('shrink-0 rounded-full object-cover', className)}
    />
  );
}
