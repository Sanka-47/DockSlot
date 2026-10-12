import dotenv from 'dotenv';

dotenv.config();

export const appConfig = {
  port: Number(process.env.PORT) || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
};
