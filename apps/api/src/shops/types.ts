export type ShopRecord = {
  id: string;
  name: string;
  projectCode: string;
  /** Service Account JSON 绝对路径 */
  credentialsFile: string;
  /** 店铺根目录：json / portal-imports / noon-session */
  rootDir: string;
  countryCode: "sa" | "ae" | "eg";
  /** 该店默认同步模式：有 API 凭证时用 live */
  noonMode: "live" | "portal" | "mock";
};

export type ShopsRegistry = {
  version: 1;
  activeShopId: string;
  shops: ShopRecord[];
  updatedAt: string;
};
