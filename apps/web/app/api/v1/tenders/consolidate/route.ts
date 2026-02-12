import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/shared/lib/supabase/server'

/**
 * Consolidation logic:
 * 1. Collect pending pr_items from approved gp_supply requests
 * 2. Group them by material's group_id
 * 3. For each group:
 *    a. If an active contract exists for that material group -> create long_term_orders
 *    b. Otherwise -> create tenders with tender_lots
 */
export async function POST(request: NextRequest) {
  const supabase = createClient()
  const body = await request.json().catch(() => ({}))
  const created_by = body.created_by || null
  const project_id = body.project_id || null

  // Step 1: Fetch pending pr_items from approved gp_supply requests
  let prItemsQuery = supabase
    .from('pr_items')
    .select(`
      *,
      material:material_catalog(id, name, unit, group_id),
      request:purchase_requests!inner(id, project_id, funding_type, status)
    `)
    .eq('status', 'pending')
    .eq('request.funding_type', 'gp_supply')
    .eq('request.status', 'approved')

  if (project_id) {
    prItemsQuery = prItemsQuery.eq('request.project_id', project_id)
  }

  const { data: prItems, error: prItemsError } = await prItemsQuery

  if (prItemsError) {
    return NextResponse.json({ data: null, error: prItemsError.message }, { status: 500 })
  }

  if (!prItems || prItems.length === 0) {
    return NextResponse.json({
      data: { tenders_created: 0, long_term_orders_created: 0 },
      message: 'No pending items to consolidate',
    })
  }

  // Step 2: Group by material group_id
  const groupedByMaterialGroup = new Map<
    string,
    { group_id: string; items: typeof prItems }
  >()

  for (const item of prItems) {
    const groupId = item.material?.group_id || 'ungrouped'
    if (!groupedByMaterialGroup.has(groupId)) {
      groupedByMaterialGroup.set(groupId, { group_id: groupId, items: [] })
    }
    groupedByMaterialGroup.get(groupId)!.items.push(item)
  }

  let tendersCreated = 0
  let longTermOrdersCreated = 0
  const errors: string[] = []

  // Step 3: Process each material group
  for (const [groupId, group] of groupedByMaterialGroup) {
    // Check for active contracts covering this material group
    const { data: activeContracts } = await supabase
      .from('contracts')
      .select('id, supplier_id')
      .eq('status', 'active')
      .limit(1)

    // Simple heuristic: check if any long_term_orders already exist for materials in this group
    // or if there is a contract that covers these materials
    let hasContract = false
    let contractId: string | null = null

    if (activeContracts && activeContracts.length > 0) {
      // Check if any contract has long_term_orders for materials in this group
      const materialIds = group.items.map((i) => i.material_id)
      const { data: existingOrders } = await supabase
        .from('long_term_orders')
        .select('contract_id')
        .in('material_id', materialIds)
        .limit(1)

      if (existingOrders && existingOrders.length > 0) {
        hasContract = true
        contractId = existingOrders[0].contract_id
      }
    }

    if (hasContract && contractId) {
      // Path A: Create long_term_orders for each item
      for (const item of group.items) {
        const { error: ltoError } = await supabase
          .from('long_term_orders')
          .insert({
            contract_id: contractId,
            material_id: item.material_id,
            quantity: item.quantity,
            unit: item.unit,
            required_date: item.required_date,
            status: 'draft',
            pr_item_id: item.id,
            created_by: created_by || '',
          })

        if (ltoError) {
          errors.push(`LTO error for item ${item.id}: ${ltoError.message}`)
          continue
        }

        // Update pr_item status
        await supabase
          .from('pr_items')
          .update({ status: 'ordered', updated_at: new Date().toISOString() })
          .eq('id', item.id)

        longTermOrdersCreated++
      }
    } else {
      // Path B: Create a tender with lots
      const { data: tender, error: tenderError } = await supabase
        .from('tenders')
        .insert({
          project_id: project_id || group.items[0]?.request?.project_id || null,
          material_group_id: groupId === 'ungrouped' ? null : groupId,
          type: 'tender',
          status: 'draft',
          period_start: new Date().toISOString().split('T')[0],
          created_by: created_by || '',
        })
        .select()
        .single()

      if (tenderError) {
        errors.push(`Tender creation error for group ${groupId}: ${tenderError.message}`)
        continue
      }

      tendersCreated++

      // Group items by material_id to aggregate quantities for lots
      const lotsByMaterial = new Map<
        string,
        { material_id: string; totalQty: number; unit: string; prItemIds: string[] }
      >()

      for (const item of group.items) {
        if (!lotsByMaterial.has(item.material_id)) {
          lotsByMaterial.set(item.material_id, {
            material_id: item.material_id,
            totalQty: 0,
            unit: item.unit,
            prItemIds: [],
          })
        }
        const lot = lotsByMaterial.get(item.material_id)!
        lot.totalQty += Number(item.quantity)
        lot.prItemIds.push(item.id)
      }

      // Create tender lots
      for (const [, lotData] of lotsByMaterial) {
        const { data: lot, error: lotError } = await supabase
          .from('tender_lots')
          .insert({
            tender_id: tender.id,
            material_id: lotData.material_id,
            total_quantity: lotData.totalQty,
            unit: lotData.unit,
          })
          .select()
          .single()

        if (lotError) {
          errors.push(`Lot creation error: ${lotError.message}`)
          continue
        }

        // Create tender_lot_requests links
        for (const prItemId of lotData.prItemIds) {
          await supabase.from('tender_lot_requests').insert({
            lot_id: lot.id,
            pr_item_id: prItemId,
          })

          // Update pr_item status to in_tender
          await supabase
            .from('pr_items')
            .update({ status: 'in_tender', updated_at: new Date().toISOString() })
            .eq('id', prItemId)
        }
      }
    }
  }

  return NextResponse.json({
    data: {
      tenders_created: tendersCreated,
      long_term_orders_created: longTermOrdersCreated,
      errors: errors.length > 0 ? errors : undefined,
    },
  }, { status: 201 })
}
