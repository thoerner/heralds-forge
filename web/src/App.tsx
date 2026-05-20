import { useState, useEffect, useCallback } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useReadContract, useWriteContract, usePublicClient } from "wagmi";
import {
  HERALDIA_ADDRESS,
  RENDERER_ADDRESS,
  ART_SELECTION_ADDRESS,
  STORAGE_ADDRESS,
  rendererAbi,
  artSelectionAbi,
  storageAbi,
  TRAIT_MAP,
  type TraitName,
} from "./contracts";
import { craftHash, randomSeed, type TraitSelection } from "./hashCraft";
import { usePreview } from "./usePreview";

// ---------------------------------------------------------------------------
// Gallery token type
// ---------------------------------------------------------------------------

interface OwnedToken {
  tokenId: bigint;
  svg: string | null;
}

// ---------------------------------------------------------------------------
// Landing page (not connected)
// ---------------------------------------------------------------------------

function Landing() {
  return (
    <div className="landing">
      <div className="landing-hero">
        <p className="eyebrow">Unofficial community tool</p>
        <h2>Herald&rsquo;s Forge</h2>
        <p className="tagline">
          Craft a custom composition for your Heraldia tokens.
        </p>
        <p className="description">
          A small companion to{" "}
          <a
            href="https://heraldia.art"
            target="_blank"
            rel="noopener noreferrer"
          >
            heraldia.art
          </a>
          . Pick a theme, pattern, and background, preview the result, then
          write it on-chain with <code>selectArt</code>. Not affiliated with
          ab83 or the Heraldia team.
        </p>
        <div className="landing-cta">
          <ConnectButton showBalance={false} />
        </div>
        <div className="landing-links">
          <a
            href="https://heraldia.art"
            target="_blank"
            rel="noopener noreferrer"
          >
            heraldia.art
          </a>
          <span className="sep" />
          <a
            href="https://opensea.io/collection/heraldia"
            target="_blank"
            rel="noopener noreferrer"
          >
            OpenSea
          </a>
          <span className="sep" />
          <a
            href={`https://etherscan.io/address/${HERALDIA_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Etherscan
          </a>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gallery (connected, showing owned tokens)
// ---------------------------------------------------------------------------

const ALCHEMY_API_KEY = import.meta.env.VITE_ALCHEMY_API_KEY as string;

interface AlchemyResponse {
  ownedNfts: { tokenId: string }[];
  totalCount: number;
  pageKey: string | null;
}

async function fetchOwnedTokenIds(owner: string): Promise<bigint[]> {
  const params = new URLSearchParams({
    owner,
    "contractAddresses[]": HERALDIA_ADDRESS,
    withMetadata: "false",
    pageSize: "100",
  });
  const url = `https://eth-mainnet.g.alchemy.com/nft/v3/${ALCHEMY_API_KEY}/getNFTsForOwner?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Alchemy API error: ${res.status}`);
  const data: AlchemyResponse = await res.json();
  return data.ownedNfts.map((nft) => BigInt(nft.tokenId));
}

function Gallery({
  address,
  onSelect,
}: {
  address: `0x${string}`;
  onSelect: (tokenId: bigint) => void;
}) {
  const publicClient = usePublicClient();
  const [tokens, setTokens] = useState<OwnedToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicClient) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const ids = await fetchOwnedTokenIds(address);
        if (cancelled) return;

        if (ids.length === 0) {
          setTokens([]);
          setLoading(false);
          return;
        }

        // Show cards immediately, then fill in SVGs from the on-chain renderer
        setTokens(ids.map((id) => ({ tokenId: id, svg: null })));
        setLoading(false);

        const CONCURRENCY = 5;
        for (let start = 0; start < ids.length; start += CONCURRENCY) {
          const batch = ids.slice(start, start + CONCURRENCY);
          const results = await Promise.allSettled(
            batch.map(async (tokenId) => {
              const uri = await publicClient!.readContract({
                address: RENDERER_ADDRESS,
                abi: rendererAbi,
                functionName: "tokenURI",
                args: [tokenId],
              });
              return { tokenId, svg: extractSvgFromUri(uri) };
            }),
          );
          if (cancelled) return;
          setTokens((prev) =>
            prev.map((t) => {
              const match = results.find(
                (r) =>
                  r.status === "fulfilled" && r.value.tokenId === t.tokenId,
              );
              if (match && match.status === "fulfilled") {
                return { ...t, svg: match.value.svg };
              }
              return t;
            }),
          );
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load tokens");
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [publicClient, address]);

  if (loading) {
    return (
      <div className="gallery-status">
        <p>Loading your Heraldia tokens...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="gallery-status">
        <p className="error-text">{error}</p>
      </div>
    );
  }

  if (tokens.length === 0) {
    return (
      <div className="gallery-status">
        <p>You don't own any Heraldia tokens.</p>
        <p className="hint">
          <a
            href="https://opensea.io/collection/heraldia"
            target="_blank"
            rel="noopener noreferrer"
          >
            Browse the collection on OpenSea
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="gallery">
      <h2 className="section-heading">
        Your Heraldia <span className="count">({tokens.length})</span>
      </h2>
      <div className="gallery-grid">
        {tokens.map((t) => (
          <button
            key={t.tokenId.toString()}
            className="gallery-card"
            onClick={() => onSelect(t.tokenId)}
          >
            <div className="gallery-card-art">
              {t.svg ? (
                <div dangerouslySetInnerHTML={{ __html: t.svg }} />
              ) : (
                <div className="loading">Loading</div>
              )}
            </div>
            <span className="gallery-card-label">
              #{t.tokenId.toString()}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Crafter (token selected)
// ---------------------------------------------------------------------------

function Crafter({
  tokenId,
  ownerAddress,
  onBack,
}: {
  tokenId: bigint;
  ownerAddress: `0x${string}`;
  onBack: () => void;
}) {
  const [traits, setTraits] = useState<TraitSelection>({
    Theme: 0,
    Pattern: 0,
    Background: 0,
  });
  const [seed, setSeed] = useState(() => randomSeed());
  const [copied, setCopied] = useState(false);

  function copyHash() {
    navigator.clipboard.writeText(craftedHash);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const publicClient = usePublicClient();

  // On-chain reads
  const { data: activeHashResult } = useReadContract({
    address: ART_SELECTION_ADDRESS,
    abi: artSelectionAbi,
    functionName: "getActiveHash",
    args: [tokenId],
  });

  const { data: staticHash } = useReadContract({
    address: STORAGE_ADDRESS,
    abi: storageAbi,
    functionName: "getStaticHash",
    args: [tokenId],
  });

  const { data: transferCount } = useReadContract({
    address: STORAGE_ADDRESS,
    abi: storageAbi,
    functionName: "getTransferCount",
    args: [tokenId],
  });

  // Current on-chain artwork
  const [currentSvg, setCurrentSvg] = useState<string | null>(null);
  const [currentTraits, setCurrentTraits] = useState<
    { trait_type: string; value: string }[]
  >([]);
  const [loadingCurrent, setLoadingCurrent] = useState(true);

  const fetchCurrentArt = useCallback(async () => {
    if (!publicClient) return;
    setLoadingCurrent(true);
    try {
      const uri = await publicClient.readContract({
        address: RENDERER_ADDRESS,
        abi: rendererAbi,
        functionName: "tokenURI",
        args: [tokenId],
      });
      const { svg, traits } = parseTokenUri(uri);
      setCurrentSvg(svg);
      setCurrentTraits(traits);
    } catch {
      setCurrentSvg(null);
      setCurrentTraits([]);
    } finally {
      setLoadingCurrent(false);
    }
  }, [publicClient, tokenId]);

  useEffect(() => {
    fetchCurrentArt();
  }, [fetchCurrentArt]);

  // Preview with crafted hash
  const {
    preview,
    loading: previewLoading,
    error: previewError,
    result: previewResult,
  } = usePreview();

  const craftedHash = craftHash(traits, seed);

  const runPreview = useCallback(() => {
    preview(tokenId, craftedHash, ownerAddress);
  }, [tokenId, ownerAddress, craftedHash, preview]);

  useEffect(() => {
    const timer = setTimeout(runPreview, 300);
    return () => clearTimeout(timer);
  }, [traits, seed, runPreview]);

  // Write contracts
  const {
    writeContract: writeSelectArt,
    isPending: selectArtPending,
    isSuccess: selectArtSuccess,
  } = useWriteContract();
  const { writeContract: writeResetArt, isPending: resetArtPending } =
    useWriteContract();

  const hasCustomArt = activeHashResult?.[0] === true;

  useEffect(() => {
    if (selectArtSuccess) {
      const timer = setTimeout(fetchCurrentArt, 3000);
      return () => clearTimeout(timer);
    }
  }, [selectArtSuccess, fetchCurrentArt]);

  function handleSelectArt() {
    writeSelectArt({
      address: ART_SELECTION_ADDRESS,
      abi: artSelectionAbi,
      functionName: "selectArt",
      args: [tokenId, craftedHash],
    });
  }

  function handleResetArt() {
    writeResetArt({
      address: ART_SELECTION_ADDRESS,
      abi: artSelectionAbi,
      functionName: "resetArt",
      args: [tokenId],
    });
  }

  return (
    <>
      <button className="back-btn" onClick={onBack}>
        <span aria-hidden="true">&larr;</span> Gallery
      </button>

      <main>
        <section className="panel current-panel">
          <div className="panel-header">
            <h2>Current</h2>
            <span className="token-id">
              <a
                href={`https://opensea.io/assets/ethereum/${HERALDIA_ADDRESS}/${tokenId}`}
                target="_blank"
                rel="noopener noreferrer"
                title="View on OpenSea"
              >
                #{tokenId.toString()}
              </a>
            </span>
          </div>
          <div className="svg-frame">
            {loadingCurrent ? (
              <div className="loading">Loading</div>
            ) : currentSvg ? (
              <div dangerouslySetInnerHTML={{ __html: currentSvg }} />
            ) : (
              <div className="empty">No artwork</div>
            )}
          </div>
          <div className="info-grid">
            <span className="label">Owner</span>
            <span className="value mono">{truncAddr(ownerAddress)}</span>
            <span className="label">Static Hash</span>
            <span className="value mono">
              {staticHash ? truncHash(staticHash) : "\u2014"}
            </span>
            <span className="label">Transfers</span>
            <span className="value">
              {transferCount !== undefined ? String(transferCount) : "\u2014"}
            </span>
            <span className="label">Custom Art</span>
            <span className="value mono">
              {hasCustomArt ? truncHash(activeHashResult![1]) : "None"}
            </span>
          </div>
          <div className="trait-list">
            {currentTraits.map((t) => (
              <div key={t.trait_type} className="trait-row">
                <span className="trait-name">{t.trait_type}</span>
                <span className="trait-value">{t.value}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel craft-panel">
          <div className="panel-header">
            <h2>Preview</h2>
          </div>

          <div className="controls">
            {(Object.keys(TRAIT_MAP) as TraitName[]).map((traitName) => (
              <div key={traitName} className="control-row">
                <label>{traitName}</label>
                <select
                  value={traits[traitName]}
                  onChange={(e) =>
                    setTraits((prev) => ({
                      ...prev,
                      [traitName]: Number(e.target.value),
                    }))
                  }
                >
                  {TRAIT_MAP[traitName].options.map((opt) => (
                    <option key={opt.index} value={opt.index}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}

            <div className="control-row">
              <label>Color Seed</label>
              <div className="seed-input">
                <input
                  type="number"
                  value={seed}
                  onChange={(e) => setSeed(Number(e.target.value))}
                />
                <button
                  onClick={() => setSeed(randomSeed())}
                  title="Randomize color seed"
                  aria-label="Randomize color seed"
                >
                  ↻
                </button>
              </div>
            </div>
          </div>

          <div className="svg-frame">
            {previewLoading ? (
              <div className="loading">Previewing</div>
            ) : previewError ? (
              <div className="error">{previewError}</div>
            ) : previewResult?.svg ? (
              <div dangerouslySetInnerHTML={{ __html: previewResult.svg }} />
            ) : (
              <div className="empty">Select traits to preview</div>
            )}
          </div>

          {previewResult && (
            <div className="trait-list">
              {previewResult.traits.map((t) => (
                <div key={t.trait_type} className="trait-row">
                  <span className="trait-name">{t.trait_type}</span>
                  <span className="trait-value">{t.value}</span>
                </div>
              ))}
            </div>
          )}

          <div className="hash-display">
            <label>
              <span>Crafted Hash</span>
              {copied && <span className="copy-status">Copied</span>}
            </label>
            <code
              className="hash"
              onClick={copyHash}
              title="Click to copy"
            >
              {craftedHash}
            </code>
          </div>

          <div className="actions">
            <button
              className="btn-primary"
              onClick={handleSelectArt}
              disabled={selectArtPending}
            >
              {selectArtPending ? "Confirming\u2026" : "Apply On-Chain"}
            </button>
            <button
              className="btn-secondary"
              onClick={handleResetArt}
              disabled={!hasCustomArt || resetArtPending}
              title={!hasCustomArt ? "No custom art to reset" : ""}
            >
              {resetArtPending ? "Confirming\u2026" : "Reset Art"}
            </button>
          </div>
        </section>
      </main>
    </>
  );
}

// ---------------------------------------------------------------------------
// Root App
// ---------------------------------------------------------------------------

function App() {
  const { address } = useAccount();
  const [selectedToken, setSelectedToken] = useState<bigint | null>(null);

  // Reset selection when wallet disconnects
  useEffect(() => {
    if (!address) setSelectedToken(null);
  }, [address]);

  return (
    <div className="app">
      <header>
        <h1>Herald&rsquo;s Forge</h1>
        {address && (
          <ConnectButton
            showBalance={false}
            accountStatus={{ smallScreen: "avatar", largeScreen: "full" }}
            chainStatus="none"
          />
        )}
      </header>

      {!address && <Landing />}

      {address && !selectedToken && (
        <Gallery address={address} onSelect={setSelectedToken} />
      )}

      {address && selectedToken !== null && (
        <Crafter
          tokenId={selectedToken}
          ownerAddress={address}
          onBack={() => setSelectedToken(null)}
        />
      )}

      <footer className="app-footer">
        <span>Forged on Ethereum</span>
        <span className="footer-sep">&middot;</span>
        <a
          href={`https://etherscan.io/address/${HERALDIA_ADDRESS}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {HERALDIA_ADDRESS.slice(0, 6)}&hellip;{HERALDIA_ADDRESS.slice(-4)}
        </a>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractSvgFromUri(uri: string): string | null {
  try {
    const jsonB64 = uri.replace("data:application/json;base64,", "");
    const metadata = JSON.parse(atob(jsonB64));
    const img = metadata.image as string;
    if (img?.startsWith("data:image/svg+xml;base64,")) {
      return atob(img.replace("data:image/svg+xml;base64,", ""));
    }
    if (img?.startsWith("data:image/svg+xml,")) {
      return decodeURIComponent(img.replace("data:image/svg+xml,", ""));
    }
  } catch {}
  return null;
}

function parseTokenUri(uri: string): {
  svg: string | null;
  traits: { trait_type: string; value: string }[];
} {
  try {
    const jsonB64 = uri.replace("data:application/json;base64,", "");
    const metadata = JSON.parse(atob(jsonB64));
    const svg = extractSvgFromUri(uri);
    const traits = (metadata.attributes ?? []) as {
      trait_type: string;
      value: string;
    }[];
    return { svg, traits };
  } catch {
    return { svg: null, traits: [] };
  }
}

function truncAddr(addr: string): string {
  return addr.slice(0, 6) + "\u2026" + addr.slice(-4);
}

function truncHash(hash: string): string {
  return hash.slice(0, 10) + "\u2026" + hash.slice(-6);
}

export default App;
