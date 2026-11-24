/** Subconjunto dos tipos da Bot API do Telegram que o adaptador usa. */

export interface TgUsuario {
  id: number;
}

export interface TgChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel" | string;
}

export interface TgFoto {
  file_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TgDocumento {
  file_id: string;
  mime_type?: string;
  file_size?: number;
}

export interface TgMensagem {
  message_id: number;
  from?: TgUsuario;
  chat: TgChat;
  text?: string;
  caption?: string;
  photo?: TgFoto[];
  document?: TgDocumento;
  voice?: unknown;
  audio?: unknown;
  video?: unknown;
  video_note?: unknown;
  animation?: unknown;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUsuario;
  message?: TgMensagem;
  data?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMensagem;
  callback_query?: TgCallbackQuery;
}

export interface BotaoInline {
  text: string;
  callback_data: string;
}

export interface TecladoInline {
  inline_keyboard: BotaoInline[][];
}
