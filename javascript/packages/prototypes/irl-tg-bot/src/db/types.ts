export type TUser = {
  id: number;
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

export type TReminderWithChatId = TReminder & { chat_id: number; };
