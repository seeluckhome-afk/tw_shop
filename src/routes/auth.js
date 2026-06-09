const express = require('express');
const { db } = require('../db');
const { now } = require('../utils/helpers');
const { hashPassword, verifyPassword, signJwt, generateSecret } = require('../utils/auth');
const appConfig = require('../config');

const loginAttempts = new Map();

function loginRateLimit(req, res, next) {
  const key = `${req.ip || req.socket?.remoteAddress || 'local'}:${req.body?.channel || ''}:${req.body?.username || ''}`;
  const nowMs = Date.now();
  const windowMs = 10 * 60 * 1000;
  const maxAttempts = 20;
  const current = loginAttempts.get(key) || { count: 0, resetAt: nowMs + windowMs };
  if (current.resetAt <= nowMs) {
    current.count = 0;
    current.resetAt = nowMs + windowMs;
  }
  current.count += 1;
  loginAttempts.set(key, current);
  if (current.count > maxAttempts) {
    return res.status(429).json({ ok: false, error: '登录尝试过多，请稍后再试' });
  }
  next();
}

function authRoutes(channel) {
  const router = express.Router();

  router.post('/login', loginRateLimit, (req, res) => {
    try {
      const { username, password } = req.body || {};
      if (!username || !password) {
        return res.status(400).json({ ok: false, error: '请输入用户名和密码' });
      }
      const user = db.prepare('SELECT * FROM users WHERE channel = ? AND username = ? AND enabled = 1').get(channel, username);
      if (!user || !verifyPassword(password, user.password_hash, user.salt)) {
        return res.status(401).json({ ok: false, error: '用户名或密码错误' });
      }
      const cfg = appConfig.authConfig();
      const token = signJwt(
        { sub: user.id, username: user.username, channel: user.channel, role: user.role, display_name: user.display_name },
        generateSecret(),
        cfg.jwtExpiresIn
      );
      res.json({ ok: true, token, user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role, channel: user.channel } });
    } catch (e) {
      console.error('[AUTH] login error:', e);
      res.status(500).json({ ok: false, error: '服务器内部错误' });
    }
  });

  router.post('/verify', (req, res) => {
    try {
      const token = req.body?.token || (req.headers.authorization || '').slice(7);
      if (!token) return res.json({ ok: false });
      const payload = require('../utils/auth').verifyJwt(token, generateSecret());
      if (!payload || payload.channel !== channel) return res.json({ ok: false });
      res.json({ ok: true, user: { id: payload.sub, username: payload.username, display_name: payload.display_name, role: payload.role, channel: payload.channel } });
    } catch {
      res.json({ ok: false });
    }
  });

  return router;
}

function managementAuthRoutes() {
  const router = express.Router();

  router.post('/login', loginRateLimit, (req, res) => {
    try {
      const { channel, username, password } = req.body || {};
      if (!channel || !username || !password) {
        return res.status(400).json({ ok: false, error: '请选择渠道并输入用户名和密码' });
      }
      if (!['shopify', 'amazon'].includes(channel)) {
        return res.status(400).json({ ok: false, error: '渠道必须是 shopify 或 amazon' });
      }
      const user = db.prepare('SELECT * FROM users WHERE channel = ? AND username = ? AND enabled = 1').get(channel, username);
      if (!user || !verifyPassword(password, user.password_hash, user.salt)) {
        return res.status(401).json({ ok: false, error: '用户名或密码错误' });
      }
      const cfg = appConfig.authConfig();
      const token = signJwt(
        { sub: user.id, username: user.username, channel: user.channel, role: user.role, display_name: user.display_name },
        generateSecret(),
        cfg.jwtExpiresIn
      );
      res.json({ ok: true, token, user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role, channel: user.channel } });
    } catch (e) {
      console.error('[AUTH] management login error:', e);
      res.status(500).json({ ok: false, error: '服务器内部错误' });
    }
  });

  router.post('/verify', (req, res) => {
    try {
      const token = req.body?.token || (req.headers.authorization || '').slice(7);
      if (!token) return res.json({ ok: false });
      const payload = require('../utils/auth').verifyJwt(token, generateSecret());
      if (!payload) return res.json({ ok: false });
      res.json({ ok: true, user: { id: payload.sub, username: payload.username, display_name: payload.display_name, role: payload.role, channel: payload.channel } });
    } catch {
      res.json({ ok: false });
    }
  });

  return router;
}

