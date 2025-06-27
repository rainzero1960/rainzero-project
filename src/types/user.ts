export interface UserData {
  id: number;
  username: string;
  email?: string;
  color_theme_light?: string;
  color_theme_dark?: string;
  display_name?: string;
  points: number;
  chat_background_dark_set?: string;
  chat_background_light_set?: string;
  rag_background_dark_set?: string;
  rag_background_light_set?: string;
  selected_character?: string | null;
  created_at: string;
}