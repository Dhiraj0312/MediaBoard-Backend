export interface User {
  id: string;
  email: string;
  created_at: string;
  updated_at: string;
}

export interface Screen {
  id: string;
  name: string;
  device_code: string;
  location?: string;
  status: 'online' | 'offline';
  last_heartbeat?: string;
  created_at: string;
  updated_at: string;
}

export interface Media {
  id: string;
  name: string;
  type: 'image' | 'video';
  file_path: string;
  file_size?: number;
  mime_type?: string;
  duration?: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PlaylistItem {
  id: string;
  playlist_id: string;
  media_id: string;
  order_index: number;
  duration: number;
  created_at: string;
}

export interface ScreenAssignment {
  id: string;
  screen_id: string;
  playlist_id: string;
  assigned_at: string;
}