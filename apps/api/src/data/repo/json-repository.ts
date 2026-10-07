import type { AppState } from "../../common/types.js";
import { loadState, saveState } from "../store.js";
import type { AppRepository } from "./types.js";

export class JsonFileRepository implements AppRepository {
  readonly driver = "json" as const;
  private state: AppState;

  constructor(initial?: AppState) {
    this.state = initial ?? loadState();
  }

  getState() {
    return this.state;
  }

  /** 切换店铺时替换内存态（新引用） */
  replaceState(next: AppState) {
    this.state = next;
  }

  save() {
    saveState(this.state);
  }
}
