import { useState, useCallback } from "react";
import {
  encodeFunctionData,
  decodeFunctionResult,
} from "viem";
import { usePublicClient } from "wagmi";
import {
  RENDERER_ADDRESS,
  rendererAbi,
} from "./contracts";
import { buildPreviewStateOverride } from "./stateOverride";

export interface PreviewResult {
  svg: string;
  metadata: Record<string, unknown>;
  traits: { trait_type: string; value: string }[];
}

export function usePreview() {
  const publicClient = usePublicClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PreviewResult | null>(null);

  const preview = useCallback(
    async (
      tokenId: bigint,
      customHash: `0x${string}`,
      owner: `0x${string}`,
    ) => {
      if (!publicClient) {
        setError("No RPC client available");
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const data = encodeFunctionData({
          abi: rendererAbi,
          functionName: "tokenURI",
          args: [tokenId],
        });

        const callResult = await publicClient.call({
          to: RENDERER_ADDRESS,
          data,
          stateOverride: buildPreviewStateOverride(tokenId, customHash, owner),
        });

        const uri = decodeFunctionResult({
          abi: rendererAbi,
          functionName: "tokenURI",
          data: callResult.data!,
        });

        const jsonB64 = (uri as string).replace(
          "data:application/json;base64,",
          "",
        );
        const metadata = JSON.parse(atob(jsonB64));

        let svg = "";
        const imageField = metadata.image as string;
        if (imageField?.startsWith("data:image/svg+xml;base64,")) {
          svg = atob(imageField.replace("data:image/svg+xml;base64,", ""));
        } else if (imageField?.startsWith("data:image/svg+xml,")) {
          svg = decodeURIComponent(
            imageField.replace("data:image/svg+xml,", ""),
          );
        }

        const traits = (metadata.attributes ?? []) as {
          trait_type: string;
          value: string;
        }[];

        setResult({ svg, metadata, traits });
      } catch (e: unknown) {
        const msg =
          e instanceof Error ? e.message : "Preview failed";
        setError(msg);
        setResult(null);
      } finally {
        setLoading(false);
      }
    },
    [publicClient],
  );

  return { preview, loading, error, result };
}
