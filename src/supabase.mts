export interface Database {
  public: {
    Tables: {
      pull_requests: {
        Row: {
          created_at: string;
          id: string;
          kind: string;
          merged: boolean;
          repo: string;
          status: string;
          url: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          kind: string;
          merged?: boolean;
          repo: string;
          status: string;
          url: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          kind?: string;
          merged?: boolean;
          repo?: string;
          status?: string;
          url?: string;
        };
      };
      repositories: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          owner: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          owner: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          owner?: string;
        };
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}
