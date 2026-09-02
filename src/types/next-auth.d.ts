import { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
    } & DefaultSession['user'];
    access_token?: string;
    refresh_token?: string;
    error?: string;
    new_user: boolean;
    referralId?: string;
  }
}

export interface CustomSession {
  user?: {
    id: string;
    name?: string | null;
    email?: string | null;
  } & DefaultSession['user'];
  access_token?: string;
  refresh_token?: string;
  error?: string;
  new_user?: boolean;
  expires: string;
  referralId?: string;
}
