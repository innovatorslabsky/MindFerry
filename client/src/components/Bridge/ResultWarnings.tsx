import type { TBridgeResultWarning, TBridgeResultWarningCode } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { useLocalize } from '~/hooks';

const MESSAGE: Record<TBridgeResultWarningCode, TranslationKeys> = {
  secret: 'com_bridge_warn_secret',
  banned_claim: 'com_bridge_warn_banned_claim',
  claim_phrase: 'com_bridge_warn_claim_phrase',
  placeholder_example: 'com_bridge_warn_placeholder_example',
  link_data: 'com_bridge_warn_link_data',
  link_credentials: 'com_bridge_warn_link_credentials',
  link_scheme: 'com_bridge_warn_link_scheme',
  link_host: 'com_bridge_warn_link_host',
  hidden_char: 'com_bridge_warn_hidden_char',
};
const ORDER = Object.keys(MESSAGE) as TBridgeResultWarningCode[];
const LINES_SHOWN = 6;

/**
 * What the scan of an agent's result found, in plain words and with the lines to look at. The words
 * named are only ones from the scan's own fixed list or a host name, never text copied from the result.
 */
export default function ResultWarnings({
  warnings,
  omitted = 0,
}: {
  warnings: TBridgeResultWarning[];
  omitted?: number;
}) {
  const localize = useLocalize();
  if (warnings.length === 0) {
    return null;
  }
  const groups = ORDER.map((code) => {
    const found = warnings.filter((w) => w.code === code);
    const terms = [...new Set(found.map((w) => w.term).filter((t): t is string => Boolean(t)))];
    const lines = [...new Set(found.map((w) => w.line).filter((l): l is number => l != null))];
    return { code, count: found.length, terms, lines };
  }).filter((group) => group.count > 0);

  return (
    <section
      aria-label={localize('com_bridge_warn_title')}
      className="border-border-light bg-surface-secondary flex flex-col gap-2 rounded-lg border p-3"
      data-testid="bridge-result-warnings"
    >
      <p className="text-text-primary text-sm font-medium">{localize('com_bridge_warn_title')}</p>
      <ul className="text-text-secondary flex list-disc flex-col gap-1 pl-5 text-xs">
        {groups.map(({ code, terms, lines }) => (
          <li key={code} data-testid={`bridge-warning-${code}`}>
            {localize(MESSAGE[code], { 0: terms.join(', ') })}
            {lines.length > 0 && (
              <>
                {' '}
                {localize('com_bridge_warn_lines', {
                  0: `${lines.slice(0, LINES_SHOWN).join(', ')}${lines.length > LINES_SHOWN ? '…' : ''}`,
                })}
              </>
            )}
          </li>
        ))}
      </ul>
      {omitted > 0 && (
        <p className="text-text-tertiary text-xs">
          {localize('com_bridge_warn_more', { 0: omitted })}
        </p>
      )}
    </section>
  );
}
