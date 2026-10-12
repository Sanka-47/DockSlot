import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes';
import bookingRoutes from './routes/booking.routes';
import warehouseRoutes from './routes/warehouse.routes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/auth', authRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/warehouses', warehouseRoutes);

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'OK', message: 'DockSlot API is running' });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

export default app;
