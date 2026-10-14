import swaggerJSDoc, { Options } from 'swagger-jsdoc';
import path from 'path';

const port = process.env.PORT || 5000;

// Resolve patterns with forward slashes for cross-platform Windows/Linux glob compatibility
const routesTs = path.join(__dirname, '../routes/*.ts').replace(/\\/g, '/');
const routesJs = path.join(__dirname, '../routes/*.js').replace(/\\/g, '/');
const controllersTs = path.join(__dirname, '../controllers/*.ts').replace(/\\/g, '/');
const controllersJs = path.join(__dirname, '../controllers/*.js').replace(/\\/g, '/');

const swaggerOptions: Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'DockSlot Logistics & Dock Scheduling API',
      version: '1.0.0',
      description: 'API documentation for multi-tenant logistics platform.',
    },
    servers: [
      {
        url: `http://localhost:${port}/api`,
        description: 'Local development API server',
      },
      {
        url: `http://localhost:${port}`,
        description: 'Root server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT Bearer token in the format: Bearer <token>',
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  apis: [
    routesTs,
    routesJs,
    controllersTs,
    controllersJs,
    './src/routes/*.ts',
    './src/controllers/*.ts',
    './dist/routes/*.js',
    './dist/controllers/*.js',
  ],
};

export const swaggerSpec = swaggerJSDoc(swaggerOptions);
export default swaggerSpec;
