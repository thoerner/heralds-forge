import { keccak256, concat, pad, toHex } from "viem";
import {
  ART_SELECTION_ADDRESS,
  ART_SELECTION_V2_ADDRESS,
  COLOR_ANIMATION_ADDRESS,
} from "./contracts";

const V1_MAPPING_SLOT = 2n;
const V2_MAPPING_SLOT = 3n;
const ANIM_MAPPING_SLOT = 2n;
const ZERO =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

function mappingSlot(tokenId: bigint, slot: bigint) {
  return keccak256(
    concat([pad(toHex(tokenId), { size: 32 }), pad(toHex(slot), { size: 32 })]),
  ) as `0x${string}`;
}

function mappingSlots(tokenId: bigint, slot: bigint) {
  const base = mappingSlot(tokenId, slot);
  return {
    slot0: base,
    slot1: toHex(BigInt(base) + 1n, { size: 32 }) as `0x${string}`,
  };
}

export function packSelectedBy(
  address: `0x${string}`,
  isActive: boolean,
): `0x${string}` {
  const addrBig = BigInt(address);
  const activeBit = isActive ? 1n << 160n : 0n;
  return toHex(addrBig | activeBit, { size: 32 });
}

/**
 * Build the stateOverride array for previewing custom art via the renderer.
 *
 * The renderer checks V2 first, then V1. We set the desired hash on V1
 * and clear V2 so the renderer falls through to V1.
 * Optionally sets an animation mode on the color animation contract.
 */
export function buildPreviewStateOverride(
  tokenId: bigint,
  customHash: `0x${string}`,
  owner: `0x${string}`,
  animationMode?: number,
) {
  const v1 = mappingSlots(tokenId, V1_MAPPING_SLOT);
  const v2 = mappingSlots(tokenId, V2_MAPPING_SLOT);
  const packed = packSelectedBy(owner, true);

  const overrides: {
    address: `0x${string}`;
    stateDiff: { slot: `0x${string}`; value: `0x${string}` }[];
  }[] = [
    {
      address: ART_SELECTION_V2_ADDRESS as `0x${string}`,
      stateDiff: [
        { slot: v2.slot0, value: ZERO as `0x${string}` },
        { slot: v2.slot1, value: ZERO as `0x${string}` },
      ],
    },
    {
      address: ART_SELECTION_ADDRESS as `0x${string}`,
      stateDiff: [
        { slot: v1.slot0, value: customHash },
        { slot: v1.slot1, value: packed },
      ],
    },
  ];

  if (animationMode !== undefined) {
    const animSlot = mappingSlot(tokenId, ANIM_MAPPING_SLOT);
    overrides.push({
      address: COLOR_ANIMATION_ADDRESS as `0x${string}`,
      stateDiff: [
        { slot: animSlot, value: toHex(BigInt(animationMode), { size: 32 }) },
      ],
    });
  }

  return overrides;
}
