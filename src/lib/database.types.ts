
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
                    "action": string,"actor": string | null,"at": string,"detail": Json | null,"entity": string,"entity_id": string | null,"id": number,"restaurant_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor"?: string | null,"at"?: string,"detail"?: Json | null,"entity": string,"entity_id"?: string | null,"id"?: never,"restaurant_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor"?: string | null,"at"?: string,"detail"?: Json | null,"entity"?: string,"entity_id"?: string | null,"id"?: never,"restaurant_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_log_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"blocked_attempts": {
                  Row: {
                    "at": string,"id": number,"reason": string,"restaurant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "at"?: string,"id"?: never,"reason": string,"restaurant_id": string
                  }
                  Update: {
                    "at"?: string,"id"?: never,"reason"?: string,"restaurant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "blocked_attempts_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"cash_closings": {
                  Row: {
                    "closed_at": string,"closed_by": string | null,"counted": number,"day": string,"difference": number | null,"expected": number,"id": string,"notes": string | null,"restaurant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "closed_at"?: string,"closed_by"?: string | null,"counted": number,"day": string,"difference"?: never,"expected": number,"id"?: string,"notes"?: string | null,"restaurant_id": string
                  }
                  Update: {
                    "closed_at"?: string,"closed_by"?: string | null,"counted"?: number,"day"?: string,"difference"?: never,"expected"?: number,"id"?: string,"notes"?: string | null,"restaurant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "cash_closings_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"categories": {
                  Row: {
                    "emoji": string | null,"id": string,"is_addons": boolean,"name": string,"note": string | null,"position": number,"restaurant_id": string,"slug": string,"visible": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "emoji"?: string | null,"id"?: string,"is_addons"?: boolean,"name": string,"note"?: string | null,"position"?: number,"restaurant_id": string,"slug": string,"visible"?: boolean
                  }
                  Update: {
                    "emoji"?: string | null,"id"?: string,"is_addons"?: boolean,"name"?: string,"note"?: string | null,"position"?: number,"restaurant_id"?: string,"slug"?: string,"visible"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "categories_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"consents": {
                  Row: {
                    "at": string,"granted": boolean,"id": number,"kind": Database["public"]['Enums']["consent_kind"],"phone": string,"restaurant_id": string,"source": string,"version": string
                  }
                  ComputedFields: never
                  Insert: {
                    "at"?: string,"granted": boolean,"id"?: never,"kind": Database["public"]['Enums']["consent_kind"],"phone": string,"restaurant_id": string,"source": string,"version": string
                  }
                  Update: {
                    "at"?: string,"granted"?: boolean,"id"?: never,"kind"?: Database["public"]['Enums']["consent_kind"],"phone"?: string,"restaurant_id"?: string,"source"?: string,"version"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "consents_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"coupons": {
                  Row: {
                    "active": boolean,"code": string,"detail": string,"ends_on": string | null,"id": string,"kind": Database["public"]['Enums']["coupon_kind"],"max_uses": number | null,"min_total": number,"once_per_phone": boolean,"restaurant_id": string,"starts_on": string | null,"title": string,"uses": number,"value": number,"visible": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"code": string,"detail"?: string,"ends_on"?: string | null,"id"?: string,"kind": Database["public"]['Enums']["coupon_kind"],"max_uses"?: number | null,"min_total"?: number,"once_per_phone"?: boolean,"restaurant_id": string,"starts_on"?: string | null,"title": string,"uses"?: number,"value"?: number,"visible"?: boolean
                  }
                  Update: {
                    "active"?: boolean,"code"?: string,"detail"?: string,"ends_on"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["coupon_kind"],"max_uses"?: number | null,"min_total"?: number,"once_per_phone"?: boolean,"restaurant_id"?: string,"starts_on"?: string | null,"title"?: string,"uses"?: number,"value"?: number,"visible"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "coupons_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"customers": {
                  Row: {
                    "blocked": boolean,"created_at": string,"id": string,"name": string,"notes": string | null,"phone": string,"restaurant_id": string,"trusted": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "blocked"?: boolean,"created_at"?: string,"id"?: string,"name": string,"notes"?: string | null,"phone": string,"restaurant_id": string,"trusted"?: boolean
                  }
                  Update: {
                    "blocked"?: boolean,"created_at"?: string,"id"?: string,"name"?: string,"notes"?: string | null,"phone"?: string,"restaurant_id"?: string,"trusted"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "customers_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"delivery_zones": {
                  Row: {
                    "active": boolean,"fee": number,"id": string,"name": string,"position": number,"restaurant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"fee"?: number,"id"?: string,"name": string,"position"?: number,"restaurant_id": string
                  }
                  Update: {
                    "active"?: boolean,"fee"?: number,"id"?: string,"name"?: string,"position"?: number,"restaurant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "delivery_zones_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"events": {
                  Row: {
                    "active": boolean,"body": string,"captures_leads": boolean,"coupon_id": string | null,"cta_href": string,"cta_label": string,"ends_on": string,"id": string,"image_path": string | null,"kicker": string,"position": number,"restaurant_id": string,"show_intro": boolean,"show_section": boolean,"show_strip": boolean,"starts_on": string,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"body"?: string,"captures_leads"?: boolean,"coupon_id"?: string | null,"cta_href"?: string,"cta_label"?: string,"ends_on": string,"id"?: string,"image_path"?: string | null,"kicker"?: string,"position"?: number,"restaurant_id": string,"show_intro"?: boolean,"show_section"?: boolean,"show_strip"?: boolean,"starts_on"?: string,"title": string
                  }
                  Update: {
                    "active"?: boolean,"body"?: string,"captures_leads"?: boolean,"coupon_id"?: string | null,"cta_href"?: string,"cta_label"?: string,"ends_on"?: string,"id"?: string,"image_path"?: string | null,"kicker"?: string,"position"?: number,"restaurant_id"?: string,"show_intro"?: boolean,"show_section"?: boolean,"show_strip"?: boolean,"starts_on"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "events_coupon_id_fkey"
      columns: ["coupon_id"]
isOneToOne: false
      referencedRelation: "coupons"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "events_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"leads": {
                  Row: {
                    "coupon_id": string | null,"created_at": string,"event_id": string | null,"id": string,"name": string,"phone": string,"restaurant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "coupon_id"?: string | null,"created_at"?: string,"event_id"?: string | null,"id"?: string,"name": string,"phone": string,"restaurant_id": string
                  }
                  Update: {
                    "coupon_id"?: string | null,"created_at"?: string,"event_id"?: string | null,"id"?: string,"name"?: string,"phone"?: string,"restaurant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "leads_coupon_id_fkey"
      columns: ["coupon_id"]
isOneToOne: false
      referencedRelation: "coupons"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "leads_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "leads_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"order_events": {
                  Row: {
                    "at": string,"by_user": string | null,"id": number,"order_id": string,"restaurant_id": string,"status": Database["public"]['Enums']["order_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "at"?: string,"by_user"?: string | null,"id"?: never,"order_id": string,"restaurant_id": string,"status": Database["public"]['Enums']["order_status"]
                  }
                  Update: {
                    "at"?: string,"by_user"?: string | null,"id"?: never,"order_id"?: string,"restaurant_id"?: string,"status"?: Database["public"]['Enums']["order_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_events_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "order_events_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"order_items": {
                  Row: {
                    "combo": boolean,"id": string,"name": string,"order_id": string,"parent_item_id": string | null,"position": number,"product_id": string | null,"qty": number,"restaurant_id": string,"unit_price": number
                  }
                  ComputedFields: never
                  Insert: {
                    "combo"?: boolean,"id"?: string,"name": string,"order_id": string,"parent_item_id"?: string | null,"position"?: number,"product_id"?: string | null,"qty": number,"restaurant_id": string,"unit_price": number
                  }
                  Update: {
                    "combo"?: boolean,"id"?: string,"name"?: string,"order_id"?: string,"parent_item_id"?: string | null,"position"?: number,"product_id"?: string | null,"qty"?: number,"restaurant_id"?: string,"unit_price"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_items_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "order_items_parent_item_id_fkey"
      columns: ["parent_item_id"]
isOneToOne: false
      referencedRelation: "order_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "order_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "order_items_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"orders": {
                  Row: {
                    "address": string,"barrio": string,"cancel_reason": string | null,"cash_with": number | null,"channel": Database["public"]['Enums']["order_channel"],"code": string,"coupon_code": string | null,"created_at": string,"customer_id": string | null,"customer_name": string,"delivery_fee": number,"discount": number,"fulfillment": string,"gift": string | null,"id": string,"notes": string,"number": number,"payment_label": string,"phone": string,"restaurant_id": string,"status": Database["public"]['Enums']["order_status"],"subtotal": number,"total": number,"track_hash": string,"updated_at": string,"zone_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address": string,"barrio"?: string,"cancel_reason"?: string | null,"cash_with"?: number | null,"channel"?: Database["public"]['Enums']["order_channel"],"code": string,"coupon_code"?: string | null,"created_at"?: string,"customer_id"?: string | null,"customer_name": string,"delivery_fee"?: number,"discount"?: number,"fulfillment"?: string,"gift"?: string | null,"id"?: string,"notes"?: string,"number": number,"payment_label": string,"phone": string,"restaurant_id": string,"status"?: Database["public"]['Enums']["order_status"],"subtotal": number,"total": number,"track_hash": string,"updated_at"?: string,"zone_name": string
                  }
                  Update: {
                    "address"?: string,"barrio"?: string,"cancel_reason"?: string | null,"cash_with"?: number | null,"channel"?: Database["public"]['Enums']["order_channel"],"code"?: string,"coupon_code"?: string | null,"created_at"?: string,"customer_id"?: string | null,"customer_name"?: string,"delivery_fee"?: number,"discount"?: number,"fulfillment"?: string,"gift"?: string | null,"id"?: string,"notes"?: string,"number"?: number,"payment_label"?: string,"phone"?: string,"restaurant_id"?: string,"status"?: Database["public"]['Enums']["order_status"],"subtotal"?: number,"total"?: number,"track_hash"?: string,"updated_at"?: string,"zone_name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "orders_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"payment_methods": {
                  Row: {
                    "active": boolean,"asks_change": boolean,"code": string,"id": string,"label": string,"position": number,"restaurant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"asks_change"?: boolean,"code": string,"id"?: string,"label": string,"position"?: number,"restaurant_id": string
                  }
                  Update: {
                    "active"?: boolean,"asks_change"?: boolean,"code"?: string,"id"?: string,"label"?: string,"position"?: number,"restaurant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_methods_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"products": {
                  Row: {
                    "available": boolean,"badge": string | null,"category_id": string,"combo_price": number | null,"description": string,"featured": boolean,"hero": boolean,"id": string,"image_path": string | null,"name": string,"position": number,"price": number,"restaurant_id": string,"slug": string,"updated_at": string,"visible": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "available"?: boolean,"badge"?: string | null,"category_id": string,"combo_price"?: number | null,"description"?: string,"featured"?: boolean,"hero"?: boolean,"id"?: string,"image_path"?: string | null,"name": string,"position"?: number,"price": number,"restaurant_id": string,"slug": string,"updated_at"?: string,"visible"?: boolean
                  }
                  Update: {
                    "available"?: boolean,"badge"?: string | null,"category_id"?: string,"combo_price"?: number | null,"description"?: string,"featured"?: boolean,"hero"?: boolean,"id"?: string,"image_path"?: string | null,"name"?: string,"position"?: number,"price"?: number,"restaurant_id"?: string,"slug"?: string,"updated_at"?: string,"visible"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "products_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "products_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"quotes": {
                  Row: {
                    "created_at": string,"event_date": string | null,"guests": number | null,"id": string,"kind": string,"message": string,"name": string,"phone": string,"restaurant_id": string,"status": Database["public"]['Enums']["quote_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"event_date"?: string | null,"guests"?: number | null,"id"?: string,"kind": string,"message": string,"name": string,"phone": string,"restaurant_id": string,"status"?: Database["public"]['Enums']["quote_status"]
                  }
                  Update: {
                    "created_at"?: string,"event_date"?: string | null,"guests"?: number | null,"id"?: string,"kind"?: string,"message"?: string,"name"?: string,"phone"?: string,"restaurant_id"?: string,"status"?: Database["public"]['Enums']["quote_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "quotes_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"recipes": {
                  Row: {
                    "combo_only": boolean,"product_id": string,"qty": number,"restaurant_id": string,"supply_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "combo_only"?: boolean,"product_id": string,"qty": number,"restaurant_id": string,"supply_id": string
                  }
                  Update: {
                    "combo_only"?: boolean,"product_id"?: string,"qty"?: number,"restaurant_id"?: string,"supply_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "recipes_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "recipes_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "recipes_supply_id_fkey"
      columns: ["supply_id"]
isOneToOne: false
      referencedRelation: "supplies"
      referencedColumns: ["id"]
    }
                  ]
                },"restaurant_settings": {
                  Row: {
                    "accepting_orders": boolean,"blocks": NonNullable<Json>,"brand": NonNullable<Json>,"channels": NonNullable<Json>,"delivery_eta": string,"delivery_min": number,"hero": NonNullable<Json>,"hours": NonNullable<Json>,"instagram": string | null,"intro_mode": Database["public"]['Enums']["intro_mode"],"pickup_enabled": boolean,"protection": Database["public"]['Enums']["protection_level"],"published_at": string | null,"restaurant_id": string,"sections": NonNullable<Json>,"site_url": string | null,"store_address": string | null,"store_hours": NonNullable<Json>,"store_maps_url": string | null,"store_open": boolean,"tiktok": string | null,"updated_at": string,"whatsapp": string | null,"whatsapp_mode": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepting_orders"?: boolean,"blocks"?: NonNullable<Json>,"brand"?: NonNullable<Json>,"channels"?: NonNullable<Json>,"delivery_eta"?: string,"delivery_min"?: number,"hero"?: NonNullable<Json>,"hours"?: NonNullable<Json>,"instagram"?: string | null,"intro_mode"?: Database["public"]['Enums']["intro_mode"],"pickup_enabled"?: boolean,"protection"?: Database["public"]['Enums']["protection_level"],"published_at"?: string | null,"restaurant_id": string,"sections"?: NonNullable<Json>,"site_url"?: string | null,"store_address"?: string | null,"store_hours"?: NonNullable<Json>,"store_maps_url"?: string | null,"store_open"?: boolean,"tiktok"?: string | null,"updated_at"?: string,"whatsapp"?: string | null,"whatsapp_mode"?: string
                  }
                  Update: {
                    "accepting_orders"?: boolean,"blocks"?: NonNullable<Json>,"brand"?: NonNullable<Json>,"channels"?: NonNullable<Json>,"delivery_eta"?: string,"delivery_min"?: number,"hero"?: NonNullable<Json>,"hours"?: NonNullable<Json>,"instagram"?: string | null,"intro_mode"?: Database["public"]['Enums']["intro_mode"],"pickup_enabled"?: boolean,"protection"?: Database["public"]['Enums']["protection_level"],"published_at"?: string | null,"restaurant_id"?: string,"sections"?: NonNullable<Json>,"site_url"?: string | null,"store_address"?: string | null,"store_hours"?: NonNullable<Json>,"store_maps_url"?: string | null,"store_open"?: boolean,"tiktok"?: string | null,"updated_at"?: string,"whatsapp"?: string | null,"whatsapp_mode"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "restaurant_settings_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: true
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"restaurants": {
                  Row: {
                    "active": boolean,"created_at": string,"id": string,"name": string,"order_prefix": string,"plan": string,"slug": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"id"?: string,"name": string,"order_prefix"?: string,"plan"?: string,"slug": string
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"id"?: string,"name"?: string,"order_prefix"?: string,"plan"?: string,"slug"?: string
                  }
                  Relationships: [
                    
                  ]
                },"reviews": {
                  Row: {
                    "approved": boolean,"author": string,"body": string,"created_at": string,"id": string,"restaurant_id": string,"stars": number
                  }
                  ComputedFields: never
                  Insert: {
                    "approved"?: boolean,"author": string,"body": string,"created_at"?: string,"id"?: string,"restaurant_id": string,"stars": number
                  }
                  Update: {
                    "approved"?: boolean,"author"?: string,"body"?: string,"created_at"?: string,"id"?: string,"restaurant_id"?: string,"stars"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "reviews_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"staff": {
                  Row: {
                    "active": boolean,"created_at": string,"full_name": string,"must_change_password": boolean,"permissions": (string)[],"restaurant_id": string,"role": Database["public"]['Enums']["staff_role"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"full_name": string,"must_change_password"?: boolean,"permissions"?: (string)[],"restaurant_id": string,"role"?: Database["public"]['Enums']["staff_role"],"user_id": string
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"full_name"?: string,"must_change_password"?: boolean,"permissions"?: (string)[],"restaurant_id"?: string,"role"?: Database["public"]['Enums']["staff_role"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"supplies": {
                  Row: {
                    "active": boolean,"id": string,"min_stock": number,"name": string,"per_purchase": number,"position": number,"purchase_unit": string,"restaurant_id": string,"stock": number,"unit": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"id"?: string,"min_stock"?: number,"name": string,"per_purchase"?: number,"position"?: number,"purchase_unit": string,"restaurant_id": string,"stock"?: number,"unit": string,"updated_at"?: string
                  }
                  Update: {
                    "active"?: boolean,"id"?: string,"min_stock"?: number,"name"?: string,"per_purchase"?: number,"position"?: number,"purchase_unit"?: string,"restaurant_id"?: string,"stock"?: number,"unit"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "supplies_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"supply_moves": {
                  Row: {
                    "at": string,"by_user": string | null,"id": number,"kind": Database["public"]['Enums']["supply_move_kind"],"note": string | null,"order_id": string | null,"qty": number,"restaurant_id": string,"supply_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "at"?: string,"by_user"?: string | null,"id"?: never,"kind": Database["public"]['Enums']["supply_move_kind"],"note"?: string | null,"order_id"?: string | null,"qty": number,"restaurant_id": string,"supply_id": string
                  }
                  Update: {
                    "at"?: string,"by_user"?: string | null,"id"?: never,"kind"?: Database["public"]['Enums']["supply_move_kind"],"note"?: string | null,"order_id"?: string | null,"qty"?: number,"restaurant_id"?: string,"supply_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "supply_moves_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supply_moves_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supply_moves_supply_id_fkey"
      columns: ["supply_id"]
isOneToOne: false
      referencedRelation: "supplies"
      referencedColumns: ["id"]
    }
                  ]
                },"whatsapp_messages": {
                  Row: {
                    "attempts": number,"claimed_at": string | null,"created_at": string,"error": string | null,"id": string,"kind": Database["public"]['Enums']["wa_kind"],"order_id": string | null,"provider_id": string | null,"restaurant_id": string,"sent_at": string | null,"status": Database["public"]['Enums']["wa_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"claimed_at"?: string | null,"created_at"?: string,"error"?: string | null,"id"?: string,"kind": Database["public"]['Enums']["wa_kind"],"order_id"?: string | null,"provider_id"?: string | null,"restaurant_id": string,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["wa_status"]
                  }
                  Update: {
                    "attempts"?: number,"claimed_at"?: string | null,"created_at"?: string,"error"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["wa_kind"],"order_id"?: string | null,"provider_id"?: string | null,"restaurant_id"?: string,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["wa_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "whatsapp_messages_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "whatsapp_messages_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "board_summary":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"can":
{ Args: { "area": string }; Returns: boolean
                           },
"can_of":
{ Args: { "area": string,"rid": string }; Returns: boolean
                           },
"capture_lead":
{ Args: { "p_consent_version": string,"p_event": string,"p_name": string,"p_phone": string,"p_restaurant": string }; Returns: Json
                           },
"cash_expected":
{ Args: { "p_day"?: string }; Returns: Json
                           },
"close_cash":
{ Args: { "p_counted": number,"p_day": string,"p_notes"?: string }; Returns: Json
                           },
"create_manual_order":
{ Args: { "p": Json }; Returns: string
                           },
"is_admin_of":
{ Args: { "rid": string }; Returns: boolean
                           },
"is_staff_of":
{ Args: { "rid": string }; Returns: boolean
                           },
"my_restaurant":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"my_role":
{ Args: Record<PropertyKey, never>; Returns: Database["public"]['Enums']["staff_role"]
                           },
"my_staff":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"place_order":
{ Args: { "p": Json }; Returns: Json
                           },
"publish_site":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"rate_count":
{ Args: { "p_key": string,"p_seconds": number }; Returns: number
                           },
"rate_hit":
{ Args: { "p_key": string,"p_max": number,"p_seconds": number }; Returns: boolean
                           },
"register_blocked":
{ Args: { "p_reason": string,"p_restaurant": string }; Returns: undefined
                           },
"register_supply":
{ Args: { "p_kind": Database["public"]['Enums']["supply_move_kind"],"p_note"?: string,"p_qty": number,"p_supply": string }; Returns: number
                           },
"revoke_sessions":
{ Args: { "p_user": string }; Returns: undefined
                           },
"sales_export":
{ Args: { "p_days"?: number }; Returns: {
              "canal": string,"codigo": string,"cupon": string,"descuento": number,"domicilio": number,"estado": string,"fecha": string,"pago": string,"productos": string,"subtotal": number,"total": number
            }[]
                           },
"sales_summary":
{ Args: { "p_days"?: number }; Returns: Json
                           },
"set_intro_event":
{ Args: { "p_event": string }; Returns: undefined
                           },
"set_order_status":
{ Args: { "p_order": string,"p_reason"?: string,"p_status": Database["public"]['Enums']["order_status"] }; Returns: undefined
                           },
"stock_status":
{ Args: { "p_restaurant": string }; Returns: Json
                           },
"submit_quote":
{ Args: { "p": Json }; Returns: Json
                           },
"team_list":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"team_restaurant":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"track_order":
{ Args: { "p_code": string,"p_restaurant": string,"p_token": string }; Returns: Json
                           },
"track_order_by_phone":
{ Args: { "p_code": string,"p_last4": string,"p_restaurant": string }; Returns: Json
                           },
"unmark_published":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"weekly_report":
{ Args: { "p_restaurant"?: string }; Returns: Json
                           },
"whatsapp_claim":
{ Args: { "p_limit"?: number }; Returns: Json
                           },
"whatsapp_mark":
{ Args: { "p_error"?: string,"p_id": string,"p_provider"?: string,"p_status": Database["public"]['Enums']["wa_status"] }; Returns: undefined
                           }
          }
          Enums: {
            "consent_kind": "datos_pedido"|"promociones"|"cupon_bienvenida"|"cotizacion","coupon_kind": "porcentaje"|"valor"|"envio"|"regalo","intro_mode": "completa"|"aviso"|"ninguna","order_channel": "web"|"whatsapp"|"manual"|"rappi"|"didi","order_status": "nuevo"|"confirmado"|"en_cocina"|"en_camino"|"entregado"|"cancelado","protection_level": "basica"|"recomendada"|"estricta","quote_status": "nueva"|"contactada"|"cerrada","staff_role": "admin"|"operador","supply_move_kind": "compra"|"venta"|"devolucion"|"merma"|"ajuste","wa_kind": "pedido_recibido"|"aviso_negocio"|"en_camino"|"informe_semanal","wa_status": "pendiente"|"enviado"|"simulado"|"fallido"|"omitido"
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
            "consent_kind": ["datos_pedido", "promociones", "cupon_bienvenida", "cotizacion"],"coupon_kind": ["porcentaje", "valor", "envio", "regalo"],"intro_mode": ["completa", "aviso", "ninguna"],"order_channel": ["web", "whatsapp", "manual", "rappi", "didi"],"order_status": ["nuevo", "confirmado", "en_cocina", "en_camino", "entregado", "cancelado"],"protection_level": ["basica", "recomendada", "estricta"],"quote_status": ["nueva", "contactada", "cerrada"],"staff_role": ["admin", "operador"],"supply_move_kind": ["compra", "venta", "devolucion", "merma", "ajuste"],"wa_kind": ["pedido_recibido", "aviso_negocio", "en_camino", "informe_semanal"],"wa_status": ["pendiente", "enviado", "simulado", "fallido", "omitido"]
          }
        }
} as const
