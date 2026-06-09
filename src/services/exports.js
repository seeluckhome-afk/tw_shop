function pct(v) { return `${((Number(v) || 0) * 100).toFixed(1)}%`; }
function calc(item) { return item.calc_detail || JSON.parse(item.calc_detail_json || '{}'); }
function selected(item) { return item.selected_options || JSON.parse(item.selected_options_json || '{}'); }
function sourceLabel(source) {
  if (source === 'factory_settlement') return '工厂结算';
  if (source === 'factory_cost_total') return '工厂成本合计';
  return '系统预计';
}
function factoryRows(order) {
  return order.items.map(item => {
    const c = calc(item), s = selected(item), b = c.costBreakdown || {};
    return {
      '订单号': order.order_no,
      '下单日期': order.order_date,
      '交期日期': order.delivery_date,
      '客户姓名': order.customer_name,
      '品名/编号': item.item_code,
      '产品': item.product_name,
      '工厂品名': c.product?.factory_name || c.product?.factoryName || item.product_name,
      '宽度': item.width_in,
      '高度': item.length_in,
      '数量': item.qty,
      '实际片数': b.actualPanelQty || c.actualPanelQty || item.qty,
      '面料名称': item.fabric_name,
      '内衬名称': item.lining_name,
      '预计用料米数': b.mainFabricTheoreticalUsageM || 0,
      '发料用料米数': b.mainFabricIssuedUsageM || 0,
      '是否拼接': b.spliceRequired ? '是' : '否',
      '是否定型': b.memoryRequired ? '是' : '否',
      '加工费': c.laborCostRmb || 0,
      '定型费': c.memoryCostRmb || 0,
      '成本合计': item.estimated_cost_rmb || c.estimatedCostRmb || 0,
      '结算': item.factory_settlement_rmb || '',
      '顶部工艺/配件': s.hanging_header_style || s.header_style || '',
      '是否系带': /no need|without|no|无/i.test(s.tieback || '') ? '否' : '是',
      '备注': [item.remark, order.remark, (c.warnings || []).join('；')].filter(Boolean).join('；'),
      '用料米数': item.factory_issued_usage_m || '',
      '实际用料米数': item.factory_actual_usage_m || '',
      '面料单价': item.factory_fabric_price_rmb || '',
      '加工': item.factory_labor_rmb || '',
      '定型': item.factory_memory_rmb || '',
      '工厂成本合计': item.factory_cost_total_rmb || '',
      '工厂结算': item.factory_settlement_rmb || ''
    };
  });
}
function costRows(order) {
  return order.items.map(item => {
    const c = calc(item), b = c.costBreakdown || {};
    return {
      '订单号': order.order_no,
      '项目编号': item.item_code,
      '产品': item.product_name,
      'Width': item.width_in,
      'Length': item.length_in,
      '数量': item.qty,
      '实际片数': b.actualPanelQty || c.actualPanelQty || item.qty,
      '系统售价 USD': item.system_price_usd,
      '实际成交 USD': item.sales_usd,
      '税费 USD': item.tax_usd,
      '主面料理论用料 m': b.mainFabricTheoreticalUsageM || 0,
      '主面料发料用料 m': b.mainFabricIssuedUsageM || 0,
      '主面料单价 RMB/m': b.mainFabricUnitPriceRmb || 0,
      '主面料成本 RMB': c.mainFabricCostRmb || 0,
      '内衬理论用料 m': b.liningTheoreticalUsageM || 0,
      '内衬发料用料 m': b.liningIssuedUsageM || 0,
      '内衬单价 RMB/m': b.liningUnitPriceRmb || 0,
      '内衬成本 RMB': c.liningCostRmb || 0,
      '加工费 RMB': c.laborCostRmb || 0,
      '拼接费 RMB': c.spliceFeeRmb || 0,
      '定型费 RMB': c.memoryCostRmb || 0,
      '选项成本 RMB': c.optionCostRmb || 0,
      '系统预计成本 RMB': item.estimated_cost_rmb || c.estimatedCostRmb || 0,
      '工厂成本合计 RMB': item.factory_cost_total_rmb || '',
      '工厂结算 RMB': item.factory_settlement_rmb || '',
      '最终采用成本 RMB': item.final_cost_rmb || item.cost_rmb,
      '最终成本来源': sourceLabel(item.final_cost_source),
      '利润 RMB': item.profit_rmb,
      '利润率': pct(item.profit_rate)
    };
  });
}
module.exports = { factoryRows, costRows };
