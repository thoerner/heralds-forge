import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  walletConnectWallet,
  metaMaskWallet,
  coinbaseWallet,
  injectedWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { mainnet } from "wagmi/chains";
import { http, createConfig } from "wagmi";

const isMobile =
  typeof window !== "undefined" && /Mobi|Android/i.test(navigator.userAgent);

const projectId =
  (import.meta.env.VITE_WALLET_CONNECT_PROJECT_ID as string) ||
  "00000000000000000000000000000000";

const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets: [
        walletConnectWallet,
        ...(isMobile ? [] : [metaMaskWallet]),
        coinbaseWallet,
        injectedWallet,
      ],
    },
  ],
  { appName: "Herald's Forge", projectId },
);

export const config = createConfig({
  connectors,
  chains: [mainnet],
  transports: {
    [mainnet.id]: http(
      `https://eth-mainnet.g.alchemy.com/v2/${import.meta.env.VITE_ALCHEMY_API_KEY}`,
    ),
  },
  multiInjectedProviderDiscovery: !isMobile,
});
