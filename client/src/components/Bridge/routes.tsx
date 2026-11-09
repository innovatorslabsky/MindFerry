import BridgeView from './BridgeView';
import BridgeGate from './BridgeGate';

export function BridgeRoute() {
  return (
    <BridgeGate>
      <BridgeView />
    </BridgeGate>
  );
}
