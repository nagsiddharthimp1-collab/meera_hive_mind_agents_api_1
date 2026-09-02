export interface UserSettings {
  id: string;
  name: string;
  email: string;
  company_id: number;
  subscription_end_date: string;
  talktime: number;
  talk_time_remaining: number;
  deleted: boolean;
  created_at: string;
  updated_at: string;
  core_memory: string;
}

export interface UpdateUserSettings {
  name?: string;
  email?: string;
}

export interface UserSettingsResponse {
  message: string;
  data: UserSettings;
}

export interface UpdateSettingsResponse {
  message: string;
  data: {
    user_id: string;
  };
}
