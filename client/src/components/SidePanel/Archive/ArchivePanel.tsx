import HubArchiveBrowser from '~/components/Nav/SettingsTabs/ApiKeys/HubArchiveBrowser';

/** The MindFerry archive as a sidebar panel — the same browser the Settings dialog hosts, without the trip through Settings. */
export default function ArchivePanel() {
  return (
    <div className="flex h-full min-h-0 flex-col p-2">
      <HubArchiveBrowser />
    </div>
  );
}
