const express = require('express');
const router = express.Router();
const { num } = require('../utils/helpers');
const formulas = require('../formulas');
const { context, calcItemFromPayload } = require('../utils/helpers');
const { route } = require('../utils/api');

router.post('/calc/item', route((req, res) => {
  res.json(calcItemFromPayload(req.body));
}));

router.post('/calc/splice', route((req, res) => {
  const ctx = context();
  const fabric = ctx.fabrics.find(f => f.id === (req.body.fabric_id || req.body.fabricId)) || ctx.fabrics[0];
  const lining = ctx.linings.find(l => l.id === (req.body.lining_id || req.body.liningId));

  const mainPlan = formulas.curtainCutPlan({
    widthIn: num(req.body.width_in ?? req.body.widthIn),
    lengthIn: num(req.body.length_in ?? req.body.lengthIn),
    qty: num(req.body.qty, 1),
    fullness: num(req.body.fullness, 2),
    material: fabric,
    globals: ctx.globals
  });

  const liningPlan = (req.body.has_lining || req.body.hasLining) && lining && lining.width_cm > 0
    ? formulas.curtainCutPlan({
        widthIn: num(req.body.width_in ?? req.body.widthIn),
        lengthIn: num(req.body.length_in ?? req.body.lengthIn),
        qty: num(req.body.qty, 1),
        fullness: num(req.body.fullness, 2),
        material: lining,
        globals: ctx.globals
      })
    : null;

  res.json({
    mainPlan,
    liningPlan,
    warnings: [...mainPlan.warnings, ...(liningPlan?.warnings || [])]
  });
}));

module.exports = router;
