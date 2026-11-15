
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "audit_log": {
                  Row: {
                    "action": string,"actor_type": string,"actor_user_id": string | null,"booking_id": string | null,"created_at": string,"details": NonNullable<Json>,"id": number,"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_type": string,"actor_user_id"?: string | null,"booking_id"?: string | null,"created_at"?: string,"details"?: NonNullable<Json>,"id"?: never,"tenant_id": string
                  }
                  Update: {
                    "action"?: string,"actor_type"?: string,"actor_user_id"?: string | null,"booking_id"?: string | null,"created_at"?: string,"details"?: NonNullable<Json>,"id"?: never,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_log_tenant_id_booking_id_fkey"
      columns: ["tenant_id","booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "audit_log_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "public_tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "audit_log_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"booking_access_tokens": {
                  Row: {
                    "booking_id": string,"created_at": string,"id": string,"revoked_at": string | null,"tenant_id": string,"token_hash": string
                  }
                  ComputedFields: never
                  Insert: {
                    "booking_id": string,"created_at"?: string,"id"?: string,"revoked_at"?: string | null,"tenant_id": string,"token_hash": string
                  }
                  Update: {
                    "booking_id"?: string,"created_at"?: string,"id"?: string,"revoked_at"?: string | null,"tenant_id"?: string,"token_hash"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "booking_access_tokens_tenant_id_booking_id_fkey"
      columns: ["tenant_id","booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"booking_extras": {
                  Row: {
                    "amount": number,"booking_id": string,"extra_id": string,"name": string,"qty": number,"tenant_id": string,"unit": Database["public"]['Enums']["extra_unit"],"unit_price": number
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"booking_id": string,"extra_id": string,"name": string,"qty": number,"tenant_id": string,"unit": Database["public"]['Enums']["extra_unit"],"unit_price": number
                  }
                  Update: {
                    "amount"?: number,"booking_id"?: string,"extra_id"?: string,"name"?: string,"qty"?: number,"tenant_id"?: string,"unit"?: Database["public"]['Enums']["extra_unit"],"unit_price"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "booking_extras_tenant_id_booking_id_fkey"
      columns: ["tenant_id","booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "booking_extras_tenant_id_extra_id_fkey"
      columns: ["tenant_id","extra_id"]
isOneToOne: false
      referencedRelation: "extras"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "booking_extras_tenant_id_extra_id_fkey"
      columns: ["tenant_id","extra_id"]
isOneToOne: false
      referencedRelation: "public_extras"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"bookings": {
                  Row: {
                    "cancelled_at": string | null,"comment": string | null,"consent_at": string | null,"created_at": string,"created_by": string | null,"customer_name": string,"customer_phone": string | null,"end_at": string,"guests": number,"hall_id": string,"id": string,"is_demo": boolean,"price_snapshot": NonNullable<Json>,"seen_at": string | null,"source": Database["public"]['Enums']["booking_source"],"start_at": string,"status": Database["public"]['Enums']["booking_status"],"tariff_version_id": string | null,"tenant_id": string,"total_amount": number,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "cancelled_at"?: string | null,"comment"?: string | null,"consent_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"customer_name": string,"customer_phone"?: string | null,"end_at": string,"guests": number,"hall_id": string,"id"?: string,"is_demo"?: boolean,"price_snapshot"?: NonNullable<Json>,"seen_at"?: string | null,"source": Database["public"]['Enums']["booking_source"],"start_at": string,"status"?: Database["public"]['Enums']["booking_status"],"tariff_version_id"?: string | null,"tenant_id": string,"total_amount": number,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "cancelled_at"?: string | null,"comment"?: string | null,"consent_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"customer_name"?: string,"customer_phone"?: string | null,"end_at"?: string,"guests"?: number,"hall_id"?: string,"id"?: string,"is_demo"?: boolean,"price_snapshot"?: NonNullable<Json>,"seen_at"?: string | null,"source"?: Database["public"]['Enums']["booking_source"],"start_at"?: string,"status"?: Database["public"]['Enums']["booking_status"],"tariff_version_id"?: string | null,"tenant_id"?: string,"total_amount"?: number,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "bookings_tenant_id_hall_id_fkey"
      columns: ["tenant_id","hall_id"]
isOneToOne: false
      referencedRelation: "halls"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "bookings_tenant_id_hall_id_fkey"
      columns: ["tenant_id","hall_id"]
isOneToOne: false
      referencedRelation: "public_halls"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "bookings_tenant_id_tariff_version_id_fkey"
      columns: ["tenant_id","tariff_version_id"]
isOneToOne: false
      referencedRelation: "tariff_versions"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"calendar_exceptions": {
                  Row: {
                    "date": string,"day_type": Database["public"]['Enums']["day_type"] | null,"kind": Database["public"]['Enums']["exception_kind"],"note": string | null,"start_from": string | null,"start_to": string | null,"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "date": string,"day_type"?: Database["public"]['Enums']["day_type"] | null,"kind": Database["public"]['Enums']["exception_kind"],"note"?: string | null,"start_from"?: string | null,"start_to"?: string | null,"tenant_id": string
                  }
                  Update: {
                    "date"?: string,"day_type"?: Database["public"]['Enums']["day_type"] | null,"kind"?: Database["public"]['Enums']["exception_kind"],"note"?: string | null,"start_from"?: string | null,"start_to"?: string | null,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "calendar_exceptions_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "public_tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "calendar_exceptions_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"extras": {
                  Row: {
                    "description": string,"id": string,"is_active": boolean,"key": string,"max_qty": number,"name": string,"price": number,"sort": number,"tenant_id": string,"unit": Database["public"]['Enums']["extra_unit"]
                  }
                  ComputedFields: never
                  Insert: {
                    "description"?: string,"id"?: string,"is_active"?: boolean,"key": string,"max_qty": number,"name": string,"price": number,"sort"?: number,"tenant_id": string,"unit": Database["public"]['Enums']["extra_unit"]
                  }
                  Update: {
                    "description"?: string,"id"?: string,"is_active"?: boolean,"key"?: string,"max_qty"?: number,"name"?: string,"price"?: number,"sort"?: number,"tenant_id"?: string,"unit"?: Database["public"]['Enums']["extra_unit"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "extras_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "public_tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "extras_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"hall_blocks": {
                  Row: {
                    "created_at": string,"created_by": string | null,"hall_id": string,"id": string,"occupancy_id": string,"reason": string,"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"hall_id": string,"id"?: string,"occupancy_id": string,"reason": string,"tenant_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"hall_id"?: string,"id"?: string,"occupancy_id"?: string,"reason"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "hall_blocks_tenant_id_hall_id_fkey"
      columns: ["tenant_id","hall_id"]
isOneToOne: false
      referencedRelation: "halls"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "hall_blocks_tenant_id_hall_id_fkey"
      columns: ["tenant_id","hall_id"]
isOneToOne: false
      referencedRelation: "public_halls"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "hall_blocks_tenant_id_occupancy_id_fkey"
      columns: ["tenant_id","occupancy_id"]
isOneToOne: false
      referencedRelation: "resource_occupancies"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"halls": {
                  Row: {
                    "buffer_min": number,"capacity_included": number,"capacity_max": number,"created_at": string,"description": string,"extra_guest_price": number,"extra_guest_unit": Database["public"]['Enums']["guest_price_unit"],"id": string,"is_active": boolean,"key": string,"min_duration_min": number,"name": string,"photos": NonNullable<Json>,"slot_step_min": number,"sort": number,"tenant_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "buffer_min"?: number,"capacity_included": number,"capacity_max": number,"created_at"?: string,"description"?: string,"extra_guest_price"?: number,"extra_guest_unit"?: Database["public"]['Enums']["guest_price_unit"],"id"?: string,"is_active"?: boolean,"key": string,"min_duration_min": number,"name": string,"photos"?: NonNullable<Json>,"slot_step_min": number,"sort"?: number,"tenant_id": string,"updated_at"?: string
                  }
                  Update: {
                    "buffer_min"?: number,"capacity_included"?: number,"capacity_max"?: number,"created_at"?: string,"description"?: string,"extra_guest_price"?: number,"extra_guest_unit"?: Database["public"]['Enums']["guest_price_unit"],"id"?: string,"is_active"?: boolean,"key"?: string,"min_duration_min"?: number,"name"?: string,"photos"?: NonNullable<Json>,"slot_step_min"?: number,"sort"?: number,"tenant_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "halls_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "public_tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "halls_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"idempotency_keys": {
                  Row: {
                    "booking_id": string | null,"created_at": string,"key": string,"request_hash": string,"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "booking_id"?: string | null,"created_at"?: string,"key": string,"request_hash": string,"tenant_id": string
                  }
                  Update: {
                    "booking_id"?: string | null,"created_at"?: string,"key"?: string,"request_hash"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "idempotency_keys_tenant_id_booking_id_fkey"
      columns: ["tenant_id","booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "idempotency_keys_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "public_tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "idempotency_keys_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"llm_usage": {
                  Row: {
                    "day": string,"requests": number,"tenant_id": string,"tokens": number
                  }
                  ComputedFields: never
                  Insert: {
                    "day": string,"requests"?: number,"tenant_id": string,"tokens"?: number
                  }
                  Update: {
                    "day"?: string,"requests"?: number,"tenant_id"?: string,"tokens"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "llm_usage_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "public_tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "llm_usage_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"llm_usage_global": {
                  Row: {
                    "day": string,"requests": number,"tokens": number
                  }
                  ComputedFields: never
                  Insert: {
                    "day": string,"requests"?: number,"tokens"?: number
                  }
                  Update: {
                    "day"?: string,"requests"?: number,"tokens"?: number
                  }
                  Relationships: [
                    
                  ]
                },"notification_jobs": {
                  Row: {
                    "attempts": number,"booking_id": string,"booking_version": number,"created_at": string,"dedupe_key": string,"id": string,"kind": Database["public"]['Enums']["notification_kind"],"last_error": string | null,"lease_until": string | null,"recipient": Database["public"]['Enums']["notification_recipient"],"run_at": string,"sent_at": string | null,"status": Database["public"]['Enums']["job_status"],"tenant_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"booking_id": string,"booking_version": number,"created_at"?: string,"dedupe_key": string,"id"?: string,"kind": Database["public"]['Enums']["notification_kind"],"last_error"?: string | null,"lease_until"?: string | null,"recipient": Database["public"]['Enums']["notification_recipient"],"run_at": string,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["job_status"],"tenant_id": string,"updated_at"?: string
                  }
                  Update: {
                    "attempts"?: number,"booking_id"?: string,"booking_version"?: number,"created_at"?: string,"dedupe_key"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["notification_kind"],"last_error"?: string | null,"lease_until"?: string | null,"recipient"?: Database["public"]['Enums']["notification_recipient"],"run_at"?: string,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["job_status"],"tenant_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_jobs_tenant_id_booking_id_fkey"
      columns: ["tenant_id","booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount": number,"booking_id": string,"created_at": string,"created_by": string | null,"id": string,"is_demo": boolean,"kind": Database["public"]['Enums']["payment_kind"],"method": Database["public"]['Enums']["payment_method"],"note": string | null,"provider": string | null,"provider_payment_id": string | null,"received_at": string,"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"booking_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"is_demo"?: boolean,"kind": Database["public"]['Enums']["payment_kind"],"method": Database["public"]['Enums']["payment_method"],"note"?: string | null,"provider"?: string | null,"provider_payment_id"?: string | null,"received_at"?: string,"tenant_id": string
                  }
                  Update: {
                    "amount"?: number,"booking_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"is_demo"?: boolean,"kind"?: Database["public"]['Enums']["payment_kind"],"method"?: Database["public"]['Enums']["payment_method"],"note"?: string | null,"provider"?: string | null,"provider_payment_id"?: string | null,"received_at"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_tenant_id_booking_id_fkey"
      columns: ["tenant_id","booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"push_subscriptions": {
                  Row: {
                    "auth": string,"booking_id": string | null,"created_at": string,"endpoint": string,"id": string,"p256dh": string,"scope": Database["public"]['Enums']["push_scope"],"tenant_id": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "auth": string,"booking_id"?: string | null,"created_at"?: string,"endpoint": string,"id"?: string,"p256dh": string,"scope": Database["public"]['Enums']["push_scope"],"tenant_id": string,"user_id"?: string | null
                  }
                  Update: {
                    "auth"?: string,"booking_id"?: string | null,"created_at"?: string,"endpoint"?: string,"id"?: string,"p256dh"?: string,"scope"?: Database["public"]['Enums']["push_scope"],"tenant_id"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "push_subscriptions_tenant_id_booking_id_fkey"
      columns: ["tenant_id","booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "push_subscriptions_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "public_tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "push_subscriptions_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"rate_limit_buckets": {
                  Row: {
                    "count": number,"key": string,"window_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "count"?: number,"key": string,"window_start": string
                  }
                  Update: {
                    "count"?: number,"key"?: string,"window_start"?: string
                  }
                  Relationships: [
                    
                  ]
                },"resource_occupancies": {
                  Row: {
                    "active": boolean,"booking_id": string | null,"created_at": string,"deactivated_at": string | null,"hall_id": string,"id": string,"kind": Database["public"]['Enums']["occupancy_kind"],"occupied": unknown,"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"booking_id"?: string | null,"created_at"?: string,"deactivated_at"?: string | null,"hall_id": string,"id"?: string,"kind": Database["public"]['Enums']["occupancy_kind"],"occupied": unknown,"tenant_id": string
                  }
                  Update: {
                    "active"?: boolean,"booking_id"?: string | null,"created_at"?: string,"deactivated_at"?: string | null,"hall_id"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["occupancy_kind"],"occupied"?: unknown,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "resource_occupancies_tenant_id_booking_id_fkey"
      columns: ["tenant_id","booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "resource_occupancies_tenant_id_hall_id_fkey"
      columns: ["tenant_id","hall_id"]
isOneToOne: false
      referencedRelation: "halls"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "resource_occupancies_tenant_id_hall_id_fkey"
      columns: ["tenant_id","hall_id"]
isOneToOne: false
      referencedRelation: "public_halls"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"tariff_rules": {
                  Row: {
                    "day_type": Database["public"]['Enums']["day_type"],"from_time": string,"id": string,"price_per_hour": number,"tariff_version_id": string,"tenant_id": string,"to_time": string
                  }
                  ComputedFields: never
                  Insert: {
                    "day_type": Database["public"]['Enums']["day_type"],"from_time": string,"id"?: string,"price_per_hour": number,"tariff_version_id": string,"tenant_id": string,"to_time": string
                  }
                  Update: {
                    "day_type"?: Database["public"]['Enums']["day_type"],"from_time"?: string,"id"?: string,"price_per_hour"?: number,"tariff_version_id"?: string,"tenant_id"?: string,"to_time"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tariff_rules_tenant_id_tariff_version_id_fkey"
      columns: ["tenant_id","tariff_version_id"]
isOneToOne: false
      referencedRelation: "tariff_versions"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"tariff_versions": {
                  Row: {
                    "created_at": string,"effective_from": string,"hall_id": string,"id": string,"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"effective_from": string,"hall_id": string,"id"?: string,"tenant_id": string
                  }
                  Update: {
                    "created_at"?: string,"effective_from"?: string,"hall_id"?: string,"id"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tariff_versions_tenant_id_hall_id_fkey"
      columns: ["tenant_id","hall_id"]
isOneToOne: false
      referencedRelation: "halls"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "tariff_versions_tenant_id_hall_id_fkey"
      columns: ["tenant_id","hall_id"]
isOneToOne: false
      referencedRelation: "public_halls"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"tenant_config_versions": {
                  Row: {
                    "config": NonNullable<Json>,"config_hash": string,"id": string,"published_at": string,"published_by": string | null,"tenant_id": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "config": NonNullable<Json>,"config_hash": string,"id"?: string,"published_at"?: string,"published_by"?: string | null,"tenant_id": string,"version": number
                  }
                  Update: {
                    "config"?: NonNullable<Json>,"config_hash"?: string,"id"?: string,"published_at"?: string,"published_by"?: string | null,"tenant_id"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "tenant_config_versions_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "public_tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tenant_config_versions_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"tenant_members": {
                  Row: {
                    "created_at": string,"role": Database["public"]['Enums']["member_role"],"tenant_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"role"?: Database["public"]['Enums']["member_role"],"tenant_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"role"?: Database["public"]['Enums']["member_role"],"tenant_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tenant_members_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "public_tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tenant_members_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"tenants": {
                  Row: {
                    "config_version": number,"contacts": NonNullable<Json>,"created_at": string,"deposit_enabled": boolean,"deposit_percent": number,"deposit_percent_setting": number,"free_cancellation_hours": number,"id": string,"legal": NonNullable<Json>,"max_end_after_close_min": number,"name": string,"pwa": NonNullable<Json>,"reschedule_pricing": string,"slug": string,"status": Database["public"]['Enums']["tenant_status"],"texts": NonNullable<Json>,"theme": NonNullable<Json>,"timezone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "config_version"?: number,"contacts"?: NonNullable<Json>,"created_at"?: string,"deposit_enabled"?: boolean,"deposit_percent"?: number,"deposit_percent_setting"?: number,"free_cancellation_hours"?: number,"id"?: string,"legal"?: NonNullable<Json>,"max_end_after_close_min"?: number,"name": string,"pwa"?: NonNullable<Json>,"reschedule_pricing"?: string,"slug": string,"status"?: Database["public"]['Enums']["tenant_status"],"texts"?: NonNullable<Json>,"theme"?: NonNullable<Json>,"timezone"?: string,"updated_at"?: string
                  }
                  Update: {
                    "config_version"?: number,"contacts"?: NonNullable<Json>,"created_at"?: string,"deposit_enabled"?: boolean,"deposit_percent"?: number,"deposit_percent_setting"?: number,"free_cancellation_hours"?: number,"id"?: string,"legal"?: NonNullable<Json>,"max_end_after_close_min"?: number,"name"?: string,"pwa"?: NonNullable<Json>,"reschedule_pricing"?: string,"slug"?: string,"status"?: Database["public"]['Enums']["tenant_status"],"texts"?: NonNullable<Json>,"theme"?: NonNullable<Json>,"timezone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"working_hours": {
                  Row: {
                    "start_from": string,"start_to": string,"tenant_id": string,"weekday": number
                  }
                  ComputedFields: never
                  Insert: {
                    "start_from": string,"start_to": string,"tenant_id": string,"weekday": number
                  }
                  Update: {
                    "start_from"?: string,"start_to"?: string,"tenant_id"?: string,"weekday"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "working_hours_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "public_tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "working_hours_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "public_extras": {
                  Row: {
                    "description": string,"id": string,"key": string,"max_qty": number,"name": string,"price": number,"sort": number,"tenant_id": string,"unit": Database["public"]['Enums']["extra_unit"]
                  }
                  ComputedFields: never
                  Insert: {
                           "description"?: string | null,"id"?: string | null,"key"?: string | null,"max_qty"?: number | null,"name"?: string | null,"price"?: number | null,"sort"?: number | null,"tenant_id"?: string | null,"unit"?: Database["public"]['Enums']["extra_unit"] | null
                         }
                        Update: {
                           "description"?: string | null,"id"?: string | null,"key"?: string | null,"max_qty"?: number | null,"name"?: string | null,"price"?: number | null,"sort"?: number | null,"tenant_id"?: string | null,"unit"?: Database["public"]['Enums']["extra_unit"] | null
                         }
                        Relationships: [
                    {
      foreignKeyName: "extras_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "public_tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "extras_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"public_halls": {
                  Row: {
                    "capacity_included": number,"capacity_max": number,"description": string,"extra_guest_price": number,"extra_guest_unit": Database["public"]['Enums']["guest_price_unit"],"id": string,"key": string,"min_duration_min": number,"name": string,"photos": NonNullable<Json>,"slot_step_min": number,"sort": number,"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                           "capacity_included"?: number | null,"capacity_max"?: number | null,"description"?: string | null,"extra_guest_price"?: number | null,"extra_guest_unit"?: Database["public"]['Enums']["guest_price_unit"] | null,"id"?: string | null,"key"?: string | null,"min_duration_min"?: number | null,"name"?: string | null,"photos"?: Json | null,"slot_step_min"?: number | null,"sort"?: number | null,"tenant_id"?: string | null
                         }
                        Update: {
                           "capacity_included"?: number | null,"capacity_max"?: number | null,"description"?: string | null,"extra_guest_price"?: number | null,"extra_guest_unit"?: Database["public"]['Enums']["guest_price_unit"] | null,"id"?: string | null,"key"?: string | null,"min_duration_min"?: number | null,"name"?: string | null,"photos"?: Json | null,"slot_step_min"?: number | null,"sort"?: number | null,"tenant_id"?: string | null
                         }
                        Relationships: [
                    {
      foreignKeyName: "halls_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "public_tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "halls_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"public_tenants": {
                  Row: {
                    "config_version": number,"contacts": NonNullable<Json>,"deposit_enabled": boolean,"deposit_percent": number,"free_cancellation_hours": number,"id": string,"legal": NonNullable<Json>,"name": string,"pwa": NonNullable<Json>,"slug": string,"status": Database["public"]['Enums']["tenant_status"],"texts": NonNullable<Json>,"theme": NonNullable<Json>,"timezone": string
                  }
                  ComputedFields: never
                  Insert: {
                           "config_version"?: number | null,"contacts"?: Json | null,"deposit_enabled"?: boolean | null,"deposit_percent"?: number | null,"free_cancellation_hours"?: number | null,"id"?: string | null,"legal"?: Json | null,"name"?: string | null,"pwa"?: Json | null,"slug"?: string | null,"status"?: Database["public"]['Enums']["tenant_status"] | null,"texts"?: Json | null,"theme"?: Json | null,"timezone"?: string | null
                         }
                        Update: {
                           "config_version"?: number | null,"contacts"?: Json | null,"deposit_enabled"?: boolean | null,"deposit_percent"?: number | null,"free_cancellation_hours"?: number | null,"id"?: string | null,"legal"?: Json | null,"name"?: string | null,"pwa"?: Json | null,"slug"?: string | null,"status"?: Database["public"]['Enums']["tenant_status"] | null,"texts"?: Json | null,"theme"?: Json | null,"timezone"?: string | null
                         }
                        Relationships: [
                    
                  ]
                }
          }
          Functions: {
            "admin_publish_tenant":
{ Args: { "p_config": Json,"p_config_hash": string,"p_live"?: boolean,"p_published_by"?: string }; Returns: Json
                           },
"cancel_booking_by_token":
{ Args: { "p_slug": string,"p_token_hash": string }; Returns: Json
                           },
"consume_llm_budget":
{ Args: { "p_global_daily_requests": number,"p_tenant_daily_requests": number,"p_tenant_id": string,"p_tokens": number }; Returns: boolean
                           },
"consume_rate_limit":
{ Args: { "p_key": string,"p_limit": number,"p_window": string }; Returns: boolean
                           },
"get_availability":
{ Args: { "p_date": string,"p_duration_min"?: number,"p_hall_id": string,"p_slug": string }; Returns: Json
                           },
"get_booking_by_token_hash":
{ Args: { "p_slug": string,"p_token_hash": string }; Returns: Json
                           },
"owner_add_payment":
{ Args: { "p_amount": number,"p_booking_id": string,"p_kind": Database["public"]['Enums']["payment_kind"],"p_method": Database["public"]['Enums']["payment_method"],"p_note"?: string,"p_received_at"?: string }; Returns: Json
                           },
"owner_block_hall":
{ Args: { "p_from": string,"p_hall_id": string,"p_reason": string,"p_tenant_id": string,"p_to": string }; Returns: Json
                           },
"owner_cancel_booking":
{ Args: { "p_booking_id": string,"p_reason"?: string }; Returns: Json
                           },
"owner_delete_booking":
{ Args: { "p_booking_id": string }; Returns: Json
                           },
"owner_mark_seen":
{ Args: { "p_booking_id": string }; Returns: Json
                           },
"owner_push_subscribe":
{ Args: { "p_auth": string,"p_endpoint": string,"p_p256dh": string,"p_tenant_id": string }; Returns: Json
                           },
"owner_push_unsubscribe":
{ Args: { "p_endpoint": string,"p_tenant_id": string }; Returns: Json
                           },
"owner_quick_booking":
{ Args: { "p_comment"?: string,"p_customer_name": string,"p_customer_phone"?: string,"p_duration_min": number,"p_extras"?: Json,"p_guests": number,"p_hall_id": string,"p_idempotency_key"?: string,"p_manual_total"?: number,"p_source"?: Database["public"]['Enums']["booking_source"],"p_start_at": string,"p_tenant_id": string }; Returns: Json
                           },
"owner_reschedule_booking":
{ Args: { "p_booking_id": string,"p_expected_version"?: number,"p_new_duration_min"?: number,"p_new_start_at": string }; Returns: Json
                           },
"owner_set_booking_status":
{ Args: { "p_booking_id": string,"p_status": Database["public"]['Enums']["booking_status"] }; Returns: Json
                           },
"owner_set_deposit":
{ Args: { "p_amount": number,"p_booking_id": string,"p_method"?: Database["public"]['Enums']["payment_method"] }; Returns: Json
                           },
"owner_set_deposit_enabled":
{ Args: { "p_enabled": boolean,"p_tenant_id": string }; Returns: Json
                           },
"owner_stats":
{ Args: { "p_from": string,"p_tenant_id": string,"p_to": string }; Returns: Json
                           },
"owner_unblock_hall":
{ Args: { "p_block_id": string }; Returns: Json
                           },
"public_create_booking":
{ Args: { "p_booking_id": string,"p_client_ip"?: string,"p_comment": string,"p_consent": boolean,"p_customer_name": string,"p_customer_phone": string,"p_duration_min": number,"p_extras": Json,"p_guests": number,"p_hall_id": string,"p_idempotency_key": string,"p_request_hash": string,"p_slug": string,"p_start_at": string,"p_token_hash": string }; Returns: Json
                           },
"public_push_subscribe":
{ Args: { "p_auth": string,"p_endpoint": string,"p_p256dh": string,"p_slug": string,"p_token_hash": string }; Returns: Json
                           },
"quote_booking":
{ Args: { "p_duration_min": number,"p_extras"?: Json,"p_guests": number,"p_hall_id": string,"p_slug": string,"p_start_at": string }; Returns: Json
                           },
"reschedule_booking_by_token":
{ Args: { "p_expected_version"?: number,"p_new_duration_min"?: number,"p_new_start_at": string,"p_slug": string,"p_token_hash": string }; Returns: Json
                           },
"worker_claim_jobs":
{ Args: { "p_lease"?: string,"p_limit"?: number }; Returns: Json
                           },
"worker_complete_job":
{ Args: { "p_error"?: string,"p_gone_endpoints"?: (string)[],"p_job_id": string,"p_ok": boolean }; Returns: undefined
                           }
          }
          Enums: {
            "booking_source": "online"|"phone"|"messenger"|"walk_in"|"owner","booking_status": "pending"|"confirmed"|"completed"|"cancelled"|"no_show","day_type": "weekday"|"weekend"|"holiday","exception_kind": "closed"|"special_hours"|"day_type","extra_unit": "per_booking"|"per_hour"|"per_guest","guest_price_unit": "per_hour"|"per_booking","job_status": "pending"|"leased"|"sent"|"skipped"|"failed"|"simulated","member_role": "owner"|"staff","notification_kind": "booking_created"|"reminder_24h"|"reminder_2h"|"booking_rescheduled"|"booking_cancelled","notification_recipient": "guest"|"owner","occupancy_kind": "booking"|"block","payment_kind": "deposit"|"payment"|"refund","payment_method": "cash"|"transfer"|"card"|"online","push_scope": "guest"|"owner","tenant_status": "preview"|"live"|"archived"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "booking_source": ["online", "phone", "messenger", "walk_in", "owner"],"booking_status": ["pending", "confirmed", "completed", "cancelled", "no_show"],"day_type": ["weekday", "weekend", "holiday"],"exception_kind": ["closed", "special_hours", "day_type"],"extra_unit": ["per_booking", "per_hour", "per_guest"],"guest_price_unit": ["per_hour", "per_booking"],"job_status": ["pending", "leased", "sent", "skipped", "failed", "simulated"],"member_role": ["owner", "staff"],"notification_kind": ["booking_created", "reminder_24h", "reminder_2h", "booking_rescheduled", "booking_cancelled"],"notification_recipient": ["guest", "owner"],"occupancy_kind": ["booking", "block"],"payment_kind": ["deposit", "payment", "refund"],"payment_method": ["cash", "transfer", "card", "online"],"push_scope": ["guest", "owner"],"tenant_status": ["preview", "live", "archived"]
          }
        }
} as const
