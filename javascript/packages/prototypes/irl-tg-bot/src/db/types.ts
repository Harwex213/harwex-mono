export type TUser = {
  id: number;
  role_id: number;
  notify_on_start: boolean;
  user_id: number;
  chat_id: number;
}

export type TReminder = {
  id: number;
  user_id: number;
  content: string;
  target_date: string;
  created_at: string;
  updated_at: string;
}

export const USER_ROLE_ID = {
  ADMIN: 1,
  ANON: 2,
} as const;

export type TUserRole = {
  id: number;
  max_reminders: number | null;
}

export type TReminderWithChatId = TReminder & { chat_id: number; };
