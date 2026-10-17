import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger';
import authRoutes from './routes/auth.routes';
import bookingRoutes from './routes/booking.routes';
import warehouseRoutes from './routes/warehouse.routes';
import dockRoutes from './routes/dock.routes';
import userRoutes from './routes/user.routes';
import healthRoutes from './routes/health.route';
import { apiRateLimiter } from './middleware/rateLimit.middleware';
import { errorHandler } from './middleware/error.middleware';
import { requestLogger } from './middleware/requestLogger';

dotenv.config();

const app = express();

// Correlation id + structured logging. Mounted first so every request -
// including ones rejected by the rate limiter or auth - is traced, and so the
// id is available to anything downstream (services, outbox payload).
app.use(requestLogger);

app.use(cors());
app.use(express.json());

// Swagger Documentation UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));


app.get('/swagger.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});
// Expose raw OpenAPI JSON specification
app.get('/api-docs.json', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// Global API Rate Limiter (Redis-backed)
app.use('/api', apiRateLimiter);

// Application Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/warehouses', warehouseRoutes);
app.use('/api/docks', dockRoutes);

// Health Check (public readiness/liveness probe; see routes/health.route.ts)
app.use('/health', healthRoutes);

// Global Error Handler
app.use(errorHandler);

export { app };
export default app;
