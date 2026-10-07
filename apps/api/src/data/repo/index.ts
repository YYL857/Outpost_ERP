import type { AppEnv } from "../../config/env.js";
import { applyEnvToNoon, loadState } from "../store.js";
import { JsonFileRepository } from "./json-repository.js";
import { PostgresRepository } from "./postgres-repository.js";
import type { AppRepository } from "./types.js";

export function createRepository(env: AppEnv): AppRepository {
  if (env.dataDriver === "postgres") {
    return new PostgresRepository(env.databaseUrl);
  }
  const state = applyEnvToNoon(loadState(), env);
  const repo = new JsonFileRepository(state);
  repo.save();
  return repo;
}

export type { AppRepository } from "./types.js";
