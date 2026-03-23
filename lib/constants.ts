export const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"] as const;
export const NICE: Record<string, string> = {
  BTCUSDT: "BTC", ETHUSDT: "ETH", SOLUSDT: "SOL", BNBUSDT: "BNB", XRPUSDT: "XRP",
};
export const SPOT_FEE = 0.001;
export const FUT_FEE = 0.0004;
export const LEVERAGES = [1, 2, 5, 10, 20];
export const STRATEGY_TYPES = ["none", "rsi", "sma_cross", "rsi_sma"] as const;
