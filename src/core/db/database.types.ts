export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accounting_periods: {
        Row: {
          created_at: string
          id: string
          locked_at: string | null
          locked_by: string | null
          note: string | null
          period_month: string
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          note?: string | null
          period_month: string
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          note?: string | null
          period_month?: string
          status?: string
        }
        Relationships: []
      }
      alert_dismissals: {
        Row: {
          dismissed_at: string
          key: string
        }
        Insert: {
          dismissed_at?: string
          key: string
        }
        Update: {
          dismissed_at?: string
          key?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor: string | null
          created_at: string
          detail: Json | null
          entity_id: string | null
          entity_type: string
          id: string
          occurred_at: string
          prev_hash: string | null
          row_hash: string | null
          seq: number
        }
        Insert: {
          action: string
          actor?: string | null
          created_at?: string
          detail?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
          occurred_at?: string
          prev_hash?: string | null
          row_hash?: string | null
          seq?: number
        }
        Update: {
          action?: string
          actor?: string | null
          created_at?: string
          detail?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          occurred_at?: string
          prev_hash?: string | null
          row_hash?: string | null
          seq?: number
        }
        Relationships: []
      }
      cash_reconciliations: {
        Row: {
          account_id: string
          count_date: string
          counted_amount: number
          created_at: string
          difference: number | null
          expected_balance: number
          id: string
          notes: string | null
        }
        Insert: {
          account_id: string
          count_date: string
          counted_amount: number
          created_at?: string
          difference?: number | null
          expected_balance: number
          id?: string
          notes?: string | null
        }
        Update: {
          account_id?: string
          count_date?: string
          counted_amount?: number
          created_at?: string
          difference?: number | null
          expected_balance?: number
          id?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_reconciliations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "money_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      channels: {
        Row: {
          active: boolean
          created_at: string
          id: string
          kind: string
          name: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          kind?: string
          name: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          kind?: string
          name?: string
        }
        Relationships: []
      }
      cheques: {
        Row: {
          amount_received: number | null
          created_at: string
          difference: number | null
          due_date: string | null
          edited_at: string | null
          expected_amount: number
          id: string
          notes: string | null
          received_date: string | null
          settlement_period_id: string
          status: Database["public"]["Enums"]["cheque_status"]
          updated_at: string
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          amount_received?: number | null
          created_at?: string
          difference?: number | null
          due_date?: string | null
          edited_at?: string | null
          expected_amount: number
          id?: string
          notes?: string | null
          received_date?: string | null
          settlement_period_id: string
          status?: Database["public"]["Enums"]["cheque_status"]
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          amount_received?: number | null
          created_at?: string
          difference?: number | null
          due_date?: string | null
          edited_at?: string | null
          expected_amount?: number
          id?: string
          notes?: string | null
          received_date?: string | null
          settlement_period_id?: string
          status?: Database["public"]["Enums"]["cheque_status"]
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cheques_settlement_period_id_fkey"
            columns: ["settlement_period_id"]
            isOneToOne: false
            referencedRelation: "settlement_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cheques_settlement_period_id_fkey"
            columns: ["settlement_period_id"]
            isOneToOne: false
            referencedRelation: "v_open_settlement"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_snapshots: {
        Row: {
          cash_balance: number | null
          cogs: number | null
          computed_at: string
          created_at: string
          data_confidence: Database["public"]["Enums"]["verification_status"]
          gross_profit: number | null
          has_activity: boolean
          health_score: number | null
          health_score_config_ref: string | null
          id: string
          inventory_value: number | null
          is_backfilled: boolean
          is_gap_filled: boolean
          location_id: string
          operating_profit: number | null
          pct_estimated: number
          revenue: number | null
          settlement_value: number | null
          snapshot_date: string
          source: Database["public"]["Enums"]["snapshot_source"]
          updated_at: string
        }
        Insert: {
          cash_balance?: number | null
          cogs?: number | null
          computed_at?: string
          created_at?: string
          data_confidence?: Database["public"]["Enums"]["verification_status"]
          gross_profit?: number | null
          has_activity?: boolean
          health_score?: number | null
          health_score_config_ref?: string | null
          id?: string
          inventory_value?: number | null
          is_backfilled?: boolean
          is_gap_filled?: boolean
          location_id: string
          operating_profit?: number | null
          pct_estimated?: number
          revenue?: number | null
          settlement_value?: number | null
          snapshot_date: string
          source?: Database["public"]["Enums"]["snapshot_source"]
          updated_at?: string
        }
        Update: {
          cash_balance?: number | null
          cogs?: number | null
          computed_at?: string
          created_at?: string
          data_confidence?: Database["public"]["Enums"]["verification_status"]
          gross_profit?: number | null
          has_activity?: boolean
          health_score?: number | null
          health_score_config_ref?: string | null
          id?: string
          inventory_value?: number | null
          is_backfilled?: boolean
          is_gap_filled?: boolean
          location_id?: string
          operating_profit?: number | null
          pct_estimated?: number
          revenue?: number | null
          settlement_value?: number | null
          snapshot_date?: string
          source?: Database["public"]["Enums"]["snapshot_source"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_snapshots_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_compensation: {
        Row: {
          effective_from: string
          effective_to: string | null
          employee_id: string
          id: string
          monthly_salary: number
          notes: string | null
        }
        Insert: {
          effective_from: string
          effective_to?: string | null
          employee_id: string
          id?: string
          monthly_salary: number
          notes?: string | null
        }
        Update: {
          effective_from?: string
          effective_to?: string | null
          employee_id?: string
          id?: string
          monthly_salary?: number
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_compensation_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          active: boolean
          created_at: string
          hire_date: string | null
          id: string
          location_id: string | null
          name: string
          notes: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          hire_date?: string | null
          id?: string
          location_id?: string | null
          name: string
          notes?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          hire_date?: string | null
          id?: string
          location_id?: string | null
          name?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_categories: {
        Row: {
          active: boolean
          id: string
          is_operating: boolean
          name: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          id?: string
          is_operating?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          id?: string
          is_operating?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          category_id: string
          created_at: string
          edited_at: string | null
          employee_id: string | null
          expense_date: string
          id: string
          is_estimated: boolean
          location_id: string
          notes: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          receipt_url: string | null
          source_type: Database["public"]["Enums"]["source_type"]
          supplier_id: string | null
          tax_amount: number
          updated_at: string
          verification: Database["public"]["Enums"]["verification_status"]
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          amount: number
          category_id: string
          created_at?: string
          edited_at?: string | null
          employee_id?: string | null
          expense_date: string
          id?: string
          is_estimated?: boolean
          location_id: string
          notes?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          receipt_url?: string | null
          source_type?: Database["public"]["Enums"]["source_type"]
          supplier_id?: string | null
          tax_amount?: number
          updated_at?: string
          verification?: Database["public"]["Enums"]["verification_status"]
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          amount?: number
          category_id?: string
          created_at?: string
          edited_at?: string | null
          employee_id?: string | null
          expense_date?: string
          id?: string
          is_estimated?: boolean
          location_id?: string
          notes?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          receipt_url?: string | null
          source_type?: Database["public"]["Enums"]["source_type"]
          supplier_id?: string | null
          tax_amount?: number
          updated_at?: string
          verification?: Database["public"]["Enums"]["verification_status"]
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      gl_accounts: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          name: string
          normal_balance: string
          type: Database["public"]["Enums"]["gl_account_type"]
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          name: string
          normal_balance: string
          type: Database["public"]["Enums"]["gl_account_type"]
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          name?: string
          normal_balance?: string
          type?: Database["public"]["Enums"]["gl_account_type"]
        }
        Relationships: []
      }
      gl_entries: {
        Row: {
          created_at: string
          entry_date: string
          id: string
          memo: string | null
          posted_at: string
          reverses: string | null
          source_id: string | null
          source_type: string | null
          status: string
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          created_at?: string
          entry_date: string
          id?: string
          memo?: string | null
          posted_at?: string
          reverses?: string | null
          source_id?: string | null
          source_type?: string | null
          status?: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          created_at?: string
          entry_date?: string
          id?: string
          memo?: string | null
          posted_at?: string
          reverses?: string | null
          source_id?: string | null
          source_type?: string | null
          status?: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gl_entries_reverses_fkey"
            columns: ["reverses"]
            isOneToOne: false
            referencedRelation: "gl_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      gl_lines: {
        Row: {
          account_id: string
          credit: number
          debit: number
          entry_id: string
          id: string
          memo: string | null
        }
        Insert: {
          account_id: string
          credit?: number
          debit?: number
          entry_id: string
          id?: string
          memo?: string | null
        }
        Update: {
          account_id?: string
          credit?: number
          debit?: number
          entry_id?: string
          id?: string
          memo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gl_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gl_lines_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "gl_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      import_rows: {
        Row: {
          applied: boolean
          created_at: string
          error_message: string | null
          id: string
          import_id: string | null
          match_status: string | null
          matched_product_id: string | null
          parsed: Json | null
          raw: Json | null
          row_index: number | null
          target: string | null
          updated_at: string
        }
        Insert: {
          applied?: boolean
          created_at?: string
          error_message?: string | null
          id?: string
          import_id?: string | null
          match_status?: string | null
          matched_product_id?: string | null
          parsed?: Json | null
          raw?: Json | null
          row_index?: number | null
          target?: string | null
          updated_at?: string
        }
        Update: {
          applied?: boolean
          created_at?: string
          error_message?: string | null
          id?: string
          import_id?: string | null
          match_status?: string | null
          matched_product_id?: string | null
          parsed?: Json | null
          raw?: Json | null
          row_index?: number | null
          target?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_rows_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_rows_matched_product_id_fkey"
            columns: ["matched_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      imports: {
        Row: {
          created_at: string
          filename: string | null
          id: string
          kind: string | null
          location_id: string | null
          notes: string | null
          period_from: string | null
          period_to: string | null
          row_count: number
          source_type: Database["public"]["Enums"]["source_type"]
          status: string
          totals: Json | null
          updated_at: string
          verification: Database["public"]["Enums"]["verification_status"]
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          created_at?: string
          filename?: string | null
          id?: string
          kind?: string | null
          location_id?: string | null
          notes?: string | null
          period_from?: string | null
          period_to?: string | null
          row_count?: number
          source_type?: Database["public"]["Enums"]["source_type"]
          status?: string
          totals?: Json | null
          updated_at?: string
          verification?: Database["public"]["Enums"]["verification_status"]
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          created_at?: string
          filename?: string | null
          id?: string
          kind?: string | null
          location_id?: string | null
          notes?: string | null
          period_from?: string | null
          period_to?: string | null
          row_count?: number
          source_type?: Database["public"]["Enums"]["source_type"]
          status?: string
          totals?: Json | null
          updated_at?: string
          verification?: Database["public"]["Enums"]["verification_status"]
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "imports_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          created_at: string
          edited_at: string | null
          id: string
          location_id: string | null
          movement_date: string
          movement_type: Database["public"]["Enums"]["inventory_movement_type"]
          notes: string | null
          product_id: string
          quantity: number
          reference_id: string | null
          reference_type: string | null
          source_type: Database["public"]["Enums"]["source_type"]
          total_cost: number | null
          unit_cost: number | null
          updated_at: string
          verification: Database["public"]["Enums"]["verification_status"]
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          created_at?: string
          edited_at?: string | null
          id?: string
          location_id?: string | null
          movement_date?: string
          movement_type: Database["public"]["Enums"]["inventory_movement_type"]
          notes?: string | null
          product_id: string
          quantity: number
          reference_id?: string | null
          reference_type?: string | null
          source_type?: Database["public"]["Enums"]["source_type"]
          total_cost?: number | null
          unit_cost?: number | null
          updated_at?: string
          verification?: Database["public"]["Enums"]["verification_status"]
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          created_at?: string
          edited_at?: string | null
          id?: string
          location_id?: string | null
          movement_date?: string
          movement_type?: Database["public"]["Enums"]["inventory_movement_type"]
          notes?: string | null
          product_id?: string
          quantity?: number
          reference_id?: string | null
          reference_type?: string | null
          source_type?: Database["public"]["Enums"]["source_type"]
          total_cost?: number | null
          unit_cost?: number | null
          updated_at?: string
          verification?: Database["public"]["Enums"]["verification_status"]
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      location_terms: {
        Row: {
          amount: number | null
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          location_id: string
          notes: string | null
          rate: number | null
          term_type: Database["public"]["Enums"]["term_type"]
        }
        Insert: {
          amount?: number | null
          created_at?: string
          effective_from: string
          effective_to?: string | null
          id?: string
          location_id: string
          notes?: string | null
          rate?: number | null
          term_type: Database["public"]["Enums"]["term_type"]
        }
        Update: {
          amount?: number | null
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          location_id?: string
          notes?: string | null
          rate?: number | null
          term_type?: Database["public"]["Enums"]["term_type"]
        }
        Relationships: [
          {
            foreignKeyName: "location_terms_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          active: boolean
          address: string | null
          created_at: string
          id: string
          kind: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          address?: string | null
          created_at?: string
          id?: string
          kind?: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          address?: string | null
          created_at?: string
          id?: string
          kind?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      money_accounts: {
        Row: {
          active: boolean
          created_at: string
          current_balance: number
          id: string
          name: string
          opening_balance: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          current_balance?: number
          id?: string
          name: string
          opening_balance?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          current_balance?: number
          id?: string
          name?: string
          opening_balance?: number
          updated_at?: string
        }
        Relationships: []
      }
      money_movements: {
        Row: {
          account_id: string
          amount: number
          balance_after: number | null
          created_at: string
          edited_at: string | null
          id: string
          location_id: string | null
          movement_date: string
          movement_type: Database["public"]["Enums"]["money_movement_type"]
          notes: string | null
          reference_id: string | null
          reference_type: string | null
          source_type: Database["public"]["Enums"]["source_type"]
          updated_at: string
          verification: Database["public"]["Enums"]["verification_status"]
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          account_id: string
          amount: number
          balance_after?: number | null
          created_at?: string
          edited_at?: string | null
          id?: string
          location_id?: string | null
          movement_date: string
          movement_type: Database["public"]["Enums"]["money_movement_type"]
          notes?: string | null
          reference_id?: string | null
          reference_type?: string | null
          source_type?: Database["public"]["Enums"]["source_type"]
          updated_at?: string
          verification?: Database["public"]["Enums"]["verification_status"]
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          account_id?: string
          amount?: number
          balance_after?: number | null
          created_at?: string
          edited_at?: string | null
          id?: string
          location_id?: string | null
          movement_date?: string
          movement_type?: Database["public"]["Enums"]["money_movement_type"]
          notes?: string | null
          reference_id?: string | null
          reference_type?: string | null
          source_type?: Database["public"]["Enums"]["source_type"]
          updated_at?: string
          verification?: Database["public"]["Enums"]["verification_status"]
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "money_movements_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "money_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_movements_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      physical_counts: {
        Row: {
          avg_cost_at_count: number | null
          count_date: string
          counted_qty: number
          created_at: string
          difference: number
          expected_qty: number
          id: string
          location_id: string | null
          notes: string | null
          product_id: string
          source_type: Database["public"]["Enums"]["source_type"]
          updated_at: string
          value_impact: number | null
          variance_pct: number | null
          verification: Database["public"]["Enums"]["verification_status"]
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          avg_cost_at_count?: number | null
          count_date?: string
          counted_qty: number
          created_at?: string
          difference: number
          expected_qty: number
          id?: string
          location_id?: string | null
          notes?: string | null
          product_id: string
          source_type?: Database["public"]["Enums"]["source_type"]
          updated_at?: string
          value_impact?: number | null
          variance_pct?: number | null
          verification?: Database["public"]["Enums"]["verification_status"]
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          avg_cost_at_count?: number | null
          count_date?: string
          counted_qty?: number
          created_at?: string
          difference?: number
          expected_qty?: number
          id?: string
          location_id?: string | null
          notes?: string | null
          product_id?: string
          source_type?: Database["public"]["Enums"]["source_type"]
          updated_at?: string
          value_impact?: number | null
          variance_pct?: number | null
          verification?: Database["public"]["Enums"]["verification_status"]
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "physical_counts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "physical_counts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      private_config: {
        Row: {
          key: string
          updated_at: string | null
          value: string
        }
        Insert: {
          key: string
          updated_at?: string | null
          value: string
        }
        Update: {
          key?: string
          updated_at?: string | null
          value?: string
        }
        Relationships: []
      }
      product_aliases: {
        Row: {
          alias: string | null
          alias_type: string | null
          created_at: string
          id: string
          normalized: string | null
          product_id: string | null
          source: string | null
          updated_at: string
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          alias?: string | null
          alias_type?: string | null
          created_at?: string
          id?: string
          normalized?: string | null
          product_id?: string | null
          source?: string | null
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          alias?: string | null
          alias_type?: string | null
          created_at?: string
          id?: string
          normalized?: string | null
          product_id?: string | null
          source?: string | null
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_aliases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          active: boolean
          id: string
          name_ar: string | null
          name_en: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          id?: string
          name_ar?: string | null
          name_en: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          id?: string
          name_ar?: string | null
          name_en?: string
          sort_order?: number
        }
        Relationships: []
      }
      products: {
        Row: {
          active: boolean
          alt_pos_codes: string[]
          avg_cost: number
          base_unit: string
          base_units_per_sale_unit: number
          category_id: string | null
          created_at: string
          current_stock: number
          id: string
          low_stock_threshold: number | null
          market_code: string | null
          name_ar: string | null
          name_en: string
          notes: string | null
          pos_code: string | null
          reference_cost: number | null
          sale_unit: string | null
          selling_price: number | null
          unit_type: Database["public"]["Enums"]["product_unit_type"]
          updated_at: string
          vendor: string | null
        }
        Insert: {
          active?: boolean
          alt_pos_codes?: string[]
          avg_cost?: number
          base_unit?: string
          base_units_per_sale_unit?: number
          category_id?: string | null
          created_at?: string
          current_stock?: number
          id?: string
          low_stock_threshold?: number | null
          market_code?: string | null
          name_ar?: string | null
          name_en: string
          notes?: string | null
          pos_code?: string | null
          reference_cost?: number | null
          sale_unit?: string | null
          selling_price?: number | null
          unit_type?: Database["public"]["Enums"]["product_unit_type"]
          updated_at?: string
          vendor?: string | null
        }
        Update: {
          active?: boolean
          alt_pos_codes?: string[]
          avg_cost?: number
          base_unit?: string
          base_units_per_sale_unit?: number
          category_id?: string | null
          created_at?: string
          current_stock?: number
          id?: string
          low_stock_threshold?: number | null
          market_code?: string | null
          name_ar?: string | null
          name_en?: string
          notes?: string | null
          pos_code?: string | null
          reference_cost?: number | null
          sale_unit?: string | null
          selling_price?: number | null
          unit_type?: Database["public"]["Enums"]["product_unit_type"]
          updated_at?: string
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_batches: {
        Row: {
          created_at: string
          edited_at: string | null
          id: string
          invoice_ref: string | null
          location_id: string | null
          notes: string | null
          product_id: string
          purchase_date: string
          quantity: number
          source_type: Database["public"]["Enums"]["source_type"]
          supplier_id: string | null
          total_cost: number
          unit_cost: number
          updated_at: string
          verification: Database["public"]["Enums"]["verification_status"]
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          created_at?: string
          edited_at?: string | null
          id?: string
          invoice_ref?: string | null
          location_id?: string | null
          notes?: string | null
          product_id: string
          purchase_date?: string
          quantity: number
          source_type?: Database["public"]["Enums"]["source_type"]
          supplier_id?: string | null
          total_cost: number
          unit_cost: number
          updated_at?: string
          verification?: Database["public"]["Enums"]["verification_status"]
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          created_at?: string
          edited_at?: string | null
          id?: string
          invoice_ref?: string | null
          location_id?: string | null
          notes?: string | null
          product_id?: string
          purchase_date?: string
          quantity?: number
          source_type?: Database["public"]["Enums"]["source_type"]
          supplier_id?: string | null
          total_cost?: number
          unit_cost?: number
          updated_at?: string
          verification?: Database["public"]["Enums"]["verification_status"]
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_batches_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_batches_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_batches_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      report_extractions: {
        Row: {
          branch_total_net: number | null
          created_at: string
          lines: Json
          model: string | null
          sale_date: string
          updated_at: string
        }
        Insert: {
          branch_total_net?: number | null
          created_at?: string
          lines?: Json
          model?: string | null
          sale_date: string
          updated_at?: string
        }
        Update: {
          branch_total_net?: number | null
          created_at?: string
          lines?: Json
          model?: string | null
          sale_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      sale_items: {
        Row: {
          cogs_at_sale: number | null
          created_at: string
          edited_at: string | null
          id: string
          is_estimated: boolean
          line_total: number
          notes: string | null
          product_id: string | null
          quantity: number
          raw_product_name: string | null
          sale_id: string
          tax_amount: number
          unit_price: number | null
          updated_at: string
          verification: Database["public"]["Enums"]["verification_status"]
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          cogs_at_sale?: number | null
          created_at?: string
          edited_at?: string | null
          id?: string
          is_estimated?: boolean
          line_total: number
          notes?: string | null
          product_id?: string | null
          quantity: number
          raw_product_name?: string | null
          sale_id: string
          tax_amount?: number
          unit_price?: number | null
          updated_at?: string
          verification?: Database["public"]["Enums"]["verification_status"]
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          cogs_at_sale?: number | null
          created_at?: string
          edited_at?: string | null
          id?: string
          is_estimated?: boolean
          line_total?: number
          notes?: string | null
          product_id?: string | null
          quantity?: number
          raw_product_name?: string | null
          sale_id?: string
          tax_amount?: number
          unit_price?: number | null
          updated_at?: string
          verification?: Database["public"]["Enums"]["verification_status"]
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "v_active_sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          channel_id: string
          created_at: string
          edited_at: string | null
          id: string
          is_historical: boolean
          location_id: string
          notes: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          reconciled: boolean
          sale_date: string
          settlement_period_id: string | null
          source_type: Database["public"]["Enums"]["source_type"]
          tax_amount: number
          tax_rate: number
          total_amount: number
          updated_at: string
          verification: Database["public"]["Enums"]["verification_status"]
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          channel_id: string
          created_at?: string
          edited_at?: string | null
          id?: string
          is_historical?: boolean
          location_id: string
          notes?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          reconciled?: boolean
          sale_date: string
          settlement_period_id?: string | null
          source_type?: Database["public"]["Enums"]["source_type"]
          tax_amount?: number
          tax_rate?: number
          total_amount?: number
          updated_at?: string
          verification?: Database["public"]["Enums"]["verification_status"]
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          channel_id?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          is_historical?: boolean
          location_id?: string
          notes?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          reconciled?: boolean
          sale_date?: string
          settlement_period_id?: string | null
          source_type?: Database["public"]["Enums"]["source_type"]
          tax_amount?: number
          tax_rate?: number
          total_amount?: number
          updated_at?: string
          verification?: Database["public"]["Enums"]["verification_status"]
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_sales_period"
            columns: ["settlement_period_id"]
            isOneToOne: false
            referencedRelation: "settlement_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_sales_period"
            columns: ["settlement_period_id"]
            isOneToOne: false
            referencedRelation: "v_open_settlement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      settlement_deductions: {
        Row: {
          amount: number
          created_at: string
          deduction_type: Database["public"]["Enums"]["deduction_type"]
          edited_at: string | null
          id: string
          manual_override: boolean
          notes: string | null
          rate: number | null
          settlement_period_id: string
          updated_at: string
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          amount?: number
          created_at?: string
          deduction_type: Database["public"]["Enums"]["deduction_type"]
          edited_at?: string | null
          id?: string
          manual_override?: boolean
          notes?: string | null
          rate?: number | null
          settlement_period_id: string
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          deduction_type?: Database["public"]["Enums"]["deduction_type"]
          edited_at?: string | null
          id?: string
          manual_override?: boolean
          notes?: string | null
          rate?: number | null
          settlement_period_id?: string
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "settlement_deductions_settlement_period_id_fkey"
            columns: ["settlement_period_id"]
            isOneToOne: false
            referencedRelation: "settlement_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_deductions_settlement_period_id_fkey"
            columns: ["settlement_period_id"]
            isOneToOne: false
            referencedRelation: "v_open_settlement"
            referencedColumns: ["id"]
          },
        ]
      }
      settlement_periods: {
        Row: {
          accumulated_revenue: number
          created_at: string
          edited_at: string | null
          end_date: string | null
          id: string
          location_id: string
          net_expected: number
          notes: string | null
          start_date: string
          status: Database["public"]["Enums"]["settlement_status"]
          total_deductions: number
          updated_at: string
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          accumulated_revenue?: number
          created_at?: string
          edited_at?: string | null
          end_date?: string | null
          id?: string
          location_id: string
          net_expected?: number
          notes?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["settlement_status"]
          total_deductions?: number
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          accumulated_revenue?: number
          created_at?: string
          edited_at?: string | null
          end_date?: string | null
          id?: string
          location_id?: string
          net_expected?: number
          notes?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["settlement_status"]
          total_deductions?: number
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "settlement_periods_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      strategist_actions: {
        Row: {
          category: string
          completed_at: string | null
          completion_note: string | null
          conversation_id: string | null
          created_at: string
          description: string
          dismissed_at: string | null
          due_date: string | null
          expected_outcome: string | null
          finding_id: string | null
          id: string
          priority: string
          screen_link: string
          source: string
          status: string
          title: string
        }
        Insert: {
          category?: string
          completed_at?: string | null
          completion_note?: string | null
          conversation_id?: string | null
          created_at?: string
          description?: string
          dismissed_at?: string | null
          due_date?: string | null
          expected_outcome?: string | null
          finding_id?: string | null
          id?: string
          priority?: string
          screen_link?: string
          source: string
          status?: string
          title: string
        }
        Update: {
          category?: string
          completed_at?: string | null
          completion_note?: string | null
          conversation_id?: string | null
          created_at?: string
          description?: string
          dismissed_at?: string | null
          due_date?: string | null
          expected_outcome?: string | null
          finding_id?: string | null
          id?: string
          priority?: string
          screen_link?: string
          source?: string
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "strategist_actions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "strategist_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      strategist_conversations: {
        Row: {
          created_at: string
          id: string
          mode: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          mode?: string
          title?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          mode?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      strategist_feedback: {
        Row: {
          created_at: string
          id: string
          reason: string | null
          snapshot_meta: Json | null
          subject_id: string | null
          subject_type: string
          verdict: string
        }
        Insert: {
          created_at?: string
          id?: string
          reason?: string | null
          snapshot_meta?: Json | null
          subject_id?: string | null
          subject_type: string
          verdict: string
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string | null
          snapshot_meta?: Json | null
          subject_id?: string | null
          subject_type?: string
          verdict?: string
        }
        Relationships: []
      }
      strategist_insights: {
        Row: {
          class: string
          confidence: string
          detail: string
          dismissed_at: string | null
          evidence: Json
          finding_id: string
          first_seen_at: string
          id: string
          impact_egp: number | null
          last_seen_at: string
          owner_note: string | null
          period: string | null
          resolved_at: string | null
          screen_link: string
          seen_count: number
          status: string
          title: string
          urgency: string
        }
        Insert: {
          class: string
          confidence?: string
          detail?: string
          dismissed_at?: string | null
          evidence?: Json
          finding_id: string
          first_seen_at?: string
          id?: string
          impact_egp?: number | null
          last_seen_at?: string
          owner_note?: string | null
          period?: string | null
          resolved_at?: string | null
          screen_link?: string
          seen_count?: number
          status?: string
          title: string
          urgency?: string
        }
        Update: {
          class?: string
          confidence?: string
          detail?: string
          dismissed_at?: string | null
          evidence?: Json
          finding_id?: string
          first_seen_at?: string
          id?: string
          impact_egp?: number | null
          last_seen_at?: string
          owner_note?: string | null
          period?: string | null
          resolved_at?: string | null
          screen_link?: string
          seen_count?: number
          status?: string
          title?: string
          urgency?: string
        }
        Relationships: []
      }
      strategist_messages: {
        Row: {
          content: Json
          conversation_id: string
          created_at: string
          id: string
          role: string
          snapshot_meta: Json | null
        }
        Insert: {
          content: Json
          conversation_id: string
          created_at?: string
          id?: string
          role: string
          snapshot_meta?: Json | null
        }
        Update: {
          content?: Json
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
          snapshot_meta?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "strategist_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "strategist_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          notes: string | null
          phone: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      gl_trial_balance: {
        Row: {
          balance: number | null
          code: string | null
          credit_total: number | null
          debit_total: number | null
          name: string | null
          normal_balance: string | null
          type: Database["public"]["Enums"]["gl_account_type"] | null
        }
        Relationships: []
      }
      v_active_sales: {
        Row: {
          channel_id: string | null
          created_at: string | null
          edited_at: string | null
          id: string | null
          location_id: string | null
          notes: string | null
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          reconciled: boolean | null
          sale_date: string | null
          settlement_period_id: string | null
          source_type: Database["public"]["Enums"]["source_type"] | null
          tax_amount: number | null
          tax_rate: number | null
          total_amount: number | null
          updated_at: string | null
          verification:
            | Database["public"]["Enums"]["verification_status"]
            | null
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          channel_id?: string | null
          created_at?: string | null
          edited_at?: string | null
          id?: string | null
          location_id?: string | null
          notes?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          reconciled?: boolean | null
          sale_date?: string | null
          settlement_period_id?: string | null
          source_type?: Database["public"]["Enums"]["source_type"] | null
          tax_amount?: number | null
          tax_rate?: number | null
          total_amount?: number | null
          updated_at?: string | null
          verification?:
            | Database["public"]["Enums"]["verification_status"]
            | null
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          channel_id?: string | null
          created_at?: string | null
          edited_at?: string | null
          id?: string | null
          location_id?: string | null
          notes?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          reconciled?: boolean | null
          sale_date?: string | null
          settlement_period_id?: string | null
          source_type?: Database["public"]["Enums"]["source_type"] | null
          tax_amount?: number | null
          tax_rate?: number | null
          total_amount?: number | null
          updated_at?: string | null
          verification?:
            | Database["public"]["Enums"]["verification_status"]
            | null
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_sales_period"
            columns: ["settlement_period_id"]
            isOneToOne: false
            referencedRelation: "settlement_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_sales_period"
            columns: ["settlement_period_id"]
            isOneToOne: false
            referencedRelation: "v_open_settlement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      v_open_settlement: {
        Row: {
          accumulated_revenue: number | null
          created_at: string | null
          edited_at: string | null
          end_date: string | null
          id: string | null
          location_id: string | null
          net_expected: number | null
          notes: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["settlement_status"] | null
          total_deductions: number | null
          updated_at: string | null
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          accumulated_revenue?: number | null
          created_at?: string | null
          edited_at?: string | null
          end_date?: string | null
          id?: string | null
          location_id?: string | null
          net_expected?: number | null
          notes?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["settlement_status"] | null
          total_deductions?: number | null
          updated_at?: string | null
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          accumulated_revenue?: number | null
          created_at?: string | null
          edited_at?: string | null
          end_date?: string | null
          id?: string | null
          location_id?: string | null
          net_expected?: number | null
          notes?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["settlement_status"] | null
          total_deductions?: number | null
          updated_at?: string | null
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "settlement_periods_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      assert_period_open: { Args: { d: string }; Returns: undefined }
      check_sale_reconciliation: {
        Args: { p_sale_id: string }
        Returns: boolean
      }
      create_purchase: {
        Args: {
          p_invoice_ref: string
          p_lines: Json
          p_location_id: string
          p_purchase_date: string
          p_source_type: Database["public"]["Enums"]["source_type"]
          p_supplier_id: string
          p_verification: Database["public"]["Enums"]["verification_status"]
        }
        Returns: Json
      }
      create_sale_item: {
        Args: {
          p_line_total: number
          p_notes: string
          p_product_id: string
          p_quantity: number
          p_raw_product_name: string
          p_sale_id: string
          p_unit_price: number
        }
        Returns: string
      }
      delete_sale_item: { Args: { p_id: string }; Returns: string }
      ensure_monthly_settlement_period: {
        Args: { p_location_id: string; p_month: string }
        Returns: string
      }
      get_effective_terms: {
        Args: { p_date: string; p_location_id: string }
        Returns: {
          charge_rate: number
          rent_amount: number
        }[]
      }
      get_setting_numeric: { Args: { p_key: string }; Returns: number }
      gl_post_entry: {
        Args: {
          p_date: string
          p_lines: Json
          p_memo: string
          p_source_id: string
          p_source_type: string
        }
        Returns: string
      }
      lock_period: { Args: { p_month: string }; Returns: undefined }
      post_sale_item_movement: {
        Args: { p_sale_item_id: string }
        Returns: undefined
      }
      rebuild_day_from_memory: { Args: { p_date: string }; Returns: number }
      recalc_money_account: {
        Args: { p_account_id: string }
        Returns: undefined
      }
      recalc_settlement_period: {
        Args: { p_period_id: string }
        Returns: undefined
      }
      recompute_all_product_costs: { Args: never; Returns: undefined }
      recompute_product_costs: {
        Args: { p_product_id: string }
        Returns: undefined
      }
      recompute_product_stock: {
        Args: { p_product_id: string }
        Returns: undefined
      }
      record_physical_count: {
        Args: {
          p_counted_qty: number
          p_location_id: string
          p_notes: string
          p_opening_unit_cost?: number
          p_product_id: string
        }
        Returns: Json
      }
      refresh_settlement_totals: {
        Args: { p_period_id: string }
        Returns: undefined
      }
      unlock_period: { Args: { p_month: string }; Returns: undefined }
      update_sale_item: {
        Args: {
          p_id: string
          p_line_total: number
          p_notes: string
          p_product_id: string
          p_quantity: number
          p_raw_product_name: string
          p_unit_price: number
        }
        Returns: string
      }
      verify_audit_chain: {
        Args: never
        Returns: {
          checked: number
          first_broken_seq: number
          ok: boolean
        }[]
      }
      void_physical_count: { Args: { p_id: string }; Returns: string }
      void_purchase_batch: {
        Args: { p_batch_id: string; p_reason: string }
        Returns: string
      }
      void_sale: {
        Args: { p_reason?: string; p_sale_id: string }
        Returns: undefined
      }
      void_sale_movements: { Args: { p_sale_id: string }; Returns: undefined }
    }
    Enums: {
      cheque_status:
        | "pending"
        | "received"
        | "reconciled"
        | "expected"
        | "deposited"
        | "cleared"
        | "cancelled"
      deduction_type: "rent" | "revenue_charge" | "other"
      gl_account_type: "asset" | "liability" | "equity" | "revenue" | "expense"
      inventory_movement_type:
        | "opening"
        | "purchase"
        | "sale"
        | "adjustment"
        | "count"
        | "wastage"
        | "return"
        | "transfer"
      money_movement_type:
        | "cheque_inflow"
        | "owner_injection"
        | "personal_withdrawal"
        | "cash_expense"
        | "salary"
        | "adjustment"
      payment_method:
        | "cash"
        | "cheque"
        | "card"
        | "transfer"
        | "credit"
        | "unknown"
      product_unit_type: "weight" | "count"
      settlement_status: "open" | "expected" | "received" | "reconciled"
      snapshot_source: "live_capture" | "backfill" | "recompute"
      source_type:
        | "manual"
        | "pos_import"
        | "excel"
        | "csv"
        | "screenshot"
        | "receipt"
        | "whatsapp"
        | "historical"
      term_type: "rent" | "revenue_charge"
      verification_status:
        | "verified"
        | "partially_verified"
        | "unverified"
        | "estimated"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      cheque_status: [
        "pending",
        "received",
        "reconciled",
        "expected",
        "deposited",
        "cleared",
        "cancelled",
      ],
      deduction_type: ["rent", "revenue_charge", "other"],
      gl_account_type: ["asset", "liability", "equity", "revenue", "expense"],
      inventory_movement_type: [
        "opening",
        "purchase",
        "sale",
        "adjustment",
        "count",
        "wastage",
        "return",
        "transfer",
      ],
      money_movement_type: [
        "cheque_inflow",
        "owner_injection",
        "personal_withdrawal",
        "cash_expense",
        "salary",
        "adjustment",
      ],
      payment_method: [
        "cash",
        "cheque",
        "card",
        "transfer",
        "credit",
        "unknown",
      ],
      product_unit_type: ["weight", "count"],
      settlement_status: ["open", "expected", "received", "reconciled"],
      snapshot_source: ["live_capture", "backfill", "recompute"],
      source_type: [
        "manual",
        "pos_import",
        "excel",
        "csv",
        "screenshot",
        "receipt",
        "whatsapp",
        "historical",
      ],
      term_type: ["rent", "revenue_charge"],
      verification_status: [
        "verified",
        "partially_verified",
        "unverified",
        "estimated",
      ],
    },
  },
} as const
