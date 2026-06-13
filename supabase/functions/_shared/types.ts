// Minimal Telegram update shapes (only the fields Tachles uses).

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
}

export interface TelegramVoice {
  file_id: string;
  duration: number;
  mime_type?: string;
}

export interface TelegramAudio {
  file_id: string;
  duration: number;
  mime_type?: string;
  file_name?: string;
  file_size?: number;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  caption?: string;
  voice?: TelegramVoice;
  audio?: TelegramAudio;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

// Bot UI shapes (commands list, menu button, reply keyboard).

export interface BotCommand {
  command: string;
  description: string;
}

export interface WebAppInfo {
  url: string;
}

export interface ReplyKeyboardMarkup {
  keyboard: { text: string; web_app?: WebAppInfo }[][];
  resize_keyboard?: boolean;
  is_persistent?: boolean;
  one_time_keyboard?: boolean;
}

export interface ReplyKeyboardRemove {
  remove_keyboard: true;
}

export type MenuButton =
  | { type: "default" }
  | { type: "commands" }
  | { type: "web_app"; text: string; web_app: WebAppInfo };
