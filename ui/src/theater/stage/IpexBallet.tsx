/**
 * IpexBallet — renders all active IPEX ballets as siblings in the SVG
 * ---------------------------------------------------------------------------
 * Phase 3c. Thin wrapper over CredentialPacket — one BalletSequence per
 * active ballet, each sequence emitting a GRANT packet (t=0) and an ADMIT
 * packet (t=+800ms). Both packets travel between buyer and seller positions:
 *   - GRANT: seller → buyer (the issuer hands over the credential)
 *   - ADMIT: buyer → seller (the holder confirms receipt)
 *
 * The 800ms stagger is implemented via CredentialPacket's `delay` prop so
 * we don't need to manage two separate React lifecycles or worry about
 * intermediate state. Both packets mount together; the second one waits
 * its delay before its GSAP timeline begins.
 *
 * Z-order in TheaterStage: IpexBallet sits AFTER EnvelopeLayer so packets
 * draw on top of any in-flight envelopes — including the invoice envelope
 * that triggered this ballet (they fire in parallel per Phase 3c spec).
 *
 * The completion contract: BalletSequence reports done only after BOTH
 * packets have completed. Then useIpexBallet removes the ballet from
 * state, unmounting this component.
 */

import React, { useCallback, useRef } from 'react';
import { CredentialPacket } from './CredentialPacket';
import type { BalletInstance } from './useIpexBallet';
import type { AgentPosition } from './useStageLayout';

interface IpexBalletProps {
  ballets: BalletInstance[];
  positions: Record<string, AgentPosition>;
  onBalletComplete: (balletId: string) => void;
}

export function IpexBallet({ ballets, positions, onBalletComplete }: IpexBalletProps) {
  return (
    <g aria-hidden="true" data-layer="ipex-ballet">
      {ballets.map(ballet => {
        const buyer  = positions.buyer;
        const seller = positions.seller;
        // Defensive — if either endpoint is missing, immediately complete
        // so the ballet doesn't get stuck in state.
        if (!buyer || !seller) {
          queueMicrotask(() => onBalletComplete(ballet.id));
          return null;
        }
        return (
          <BalletSequence
            key={ballet.id}
            ballet={ballet}
            buyer={buyer}
            seller={seller}
            onComplete={() => onBalletComplete(ballet.id)}
          />
        );
      })}
    </g>
  );
}

interface BalletSequenceProps {
  ballet: BalletInstance;
  buyer:  AgentPosition;
  seller: AgentPosition;
  onComplete: () => void;
}

/** One full GRANT→ADMIT ballet. Reports done only after both packets finish. */
function BalletSequence({ ballet, buyer, seller, onComplete }: BalletSequenceProps) {
  // Track completion of each packet — fire onComplete only once both done.
  const doneRef = useRef({ grant: false, admit: false });
  const calledRef = useRef(false);

  const checkBothDone = useCallback(() => {
    if (calledRef.current) return;
    if (doneRef.current.grant && doneRef.current.admit) {
      calledRef.current = true;
      onComplete();
    }
  }, [onComplete]);

  // GRANT: seller (right) → buyer (left). Packet arc is set inside
  // CredentialPacket using the variant-specific arc multiplier.
  // ADMIT: buyer → seller, staggered by 800ms.
  return (
    <>
      <CredentialPacket
        variant="grant"
        fromX={seller.x} fromY={seller.y}
        toX={buyer.x}    toY={buyer.y}
        said={ballet.grantSAID}
        onComplete={() => { doneRef.current.grant = true; checkBothDone(); }}
      />
      <CredentialPacket
        variant="admit"
        delay={800}
        fromX={buyer.x}  fromY={buyer.y}
        toX={seller.x}   toY={seller.y}
        said={ballet.admitSAID || ballet.credentialSAID}
        onComplete={() => { doneRef.current.admit = true; checkBothDone(); }}
      />
    </>
  );
}
