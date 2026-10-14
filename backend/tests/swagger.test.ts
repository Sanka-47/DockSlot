import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/index';

describe('OpenAPI 3.0 & Swagger UI Integration Tests', () => {
  it('should serve Swagger UI at /api-docs', async () => {
    const res = await request(app).get('/api-docs/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Swagger UI');
    expect(res.text).toContain('swagger-ui');
  });

  it('should redirect /api-docs to /api-docs/', async () => {
    const res = await request(app).get('/api-docs');
    // Express / swagger-ui-express redirects to trailing slash or serves 200/301/302
    expect([200, 301, 302]).toContain(res.status);
  });

  it('should serve raw OpenAPI 3.0 JSON specification at /api-docs.json', async () => {
    const res = await request(app).get('/api-docs.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.0');
    expect(res.body.info.title).toBe('DockSlot Logistics & Dock Scheduling API');
    expect(res.body.info.version).toBe('1.0.0');

    // Verify Bearer Auth security scheme
    expect(res.body.components?.securitySchemes?.bearerAuth).toBeDefined();
    expect(res.body.components.securitySchemes.bearerAuth.type).toBe('http');
    expect(res.body.components.securitySchemes.bearerAuth.scheme).toBe('bearer');

    // Verify key documented endpoints
    expect(res.body.paths).toBeDefined();
    expect(res.body.paths['/auth/register']).toBeDefined();
    expect(res.body.paths['/auth/login']).toBeDefined();
    expect(res.body.paths['/users/invite']).toBeDefined();
    expect(res.body.paths['/bookings']).toBeDefined();
    expect(res.body.paths['/bookings/{id}/reschedule']).toBeDefined();
    expect(res.body.paths['/bookings/{id}/cancel']).toBeDefined();
    expect(res.body.paths['/warehouses/{warehouseId}/slots']).toBeDefined();
  });
});
