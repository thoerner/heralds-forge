import { useState, useEffect, useCallback, useRef } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { QRCodeSVG } from "qrcode.react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from "wagmi";
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
import { usePastLooks } from "./usePastLooks";
import { useColorSearch } from "./useColorSearch";
import { useColorSweep } from "./useColorSweep";
import { ACCENT_COLORS } from "./accentColors";

// ---------------------------------------------------------------------------
// Gallery token type
// ---------------------------------------------------------------------------

const DONATE_ADDRESS = "0xc05FFc2fa06DAC5BaF09072752Cc21Cc832f6341";

// ---------------------------------------------------------------------------
// Theme toggle
// ---------------------------------------------------------------------------

type Theme = "dark" | "light";

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "dark";
    return (localStorage.getItem("hf-theme") as Theme) ?? "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("hf-theme", theme);
  }, [theme]);

  const toggle = useCallback(
    () => setTheme((t) => (t === "dark" ? "light" : "dark")),
    [],
  );

  return [theme, toggle];
}

// ---------------------------------------------------------------------------
// Donation QR popover
// ---------------------------------------------------------------------------

function DonateWithQR() {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  function copy() {
    navigator.clipboard.writeText(DONATE_ADDRESS);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  useEffect(() => {
    if (!show) return;
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setShow(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [show]);

  return (
    <div className="donate-row" ref={wrapRef}>
      <span>Donations welcome</span>
      <code
        className="donate-addr"
        onClick={copy}
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        title="Click to copy"
      >
        {copied
          ? "Copied!"
          : `${DONATE_ADDRESS.slice(0, 6)}\u2026${DONATE_ADDRESS.slice(-4)}`}
      </code>
      {show && (
        <div className="qr-popover" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
          <QRCodeSVG
            value={`ethereum:${DONATE_ADDRESS}`}
            size={140}
            bgColor="transparent"
            fgColor="currentColor"
            level="M"
          />
          <span className="qr-label">{DONATE_ADDRESS.slice(0, 10)}&hellip;{DONATE_ADDRESS.slice(-6)}</span>
        </div>
      )}
    </div>
  );
}

interface OwnedToken {
  tokenId: bigint;
  svg: string | null;
}

// ---------------------------------------------------------------------------
// Landing page (not connected)
// ---------------------------------------------------------------------------

const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "Is this an exploit?",
    a: "Not in the \u201csteal funds / take assets\u201d sense. It uses owner permissions already available on-chain. Think \u201cunexpected capability + better tooling,\u201d not contract takeover.",
  },
  {
    q: "Can someone change my NFT without permission?",
    a: "No. Only the current token owner can set artwork for that token.",
  },
  {
    q: "Can you rug or lock tokens?",
    a: "No token custody in Forge. You sign transactions from your own wallet.",
  },
  {
    q: "Why didn\u2019t the core team build this?",
    a: "No idea \u2014 this is just an independent experiment from a holder/dev perspective.",
  },
  {
    q: "This breaks rarity.",
    a: "It changes how people think about rarity: from static traits to evolving provenance + design history.",
  },
  {
    q: "Not official = sketchy.",
    a: "Fair take. That\u2019s why it\u2019s clearly labeled unofficial, with on-chain transparency and owner-only writes.",
  },
  {
    q: "What about malicious inputs?",
    a: "Params are encoded and submitted on-chain via standard wallet signing. Still: always verify tx details before confirming.",
  },
];

function FAQ() {
  return (
    <section className="faq">
      <h3 className="faq-heading">FAQ</h3>
      <div className="faq-list">
        {FAQ_ITEMS.map((item) => (
          <details key={item.q} className="faq-item">
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

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
      <FAQ />
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
  const [overrideHash, setOverrideHash] = useState<`0x${string}` | null>(null);
  const [targetColor, setTargetColor] = useState<string | null>(null);
  const [colorHash, setColorHash] = useState<`0x${string}` | null>(null);

  const publicClient = usePublicClient();

  const {
    search: colorSearch,
    cancel: cancelColorSearch,
    searching: colorSearching,
    progress: colorProgress,
    results: colorResults,
  } = useColorSearch();

  const {
    available: sweepColors,
    colorToHash: sweepColorToHash,
    sweeping,
    progress: sweepProgress,
    hasRun: sweepHasRun,
    startSweep,
  } = useColorSweep(tokenId, ownerAddress, traits);

  const activeHash = overrideHash ?? colorHash ?? craftHash(traits, seed);

  function copyHash() {
    navigator.clipboard.writeText(activeHash);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleTraitChange(traitName: TraitName, value: number) {
    setOverrideHash(null);
    setColorHash(null);
    setTraits((prev) => ({ ...prev, [traitName]: value }));
  }

  function handleSeedChange(value: number) {
    setOverrideHash(null);
    setColorHash(null);
    setSeed(value);
  }

  function handleColorPick(color: string) {
    if (targetColor === color) {
      setTargetColor(null);
      setColorHash(null);
      cancelColorSearch();
      return;
    }
    if (sweepHasRun && !sweeping && sweepColors.size > 0 && !sweepColors.has(color)) return;

    setTargetColor(color);
    setOverrideHash(null);

    const knownHash = sweepColorToHash.get(color);
    if (knownHash) {
      setColorHash(knownHash);
      cancelColorSearch();
    } else {
      setColorHash(null);
      colorSearch(tokenId, ownerAddress, color, traits);
    }
  }

  function handleColorResultPick(result: { hash: `0x${string}`; svg: string }) {
    setColorHash(result.hash);
  }

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

  // Past looks from on-chain events
  const { looks: pastLooks, loading: pastLooksLoading } = usePastLooks(
    tokenId,
    ownerAddress,
  );

  // Preview with active hash
  const {
    preview,
    loading: previewLoading,
    error: previewError,
    result: previewResult,
  } = usePreview();

  const runPreview = useCallback(() => {
    preview(tokenId, activeHash, ownerAddress);
  }, [tokenId, ownerAddress, activeHash, preview]);

  useEffect(() => {
    const timer = setTimeout(runPreview, 300);
    return () => clearTimeout(timer);
  }, [runPreview]);

  // Write contracts
  const {
    writeContract: writeSelectArt,
    isPending: selectArtPending,
    data: selectArtTxHash,
    reset: resetSelectArt,
  } = useWriteContract();
  const {
    writeContract: writeResetArt,
    isPending: resetArtPending,
    data: resetArtTxHash,
    reset: resetResetArt,
  } = useWriteContract();

  const {
    isLoading: selectArtConfirming,
    isSuccess: selectArtConfirmed,
  } = useWaitForTransactionReceipt({ hash: selectArtTxHash });

  const {
    isLoading: resetArtConfirming,
    isSuccess: resetArtConfirmed,
  } = useWaitForTransactionReceipt({ hash: resetArtTxHash });

  const hasCustomArt = activeHashResult?.[0] === true;
  const onChainHash = hasCustomArt ? activeHashResult![1] : null;

  const [txMessage, setTxMessage] = useState<{ type: "success" | "info"; text: string } | null>(null);

  useEffect(() => {
    if (selectArtConfirming) {
      setTxMessage({ type: "info", text: "Transaction pending\u2026" });
    }
  }, [selectArtConfirming]);

  useEffect(() => {
    if (selectArtConfirmed) {
      setTxMessage({ type: "success", text: "Custom art applied on-chain!" });
      fetchCurrentArt();
      const timer = setTimeout(() => {
        setTxMessage(null);
        resetSelectArt();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [selectArtConfirmed, fetchCurrentArt, resetSelectArt]);

  useEffect(() => {
    if (resetArtConfirming) {
      setTxMessage({ type: "info", text: "Transaction pending\u2026" });
    }
  }, [resetArtConfirming]);

  useEffect(() => {
    if (resetArtConfirmed) {
      setTxMessage({ type: "success", text: "Art reset to default!" });
      fetchCurrentArt();
      const timer = setTimeout(() => {
        setTxMessage(null);
        resetResetArt();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [resetArtConfirmed, fetchCurrentArt, resetResetArt]);

  function handleSelectArt() {
    setTxMessage(null);
    writeSelectArt({
      address: ART_SELECTION_ADDRESS,
      abi: artSelectionAbi,
      functionName: "selectArt",
      args: [tokenId, activeHash],
    });
  }

  function handleResetArt() {
    setTxMessage(null);
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

          {pastLooks.length > 0 && (
            <div className="past-looks">
              <h3 className="past-looks-heading">
                Past Looks{" "}
                <span className="count">({pastLooks.length})</span>
              </h3>
              <div className="past-looks-grid">
                {pastLooks.map((look) => (
                  <button
                    key={look.hash}
                    className={`past-look-card${onChainHash === look.hash ? " active" : ""}${overrideHash === look.hash ? " selected" : ""}`}
                    onClick={() => setOverrideHash(look.hash)}
                    title={look.hash}
                  >
                    <div className="past-look-art">
                      {look.svg ? (
                        <div
                          dangerouslySetInnerHTML={{ __html: look.svg }}
                        />
                      ) : (
                        <div className="loading">...</div>
                      )}
                    </div>
                    <span className="past-look-label">
                      {look.hash.slice(0, 6)}&hellip;{look.hash.slice(-4)}
                    </span>
                  </button>
                ))}
              </div>
              {pastLooksLoading && (
                <p className="past-looks-status">Loading previews&hellip;</p>
              )}
            </div>
          )}
        </section>

        <section className="panel craft-panel">
          <div className="panel-header">
            <h2>Preview</h2>
            {overrideHash && (
              <button
                className="override-clear"
                onClick={() => setOverrideHash(null)}
              >
                Back to crafter
              </button>
            )}
          </div>

          {!overrideHash && (
            <div className="controls">
              {(Object.keys(TRAIT_MAP) as TraitName[]).map((traitName) => (
                <div key={traitName} className="control-row">
                  <label>{traitName}</label>
                  <select
                    value={traits[traitName]}
                    onChange={(e) =>
                      handleTraitChange(traitName, Number(e.target.value))
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
                <label>Variation Seed</label>
                <div className="seed-input">
                  <input
                    type="number"
                    value={seed}
                    onChange={(e) => handleSeedChange(Number(e.target.value))}
                  />
                  <button
                    onClick={() => handleSeedChange(randomSeed())}
                    title="Randomize variation seed"
                    aria-label="Randomize variation seed"
                  >
                    ↻
                  </button>
                </div>
              </div>

              <div className="color-picker-section">
                <label>
                  Find Color
                  {targetColor && (
                    <span
                      className="color-active-dot"
                      style={{ background: targetColor }}
                    />
                  )}
                  {!sweeping && sweepColors.size > 0 && (
                    <span className="sweep-status sweep-done">
                      {sweepColors.size} colors
                      <button
                        className="sweep-refresh"
                        onClick={startSweep}
                        title="Rescan for different colors"
                        aria-label="Rescan colors"
                      >
                        ↻
                      </button>
                    </span>
                  )}
                </label>
                {!sweepHasRun && !sweeping ? (
                  <button
                    className="btn-sweep"
                    onClick={startSweep}
                  >
                    Scan Available Colors
                  </button>
                ) : (
                  <div className="color-swatches-wrap">
                    {sweeping && (
                      <div className="color-swatches-overlay">
                        <span className="tx-spinner" />
                        Scanning… {Math.round(sweepProgress * 100)}%
                      </div>
                    )}
                    <div className={`color-swatches${sweeping ? " scanning" : ""}`}>
                      {ACCENT_COLORS.map((c) => {
                        const reachable = sweepColors.has(c);
                        const dimmed = !sweeping && sweepColors.size > 0 && !reachable;
                        return (
                          <button
                            key={c}
                            className={`color-swatch${targetColor === c ? " selected" : ""}${dimmed ? " dimmed" : ""}`}
                            style={{ background: c }}
                            onClick={() => !sweeping && handleColorPick(c)}
                            title={`${c}${dimmed ? " (not found for these traits)" : ""}`}
                            aria-label={`Pick color ${c}`}
                            disabled={sweeping}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
                {colorSearching && (
                  <div className="color-search-status">
                    <span className="tx-spinner" />
                    Searching… {colorProgress.tested} tested, {colorProgress.found} found
                    <button
                      className="color-search-cancel"
                      onClick={() => { cancelColorSearch(); setTargetColor(null); }}
                    >
                      ✕
                    </button>
                  </div>
                )}
                {!colorSearching && targetColor && colorResults.length === 0 && colorProgress.tested > 0 && (
                  <div className="color-search-status color-search-empty">
                    No matches found. Try different traits or search again.
                  </div>
                )}
                {colorResults.length > 0 && (
                  <div className="color-results">
                    <span className="color-results-label">
                      {colorResults.length} match{colorResults.length !== 1 ? "es" : ""}
                    </span>
                    <div className="color-results-grid">
                      {colorResults.map((r) => (
                        <button
                          key={r.hash}
                          className={`color-result-card${overrideHash === r.hash ? " selected" : ""}`}
                          onClick={() => handleColorResultPick(r)}
                          title={r.hash}
                        >
                          <div
                            className="color-result-art"
                            dangerouslySetInnerHTML={{ __html: r.svg }}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

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
              <span>{overrideHash ? "Past Hash" : colorHash ? "Color Match" : "Crafted Hash"}</span>
              {copied && <span className="copy-status">Copied</span>}
            </label>
            <code
              className="hash"
              onClick={copyHash}
              title="Click to copy"
            >
              {activeHash}
            </code>
          </div>

          {txMessage && (
            <div className={`tx-message tx-${txMessage.type}`}>
              {txMessage.type === "info" && <span className="tx-spinner" />}
              {txMessage.text}
            </div>
          )}

          <div className="actions">
            <button
              className="btn-primary"
              onClick={handleSelectArt}
              disabled={selectArtPending || selectArtConfirming}
            >
              {selectArtPending
                ? "Confirm in wallet\u2026"
                : selectArtConfirming
                  ? "Mining\u2026"
                  : "Apply On-Chain"}
            </button>
            <button
              className="btn-secondary"
              onClick={handleResetArt}
              disabled={!hasCustomArt || resetArtPending || resetArtConfirming}
              title={!hasCustomArt ? "No custom art to reset" : ""}
            >
              {resetArtPending
                ? "Confirm in wallet\u2026"
                : resetArtConfirming
                  ? "Mining\u2026"
                  : "Reset Art"}
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
  const [theme, toggleTheme] = useTheme();

  useEffect(() => {
    if (!address) setSelectedToken(null);
  }, [address]);

  return (
    <div className="app">
      <header>
        <h1>Herald&rsquo;s Forge</h1>
        <div className="header-actions">
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            )}
          </button>
          {address && (
            <ConnectButton
              showBalance={false}
              accountStatus={{ smallScreen: "avatar", largeScreen: "full" }}
              chainStatus="none"
            />
          )}
        </div>
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
        <DonateWithQR />
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
