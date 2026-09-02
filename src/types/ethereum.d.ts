export {};

type EthereumRequestArgs = {
  method: string;
  params?: unknown;
};

declare global {
  interface Window {
    ethereum?: {
      isMetaMask?: boolean;
      request<T = unknown>(args: EthereumRequestArgs): Promise<T>;
    };
  }
}
