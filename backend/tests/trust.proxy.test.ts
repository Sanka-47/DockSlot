import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import app from '../src/index';
import { parseTrustProxy } from '../src/config/proxy.config';

/**
 * Behind a load balancer, `req.ip` is the proxy's address unless Express is told
 * which proxies to trust - which silently collapses every IP-keyed rate limit
 * (and the request logs) onto one key. TRUST_PROXY configures that.
 */
describe('TRUST_PROXY configuration', () => {
  it('returns undefined for unset/blank values so Express keeps its default (trust nothing)', () => {
    expect(parseTrustProxy(undefined)).toBeUndefined();
    expect(parseTrustProxy('')).toBeUndefined();
    expect(parseTrustProxy('   ')).toBeUndefined();
  });

  it('parses a hop count as a number', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy(' 2 ')).toBe(2);
  });

  it('passes booleans and subnet lists through as strings', () => {
    expect(parseTrustProxy('true')).toBe('true');
    expect(parseTrustProxy('false')).toBe('false');
    expect(parseTrustProxy('10.0.0.0/8, 172.16.0.0/12')).toBe('10.0.0.0/8, 172.16.0.0/12');
  });

  it('is wired into the real app from the TRUST_PROXY env var', () => {
    expect(app.get('trust proxy')).toEqual(parseTrustProxy(process.env.TRUST_PROXY) ?? false);
  });

  it('makes req.ip the real client when one proxy hop is trusted', async () => {
    const probe = express();
    probe.set('trust proxy', parseTrustProxy('1')!);
    probe.get('/', (req, res) => {
      res.json({ ip: req.ip });
    });

    const res = await request(probe).get('/').set('X-Forwarded-For', '203.0.113.7');

    expect(res.body.ip).toBe('203.0.113.7');
  });

  it('ignores X-Forwarded-For when no proxy is trusted', async () => {
    const probe = express();
    probe.get('/', (req, res) => {
      res.json({ ip: req.ip });
    });

    const res = await request(probe).get('/').set('X-Forwarded-For', '203.0.113.7');

    expect(res.body.ip).not.toBe('203.0.113.7');
    expect(res.body.ip).toMatch(/127\.0\.0\.1|::1|::ffff:127\.0\.0\.1/);
  });
});