function userRoutes() {
  const router = express.Router();

  function requireAdmin(req, res, next) {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ ok: false, error: '需要管理员权限' });
    }
    next();
  }

  router.get('/users', requireAdmin, (req, res) => {
    try {
      const { channel } = req.query;
      let rows;
      if (channel) {
        rows = db.prepare('SELECT id,channel,username,display_name,role,enabled,created_at,updated_at FROM users WHERE channel = ? ORDER BY id').all(channel);
      } else {
        rows = db.prepare('SELECT id,channel,username,display_name,role,enabled,created_at,updated_at FROM users ORDER BY channel,id').all();
      }
      res.json(rows);
    } catch (e) {
      console.error('[AUTH] list users error:', e);
      res.status(500).json({ ok: false, error: '服务器内部错误' });
    }
  });

  router.post('/users', requireAdmin, (req, res) => {
    try {
      const { channel, username, password, display_name, role } = req.body || {};
      if (!channel || !username || !password) {
        return res.status(400).json({ ok: false, error: '渠道、用户名和密码必填' });
      }
      if (!['shopify', 'amazon'].includes(channel)) {
        return res.status(400).json({ ok: false, error: '渠道必须是 shopify 或 amazon' });
      }
      const existing = db.prepare('SELECT id FROM users WHERE channel = ? AND username = ?').get(channel, username);
      if (existing) {
        return res.status(400).json({ ok: false, error: '该渠道下已存在此用户名' });
      }
      const { hash, salt } = hashPassword(password);
      const ts = now();
      const result = db.prepare('INSERT INTO users(channel,username,password_hash,salt,display_name,role,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(channel, username, hash, salt, display_name || username, role || 'operator', 1, ts, ts);
      res.json({ ok: true, id: result.lastInsertRowid });
    } catch (e) {
      console.error('[AUTH] create user error:', e);
      res.status(500).json({ ok: false, error: '服务器内部错误' });
    }
  });

  router.put('/users/:id', requireAdmin, (req, res) => {
    try {
      const { id } = req.params;
      const { username, display_name, role, enabled, password } = req.body || {};
      const user = db.prepare('SELECT id,username FROM users WHERE id = ?').get(id);
      if (!user) return res.status(404).json({ ok: false, error: '用户不存在' });
      if (username && username !== user.username) {
        const dup = db.prepare('SELECT id FROM users WHERE channel = (SELECT channel FROM users WHERE id = ?) AND username = ? AND id != ?').get(id, username, id);
        if (dup) return res.status(400).json({ ok: false, error: '该渠道下已存在此用户名' });
      }
      const ts = now();
      if (password) {
        const { hash, salt } = hashPassword(password);
        db.prepare('UPDATE users SET username=?,display_name=?,role=?,enabled=?,password_hash=?,salt=?,updated_at=? WHERE id=?')
          .run(username || user.username, display_name || username || user.display_name, role, enabled ?? 1, hash, salt, ts, id);
      } else {
        db.prepare('UPDATE users SET username=?,display_name=?,role=?,enabled=?,updated_at=? WHERE id=?')
          .run(username || user.username, display_name || username || user.display_name, role, enabled ?? 1, ts, id);
      }
      res.json({ ok: true });
    } catch (e) {
      console.error('[AUTH] update user error:', e);
      res.status(500).json({ ok: false, error: '服务器内部错误' });
    }
  });

  router.delete('/users/:id', requireAdmin, (req, res) => {
    try {
      const { id } = req.params;
      const user = db.prepare('SELECT id,username FROM users WHERE id = ?').get(id);
      if (!user) return res.status(404).json({ ok: false, error: '用户不存在' });
      if (user.username === 'admin') {
        return res.status(400).json({ ok: false, error: '不能删除默认管理员账号' });
      }
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
      res.json({ ok: true });
    } catch (e) {
      console.error('[AUTH] delete user error:', e);
      res.status(500).json({ ok: false, error: '服务器内部错误' });
    }
  });

  router.post('/users/:id/reset-password', requireAdmin, (req, res) => {
    try {
      const { id } = req.params;
      const { password } = req.body || {};
      if (!password) return res.status(400).json({ ok: false, error: '请输入新密码' });
      const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
      if (!user) return res.status(404).json({ ok: false, error: '用户不存在' });
      const { hash, salt } = hashPassword(password);
      db.prepare('UPDATE users SET password_hash=?,salt=?,updated_at=? WHERE id=?').run(hash, salt, now(), id);
      res.json({ ok: true });
    } catch (e) {
      console.error('[AUTH] reset password error:', e);
      res.status(500).json({ ok: false, error: '服务器内部错误' });
    }
  });

  return router;
}

module.exports = { authRoutes, managementAuthRoutes, userRoutes };
