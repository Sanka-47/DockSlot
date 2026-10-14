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
import { errorHandler } from './middleware/error.middleware';

dotenv.config();

const app = express();

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

// Application Routes
app.use('/api/auth', authRoutes);
app.use('/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/users', userRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/warehouses', warehouseRoutes);
app.use('/api/docks', dockRoutes);

// Health Check
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'OK', message: 'DockSlot API is running' });
});

// Global Error Handler
app.use(errorHandler);

export { app };
export default app;
