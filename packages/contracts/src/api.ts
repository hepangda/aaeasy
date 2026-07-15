export interface ApiErrorBody {
  error: string;
  detail?: string;
  issues?: Array<{ path: string; message: string }>;
}

export type ActionResult<T = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

export interface SessionUserDto {
  id: string;
  displayName: string;
  username: string | null;
  email: string | null;
  picture: string | null;
  isSuperAdmin: boolean;
}

export interface SessionDto {
  user: SessionUserDto | null;
}
