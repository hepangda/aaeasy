import type { Database } from '@aaeasy/db';
import type { WorkerEnv } from './env';

export type AppEnv = {
  Bindings: WorkerEnv;
  Variables: {
    db: Database;
  };
};
