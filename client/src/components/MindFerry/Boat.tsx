// From the file itself, not `~/utils`: that index loads `utils/agents`, which draws this component.
import cn from '~/utils/cn';

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
